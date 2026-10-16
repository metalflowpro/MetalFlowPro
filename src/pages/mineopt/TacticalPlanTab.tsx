import { formatDecimalGrouped } from '../../lib/format/number';


import { type CalendarConfig,
} from '../../lib/mine/planning';

import { type FleetRequirement, type PeriodPlan } from '../../lib/mine/planning';
interface TacticalPlanTabProps {
  Math: Math;
  cal: CalendarConfig;
  fleetCapacity: Record<string, number>;
  fleetDerate: { availabilityPct: number; utilisationPct: number; };
  fleetForQuarter: FleetRequirement[];
  impliedCapacity: { equipment: string; units: number; hoursYear: number; impliedTph: number; annualCostM: number; }[];
  lom: { year: number; grade: number; ore: number; waste: number; total: number; oz_k: number; contained_oz_k: number; net_oz_k: number; rev_m: number; cost_m: number; ebitda_m: number; fcf_m: number; aisc: number; rs: number; }[];
  months: PeriodPlan[];
  planYear: { year: number; grade: number; ore: number; waste: number; total: number; oz_k: number; contained_oz_k: number; net_oz_k: number; rev_m: number; cost_m: number; ebitda_m: number; fcf_m: number; aisc: number; rs: number; };
  quarters: PeriodPlan[];
  seasonality: number[];
  setCal: React.Dispatch<React.SetStateAction<CalendarConfig>>;
  setFleetCapacity: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setFleetDerate: React.Dispatch<React.SetStateAction<{ availabilityPct: number; utilisationPct: number; }>>;
  setSeasonality: React.Dispatch<React.SetStateAction<number[]>>;
  setTacticalYear: React.Dispatch<React.SetStateAction<number>>;
  tacticalYear: number;
}

export function TacticalPlanTab({ Math, cal, fleetCapacity, fleetDerate, fleetForQuarter, impliedCapacity, lom, months, planYear, quarters, seasonality, setCal, setFleetCapacity, setFleetDerate, setSeasonality, setTacticalYear, tacticalYear }: TacticalPlanTabProps) {
  return (
          <div className="space-y-4">
            {!planYear ? (
              <div className="card-sm text-center py-10 text-sm mf-txt4">Le plan stratégique (étape 3) doit exister d'abord.</div>
            ) : (
              <>
                <div className="card-sm">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Calendrier d'exploitation</div>
                    {([
                      ['Année du plan', tacticalYear, (v: number) => setTacticalYear(v), 1, lom.length],
                      ['Jours/an', cal.daysPerYear, (v: number) => setCal(c => ({ ...c, daysPerYear: v })), 1, 366],
                      ['Quarts/jour', cal.shiftsPerDay, (v: number) => setCal(c => ({ ...c, shiftsPerDay: v })), 1, 4],
                      ['Heures/quart', cal.hoursPerShift, (v: number) => setCal(c => ({ ...c, hoursPerShift: v })), 1, 24],
                    ] as [string, number, (v: number) => void, number, number][]).map(([label, val, set, min, max]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className="text-[10px] mf-txt4">{label}</span>
                        <input type="number" min={min} max={max} value={val}
                          onChange={e => set(Math.max(min, Math.min(max, +e.target.value || min)))}
                          className="input-field text-xs w-16 py-0.5 text-right" />
                      </div>
                    ))}
                    <span className="text-[10px] mf-txt4">
                      → {(cal.daysPerYear * cal.shiftsPerDay * cal.hoursPerShift).toLocaleString('fr-CA')} h/an opérationnelles
                    </span>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plan trimestriel — an {planYear.year}</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Désagrégation du plan annuel : les trimestres bouclent exactement sur l'année, par construction.
                    La saisonnalité redistribue le tonnage sans changer le total.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="tbl w-full text-xs">
                      <thead><tr>{['Trimestre', 'Saisonnalité', 'Jours', 'Minerai (Mt)', 'Stérile (Mt)', 'Total (Mt)', 'Teneur', 'koz'].map(h => (
                        <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                      <tbody>
                        {quarters.map((q, i) => (
                          <tr key={q.label} className="border-b border-white/5">
                            <td className="px-3 py-1.5 font-semibold mf-txt">{q.label}</td>
                            <td className="px-3 py-1.5">
                              <input type="number" step="0.1" min="0" value={seasonality[i] ?? 1}
                                onChange={e => setSeasonality(prev => prev.map((v, n) => n === i ? (+e.target.value || 0) : v))}
                                className="input-field text-xs w-14 py-0.5 text-right" />
                            </td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.days, 0)}</td>
                            <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(q.oreMt, 2)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.wasteMt, 2)}</td>
                            <td className="px-3 py-1.5 font-semibold mf-txt">{formatDecimalGrouped(q.totalMt, 2)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.gradeGt, 2)} g/t</td>
                            <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(q.ozK, 1)}</td>
                          </tr>
                        ))}
                        <tr className="bg-white/4">
                          <td className="px-3 py-1.5 font-bold mf-txt" colSpan={3}>Total an {planYear.year}</td>
                          <td className="px-3 py-1.5 font-bold text-amber-400">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.oreMt, 0), 2)}</td>
                          <td className="px-3 py-1.5 font-bold mf-txt3">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.wasteMt, 0), 2)}</td>
                          <td className="px-3 py-1.5 font-bold mf-txt">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.totalMt, 0), 2)}</td>
                          <td />
                          <td className="px-3 py-1.5 font-bold text-amber-400">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.ozK, 0), 1)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Plan mensuel — an {planYear.year}</div>
                  {/* items-stretch, not items-end: the columns must take the chart's
                      height, otherwise the bar's percentage height resolves against an
                      auto-height parent and collapses to zero — labels render, bars do not. */}
                  <div className="flex items-stretch gap-1 h-24">
                    {(() => {
                      const mx = Math.max(...months.map(x => x.totalMt), 0.001);
                      return months.map(m => (
                        <div key={m.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                          <div className="text-[8px] mf-txt4">{formatDecimalGrouped(m.totalMt, 1)}</div>
                          <div className="w-full flex-1 flex items-end">
                            <div className="w-full rounded-t bg-gradient-to-t from-amber-600 to-amber-400"
                              style={{ height: `${Math.max((m.totalMt / mx) * 100, m.totalMt > 0 ? 2 : 0)}%` }}
                              title={`${m.label} — ${formatDecimalGrouped(m.totalMt, 2)} Mt`} />
                          </div>
                          <div className="text-[8px] mf-txt4">{m.label}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Allocation des équipements — an {planYear.year}</div>
                  {impliedCapacity.length === 0 ? (
                    <div className="text-[10px] mf-txt4 py-3">
                      Aucun équipement planifié pour cette année. Renseignez le calendrier de flotte dans
                      <strong className="mf-txt3"> 2 · Conception minière</strong>.
                    </div>
                  ) : (
                    <>
                      <div className="text-[10px] mf-txt4 mb-3">
                        La capacité machine n'est pas stockée dans le calendrier de flotte : plutôt que de l'inventer, la colonne
                        <strong className="mf-txt3"> capacité implicite</strong> montre le t/h que chaque unité doit tenir pour livrer
                        l'année avec les heures engagées. Saisissez la capacité réelle pour obtenir le besoin en unités.
                      </div>
                      <div className="flex items-center gap-3 mb-2">
                        {([['Disponibilité (%)', 'availabilityPct'], ['Utilisation (%)', 'utilisationPct']] as const).map(([label, key]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="text-[10px] mf-txt4">{label}</span>
                            <input type="number" min="1" max="100" value={fleetDerate[key]}
                              onChange={e => setFleetDerate(d => ({ ...d, [key]: +e.target.value || 1 }))}
                              className="input-field text-xs w-14 py-0.5 text-right" />
                          </div>
                        ))}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="tbl w-full text-xs">
                          <thead><tr>{['Équipement', 'Unités', 'h/an', 'Capacité implicite', 'Capacité réelle (t/h)', 'Unités requises', 'Écart', 'Coût M$/an'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                          <tbody>
                            {impliedCapacity.map((e, i) => {
                              const req = fleetForQuarter[i];
                              const cap = fleetCapacity[e.equipment.split(' — ')[0]] ?? 0;
                              return (
                                <tr key={e.equipment} className="border-b border-white/5">
                                  <td className="px-3 py-1.5 mf-txt">{e.equipment}</td>
                                  <td className="px-3 py-1.5 mf-txt3">{e.units}</td>
                                  <td className="px-3 py-1.5 mf-txt3">{e.hoursYear.toLocaleString('fr-CA')}</td>
                                  <td className="px-3 py-1.5 font-semibold text-sky-400">{formatDecimalGrouped(e.impliedTph, 0)} t/h</td>
                                  <td className="px-3 py-1.5">
                                    <input type="number" min="0" value={cap || ''} placeholder="—"
                                      onChange={ev => setFleetCapacity(m => ({ ...m, [e.equipment.split(' — ')[0]]: +ev.target.value || 0 }))}
                                      className="input-field text-xs w-20 py-0.5 text-right" />
                                  </td>
                                  <td className="px-3 py-1.5 font-semibold mf-txt">{cap > 0 && req ? formatDecimalGrouped(req.unitsRequired, 1) : '—'}</td>
                                  <td className={`px-3 py-1.5 font-semibold ${cap > 0 && req && req.gapUnits > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {cap > 0 && req ? (req.gapUnits > 0 ? `−${formatDecimalGrouped(req.gapUnits, 1)}` : '✓') : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(e.annualCostM, 2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
}
