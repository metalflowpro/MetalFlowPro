import { describe, it, expect } from 'vitest';
import {
  applyOverrides, computeMiningCost, defaultMiningModel, effectiveProvenance, methodFromMineParams,
  openPitPeriods, productionOre, undergroundPeriods, type MiningSourceData,
} from './projectInputs';
import { miningCapexLines, miningOpexLines, mergedSustaining, MINING_AUTO_NOTE } from './economicLines';

const base: MiningSourceData = {
  project: { target_tph: 250, availability_pct: 92, ore_sg: 2.8, gold_grade_g_t: 1.5 },
  assumptions: { hoursPerYear: 8760, lomYears: 10, contingencyFraction: 0.15 },
  settings: null,
  mineParams: null,
  phases: [],
};

describe('defaultMiningModel — lit le projet, pas de valeur figée', () => {
  it('débit annuel = t/h × disponibilité × heures/an du projet', () => {
    const { model, provenance } = defaultMiningModel(base);
    expect(model.schedule.annualOreTonnes).toBeCloseTo(250 * 0.92 * 8760, 6);
    expect(provenance['schedule.annualOreTonnes'].origin).toBe('projet');
  });

  it('reprend densité, hauteur de banc, ratio de découverture et réserves de Mine & Optimisation', () => {
    const { model, provenance } = defaultMiningModel({
      ...base,
      mineParams: { method: 'Open pit', stripping_ratio: '3.5', bench_height_m: '12', reserves_mt: '20', lom_years: null },
    });
    expect(model.openPit.oreSgTpm3).toBe(2.8);
    expect(model.openPit.benchHeightM).toBe(12);
    expect(model.schedule.strippingRatio).toBe(3.5);
    expect(model.schedule.reservesTonnes).toBe(20e6);
    expect(provenance['openPit.benchHeightM'].origin).toBe('mine');
    // 20 Mt / 2,0148 Mt/an → 10 ans.
    expect(model.schedule.lomYears).toBe(Math.ceil(20e6 / (250 * 0.92 * 8760)));
  });

  it('la contingence vient des Paramètres du projet', () => {
    const { model, provenance } = defaultMiningModel({ ...base, assumptions: { ...base.assumptions, contingencyFraction: 0.22 }, settings: { contingency_pct: 22 } });
    expect(model.openPit.contingencyPct).toBeCloseTo(22, 9);
    expect(model.underground.contingencyPct).toBeCloseTo(22, 9);
    expect(provenance['openPit.contingencyPct'].origin).toBe('settings');
  });

  it('la densité de roche des galeries suit la densité du minerai du projet', () => {
    const { model } = defaultMiningModel({ ...base, project: { ...base.project, ore_sg: 3.1 } });
    expect(model.underground.capitalHeading.rockSgTpm3).toBe(3.1);
  });
});

describe('methodFromMineParams', () => {
  it('reconnaît les libellés usuels', () => {
    expect(methodFromMineParams('Open pit')).toBe('open_pit');
    expect(methodFromMineParams('Ciel ouvert')).toBe('open_pit');
    expect(methodFromMineParams('Souterrain')).toBe('underground');
    expect(methodFromMineParams('Underground — sublevel stoping')).toBe('underground');
    expect(methodFromMineParams('')).toBeNull();
  });
});

describe('calendrier', () => {
  it('montée en cadence puis plafond des réserves', () => {
    const { model } = defaultMiningModel(base);
    const ore = productionOre({ ...model.schedule, annualOreTonnes: 1e6, lomYears: 5, rampUpY1Pct: 50, rampUpY2Pct: 80, reservesTonnes: 3.6e6 });
    expect(ore).toEqual([0.5e6, 0.8e6, 1e6, 1e6, 0.3e6]);
  });

  it('ciel ouvert : années de pré-production en tête avec la pré-découverture', () => {
    const { model } = defaultMiningModel({ ...base, mineParams: { stripping_ratio: 4 } });
    const p = openPitPeriods({ ...model, schedule: { ...model.schedule, preProductionYearsOpenPit: 1 } }, []);
    expect(p[0]).toMatchObject({ year: 0, preProduction: true, oreTonnes: 0 });
    expect(p[0].wasteTonnes).toBeCloseTo(p[1].oreTonnes * 4, 6);
    expect(p[1].wasteTonnes).toBeCloseTo(p[1].oreTonnes * 4, 6);
  });

  it('les phases de Mine & Optimisation imposent le ratio de découverture annuel', () => {
    const { model } = defaultMiningModel({ ...base, mineParams: { stripping_ratio: 4 } });
    const phases = [{ year_start: 1, year_end: 2, ore_mt: 4, waste_mt: 4 }];
    const p = openPitPeriods({ ...model, schedule: { ...model.schedule, useMinePhases: true } }, phases);
    const y1 = p.find(x => x.year === 1)!;
    const y3 = p.find(x => x.year === 3)!;
    expect(y1.wasteTonnes / y1.oreTonnes).toBeCloseTo(1, 9);
    expect(y3.wasteTonnes / y3.oreTonnes).toBeCloseTo(4, 9);
  });

  it('souterrain : pré-production sans minerai', () => {
    const { model } = defaultMiningModel(base);
    const p = undergroundPeriods(model);
    expect(p.filter(x => x.preProduction).every(x => x.oreTonnes === 0)).toBe(true);
    expect(p.filter(x => !x.preProduction)).toHaveLength(model.schedule.lomYears);
  });
});

describe('surcharges', () => {
  it('une surcharge prime et marque la provenance « override » ; un chemin obsolète est ignoré', () => {
    const { model, provenance } = defaultMiningModel(base);
    const ov = { 'openPit.haulDistanceKm': 4.2, 'openPit.unknownField': 1, 'nope.deep.path': 2 };
    const m = applyOverrides(model, ov);
    expect(m.openPit.haulDistanceKm).toBe(4.2);
    expect((m.openPit as unknown as Record<string, unknown>).unknownField).toBeUndefined();
    expect(model.openPit.haulDistanceKm).not.toBe(4.2); // pas de mutation du modèle par défaut
    expect(effectiveProvenance(provenance, ov)['openPit.haulDistanceKm'].origin).toBe('override');
  });
});

describe('passage au modèle économique', () => {
  const { model } = defaultMiningModel({ ...base, mineParams: { method: 'Open pit', stripping_ratio: 3 } });
  const res = computeMiningCost(model, []);

  it('CAPEX : lignes initiales en M$, sans la ligne de contingence (portée par contingency_pct)', () => {
    const lines = miningCapexLines(res, 15);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(l => l.category === 'Travaux miniers' && l.notes === MINING_AUTO_NOTE && l.contingency_pct === 15)).toBe(true);
    expect(lines.some(l => /Contingence/.test(l.description))).toBe(false);
    const sum = lines.reduce((s, l) => s + l.value_musd, 0);
    const expected = res.capex.filter(c => c.category !== 'Contingence').reduce((s, c) => s + c.initialUsd, 0) / 1e6;
    expect(sum).toBeCloseTo(expected, 1);
  });

  it('OPEX : $/t de minerai alimenté, dont la somme = OPEX minier unitaire', () => {
    const lines = miningOpexLines(res);
    const sum = lines.reduce((s, l) => s + l.value_usd_t, 0);
    expect(sum).toBeCloseTo(res.totals.opexUsdPerOreTonne, 1);
  });

  it('capital de maintien : remplace la part minière précédente sans toucher à la part usine', () => {
    expect(mergedSustaining(10, null, 3)).toBe(13);
    expect(mergedSustaining(13, 3, 4)).toBe(14);
    expect(mergedSustaining(null, null, 2.5)).toBe(2.5);
  });

  it('souterrain : calcul complet ; avertit seulement si l’échelle s’éloigne du référentiel', () => {
    const ug = computeMiningCost({ ...model, method: 'underground' }, []);
    expect(ug.method).toBe('underground');
    expect(ug.totals.initialCapexUsd).toBeGreaterThan(0);
    // 2,0 Mt/an contre ~0,72 Mt/an pour Eastwood → avertissement d'échelle.
    expect(ug.warnings.some(w => /mine de référence/.test(w))).toBe(true);
    const atScale = computeMiningCost({ ...model, method: 'underground', schedule: { ...model.schedule, annualOreTonnes: 800_000 } }, []);
    expect(atScale.warnings).toEqual([]);
  });
});
