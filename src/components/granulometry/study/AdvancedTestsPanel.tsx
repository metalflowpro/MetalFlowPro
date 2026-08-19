import { useEffect, useState, useCallback } from 'react';
import { Save, Gem, Repeat } from 'lucide-react';
import { cumulativeGrg, type GrgStage } from '../../../lib/p80study/grg';
import { solveLockedCycle } from '../../../lib/p80study/lockedCycle';
import {
  listGrg, saveGrg, listLockedCycle, saveLockedCycle,
  type P80Study, type P80GrgTest, type P80LockedCycle,
} from '../../../lib/db/p80Study';
import type { Json } from '../../../lib/database.types';

interface Props { study: P80Study; }

/** Étage GRG éditable (P80 grossier→fin, récupération gravité de l'étage). */
const DEFAULT_STAGES: GrgStage[] = [
  { stage: 1, p80Um: 850, stageRecoveryPct: 40 },
  { stage: 2, p80Um: 300, stageRecoveryPct: 30 },
  { stage: 3, p80Um: 75, stageRecoveryPct: 25 },
];

/** Essais avancés Phase 2 : GRG étagé (Laplante) et locked-cycle test. */
export function AdvancedTestsPanel({ study }: Props) {
  const [grgTests, setGrgTests] = useState<P80GrgTest[]>([]);
  const [lctTests, setLctTests] = useState<P80LockedCycle[]>([]);
  const [stages, setStages] = useState<GrgStage[]>(DEFAULT_STAGES);
  // Locked-cycle inputs
  const [freshGrade, setFreshGrade] = useState(3);
  const [singlePass, setSinglePass] = useState(60);
  const [recycle, setRecycle] = useState(0.5);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [g, l] = await Promise.all([listGrg(study.id), listLockedCycle(study.id)]);
    setGrgTests(g); setLctTests(l);
  }, [study.id]);
  useEffect(() => { void load(); }, [load]);

  const grg = cumulativeGrg(stages);
  const lct = solveLockedCycle({ freshFeedMass: 100, freshFeedGrade: freshGrade, singlePassRecoveryPct: singlePass, recycleFraction: recycle });

  const setStage = (i: number, patch: Partial<GrgStage>) =>
    setStages(s => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));

  const saveGrgTest = async () => {
    setBusy(true);
    try {
      await saveGrg(study.project_id, study.id, {
        stages: stages as unknown as Json, cumulative_grg_pct: grg.cumulativeGrgPct,
      });
      await load();
    } finally { setBusy(false); }
  };

  const saveLct = async () => {
    setBusy(true);
    try {
      await saveLockedCycle(study.project_id, study.id, {
        inputs: { freshFeedGrade: freshGrade, singlePassRecoveryPct: singlePass, recycleFraction: recycle } as unknown as Json,
        converged_recovery_pct: lct.convergedRecoveryPct,
        circulating_load_fraction: lct.circulatingLoadFraction,
        cycles: lct.cycles,
      });
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-2 gap-5">
      {/* GRG */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="flex items-center gap-2 mb-3"><Gem size={14} className="text-amber-400" /><span className="text-sm font-semibold text-mf-txt">GRG — essai étagé</span></div>
        <table className="tbl mb-3">
          <thead><tr><th>Étage</th><th className="text-right">P80 (µm)</th><th className="text-right">Récup. étage (%)</th><th className="text-right">Contrib. (pt)</th></tr></thead>
          <tbody>
            {stages.map((s, i) => (
              <tr key={i}>
                <td className="text-xs">{s.stage}</td>
                <td><input className="input-field text-xs w-16 text-right" value={s.p80Um} onChange={e => setStage(i, { p80Um: Number(e.target.value) || 0 })} /></td>
                <td><input className="input-field text-xs w-16 text-right" value={s.stageRecoveryPct} onChange={e => setStage(i, { stageRecoveryPct: Number(e.target.value) || 0 })} /></td>
                <td className="num text-xs text-mf-txt4">{grg.perStageContributionPct[i]?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-xs mb-3">GRG cumulé = <strong className="text-amber-400">{grg.cumulativeGrgPct.toFixed(1)} %</strong> <span className="text-mf-txt4">(1 − ∏(1 − rᵢ))</span></div>
        <button onClick={() => void saveGrgTest()} disabled={busy} className="btn btn-secondary gap-1.5 text-xs py-1.5"><Save size={12} /> Enregistrer GRG</button>
        {grgTests.length > 0 && <div className="text-[10px] text-mf-txt4 mt-2">{grgTests.length} essai(s) GRG enregistré(s)</div>}
      </div>

      {/* Locked-cycle */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="flex items-center gap-2 mb-3"><Repeat size={14} className="text-sky-400" /><span className="text-sm font-semibold text-mf-txt">Locked-cycle test</span></div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div><label className="text-[9px] text-mf-txt4 block">Teneur fraîche (g/t)</label><input className="input-field text-xs w-full" value={freshGrade} onChange={e => setFreshGrade(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">Récup. 1 passage (%)</label><input className="input-field text-xs w-full" value={singlePass} onChange={e => setSinglePass(Number(e.target.value) || 0)} /></div>
          <div><label className="text-[9px] text-mf-txt4 block">Fraction recyclée</label><input className="input-field text-xs w-full" value={recycle} onChange={e => setRecycle(Number(e.target.value) || 0)} /></div>
        </div>
        <div className="text-xs mb-1">Récup. régime permanent = <strong className="text-sky-400">{lct.convergedRecoveryPct.toFixed(2)} %</strong></div>
        <div className="text-[10px] text-mf-txt4 mb-3">Charge circulante {(lct.circulatingLoadFraction * 100).toFixed(0)} % · {lct.cycles} cycles · {lct.converged ? 'convergé' : 'non convergé'}</div>
        <button onClick={() => void saveLct()} disabled={busy} className="btn btn-secondary gap-1.5 text-xs py-1.5"><Save size={12} /> Enregistrer LCT</button>
        {lctTests.length > 0 && <div className="text-[10px] text-mf-txt4 mt-2">{lctTests.length} test(s) LCT enregistré(s)</div>}
      </div>
    </div>
  );
}
