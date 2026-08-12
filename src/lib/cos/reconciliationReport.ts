// ─────────────────────────────────────────────────────────────────────────────
// Consolidation des scénarios de réconciliation en RAPPORT de metal accounting.
//
// Les runs persistés (1G) portent chacun un `result_summary` hétérogène selon la
// méthode (réseau → composants ; bilinéaire → tonnage + métaux ; sériel → réseau
// + éliminations). Ce module PUR normalise ces extraits en lignes homogènes
// puis en un rapport agrégé (compte par méthode, runs en erreur grossière,
// dernier run) — la sortie de gouvernance qu'AMIRA P754 attend, testable sans UI.
// ─────────────────────────────────────────────────────────────────────────────

import type { ReconciliationRun, ReconMethod } from './reconciliationRuns';

/** Une clôture consolidée (composant ou métal) d'un run. */
export interface ReportClosure {
  key: string;
  /** % de clôture (sortie/entrée), null si non calculée. */
  closurePct: number | null;
  grossError: boolean;
}

/** Ligne de rapport normalisée pour un run. */
export interface ReportRow {
  id: string;
  label: string;
  method: ReconMethod;
  createdAt: string;
  closures: ReportClosure[];
  /** Au moins une clôture en erreur grossière. */
  anyGrossError: boolean;
  /** Nombre d'éliminations sérielles, si applicable. */
  eliminations: number | null;
}

export interface ReconciliationReport {
  total: number;
  byMethod: Record<ReconMethod, number>;
  /** Runs comportant au moins une erreur grossière. */
  grossErrorRuns: number;
  /** Run le plus récent (rows triées du plus récent au plus ancien). */
  latest: ReportRow | null;
  rows: ReportRow[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Extrait les clôtures d'un `result_summary` selon la forme de la méthode. */
function extractClosures(method: ReconMethod, summary: Record<string, unknown>): ReportClosure[] {
  // Réseau / sériel : { components: [{ key, closurePct, grossError }] }
  if (Array.isArray(summary.components)) {
    return (summary.components as Record<string, unknown>[])
      .filter(c => !c.empty)
      .map(c => ({ key: String(c.key ?? '?'), closurePct: num(c.closurePct), grossError: Boolean(c.grossError) }));
  }
  // Bilinéaire : { tonnageClosurePct, metals: [{ key, metalClosurePct, grossError }] }
  const closures: ReportClosure[] = [];
  const tc = num(summary.tonnageClosurePct);
  if (tc != null) closures.push({ key: 'tonnage', closurePct: tc, grossError: false });
  if (Array.isArray(summary.metals)) {
    for (const m of summary.metals as Record<string, unknown>[]) {
      closures.push({ key: String(m.key ?? '?'), closurePct: num(m.metalClosurePct), grossError: Boolean(m.grossError) });
    }
  }
  void method;
  return closures;
}

function toRow(run: ReconciliationRun): ReportRow {
  const summary = run.result_summary ?? {};
  const closures = extractClosures(run.method, summary);
  const elimFromInput = (run.input as Record<string, unknown> | undefined)?.serial ? 0 : null;
  return {
    id: run.id,
    label: run.label,
    method: run.method,
    createdAt: run.created_at,
    closures,
    anyGrossError: closures.some(c => c.grossError),
    // les éliminations détaillées ne sont pas dans le résumé ; on signale au moins
    // qu'un run sériel a été mené (0 = piste sérielle sans compteur persisté).
    eliminations: run.method === 'serial' ? (typeof summary.eliminations === 'number' ? summary.eliminations : elimFromInput ?? 0) : null,
  };
}

const EMPTY_BY_METHOD: Record<ReconMethod, number> = { network: 0, bilinear: 0, bilinear_iter: 0, serial: 0 };

/** Consolide une liste de runs persistés en rapport de metal accounting. */
export function summarizeReconciliationRuns(runs: ReconciliationRun[]): ReconciliationReport {
  const rows = [...runs]
    .map(toRow)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  const byMethod = { ...EMPTY_BY_METHOD };
  for (const r of rows) byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;

  return {
    total: rows.length,
    byMethod,
    grossErrorRuns: rows.filter(r => r.anyGrossError).length,
    latest: rows[0] ?? null,
    rows,
  };
}
