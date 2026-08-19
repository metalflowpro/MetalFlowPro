// ─────────────────────────────────────────────────────────────────────────────
// Couche données du module d'étude P80.
//
// Le client Supabase n'est pas typé globalement (voir rows.ts) ; on expose ici
// des interfaces de lignes explicites et des helpers CRUD, chacun écrivant dans
// p80_audit_log pour la traçabilité exigée par la spec §8. Le LIMS n'est JAMAIS
// muté : on n'y stocke que des références (lims_sample_id, lims_result_id).
// ─────────────────────────────────────────────────────────────────────────────

// Vue NON typée du client : les tables p80_* ne figurent pas (encore) dans les
// types générés `database.types.ts`. `supabaseDynamic` conserve les mêmes
// notifications d'erreur d'écriture que le client typé.
import { supabaseDynamic as supabase } from '../supabase';
import type { Json } from '../database.types';

// ── Types de lignes ──────────────────────────────────────────────────────────

export type StudyStatus =
  | 'draft' | 'samples_selected' | 'plan_approved' | 'results_imported'
  | 'qc' | 'computed' | 'reviewed' | 'recommendation_approved' | 'published';

export type StudyObjective = 'recovery' | 'throughput' | 'cost' | 'net_value';

export interface P80Study {
  id: string;
  project_id: string;
  study_name: string;
  ore_type: string | null;
  deposit_zone: string | null;
  process_route: string | null;
  objective: StudyObjective;
  p80_targets_um: number[];
  status: StudyStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface P80StudySample {
  id: string;
  project_id: string;
  study_id: string;
  lims_sample_id: string | null;
  sample_type: string | null;
  geological_domain: string | null;
  head_grade_au: number | null;
  sample_mass: number | null;
  representativity_status: 'to_verify' | 'acceptable' | 'rejected';
  selection_reason: string | null;
  created_at: string;
}

export interface P80TestPlan {
  id: string;
  project_id: string;
  study_id: string;
  study_sample_id: string | null;
  test_type: string;
  target_p80: number | null;
  p80_lower_limit: number | null;
  p80_upper_limit: number | null;
  replicate_count: number;
  method_id: string | null;
  planned_date: string | null;
  created_at: string;
}

export interface P80TestResult {
  id: string;
  project_id: string;
  study_id: string;
  test_plan_id: string | null;
  lims_result_id: string | null;
  lims_result_version: number | null;
  target_p80: number | null;
  actual_p80: number | null;
  p80_unit: string;
  au_feed: number | null;
  au_concentrate: number | null;
  au_tailings: number | null;
  au_recovery: number | null;
  mass_recovery: number | null;
  reagent_consumption: number | null;
  energy_consumption: number | null;
  throughput: number | null;
  psd_curve: Json | null;
  computed_p80: number | null;
  computed_recovery: number | null;
  p80_method: string | null;
  qc_status: 'conforme' | 'a_revoir' | 'non_conforme';
  review_status: 'non_revise' | 'revise' | 'approuve';
  created_at: string;
}

export interface P80PlantScenario {
  id: string;
  project_id: string;
  study_id: string;
  target_p80: number;
  f80_um: number | null;
  throughput_tph: number | null;
  mill_power_kw: number | null;
  bond_wi: number | null;
  recovery_pct: number | null;
  energy_kwh_t: number | null;
  ball_consumption: number | null;
  oz_per_day: number | null;
  net_value_per_day: number | null;
  created_at: string;
}

export interface P80Recommendation {
  id: string;
  project_id: string;
  study_id: string;
  lab_p80_um: number | null;
  plant_p80_um: number | null;
  range_low_um: number | null;
  range_high_um: number | null;
  estimated_recovery_pct: number | null;
  confidence: 'low' | 'medium' | 'high';
  rationale: string | null;
  assumptions: Json;
  validation_required: string[];
  status: 'draft' | 'approved' | 'published';
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export type AuditEntity = 'study' | 'sample' | 'plan' | 'result' | 'scenario' | 'recommendation';
export type AuditAction = 'create' | 'update' | 'delete' | 'status_change' | 'approve';

// ── Utilitaires ──────────────────────────────────────────────────────────────

/** Email de l'utilisateur courant, pour created_by / approved_by / actor. */
export async function currentActor(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? data.user?.id ?? null;
}

/** Écrit une entrée d'audit. Ne lève jamais : l'audit ne doit pas casser le flux. */
export async function auditLog(
  projectId: string,
  studyId: string | null,
  entity: AuditEntity,
  entityId: string | null,
  action: AuditAction,
  oldValue: Json | null,
  newValue: Json | null,
): Promise<void> {
  try {
    const actor = await currentActor();
    await supabase.from('p80_audit_log').insert({
      project_id: projectId, study_id: studyId, entity, entity_id: entityId,
      action, actor, old_value: oldValue, new_value: newValue,
    });
  } catch (e) {
    console.error('[p80 audit]', e);
  }
}

// ── Études ───────────────────────────────────────────────────────────────────

export async function listStudies(projectId: string): Promise<P80Study[]> {
  const { data, error } = await supabase
    .from('p80_study').select('*')
    .eq('project_id', projectId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as P80Study[];
}

export async function createStudy(
  projectId: string, patch: Partial<P80Study> & { study_name: string },
): Promise<P80Study> {
  const created_by = await currentActor();
  const { data, error } = await supabase
    .from('p80_study')
    .insert({ project_id: projectId, created_by, ...patch })
    .select().single();
  if (error) throw error;
  const row = data as P80Study;
  await auditLog(projectId, row.id, 'study', row.id, 'create', null, patch as Json);
  return row;
}

export async function updateStudy(
  study: P80Study, patch: Partial<P80Study>,
): Promise<P80Study> {
  const isStatusChange = patch.status != null && patch.status !== study.status;
  const { data, error } = await supabase
    .from('p80_study')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', study.id).select().single();
  if (error) throw error;
  await auditLog(
    study.project_id, study.id, 'study', study.id,
    isStatusChange ? 'status_change' : 'update',
    { status: study.status } as Json, patch as Json,
  );
  return data as P80Study;
}

// ── Échantillons ─────────────────────────────────────────────────────────────

export async function listSamples(studyId: string): Promise<P80StudySample[]> {
  const { data, error } = await supabase
    .from('p80_study_sample').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as P80StudySample[];
}

export async function addSample(
  projectId: string, studyId: string, patch: Partial<P80StudySample>,
): Promise<P80StudySample> {
  const { data, error } = await supabase
    .from('p80_study_sample')
    .insert({ project_id: projectId, study_id: studyId, ...patch })
    .select().single();
  if (error) throw error;
  const row = data as P80StudySample;
  await auditLog(projectId, studyId, 'sample', row.id, 'create', null, patch as Json);
  return row;
}

export async function removeSample(row: P80StudySample): Promise<void> {
  const { error } = await supabase.from('p80_study_sample').delete().eq('id', row.id);
  if (error) throw error;
  await auditLog(row.project_id, row.study_id, 'sample', row.id, 'delete', row as unknown as Json, null);
}

// ── Plan d'essais ────────────────────────────────────────────────────────────

export async function listPlans(studyId: string): Promise<P80TestPlan[]> {
  const { data, error } = await supabase
    .from('p80_test_plan').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as P80TestPlan[];
}

export async function insertPlans(
  projectId: string, studyId: string, plans: Array<Partial<P80TestPlan>>,
): Promise<P80TestPlan[]> {
  if (plans.length === 0) return [];
  const rows = plans.map(p => ({ project_id: projectId, study_id: studyId, ...p }));
  const { data, error } = await supabase.from('p80_test_plan').insert(rows).select();
  if (error) throw error;
  await auditLog(projectId, studyId, 'plan', null, 'create', null, { count: plans.length } as Json);
  return (data ?? []) as P80TestPlan[];
}

export async function clearPlans(projectId: string, studyId: string): Promise<void> {
  const { error } = await supabase.from('p80_test_plan').delete().eq('study_id', studyId);
  if (error) throw error;
  await auditLog(projectId, studyId, 'plan', null, 'delete', null, null);
}

// ── Résultats ────────────────────────────────────────────────────────────────

export async function listResults(studyId: string): Promise<P80TestResult[]> {
  const { data, error } = await supabase
    .from('p80_test_result').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as P80TestResult[];
}

export async function upsertResult(
  projectId: string, studyId: string, patch: Partial<P80TestResult> & { id?: string },
): Promise<P80TestResult> {
  const isUpdate = !!patch.id;
  const { data, error } = await supabase
    .from('p80_test_result')
    .upsert({ project_id: projectId, study_id: studyId, ...patch })
    .select().single();
  if (error) throw error;
  const row = data as P80TestResult;
  await auditLog(projectId, studyId, 'result', row.id, isUpdate ? 'update' : 'create', null, patch as Json);
  return row;
}

export async function deleteResult(row: P80TestResult): Promise<void> {
  const { error } = await supabase.from('p80_test_result').delete().eq('id', row.id);
  if (error) throw error;
  await auditLog(row.project_id, row.study_id, 'result', row.id, 'delete', row as unknown as Json, null);
}

// ── Scénarios usine ──────────────────────────────────────────────────────────

export async function listScenarios(studyId: string): Promise<P80PlantScenario[]> {
  const { data, error } = await supabase
    .from('p80_plant_scenario').select('*').eq('study_id', studyId)
    .order('target_p80', { ascending: false });
  if (error) throw error;
  return (data ?? []) as P80PlantScenario[];
}

export async function replaceScenarios(
  projectId: string, studyId: string, scenarios: Array<Partial<P80PlantScenario>>,
): Promise<P80PlantScenario[]> {
  await supabase.from('p80_plant_scenario').delete().eq('study_id', studyId);
  if (scenarios.length === 0) return [];
  const rows = scenarios.map(s => ({ project_id: projectId, study_id: studyId, ...s }));
  const { data, error } = await supabase.from('p80_plant_scenario').insert(rows).select();
  if (error) throw error;
  await auditLog(projectId, studyId, 'scenario', null, 'update', null, { count: scenarios.length } as Json);
  return (data ?? []) as P80PlantScenario[];
}

// ── Recommandation ───────────────────────────────────────────────────────────

export async function latestRecommendation(studyId: string): Promise<P80Recommendation | null> {
  const { data, error } = await supabase
    .from('p80_recommendation').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return (data as P80Recommendation | null) ?? null;
}

export async function saveRecommendation(
  projectId: string, studyId: string, patch: Partial<P80Recommendation>,
): Promise<P80Recommendation> {
  const { data, error } = await supabase
    .from('p80_recommendation')
    .insert({ project_id: projectId, study_id: studyId, ...patch })
    .select().single();
  if (error) throw error;
  const row = data as P80Recommendation;
  await auditLog(projectId, studyId, 'recommendation', row.id, 'create', null, patch as Json);
  return row;
}

export async function approveRecommendation(
  row: P80Recommendation, status: 'approved' | 'published',
): Promise<P80Recommendation> {
  const approved_by = await currentActor();
  const { data, error } = await supabase
    .from('p80_recommendation')
    .update({ status, approved_by, approved_at: new Date().toISOString() })
    .eq('id', row.id).select().single();
  if (error) throw error;
  await auditLog(row.project_id, row.study_id, 'recommendation', row.id, 'approve',
    { status: row.status } as Json, { status } as Json);
  return data as P80Recommendation;
}

// ═══ Phase 2 ═════════════════════════════════════════════════════════════════

// ── Signature électronique (21 CFR Part 11) ──────────────────────────────────

export interface P80Signature {
  id: string;
  project_id: string;
  study_id: string;
  recommendation_id: string | null;
  signer: string;
  signer_role: 'analyst' | 'responsible';
  meaning: string;
  content_hash: string;
  signed_at: string;
}

/** SHA-256 hex du contenu signé — lie la signature au dossier (intégrité). */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function listSignatures(studyId: string): Promise<P80Signature[]> {
  const { data, error } = await supabase
    .from('p80_signature').select('*').eq('study_id', studyId)
    .order('signed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as P80Signature[];
}

/** Enregistre une signature immuable (append-only). Le signataire = session courante. */
export async function addSignature(
  projectId: string, studyId: string,
  recommendationId: string | null, role: 'analyst' | 'responsible',
  meaning: string, signedContent: string,
): Promise<P80Signature> {
  const signer = await currentActor();
  const content_hash = await sha256Hex(signedContent);
  const { data, error } = await supabase
    .from('p80_signature')
    .insert({
      project_id: projectId, study_id: studyId, recommendation_id: recommendationId,
      signer: signer ?? 'inconnu', signer_role: role, meaning, content_hash,
    })
    .select().single();
  if (error) throw error;
  const row = data as P80Signature;
  await auditLog(projectId, studyId, 'recommendation', recommendationId, 'approve',
    null, { signature: meaning, signer, content_hash } as Json);
  return row;
}

// ── GRG (essai étagé) ────────────────────────────────────────────────────────

export interface P80GrgTest {
  id: string; project_id: string; study_id: string; study_sample_id: string | null;
  stages: Json; cumulative_grg_pct: number | null; created_at: string;
}

export async function listGrg(studyId: string): Promise<P80GrgTest[]> {
  const { data, error } = await supabase.from('p80_grg_test').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as P80GrgTest[];
}

export async function saveGrg(
  projectId: string, studyId: string, patch: Partial<P80GrgTest>,
): Promise<P80GrgTest> {
  const { data, error } = await supabase.from('p80_grg_test')
    .insert({ project_id: projectId, study_id: studyId, ...patch }).select().single();
  if (error) throw error;
  const row = data as P80GrgTest;
  await auditLog(projectId, studyId, 'result', row.id, 'create', null, { grg: patch.cumulative_grg_pct } as Json);
  return row;
}

// ── Locked-cycle ─────────────────────────────────────────────────────────────

export interface P80LockedCycle {
  id: string; project_id: string; study_id: string; study_sample_id: string | null;
  inputs: Json; converged_recovery_pct: number | null;
  circulating_load_fraction: number | null; cycles: number | null; created_at: string;
}

export async function listLockedCycle(studyId: string): Promise<P80LockedCycle[]> {
  const { data, error } = await supabase.from('p80_locked_cycle').select('*').eq('study_id', studyId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as P80LockedCycle[];
}

export async function saveLockedCycle(
  projectId: string, studyId: string, patch: Partial<P80LockedCycle>,
): Promise<P80LockedCycle> {
  const { data, error } = await supabase.from('p80_locked_cycle')
    .insert({ project_id: projectId, study_id: studyId, ...patch }).select().single();
  if (error) throw error;
  const row = data as P80LockedCycle;
  await auditLog(projectId, studyId, 'result', row.id, 'create', null, { lct: patch.converged_recovery_pct } as Json);
  return row;
}

// ── Config d'ingestion webhook LIMS ──────────────────────────────────────────

export interface P80IngestionConfig {
  id: string; project_id: string; study_id: string; enabled: boolean;
  secret: string; source_family: string; last_triggered_at: string | null; created_at: string;
}

export async function getIngestionConfig(studyId: string): Promise<P80IngestionConfig | null> {
  const { data, error } = await supabase.from('p80_ingestion_config').select('*')
    .eq('study_id', studyId).maybeSingle();
  if (error) throw error;
  return (data as P80IngestionConfig | null) ?? null;
}

/** Secret aléatoire (hex) pour authentifier le webhook LIMS entrant. */
export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function upsertIngestionConfig(
  projectId: string, studyId: string, patch: Partial<P80IngestionConfig>,
): Promise<P80IngestionConfig> {
  const existing = await getIngestionConfig(studyId);
  const payload = {
    project_id: projectId, study_id: studyId,
    secret: existing?.secret ?? randomSecret(), enabled: existing?.enabled ?? false,
    ...(existing ? { id: existing.id } : {}), ...patch,
  };
  const { data, error } = await supabase.from('p80_ingestion_config')
    .upsert(payload, { onConflict: 'study_id' }).select().single();
  if (error) throw error;
  return data as P80IngestionConfig;
}

// ── Synchronisation « pull » depuis le LIMS ──────────────────────────────────

/**
 * Rapatrie les essais PSD LIMS des échantillons sélectionnés en créant des
 * p80_test_result RÉFÉRENÇANT le résultat LIMS (lims_result_id = id de la ligne
 * lims_test_psd). Idempotent : n'insère pas deux fois le même lims_result_id.
 * Équivalent « pull » du webhook, toujours disponible et sans toucher au LIMS.
 */
export async function syncResultsFromLims(
  projectId: string, studyId: string, limsSampleIds: string[],
): Promise<number> {
  if (limsSampleIds.length === 0) return 0;
  const [{ data: psd }, existing] = await Promise.all([
    supabase.from('lims_test_psd').select('id,sample_id,p80_um').eq('project_id', projectId).in('sample_id', limsSampleIds),
    listResults(studyId),
  ]);
  const seen = new Set(existing.map(r => r.lims_result_id).filter(Boolean));
  const rows = ((psd ?? []) as Array<{ id: string; p80_um: number | null }>)
    .filter(r => !seen.has(r.id))
    .map(r => ({
      project_id: projectId, study_id: studyId, lims_result_id: r.id,
      target_p80: r.p80_um, actual_p80: r.p80_um, qc_status: 'a_revoir', review_status: 'non_revise',
    }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from('p80_test_result').insert(rows);
  if (error) throw error;
  await auditLog(projectId, studyId, 'result', null, 'create', null, { synced_from_lims: rows.length } as Json);
  return rows.length;
}
