import { describe, it, expect } from 'vitest';
import { fitLeachKinetics, leachAt, type LeachPoint } from './leachKinetics';

// Données synthétiques 1er ordre R(t)=88·(1−e^(−0.15 t)), non saturées (t≤12).
const rInfTrue = 88, kTrue = 0.15;
const synth: LeachPoint[] = [2, 4, 8, 12].map(h => ({ hours: h, recoveryPct: +leachAt({ rInf: rInfTrue, k: kTrue }, h).toFixed(2) }));

describe('fitLeachKinetics', () => {
  it('récupère R∞ et k depuis des points 1er ordre', () => {
    const kin = fitLeachKinetics(synth)!;
    expect(kin).not.toBeNull();
    expect(kin.rInf).toBeGreaterThan(82);
    expect(kin.rInf).toBeLessThan(95);
    expect(kin.k).toBeGreaterThan(0.10);
    expect(kin.k).toBeLessThan(0.22);
    expect(kin.rSquared).toBeGreaterThan(0.98);
  });

  it('t95 ≈ ln(20)/k et prédiction croissante', () => {
    const kin = fitLeachKinetics(synth)!;
    expect(kin.t95).toBeGreaterThan(12);
    expect(kin.t95).toBeLessThan(35);
    expect(leachAt(kin, 24)).toBeGreaterThan(leachAt(kin, 4));
  });

  it('classe la lenteur cinétique', () => {
    const fast = fitLeachKinetics([2, 4, 8].map(h => ({ hours: h, recoveryPct: +leachAt({ rInf: 92, k: 0.5 }, h).toFixed(2) })))!;
    expect(fast.slowness).toBe('rapide');
    const slow = fitLeachKinetics([4, 12, 24, 48].map(h => ({ hours: h, recoveryPct: +leachAt({ rInf: 70, k: 0.03 }, h).toFixed(2) })))!;
    expect(['lent', 'tres_lent']).toContain(slow.slowness);
  });

  it('moins de 2 points → null', () => {
    expect(fitLeachKinetics([{ hours: 24, recoveryPct: 80 }])).toBeNull();
  });
});
