import { useState } from 'react';
import { Loader2, Play, Star } from 'lucide-react';
import { optimizeBuffer, backtest, type BufferOptimizationResult, type BacktestResult } from '../../lib/plantopt/optimize';
import { parseHistoricalText } from '../../lib/plantopt/importData';
import type { PlantModel, SimConfig } from '../../lib/plantopt/types';

/** Courbe capacité tampon → débit P50 avec repère du genou. */
function SweepCurve({ res }: { res: BufferOptimizationResult }) {
  const W = 360;
  const H = 150;
  const pad = { l: 40, r: 10, t: 10, b: 24 };
  const xs = res.points.map(p => p.capacityTonnes);
  const ys = res.points.map(p => p.throughputP50);
  const xMax = Math.max(...xs, 1);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const ySpan = yMax - yMin || 1;
  const px = (x: number) => pad.l + (x / xMax) * (W - pad.l - pad.r);
  const py = (y: number) => pad.t + (1 - (y - yMin) / ySpan) * (H - pad.t - pad.b);
  const path = res.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.capacityTonnes).toFixed(1)},${py(p.throughputP50).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 460 }}>
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="#475569" strokeWidth={1} />
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="#475569" strokeWidth={1} />
      <path d={path} fill="none" stroke="#34d399" strokeWidth={2} />
      {res.points.map((p, i) => <circle key={i} cx={px(p.capacityTonnes)} cy={py(p.throughputP50)} r={2} fill="#38bdf8" />)}
      <circle cx={px(res.kneeCapacityTonnes)} cy={py(res.kneeThroughputP50)} r={5} fill="none" stroke="#f59e0b" strokeWidth={2} />
      <text x={pad.l} y={H - 6} fontSize={9} fill="#94a3b8">0</text>
      <text x={W - pad.r} y={H - 6} fontSize={9} fill="#94a3b8" textAnchor="end">{Math.round(xMax)} t</text>
    </svg>
  );
}

function BufferOptimizerRow({ model, config, streamId, label }: { model: PlantModel; config: SimConfig; streamId: string; label: string }) {
  const [res, setRes] = useState<BufferOptimizationResult | null>(null);
  const [busy, setBusy] = useState(false);

  function run() {
    setBusy(true);
    // Laisse peindre le spinner avant le calcul synchrone (balayage ×12).
    setTimeout(() => {
      try { setRes(optimizeBuffer(model, config, streamId)); } finally { setBusy(false); }
    }, 20);
  }

  return (
    <div className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-mf-txt2 font-medium">{label}</div>
        <button onClick={run} disabled={busy} className="btn btn-sm btn-primary">
          {busy ? <Loader2 size={13} className="animate-spin" /> : null} Optimiser
        </button>
      </div>
      {res && (
        <div className="mt-2">
          <div className="text-[11px] text-mf-txt4 mb-1">Courbe capacité tampon → débit</div>
          <SweepCurve res={res} />
          <div className="mt-1 text-xs text-amber-400 flex items-center gap-1.5">
            <Star size={13} /> Capacité recommandée (genou) : {Math.round(res.kneeCapacityTonnes)} t → P50 = {Math.round(res.kneeThroughputP50)} t/h
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  model: PlantModel;
  config: SimConfig;
  initialHistorical?: string;
}

/** Onglet OPTIMISATION & BACK-TEST. */
export function OptimizationTab({ model, config, initialHistorical }: Props) {
  const [histText, setHistText] = useState(initialHistorical ?? '');
  const [bt, setBt] = useState<BacktestResult | null>(null);
  const [btBusy, setBtBusy] = useState(false);
  const [btError, setBtError] = useState<string | null>(null);

  function runBacktest() {
    setBtError(null);
    const values = parseHistoricalText(histText);
    if (values.length < 5) { setBtError('Au moins 5 débits historiques requis.'); return; }
    setBtBusy(true);
    setTimeout(() => {
      try {
        const r = backtest(model, config, values);
        if (!r) setBtError('Back-test impossible (données insuffisantes).');
        else setBt(r);
      } finally { setBtBusy(false); }
    }, 20);
  }

  const verdictColor = bt ? (bt.verdict === 'bon' ? 'text-emerald-400' : bt.verdict === 'acceptable' ? 'text-amber-400' : 'text-red-400') : '';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card">
        <div className="section-title">Optimisation des tampons</div>
        <div className="section-sub mb-4">Balayage de la capacité de chaque tampon pour trouver la capacité recommandée (genou de la courbe capacité → débit).</div>
        <div className="space-y-2">
          {model.streams.length === 0 && <div className="text-xs text-mf-txt4">Aucun flux à optimiser.</div>}
          {model.streams.map(s => {
            const src = model.areas.find(a => a.id === s.sourceAreaId)?.name ?? '—';
            const tgt = model.areas.find(a => a.id === s.targetAreaId)?.name ?? '—';
            return <BufferOptimizerRow key={s.id} model={model} config={config} streamId={s.id} label={`${src} → ${tgt}`} />;
          })}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Back-test : validation sur historique</div>
        <div className="section-sub mb-4">Comparez la distribution simulée aux débits réels pour valider le modèle (test de Kolmogorov–Smirnov).</div>
        <label className="label">Débits historiques (t/h) — une valeur par ligne ou séparés</label>
        <textarea value={histText} onChange={e => setHistText(e.target.value)} rows={6}
          placeholder={'928\n945\n918\n968\n…'} className="input-field font-mono text-xs w-full" />
        <button onClick={runBacktest} disabled={btBusy} className="btn btn-sm btn-primary mt-2">
          {btBusy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Lancer le back-test
        </button>
        {btError && <div className="text-xs text-red-400 mt-2">{btError}</div>}
        {bt && (
          <div className="mt-3 text-xs space-y-1 bg-mf-panel/50 rounded-md p-3 border border-mf-border/50">
            <div>Écart KS : <span className={`font-mono font-semibold ${verdictColor}`}>{bt.ks.toFixed(3)}</span> <span className="text-mf-txt4">({bt.verdict})</span></div>
            <div className="text-mf-txt4">n = {bt.n} · Médiane hist. {Math.round(bt.histP50)} t/h vs sim {Math.round(bt.simP50)} t/h</div>
            <div className="text-mf-txt4">Moyenne hist. {Math.round(bt.histMean)} t/h vs sim {Math.round(bt.simMean)} t/h</div>
          </div>
        )}
      </div>
    </div>
  );
}
