import { describe, it, expect } from 'vitest';
import {
  bondEnergy, recoveryModel, runP80Engine, domainRecoveryAtP80,
  rowlandEF5, plantGrindEnergy,
  REFERENCE_P80_UM, P80_LADDER, LIBERATION_MODEL,
} from './p80';
import { domainWeightedMean } from './domains';
import { DEFAULT_ASSUMPTIONS } from '../config/constants';

describe('rowlandEF5 — fineness-of-grind correction', () => {
  it('is 1 at and above 75 µm — the lab test is representative there', () => {
    expect(rowlandEF5(75)).toBe(1);
    expect(rowlandEF5(150)).toBe(1);
  });

  it('exceeds 1 below 75 µm and grows as the grind gets finer', () => {
    expect(rowlandEF5(53)).toBeGreaterThan(1);
    expect(rowlandEF5(25)).toBeGreaterThan(rowlandEF5(53));
  });

  it('matches Rowland (1982): (P80 + 10.3) / (1.145·P80)', () => {
    expect(rowlandEF5(38)).toBeCloseTo((38 + 10.3) / (1.145 * 38), 10); // ≈1.11
    expect(rowlandEF5(25)).toBeCloseTo((25 + 10.3) / (1.145 * 25), 10); // ≈1.23
  });

  it('does not divide by zero on a degenerate P80', () => {
    expect(rowlandEF5(0)).toBe(1);
  });
});

describe('plantGrindEnergy — lab energy is not plant energy', () => {
  it('exceeds the lab Bond energy — a real mill grinds less efficiently', () => {
    const lab = bondEnergy(15, 12000, 75);
    const plant = plantGrindEnergy(15, 12000, 75, 1.15);
    expect(plant).toBeGreaterThan(lab);
    expect(plant).toBeCloseTo(lab * 1.15, 6); // EF5=1 at 75 µm
  });

  it('applies EF5 on top of the overall factor at fine sizes', () => {
    const plant = plantGrindEnergy(15, 12000, 38, 1.15);
    const lab = bondEnergy(15, 12000, 38);
    expect(plant).toBeCloseTo(lab * 1.15 * rowlandEF5(38), 6);
  });

  it('reduces to the raw lab energy at factor 1 with no fineness correction', () => {
    expect(plantGrindEnergy(15, 12000, 38, 1, false)).toBeCloseTo(bondEnergy(15, 12000, 38), 10);
  });

  it('uses the documented default factor when none is passed', () => {
    expect(plantGrindEnergy(15, 12000, 75))
      .toBeCloseTo(bondEnergy(15, 12000, 75) * DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR, 6);
  });
});

describe('bondEnergy', () => {
  it('rises as the target grind gets finer', () => {
    const coarse = bondEnergy(15, 12000, 150);
    const fine = bondEnergy(15, 12000, 53);
    expect(fine).toBeGreaterThan(coarse);
  });

  it('scales linearly with the work index', () => {
    expect(bondEnergy(30, 12000, 75)).toBeCloseTo(2 * bondEnergy(15, 12000, 75), 6);
  });

  it('never returns negative energy when P80 is coarser than F80', () => {
    expect(bondEnergy(15, 100, 500)).toBe(0);
  });

  it('matches Bond third theory for a known case', () => {
    // W = 10 · BWi · (1/√P80 − 1/√F80), BWi 15, F80 12000, P80 75
    const expected = 15 * 10 * (1 / Math.sqrt(75) - 1 / Math.sqrt(12000));
    expect(bondEnergy(15, 12000, 75)).toBeCloseTo(expected, 10);
  });
});

describe('recoveryModel', () => {
  it('improves as the grind gets finer', () => {
    expect(recoveryModel(53, 70, 95)).toBeGreaterThan(recoveryModel(212, 70, 95));
  });

  it('never exceeds the project recovery ceiling', () => {
    for (const p of P80_LADDER) {
      expect(recoveryModel(p, 90, 92)).toBeLessThanOrEqual(92);
    }
  });

  it('is anchored so the finest grind reaches the ceiling', () => {
    // Keeps the module coherent with Dashboard/Économie instead of an arbitrary 98%.
    expect(recoveryModel(25, 70, 92)).toBeCloseTo(92, 6);
  });

  it('falls back to a default liberation when Au libre is unknown', () => {
    expect(() => recoveryModel(75, null, 92)).not.toThrow();
    expect(recoveryModel(75, null, 92)).toBeGreaterThan(0);
    // Le repli est la valeur documentée du modèle, pas un littéral caché.
    expect(recoveryModel(75, null, 92)).toBeCloseTo(recoveryModel(75, LIBERATION_MODEL.defaultFreeAuPct, 92), 10);
  });

  it('uses the documented default ceiling when the caller supplies none', () => {
    expect(recoveryModel(25, 70)).toBeCloseTo(LIBERATION_MODEL.defaultCeilingPct, 6);
  });

  it('keeps the liberation constants physically coherent', () => {
    const L = LIBERATION_MODEL;
    // L'or déjà libre se libère plus vite que la fraction verrouillée…
    expect(L.freeRatePerUm).toBeGreaterThan(L.lockedRatePerUm);
    // …et la fraction verrouillée n'atteint jamais la récupération de l'or libre.
    expect(L.lockedCeilingFraction).toBeGreaterThan(0);
    expect(L.lockedCeilingFraction).toBeLessThan(1);
    // Les ancrages bornent bien l'échelle de broyage balayée.
    expect(L.fineAnchorUm).toBeLessThan(L.coarseAnchorUm);
  });
});

describe('domainRecoveryAtP80', () => {
  it('returns the design recovery unchanged at the reference grind', () => {
    expect(domainRecoveryAtP80(89.7, REFERENCE_P80_UM)).toBeCloseTo(89.7, 10);
  });

  it('gains recovery when grinding finer than the reference', () => {
    expect(domainRecoveryAtP80(89.7, 53)).toBeGreaterThan(89.7);
  });

  it('loses recovery when grinding coarser', () => {
    expect(domainRecoveryAtP80(89.7, 150)).toBeLessThan(89.7);
  });

  it('clamps to a physically sane band', () => {
    expect(domainRecoveryAtP80(98, 25)).toBeLessThanOrEqual(99);
    expect(domainRecoveryAtP80(55, 500)).toBeGreaterThanOrEqual(50);
  });
});

describe('runP80Engine', () => {
  const base = {
    bwi: 15.3, f80_um: 12000, auFreePct: 70,
    recoveryCeilingPct: 92, goldGradeGt: 1.7, goldPriceUsdOz: 2000,
  };

  it('refines the optimum off the discrete ladder, never below the best rung', () => {
    // The optimum is refined to the nearest µm inside the bracket around the best
    // ladder rung, so it is at least as valuable as any rung and stays in range.
    const { points, optimal } = runP80Engine(base);
    const bestRungNet = Math.max(...points.map(p => p.netUsd));
    expect(optimal.netUsd).toBeGreaterThanOrEqual(bestRungNet - 1e-9);
    expect(optimal.p80).toBeGreaterThanOrEqual(P80_LADDER[P80_LADDER.length - 1]);
    expect(optimal.p80).toBeLessThanOrEqual(P80_LADDER[0]);
    expect(Number.isInteger(optimal.p80)).toBe(true); // refined to the µm
  });

  it('exposes the nearest ladder rung to the refined optimum', () => {
    const { optimal, optimalIndex } = runP80Engine(base);
    const nearest = P80_LADDER.reduce((b, v) =>
      (Math.abs(v - optimal.p80) < Math.abs(b - optimal.p80) ? v : b));
    expect(P80_LADDER[optimalIndex]).toBe(nearest);
  });

  it('reports a lab-energy optimum finer than the plant optimum', () => {
    // Costed on raw Bond energy (no EF5, no plant factor), the optimum is
    // deceptively fine — the fine-grind penalties that pull the plant optimum
    // coarser are absent. This is the teaching contrast surfaced in the UI.
    const { optimal, optimalLab } = runP80Engine({ ...base, plantFactor: 1.2 });
    expect(optimalLab.p80).toBeLessThanOrEqual(optimal.p80);
  });

  it('the lab basis is cheaper than the plant basis at every rung', () => {
    const { points } = runP80Engine({ ...base, plantFactor: 1.2 });
    for (const p of points) {
      expect(p.labCost).toBeLessThanOrEqual(p.cost + 1e-9);
      expect(p.netUsdLab).toBeGreaterThanOrEqual(p.netUsd - 1e-9);
      expect(p.netUsdLab).toBeCloseTo(p.revenueUsdT - p.labCost, 10);
    }
  });

  it('prices the mill on plant energy, above the lab prediction', () => {
    const { points } = runP80Engine({ ...base, plantFactor: 1.2 });
    for (const p of points) {
      expect(p.energy).toBeGreaterThanOrEqual(p.labEnergy - 1e-9);
      if (p.p80 < 75) expect(p.energy).toBeGreaterThan(p.labEnergy); // EF5 bites
    }
  });

  it('a higher plant factor never pushes the optimum FINER — grinding costs more', () => {
    // The whole point of the lab→plant factor: it can only hold the optimum where
    // it is or pull it coarser, because every fine candidate got more expensive.
    const lab = runP80Engine({ ...base, plantFactor: 1.0, applyFineness: false }).optimal.p80;
    const plant = runP80Engine({ ...base, plantFactor: 1.35 }).optimal.p80;
    expect(plant).toBeGreaterThanOrEqual(lab);
  });

  it('reports the EF5 actually applied at each grind', () => {
    for (const p of runP80Engine(base).points) {
      expect(p.ef5).toBeCloseTo(rowlandEF5(p.p80), 10);
    }
  });

  it('returns one point per ladder step', () => {
    expect(runP80Engine(base).points.map(p => p.p80)).toEqual(P80_LADDER);
  });

  it('net value is revenue minus grinding energy cost', () => {
    const { points } = runP80Engine(base);
    for (const p of points) expect(p.netUsd).toBeCloseTo(p.revenueUsdT - p.cost, 10);
  });

  it('grinds coarser when energy gets expensive', () => {
    const cheap = runP80Engine({ ...base, elecCostUsdKwh: 0.01 }).optimal.p80;
    const dear = runP80Engine({ ...base, elecCostUsdKwh: 5 }).optimal.p80;
    expect(dear).toBeGreaterThanOrEqual(cheap);
  });

  it('grinds finer when gold is worth more', () => {
    const low = runP80Engine({ ...base, goldPriceUsdOz: 200 }).optimal.p80;
    const high = runP80Engine({ ...base, goldPriceUsdOz: 5000 }).optimal.p80;
    expect(high).toBeLessThanOrEqual(low);
  });

  it('does not assume the optimum equals the reference grind', () => {
    // GéoMet used to star 75 µm as the optimum; the engine decides economically
    // and resolves a precise size within the ladder envelope.
    const opt = runP80Engine(base).optimal.p80;
    expect(opt).toBeGreaterThanOrEqual(P80_LADDER[P80_LADDER.length - 1]);
    expect(opt).toBeLessThanOrEqual(P80_LADDER[0]);
  });
});

describe('engine inputs — composites excluded, weighted per domain', () => {
  // Mirrors the reported project: sulphide was tested far more than oxide, and the
  // mixte composite is itself a blend of the three.
  const bwiSamples = [
    ...Array(18).fill(0).map(() => ({ value: 11.9, domain: 'Oxide' })),
    ...Array(23).fill(0).map(() => ({ value: 15.7, domain: 'Transitionnel' })),
    ...Array(41).fill(0).map(() => ({ value: 17.1, domain: 'Sulfure' })),
    ...Array(8).fill(0).map(() => ({ value: 16.4, domain: 'mixte' })),
  ];

  it('excludes the mixte composite from the mean', () => {
    const agg = domainWeightedMean(bwiSamples);
    expect(agg.byDomain.map(d => d.canon).sort()).toEqual(['oxide', 'sulphide', 'transition']);
    expect(agg.compositeN).toBe(8);
    expect(agg.compositeMean).toBeCloseTo(16.4, 6);
  });

  it('weights domains equally instead of by testing effort', () => {
    const agg = domainWeightedMean(bwiSamples);
    expect(agg.mean).toBeCloseTo((11.9 + 15.7 + 17.1) / 3, 6); // 14.9
  });

  it('differs materially from the flat sample mean it replaces', () => {
    const flat = bwiSamples.reduce((s, r) => s + r.value, 0) / bwiSamples.length;
    const agg = domainWeightedMean(bwiSamples);
    expect(flat).toBeGreaterThan(agg.mean!); // 41 sulphide tests dragged it up
    expect(Math.abs(flat - agg.mean!)).toBeGreaterThan(0.5);
  });

  it('a harder biased BWi changes the grinding energy the optimum is priced on', () => {
    const agg = domainWeightedMean(bwiSamples);
    const flat = bwiSamples.reduce((s, r) => s + r.value, 0) / bwiSamples.length;
    const eWeighted = bondEnergy(agg.mean!, 12000, 75);
    const eFlat = bondEnergy(flat, 12000, 75);
    expect(eFlat).toBeGreaterThan(eWeighted);
  });
});
