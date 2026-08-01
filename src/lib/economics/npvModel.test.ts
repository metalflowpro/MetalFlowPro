import { describe, it, expect } from 'vitest';
import { computeProjectNpv, type NpvModelInputs } from './npvModel';

const base: NpvModelInputs = {
  annualOz: 100_000,
  goldPriceUsdOz: 2000,
  annualOpexUsd: 90_000_000,
  initialCapexUsd: 300_000_000,
  sustainingCapexUsdYr: 10_000_000,
  discountRate: 0.08,
  lomYears: 10,
  royaltyFraction: 0.03,
  refineryChargeUsdOz: 5,
};

describe('computeProjectNpv', () => {
  it('computes revenue net of royalty and refining', () => {
    const r = computeProjectNpv(base);
    expect(r.grossRevenueYr).toBe(200_000_000);
    // royalty 3% = 6M ; refining 100k·5 = 0.5M
    expect(r.netRevenueYr).toBeCloseTo(200_000_000 - 6_000_000 - 500_000, 6);
    expect(r.ebitdaYr).toBeCloseTo(r.netRevenueYr - 90_000_000, 6);
    expect(r.annualCashflow).toBeCloseTo(r.ebitdaYr - 10_000_000, 6);
  });

  it('discounts operating cashflows and subtracts initial capex', () => {
    const r = computeProjectNpv(base);
    // Manual: annuity factor for 10 yr @8% ≈ 6.7101
    const cf = base.annualOpexUsd; // placeholder unused
    void cf;
    const af = (1 - Math.pow(1.08, -10)) / 0.08;
    const expected = computeProjectNpv(base).annualCashflow * af - base.initialCapexUsd;
    expect(r.npv).toBeCloseTo(expected, 2);
  });

  it('NPV decreases as discount rate rises', () => {
    const low = computeProjectNpv({ ...base, discountRate: 0.05 }).npv;
    const high = computeProjectNpv({ ...base, discountRate: 0.15 }).npv;
    expect(low).toBeGreaterThan(high);
  });

  it('NPV rises with gold price', () => {
    const lo = computeProjectNpv({ ...base, goldPriceUsdOz: 1500 }).npv;
    const hi = computeProjectNpv({ ...base, goldPriceUsdOz: 2500 }).npv;
    expect(hi).toBeGreaterThan(lo);
  });

  it('returns a finite IRR for a viable project', () => {
    const r = computeProjectNpv(base);
    expect(r.irr).not.toBeNull();
    expect(r.irr!).toBeGreaterThan(0);
    expect(r.irr!).toBeLessThan(1);
  });

  it('reports payback in years', () => {
    const r = computeProjectNpv(base);
    expect(r.paybackYears).toBeGreaterThan(0);
    expect(r.paybackYears).toBeLessThan(base.lomYears);
  });

  it('flags a non-viable project (no positive cashflow) with infinite payback', () => {
    const r = computeProjectNpv({ ...base, annualOpexUsd: 500_000_000 });
    expect(r.annualCashflow).toBeLessThan(0);
    expect(r.paybackYears).toBe(Infinity);
  });
});
