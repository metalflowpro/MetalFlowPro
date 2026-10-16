import { formatDecimalGrouped } from '../../lib/format/number';


import { type ResolvedMineParams } from '../../lib/mine/params';

import { MineParamsRow } from './model';

import { type ScenarioRow } from './model';
interface ValueChainTabProps {
  Math: Math;
  chosen: ScenarioRow;
  mine: ResolvedMineParams;
  params: MineParamsRow;
  scenarios: ScenarioRow[];
  selectedScenario: string;
  setSelectedScenario: React.Dispatch<React.SetStateAction<string>>;
}

export function ValueChainTab({ Math, chosen, mine, params, scenarios, selectedScenario, setSelectedScenario }: ValueChainTabProps) {
  return (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {scenarios.map(sc => (
                <div
                  key={sc.id}
                  onClick={() => setSelectedScenario(sc.id)}
                  className={`card-sm cursor-pointer transition-all border-2 ${selectedScenario === sc.id ? 'border-amber-500/50 bg-amber-400/5' : 'border-transparent hover:border-white/10'}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-2">
                      <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: sc.color }} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-mf-txt text-sm">{sc.name}</span>
                          {sc.recommended && <span className="text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/25 px-1.5 py-0.5 rounded">★</span>}
                        </div>
                        <div className="text-xs text-mf-txt4 mt-0.5">{sc.description}</div>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedScenario === sc.id ? 'border-amber-500 bg-amber-500' : 'border-white/20'}`}>
                      {selectedScenario === sc.id && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'VAN₁₀', val: `${formatDecimalGrouped(sc.npv_musd, 0)} M$`, color: sc.npv_musd >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'TRI', val: sc.irr_pct != null ? `${formatDecimalGrouped(sc.irr_pct, 1)}%` : '—', color: 'text-sky-400' },
                      { label: 'Retour', val: `${formatDecimalGrouped(sc.payback_years, 1)} ans`, color: 'text-amber-400' },
                      { label: 'AISC', val: `$${formatDecimalGrouped(sc.aisc, 0)}/oz`, color: 'text-purple-400' },
                    ].map(kpi => (
                      <div key={kpi.label} className="bg-white/5 rounded-lg p-2 text-center">
                        <div className={`text-sm font-bold font-mono ${kpi.color}`}>{kpi.val}</div>
                        <div className="text-[10px] text-mf-txt4">{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex gap-4 text-xs text-mf-txt4 flex-wrap">
                    <span>RS: {formatDecimalGrouped(sc.stripping_ratio, 1)}:1</span>
                    <span>Talus: {sc.slope_angle_deg}°</span>
                    <span>LOM: {sc.lom_years} ans</span>
                    <span>Réserves: {formatDecimalGrouped(sc.reserves_mt, 1)} Mt</span>
                    <span>CAPEX: {formatDecimalGrouped(sc.capex_m, 0)} M$</span>
                    <span>Oz/an: {formatDecimalGrouped((sc.annual_oz / 1000), 0)} koz</span>
                  </div>
                </div>
              ))}
            </div>

            {/* VAN waterfall */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Décomposition VAN — Base Case</div>
              {chosen && (() => {
                const capexM = chosen.capex_m;
                const annualOz = chosen.annual_oz;
                const grossRevM = (annualOz * mine.goldPriceUsdOz.value / 1e6) * chosen.lom_years;
                const royaltiesM = grossRevM * mine.royaltyPct.value / 100;
                const opexM = (mine.processCostUsdT.value * params.reserves_mt * 1e6 / 1e6);
                const mineM = (params.mining_cost_t * params.reserves_mt * (1 + params.stripping_ratio) * 1e6 / 1e6);
                const bars = [
                  { label: 'Rev. bruts', val: grossRevM, color: '#10B981', positive: true },
                  { label: 'Redevances', val: -royaltiesM, color: '#F06B6B', positive: false },
                  { label: 'Opex traitement', val: -opexM, color: '#F59E0B', positive: false },
                  { label: 'Coûts miniers', val: -mineM, color: '#F59E0B', positive: false },
                  { label: 'G&A total', val: -(params.ga_cost_m * chosen.lom_years), color: '#8B5CF6', positive: false },
                  { label: 'Pompage', val: -(params.pump_cost_m * chosen.lom_years), color: '#8B5CF6', positive: false },
                  { label: 'CAPEX initial', val: -capexM, color: '#F06B6B', positive: false },
                  { label: 'VAN₁₀', val: chosen.npv_musd, color: chosen.npv_musd >= 0 ? '#10B981' : '#F06B6B', positive: chosen.npv_musd >= 0 },
                ];
                const maxAbs = Math.max(...bars.map(b => Math.abs(b.val)), 1);
                return (
                  <div className="space-y-2">
                    {bars.map(b => (
                      <div key={b.label} className="flex items-center gap-3 text-xs">
                        <div className="w-28 text-mf-txt3 text-right shrink-0">{b.label}</div>
                        <div className="flex-1 relative h-5">
                          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                          <div
                            className="absolute top-0.5 h-4 rounded"
                            style={{
                              [b.positive ? 'left' : 'right']: '50%',
                              width: `${(Math.abs(b.val) / maxAbs) * 48}%`,
                              background: b.color,
                              opacity: 0.75,
                            }}
                          />
                        </div>
                        <div className="w-24 font-mono font-semibold shrink-0 text-right" style={{ color: b.color }}>
                          {b.positive ? '+' : ''}{formatDecimalGrouped(b.val, 0)} M$
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        );
}
