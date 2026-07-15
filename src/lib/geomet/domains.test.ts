import { describe, it, expect } from 'vitest';
import { canonDomain, isCompositeDomain, derivePregRobbing } from './domains';

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
