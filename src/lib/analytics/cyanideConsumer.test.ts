import { describe, it, expect } from 'vitest';
import { estimateCyanide } from './cyanideConsumer';

describe('estimateCyanide', () => {
  it('cuivre élevé → consommation dominée par le Cu, charge élevée', () => {
    const e = estimateCyanide({ cuPct: 0.5, cuSolubleFraction: 0.3 });
    // Cu soluble 0.5×10×0.3=1.5 kg/t → 1.5×2.7=4.05 ; total 0.35+4.05=4.40
    expect(e.predictedKgT).toBeCloseTo(4.40, 1);
    expect(e.copperShare).toBeGreaterThan(0.5);
    expect(e.cyanicideLoad).toBe('elevee');
    expect(e.message).toMatch(/cuivre/i);
  });

  it('sans cuivre → base seule, charge faible', () => {
    const e = estimateCyanide({ cuPct: 0 });
    expect(e.predictedKgT).toBeCloseTo(0.35, 2);
    expect(e.cyanicideLoad).toBe('faible');
  });

  it('la décomposition somme au prédit', () => {
    const e = estimateCyanide({ cuPct: 0.2, sSulfidePct: 1.5 });
    const sum = e.breakdown.base + e.breakdown.copper + e.breakdown.sulphide;
    expect(sum).toBeCloseTo(e.predictedKgT, 3);
  });

  it('réconciliation avec le mesuré', () => {
    const coherent = estimateCyanide({ cuPct: 0.1, measuredNaCnKgT: undefined });
    expect(coherent.residualKgT).toBeNull();
    const high = estimateCyanide({ cuPct: 0.1, cuSolubleFraction: 0.3, measuredNaCnKgT: 3 });
    expect(high.residualKgT).not.toBeNull();
    expect(high.residualKgT!).toBeGreaterThan(0); // mesuré > prédit
    expect(high.message).toMatch(/cyanicides supplémentaires|non captés/i);
  });
});
