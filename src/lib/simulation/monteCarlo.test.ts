import { describe, it, expect } from 'vitest';
import {
  runMonteCarlo,
  fitNormal,
  fitLognormal,
  sample,
  type Distribution,
} from './monteCarlo';

describe('monteCarlo', () => {
  it('samples normal distribution within range', () => {
    const dist: Distribution = { kind: 'normal', mean: 100, std: 10, min: 50, max: 150 };
    for (let i = 0; i < 1000; i++) {
      const v = sample(dist);
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThanOrEqual(150);
    }
  });

  it('samples triangular within [min, max]', () => {
    const dist: Distribution = { kind: 'triangular', min: 0, mode: 50, max: 100 };
    for (let i = 0; i < 1000; i++) {
      const v = sample(dist);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('samples uniform within range', () => {
    const dist: Distribution = { kind: 'uniform', min: 10, max: 20 };
    for (let i = 0; i < 1000; i++) {
      const v = sample(dist);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('samples empirical from provided data', () => {
    const dist: Distribution = { kind: 'empirical', samples: [1, 2, 3, 4, 5] };
    for (let i = 0; i < 100; i++) {
      const v = sample(dist);
      expect([1, 2, 3, 4, 5]).toContain(v);
    }
  });

  it('fitNormal produces correct mean', () => {
    const dist = fitNormal([10, 20, 30]);
    expect(dist.kind).toBe('normal');
    if (dist.kind === 'normal') {
      expect(dist.mean).toBeCloseTo(20, 1);
    }
  });

  it('fitLognormal handles positive values', () => {
    const dist = fitLognormal([1, 2, 4, 8]);
    expect(dist.kind).toBe('lognormal');
    if (dist.kind === 'lognormal') {
      expect(Number.isFinite(dist.meanLog)).toBe(true);
    }
  });

  it('runMonteCarlo produces sensible statistics', () => {
    const result = runMonteCarlo(
      [{ name: 'x', dist: { kind: 'normal', mean: 100, std: 10 } }],
      (draws) => draws.x * 2,
      1000,
      10,
    );
    expect(result.iterations).toBe(1000);
    expect(result.mean).toBeCloseTo(200, -1);
    expect(result.std).toBeCloseTo(20, -1);
    expect(result.p10).toBeLessThan(result.p50);
    expect(result.p50).toBeLessThan(result.p90);
    expect(result.histogram.length).toBe(10);
    expect(result.binEdges.length).toBe(11);
  });

  it('runMonteCarlo computes sensitivity correlations', () => {
    const result = runMonteCarlo(
      [
        { name: 'a', dist: { kind: 'normal', mean: 100, std: 20 } },
        { name: 'b', dist: { kind: 'normal', mean: 50, std: 5 } },
      ],
      (draws) => draws.a * 10 + draws.b,
      2000,
      20,
    );
    expect(result.sensitivity).toBeDefined();
    expect(result.sensitivity!.length).toBe(2);
    // 'a' has much larger variance contribution, so it should rank first
    expect(Math.abs(result.sensitivity![0].correlation)).toBeGreaterThan(
      Math.abs(result.sensitivity![1].correlation),
    );
  });

  it('runMonteCarlo handles empty inputs gracefully', () => {
    const result = runMonteCarlo([], () => 42, 100, 5);
    expect(result.iterations).toBe(100);
    expect(result.mean).toBe(42);
  });

  it('runMonteCarlo filters non-finite outputs', () => {
    const result = runMonteCarlo(
      [{ name: 'x', dist: { kind: 'normal', mean: 0, std: 1 } }],
      (draws) => draws.x > 0.5 ? Infinity : draws.x,
      1000,
      10,
    );
    expect(result.iterations).toBeLessThan(1000);
    expect(result.values.every(Number.isFinite)).toBe(true);
  });

  it('cv is std/abs(mean)', () => {
    const result = runMonteCarlo(
      [{ name: 'x', dist: { kind: 'normal', mean: 50, std: 10 } }],
      (draws) => draws.x,
      5000,
      20,
    );
    expect(result.cv).toBeCloseTo(0.2, 1);
  });
});
