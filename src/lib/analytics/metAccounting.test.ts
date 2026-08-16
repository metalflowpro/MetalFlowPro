import { describe, it, expect } from 'vitest';
import {
  twoProductBalance, isSeparable, recoveryFromMasses,
  reconcileSeparationTest, threeProductBalance,
  RECONCILIATION_TOLERANCE_PTS,
} from './metAccounting';

describe('bilan à deux produits — formules 911 Metallurgist', () => {
  // Cas d'école : f = 1, c = 20, t = 0,1 (unités homogènes).
  const A = { feed: 1, concentrate: 20, tailings: 0.1 };

  it('ratio de concentration K = (c−t)/(f−t)', () => {
    expect(twoProductBalance(A)!.concentrationRatio).toBeCloseTo((20 - 0.1) / (1 - 0.1), 10);
  });

  it('tirage massique = 100/K', () => {
    const b = twoProductBalance(A)!;
    expect(b.massPullPct).toBeCloseTo(100 / b.concentrationRatio, 10);
  });

  it('récupération R = 100·c(f−t)/[f(c−t)]', () => {
    expect(twoProductBalance(A)!.recoveryPct)
      .toBeCloseTo((100 * 20 * (1 - 0.1)) / (1 * (20 - 0.1)), 10);
  });

  it('l\'identité R = 100·c/(K·f) donne le même résultat', () => {
    const b = twoProductBalance(A)!;
    expect(b.recoveryPct).toBeCloseTo((100 * A.concentrate) / (b.concentrationRatio * A.feed), 10);
  });

  it('ratio d\'enrichissement = c/f', () => {
    expect(twoProductBalance(A)!.enrichmentRatio).toBeCloseTo(20, 10);
  });

  it('le métal se conserve : masse×titre entrant = concentré + rejet', () => {
    const b = twoProductBalance(A)!;
    const cFrac = b.massPullPct / 100;
    const metalOut = cFrac * A.concentrate + (1 - cFrac) * A.tailings;
    expect(metalOut).toBeCloseTo(A.feed, 10);
  });

  it('récupération et tirage restent physiques sur une large plage', () => {
    for (const c of [5, 20, 100, 500]) {
      for (const t of [0.01, 0.1, 0.5]) {
        const b = twoProductBalance({ feed: 1, concentrate: c, tailings: t });
        if (!b) continue;
        expect(b.recoveryPct, `c=${c} t=${t}`).toBeGreaterThan(0);
        expect(b.recoveryPct, `c=${c} t=${t}`).toBeLessThanOrEqual(100);
        expect(b.massPullPct, `c=${c} t=${t}`).toBeGreaterThan(0);
        expect(b.massPullPct, `c=${c} t=${t}`).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('refus des bilans qui ne décrivent pas une séparation', () => {
  it('refuse un concentré moins riche que le rejet', () => {
    expect(isSeparable({ feed: 1, concentrate: 0.5, tailings: 2 })).toBe(false);
    expect(twoProductBalance({ feed: 1, concentrate: 0.5, tailings: 2 })).toBeNull();
  });

  it('refuse c = t (aucun enrichissement, division par zéro)', () => {
    expect(twoProductBalance({ feed: 1, concentrate: 3, tailings: 3 })).toBeNull();
  });

  it('refuse une alimentation hors de l\'encadrement c > f > t', () => {
    expect(twoProductBalance({ feed: 25, concentrate: 20, tailings: 0.1 })).toBeNull();
    expect(twoProductBalance({ feed: 0.05, concentrate: 20, tailings: 0.1 })).toBeNull();
  });

  it('refuse les valeurs non finies ou négatives', () => {
    expect(twoProductBalance({ feed: NaN, concentrate: 20, tailings: 0.1 })).toBeNull();
    expect(twoProductBalance({ feed: 0, concentrate: 20, tailings: 0.1 })).toBeNull();
    expect(twoProductBalance({ feed: 1, concentrate: 20, tailings: -1 })).toBeNull();
  });
});

describe('récupération par les masses — chemin indépendant', () => {
  it('R = 100·C·c/(F·f)', () => {
    expect(recoveryFromMasses(1000, 1, 45.2, 20)!).toBeCloseTo((100 * 45.2 * 20) / (1000 * 1), 10);
  });

  it('concorde avec le bilan par les titres', () => {
    const A = { feed: 1, concentrate: 20, tailings: 0.1 };
    const b = twoProductBalance(A)!;
    const F = 1000, C = F * b.massPullPct / 100;
    expect(recoveryFromMasses(F, A.feed, C, A.concentrate)!).toBeCloseTo(b.recoveryPct, 8);
  });

  it('refuse une alimentation sans métal', () => {
    expect(recoveryFromMasses(0, 1, 45, 20)).toBeNull();
    expect(recoveryFromMasses(1000, 0, 45, 20)).toBeNull();
  });
});

describe('réconciliation d\'un essai LIMS', () => {
  const A = { feed: 1, concentrate: 20, tailings: 0.1 };
  const computed = twoProductBalance(A)!;

  it('valide un essai dont la récupération annoncée colle aux titres', () => {
    const rec = reconcileSeparationTest(A, { recoveryPct: computed.recoveryPct })!;
    expect(rec.consistent).toBe(true);
    expect(rec.warnings).toHaveLength(0);
    expect(rec.deltaPts).toBeCloseTo(0, 6);
  });

  it('signale une récupération annoncée incompatible avec les titres', () => {
    const rec = reconcileSeparationTest(A, { recoveryPct: computed.recoveryPct + 10 })!;
    expect(rec.consistent).toBe(false);
    expect(rec.warnings[0]).toMatch(/Récupération annoncée/);
    expect(rec.deltaPts).toBeCloseTo(10, 1);
  });

  it('signale un tirage massique incompatible', () => {
    const rec = reconcileSeparationTest(A, { massPullPct: computed.massPullPct + 20 })!;
    expect(rec.consistent).toBe(false);
    expect(rec.warnings.some(w => /Tirage massique/.test(w))).toBe(true);
  });

  it('tolère un écart sous le seuil', () => {
    const rec = reconcileSeparationTest(A, {
      recoveryPct: computed.recoveryPct + RECONCILIATION_TOLERANCE_PTS - 0.1,
    })!;
    expect(rec.consistent).toBe(true);
  });

  it('sans valeur annoncée, recalcule sans rien signaler', () => {
    const rec = reconcileSeparationTest(A)!;
    expect(rec.reportedPct).toBeNull();
    expect(rec.deltaPts).toBeNull();
    expect(rec.consistent).toBe(true);
    expect(rec.computedPct).toBeCloseTo(computed.recoveryPct, 10);
  });

  it('renvoie null sur des titres non séparables', () => {
    expect(reconcileSeparationTest({ feed: 1, concentrate: 1, tailings: 1 })).toBeNull();
  });
});

describe('bilan à trois produits (bi-métallique)', () => {
  // Partage construit à l'envers depuis un partage massique connu, pour que le
  // test vérifie l'algèbre et non un jeu de chiffres arbitraire.
  const x1 = 0.10, x2 = 0.15;                     // fractions massiques des concentrés
  const build = (c1: number, c2: number, tl: number) => ({
    feed: x1 * c1 + x2 * c2 + (1 - x1 - x2) * tl,
    conc1: c1, conc2: c2, tailings: tl,
  });
  const cu = build(25, 1.2, 0.08);                // Cu : riche au concentré 1
  const zn = build(2.0, 48, 0.30);                // Zn : riche au concentré 2

  it('retrouve le partage massique des deux concentrés', () => {
    const b = threeProductBalance(cu, zn)!;
    expect(b.conc1Fraction).toBeCloseTo(x1, 8);
    expect(b.conc2Fraction).toBeCloseTo(x2, 8);
  });

  it('calcule la récupération de chaque métal dans SON concentré', () => {
    const b = threeProductBalance(cu, zn)!;
    expect(b.metalARecoveryC1Pct).toBeCloseTo((100 * x1 * cu.conc1) / cu.feed, 8);
    expect(b.metalBRecoveryC2Pct).toBeCloseTo((100 * x2 * zn.conc2) / zn.feed, 8);
    for (const r of [b.metalARecoveryC1Pct, b.metalBRecoveryC2Pct]) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(100);
    }
  });

  it('refuse un système indéterminé (les deux métaux ne discriminent pas)', () => {
    const same = build(10, 10, 0.1);
    expect(threeProductBalance(same, same)).toBeNull();
  });

  it('refuse un partage massique non physique', () => {
    expect(threeProductBalance(
      { feed: 50, conc1: 1, conc2: 1, tailings: 0.1 },
      { feed: 50, conc1: 1, conc2: 2, tailings: 0.1 },
    )).toBeNull();
  });
});
