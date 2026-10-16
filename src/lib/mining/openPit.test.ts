import { describe, it, expect } from 'vitest';
import { computeOpenPitCost, explosiveBlend, type OpenPitInputs } from './openPit';
import { defaultMiningModel, openPitPeriods, type MiningSourceData } from './projectInputs';

describe('explosiveBlend — Magino Blast', () => {
  it('retrouve la densité et le coût de l’ANFO de la feuille (0,8494 ; 0,7095 US$/kg)', () => {
    const b = explosiveBlend({
      emulsionWeightFraction: 0, emulsionSg: 1.15, emulsionUsdKg: 0.629,
      prillSg: 0.85, prillUsdKg: 0.32 * 2.2046, anfoFuelWeightFraction: 0.06, fuelOilSg: 0.84,
      dieselUsdL: 2.4567 / 3.7854,
    });
    expect(b.anfoSg).toBeCloseTo(0.8494, 4);
    expect(b.anfoUsdKg).toBeCloseTo(0.7095, 4);
    expect(b.sg).toBeCloseTo(0.8494, 4);
  });
  it('100 % émulsion → densité et prix de l’émulsion', () => {
    const b = explosiveBlend({
      emulsionWeightFraction: 1, emulsionSg: 1.15, emulsionUsdKg: 0.629,
      prillSg: 0.85, prillUsdKg: 0.7, anfoFuelWeightFraction: 0.06, fuelOilSg: 0.84, dieselUsdL: 0.65,
    });
    expect(b.sg).toBeCloseTo(1.15, 9);
    expect(b.usdKg).toBeCloseTo(0.629, 9);
  });
});

// Projet type Magino : ~3,4 Mt/an de minerai, ratio de découverture ~2,3.
const src: MiningSourceData = {
  project: { target_tph: 420, availability_pct: 92, ore_sg: 2.75, gold_grade_g_t: 1.1 },
  assumptions: { hoursPerYear: 8760, lomYears: 10, contingencyFraction: 0.15 },
  settings: null,
  mineParams: { method: 'Open pit', stripping_ratio: 2.3, bench_height_m: 10, reserves_mt: 40, lom_years: null, ramp_up_y1_pct: 80, ramp_up_y2_pct: 92 },
  phases: [],
};

function opInputs(over: Partial<OpenPitInputs> = {}): OpenPitInputs {
  const { model } = defaultMiningModel(src);
  return { ...model.openPit, periods: openPitPeriods(model, []), ...over };
}

describe('computeOpenPitCost', () => {
  it('donne un coût par tonne déplacée du même ordre que Magino (2,2–2,8 US$/t en régime)', () => {
    const r = computeOpenPitCost(opInputs());
    expect(r.totals.opexUsdPerTotalTonne).toBeGreaterThan(1.5);
    expect(r.totals.opexUsdPerTotalTonne).toBeLessThan(4.5);
    expect(r.warnings).toEqual([]);
  });

  it('capitalise la pré-découverture : OPEX nul en pré-production, reporté en CAPEX', () => {
    const r = computeOpenPitCost(opInputs());
    const pp = r.periods.find(p => p.preProduction)!.index;
    expect(r.opex.every(o => o.byPeriod[pp] === 0)).toBe(true);
    const prestrip = r.capex.find(c => c.key === 'prestrip')!;
    expect(prestrip.initialUsd).toBeGreaterThan(0);
    expect(prestrip.sustainingUsd).toBe(0);
  });

  it('achète en pré-production la flotte de la 1re année de production', () => {
    const r = computeOpenPitCost(opInputs());
    const pp = r.periods.findIndex(p => p.preProduction);
    const y1 = r.periods.findIndex(p => !p.preProduction);
    for (const f of r.fleet) expect(f.purchases[pp]).toBeGreaterThanOrEqual(f.units[y1]);
  });

  it('une distance de roulage plus longue demande plus de camions et coûte plus cher', () => {
    const near = computeOpenPitCost(opInputs({ haulDistanceKm: 2 }));
    const far = computeOpenPitCost(opInputs({ haulDistanceKm: 5 }));
    const trucks = (r: typeof near) => Math.max(...r.fleet.find(f => f.role === 'truck')!.units);
    expect(trucks(far)).toBeGreaterThan(trucks(near));
    expect(far.totals.productionOpexUsd).toBeGreaterThan(near.totals.productionOpexUsd);
  });

  it('le facteur de charge découle de la géométrie du tir (B = 30 D, émulsion 1,15)', () => {
    const r = computeOpenPitCost(opInputs());
    expect(r.derived.burdenM).toBeCloseTo(30 * 0.165, 9);
    expect(r.derived.powderFactorKgT).toBeGreaterThan(0.1);
    expect(r.derived.powderFactorKgT).toBeLessThan(0.6);
  });

  it('applique la contingence au seul capital initial', () => {
    const r = computeOpenPitCost(opInputs({ contingencyPct: 10 }));
    const cont = r.capex.find(c => c.key === 'contingency')!;
    const initialBase = r.capex.filter(c => c.key !== 'contingency').reduce((s, c) => s + c.initialUsd, 0);
    expect(cont.initialUsd).toBeCloseTo(initialBase * 0.1, 0);
    expect(cont.sustainingUsd).toBe(0);
  });
});
