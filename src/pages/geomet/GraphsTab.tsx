import { formatDecimalGrouped } from '../../lib/format/number';

import type { Project } from '../../types';



import { GeometDomain } from './model';

interface GraphsTabProps {
  domains: GeometDomain[];
  mcP10: number | null;
  mcP50: number | null;
  mcP90: number | null;
  monteCarlo: { oz: number; rec: number; }[];
  project: Project;
}

export function GraphsTab({ domains, mcP10, mcP50, mcP90, monteCarlo, project }: GraphsTabProps) {
  return (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Aucune donnée à visualiser</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Récupération par Domaine (%)</div>
                    <div className="space-y-2">
                      {domains.map(d => {
                        const rec = d.recovery_design ?? 0;
                        return (
                          <div key={d.id} className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="w-20 text-xs mf-txt3 truncate">{d.name}</div>
                            <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                              {d.recovery_min != null && d.recovery_max != null && (
                                <div className="absolute h-full opacity-20 rounded-full"
                                  style={{ left: `${d.recovery_min}%`, width: `${d.recovery_max - d.recovery_min}%`, backgroundColor: d.color ?? '#10B981' }} />
                              )}
                              <div className="h-full rounded-full" style={{ width: `${rec}%`, backgroundColor: d.color ?? '#6B7280', opacity: 0.8 }} />
                            </div>
                            <div className="w-12 text-xs font-semibold text-right" style={{ color: d.color ?? '#9CA3AF' }}>
                              {rec > 0 ? `${formatDecimalGrouped(rec, 1)}%` : '—'}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-3 border-t border-white/5 pt-2">
                        <div className="w-3 h-3 rounded-full shrink-0 border-2 border-white/30 bg-transparent" />
                        <div className="w-20 text-xs mf-txt4 truncate">Projet (réf.)</div>
                        <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden">
                          <div className="h-full rounded-full border-2 border-white/30" style={{ width: `${project.recovery_pct}%` }} />
                        </div>
                        <div className="w-12 text-xs text-white/30 text-right">{project.recovery_pct}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">BWi par Domaine (kWh/t)</div>
                    {domains.filter(d => d.avg_bwi_kwh_t != null).length === 0 ? (
                      <div className="text-xs mf-txt4 text-center py-8">Aucune donnée BWi</div>
                    ) : (() => {
                      const maxBwi = Math.max(...domains.map(d => d.avg_bwi_kwh_t ?? 0), 1);
                      return domains.map(d => {
                        const bwi = d.avg_bwi_kwh_t ?? 0;
                        return (
                          <div key={d.id} className="flex items-center gap-3 mb-2">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="w-20 text-xs mf-txt3 truncate">{d.name}</div>
                            <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                              {d.bwi_min != null && d.bwi_max != null && (
                                <div className="absolute h-full bg-sky-400/15 rounded-full"
                                  style={{ left: `${(d.bwi_min / maxBwi) * 100}%`, width: `${((d.bwi_max - d.bwi_min) / maxBwi) * 100}%` }} />
                              )}
                              <div className="h-full rounded-full bg-sky-500/60 transition-all" style={{ width: `${(bwi / maxBwi) * 100}%` }} />
                            </div>
                            <div className="w-16 text-xs text-sky-400 text-right">{bwi > 0 ? `${formatDecimalGrouped(bwi, 1)}` : '—'}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Monte Carlo results histogram if available */}
                  {monteCarlo.length > 0 && (
                    <div className="card-sm">
                      <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Distribution Monte Carlo — Onces/an</div>
                      <div className="flex items-end gap-px h-24 mb-2">
                        {(() => {
                          const min = monteCarlo[0].oz;
                          const max = monteCarlo[monteCarlo.length - 1].oz;
                          const bins = 25;
                          const binW = (max - min) / bins;
                          const counts = Array(bins).fill(0);
                          monteCarlo.forEach(r => {
                            const b = Math.min(bins - 1, Math.floor((r.oz - min) / binW));
                            counts[b]++;
                          });
                          const maxCount = Math.max(...counts);
                          return counts.map((c, i) => {
                            const binMid = min + (i + 0.5) * binW;
                            const isP50 = i === Math.floor(bins / 2);
                            return (
                              <div key={i} className="flex-1 rounded-t transition-all"
                                title={`${formatDecimalGrouped((binMid / 1000), 1)} koz: ${c} simulations`}
                                style={{ height: `${(c / maxCount) * 100}%`, backgroundColor: isP50 ? '#F59E0B' : '#10B981AA' }} />
                            );
                          });
                        })()}
                      </div>
                      <div className="flex justify-between text-[10px] mf-txt4">
                        <span className="text-red-400">P10: {mcP10 != null ? `${formatDecimalGrouped((mcP10/1000), 1)} koz` : '—'}</span>
                        <span className="text-amber-400">P50: {mcP50 != null ? `${formatDecimalGrouped((mcP50/1000), 1)} koz` : '—'}</span>
                        <span className="text-emerald-400">P90: {mcP90 != null ? `${formatDecimalGrouped((mcP90/1000), 1)} koz` : '—'}</span>
                      </div>
                    </div>
                  )}
                </div>

                {domains.some(d => d.lom_pct != null) && (() => {
                  const total = domains.reduce((s, d) => s + (d.lom_pct ?? 0), 0) || 1;
                  let cumAngle = -Math.PI / 2;
                  const cx = 80, cy = 80, r = 62;
                  return (
                    <div className="card-sm">
                      <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Proportion LOM par domaine</div>
                      <div className="flex gap-8 items-center">
                        <svg viewBox="0 0 160 160" className="w-40 h-40 shrink-0">
                          {domains.map(d => {
                            if (!d.lom_pct) return null;
                            const angle = (d.lom_pct / total) * 2 * Math.PI;
                            const x1 = cx + r * Math.cos(cumAngle);
                            const y1 = cy + r * Math.sin(cumAngle);
                            cumAngle += angle;
                            const x2 = cx + r * Math.cos(cumAngle);
                            const y2 = cy + r * Math.sin(cumAngle);
                            const largeArc = angle > Math.PI ? 1 : 0;
                            return (
                              <path key={d.id}
                                d={`M${cx},${cy} L${x1},${y1} A${r},${r},0,${largeArc},1,${x2},${y2} Z`}
                                fill={d.color ?? '#6B7280'} opacity={0.85} />
                            );
                          })}
                          <circle cx={cx} cy={cy} r={28} fill="rgb(18,24,32)" />
                          <text x={cx} y={cy - 5} textAnchor="middle" fill="#9CA3AF" fontSize="9">LOM</text>
                          <text x={cx} y={cy + 8} textAnchor="middle" fill="#E5E7EB" fontSize="11" fontWeight="bold">{domains.length} dom.</text>
                        </svg>
                        <div className="space-y-2">
                          {domains.filter(d => d.lom_pct).map(d => (
                            <div key={d.id} className="flex items-center gap-2.5 text-xs">
                              <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                              <span className="mf-txt">{d.name}</span>
                              <span className="ml-auto mf-txt3">{d.lom_pct?.toFixed(0)}%</span>
                            </div>
                          ))}
                          <div className="pt-2 border-t border-white/5 text-[10px] mf-txt4">
                            Total: {formatDecimalGrouped(domains.reduce((s, d) => s + (d.lom_pct ?? 0), 0), 0)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        );
}
