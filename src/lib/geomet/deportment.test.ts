import { describe, it, expect } from 'vitest';
import {
  normalizeDeportment, liberationGain, accessibleByClass, pregRobSeverity,
  predictRecoveryAtP80, recoveryVsP80Curve, liberationLimitedP80,
  DEFAULT_DEPORTMENT_MODEL, type GoldDeportment,
} from './deportment';

const DEP: GoldDeportment = { free: 50, sulphide: 20, silicate: 15, oxide: 5, occluded: 8, pregRob: 2 };
const REF = { p80RefUm: 100, grgPct: 40, cOrgPct: 0.5 };

describe('normalizeDeportment', () => {
  it('renormalise à 100 %', () => {
    const d = normalizeDeportment({ free: 25, sulphide: 10, silicate: 7.5, oxide: 2.5, occluded: 4, pregRob: 1 })!;
    const sum = d.free + d.sulphide + d.silicate + d.oxide + d.occluded + d.pregRob;
    expect(sum).toBeCloseTo(100, 6);
    expect(d.free).toBeCloseTo(50, 4); // proportions conservées
  });
  it('null → 0, et somme nulle → null', () => {
    const d = normalizeDeportment({ free: 100, sulphide: null as unknown as number })!;
    expect(d.free).toBeCloseTo(100, 6);
    expect(normalizeDeportment({})).toBeNull();
  });
});

describe('liberationGain', () => {
  const s = DEFAULT_DEPORTMENT_MODEL.sulphide;
  it('nul au P80 de référence', () => {
    expect(liberationGain(s, 100, 100)).toBeCloseTo(0, 9);
  });
  it('croît en broyant plus fin, borné par maxLiberable', () => {
    const g50 = liberationGain(s, 50, 100);
    const g10 = liberationGain(s, 10, 100);
    expect(g50).toBeGreaterThan(0);
    expect(g10).toBeGreaterThan(g50);
    expect(g10).toBeLessThanOrEqual(s.maxLiberable + 1e-9);
  });
});

describe('accessibleByClass', () => {
  it('or libre constant ; verrouillé nul à la réf. puis croissant', () => {
    const atRef = accessibleByClass(DEP, 100, REF);
    expect(atRef.free).toBe(50);
    expect(atRef.sulphide).toBeCloseTo(0, 9);
    expect(atRef.total).toBeCloseTo(50, 6);
    const finer = accessibleByClass(DEP, 50, REF);
    expect(finer.sulphide).toBeGreaterThan(0);
    expect(finer.total).toBeGreaterThan(atRef.total);
  });
});

describe('pregRobSeverity', () => {
  it('proportionnel au carbone organique, saturé à 1', () => {
    expect(pregRobSeverity(0.25)).toBeCloseTo(0.5, 6);
    expect(pregRobSeverity(0.5)).toBeCloseTo(1, 6);
    expect(pregRobSeverity(2)).toBe(1);
    expect(pregRobSeverity(null)).toBeCloseTo(0.5, 6); // défaut modéré
  });
});

describe('predictRecoveryAtP80', () => {
  it('monotone croissante en broyant plus fin', () => {
    const rCoarse = predictRecoveryAtP80(DEP, 120, REF);
    const rRef = predictRecoveryAtP80(DEP, 100, REF);
    const rFine = predictRecoveryAtP80(DEP, 40, REF);
    expect(rRef).toBeGreaterThanOrEqual(rCoarse);
    expect(rFine).toBeGreaterThan(rRef);
  });
  it('à la référence : accessible = or libre, moins preg-robbing', () => {
    // 50 % accessible × 0.98 − (2 × severité 1) = 49 − 2 = 47
    expect(predictRecoveryAtP80(DEP, 100, REF)).toBeCloseTo(47, 2);
  });
  it("l'or occlus n'est jamais récupéré (plafond réfractaire)", () => {
    const rUltraFine = predictRecoveryAtP80(DEP, 1, REF);
    expect(rUltraFine).toBeLessThan(100 - DEP.occluded); // < 92
  });
  it('bornée 0–100', () => {
    const hot: GoldDeportment = { free: 99, sulphide: 1, silicate: 0, oxide: 0, occluded: 0, pregRob: 0 };
    const r = predictRecoveryAtP80(hot, 1, { p80RefUm: 100, cOrgPct: 0 });
    expect(r).toBeLessThanOrEqual(100);
    expect(r).toBeGreaterThanOrEqual(0);
  });
});

describe('recoveryVsP80Curve', () => {
  it('produit une courbe monotone décroissante en P80', () => {
    const curve = recoveryVsP80Curve(DEP, REF, { p80Min: 20, p80Max: 120, step: 20 });
    expect(curve.length).toBe(6);
    for (let i = 1; i < curve.length; i++) {
      // P80 croît → récupération décroît (ou égale)
      expect(curve[i].recovery).toBeLessThanOrEqual(curve[i - 1].recovery + 1e-6);
    }
  });
});

describe('liberationLimitedP80', () => {
  it('détecte le sur-broyage (gain marginal sous le seuil)', () => {
    // Profil marginal (bwi 15, f80 2000) : ~4 pt/kWh à 95 µm → ~0.26 à 20 µm.
    // Un seuil exigeant de 1 pt/kWh place le P80 de libération vers 35 µm.
    const res = liberationLimitedP80(DEP, REF, { bwiKwhT: 15, f80Um: 2000, econThresholdPtPerKwh: 1.0 });
    expect(res).not.toBeNull();
    expect(res!.atFineBound).toBe(false);
    expect(res!.p80Um).toBeGreaterThan(20);
    expect(res!.p80Um).toBeLessThan(100);
    expect(res!.ceilingPct).toBeGreaterThan(res!.recoveryPct - 1e-6);
  });
  it('seuil quasi nul ⇒ paie jusqu’à la borne fine (atFineBound)', () => {
    // Scan borné à P80ref (100) → toute la plage 30–100 est plus fine que la réf.
    // et gagne encore ; avec un seuil quasi nul, on atteint la borne fine.
    const res = liberationLimitedP80(DEP, REF, { bwiKwhT: 15, f80Um: 2000, econThresholdPtPerKwh: 1e-9, p80Min: 30 });
    expect(res!.atFineBound).toBe(true);
    expect(res!.p80Um).toBeCloseTo(30, 0);
  });
  it('entrées invalides → null', () => {
    expect(liberationLimitedP80(DEP, REF, { bwiKwhT: 0, f80Um: 2000 })).toBeNull();
  });
});
