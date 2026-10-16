// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — persistance du modèle par projet (table mine_cost_models).
//
// Une ligne par projet : méthode + SURCHARGES de l'utilisateur (le reste est
// relu du projet à chaque ouverture, voir lib/mining/projectInputs.ts), résumé
// du dernier calcul injecté dans l'Économie, et part minière appliquée au
// capital de maintien.
//
// Écritures via la couche S7 (upsertRows : nombre de lignes prouvé) ; lecture
// via le client dynamique (table hors types générés). Repli localStorage si la
// table n'est pas encore migrée, pour ne jamais bloquer l'écran.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseDynamic } from '../supabase';
import { upsertRows } from './mutations';
import type { MiningMethod } from '../mining/types';
import type { MiningOverrides } from '../mining/projectInputs';

export interface MineCostSummary {
  method: MiningMethod;
  initialCapexMusd: number;
  sustainingMusdPerYear: number;
  opexUsdPerOreTonne: number;
  capexLines: number;
  opexLines: number;
  appliedAt: string;
}

export interface MineCostModelRow {
  id?: string;
  project_id: string;
  method: MiningMethod;
  overrides: MiningOverrides;
  result_summary: MineCostSummary | null;
  applied_sustaining_musd_yr: number | null;
  updated_at?: string;
}

const TABLE = 'mine_cost_models';
const lsKey = (projectId: string) => `mfp_mine_cost_model_${projectId}`;

/** Erreur « table absente » (migration non appliquée) : PostgREST PGRST205 / Postgres 42P01. */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  return !!err && (err.code === 'PGRST205' || err.code === '42P01' || /does not exist|schema cache/i.test(err.message ?? ''));
}

function readLocal(projectId: string): MineCostModelRow | null {
  try {
    const raw = localStorage.getItem(lsKey(projectId));
    return raw ? (JSON.parse(raw) as MineCostModelRow) : null;
  } catch { return null; }
}

function writeLocal(row: MineCostModelRow): void {
  try { localStorage.setItem(lsKey(row.project_id), JSON.stringify(row)); } catch { /* quota / navigation privée */ }
}

export async function loadMineCostModel(projectId: string): Promise<MineCostModelRow | null> {
  const { data, error } = await supabaseDynamic.from(TABLE).select('*').eq('project_id', projectId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return readLocal(projectId);
    throw new Error(`Lecture du modèle de coûts miniers impossible : ${error.message}`);
  }
  return (data as MineCostModelRow | null) ?? null;
}

/** Enregistre (insère ou remplace) le modèle du projet. */
export async function saveMineCostModel(row: MineCostModelRow): Promise<MineCostModelRow> {
  const payload: MineCostModelRow = { ...row, updated_at: new Date().toISOString() };
  delete payload.id;
  try {
    const [saved] = await upsertRows<MineCostModelRow>(TABLE, [payload], { onConflict: 'project_id', label: 'enregistrer le modèle de coûts miniers' });
    return saved ?? payload;
  } catch (e) {
    const err = (e as { cause?: { code?: string; message?: string } }).cause ?? (e as { code?: string; message?: string });
    if (isMissingTable(err)) { writeLocal(payload); return payload; }
    throw e;
  }
}
