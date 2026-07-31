import { describe, it, expect } from 'vitest';
import { canonDomain, isCompositeDomain, derivePregRobbing, domainWeightedMean, domainWeightedCurve, type DomainCurve } from './domains';
import { p80FromPsd } from './psd';

describe('canonDomain', () => {
  it('folds EN/FR spellings of the primary domains onto one key', () => {
    expect(canonDomain('Oxide')).toBe('oxide');
    expect(canonDomain('Oxyde')).toBe('oxide');
    expect(canonDomain('Transitionnel')).toBe('transition');
    expect(canonDomain('transition')).toBe('transition');
    expect(canonDomain('Sulfure')).toBe('sulphide');
    expect(canonDomain('Sulphide')).toBe('sulphide');
  });

  it('folds every spelling of the composite onto one key', () => {
    for (const label of ['mixte', 'Mixte', 'MIXTE', 'mixed', 'Mixed', 'mix', 'mélange', 'mixture']) {
      expect(canonDomain(label)).toBe('mixte');
    }
  });

  it('strips accents and punctuation', () => {
    expect(canonDomain('  Mélange ')).toBe('mixte');
    expect(canonDomain('Transitionnel')).toBe(canonDomain('transitionnel'));
  });

  it('keeps genuinely distinct domains separate', () => {
    // Only exact tokens fold — grade-split domains must not collapse together.
    expect(canonDomain('Sulphide-HG')).not.toBe(canonDomain('Sulphide-LG'));
    expect(canonDomain('Sulphide-HG')).not.toBe('sulphide');
  });

  it('maps empty/absent labels to a stable key', () => {
    expect(canonDomain(null)).toBe('nonclassifie');
    expect(canonDomain('   ')).toBe('nonclassifie');
  });
});

describe('isCompositeDomain', () => {
  it('flags mixte as composite whatever the spelling', () => {
    for (const label of ['mixte', 'Mixte', 'mixed', 'mélange']) {
      expect(isCompositeDomain(label)).toBe(true);
    }
  });

  it('does not flag the primary domains', () => {
    // These three are the only ore sources; a composite is their blend, so
    // treating one of them as composite would drop real feed from the model.
    for (const label of ['Oxide', 'Transitionnel', 'Sulfure', 'oxide', 'transition', 'sulphide']) {
      expect(isCompositeDomain(label)).toBe(false);
    }
  });

  it('does not flag unknown or unclassified domains', () => {
    expect(isCompositeDomain('Saprolite')).toBe(false);
    expect(isCompositeDomain(null)).toBe(false);
  });
});

describe('blend allocation excludes composites', () => {
  // Reproduces the reported defect: 4 sliders at 25% each, where "mixte" is
  // itself made of the other three — the same ore counted twice.
  const domains = [
    { name: 'Oxide', recovery: 95.6 },
    { name: 'Transitionnel', recovery: 89.7 },
    { name: 'Sulfure', recovery: 82.8 },
    { name: 'mixte', recovery: 88.9 },
  ];

  it('leaves exactly the three primary domains allocatable', () => {
    const primary = domains.filter(d => !isCompositeDomain(d.name));
    expect(primary.map(d => d.name)).toEqual(['Oxide', 'Transitionnel', 'Sulfure']);
  });

  it('splits 100% across 3 domains, not 4', () => {
    const primary = domains.filter(d => !isCompositeDomain(d.name));
    const equal = +(100 / primary.length).toFixed(1);
    expect(equal).toBeCloseTo(33.3, 1);
    expect(equal * primary.length).toBeCloseTo(99.9, 1);
  });

  it('computes a blended recovery from the primaries alone', () => {
    const primary = domains.filter(d => !isCompositeDomain(d.name));
    const blended = primary.reduce((s, d) => s + d.recovery / primary.length, 0);
    expect(blended).toBeCloseTo(89.37, 2);
    // The old 4-way split diluted the result with the composite's own value.
    const legacy = domains.reduce((s, d) => s + d.recovery / domains.length, 0);
    expect(legacy).not.toBeCloseTo(blended, 2);
  });

  it('lands close to the measured mixte composite, validating the model', () => {
    const primary = domains.filter(d => !isCompositeDomain(d.name));
    const blended = primary.reduce((s, d) => s + d.recovery / primary.length, 0);
    const measuredMixte = domains.find(d => isCompositeDomain(d.name))!.recovery;
    expect(Math.abs(blended - measuredMixte)).toBeLessThan(2);
  });
});

describe('domainWeightedMean — weighting by the persisted feed share', () => {
  const bwi = [
    ...Array(18).fill(0).map(() => ({ value: 11.9, domain: 'Oxide' })),
    ...Array(23).fill(0).map(() => ({ value: 15.7, domain: 'Transitionnel' })),
    ...Array(41).fill(0).map(() => ({ value: 17.1, domain: 'Sulfure' })),
    ...Array(8).fill(0).map(() => ({ value: 16.4, domain: 'mixte' })),
  ];

  it('falls back to equal weights and says so when no split is saved', () => {
    const agg = domainWeightedMean(bwi);
    expect(agg.weightedByFeed).toBe(false);
    expect(agg.mean).toBeCloseTo((11.9 + 15.7 + 17.1) / 3, 6);
    for (const d of agg.byDomain) expect(d.weight).toBeCloseTo(1 / 3, 6);
  });

  it('follows the saved split and reports it', () => {
    const agg = domainWeightedMean(bwi, { oxide: 10, transition: 20, sulphide: 70 });
    expect(agg.weightedByFeed).toBe(true);
    expect(agg.mean).toBeCloseTo(0.1 * 11.9 + 0.2 * 15.7 + 0.7 * 17.1, 6);
  });

  it('normalises weights that do not sum to 100', () => {
    const a = domainWeightedMean(bwi, { oxide: 1, transition: 2, sulphide: 7 });
    const b = domainWeightedMean(bwi, { oxide: 10, transition: 20, sulphide: 70 });
    expect(a.mean).toBeCloseTo(b.mean!, 10);
  });

  it('a sulphide-heavy feed lands near the measured mixte composite', () => {
    // The measured mixte (16.4) sits well above the equal-split blend (14.9),
    // which is the signal that the real feed is sulphide-leaning.
    const equal = domainWeightedMean(bwi);
    const heavy = domainWeightedMean(bwi, { oxide: 10, transition: 20, sulphide: 70 });
    expect(Math.abs(heavy.mean! - heavy.compositeMean!))
      .toBeLessThan(Math.abs(equal.mean! - equal.compositeMean!));
  });

  it('ignores an all-zero split rather than dividing by zero', () => {
    const agg = domainWeightedMean(bwi, { oxide: 0, transition: 0, sulphide: 0 });
    expect(agg.weightedByFeed).toBe(false);
    expect(agg.mean).toBeCloseTo((11.9 + 15.7 + 17.1) / 3, 6);
  });

  it('ignores a split naming only unknown domains', () => {
    const agg = domainWeightedMean(bwi, { saprolite: 100 });
    expect(agg.weightedByFeed).toBe(false);
    expect(agg.mean).not.toBeNull();
  });

  it('never lets a composite carry feed weight', () => {
    const agg = domainWeightedMean(bwi, { oxide: 25, transition: 25, sulphide: 25, mixte: 25 });
    expect(agg.byDomain.map(d => d.canon)).not.toContain('mixte');
    expect(agg.byDomain.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1, 10);
  });

  it('weights always sum to 1', () => {
    for (const w of [undefined, { oxide: 10, transition: 20, sulphide: 70 }]) {
      expect(domainWeightedMean(bwi, w).byDomain.reduce((s, d) => s + d.weight, 0)).toBeCloseTo(1, 10);
    }
  });
});

describe('derivePregRobbing', () => {
  it('prefers the direct liberation measurement', () => {
    expect(derivePregRobbing(3.2, 0.01)).toBe(true);
    expect(derivePregRobbing(0.1, 5)).toBe(false);
  });

  it('falls back to organic carbon at the same threshold Analytics uses', () => {
    expect(derivePregRobbing(null, 0.5)).toBe(true);
    expect(derivePregRobbing(null, 0.1)).toBe(false);
  });

  it('returns null when neither test exists — unknown is not "no"', () => {
    // The sync used to hardcode `false`, which reported untested domains as clean.
    expect(derivePregRobbing(null, null)).toBeNull();
  });

  it('treats an explicit zero as a real measurement, not a missing one', () => {
    expect(derivePregRobbing(0, null)).toBe(false);
    expect(derivePregRobbing(null, 0)).toBe(false);
  });
});

describe('domainWeightedCurve — P80 de la courbe combinée, pas moyenne des P80', () => {
  // Deux courbes symétriques autour de 100 µm en log-taille : l'une fine
  // (P80 ≈ 50), l'autre grossière (P80 ≈ 200). La combinaison doit passer à 80 %
  // vers 100 µm — ce qu'une moyenne des P80 (125) ne donnerait pas.
  const fine: DomainCurve = { domain: 'oxide', curve: [
    { sieve: 25, passing: 55 }, { sieve: 50, passing: 80 }, { sieve: 100, passing: 96 }, { sieve: 200, passing: 100 },
  ] };
  const coarse: DomainCurve = { domain: 'oxide', curve: [
    { sieve: 25, passing: 8 }, { sieve: 100, passing: 40 }, { sieve: 200, passing: 80 }, { sieve: 400, passing: 100 },
  ] };

  it('lit le P80 sur la courbe combinée, distinct de la moyenne des P80', () => {
    const pooled = domainWeightedCurve([fine, coarse]);
    const p80Combined = p80FromPsd(pooled.curve)!;
    const meanOfP80s = (50 + 200) / 2;               // 125 µm
    expect(p80Combined).toBeGreaterThan(60);
    expect(p80Combined).toBeLessThan(160);
    expect(Math.abs(p80Combined - meanOfP80s)).toBeGreaterThan(10);   // les deux diffèrent bien
  });

  it('pondère par domaine, pas par nombre d\'essais', () => {
    // 3 essais fins en oxide, 1 grossier en sulphide. À poids d'alimentation
    // égaux, la combinaison ne doit pas être tirée vers le fin par le nombre.
    const rows: DomainCurve[] = [
      { ...fine, domain: 'oxide' }, { ...fine, domain: 'oxide' }, { ...fine, domain: 'oxide' },
      { ...coarse, domain: 'sulphide' },
    ];
    const equal = domainWeightedCurve(rows);
    const feedFine = domainWeightedCurve(rows, { oxide: 90, sulphide: 10 });
    const pEqual = p80FromPsd(equal.curve)!;
    const pFine = p80FromPsd(feedFine.curve)!;
    // Charger l'alimentation vers l'oxyde fin doit abaisser le P80 combiné.
    expect(pFine).toBeLessThan(pEqual);
    expect(equal.byDomain.find(d => d.canon === 'oxide')?.weight).toBeCloseTo(0.5, 6);
  });

  it('exclut les composites et les rend séparément comme référence', () => {
    const rows: DomainCurve[] = [fine, coarse, { ...coarse, domain: 'mixte' }];
    const pooled = domainWeightedCurve(rows);
    expect(pooled.nSamples).toBe(2);                 // mixte exclu du combiné
    expect(pooled.compositeN).toBe(1);
    expect(pooled.compositeCurve).not.toBeNull();
  });

  it('signale une pondération à poids égaux faute de partage d\'alimentation', () => {
    expect(domainWeightedCurve([fine, coarse]).weightedByFeed).toBe(false);
    expect(domainWeightedCurve([fine, coarse], { oxide: 100 }).weightedByFeed).toBe(true);
  });

  it('ignore les courbes trop courtes sans planter', () => {
    const pooled = domainWeightedCurve([fine, { domain: 'oxide', curve: [{ sieve: 75, passing: 50 }] }]);
    expect(pooled.nSamples).toBe(1);
    expect(pooled.curve.length).toBeGreaterThanOrEqual(2);
  });

  it('rend une combinaison vide plutôt qu\'une erreur sans données primaires', () => {
    const pooled = domainWeightedCurve([{ domain: 'mixte', curve: fine.curve }]);
    expect(pooled.curve).toHaveLength(0);
    expect(p80FromPsd(pooled.curve)).toBeNull();
  });
});
