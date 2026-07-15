import { describe, it, expect } from 'vitest';
import { domainCutoffs, blendedCutoff, throughputForHardness, blendedProperty, type CutoffInputs } from './cutoff';
import { TROY_OZ_GRAMS } from '../config/constants';

// The reported project: soft high-recovery oxide vs hard low-recovery sulphide.
const DOMAINS = [
  { canon: 'oxide',      label: 'Oxide',         recoveryPct: 95.6, bwiKwhT: 11.9, feedShare: 1 / 3 },
  { canon: 'transition', label: 'Transitionnel', recoveryPct: 89.7, bwiKwhT: 15.7, feedShare: 1 / 3 },
  { canon: 'sulphide',   label: 'Sulfure',       recoveryPct: 82.8, bwiKwhT: 17.1, feedShare: 1 / 3 },
];

const INP: CutoffInputs = {
  goldPriceUsdOz: 2000,
  processCostExGrindUsdT: 12,
  miningCostUsdT: 2.8,
  strippingRatio: 4,
  gaCostUsdT: 1.8,
  royaltyFraction: 0.045,
  elecCostUsdKwh: 0.067,
  f80Um: 12000,
  p80Um: 75,
};

describe('domainCutoffs', () => {
  it('gives each domain its own cut-off — the point of the model', () => {
    const cuts = domainCutoffs(DOMAINS, INP);
    const grades = cuts.map(c => c.marginalCutoffGt);
    expect(new Set(grades.map(g => g.toFixed(4))).size).toBe(3);
  });

  it('demands more grade from hard, low-recovery ore than from soft, high-recovery ore', () => {
    const [oxide, , sulphide] = domainCutoffs(DOMAINS, INP);
    // Sulphide recovers less AND costs more to grind: it must carry more gold.
    expect(sulphide.marginalCutoffGt).toBeGreaterThan(oxide.marginalCutoffGt);
    expect(sulphide.breakevenCutoffGt).toBeGreaterThan(oxide.breakevenCutoffGt);
  });

  it('prices each domain grinding energy from its own BWi', () => {
    const [oxide, , sulphide] = domainCutoffs(DOMAINS, INP);
    expect(sulphide.grindEnergyKwhT).toBeGreaterThan(oxide.grindEnergyKwhT);
    expect(sulphide.processCostUsdT).toBeGreaterThan(oxide.processCostUsdT);
  });

  it('breakeven exceeds marginal — mining and G&A are extra to carry', () => {
    for (const c of domainCutoffs(DOMAINS, INP)) {
      expect(c.breakevenCutoffGt).toBeGreaterThan(c.marginalCutoffGt);
    }
  });

  it('matches the closed-form marginal cut-off', () => {
    const [oxide] = domainCutoffs(DOMAINS, INP);
    const revPerG = (2000 / TROY_OZ_GRAMS) * (95.6 / 100) * (1 - 0.045);
    expect(oxide.revenuePerGramUsd).toBeCloseTo(revPerG, 10);
    expect(oxide.marginalCutoffGt).toBeCloseTo(oxide.processCostUsdT / revPerG, 10);
  });

  it('lowers the cut-off when gold is worth more', () => {
    const cheap = domainCutoffs(DOMAINS, { ...INP, goldPriceUsdOz: 1200 })[0];
    const dear = domainCutoffs(DOMAINS, { ...INP, goldPriceUsdOz: 3000 })[0];
    expect(dear.marginalCutoffGt).toBeLessThan(cheap.marginalCutoffGt);
  });

  it('raises the cut-off when royalties bite', () => {
    const none = domainCutoffs(DOMAINS, { ...INP, royaltyFraction: 0 })[0];
    const heavy = domainCutoffs(DOMAINS, { ...INP, royaltyFraction: 0.3 })[0];
    expect(heavy.marginalCutoffGt).toBeGreaterThan(none.marginalCutoffGt);
  });

  it('returns an infinite cut-off rather than a negative one at zero recovery', () => {
    // Nothing is payable if nothing is recovered — must not silently divide by zero.
    const [dead] = domainCutoffs([{ ...DOMAINS[0], recoveryPct: 0 }], INP);
    expect(dead.marginalCutoffGt).toBe(Infinity);
  });

  it('produces cut-offs in a plausible gold-mining band', () => {
    for (const c of domainCutoffs(DOMAINS, INP)) {
      expect(c.marginalCutoffGt).toBeGreaterThan(0.05);
      expect(c.marginalCutoffGt).toBeLessThan(3);
    }
  });
});

describe('blendedCutoff', () => {
  it('is the feed-weighted mean of the domain cut-offs', () => {
    const cuts = domainCutoffs(DOMAINS, INP);
    const blended = blendedCutoff(cuts, 'marginalCutoffGt')!;
    const manual = cuts.reduce((s, c) => s + c.marginalCutoffGt / 3, 0);
    expect(blended).toBeCloseTo(manual, 10);
  });

  it('follows the feed split rather than treating domains equally', () => {
    const cuts = domainCutoffs(DOMAINS, INP);
    const sulphideHeavy = domainCutoffs(
      DOMAINS.map(d => ({ ...d, feedShare: d.canon === 'sulphide' ? 0.8 : 0.1 })), INP,
    );
    expect(blendedCutoff(sulphideHeavy, 'marginalCutoffGt')!)
      .toBeGreaterThan(blendedCutoff(cuts, 'marginalCutoffGt')!);
  });

  it('returns null when nothing is fed', () => {
    expect(blendedCutoff(domainCutoffs(DOMAINS.map(d => ({ ...d, feedShare: 0 })), INP), 'marginalCutoffGt')).toBeNull();
    expect(blendedCutoff([], 'marginalCutoffGt')).toBeNull();
  });
});

describe('throughputForHardness', () => {
  it('returns the nameplate rate at the reference hardness', () => {
    expect(throughputForHardness(500, 15, 15, 12000, 75)).toBeCloseTo(500, 6);
  });

  it('slows the mill on harder ore', () => {
    expect(throughputForHardness(500, 15, 18, 12000, 75)).toBeLessThan(500);
  });

  it('speeds the mill up on softer ore', () => {
    expect(throughputForHardness(500, 15, 11.9, 12000, 75)).toBeGreaterThan(500);
  });

  it('scales inversely with specific energy — the power-limited relation', () => {
    // Twice the work index at fixed installed power => half the tonnage.
    expect(throughputForHardness(500, 10, 20, 12000, 75)).toBeCloseTo(250, 4);
  });

  it('quantifies the miss a fixed-tph schedule makes on sulphide feed', () => {
    const nameplate = 500;
    const onSulphide = throughputForHardness(nameplate, 14.9, 17.1, 12000, 75);
    const shortfall = (nameplate - onSulphide) / nameplate;
    expect(shortfall).toBeGreaterThan(0.1); // >10% over-stated by a constant-tph plan
  });

  it('falls back to nameplate rather than dividing by zero', () => {
    expect(throughputForHardness(500, 15, 15, 100, 500)).toBe(500);
  });
});

describe('blendedProperty', () => {
  it('weights by feed share', () => {
    expect(blendedProperty(DOMAINS, d => d.bwiKwhT)).toBeCloseTo((11.9 + 15.7 + 17.1) / 3, 6);
  });

  it('returns null when nothing is fed', () => {
    expect(blendedProperty(DOMAINS.map(d => ({ ...d, feedShare: 0 })), d => d.bwiKwhT)).toBeNull();
  });
});
