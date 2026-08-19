// ─────────────────────────────────────────────────────────────────────────────
// MOYENNES DES ESSAIS LIMS — module PUR.
//
// ── Ce que ce module montre, et ce qu'il ne montre PAS ──────────────────────
//
// Il expose ce que le LABORATOIRE a mesuré, famille par famille. C'est la
// matière première des routes, jamais leur résultat :
//
//   • Un essai de lixiviation est une bouteille agitée. Il dit combien d'or se
//     DISSOUT. Il ne dit rien du transfert labo → usine, ni de l'adsorption sur
//     charbon. La récupération de circuit qui en découle est toujours PLUS BASSE
//     que l'essai (voir routeEstimation, principe n° 2).
//   • Un GRG dit ce que le MINERAI offre à la gravité, pas ce que le circuit en
//     voit — celui-ci est borné par la fraction d'underflow dérivée.
//
// D'où la règle d'affichage : ces moyennes ne se comparent pas aux cartes de
// récupération de circuit, et le libellé doit le dire. Les confondre est
// l'erreur que ce module rend visible plutôt que possible.
//
// ── Pourquoi PAS de moyenne toutes familles confondues ──────────────────────
// Moyenner une lixiviation (79 %) avec un GRG (51 %) et une flottation (86 %)
// n'a aucun sens : trois mesures d'or différentes, sur trois alimentations
// différentes, dont deux ne s'additionnent pas. Ce qui les combine légitimement
// est une ROUTE, avec sa formule (voir routeEstimation).
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import type { RouteMetrics, RouteSampleCounts } from './routeEstimation';

/** Une famille d'essais LIMS, réduite à ce qu'elle mesure. */
export interface TestworkAverage {
  /** Clé stable — sert de clé de rendu, jamais affichée. */
  key: string;
  /** Nom de la famille tel qu'affiché. */
  label: string;
  /** Moyenne des essais de la famille (%), `null` quand il n'y en a aucun. */
  meanPct: number | null;
  /** Nombre d'essais de la famille. */
  n: number;
  /**
   * Valeur du modèle d'étage AJUSTÉ, lue à la teneur d'alimentation du projet.
   * C'est elle — et non la moyenne brute — qui alimente les routes quand elle
   * existe : un rapport technique ajuste, il ne moyenne pas. `null` quand les
   * essais ne soutiennent aucun ajustement.
   */
  fittedPct: number | null;
  /** Ce que la famille mesure — pour l'infobulle. */
  note: string;
}

/** Valeurs ajustées à la teneur d'alimentation, quand un modèle les soutient. */
export interface FittedStageValues {
  leachPct?: number | null;
  flotationPct?: number | null;
}

/**
 * Moyennes des essais du projet, famille par famille.
 *
 * Les familles sans essais sont CONSERVÉES avec `meanPct: null` : une famille
 * absente est une lacune de caractérisation à combler, pas une ligne à masquer.
 * C'est elle qui explique qu'une route ne soit pas chiffrable.
 */
export function summariseTestwork(
  m: RouteMetrics,
  counts: RouteSampleCounts,
  fitted: FittedStageValues = {},
): TestworkAverage[] {
  const clean = (v: number | null | undefined): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  return [
    {
      key: 'leach48',
      label: 'Lixiviation 48 h',
      meanPct: clean(m.leachRec48Pct),
      n: counts.leaching,
      fittedPct: clean(fitted.leachPct),
      note: 'Bouteille agitée à la durée FINALE — référence de conception. Or DISSOUS, '
          + 'avant transfert usine et adsorption sur charbon.',
    },
    {
      key: 'leach24',
      label: 'Lixiviation 24 h',
      meanPct: clean(m.leachRec24Pct),
      n: counts.leaching,
      fittedPct: null,
      note: 'Point de CINÉTIQUE intermédiaire — sert de repli si le 48 h manque, '
          + 'jamais de référence de conception.',
    },
    {
      key: 'grg',
      label: 'Gravité (GRG)',
      meanPct: clean(m.grgPct),
      n: counts.knelson,
      fittedPct: null,
      note: 'Or gravi-récupérable : ce que le MINERAI offre. Le circuit n\'en voit '
          + 'que la fraction du cyclone underflow qu\'il dérive.',
    },
    {
      key: 'flotation',
      label: 'Flottation Au',
      meanPct: clean(m.flotationAuRecPct),
      n: counts.flotation,
      fittedPct: clean(fitted.flotationPct),
      note: 'Récupération de l\'or au concentré de flottation, avant rendement d\'étage.',
    },
    {
      key: 'auFree',
      label: 'Or libre',
      meanPct: clean(m.auFreePct),
      n: counts.mineralogy,
      fittedPct: null,
      note: 'Libération minéralogique — conditionne l\'éligibilité d\'une lixiviation '
          + 'en tas, ce n\'est pas une récupération de circuit.',
    },
  ];
}

/** Vrai dès qu'une famille au moins a été mesurée. */
export function hasAnyTestwork(rows: TestworkAverage[]): boolean {
  return rows.some(r => r.meanPct != null);
}
