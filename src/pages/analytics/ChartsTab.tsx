import { formatDecimalGrouped } from '../../lib/format/number';


import { LimsData } from './model';
import { Histogram } from './charts';

// ─── Tab: Courbes & Histogrammes ─────────────────────────────────────────────

export function ChartsTab({ data }: { data: LimsData }) {
  const auVals     = data.chem.map(t => t.au_g_t).filter((v): v is number => v !== null && v > 0);
  const bwiVals    = data.comminution.map(t => t.bwi_kwh_t).filter((v): v is number => v !== null && v > 0);
  const grgVals    = data.knelson.map(t => t.grg_recovery_pct).filter((v): v is number => v !== null && v > 0);
  const leachVals  = data.leaching.map(t => t.leach_rec_24h_pct).filter((v): v is number => v !== null && v > 0);
  const flotVals   = data.flotation.map(t => t.au_recovery_pct).filter((v): v is number => v !== null && v > 0);
  const pyVals     = data.mineralogy.map(t => t.pyrite_pct).filter((v): v is number => v !== null && v > 0);
  const auFreeVals = data.mineralogy.map(t => t.au_free_pct).filter((v): v is number => v !== null && v > 0);
  const nacnVals   = data.leaching.map(t => t.nacn_consumption_kg_t).filter((v): v is number => v !== null && v > 0);

  // Kinetics curve
  const leachRows = data.leaching;
  const kineticPts = [
    { h: 2,  key: 'leach_rec_2h_pct' as const },
    { h: 4,  key: 'leach_rec_4h_pct' as const },
    { h: 8,  key: 'leach_rec_8h_pct' as const },
    { h: 12, key: 'leach_rec_12h_pct' as const },
    { h: 24, key: 'leach_rec_24h_pct' as const },
    { h: 48, key: 'leach_rec_48h_pct' as const },
  ].map(pt => {
    const vals = leachRows.map(r => r[pt.key]).filter((v): v is number => v !== null && v > 0);
    return { h: pt.h, key: pt.key, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });

  const charts = [
    { values: auVals,     label: 'Distribution teneur Au (Analyse chim.)', unit: 'g/t',   color: '#f59e0b' },
    { values: leachVals,  label: 'Distribution récupération lixiviation 24h', unit: '%',  color: '#10b981' },
    { values: grgVals,    label: 'Distribution récupération GRG (Knelson)',  unit: '%',   color: '#2ecc8a' },
    { values: bwiVals,    label: 'Distribution Bond Ball WI',                unit: 'kWh/t', color: '#38bdf8' },
    { values: flotVals,   label: 'Distribution récupération flottation Au',  unit: '%',   color: '#f88a44' },
    { values: pyVals,     label: 'Distribution pyrite (Minéralogie)',        unit: '%',   color: '#9d78f0' },
    { values: auFreeVals, label: 'Distribution Au libre (MLA)',              unit: '%',   color: '#fbbf24' },
    { values: nacnVals,   label: 'Distribution consommation NaCN',           unit: 'kg/t', color: '#6b7280' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {charts.map(c => (
          <div key={c.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <Histogram {...c} bins={8} />
            {c.values.length > 1 && (
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-mf-border/60">
                {[
                  { k: 'Min', v: Math.min(...c.values) },
                  { k: 'Moy', v: c.values.reduce((a, b) => a + b, 0) / c.values.length },
                  { k: 'Max', v: Math.max(...c.values) },
                ].map(s => (
                  <div key={s.k} className="text-center">
                    <div className="text-[9px] text-mf-txt4 uppercase">{s.k}</div>
                    <div className="text-xs font-mono font-bold text-mf-txt">{formatDecimalGrouped(s.v, 1)} <span className="text-mf-txt4 text-[9px]">{c.unit}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Kinetics curve */}
      {leachRows.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-sm font-semibold text-mf-txt mb-1">Cinétique de lixiviation — profil moyen (n={leachRows.length} essais)</div>
          <div className="relative h-48">
            <svg viewBox="0 0 600 170" className="w-full h-full">
              {[25, 50, 75, 100].map(y => (
                <g key={y}>
                  <line x1="40" y1={158 - y * 1.4} x2="580" y2={158 - y * 1.4} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  <text x="34" y={162 - y * 1.4} fill="#6b7280" fontSize="9" textAnchor="end">{y}%</text>
                </g>
              ))}
              {kineticPts.map((pt, i) => {
                const x = 40 + (i / (kineticPts.length - 1)) * 540;
                return <text key={pt.h} x={x} y="168" fill="#6b7280" fontSize="9" textAnchor="middle">{pt.h}h</text>;
              })}
              {/* Individual curves */}
              {leachRows.slice(0, 20).map((row, ri) => {
                const pts = kineticPts.map((pt, i) => {
                  const v = row[pt.key as keyof typeof row] as number | null;
                  const x = 40 + (i / (kineticPts.length - 1)) * 540;
                  const y = v && v > 0 ? 158 - v * 1.4 : null;
                  return { x, y };
                }).filter(p => p.y !== null);
                if (pts.length < 2) return null;
                return <polyline key={ri} points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="1" opacity="0.15" />;
              })}
              {/* Average */}
              {(() => {
                const pts = kineticPts.filter(pt => pt.avg !== null)
                  .map((pt) => ({ x: 40 + (kineticPts.findIndex(p => p.h === pt.h) / (kineticPts.length - 1)) * 540, y: 158 - pt.avg! * 1.4 }));
                if (pts.length < 2) return null;
                return (
                  <g>
                    <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="2.5" />
                    {pts.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r="4.5" fill="#10b981" />
                        <text x={p.x} y={p.y - 7} fill="#10b981" fontSize="8" textAnchor="middle">
                          {kineticPts[i].avg !== null ? `${kineticPts[i].avg!.toFixed(0)}%` : ''}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
