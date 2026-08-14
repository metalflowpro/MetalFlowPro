// ─────────────────────────────────────────────────────────────────────────────
// Which metallurgical circuit the project recommends — decided ONCE.
//
// Pure module (no Supabase, no React) so the rule is testable: it previously
// lived inside the "Route Métallurgique" tab, which re-decided it locally while
// "Synthèse LIMS" read the raw highest-recovery flag. The two views recommended
// different circuits for the same project.
// ─────────────────────────────────────────────────────────────────────────────

/** Indicateur relatif de coût — arbitrage, pas un montant (cf. circuitSelection). */
export type CostIndicator = 'low' | 'medium' | 'high';

export interface RouteCandidate {
  route: string;
  recovery_pct: number;
  recommended?: boolean;
  // ── Signaux multi-critères (facultatifs : une route qui ne les porte pas est
  //    départagée sur la seule récupération — rétrocompatibilité). ──
  /** Indicateur CAPEX relatif de la route. */
  capex_indicator?: CostIndicator;
  /** Indicateur OPEX relatif de la route. */
  opex_indicator?: CostIndicator;
  /** Niveau de confiance métallurgique de l'estimation. */
  confidence?: 'high' | 'medium' | 'low';
  /** Score 0–100 de suffisance des essais soutenant la route. */
  dataQualityScore?: number;
}

/**
 * Recoveries within this many points are a tie: testwork does not resolve
 * circuits any finer, so preferring one on a 0.9 pt edge would be false precision.
 */
export const ROUTE_TIE_TOLERANCE_PCT = 1.5;

/**
 * Heuristiques d'estimation des routes métallurgiques candidates.
 *
 * ⚠️ Barème d'INGÉNIERIE propre au minerai, pas une corrélation publiée : il
 * traduit ce qu'un métallurgiste attend d'une route donnée à partir des essais
 * disponibles. Ces facteurs orientent le choix du circuit (CIL vs flottation vs
 * lixiviation en tas) — un arbitrage structurant en CAPEX — et doivent être
 * recalés sur les essais du projet dès qu'ils existent.
 *
 * Ils étaient auparavant écrits en dur dans la page Analytics, donc invisibles
 * à la revue et impossibles à ajuster sans toucher au composant.
 */
export const ROUTE_ESTIMATION = {
  /** Carbone organique (%) au-delà duquel on retranche une pénalité de preg-robbing… */
  pregRobbingCorgThresholdPct: 0.2,
  /** …d'une amplitude de tant de points de récupération. */
  pregRobbingPenaltyPts: 3,
  /**
   * Lixiviation en tas : rendement rapporté à la récupération en cuve agitée.
   * Le tas percole plus grossier et plus lentement, donc récupère moins.
   */
  heapLeachEfficiency: 0.72,
  /** Plafond de récupération d'une lixiviation en tas (%). */
  heapLeachMaxRecoveryPct: 75,
  /** Or libre (%) minimal pour qu'un tas soit envisageable. */
  heapLeachMinAuFreePct: 55,
  /** Facteur appliqué à la récupération flottation dans le score de route. */
  flotationScoreFactor: 0.9,
  /** Pénalité de score par % de carbone organique. */
  corgScorePenaltyPerPct: 20,
  /** Or libre (%) au-delà duquel le score reçoit un bonus… */
  highAuFreeThresholdPct: 60,
  /** …de tant de points. */
  highAuFreeBonusPts: 5,
};

// ─────────────────────────────────────────────────────────────────────────────
// Sélection MULTI-CRITÈRES de la route recommandée.
//
// La récupération métallurgique n'est PAS le seul critère (cf. pratique 43-101) :
//   1. Récupération globale de chaque route — critère dominant.
//   2. Étude économique — CAPEX + OPEX. Faute de prix/NPV en base (et pour ne
//      RIEN coder en dur), on n'exprime l'économie que par les indicateurs
//      RELATIFS déjà portés par chaque route (low/medium/high), comme le fait
//      circuitSelection. On ne renverse donc jamais un écart DÉCISIF de
//      récupération sur l'économie : il faudrait un NPV chiffré qu'on n'invente
//      pas. L'arbitrage économique n'opère que dans la fenêtre de quasi-égalité.
//   3. Caractérisation du minerai — déjà intégrée en amont dans le chiffre de
//      récupération de chaque route (preg-robbing, sulfures, or libre : voir
//      estimateRoutes), donc reflétée par recovery_pct sans double comptage.
//   5/6. Robustesse & appui données — confiance de l'estimation + suffisance des
//      essais (dataQualityScore).
//
// Toutes les pondérations et correspondances vivent dans ROUTE_SELECTION_CRITERIA
// (aucune valeur en dur dans la logique). La récupération reste souveraine hors
// de la fenêtre de quasi-égalité ; à l'intérieur, coût, robustesse et conformité
// du circuit d'adsorption départagent.
// ─────────────────────────────────────────────────────────────────────────────

/** Barème (surchargeable par projet) de la décision multi-critères. */
export interface RouteSelectionCriteria {
  /** Fenêtre de quasi-égalité de récupération (pts). */
  recoveryTieTolerancePct: number;
  /** Poids relatifs des critères (normalisés par leur somme). */
  weights: { recovery: number; economics: number; dataSupport: number };
  /** Score 0–1 d'un indicateur de COÛT (bas coût = meilleur score). */
  costIndicatorScore: Record<CostIndicator, number>;
  /** Score 0–1 d'un niveau de confiance. */
  confidenceScore: Record<'high' | 'medium' | 'low', number>;
  /** Répartition du critère économique entre CAPEX et OPEX. */
  economicsSplit: { capex: number; opex: number };
  /** Répartition du critère "appui données" entre confiance et score de données. */
  dataSupportSplit: { confidence: number; quality: number };
  /** Score neutre (0–1) d'un critère quand la route n'en porte pas l'information. */
  neutral: { economics: number; dataSupport: number };
}

/**
 * Barème par défaut de la décision multi-critères. Éditable — mêmes conventions
 * que ROUTE_ESTIMATION / ADSORPTION_DECISION_THRESHOLDS. À recaler par le
 * métallurgiste ; jamais de nombre magique dans le code de sélection.
 */
export const ROUTE_SELECTION_CRITERIA: RouteSelectionCriteria = {
  // En-deçà de cette fenêtre, l'arbitrage multi-critères départage ; au-delà, la
  // récupération l'emporte.
  recoveryTieTolerancePct: ROUTE_TIE_TOLERANCE_PCT,
  weights: {
    recovery: 0.5,     // récupération métallurgique — critère 1, dominant
    economics: 0.3,    // CAPEX + OPEX — critère 2, arbitrage relatif
    dataSupport: 0.2,  // confiance + suffisance des essais — critères 5/6
  },
  costIndicatorScore: { low: 1, medium: 0.5, high: 0 },
  confidenceScore: { high: 1, medium: 0.6, low: 0.25 },
  economicsSplit: { capex: 0.5, opex: 0.5 },
  dataSupportSplit: { confidence: 0.5, quality: 0.5 },
  neutral: { economics: 0.5, dataSupport: 0.5 },
};

/** Détail du score multi-critères d'une route (0–100 par critère et au total). */
export interface RouteScore {
  total: number;
  recovery: number;
  economics: number;
  dataSupport: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Score composite 0–100 d'une route : mélange pondéré récupération / économie /
 * appui données. Les critères absents prennent leur valeur NEUTRE (une route sans
 * indicateur de coût n'est ni avantagée ni pénalisée), si bien qu'une route
 * réduite à sa récupération reste classée par sa seule récupération.
 */
export function scoreRoute(route: RouteCandidate, criteria: RouteSelectionCriteria = ROUTE_SELECTION_CRITERIA): RouteScore {
  const c = criteria;
  const recovery = clamp01(route.recovery_pct / 100);

  const hasEcon = route.capex_indicator != null || route.opex_indicator != null;
  const economics = hasEcon
    ? c.costIndicatorScore[route.capex_indicator ?? 'medium'] * c.economicsSplit.capex
      + c.costIndicatorScore[route.opex_indicator ?? 'medium'] * c.economicsSplit.opex
    : c.neutral.economics;

  const hasData = route.confidence != null || route.dataQualityScore != null;
  const dataSupport = hasData
    ? c.confidenceScore[route.confidence ?? 'medium'] * c.dataSupportSplit.confidence
      + clamp01((route.dataQualityScore ?? 0) / 100) * c.dataSupportSplit.quality
    : c.neutral.dataSupport;

  const totalW = c.weights.recovery + c.weights.economics + c.weights.dataSupport;
  const total = (recovery * c.weights.recovery + economics * c.weights.economics + dataSupport * c.weights.dataSupport) / totalW;
  return { total: total * 100, recovery: recovery * 100, economics: economics * 100, dataSupport: dataSupport * 100 };
}

/** Meilleure route d'un ensemble au sens du score composite (stable, sans mutation). */
function bestByScore<T extends RouteCandidate>(pool: T[], criteria: RouteSelectionCriteria): T {
  return pool.reduce((best, r) => (scoreRoute(r, criteria).total > scoreRoute(best, criteria).total ? r : best), pool[0]);
}

/**
 * Choisit la route recommandée par analyse multi-critères.
 *
 * 1. La récupération classe les candidats ; le meneur fixe la fenêtre de
 *    quasi-égalité (recoveryTieTolerancePct). Un écart de récupération HORS de
 *    cette fenêtre n'est jamais renversé (pas de NPV inventé pour le justifier).
 * 2. Dans la fenêtre, si le meneur est un circuit d'adsorption, on privilégie les
 *    routes CONFORMES au conseil CIL/CIP (cohérence circuit ↔ conseil).
 * 3. Le score composite (économie + robustesse, récupération dominante) départage
 *    l'ensemble retenu.
 *
 * Retourne le candidat choisi (une référence du tableau d'entrée) ; l'appelant le
 * marque. Ne mute pas l'entrée.
 */
export function selectRecommendedRoute<T extends RouteCandidate>(
  routes: T[],
  cilCipRecommendation: 'CIL' | 'CIP',
  criteria: RouteSelectionCriteria = ROUTE_SELECTION_CRITERIA,
): T | undefined {
  if (routes.length === 0) return undefined;
  const tol = criteria.recoveryTieTolerancePct;
  const byRecovery = [...routes].sort((a, b) => b.recovery_pct - a.recovery_pct);
  const leader = byRecovery[0];

  // Quasi-égalité de récupération avec le meneur : les seuls candidats que
  // l'économie/robustesse peut départager.
  const contenders = byRecovery.filter(r => leader.recovery_pct - r.recovery_pct <= tol);

  // Le conseil CIL/CIP ne s'applique qu'aux circuits d'adsorption : si le meneur
  // n'en est pas un (ex. lixiviation en tas), on départage sans lui.
  const leaderIsAdsorption = leader.route.includes('CIL') || leader.route.includes('CIP');
  if (!leaderIsAdsorption) return bestByScore(contenders, criteria);

  const matching = contenders.filter(r => r.route.includes(cilCipRecommendation));
  const pool = matching.length ? matching : contenders;
  return bestByScore(pool, criteria);
}
