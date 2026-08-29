import { describe, it, expect } from 'vitest';
import { importFromModules, bundleHasData, type ProjectDataBundle } from './projectImport';
import { buildExamplePlant } from './examplePlant';

const model = buildExamplePlant({ targetTph: 500, availabilityFraction: 0.9 });

const bundle: ProjectDataBundle = {
  effectiveRecoveryPct: 92.5,
  recoveryLabel: 'Gravité + CIL 48 h',
  hoursPerYear: 8000,
  opexLines: [
    { category: 'Broyage', description: 'Broyage (Ball Mill)', value_usd_t: 7.2 },
    { category: 'Réactifs', description: 'Cyanure', value_usd_t: 1.1 },
  ],
  equipment: [
    { name: 'Ball Mill 1', category: 'Broyage', capacity: 300, capacity_unit: 't/h', status: 'installed' },
    { name: 'Ball Mill 2', category: 'Broyage', capacity: 300, capacity_unit: 't/h', status: 'installed' },
    { name: 'Concasseur', category: 'Concassage', capacity: 900, capacity_unit: 't/h', status: 'operating' },
  ],
};

const allSel = { recovery: true, horizon: true, opex: true, capacity: true };

describe('bundleHasData', () => {
  it('détecte les sources disponibles', () => {
    const has = bundleHasData(bundle);
    expect(has).toEqual({ recovery: true, horizon: true, opex: true, capacity: true });
  });
  it('marque indisponible ce qui est vide', () => {
    const empty: ProjectDataBundle = { effectiveRecoveryPct: null, hoursPerYear: 0, opexLines: [], equipment: [] };
    expect(bundleHasData(empty)).toEqual({ recovery: false, horizon: false, opex: false, capacity: false });
  });
});

describe('importFromModules', () => {
  it('applique la récupération des essais à l\'aire de lixiviation', () => {
    const res = importFromModules(model, bundle, { ...allSel, horizon: false, opex: false, capacity: false });
    const leach = res.model.areas.find(a => (a.type ?? '').includes('leach'))!;
    expect(leach.baseRecovery).toBeCloseTo(0.925, 4);
    expect(res.messages.some(m => m.includes('Récupération'))).toBe(true);
  });

  it('applique l\'horizon résolu', () => {
    const res = importFromModules(model, bundle, { ...allSel, recovery: false, opex: false, capacity: false });
    expect(res.model.horizonHours).toBe(8000);
  });

  it('mappe l\'OPEX par nom d\'aire', () => {
    const res = importFromModules(model, bundle, { ...allSel, recovery: false, horizon: false, capacity: false });
    const mill = res.model.areas.find(a => a.name.includes('Ball Mill'))!;
    expect(mill.opexPerTonne).toBe(7.2);
  });

  it('somme les capacités des équipements par aire correspondante', () => {
    const res = importFromModules(model, bundle, { ...allSel, recovery: false, horizon: false, opex: false });
    const mill = res.model.areas.find(a => a.name.includes('Ball Mill'))!;
    // Deux broyeurs 300 t/h → mode 600.
    expect(Number(mill.capacityDist.params.mode)).toBe(600);
    // La forme triangulaire est conservée (min < mode < max).
    expect(Number(mill.capacityDist.params.min)).toBeLessThan(600);
    expect(Number(mill.capacityDist.params.max)).toBeGreaterThan(600);
  });

  it('signale les sources vides', () => {
    const empty: ProjectDataBundle = { effectiveRecoveryPct: null, hoursPerYear: 0, opexLines: [], equipment: [] };
    const res = importFromModules(model, empty, allSel);
    expect(res.empty.sort()).toEqual(['capacity', 'horizon', 'opex', 'recovery']);
    expect(res.messages).toHaveLength(0);
  });

  it('n\'écrase que les aires correspondantes', () => {
    const res = importFromModules(model, bundle, { ...allSel, recovery: false, horizon: false, capacity: false });
    // La flottation n'a pas de ligne OPEX correspondante → inchangée.
    const flot = model.areas.find(a => a.type === 'flotation')!;
    const flotAfter = res.model.areas.find(a => a.id === flot.id)!;
    expect(flotAfter.opexPerTonne).toBe(flot.opexPerTonne);
  });
});
