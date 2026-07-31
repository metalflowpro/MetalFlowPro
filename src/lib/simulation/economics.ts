import { ScenarioModification, ScenarioEconomics, ProcessNode, StreamEdge, FeedInput } from './types';
import { solveFlowsheet } from './engine';
import { TROY_OZ_PER_KG, HOURS_PER_YEAR, DEFAULT_ASSUMPTIONS } from '../config/constants';

// ─── NPV calculation ──────────────────────────────────────────────────────────

export function npv(cashflows: number[], discountRate: number): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + discountRate, t + 1), 0);
}

// ─── IRR — bracketed bisection ────────────────────────────────────────────────

/** NPV at t=0..n-1 (cashflows[0] undiscounted) — the function the IRR zeroes. */
function npvAtRate(cashflows: number[], rate: number): number {
  let v = 0;
  for (let t = 0; t < cashflows.length; t++) v += cashflows[t] / Math.pow(1 + rate, t);
  return v;
}

/** Widest rate the search considers: −99 % to +10 000 %/yr. */
const IRR_MIN = -0.9999;
const IRR_MAX = 100;

/**
 * Internal rate of return.
 *
 * Returns `null` when no IRR exists — which is a real outcome, not an error: a
 * stream with no sign change (all-positive or all-negative) has no rate that
 * zeroes its NPV.
 *
 * This replaces an unguarded Newton-Raphson that had no bracketing, no check on
 * a vanishing derivative and no bounds. It diverged on short, capex-heavy mine
 * schedules and returned whatever it had reached after 100 iterations — the
 * module displayed 4.5e+31 % as a rate of return. Bisection cannot diverge: it
 * only ever halves a bracket that is known to contain a root.
 */
export function irr(cashflows: number[], maxIter = 200): number | null {
  if (cashflows.length < 2) return null;
  const hasPos = cashflows.some(c => c > 0);
  const hasNeg = cashflows.some(c => c < 0);
  if (!hasPos || !hasNeg) return null;   // no sign change → no IRR

  let lo = IRR_MIN, hi = IRR_MAX;
  let fLo = npvAtRate(cashflows, lo);
  let fHi = npvAtRate(cashflows, hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  // The root must be bracketed. A stream that stays positive even at +10 000 %/yr
  // has no meaningful IRR to report.
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < maxIter; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAtRate(cashflows, mid);
    if (!Number.isFinite(fMid)) return null;
    if (Math.abs(fMid) < 1e-9 || (hi - lo) / 2 < 1e-9) return mid;
    if (fLo * fMid <= 0) { hi = mid; fHi = fMid; } else { lo = mid; fLo = fMid; }
  }
  return (lo + hi) / 2;
}

// ─── Payback period ───────────────────────────────────────────────────────────

function paybackYears(capex: number, annualCashflow: number): number {
  return annualCashflow > 0 ? capex / annualCashflow : Infinity;
}

// ─── AISC per oz ──────────────────────────────────────────────────────────────

function aiscPerOz(annualOpex: number, sustainingCapex: number, annualOz: number): number {
  return annualOz > 0 ? (annualOpex + sustainingCapex) / annualOz : 0;
}

// ─── Main economic scenario evaluator ────────────────────────────────────────

export interface EconomicInputs {
  baseNodes: ProcessNode[];
  modifiedNodes: ProcessNode[];
  edges: StreamEdge[];
  feed: FeedInput;
  modifications: ScenarioModification[];
  goldPriceUsdOz: number;          // $/oz
  availabilityFraction: number;    // 0–1 (e.g. 0.91)
  mineLifeYears: number;
  sustainingCapexPerYear: number;  // $/year for AISC; no incremental delta is assumed
  discountRate?: number;           // fraction; defaults to DEFAULT_ASSUMPTIONS.DISCOUNT_RATE
  goldPriceLadder?: number[];      // $/oz sensitivity ladder; defaults to DEFAULT_ASSUMPTIONS
}

export function computeScenarioEconomics(inputs: EconomicInputs): ScenarioEconomics {
  const { baseNodes, modifiedNodes, edges, feed, modifications, goldPriceUsdOz, availabilityFraction, mineLifeYears, sustainingCapexPerYear } = inputs;
  const discountRate = inputs.discountRate ?? DEFAULT_ASSUMPTIONS.DISCOUNT_RATE;
  const goldPriceLadder = inputs.goldPriceLadder ?? DEFAULT_ASSUMPTIONS.GOLD_PRICE_SENSITIVITY;

  const baseResult = solveFlowsheet(baseNodes, edges, feed, { maxIterations: 60, tolerance: 1e-4, mode: 'steady_state' });
  const modResult  = solveFlowsheet(modifiedNodes, edges, feed, { maxIterations: 60, tolerance: 1e-4, mode: 'steady_state' });

  const effectiveHours = HOURS_PER_YEAR * availabilityFraction;
  const dryFeedRate = feed.feed_rate * (1 - feed.moisture / 100);

  // Annual gold output
  const baseAnnualKg  = baseResult.globalResults.dore_production_kg_h * effectiveHours;
  const modAnnualKg   = modResult.globalResults.dore_production_kg_h * effectiveHours;
  const additionalKg  = modAnnualKg - baseAnnualKg;
  const additionalOz  = additionalKg * TROY_OZ_PER_KG;

  // Annual revenue delta
  const modAnnualOz   = modAnnualKg * TROY_OZ_PER_KG;
  const modRevenue    = modAnnualOz * goldPriceUsdOz;
  const baseRevenue   = baseAnnualKg * TROY_OZ_PER_KG * goldPriceUsdOz;

  // Opex delta ($/t processed)
  const opexDelta = modResult.globalResults.total_opex_per_t - baseResult.globalResults.total_opex_per_t;
  const annualOpexDelta = opexDelta * dryFeedRate * effectiveHours;
  const modAnnualOpex   = modResult.globalResults.total_opex_per_t * dryFeedRate * effectiveHours;

  // Total CAPEX from modifications
  const capexTotal = modifications.reduce((s, m) => s + m.capex_estimate, 0);

  // Annual incremental cash flow. `sustainingCapexPerYear` is a project-level
  // amount used by AISC; without separate base/modified values its incremental
  // delta is zero and must not penalise an otherwise identical scenario.
  const annualIncrementalCF = (modRevenue - baseRevenue) - annualOpexDelta;

  // NPV at the resolved discount rate over mine life
  const cashflows = [-capexTotal, ...Array(mineLifeYears).fill(annualIncrementalCF)];
  const npv8 = npv(cashflows.slice(1), discountRate) - capexTotal;

  // IRR
  const irrVal = irr(cashflows);

  // Payback
  const payback = paybackYears(capexTotal, annualIncrementalCF);

  // AISC
  const aisc = aiscPerOz(modAnnualOpex, sustainingCapexPerYear, modAnnualOz);

  // Gold price sensitivity
  const sensitivity: Record<string, number> = {};
  for (const gp of goldPriceLadder) {
    const revAtPrice = modAnnualOz * gp;
    const baseRevAtPrice = baseAnnualKg * TROY_OZ_PER_KG * gp;
    const cfAtPrice = (revAtPrice - baseRevAtPrice) - annualOpexDelta;
    const cfs = [-capexTotal, ...Array(mineLifeYears).fill(cfAtPrice)];
    sensitivity[`$${gp}`] = npv(cfs.slice(1), discountRate) - capexTotal;
  }

  return {
    capex_total: capexTotal,
    opex_delta_per_tonne: opexDelta,
    additional_oz_per_year: additionalOz,
    npv_8pct: npv8,
    irr: irrVal,
    payback_years: payback,
    aisc_per_oz: aisc,
    gold_price_sensitivity: sensitivity,
  };
}

// ─── Format helpers ───────────────────────────────────────────────────────────

export function formatCurrency(value: number, decimals = 0): string {
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(0)}k`;
  return `$${value.toFixed(decimals)}`;
}

export function formatOz(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} Moz`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} koz`;
  return `${value.toFixed(0)} oz`;
}
