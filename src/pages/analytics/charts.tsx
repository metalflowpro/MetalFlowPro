import { formatDecimalGrouped } from '../../lib/format/number';
import { Star,
} from 'lucide-react';
import { type RouteEstimate } from '../../lib/analytics/routeEstimation';


// ─── SVG Histogram ────────────────────────────────────────────────────────────

export function Histogram({ values, label, unit, bins = 8, color = '#f59e0b' }: {
  values: number[]; label: string; unit: string; bins?: number; color?: string;
}) {
  const HW = 320, HH = 100, HPAD = 4;
  if (values.length === 0) {
    return (
      <div>
        <div className="text-xs font-semibold text-mf-txt mb-1">{label}</div>
        <div className="flex items-center justify-center h-24 text-xs text-mf-txt4 rounded-lg border border-dashed border-mf-border/50">Pas de données LIMS</div>
      </div>
    );
  }
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const binW = range / bins;
  const counts = Array(bins).fill(0);
  values.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - minV) / binW))]++; });
  const maxCount = Math.max(...counts, 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const barW = (HW - HPAD * 2) / bins;

  return (
    <div>
      <div className="text-xs font-semibold text-mf-txt mb-1">
        {label} <span className="text-mf-txt4 font-normal text-[10px]">n={values.length} · μ={formatDecimalGrouped(avg, 2)} {unit}</span>
      </div>
      <svg viewBox={`0 0 ${HW} ${HH + 18}`} className="w-full" style={{ height: 118 }}>
        {/* grid lines */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={HPAD} y1={HH - f * HH} x2={HW - HPAD} y2={HH - f * HH} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {/* bars */}
        {counts.map((c, i) => {
          const bh = Math.max(c > 0 ? 4 : 0, (c / maxCount) * HH);
          const x = HPAD + i * barW + 1;
          const w = barW - 2;
          const opacity = 0.45 + (c / maxCount) * 0.5;
          return (
            <g key={i}>
              <rect x={x} y={HH - bh} width={w} height={bh} fill={color} opacity={opacity} rx="2" />
              {c > 0 && bh > 14 && (
                <text x={x + w / 2} y={HH - bh + 10} fill="white" fontSize="8" textAnchor="middle" opacity="0.9">{c}</text>
              )}
            </g>
          );
        })}
        {/* mean line */}
        {(() => {
          const mx = HPAD + ((avg - minV) / range) * (HW - HPAD * 2);
          return (
            <line x1={mx} y1={0} x2={mx} y2={HH} stroke={color} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
          );
        })()}
        {/* x-axis labels */}
        <text x={HPAD} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="start">{formatDecimalGrouped(minV, 1)}</text>
        <text x={HW / 2} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="middle">{unit}</text>
        <text x={HW - HPAD} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="end">{formatDecimalGrouped(maxV, 1)}</text>
      </svg>
    </div>
  );
}

// ─── SVG Scatter ─────────────────────────────────────────────────────────────

function _ScatterPlot({ xVals, yVals, xLabel, yLabel, color = '#f59e0b' }: {
  xVals: number[]; yVals: number[]; xLabel: string; yLabel: string; color?: string;
}) {
  if (xVals.length < 2) {
    return <div className="flex items-center justify-center h-36 text-xs text-mf-txt4">Données insuffisantes (min. 2 points)</div>;
  }
  const W = 260, H = 140, PAD = 28;
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const scaleX = (v: number) => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  const scaleY = (v: number) => H - PAD - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);

  // Simple linear regression
  const n = xVals.length;
  const xMean = xVals.reduce((a, b) => a + b, 0) / n;
  const yMean = yVals.reduce((a, b) => a + b, 0) / n;
  const num = xVals.reduce((s, x, i) => s + (x - xMean) * (yVals[i] - yMean), 0);
  const den = xVals.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const r = den !== 0 ? num / Math.sqrt(den * yVals.reduce((s, y) => s + (y - yMean) ** 2, 0)) : 0;

  const lineX1 = xMin, lineY1 = slope * xMin + intercept;
  const lineX2 = xMax, lineY2 = slope * xMax + intercept;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        {/* axes */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.1)" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.1)" />
        {/* regression line */}
        <line x1={scaleX(lineX1)} y1={scaleY(lineY1)} x2={scaleX(lineX2)} y2={scaleY(lineY2)}
          stroke={color} strokeWidth="1" strokeDasharray="4 2" opacity="0.5" />
        {/* points */}
        {xVals.map((x, i) => (
          <circle key={i} cx={scaleX(x)} cy={scaleY(yVals[i])} r="3" fill={color} opacity="0.75" />
        ))}
        {/* axis labels */}
        <text x={W / 2} y={H - 2} fill="#6b7280" fontSize="8" textAnchor="middle">{xLabel}</text>
        <text x={8} y={H / 2} fill="#6b7280" fontSize="8" textAnchor="middle" transform={`rotate(-90,8,${H / 2})`}>{yLabel}</text>
      </svg>
      <div className="text-[10px] text-mf-txt4 text-right">r = {formatDecimalGrouped(r, 2)}{Math.abs(r) > 0.7 ? ' ✓ corrélation forte' : Math.abs(r) > 0.4 ? ' ~ corrélation modérée' : ' ✗ corrélation faible'}</div>
    </div>
  );
}

// ─── RouteBar ─────────────────────────────────────────────────────────────────

export function RouteBar({ route, maxRec }: { route: RouteEstimate; maxRec: number }) {
  const pctWidth = maxRec > 0 ? (route.recovery_pct / maxRec) * 100 : 0;
  const p = { high: { fg: '#10b981', bg: 'bg-emerald-500/15 border-emerald-500/25', text: 'text-emerald-400' }, medium: { fg: '#f59e0b', bg: 'bg-amber-500/15 border-amber-500/25', text: 'text-amber-400' }, low: { fg: '#6b7280', bg: 'bg-mf-border/30 border-mf-border/50', text: 'text-mf-txt4' } };
  const c = p[route.confidence];
  const capexColor = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-red-400' };
  return (
    <div className={`mb-3 p-3 rounded-xl border transition-all ${route.recommended ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-mf-border/50 bg-mf-hover/20'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {route.recommended && <Star size={11} className="text-emerald-400 fill-emerald-400" />}
          <span className="text-xs font-medium text-mf-txt">{route.route}</span>
        </div>
        <span className={`text-sm font-mono font-bold ${route.recommended ? 'text-emerald-400' : 'text-mf-txt'}`}>{route.recovery_pct}%</span>
      </div>
      <div className="h-1.5 bg-mf-border/30 rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pctWidth}%`, backgroundColor: c.fg }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${c.bg} ${c.text}`}>{route.confidence.toUpperCase()}</span>
        <span className="text-[9px] text-mf-txt4">CapEx: <span className={capexColor[route.capex_indicator]}>{route.capex_indicator.toUpperCase()}</span></span>
        <span className="text-[9px] text-mf-txt4">OpEx: <span className={capexColor[route.opex_indicator]}>{route.opex_indicator.toUpperCase()}</span></span>
        <span className="text-[10px] text-mf-txt4 flex-1 leading-tight">{route.basis}</span>
      </div>
    </div>
  );
}
