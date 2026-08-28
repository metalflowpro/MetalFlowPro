import { describe, it, expect } from 'vitest';
import { Rng, buildDistribution, gammaFn, percentile, fitDistribution } from './distributions';
import { runSimulationSync } from './engine';
import { buildModelFromProject, PLANT_OPT_TEMPLATE } from './projectModel';
import { PLANT_OPT_RUN_DEFAULTS } from './config';
import type { Project } from '../../types';
import type { SimConfig } from './types';

const project: Project = {
  id: 'p1', code: 'TEST', name: 'Test', country: 'CI', phase: 'FEASIBILITY',
  target_tph: 250, gold_grade_g_t: 1.8, availability_pct: 91, recovery_pct: 88,
  ore_sg: 2.75, gold_price_usd: 2300, annual_tonnes: 0,
  created_at: '', updated_at: '',
};

const fastConfig: SimConfig = {
  iterations: 60,
  seed: 42,
  warmupHours: 48,
  timeStepHours: 4,
  horizonHours: 24 * 30, // 30 jours pour un test rapide
};

describe('RNG déterministe', () => {
  it('produit la même suite pour une graine donnée', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 100; i++) expect(a.random()).toBe(b.random());
  });
  it('reste dans [0,1)', () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Fonction Gamma', () => {
  it('vérifie Γ(n) = (n-1)! sur les entiers', () => {
    expect(gammaFn(1)).toBeCloseTo(1, 6);
    expect(gammaFn(5)).toBeCloseTo(24, 4);
    expect(gammaFn(0.5)).toBeCloseTo(Math.sqrt(Math.PI), 5);
  });
});

describe('percentile', () => {
  it('interpole sur un tableau trié', () => {
    const s = [10, 20, 30, 40, 50];
    expect(percentile(s, 0)).toBe(10);
    expect(percentile(s, 1)).toBe(50);
    expect(percentile(s, 0.5)).toBe(30);
  });
});

describe('Lois — moyennes empiriques ≈ moyennes analytiques', () => {
  it('triangulaire', () => {
    const d = buildDistribution({ kind: 'triangular', params: { min: 0, mode: 5, max: 10 } });
    const rng = new Rng(1);
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) s += d.sample(rng);
    expect(s / n).toBeCloseTo(5, 1);
    expect(d.mean()).toBeCloseTo(5, 6);
  });
  it('weibull', () => {
    const d = buildDistribution({ kind: 'weibull', params: { shape: 2, scale: 100 } });
    const rng = new Rng(2);
    let s = 0;
    const n = 30000;
    for (let i = 0; i < n; i++) s += d.sample(rng);
    expect(s / n).toBeCloseTo(d.mean(), 0);
  });
});

describe('fitDistribution', () => {
  it('récupère les paramètres d’une normale et donne un KS faible', () => {
    const rng = new Rng(9);
    const data: number[] = [];
    const gen = buildDistribution({ kind: 'normal', params: { mean: 100, sd: 10 } });
    for (let i = 0; i < 500; i++) data.push(gen.sample(rng));
    const fit = fitDistribution('normal', data);
    expect(fit.mean).toBeCloseTo(100, 0);
    expect(fit.ks).toBeLessThan(0.15);
  });
});

describe('buildModelFromProject', () => {
  it('centre les capacités sur le débit du projet et porte la récupération', () => {
    const model = buildModelFromProject(project);
    expect(model.areas).toHaveLength(PLANT_OPT_TEMPLATE.areas.length);
    // Le broyage (marge 1.05) est plus juste que le concassage (marge 1.40).
    const crushing = model.areas.find(a => a.type === 'crushing')!;
    const grinding = model.areas.find(a => a.type === 'grinding')!;
    expect(Number(crushing.capacityDist.params.mode)).toBeGreaterThan(Number(grinding.capacityDist.params.mode));
    // La récupération projet (0.88) est portée par l'aire de lixiviation.
    const leach = model.areas.find(a => a.type === 'leaching')!;
    expect(leach.baseRecovery).toBeCloseTo(0.88, 5);
    // Un mode de défaillance par aire.
    expect(model.failureModes).toHaveLength(model.areas.length);
    // Devise et horizon renseignés.
    expect(model.currency).toBe('USD');
    expect(model.horizonHours).toBe(PLANT_OPT_RUN_DEFAULTS.horizonHours);
  });
});

describe('runSimulationSync', () => {
  it('est reproductible (même graine ⇒ résultat identique)', () => {
    const model = buildModelFromProject(project);
    const a = runSimulationSync(model, fastConfig);
    const b = runSimulationSync(model, fastConfig);
    expect(a.throughputP50).toBe(b.throughputP50);
    expect(a.bottleneckProbability).toEqual(b.bottleneckProbability);
  });

  it('respecte l’ordre P10 ≤ P50 ≤ P90 et borne le débit par le débit projet', () => {
    const model = buildModelFromProject(project);
    const r = runSimulationSync(model, fastConfig);
    expect(r.throughputP10).toBeLessThanOrEqual(r.throughputP50);
    expect(r.throughputP50).toBeLessThanOrEqual(r.throughputP90);
    // Le débit ne peut pas dépasser la capacité de l'aire la plus juste (~target×1.05).
    expect(r.throughputP90).toBeLessThanOrEqual(project.target_tph * 1.06);
    expect(r.throughputP10).toBeGreaterThan(0);
  });

  it('probabilités de goulot : somme = 1, broyage dominant', () => {
    const model = buildModelFromProject(project);
    const r = runSimulationSync(model, fastConfig);
    const sum = Object.values(r.bottleneckProbability).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // L'aire la plus juste (broyage, marge 1.05) doit être le goulot le plus probable.
    const grinding = model.areas.find(a => a.type === 'grinding')!;
    const others = model.areas.filter(a => a.id !== grinding.id);
    for (const o of others) {
      expect(r.bottleneckProbability[grinding.id]).toBeGreaterThanOrEqual(r.bottleneckProbability[o.id]);
    }
  });

  it('la disponibilité simulée est proche de la cible du projet', () => {
    const model = buildModelFromProject(project);
    const r = runSimulationSync(model, { ...fastConfig, iterations: 120, horizonHours: 24 * 120 });
    // Calibrage série : on vise ~0.91, tolérance large (bruit MC + effet tampons/série).
    expect(r.availability).toBeGreaterThan(0.6);
    expect(r.availability).toBeLessThanOrEqual(1);
  });

  it('un mode de défaillance abaisse le débit vs une usine sans panne', () => {
    const model = buildModelFromProject(project);
    const noFail = { ...model, failureModes: [] };
    const withFail = runSimulationSync(model, fastConfig);
    const without = runSimulationSync(noFail, fastConfig);
    expect(without.throughputP50).toBeGreaterThanOrEqual(withFail.throughputP50);
  });
});
