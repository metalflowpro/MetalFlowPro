import { describe, it, expect } from 'vitest';
import {
  computeCalibration, applyCalibration, calibrateRecoveryPct, CALIBRATION_CONFIG,
} from './calibration';

describe('computeCalibration', () => {
  it('renvoie un facteur neutre et confiance faible sans point', () => {
    const r = computeCalibration([]);
    expect(r.factor).toBe(1);
    expect(r.n).toBe(0);
    expect(r.confidence).toBe('low');
  });

  it('facteur 1 quand simulé = mesuré', () => {
    const r = computeCalibration([{ simulated: 90, measured: 90 }, { simulated: 88, measured: 88 }]);
    expect(r.factor).toBeCloseTo(1, 6);
    expect(r.meanBiasPct).toBeCloseTo(0, 6);
  });

  it('facteur > 1 quand l’usine récupère plus que le modèle', () => {
    const r = computeCalibration([{ simulated: 80, measured: 88 }, { simulated: 80, measured: 88 }]);
    expect(r.factor).toBeCloseTo(1.1, 6);
    expect(r.meanBiasPct).toBeCloseTo(10, 6);
  });

  it('borne le facteur et signale le clamp quand le biais est extrême', () => {
    const r = computeCalibration([{ simulated: 10, measured: 100 }]); // ratio 10 → borné à 1.5
    expect(r.factor).toBe(CALIBRATION_CONFIG.maxFactor);
    expect(r.clamped).toBe(true);
  });

  it('gradue la confiance selon le nombre de points', () => {
    const one = computeCalibration([{ simulated: 1, measured: 1 }]);
    expect(one.confidence).toBe('low');
    const five = computeCalibration(Array.from({ length: 5 }, () => ({ simulated: 1, measured: 1 })));
    expect(five.confidence).toBe('high');
  });

  it('ignore les points invalides (simulé ≤ 0, non finis)', () => {
    const r = computeCalibration([{ simulated: 0, measured: 5 }, { simulated: NaN, measured: 5 }, { simulated: 80, measured: 88 }]);
    expect(r.n).toBe(1);
    expect(r.factor).toBeCloseTo(1.1, 6);
  });
});

describe('application', () => {
  it('applyCalibration multiplie', () => {
    expect(applyCalibration(80, 1.1)).toBeCloseTo(88, 6);
  });
  it('calibrateRecoveryPct borne à [0,100]', () => {
    expect(calibrateRecoveryPct(95, 1.2)).toBe(100);
    expect(calibrateRecoveryPct(50, 0.5)).toBe(25);
    expect(calibrateRecoveryPct(10, -1)).toBe(0);
  });
});
