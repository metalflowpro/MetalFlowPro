import { useState, useMemo } from 'react';
import { GitCompare } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { goldOuncesPerDay } from '../../lib/simulation/generator';
import type { SimRunResult } from '../../lib/simulation/types';

type Dir = 'max' | 'min' | 'none';

interface Row {
  key: string;
  label: string;
  unit?: string;
  dir: Dir;
  value: (r: SimRunResult) => number | null;
  fmt?: (v: number) => string;
}

const ROWS: Row[] = [
  { key: 'tph', label: 'Débit', unit: 't/h', dir: 'none', value: r => r.feed_input?.feed_rate ?? null, fmt: v => formatDecimalGrouped(v, 0) },
  { key: 'grade', label: 'Teneur Au', unit: 'g/t', dir: 'none', value: r => r.feed_input?.gold_grade ?? null, fmt: v => formatDecimalGrouped(v, 2) },
  { key: 'p80', label: 'P80 alimentation', unit: 'µm', dir: 'none', value: r => r.feed_input?.p80 ?? null, fmt: v => formatDecimalGrouped(v, 0) },
  { key: 'rec', label: 'Récupération Au', unit: '%', dir: 'max', value: r => r.global_results?.overall_recovery ?? null, fmt: v => formatDecimalGrouped(v, 1) },
  { key: 'oz', label: 'Au récupéré', unit: 'oz/j', dir: 'max',
    value: r => (r.feed_input && r.global_results) ? goldOuncesPerDay(r.feed_input.feed_rate, r.feed_input.gold_grade, r.global_results.overall_recovery / 100) : null,
    fmt: v => formatDecimalGrouped(v, 0) },
  { key: 'energy', label: 'Énergie', unit: 'kWh/t', dir: 'min', value: r => r.global_results?.total_energy_kwh_t ?? null, fmt: v => formatDecimalGrouped(v, 1) },
  { key: 'cn', label: 'Cyanure', unit: 'kg/t', dir: 'min', value: r => r.global_results?.cyanide_consumption ?? null, fmt: v => formatDecimalGrouped(v, 2) },
  { key: 'opex', label: 'OPEX', unit: '$/t', dir: 'min', value: r => r.global_results?.total_opex_per_t ?? null, fmt: v => formatDecimalGrouped(v, 2) },
  { key: 'tails', label: 'Teneur résidus', unit: 'g/t', dir: 'min', value: r => r.global_results?.tails_grade ?? null, fmt: v => formatDecimalGrouped(v, 3) },
];

/** Compare plusieurs simulations côte à côte (§10). Le cas de base reste intact :
 *  on ne modifie rien, on met en regard les runs déjà enregistrés. */
export default function ComparisonTab({ runs }: { runs: SimRunResult[] }) {
  // Sélection : par défaut les 4 runs les plus récents.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(runs.slice(0, 4).map(r => r.id)));

  const cols = useMemo(() => runs.filter(r => selected.has(r.id)), [runs, selected]);

  // Meilleure valeur par ligne (selon la direction) pour surligner la colonne gagnante.
  const bestByRow = useMemo(() => {
    const m: Record<string, number | null> = {};
    for (const row of ROWS) {
      if (row.dir === 'none') { m[row.key] = null; continue; }
      const vals = cols.map(row.value).filter((v): v is number => v != null && Number.isFinite(v));
      if (vals.length === 0) { m[row.key] = null; continue; }
      m[row.key] = row.dir === 'max' ? Math.max(...vals) : Math.min(...vals);
    }
    return m;
  }, [cols]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (runs.length === 0) {
    return (
      <div className="p-6 h-full flex items-center justify-center text-slate-500">
        Lancez au moins une simulation pour comparer des scénarios.
      </div>
    );
  }

  return (
    <div className="p-6 overflow-auto h-full">
      <div className="flex items-center gap-2 mb-4">
        <GitCompare size={18} className="text-blue-400" />
        <h3 className="section-title">Comparaison des scénarios</h3>
        <span className="text-xs text-slate-500">{cols.length} sélectionné(s) sur {runs.length}</span>
      </div>

      {/* Sélecteur de runs */}
      <div className="flex flex-wrap gap-2 mb-4">
        {runs.map(r => {
          const on = selected.has(r.id);
          return (
            <button key={r.id} onClick={() => toggle(r.id)}
              className={`px-2.5 py-1 text-xs rounded border ${on ? 'bg-blue-500/15 border-blue-500/40 text-blue-200' : 'border-slate-600 text-slate-400 hover:border-slate-400'}`}>
              {new Date(r.created_at).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' })}
              {' · '}{formatDecimalGrouped(r.global_results?.overall_recovery ?? 0, 1)}%
            </button>
          );
        })}
      </div>

      {cols.length === 0 ? (
        <div className="text-sm text-slate-500">Sélectionnez au moins une simulation à comparer.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-slate-400 uppercase border-b border-slate-700">
                <th className="py-2 pr-4">Indicateur</th>
                {cols.map((r, i) => (
                  <th key={r.id} className="py-2 px-3 text-right whitespace-nowrap">
                    Scénario {i + 1}
                    <div className="text-[10px] normal-case text-slate-500">
                      {new Date(r.created_at).toLocaleDateString('fr-CA')}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(row => (
                <tr key={row.key} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4 text-slate-400">{row.label} {row.unit && <span className="text-slate-600">({row.unit})</span>}</td>
                  {cols.map(r => {
                    const v = row.value(r);
                    const isBest = row.dir !== 'none' && v != null && bestByRow[row.key] != null && Math.abs(v - (bestByRow[row.key] as number)) < 1e-9 && cols.length > 1;
                    return (
                      <td key={r.id} className={`py-2 px-3 text-right font-mono ${isBest ? 'text-emerald-400 font-semibold' : 'text-white'}`}>
                        {v == null ? '—' : (row.fmt ? row.fmt(v) : formatDecimalGrouped(v, 2))}
                        {isBest && <span className="ml-1 text-[10px]">▲</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Statut */}
              <tr>
                <td className="py-2 pr-4 text-slate-400">Statut</td>
                {cols.map(r => (
                  <td key={r.id} className="py-2 px-3 text-right">
                    <span className={`badge ${r.status === 'converged' ? 'badge-success' : 'badge-warning'}`}>{r.status}</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="text-[10px] text-slate-500 mt-3">
            ▲ = meilleure valeur de la ligne (récupération et oz/j : au plus haut ; énergie, cyanure, OPEX, résidus : au plus bas).
            Les cellules « Débit / Teneur / P80 » ne sont pas classées — ce sont les hypothèses d'entrée du scénario.
          </div>
        </div>
      )}
    </div>
  );
}
