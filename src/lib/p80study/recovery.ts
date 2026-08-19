// ─────────────────────────────────────────────────────────────────────────────
// Récupération métallurgique par bilan de métal — module d'étude P80.
//
// La spec §5 impose de RECALCULER la récupération à partir des titres/masses du
// bilan (jamais de faire confiance aveuglément au champ rapporté par le labo) et
// de DÉCLENCHER UNE ALERTE quand le recalcul et le reporté divergent au-delà
// d'une tolérance configurable.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS } from '../config/constants';

export type RecoveryBasis = 'concentrate' | 'tailings';

export interface MetalBalanceInputs {
  /** Masse d'alimentation Mf (unité cohérente avec les autres masses). */
  feedMass?: number | null;
  /** Teneur d'alimentation Cf (g/t). */
  feedGrade?: number | null;
  /** Masse du concentré Mc. */
  concentrateMass?: number | null;
  /** Teneur du concentré Cc (g/t). */
  concentrateGrade?: number | null;
  /** Masse des rejets Mt. */
  tailingsMass?: number | null;
  /** Teneur des rejets Ct (g/t). */
  tailingsGrade?: number | null;
}

export interface MetalBalanceResult {
  /** Récupération recalculée (%), ou null si les entrées sont insuffisantes. */
  recoveryPct: number | null;
  /** Base réellement utilisée pour le calcul. */
  basis: RecoveryBasis | null;
  /** Récupération massique Mc/Mf (%), quand les deux masses sont connues. */
  massRecoveryPct: number | null;
}

const pos = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonNeg = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Récupération de l'or par bilan de métal.
 *
 * Deux voies, dans l'ordre de préférence :
 *  1. Concentré : R = (Mc·Cc) / (Mf·Cf) × 100.
 *  2. Rejets    : R = (1 − Mt·Ct / (Mf·Cf)) × 100 — utile quand seul le rejet
 *     est titré (cas fréquent d'un essai de lixiviation sur résidu).
 *
 * `preferBasis` force une voie ; sinon le concentré prime quand ses données sont
 * disponibles. Le résultat est borné [0, 100] (un bilan bruité peut dépasser).
 */
export function goldRecoveryFromBalance(
  inp: MetalBalanceInputs,
  preferBasis?: RecoveryBasis,
): MetalBalanceResult {
  const feedMetal = pos(inp.feedMass) && pos(inp.feedGrade) ? inp.feedMass * inp.feedGrade : null;
  const massRecoveryPct =
    pos(inp.feedMass) && nonNeg(inp.concentrateMass)
      ? Math.min(100, (inp.concentrateMass / inp.feedMass) * 100)
      : null;

  const canConcentrate = feedMetal != null && nonNeg(inp.concentrateMass) && nonNeg(inp.concentrateGrade);
  const canTailings = feedMetal != null && nonNeg(inp.tailingsMass) && nonNeg(inp.tailingsGrade);

  const order: RecoveryBasis[] = preferBasis
    ? [preferBasis, preferBasis === 'concentrate' ? 'tailings' : 'concentrate']
    : ['concentrate', 'tailings'];

  for (const basis of order) {
    if (basis === 'concentrate' && canConcentrate && feedMetal) {
      const r = ((inp.concentrateMass as number) * (inp.concentrateGrade as number)) / feedMetal * 100;
      return { recoveryPct: clampPct(r), basis: 'concentrate', massRecoveryPct };
    }
    if (basis === 'tailings' && canTailings && feedMetal) {
      const r = (1 - ((inp.tailingsMass as number) * (inp.tailingsGrade as number)) / feedMetal) * 100;
      return { recoveryPct: clampPct(r), basis: 'tailings', massRecoveryPct };
    }
  }
  return { recoveryPct: null, basis: null, massRecoveryPct };
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export interface RecoveryGap {
  /** Écart signé recomputed − reported (points de %), null si l'un manque. */
  deltaPct: number | null;
  /** true quand |delta| dépasse la tolérance : le résultat doit être revu. */
  flagged: boolean;
  /** Tolérance effectivement appliquée (points de %). */
  tolerancePct: number;
}

/**
 * Compare la récupération recalculée à celle rapportée par le labo et lève un
 * drapeau si l'écart absolu dépasse la tolérance (défaut : hypothèse projet
 * `RECOVERY_RECON_TOLERANCE_PCT`, surchargable).
 */
export function recoveryGap(
  computedPct: number | null,
  reportedPct: number | null,
  tolerancePct: number = DEFAULT_ASSUMPTIONS.RECOVERY_RECON_TOLERANCE_PCT,
): RecoveryGap {
  if (computedPct == null || reportedPct == null) {
    return { deltaPct: null, flagged: false, tolerancePct };
  }
  const deltaPct = computedPct - reportedPct;
  return { deltaPct, flagged: Math.abs(deltaPct) > tolerancePct, tolerancePct };
}
