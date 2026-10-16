import { useMemo } from 'react';
import {
  FlaskConical, AlertTriangle, CheckCircle2, Info, BookOpen, Microscope,
} from 'lucide-react';

import { GeometClusters } from '../../components/analytics/GeometClusters';
import { GeometEntry, LimsData, pct } from './model';

// ─── Tab: Géométallurgie ─────────────────────────────────────────────────────

export function GeometTab({ entries, data }: { entries: GeometEntry[]; data: LimsData }) {
  // Vecteurs de caractéristiques par échantillon pour le clustering métallurgique.
  const clusterInputs = useMemo(() => {
    const comm = new Map(data.comminution.map(c => [String(c.sample_id), c]));
    const chem = new Map(data.chem.map(c => [String(c.sample_id), c]));
    const knel = new Map(data.knelson.map(k => [String(k.sample_id), k]));
    const mineral = new Map(data.mineralogy.map(m => [String(m.sample_id), m]));
    const out: { id: string; features: number[] }[] = [];
    for (const s of data.samples) {
      const k = String(s.id);
      const bwi = comm.get(k)?.bwi_kwh_t, sS = chem.get(k)?.s_sulfide_pct, cO = chem.get(k)?.c_organic_pct,
        grg = knel.get(k)?.grg_recovery_pct, auF = mineral.get(k)?.au_free_pct;
      if ([bwi, sS, cO, grg, auF].every(v => v != null && Number.isFinite(v))) {
        out.push({ id: k, features: [bwi as number, sS as number, cO as number, grg as number, auF as number] });
      }
    }
    return out;
  }, [data]);

  const oreTypeCounts = entries.reduce((acc, e) => { acc[e.ore_type] = (acc[e.ore_type] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const anomalyCount = entries.filter(e => e.anomaly).length;
  const highScoreCount = entries.filter(e => e.score >= 80).length;
  const lowScoreCount = entries.filter(e => e.score < 50).length;

  const oreColors: Record<string, string> = { Oxyde: '#f59e0b', Sulfure: '#9d78f0', Transition: '#38bdf8', Indéterminé: '#6b7280' };

  return (
    <div className="space-y-5">
      <GeometClusters
        data={clusterInputs}
        featureNames={['BWi', 'S sulf.', 'C org.', 'GRG', 'Au libre']}
        featureUnits={['kWh/t', '%', '%', '%', '%']}
      />
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Échantillons analysés', val: entries.length, color: 'text-mf-txt', icon: <FlaskConical size={14} className="text-amber-400"/> },
          { label: 'Anomalies détectées', val: anomalyCount, color: anomalyCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: <AlertTriangle size={14} className="text-amber-400"/> },
          { label: 'Score métall. ≥ 80%', val: highScoreCount, color: 'text-emerald-400', icon: <CheckCircle2 size={14} className="text-emerald-400"/> },
          { label: 'Score métall. < 50%', val: lowScoreCount, color: lowScoreCount > 0 ? 'text-red-400' : 'text-mf-txt4', icon: <AlertTriangle size={14} className="text-red-400"/> },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{k.icon}</div>
              <span className="text-[10px] text-mf-txt4">{k.label}</span>
            </div>
            <div className={`text-2xl font-mono font-bold ${k.color}`}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Ore type distribution */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Classification minéralogique — Distribution des types de minerai</div>
          <div className="flex gap-3 mb-3">
            {Object.entries(oreTypeCounts).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mf-hover border border-mf-border/50 flex-1 text-center">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: oreColors[type] ?? '#6b7280' }} />
                <div>
                  <div className="text-xs font-bold text-mf-txt">{count}</div>
                  <div className="text-[10px] text-mf-txt4">{type}</div>
                  <div className="text-[9px] text-mf-txt4">{pct(count, entries.length)}%</div>
                </div>
              </div>
            ))}
          </div>
          {/* Bar chart */}
          <div className="space-y-1.5">
            {Object.entries(oreTypeCounts).map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <div className="text-xs text-mf-txt3 w-24 shrink-0">{type}</div>
                <div className="flex-1 h-2 bg-mf-border/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct(count, entries.length)}%`, backgroundColor: oreColors[type] ?? '#6b7280', opacity: 0.75 }} />
                </div>
                <div className="text-xs font-mono text-mf-txt4 w-8 text-right">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-sample table */}
      {entries.length > 0 ? (
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 py-3 border-b border-mf-border">
            <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Analyse par échantillon — Score métallurgique & Recommandations</div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID Échantillon</th>
                  <th>Domaine</th>
                  <th>Type minerai</th>
                  <th>Score</th>
                  <th>Driver récupération</th>
                  <th>Anomalie</th>
                  <th>Recommandation</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.sample_id}>
                    <td><span className="font-mono text-amber-400 text-xs">{e.sample_id}</span></td>
                    <td><span className="text-xs text-mf-txt3">{e.domain ?? '—'}</span></td>
                    <td>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: oreColors[e.ore_type] ?? '#6b7280', backgroundColor: `${oreColors[e.ore_type] ?? '#6b7280'}20` }}>
                        {e.ore_type}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-mf-border/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${e.score}%`, backgroundColor: e.score >= 80 ? '#10b981' : e.score >= 50 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className={`text-xs font-mono font-bold ${e.score >= 80 ? 'text-emerald-400' : e.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{e.score}</span>
                      </div>
                    </td>
                    <td><span className="text-[10px] text-mf-txt3 max-w-40 block leading-tight">{e.recovery_driver}</span></td>
                    <td>
                      {e.anomaly ? (
                        <div className="flex items-start gap-1">
                          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                          <span className="text-[10px] text-amber-300 max-w-36 block leading-tight">{e.anomaly}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <CheckCircle2 size={11} className="text-emerald-400" />
                          <span className="text-[10px] text-emerald-400">Normal</span>
                        </div>
                      )}
                    </td>
                    <td><span className="text-[10px] text-mf-txt3 max-w-48 block leading-tight">{e.recommendation}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 text-center rounded-xl border border-dashed border-mf-border">
          <Microscope size={24} className="text-mf-txt4 mb-2" />
          <p className="text-xs text-mf-txt4">Complétez les analyses chimiques, minéralogiques et de lixiviation pour générer l'analyse géométallurgique.</p>
        </div>
      )}

      {/* Recommendations panel */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={13} className="text-amber-400" />
            <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Recommandations prioritaires</div>
          </div>
          <div className="space-y-2">
            {lowScoreCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
                <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-red-400">{lowScoreCount} échantillon{lowScoreCount > 1 ? 's' : ''}</span> avec score métallurgique inférieur à 50 — investigation complémentaire requise (prétraitement, caractérisation minéralogique approfondie).</div>
              </div>
            )}
            {anomalyCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
                <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-amber-400">{anomalyCount} anomalie{anomalyCount > 1 ? 's' : ''} détectée{anomalyCount > 1 ? 's' : ''}</span> — réviser protocole QAQC et confirmer résultats par duplicatas.</div>
              </div>
            )}
            {highScoreCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-emerald-400">{highScoreCount} échantillon{highScoreCount > 1 ? 's' : ''}</span> avec score ≥ 80 — potentiel de récupération favorable confirmé. Prioriser pour composites variabilité.</div>
              </div>
            )}
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/8 border border-blue-500/20">
              <Info size={12} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-mf-txt3">Score métallurgique calculé à partir de : récupération lixiviation, Au libre, teneur Corg, flottation Au. Score 0–100 — indicatif seulement, non substitut à l'étude de faisabilité.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
