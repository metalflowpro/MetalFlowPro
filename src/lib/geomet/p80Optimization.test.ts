import { describe, it, expect } from 'vitest';
import {
  p80FromCurve, recoveryAtP80, deriveLabTarget, computeKIndus,
  circuitEnergy, chainEnergy, runScenarios,
  recommendByCircuit, confidenceFromData, defaultCircuitChain,
  runP80Optimization, K_INDUS_DEFAULT, K_INDUS_BOUNDS, DEFAULT_OVERGRIND,
  type RecoveryCurveParams, type DataSufficiency,
} from './p80Optimization';
import { bondEnergy } from './p80';

const REC: RecoveryCurveParams = { auFreePct: 60, recoveryCeilingPct: 93 };
const FULL_DATA: DataSufficiency = { hasPsd: true, hasMeasuredWi: true, hasRecoveryData: true, nSamples: 10 };
const NO_DATA: DataSufficiency = { hasPsd: false, hasMeasuredWi: false, hasRecoveryData: false, nSamples: 0 };

// Courbe PSD synthétique encadrant 80 % passant entre 106 et 150 µm.
const CURVE = [
  { sieve: 38, passing: 35 }, { sieve: 53, passing: 48 }, { sieve: 75, passing: 62 },
  { sieve: 106, passing: 76 }, { sieve: 150, passing: 86 }, { sieve: 212, passing: 94 },
];

describe('p80FromCurve', () => {
  it('interpolates P80 between the bracketing sieves (log-linear)', () => {
    const m = p80FromCurve(CURVE, { source: 'lims', sampleId: 'S1', dateAnalysis: '2026-07-01' });
    expect(m.method).toBe('log_interpolation');
    expect(m.valueUm).toBeGreaterThan(106);
    expect(m.valueUm).toBeLessThan(150);
    expect(m.source).toBe('lims');
    expect(m.sampleId).toBe('S1');
  });

  it('supports mm input and converts to µm', () => {
    const mm = CURVE.map(p => ({ sieve: p.sieve / 1000, passing: p.passing }));
    const a = p80FromCurve(CURVE, { unit: 'um' });
    const b = p80FromCurve(mm, { unit: 'mm' });
    expect(b.valueUm).toBeCloseTo(a.valueUm!, 6);
    expect(b.unit).toBe('um');
  });

  it('flags insufficient data when 80% cannot be bracketed', () => {
    const m = p80FromCurve([{ sieve: 75, passing: 40 }]);
    expect(m.valueUm).toBeNull();
    expect(m.method).toBe('insufficient_data');
  });
});

describe('recoveryAtP80 (overgrind rule)', () => {
  it('penalises recovery below the overgrind threshold', () => {
    const atThreshold = recoveryAtP80(DEFAULT_OVERGRIND.thresholdUm, REC);
    const finer = recoveryAtP80(25, REC);
    // sans pénalité le modèle serait monotone croissant vers fin ; ici le
    // surbroyage doit dégrader la performance
    const baseFiner = recoveryAtP80(25, { ...REC, overgrindPenaltyPctPerUm: 0 });
    expect(finer).toBeLessThan(baseFiner);
    expect(atThreshold).toBeGreaterThan(0);
  });
});

describe('deriveLabTarget', () => {
  it('finds the best metallurgical response, not the finest grind', () => {
    const t = deriveLabTarget(REC);
    expect(t.valueUm).toBeGreaterThan(25); // le surbroyage écarte l'extrême fin
    expect(t.rangeUm[0]).toBeLessThanOrEqual(t.valueUm);
    expect(t.rangeUm[1]).toBeGreaterThanOrEqual(t.valueUm);
    expect(t.justification).toContain('µm');
  });

  it('honours an engineer-fixed value', () => {
    const t = deriveLabTarget(REC, { engineerValueUm: 106 });
    expect(t.valueUm).toBe(106);
    expect(t.testType).toBe('engineer');
  });
});

describe('computeKIndus', () => {
  it('defaults to the documented value', () => {
    expect(computeKIndus('default').k).toBe(K_INDUS_DEFAULT);
  });
  it('manual mode clamps to bounds', () => {
    expect(computeKIndus('manual', {}, 9).k).toBe(K_INDUS_BOUNDS[1]);
    expect(computeKIndus('manual', {}, 0.5).k).toBe(K_INDUS_BOUNDS[0]);
    expect(computeKIndus('manual', {}, 1.25).k).toBe(1.25);
  });
  it('auto mode raises K for poor circuit efficiency and explains the basis', () => {
    const good = computeKIndus('auto', { circuitEfficiencyPct: 85 });
    const poor = computeKIndus('auto', { circuitEfficiencyPct: 55 });
    expect(poor.k).toBeGreaterThan(good.k);
    expect(poor.basis.length).toBeGreaterThan(1);
  });
});

describe('circuitEnergy / chainEnergy (Bond)', () => {
  it('matches Bond: E = 10·Wi·(1/√P80 − 1/√F80)', () => {
    const r = circuitEnergy({ type: 'ball', label: 'Ball', f80Um: 2000, p80Um: 106, wi: 14 });
    expect(r.specificEnergyKwhT).toBeCloseTo(10 * 14 * (1 / Math.sqrt(106) - 1 / Math.sqrt(2000)), 6);
  });
  it('computes required power from throughput and utilization vs available', () => {
    const r = circuitEnergy({ type: 'ball', label: 'Ball', f80Um: 2000, p80Um: 106, wi: 14, throughputTph: 400, availablePowerKw: 6000 });
    expect(r.powerRequiredKw).toBeCloseTo(r.specificEnergyKwhT * 400, 6);
    expect(r.powerUtilizationPct).toBeCloseTo((r.powerRequiredKw! / 6000) * 100, 6);
  });
  it('chains stages and compares to the design target', () => {
    const chain = chainEnergy([
      { type: 'sag', label: 'SAG', f80Um: 10000, p80Um: 1500, wi: 14, throughputTph: 400 },
      { type: 'ball', label: 'Ball', f80Um: 1500, p80Um: 106, wi: 14, throughputTph: 400 },
    ], 12);
    expect(chain.totalKwhT).toBeCloseTo(chain.perCircuit[0].specificEnergyKwhT + chain.perCircuit[1].specificEnergyKwhT, 6);
    expect(chain.totalPowerKw).toBeCloseTo(chain.totalKwhT * 400, 6);
    expect(chain.designDeltaPct).not.toBeNull();
  });
});

describe('runScenarios', () => {
  const inputs = {
    bwi: 14.5, f80Um: 2000, recovery: REC,
    goldGradeGt: 3.2, goldPriceUsdOz: 2400, throughputTph: 400,
  };

  it('produces the three spec scenarios with distinct objectives', () => {
    const r = runScenarios(inputs);
    expect(r.scenarios.map(s => s.id)).toEqual(['bond_energy', 'recovery_driven', 'curve_driven']);
    const bond = r.scenarios[0], rec = r.scenarios[1];
    // Bond Energy choisit le plus économe : jamais plus d'énergie que Recovery.
    expect(bond.energyKwhT).toBeLessThanOrEqual(rec.energyKwhT);
    // Recovery-driven ne récupère jamais moins que Bond Energy.
    expect(rec.recoveryPct).toBeGreaterThanOrEqual(bond.recoveryPct);
  });

  it('selects a scenario with a stated reason and computes marginal slopes', () => {
    const r = runScenarios(inputs);
    expect(r.selected).toBeDefined();
    expect(r.selectionReason.length).toBeGreaterThan(10);
    expect(r.points.some(p => p.marginalNetPerUm != null)).toBe(true);
  });

  it('respects the process max P80 constraint for Bond Energy', () => {
    const r = runScenarios({ ...inputs, processMaxP80Um: 106 });
    expect(r.scenarios[0].p80Um).toBeLessThanOrEqual(106);
  });
});

describe('recommendByCircuit', () => {
  const base = {
    plantP80Um: 125,
    chain: defaultCircuitChain(false),
    wiByType: { crush_primary: 11, crush_secondary: 11, crush_tertiary: 11, sag: 14.5, ball: 14.5 } as const,
    headF80Um: 600_000,
    recovery: REC,
    data: FULL_DATA,
  };

  it('covers every present circuit with a per-circuit P80 (never one global P80)', () => {
    const recs = recommendByCircuit(base);
    expect(recs.map(r => r.type)).toEqual(['crush_primary', 'crush_secondary', 'crush_tertiary', 'sag', 'ball']);
    const values = new Set(recs.map(r => r.p80RecommendedUm));
    expect(values.size).toBe(recs.length); // tous différents
  });

  it('anchors the final mill on the plant P80 and respects mechanical windows', () => {
    const recs = recommendByCircuit(base);
    const ball = recs.find(r => r.type === 'ball')!;
    expect(ball.p80RecommendedUm).toBe(125);
    for (const r of recs) {
      const def = base.chain.find(c => c.type === r.type)!;
      expect(r.p80RecommendedUm).toBeGreaterThanOrEqual(def.p80WindowUm[0]);
      expect(r.p80RecommendedUm).toBeLessThanOrEqual(def.p80WindowUm[1]);
    }
  });

  it('chains product → feed: each stage is finer than the previous', () => {
    const recs = recommendByCircuit(base);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].p80RecommendedUm).toBeLessThan(recs[i - 1].p80RecommendedUm);
    }
  });

  it('adds regrind finer than the plant P80 when present', () => {
    const recs = recommendByCircuit({ ...base, chain: defaultCircuitChain(true) });
    const regrind = recs.find(r => r.type === 'regrind')!;
    const ball = recs.find(r => r.type === 'ball')!;
    expect(regrind.p80RecommendedUm).toBeLessThan(ball.p80RecommendedUm);
  });

  it('with regrind present, the BALL mill (not the regrind) anchors the plant P80; regrind ≈ 0.5×', () => {
    // Regression guard: the ball mill is the main grinder and must hit the plant
    // P80; the regrind is a finer polishing stage (~0.5×). Previously the regrind
    // was wrongly treated as the final grinder and took the plant P80 itself.
    const recs = recommendByCircuit({ ...base, chain: defaultCircuitChain(true) });
    const ball = recs.find(r => r.type === 'ball')!;
    const regrind = recs.find(r => r.type === 'regrind')!;
    expect(ball.p80RecommendedUm).toBe(125);                 // ball = plant P80
    expect(regrind.p80RecommendedUm).toBe(63);               // ≈ 0.5 × 125, within [15,75]
  });

  it('degrades confidence with insufficient data', () => {
    const recs = recommendByCircuit({ ...base, data: NO_DATA });
    expect(recs.find(r => r.type === 'ball')!.confidence).toBe('low');
  });
});

describe('confidenceFromData', () => {
  it('maps data sufficiency to levels', () => {
    expect(confidenceFromData(FULL_DATA)).toBe('high');
    expect(confidenceFromData(NO_DATA)).toBe('low');
    expect(confidenceFromData({ hasPsd: true, hasMeasuredWi: true, hasRecoveryData: false, nSamples: 2 })).toBe('medium');
  });
});

describe('runP80Optimization (end-to-end)', () => {
  const inputs = {
    psdCurve: CURVE,
    psdMeta: { source: 'lims', sampleId: 'S1' },
    f80Um: 2000,
    headF80Um: 600_000,
    bwi: 14.5,
    recovery: REC,
    goldGradeGt: 3.2,
    goldPriceUsdOz: 2400,
    throughputTph: 400,
    availablePowerKw: 8000,
    designEnergyTargetKwhT: 13,
    kIndusMode: 'default' as const,
    data: FULL_DATA,
  };

  it('produces the full spec output: LIMS P80, lab target, plant P80, scenarios, per-circuit, comment', () => {
    const r = runP80Optimization(inputs);
    expect(r.p80Lims.valueUm).toBeGreaterThan(100);
    expect(r.p80OptimalPlantUm).toBeCloseTo(r.labTarget.valueUm * r.kIndus.k, 6);
    // distingue clairement labo et usine
    expect(r.p80OptimalPlantUm).toBeGreaterThan(r.labTarget.valueUm);
    expect(r.scenarios.scenarios.length).toBe(3);
    expect(r.circuits.length).toBe(5);
    expect(r.finalGrindEnergy.totalKwhT).toBeGreaterThan(0);
    expect(r.finalGrindEnergy.designDeltaPct).not.toBeNull();
    expect(r.comment).toContain('Scénario retenu');
    expect(r.confidence).toBe('high');
    // audit conserve les paramètres sans la courbe brute
    expect(r.audit.bwi).toBe(14.5);
    expect(r.audit.psdPointCount).toBe(CURVE.length);
  });

  it('flags provisional values with low confidence when data is missing', () => {
    const r = runP80Optimization({ ...inputs, psdCurve: [], data: NO_DATA });
    expect(r.confidence).toBe('low');
    expect(r.p80Lims.method).toBe('insufficient_data');
    expect(r.comment).toContain('Données insuffisantes');
    // le pipeline produit quand même une valeur provisoire
    expect(r.p80OptimalPlantUm).toBeGreaterThan(0);
  });

  it('energy is consistent with Bond for the ball stage', () => {
    const r = runP80Optimization(inputs);
    const ball = r.finalGrindEnergy.perCircuit.find(c => c.type === 'ball')!;
    expect(ball.specificEnergyKwhT).toBeCloseTo(bondEnergy(14.5, ball.f80Um, ball.p80Um), 6);
  });
});
