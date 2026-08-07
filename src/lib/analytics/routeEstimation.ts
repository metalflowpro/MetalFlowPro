// ─────────────────────────────────────────────────────────────────────────────
// Estimation des routes métallurgiques candidates — moteur PUR et PARTAGÉ.
//
// Partagé par « Analyse et Interprétation » et la section P80 de Granulométrie :
// dupliquer ce calcul garantirait la divergence des deux écrans.
//
// ── Trois principes de modélisation ─────────────────────────────────────────
//
// 1. LA DURÉE DE LIXIVIATION DE RÉFÉRENCE EST 48 h. La récupération de
//    conception se lit à la durée FINALE de lixiviation, pas au point
//    intermédiaire de 24 h qui ne fait que décrire la cinétique.
//
// 2. L'ESSAI N'EST PAS UN CIRCUIT. Un essai labo est une LIXIVIATION (bouteille
//    agitée) : il mesure l'or dissous. CIL et CIP sont deux façons de RÉCUPÉRER
//    cet or dissous sur charbon. La récupération se décompose donc :
//        R = R_lixiviation(48 h) × transfert_usine × efficacité_adsorption
//    et le choix CIL/CIP vient de ./adsorptionCircuit, sur les facteurs
//    d'exploitation déjà présents dans l'application.
//
// 3. DEUX TOPOLOGIES, DEUX FORMULES — les confondre est l'erreur classique :
//    • étages en SÉRIE sur le REJET du précédent (gravité → lixiviation des
//      queues de gravité) : chaque étage rattrape ce que l'autre a laissé,
//          R = 1 − ∏(1 − Rᵢ)
//    • étages SÉQUENTIELS sur le MÊME flux (flottation → oxydation → lixiviation
//      du concentré) : ce que la flottation rejette ne revoit jamais la suite,
//          R = ∏ Rᵢ
//    Appliquer la formule série à une chaîne séquentielle produit des
//    récupérations supérieures à celle de l'étage de tête — jusqu'à 100 %.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS } from '../config/constants';
import { ROUTE_ESTIMATION, selectRecommendedRoute } from './routeSelection';
import { ADSORPTION_CIRCUITS, type AdsorptionCircuitId } from './adsorptionCircuit';

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
 * AU MINERAI ET AU CIRCUIT, à recaler sur les essais du projet.
 *
 * Note : l'efficacité d'adsorption (CIL/CIP) ne figure PAS ici — elle est portée
 * par ./adsorptionCircuit, puisqu'elle dépend du circuit retenu et non de l'étage.
 */
export const ROUTE_STAGE_EFFICIENCIES = {
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
  /**
   * Récupération de lixiviation à 48 h (%) — la DURÉE FINALE, référence de
   * conception. C'est cette valeur qui fonde toutes les routes.
   */
  leachRec48Pct: number | null;
  /**
   * Récupération à 24 h (%) — point de CINÉTIQUE intermédiaire. Sert de repli
   * explicite si le 48 h manque, jamais de référence par défaut.
   */
  leachRec24Pct: number | null;
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
  /**
   * Circuit d'adsorption retenu (voir ./adsorptionCircuit). REQUIS : une route
   * ne peut pas être nommée ni chiffrée sans savoir si l'or dissous est capté
   * en CIL ou en CIP.
   */
  adsorptionCircuit: AdsorptionCircuitId;
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

/**
 * Étages en SÉRIE traitant chacun le REJET du précédent : R = 1 − ∏(1 − Rᵢ).
 * N'utiliser que lorsque chaque étage a une seconde chance sur l'or que le
 * précédent a laissé passer (gravité puis lixiviation des queues de gravité).
 */
export function seriesRecovery(...stages: number[]): number {
  const global = 1 - stages.reduce((prod, r) => prod * (1 - r), 1);
  return Math.max(0, Math.min(100, global * 100));
}

/**
 * Étages SÉQUENTIELS sur le MÊME flux : R = ∏ Rᵢ.
 * À utiliser dès qu'un étage SÉPARE le flux (flottation) : ce qu'il rejette ne
 * revoit aucun étage aval. Le résultat ne peut donc jamais dépasser le rendement
 * de l'étage de tête — propriété vérifiée par les tests.
 */
export function sequentialRecovery(...stages: number[]): number {
  const global = stages.reduce((prod, r) => prod * r, 1);
  return Math.max(0, Math.min(100, global * 100));
}

const f1 = (v: number) => v.toFixed(1);

/** Base de lixiviation retenue : 48 h de préférence, 24 h en repli explicite. */
function leachBasis(m: RouteMetrics): { pct: number; label: string; isFallback: boolean } | null {
  if (m.leachRec48Pct != null) return { pct: m.leachRec48Pct, label: '48 h', isFallback: false };
  if (m.leachRec24Pct != null) return { pct: m.leachRec24Pct, label: '24 h (repli — 48 h non mesuré)', isFallback: true };
  return null;
}

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
  const ads = ADSORPTION_CIRCUITS[inputs.adsorptionCircuit];
  const C = ads.label; // 'CIL' | 'CIP' — nomme les routes

  const leach = leachBasis(m);
  if (!leach) return [];

  // Perte par preg-robbing, ATTÉNUÉE selon le circuit d'adsorption : en CIL le
  // charbon ajouté concurrence le carbone natif du minerai, en CIP non.
  const rawPregLoss = m.organicCarbonPct !== null && m.organicCarbonPct > R.pregRobbingCorgThresholdPct
    ? R.pregRobbingPenaltyPts
    : 0;
  const pregLoss = rawPregLoss * (1 - ads.pregRobbingMitigation);
  const pregNote = rawPregLoss > 0
    ? ` · preg-robbing −${f1(pregLoss)} pt (${C} : ${Math.round(ads.pregRobbingMitigation * 100)} % de la perte évitée)`
    : '';

  /** Récupération d'un circuit de cyanuration : lixiviation × usine × adsorption. */
  const cyanidation = (leachPct: number): number =>
    ((leachPct - pregLoss) / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ads.adsorptionEfficiency;

  const leachNote = `lixiviation ${leach.label} ${f1(leach.pct)} % × transfert usine ${DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY} × adsorption ${C} ${ads.adsorptionEfficiency}${pregNote}`;

  const routes: RouteEstimate[] = [];

  // ── Route 1 — Gravité + Lixiviation + adsorption ─────────────────────────
  // SÉRIE : la lixiviation traite les QUEUES de gravité, elle rattrape donc
  // l'or que la gravité a laissé passer.
  if (m.grgPct !== null) {
    const rGrav = (m.grgPct / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rCyan = cyanidation(leach.pct);
    const combined = seriesRecovery(rGrav, rCyan);
    routes.push({
      route: `Gravité (Knelson) + Lixiviation + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Série (la lixiviation traite les queues de gravité) : R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rCyan * 100)} %) = ${f1(combined)} % · ${leachNote}`,
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Guidelines'],
      capex_indicator: 'medium', opex_indicator: ads.opex,
    });
  }

  // ── Route 2 — Lixiviation directe + adsorption (étage unique) ────────────
  {
    const rec = Math.min(E.directLeachMaxPct, cyanidation(leach.pct) * 100);
    routes.push({
      route: `Lixiviation directe + ${C}`,
      recovery_pct: +rec.toFixed(1),
      confidence: rec >= E.directLeachHighConfidencePct ? 'high' : rec >= E.directLeachLowConfidencePct ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Étage unique : R = ${f1(rec)} % · ${leachNote}`,
      references: ['CIM Best Practices — Metallurgical Testing', 'Marsden & House, The Chemistry of Gold Extraction, 2nd ed.'],
      capex_indicator: ads.capex, opex_indicator: ads.opex,
    });
  }

  // ── Route 3 — Flottation + Rebroyage + Lixiviation + adsorption ──────────
  // La flottation SÉPARE le flux : bilan massique sur les deux courants.
  if (m.flotationAuRecPct !== null) {
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const rConc = Math.min(E.regrindLeachMax, cyanidation(leach.pct + E.regrindLeachBonusPts));
    const rTails = Math.max(0, cyanidation(leach.pct - E.tailsLeachPenaltyPts)) * E.tailsLeachEfficiency;
    const auFromConc = rFlot * rConc;
    const auFromTails = (1 - rFlot) * rTails;
    const combined = Math.min(E.flotationRouteMaxPct, (auFromConc + auFromTails) * 100);
    routes.push({
      route: `Flottation + Rebroyage + Lixiviation + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.sulphidePct !== null && m.sulphidePct > 1 ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 1 }, { n: n.comminution, w: 1 }]),
      basis: `Bilan massique (la flottation sépare le flux) : concentré ${f1(auFromConc * 100)} % + queues ${f1(auFromTails * 100)} % = ${f1(combined)} % · ${leachNote}`,
      references: ['Wills B.A. — Mineral Processing Technology, 8th ed.'],
      capex_indicator: 'high', opex_indicator: ads.opex,
    });
  }

  // ── Route 4 — Flottation + Oxydation (POX/Grillage) + Lixiviation + ads. ─
  // SÉQUENTIELLE : l'or perdu aux rejets de flottation ne revoit NI l'oxydation
  // NI la lixiviation. La récupération ne peut donc pas dépasser celle de la
  // flottation — d'où le produit, et non la formule série.
  if (m.sulphidePct !== null && m.sulphidePct > E.refractorySulphidesPct) {
    const rFlot = ((m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct) / 100) * E.flotationSulphides;
    const rOx = E.oxidationLiberation;
    const rCyan = Math.min(E.postOxidationLeachMax, cyanidation(leach.pct + E.postOxidationLeachBonusPts));
    const combined = sequentialRecovery(rFlot, rOx, rCyan);
    routes.push({
      route: `Flottation + Oxydation (POX/Grillage) + Lixiviation + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: rawPregLoss > 0 ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Séquentielle (même flux, la flottation borne le tout) : R = ${f1(rFlot * 100)} % × ${f1(rOx * 100)} % × ${f1(rCyan * 100)} % = ${f1(combined)} % · ${leachNote}`,
      references: ['Adams M.D. (2016) — Gold Ore Processing', 'CIM Best Practices'],
      capex_indicator: 'high', opex_indicator: 'high',
    });
  }

  // ── Repli — Lixiviation en tas (minerai oxydé, étage unique) ─────────────
  if (routes.length < 3 && m.auFreePct !== null && m.auFreePct > R.heapLeachMinAuFreePct) {
    const rec = Math.max(0, Math.min(R.heapLeachMaxRecoveryPct, leach.pct * R.heapLeachEfficiency));
    routes.push({
      route: 'Lixiviation en tas (Heap Leach)',
      recovery_pct: +rec.toFixed(1),
      confidence: 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Étage unique — cinétique colonne : R = ${f1(leach.pct)} % × ${R.heapLeachEfficiency} = ${f1(rec)} % (Au libre ${f1(m.auFreePct)} %)`,
      references: ['Marsden & House, The Chemistry of Gold Extraction, 2nd ed. — Heap Leaching'],
      capex_indicator: 'low', opex_indicator: 'low',
    });
  }

  // Recommandation UNIQUE : meilleure récupération. Toutes les routes de
  // cyanuration portent désormais le MÊME circuit d'adsorption, donc plus de
  // départage à faire entre un « CIL » et un « CIP » concurrents — la question
  // est tranchée en amont par recommendAdsorptionCircuit.
  const sorted = routes.sort((a, b) => b.recovery_pct - a.recovery_pct);
  const best = selectRecommendedRoute(sorted, inputs.adsorptionCircuit) ?? sorted[0];
  sorted.forEach(r => { r.recommended = r === best; });
  return sorted;
}
