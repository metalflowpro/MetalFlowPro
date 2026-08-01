import { useMemo } from 'react';
import { Cpu, TrendingUp, AlertCircle } from 'lucide-react';
import { fitRegression, fitQuality } from '../../lib/ml/regression';
import { LineChart, type Series } from '../ui/Chart';

/**
 * Modèle prédictif de récupération — VRAIE régression ajustée sur les données.
 *
 * Contrairement aux corrélations déterministes du reste du module, ce panneau
 * ajuste par moindres carrés un modèle multivarié récup. = f(caractère minerai)
 * sur les domaines géométallurgiques réels du projet, puis affiche :
 *   • la qualité de l'ajustement (R², R² ajusté, n, RMSE) ;
 *   • l'influence standardisée de chaque variable retenue ;
 *   • observé vs modèle par domaine, avec bande d'intervalle de prédiction ;
 *   • la récupération prédite du domaine actif avec son intervalle à 90 %.
 *
 * Sélection automatique des variables : on ne retient que les colonnes
 * renseignées sur tous les domaines exploitables, classées par corrélation avec
 * la cible, en gardant p ≤ n − 2 (garantit un degré de liberté pour
 * l'incertitude). Dégradation gracieuse quand les données sont insuffisantes.
 */

export interface RegressionDomain {
  id: string;
  name: string;
  color: string | null;
  recovery_design: number | null;
  avg_cil_pct: number | null;
  avg_grg_pct: number | null;
  avg_bwi_kwh_t: number | null;
  sulphide_pct: number | null;
  clay_pct: number | null;
  carbonate_pct: number | null;
}

interface Props {
  domains: RegressionDomain[];
  selectedDomainId: string | null;
  confidence?: number;
}

const CANDIDATES: { key: keyof RegressionDomain; label: string; unit: string }[] = [
  { key: 'avg_grg_pct',    label: 'GRG',        unit: '%' },
  { key: 'avg_bwi_kwh_t',  label: 'BWi',        unit: 'kWh/t' },
  { key: 'sulphide_pct',   label: 'Sulfures',   unit: '%' },
  { key: 'clay_pct',       label: 'Argile',     unit: '%' },
  { key: 'carbonate_pct',  label: 'Carbonate',  unit: '%' },
];

const targetOf = (d: RegressionDomain): number | null =>
  d.recovery_design ?? d.avg_cil_pct ?? null;

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(da * db);
  return den > 0 ? num / den : 0;
}

function std(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

export function RecoveryRegressionPanel({ domains, selectedDomainId, confidence = 0.90 }: Props) {
  const analysis = useMemo(() => {
    // Rows with a usable recovery target.
    const rows = domains
      .map(d => ({ d, y: targetOf(d) }))
      .filter((r): r is { d: RegressionDomain; y: number } => r.y != null && Number.isFinite(r.y));
    const n = rows.length;
    if (n < 3) return { kind: 'insufficient' as const, n };

    // Candidate features present (finite) on every usable row.
    const available = CANDIDATES.filter(c =>
      rows.every(r => {
        const v = r.d[c.key];
        return typeof v === 'number' && Number.isFinite(v);
      }),
    );
    if (available.length === 0) return { kind: 'no_features' as const, n };

    const targets = rows.map(r => r.y);
    // Rank features by |correlation| with recovery, keep p ≤ n − 2.
    const ranked = available
      .map(c => ({ c, r: Math.abs(pearson(rows.map(r => r.d[c.key] as number), targets)) }))
      .sort((a, b) => b.r - a.r);
    const maxP = Math.max(1, n - 2);
    const chosen = ranked.slice(0, Math.min(maxP, ranked.length)).map(x => x.c);

    const X = rows.map(r => chosen.map(c => r.d[c.key] as number));
    const model = fitRegression(X, targets, { confidence });
    if (!model) return { kind: 'no_features' as const, n };

    // Standardised influence: effect on recovery of a 1-SD change in each feature.
    const influence = chosen.map((c, j) => ({
      label: c.label,
      unit: c.unit,
      coef: model.coefficients[j],
      stdEffect: model.coefficients[j] * std(rows.map(r => r.d[c.key] as number)),
    }));

    // Observed vs fitted, ordered by the dominant predictor for a readable chart.
    const topKey = chosen[0].key;
    const ordered = [...rows].sort((a, b) => (a.d[topKey] as number) - (b.d[topKey] as number));
    const fittedPreds = ordered.map(r => model.predict(chosen.map(c => r.d[c.key] as number), confidence));

    return {
      kind: 'ok' as const,
      n, model, chosen, influence,
      labels: ordered.map(r => r.d.name),
      observed: ordered.map(r => r.y),
      fitted: fittedPreds.map(p => p.value),
      lower: fittedPreds.map(p => p.lower),
      upper: fittedPreds.map(p => p.upper),
      selectedPred: (() => {
        const sel = rows.find(r => r.d.id === selectedDomainId) ?? rows[0];
        return { name: sel.d.name, observed: sel.y, pred: model.predict(chosen.map(c => sel.d[c.key] as number), confidence) };
      })(),
    };
  }, [domains, selectedDomainId, confidence]);

  if (analysis.kind === 'insufficient') {
    return (
      <div className="card-sm bg-white/[0.02]">
        <Header />
        <div className="flex items-start gap-2 text-xs mf-txt3 mt-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-400" />
          <span>Il faut au moins 3 domaines avec une récupération renseignée pour ajuster un modèle
            ({analysis.n} disponible{analysis.n > 1 ? 's' : ''}). Renseignez la récupération design ou CIL par domaine.</span>
        </div>
      </div>
    );
  }
  if (analysis.kind === 'no_features') {
    return (
      <div className="card-sm bg-white/[0.02]">
        <Header />
        <div className="flex items-start gap-2 text-xs mf-txt3 mt-2">
          <AlertCircle size={13} className="shrink-0 mt-0.5 text-amber-400" />
          <span>Aucune variable de caractère minerai (GRG, BWi, sulfures, argile, carbonate) n'est
            renseignée sur tous les domaines. Complétez le mapping GID pour activer la prédiction.</span>
        </div>
      </div>
    );
  }

  const { model, chosen, influence, labels, observed, fitted, lower, upper, selectedPred } = analysis;
  const quality = fitQuality(model.r2);
  const qColor = quality.level === 'strong' ? 'text-emerald-400'
    : quality.level === 'moderate' ? 'text-amber-400' : 'text-red-400';

  const series: Series[] = [
    { label: 'Récup. modèle', color: '#8B5CF6', points: fitted, band: { lower, upper } },
    { label: 'Récup. observée', color: '#10B981', points: observed, dashed: true },
  ];

  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="card-sm bg-white/[0.02] space-y-4">
      <Header />

      {/* Quality strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: 'R²', v: model.r2.toFixed(3), c: qColor },
          { l: 'R² ajusté', v: model.adjustedR2.toFixed(3), c: 'mf-txt' },
          { l: 'Domaines (n)', v: String(model.n), c: 'mf-txt' },
          { l: 'RMSE', v: `${model.rmse.toFixed(2)}%`, c: 'mf-txt' },
        ].map(m => (
          <div key={m.l} className="rounded-md bg-white/[0.03] px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-wider mf-txt4">{m.l}</div>
            <div className={`text-sm font-mono font-semibold ${m.c}`}>{m.v}</div>
          </div>
        ))}
      </div>
      <div className={`text-[11px] ${qColor} flex items-center gap-1.5`}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />
        {quality.label}
        {model.ridge > 0 && <span className="mf-txt4 ml-1">· ridge λ={model.ridge.toExponential(0)} (colinéarité)</span>}
      </div>

      {/* Observed vs modelled, with prediction band */}
      <div>
        <div className="text-[10px] uppercase tracking-wider mf-txt4 mb-1">
          Observé vs modèle par domaine — bande = intervalle de prédiction {Math.round(confidence * 100)}%
        </div>
        <LineChart labels={labels} series={series} height={200} yFormat={fmtPct} yLabel="Récupération" />
      </div>

      {/* Feature influence */}
      <div>
        <div className="text-[10px] uppercase tracking-wider mf-txt4 mb-2">
          Influence des variables (effet d'un écart-type sur la récupération)
        </div>
        <div className="space-y-1.5">
          {[...influence].sort((a, b) => Math.abs(b.stdEffect) - Math.abs(a.stdEffect)).map(f => {
            const maxAbs = Math.max(...influence.map(x => Math.abs(x.stdEffect)), 1e-9);
            const w = (Math.abs(f.stdEffect) / maxAbs) * 100;
            const pos = f.stdEffect >= 0;
            return (
              <div key={f.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 shrink-0 mf-txt2">{f.label}</span>
                <div className="flex-1 h-3 rounded-sm bg-white/[0.04] overflow-hidden">
                  <div className="h-full rounded-sm" style={{ width: `${w}%`, background: pos ? '#10B981' : '#F06B6B' }} />
                </div>
                <span className={`w-20 text-right font-mono ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
                  {pos ? '+' : ''}{f.stdEffect.toFixed(2)} pt
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Prediction for the selected domain */}
      <div className="rounded-md border border-violet-400/20 bg-violet-400/5 px-3 py-2.5">
        <div className="text-[10px] uppercase tracking-wider mf-txt4 mb-1">
          Récupération prédite — {selectedPred.name}
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-mono font-bold text-violet-300">{selectedPred.pred.value.toFixed(1)}%</span>
          <span className="text-[11px] mf-txt3 font-mono">
            IP {Math.round(confidence * 100)}% : [{selectedPred.pred.lower.toFixed(1)} – {selectedPred.pred.upper.toFixed(1)}]%
          </span>
        </div>
        <div className="text-[10px] mf-txt4 mt-1 flex items-center gap-1">
          <TrendingUp size={10} />
          Observée : {selectedPred.observed.toFixed(1)}% · écart modèle {(selectedPred.pred.value - selectedPred.observed >= 0 ? '+' : '')}{(selectedPred.pred.value - selectedPred.observed).toFixed(1)} pt
          {' · '}variables : {chosen.map(c => c.label).join(', ')}
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="flex items-center gap-2">
      <Cpu size={13} className="text-violet-400" />
      <span className="text-xs font-semibold mf-txt">Modèle prédictif (régression multivariée)</span>
      <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-400/15 text-violet-300 font-semibold">ML</span>
    </div>
  );
}
