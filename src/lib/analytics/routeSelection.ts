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
