// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Engine de Traçabilité Applicative (Audit Logging)
//
// Ce module centralise la traçabilité des modifications de paramètres, exécutions
// de simulations, réconciliations metallurgiques et approbations de jalons.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, supabaseDynamic } from '../supabase';

export type AuditAction = 
  | 'create'
  | 'update'
  | 'delete'
  | 'run_simulation'
  | 'run_reconciliation'
  | 'run_p80_study'
  | 'run_plant_optimization'
  | 'approve_stage'
  | 'update_settings'
  | 'update_met_constants';

export type AuditEntityType = 
  | 'project'
  | 'project_settings'
  | 'project_met_constants'
  | 'flowsheet'
  | 'simulation_run'
  | 'cos_reconciliation'
  | 'p80_study'
  | 'plant_opt_scenario'
  | 'stage_gate'
  | 'lims_sample'
  | 'block_model'
  | 'mine_params';

export interface AuditLogEntry {
  id: string;
  project_id: string | null;
  user_id: string;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  previous_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface LogAuditInput {
  projectId: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string | null;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

// Fallback mémoire pour assurer la traçabilité continue même si offline/déconnecté
const inMemoryAuditLogs: AuditLogEntry[] = [];

/**
 * Enregistre un événement dans le journal d'audit (Supabase BDD avec fallback mémoire).
 */
export async function logAuditEvent(input: LogAuditInput): Promise<AuditLogEntry | null> {
  const { projectId, action, entityType, entityId, previousValues, newValues, metadata } = input;

  const entry: AuditLogEntry = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    project_id: projectId,
    user_id: 'system',
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    previous_values: previousValues ?? null,
    new_values: newValues ?? null,
    metadata: metadata ?? {},
    created_at: new Date().toISOString(),
  };

  // Toujours ajouter au store mémoire local pour accès immédiat
  inMemoryAuditLogs.unshift(entry);

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id;

    if (!userId) {
      return entry;
    }

    entry.user_id = userId;

    // `audit_logs` n'est pas dans les types générés (nouvelle table) → client
    // dynamique, même échappatoire que les imports LIMS/COS (supabaseDynamic).
    const { data, error } = await supabaseDynamic
      .from('audit_logs')
      .insert({
        project_id: projectId,
        user_id: userId,
        action,
        entity_type: entityType,
        entity_id: entityId ?? null,
        previous_values: previousValues ?? null,
        new_values: newValues ?? null,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.warn('Traceability: Could not persist log to DB, stored in local memory fallback.', error.message);
      return entry;
    }

    return (data as AuditLogEntry) ?? entry;
  } catch (err) {
    console.warn('Traceability: Exception logging audit event.', err);
    return entry;
  }
}

/**
 * Récupère l'historique de traçabilité pour un projet donné.
 */
export async function fetchAuditLogs(projectId?: string | null): Promise<AuditLogEntry[]> {
  try {
    let query = supabaseDynamic.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(100);

    if (projectId) {
      query = query.eq('project_id', projectId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
      // Fallback vers la mémoire locale
      return projectId 
        ? inMemoryAuditLogs.filter(l => l.project_id === projectId)
        : inMemoryAuditLogs;
    }

    return data as AuditLogEntry[];
  } catch {
    return projectId 
      ? inMemoryAuditLogs.filter(l => l.project_id === projectId)
      : inMemoryAuditLogs;
  }
}

/**
 * Nettoie la mémoire locale (utilisé dans les tests unitaires).
 */
export function clearInMemoryAuditLogs(): void {
  inMemoryAuditLogs.length = 0;
}
