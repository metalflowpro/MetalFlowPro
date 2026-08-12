import { describe, it, expect } from 'vitest';
import { simulateMultistageAdsorption } from './adsorptionMultistage';

describe('simulateMultistageAdsorption', () => {
  it('computes realistic CIL tank profiles and adsorption recovery', () => {
    const res = simulateMultistageAdsorption({
      tankCount: 6,
      tankVolumeM3: 500,
      slurryFlowM3H: 250,
      feedGoldSolubleGm3: 2.5,
      feedGoldSolidGt: 1.0,
      carbonConcentrationGl: 15,
      carbonTransferKgH: 1500,
      adsorptionRateK: 0.15,
      mode: 'CIL',
    });

    expect(res.tanks.length).toBe(6);
    // Modèle simplifié de cadrage : récupération d'adsorption élevée (> 85 %),
    // bornée à 100 %. La valeur exacte se recale sur les essais du site.
    expect(res.overallAdsorptionRecoveryPct).toBeGreaterThan(85);
    expect(res.overallAdsorptionRecoveryPct).toBeLessThanOrEqual(100);
    // Profil à contre-courant : la teneur en solution DÉCROÎT de la tête à la queue.
    expect(res.tanks[0].cSolubleGm3).toBeGreaterThan(res.tanks[5].cSolubleGm3);
    // Le charbon de tête (chargé) est plus riche que celui de la dernière cuve.
    expect(res.loadedCarbonGradeGt).toBeGreaterThan(res.tanks[5].qCarbonGt);
    expect(res.totalCarbonInventoryKg).toBeGreaterThan(0);
  });

  it('handles CIP mode with adsorption only', () => {
    const res = simulateMultistageAdsorption({
      tankCount: 8,
      tankVolumeM3: 400,
      slurryFlowM3H: 200,
      feedGoldSolubleGm3: 3.0,
      carbonConcentrationGl: 12,
      carbonTransferKgH: 1200,
      adsorptionRateK: 0.20,
      mode: 'CIP',
    });

    expect(res.tanks.length).toBe(8);
    expect(res.overallAdsorptionRecoveryPct).toBeGreaterThan(95);
  });
});
