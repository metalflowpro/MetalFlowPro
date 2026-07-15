// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Physical & financial constants (single source of truth)
//
// This module centralises values that were previously hardcoded (and duplicated)
// across modules. Two tiers:
//   1. PHYSICAL_CONSTANTS  — immutable physical/units constants (never per-project).
//   2. DEFAULT_ASSUMPTIONS — versioned default economic/operational assumptions,
//      overridable per project via the `project_settings` table (see resolveSettings).
//
// Rule of thumb: if a number has a physical/units meaning it belongs in
// PHYSICAL_CONSTANTS; if it is an economic or operating assumption a user could
// legitimately change, it belongs in DEFAULT_ASSUMPTIONS and must be overridable.
// ─────────────────────────────────────────────────────────────────────────────

/** Immutable physical & unit-conversion constants. */
export const PHYSICAL_CONSTANTS = {
  /** Grams per troy ounce (exact, per international troy weight). */
  TROY_OZ_GRAMS: 31.1035,
  /** Troy ounces per kilogram = 1000 / 31.1035. */
  TROY_OZ_PER_KG: 1000 / 31.1035,
  /** Calendar hours in a (non-leap) year. */
  HOURS_PER_YEAR: 8760,
} as const;

/** Convenience scalar re-exports (kept in sync with PHYSICAL_CONSTANTS). */
export const TROY_OZ_GRAMS = PHYSICAL_CONSTANTS.TROY_OZ_GRAMS;
export const TROY_OZ_PER_KG = PHYSICAL_CONSTANTS.TROY_OZ_PER_KG;
export const HOURS_PER_YEAR = PHYSICAL_CONSTANTS.HOURS_PER_YEAR;

/** Convert a gold mass in kilograms to troy ounces. */
export function kgToTroyOz(kg: number): number {
  return kg * TROY_OZ_PER_KG;
}

/** Convert a gold mass in grams to troy ounces. */
export function gramsToTroyOz(g: number): number {
  return g / TROY_OZ_GRAMS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default economic / operational assumptions (overridable per project)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Documented default assumptions. These are the code-versioned fallbacks used
 * when a project has not (yet) supplied a value in `project_settings`.
 * Sources/rationale are noted so figures remain auditable and defensible.
 */
export const DEFAULT_ASSUMPTIONS = {
  /** Discount rate for NPV (fraction). 8% is the mining-industry base case for gold PFS/FS. */
  DISCOUNT_RATE: 0.08,
  /** Plant availability (fraction) fallback when a project has no explicit value. */
  AVAILABILITY_FRACTION: 0.91,
  /** Life-of-mine (years) fallback for cash-flow horizon. */
  LOM_YEARS: 10,
  /** Gold price ($/oz) used for base-case economics when none supplied. */
  GOLD_PRICE_USD_OZ: 2000,
  /** Gold-price ladder ($/oz) for NPV sensitivity analysis. */
  GOLD_PRICE_SENSITIVITY: [1600, 1800, 2000, 2200, 2500, 3000] as number[],
  /**
   * Gravity-plant efficiency factor applied to GRG lab recovery to estimate the
   * installed gravity-circuit recovery (lab GRG over-states plant performance).
   * ~0.90 is a conventional derating for Knelson/Falcon centrifugal circuits.
   */
  GRAVITY_PLANT_EFFICIENCY: 0.90,
  /**
   * Electricity cost ($/kWh) used for grinding-energy trade-offs (e.g. optimal P80).
   * Note: the Economics module carries its own user-editable `elec_cad_kwh` (CAD).
   * These are not yet unified because they are in different currencies — see audit.
   */
  ELECTRICITY_COST_USD_KWH: 0.08,
  /** Refining/smelting charge ($/oz) fallback for doré. */
  REFINERY_CHARGE_USD_OZ: 5,
  /** Mining royalty (fraction of revenue) fallback. */
  ROYALTY_FRACTION: 0.03,
  /** Working capital as a fraction of first-year CAPEX. */
  WORKING_CAPITAL_FRACTION: 0.10,
  /** Contingency (fraction) applied to CAPEX estimates. */
  CONTINGENCY_FRACTION: 0.15,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Settings resolver: merge DB overrides (project_settings) over code defaults
// ─────────────────────────────────────────────────────────────────────────────

/** Subset of project_settings fields relevant to economic/operational resolution. */
export interface ResolvableSettings {
  hours_per_year: number | null;
  discount_rate_pct: number | null;
  sustaining_capex_musd_yr: number | null;
  contingency_pct: number | null;
  lom_years: number | null;
  refinery_charge_usd_oz: number | null;
  royalty_pct: number | null;
  working_capital_pct: number | null;
}

/** Fully-resolved assumptions (defaults with any project override applied). */
export interface ResolvedAssumptions {
  hoursPerYear: number;
  discountRate: number;       // fraction
  lomYears: number;
  contingencyFraction: number;
  refineryChargeUsdOz: number;
  royaltyFraction: number;
  workingCapitalFraction: number;
}

/** First finite number wins; used to layer DB override over code default. */
function pick(override: number | null | undefined, fallback: number): number {
  return typeof override === 'number' && Number.isFinite(override) ? override : fallback;
}

/**
 * Resolve the effective assumptions for a project by layering the persisted
 * `project_settings` (when present) over the documented code defaults.
 * Percentage-typed DB columns are converted to fractions here.
 */
export function resolveSettings(settings: Partial<ResolvableSettings> | null | undefined): ResolvedAssumptions {
  const s = settings ?? {};
  return {
    hoursPerYear: pick(s.hours_per_year, HOURS_PER_YEAR),
    discountRate: pick(s.discount_rate_pct != null ? s.discount_rate_pct / 100 : null, DEFAULT_ASSUMPTIONS.DISCOUNT_RATE),
    lomYears: pick(s.lom_years, DEFAULT_ASSUMPTIONS.LOM_YEARS),
    contingencyFraction: pick(s.contingency_pct != null ? s.contingency_pct / 100 : null, DEFAULT_ASSUMPTIONS.CONTINGENCY_FRACTION),
    refineryChargeUsdOz: pick(s.refinery_charge_usd_oz, DEFAULT_ASSUMPTIONS.REFINERY_CHARGE_USD_OZ),
    royaltyFraction: pick(s.royalty_pct != null ? s.royalty_pct / 100 : null, DEFAULT_ASSUMPTIONS.ROYALTY_FRACTION),
    workingCapitalFraction: pick(s.working_capital_pct != null ? s.working_capital_pct / 100 : null, DEFAULT_ASSUMPTIONS.WORKING_CAPITAL_FRACTION),
  };
}
