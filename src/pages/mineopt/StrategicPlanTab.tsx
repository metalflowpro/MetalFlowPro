import { formatDecimalGrouped } from '../../lib/format/number';
import { Target, Gauge,
  ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { Project } from '../../types';
import { type DomainMetInputs } from '../../lib/mine/cutoff';

import { MineParamsRow } from './model';

import { type DomainCutoff } from '../../lib/mine/cutoff';
import { type ScenarioRow } from './model';
interface StrategicPlanTabProps {
  Math: Math;
  Number: NumberConstructor;
  activeTab: "Paramètres du modèle minier" | "1 · Optimisation fosse" | "2 · Conception minière" | "3 · Planification stratégique" | "4 · Planification tactique" | "5 · Planification opérationnelle" | "6 · Chaîne de valeur" | "7 · Simulation & scénarios" | "8 · Suivi & réconciliation";
  avgAisc: number;
  blendedBreakevenCutoff: number | null;
  blendedBwi: number | null;
  blendedMarginalCutoff: number | null;
  cutoffs: DomainCutoff[];
  deratedTph: number | null;
  feedFromLom: boolean;
  lom: { year: number; grade: number; ore: number; waste: number; total: number; oz_k: number; contained_oz_k: number; net_oz_k: number; rev_m: number; cost_m: number; ebitda_m: number; fcf_m: number; aisc: number; rs: number; }[];
  maxOz: number;
  maxRev: number;
  metDomains: DomainMetInputs[];
  p: MineParamsRow | null;
  peakOz: number;
  project: Project & { lom_years?: number; };
  scenarios: ScenarioRow[];
  selectedScenario: string;
  totalFcf: number;
  totalRev: number;
}

export function StrategicPlanTab({ Math, Number, activeTab, avgAisc, blendedBreakevenCutoff, blendedBwi, blendedMarginalCutoff, cutoffs, deratedTph, feedFromLom, lom, maxOz, maxRev, metDomains, p, peakOz, project, scenarios, selectedScenario, totalFcf, totalRev }: StrategicPlanTabProps) {
  return (
    <>
      {activeTab === '3 · Planification stratégique' && (
          <div className="space-y-5">
            {/* ── Cut-off géométallurgique ───────────────────────────────────
                Conventional planners apply ONE recovery and ONE cost to every
                block. Recovery and grinding energy are properties of the ore. */}
            {cutoffs.length > 0 && (
              <div className="card-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Target size={12} className="text-violet-400" />
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Teneur de coupure géométallurgique</div>
                </div>
                <div className="text-[10px] mf-txt4 mb-3">
                  Chaque domaine porte sa propre coupure, calculée sur <strong className="mf-txt3">sa</strong> récupération et
                  <strong className="mf-txt3"> son</strong> énergie de broyage — un sulfure dur qui récupère moins doit porter plus d'or
                  pour se payer qu'un oxyde tendre. Une coupure unique envoie du sulfure sous-marginal au moulin et de l'oxyde payant au stérile.
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Domaine', 'Récup.', 'BWi', 'Énergie', 'Coût procédé', '% alim.', 'Coupure marginale', 'Coupure équilibre'].map(h => (
                          <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cutoffs.map(c => (
                        <tr key={c.canon} className="border-b border-white/5">
                          <td className="px-3 py-1.5 font-semibold mf-txt">{c.label}</td>
                          <td className="px-3 py-1.5 text-emerald-400">{formatDecimalGrouped(c.recoveryPct, 1)} %</td>
                          <td className="px-3 py-1.5 text-sky-400">{formatDecimalGrouped(c.bwiKwhT, 1)}</td>
                          <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(c.grindEnergyKwhT, 1)} kWh/t</td>
                          <td className="px-3 py-1.5 mf-txt3">${formatDecimalGrouped(c.processCostUsdT, 2)}/t</td>
                          <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((c.feedShare * 100), 0)} %</td>
                          <td className="px-3 py-1.5 font-bold text-amber-400">
                            {Number.isFinite(c.marginalCutoffGt) ? `${formatDecimalGrouped(c.marginalCutoffGt, 2)} g/t` : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-bold text-violet-300">
                            {Number.isFinite(c.breakevenCutoffGt) ? `${formatDecimalGrouped(c.breakevenCutoffGt, 2)} g/t` : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-white/4">
                        <td className="px-3 py-1.5 font-bold mf-txt">Blend ({feedFromLom ? 'répartition LOM' : 'parts égales'})</td>
                        <td className="px-3 py-1.5" colSpan={5} />
                        <td className="px-3 py-1.5 font-bold text-amber-400">{blendedMarginalCutoff?.toFixed(2) ?? '—'} g/t</td>
                        <td className="px-3 py-1.5 font-bold text-violet-300">{blendedBreakevenCutoff?.toFixed(2) ?? '—'} g/t</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {p?.cutoff_g_t != null && blendedBreakevenCutoff != null && (() => {
                  const drift = Math.abs(p.cutoff_g_t - blendedBreakevenCutoff) > 0.1;
                  return (
                    <div className={`text-[10px] mt-2 ${drift ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {drift ? '⚠' : '✓'} Coupure saisie {formatDecimalGrouped(p.cutoff_g_t, 2)} g/t vs. coupure
                      d'équilibre calculée {formatDecimalGrouped(blendedBreakevenCutoff, 2)} g/t.
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Débit dérasé par la dureté ─────────────────────────────── */}
            {deratedTph != null && blendedBwi != null && (
              <div className="card-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge size={12} className="text-amber-400" />
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Débit limité par la puissance (mine-to-mill)</div>
                </div>
                <div className="text-[10px] mf-txt4 mb-3">
                  Un circuit de broyage est limité par sa puissance installée, pas par le tonnage : à kW constants,
                  un minerai plus dur passe moins vite. Les planificateurs conventionnels tiennent le débit nominal
                  sur toute la vie de mine, ce qui surestime la production des années riches en sulfure.
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Débit nominal', val: `${formatDecimalGrouped(project.target_tph, 0)} t/h`, color: 'mf-txt3' },
                    { label: 'BWi du blend', val: `${formatDecimalGrouped(blendedBwi, 2)} kWh/t`, color: 'text-sky-400' },
                    { label: 'Débit réalisable', val: `${formatDecimalGrouped(deratedTph, 0)} t/h`, color: deratedTph < project.target_tph ? 'text-amber-400' : 'text-emerald-400' },
                    {
                      label: 'Écart vs nominal',
                      val: `${formatDecimalGrouped((((deratedTph - project.target_tph) / project.target_tph) * 100), 1)} %`,
                      color: deratedTph < project.target_tph ? 'text-red-400' : 'text-emerald-400',
                    },
                  ].map(k => (
                    <div key={k.label}>
                      <div className="text-[10px] mf-txt4">{k.label}</div>
                      <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] mf-txt4 mt-2">
                  Référence de dureté : le domaine le plus tendre ({formatDecimalGrouped(Math.min(...metDomains.map(d => d.bwiKwhT)), 1)} kWh/t),
                  auquel le débit nominal est réputé atteint. Le plan LOM ci-dessous utilise le débit réalisable.
                </div>
              </div>
            )}

            {/* Production profile + FCF sparklines */}
            <div className="grid grid-cols-3 gap-4">
              {/* Production chart */}
              <div className="col-span-2 card-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-semibold text-mf-txt">Production & Revenus — {lom.length} ans LOM</div>
                    <div className="text-xs text-mf-txt4">koz Au / an · Revenus nets M$ / an</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-mf-txt4">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" />koz Au</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-500/50 inline-block" />Rev. M$</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/50 inline-block" />FCF M$</span>
                  </div>
                </div>
                <svg viewBox={`0 0 640 180`} className="w-full">
                  {/* grid */}
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={40} y1={10 + f * 150} x2={630} y2={10 + f * 150} stroke="#ffffff08" strokeWidth={1} />
                  ))}
                  {lom.map((y, i) => {
                    const bw = 590 / lom.length;
                    const x = 40 + i * bw + bw * 0.1;
                    const bwInner = bw * 0.8;
                    const ozH = (y.oz_k / maxOz) * 130;
                    const revH = (y.rev_m / maxRev) * 130;
                    const fcfH = Math.abs(y.fcf_m) / maxRev * 130;
                    return (
                      <g key={i}>
                        <rect x={x + bwInner * 0.35} y={10 + 130 - revH} width={bwInner * 0.3} height={revH} rx={1} fill="#0ea5e988" />
                        <rect x={x + bwInner * 0.05} y={10 + 130 - ozH} width={bwInner * 0.28} height={ozH} rx={1} fill="#f59e0b" opacity={0.9} />
                        <rect x={x + bwInner * 0.67} y={y.fcf_m >= 0 ? 10 + 130 - fcfH : 10 + 130} width={bwInner * 0.28} height={fcfH} rx={1} fill={y.fcf_m >= 0 ? '#10b98166' : '#f0696a88'} />
                        <text x={x + bwInner / 2} y={175} fill="#6B7280" fontSize={8} textAnchor="middle">{y.year}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Summary metrics */}
              <div className="space-y-3">
                {[
                  { label: 'Production pic', val: `${formatDecimalGrouped(peakOz, 1)} koz/an`, trend: '+', color: 'text-amber-400' },
                  { label: 'AISC moyen LOM', val: `$${formatDecimalGrouped(avgAisc, 0)}/oz`, trend: avgAisc < project.gold_price_usd * 0.6 ? '+' : '-', color: avgAisc < project.gold_price_usd * 0.6 ? 'text-emerald-400' : 'text-amber-400' },
                  { label: 'Marge EBITDA', val: `${totalRev > 0 ? formatDecimalGrouped(((lom.reduce((s, y) => s + y.ebitda_m, 0) / totalRev) * 100), 0) : '—'}%`, trend: '+', color: 'text-sky-400' },
                  { label: 'FCF cumulé', val: `${formatDecimalGrouped(totalFcf, 0)} M$`, trend: totalFcf > 0 ? '+' : '-', color: totalFcf > 0 ? 'text-emerald-400' : 'text-red-400' },
                ].map(m => (
                  <div key={m.label} className="card-sm flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-mf-txt4">{m.label}</div>
                      <div className={`text-lg font-bold font-mono ${m.color}`}>{m.val}</div>
                    </div>
                    {m.trend === '+' ? <ArrowUpRight size={18} className="text-emerald-500/60" /> : <ArrowDownRight size={18} className="text-red-400/60" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Scenario comparison quick view */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Comparaison rapide — 5 scénarios</div>
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['Scénario', 'Réserves', 'LOM', 'VAN₁₀', 'TRI', 'AISC', 'Retour', 'Rec.'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-mf-txt3 font-semibold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map(sc => (
                      <tr key={sc.id} className={`border-b border-white/5 hover:bg-white/4 ${sc.id === selectedScenario ? 'bg-amber-400/5' : ''}`}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: sc.color }} />
                            <span className="font-medium text-mf-txt">{sc.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-amber-300 font-mono">{formatDecimalGrouped(sc.reserves_mt, 1)} Mt</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{sc.lom_years} ans</td>
                        <td className="px-3 py-1.5 font-semibold font-mono" style={{ color: sc.npv_musd >= 0 ? '#10B981' : '#F06B6B' }}>{formatDecimalGrouped(sc.npv_musd, 0)} M$</td>
                        <td className="px-3 py-1.5 text-sky-400">{sc.irr_pct != null ? `${formatDecimalGrouped(sc.irr_pct, 1)}%` : "—"}</td>
                        <td className="px-3 py-1.5 text-purple-400">${formatDecimalGrouped(sc.aisc, 0)}</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{formatDecimalGrouped(sc.payback_years, 1)} ans</td>
                        <td className="px-3 py-1.5">{sc.recommended && <span className="text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/25 px-1.5 py-0.5 rounded">★ Recommandé</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      {activeTab === '3 · Planification stratégique' && (
          <div className="space-y-5">
            {/* LOM Table */}
            <div className="overflow-x-auto">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    {['An', 'Minerai (Mt)', 'Stérile (Mt)', 'RS', 'Teneur (g/t)', 'Oz brut (koz)', 'Oz net (koz)', 'Rev. net (M$)', 'Coûts (M$)', 'EBITDA (M$)', 'FCF (M$)', 'AISC ($/oz)'].map(h => (
                      <th key={h} className="text-right px-2 py-2 text-mf-txt3 font-semibold text-[10px] first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lom.map((y, i) => (
                    <tr key={i} className={`border-b border-white/5 hover:bg-white/4 ${i === 0 ? 'bg-amber-400/4' : ''}`}>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-mf-txt3">An {y.year}</td>
                      <td className="px-2 py-1.5 text-right">{formatDecimalGrouped(y.ore, 2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{formatDecimalGrouped(y.waste, 2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{y.rs}</td>
                      <td className="px-2 py-1.5 text-right text-amber-400 font-semibold">{formatDecimalGrouped(y.grade, 3)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-300">{y.oz_k}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-400 font-semibold">{y.net_oz_k}</td>
                      <td className="px-2 py-1.5 text-right">{y.rev_m}</td>
                      <td className="px-2 py-1.5 text-right text-orange-400">{y.cost_m}</td>
                      <td className="px-2 py-1.5 text-right font-semibold" style={{ color: y.ebitda_m >= 0 ? '#10B981' : '#F06B6B' }}>{y.ebitda_m}</td>
                      <td className="px-2 py-1.5 text-right font-bold" style={{ color: y.fcf_m >= 0 ? '#10B981' : '#F06B6B' }}>{y.fcf_m}</td>
                      <td className="px-2 py-1.5 text-right text-purple-400">{y.aisc}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-white/10 font-bold text-amber-400 bg-amber-400/4">
                    <td className="px-2 py-2">TOTAL</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.ore, 0), 2)}</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.waste, 0), 2)}</td>
                    <td colSpan={2} className="px-2 py-2 text-right text-mf-txt4">—</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.oz_k, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.net_oz_k, 0), 1)}</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(totalRev, 1)}</td>
                    <td className="px-2 py-2 text-right text-orange-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.cost_m, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.ebitda_m, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(totalFcf, 1)}</td>
                    <td className="px-2 py-2 text-right text-mf-txt4">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
    </>
  );
}
