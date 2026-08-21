import { describe, it, expect } from 'vitest';
import {
  emptyPsd, normalizePsd, psdToPassingCurve, psdP80, blendPsd,
  addComponents, scaleComponents, gradeGpt,
  closureError, isBalanceClosed, componentClosure,
  type Psd, type ComponentMap,
} from './streamModel';

describe('streamModel — PSD (§5)', () => {
  it('normalise les fractions à somme 1', () => {
    const psd: Psd = { sizeBinsUm: [10, 20, 40], massFractions: [1, 2, 1] };
    const n = normalizePsd(psd);
    expect(n.massFractions.reduce((s, f) => s + f, 0)).toBeCloseTo(1, 12);
    expect(n.massFractions).toEqual([0.25, 0.5, 0.25]);
  });

  it('PSD à somme nulle reste à zéro (pas de NaN)', () => {
    const n = normalizePsd({ sizeBinsUm: [10, 20], massFractions: [0, 0] });
    expect(n.massFractions).toEqual([0, 0]);
  });

  it('construit une courbe de passant cumulé croissante finissant à 100', () => {
    const curve = psdToPassingCurve({ sizeBinsUm: [10, 50, 100], massFractions: [0.2, 0.5, 0.3] });
    expect(curve.map(p => p.passing)).toEqual([20, 70, 100]);
    expect(curve.map(p => p.sieve)).toEqual([10, 50, 100]);
  });

  it('calcule le P80 par interpolation log (réutilise p80FromPsd)', () => {
    // 80 % passant est encadré par 50 µm (70 %) et 100 µm (100 %).
    const p80 = psdP80({ sizeBinsUm: [10, 50, 100], massFractions: [0.2, 0.5, 0.3] });
    const expected = Math.exp(Math.log(50) + ((80 - 70) / (100 - 70)) * (Math.log(100) - Math.log(50)));
    expect(p80).toBeCloseTo(expected, 6);
    expect(p80!).toBeGreaterThan(50);
    expect(p80!).toBeLessThan(100);
  });

  it('P80 null si une seule classe', () => {
    expect(psdP80({ sizeBinsUm: [75], massFractions: [1] })).toBeNull();
  });

  it('mélange les PSD pondéré par la masse solide (§7.1)', () => {
    const a: Psd = { sizeBinsUm: [10, 100], massFractions: [0.8, 0.2] }; // fin
    const b: Psd = { sizeBinsUm: [10, 100], massFractions: [0.2, 0.8] }; // grossier
    const mix = blendPsd([{ solidsMass: 75, psd: a }, { solidsMass: 25, psd: b }]);
    // f_out[0] = (75*0.8 + 25*0.2) / 100 = 0.65
    expect(mix.massFractions[0]).toBeCloseTo(0.65, 12);
    expect(mix.massFractions[1]).toBeCloseTo(0.35, 12);
  });

  it('mélange PSD ignore les courants sans solide et rend vide si aucun', () => {
    const a: Psd = { sizeBinsUm: [10, 100], massFractions: [0.5, 0.5] };
    const mix = blendPsd([{ solidsMass: 0, psd: a }, { solidsMass: 0, psd: emptyPsd() }]);
    expect(mix).toEqual(emptyPsd());
  });

  it('mélange PSD lève si les bornes de classes diffèrent', () => {
    const a: Psd = { sizeBinsUm: [10, 100], massFractions: [0.5, 0.5] };
    const b: Psd = { sizeBinsUm: [20, 200], massFractions: [0.5, 0.5] };
    expect(() => blendPsd([{ solidsMass: 1, psd: a }, { solidsMass: 1, psd: b }])).toThrow();
  });
});

describe('streamModel — composants (§3, §4)', () => {
  it('somme composant par composant', () => {
    const m1: ComponentMap = { Au: 0.5, SiO2: 400, NaCN: 0 };
    const m2: ComponentMap = { Au: 0.25, FeS2: 18 };
    expect(addComponents([m1, m2])).toEqual({ Au: 0.75, SiO2: 400, NaCN: 0, FeS2: 18 });
  });

  it('met à l\'échelle les composants (split)', () => {
    expect(scaleComponents({ Au: 1, SiO2: 400 }, 0.35)).toEqual({ Au: 0.35, SiO2: 140 });
  });

  it('dérive la teneur des masses (§3) et évite la division par zéro', () => {
    // 840 g/h d'Au sur 840 t/h → 1 g/t.
    expect(gradeGpt(840, 840)).toBeCloseTo(1, 12);
    expect(gradeGpt(100, 0)).toBe(0);
  });
});

describe('streamModel — fermeture de bilan (§4, §9)', () => {
  it('erreur relative de fermeture', () => {
    expect(closureError(100, 100)).toBe(0);
    expect(closureError(100, 99)).toBeCloseTo(0.01, 12);
    expect(closureError(0, 0)).toBe(0);
    expect(closureError(0, 5)).toBe(1);
  });

  it('verdict sous tolérance', () => {
    expect(isBalanceClosed(100, 99.95, 0.001)).toBe(true);
    expect(isBalanceClosed(100, 99, 0.001)).toBe(false);
  });

  it('fermeture composant par composant', () => {
    const res = componentClosure({ Au: 1, Ag: 2 }, { Au: 1, Ag: 1.5 }, 0.01);
    expect(res.Au.closed).toBe(true);
    expect(res.Au.error).toBe(0);
    expect(res.Ag.closed).toBe(false);
    expect(res.Ag.error).toBeCloseTo(0.25, 12);
  });
});
