// ─────────────────────────────────────────────────────────────────────────────
// Estimation des routes métallurgiques candidates — moteur PUR et PARTAGÉ.
//
// Ce calcul vivait en ligne dans la page « Analyse et Interprétation ». La
// section P80 de Granulométrie doit recommander la même route : la dupliquer
// aurait garanti la divergence des deux écrans dès la première évolution — le
// défaut exact que l'app a déjà connu entre « Synthèse LIMS » et « Route
// Métallurgique » (deux circuits recommandés pour le même projet).
//
// Chaque route est estimée par une formule de récupération EXPLICITE :
//   • étages en série indépendants  R = 1 − ∏(1 − Rᵢ)
//   • ou bilan massique quand un étage sépare le flux (flottation).
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS } from '../config/constants';
import { ROUTE_ESTIMATION, selectRecommendedRoute } from './routeSelection';

/** Une route candidate et son estimation. */
export interface RouteEstimate {
  route: string;
  recovery_pct: number;
  confidence: 'high' | 'medium' | 'low';
  /** 0–100 : à quel point les essais LIMS soutiennent les paramètres de cette route. */
  dataQualityScore: number;
  basis: string;
  references: string[];
  recommended?: boolean;
  capex_indicator: 'low' | 'medium' | 'high';
  opex_indicator: 'low' | 'medium' | 'high';
}

/**
 * Rendements des étages unitaires composant les routes.
 *
 * ⚠️ Facteurs de transposition labo → usine et rendements d'étage SPÉCIFIQUES
 * AU MINERAI ET AU CIRCUIT. Ils étaient écrits en dur dans la page, donc
 * invisibles à la revue. Ils doivent être recalés sur les essais du projet
 * (pilote, courbes de cyanuration, essais de flottation) avant qu'une étude
 * s'appuie sur les récupérations produites ici.
 */
export const ROUTE_STAGE_EFFICIENCIES = {
  /** Rendement du circuit gravité en CIP (moins efficace que le CIL de référence). */
  gravityCipTransfer: 0.88,
  /** Rendement d'adsorption d'un circuit CIP sur queues de gravité. */
  cipAdsorption: 0.96,
  /** Part de la pénalité preg-robbing appliquée en CIP (charbon ajouté après lixiviation). */
  cipPregRobbingShare: 0.5,
  /** Rendement de la flottation de l'or (efficacité de l'étage). */
  flotationAu: 0.94,
  /** Rendement de flottation des sulfures avant prétraitement oxydant. */
  flotationSulphides: 0.93,
  /** Récupération par défaut de la flottation (%) quand aucun essai n'existe. */
  flotationDefaultRecoveryPct: 85,
  /** Gain de cinétique de lixiviation (pts) sur un concentré rebroyé. */
  regrindLeachBonusPts: 5,
  /** Plafond de lixiviation d'un concentré rebroyé (fraction). */
  regrindLeachMax: 0.97,
  /** Perte de cinétique (pts) sur les queues de flottation. */
  tailsLeachPenaltyPts: 10,
  /** Rendement de la lixiviation sur queues de flottation (plus lente). */
  tailsLeachEfficiency: 0.75,
  /** Libération de l'or verrouillé par oxydation sous pression / grillage. */
  oxidationLiberation: 0.97,
  /** Gain de lixiviation (pts) après oxydation. */
  postOxidationLeachBonusPts: 8,
  /** Plafond de lixiviation après oxydation (fraction). */
  postOxidationLeachMax: 0.97,
  /** Plafond de récupération d'une lixiviation directe (%). */
  directLeachMaxPct: 98,
  /** Plafond de récupération d'une route flottation + lixiviation (%). */
  flotationRouteMaxPct: 97,
  /** GRG (%) au-delà duquel la route gravité est jugée de confiance élevée. */
  gravityHighConfidenceGrgPct: 10,
  /** Sulfures (%) au-delà desquels une route oxydante est envisagée. */
  refractorySulphidesPct: 2,
  /** Récupération (%) au-delà de laquelle une lixiviation directe est de confiance élevée. */
  directLeachHighConfidencePct: 80,
  /** …et en deçà de laquelle elle devient de confiance faible. */
  directLeachLowConfidencePct: 65,
} as const;

/** Nombre d'essais disponibles par famille — pilote le score de qualité de données. */
export interface RouteSampleCounts {
  chem: number;
  comminution: number;
  knelson: number;
  flotation: number;
  leaching: number;
  mineralogy: number;
}

/** Moyennes robustes des essais, déjà agrégées par l'appelant. */
export interface RouteMetrics {
  /** Récupération de lixiviation à 24 h (%). */
  leachRec24Pct: number | null;
  /** Récupération de lixiviation à 48 h (%). */
  leachRec48Pct: number | null;
  /** Or gravimétrique récupérable GRG (%). */
  grgPct: number | null;
  /** Carbone organique (%). */
  organicCarbonPct: number | null;
  /** Récupération de flottation de l'or (%). */
  flotationAuRecPct: number | null;
  /** Soufre sulfure (%). */
  sulphidePct: number | null;
  /** Or libre (%). */
  auFreePct: number | null;
}

export interface RouteEstimationInputs {
  metrics: RouteMetrics;
  counts: RouteSampleCounts;
  /** Recommandation CIL vs CIP, pour départager une quasi-égalité. */
  adsorptionPreference?: 'CIL' | 'CIP';
}

/** Nombre d'essais par paramètre au-delà duquel le score de qualité sature. */
export const QUALITY_SCORE_SATURATION_N = 15;

/** Score 0–100 de suffisance des données pour un effectif d'essais. */
export function qualityScore(n: number): number {
  return Math.min(100, Math.round((n / QUALITY_SCORE_SATURATION_N) * 100));
}

/** Moyenne pondérée des scores de qualité des paramètres dont dépend une route. */
export function weightedQuality(params: Array<{ n: number; w: number }>): number {
  const totalW = params.reduce((s, p) => s + p.w, 0);
  if (totalW <= 0) return 0;
  return Math.round(params.reduce((s, p) => s + qualityScore(p.n) * p.w, 0) / totalW);
}

/** Récupération globale d'étages indépendants en série : R = 1 − ∏(1 − Rᵢ). */
export function seriesRecovery(...stages: number[]): number {
  const global = 1 - stages.reduce((prod, r) => prod * (1 - r), 1);
  return Math.max(0, Math.min(100, global * 100));
}

const f1 = (v: number) => v.toFixed(1);

/**
 * Estime toutes les routes métallurgiques soutenues par les essais disponibles,
 * triées par récupération décroissante, la recommandée portant `recommended`.
 *
 * Une route n'est proposée que si les essais qui la fondent existent : pas de
 * route inventée sur des valeurs par défaut.
 */
export function estimateRoutes(inputs: RouteEstimationInputs): RouteEstimate[] {
  const { metrics: m, counts: n } = inputs;
  const E = ROUTE_STAGE_EFFICIENCIES;
  const R = ROUTE_ESTIMATION;

  const pregPenalty = m.organicCarbonPct !== null && m.organicCarbonPct > R.pregRobbingCorgThresholdPct
    ? R.pregRobbingPenaltyPts
    : 0;

  const routes: RouteEstimate[] = [];

  // ── Route 1 — Gravité (Knelson) + CIL ────────────────────────────────────
  if (m.grgPct !== null && m.leachRec24Pct !== null) {
    // Mêmes facteurs de transposition labo → usine que ceux appliqués par
    // ProjectContext pour la récupération globale affichée : les deux chiffres
    // concordent par construction.
    const rGrav = (m.grgPct / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rLeach = ((m.leachRec24Pct - pregPenalty) / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY;
    const combined = seriesRecovery(rGrav, rLeach);
    routes.push({
      route: 'Gravité (Knelson) + CIL',
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rLeach * 100)} %) = ${f1(combined)} % · formule série — Laplante 2000`,
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Guidelines'],
      capex_indicator: 'medium', opex_indicator: 'low',
    });
  }

  // ── Route 2 — Gravité + Lixiviation + CIP ────────────────────────────────
  if (m.grgPct !== null && m.leachRec24Pct !== null) {
    const rGrav = (m.grgPct / 100) * E.gravityCipTransfer;
    const leach48 = m.leachRec48Pct ?? m.leachRec24Pct;
    const rCip = ((leach48 - pregPenalty * E.cipPregRobbingShare) / 100) * E.cipAdsorption;
    const combined = seriesRecovery(rGrav, rCip);
    routes.push({
      route: 'Gravité + Lixiviation + CIP',
      recovery_pct: +combined.toFixed(1),
      confidence: 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rCip * 100)} %) = ${f1(combined)} % · lixiviation 48 h + CIP`,
      references: ['Marsden & House, Gold Leaching, 3rd ed.', 'Adams M.D. (2016) — Gold Ore Processing'],
      capex_indicator: 'medium', opex_indicator: 'medium',
    });
  }

  // ── Route 3 — Lixiviation directe CIL/CIP (étage unique) ─────────────────
  if (m.leachRec24Pct !== null) {
    const rec = Math.max(0, Math.min(E.directLeachMaxPct, m.leachRec24Pct - pregPenalty));
    routes.push({
      route: 'Lixiviation directe CIL/CIP',
      recovery_pct: +rec.toFixed(1),
      confidence: rec >= E.directLeachHighConfidencePct ? 'high' : rec >= E.directLeachLowConfidencePct ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `R = ${f1(rec)} % (étage unique — bilan direct)${pregPenalty ? ` · −${pregPenalty} pts pénalité Corg` : ''}`,
      references: ['CIM Best Practices — Metallurgical Testing', 'Marsden & House, Gold Leaching, 3rd ed.'],
      capex_indicator: 'medium', opex_indicator: 'medium',
    });
  }

  // ── Route 4 — Flottation + Rebroyage + Lixiviation + CIP ─────────────────
  // La flottation SÉPARE le flux : bilan massique, pas formule série.
  if (m.flotationAuRecPct !== null && m.leachRec24Pct !== null) {
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const rLeachConc = Math.min(E.regrindLeachMax, (m.leachRec24Pct + E.regrindLeachBonusPts) / 100);
    const rLeachTails = Math.max(0, (m.leachRec24Pct - E.tailsLeachPenaltyPts) / 100) * E.tailsLeachEfficiency;
    const auFromConc = rFlot * rLeachConc;
    const auFromTails = (1 - rFlot) * rLeachTails;
    const combined = Math.min(E.flotationRouteMaxPct, (auFromConc + auFromTails) * 100);
    routes.push({
      route: 'Flottation + Rebroyage + Leach + CIP',
      recovery_pct: +combined.toFixed(1),
      confidence: m.sulphidePct !== null && m.sulphidePct > 1 ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 1 }, { n: n.comminution, w: 1 }]),
      basis: `Bilan massique : or_concentré (${f1(auFromConc * 100)} %) + or_queues (${f1(auFromTails * 100)} %) = ${f1(combined)} %`,
      references: ['Wills B.A. — Mineral Processing Technology, 8th ed.'],
      capex_indicator: 'high', opex_indicator: 'medium',
    });
  }

  // ── Route 5 — Flottation + POX/Grillage + CIL (minerai réfractaire) ──────
  if (m.sulphidePct !== null && m.sulphidePct > E.refractorySulphidesPct && m.leachRec24Pct !== null) {
    const rFlot = ((m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct) / 100) * E.flotationSulphides;
    const rOx = E.oxidationLiberation;
    const rCil = Math.min(E.postOxidationLeachMax, (m.leachRec24Pct + E.postOxidationLeachBonusPts - pregPenalty) / 100);
    const combined = seriesRecovery(rFlot, rOx, rCil);
    routes.push({
      route: 'Flottation + Prétraitement (POX/Grillage) + CIL',
      recovery_pct: +combined.toFixed(1),
      confidence: pregPenalty > 0 ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `R = 1−(1−${f1(rFlot * 100)} %)(1−${f1(rOx * 100)} %)(1−${f1(rCil * 100)} %) = ${f1(combined)} %`,
      references: ['Adams M.D. (2016) — Gold Ore Processing', 'CIM Best Practices'],
      capex_indicator: 'high', opex_indicator: 'high',
    });
  }

  // ── Repli — Lixiviation en tas (minerai oxydé, étage unique) ─────────────
  if (routes.length < 3 && m.leachRec24Pct !== null && m.auFreePct !== null && m.auFreePct > R.heapLeachMinAuFreePct) {
    const rec = Math.max(0, Math.min(R.heapLeachMaxRecoveryPct, m.leachRec24Pct * R.heapLeachEfficiency));
    routes.push({
      route: 'Lixiviation en tas (Heap Leach)',
      recovery_pct: +rec.toFixed(1),
      confidence: 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `R = ${f1(rec)} % (étage unique — cinétique colonne, Au libre ${f1(m.auFreePct)} %)`,
      references: ['Marsden & House, Gold Leaching, 3rd ed. — Heap Leach Chapter'],
      capex_indicator: 'low', opex_indicator: 'low',
    });
  }

  // Recommandation UNIQUE et réconciliée : meilleure récupération, mais sur une
  // quasi-égalité (dans le bruit des essais) on préfère le circuit dont l'étage
  // d'adsorption correspond à l'analyse CIL/CIP — sinon le circuit affiché et le
  // conseil d'adsorption se contredisent.
  //
  // Sans préférence d'adsorption fournie (l'appelant n'a pas fait l'analyse
  // CIL vs CIP), on NE départage PAS arbitrairement : la meilleure récupération
  // l'emporte. Inventer un « CIL » par défaut ferait basculer la reco sur une
  // quasi-égalité au nom d'une préférence que personne n'a exprimée.
  const sorted = routes.sort((a, b) => b.recovery_pct - a.recovery_pct);
  const best = inputs.adsorptionPreference
    ? selectRecommendedRoute(sorted, inputs.adsorptionPreference)
    : sorted[0];
  sorted.forEach(r => { r.recommended = r === best; });
  return sorted;
}
