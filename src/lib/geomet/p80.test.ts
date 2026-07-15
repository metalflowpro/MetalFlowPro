import { describe, it, expect } from 'vitest';
import {
  bondEnergy, recoveryModel, runP80Engine, domainRecoveryAtP80,
  REFERENCE_P80_UM, P80_LADDER,
} from './p80';
import { domainWeightedMean } from './domains';

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

  it('picks the point with the highest net value per tonne', () => {
    const { points, optimal } = runP80Engine(base);
    const best = points.reduce((a, b) => (b.netUsd > a.netUsd ? b : a));
    expect(optimal.p80).toBe(best.p80);
    expect(optimal.netUsd).toBeGreaterThanOrEqual(Math.max(...points.map(p => p.netUsd)) - 1e-9);
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
    // GéoMet used to star 75 µm as the optimum; the engine decides economically.
    const opt = runP80Engine(base).optimal.p80;
    expect(P80_LADDER).toContain(opt);
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
