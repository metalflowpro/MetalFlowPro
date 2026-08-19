import { describe, it, expect } from 'vitest';
import { derivePortfolioRecovery, type PortfolioRecoveryInput } from './portfolioRecovery';
import { estimateRoutes } from './routeEstimation';
import { recommendAdsorptionCircuit } from './adsorptionCircuit';
import { recommendRefractoryCircuit } from './refractoryCircuit';
import { resolveMetConstants } from '../config/metConstants';

const noCounts = { chem: 0, comminution: 0, knelson: 0, flotation: 0, leaching: 0, mineralogy: 0 };

/** Projet type : lixiviation 48 h mesurée, sans points d'ajustement. */
function base(over: Partial<PortfolioRecoveryInput> = {}): PortfolioRecoveryInput {
  return {
    headGradeGt: 1.2,
    designRecoveryPct: 88,
    throughputTph: 500,
    leach48Pct: 80,
    leach24Pct: null,
    grgPct: null,
    organicCarbonPct: null,
    sulphidePct: null,
    flotationAuRecPct: null,
    auFreePct: null,
    nacnKgT: null,
    auFeedGt: 1.2,
    leachPoints: [],
    flotPoints: [],
    counts: { ...noCounts, leaching: 4 },
    ...over,
  };
}

describe('derivePortfolioRecovery — règle 48 h', () => {
  it('chiffre la globale et l’aligne sur 48 h quand la lixiviation 48 h existe', () => {
    const r = derivePortfolioRecovery(base());
    expect(r.leach48Pct).toBe(80);
    expect(r.globalRecoveryPct).not.toBeNull();
    expect(r.isDesignFallback).toBe(false);
    expect(r.effectiveRecoveryPct).toBe(r.globalRecoveryPct);
    expect(r.routeLabel).toBeTruthy();
  });

  it('retombe sur la récupération design sans aucun essai de lixiviation', () => {
    const r = derivePortfolioRecovery(base({ leach48Pct: null, counts: { ...noCounts } }));
    expect(r.leach48Pct).toBeNull();
    expect(r.globalRecoveryPct).toBeNull();
    expect(r.isDesignFallback).toBe(true);
    expect(r.effectiveRecoveryPct).toBe(88);
    expect(r.routeLabel).toBeNull();
  });

  it('ne pilote PAS la globale depuis le repli 24 h — retombe sur le design', () => {
    const r = derivePortfolioRecovery(base({
      leach48Pct: null, leach24Pct: 72, counts: { ...noCounts, leaching: 3 },
    }));
    // Une route existe (sur repli 24 h) mais elle n'est pas alignée sur 48 h.
    expect(r.globalRecoveryPct).toBeNull();
    expect(r.isDesignFallback).toBe(true);
    expect(r.effectiveRecoveryPct).toBe(88);
  });

  it('reproduit exactement la récupération de la route recommandée du moteur', () => {
    const input = base({ grgPct: 12, counts: { ...noCounts, leaching: 5, knelson: 4 } });
    const met = resolveMetConstants({});
    const ads = recommendAdsorptionCircuit(
      { organicCarbonPct: null, nacnKgT: null, auFeedGt: input.auFeedGt, sulphidePct: null },
      met.adsorptionDecision,
    );
    const refr = recommendRefractoryCircuit(
      { sulphidePct: null, organicCarbonPct: null, arsenicPct: null, carbonatePct: null, throughputTph: input.throughputTph },
      met.refractoryDecision,
    );
    const routes = estimateRoutes({
      metrics: {
        leachRec48Pct: input.leach48Pct,
        leachRec24Pct: null,
        grgPct: input.grgPct,
        organicCarbonPct: null,
        flotationAuRecPct: null,
        sulphidePct: null,
        auFreePct: null,
      },
      counts: input.counts,
      adsorptionCircuit: ads.recommendation,
      stageEfficiencies: met.routeStageEfficiencies,
      refractoryCircuit: refr.recommendation,
      refractoryEfficiencies: met.refractoryCircuits,
    });
    const recommended = routes.find(r => r.recommended)!;
    const r = derivePortfolioRecovery(input);
    expect(r.globalRecoveryPct).toBe(recommended.recovery_pct);
    expect(r.routeLabel).toBe(recommended.route);
  });
});
