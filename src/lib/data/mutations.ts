// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Couche de données vérifiant le nombre de lignes (S7)
//
// Toute écriture (insert / update / upsert / delete / RPC mutant) passe par ces
// wrappers. Le principe : aucune écriture industrielle n'est considérée réussie
// tant que la couche de données ne peut pas PROUVER qu'au moins une ligne a été
// affectée.
//
// Politique d'attente (`expect`) :
//   - 'atLeastOne' (défaut) : 0 ligne = DataNotPersistedError (piège T3b)
//   - 'exactlyOne'          : exactement 1 ligne, sinon DataNotPersistedError
//   - 'allowZero'            : 0 ligne autorisé, MAIS l'appelant doit fournir
//                              une raison (allowZeroReason) — pour les opérations
//                              idempotentes légitimes (ex. upsert sans changement).
//
// Fail closed : si le nombre de lignes affectées est inconnu (ni `count` ni
// `data` retournés), on lève AffectedRowsUnknownError plutôt que de supposer
// le succès.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseDynamic } from '../supabase';
import {
  DataPersistenceError,
  DataNotPersistedError,
  AffectedRowsUnknownError,
} from './errors';

// Les tables sont dynamiques dans cette couche. On limite donc la surface non
// typée au point d'adaptation, sans propager `any` dans les wrappers.
interface DynamicTable {
  update: (values: unknown) => unknown;
  delete: () => unknown;
  upsert: (rows: unknown[], options?: { onConflict: string }) => unknown;
  insert: (row: unknown) => unknown;
}

const db = supabaseDynamic as unknown as {
  from: (table: string) => DynamicTable;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<MutationResult>;
};

export type Expect = 'exactlyOne' | 'atLeastOne' | 'allowZero';

export interface MutationOptions {
  /** Combien de lignes la couche de données doit-elle prouver ? Défaut: atLeastOne. */
  expect?: Expect;
  /** Obligatoire si expect='allowZero'. Documente pourquoi 0 ligne est acceptable. */
  allowZeroReason?: string;
  /** Étiquette humaine pour le message d'erreur (ex. 'update projects'). */
  label?: string;
}

/** Forme du résultat d'une mutation supabase-js (avec count exact). */
interface MutationResult {
  data: unknown;
  error: { code?: string; message?: string; details?: string } | null;
  count: number | null;
  status?: number;
}

/**
 * Détermine le nombre de lignes affectées. Privilégie l'en-tête `count` exact
 * (demandé via { count: 'exact' }), sinon la longueur des données retournées,
 * sinon déduit d'un objet unique. Retourne `null` si impossible à prouver
 * (ni count ni donnée — cas défensif d'échec fermé).
 *
 * Note : `data: null` + `count: null` est considéré INCONNU (et non 0), car un
 * UPDATE sans RETURNING retourne null même si N lignes ont été affectées. On
 * refuse donc de conclure au succès. Les wrappers qui attendent un objet unique
 * (insert via maybeSingle) gèrent `data: null` comme 0 ligne de façon définitive.
 */
function affectedCount(r: MutationResult): number | null {
  if (typeof r.count === 'number') return r.count;
  if (Array.isArray(r.data)) return r.data.length;
  if (r.data !== null && r.data !== undefined) return 1; // objet unique
  return null; // count null + data null/undefined → inconnu
}

/**
 * Applique la politique d'attente. Lève une erreur explicite si l'écriture
 * n'est pas prouvée (0 ligne, nombre inattendu, ou nombre inconnu).
 * @returns le nombre de lignes affectées (prouvé)
 */
export function enforceMutation(
  r: MutationResult,
  label: string,
  opts: MutationOptions = {},
): number {
  if (r.error) {
    throw new DataPersistenceError(
      `${label}: erreur serveur (${r.error.code ?? 'unknown'}: ${r.error.message}). ` +
        `Aucune ligne n'est garantie avoir été écrite.`,
      r.error,
    );
  }
  const n = affectedCount(r);
  const expect = opts.expect ?? 'atLeastOne';
  if (n === null) {
    throw new AffectedRowsUnknownError(
      `${label}: nombre de lignes affectées inconnu (ni 'count' ni 'data' retournés). ` +
        `Refus de considérer l'écriture comme réussie (fail closed).`,
    );
  }
  if (expect === 'exactlyOne' && n !== 1) {
    throw new DataNotPersistedError(
      `${label}: ${n} ligne(s) affectée(s), 1 attendue. ` +
        `L'écriture a probablement été refusée par la RLS (piège T3b) — vérifiez l'appartenance au projet et les permissions.`,
    );
  }
  if (expect === 'atLeastOne' && n === 0) {
    throw new DataNotPersistedError(
      `${label}: 0 ligne affectée. ` +
        `L'écriture a probablement été refusée par la clause USING d'une politique RLS (piège T3b) — ` +
        `vérifiez l'appartenance au projet, le statut du membre et le domaine concerné.`,
    );
  }
  if (expect === 'allowZero') {
    if (n === 0 && !opts.allowZeroReason) {
      throw new DataNotPersistedError(
        `${label}: 0 ligne et politique 'allowZero' sans raison fournie. ` +
          `Fournissez allowZeroReason pour autoriser explicitement 0 ligne.`,
      );
    }
  }
  return n;
}

/** Construit la chaîne eq() à partir d'un objet de correspondance. */
function applyMatch(
  q: { eq: (col: string, val: unknown) => unknown },
  match: Record<string, unknown>,
) {
  let chain: unknown = q;
  for (const [k, v] of Object.entries(match)) {
    chain = (chain as { eq: (c: string, v: unknown) => unknown }).eq(k, v);
  }
  return chain as unknown;
}

/** Type d'un terminal select() pour le chaînage typé. */
interface Selectable {
  select: (columns: string, opts: { count: 'exact' }) => Promise<MutationResult>;
}

/**
 * UPDATE avec vérification du nombre de lignes. Retourne les lignes affectées.
 * Défaut : au moins une ligne, sinon DataNotPersistedError (piège T3b).
 */
export async function updateWhere<T>(
  table: string,
  match: Record<string, unknown>,
  values: Partial<T>,
  opts: MutationOptions = {},
): Promise<T[]> {
  const label = opts.label ?? `update ${table}`;
  const base = db.from(table).update(values);
  const chain = applyMatch(
    base as unknown as { eq: (c: string, v: unknown) => unknown },
    match,
  );
  const r = (await (chain as unknown as Selectable).select('*', {
    count: 'exact',
  })) as MutationResult;
  enforceMutation(r, label, opts);
  return (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []) as T[];
}

/**
 * DELETE avec vérification. Défaut : au moins une ligne. 0 ligne sur un delete
 * est presque toujours un bug (piège T3b) — sauf idempotence explicite
 * (expect='allowZero' + raison).
 */
export async function deleteWhere(
  table: string,
  match: Record<string, unknown>,
  opts: MutationOptions = {},
): Promise<number> {
  const label = opts.label ?? `delete ${table}`;
  const base = db.from(table).delete();
  const chain = applyMatch(
    base as unknown as { eq: (c: string, v: unknown) => unknown },
    match,
  );
  const r = (await (chain as unknown as Selectable).select('*', {
    count: 'exact',
  })) as MutationResult;
  return enforceMutation(r, label, opts);
}

/**
 * UPSERT de plusieurs lignes. Défaut : au moins une ligne. Pour un upsert
 * idempotent qui ne change rien, utiliser expect='allowZero' avec une raison.
 */
export async function upsertRows<T>(
  table: string,
  rows: Partial<T>[],
  opts: MutationOptions & { onConflict?: string } = {},
): Promise<T[]> {
  const label = opts.label ?? `upsert ${table}`;
  const base = db.from(table).upsert(
    rows,
    opts.onConflict ? { onConflict: opts.onConflict } : undefined,
  );
  const r = (await (base as unknown as Selectable).select('*', {
    count: 'exact',
  })) as MutationResult;
  enforceMutation(r, label, opts);
  return (Array.isArray(r.data) ? r.data : r.data ? [r.data] : []) as T[];
}

/**
 * INSERT d'une ligne avec vérification. Utilise maybeSingle() : un retour null
 * est définitivement 0 ligne (RLS a refusé l'INSERT via WITH CHECK) →
 * DataNotPersistedError. Défaut : exactement 1 ligne attendue.
 */
export async function insertOne<T>(
  table: string,
  row: Partial<T>,
  opts: MutationOptions = {},
): Promise<T> {
  const label = opts.label ?? `insert ${table}`;
  const inserted = db.from(table).insert(row) as {
    select: (columns: string, opts: { count: 'exact' }) => {
      maybeSingle: () => Promise<MutationResult>;
    };
  };
  const r = await inserted.select('*', { count: 'exact' }).maybeSingle();
  if (r.error) {
    throw new DataPersistenceError(
      `${label}: erreur serveur (${r.error.code ?? 'unknown'}: ${r.error.message}).`,
      r.error,
    );
  }
  if (r.data === null || r.data === undefined) {
    // maybeSingle retourne null seulement si 0 ligne → RLS a refusé (piège T3b)
    throw new DataNotPersistedError(
      `${label}: 0 ligne insérée. ` +
        `L'écriture a probablement été refusée par la clause WITH CHECK d'une politique RLS (piège T3b) — ` +
        `vérifiez l'appartenance au projet, le statut du membre et le domaine concerné.`,
    );
  }
  return r.data as T;
}

/**
 * RPC mutant (ex. fonctions S6 mfp_enqueue_compute / mfp_audit_log).
 * Le contrat : le RPC doit soit lever une erreur SQL (propagée), soit retourner
 * une valeur non nulle (un id, un ack). Un retour nul sans erreur est traité
 * comme 0 ligne → DataNotPersistedError.
 */
export async function rpcMutation<T>(
  fn: string,
  args: Record<string, unknown>,
  opts: MutationOptions = {},
): Promise<T> {
  const label = opts.label ?? `rpc ${fn}`;
  const r = (await db.rpc(fn, args)) as MutationResult;
  if (r.error) {
    throw new DataPersistenceError(
      `${label}: erreur serveur (${r.error.code ?? 'unknown'}: ${r.error.message}).`,
      r.error,
    );
  }
  if (r.data === null || r.data === undefined) {
    throw new DataNotPersistedError(
      `${label}: retour nul (0 ligne / pas d'ack). ` +
        `L'écriture n'a probablement pas eu lieu — vérifiez l'appartenance au projet et le JWT.`,
    );
  }
  return r.data as T;
}
