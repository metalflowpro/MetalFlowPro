import { formatDecimalGrouped } from '../../lib/format/number';
import { Save, GitBranch,
} from 'lucide-react';
import { type ResolvedMineParams, type ResolvedParam } from '../../lib/mine/params';

import { MineParamsRow } from './model';

interface ModelParamsTabProps {
  Number: NumberConstructor;
  String: StringConstructor;
  mine: ResolvedMineParams;
  params: MineParamsRow;
  saveParams: () => Promise<void>;
  saving: boolean;
  upd: <K extends keyof MineParamsRow>(key: K, val: MineParamsRow[K]) => void;
}

export function ModelParamsTab({ Number, String, mine, params, saveParams, saving, upd }: ModelParamsTabProps) {
  return (
          <div className="space-y-5">
            {/* ── Importés automatiquement des autres modules ─────────────── */}
            <div className="card-sm">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={12} className="text-teal-400" />
                <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Importés automatiquement des autres modules</div>
                <span className="text-[10px] mf-txt4">— chaque valeur provient du module qui la possède</span>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2.5">
                {([
                  ['Récupération métall.', mine.metRecoveryPct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['Teneur alimentation', mine.goldGradeGt, (v: number) => `${formatDecimalGrouped(v, 2)} g/t`],
                  ['Prix de l\'or', mine.goldPriceUsdOz, (v: number) => `$${formatDecimalGrouped(v, 0)}/oz`],
                  ['Taux d\'actualisation', mine.discountRatePct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['Redevances', mine.royaltyPct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['OPEX procédé', mine.processCostUsdT, (v: number) => `$${formatDecimalGrouped(v, 2)}/t`],
                  ['CAPEX initial', mine.capexMusd, (v: number) => `${formatDecimalGrouped(v, 1)} M$`],
                  ['CAPEX maintien', mine.sustainingCapexMusd, (v: number) => `${formatDecimalGrouped(v, 1)} M$/an`],
                ] as [string, ResolvedParam, (v: number) => string][]).map(([label, param, fmt]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[10px] mf-txt4 truncate">{label}</div>
                    <div className="text-sm font-bold mf-txt">{fmt(param.value)}</div>
                    <div className={`text-[9px] truncate ${
                      param.origin === 'override' ? 'text-amber-400'
                        : param.origin === 'defaut' ? 'text-red-400/80'
                        : 'text-emerald-400/80'}`} title={param.source}>
                      {param.origin === 'override' ? '✎ ' : param.origin === 'defaut' ? '⚠ ' : '↓ '}{param.source}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Saisie manuelle (avec import ponctuel depuis un module) ──── */}
            <div className="card-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Paramètres du modèle minier</div>
                <span className="text-[10px] mf-txt4">Bouton ↓ = importer la valeur du module · sinon saisie manuelle</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {([
                  { label: 'Méthode', key: 'method', type: 'select', options: ['Open pit', 'Souterrain', 'Open pit + Souterrain'] },
                  { label: 'RS moyen (s/m)', key: 'stripping_ratio', type: 'number', step: 0.1 },
                  { label: 'Angle talus global (°)', key: 'slope_angle_deg', type: 'number', step: 1 },
                  { label: 'Hauteur banc (m)', key: 'bench_height_m', type: 'number', step: 1 },
                  { label: 'Réserves (Mt)', key: 'reserves_mt', type: 'number', step: 0.5 },
                  { label: 'Teneur réserves (g/t)', key: 'grade_g_t', type: 'number', step: 0.01, imp: { param: mine.goldGradeGt, dp: 2 } },
                  { label: 'CoG (g/t Au)', key: 'cutoff_g_t', type: 'number', step: 0.01 },
                  { label: 'Dilution minière (%)', key: 'dilution_pct', type: 'number', step: 0.5 },
                  { label: 'Récupération minerai (%)', key: 'ore_recovery_pct', type: 'number', step: 0.5 },
                  { label: 'Coût extraction ($/t total)', key: 'mining_cost_t', type: 'number', step: 0.1 },
                  { label: 'Coût traitement ($/t minerai)', key: 'process_cost_t', type: 'number', step: 0.5, imp: { param: mine.processCostUsdT, dp: 2 } },
                  { label: 'Sautage ($/t total)', key: 'blasting_cost_t', type: 'number', step: 0.05 },
                  { label: 'G&A (M$/an)', key: 'ga_cost_m', type: 'number', step: 0.5 },
                  { label: 'Pompage (M$/an)', key: 'pump_cost_m', type: 'number', step: 0.5 },
                  { label: 'CAPEX soutien (M$/an)', key: 'sustaining_capex_m', type: 'number', step: 0.5, imp: { param: mine.sustainingCapexMusd, dp: 1 } },
                  { label: 'Taux actualisation (%)', key: 'discount_rate_pct', type: 'number', step: 0.5, imp: { param: mine.discountRatePct, dp: 1 } },
                  { label: 'Redevances royalties (%)', key: 'royalty_pct', type: 'number', step: 0.25, imp: { param: mine.royaltyPct, dp: 2 } },
                  { label: 'NSR (%)', key: 'nsr_pct', type: 'number', step: 0.25 },
                  { label: 'Camions', key: 'trucks', type: 'text' },
                  { label: 'Pelle / Chargeuse', key: 'shovel', type: 'text' },
                  { label: 'Montée en régime An 1 (%)', key: 'ramp_up_y1_pct', type: 'number', step: 1 },
                  { label: 'Montée en régime An 2 (%)', key: 'ramp_up_y2_pct', type: 'number', step: 1 },
                  { label: 'Déclin teneur (%/an)', key: 'grade_decay_pct_yr', type: 'number', step: 0.1 },
                  { label: 'Coût CAPEX unitaire ($/t-j)', key: 'capex_unit_cost_usd_t', type: 'number', step: 500 },
                ] as { label: string; key: keyof MineParamsRow; type: string; step?: number; options?: string[]; imp?: { param: ResolvedParam; dp: number } }[]).map(f => (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    {f.type === 'select' ? (
                      <select
                        className="input-field w-full text-xs"
                        value={String(params[f.key] ?? '')}
                        onChange={e => upd(f.key, e.target.value as never)}
                      >
                        {f.options?.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type} step={f.step}
                        className="input-field w-full font-mono text-xs"
                        value={String(params[f.key] ?? '')}
                        onChange={e => upd(f.key, (f.type === 'number' ? Number(e.target.value) : e.target.value) as never)}
                      />
                    )}
                    {f.imp && (
                      <button
                        type="button"
                        onClick={() => upd(f.key, Number(f.imp!.param.value.toFixed(f.imp!.dp)) as never)}
                        className="mt-1 text-[9px] text-teal-400 hover:text-teal-300 flex items-center gap-1 truncate"
                        title={`Importer depuis : ${f.imp.param.source}`}
                      >
                        ↓ Importer ({formatDecimalGrouped(f.imp.param.value, f.imp.dp)}) — {f.imp.param.source}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={saveParams} disabled={saving} className="btn btn-secondary text-xs flex items-center gap-1.5">
                  <Save size={12} /> Sauvegarder
                </button>
              </div>
            </div>
          </div>
        );
}
