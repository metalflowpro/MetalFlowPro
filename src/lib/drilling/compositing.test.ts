import { describe, it, expect } from 'vitest';
import { compositeByLength, type RawSample } from './compositing';

/** Somme du métal contenu (Σ teneur × longueur) — invariant de conservation. */
function metal(samples: { value: number | null; length?: number; from?: number; to?: number }[]): number {
  return samples.reduce((s, x) => {
    const len = x.length ?? (x.to! - x.from!);
    return s + (x.value ?? 0) * len;
  }, 0);
}

describe('compositeByLength', () => {
  it('échantillons homogènes 1 m → composites 2 m à la même teneur', () => {
    const raw: RawSample[] = Array.from({ length: 6 }, (_, i) => ({ from: i, to: i + 1, value: 1.0 }));
    const comps = compositeByLength(raw, { length: 2 });
    expect(comps).toHaveLength(3);
    for (const c of comps) {
      expect(c.value).toBeCloseTo(1.0, 9);
      expect(c.length).toBe(2);
      expect(c.coverage).toBeCloseTo(1, 9);
    }
  });

  it('pondère par la longueur, pas par le nombre d’échantillons', () => {
    // [0-1]=2,0 puis [1-2]=0 → composite 2 m = (2·1 + 0·1)/2 = 1,0
    const raw: RawSample[] = [
      { from: 0, to: 1, value: 2.0 },
      { from: 1, to: 2, value: 0.0 },
    ];
    const [c] = compositeByLength(raw, { length: 2 });
    expect(c.value).toBeCloseTo(1.0, 9);
  });

  it('conserve le métal contenu quand la couverture est complète', () => {
    const raw: RawSample[] = [
      { from: 0, to: 1.5, value: 3.0 },
      { from: 1.5, to: 3, value: 1.0 },
      { from: 3, to: 6, value: 0.5 },
    ];
    const comps = compositeByLength(raw, { length: 2 });
    expect(metal(comps)).toBeCloseTo(metal(raw), 6);
  });

  it('écarte un composite trop lacunaire (fenêtre pleine, couverture < seuil)', () => {
    // Fenêtre [0-2] dosée seulement sur [0-0,4] (le 2e échantillon bas force une
    // fenêtre pleine de 2 m) → couverture 0,2 < 0,5 → écarté ; [4-6] conservé.
    const raw: RawSample[] = [
      { from: 0, to: 0.4, value: 5 },
      { from: 4, to: 6, value: 1 },
    ];
    const kept = compositeByLength(raw, { length: 2, minCoverage: 0.5 });
    expect(kept).toHaveLength(1);
    expect(kept[0].from).toBe(4);
    // Seuil abaissé → la fenêtre lacunaire réapparaît avec sa couverture réelle 0,2
    const low = compositeByLength(raw, { length: 2, minCoverage: 0.1 });
    const lacunaire = low.find(c => c.from === 0)!;
    expect(lacunaire.coverage).toBeCloseTo(0.2, 9);
    expect(lacunaire.value).toBeCloseTo(5, 9);
  });

  it('ignore les valeurs nulles/non dosées sans fausser la moyenne', () => {
    const raw: RawSample[] = [
      { from: 0, to: 1, value: 4 },
      { from: 1, to: 2, value: null },
    ];
    const [c] = compositeByLength(raw, { length: 2, minCoverage: 0.4 });
    expect(c.value).toBeCloseTo(4, 9); // seule la partie dosée compte
    expect(c.coverage).toBeCloseTo(0.5, 9);
  });

  it('lève sur une longueur cible invalide', () => {
    expect(() => compositeByLength([], { length: 0 })).toThrow(/invalide/);
  });

  it('série vide → aucun composite', () => {
    expect(compositeByLength([], { length: 2 })).toEqual([]);
  });
});
