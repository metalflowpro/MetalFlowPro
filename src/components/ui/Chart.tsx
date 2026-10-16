import { useMemo, useState, useId } from 'react';

/**
 * Lightweight, dependency-free interactive chart primitives shared across
 * modules. Replaces the hand-rolled per-page <svg> blocks with a consistent,
 * hover-aware component (crosshair + tooltip) that themes via the `mf-` palette
 * and prints cleanly (see @media print in index.css).
 *
 * Deliberately small: line/area + bar, categorical or numeric X. For anything
 * heavier (Pareto fronts, PSD log-axes) a page can still render bespoke SVG.
 */

export interface Series {
  label: string;
  color: string;            // any CSS colour (hex or var)
  points: number[];         // y-values, aligned to `labels`
  area?: boolean;           // fill under the line
  dashed?: boolean;
  /** Optional confidence/prediction band: shaded region between lower and upper. */
  band?: { lower: number[]; upper: number[] };
  /** Série de fond (trait fin, estompé), exclue de l'info-bulle et de la légende. */
  muted?: boolean;
  /** Marqueurs ronds sur chaque point. */
  dots?: boolean;
}

/** Ligne de repère verticale (P10/P50/P90, cible…) positionnée sur l'axe X. */
export interface Marker {
  /** Indice de catégorie, ou valeur X quand le graphique a un axe numérique (`x`). */
  at: number;
  label: string;
  color: string;
}

interface AxisChartProps {
  labels: (string | number)[];
  series: Series[];
  /**
   * Positions X numériques (même longueur que `labels`) : axe proportionnel,
   * pour des points non équidistants (courbe cumulée, profils). Sans `x`,
   * l'axe est catégoriel (points équidistants).
   */
  x?: number[];
  /** Lignes de repère verticales. */
  markers?: Marker[];
  height?: number;
  yFormat?: (v: number) => string;
  yLabel?: string;
  className?: string;
  /**
   * Anchor the y-axis at 0 (default true). Set false for tightly-clustered
   * data far from zero (e.g. recoveries 80–95 %) so the lines and any
   * prediction band fill the plot instead of being squished at the top.
   */
  yZero?: boolean;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

function niceExtent(values: number[], includeZero = true): [number, number] {
  const min = Math.min(...values, ...(includeZero ? [0] : []));
  const max = Math.max(...values, ...(includeZero ? [1] : []));
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.08;
  // includeZero: keep the original 0-anchored behaviour (no bottom pad when the
  // data is all-positive). Otherwise pad both ends so tight clusters breathe.
  if (includeZero) return [min - (min < 0 ? pad : 0), max + pad];
  return [min - pad, max + pad];
}

/**
 * Multi-series line / area chart with a hover crosshair and a tooltip that
 * reports every series value at the nearest X. Fully keyboard/pointer safe.
 */
export function LineChart({
  labels, series, height = 220, yFormat = v => String(Math.round(v)), yLabel, className = '', yZero = true, x, markers = [],
}: AxisChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const width = 640; // viewBox units; SVG scales to container width.

  // Les valeurs non finies (NaN) sont des TROUS : la courbe s'interrompt.
  const allY = series.flatMap(s => [...s.points, ...(s.band ? [...s.band.lower, ...s.band.upper] : [])]).filter(Number.isFinite);
  const [yMin, yMax] = useMemo(() => niceExtent(allY, yZero), [allY, yZero]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const n = labels.length;

  const numeric = Array.isArray(x) && x.length === n && n > 1;
  const xMin = numeric ? Math.min(...x!) : 0;
  const xMax = numeric ? Math.max(...x!) : 1;
  const xOfValue = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin || 1)) * plotW;
  const xAt = (i: number) => numeric ? xOfValue(x![i]) : PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const markerX = (m: Marker) => numeric ? xOfValue(m.at) : xAt(m.at);
  const yAt = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  // 4 horizontal gridlines.
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));

  const pathFor = (s: Series) => {
    let pen = false;
    return s.points.map((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return ''; }
      const seg = `${pen ? 'L' : 'M'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`;
      pen = true;
      return seg;
    }).join(' ');
  };

  const areaFor = (s: Series) =>
    `${pathFor(s)} L ${xAt(n - 1).toFixed(1)} ${yAt(yMin).toFixed(1)} L ${xAt(0).toFixed(1)} ${yAt(yMin).toFixed(1)} Z`;

  // Closed polygon tracing the upper bound forward then the lower bound back.
  const bandFor = (b: { lower: number[]; upper: number[] }) => {
    const up = b.upper.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');
    const down = b.lower.map((v, i) => `L ${xAt(b.lower.length - 1 - i).toFixed(1)} ${yAt(b.lower[b.lower.length - 1 - i]).toFixed(1)}`).join(' ');
    return `${up} ${down} Z`;
  };

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    if (numeric) {
      // Point le plus proche en X (axe proportionnel).
      let best = 0;
      for (let k = 1; k < n; k++) if (Math.abs(xAt(k) - px) < Math.abs(xAt(best) - px)) best = k;
      setHover(best);
      return;
    }
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - PAD.left) / plotW) * (n - 1))));
    setHover(i);
  }

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img"
           aria-label={yLabel ? `Graphique — ${yLabel}` : 'Graphique linéaire'}>
        {/* gridlines + y ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)}
                  stroke="#1E2A3B" strokeWidth={1} />
            <text x={PAD.left - 6} y={yAt(t) + 3} textAnchor="end"
                  fontSize={9} fill="#56657A" className="font-mono">{yFormat(t)}</text>
          </g>
        ))}

        {/* x labels (thin out if crowded) */}
        {labels.map((l, i) => {
          const step = Math.ceil(n / 8);
          if (i % step !== 0 && i !== n - 1) return null;
          return (
            <text key={i} x={xAt(i)} y={height - 8} fontSize={9} fill="#56657A"
                  // Axe numérique : la dernière étiquette s'aligne à droite pour ne pas déborder.
                  textAnchor={numeric && i === n - 1 ? 'end' : 'middle'}>
              {String(l)}
            </text>
          );
        })}

        {/* repères verticaux */}
        {markers.map((m, mi) => (
          <g key={`mk-${mi}`} pointerEvents="none">
            <line x1={markerX(m)} x2={markerX(m)} y1={PAD.top} y2={PAD.top + plotH} stroke={m.color} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.85} />
            <text x={markerX(m)} y={PAD.top + 9} textAnchor="middle" fontSize={9} fill={m.color} className="font-mono">{m.label}</text>
          </g>
        ))}

        {/* confidence/prediction bands (drawn under the lines) */}
        {series.map((s, si) => s.band && (
          <path key={`band-${si}`} d={bandFor(s.band)} fill={s.color} opacity={0.14} stroke="none" />
        ))}

        {/* series */}
        {series.map((s, si) => (
          <g key={si}>
            {s.area && <path d={areaFor(s)} fill={s.color} opacity={0.12} />}
            <path d={pathFor(s)} fill="none" stroke={s.color} strokeWidth={s.muted ? 1 : 2}
                  opacity={s.muted ? 0.22 : 1}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  strokeLinejoin="round" strokeLinecap="round" />
            {s.dots && s.points.map((v, i) => Number.isFinite(v) && (
              <circle key={i} cx={xAt(i)} cy={yAt(v)} r={3} fill={s.color} />
            ))}
          </g>
        ))}

        {/* hover crosshair + markers */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH}
                  stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {series.map((s, si) => !s.muted && Number.isFinite(s.points[hover]) && (
              <circle key={si} cx={xAt(hover)} cy={yAt(s.points[hover])} r={3.5}
                      fill={s.color} stroke="#0B111C" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {/* invisible capture layer */}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>

      {/* tooltip */}
      {hover != null && (
        <div className="absolute top-1 right-1 no-print rounded-lg bg-mf-panel/95 border border-mf-border px-2.5 py-1.5 text-[10px] shadow-card pointer-events-none">
          <div className="text-mf-txt3 mb-1 font-mono">{String(labels[hover])}</div>
          {series.filter(s => !s.muted).map((s, si) => (
            <div key={si}>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-mf-txt2">{s.label}</span>
                <span className="ml-auto font-mono text-mf-txt" data-gid={gid}>{Number.isFinite(s.points[hover]) ? yFormat(s.points[hover]) : '—'}</span>
              </div>
              {s.band && (
                <div className="text-[9px] text-mf-txt4 font-mono text-right">
                  [{yFormat(s.band.lower[hover])} – {yFormat(s.band.upper[hover])}]
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* legend */}
      {series.filter(s => !s.muted).length > 1 && (
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {series.filter(s => !s.muted).map((s, si) => (
            <div key={si} className="flex items-center gap-1.5 text-[10px] text-mf-txt3">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface TornadoDatum {
  label: string;
  /** Output values at the variable's low and high bound. */
  low: number;
  high: number;
  /** Optional annotations shown at each end (e.g. the input value). */
  lowNote?: string;
  highNote?: string;
}

interface TornadoChartProps {
  data: TornadoDatum[];   // pre-sorted (largest swing first) by caller
  base: number;           // baseline output (vertical reference line)
  valueFormat?: (v: number) => string;
  colorLow?: string;
  colorHigh?: string;
  barHeight?: number;
  className?: string;
}

/**
 * Horizontal tornado chart: each row is one variable, its bar spanning the
 * output range between its low and high bound, diverging from the base line.
 * The staple sensitivity visual for NPV/IRR — which lever moves the outcome most.
 */
export function TornadoChart({
  data, base, valueFormat = v => String(Math.round(v)),
  colorLow = '#F06B6B', colorHigh = '#10B981', barHeight = 26, className = '',
}: TornadoChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const labelW = 130;
  const noteW = 8;
  const top = 8, bottom = 22;
  const plotLeft = labelW;
  const plotRight = width - noteW;
  const plotW = plotRight - plotLeft;
  const rowGap = 8;
  const height = top + bottom + data.length * (barHeight + rowGap);

  const allV = data.flatMap(d => [d.low, d.high, base]);
  const min = Math.min(...allV);
  const max = Math.max(...allV);
  const pad = (max - min) * 0.08 || 1;
  const lo = min - pad, hi = max + pad;
  const xAt = (v: number) => plotLeft + ((v - lo) / (hi - lo || 1)) * plotW;

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Diagramme tornado de sensibilité">
        {/* base reference line */}
        <line x1={xAt(base)} x2={xAt(base)} y1={top} y2={height - bottom} stroke="#F59E0B" strokeWidth={1.25} strokeDasharray="3 3" opacity={0.8} />
        <text x={xAt(base)} y={height - 8} textAnchor="middle" fontSize={9} fill="#F59E0B" className="font-mono">base {valueFormat(base)}</text>

        {data.map((d, i) => {
          const y = top + i * (barHeight + rowGap);
          const x1 = xAt(Math.min(d.low, d.high));
          const x2 = xAt(Math.max(d.low, d.high));
          const active = hover === i;
          // Split the bar at the base line and colour by SIDE of base, not by
          // which input bound produced it: everything left of base is below the
          // baseline output (unfavourable → colorLow), everything right is above
          // it (favourable → colorHigh). This matches the legend regardless of
          // whether the low or high input bound is the one that lowers the output
          // (e.g. a higher OPEX lowers NPV).
          const xBase = Math.max(x1, Math.min(x2, xAt(base)));
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <text x={labelW - 8} y={y + barHeight / 2 + 3} textAnchor="end" fontSize={10} fill={active ? '#DCE3EE' : '#94A3B8'}>{d.label}</text>
              {/* left segment — below base (unfavourable) */}
              <rect x={x1} y={y} width={Math.max(0, xBase - x1)} height={barHeight} rx={2}
                    fill={colorLow} opacity={active ? 1 : 0.82} />
              {/* right segment — above base (favourable) */}
              <rect x={xBase} y={y} width={Math.max(0, x2 - xBase)} height={barHeight} rx={2}
                    fill={colorHigh} opacity={active ? 1 : 0.82} />
              {active && (
                <>
                  <text x={x1 - 3} y={y + barHeight / 2 + 3} textAnchor="end" fontSize={9} fill="#94A3B8" className="font-mono">{valueFormat(Math.min(d.low, d.high))}</text>
                  <text x={x2 + 3} y={y + barHeight / 2 + 3} textAnchor="start" fontSize={9} fill="#94A3B8" className="font-mono">{valueFormat(Math.max(d.low, d.high))}</text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface BarChartProps {
  labels: (string | number)[];
  values: number[];
  color?: string;
  height?: number;
  yFormat?: (v: number) => string;
  className?: string;
}

/** Simple vertical bar chart with per-bar hover highlight + value tooltip. */
export function BarChart({
  labels, values, color = '#F59E0B', height = 200, yFormat = v => String(Math.round(v)), className = '',
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const [, yMax] = niceExtent(values);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const n = values.length;
  const bw = (plotW / n) * 0.62;
  const gap = (plotW / n) * 0.38;

  const yAt = (v: number) => PAD.top + plotH - (v / (yMax || 1)) * plotH;

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Graphique en barres">
        {Array.from({ length: 5 }, (_, i) => (yMax / 4) * i).map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yAt(t)} y2={yAt(t)} stroke="#1E2A3B" strokeWidth={1} />
            <text x={PAD.left - 6} y={yAt(t) + 3} textAnchor="end" fontSize={9} fill="#56657A" className="font-mono">{yFormat(t)}</text>
          </g>
        ))}
        {values.map((v, i) => {
          const x = PAD.left + i * (bw + gap) + gap / 2;
          const active = hover === i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={yAt(v)} width={bw} height={PAD.top + plotH - yAt(v)} rx={2}
                    fill={color} opacity={active ? 1 : 0.78} />
              <text x={x + bw / 2} y={height - 8} textAnchor="middle" fontSize={9} fill="#56657A">{String(labels[i])}</text>
              {active && (
                <text x={x + bw / 2} y={yAt(v) - 4} textAnchor="middle" fontSize={10} fill="#DCE3EE" className="font-mono">{yFormat(v)}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

interface HistogramChartProps {
  /** Bornes des classes (n + 1 valeurs croissantes). */
  binEdges: number[];
  /** Effectif de chaque classe (n valeurs). */
  counts: number[];
  color?: string;
  height?: number;
  xFormat?: (v: number) => string;
  /** Repères verticaux en valeur X (ex. P10/P50/P90). */
  markers?: Marker[];
  xLabel?: string;
  className?: string;
}

/**
 * Histogramme à classes numériques : barres jointives proportionnelles à leur
 * largeur réelle, repères verticaux en valeur, survol avec bornes et effectif.
 */
export function HistogramChart({
  binEdges, counts, color = '#6366F1', height = 200, xFormat = v => String(Math.round(v)), markers = [], xLabel, className = '',
}: HistogramChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const lo = binEdges[0] ?? 0;
  const hi = binEdges[binEdges.length - 1] ?? 1;
  const maxCount = Math.max(1, ...counts);
  const xOf = (v: number) => PAD.left + ((v - lo) / (hi - lo || 1)) * plotW;
  const yOf = (c: number) => PAD.top + plotH - (c / maxCount) * plotH;
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={xLabel ? `Histogramme — ${xLabel}` : 'Histogramme'}>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yOf(f * maxCount)} y2={yOf(f * maxCount)} stroke="#1E2A3B" strokeWidth={1} />
            <text x={PAD.left - 6} y={yOf(f * maxCount) + 3} textAnchor="end" fontSize={9} fill="#56657A" className="font-mono">{Math.round(f * maxCount)}</text>
          </g>
        ))}
        {counts.map((c, i) => {
          const x1 = xOf(binEdges[i]);
          const x2 = xOf(binEdges[i + 1]);
          return (
            <rect key={i} x={x1 + 0.5} y={yOf(c)} width={Math.max(1, x2 - x1 - 1)} height={PAD.top + plotH - yOf(c)}
                  fill={color} opacity={hover === i ? 1 : 0.72}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
        {markers.map((m, mi) => (
          <g key={mi} pointerEvents="none">
            <line x1={xOf(m.at)} x2={xOf(m.at)} y1={PAD.top} y2={PAD.top + plotH} stroke={m.color} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={xOf(m.at)} y={PAD.top + 9} textAnchor="middle" fontSize={9} fill={m.color} className="font-mono">{m.label}</text>
          </g>
        ))}
        <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} stroke="#334155" strokeWidth={1} />
        <text x={PAD.left} y={height - 8} fontSize={9} fill="#56657A" className="font-mono">{xFormat(lo)}</text>
        <text x={width - PAD.right} y={height - 8} textAnchor="end" fontSize={9} fill="#56657A" className="font-mono">{xFormat(hi)}</text>
        {xLabel && <text x={PAD.left + plotW / 2} y={height - 8} textAnchor="middle" fontSize={9} fill="#56657A">{xLabel}</text>}
      </svg>
      {hover != null && (
        <div className="absolute top-1 right-1 no-print rounded-lg bg-mf-panel/95 border border-mf-border px-2.5 py-1.5 text-[10px] shadow-card pointer-events-none font-mono">
          <div className="text-mf-txt3">{xFormat(binEdges[hover])} – {xFormat(binEdges[hover + 1])}</div>
          <div className="text-mf-txt">{counts[hover]} ({total > 0 ? Math.round((counts[hover] / total) * 100) : 0} %)</div>
        </div>
      )}
    </div>
  );
}

export interface ScatterPoint {
  x: number;
  y: number;
  /** Étiquette affichée au survol (ex. identifiant d'échantillon). */
  label?: string;
  color?: string;
}

interface ScatterChartProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  color?: string;
  height?: number;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  /** Droite de tendance y = slope·x + intercept, tracée sur l'étendue des X. */
  trend?: { slope: number; intercept: number; color?: string; label?: string };
  className?: string;
}

/** Nuage de points X–Y numérique, avec droite de tendance optionnelle et survol par point. */
export function ScatterChart({
  points, xLabel, yLabel, color = '#F59E0B', height = 260,
  xFormat = v => String(+v.toFixed(2)), yFormat = v => String(+v.toFixed(2)), trend, className = '',
}: ScatterChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 640;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom - 10;
  const [x0, x1] = niceExtent(points.map(p => p.x), false);
  const [y0, y1] = niceExtent(points.map(p => p.y), false);
  const xOf = (v: number) => PAD.left + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const yOf = (v: number) => PAD.top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;
  const ticks = (a: number, b: number) => Array.from({ length: 5 }, (_, i) => a + (i / 4) * (b - a));

  return (
    <div className={`relative ${className}`}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={`Nuage de points — ${yLabel} en fonction de ${xLabel}`}>
        {ticks(y0, y1).map((t, i) => (
          <g key={`y${i}`}>
            <line x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="#1E2A3B" strokeWidth={1} />
            <text x={PAD.left - 6} y={yOf(t) + 3} textAnchor="end" fontSize={9} fill="#56657A" className="font-mono">{yFormat(t)}</text>
          </g>
        ))}
        {ticks(x0, x1).map((t, i) => (
          <text key={`x${i}`} x={xOf(t)} y={PAD.top + plotH + 14} textAnchor="middle" fontSize={9} fill="#56657A" className="font-mono">{xFormat(t)}</text>
        ))}
        <text x={PAD.left + plotW / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#94A3B8">{xLabel}</text>
        <text x={12} y={PAD.top + plotH / 2} textAnchor="middle" fontSize={10} fill="#94A3B8" transform={`rotate(-90 12 ${PAD.top + plotH / 2})`}>{yLabel}</text>
        {trend && (
          <line x1={xOf(x0)} y1={yOf(trend.slope * x0 + trend.intercept)} x2={xOf(x1)} y2={yOf(trend.slope * x1 + trend.intercept)}
                stroke={trend.color ?? '#94A3B8'} strokeWidth={1.5} strokeDasharray="5 4" />
        )}
        {points.map((p, i) => (
          <circle key={i} cx={xOf(p.x)} cy={yOf(p.y)} r={hover === i ? 5 : 3.5}
                  fill={p.color ?? color} opacity={hover == null || hover === i ? 0.9 : 0.45} stroke="#0B111C" strokeWidth={1}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover != null && points[hover] && (
        <div className="absolute top-1 right-1 no-print rounded-lg bg-mf-panel/95 border border-mf-border px-2.5 py-1.5 text-[10px] shadow-card pointer-events-none font-mono">
          {points[hover].label && <div className="text-mf-txt3">{points[hover].label}</div>}
          <div className="text-mf-txt">{xLabel} : {xFormat(points[hover].x)}</div>
          <div className="text-mf-txt">{yLabel} : {yFormat(points[hover].y)}</div>
        </div>
      )}
      {trend?.label && <div className="text-[10px] text-mf-txt4 text-center mt-1">{trend.label}</div>}
    </div>
  );
}
