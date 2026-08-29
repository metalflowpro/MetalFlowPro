import { describe, it, expect } from 'vitest';
import { buildExamplePlant, REFERENCE_FEED_TPH } from './examplePlant';
import { optimizeBuffer, backtest } from './optimize';
import { applyGmaoImport, parseHistoricalText } from './importData';
import { buildModelFromProject } from './projectModel';
import { runSimulationSync } from './engine';
import type { Project } from '../../types';
import type { SimConfig } from './types';

const project: Project = {
  id: 'p1', code: 'TEST', name: 'Test', country: 'CI', phase: 'FEASIBILITY',
  target_tph: 500, gold_grade_g_t: 1.8, availability_pct: 90, recovery_pct: 88,
  ore_sg: 2.75, gold_price_usd: 2300, annual_tonnes: 0, created_at: '', updated_at: '',
};

const fast: SimConfig = { iterations: 40, seed: 7, warmupHours: 24, timeStepHours: 6, horizonHours: 24 * 20 };

describe('buildExamplePlant — scalable, rien de figé', () => {
  it('met les capacités à l\'échelle du débit projet', () => {
    const at500 = buildExamplePlant({ targetTph: 500, availabilityFraction: 0.9 });
    const atRef = buildExamplePlant({ targetTph: REFERENCE_FEED_TPH, availabilityFraction: 0.9 });
    const crush500 = at500.areas.find(a => a.type === 'crushing')!;
    const crushRef = atRef.areas.find(a => a.type === 'crushing')!;
    const ratio = Number(crush500.capacityDist.params.mode) / Number(crushRef.capacityDist.params.mode);
    expect(ratio).toBeCloseTo(500 / REFERENCE_FEED_TPH, 4);
  });

  it('produit une usine complète (8 aires, flux, tampons, cause commune, feed)', () => {
    const m = buildExamplePlant({ targetTph: 500, availabilityFraction: 0.9 });
    expect(m.areas.length).toBe(8);
    expect(m.streams.length).toBe(7);
    expect(m.buffers.length).toBeGreaterThan(0);
    expect(m.commonCauses.length).toBe(1);
    expect(m.feedScenario?.hardnessDist).toBeTruthy();
    // La flottation applique un rendement massique < 1 (ligne concentré).
    const flotStream = m.streams.find(s => s.sourceAreaId === m.areas.find(a => a.type === 'flotation')!.id);
    expect(flotStream!.massYield).toBeLessThan(1);
  });

  it('reste simulable et reproductible', () => {
    const m = buildExamplePlant({ targetTph: 500, availabilityFraction: 0.9 });
    const a = runSimulationSync(m, fast);
    const b = runSimulationSync(m, fast);
    expect(a.throughputP50).toBe(b.throughputP50);
    expect(a.throughputP50).toBeGreaterThan(0);
  });
});

describe('optimizeBuffer', () => {
  it('renvoie une courbe croissante et un genou dans les bornes', () => {
    const m = buildModelFromProject(project);
    // Assure un flux avec tampon optimisable.
    const streamId = m.streams[0].id;
    const res = optimizeBuffer(m, { ...fast, iterations: 30 }, streamId)!;
    expect(res.points.length).toBeGreaterThan(2);
    expect(res.kneeCapacityTonnes).toBeGreaterThanOrEqual(0);
    expect(res.kneeCapacityTonnes).toBeLessThanOrEqual(res.points[res.points.length - 1].capacityTonnes);
    // P50 au plateau ≥ P50 sans tampon.
    expect(res.plateauThroughputP50).toBeGreaterThanOrEqual(res.points[0].throughputP50 - 1e-6);
  });
});

describe('backtest', () => {
  it('donne un KS faible quand l\'historique ressemble à la simulation', () => {
    const m = buildModelFromProject(project);
    const sim = runSimulationSync(m, fast);
    // Historique = un sous-échantillon des débits simulés → KS doit être petit.
    const hist = sim.throughputSamples.filter((_, i) => i % 2 === 0);
    const bt = backtest(m, fast, hist)!;
    expect(bt.n).toBe(hist.length);
    expect(bt.ks).toBeLessThan(0.3);
  });
  it('refuse moins de 5 points', () => {
    const m = buildModelFromProject(project);
    expect(backtest(m, fast, [1, 2, 3])).toBeNull();
  });
});

describe('import GMAO', () => {
  it('applique min/mode/max/opex par nom d\'aire et extrait les débits', () => {
    const m = buildModelFromProject(project);
    const targetName = m.areas[0].name;
    const rows: (string | number)[][] = [
      ['Aire', 'Min', 'Mode', 'Max', 'OPEX', 'Débit'],
      [targetName, 100, 120, 140, 2.5, 815],
      ['Aire inconnue', 1, 2, 3, 1, 820],
    ];
    const res = applyGmaoImport(m, rows);
    const updated = res.model.areas.find(a => a.name === targetName)!;
    expect(Number(updated.capacityDist.params.mode)).toBe(120);
    expect(updated.opexPerTonne).toBe(2.5);
    expect(res.applied).toContain(targetName);
    expect(res.skipped).toContain('Aire inconnue');
    expect(res.historical).toEqual([815, 820]);
  });

  it('parseHistoricalText tolère virgules, espaces et retours', () => {
    expect(parseHistoricalText('928, 945\n918;968')).toEqual([928, 945, 918, 968]);
  });
});
