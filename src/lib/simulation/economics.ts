import { ScenarioModification, ScenarioEconomics, ProcessNode, StreamEdge, FeedInput } from './types';
import { solveFlowsheet } from './engine';

// ─── Constants ────────────────────────────────────────────────────────────────

const TROY_OZ_PER_KG = 1 / 0.0311035;
const HOURS_PER_YEAR = 8760;

// ─── NPV calculation ──────────────────────────────────────────────────────────

function npv(cashflows: number[], discountRate: number): number {
  return cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + discountRate, t + 1), 0);
}

// ─── IRR via Newton-Raphson ───────────────────────────────────────────────────

function irr(cashflows: number[], maxIter = 100): number {
  let rate = 0.15;
  for (let i = 0; i < maxIter; i++) {
    let f = 0;
    let df = 0;
    for (let t = 0; t < cashflows.length; t++) {
      f += cashflows[t] / Math.pow(1 + rate, t);
      if (t > 0) df -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
    }
    const newRate = rate - f / df;
    if (Math.abs(newRate - rate) < 1e-6) return newRate;
    rate = newRate;
  }
  return rate;
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
  sustainingCapexPerYear: number;  // $/year
}

export function computeScenarioEconomics(inputs: EconomicInputs): ScenarioEconomics {
  const { baseNodes, modifiedNodes, edges, feed, modifications, goldPriceUsdOz, availabilityFraction, mineLifeYears, sustainingCapexPerYear } = inputs;

  const baseResult = solveFlowsheet(baseNodes, edges, feed, { maxIterations: 60, tolerance: 1e-4, mode: 'steady_state' });
  const modResult  = solveFlowsheet(modifiedNodes, edges, feed, { maxIterations: 60, tolerance: 1e-4, mode: 'steady_state' });

  const effectiveHours = HOURS_PER_YEAR * availabilityFraction;

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
  const annualOpexDelta = opexDelta * feed.feed_rate * effectiveHours;
  const modAnnualOpex   = modResult.globalResults.total_opex_per_t * feed.feed_rate * effectiveHours;

  // Total CAPEX from modifications
  const capexTotal = modifications.reduce((s, m) => s + m.capex_estimate, 0);

  // Annual incremental cash flow
  const annualIncrementalCF = (modRevenue - baseRevenue) - annualOpexDelta - sustainingCapexPerYear;

  // NPV at 8% over mine life
  const cashflows = [-capexTotal, ...Array(mineLifeYears).fill(annualIncrementalCF)];
  const npv8 = npv(cashflows.slice(1), 0.08) - capexTotal;

  // IRR
  const irrVal = irr(cashflows);

  // Payback
  const payback = paybackYears(capexTotal, annualIncrementalCF);

  // AISC
  const aisc = aiscPerOz(modAnnualOpex, sustainingCapexPerYear, modAnnualOz);

  // Gold price sensitivity
  const goldPrices = [1600, 1800, 2000, 2200, 2500, 3000];
  const sensitivity: Record<string, number> = {};
  for (const gp of goldPrices) {
    const revAtPrice = modAnnualOz * gp;
    const baseRevAtPrice = baseAnnualKg * TROY_OZ_PER_KG * gp;
    const cfAtPrice = (revAtPrice - baseRevAtPrice) - annualOpexDelta - sustainingCapexPerYear;
    const cfs = [-capexTotal, ...Array(mineLifeYears).fill(cfAtPrice)];
    sensitivity[`$${gp}`] = npv(cfs.slice(1), 0.08) - capexTotal;
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
