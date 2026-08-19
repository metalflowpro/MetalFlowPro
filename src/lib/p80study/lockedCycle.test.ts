import { describe, it, expect } from 'vitest';
import { solveLockedCycle, type LockedCycleInputs } from './lockedCycle';

const base: LockedCycleInputs = {
  freshFeedMass: 100,
  freshFeedGrade: 3,
  singlePassRecoveryPct: 60,
  recycleFraction: 0.5,
};

describe('solveLockedCycle', () => {
  it('converges and recovery exceeds the single-pass value (recycling helps)', () => {
    const r = solveLockedCycle(base);
    expect(r.converged).toBe(true);
    expect(r.convergedRecoveryPct).toBeGreaterThan(base.singlePassRecoveryPct);
    expect(r.convergedRecoveryPct).toBeLessThanOrEqual(100);
  });

  it('recovery series is monotonically non-decreasing toward steady state', () => {
    const { recoverySeriesPct } = solveLockedCycle(base);
    for (let i = 1; i < recoverySeriesPct.length; i++) {
      expect(recoverySeriesPct[i]).toBeGreaterThanOrEqual(recoverySeriesPct[i - 1] - 1e-9);
    }
  });

  it('no recycle → converged recovery equals single-pass', () => {
    const r = solveLockedCycle({ ...base, recycleFraction: 0 });
    expect(r.convergedRecoveryPct).toBeCloseTo(60, 6);
    expect(r.circulatingLoadFraction).toBe(0);
  });

  it('higher recycle fraction yields higher steady-state recovery', () => {
    const low = solveLockedCycle({ ...base, recycleFraction: 0.3 }).convergedRecoveryPct;
    const high = solveLockedCycle({ ...base, recycleFraction: 0.7 }).convergedRecoveryPct;
    expect(high).toBeGreaterThan(low);
  });

  it('respects the maxCycles guard', () => {
    const r = solveLockedCycle({ ...base, convergenceTolPct: 0, maxCycles: 5 });
    expect(r.cycles).toBeLessThanOrEqual(5);
  });
});
