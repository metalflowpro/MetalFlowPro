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

/**
 * Empirical shape parameters of the liberation-driven recovery curve.
 *
 * The curve is a sum of two saturating exponentials: gold already free at coarse
 * sizes liberates fast (`freeRatePerUm`), the locked/refractory fraction needs a
 * much finer grind (`lockedRatePerUm`) and never reaches the same ceiling
 * (`lockedCeilingFraction`). `coarseAnchorUm` is the coarse end of the curve
 * (recovery ≈ 0 there) and `fineAnchorUm` the fine end used for normalisation.
 *
 * ⚠️ These are ORE-SPECIFIC calibration constants, not physical laws — the
 * liberation behaviour of a free-milling quartz-vein ore and of a refractory
 * pyrite/arsenopyrite ore differ by far more than the difference between any two
 * values here. They must be re-fitted against the project's own grind-recovery
 * testwork (a standard set of bottle-roll / GRG tests at several P80s) before the
 * curve is used for anything but a first-pass screening. Grouped and named here
 * rather than buried in the formula so a re-calibration is a single, visible edit.
 */
export const LIBERATION_MODEL = {
  coarseAnchorUm: 500,
  fineAnchorUm: 25,
  freeRatePerUm: 0.018,
  lockedRatePerUm: 0.008,
  lockedCeilingFraction: 0.85,
  /** Free-gold fraction (%) assumed when a domain has no measured GRG/diagnostic value. */
  defaultFreeAuPct: 60,
  /** Recovery ceiling (%) when the caller supplies no project-specific achievable recovery. */
  defaultCeilingPct: 96,
} as const;

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
  const L = LIBERATION_MODEL;
  const finerBy = L.coarseAnchorUm - p80_um;
  const base = freeAu * (1 - Math.exp(-L.freeRatePerUm * finerBy));
  const tailRec = (100 - freeAu) * L.lockedCeilingFraction * (1 - Math.exp(-L.lockedRatePerUm * finerBy));
  return Math.max(0, base + tailRec);
}

/**
 * Recovery vs grind size, anchored on the project's achievable recovery.
 *
 * The raw liberation curve is normalised so a fine grind (25 µm) reaches
 * `ceiling` — the project's global gravity+leach recovery — keeping the module
 * coherent with the Dashboard / Économie instead of an arbitrary 98 % asymptote.
 */
export function recoveryModel(
  p80_um: number,
  au_free_pct: number | null,
  ceiling: number = LIBERATION_MODEL.defaultCeilingPct,
): number {
  const freeAu = au_free_pct ?? LIBERATION_MODEL.defaultFreeAuPct;
  const refFine = recoveryShape(LIBERATION_MODEL.fineAnchorUm, freeAu) || 1;
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
  cost: number;        // $/t grinding energy (plant basis)
  labCost: number;     // $/t grinding energy if costed on the raw lab Bond energy
  revenueUsdT: number;
  netUsd: number;      // $/t net value — plant-energy basis (design basis)
  netUsdLab: number;   // $/t net value if costed on lab energy — control only
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
  /**
   * Economic optimum, PLANT-energy basis — refined off the discrete ladder to
   * the nearest µm (see refineOptimum). This is the design grind: the ladder
   * only brackets it, a real mill is set to a specific size, not a rung.
   */
  optimal: P80Point;
  /** Nearest ladder rung to `optimal` — for charts/markers that live on the ladder. */
  optimalIndex: number;
  /**
   * Economic optimum if the mill were (wrongly) costed on the raw lab Bond
   * energy — no EF5, no plant/lab factor. Always finer than `optimal`: it is the
   * "deceptively fine" size a lab-energy optimisation would pick, kept as a
   * teaching/control value beside the real plant target.
   */
  optimalLab: P80Point;
  /** Nearest ladder rung to `optimalLab`. */
  optimalLabIndex: number;
}

/** Frozen valuation context so a P80 can be scored anywhere on a continuum. */
interface ValueCtx {
  bwi: number; f80: number; auFreePct: number | null; ceiling: number;
  grade: number; price: number; elec: number; plantFactor: number; applyFineness: boolean;
}

/** Net value of a single P80, on both the plant and lab energy bases. */
function valueAtP80(p80: number, c: ValueCtx): P80Point {
  const labEnergy = bondEnergy(c.bwi, c.f80, p80);
  const ef5 = c.applyFineness ? rowlandEF5(p80) : 1;
  const energy = labEnergy * ef5 * c.plantFactor;
  const recovery = recoveryModel(p80, c.auFreePct, c.ceiling);
  const revenueUsdT = c.grade * (recovery / 100) / TROY_OZ_GRAMS * c.price;
  const cost = energy * c.elec;
  const labCost = labEnergy * c.elec;
  return {
    p80, energy, labEnergy, ef5, recovery, cost, labCost, revenueUsdT,
    netUsd: revenueUsdT - cost, netUsdLab: revenueUsdT - labCost,
  };
}

/**
 * Refine a ladder optimum to the nearest µm.
 *
 * The ladder only samples the value curve every ~30 µm, so its argmax is snapped
 * to a rung. The value function (Bond × EF5 × recovery) is smooth and single-
 * peaked in the neighbourhood of that rung, so a 1 µm scan across the bracket
 * formed by the two adjacent rungs recovers a precise optimum. The bracket
 * always contains the rung itself, so the refined point is never worse than it.
 */
function refineOptimum(
  ladder: number[], bestIdx: number, key: 'netUsd' | 'netUsdLab', c: ValueCtx,
): P80Point {
  const neighbourA = ladder[Math.min(bestIdx + 1, ladder.length - 1)];
  const neighbourB = ladder[Math.max(bestIdx - 1, 0)];
  const lo = Math.min(neighbourA, neighbourB);
  const hi = Math.max(neighbourA, neighbourB);
  let best = valueAtP80(ladder[bestIdx], c);
  for (let p = Math.ceil(lo); p <= Math.floor(hi); p++) {
    const pt = valueAtP80(p, c);
    if (pt[key] > best[key]) best = pt;
  }
  return best;
}

/** Index of the ladder rung nearest an arbitrary P80. */
function nearestLadderIndex(ladder: number[], p80: number): number {
  return ladder.reduce((best, v, i) => (Math.abs(v - p80) < Math.abs(ladder[best] - p80) ? i : best), 0);
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

  const ctx: ValueCtx = {
    bwi: inputs.bwi, f80: inputs.f80_um, auFreePct: inputs.auFreePct,
    ceiling: inputs.recoveryCeilingPct, grade: inputs.goldGradeGt,
    price: inputs.goldPriceUsdOz, elec, plantFactor, applyFineness,
  };

  // The mill is priced on PLANT energy, not the lab Bond prediction — otherwise
  // the optimum would sit finer than any real circuit could afford. The lab basis
  // is kept per point (netUsdLab) so the two optima can be shown side by side.
  const points: P80Point[] = ladder.map(p => valueAtP80(p, ctx));

  const ladderBest = (key: 'netUsd' | 'netUsdLab') =>
    points.reduce((best, pt, i) => (pt[key] > points[best][key] ? i : best), 0);

  // Refine each ladder argmax to the nearest µm — a real mill targets a size, not
  // a rung. optimalIndex keeps the nearest ladder rung for chart markers.
  const optimal = refineOptimum(ladder, ladderBest('netUsd'), 'netUsd', ctx);
  const optimalLab = refineOptimum(ladder, ladderBest('netUsdLab'), 'netUsdLab', ctx);
  return {
    points, optimal, optimalLab,
    optimalIndex: nearestLadderIndex(ladder, optimal.p80),
    optimalLabIndex: nearestLadderIndex(ladder, optimalLab.p80),
  };
}
