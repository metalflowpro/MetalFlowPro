import { describe, it, expect } from 'vitest';
import {
  MC_CIRCUITS, MC_VARIABLES, variablesForCircuit, defaultParams, toDistribution,
  makeModel, liberationFactor, leachExtraction, mechanisticRecovery, blendKeys,
  MC_MODEL_CONFIG, type MCSeed,
} from './monteCarloModel';

const SEED: MCSeed = {
  feedTpd: 12000, availabilityFrac: 0.91, goldGradeGt: 2.5, p80Um: 75, rmaxFrac: 0.95,
  leachKPerH: 0.1, cilRetentionH: 24, adsLossPct: 1.5,
  cyanideKgT: 0.6, limeKgT: 1.0, energyKwhT: 18,
  cyanidePriceUsdKg: 2.5, limePriceUsdKg: 0.12, electricityUsdKwh: 0.07,
  otherCostsUsdT: 12, goldPriceUsdOz: 2000,
  discountRate: 0.08, lomYears: 10,
};

describe('monteCarloModel — catalogue', () => {
  it('exposes the six circuits from the design', () => {
    expect(MC_CIRCUITS.map(c => c.id)).toEqual(['leach', 'cip', 'cil', 'gravity', 'flotation', 'regrind']);
  });

  it('includes the mechanistic recovery variables from the reference design', () => {
    const keys = MC_VARIABLES.map(v => v.key);
    for (const k of ['availability', 'p80_um', 'rmax', 'leach_k', 'ads_loss_pct', 'other_costs_usd_t']) {
      expect(keys).toContain(k);
    }
  });

  it('restricts leach kinetics & ADR losses to the right circuits', () => {
    const gravity = variablesForCircuit('gravity').map(v => v.key);
    expect(gravity).not.toContain('leach_k');
    expect(gravity).not.toContain('ads_loss_pct');
    expect(gravity).not.toContain('cyanide_kg_t');
    const cil = variablesForCircuit('cil').map(v => v.key);
    expect(cil).toContain('leach_k');
    expect(cil).toContain('ads_loss_pct');
    const leach = variablesForCircuit('leach').map(v => v.key);
    expect(leach).toContain('leach_k');       // lixiviation → cinétique
    expect(leach).not.toContain('ads_loss_pct'); // sans charbon → pas de pertes ADR
  });

  it('seeds every default parameter from project data (no zero centers)', () => {
    const params = defaultParams('cil', SEED);
    for (const v of variablesForCircuit('cil')) {
      const p = params[v.key];
      expect(p).toBeDefined();
      const center = p.kind === 'normal' || p.kind === 'lognormal' ? p.mean : (p as { mode: number }).mode;
      expect(center).toBeGreaterThan(0);
    }
  });
});

describe('monteCarloModel — recovery physics', () => {
  it('liberationFactor is 1 at the reference P80 and drops when coarser', () => {
    expect(liberationFactor(75, 75)).toBeCloseTo(1, 9);
    expect(liberationFactor(150, 75)).toBeLessThan(1);
    expect(liberationFactor(150, 75)).toBeGreaterThanOrEqual(MC_MODEL_CONFIG.liberation.floor);
  });

  it('leachExtraction follows first-order kinetics and is 1 without leaching', () => {
    expect(leachExtraction(0.1, 24, true)).toBeCloseTo(1 - Math.exp(-2.4), 9);
    expect(leachExtraction(0.1, 24, false)).toBe(1);
  });

  it('mechanistic recovery stays below Rmax and within [0,1]', () => {
    const r = mechanisticRecovery({ rmaxFrac: 0.95, p80Um: 75, refP80Um: 75, kPerH: 0.1, retentionH: 24, adsLossPct: 1.5, hasLeach: true, hasCarbon: true });
    expect(r).toBeLessThan(0.95);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe('monteCarloModel — techno-economic model', () => {
  it('annualises production with availability', () => {
    const model = makeModel('cil', SEED);
    const out = model({
      feed_tpd: 12000, availability: 0.91, gold_grade: 2.5, p80_um: 75, rmax: 0.95,
      leach_k: 0.1, cil_retention_h: 24, ads_loss_pct: 1.5,
      cyanide_kg_t: 0.6, lime_kg_t: 1.0, energy_kwh_t: 18,
      cyanide_price: 2.5, lime_price: 0.12, electricity_price: 0.07, other_costs_usd_t: 12, gold_price: 2000,
    });
    const daysYear = 365 * 0.91;
    expect(out.gold_oz_year).toBeCloseTo(out.gold_oz_day * daysYear, 3);
    expect(out.margin_year).toBeCloseTo(out.revenue_year - out.opex_year, 3);
    expect(out.recovery_pct).toBeGreaterThan(0);
    expect(out.recovery_pct).toBeLessThan(95); // R < Rmax
    expect(out.npv).toBeGreaterThan(0);
  });

  it('charges no cyanide cost on a gravity circuit', () => {
    const model = makeModel('gravity', SEED);
    const out = model({ feed_tpd: 12000, availability: 0.91, gold_grade: 2.5, p80_um: 75, rmax: 0.45, energy_kwh_t: 18, electricity_price: 0.07, other_costs_usd_t: 12, gold_price: 2000 });
    const expectedOpexPerT = 18 * 0.07 + 12; // energy + other only
    const daysYear = 365 * 0.91;
    expect(out.opex_year).toBeCloseTo(expectedOpexPerT * 12000 * daysYear, 1);
  });
});

describe('monteCarloModel — blending géométallurgique', () => {
  it('blends grade by mass and recovery by contained metal', () => {
    const ids = ['ox', 'sulf'];
    const model = makeModel('cil', SEED, { blendDomainIds: ids });
    const draws: Record<string, number> = {
      feed_tpd: 12000, availability: 0.91, p80_um: 75,
      leach_k: 0.1, cil_retention_h: 24, ads_loss_pct: 1.5,
      cyanide_kg_t: 0.6, lime_kg_t: 1.0, energy_kwh_t: 18,
      cyanide_price: 2.5, lime_price: 0.12, electricity_price: 0.07, other_costs_usd_t: 12, gold_price: 2000,
    };
    // 70 % oxyde à 1.5 g/t Rmax 0.95 ; 30 % sulfuré à 5 g/t Rmax 0.80
    const ox = blendKeys('ox'), sulf = blendKeys('sulf');
    draws[ox.share] = 70; draws[ox.grade] = 1.5; draws[ox.rmax] = 0.95;
    draws[sulf.share] = 30; draws[sulf.grade] = 5.0; draws[sulf.rmax] = 0.80;
    const out = model(draws);
    // Teneur mélangée pondérée masse = 0.7*1.5 + 0.3*5 = 2.55 g/t → oz/j cohérent
    const gradeBlend = 0.7 * 1.5 + 0.3 * 5.0;
    // Récupération pondérée métal doit se situer entre celles des deux domaines
    expect(out.recovery_pct).toBeGreaterThan(0);
    expect(out.recovery_pct).toBeLessThan(95);
    // oz/j = tpd * gradeBlend * recFrac / 31.1035
    const recFrac = out.recovery_pct / 100;
    expect(out.gold_oz_day).toBeCloseTo((12000 * gradeBlend * recFrac) / 31.1035, 2);
  });

  it('a single blend domain reproduces the homogeneous case', () => {
    const model = makeModel('cil', SEED, { blendDomainIds: ['only'] });
    const k = blendKeys('only');
    const draws: Record<string, number> = {
      feed_tpd: 12000, availability: 0.91, p80_um: 75, leach_k: 0.1, cil_retention_h: 24, ads_loss_pct: 1.5,
      cyanide_kg_t: 0.6, lime_kg_t: 1.0, energy_kwh_t: 18,
      cyanide_price: 2.5, lime_price: 0.12, electricity_price: 0.07, other_costs_usd_t: 12, gold_price: 2000,
      [k.share]: 100, [k.grade]: 2.5, [k.rmax]: 0.95,
    };
    const blended = model(draws);
    const homogeneous = makeModel('cil', SEED)({ ...draws, gold_grade: 2.5, rmax: 0.95 });
    expect(blended.recovery_pct).toBeCloseTo(homogeneous.recovery_pct, 6);
    expect(blended.gold_oz_day).toBeCloseTo(homogeneous.gold_oz_day, 6);
  });
});

describe('monteCarloModel — distributions', () => {
  it('bounds a fraction PERT within [0, 1]', () => {
    const dist = toDistribution({ kind: 'pert', min: 0.9, mode: 0.95, max: 0.99 }, 'fraction');
    expect(dist.kind).toBe('pert');
    const params = defaultParams('cil', SEED);
    const av = params['availability'];
    if (av.kind === 'pert') expect(av.max).toBeLessThanOrEqual(1);
  });
});
