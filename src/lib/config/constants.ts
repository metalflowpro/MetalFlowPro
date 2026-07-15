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
// Currency — USD is the platform's reference currency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * USD per 1 CAD.
 *
 * Every cost in the app is expressed and displayed in USD. This rate exists
 * solely to convert the CAD-denominated engineering benchmarks the OPEX model
 * was originally built from (Québec labour rates, diesel, grid power) into that
 * reference currency.
 *
 * ⚠️ Market rate, not a physical constant — it drifts. Review before publishing
 * a study; prefer capturing costs directly in USD over relying on this.
 */
export const USD_PER_CAD = 0.73;

/** Convert a CAD-denominated benchmark to the reference currency (USD). */
export function cadToUsd(cad: number): number {
  return cad * USD_PER_CAD;
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
   * Electricity cost (USD/kWh) — the single source shared by the Economics OPEX
   * model and Granulometry's optimal-P80 energy trade-off.
   *
   * Derived from the OPEX model's engineering benchmark of 0.092 CAD/kWh
   * (Québec industrial grid power) converted at USD_PER_CAD. Granulometry
   * previously used a self-described "nominal" 0.08 USD/kWh, so the two modules
   * priced the same kWh differently; they now agree on this value.
   */
  ELECTRICITY_COST_USD_KWH: USD_PER_CAD * 0.092,
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

/**
 * Parse a settings-editor input into the value to persist.
 *
 * Lives here rather than in the Economics page so it stays free of the Supabase
 * client (importing the page pulls in `supabase.ts`, which throws at module load
 * when env vars are absent — that made the test suite depend on a local .env).
 *
 * - `null`      -> field cleared; drop the override so the documented default applies
 * - `undefined` -> nothing to write (unchanged, already empty, or unparseable)
 * - number      -> persist it, including an explicit 0
 */
export function parseSettingInput(draft: string, current: number | null): number | null | undefined {
  const raw = draft.trim();
  if (raw === '') return current != null ? null : undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return n !== current ? n : undefined;
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
