import { formatDecimalGrouped } from '../../lib/format/number';
import { HistogramChart } from '../../components/ui/Chart';
import { Star,
} from 'lucide-react';
import { type RouteEstimate } from '../../lib/analytics/routeEstimation';


// ─── Histogramme ─────────────────────────────────────────────────────────────

export function Histogram({ values, label, unit, bins = 8, color = '#f59e0b' }: {
  values: number[]; label: string; unit: string; bins?: number; color?: string;
}) {
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
  const counts = Array<number>(bins).fill(0);
  values.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - minV) / binW))]++; });
  const edges = Array.from({ length: bins + 1 }, (_, i) => minV + i * binW);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  return (
    <div>
      <div className="text-xs font-semibold text-mf-txt mb-1">
        {label} <span className="text-mf-txt4 font-normal text-[10px]">n={values.length} · μ={formatDecimalGrouped(avg, 2)} {unit}</span>
      </div>
      <HistogramChart
        binEdges={edges} counts={counts} color={color} height={150} xLabel={unit}
        xFormat={v => formatDecimalGrouped(v, 1)}
        markers={[{ at: avg, label: 'μ', color }]}
      />
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
