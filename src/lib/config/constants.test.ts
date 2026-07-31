import { describe, it, expect } from 'vitest';
import {
  resolveSettings, DEFAULT_ASSUMPTIONS, HOURS_PER_YEAR,
  TROY_OZ_GRAMS, kgToTroyOz, gramsToTroyOz,
  USD_PER_CAD, cadToUsd, parseSettingInput,
  computeProductionMetrics,
} from './constants';

describe('resolveSettings', () => {
  it('falls back to documented defaults when a project has no settings row', () => {
    const a = resolveSettings(null);
    // Regression: this used to resolve to null upstream, which collapsed
    // annualProduction to 0 while other modules assumed 8760.
    expect(a.hoursPerYear).toBe(HOURS_PER_YEAR);
    expect(a.discountRate).toBeCloseTo(DEFAULT_ASSUMPTIONS.DISCOUNT_RATE);
    expect(a.lomYears).toBe(DEFAULT_ASSUMPTIONS.LOM_YEARS);
  });

  it('treats an empty settings object like no settings', () => {
    expect(resolveSettings({})).toEqual(resolveSettings(null));
  });

  it('lets a project override win over the default', () => {
    expect(resolveSettings({ hours_per_year: 8000 }).hoursPerYear).toBe(8000);
  });

  it('converts percentage columns to fractions', () => {
    const a = resolveSettings({ discount_rate_pct: 12, royalty_pct: 4, contingency_pct: 20, working_capital_pct: 5 });
    expect(a.discountRate).toBeCloseTo(0.12);
    expect(a.royaltyFraction).toBeCloseTo(0.04);
    expect(a.contingencyFraction).toBeCloseTo(0.20);
    expect(a.workingCapitalFraction).toBeCloseTo(0.05);
  });

  it('keeps an explicit zero instead of falling back to the default', () => {
    // A project legitimately setting 0% royalty must not silently get 3%.
    expect(resolveSettings({ royalty_pct: 0 }).royaltyFraction).toBe(0);
  });

  it('ignores non-finite overrides and keeps the default', () => {
    expect(resolveSettings({ hours_per_year: NaN }).hoursPerYear).toBe(HOURS_PER_YEAR);
  });

  it('only overrides the fields that are supplied', () => {
    const a = resolveSettings({ hours_per_year: 8000 });
    expect(a.lomYears).toBe(DEFAULT_ASSUMPTIONS.LOM_YEARS);
    expect(a.discountRate).toBeCloseTo(DEFAULT_ASSUMPTIONS.DISCOUNT_RATE);
  });
});

describe('troy ounce conversions', () => {
  it('agrees with the literal the modules used to hardcode', () => {
    expect(gramsToTroyOz(31.1035)).toBeCloseTo(1, 10);
    expect(kgToTroyOz(1)).toBeCloseTo(1000 / TROY_OZ_GRAMS, 10);
  });

  it('matches the /0.0311035 literal the optimizer used', () => {
    expect(kgToTroyOz(1)).toBeCloseTo(1 / 0.0311035, 3);
  });

  it('round-trips', () => {
    expect(gramsToTroyOz(kgToTroyOz(2) * TROY_OZ_GRAMS)).toBeCloseTo(2000 / TROY_OZ_GRAMS, 6);
  });
});

describe('currency — USD is the reference', () => {
  it('converts CAD benchmarks to USD at the documented rate', () => {
    expect(cadToUsd(1)).toBeCloseTo(USD_PER_CAD, 10);
    expect(cadToUsd(0)).toBe(0);
  });

  it('uses a rate that makes CAD worth less than USD', () => {
    // Guards against the rate being inverted (USD per CAD, not CAD per USD).
    expect(USD_PER_CAD).toBeGreaterThan(0);
    expect(USD_PER_CAD).toBeLessThan(1);
  });

  it('converts the Québec labour benchmark into a plausible USD rate', () => {
    // 38 CAD/h mill operator -> high-20s USD/h. Catches a missing or inverted rate.
    const usdPerHour = cadToUsd(38);
    expect(usdPerHour).toBeGreaterThan(20);
    expect(usdPerHour).toBeLessThan(35);
  });
});

describe('electricity cost — single shared source', () => {
  it('derives from the 0.092 CAD/kWh benchmark', () => {
    expect(DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH).toBeCloseTo(cadToUsd(0.092), 10);
  });

  it('lands in a plausible industrial USD/kWh band', () => {
    // Regression: the app previously carried 0.08 USD (Granulometry), 0.092 CAD
    // (OPEX table) and 0.09 (OPEX generator) as three different prices per kWh.
    expect(DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH).toBeGreaterThan(0.03);
    expect(DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH).toBeLessThan(0.15);
  });
});

describe('annual production coherence', () => {
  // The formula that ProjectContext now owns, and that MassBalance used to
  // duplicate with a hardcoded 8760. Both paths must agree.
  const project = { target_tph: 500, availability_pct: 91, gold_grade_g_t: 2.5 };
  const recoveryPct = 92;

  function fromContext() {
    const a = resolveSettings(null);
    const tonnes = project.target_tph * a.hoursPerYear * (project.availability_pct / 100);
    return tonnes * project.gold_grade_g_t * (recoveryPct / 100) / TROY_OZ_GRAMS;
  }

  it('is greater than zero without a settings row', () => {
    expect(fromContext()).toBeGreaterThan(0);
  });

  it('matches the formula MassBalance used to compute independently', () => {
    const massBalanceLegacy =
      project.target_tph * project.availability_pct / 100 * 8760 *
      project.gold_grade_g_t * recoveryPct / 100 / 31.1035;
    expect(fromContext()).toBeCloseTo(massBalanceLegacy, 6);
  });

  it('tracks an hours override', () => {
    const a = resolveSettings({ hours_per_year: 8000 });
    const tonnes = project.target_tph * a.hoursPerYear * (project.availability_pct / 100);
    expect(tonnes).toBeCloseTo(500 * 8000 * 0.91, 6);
  });

  it('centralizes production metrics on resolved settings, not raw nullable settings', () => {
    const a = resolveSettings(null);
    const metrics = computeProductionMetrics(project, a, recoveryPct);
    expect(metrics.annualTonnes).toBeCloseTo(500 * HOURS_PER_YEAR * 0.91, 6);
    expect(metrics.annualOz).toBeCloseTo(fromContext(), 6);
  });
});

// `undefined` means "do not write" (revert the field); `null` means "clear the
// override so the documented default applies"; a number means "persist it".
describe('parseSettingInput', () => {
  it('persists an explicit zero instead of dropping it', () => {
    // Regression: the old `parseFloat(v) || null` turned 0 into null, so a
    // royalty deliberately set to 0% silently reverted to the 3% default.
    expect(parseSettingInput('0', 3)).toBe(0);
    expect(parseSettingInput('0', null)).toBe(0);
  });

  it('clears the override when the field is emptied', () => {
    expect(parseSettingInput('', 8000)).toBeNull();
  });

  it('does not write when an already-empty field is left empty', () => {
    expect(parseSettingInput('', null)).toBeUndefined();
  });

  it('does not write when the value is unchanged', () => {
    expect(parseSettingInput('8000', 8000)).toBeUndefined();
  });

  it('writes when the value changed', () => {
    expect(parseSettingInput('8100', 8000)).toBe(8100);
  });

  it('reverts on unparseable input rather than writing garbage', () => {
    expect(parseSettingInput('abc', 8000)).toBeUndefined();
    expect(parseSettingInput('--', 8000)).toBeUndefined();
    expect(parseSettingInput('1.2.3', 8000)).toBeUndefined();
  });

  it('accepts decimals and trims whitespace', () => {
    expect(parseSettingInput('0.5', null)).toBe(0.5);
    expect(parseSettingInput('  12  ', null)).toBe(12);
  });
});
