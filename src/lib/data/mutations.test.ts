import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock du client supabase : on intercepte from() (mutations) et rpc().
// Aucune connexion réelle. vi.hoisted car vi.mock est hissé.
const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { rpc: rpcMock },
  supabaseDynamic: { from: fromMock, rpc: rpcMock },
}));

import {
  updateWhere,
  insertOne,
  upsertRows,
  deleteWhere,
  rpcMutation,
  enforceMutation,
} from './mutations';
import {
  DataNotPersistedError,
  AffectedRowsUnknownError,
  DataPersistenceError,
} from './errors';

interface MutResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
  count: number | null;
}

/** Construit un builder chainable résolu en `result` à l'await final. */
function makeBuilder(result: MutResult) {
  // `select` est à la fois le terminal (awaitable) pour update/delete/upsert,
  // et chaînable avec .maybeSingle()/.single() pour insert.
  const thenable = {
    then: (resolve: (v: MutResult) => void) => resolve(result),
    maybeSingle: () => thenable,
    single: () => thenable,
  };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.update = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.upsert = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.select = vi.fn(() => thenable);
  builder.maybeSingle = vi.fn(() => thenable);
  return builder;
}

describe('Couche de données S7 — vérification du nombre de lignes (anti-T3b)', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('update avec au moins une ligne réussit et retourne les lignes', async () => {
    const builder = makeBuilder({
      data: [{ id: 'r1', label: 'a' }],
      error: null,
      count: 1,
    });
    fromMock.mockReturnValue(builder);
    const rows = await updateWhere('projects', { id: 'p1' }, { name: 'A' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: 'r1', label: 'a' });
    // Garantie critique : le compte exact est demandé, sinon 0 ligne ne serait
    // pas distinguable d'un UPDATE sans RETURNING (piège T3b).
    expect(builder.select).toHaveBeenCalledWith('*', { count: 'exact' });
  });

  it('update à 0 ligne (piège T3b : RLS USING refuse) lève DataNotPersistedError', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: [], error: null, count: 0 }));
    await expect(
      updateWhere('projects', { id: 'p1' }, { name: 'A' }),
    ).rejects.toBeInstanceOf(DataNotPersistedError);
  });

  it('update à 0 ligne sans count mais data vide lève DataNotPersistedError (longueur tableau = 0)', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: [], error: null, count: null }));
    await expect(
      updateWhere('projects', { id: 'p1' }, { name: 'A' }),
    ).rejects.toBeInstanceOf(DataNotPersistedError);
  });

  it('update avec nombre inconnu (count null + data null) lève AffectedRowsUnknownError (fail closed)', async () => {
    // Cas défensif : le serveur n'a retourné ni count ni donnée — on refuse
    // de conclure au succès (un UPDATE sans RETURNING retourne null même si
    // N lignes ont été affectées).
    fromMock.mockReturnValue(makeBuilder({ data: null, error: null, count: null }));
    await expect(
      updateWhere('projects', { id: 'p1' }, { name: 'A' }),
    ).rejects.toBeInstanceOf(AffectedRowsUnknownError);
  });

  it('enforceMutation lève AffectedRowsUnknownError quand le nombre est vraiment inconnu', () => {
    expect(() =>
      enforceMutation(
        { data: null, error: null, count: null },
        'x',
        { expect: 'atLeastOne' },
      ),
    ).toThrow(AffectedRowsUnknownError);
  });

  it('erreur serveur propagée en DataPersistenceError', async () => {
    fromMock.mockReturnValue(makeBuilder({
      data: null,
      error: { code: '42501', message: 'permission refusée' },
      count: null,
    }));
    await expect(
      updateWhere('projects', { id: 'p1' }, { name: 'A' }),
    ).rejects.toBeInstanceOf(DataPersistenceError);
  });

  it('insertOne exactement 1 ligne réussit et demande le compte exact', async () => {
    const builder = makeBuilder({
      data: { id: 'p1' },
      error: null,
      count: 1,
    });
    fromMock.mockReturnValue(builder);
    const row = await insertOne('projects', { name: 'A' });
    expect(row).toEqual({ id: 'p1' });
    expect(builder.select).toHaveBeenCalledWith('*', { count: 'exact' });
  });

  it('insertOne à 0 ligne (maybeSingle null) lève DataNotPersistedError', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: null, count: null }));
    await expect(insertOne('projects', { name: 'A' })).rejects.toBeInstanceOf(
      DataNotPersistedError,
    );
  });

  it('delete à 0 ligne lève DataNotPersistedError (presque toujours un bug)', async () => {
    const builder = makeBuilder({ data: [], error: null, count: 0 });
    fromMock.mockReturnValue(builder);
    await expect(deleteWhere('projects', { id: 'p1' })).rejects.toBeInstanceOf(
      DataNotPersistedError,
    );
    expect(builder.select).toHaveBeenCalledWith('*', { count: 'exact' });
  });

  it('upsert retourne des lignes → succès et demande le compte exact', async () => {
    const builder = makeBuilder({
      data: [{ id: 'r1' }, { id: 'r2' }],
      error: null,
      count: 2,
    });
    fromMock.mockReturnValue(builder);
    const rows = await upsertRows('lims_samples', [{ sample_id: 'r1' }]);
    expect(rows).toHaveLength(2);
    expect(builder.select).toHaveBeenCalledWith('*', { count: 'exact' });
  });

  it('allowZero sans raison lève (on ne tolère pas le faux succès implicite)', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: [], error: null, count: 0 }));
    await expect(
      upsertRows('lims_samples', [], { expect: 'allowZero' }),
    ).rejects.toBeInstanceOf(DataNotPersistedError);
  });

  it('allowZero avec raison autorise 0 ligne', async () => {
    fromMock.mockReturnValue(makeBuilder({ data: [], error: null, count: 0 }));
    const rows = await upsertRows('lims_samples', [], {
      expect: 'allowZero',
      allowZeroReason: 'upsert idempotent sans changement',
    });
    expect(rows).toEqual([]);
  });

  it('rpcMutation propage DataPersistenceError sur erreur SQL', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Run non exécutable' },
      count: null,
    });
    await expect(
      rpcMutation('mfp_succeed_p80_compute_run', { p_run_id: 'x' }),
    ).rejects.toBeInstanceOf(DataPersistenceError);
  });

  it('rpcMutation lève DataNotPersistedError sur retour nul sans erreur (0 ligne)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null, count: null });
    await expect(
      rpcMutation('mfp_audit_log', { p_action: 'create' }),
    ).rejects.toBeInstanceOf(DataNotPersistedError);
  });

  it('rpcMutation réussit et retourne la valeur non nulle', async () => {
    rpcMock.mockResolvedValue({ data: 'run-id-123', error: null, count: null });
    const id = await rpcMutation('mfp_enqueue_compute', { p_project_id: 'p1' });
    expect(id).toBe('run-id-123');
  });
});
