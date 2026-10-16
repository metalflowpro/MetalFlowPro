import { formatDecimalGrouped } from '../../lib/format/number';
import {
  FlaskConical, Layers, Zap, Droplets, AlertTriangle, CheckCircle2, Star,
  Activity, Target,
} from 'lucide-react';
import { type RouteEstimate } from '../../lib/analytics/routeEstimation';

import { LimsData, robustMean } from './model';

// ─── Tab: Synthèse LIMS ──────────────────────────────────────────────────────

export function SyntheseTab({ data, routes, hasPregRobbing }: { data: LimsData; routes: RouteEstimate[]; hasPregRobbing: boolean }) {
  const auMean = robustMean(data.chem.map(t => t.au_g_t));
  const bwiMean = robustMean(data.comminution.map(t => t.bwi_kwh_t));
  const grgMean = robustMean(data.knelson.map(t => t.grg_recovery_pct));
  const leachMean = robustMean(data.leaching.map(t => t.leach_rec_24h_pct));
  const leach48Mean = robustMean(data.leaching.map(t => t.leach_rec_48h_pct));
  const nacnMean = robustMean(data.leaching.map(t => t.nacn_consumption_kg_t));
  const caoMean = robustMean(data.leaching.map(t => t.cao_consumption_kg_t));
  const flotMean = robustMean(data.flotation.map(t => t.au_recovery_pct));
  const eluMean = robustMean(data.elution.map(t => t.au_recovery_pct));
  const pyMean = robustMean(data.mineralogy.map(t => t.pyrite_pct));
  const auFreeMean = robustMean(data.mineralogy.map(t => t.au_free_pct));

  const KPIs = [
    { label: 'Échantillons', val: data.samples.length, unit: '', icon: <FlaskConical size={14} className="text-amber-400"/>, color: '#F59E0B' },
    { label: 'Au tête moy.', val: auMean, unit: 'g/t', icon: <Target size={14} className="text-amber-400"/>, color: '#F59E0B' },
    { label: 'Récup. lixiv. 24h', val: leachMean, unit: '%', icon: <Droplets size={14} className="text-emerald-400"/>, color: '#10B981' },
    { label: 'Récup. lixiv. 48h', val: leach48Mean, unit: '%', icon: <Droplets size={14} className="text-teal-400"/>, color: '#059669' },
    { label: 'GRG moy.', val: grgMean, unit: '%', icon: <Layers size={14} className="text-teal-400"/>, color: '#2ECC8A' },
    { label: 'Bond Wi moy.', val: bwiMean, unit: 'kWh/t', icon: <Zap size={14} className="text-sky-400"/>, color: '#5BA4F5' },
    { label: 'Cons. NaCN', val: nacnMean, unit: 'kg/t', icon: <Activity size={14} className="text-purple-400"/>, color: '#9D78F0' },
    { label: 'Cons. CaO', val: caoMean, unit: 'kg/t', icon: <Activity size={14} className="text-orange-400"/>, color: '#F88A44' },
  ];

  const families = [
    { label: 'Analyse chimique', n: data.chem.length, color: '#F59E0B' },
    { label: 'Minéralogie', n: data.mineralogy.length, color: '#9D78F0' },
    { label: 'Comminution', n: data.comminution.length, color: '#5BA4F5' },
    { label: 'Gravimétrie', n: data.knelson.length, color: '#2ECC8A' },
    { label: 'Flottation', n: data.flotation.length, color: '#F88A44' },
    { label: 'Lixiviation', n: data.leaching.length, color: '#10B981' },
    { label: 'Élution ADR', n: data.elution.length, color: '#F06B6B' },
  ];

  const recommended = routes.find(r => r.recommended);

  // Récupération moyenne par famille d'essai (moyenne de tous les tests)
  const recoveries = [
    { label: 'Gravité (GRG)',     val: grgMean,     n: data.knelson.length,   color: '#2ECC8A', icon: <Layers size={14} className="text-teal-400"/> },
    { label: 'Flottation Au',     val: flotMean,    n: data.flotation.length, color: '#F88A44', icon: <Activity size={14} className="text-orange-400"/> },
    { label: 'Lixiviation 48h',   val: leach48Mean, n: data.leaching.length,  color: '#10B981', icon: <Droplets size={14} className="text-emerald-400"/> },
    { label: 'Élution ADR',       val: eluMean,     n: data.elution.length,   color: '#F06B6B', icon: <FlaskConical size={14} className="text-rose-400"/> },
  ];

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-3">
        {KPIs.map(k => (
          <div key={k.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{k.icon}</div>
              <span className="text-[10px] text-mf-txt4 leading-tight">{k.label}</span>
            </div>
            <div className="text-xl font-mono font-bold text-mf-txt">
              {typeof k.val === 'number' ? (
                <>
                  {k.val < 10 ? formatDecimalGrouped(k.val, 2) : formatDecimalGrouped(k.val, 1)}
                  <span className="text-xs text-mf-txt4 font-normal ml-1">{k.unit}</span>
                </>
              ) : k.val === null ? (
                <span className="text-sm text-mf-txt4">N/A</span>
              ) : (
                <>
                  {k.val}
                  <span className="text-xs text-mf-txt4 font-normal ml-1">{k.unit}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Récupération moyenne par famille d'essai */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Récupération moyenne par famille d'essai</div>
        <div className="grid grid-cols-4 gap-3">
          {recoveries.map(r => (
            <div key={r.label} className="rounded-lg border border-mf-border/60 bg-mf-hover/30 p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{r.icon}</div>
                <span className="text-[10px] text-mf-txt4 leading-tight">{r.label}</span>
              </div>
              <div className="text-2xl font-mono font-bold" style={{ color: r.val !== null ? r.color : undefined }}>
                {r.val !== null ? (
                  <>
                    {formatDecimalGrouped(r.val, 1)}
                    <span className="text-xs text-mf-txt4 font-normal ml-1">%</span>
                  </>
                ) : (
                  <span className="text-sm text-mf-txt4">N/A</span>
                )}
              </div>
              <div className="text-[10px] text-mf-txt4 mt-1">{r.n} essai{r.n > 1 ? 's' : ''}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Recommended route banner */}
      {recommended && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
            <Star size={18} className="text-emerald-400 fill-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="text-xs font-bold text-emerald-400 mb-0.5">Route recommandée</div>
            <div className="text-sm font-semibold text-mf-txt">{recommended.route}</div>
            <div className="text-xs text-mf-txt3 mt-0.5">{recommended.basis}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-mono font-bold text-emerald-400">{recommended.recovery_pct}%</div>
            <div className="text-[10px] text-mf-txt4">Récupération estimée</div>
          </div>
        </div>
      )}

      {/* Mineralogy summary */}
      {(pyMean !== null || auFreeMean !== null || flotMean !== null) && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Indicateurs minéralogiques & métallurgiques</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Au libre (MLA)', val: auFreeMean, unit: '%', warn: auFreeMean !== null && auFreeMean < 40, note: '< 40% — complexité de libération' },
              { label: 'Pyrite', val: pyMean, unit: '%', warn: pyMean !== null && pyMean > 8, note: '> 8% — risque d\'interférence flottation' },
              { label: 'Récup. flottation Au', val: flotMean, unit: '%', warn: flotMean !== null && flotMean < 75, note: '< 75% — flottation sous-performante' },
              { label: 'Corg (prég-robbing)', val: robustMean(data.chem.map(t => t.c_organic_pct)), unit: '%', warn: hasPregRobbing, note: '> 0.2% — circuit CIL avec prétraitement' },
            ].filter(f => f.val !== null).map(f => (
              <div key={f.label} className="flex items-center justify-between p-2 rounded-lg bg-mf-hover/30 border border-mf-border/50">
                <span className="text-xs text-mf-txt3">{f.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-semibold ${f.warn ? 'text-amber-400' : 'text-mf-txt'}`}>
                    {f.val!.toFixed(2)} {f.unit}
                  </span>
                  {f.warn ? <AlertTriangle size={11} className="text-amber-400" /> : <CheckCircle2 size={11} className="text-emerald-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completeness */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Complétude programme de testwork</div>
        <div className="grid grid-cols-4 gap-2">
          {families.map(f => (
            <div key={f.label} className="p-3 rounded-lg bg-mf-hover border border-mf-border/60 text-center">
              <div className="text-lg font-bold text-mf-txt font-mono">{f.n}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5 mb-2 leading-tight">{f.label}</div>
              <div className="h-1 bg-mf-border rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, f.n * 10)}%`, backgroundColor: f.color, opacity: 0.65 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
