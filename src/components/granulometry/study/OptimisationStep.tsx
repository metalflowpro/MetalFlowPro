import { useEffect, useMemo, useState, useCallback } from 'react';
import { Save, Star, Factory } from 'lucide-react';
import { formatDecimalGrouped } from '../../../lib/format/number';
import { DEFAULT_ASSUMPTIONS } from '../../../lib/config/constants';
import { LAB_SCORE_WEIGHTS, type LabScoreWeights } from '../../../lib/p80study/labScore';
import { optimisePlantP80, type PlantP80Inputs, type PlantObjective, type PlantP80Point } from '../../../lib/p80study/plantP80';
import { paretoFront, weightedRanking, MULTI_OBJECTIVE_WEIGHTS, type ObjectiveSpec } from '../../../lib/p80study/multiObjective';
import { listResults, replaceScenarios, type P80Study, type P80TestResult } from '../../../lib/db/p80Study';
import { scoreLab } from './studyCompute';
import type { Project } from '../../../types';

interface Props {
  study: P80Study;
  project: Project;
  recoveryCeilingPct: number;
  onChanged: () => void;
}

/** Étape 5 — optimisation : P80 labo (score) + P80 usine (débit/oz-jour). */
export function OptimisationStep({ study, project, recoveryCeilingPct, onChanged }: Props) {
  const [results, setResults] = useState<P80TestResult[]>([]);
  const [weights, setWeights] = useState<LabScoreWeights>(LAB_SCORE_WEIGHTS);

  // Entrées usine éditables (aucune valeur figée en dur : défauts documentés).
  const [f80, setF80] = useState(10000);
  const [millPowerKw, setMillPowerKw] = useState(5000);
  const [bwi, setBwi] = useState<number>(DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T);
  const [treatmentCost, setTreatmentCost] = useState(12);
  const [objective, setObjective] = useState<PlantObjective>(
    study.objective === 'recovery' ? 'oz_per_day' : 'net_value_per_day');
  const [saving, setSaving] = useState(false);
  const [moWeights, setMoWeights] = useState(MULTI_OBJECTIVE_WEIGHTS);

  const load = useCallback(async () => { setResults(await listResults(study.id)); }, [study.id]);
  useEffect(() => { void load(); }, [load]);

  const lab = useMemo(() => scoreLab(results, weights), [results, weights]);

  const plantInputs: PlantP80Inputs = {
    bwi, f80Um: f80, millPowerKw,
    gradeGt: project.gold_grade_g_t, goldPriceUsdOz: project.gold_price_usd,
    treatmentCostUsdT: treatmentCost, recoveryCeilingPct,
  };
  const plant = useMemo(
    () => optimisePlantP80(study.p80_targets_um, plantInputs, objective),
    // plantInputs est reconstruit à chaque rendu ; on dépend de ses champs primitifs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [study.p80_targets_um, bwi, f80, millPowerKw, project.gold_grade_g_t, project.gold_price_usd, treatmentCost, recoveryCeilingPct, objective],
  );

  // ── Multi-objectifs (Pareto + score composite) sur les points usine ─────────
  type MOKey = 'recovery' | 'throughput' | 'ozPerDay' | 'netValue' | 'energy';
  const moObjectives = (p: PlantP80Point): Record<MOKey, number> => ({
    recovery: p.recoveryPct, throughput: p.throughputTph,
    ozPerDay: p.ozPerDay, netValue: p.netValueUsdDay, energy: p.energyKwhT,
  });
  const moSpecs: ObjectiveSpec<MOKey>[] = [
    { key: 'recovery', direction: 'max', weight: moWeights.recovery },
    { key: 'throughput', direction: 'max', weight: moWeights.throughput },
    { key: 'ozPerDay', direction: 'max', weight: moWeights.ozPerDay },
    { key: 'netValue', direction: 'max', weight: moWeights.netValue },
    { key: 'energy', direction: 'min', weight: moWeights.energy },
  ];
  // moObjectives/moSpecs sont dérivés de moWeights ; on dépend de plant.points et moWeights.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pareto = useMemo(() => paretoFront(plant.points, moObjectives, moSpecs), [plant.points, moWeights]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const moRanking = useMemo(() => weightedRanking(plant.points, moObjectives, moSpecs), [plant.points, moWeights]);
  const moBest = moRanking[0]?.item ?? null;

  const saveScenarios = async () => {
    setSaving(true);
    try {
      await replaceScenarios(study.project_id, study.id, plant.points.map(p => ({
        target_p80: p.p80Um, f80_um: f80, throughput_tph: p.throughputTph,
        mill_power_kw: millPowerKw, bond_wi: bwi, recovery_pct: p.recoveryPct,
        energy_kwh_t: p.energyKwhT, oz_per_day: p.ozPerDay, net_value_per_day: p.netValueUsdDay,
      })));
      onChanged();
    } finally { setSaving(false); }
  };

  const wField = (key: keyof LabScoreWeights, label: string) => (
    <div>
      <label className="text-[9px] text-mf-txt4 block">{label}</label>
      <input type="number" step="0.1" className="input-field text-xs w-16" value={weights[key]}
        onChange={e => setWeights(w => ({ ...w, [key]: Number(e.target.value) || 0 }))} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ── P80 LABO ── */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Star size={15} className="text-teal-400" />
          <span className="text-sm font-semibold text-mf-txt">P80 laboratoire — score multi-critères</span>
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <span className="text-[10px] text-mf-txt4">Poids :</span>
          {wField('recovery', 'w récup')}
          {wField('reagent', 'w réactifs')}
          {wField('energy', 'w énergie')}
          {wField('fines', 'w fines')}
        </div>
        {lab.scored.length === 0 ? (
          <div className="text-sm text-mf-txt4">Aucun résultat exploitable — saisissez d'abord des résultats conformes.</div>
        ) : (
          <>
            <table className="tbl">
              <thead><tr><th className="text-right">P80 (µm)</th><th className="text-right">Récup. (%)</th><th className="text-right">Réactifs</th><th className="text-right">Énergie</th><th className="text-right">Fines</th><th className="text-right">Score</th></tr></thead>
              <tbody>
                {lab.scored.slice().sort((a, b) => b.score - a.score).map(c => (
                  <tr key={c.p80Um} className={lab.best?.p80Um === c.p80Um ? 'bg-teal-500/10' : ''}>
                    <td className="num text-xs font-bold">{Math.round(c.p80Um)}{lab.best?.p80Um === c.p80Um && <Star size={11} className="inline ml-1 text-teal-400" />}</td>
                    <td className="num text-xs">{c.recoveryPct.toFixed(1)}</td>
                    <td className="num text-xs text-mf-txt4">{c.contributions.reagent.toFixed(2)}</td>
                    <td className="num text-xs text-mf-txt4">{c.contributions.energy.toFixed(2)}</td>
                    <td className="num text-xs text-mf-txt4">{c.contributions.fines.toFixed(2)}</td>
                    <td className="num text-xs font-mono text-teal-400">{c.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lab.best && (
              <div className="mt-3 text-xs text-teal-300">
                P80 labo recommandé : <strong>{Math.round(lab.best.p80Um)} µm</strong> — meilleur compromis
                récupération / réactifs / énergie / fines (contributions détaillées ci-dessus, pas seulement le score).
              </div>
            )}
          </>
        )}
      </div>

      {/* ── P80 USINE ── */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Factory size={15} className="text-sky-400" />
          <span className="text-sm font-semibold text-mf-txt">P80 usine — débit, oz/jour, valeur nette</span>
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div><label className="text-[9px] text-mf-txt4 block">F80 (µm)</label><input type="number" className="input-field text-xs w-24" value={f80} onChange={e => setF80(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">Puissance broyeur (kW)</label><input type="number" className="input-field text-xs w-28" value={millPowerKw} onChange={e => setMillPowerKw(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">BWi (kWh/t)</label><input type="number" step="0.1" className="input-field text-xs w-20" value={bwi} onChange={e => setBwi(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">Coût trait. ($/t)</label><input type="number" step="0.1" className="input-field text-xs w-20" value={treatmentCost} onChange={e => setTreatmentCost(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">Objectif</label>
            <select className="input-field text-xs w-40" value={objective} onChange={e => setObjective(e.target.value as PlantObjective)}>
              <option value="net_value_per_day">Valeur nette / jour</option>
              <option value="oz_per_day">Onces d'or / jour</option>
            </select>
          </div>
        </div>
        <table className="tbl">
          <thead><tr><th className="text-right">P80 (µm)</th><th className="text-right">Débit (t/h)</th><th className="text-right">Récup. (%)</th><th className="text-right">Or/jour (oz)</th><th className="text-right">Énergie (kWh/t)</th><th className="text-right">Valeur nette ($/j)</th></tr></thead>
          <tbody>
            {plant.points.map(p => (
              <tr key={p.p80Um} className={plant.optimal?.p80Um === p.p80Um ? 'bg-sky-500/10' : ''}>
                <td className="num text-xs font-bold">{Math.round(p.p80Um)}{plant.optimal?.p80Um === p.p80Um && <Star size={11} className="inline ml-1 text-sky-400" />}</td>
                <td className="num text-xs">{formatDecimalGrouped(p.throughputTph, 1)}</td>
                <td className="num text-xs">{p.recoveryPct.toFixed(1)}</td>
                <td className="num text-xs">{formatDecimalGrouped(p.ozPerDay, 1)}</td>
                <td className="num text-xs text-mf-txt4">{p.energyKwhT.toFixed(1)}</td>
                <td className="num text-xs font-mono text-emerald-400">{formatDecimalGrouped(p.netValueUsdDay, 0)}</td>
              </tr>
            ))}
            {plant.points.length === 0 && <tr><td colSpan={6} className="text-center text-mf-txt4 py-6 text-xs">Définissez des P80 cibles.</td></tr>}
          </tbody>
        </table>
        {plant.optimal && (
          <div className="mt-3 text-xs text-sky-300">
            P80 usine optimal ({objective === 'oz_per_day' ? 'onces/jour' : 'valeur nette'}) :
            <strong> {Math.round(plant.optimal.p80Um)} µm</strong> — un broyage plus fin augmenterait
            la récupération mais réduirait le débit, et donc la production quotidienne.
          </div>
        )}
        <button onClick={() => void saveScenarios()} disabled={saving} className="btn btn-primary gap-1.5 text-xs py-1.5 mt-4">
          <Save size={13} /> {saving ? 'Enregistrement…' : 'Enregistrer les scénarios usine'}
        </button>
      </div>

      {/* ── MULTI-OBJECTIFS ── */}
      {plant.points.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Star size={15} className="text-violet-400" />
            <span className="text-sm font-semibold text-mf-txt">Optimisation multi-objectifs — Pareto & score composite</span>
          </div>
          <div className="flex flex-wrap items-end gap-3 mb-4">
            <span className="text-[10px] text-mf-txt4">Poids :</span>
            {(['recovery', 'throughput', 'ozPerDay', 'netValue', 'energy'] as const).map(k => (
              <div key={k}>
                <label className="text-[9px] text-mf-txt4 block">{k}</label>
                <input type="number" step="0.5" className="input-field text-xs w-16" value={moWeights[k]}
                  onChange={e => setMoWeights(w => ({ ...w, [k]: Number(e.target.value) || 0 }))} />
              </div>
            ))}
          </div>
          <table className="tbl">
            <thead><tr><th className="text-right">P80 (µm)</th><th className="text-center">Pareto</th><th className="text-right">Récup.</th><th className="text-right">Débit</th><th className="text-right">Oz/jour</th><th className="text-right">Score composite</th></tr></thead>
            <tbody>
              {moRanking.map(({ item: p, score }) => {
                const idx = plant.points.indexOf(p);
                const isPareto = pareto.isOptimal[idx];
                return (
                  <tr key={p.p80Um} className={moBest?.p80Um === p.p80Um ? 'bg-violet-500/10' : ''}>
                    <td className="num text-xs font-bold">{Math.round(p.p80Um)}{moBest?.p80Um === p.p80Um && <Star size={11} className="inline ml-1 text-violet-400" />}</td>
                    <td className="text-center text-xs">{isPareto ? <span className="text-emerald-400">✓</span> : <span className="text-mf-txt4">—</span>}</td>
                    <td className="num text-xs">{p.recoveryPct.toFixed(1)}</td>
                    <td className="num text-xs">{formatDecimalGrouped(p.throughputTph, 1)}</td>
                    <td className="num text-xs">{formatDecimalGrouped(p.ozPerDay, 1)}</td>
                    <td className="num text-xs font-mono text-violet-400">{score.toFixed(3)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {moBest && (
            <div className="mt-3 text-xs text-violet-300">
              Recommandation multi-objectifs : <strong>{Math.round(moBest.p80Um)} µm</strong> — meilleur
              compromis pondéré ; les P80 marqués ✓ sont Pareto-optimaux (aucun autre n'est meilleur sur tous les critères).
            </div>
          )}
        </div>
      )}
    </div>
  );
}
