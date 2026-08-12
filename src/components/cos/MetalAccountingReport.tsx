// ─────────────────────────────────────────────────────────────────────────────
// Rapport de metal accounting — consolide les scénarios de réconciliation
// persistés (1G) en une synthèse auditée (AMIRA P754). Sortie de gouvernance :
// production réconciliée par composant/métal, clôtures, erreurs grossières,
// pistes sérielles, datées. Imprimable (PDF) comme piste d'audit.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { ClipboardList, ShieldAlert, CheckCircle2, Database, RefreshCw } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { PrintButton } from '../ui/PrintButton';
import { listReconciliationRuns, type ReconciliationRun } from '../../lib/cos/reconciliationRuns';
import { summarizeReconciliationRuns, type ReconciliationReport } from '../../lib/cos/reconciliationReport';

const METHOD_LABEL: Record<string, string> = {
  network: 'Réseau', bilinear: 'Bilinéaire', bilinear_iter: 'Bilinéaire itératif', serial: 'Élimination sérielle',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString('fr-CA');
const closureTone = (pct: number | null) =>
  pct == null ? 'text-mf-txt4' : Math.abs(pct - 100) <= 2 ? 'text-emerald-400' : Math.abs(pct - 100) <= 5 ? 'text-amber-400' : 'text-red-400';

export function MetalAccountingReport({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { runs, tableMissing } = await listReconciliationRuns(projectId);
      setTableMissing(tableMissing);
      setReport(summarizeReconciliationRuns(runs as ReconciliationRun[]));
    } catch {
      setReport(summarizeReconciliationRuns([]));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (tableMissing) {
    return (
      <div className="card text-xs text-amber-300 bg-amber-500/5 border border-amber-500/25">
        Table <code>cos_reconciliation_runs</code> absente — exécuter la migration <code>..._cos_reconciliation_runs.sql</code> pour activer le rapport de metal accounting.
      </div>
    );
  }

  if (loading || !report) return <div className="card text-xs text-mf-txt4">Chargement du rapport…</div>;

  if (report.total === 0) {
    return (
      <div className="card text-xs text-mf-txt3">
        Aucun scénario de réconciliation sauvegardé. Sauvegardez un scénario (onglets Réseau / Bilinéaire) pour alimenter le rapport de metal accounting.
      </div>
    );
  }

  return (
    <div className="space-y-4 print-container">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <ClipboardList size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1 flex-1">
          <div><span className="font-semibold">Rapport de metal accounting (AMIRA P754)</span> — synthèse auditée des scénarios de réconciliation sauvegardés.</div>
          <div>Chaque ligne fige un circuit, sa méthode et ses clôtures à une date. Sert de piste d'audit avant usage financier.</div>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button className="btn btn-secondary btn-sm" onClick={() => void refresh()}><RefreshCw size={13} /> Rafraîchir</button>
          <PrintButton documentTitle="Rapport metal accounting" />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi icon={<Database size={14} className="text-blue-400" />} label="Scénarios" value={String(report.total)} sub="sauvegardés" />
        <Kpi icon={<ShieldAlert size={14} className="text-red-400" />} label="En erreur grossière" value={String(report.grossErrorRuns)} sub="à revoir" tone={report.grossErrorRuns > 0 ? 'text-red-400' : 'text-emerald-400'} />
        <Kpi icon={<CheckCircle2 size={14} className="text-emerald-400" />} label="Méthodes" value={String(Object.values(report.byMethod).filter(n => n > 0).length)} sub="employées" />
        <Kpi icon={<ClipboardList size={14} className="text-teal-400" />} label="Dernier run" value={report.latest ? METHOD_LABEL[report.latest.method] ?? report.latest.method : '—'} sub={report.latest ? fmtDate(report.latest.createdAt) : ''} />
      </div>

      {/* Détail par run */}
      <div className="card overflow-hidden">
        <div className="section-title mb-3">Scénarios réconciliés — détail audité</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-3">Scénario</th>
                <th className="py-2 pr-3">Méthode</th>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Clôtures (%)</th>
                <th className="py-2 pr-3 text-center">Statut</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map(r => (
                <tr key={r.id} className={`border-b border-mf-border/30 ${r.anyGrossError ? 'bg-red-500/5' : ''}`}>
                  <td className="py-2 pr-3 text-mf-txt2 font-medium">{r.label}</td>
                  <td className="py-2 pr-3 text-mf-txt3">{METHOD_LABEL[r.method] ?? r.method}{r.eliminations != null && <span className="text-mf-txt4"> · {r.eliminations} élim.</span>}</td>
                  <td className="py-2 pr-3 text-mf-txt4">{fmtDate(r.createdAt)}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.closures.length === 0 ? <span className="text-mf-txt4">—</span> : r.closures.map(c => (
                        <span key={c.key} className={`px-1.5 py-0.5 rounded bg-mf-hover/40 ${closureTone(c.closurePct)}`}>
                          {c.key}: {c.closurePct == null ? '—' : `${formatDecimalGrouped(c.closurePct, 1)}%`}{c.grossError && ' ⚠'}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {r.anyGrossError
                      ? <span className="inline-flex items-center gap-1 text-red-400"><ShieldAlert size={13} /> erreur</span>
                      : <span className="inline-flex items-center gap-1 text-emerald-400"><CheckCircle2 size={13} /> cohérent</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone = 'text-mf-txt' }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card-sm py-2.5 border border-mf-border">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-mf-txt4 uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div className={`text-lg font-bold mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-mf-txt4">{sub}</div>}
    </div>
  );
}
