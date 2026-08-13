import { supabaseDynamic } from '../supabase';

/**
 * Client de persistance des scénarios de réconciliation (metal accounting).
 * Requiert la table `cos_reconciliation_runs` (voir
 * supabase/migrations/..._cos_reconciliation_runs.sql). Comme le client des
 * snapshots (T4), chaque lecture/écriture DÉGRADE GRACIEUSEMENT : si la table
 * est absente, l'appel renvoie un signal `tableMissing` au lieu de lever, pour
 * que l'UI propose d'activer la fonctionnalité plutôt que de casser.
 *
 * On passe par `supabaseDynamic` (vue non typée) : la table est trop récente
 * pour figurer dans les types générés `Database`, tout en gardant la même
 * instance proxifiée (donc les mêmes notifications d'erreur d'écriture).
 */

/** Méthode de réconciliation ayant produit le scénario. */
export type ReconMethod = 'network' | 'bilinear' | 'bilinear_iter' | 'serial';

export interface ReconciliationRun {
  id: string;
  project_id: string;
  label: string;
  method: ReconMethod;
  /** Entrées saisies (nœuds + flux + options) telles quelles, pour rechargement. */
  input: Record<string, unknown>;
  /** Extrait du résultat pour l'audit (clôtures, erreurs grossières, éliminations…). */
  result_summary: Record<string, unknown>;
  note: string | null;
  created_at: string;
}

/** Code Postgres « relation inexistante ». */
const UNDEFINED_TABLE = '42P01';
const TABLE = 'cos_reconciliation_runs';

export interface ReconRunListResult {
  runs: ReconciliationRun[];
  tableMissing: boolean;
}

export async function listReconciliationRuns(projectId: string): Promise<ReconRunListResult> {
  const { data, error } = await supabaseDynamic
    .from(TABLE)
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === UNDEFINED_TABLE) return { runs: [], tableMissing: true };
    throw error;
  }
  return { runs: (data ?? []) as unknown as ReconciliationRun[], tableMissing: false };
}

export interface SaveReconciliationRunInput {
  projectId: string;
  label: string;
  method: ReconMethod;
  input: Record<string, unknown>;
  resultSummary: Record<string, unknown>;
  note?: string | null;
}

export interface SaveReconRunResult {
  run: ReconciliationRun | null;
  tableMissing: boolean;
}

export async function saveReconciliationRun(input: SaveReconciliationRunInput): Promise<SaveReconRunResult> {
  const { data, error } = await supabaseDynamic
    .from(TABLE)
    .insert({
      project_id: input.projectId,
      label: input.label,
      method: input.method,
      input: input.input,
      result_summary: input.resultSummary,
      note: input.note ?? null,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === UNDEFINED_TABLE) return { run: null, tableMissing: true };
    throw error;
  }
  return { run: data as unknown as ReconciliationRun, tableMissing: false };
}

export async function deleteReconciliationRun(id: string): Promise<{ tableMissing: boolean }> {
  const { error } = await supabaseDynamic.from(TABLE).delete().eq('id', id);
  if (error) {
    if (error.code === UNDEFINED_TABLE) return { tableMissing: true };
    throw error;
  }
  return { tableMissing: false };
}
