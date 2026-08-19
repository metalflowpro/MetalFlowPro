import { describe, it, expect } from 'vitest';
import { cumulativeGrg, type GrgStage } from './grg';

const stages: GrgStage[] = [
  { stage: 1, p80Um: 850, stageRecoveryPct: 40 },
  { stage: 2, p80Um: 300, stageRecoveryPct: 30 },
  { stage: 3, p80Um: 75, stageRecoveryPct: 25 },
];

describe('cumulativeGrg', () => {
  it('composes sequentially over remaining gold: 1 − ∏(1 − rᵢ)', () => {
    const r = cumulativeGrg(stages);
    // 1 − 0.6·0.7·0.75 = 1 − 0.315 = 0.685
    expect(r.cumulativeGrgPct).toBeCloseTo(68.5, 6);
  });

  it('per-stage contributions sum to the cumulative GRG', () => {
    const r = cumulativeGrg(stages);
    const sum = r.perStageContributionPct.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(r.cumulativeGrgPct, 6);
  });

  it('is monotonically increasing along the cumulative curve', () => {
    const { cumulativeCurvePct } = cumulativeGrg(stages);
    for (let i = 1; i < cumulativeCurvePct.length; i++) {
      expect(cumulativeCurvePct[i]).toBeGreaterThanOrEqual(cumulativeCurvePct[i - 1]);
    }
  });

  it('sorts coarse → fine regardless of input order', () => {
    const shuffled = [stages[2], stages[0], stages[1]];
    expect(cumulativeGrg(shuffled).cumulativeGrgPct).toBeCloseTo(68.5, 6);
  });

  it('a single 100% stage yields 100% GRG', () => {
    expect(cumulativeGrg([{ stage: 1, p80Um: 100, stageRecoveryPct: 100 }]).cumulativeGrgPct).toBe(100);
  });
});
