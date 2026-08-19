import { describe, it, expect } from 'vitest';
import { goldRecoveryFromBalance, recoveryGap } from './recovery';

describe('goldRecoveryFromBalance', () => {
  it('recovers from the concentrate balance R = Mc·Cc / Mf·Cf', () => {
    // 100 t feed @ 2 g/t = 200 g in; 4 t conc @ 45 g/t = 180 g → 90 %.
    const r = goldRecoveryFromBalance({
      feedMass: 100, feedGrade: 2, concentrateMass: 4, concentrateGrade: 45,
    });
    expect(r.basis).toBe('concentrate');
    expect(r.recoveryPct).toBeCloseTo(90, 6);
    expect(r.massRecoveryPct).toBeCloseTo(4, 6);
  });

  it('recovers from the tailings balance R = 1 − Mt·Ct / Mf·Cf', () => {
    // 100 t feed @ 2 g/t = 200 g; 96 t tails @ 0.25 g/t = 24 g → 88 %.
    const r = goldRecoveryFromBalance(
      { feedMass: 100, feedGrade: 2, tailingsMass: 96, tailingsGrade: 0.25 },
      'tailings',
    );
    expect(r.basis).toBe('tailings');
    expect(r.recoveryPct).toBeCloseTo(88, 6);
  });

  it('prefers the concentrate basis when both are available', () => {
    const r = goldRecoveryFromBalance({
      feedMass: 100, feedGrade: 2,
      concentrateMass: 4, concentrateGrade: 45,
      tailingsMass: 96, tailingsGrade: 0.25,
    });
    expect(r.basis).toBe('concentrate');
  });

  it('returns null when the feed metal cannot be formed', () => {
    expect(goldRecoveryFromBalance({ feedMass: 100, concentrateMass: 4, concentrateGrade: 45 }).recoveryPct).toBeNull();
  });

  it('clamps a noisy balance into [0, 100]', () => {
    const over = goldRecoveryFromBalance({ feedMass: 100, feedGrade: 2, concentrateMass: 5, concentrateGrade: 50 });
    expect(over.recoveryPct).toBe(100); // 250 g out > 200 g in
  });
});

describe('recoveryGap', () => {
  it('does not flag within tolerance', () => {
    const g = recoveryGap(90.5, 90.0, 2);
    expect(g.deltaPct).toBeCloseTo(0.5, 6);
    expect(g.flagged).toBe(false);
  });

  it('flags beyond tolerance', () => {
    const g = recoveryGap(94, 90, 2);
    expect(g.flagged).toBe(true);
  });

  it('is inconclusive (unflagged) when a value is missing', () => {
    expect(recoveryGap(null, 90).flagged).toBe(false);
    expect(recoveryGap(90, null).deltaPct).toBeNull();
  });
});
