// ─────────────────────────────────────────────────────────────────────────────
// GRG — Gravity Recoverable Gold (essai étagé Laplante) — Phase 2.
//
// L'essai GRG mesure l'or récupérable par gravité en broyant progressivement
// plus fin sur plusieurs étages : à chaque étage, une fraction de l'or ENCORE
// présent est récupérée. Le GRG cumulé n'est donc PAS la somme des étages mais
// une composition séquentielle sur l'or restant :
//     GRG_cum = 1 − ∏ (1 − rᵢ)
// où rᵢ est la récupération de l'étage i, exprimée en fraction de l'or entrant
// dans cet étage.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface GrgStage {
  /** N° d'étage (1..n), du plus grossier au plus fin. */
  stage: number;
  /** P80 de l'étage (µm). */
  p80Um: number;
  /** Récupération gravimétrique de l'étage (%), fraction de l'or ENTRANT. */
  stageRecoveryPct: number;
  /** Rendement massique du concentré de l'étage (%), optionnel. */
  massYieldPct?: number | null;
}

export interface GrgResult {
  /** GRG cumulé (%) après tous les étages. */
  cumulativeGrgPct: number;
  /** Contribution absolue de chaque étage au GRG cumulé (points de %). */
  perStageContributionPct: number[];
  /** Courbe cumulée après chaque étage (%) — pour tracer GRG vs finesse. */
  cumulativeCurvePct: number[];
  stages: GrgStage[];
}

const clampFrac = (pct: number): number => Math.max(0, Math.min(100, pct)) / 100;

/**
 * GRG cumulé par composition séquentielle sur l'or restant.
 *
 * Chaque étage récupère `stageRecoveryPct` % de l'or qui LUI parvient (soit
 * `remaining`), donc sa contribution absolue est `remaining × rᵢ`. Les étages
 * sont triés du plus grossier au plus fin avant composition.
 */
export function cumulativeGrg(stagesIn: GrgStage[]): GrgResult {
  const stages = [...stagesIn].sort((a, b) => b.p80Um - a.p80Um);
  let remaining = 1;
  const perStageContributionPct: number[] = [];
  const cumulativeCurvePct: number[] = [];
  for (const s of stages) {
    const r = clampFrac(s.stageRecoveryPct);
    const contribution = remaining * r;
    perStageContributionPct.push(contribution * 100);
    remaining -= contribution;
    cumulativeCurvePct.push((1 - remaining) * 100);
  }
  return {
    cumulativeGrgPct: (1 - remaining) * 100,
    perStageContributionPct,
    cumulativeCurvePct,
    stages,
  };
}
