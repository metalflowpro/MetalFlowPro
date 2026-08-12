import { describe, it, expect } from 'vitest';
import { summarizeReconciliationRuns } from './reconciliationReport';
import type { ReconciliationRun } from './reconciliationRuns';

function run(partial: Partial<ReconciliationRun>): ReconciliationRun {
  return {
    id: partial.id ?? 'r1',
    project_id: 'p1',
    label: partial.label ?? 'Run',
    method: partial.method ?? 'network',
    input: partial.input ?? {},
    result_summary: partial.result_summary ?? {},
    note: null,
    created_at: partial.created_at ?? '2026-08-01T10:00:00Z',
  };
}

describe('summarizeReconciliationRuns — agrégation', () => {
  it('compte les runs par méthode', () => {
    const rep = summarizeReconciliationRuns([
      run({ id: 'a', method: 'network' }),
      run({ id: 'b', method: 'bilinear' }),
      run({ id: 'c', method: 'bilinear_iter' }),
      run({ id: 'd', method: 'serial' }),
      run({ id: 'e', method: 'network' }),
    ]);
    expect(rep.total).toBe(5);
    expect(rep.byMethod.network).toBe(2);
    expect(rep.byMethod.bilinear).toBe(1);
    expect(rep.byMethod.bilinear_iter).toBe(1);
    expect(rep.byMethod.serial).toBe(1);
  });

  it('trie du plus récent au plus ancien et expose `latest`', () => {
    const rep = summarizeReconciliationRuns([
      run({ id: 'old', created_at: '2026-08-01T00:00:00Z' }),
      run({ id: 'new', created_at: '2026-08-10T00:00:00Z' }),
      run({ id: 'mid', created_at: '2026-08-05T00:00:00Z' }),
    ]);
    expect(rep.rows.map(r => r.id)).toEqual(['new', 'mid', 'old']);
    expect(rep.latest?.id).toBe('new');
  });

  it('liste vide → rapport nul cohérent', () => {
    const rep = summarizeReconciliationRuns([]);
    expect(rep.total).toBe(0);
    expect(rep.latest).toBeNull();
    expect(rep.grossErrorRuns).toBe(0);
  });
});

describe('summarizeReconciliationRuns — extraction des clôtures', () => {
  it('lit les composants d\'un run réseau', () => {
    const rep = summarizeReconciliationRuns([run({
      method: 'network',
      result_summary: { components: [
        { key: 'solids', closurePct: 99.4, grossError: false },
        { key: 'gold', closurePct: 88, grossError: true },
        { key: 'water', empty: true },
      ] },
    })]);
    const row = rep.rows[0];
    expect(row.closures).toHaveLength(2); // le composant `empty` est ignoré
    expect(row.closures.find(c => c.key === 'gold')?.grossError).toBe(true);
    expect(row.anyGrossError).toBe(true);
    expect(rep.grossErrorRuns).toBe(1);
  });

  it('lit tonnage + métaux d\'un run bilinéaire', () => {
    const rep = summarizeReconciliationRuns([run({
      method: 'bilinear',
      result_summary: { tonnageClosurePct: 100.2, metals: [
        { key: 'au', metalClosurePct: 99.1, grossError: false },
        { key: 'ag', metalClosurePct: 97.5, grossError: false },
      ] },
    })]);
    const row = rep.rows[0];
    expect(row.closures.map(c => c.key)).toEqual(['tonnage', 'au', 'ag']);
    expect(row.closures[0].closurePct).toBeCloseTo(100.2, 2);
    expect(row.anyGrossError).toBe(false);
  });

  it('signale une piste sérielle', () => {
    const rep = summarizeReconciliationRuns([run({
      method: 'serial', input: { serial: true },
      result_summary: { components: [{ key: 'solids', closurePct: 100, grossError: false }], eliminations: 2 },
    })]);
    expect(rep.rows[0].eliminations).toBe(2);
  });

  it('tolère un résumé de forme inconnue sans planter', () => {
    const rep = summarizeReconciliationRuns([run({ result_summary: { weird: 42 } })]);
    expect(rep.rows[0].closures).toHaveLength(0);
    expect(rep.rows[0].anyGrossError).toBe(false);
  });
});
