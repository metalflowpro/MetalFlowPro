import { describe, it, expect } from 'vitest';
import {
  optimizeBlend, blendMetrics, blendRecovery,
  DEFAULT_BLEND_OPT_PARAMS, type BlendDomain, type BlendOptParams,
} from './blendOptimization';

const params: BlendOptParams = {
  targetTph: 500,
  operatingHours: 8000,
  gradeGt: 1.5,
  troyGrams: 31.1035,
  ...DEFAULT_BLEND_OPT_PARAMS,
};

describe('blendOptimization', () => {
  it('sans preg-robbing : concentre sur le meilleur ratio récupération / dureté', () => {
    const domains: BlendDomain[] = [
      { id: 'a', recoveryPct: 90, bwiKwhT: 15, pregRobbing: false },
      { id: 'b', recoveryPct: 70, bwiKwhT: 15, pregRobbing: false },
    ];
    const res = optimizeBlend(domains, params)!;
    // Même dureté, récup supérieure → 100 % du domaine A.
    expect(res.shares['a']).toBeGreaterThan(0.99);
    expect(res.shares['b']).toBeLessThan(0.01);
  });

  it('dilue un domaine préempteur pour rester sous le seuil preg (écart de récup modéré)', () => {
    // A : récup un peu supérieure mais preg-robbing ; B : récup légèrement moindre, propre.
    // 100 % A → 85 − 8 = 77 ; 100 % B → 82 ; un filet de A sous le seuil preg bat les deux
    // (0,15·85 + 0,85·82 = 82,45, sans pénalité). L'optimum est donc un vrai mélange.
    const domains: BlendDomain[] = [
      { id: 'a', recoveryPct: 85, bwiKwhT: 15, pregRobbing: true },
      { id: 'b', recoveryPct: 82, bwiKwhT: 15, pregRobbing: false },
    ];
    const res = optimizeBlend(domains, params)!;
    expect(res.shares['a']).toBeGreaterThan(0.01);
    expect(res.shares['a']).toBeLessThan(0.99);
    // La part preg (= part de A) reste bornée près de la tolérance.
    expect(res.pregShareFrac).toBeLessThanOrEqual(DEFAULT_BLEND_OPT_PARAMS.pregToleranceFrac + 0.06);
  });

  it('l\'optimum n\'est jamais pire que le meilleur domaine seul (multi-départ)', () => {
    const domains: BlendDomain[] = [
      { id: 'a', recoveryPct: 88, bwiKwhT: 18, pregRobbing: true },
      { id: 'b', recoveryPct: 82, bwiKwhT: 14, pregRobbing: false },
      { id: 'c', recoveryPct: 75, bwiKwhT: 12, pregRobbing: false },
    ];
    const res = optimizeBlend(domains, params)!;
    const vertices = domains.map(d =>
      blendMetrics({ [d.id]: 1 }, domains, params).annualOz,
    );
    expect(res.annualOz).toBeGreaterThanOrEqual(Math.max(...vertices) - 1e-6);
  });

  it('les parts somment à 1', () => {
    const domains: BlendDomain[] = [
      { id: 'a', recoveryPct: 90, bwiKwhT: 16, pregRobbing: true },
      { id: 'b', recoveryPct: 78, bwiKwhT: 13, pregRobbing: false },
      { id: 'c', recoveryPct: 84, bwiKwhT: 20, pregRobbing: false },
    ];
    const res = optimizeBlend(domains, params)!;
    const total = Object.values(res.shares).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('un seul domaine → 100 %', () => {
    const res = optimizeBlend([{ id: 'x', recoveryPct: 85, bwiKwhT: 15, pregRobbing: false }], params)!;
    expect(res.shares['x']).toBe(1);
  });

  it('aucun domaine → null', () => {
    expect(optimizeBlend([], params)).toBeNull();
  });

  it('blendRecovery : pénalité nulle sous la tolérance, croissante au-dessus', () => {
    const domains: BlendDomain[] = [
      { id: 'a', recoveryPct: 90, bwiKwhT: 15, pregRobbing: true },
      { id: 'b', recoveryPct: 90, bwiKwhT: 15, pregRobbing: false },
    ];
    // Part preg 10 % < tolérance 15 % → pas de pénalité, récup = 90.
    expect(blendRecovery({ a: 0.10, b: 0.90 }, domains, params)).toBeCloseTo(90, 6);
    // Part preg 100 % → pénalité maximale = pregPenaltyPts.
    expect(blendRecovery({ a: 1, b: 0 }, domains, params)).toBeCloseTo(90 - params.pregPenaltyPts, 6);
  });
});
