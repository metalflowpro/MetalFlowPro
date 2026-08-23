import { describe, it, expect } from 'vitest';
import {
  extendedStats, quantileSorted, probBelow, probAtLeast, cdfPoints, cvBand, interpretOutput,
} from './monteCarloStats';
import type { MonteCarloResult } from './monteCarlo';
import type { MCOutputDef } from './monteCarloModel';

// Échantillon 1..100.
const RANGE = Array.from({ length: 100 }, (_, i) => i + 1);

describe('monteCarloStats — quantiles & moments', () => {
  it('quantileSorted interpolates', () => {
    const s = [0, 10, 20, 30, 40];
    expect(quantileSorted(s, 50)).toBeCloseTo(20, 9);
    expect(quantileSorted(s, 0)).toBe(0);
    expect(quantileSorted(s, 100)).toBe(40);
  });

  it('extendedStats returns ordered percentiles and a sane mean', () => {
    const s = extendedStats(RANGE);
    expect(s.n).toBe(100);
    expect(s.mean).toBeCloseTo(50.5, 6);
    expect(s.p10).toBeLessThan(s.p50);
    expect(s.p50).toBeLessThan(s.p90);
    expect(s.iqr).toBeCloseTo(s.p75 - s.p25, 9);
    expect(Math.abs(s.skewness)).toBeLessThan(0.1); // symétrique
  });

  it('detects positive skew on a right-tailed sample', () => {
    const skewed = [1, 1, 1, 1, 1, 2, 2, 3, 10, 40];
    expect(extendedStats(skewed).skewness).toBeGreaterThan(0.5);
  });
});

describe('monteCarloStats — probabilities & cdf', () => {
  it('probBelow / probAtLeast are complementary', () => {
    expect(probBelow(RANGE, 50)).toBeCloseTo(0.49, 6);
    expect(probAtLeast(RANGE, 50)).toBeCloseTo(0.51, 6);
  });

  it('cdfPoints are monotone in p and end at 1', () => {
    const pts = cdfPoints(RANGE, 20);
    for (let i = 1; i < pts.length; i++) expect(pts[i].p).toBeGreaterThanOrEqual(pts[i - 1].p);
    expect(pts[pts.length - 1].p).toBeCloseTo(1, 9);
  });

  it('cvBand thresholds', () => {
    expect(cvBand(0.05).label).toBe('faible');
    expect(cvBand(0.15).label).toBe('modérée');
    expect(cvBand(0.35).label).toBe('élevée');
    expect(cvBand(0.8).label).toBe('très élevée');
  });
});

describe('monteCarloStats — interpretation', () => {
  const mkResult = (values: number[]): MonteCarloResult => {
    const s = extendedStats(values);
    return { iterations: values.length, mean: s.mean, std: s.std, cv: s.cv, p5: s.p5, p10: s.p10, p50: s.p50, p90: s.p90, p95: s.p95, min: s.min, max: s.max, histogram: [], binEdges: [], values };
  };
  const marginDef: MCOutputDef = { key: 'margin_year', label: 'Marge annuelle', unit: '$/an', direction: 'maximize', currency: true };
  const opexDef: MCOutputDef = { key: 'opex_year', label: 'OPEX annuel', unit: '$/an', direction: 'minimize', currency: true };
  const fmt = (v: number) => v.toFixed(0);

  it('flags loss probability for a margin that can be negative', () => {
    const values = Array.from({ length: 100 }, (_, i) => i - 30); // 30% négatifs
    const r = mkResult(values);
    const interp = interpretOutput(marginDef, r, extendedStats(values), { fmt });
    const risk = interp.find(i => i.text.includes('négatif'));
    expect(risk).toBeDefined();
    expect(risk?.tone).toBe('bad');
  });

  it('speaks of upside risk for a minimised output', () => {
    const values = RANGE;
    const r = mkResult(values);
    const interp = interpretOutput(opexDef, r, extendedStats(values), { fmt });
    expect(interp.some(i => i.text.includes('haussier'))).toBe(true);
  });

  it('reports probability of reaching a target and names the top driver', () => {
    const values = RANGE.map(v => v * 1000);
    const r = mkResult(values);
    const interp = interpretOutput(marginDef, r, extendedStats(values), {
      fmt,
      target: 60000,
      topDriver: { label: 'Prix de l\'or ($/oz)', correlation: 0.72 },
    });
    expect(interp.some(i => i.text.includes('Probabilité'))).toBe(true);
    expect(interp.some(i => i.text.includes('Prix de l\'or'))).toBe(true);
  });
});
