import { describe, it, expect } from 'vitest';
import { npv, irr, formatCurrency, formatOz } from './economics';

describe('npv', () => {
  it('discounts the first cashflow by one full period', () => {
    // Convention: cashflows[0] is year 1 (end-of-period), so it is discounted once.
    expect(npv([100], 0.10)).toBeCloseTo(100 / 1.1, 10);
  });

  it('matches the closed-form annuity for a level stream', () => {
    const cf = Array(10).fill(1_000_000);
    const r = 0.08;
    const annuity = (1 - Math.pow(1 + r, -10)) / r;
    expect(npv(cf, r)).toBeCloseTo(1_000_000 * annuity, 4);
    // ~6.71x annual cashflow over 10 years at 8%.
    expect(npv(cf, r) / 1_000_000).toBeCloseTo(6.7101, 3);
  });

  it('decreases as the discount rate rises', () => {
    const cf = Array(10).fill(1_000_000);
    expect(npv(cf, 0.15)).toBeLessThan(npv(cf, 0.08));
  });

  it('equals the plain sum at a zero rate', () => {
    expect(npv([100, 200, 300], 0)).toBeCloseTo(600, 10);
  });

  it('is always below the undiscounted sum at a positive rate', () => {
    const cf = Array(10).fill(1_000_000);
    expect(npv(cf, 0.08)).toBeLessThan(10_000_000);
  });

  it('returns 0 for no cashflows', () => {
    expect(npv([], 0.08)).toBe(0);
  });
});

describe('irr', () => {
  it('finds the rate that zeroes a simple two-period project', () => {
    // -100 now, +110 in one year => exactly 10%.
    expect(irr([-100, 110])).toBeCloseTo(0.10, 6);
  });

  it('finds the rate of a level annuity against an upfront capex', () => {
    // -1000 now, +250/yr for 5 years => ~7.93%.
    const r = irr([-1000, 250, 250, 250, 250, 250]);
    expect(r).toBeCloseTo(0.0793, 3);
  });

  it('produces a rate that actually zeroes the NPV', () => {
    const cf = [-5000, 1200, 1500, 1800, 2000, 2200];
    const r = irr(cf);
    const value = cf.reduce((acc, c, t) => acc + c / Math.pow(1 + r, t), 0);
    expect(value).toBeCloseTo(0, 4);
  });

  it('rises when later cashflows improve', () => {
    expect(irr([-1000, 300, 300, 300, 300, 300]))
      .toBeGreaterThan(irr([-1000, 250, 250, 250, 250, 250]));
  });
});

describe('formatters', () => {
  it('formats currency in millions with a $ prefix', () => {
    expect(formatCurrency(0)).toContain('$');
  });

  it('formats ounces without throwing on zero', () => {
    expect(() => formatOz(0)).not.toThrow();
  });
});
