// ─────────────────────────────────────────────────────────────────────────────
// Optimal grind size (P80) — single source shared by Granulométrie and GéoMet.
//
// Pure module: no Supabase, no React, so it stays unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS, DEFAULT_ASSUMPTIONS } from '../config/constants';

/** P80 ladder the engine scans, coarse → fine (µm). */
export const P80_LADDER = [500, 300, 212, 150, 106, 75, 53, 38, 25];

/**
 * Reference grind size (µm) the domain recovery figures are anchored on.
 *
 * `recovery_design` per domain is the recovery measured at this grind, so the
 * per-domain sensitivity pivots around it. It is a *baseline*, NOT an optimum —
 * GéoMet used to star 75 µm as if it were the optimal grind while Granulométrie
 * computed a different optimum economically.
 */
export const REFERENCE_P80_UM = 75;

/** Recovery sensitivity to grind (% recovery per µm finer than the reference). */
export const RECOVERY_PER_UM = 0.07;

/** Bond's third theory: specific grinding energy (kWh/t) from F80 to P80. */
export function bondEnergy(bwi: number, f80_um: number, p80_um: number): number {
  return Math.max(0, bwi * 10 * (1 / Math.sqrt(p80_um) - 1 / Math.sqrt(f80_um)));
}

/**
 * Rowland EF5 — fineness-of-grind inefficiency factor.
 *
 * Below ~75 µm a real ball mill needs disproportionately more energy than Bond's
 * lab equation predicts: the lab test does not capture the falling efficiency of
 * fine grinding. Rowland's correction (1982) is EF5 = (P80 + 10.3) / (1.145·P80),
 * applied only when P80 < 75 µm; above that it is 1.
 *
 * Because it grows as the grind gets finer, it is what actually pulls the
 * economic optimum coarser — a flat factor only scales every candidate equally.
 */
export function rowlandEF5(p80_um: number): number {
  if (p80_um >= 75 || p80_um <= 0) return 1;
  return (p80_um + 10.3) / (1.145 * p80_um);
}

/**
 * Specific grinding energy a real plant needs (kWh/t), from the lab BWi.
 *
 * = lab Bond energy × EF5(P80) × overall plant/lab factor. The lab grinds more
 * efficiently than an industrial circuit, so plant energy is higher — and higher
 * still at fine sizes, where EF5 bites. `plantFactor` is the project's own
 * Wio/Wi ratio; passing 1 with no EF5 reduces this to the raw lab energy.
 */
export function plantGrindEnergy(
  bwi: number,
  f80_um: number,
  p80_um: number,
  plantFactor: number = DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR,
  applyFineness = true,
): number {
  const ef5 = applyFineness ? rowlandEF5(p80_um) : 1;
  return bondEnergy(bwi, f80_um, p80_um) * ef5 * plantFactor;
}

/** Raw liberation-driven recovery shape (un-normalised). */
function recoveryShape(p80_um: number, freeAu: number): number {
  const base = freeAu * (1 - Math.exp(-0.018 * (500 - p80_um)));
  const tailRec = (100 - freeAu) * 0.85 * (1 - Math.exp(-0.008 * (500 - p80_um)));
  return Math.max(0, base + tailRec);
}

/**
 * Recovery vs grind size, anchored on the project's achievable recovery.
 *
 * The raw liberation curve is normalised so a fine grind (25 µm) reaches
 * `ceiling` — the project's global gravity+leach recovery — keeping the module
 * coherent with the Dashboard / Économie instead of an arbitrary 98 % asymptote.
 */
export function recoveryModel(p80_um: number, au_free_pct: number | null, ceiling = 96): number {
  const freeAu = au_free_pct ?? 60;
  const refFine = recoveryShape(25, freeAu) || 1;
  return Math.max(0, Math.min(ceiling, recoveryShape(p80_um, freeAu) / refFine * ceiling));
}

/**
 * Per-domain recovery at an arbitrary grind, pivoting on REFERENCE_P80_UM.
 * Used where only `recovery_design` is known for a domain (GéoMet), rather than
 * a full liberation curve.
 */
export function domainRecoveryAtP80(recoveryDesignPct: number, p80_um: number): number {
  return Math.max(50, Math.min(99, recoveryDesignPct + (REFERENCE_P80_UM - p80_um) * RECOVERY_PER_UM));
}

export interface P80Point {
  p80: number;
  energy: number;      // kWh/t — plant energy actually paid for
  labEnergy: number;   // kWh/t — Bond lab prediction, for comparison
  ef5: number;         // Rowland fineness factor applied at this P80
  recovery: number;    // %
  cost: number;        // $/t grinding energy
  revenueUsdT: number;
  netUsd: number;      // $/t net value
}

export interface P80EngineInputs {
  bwi: number;
  f80_um: number;
  auFreePct: number | null;
  /** Achievable recovery ceiling (%) — the project's global recovery. */
  recoveryCeilingPct: number;
  goldGradeGt: number;
  goldPriceUsdOz: number;
  /** $/kWh; defaults to the shared documented assumption. */
  elecCostUsdKwh?: number;
  /** Plant/lab grinding inefficiency (Wio/Wi); defaults to the documented value. */
  plantFactor?: number;
  /** Apply the Rowland EF5 fine-grind correction (default true). */
  applyFineness?: boolean;
  ladder?: number[];
}

export interface P80EngineResult {
  points: P80Point[];
  optimal: P80Point;
  optimalIndex: number;
}

/**
 * Scan the grind ladder and pick the P80 maximising net value per tonne:
 * recovered-gold revenue − grinding energy cost.
 *
 * Maximising recovery/energy instead would under-grind — gold value dwarfs the
 * marginal kWh.
 */
export function runP80Engine(inputs: P80EngineInputs): P80EngineResult {
  const elec = inputs.elecCostUsdKwh ?? DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;
  const plantFactor = inputs.plantFactor ?? DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR;
  const applyFineness = inputs.applyFineness ?? true;
  const ladder = inputs.ladder ?? P80_LADDER;

  const points: P80Point[] = ladder.map(p => {
    // The mill is priced on PLANT energy, not the lab Bond prediction — otherwise
    // the optimum would sit finer than any real circuit could afford.
    const labEnergy = bondEnergy(inputs.bwi, inputs.f80_um, p);
    const ef5 = applyFineness ? rowlandEF5(p) : 1;
    const energy = plantGrindEnergy(inputs.bwi, inputs.f80_um, p, plantFactor, applyFineness);
    const recovery = recoveryModel(p, inputs.auFreePct, inputs.recoveryCeilingPct);
    const revenueUsdT = inputs.goldGradeGt * (recovery / 100) / TROY_OZ_GRAMS * inputs.goldPriceUsdOz;
    const cost = energy * elec;
    return { p80: p, energy, labEnergy, ef5, recovery, cost, revenueUsdT, netUsd: revenueUsdT - cost };
  });

  const optimalIndex = points.reduce((best, pt, i) => (pt.netUsd > points[best].netUsd ? i : best), 0);
  return { points, optimal: points[optimalIndex], optimalIndex };
}
