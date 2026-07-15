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
    expect(irr([-100, 110])!).toBeCloseTo(0.10, 6);
  });

  it('finds the rate of a level annuity against an upfront capex', () => {
    // -1000 now, +250/yr for 5 years => ~7.93%.
    const r = irr([-1000, 250, 250, 250, 250, 250])!;
    expect(r).toBeCloseTo(0.0793, 3);
  });

  it('produces a rate that actually zeroes the NPV', () => {
    const cf = [-5000, 1200, 1500, 1800, 2000, 2200];
    const r = irr(cf)!;
    const value = cf.reduce((acc, c, t) => acc + c / Math.pow(1 + r, t), 0);
    expect(value).toBeCloseTo(0, 4);
  });

  it('rises when later cashflows improve', () => {
    expect(irr([-1000, 300, 300, 300, 300, 300])!)
      .toBeGreaterThan(irr([-1000, 250, 250, 250, 250, 250])!);
  });

  it('never diverges on a short, capex-heavy mine schedule', () => {
    // Regression: the mine module showed "4.48e+31 %". A 281 M$ construction spend
    // followed by ~1100 M$/yr is a real DCF shape and must resolve to a finite rate.
    const r = irr([-281, 1100, 1150, 1200]);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
    expect(r!).toBeLessThan(100);
    expect(Number.isFinite(r!)).toBe(true);
  });

  it('returns null for the shape that made the old solver diverge', () => {
    // All-positive: CAPEX booked inside year 1 alongside full revenue, so the
    // project never has a negative year and NO rate zeroes the stream. The old
    // Newton-Raphson chased that non-existent root to 1e31.
    expect(irr([0, 819, 1150, 1200])).toBeNull();
  });

  it('stays finite and bracketed across a sweep of plausible schedules', () => {
    for (let capex = 50; capex <= 600; capex += 50) {
      for (let cf = 50; cf <= 1500; cf += 150) {
        const r = irr([-capex, cf, cf, cf]);
        if (r !== null) {
          expect(Number.isFinite(r)).toBe(true);
          expect(r).toBeGreaterThan(-1);
          expect(r).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('returns null when there is no sign change — no IRR exists', () => {
    expect(irr([100, 200, 300])).toBeNull();   // all positive
    expect(irr([-100, -200])).toBeNull();      // all negative
  });

  it('returns null rather than a number for a degenerate stream', () => {
    expect(irr([])).toBeNull();
    expect(irr([-100])).toBeNull();
  });

  it('handles a very profitable project without overflowing', () => {
    const r = irr([-100, 1000]);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!)).toBe(true);
    expect(r!).toBeCloseTo(9, 6); // -100 now, +1000 in a year => 900 %
  });

  it('reports null above the search ceiling rather than a meaningless rate', () => {
    // A 99 900 % return is past the +10 000 %/yr cap: no real project reaches it,
    // and reporting it would suggest a precision the model does not have.
    expect(irr([-1, 1000])).toBeNull();
  });

  it('agrees with the NPV it is supposed to zero', () => {
    const cf = [-500, 120, 180, 220, 260];
    const r = irr(cf)!;
    const v = cf.reduce((acc, c, t) => acc + c / Math.pow(1 + r, t), 0);
    expect(Math.abs(v)).toBeLessThan(1e-6);
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
