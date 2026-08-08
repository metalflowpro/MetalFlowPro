import { describe, it, expect } from 'vitest';
import { normalQuantile, studentTQuantile, tCritical } from './distributions';

describe('normalQuantile', () => {
  it('matches standard normal quantiles', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 6);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 4);
    expect(normalQuantile(0.95)).toBeCloseTo(1.644854, 4);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.959964, 4);
    expect(normalQuantile(0.99)).toBeCloseTo(2.326348, 4);
  });

  it('handles the tails', () => {
    expect(normalQuantile(0)).toBe(-Infinity);
    expect(normalQuantile(1)).toBe(Infinity);
  });
});

describe('studentTQuantile', () => {
  // Valeurs de référence des tables de Student (quantile 0.975).
  it('approximates t(0.975, ν) within tolerance', () => {
    expect(studentTQuantile(0.975, 5)).toBeCloseTo(2.571, 1);
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228, 1);
    expect(studentTQuantile(0.975, 20)).toBeCloseTo(2.086, 2);
    expect(studentTQuantile(0.975, 30)).toBeCloseTo(2.042, 2);
    expect(studentTQuantile(0.975, 100)).toBeCloseTo(1.984, 2);
  });

  it('converges to the normal quantile for large df', () => {
    expect(studentTQuantile(0.975, 1e8)).toBeCloseTo(1.959964, 4);
  });

  it('is always wider than the normal (fatter tails)', () => {
    expect(studentTQuantile(0.975, 5)).toBeGreaterThan(normalQuantile(0.975));
    expect(studentTQuantile(0.975, 50)).toBeGreaterThan(normalQuantile(0.975));
  });
});

describe('tCritical', () => {
  it('maps a confidence level to the two-sided critical value', () => {
    // 90 % confiance → quantile 0.95
    expect(tCritical(0.90, 10)).toBeCloseTo(studentTQuantile(0.95, 10), 9);
    expect(tCritical(0.95, 20)).toBeCloseTo(studentTQuantile(0.975, 20), 9);
  });
});
