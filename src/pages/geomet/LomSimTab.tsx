import { formatDecimalGrouped } from '../../lib/format/number';




import { GeometDomain, LomSimRow } from './model';

interface LomSimTabProps {
  domains: GeometDomain[];
  lomSimRows: LomSimRow[];
  lomYears: number;
  setLomSimRows: React.Dispatch<React.SetStateAction<LomSimRow[]>>;
  setLomYears: React.Dispatch<React.SetStateAction<number>>;
}

export function LomSimTab({ domains, lomSimRows, lomYears, setLomSimRows, setLomYears }: LomSimTabProps) {
  return (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Plan de vie de mine — Simulation GéoMet</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="mf-txt3">Durée LOM:</span>
                      <input type="number" min="1" max="30" className="input-field text-xs w-14 text-right" value={lomYears} onChange={e => setLomYears(parseInt(e.target.value) || 10)} />
                      <span className="mf-txt4">ans</span>
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    {[
                      { label: 'Total onces', val: `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.oz_year, 0) / 1000), 0)} koz`, color: 'text-amber-400' },
                      { label: 'Récup. moy.', val: lomSimRows.length ? `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.recovery_pct, 0) / lomSimRows.length), 1)}%` : '—', color: 'text-emerald-400' },
                      { label: 'Énergie moy.', val: lomSimRows.length ? `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.energy_kwh_t, 0) / lomSimRows.length), 1)} kWh/t` : '—', color: 'text-sky-400' },
                    ].map(k => (
                      <div key={k.label} className="text-right">
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`font-bold ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LOM bar chart */}
                <div className="card-sm">
                  <div className="text-xs mf-txt3 font-semibold mb-3 uppercase tracking-wider">Production annuelle (koz/an)</div>
                  {/* Each column must stretch to the chart height and give the bar a
                      parent with a definite height — a percentage height against an
                      auto-height parent resolves to zero, which left the bars invisible
                      while the labels still rendered. */}
                  <div className="flex items-stretch gap-1 h-32">
                    {(() => {
                      const maxOz = Math.max(...lomSimRows.map(x => x.oz_year), 1);
                      return lomSimRows.map(r => {
                        const h = Math.max((r.oz_year / maxOz) * 100, r.oz_year > 0 ? 2 : 0);
                        return (
                          <div key={r.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                            <div className="text-[9px] mf-txt4">{formatDecimalGrouped((r.oz_year / 1000), 0)}</div>
                            <div className="w-full flex-1 flex items-end">
                              <div className="w-full rounded-t transition-all"
                                style={{ height: `${h}%`, background: 'linear-gradient(180deg, #F59E0B 0%, #D97706 100%)' }}
                                title={`An ${r.year} — ${formatDecimalGrouped((r.oz_year / 1000), 1)} koz`} />
                            </div>
                            <div className="text-[9px] mf-txt4">{r.year}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Année', 'Débit (t/h)', 'Teneur (g/t)', 'Récup. (%)', 'BWi (kWh/t)', 'Énergie (kWh/t)', 'koz/an', 'Cumul (koz)', 'Notes'].map(h => (
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lomSimRows.map((r, i) => {
                        const cumOz = lomSimRows.slice(0, i + 1).reduce((s, x) => s + x.oz_year, 0);
                        return (
                          <tr key={r.year} className="border-b border-white/5 hover:bg-white/4">
                            <td className="px-2 py-1.5 font-semibold text-amber-400">An {r.year}</td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="10" className="input-field text-xs w-16 py-0.5 text-right"
                                value={formatDecimalGrouped(r.tph, 0)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, tph: parseFloat(e.target.value) || x.tph } : x))} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.01" className="input-field text-xs w-14 py-0.5 text-right"
                                value={formatDecimalGrouped(r.grade_g_t, 2)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, grade_g_t: parseFloat(e.target.value) || x.grade_g_t } : x))} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.1" className="input-field text-xs w-14 py-0.5 text-right"
                                value={formatDecimalGrouped(r.recovery_pct, 1)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, recovery_pct: parseFloat(e.target.value) || x.recovery_pct } : x))} />
                            </td>
                            <td className="px-2 py-1.5 text-sky-400">{formatDecimalGrouped(r.bwi_kwh_t, 1)}</td>
                            <td className="px-2 py-1.5 text-amber-300">{r.energy_kwh_t > 0 ? formatDecimalGrouped(r.energy_kwh_t, 1) : '—'}</td>
                            <td className="px-2 py-1.5 font-bold text-amber-400">{formatDecimalGrouped((r.oz_year / 1000), 1)}</td>
                            <td className="px-2 py-1.5 text-emerald-400">{formatDecimalGrouped((cumOz / 1000), 1)}</td>
                            <td className="px-2 py-1.5">
                              <input className="input-field text-xs w-32 py-0.5 mf-txt3"
                                value={r.notes}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                                placeholder="Commentaire…" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-400/40">
                        <td className="px-2 py-2 font-bold text-xs mf-txt" colSpan={6}>TOTAL LOM</td>
                        <td className="px-2 py-2 font-bold text-amber-400">{formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.oz_year, 0) / 1000), 1)} koz</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        );
}
