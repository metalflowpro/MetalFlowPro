import { HistogramChart } from '../ui/Chart';
import { heatColor } from '../../lib/plantopt/config';
import type { Area, SimResult } from '../../lib/plantopt/types';

/** Barres de probabilité de goulot par aire (aire la plus « chaude » = goulot). */
export function BottleneckBars({ areas, result }: { areas: Area[]; result: SimResult }) {
  const rows = [...areas]
    .sort((a, b) => a.processOrder - b.processOrder)
    .map(a => ({ area: a, prob: result.bottleneckProbability[a.id] ?? 0 }));
  return (
    <div className="space-y-2">
      {rows.map(({ area, prob }) => (
        <div key={area.id} className="flex items-center gap-3">
          <div className="w-40 text-xs text-mf-txt3 truncate" title={area.name}>{area.name}</div>
          <div className="flex-1 h-4 rounded bg-mf-panel border border-mf-border overflow-hidden">
            <div className="h-full rounded-r" style={{ width: `${100 * prob}%`, backgroundColor: heatColor(prob) }} />
          </div>
          <div className="w-12 text-right text-xs font-mono text-mf-txt3">{(100 * prob).toFixed(1)}%</div>
        </div>
      ))}
    </div>
  );
}

/** Diagramme tornado : sensibilité du débit à la capacité de chaque aire. */
export function TornadoChart({ result }: { result: SimResult }) {
  const rows = result.sensitivity ?? [];
  if (rows.length === 0) {
    return <div className="text-xs text-mf-txt4">Sensibilité indisponible (trop peu d'itérations).</div>;
  }
  const base = result.throughputP50;
  const all = rows.flatMap(r => [r.low, r.high]).concat(base);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 10;
  const x0 = lo - pad;
  const span = hi + pad - x0 || 1;
  const rowH = 40;
  const height = rowH * rows.length + 44;
  const width = 560;
  const px = (v: number) => 130 + ((v - x0) / span) * (width - 150);
  const baseX = px(base);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ minWidth: 480 }} role="img" aria-label="Diagramme tornado de sensibilité">
        <line x1={baseX} y1={8} x2={baseX} y2={rowH * rows.length + 6} stroke="#94a3b8" strokeWidth={1.4} strokeDasharray="4 3" />
        {rows.map((r, i) => {
          const y = 8 + rowH * i + 20 - 11;
          const xLow = px(Math.min(r.low, base));
          const xHigh = px(Math.max(r.high, base));
          return (
            <g key={r.driver}>
              <text x={120} y={y + 11 + 4} textAnchor="end" fontSize={12} fontWeight={600} fill="#cbd5e1">{r.driver}</text>
              {r.low < base && <rect x={xLow} y={y} width={Math.max(1, baseX - xLow)} height={22} fill="#f87171" />}
              {r.high > base && <rect x={baseX} y={y} width={Math.max(1, xHigh - baseX)} height={22} fill="#34d399" />}
              <text x={xLow - 4} y={y + 11 + 4} textAnchor="end" fontSize={11} fill="#94a3b8">{Math.round(r.low)}</text>
              <text x={xHigh + 4} y={y + 11 + 4} textAnchor="start" fontSize={11} fill="#94a3b8">{Math.round(r.high)}</text>
            </g>
          );
        })}
        <text x={width / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="#94a3b8">Débit P50 = {Math.round(base)} t/h</text>
      </svg>
    </div>
  );
}


/** Histogramme de la distribution du débit avec repères P10/P50/P90. */
export function ThroughputHistogram({ result }: { result: SimResult }) {
  const samples = result.throughputSamples ?? [];
  if (samples.length < 2) {
    return <div className="text-xs text-mf-txt4">Pas assez d'échantillons pour l'histogramme.</div>;
  }
  const lo = samples[0];
  const hi = samples[samples.length - 1];
  const span = hi - lo || 1;
  const binW = span / 24;
  const bins = new Array(24).fill(0);
  for (const v of samples) {
    let b = Math.floor((v - lo) / binW);
    if (b >= 24) b = 23;
    if (b < 0) b = 0;
    bins[b] += 1;
  }
  const edges = Array.from({ length: 25 }, (_, i) => lo + i * binW);
  const markers = [
    { label: 'P10', value: result.throughputP10, color: '#f87171' },
    { label: 'P50', value: result.throughputP50, color: '#f59e0b' },
    { label: 'P90', value: result.throughputP90, color: '#34d399' },
  ];

  return (
    <div>
      <HistogramChart
        binEdges={edges} counts={bins} color="#38bdf8" height={200} xLabel="Débit (t/h)"
        xFormat={v => `${Math.round(v)} t/h`}
        markers={markers.map(m => ({ at: m.value, label: m.label, color: m.color }))}
      />
      <div className="flex flex-wrap gap-3 mt-1">
        {markers.map(m => (
          <span key={m.label} className="flex items-center gap-1.5 text-xs text-mf-txt3">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: m.color }} />
            {m.label} = {Math.round(m.value)} t/h
          </span>
        ))}
      </div>
    </div>
  );
}
