import { describe, it, expect } from 'vitest';
import {
  METALS, getMetal, isKnownMetal, knownMetalSymbols, defaultMetalPrices,
} from './registry';
import { TROY_OZ_GRAMS, LB_PER_TONNE } from '../config/constants';

describe('registre des métaux', () => {
  it('expose les métaux d’un porphyre Cu-Au-Mo', () => {
    for (const s of ['Cu', 'Au', 'Mo']) expect(isKnownMetal(s)).toBe(true);
    expect(isKnownMetal('Xx')).toBe(false);
  });

  it('facteur pivot d’un métal de base (%) = LB_PER_TONNE/100 livres par tonne et par %', () => {
    expect(getMetal('Cu').massPerTonnePerGrade).toBeCloseTo(LB_PER_TONNE / 100, 6);
    // 1 % dans 1 t ≈ 22,05 lb — repère industrie.
    expect(getMetal('Cu').massPerTonnePerGrade).toBeCloseTo(22.0462, 3);
  });

  it('facteur pivot d’un précieux (g/t) = 1/31,1035 oz troy par tonne et par g/t', () => {
    expect(getMetal('Au').massPerTonnePerGrade).toBeCloseTo(1 / TROY_OZ_GRAMS, 8);
  });

  it('getMetal lève sur un symbole inconnu (bug d’appel, pas donnée à ignorer)', () => {
    expect(() => getMetal('Zz')).toThrow(/inconnu/);
  });

  it('les prix par défaut couvrent tous les symboles connus', () => {
    const prices = defaultMetalPrices();
    for (const s of knownMetalSymbols()) expect(prices[s]).toBeGreaterThan(0);
  });

  it('unités de teneur/prix cohérentes par catégorie', () => {
    for (const def of Object.values(METALS)) {
      if (def.category === 'precious') {
        expect(def.gradeUnit).toBe('g/t');
        expect(def.priceUnit).toBe('usd/oz');
      } else if (def.category === 'base') {
        expect(def.gradeUnit).toBe('pct');
        expect(def.priceUnit).toBe('usd/lb');
      }
    }
  });
});
