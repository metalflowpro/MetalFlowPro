import { describe, it, expect, vi } from 'vitest';
import {
  runMonteCarlo,
  runMonteCarloModel,
  fitNormal,
  fitLognormal,
  sample,
  quantile,
  normalCdf,
  regularizedIncompleteBeta,
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

  it('aligne les tirages de sensibilité sur les seules sorties valides', () => {
    const random = vi.spyOn(Math, 'random');
    for (const v of [0.01, 0.81, 0.41, 0.21, 0.61]) random.mockReturnValueOnce(v);
    try {
      const result = runMonteCarlo(
        [{ name: 'x', dist: { kind: 'empirical', samples: [1, 2, 3, 4, 5] } }],
        draws => draws.x === 5 ? Infinity : draws.x,
        5,
        4,
      );
      expect(result.values).toEqual([1, 3, 2, 4]);
      expect(result.sensitivity?.[0].correlation).toBeCloseTo(1, 12);
    } finally {
      random.mockRestore();
    }
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

describe('monteCarlo — PERT & quantiles', () => {
  it('samples PERT within [min, max] and concentrates near the mode', () => {
    const dist: Distribution = { kind: 'pert', min: 80, mode: 92, max: 96 };
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = sample(dist);
      expect(v).toBeGreaterThanOrEqual(80);
      expect(v).toBeLessThanOrEqual(96);
      sum += v;
    }
    const mean = sum / n;
    // PERT mean = (min + λ·mode + max)/(λ+2) = (80 + 4·92 + 96)/6 ≈ 90.7
    expect(mean).toBeGreaterThan(88);
    expect(mean).toBeLessThan(93);
  });

  it('quantile is the inverse CDF: median of a normal is its mean', () => {
    expect(quantile({ kind: 'normal', mean: 100, std: 15 }, 0.5)).toBeCloseTo(100, 6);
    expect(quantile({ kind: 'uniform', min: 10, max: 20 }, 0.5)).toBeCloseTo(15, 9);
  });

  it('regularizedIncompleteBeta is monotone and bracketed in [0,1]', () => {
    const a = regularizedIncompleteBeta(0.3, 2, 5);
    const b = regularizedIncompleteBeta(0.6, 2, 5);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('normalCdf matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe('runMonteCarloModel — correlated multi-output', () => {
  it('induces the requested rank correlation between inputs', () => {
    const inputs = [
      { name: 'x', dist: { kind: 'normal', mean: 0, std: 1 } as Distribution },
      { name: 'y', dist: { kind: 'normal', mean: 0, std: 1 } as Distribution },
    ];
    const res = runMonteCarloModel(
      inputs,
      [{ a: 'x', b: 'y', rho: 0.8 }],
      (d) => ({ sum: d.x + d.y, x: d.x }),
      ['sum', 'x'],
      8000,
    );
    expect(res.correlationsApplied).toBe(true);
    // Sensitivity of `sum` to x should be strongly positive under ρ=0.8.
    const sx = res.outputs.sum.sensitivity?.find(s => s.name === 'x');
    expect(sx?.correlation ?? 0).toBeGreaterThan(0.5);
  });

  it('falls back to independent sampling on a non-positive-definite matrix', () => {
    const inputs = [
      { name: 'x', dist: { kind: 'normal', mean: 0, std: 1 } as Distribution },
      { name: 'y', dist: { kind: 'normal', mean: 0, std: 1 } as Distribution },
      { name: 'z', dist: { kind: 'normal', mean: 0, std: 1 } as Distribution },
    ];
    // Mutually inconsistent correlations (x~y +0.9, x~z +0.9, y~z −0.9) — not PD.
    const res = runMonteCarloModel(
      inputs,
      [{ a: 'x', b: 'y', rho: 0.9 }, { a: 'x', b: 'z', rho: 0.9 }, { a: 'y', b: 'z', rho: -0.9 }],
      (d) => ({ s: d.x + d.y + d.z }),
      ['s'],
      500,
    );
    expect(res.correlationsApplied).toBe(false);
    expect(res.outputs.s.iterations).toBeGreaterThan(0);
  });
});
