// ─────────────────────────────────────────────────────────────────────────────
// Agencement du flowsheet EN CASCADE, GROUPÉ PAR CIRCUIT — module PUR.
//
// Un flowsheet aurifère n'est pas une file d'unités : c'est une succession de
// CIRCUITS (comminution, flottation, lixiviation, ADR, électrométallurgie,
// résidus…). Les poser sur une seule ligne horizontale rend le schéma illisible
// et oblige à dézoomer. Ce module regroupe les unités par circuit et empile les
// circuits en cascade (bandes qui descendent dans l'ordre du procédé), de sorte
// que le schéma tienne dans le panneau sans zoom.
//
// Réutilisé par les DEUX constructeurs de templates (templates.ts sériel et
// templateLibrary.ts branché) pour un rendu homogène.
// ─────────────────────────────────────────────────────────────────────────────

import { getUnit } from './unitRegistry';

/** Ordre des circuits dans le procédé (haut → bas de la cascade). */
export const CIRCUIT_ORDER = [
  'Alimentation',
  'Comminution',
  'Séparation S/L',
  'Flottation',
  'Lixiviation',
  'ADR',
  'Électrométallurgie',
  'Doré',
  'Effluents',
  'Résidus',
  'Utilitaires',
] as const;

export type Circuit = typeof CIRCUIT_ORDER[number];

/** Unités d'alimentation — recatégorisées hors de « Utilitaires ». */
const FEED_UNITS = new Set(['feed_source', 'stockpile', 'apron_feeder', 'silo', 'vibrating_feeder']);

/**
 * Circuit d'appartenance d'une unité. Part de la catégorie du registre, avec
 * quelques recatégorisations pour que l'alimentation, le doré et les résidus
 * forment leurs propres bandes plutôt que d'être noyés dans « Utilitaires » /
 * « Effluents ».
 */
export function unitCircuit(unitType: string): Circuit {
  if (unitType === 'product_sink' || unitType === 'dore_refinery') return 'Doré';
  if (unitType === 'tailings_pond') return 'Résidus';
  if (FEED_UNITS.has(unitType)) return 'Alimentation';
  const cat = getUnit(unitType)?.category;
  if (cat && (CIRCUIT_ORDER as readonly string[]).includes(cat)) return cat as Circuit;
  return 'Utilitaires';
}

export interface LayoutNode { id: string; unit_type: string }
export interface LayoutEdge { source: string; target: string }
export interface Position { x: number; y: number }

export interface LayoutOptions {
  x0?: number; y0?: number;
  colW?: number; rowH?: number;
  /** Nombre max d'unités par bande avant retour à la ligne dans le même circuit. */
  maxPerRow?: number;
}

const DEFAULTS: Required<LayoutOptions> = { x0: 40, y0: 40, colW: 210, rowH: 140, maxPerRow: 6 };

/**
 * Profondeur topologique (plus long chemin depuis une source) — ordonne les
 * unités DANS un circuit selon le sens du procédé. Robuste aux cycles.
 */
function topoDepth(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, number> {
  const succ = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) { succ.set(n.id, []); indeg.set(n.id, 0); }
  for (const e of edges) {
    if (!succ.has(e.source) || !indeg.has(e.target)) continue;
    succ.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const depth = new Map<string, number>(nodes.map(n => [n.id, 0]));
  const queue = nodes.filter(n => (indeg.get(n.id) ?? 0) === 0).map(n => n.id);
  const seen = new Set<string>();
  while (queue.length) {
    const k = queue.shift()!;
    if (seen.has(k)) continue;
    seen.add(k);
    for (const s of succ.get(k) ?? []) {
      depth.set(s, Math.max(depth.get(s) ?? 0, (depth.get(k) ?? 0) + 1));
      const d = (indeg.get(s) ?? 1) - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  return depth;
}

/**
 * Agence les nœuds en couches par PROFONDEUR DE FLUX (cascade haut → bas), le
 * sens du procédé donnant l'axe vertical : une unité est placée sous celles qui
 * l'alimentent, donc les arêtes relient des rangées ADJACENTES (sauts courts)
 * au lieu de traverser tout le schéma. Dans chaque couche, l'ordre des unités
 * est optimisé par barycentre (réduction des croisements). Une couche plus large
 * que `maxPerRow` déborde sur des sous-rangées. Renvoie une position par id.
 *
 * Le tri par circuit d'antan produisait des bandes où des unités connectées se
 * retrouvaient loin l'une de l'autre → arêtes en longues courbes illisibles.
 * Ici la couche = profondeur de flux, ce qui suit la topologie réelle.
 */
export function layoutByCircuit(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Position> {
  const opt = { ...DEFAULTS, ...options };
  const depth = topoDepth(nodes, edges);
  const origIndex = new Map(nodes.map((n, i) => [n.id, i]));

  // Voisinage (arêtes internes seulement).
  const idSet = new Set(nodes.map(n => n.id));
  const preds = new Map<string, string[]>();
  const succ = new Map<string, string[]>();
  for (const n of nodes) { preds.set(n.id, []); succ.set(n.id, []); }
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    succ.get(e.source)!.push(e.target);
    preds.get(e.target)!.push(e.source);
  }

  // Rapproche les sources-appoint (réactifs, chaux, air : aucun amont mais un
  // aval) juste AU-DESSUS de leur consommateur, plutôt qu'en haut du schéma —
  // sinon un réactif injecté au CIL tirerait une arête sur toute la hauteur.
  // L'alimentation minerai réelle (aval en profondeur 1) reste tout en haut.
  for (const n of nodes) {
    const ps = preds.get(n.id)!;
    const ss = succ.get(n.id)!;
    if (ps.length === 0 && ss.length > 0) {
      const minSucc = Math.min(...ss.map(s => depth.get(s) ?? 0));
      depth.set(n.id, Math.max(0, minSucc - 1));
    }
  }

  // Regroupe par profondeur, ordre d'origine stable dans chaque couche.
  const maxD = nodes.reduce((m, n) => Math.max(m, depth.get(n.id) ?? 0), 0);
  const layers: string[][] = Array.from({ length: maxD + 1 }, () => []);
  for (const n of [...nodes].sort((a, b) => (origIndex.get(a.id)! - origIndex.get(b.id)!))) {
    layers[depth.get(n.id) ?? 0].push(n.id);
  }

  // Index (colonne logique) de chaque nœud dans sa couche.
  const order = new Map<string, number>();
  layers.forEach(L => L.forEach((id, i) => order.set(id, i)));

  // Barycentre : moyenne des positions des voisins dans la couche de référence.
  // Un nœud sans voisin garde sa place (clé = sa position courante).
  const barycenter = (id: string, neigh: Map<string, string[]>): number => {
    const ns = neigh.get(id) ?? [];
    if (!ns.length) return order.get(id) ?? 0;
    return ns.reduce((s, x) => s + (order.get(x) ?? 0), 0) / ns.length;
  };

  // Balayages descendants (par les prédécesseurs) puis montants (successeurs).
  for (let iter = 0; iter < 4; iter++) {
    const down = iter % 2 === 0;
    const neigh = down ? preds : succ;
    const range = down ? layers.map((_, d) => d) : layers.map((_, d) => d).reverse();
    for (const d of range) {
      const L = layers[d];
      if (L.length < 2) continue;
      const keyed = L.map(id => ({ id, k: barycenter(id, neigh), o: order.get(id)! }));
      keyed.sort((a, b) => (a.k === b.k ? a.o - b.o : a.k - b.k));
      layers[d] = keyed.map(x => x.id);
      layers[d].forEach((id, i) => order.set(id, i));
    }
  }

  // Positions : couches empilées (y = profondeur/sous-rangée), débordement au-delà
  // de maxPerRow, alignées à gauche (x0) pour garder un tronc vertical lisible.
  const pos = new Map<string, Position>();
  let physRow = 0;
  for (const L of layers) {
    if (!L.length) continue;
    L.forEach((id, i) => {
      const col = i % opt.maxPerRow;
      const sub = Math.floor(i / opt.maxPerRow);
      pos.set(id, { x: opt.x0 + col * opt.colW, y: opt.y0 + (physRow + sub) * opt.rowH });
    });
    physRow += Math.ceil(L.length / opt.maxPerRow);
  }

  return pos;
}
