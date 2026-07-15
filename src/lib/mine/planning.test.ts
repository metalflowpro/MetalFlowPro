import { describe, it, expect } from 'vitest';
import {
  disaggregateYear, fleetRequirements, drillBlastPlan, reconcile, reconVerdict,
  QUARTER_LABELS, MONTH_LABELS,
  type AnnualPlan, type CalendarConfig, type FleetSpec, type DrillBlastConfig,
} from './planning';

const YEAR: AnnualPlan = { year: 1, ore: 4.0, waste: 16.0, grade: 1.7, oz_k: 200 };
const CAL: CalendarConfig = { daysPerYear: 350, shiftsPerDay: 2, hoursPerShift: 12 };

describe('disaggregateYear — étape 4', () => {
  it('ties back to the annual plan exactly', () => {
    // A tactical plan that does not sum to its strategic parent is a bug, not a nuance.
    const qs = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    expect(qs.reduce((s, q) => s + q.oreMt, 0)).toBeCloseTo(YEAR.ore, 9);
    expect(qs.reduce((s, q) => s + q.wasteMt, 0)).toBeCloseTo(YEAR.waste, 9);
    expect(qs.reduce((s, q) => s + q.ozK, 0)).toBeCloseTo(YEAR.oz_k, 9);
    expect(qs.reduce((s, q) => s + q.days, 0)).toBeCloseTo(CAL.daysPerYear, 9);
  });

  it('splits evenly with no seasonality', () => {
    for (const q of disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL)) {
      expect(q.oreMt).toBeCloseTo(1.0, 9);
    }
  });

  it('honours seasonality without changing the annual total', () => {
    const qs = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL, [0.5, 1.5, 1.5, 0.5]);
    expect(qs[0].oreMt).toBeLessThan(qs[1].oreMt);
    expect(qs.reduce((s, q) => s + q.oreMt, 0)).toBeCloseTo(YEAR.ore, 9);
  });

  it('does not dilute the grade across periods', () => {
    // Grade is an ore property; splitting a year must not divide it by 4.
    for (const q of disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL)) {
      expect(q.gradeGt).toBeCloseTo(YEAR.grade, 9);
    }
  });

  it('handles months', () => {
    const ms = disaggregateYear(YEAR, 12, MONTH_LABELS, CAL);
    expect(ms).toHaveLength(12);
    expect(ms[0].label).toBe('Jan');
    expect(ms.reduce((s, m) => s + m.oreMt, 0)).toBeCloseTo(YEAR.ore, 9);
  });

  it('ignores a seasonality array of the wrong length rather than mis-splitting', () => {
    const qs = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL, [1, 2]);
    expect(qs[0].oreMt).toBeCloseTo(1.0, 9);
  });
});

describe('fleetRequirements — étape 4', () => {
  const SPECS: FleetSpec[] = [
    { equipment: 'Camion 220t', nominalTph: 800, availabilityPct: 85, utilisationPct: 80, unitsAvailable: 4 },
  ];

  it('derates nominal capacity by availability and utilisation', () => {
    const [q] = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    const [r] = fleetRequirements(q, CAL, SPECS);
    expect(r.effectiveTphPerUnit).toBeCloseTo(800 * 0.85 * 0.80, 6); // 544, not 800
  });

  it('needs more units than a nominal-capacity sizing would suggest', () => {
    const [q] = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    const [derated] = fleetRequirements(q, CAL, SPECS);
    const [nominal] = fleetRequirements(q, CAL, [{ ...SPECS[0], availabilityPct: 100, utilisationPct: 100 }]);
    expect(derated.unitsRequired).toBeGreaterThan(nominal.unitsRequired);
  });

  it('flags the gap when the fleet is short', () => {
    const [q] = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    const [r] = fleetRequirements(q, CAL, [{ ...SPECS[0], unitsAvailable: 1 }]);
    expect(r.gapUnits).toBeGreaterThan(0);
    expect(r.utilisationPct).toBeGreaterThan(100);
  });

  it('scales with the tonnage moved', () => {
    const [q] = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    const [big] = fleetRequirements({ ...q, totalMt: q.totalMt * 2 }, CAL, SPECS);
    const [small] = fleetRequirements(q, CAL, SPECS);
    expect(big.unitsRequired).toBeCloseTo(small.unitsRequired * 2, 6);
  });

  it('does not divide by zero on a zero-capacity spec', () => {
    const [q] = disaggregateYear(YEAR, 4, QUARTER_LABELS, CAL);
    const [r] = fleetRequirements(q, CAL, [{ ...SPECS[0], nominalTph: 0 }]);
    expect(r.unitsRequired).toBe(0);
  });
});

describe('drillBlastPlan — étape 5', () => {
  const CFG: DrillBlastConfig = {
    burdenM: 5, spacingM: 6, benchHeightM: 10, subDrillM: 1,
    powderFactorKgT: 0.25, rockDensity: 2.7, tonnesPerBlast: 50000,
  };

  it('derives hole count from the pattern geometry', () => {
    const p = drillBlastPlan(81000, CFG); // 30 000 m³ at SG 2.7
    expect(p.volumeM3).toBeCloseTo(30000, 6);
    expect(p.holes).toBeCloseTo(30000 / (5 * 6 * 10), 6); // 100 holes
  });

  it('drills bench height plus sub-drill per hole', () => {
    const p = drillBlastPlan(81000, CFG);
    expect(p.drillMetres).toBeCloseTo(p.holes * 11, 6);
  });

  it('explosive follows the powder factor', () => {
    expect(drillBlastPlan(100000, CFG).explosiveKg).toBeCloseTo(25000, 6);
  });

  it('a tighter pattern needs more holes for the same rock', () => {
    const loose = drillBlastPlan(81000, CFG);
    const tight = drillBlastPlan(81000, { ...CFG, burdenM: 4, spacingM: 4 });
    expect(tight.holes).toBeGreaterThan(loose.holes);
  });

  it('counts the blasts the period needs', () => {
    expect(drillBlastPlan(200000, CFG).blasts).toBeCloseTo(4, 6);
  });

  it('survives a zero-density config', () => {
    expect(drillBlastPlan(1000, { ...CFG, rockDensity: 0 }).volumeM3).toBe(0);
  });
});

describe('reconcile — étape 8', () => {
  const model = { tonnes: 1_000_000, gradeGt: 2.0 };

  it('reports 1.00 everywhere when reality matches the model', () => {
    const r = reconcile(model, model, model);
    expect(r.f1Ounces).toBeCloseTo(1, 9);
    expect(r.f2Ounces).toBeCloseTo(1, 9);
    expect(r.f3Ounces).toBeCloseTo(1, 9);
  });

  it('catches an optimistic model', () => {
    // The mine dug the tonnes but the grade came in 12 % low.
    const r = reconcile(model, { tonnes: 1_000_000, gradeGt: 1.76 }, { tonnes: 1_000_000, gradeGt: 1.76 });
    expect(r.f1Grade).toBeCloseTo(0.88, 6);
    expect(reconVerdict(r.f1Grade)).toBe('bad');
  });

  it('F3 is F1 × F2 — the chain composes', () => {
    const mine = { tonnes: 1_050_000, gradeGt: 1.9 };
    const plant = { tonnes: 1_020_000, gradeGt: 1.85 };
    const r = reconcile(model, mine, plant);
    expect(r.f3Ounces!).toBeCloseTo(r.f1Ounces! * r.f2Ounces!, 9);
    expect(r.f3Tonnes!).toBeCloseTo(r.f1Tonnes! * r.f2Tonnes!, 9);
  });

  it('separates a tonnage problem from a grade problem', () => {
    const r = reconcile(model, { tonnes: 1_200_000, gradeGt: 2.0 }, { tonnes: 1_200_000, gradeGt: 2.0 });
    expect(r.f1Tonnes).toBeCloseTo(1.2, 6);
    expect(r.f1Grade).toBeCloseTo(1.0, 6);
  });

  it('returns null instead of dividing by zero on an empty model', () => {
    const r = reconcile({ tonnes: 0, gradeGt: 0 }, model, model);
    expect(r.f1Tonnes).toBeNull();
    expect(reconVerdict(r.f1Tonnes)).toBe('unknown');
  });
});

describe('reconVerdict', () => {
  it('accepts within ±5 %', () => {
    expect(reconVerdict(1.0)).toBe('ok');
    expect(reconVerdict(0.96)).toBe('ok');
    expect(reconVerdict(1.04)).toBe('ok');
  });

  it('warns between 5 % and 10 %', () => {
    expect(reconVerdict(1.08)).toBe('warn');
    expect(reconVerdict(0.92)).toBe('warn');
  });

  it('fails beyond 10 %', () => {
    expect(reconVerdict(1.2)).toBe('bad');
    expect(reconVerdict(0.8)).toBe('bad');
  });

  it('reports unknown rather than guessing', () => {
    expect(reconVerdict(null)).toBe('unknown');
    expect(reconVerdict(Infinity)).toBe('unknown');
  });
});
