import { describe, it, expect } from 'vitest';
import { resolveMetConstants, sanitizeOverrides, MET_CONSTANT_GROUPS } from './metConstants';
import { ROUTE_STAGE_EFFICIENCIES } from '../analytics/routeEstimation';

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
});
