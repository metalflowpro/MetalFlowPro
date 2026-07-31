import { supabase } from './supabase';
import type { Project } from '../types';

/**
 * Client for project scenario snapshots (T4). Requires the `project_snapshots`
 * table (see supabase/migrations/..._project_snapshots.sql) — run that SQL in
 * Supabase before the feature works. Every read/write degrades gracefully:
 * if the table is absent the calls resolve to a `tableMissing` signal rather
 * than throwing, so the UI can prompt to activate the feature.
 */

export interface KpiSnapshot {
  annualOz: number | null;
  revenueMusd: number | null;
  totalCapexMusd: number;
  totalOpexUsdT: number;
  aiscUsdOz: number | null;
  effectiveRecoveryPct: number;
}

export interface ProjectSnapshot {
  id: string;
  project_id: string;
  label: string;
  project_state: Partial<Project>;
  settings_state: Record<string, unknown>;
  kpi_snapshot: KpiSnapshot;
  note: string | null;
  created_at: string;
}

/** Postgres error code for "relation does not exist". */
const UNDEFINED_TABLE = '42P01';

export interface SnapshotListResult {
  snapshots: ProjectSnapshot[];
  tableMissing: boolean;
}

export async function listSnapshots(projectId: string): Promise<SnapshotListResult> {
  const { data, error } = await supabase
    .from('project_snapshots')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    if (error.code === UNDEFINED_TABLE) return { snapshots: [], tableMissing: true };
    throw error;
  }
  return { snapshots: (data ?? []) as ProjectSnapshot[], tableMissing: false };
}

export async function createSnapshot(input: {
  projectId: string;
  label: string;
  note?: string;
  projectState: Partial<Project>;
  settingsState: Record<string, unknown>;
  kpi: KpiSnapshot;
}): Promise<{ ok: boolean; tableMissing: boolean }> {
  const { error } = await supabase.from('project_snapshots').insert({
    project_id: input.projectId,
    label: input.label,
    note: input.note ?? null,
    project_state: input.projectState,
    settings_state: input.settingsState,
    kpi_snapshot: input.kpi,
  });
  if (error) {
    if (error.code === UNDEFINED_TABLE) return { ok: false, tableMissing: true };
    throw error;
  }
  return { ok: true, tableMissing: false };
}

export async function deleteSnapshot(id: string, projectId: string): Promise<void> {
  const { error } = await supabase.from('project_snapshots').delete().eq('id', id).eq('project_id', projectId);
  if (error && error.code !== UNDEFINED_TABLE) throw error;
}

/** Restore the process parameters captured in a snapshot back onto the project row. */
export async function restoreSnapshot(snapshot: ProjectSnapshot, expectedProjectId: string): Promise<Project | null> {
  if (snapshot.project_id !== expectedProjectId) {
    throw new Error('Le snapshot n’appartient pas au projet actif.');
  }
  const s = snapshot.project_state;
  const payload = {
    target_tph: s.target_tph,
    gold_grade_g_t: s.gold_grade_g_t,
    availability_pct: s.availability_pct,
    recovery_pct: s.recovery_pct,
    ore_sg: s.ore_sg,
    gold_price_usd: s.gold_price_usd,
    phase: s.phase,
  };
  const { data } = await supabase
    .from('projects')
    .update(payload)
    .eq('id', expectedProjectId)
    .select()
    .maybeSingle();
  return (data as Project) ?? null;
}
