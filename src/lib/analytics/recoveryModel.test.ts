import { describe, it, expect } from 'vitest';
import {
  trainRecoveryModel,
  predictRecovery,
  predictWithCI,
  modelQuality,
  type TrainingSample,
} from './recoveryModel';

describe('recoveryModel', () => {
  const goodSamples: TrainingSample[] = [
    { auGrade: 2.5, sSulfide: 0.5, cOrganic: 0.1, bwi: 14, grg: 40, p80: 75, auFree: 65, recovery: 92 },
    { auGrade: 3.0, sSulfide: 0.3, cOrganic: 0.05, bwi: 12, grg: 50, p80: 75, auFree: 70, recovery: 95 },
    { auGrade: 1.5, sSulfide: 2.0, cOrganic: 0.3, bwi: 18, grg: 20, p80: 106, auFree: 40, recovery: 72 },
    { auGrade: 4.0, sSulfide: 0.2, cOrganic: 0.08, bwi: 11, grg: 55, p80: 53, auFree: 75, recovery: 96 },
    { auGrade: 1.0, sSulfide: 3.5, cOrganic: 0.5, bwi: 20, grg: 15, p80: 150, auFree: 30, recovery: 58 },
    { auGrade: 2.0, sSulfide: 1.0, cOrganic: 0.15, bwi: 15, grg: 35, p80: 90, auFree: 55, recovery: 85 },
    { auGrade: 5.0, sSulfide: 0.1, cOrganic: 0.02, bwi: 10, grg: 60, p80: 75, auFree: 80, recovery: 97 },
    { auGrade: 0.8, sSulfide: 4.0, cOrganic: 0.8, bwi: 22, grg: 10, p80: 150, auFree: 25, recovery: 52 },
  ];

  it('returns null with fewer than 3 samples', () => {
    expect(trainRecoveryModel(goodSamples.slice(0, 2))).toBeNull();
  });

  it('trains a model with 3+ samples', () => {
    const model = trainRecoveryModel(goodSamples);
    expect(model).not.toBeNull();
    expect(model!.sampleCount).toBe(8);
    expect(Number.isFinite(model!.coefficients.intercept)).toBe(true);
  });

  it('produces reasonable R² for correlated data', () => {
    const model = trainRecoveryModel(goodSamples);
    expect(model).not.toBeNull();
    expect(model!.rSquared).toBeGreaterThan(0.5);
  });

  it('predictions are within [0, 100]', () => {
    const model = trainRecoveryModel(goodSamples);
    if (!model) return;
    const pred = predictRecovery(model.coefficients, {
      auGrade: 2.5, sSulfide: 1.0, cOrganic: 0.2, bwi: 15, grg: 35, p80: 75, auFree: 60,
    });
    expect(pred).toBeGreaterThanOrEqual(0);
    expect(pred).toBeLessThanOrEqual(100);
  });

  it('confidence interval brackets the point estimate', () => {
    const model = trainRecoveryModel(goodSamples);
    if (!model) return;
    const ci = predictWithCI(model, {
      auGrade: 2.5, sSulfide: 1.0, cOrganic: 0.2, bwi: 15, grg: 35, p80: 75, auFree: 60,
    });
    expect(ci.lower).toBeLessThanOrEqual(ci.point);
    expect(ci.upper).toBeGreaterThanOrEqual(ci.point);
  });

  it('feature importance is sorted by magnitude descending', () => {
    const model = trainRecoveryModel(goodSamples);
    if (!model) return;
    for (let i = 1; i < model.featureImportance.length; i++) {
      expect(model.featureImportance[i].normalized).toBeLessThanOrEqual(
        model.featureImportance[i - 1].normalized,
      );
    }
  });

  it('RMSE is non-negative', () => {
    const model = trainRecoveryModel(goodSamples);
    if (!model) return;
    expect(model.rmse).toBeGreaterThanOrEqual(0);
  });

  it('modelQuality returns a descriptive string', () => {
    const model = trainRecoveryModel(goodSamples);
    if (!model) return;
    const q = modelQuality(model);
    expect(q).toContain('R²');
    expect(q).toContain('RMSE');
  });

  it('handles degenerate case (all same recovery)', () => {
    const degenerate: TrainingSample[] = goodSamples.map(s => ({ ...s, recovery: 85 }));
    const model = trainRecoveryModel(degenerate);
    if (model) {
      expect(model.rSquared).toBeLessThanOrEqual(1);
    }
  });

  it('enforces physical coefficient signs (never learns P80↑⇒récup↑ nor Au libre↑⇒récup↓)', () => {
    // Jeu artefact : la récupération croît avec un P80 grossier et DÉCROÎT avec
    // l'or libre — deux signes physiquement impossibles (colinéarité). Le modèle
    // sous contraintes doit refuser ces signes (P80 ≤ 0, Au libre ≥ 0, sulfures/
    // C organique ≤ 0, GRG ≥ 0), pas les reproduire.
    const bad: TrainingSample[] = [];
    for (let i = 0; i < 24; i++) {
      const p80 = 45 + (i % 8) * 14;
      const auFree = 45 + (i % 5) * 9;
      const sSulfide = 0.5 + (i % 4) * 0.6;
      bad.push({
        auGrade: 1.5 + (i % 3), sSulfide, cOrganic: 0.05 + (i % 6) * 0.05,
        bwi: 11 + (i % 7) * 0.5, grg: 18 + (i % 9) * 2, p80, auFree,
        recovery: Math.max(50, Math.min(98, 70 + 0.09 * p80 - 0.12 * auFree - 1.0 * sSulfide)),
      });
    }
    const m = trainRecoveryModel(bad)!;
    expect(m.coefficients.p80).toBeLessThanOrEqual(1e-6);      // jamais positif
    expect(m.coefficients.auFree).toBeGreaterThanOrEqual(-1e-6); // jamais négatif
    expect(m.coefficients.sSulfide).toBeLessThanOrEqual(1e-6);
    expect(m.coefficients.grg).toBeGreaterThanOrEqual(-1e-6);
    // Conséquence UI : la récupération prédite ne peut pas AUGMENTER en broyant
    // plus grossier (curseur P80 ↑).
    const lo = predictRecovery(m.coefficients, { auGrade: 2, sSulfide: 1, cOrganic: 0.2, bwi: 13, grg: 25, p80: 60, auFree: 60 });
    const hi = predictRecovery(m.coefficients, { auGrade: 2, sSulfide: 1, cOrganic: 0.2, bwi: 13, grg: 25, p80: 160, auFree: 60 });
    expect(hi).toBeLessThanOrEqual(lo + 1e-6);
  });
});
