import { describe, it, expect } from 'vitest';
import { resolveMetConstants, sanitizeOverrides, MET_CONSTANT_GROUPS } from './metConstants';
import { ROUTE_STAGE_EFFICIENCIES } from '../analytics/routeEstimation';
import { ADSORPTION_DECISION_THRESHOLDS } from '../analytics/adsorptionCircuit';

describe('metConstants', () => {
  it('sans surcharge → renvoie exactement les défauts', () => {
    const c = resolveMetConstants(null);
    expect(c.routeStageEfficiencies).toEqual({ ...ROUTE_STAGE_EFFICIENCIES });
  });

  it('surcharge partielle → seuls les champs fournis changent', () => {
    const c = resolveMetConstants({ routeStageEfficiencies: { flotationAu: 0.90 } });
    expect(c.routeStageEfficiencies.flotationAu).toBe(0.90);
    expect(c.routeStageEfficiencies.flotationSulphides).toBe(ROUTE_STAGE_EFFICIENCIES.flotationSulphides);
  });

  it('ignore les valeurs hors bornes, non finies ou inconnues', () => {
    const c = resolveMetConstants({
      routeStageEfficiencies: {
        flotationAu: 1.5,                    // > max 1 → ignoré
        tailsLeachEfficiency: NaN,           // non fini → ignoré
        // @ts-expect-error clé inconnue
        bogus: 42,                           // inconnu → ignoré
        directLeachMaxPct: 92,               // valide → gardé
      },
    });
    expect(c.routeStageEfficiencies.flotationAu).toBe(ROUTE_STAGE_EFFICIENCIES.flotationAu);
    expect(c.routeStageEfficiencies.tailsLeachEfficiency).toBe(ROUTE_STAGE_EFFICIENCIES.tailsLeachEfficiency);
    expect(c.routeStageEfficiencies.directLeachMaxPct).toBe(92);
  });

  it('sanitizeOverrides ne conserve que le groupe route nettoyé', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides({ routeStageEfficiencies: { flotationAu: 0.9 } }))
      .toEqual({ routeStageEfficiencies: { flotationAu: 0.9 } });
    expect(sanitizeOverrides({ routeStageEfficiencies: {} })).toEqual({});
  });

  it('les métadonnées couvrent tous les champs du défaut (éditeur exhaustif)', () => {
    const metaKeys = new Set(MET_CONSTANT_GROUPS[0].fields.map(f => f.key));
    const defaultKeys = Object.keys(ROUTE_STAGE_EFFICIENCIES);
    expect(metaKeys.size).toBe(defaultKeys.length);
    for (const k of defaultKeys) expect(metaKeys.has(k as never)).toBe(true);
  });

  // ── Slice 2 : décision CIL/CIP ──────────────────────────────────────────────
  it('groupe adsorptionDecision : sans surcharge → défauts ; surcharge partielle appliquée', () => {
    expect(resolveMetConstants(null).adsorptionDecision).toEqual({ ...ADSORPTION_DECISION_THRESHOLDS });
    const c = resolveMetConstants({ adsorptionDecision: { organicCarbonPct: 0.35 } });
    expect(c.adsorptionDecision.organicCarbonPct).toBe(0.35);
    expect(c.adsorptionDecision.nacnKgT).toBe(ADSORPTION_DECISION_THRESHOLDS.nacnKgT);
  });

  it('sanitize générique : nettoie chaque groupe indépendamment', () => {
    const c = resolveMetConstants({
      routeStageEfficiencies: { flotationAu: 0.9 },
      adsorptionDecision: { nacnKgT: 99 /* > max 10 → ignoré */, auFeedGt: 8 },
    });
    expect(c.routeStageEfficiencies.flotationAu).toBe(0.9);
    expect(c.adsorptionDecision.nacnKgT).toBe(ADSORPTION_DECISION_THRESHOLDS.nacnKgT);
    expect(c.adsorptionDecision.auFeedGt).toBe(8);
  });

  it('les métadonnées du groupe adsorptionDecision couvrent tous ses champs', () => {
    const grp = MET_CONSTANT_GROUPS.find(g => g.id === 'adsorptionDecision')!;
    const metaKeys = new Set(grp.fields.map(f => f.key));
    for (const k of Object.keys(ADSORPTION_DECISION_THRESHOLDS)) expect(metaKeys.has(k)).toBe(true);
  });
});
