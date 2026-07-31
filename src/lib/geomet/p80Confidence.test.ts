import { describe, it, expect } from 'vitest';
import { p80Confidence } from './p80Confidence';
import type { PsdPoint } from './psd';

// Tamis serrés autour de 80 % passant → incertitude faible.
const narrow: PsdPoint[] = [
  { sieve: 53, passing: 60 }, { sieve: 74, passing: 75 }, { sieve: 90, passing: 83 },
  { sieve: 106, passing: 90 }, { sieve: 150, passing: 97 },
];
// Tamis très espacés autour de 80 % → incertitude élevée.
const wide: PsdPoint[] = [
  { sieve: 53, passing: 55 }, { sieve: 106, passing: 75 }, { sieve: 212, passing: 88 }, { sieve: 300, passing: 95 },
];

describe('p80Confidence', () => {
  it('encadre le P80 (lower < p80 < upper)', () => {
    const c = p80Confidence(narrow)!;
    expect(c).not.toBeNull();
    expect(c.lower).toBeLessThan(c.p80);
    expect(c.upper).toBeGreaterThan(c.p80);
  });

  it('bracket serré ⇒ incertitude plus faible que bracket large', () => {
    const cn = p80Confidence(narrow)!;
    const cw = p80Confidence(wide)!;
    expect(cn.relUncertaintyPct).toBeLessThan(cw.relUncertaintyPct);
    expect(cw.relUncertaintyPct).toBeGreaterThan(25); // tamis trop espacés
  });

  it('utilise le fit Rosin-Rammler quand possible', () => {
    const c = p80Confidence(narrow)!;
    expect(c.method).toBe('bracket+rr');
  });

  it('moins de 2 points → null', () => {
    expect(p80Confidence([{ sieve: 75, passing: 80 }])).toBeNull();
  });
});
