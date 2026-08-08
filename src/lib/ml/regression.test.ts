import { describe, it, expect } from 'vitest';
import { fitRegression, fitQuality } from './regression';

describe('fitRegression — simple linear', () => {
  it('recovers a known noiseless line y = 3 + 2x', () => {
    const X = [[0], [1], [2], [3], [4]];
    const y = [3, 5, 7, 9, 11];
    const m = fitRegression(X, y)!;
    expect(m.intercept).toBeCloseTo(3, 6);
    expect(m.coefficients[0]).toBeCloseTo(2, 6);
    expect(m.r2).toBeCloseTo(1, 9);
    expect(m.rmse).toBeCloseTo(0, 6);
  });

  it('predicts on a perfect fit with a near-zero interval', () => {
    const X = [[0], [1], [2], [3], [4]];
    const y = [3, 5, 7, 9, 11];
    const m = fitRegression(X, y)!;
    const pred = m.predict([10]);
    expect(pred.value).toBeCloseTo(23, 6);
    expect(pred.upper - pred.lower).toBeLessThan(1e-3);
  });
});

describe('fitRegression — multivariate', () => {
  it('recovers coefficients of y = 1 + 2·x1 − 3·x2', () => {
    const X = [
      [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 3], [7, 4],
    ];
    const y = X.map(([a, b]) => 1 + 2 * a - 3 * b);
    const m = fitRegression(X, y)!;
    expect(m.intercept).toBeCloseTo(1, 4);
    expect(m.coefficients[0]).toBeCloseTo(2, 4);
    expect(m.coefficients[1]).toBeCloseTo(-3, 4);
    expect(m.r2).toBeCloseTo(1, 6);
  });
});

describe('fitRegression — noisy data', () => {
  const X = [[1], [2], [3], [4], [5], [6], [7], [8]];
  // y ≈ 2x with small noise
  const y = [2.1, 3.9, 6.2, 7.8, 10.1, 12.2, 13.8, 16.1];

  it('fits a strong but imperfect trend', () => {
    const m = fitRegression(X, y)!;
    expect(m.coefficients[0]).toBeCloseTo(2, 1);
    expect(m.r2).toBeGreaterThan(0.99);
    expect(m.rmse).toBeGreaterThan(0);
    expect(m.residualStdError).toBeGreaterThan(0);
  });

  it('produces a prediction interval that contains the point estimate', () => {
    const m = fitRegression(X, y)!;
    const pred = m.predict([5], 0.90);
    expect(pred.lower).toBeLessThan(pred.value);
    expect(pred.upper).toBeGreaterThan(pred.value);
    expect(pred.confidence).toBe(0.90);
  });

  it('widens the interval away from the data centroid (leverage)', () => {
    const m = fitRegression(X, y)!;
    const centre = m.predict([4.5]);   // near mean of X
    const far = m.predict([20]);       // extrapolation
    const wCentre = centre.upper - centre.lower;
    const wFar = far.upper - far.lower;
    expect(wFar).toBeGreaterThan(wCentre);
  });

  it('a higher confidence level yields a wider interval', () => {
    const m = fitRegression(X, y)!;
    const w90 = (p => p.upper - p.lower)(m.predict([5], 0.90));
    const w99 = (p => p.upper - p.lower)(m.predict([5], 0.99));
    expect(w99).toBeGreaterThan(w90);
  });
});

describe('fitRegression — guards', () => {
  it('returns null without enough degrees of freedom', () => {
    expect(fitRegression([[1], [2]], [1, 2])).toBeNull(); // n=2, p=1 → n < p+2
  });

  it('returns null on mismatched lengths', () => {
    expect(fitRegression([[1], [2], [3]], [1, 2])).toBeNull();
  });

  it('handles collinear features via automatic ridge fallback', () => {
    // x2 = 2·x1 exactly → XᵀX singular in OLS.
    const X = [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10], [6, 12]];
    const y = [3, 5, 7, 9, 11, 13];
    const m = fitRegression(X, y)!;
    expect(m).not.toBeNull();
    expect(m.ridge).toBeGreaterThan(0);
    // The model should still track the target closely.
    expect(m.predict([7, 14]).value).toBeCloseTo(15, 0);
  });

  it('handles a constant feature column', () => {
    const X = [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]];
    const y = [2, 4, 6, 8, 10];
    const m = fitRegression(X, y)!;
    expect(m.coefficients[0]).toBeCloseTo(2, 4);
    expect(Number.isFinite(m.intercept)).toBe(true);
  });
});

describe('fitQuality', () => {
  it('classifies fit strength', () => {
    expect(fitQuality(0.9).level).toBe('strong');
    expect(fitQuality(0.5).level).toBe('moderate');
    expect(fitQuality(0.2).level).toBe('weak');
  });
});
