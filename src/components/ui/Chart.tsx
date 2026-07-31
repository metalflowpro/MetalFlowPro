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
}

interface AxisChartProps {
  labels: (string | number)[];
  series: Series[];
  height?: number;
  yFormat?: (v: number) => string;
  yLabel?: string;
  className?: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 46 };

function niceExtent(values: number[]): [number, number] {
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  if (min === max) return [min - 1, max + 1];
  const pad = (max - min) * 0.08;
  return [min - (min < 0 ? pad : 0), max + pad];
}

/**
 * Multi-series line / area chart with a hover crosshair and a tooltip that
 * reports every series value at the nearest X. Fully keyboard/pointer safe.
 */
export function LineChart({
  labels, series, height = 220, yFormat = v => String(Math.round(v)), yLabel, className = '',
}: AxisChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  const width = 640; // viewBox units; SVG scales to container width.

  const allY = series.flatMap(s => s.points);
  const [yMin, yMax] = useMemo(() => niceExtent(allY), [allY]);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const n = labels.length;

  const xAt = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  // 4 horizontal gridlines.
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * (yMax - yMin));

  const pathFor = (s: Series) =>
    s.points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ');

  const areaFor = (s: Series) =>
    `${pathFor(s)} L ${xAt(n - 1).toFixed(1)} ${yAt(yMin).toFixed(1)} L ${xAt(0).toFixed(1)} ${yAt(yMin).toFixed(1)} Z`;

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - PAD.left) / plotW) * (n - 1))));
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
            <text key={i} x={xAt(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="#56657A">
              {String(l)}
            </text>
          );
        })}

        {/* series */}
        {series.map((s, si) => (
          <g key={si}>
            {s.area && <path d={areaFor(s)} fill={s.color} opacity={0.12} />}
            <path d={pathFor(s)} fill="none" stroke={s.color} strokeWidth={2}
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                  strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}

        {/* hover crosshair + markers */}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH}
                  stroke="#F59E0B" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {series.map((s, si) => (
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
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
              <span className="text-mf-txt2">{s.label}</span>
              <span className="ml-auto font-mono text-mf-txt" data-gid={gid}>{yFormat(s.points[hover])}</span>
            </div>
          ))}
        </div>
      )}

      {/* legend */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {series.map((s, si) => (
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
