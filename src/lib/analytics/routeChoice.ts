// ─────────────────────────────────────────────────────────────────────────────
// Route métallurgique RETENUE PAR L'UTILISATEUR — module PUR.
//
// `estimateRoutes` classe les routes candidates et en RECOMMANDE une. Mais la
// décision appartient au métallurgiste : c'est le flowsheet qu'il compose dans
// « Critères de conception » (assistant guidé, étape « Route de récupération de
// l'or ») qui fait foi. Tout l'applicatif — production annuelle, revenus, AISC,
// graphique de récupération — doit suivre CE choix, pas la recommandation.
//
// Le choix est persisté indirectement, par les ÉQUIPEMENTS activés dans
// `dc_draft.content.equip`. Ce module traduit cet ensemble d'équipements en la
// route correspondante du catalogue, sans dupliquer aucune formule : il se
// contente de RETROUVER la route déjà chiffrée par `estimateRoutes`.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import type { RouteEstimate } from './routeEstimation';
import { REFRACTORY_CIRCUITS } from './refractoryCircuit';

/** Libellés des circuits oxydants — dérivés du registre, jamais réécrits ici. */
const OXIDATION_LABELS = Object.values(REFRACTORY_CIRCUITS).map(c => c.label);

/**
 * Identifiants d'équipement (sections de « Critères de conception ») qui
 * caractérisent une route. Les autres — concassage, broyage, services — ne
 * distinguent aucune route et sont ignorés.
 */
export const ROUTE_DEFINING_EQUIPMENT = {
  gravity: 'gravity',
  flotation: 'flotation',
  leach: 'cil',
  heap: 'heap_leach',
  regrind: ['vertimill', 'isamill', 'towermill'],
  oxidation: ['pox', 'biox', 'roasting', 'albion'],
} as const;

/** Route retenue, exprimée par les étages que l'utilisateur a activés. */
export interface FlowsheetRoute {
  gravity: boolean;
  flotation: boolean;
  leach: boolean;
  heap: boolean;
  regrind: boolean;
  oxidation: boolean;
}

/** Un équipement est retenu si sa case est cochée (absent = non retenu). */
function on(equip: Record<string, boolean> | null | undefined, id: string): boolean {
  return equip?.[id] === true;
}

/** Lit le flowsheet de l'utilisateur et en extrait les étages déterminants. */
export function flowsheetRoute(equip: Record<string, boolean> | null | undefined): FlowsheetRoute {
  const E = ROUTE_DEFINING_EQUIPMENT;
  return {
    gravity: on(equip, E.gravity),
    flotation: on(equip, E.flotation),
    leach: on(equip, E.leach),
    heap: on(equip, E.heap),
    regrind: E.regrind.some(id => on(equip, id)),
    oxidation: E.oxidation.some(id => on(equip, id)),
  };
}

/**
 * Motif de reconnaissance d'une route du catalogue dans la liste renvoyée par
 * `estimateRoutes`. On matche sur le LIBELLÉ car c'est lui qui porte la
 * distinction de flowsheet (« … (concentré) »), et il est déjà testé.
 */
interface RoutePattern {
  /**
   * Ce que ce motif décrit, en clair — affiché quand le flowsheet désigne une
   * route que les essais ne permettent pas de chiffrer.
   */
  label: string;
  /** Vrai si le flowsheet de l'utilisateur correspond à cette route. */
  matches: (f: FlowsheetRoute) => boolean;
  /** Retrouve la route correspondante parmi les candidates chiffrées. */
  find: (routes: RouteEstimate[]) => RouteEstimate | undefined;
}

const startsWith = (prefix: string) => (routes: RouteEstimate[]) =>
  routes.find(r => r.route.startsWith(prefix));

/**
 * Motifs ORDONNÉS du plus spécifique au plus général : un flowsheet
 * gravité+flottation+CIL doit matcher la route à trois étages, pas la route
 * gravité+CIL qui est aussi « compatible ».
 */
const ROUTE_PATTERNS: RoutePattern[] = [
  // Réfractaire — l'oxydation prime sur tout le reste. Le libellé porte le nom
  // du circuit RETENU (POX, BIOX, Grillage, Albion), pas un « Oxydation »
  // générique : on reconnaît donc n'importe lequel d'entre eux.
  {
    label: 'Flottation + oxydation + cyanuration',
    matches: f => f.oxidation && f.flotation,
    find: routes => routes.find(r => OXIDATION_LABELS.some(l => r.route.startsWith(`Flottation + ${l} +`))),
  },
  // Gravité + flottation + cyanuration.
  {
    label: 'Gravité + flottation + cyanuration',
    matches: f => f.gravity && f.flotation && f.leach,
    // Deux circuits gravité+flottation+CIL coexistent au catalogue : celui qui
    // LIXIVIE LES RÉSIDUS de flottation (« … + Flottation + CIL (résidus de
    // flottation) ») et celui qui envoie ces rejets au parc (« Gravité (Knelson)
    // + Flottation + CIL »). L'assistant « Gravité + Flottation + Lixiviation
    // (CIL) » décrit « lixiviation CIL du reste » = résidus lixiviés. Les routes
    // étant triées par récupération DÉCROISSANTE (estimateRoutes), on retient la
    // plus performante des deux. Le motif exige que le CIL/CIP suive
    // IMMÉDIATEMENT « + Flottation + », ce qui exclut la route réfractaire
    // « … + Flottation + POX/BIOX + CIL » (traitée par le motif oxydation).
    find: routes => routes.find(r => /^Gravité .*\+ Flottation \+ (CIL|CIP)/.test(r.route)),
  },
  // Flottation + rebroyage + cyanuration (sans gravité).
  {
    label: 'Flottation + rebroyage + cyanuration',
    matches: f => f.flotation && f.leach,
    find: startsWith('Flottation + Rebroyage'),
  },
  // Gravité + cyanuration.
  {
    label: 'Gravité + cyanuration',
    matches: f => f.gravity && f.leach,
    find: routes => routes.find(r => /^Gravité \(Knelson\) \+ (CIL|CIP)$/.test(r.route)),
  },
  // Lixiviation en tas.
  {
    label: 'Lixiviation en tas',
    matches: f => f.heap,
    find: startsWith('Lixiviation en tas'),
  },
  // Cyanuration directe du tout-venant.
  {
    label: 'Cyanuration directe du tout-venant',
    matches: f => f.leach,
    find: routes => routes.find(r => /^(CIL|CIP) direct/.test(r.route)),
  },
];

/**
 * Route retenue, ET l'écart éventuel entre ce que le flowsheet DÉCRIT et ce que
 * les essais permettent de CHIFFRER.
 *
 * Cet écart doit être porté jusqu'à l'écran : sans lui, l'application affichait
 * « Route retenue : CIL direct » à un métallurgiste qui avait coché gravité +
 * CIL, lui attribuant un choix qu'il n'avait pas fait.
 */
export interface RouteChoice {
  /** La route effectivement chiffrée, telle que sortie de `estimateRoutes`. */
  estimate: RouteEstimate;
  /** Ce que le flowsheet coché décrit, en clair. */
  requested: string;
  /**
   * Vrai quand `estimate` est MOINS spécifique que `requested` : la route cochée
   * n'était pas chiffrable faute d'essais, et un repli a été appliqué.
   */
  downgraded: boolean;
}

/**
 * Route retenue par l'utilisateur, telle que chiffrée par `estimateRoutes`.
 *
 * Renvoie `null` quand le flowsheet ne désigne AUCUNE route connue. L'appelant
 * retombe alors sur la recommandation du moteur — jamais sur un chiffre inventé.
 *
 * ⚠️ Quand la route décrite par le flowsheet n'est pas chiffrable faute d'essais
 * (flottation cochée sans essai de flottation, gravité cochée sans essai
 * Knelson), la recherche se poursuit sur les motifs MOINS spécifiques : un
 * flowsheet gravité + CIL sans Knelson se résout en « CIL direct ». Ce repli est
 * volontaire — il vaut mieux chiffrer le tronçon soutenu par les essais que ne
 * rien afficher — mais il n'est JAMAIS silencieux : `downgraded` le signale, et
 * l'écran doit le dire. Une route de repli présentée comme « retenue » attribue
 * au métallurgiste une décision qu'il n'a pas prise.
 */
export function chosenRoute(
  routes: RouteEstimate[],
  equip: Record<string, boolean> | null | undefined,
): RouteChoice | null {
  if (routes.length === 0) return null;
  const f = flowsheetRoute(equip);
  // Le PREMIER motif que le flowsheet satisfait est ce que l'utilisateur décrit ;
  // les suivants ne sont que des replis de plus en plus grossiers.
  let requested: string | null = null;
  for (const p of ROUTE_PATTERNS) {
    if (!p.matches(f)) continue;
    if (requested === null) requested = p.label;
    const hit = p.find(routes);
    if (hit) return { estimate: hit, requested, downgraded: p.label !== requested };
  }
  return null;
}
