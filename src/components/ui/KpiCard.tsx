import { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

type AccentColor = 'gold' | 'teal' | 'blue' | 'green' | 'red' | 'purple';

interface KpiCardProps {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  icon?: ReactNode;
  accentColor?: AccentColor;
  /** Convenience alias for accentColor. Accepts 'amber' (mapped to gold). */
  color?: AccentColor | 'amber';
  /** Directional trend indicator shown next to the sub-label. */
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

const COLOR_ALIASES: Record<string, AccentColor> = { amber: 'gold' };

function resolveAccent(color?: string, accentColor?: AccentColor): AccentColor {
  const raw = color ?? accentColor ?? 'gold';
  return COLOR_ALIASES[raw] ?? (raw as AccentColor);
}

const ACCENT_CLASSES: Record<string, string> = {
  gold:   'border-amber-500/30 bg-amber-500/5',
  teal:   'border-teal-500/30 bg-teal-500/5',
  blue:   'border-blue-500/30 bg-blue-500/5',
  green:  'border-emerald-500/30 bg-emerald-500/5',
  red:    'border-red-500/30 bg-red-500/5',
  purple: 'border-purple-500/30 bg-purple-500/5',
};

const ICON_ACCENT: Record<string, string> = {
  gold:   'bg-amber-500/15 text-amber-400',
  teal:   'bg-teal-500/15 text-teal-400',
  blue:   'bg-blue-500/15 text-blue-400',
  green:  'bg-emerald-500/15 text-emerald-400',
  red:    'bg-red-500/15 text-red-400',
  purple: 'bg-purple-500/15 text-purple-400',
};

export function KpiCard({ label, value, unit, sub, delta, deltaLabel, icon, accentColor, color, trend, className = '' }: KpiCardProps) {
  const accent       = resolveAccent(color, accentColor);
  const accentBorder = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.gold;
  const iconClass    = ICON_ACCENT[accent] ?? ICON_ACCENT.gold;

  // A directional trend maps to an implicit delta arrow when no explicit delta is provided.
  const trendDelta = delta ?? (trend === 'up' ? 1 : trend === 'down' ? -1 : trend === 'neutral' ? 0 : undefined);
  const showDeltaValue = delta !== undefined;
  const deltaColor = trendDelta === undefined ? '' : trendDelta > 0 ? 'text-emerald-400' : trendDelta < 0 ? 'text-red-400' : 'text-mf-txt4';
  const DeltaIcon  = trendDelta === undefined ? null : trendDelta > 0 ? TrendingUp : trendDelta < 0 ? TrendingDown : Minus;

  return (
    <div className={`card border ${accentBorder} flex flex-col gap-3 animate-fade-in ${className}`}>
      <div className="flex items-start justify-between">
        <div className="kpi-label">{label}</div>
        {icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconClass}`}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <span className="kpi-value">{value}</span>
        {unit && <span className="kpi-unit mb-1">{unit}</span>}
      </div>
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-mf-border/50">
        {sub && <span className="text-xs text-mf-txt4">{sub}</span>}
        {DeltaIcon && (
          <span className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
            <DeltaIcon size={12} />
            {showDeltaValue && `${Math.abs(delta!)}% `}{deltaLabel ?? ''}
          </span>
        )}
      </div>
    </div>
  );
}
