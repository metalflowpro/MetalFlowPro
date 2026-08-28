// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Persistance & traçabilité des scénarios
//
// Un SCÉNARIO fige un modèle d'usine + ses réglages Monte-Carlo + un résumé de
// résultat, rattaché à un projet. Persisté dans la table `plantopt_scenarios`
// (RLS propriétaire-ET-approuvé, comme les tables p80_*/geomet_*) via le client
// dynamique — même échappatoire que l'audit/LIMS pour une table hors types générés.
//
// Chaque enregistrement et chaque exécution émettent un événement d'audit
// (`audit_logs`) : l'historique « qui a lancé quel run, avec quelles hypothèses,
// pour quel débit » est ainsi reconstituable. Repli localStorage si la table
// n'est pas encore migrée, pour ne jamais bloquer l'UX (l'audit, lui, part quand
// même).
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseDynamic } from '../supabase';
import { logAuditEvent } from '../audit/auditLog';
import type { PlantModel, SimConfig, SimResult } from './types';

export interface ScenarioResultSummary {
  throughputP10: number;
  throughputP50: number;
  throughputP90: number;
  availability: number;
  costPerTonne: number;
  recoveryMean: number;
  /** Nom de l'aire goulot la plus probable + sa probabilité. */
  topBottleneckName: string;
  topBottleneckProb: number;
}

export interface PlantOptScenario {
  id: string;
  project_id: string;
  name: string;
  model: PlantModel;
  config: SimConfig;
  result_summary: ScenarioResultSummary | null;
  created_at: string;
  updated_at?: string;
}

const TABLE = 'plantopt_scenarios';
const lsKey = (projectId: string) => `mfp_plantopt_scenarios_${projectId}`;

// ── Repli localStorage (session/navigateur) ──────────────────────────────────

function readLocal(projectId: string): PlantOptScenario[] {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    return raw ? (JSON.parse(raw) as PlantOptScenario[]) : [];
  } catch { return []; }
}
function writeLocal(projectId: string, rows: PlantOptScenario[]): void {
  try { localStorage.setItem(lsKey(projectId), JSON.stringify(rows)); } catch { /* quota/private */ }
}

/** Construit le résumé de résultat persisté depuis un `SimResult` + le modèle. */
export function summariseResult(model: PlantModel, result: SimResult): ScenarioResultSummary {
  let topId = '';
  let topProb = -1;
  for (const [id, prob] of Object.entries(result.bottleneckProbability)) {
    if (prob > topProb) { topProb = prob; topId = id; }
  }
  const topArea = model.areas.find(a => a.id === topId);
  return {
    throughputP10: result.throughputP10,
    throughputP50: result.throughputP50,
    throughputP90: result.throughputP90,
    availability: result.availability,
    costPerTonne: result.costPerTonne,
    recoveryMean: result.recoveryMean,
    topBottleneckName: topArea?.name ?? '—',
    topBottleneckProb: topProb < 0 ? 0 : topProb,
  };
}

/** Liste les scénarios d'un projet (DB d'abord, repli local). */
export async function listScenarios(projectId: string): Promise<PlantOptScenario[]> {
  try {
    const { data, error } = await supabaseDynamic
      .from(TABLE)
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error || !data) return readLocal(projectId);
    return data as PlantOptScenario[];
  } catch {
    return readLocal(projectId);
  }
}

export interface SaveScenarioInput {
  projectId: string;
  name: string;
  model: PlantModel;
  config: SimConfig;
  result: SimResult | null;
}

/**
 * Enregistre un scénario et journalise l'événement d'audit. Renvoie la ligne
 * persistée (ou le repli local si la table est absente).
 */
export async function saveScenario(input: SaveScenarioInput): Promise<PlantOptScenario | null> {
  const { projectId, name, model, config, result } = input;
  const summary = result ? summariseResult(model, result) : null;
  const payload = {
    project_id: projectId,
    name,
    model,
    config,
    result_summary: summary,
  };

  let saved: PlantOptScenario | null = null;
  try {
    const { data, error } = await supabaseDynamic.from(TABLE).insert(payload).select().single();
    if (!error && data) saved = data as PlantOptScenario;
  } catch { /* fallthrough to local */ }

  if (!saved) {
    // Repli local : identifiant + horodatage synthétiques.
    saved = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `local_${Date.now()}`,
      project_id: projectId,
      name,
      model,
      config,
      result_summary: summary,
      created_at: new Date().toISOString(),
    };
    const rows = readLocal(projectId);
    rows.unshift(saved);
    writeLocal(projectId, rows);
  }

  await logAuditEvent({
    projectId,
    action: 'create',
    entityType: 'plant_opt_scenario',
    entityId: saved.id,
    newValues: { name, areas: model.areas.length, ...(summary ?? {}) },
    metadata: { iterations: config.iterations, seed: config.seed, horizonHours: config.horizonHours ?? model.horizonHours },
  });

  return saved;
}

/** Supprime un scénario (DB puis local) et journalise. */
export async function deleteScenario(id: string, projectId: string): Promise<void> {
  try {
    await supabaseDynamic.from(TABLE).delete().eq('id', id).eq('project_id', projectId);
  } catch { /* ignore */ }
  const rows = readLocal(projectId).filter(r => r.id !== id);
  writeLocal(projectId, rows);
  await logAuditEvent({
    projectId,
    action: 'delete',
    entityType: 'plant_opt_scenario',
    entityId: id,
  });
}

/**
 * Journalise l'exécution d'une optimisation (sans forcément la sauvegarder) : la
 * traçabilité « un run a eu lieu avec ces hypothèses » est ainsi toujours captée.
 */
export async function logOptimizationRun(
  projectId: string,
  model: PlantModel,
  config: SimConfig,
  result: SimResult,
): Promise<void> {
  const summary = summariseResult(model, result);
  await logAuditEvent({
    projectId,
    action: 'run_plant_optimization',
    entityType: 'plant_opt_scenario',
    entityId: model.id,
    newValues: summary as unknown as Record<string, unknown>,
    metadata: {
      iterations: config.iterations,
      seed: config.seed,
      horizonHours: config.horizonHours ?? model.horizonHours,
      timeStepHours: config.timeStepHours,
      warmupHours: config.warmupHours,
      areas: model.areas.length,
      failureModes: model.failureModes.length,
    },
  });
}
