import { describe, it, expect } from 'vitest';
import { recoveryFromCurve, isCurveEnabled, RECOVERY_CURVE, type RecoveryCurveParams } from './recoveryCurve';

/** Coefficients du PFS Spanish Mountain 2021 §13.5.5 — SAISIS PAR PROJET. */
const SMG: RecoveryCurveParams = {
  ...RECOVERY_CURVE,
  enabled: 1,
  lnCoefficientPct: 10.189,
  constantPct: 91.686,
  minGradeGt: 0.5,
  maxGradeGt: 1.0,
  floorPct: 0,
  capPct: 99,
};

describe('courbe désactivée par défaut — aucun projet impacté sans configuration', () => {
  it('les défauts du code sont neutres', () => {
    expect(isCurveEnabled({ ...RECOVERY_CURVE })).toBe(false);
    expect(recoveryFromCurve(0.92, { ...RECOVERY_CURVE })).toBeNull();
  });

  it('activée mais sans coefficients, reste inopérante', () => {
    expect(recoveryFromCurve(0.92, { ...RECOVERY_CURVE, enabled: 1 })).toBeNull();
  });

  it('aucun coefficient de gisement n\'est écrit en dur dans le code', () => {
    expect(RECOVERY_CURVE.lnCoefficientPct).toBe(0);
    expect(RECOVERY_CURVE.constantPct).toBe(0);
    expect(RECOVERY_CURVE.enabled).toBe(0);
  });
});

describe('courbe auditée — R = a·ln(teneur) + b', () => {
  it('reproduit le chiffre du PFS à la teneur du projet', () => {
    // 10,189 × ln(0,92) + 91,686 = 90,84 %
    const r = recoveryFromCurve(0.92, SMG)!;
    expect(r.recoveryPct).toBeCloseTo(10.189 * Math.log(0.92) + 91.686, 6);
    expect(r.recoveryPct).toBeCloseTo(90.8, 1);
    expect(r.clamped).toBe(false);
  });

  it('couvre la plage annoncée par le rapport (85–92 % de 0,6 à 1,0 g/t)', () => {
    expect(recoveryFromCurve(0.6, SMG)!.recoveryPct).toBeCloseTo(86.5, 0);
    expect(recoveryFromCurve(1.0, SMG)!.recoveryPct).toBeCloseTo(91.7, 0);
  });

  it('croît avec la teneur', () => {
    const grades = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const recs = grades.map(g => recoveryFromCurve(g, SMG)!.recoveryPct);
    for (let i = 1; i < recs.length; i++) expect(recs[i]).toBeGreaterThan(recs[i - 1]);
  });

  it('expose une formule traçable pour le 43-101', () => {
    const r = recoveryFromCurve(0.92, SMG)!;
    expect(r.basis).toMatch(/Courbe auditée/);
    expect(r.basis).toMatch(/10\.189/);
    expect(r.basis).toMatch(/91\.686/);
  });
});

describe('hors plage d\'ajustement — borner, jamais extrapoler', () => {
  it('borne une teneur sous la plage et le signale', () => {
    const r = recoveryFromCurve(0.05, SMG)!;
    expect(r.clamped).toBe(true);
    expect(r.gradeUsedGt).toBe(SMG.minGradeGt);
    expect(r.basis).toMatch(/hors plage/);
  });

  it('borne une teneur au-dessus de la plage', () => {
    const r = recoveryFromCurve(12, SMG)!;
    expect(r.clamped).toBe(true);
    expect(r.gradeUsedGt).toBe(SMG.maxGradeGt);
  });

  it('un log extrapolé ne produit jamais de récupération absurde', () => {
    for (const g of [0.001, 0.01, 50, 500]) {
      const r = recoveryFromCurve(g, SMG)!;
      expect(r.recoveryPct).toBeGreaterThanOrEqual(SMG.floorPct);
      expect(r.recoveryPct).toBeLessThanOrEqual(SMG.capPct);
    }
  });

  it('respecte plancher et plafond configurés', () => {
    const borne = { ...SMG, floorPct: 88, capPct: 90, minGradeGt: 0.01, maxGradeGt: 100 };
    expect(recoveryFromCurve(0.1, borne)!.recoveryPct).toBe(88);
    expect(recoveryFromCurve(10, borne)!.recoveryPct).toBe(90);
  });
});

describe('entrées invalides', () => {
  it('refuse une teneur nulle, négative ou non finie', () => {
    for (const g of [0, -1, NaN, Infinity]) expect(recoveryFromCurve(g, SMG)).toBeNull();
  });

  it('supporte une plage min > max sans planter', () => {
    const r = recoveryFromCurve(0.92, { ...SMG, minGradeGt: 2, maxGradeGt: 0.5 });
    expect(r).not.toBeNull();
    expect(Number.isFinite(r!.recoveryPct)).toBe(true);
  });
});
