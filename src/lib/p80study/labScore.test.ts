import { describe, it, expect } from 'vitest';
import { scoreLabP80, LAB_SCORE_WEIGHTS, type P80Candidate } from './labScore';

const candidates: P80Candidate[] = [
  { p80Um: 150, recoveryPct: 84, reagent: 0.5, energyKwhT: 8, finesPenalty: 0 },
  { p80Um: 106, recoveryPct: 88, reagent: 0.6, energyKwhT: 12, finesPenalty: 1 },
  { p80Um: 75, recoveryPct: 91, reagent: 0.7, energyKwhT: 18, finesPenalty: 3 },
  { p80Um: 53, recoveryPct: 92, reagent: 0.9, energyKwhT: 28, finesPenalty: 7 },
];

describe('scoreLabP80', () => {
  it('returns a contribution breakdown that sums to the score', () => {
    const { scored } = scoreLabP80(candidates);
    for (const s of scored) {
      const sum = s.contributions.recovery + s.contributions.reagent + s.contributions.energy + s.contributions.fines;
      expect(sum).toBeCloseTo(s.score, 9);
    }
  });

  it('signs the terms: recovery adds, the three costs subtract', () => {
    const { scored } = scoreLabP80(candidates);
    for (const s of scored) {
      expect(s.contributions.recovery).toBeGreaterThanOrEqual(0);
      expect(s.contributions.reagent).toBeLessThanOrEqual(0);
      expect(s.contributions.energy).toBeLessThanOrEqual(0);
      expect(s.contributions.fines).toBeLessThanOrEqual(0);
    }
  });

  it('picks the finest P80 when recovery dominates (cost weights ~0)', () => {
    const { best } = scoreLabP80(candidates, { recovery: 1, reagent: 0, energy: 0, fines: 0 });
    expect(best?.p80Um).toBe(53); // highest recovery
  });

  it('pulls the optimum coarser when energy/fines are penalised hard', () => {
    const { best } = scoreLabP80(candidates, { recovery: 1, reagent: 0, energy: 3, fines: 3 });
    expect(best && best.p80Um).toBeGreaterThan(53);
  });

  it('handles a single candidate (neutral cost contributions)', () => {
    const { best } = scoreLabP80([candidates[0]]);
    expect(best?.p80Um).toBe(150);
    expect(best?.contributions.energy).toBeCloseTo(0, 9);
  });

  it('exposes the weights it used', () => {
    expect(scoreLabP80(candidates).weights).toBe(LAB_SCORE_WEIGHTS);
  });
});
