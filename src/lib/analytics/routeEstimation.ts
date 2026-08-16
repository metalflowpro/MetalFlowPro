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
// 3. DEUX TOPOLOGIES, DEUX FORMULES — les confondre est l'erreur classique.
//    Ce qui tranche est la question : « la lixiviation traite-t-elle les RÉSIDUS
//    de l'étage amont, ou son CONCENTRÉ ? »
//
//    • LIXIVIATION SUR RÉSIDUS — chaque étage traite le rejet du précédent et
//      rattrape ce que l'autre a laissé. Les contributions s'ADDITIONNENT :
//          R = 1 − ∏(1 − Rᵢ)
//    • LIXIVIATION SUR CONCENTRÉ — l'étage amont ORIENTE l'or vers un concentré,
//      et la lixiviation n'en extrait qu'une part. Les récupérations se
//      MULTIPLIENT, et ce que l'étage amont rejette ne revoit jamais la suite :
//          R = ∏ Rᵢ
//
//    Appliquer la formule des résidus à une lixiviation sur concentré produit des
//    récupérations supérieures à celle de l'étage de tête — jusqu'à 100 %.
//
// ── CATALOGUE DES ROUTES (référentiel arbitré par le métallurgiste) ─────────
//   CIL direct .......................... R = R_CIL
//   Gravité + Leach (résidus) ........... R = 1 − (1−R_g)(1−R_l)
//   Flottation + Leach (résidus) ........ R = 1 − (1−R_f)(1−R_l)
//   Flottation + Leach (concentré) ...... R = R_f × R_l
//   Grav. + Flot. + Leach (résidus) ..... R = 1 − (1−R_g)(1−R_f)(1−R_l)
//   Grav. + Flot. + Leach (concentré) ... R = R_g + (1−R_g) × R_f × R_l
//   Flot. + Rebroyage + Leach ........... R = R_f × R_l,rebroyé
//   Grav. + Flot. + Rebroyage + Leach ... R = R_g + (1−R_g) × R_f × R_l,rebroyé
//   Grav. + Flot. (concentré vendu) ..... R = 1 − (1−R_g)(1−R_f)
//   Heap Leach direct ................... R = R_heap
//   Gravité + Heap Leach ................ R = 1 − (1−R_g)(1−R_heap)
//
//   ⚠️ Le REBROYAGE n'a pas de récupération propre : il améliore la LIBÉRATION,
//   donc il se traduit par un R_l plus élevé (R_l,rebroyé > R_l), jamais par un
//   terme supplémentaire. Le gain se quantifie par un essai comparatif.
//
//   ⚠️ Une route « … + Leach (concentré) » ne crédite AUCUN or aux résidus de
//   l'étage séparateur : cet or part aux rejets. Si le flowsheet lixivie aussi
//   ces résidus, ce sont DEUX routes différentes, pas un terme à ajouter.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS } from '../config/constants';
import { ROUTE_ESTIMATION, selectRecommendedRoute } from './routeSelection';
import { ADSORPTION_CIRCUITS, type AdsorptionCircuitId } from './adsorptionCircuit';

/**
 * Un étage de la route, tel qu'il doit être AFFICHÉ.
 *
 * Les écrans ne doivent JAMAIS re-supposer la composition d'une route (le
 * Tableau de bord affichait « Gravité / Lixiviation / Globale » même quand la
 * route recommandée n'avait pas de gravité, ou avait une flottation en plus) :
 * c'est la route elle-même qui énumère ses étages.
 */
export interface RouteStage {
  /** Nom de l'étage tel qu'affiché (« Gravité », « Flottation », « CIL »…). */
  label: string;
  /** Récupération de l'étage (%), sur SA propre alimentation. */
  recovery_pct: number;
  /** Ce que l'étage traite et d'où vient son chiffre — pour l'infobulle. */
  note: string;
}

/** Une route candidate et son estimation. */
export interface RouteEstimate {
  route: string;
  recovery_pct: number;
  confidence: 'high' | 'medium' | 'low';
  /** 0–100 : à quel point les essais LIMS soutiennent les paramètres de cette route. */
  dataQualityScore: number;
  basis: string;
  /**
   * Étages composant la route, dans l'ordre du procédé. Source unique de vérité
   * pour tout affichage par étage — cartes et graphiques du Tableau de bord.
   */
  stages: RouteStage[];
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
  /** Plafond de récupération d'une route gravité + flottation + lixiviation (%). */
  gravFlotLeachRouteMaxPct: 99.5,
  /** GRG (%) au-delà duquel la route gravité est jugée de confiance élevée. */
  gravityHighConfidenceGrgPct: 10,
  /** Sulfures (%) au-delà desquels une route oxydante est envisagée. */
  refractorySulphidesPct: 2,
  /** Récupération (%) au-delà de laquelle une lixiviation directe est de confiance élevée. */
  directLeachHighConfidencePct: 80,
  /** …et en deçà de laquelle elle devient de confiance faible. */
  directLeachLowConfidencePct: 65,
} as const;

/** Version modifiable (nombres) des efficacités d'étapes — base des surcharges par projet. */
export type RouteStageEfficiencies = { -readonly [K in keyof typeof ROUTE_STAGE_EFFICIENCIES]: number };

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
  /**
   * Efficacités d'étapes de route surchargées par le projet (éditeur de
   * constantes métallurgiques). Optionnel : à défaut, les valeurs par défaut de
   * l'application s'appliquent — les tests et appelants existants restent valides.
   */
  stageEfficiencies?: RouteStageEfficiencies;
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
  const E = inputs.stageEfficiencies ?? ROUTE_STAGE_EFFICIENCIES;
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

  // ⚠️ NOMENCLATURE DES ROUTES — « CIL » et « CIP » désignent le CIRCUIT DE
  // CYANURATION COMPLET, lixiviation comprise : en CIL le charbon est dans les
  // cuves de lixiviation, en CIP il est dans une cuverie qui suit la
  // lixiviation. Écrire « Lixiviation + CIL » est donc un pléonasme, et
  // « Lixiviation + CIP » laisse croire à un troisième étage. On nomme les
  // routes par ce qui précède le circuit de cyanuration, puis par le circuit
  // retenu : « Gravité (Knelson) + CIL » / « Gravité (Knelson) + CIP ».

  // ── Route 1 — Gravité + circuit de cyanuration ───────────────────────────
  // SÉRIE : la lixiviation traite les QUEUES de gravité, elle rattrape donc
  // l'or que la gravité a laissé passer.
  if (m.grgPct !== null) {
    const rGrav = (m.grgPct / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rCyan = cyanidation(leach.pct);
    const combined = seriesRecovery(rGrav, rCyan);
    routes.push({
      route: `Gravité (Knelson) + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Série (la lixiviation traite les queues de gravité) : R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rCyan * 100)} %) = ${f1(combined)} % · ${leachNote}`,
      stages: [
        { label: 'Gravité', recovery_pct: +(rGrav * 100).toFixed(1), note: `GRG ${f1(m.grgPct)} % × transfert usine ${DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY}` },
        { label: C, recovery_pct: +(rCyan * 100).toFixed(1), note: `sur les queues de gravité · ${leachNote}` },
      ],
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Guidelines'],
      capex_indicator: 'medium', opex_indicator: ads.opex,
    });
  }

  // ── Route — Gravité + Flottation + cyanuration DU CONCENTRÉ ──────────────
  // Catalogue : « Grav. + Flot. + Leach (concentré) » → R = R_g + (1−R_g)·R_f·R_l
  //
  // La gravité prend l'or grossier ; la flottation traite ses queues et ORIENTE
  // l'or vers un concentré ; la lixiviation n'extrait qu'une part de cet or
  // concentré — d'où le PRODUIT R_f × R_l et non un complément. Les queues de
  // flottation ne sont pas lixiviées dans cette route : leur or part aux rejets.
  // (Le flowsheet qui lixivie AUSSI ces queues est une route distincte, pas un
  // terme à ajouter ici.)
  if (m.grgPct !== null && m.flotationAuRecPct !== null) {
    const rGrav = (m.grgPct / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const rLeach = cyanidation(leach.pct);
    const fromFlot = rFlot * rLeach;
    const combined = Math.min(E.gravFlotLeachRouteMaxPct, (rGrav + (1 - rGrav) * fromFlot) * 100);
    routes.push({
      route: `Gravité (Knelson) + Flottation + ${C} (concentré)`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.flotation, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Lixiviation du CONCENTRÉ de flottation : R = R_g + (1−R_g)×R_f×R_l = ${f1(rGrav * 100)} % + (1−${f1(rGrav * 100)} %)×${f1(rFlot * 100)} %×${f1(rLeach * 100)} % = ${f1(combined)} % · gravité ${f1(rGrav * 100)} % (GRG ${f1(m.grgPct)} %) · flottation ${f1(rFlot * 100)} % (essai ${f1(m.flotationAuRecPct)} %) · ${leachNote} · queues de flottation NON lixiviées (or perdu aux rejets)`,
      stages: [
        { label: 'Gravité', recovery_pct: +(rGrav * 100).toFixed(1), note: `GRG ${f1(m.grgPct)} % × transfert usine ${DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY}` },
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — oriente l'or vers le concentré ; les queues partent aux rejets` },
        { label: C, recovery_pct: +(rLeach * 100).toFixed(1), note: `lixiviation du concentré de flottation · ${leachNote}` },
      ],
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'Wills B.A. — Mineral Processing Technology, 8th ed.', 'CIM Best Practices'],
      capex_indicator: 'high', opex_indicator: ads.opex,
    });
  }

  // ── Route 2 — Cyanuration directe du tout-venant (étage unique) ──────────
  {
    const rec = Math.min(E.directLeachMaxPct, cyanidation(leach.pct) * 100);
    routes.push({
      route: `${C} direct (tout-venant, sans pré-concentration)`,
      recovery_pct: +rec.toFixed(1),
      confidence: rec >= E.directLeachHighConfidencePct ? 'high' : rec >= E.directLeachLowConfidencePct ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Étage unique : R = ${f1(rec)} % · ${leachNote}`,
      stages: [
        { label: C, recovery_pct: +rec.toFixed(1), note: `tout-venant, sans pré-concentration · ${leachNote}` },
      ],
      references: ['CIM Best Practices — Metallurgical Testing', 'Marsden & House, The Chemistry of Gold Extraction, 2nd ed.'],
      capex_indicator: ads.capex, opex_indicator: ads.opex,
    });
  }

  // ── Route 3 — Flottation + Rebroyage + cyanuration DU CONCENTRÉ ──────────
  // Catalogue : « Flot. + Rebroyage + Leach » → R = R_f × R_l,rebroyé
  //
  // Le REBROYAGE n'a pas de récupération propre : il améliore la libération,
  // donc il RELÈVE R_l (d'où le bonus de cinétique appliqué à la lixiviation),
  // il n'ajoute pas d'étage. Les queues de flottation partent aux rejets.
  if (m.flotationAuRecPct !== null) {
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const rConc = Math.min(E.regrindLeachMax, cyanidation(leach.pct + E.regrindLeachBonusPts));
    const combined = Math.min(E.flotationRouteMaxPct, rFlot * rConc * 100);
    routes.push({
      route: `Flottation + Rebroyage + ${C} (concentré)`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.sulphidePct !== null && m.sulphidePct > 1 ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 1 }, { n: n.comminution, w: 1 }]),
      basis: `Lixiviation du CONCENTRÉ rebroyé : R = R_f × R_l,rebroyé = ${f1(rFlot * 100)} % × ${f1(rConc * 100)} % = ${f1(combined)} % · le rebroyage ne récupère rien par lui-même, il relève R_l de ${E.regrindLeachBonusPts} pts (libération) · ${leachNote} · queues de flottation NON lixiviées (or perdu aux rejets)`,
      stages: [
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — oriente l'or vers le concentré ; les queues partent aux rejets` },
        { label: `${C} (concentré rebroyé)`, recovery_pct: +(rConc * 100).toFixed(1), note: `lixiviation du concentré, +${E.regrindLeachBonusPts} pts de cinétique gagnés par la libération au rebroyage` },
      ],
      references: ['Wills B.A. — Mineral Processing Technology, 8th ed.'],
      capex_indicator: 'high', opex_indicator: ads.opex,
    });
  }

  // ── Route 4 — Flottation + Oxydation (POX/Grillage) + cyanuration ────────
  // SÉQUENTIELLE : l'or perdu aux rejets de flottation ne revoit NI l'oxydation
  // NI la lixiviation. La récupération ne peut donc pas dépasser celle de la
  // flottation — d'où le produit, et non la formule série.
  if (m.sulphidePct !== null && m.sulphidePct > E.refractorySulphidesPct) {
    const rFlot = ((m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct) / 100) * E.flotationSulphides;
    const rOx = E.oxidationLiberation;
    const rCyan = Math.min(E.postOxidationLeachMax, cyanidation(leach.pct + E.postOxidationLeachBonusPts));
    const combined = sequentialRecovery(rFlot, rOx, rCyan);
    routes.push({
      route: `Flottation + Oxydation (POX/Grillage) + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: rawPregLoss > 0 ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Séquentielle (même flux, la flottation borne le tout) : R = ${f1(rFlot * 100)} % × ${f1(rOx * 100)} % × ${f1(rCyan * 100)} % = ${f1(combined)} % · ${leachNote}`,
      stages: [
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct)} % × rendement sulfures ${E.flotationSulphides} — borne toute la chaîne` },
        { label: 'Oxydation', recovery_pct: +(rOx * 100).toFixed(1), note: `libération de l'or verrouillé (POX / grillage) sur le concentré` },
        { label: C, recovery_pct: +(rCyan * 100).toFixed(1), note: `concentré oxydé, +${E.postOxidationLeachBonusPts} pts après oxydation · ${leachNote}` },
      ],
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
      stages: [
        { label: 'Lixiviation en tas', recovery_pct: +rec.toFixed(1), note: `lixiviation ${leach.label} ${f1(leach.pct)} % × rendement colonne ${R.heapLeachEfficiency} (percolation plus grossière et plus lente)` },
      ],
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
