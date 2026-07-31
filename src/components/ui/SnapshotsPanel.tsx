import { useState } from 'react';
import { Camera, RotateCcw, Trash2, Info, Plus, GitCompare } from 'lucide-react';
import {
  listSnapshots, createSnapshot, deleteSnapshot, restoreSnapshot,
  type ProjectSnapshot, type KpiSnapshot,
} from '../../lib/snapshots';
import type { Project } from '../../types';
import { formatDecimalGrouped } from '../../lib/format/number';
import { notifyError, notifySuccess } from '../../lib/notify';
import { useQuery } from '../../lib/query/useQuery';

interface SnapshotsPanelProps {
  project: Project;
  kpi: KpiSnapshot;
  settingsState: Record<string, unknown>;
  onRestored?: (project: Project) => void;
}

/** Metric rows shown in the comparison table — value extractor + formatter. */
const COMPARE_ROWS: {
  key: string;
  label: string;
  get: (s: ProjectSnapshot) => number | null;
  fmt: (v: number) => string;
  higherIsBetter?: boolean;
}[] = [
  { key: 'oz',   label: 'Production',   get: s => s.kpi_snapshot?.annualOz ?? null,      fmt: v => `${formatDecimalGrouped(v / 1000, 1)} koz`, higherIsBetter: true },
  { key: 'rev',  label: 'Revenus',      get: s => s.kpi_snapshot?.revenueMusd ?? null,   fmt: v => `${formatDecimalGrouped(v, 1)} M$`,         higherIsBetter: true },
  { key: 'aisc', label: 'AISC',         get: s => s.kpi_snapshot?.aiscUsdOz ?? null,     fmt: v => `${formatDecimalGrouped(v, 0)} $/oz`,       higherIsBetter: false },
  { key: 'capex',label: 'CAPEX',        get: s => s.kpi_snapshot?.totalCapexMusd ?? null,fmt: v => `${formatDecimalGrouped(v, 1)} M$`,         higherIsBetter: false },
  { key: 'rec',  label: 'Récup. eff.',  get: s => s.kpi_snapshot?.effectiveRecoveryPct ?? null, fmt: v => `${formatDecimalGrouped(v, 1)}%`,     higherIsBetter: true },
  { key: 'tph',  label: 'Débit',        get: s => (s.project_state?.target_tph as number) ?? null,   fmt: v => `${v} t/h` },
  { key: 'grade',label: 'Teneur Au',    get: s => (s.project_state?.gold_grade_g_t as number) ?? null, fmt: v => `${v} g/t` },
  { key: 'price',label: 'Prix Au',      get: s => (s.project_state?.gold_price_usd as number) ?? null, fmt: v => `${v} $/oz` },
];

/**
 * Scenario snapshots (T4): capture the current project state under a name, list
 * past captures, compare any subset side-by-side (KPI diff), restore or delete
 * them. Degrades gracefully when the `project_snapshots` table is not yet
 * provisioned — shows a one-line activation hint instead of erroring.
 */
export function SnapshotsPanel({ project, kpi, settingsState, onRestored }: SnapshotsPanelProps) {
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comparing, setComparing] = useState(false);

  // Cached, de-duplicated read via the T7 query layer (stale-while-revalidate).
  const { data, loading, refetch } = useQuery(
    `snapshots:${project.id}`,
    () => listSnapshots(project.id),
    { staleTime: 15_000 },
  );
  const snapshots = data?.snapshots ?? [];
  const tableMissing = data?.tableMissing ?? false;

  async function handleCreate() {
    const name = label.trim() || `Snapshot ${new Date().toLocaleString('fr-FR')}`;
    setSaving(true);
    try {
      const res = await createSnapshot({
        projectId: project.id, label: name, projectState: project, settingsState, kpi,
      });
      if (res.tableMissing) { await refetch(); return; }
      setLabel('');
      notifySuccess(`Snapshot « ${name} » enregistré`);
      await refetch();
    } catch {
      notifyError('Enregistrement du snapshot impossible');
    } finally {
      setSaving(false);
    }
  }

  async function handleRestore(s: ProjectSnapshot) {
    const restored = await restoreSnapshot(s, project.id);
    if (restored) {
      notifySuccess(`Paramètres restaurés depuis « ${s.label} »`);
      onRestored?.(restored);
    }
  }

  async function handleDelete(id: string) {
    await deleteSnapshot(id, project.id);
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    await refetch();
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // "Current" state as a pseudo-snapshot so it always anchors the comparison.
  const currentAsSnapshot: ProjectSnapshot = {
    id: '__current__', project_id: project.id, label: 'Actuel',
    project_state: project, settings_state: settingsState, kpi_snapshot: kpi,
    note: null, created_at: new Date().toISOString(),
  };
  const compareCols = [currentAsSnapshot, ...snapshots.filter(s => selected.has(s.id))];

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera size={15} className="text-amber-400" />
          <div className="section-title">Snapshots de scénarios</div>
        </div>
        <div className="flex items-center gap-3">
          {selected.size > 0 && (
            <button
              onClick={() => setComparing(c => !c)}
              className={`btn btn-sm ${comparing ? 'btn-primary' : 'btn-secondary'}`}
            >
              <GitCompare size={13} /> Comparer ({selected.size})
            </button>
          )}
          <span className="text-[10px] text-mf-txt4">{snapshots.length} capture(s)</span>
        </div>
      </div>

      {tableMissing ? (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/8 border border-amber-500/20 text-xs text-mf-txt3">
          <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            Fonctionnalité à activer : exécutez la migration
            <code className="mx-1 px-1 rounded bg-mf-panel text-amber-300">project_snapshots.sql</code>
            dans Supabase (SQL Editor), puis rechargez.
          </div>
        </div>
      ) : (
        <>
          {/* Capture bar */}
          <div className="flex gap-2">
            <input
              className="input-field flex-1 text-sm"
              placeholder="Nom du scénario (ex. Cas de base v3)"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
            <button className="btn btn-sm btn-primary" onClick={handleCreate} disabled={saving}>
              <Plus size={13} /> Capturer
            </button>
          </div>

          {/* Comparison table */}
          {comparing && compareCols.length > 1 && (
            <div className="overflow-x-auto rounded-lg border border-mf-border">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Métrique</th>
                    {compareCols.map(c => (
                      <th key={c.id} className="text-right">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map(row => {
                    const base = row.get(compareCols[0]);
                    return (
                      <tr key={row.key}>
                        <td className="text-mf-txt3">{row.label}</td>
                        {compareCols.map((c, ci) => {
                          const v = row.get(c);
                          let deltaCls = 'text-mf-txt';
                          if (ci > 0 && v != null && base != null && row.higherIsBetter != null) {
                            const better = row.higherIsBetter ? v > base : v < base;
                            const worse = row.higherIsBetter ? v < base : v > base;
                            if (better) deltaCls = 'text-emerald-400';
                            else if (worse) deltaCls = 'text-red-400';
                          }
                          return (
                            <td key={c.id} className={`num ${deltaCls}`}>
                              {v != null ? row.fmt(v) : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="text-xs text-mf-txt4 py-2">Chargement…</div>
          ) : snapshots.length === 0 ? (
            <div className="text-xs text-mf-txt4 py-2">
              Aucun snapshot. Capturez l'état actuel pour pouvoir le comparer ou y revenir.
            </div>
          ) : (
            <div className="space-y-1.5">
              {snapshots.map(s => (
                <div key={s.id} className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                  selected.has(s.id) ? 'bg-amber-500/8 border-amber-500/30' : 'bg-mf-panel/40 border-mf-border/60'
                }`}>
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleSelect(s.id)}
                    aria-label={`Sélectionner ${s.label} pour comparaison`}
                    className="w-3.5 h-3.5 shrink-0 accent-amber-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-mf-txt truncate">{s.label}</div>
                    <div className="text-[10px] text-mf-txt4 font-mono">
                      {new Date(s.created_at).toLocaleString('fr-FR')}
                      {s.kpi_snapshot?.annualOz != null && (
                        <> · {formatDecimalGrouped(s.kpi_snapshot.annualOz / 1000, 1)} koz/an</>
                      )}
                      {s.kpi_snapshot?.aiscUsdOz != null && (
                        <> · AISC {formatDecimalGrouped(s.kpi_snapshot.aiscUsdOz, 0)} $/oz</>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(s)}
                    title="Restaurer ces paramètres sur le projet"
                    className="btn btn-sm btn-ghost"
                  >
                    <RotateCcw size={13} /> Restaurer
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    title="Supprimer"
                    className="text-mf-txt4 hover:text-mf-red transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
