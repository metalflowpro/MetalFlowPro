import { formatDecimalGrouped } from '../../lib/format/number';
import {
  CheckCircle2, AlertTriangle, Activity,
} from 'lucide-react';
import type { Project } from '../../types';
import { type ResolvedMineParams } from '../../lib/mine/params';
import { reconVerdict,
} from '../../lib/mine/planning';
import { MineParamsRow, MinePhaseRow } from './model';

import { type ScenarioRow } from './model';
import { type ReconciliationResult } from '../../lib/mine/planning';
interface ReconciliationTabProps {
  Number: NumberConstructor;
  activeTab: "Paramètres du modèle minier" | "1 · Optimisation fosse" | "2 · Conception minière" | "3 · Planification stratégique" | "4 · Planification tactique" | "5 · Planification opérationnelle" | "6 · Chaîne de valeur" | "7 · Simulation & scénarios" | "8 · Suivi & réconciliation";
  actuals: { mineTonnes: number; mineGrade: number; plantTonnes: number; plantGrade: number; };
  benchmarks: { aiscUsdOz: number; hurdlePct: number; strippingRatio: number; };
  chosen: ScenarioRow;
  hasActuals: boolean;
  mine: ResolvedMineParams;
  params: MineParamsRow;
  phases: MinePhaseRow[];
  planYear: { year: number; grade: number; ore: number; waste: number; total: number; oz_k: number; contained_oz_k: number; net_oz_k: number; rev_m: number; cost_m: number; ebitda_m: number; fcf_m: number; aisc: number; rs: number; };
  project: Project & { lom_years?: number; };
  reconciliation: ReconciliationResult | null;
  reservesOrigin: "saisie manuelle" | "fosse optimisée (étape 1)" | "saisie manuelle ≠ fosse optimisée";
  setActuals: React.Dispatch<React.SetStateAction<{ mineTonnes: number; mineGrade: number; plantTonnes: number; plantGrade: number; }>>;
  totalOz: number;
  totalRev: number;
}

export function ReconciliationTab({ Number, activeTab, actuals, benchmarks, chosen, hasActuals, mine, params, phases, planYear, project, reconciliation, reservesOrigin, setActuals, totalOz, totalRev }: ReconciliationTabProps) {
  return (
    <>
      {activeTab === '8 · Suivi & réconciliation' && (
          <div className="space-y-4">
            <div className="card-sm">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={12} className="text-violet-400" />
                <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Réconciliation Mine — Modèle — Usine (F1 / F2 / F3)</div>
              </div>
              <div className="text-[10px] mf-txt4 mb-3">
                Le standard de l'industrie pour savoir si le modèle de ressources dit la vérité.
                <strong className="mf-txt3"> F1 = Mine ÷ Modèle</strong> : le modèle prédit-il ce qu'on extrait ?
                <strong className="mf-txt3"> F2 = Usine ÷ Mine</strong> : la mine livre-t-elle ce qu'elle annonce ?
                <strong className="mf-txt3"> F3 = F1 × F2</strong> : le facteur de bout en bout. Un F3 à 1,15 sur les onces
                signifie un modèle systématiquement optimiste — et tout plan bâti dessus hérite du biais.
              </div>

              <div className="p-2.5 rounded-md bg-sky-400/8 border border-sky-400/20 text-[10px] text-sky-300 mb-3 flex items-start gap-2">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>
                  Aucune table de production réelle n'existe dans la base : les valeurs mesurées sont saisies ici et
                  ne sont pas persistées. Une table <code>mine_production_actuals</code> (tonnes/teneur par période,
                  à la mine et à l'usine) rendrait ce suivi durable et automatisable.
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-[10px] font-semibold mf-txt3 uppercase mb-1.5">Modèle (plan an {planYear?.year ?? '—'})</div>
                  <div className="text-xs mf-txt4">Tonnes : <strong className="mf-txt">{planYear ? (planYear.ore * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 }) : '—'}</strong></div>
                  <div className="text-xs mf-txt4">Teneur : <strong className="mf-txt">{planYear ? formatDecimalGrouped(planYear.grade, 2) : '—'} g/t</strong></div>
                  <div className="text-[9px] mf-txt4 mt-1">↓ Importé du plan stratégique</div>
                </div>
                {([
                  ['Mine (réel)', 'mineTonnes', 'mineGrade'],
                  ['Usine (réel)', 'plantTonnes', 'plantGrade'],
                ] as const).map(([label, tKey, gKey]) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold mf-txt3 uppercase mb-1.5">{label}</div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] mf-txt4 w-12">Tonnes</span>
                      <input type="number" min="0" value={actuals[tKey] || ''} placeholder="—"
                        onChange={e => setActuals(a => ({ ...a, [tKey]: +e.target.value || 0 }))}
                        className="input-field text-xs w-28 py-0.5 text-right" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] mf-txt4 w-12">Teneur</span>
                      <input type="number" step="0.01" min="0" value={actuals[gKey] || ''} placeholder="—"
                        onChange={e => setActuals(a => ({ ...a, [gKey]: +e.target.value || 0 }))}
                        className="input-field text-xs w-28 py-0.5 text-right" />
                    </div>
                  </div>
                ))}
              </div>

              {!hasActuals ? (
                <div className="text-[10px] mf-txt4 py-2">Saisissez les tonnes et teneurs réelles pour calculer les facteurs.</div>
              ) : reconciliation && (
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead><tr>{['Facteur', 'Tonnes', 'Teneur', 'Onces', 'Verdict'].map(h => (
                      <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                    <tbody>
                      {([
                        ['F1 — Mine ÷ Modèle', reconciliation.f1Tonnes, reconciliation.f1Grade, reconciliation.f1Ounces],
                        ['F2 — Usine ÷ Mine', reconciliation.f2Tonnes, reconciliation.f2Grade, reconciliation.f2Ounces],
                        ['F3 — Usine ÷ Modèle', reconciliation.f3Tonnes, reconciliation.f3Grade, reconciliation.f3Ounces],
                      ] as [string, number | null, number | null, number | null][]).map(([label, t, g, o]) => {
                        const v = reconVerdict(o);
                        const cls = v === 'ok' ? 'text-emerald-400' : v === 'warn' ? 'text-amber-400' : v === 'bad' ? 'text-red-400' : 'mf-txt4';
                        const fmt = (x: number | null) => (x != null && Number.isFinite(x) ? formatDecimalGrouped(x, 3) : '—');
                        return (
                          <tr key={label} className="border-b border-white/5">
                            <td className="px-3 py-1.5 font-semibold mf-txt">{label}</td>
                            <td className="px-3 py-1.5 mf-txt3">{fmt(t)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{fmt(g)}</td>
                            <td className={`px-3 py-1.5 font-bold ${cls}`}>{fmt(o)}</td>
                            <td className={`px-3 py-1.5 ${cls}`}>
                              {v === 'ok' ? '✓ Dans la tolérance ±5 %' : v === 'warn' ? '⚠ Écart 5–10 %' : v === 'bad' ? '✗ Écart > 10 %' : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {reconVerdict(reconciliation.f1Grade) === 'bad' && (
                    <div className="text-[10px] text-red-300 mt-2">
                      La teneur extraite s'écarte de plus de 10 % du modèle — vérifier la dilution, le contrôle de teneur
                      et l'estimation avant de rebâtir un plan sur ce modèle.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      {activeTab === '8 · Suivi & réconciliation' && chosen && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              {/* Recommendation */}
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Recommandation — Plan minier retenu</div>
                <div className="p-4 rounded-lg bg-amber-400/8 border border-amber-400/20 mb-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-mf-txt mb-1">Scénario Base Case — Recommandé</div>
                      <div className="text-xs text-mf-txt3 leading-relaxed">
                        Le scénario Base Case présente le meilleur équilibre VAN/risque. Le pit shell optimisé à ${project.gold_price_usd}/oz
                        avec un talus de {params.slope_angle_deg}° offre {params.reserves_mt} Mt à {formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t Au ({reservesOrigin}).
                        La production annuelle de ~{formatDecimalGrouped((chosen.annual_oz / 1000), 0)} koz sur {chosen.lom_years} ans génère une
                        VAN₁₀ de {formatDecimalGrouped(chosen.npv_musd, 0)} M$ avec un TRI de {chosen.irr_pct != null ? `${formatDecimalGrouped(chosen.irr_pct, 1)}%` : '—'}.
                        L'AISC de ${formatDecimalGrouped(chosen.aisc, 0)}/oz offre une marge opérationnelle robuste face aux cycles du prix de l'or.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Évaluation par domaine</div>
                <div className="space-y-2">
                  {[
                    { label: "Plan d'exploitation",  status: 'ok',   text: `${params.method} · ${chosen.lom_years} ans · ${phases.length > 0 ? `${phases.length} phases séquentielles` : 'phases à définir'}` },
                    { label: 'Géotechnique',          status: 'ok',   text: `Angle global ${params.slope_angle_deg}° · IFS 1.35 statique · Fond fosse –340 m` },
                    { label: 'Hydrogéologie',         status: 'warn', text: 'Déwatering à dimensionner phase 2 — débit estimé 420 m³/h' },
                    { label: 'Flotte minière',        status: 'ok',   text: `${params.trucks} · ${params.shovel} · ${params.drill}` },
                    { label: 'Gestion stériles',      status: 'ok',   text: 'RSF interne phase 1 · Extension externe phases 2–3 · ≥ 500m usine' },
                    { label: 'Gestion eaux & DMA',    status: 'warn', text: 'Tests NP/PA à compléter · Protocole co-disposal à finaliser' },
                    { label: 'Conformité & Permis',   status: 'ok',   text: 'ESIA phase 1 validée · PAE & RCP en cours · Consultation communautaire active' },
                    { label: 'Couverture (hedging)',  status: 'warn', text: 'Couverture 30% production recommandée pour années 1–3' },
                  ].map(pt => (
                    <div key={pt.label} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-white/8">
                      {pt.status === 'ok'
                        ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />}
                      <div>
                        <div className="text-xs font-semibold text-mf-txt">{pt.label}</div>
                        <div className="text-xs text-mf-txt4">{pt.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next steps */}
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Plan d'action — Prochaines étapes</div>
                <div className="space-y-2">
                  {[
                    { priority: '1', step: 'Études géotechniques phase 2 approfondies (forages géoméca.)', timeline: '3 mois' },
                    { priority: '2', step: 'Dimensionnement final système de déwatering + simulation 3D', timeline: '4 mois' },
                    { priority: '3', step: 'Appel d\'offres flotte minière (camions + pelles)', timeline: '6 mois' },
                    { priority: '4', step: 'Mise à jour modèle de blocs — forage infill 25m × 25m', timeline: '8 mois' },
                    { priority: '5', step: 'Validation réserves NI 43-101 / JORC par QP indépendant', timeline: '10 mois' },
                    { priority: '6', step: 'Finalisation ESIA & obtention permis d\'exploitation', timeline: '12 mois' },
                  ].map(s => (
                    <div key={s.priority} className="flex items-center gap-3 p-2.5 rounded-lg border border-white/5">
                      <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-amber-400">{s.priority}</span>
                      </div>
                      <div className="flex-1 text-xs text-mf-txt">{s.step}</div>
                      <div className="text-[10px] text-mf-txt4 shrink-0">{s.timeline}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-3">
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Indicateurs retenus</div>
                {[
                  ['Réserves',         `${params.reserves_mt} Mt @ ${formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t (${reservesOrigin})`],
                  ['Dilution minière', `${params.dilution_pct}%`],
                  ['Prod. annuelle',   `${formatDecimalGrouped((chosen.annual_oz / 1000), 0)} koz Au`],
                  ['Prod. totale LOM', `${formatDecimalGrouped(totalOz, 0)} koz Au`],
                  ['VAN₁₀',           `${formatDecimalGrouped(chosen.npv_musd, 0)} M USD`],
                  ['TRI',             chosen.irr_pct != null ? `${formatDecimalGrouped(chosen.irr_pct, 1)}%` : '—'],
                  ['Retour invest.',  `${formatDecimalGrouped(chosen.payback_years, 1)} ans`],
                  ['AISC',            `$${formatDecimalGrouped(chosen.aisc, 0)}/oz`],
                  ['LOM',             `${chosen.lom_years} ans`],
                  ['CAPEX initial',   `${formatDecimalGrouped(chosen.capex_m, 0)} M$`],
                  ['CAPEX soutien',   `${params.sustaining_capex_m} M$/an`],
                  ['Rev. totaux LOM', `${formatDecimalGrouped(totalRev, 0)} M$`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                    <span className="text-mf-txt3">{k}</span>
                    <span className="text-amber-400 font-semibold">{v}</span>
                  </div>
                ))}
              </div>

              <div className="card-sm bg-emerald-400/4 border border-emerald-400/15">
                <div className="flex items-start gap-2">
                  <Activity size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-mf-txt3 leading-relaxed">
                    Niveau de confiance global : <strong className="text-emerald-400">PEA / PFS</strong>.
                    Les réserves sont classifiées selon les standards CIM 2019 / NI 43-101.
                    Validation par un QP indépendant requise avant décision d'investissement finale (DIF).
                  </div>
                </div>
              </div>

              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Benchmarks sectoriels</div>
                {[
                  {
                    label: `AISC vs pair ($${benchmarks.aiscUsdOz}/oz)`,
                    val: chosen.aisc < benchmarks.aiscUsdOz ? 'Inférieur au pair ✓' : 'Supérieur au pair',
                    ok: chosen.aisc < benchmarks.aiscUsdOz,
                  },
                  {
                    // The hurdle defaults to the project's own discount rate — a project
                    // that clears its cost of capital is the meaningful test, not a
                    // hardcoded 15 %.
                    label: `TRI vs hurdle (${benchmarks.hurdlePct}%)`,
                    val: chosen.irr_pct == null ? '—' : chosen.irr_pct > benchmarks.hurdlePct ? 'Supérieur au hurdle ✓' : 'Inférieur au hurdle',
                    ok: (chosen.irr_pct ?? 0) > benchmarks.hurdlePct,
                  },
                  {
                    label: `RS vs médiane (${benchmarks.strippingRatio}:1)`,
                    val: params.stripping_ratio < benchmarks.strippingRatio ? 'Favorable ✓' : 'Élevé',
                    ok: params.stripping_ratio < benchmarks.strippingRatio,
                  },
                  { label: 'LOM vs projet', val: chosen.lom_years >= 8 ? 'LOM suffisant ✓' : 'LOM court', ok: chosen.lom_years >= 8 },
                ].map(b => (
                  <div key={b.label} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                    <span className="text-mf-txt3">{b.label}</span>
                    <span className={b.ok ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>{b.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
    </>
  );
}
