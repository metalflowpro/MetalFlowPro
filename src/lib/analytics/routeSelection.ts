// ─────────────────────────────────────────────────────────────────────────────
// Which metallurgical circuit the project recommends — decided ONCE.
//
// Pure module (no Supabase, no React) so the rule is testable: it previously
// lived inside the "Route Métallurgique" tab, which re-decided it locally while
// "Synthèse LIMS" read the raw highest-recovery flag. The two views recommended
// different circuits for the same project.
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteCandidate {
  route: string;
  recovery_pct: number;
  recommended?: boolean;
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

/**
 * Pick the recommended circuit.
 *
 * Highest recovery wins — except on a near-tie between adsorption circuits, where
 * the one matching the CIL/CIP analysis wins, so the headline circuit and the
 * adsorption advice cannot contradict each other.
 *
 * Returns the chosen candidate; callers flag it.
 */
export function selectRecommendedRoute<T extends RouteCandidate>(
  routes: T[],
  cilCipRecommendation: 'CIL' | 'CIP',
  tolerance = ROUTE_TIE_TOLERANCE_PCT,
): T | undefined {
  if (routes.length === 0) return undefined;
  const sorted = [...routes].sort((a, b) => b.recovery_pct - a.recovery_pct);
  const top = sorted[0];
  const topIsAdsorption = top.route.includes('CIL') || top.route.includes('CIP');
  if (!topIsAdsorption) return top;
  return sorted.find(
    r => Math.abs(r.recovery_pct - top.recovery_pct) <= tolerance && r.route.includes(cilCipRecommendation),
  ) ?? top;
}
