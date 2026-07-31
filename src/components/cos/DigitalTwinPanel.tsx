// ─────────────────────────────────────────────────────────────────────────────
// Jumeau numérique — onglet du module COS.
//
// Confronte ce que le MODÈLE prédit à ce que l'USINE mesure. Les mesures
// viennent des tags réellement importés (cos_tag_readings) ; les valeurs
// prédites sont saisies ou reprises du design projet. L'écart est normalisé par
// la tolérance métier de chaque grandeur, gradué en sévérité et assorti d'une
// cause probable.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity, RefreshCw, Gauge, AlertTriangle, CheckCircle2,
  TrendingUp, TrendingDown, Minus, Database,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { supabase } from '../../lib/supabase';
import {
  compareTwin, measuredFromTags, METRIC_SPECS,
  type TwinMetric, type TagReading, type TwinSeverity,
} from '../../lib/cos/digitalTwin';
import type { Project } from '../../types';

interface Props { project: Project }

const SEVERITY_STYLE: Record<TwinSeverity, { cls: string; label: string }> = {
  conforme:     { cls: 'bg-emerald-500/15 text-emerald-400', label: 'conforme' },
  surveillance: { cls: 'bg-amber-500/15 text-amber-400',     label: 'surveillance' },
  derive:       { cls: 'bg-orange-500/15 text-orange-400',   label: 'dérive' },
  critique:     { cls: 'bg-red-500/15 text-red-400',         label: 'critique' },
};

/** Grandeurs proposées à la saisie du prédit, dans l'ordre d'intérêt procédé. */
const EDITABLE: TwinMetric[] = [
  'mass_flow', 'solids_content', 'pH', 'cyanide_concentration',
  'temperature', 'energy_consumption', 'gold_grade', 'recovery',
];

export function DigitalTwinPanel({ project }: Props) {
  const [readings, setReadings] = useState<TagReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Valeurs prédites : préremplies depuis le design projet, puis ajustables.
  const [predicted, setPredicted] = useState<Partial<Record<TwinMetric, string>>>({
    mass_flow: String(project.target_tph),
    gold_grade: String(project.gold_grade_g_t),
    recovery: String(project.recovery_pct),
    solids_content: '70',
    pH: '10.5',
    cyanide_concentration: '180',
    temperature: '25',
    energy_consumption: '14',
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('cos_tag_readings')
      .select('tag,unit,value,quality,ts')
      .eq('project_id', project.id)
      .order('ts', { ascending: false })
      .limit(500);
    if (error) setLoadError(error.message);
    else { setLoadError(null); setReadings((data ?? []) as TagReading[]); }
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const { measured, used, skipped } = useMemo(() => measuredFromTags(readings), [readings]);

  const predictedNum = useMemo(() => {
    const out: Partial<Record<TwinMetric, number>> = {};
    for (const [k, v] of Object.entries(predicted)) {
      const n = Number(v);
      if (v !== '' && Number.isFinite(n)) out[k as TwinMetric] = n;
    }
    return out;
  }, [predicted]);

  const report = useMemo(() => compareTwin(predictedNum, measured), [predictedNum, measured]);

  const healthColor = report.healthIndex >= 85 ? 'text-emerald-400'
    : report.healthIndex >= 60 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <Activity size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <div><span className="font-semibold">Jumeau numérique</span> — confronte les prédictions du modèle procédé aux mesures réelles de l'usine.</div>
          <div>Chaque écart est rapporté à la tolérance métier de sa grandeur : un écart de 2 °C et un écart de 0,15 de pH pèsent alors pareil. Les causes probables orientent le diagnostic.</div>
        </div>
      </div>

      {/* Santé du jumeau */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-mf-border bg-mf-card p-4 flex items-center gap-3">
          <Gauge size={18} className={`${healthColor} shrink-0`} />
          <div>
            <div className="text-[10px] text-mf-txt4 uppercase">Santé du jumeau</div>
            <div className={`text-xl font-mono font-bold ${healthColor}`}>{report.healthIndex}/100</div>
          </div>
        </div>
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-[10px] text-mf-txt4 uppercase">Grandeurs comparées</div>
          <div className="text-xl font-mono font-bold text-mf-txt">{report.comparisons.length}</div>
          <div className="text-[10px] text-mf-txt4">{report.counts.conforme} conforme(s)</div>
        </div>
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-[10px] text-mf-txt4 uppercase">Dérives</div>
          <div className={`text-xl font-mono font-bold ${report.drifts.length > 0 ? 'text-orange-400' : 'text-mf-txt4'}`}>
            {report.drifts.length}
          </div>
          <div className="text-[10px] text-mf-txt4">{report.counts.critique} critique(s)</div>
        </div>
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-[10px] text-mf-txt4 uppercase">Lectures usine</div>
          <div className="text-xl font-mono font-bold text-sky-300">{used}</div>
          <div className="text-[10px] text-mf-txt4">{skipped} écartée(s)</div>
        </div>
      </div>

      {/* Synthèse */}
      <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
        report.counts.critique > 0 ? 'bg-red-500/5 border-red-500/30'
        : report.drifts.length > 0 ? 'bg-orange-500/5 border-orange-500/30'
        : 'bg-emerald-500/5 border-emerald-500/30'
      }`}>
        {report.counts.critique > 0 || report.drifts.length > 0
          ? <AlertTriangle size={16} className="text-orange-400 shrink-0 mt-0.5" />
          : <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />}
        <div className="text-xs text-mf-txt2">{report.summary}</div>
      </div>

      {/* Source des mesures */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <div className="section-title flex items-center gap-2">
            <Database size={15} className="text-sky-400" /> Mesures d'usine (tags importés)
          </div>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>
        {loadError ? (
          <div className="flex items-center gap-2 text-xs text-amber-400 px-3 py-2 rounded-lg bg-amber-500/5">
            <AlertTriangle size={12} className="shrink-0" /> {loadError}
          </div>
        ) : readings.length === 0 ? (
          <div className="text-xs text-mf-txt4">
            Aucune lecture de tag pour ce projet. Importez des données via l'onglet <strong>Ingestion</strong> (gabarit « Tags temps réel ») pour alimenter le jumeau.
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-mf-txt4">
            {(Object.keys(measured) as TwinMetric[]).map(m => (
              <span key={m}>
                {METRIC_SPECS[m].label} : <strong className="text-sky-300">{formatDecimalGrouped(measured[m]!, 2)} {METRIC_SPECS[m].unit}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Valeurs prédites */}
      <div className="card">
        <div className="section-title mb-3">Valeurs prédites par le modèle</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {EDITABLE.map(m => (
            <div key={m}>
              <label className="label">{METRIC_SPECS[m].label} {METRIC_SPECS[m].unit && `(${METRIC_SPECS[m].unit})`}</label>
              <input
                type="number" step="any"
                className="input-field font-mono text-xs"
                value={predicted[m] ?? ''}
                onChange={e => setPredicted(p => ({ ...p, [m]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 text-[10px] text-mf-txt4">
          Préremplies depuis les paramètres du projet (débit, teneur, récupération) — ajustez-les pour refléter la prédiction du circuit simulé.
        </div>
      </div>

      {/* Comparaison détaillée */}
      {!report.empty && (
        <div className="card overflow-hidden">
          <div className="section-title mb-3">Écarts modèle / usine</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                  <th className="py-2 pr-3">Grandeur</th>
                  <th className="py-2 pr-3 text-right">Prédit</th>
                  <th className="py-2 pr-3 text-right">Mesuré</th>
                  <th className="py-2 pr-3 text-right">Écart</th>
                  <th className="py-2 pr-3 text-right">×tolérance</th>
                  <th className="py-2 pr-3">État</th>
                  <th className="py-2 pr-3">Cause probable</th>
                </tr>
              </thead>
              <tbody>
                {report.comparisons.map(c => {
                  const st = SEVERITY_STYLE[c.severity];
                  const Icon = c.deviation > 0 ? TrendingUp : c.deviation < 0 ? TrendingDown : Minus;
                  return (
                    <tr key={c.metric} className={`border-b border-mf-border/30 ${c.severity === 'critique' ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 pr-3 text-mf-txt2">{c.label}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(c.predicted, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-sky-300">{formatDecimalGrouped(c.measured, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        <span className={`inline-flex items-center gap-1 ${c.severity === 'conforme' ? 'text-mf-txt4' : 'text-amber-400'}`}>
                          <Icon size={11} />
                          {c.deviationPct >= 0 ? '+' : ''}{formatDecimalGrouped(c.deviationPct, 1)} %
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(c.normalized, 2)}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="py-2 pr-3 text-[10px] text-mf-txt4 max-w-[280px]">{c.probableCause ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.empty && readings.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 text-xs text-amber-300">
          <AlertTriangle size={14} /> {report.summary}
        </div>
      )}
    </div>
  );
}
