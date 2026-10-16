import { formatDecimalGrouped } from '../../lib/format/number';
import { RefreshCw, AlertCircle,
} from 'lucide-react';
import type { Project } from '../../types';
import { DEFAULT_ASSUMPTIONS } from '../../lib/config/constants';
import { REFERENCE_P80_UM, domainRecoveryAtP80, plantGrindEnergy } from '../../lib/geomet/p80';
import { RecoveryRegressionPanel } from '../../components/geomet/RecoveryRegressionPanel';



import { GeometDomain, METAL_VIEWS, MetalView, TROY, Tab } from './model';

interface MetallurgyTabProps {
  P80_RANGE: number[];
  curveP80: number;
  dcF80: number;
  domains: GeometDomain[];
  hoursPerYear: number;
  mcP10: number | null;
  mcP50: number | null;
  mcP90: number | null;
  mcRunning: boolean;
  metalView: MetalView;
  monteCarlo: { oz: number; rec: number; }[];
  predAnnualOz: number;
  predBwi: number;
  predEnergy: number;
  predGrade: number;
  predP80: number;
  predRec: number;
  predTph: number;
  project: Project;
  runMonteCarlo: () => void;
  selectedDomainId: string | null;
  setCurveP80: React.Dispatch<React.SetStateAction<number>>;
  setMetalView: React.Dispatch<React.SetStateAction<MetalView>>;
  setPredGrade: React.Dispatch<React.SetStateAction<number>>;
  setPredP80: React.Dispatch<React.SetStateAction<number>>;
  setPredTph: React.Dispatch<React.SetStateAction<number>>;
  setSelectedDomainId: React.Dispatch<React.SetStateAction<string | null>>;
  setVarP80: React.Dispatch<React.SetStateAction<number>>;
  tab: Tab;
  varP80: number;
}

export function MetallurgyTab({ P80_RANGE, curveP80, dcF80, domains, hoursPerYear, mcP10, mcP50, mcP90, mcRunning, metalView, monteCarlo, predAnnualOz, predBwi, predEnergy, predGrade, predP80, predRec, predTph, project, runMonteCarlo, selectedDomainId, setCurveP80, setMetalView, setPredGrade, setPredP80, setPredTph, setSelectedDomainId, setVarP80, tab, varP80 }: MetallurgyTabProps) {
  return (
    <>
      {tab === 'metallurgie' && (
          <div className="inline-flex items-center gap-1 mb-4 p-0.5 rounded-lg bg-white/[0.03] border mf-border">
            {METAL_VIEWS.map(v => (
              <button
                key={v.id} onClick={() => setMetalView(v.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap ${
                  metalView === v.id ? 'bg-emerald-400/15 text-emerald-300' : 'mf-txt3 hover:mf-txt'
                }`}
              >
                {v.icon}{v.label}
              </button>
            ))}
          </div>
        )}
      {tab === 'metallurgie' && metalView === 'curves' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines pour visualiser les courbes</div>
            ) : (
              <>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-xs mf-txt3 font-semibold">Paramètre variable: P80 broyage</div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="38" max="150" step="1" value={curveP80} onChange={e => setCurveP80(parseInt(e.target.value))} className="accent-emerald-400 w-32" />
                    <span className="text-xs text-emerald-400 font-bold w-16">{curveP80} µm</span>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Récupération prédite à P80 = {curveP80} µm</div>
                  <div className="space-y-2">
                    {domains.map(d => {
                      const rec = domainRecoveryAtP80(d.recovery_design ?? project.recovery_pct, curveP80);
                      const recMin = d.recovery_min != null ? domainRecoveryAtP80(d.recovery_min, curveP80) : null;
                      const recMax = d.recovery_max != null ? domainRecoveryAtP80(d.recovery_max, curveP80) : null;
                      return (
                        <div key={d.id} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                          <div className="w-28 text-xs mf-txt truncate">{d.name}</div>
                          <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                            {recMin != null && recMax != null && (
                              <div className="absolute h-full opacity-20 rounded-full"
                                style={{ left: `${recMin}%`, width: `${recMax - recMin}%`, backgroundColor: d.color ?? '#10B981' }} />
                            )}
                            <div className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${rec}%`, backgroundColor: (d.color ?? '#10B981') + 'AA' }} />
                          </div>
                          <div className="w-20 text-xs font-bold text-right" style={{ color: d.color ?? '#9CA3AF' }}>
                            {formatDecimalGrouped(rec, 2)}%
                            {recMin != null && recMax != null && (
                              <div className="text-[9px] mf-txt4">{formatDecimalGrouped(recMin, 1)}–{formatDecimalGrouped(recMax, 1)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left px-3 py-2 mf-txt3 font-semibold">P80 (µm)</th>
                        {domains.map(d => (
                          <th key={d.id} className="text-right px-3 py-2 font-semibold" style={{ color: d.color ?? '#9CA3AF' }}>{d.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {P80_RANGE.map(p => (
                        <tr key={p} className={`border-b border-white/5 hover:bg-white/4 ${p === REFERENCE_P80_UM ? 'bg-amber-400/4' : ''}`}>
                          {/* This row is the REFERENCE grind the domain recoveries were
                              measured at — not an optimum. It used to be starred as if it
                              were, while Granulométrie computed a different optimal P80
                              economically. */}
                          <td className={`px-3 py-1.5 font-mono text-xs ${p === REFERENCE_P80_UM ? 'text-amber-400 font-bold' : 'mf-txt3'}`}>
                            {p}{p === REFERENCE_P80_UM ? ' ◆' : ''}
                          </td>
                          {domains.map(d => {
                            const base = d.recovery_design ?? project.recovery_pct;
                            const rec = domainRecoveryAtP80(base, p);
                            const delta = rec - base;
                            return (
                              <td key={d.id} className="px-3 py-1.5 text-right">
                                <span className={`font-semibold ${delta > 1 ? 'text-emerald-400' : delta < -1 ? 'text-red-400' : 'mf-txt'}`}>{formatDecimalGrouped(rec, 2)}%</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs mf-txt4 flex items-start gap-1.5">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" />
                  <span>
                    ◆ <strong>Référence</strong> P80 = {REFERENCE_P80_UM} µm (CIL standard) : le grind auquel les
                    récupérations par domaine sont mesurées, pivot de la correction empirique ±0,07 %/µm.
                    <strong> Ce n'est pas le P80 optimal</strong> — celui-ci est calculé économiquement (revenu or −
                    coût énergie) dans <em>Granulométrie / PSD → P80 Optimisation</em>, et peut différer de 75 µm.
                    Bandes min/max affichées si renseignées.
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      {tab === 'metallurgie' && metalView === 'variability' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines pour l'analyse de variabilité</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 card-sm space-y-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Plage de variabilité par domaine</div>
                    {domains.map(d => {
                      const recBase = d.recovery_design ?? project.recovery_pct;
                      const bwiBase = d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T;
                      const recMin = d.recovery_min ?? recBase - 3;
                      const recMax = d.recovery_max ?? recBase + 3;
                      const bwiMin = d.bwi_min ?? bwiBase - 2;
                      const bwiMax = d.bwi_max ?? bwiBase + 2;
                      return (
                        <div key={d.id} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <span className="text-xs font-semibold mf-txt">{d.name}</span>
                            {d.preg_robbing && <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5">PREG-ROBBING</span>}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                                <span>Récupération (%)</span>
                                <span style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(recMin, 1)} – {formatDecimalGrouped(recMax, 1)}%</span>
                              </div>
                              <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
                                <div className="absolute h-full rounded-full opacity-30"
                                  style={{ left: `${recMin}%`, width: `${recMax - recMin}%`, backgroundColor: d.color ?? '#10B981' }} />
                                <div className="absolute h-full w-0.5 bg-white/60"
                                  style={{ left: `${recBase}%` }} />
                              </div>
                              <div className="flex justify-between text-[9px] mf-txt4 mt-0.5">
                                <span>P10: {formatDecimalGrouped(recMin, 1)}%</span>
                                <span className="font-bold" style={{ color: d.color ?? '#9CA3AF' }}>Design: {formatDecimalGrouped(recBase, 1)}%</span>
                                <span>P90: {formatDecimalGrouped(recMax, 1)}%</span>
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                                <span>BWi (kWh/t)</span>
                                <span className="text-sky-400">{formatDecimalGrouped(bwiMin, 1)} – {formatDecimalGrouped(bwiMax, 1)}</span>
                              </div>
                              <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
                                <div className="absolute h-full rounded-full bg-sky-400/30"
                                  style={{ left: `${(bwiMin / 30) * 100}%`, width: `${((bwiMax - bwiMin) / 30) * 100}%` }} />
                                <div className="absolute h-full w-0.5 bg-sky-300/80"
                                  style={{ left: `${(bwiBase / 30) * 100}%` }} />
                              </div>
                              <div className="flex justify-between text-[9px] mf-txt4 mt-0.5">
                                <span>Min: {formatDecimalGrouped(bwiMin, 1)}</span>
                                <span className="text-sky-400 font-bold">Moy: {formatDecimalGrouped(bwiBase, 1)}</span>
                                <span>Max: {formatDecimalGrouped(bwiMax, 1)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-3">
                    <div className="card-sm space-y-3">
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Simulation Monte Carlo</div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="mf-txt3">P80 cible (µm)</span>
                        <input type="range" min="38" max="150" value={varP80} onChange={e => setVarP80(parseInt(e.target.value))} className="w-24 accent-emerald-400" />
                        <span className="text-emerald-400 font-bold w-12">{varP80}</span>
                      </div>
                      <button onClick={runMonteCarlo} disabled={mcRunning} className="btn btn-teal w-full text-xs flex items-center justify-center gap-1.5">
                        <RefreshCw size={11} className={mcRunning ? 'animate-spin' : ''} />
                        {mcRunning ? 'Simulation…' : 'Lancer 500 itérations'}
                      </button>

                      {monteCarlo.length > 0 && (
                        <div className="space-y-2">
                          {[
                            { label: 'P10 (pessimiste)', val: mcP10, color: 'text-red-400' },
                            { label: 'P50 (médiane)', val: mcP50, color: 'text-amber-400' },
                            { label: 'P90 (optimiste)', val: mcP90, color: 'text-emerald-400' },
                          ].map(s => (
                            <div key={s.label} className="flex justify-between text-xs">
                              <span className="mf-txt3">{s.label}</span>
                              <span className={`font-bold ${s.color}`}>
                                {s.val != null ? `${formatDecimalGrouped((s.val / 1000), 1)} koz/an` : '—'}
                              </span>
                            </div>
                          ))}
                          <div className="pt-2 border-t border-white/10">
                            <div className="text-[10px] mf-txt4 mb-2">Distribution onces/an (500 runs)</div>
                            <div className="flex items-end gap-px h-12">
                              {(() => {
                                const min = monteCarlo[0].oz;
                                const max = monteCarlo[monteCarlo.length - 1].oz;
                                const bins = 20;
                                const binW = (max - min) / bins;
                                const counts = Array(bins).fill(0);
                                monteCarlo.forEach(r => {
                                  const b = Math.min(bins - 1, Math.floor((r.oz - min) / binW));
                                  counts[b]++;
                                });
                                const maxCount = Math.max(...counts);
                                return counts.map((c, i) => (
                                  <div key={i} className="flex-1 rounded-t"
                                    style={{ height: `${(c / maxCount) * 100}%`, backgroundColor: '#10B981AA' }} />
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      {tab === 'metallurgie' && metalView === 'prediction' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines</div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-3">
                  <div className="card-sm space-y-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Paramètres de prédiction</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Domaine actif</label>
                        <select className="input-field w-full text-xs"
                          value={selectedDomainId ?? ''}
                          onChange={e => setSelectedDomainId(e.target.value)}>
                          {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">P80 broyage (µm)</label>
                        <div className="flex items-center gap-2">
                          <input type="range" min="38" max="150" value={predP80} onChange={e => setPredP80(parseInt(e.target.value))} className="flex-1 accent-emerald-400" />
                          <input type="number" className="input-field text-xs w-16 text-right" value={predP80} onChange={e => setPredP80(parseInt(e.target.value) || 75)} />
                        </div>
                      </div>
                      <div>
                        <label className="label">Teneur (g/t)</label>
                        <input type="number" step="0.01" className="input-field w-full text-xs" value={predGrade} onChange={e => setPredGrade(parseFloat(e.target.value) || project.gold_grade_g_t)} />
                      </div>
                      <div>
                        <label className="label">Débit (t/h)</label>
                        <input type="number" step="10" className="input-field w-full text-xs" value={predTph} onChange={e => setPredTph(parseFloat(e.target.value) || project.target_tph)} />
                      </div>
                    </div>
                  </div>

                  {/* Comparison table across all domains */}
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Comparaison tous domaines à P80 = {predP80} µm</div>
                    <table className="tbl w-full text-xs">
                      <thead>
                        <tr>
                          {['Domaine', 'Récup. (%)', 'BWi (kWh/t)', 'Énergie spéc. (kWh/t)', 'koz/an (design)', 'Notes'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map(d => {
                          const rec = domainRecoveryAtP80(d.recovery_design ?? project.recovery_pct, predP80);
                          const bwi = d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T;
                          const energy = plantGrindEnergy(bwi, dcF80, predP80);
                          const h = (project.availability_pct / 100) * hoursPerYear;
                          const oz = predTph * h * predGrade * (rec / 100) / TROY;
                          const isActive = d.id === selectedDomainId;
                          return (
                            <tr key={d.id} onClick={() => setSelectedDomainId(d.id)}
                              className={`border-b border-white/5 cursor-pointer transition-colors ${isActive ? 'bg-emerald-400/8' : 'hover:bg-white/4'}`}>
                              <td className="px-3 py-2 flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                                <span className="font-semibold mf-txt">{d.name}</span>
                              </td>
                              <td className="px-3 py-2 font-bold" style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(rec, 2)}%</td>
                              <td className="px-3 py-2 text-sky-400">{formatDecimalGrouped(bwi, 1)}</td>
                              <td className="px-3 py-2 text-amber-300">{energy > 0 ? formatDecimalGrouped(energy, 1) : '—'}</td>
                              <td className="px-3 py-2 text-emerald-400 font-bold">{formatDecimalGrouped((oz / 1000), 1)}</td>
                              <td className="px-3 py-2 text-[10px] mf-txt4">
                                {d.preg_robbing ? '⚠ Preg-robbing' : d.clay_pct != null && d.clay_pct > 5 ? '⚠ Argile élevée' : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Real fitted regression model (ML) with prediction intervals. */}
                  <RecoveryRegressionPanel domains={domains} selectedDomainId={selectedDomainId} />
                </div>

                {/* Right — metrics for selected domain */}
                <div className="space-y-3">
                  {(() => {
                    const d = domains.find(dd => dd.id === selectedDomainId) ?? domains[0];
                    if (!d) return null;
                    return (
                      <>
                        <div className="card-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="text-xs font-semibold mf-txt">{d.name}</div>
                          </div>
                          {[
                            { label: 'Récupération prédite', val: `${formatDecimalGrouped(predRec, 2)}%`, color: 'text-emerald-400' },
                            { label: 'BWi moyen', val: predBwi > 0 ? `${formatDecimalGrouped(predBwi, 1)} kWh/t` : '—', color: 'text-sky-400' },
                            { label: 'Énergie spécifique', val: predEnergy > 0 ? `${formatDecimalGrouped(predEnergy, 1)} kWh/t` : '—', color: 'text-amber-400' },
                            { label: 'Production annuelle', val: `${formatDecimalGrouped((predAnnualOz / 1000), 1)} koz/an`, color: 'text-amber-400 font-bold' },
                          ].map(f => (
                            <div key={f.label} className="flex justify-between text-xs mb-2">
                              <span className="mf-txt3">{f.label}</span>
                              <span className={`font-semibold ${f.color}`}>{f.val}</span>
                            </div>
                          ))}
                        </div>

                        {d.preg_robbing && (
                          <div className="card-sm bg-red-400/5 border border-red-400/20 text-xs text-red-300 flex items-start gap-2">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span>Preg-robbing confirmé. Utiliser CIL avec lavages additionnels ou prétaitement carbone.</span>
                          </div>
                        )}

                        {(d.clay_pct ?? 0) > 5 && (
                          <div className="card-sm bg-orange-400/5 border border-orange-400/20 text-xs text-orange-300 flex items-start gap-2">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span>Teneur argile {d.clay_pct?.toFixed(1)}% — risque colmatage, ajuster disponibilité et conso. floculant.</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
