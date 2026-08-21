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

function circuitRank(c: Circuit): number {
  const i = CIRCUIT_ORDER.indexOf(c);
  return i === -1 ? CIRCUIT_ORDER.length : i;
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

const DEFAULTS: Required<LayoutOptions> = { x0: 40, y0: 40, colW: 180, rowH: 116, maxPerRow: 6 };

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
 * Agence les nœuds en cascade groupée par circuit. Chaque circuit forme une (ou
 * plusieurs) bande(s) horizontale(s) ; les bandes s'empilent dans l'ordre du
 * procédé. Renvoie une position par id.
 */
export function layoutByCircuit(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions = {},
): Map<string, Position> {
  const opt = { ...DEFAULTS, ...options };
  const depth = topoDepth(nodes, edges);
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));

  // Tri : circuit (rang procédé) → profondeur → ordre d'origine.
  const ordered = [...nodes].sort((a, b) => {
    const ca = circuitRank(unitCircuit(a.unit_type));
    const cb = circuitRank(unitCircuit(b.unit_type));
    if (ca !== cb) return ca - cb;
    const da = depth.get(a.id) ?? 0, db = depth.get(b.id) ?? 0;
    if (da !== db) return da - db;
    return (indexOf.get(a.id) ?? 0) - (indexOf.get(b.id) ?? 0);
  });

  const pos = new Map<string, Position>();
  let row = 0, col = 0;
  let prevCircuit: Circuit | null = null;

  for (const n of ordered) {
    const circuit = unitCircuit(n.unit_type);
    // Nouvelle bande quand le circuit change (et que la bande courante n'est pas
    // vide) ou quand la bande est pleine.
    if ((prevCircuit !== null && circuit !== prevCircuit && col > 0) || col >= opt.maxPerRow) {
      row++; col = 0;
    }
    pos.set(n.id, { x: opt.x0 + col * opt.colW, y: opt.y0 + row * opt.rowH });
    col++;
    prevCircuit = circuit;
  }

  return pos;
}
