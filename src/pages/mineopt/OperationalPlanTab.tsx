import { formatDecimalGrouped } from '../../lib/format/number';


import { type Block as PitBlock } from '../../lib/mine/pitOptimizer';

import { MineParamsRow } from './model';

import { type DrillBlastPlan, type PeriodPlan } from '../../lib/mine/planning';
interface OperationalPlanTabProps {
  blastPlan: DrillBlastPlan | null;
  blocks: PitBlock[];
  currentMonth: PeriodPlan;
  daily: { oreMt: number; wasteMt: number; totalMt: number; } | null;
  dbCfg: { burdenM: number; spacingM: number; subDrillM: number; powderFactorKgT: number; tonnesPerBlast: number; };
  p: MineParamsRow | null;
  planYear: { year: number; grade: number; ore: number; waste: number; total: number; oz_k: number; contained_oz_k: number; net_oz_k: number; rev_m: number; cost_m: number; ebitda_m: number; fcf_m: number; aisc: number; rs: number; };
  setDbCfg: React.Dispatch<React.SetStateAction<{ burdenM: number; spacingM: number; subDrillM: number; powderFactorKgT: number; tonnesPerBlast: number; }>>;
  weekly: { oreMt: number; wasteMt: number; totalMt: number; } | null;
}

export function OperationalPlanTab({ blastPlan, blocks, currentMonth, daily, dbCfg, p, planYear, setDbCfg, weekly }: OperationalPlanTabProps) {
  return (
          <div className="space-y-4">
            {!daily || !planYear ? (
              <div className="card-sm text-center py-10 text-sm mf-txt4">Le plan stratégique (étape 3) doit exister d'abord.</div>
            ) : (
              <>
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plans hebdomadaire & journalier — an {planYear.year}, {currentMonth?.label}</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Dérivés du plan mensuel, lui-même dérivé de l'année : les horizons ne peuvent pas diverger entre eux.
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    {[
                      { label: 'Minerai / semaine', val: `${formatDecimalGrouped((weekly!.oreMt * 1e6 / 1000), 1)} kt`, color: 'text-amber-400' },
                      { label: 'Stérile / semaine', val: `${formatDecimalGrouped((weekly!.wasteMt * 1e6 / 1000), 1)} kt`, color: 'mf-txt3' },
                      { label: 'Total / semaine', val: `${formatDecimalGrouped((weekly!.totalMt * 1e6 / 1000), 1)} kt`, color: 'mf-txt' },
                      { label: 'Minerai / jour', val: `${(daily.oreMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'text-amber-400' },
                      { label: 'Stérile / jour', val: `${(daily.wasteMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'mf-txt3' },
                      { label: 'Total / jour', val: `${(daily.totalMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'mf-txt' },
                    ].map(k => (
                      <div key={k.label}>
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`text-base font-bold ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plan de forage & sautage — journalier</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Déduit de la géométrie du patron : chaque trou couvre banlieue × espacement × hauteur de banc de roche,
                    donc le tonnage fixe le nombre de trous, et les trous fixent les mètres et l'explosif.
                    Densité lue du modèle de blocs ({blocks.length ? formatDecimalGrouped(blocks[0].density, 2) : '2.70'} t/m³).
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mb-3">
                    {([
                      ['Banlieue (m)', 'burdenM'], ['Espacement (m)', 'spacingM'],
                      ['Sur-forage (m)', 'subDrillM'], ['Facteur poudre (kg/t)', 'powderFactorKgT'],
                      ['Tonnes/sautage', 'tonnesPerBlast'],
                    ] as const).map(([label, key]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-[10px] mf-txt4">{label}</span>
                        <input type="number" step="0.01" min="0" value={dbCfg[key]}
                          onChange={e => setDbCfg(c => ({ ...c, [key]: +e.target.value || 0 }))}
                          className="input-field text-xs w-20 py-0.5 text-right" />
                      </div>
                    ))}
                    <span className="text-[10px] mf-txt4">Hauteur de banc {p?.bench_height_m} m (étape 2)</span>
                  </div>
                  {blastPlan && (
                    <div className="grid grid-cols-6 gap-3">
                      {[
                        { label: 'Volume à abattre', val: `${blastPlan.volumeM3.toLocaleString('fr-CA', { maximumFractionDigits: 0 })} m³` },
                        { label: 'Trous de mine', val: formatDecimalGrouped(blastPlan.holes, 0) },
                        { label: 'Mètres forés', val: `${blastPlan.drillMetres.toLocaleString('fr-CA', { maximumFractionDigits: 0 })} m` },
                        { label: 'Explosif', val: `${formatDecimalGrouped((blastPlan.explosiveKg / 1000), 1)} t` },
                        { label: 'Sautages', val: formatDecimalGrouped(blastPlan.blasts, 2) },
                        { label: 'Mètres/trou', val: `${formatDecimalGrouped((p!.bench_height_m + dbCfg.subDrillM), 1)} m` },
                      ].map(k => (
                        <div key={k.label}>
                          <div className="text-[10px] mf-txt4">{k.label}</div>
                          <div className="text-base font-bold text-sky-400">{k.val}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
}
