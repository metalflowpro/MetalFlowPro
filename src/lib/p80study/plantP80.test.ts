import { describe, it, expect } from 'vitest';
import { throughputAtP80, evaluatePlantP80, optimisePlantP80, type PlantP80Inputs } from './plantP80';

const base: PlantP80Inputs = {
  bwi: 15,
  f80Um: 10000,
  millPowerKw: 5000,
  gradeGt: 3,
  goldPriceUsdOz: 2000,
  treatmentCostUsdT: 12,
  recoveryCeilingPct: 94,
  auFreePct: 55,
};

describe('throughputAtP80', () => {
  it('falls as the grind gets finer (more specific energy per tonne)', () => {
    const coarse = throughputAtP80(150, base);
    const fine = throughputAtP80(53, base);
    expect(coarse).toBeGreaterThan(fine);
    expect(fine).toBeGreaterThan(0);
  });

  it('honours the throughput cap', () => {
    const capped = throughputAtP80(150, { ...base, maxThroughputTph: 10 });
    expect(capped).toBeLessThanOrEqual(10);
  });

  it('is zero without mill power', () => {
    expect(throughputAtP80(75, { ...base, millPowerKw: 0 })).toBe(0);
  });
});

describe('evaluatePlantP80', () => {
  it('recovers higher but processes fewer tonnes as it grinds finer', () => {
    const coarse = evaluatePlantP80(150, base);
    const fine = evaluatePlantP80(53, base);
    expect(fine.recoveryPct).toBeGreaterThan(coarse.recoveryPct);
    expect(fine.tonnesPerDay).toBeLessThan(coarse.tonnesPerDay);
    expect(coarse.netValueUsdDay).toBeCloseTo(coarse.revenueUsdDay - coarse.costUsdDay, 6);
  });
});

describe('optimisePlantP80', () => {
  it('can prefer a coarser P80 for oz/day than a pure recovery pick would', () => {
    // A power-limited mill: the finest grind maximises recovery but not oz/day,
    // because throughput collapses. The oz/day optimum must not be the finest rung.
    const ladder = [150, 106, 75, 53];
    const { optimal } = optimisePlantP80(ladder, base, 'oz_per_day');
    expect(optimal).not.toBeNull();
    expect(optimal!.p80Um).toBeGreaterThan(53);
  });

  it('net-value and oz/day objectives can select different optima', () => {
    const ladder = [150, 106, 75, 53];
    const nv = optimisePlantP80(ladder, base, 'net_value_per_day').optimal;
    const oz = optimisePlantP80(ladder, base, 'oz_per_day').optimal;
    expect(nv).not.toBeNull();
    expect(oz).not.toBeNull();
    // Net value subtracts treatment cost per tonne, so it never favours a finer
    // (lower-throughput, higher-recovery) grind than the oz/day optimum.
    expect(nv!.p80Um).toBeGreaterThanOrEqual(oz!.p80Um);
  });

  it('returns a null optimum for an empty ladder', () => {
    expect(optimisePlantP80([], base).optimal).toBeNull();
  });
});
