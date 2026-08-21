import { useState, useMemo } from 'react';
import { SlidersHorizontal, Beaker, Dices, Plus, Trash2 } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { computeCalibration, type CalibrationPoint } from '../../lib/simulation/calibration';
import { reconcile, type ReconTag } from '../../lib/simulation/plantReconciliation';
import { runMultiObjectiveMC, type MCScenario, type MCObjective } from '../../lib/simulation/monteCarloMultiObjective';
import { goldOuncesPerDay } from '../../lib/simulation/generator';
import { CONFIDENCE_UI } from './simUi';
import type { SimRunResult } from '../../lib/simulation/types';

// ─── Calibration pilote / usine ───────────────────────────────────────────────

function CalibrationPanel() {
  const [points, setPoints] = useState<CalibrationPoint[]>([{ simulated: 80, measured: 88 }]);
  const result = useMemo(() => computeCalibration(points), [points]);

  const update = (i: number, key: keyof CalibrationPoint, v: number) =>
    setPoints(prev => prev.map((p, j) => j === i ? { ...p, [key]: v } : p));

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3"><SlidersHorizontal size={16} className="text-cyan-400" /><h4 className="font-semibold text-white">Calibration pilote / usine</h4></div>
      <p className="text-xs text-slate-400 mb-3">
        Corrige le biais systématique du simulateur à partir de mesures pilote/usine. Le facteur est borné : un écart extrême signale un modèle à revoir, pas un simple facteur d'échelle.
      </p>
      <div className="space-y-2 mb-3">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-[11px] text-slate-500 uppercase">
          <span>Simulé (%)</span><span>Mesuré usine (%)</span><span></span>
        </div>
        {points.map((p, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            <input type="number" className="input-field" value={p.simulated} onChange={e => update(i, 'simulated', Number(e.target.value))} />
            <input type="number" className="input-field" value={p.measured} onChange={e => update(i, 'measured', Number(e.target.value))} />
            <button onClick={() => setPoints(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={() => setPoints(prev => [...prev, { simulated: 80, measured: 80 }])} className="btn btn-secondary text-xs"><Plus size={12} /> Ajouter un point</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="card-sm"><div className="text-xs text-slate-400">Facteur de calibration</div><div className="text-lg font-bold text-white">×{formatDecimalGrouped(result.factor, 3)}{result.clamped && <span className="text-amber-400 text-xs ml-1">(borné)</span>}</div></div>
        <div className="card-sm"><div className="text-xs text-slate-400">Biais moyen</div><div className={`text-lg font-bold ${Math.abs(result.meanBiasPct) < 5 ? 'text-emerald-400' : 'text-amber-400'}`}>{result.meanBiasPct >= 0 ? '+' : ''}{formatDecimalGrouped(result.meanBiasPct, 1)}%</div></div>
        <div className="card-sm"><div className="text-xs text-slate-400">Confiance ({result.n} pt)</div><div><span className={`badge ${CONFIDENCE_UI[result.confidence].badge}`}>{CONFIDENCE_UI[result.confidence].label}</span></div></div>
      </div>
    </div>
  );
}

// ─── Réconciliation usine ─────────────────────────────────────────────────────

function ReconciliationPanel({ lastRun }: { lastRun: SimRunResult | null }) {
  const seed: ReconTag[] = useMemo(() => {
    const g = lastRun?.global_results;
    return [
      { name: 'Récupération Au', simulated: g?.overall_recovery ?? 90, measured: g?.overall_recovery ?? 90, unit: '%' },
      { name: 'Débit', simulated: lastRun?.feed_input?.feed_rate ?? 500, measured: lastRun?.feed_input?.feed_rate ?? 500, unit: 't/h' },
      { name: 'Énergie', simulated: g?.total_energy_kwh_t ?? 20, measured: g?.total_energy_kwh_t ?? 20, unit: 'kWh/t' },
    ];
  }, [lastRun]);
  const [tags, setTags] = useState<ReconTag[]>(seed);
  const [tol, setTol] = useState(5);
  const result = useMemo(() => reconcile(tags, { tolerancePct: tol }), [tags, tol]);

  const update = (i: number, key: 'simulated' | 'measured', v: number) =>
    setTags(prev => prev.map((t, j) => j === i ? { ...t, [key]: v } : t));

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3"><Beaker size={16} className="text-emerald-400" /><h4 className="font-semibold text-white">Réconciliation modèle ↔ usine</h4></div>
      <p className="text-xs text-slate-400 mb-3">Confronte les valeurs simulées aux mesures usine (SCADA/DCS/historian). Renseignez les mesures ; les écarts hors tolérance sont signalés.</p>
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-slate-400">Tolérance (%)</span>
        <input type="number" className="input-field w-20" value={tol} onChange={e => setTol(Number(e.target.value))} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-[11px] text-slate-400 uppercase border-b border-slate-700">
            <th className="py-1.5 pr-3">Tag</th><th className="py-1.5 px-2 text-right">Simulé</th><th className="py-1.5 px-2 text-right">Mesuré</th><th className="py-1.5 px-2 text-right">Écart</th><th className="py-1.5 pl-2">Statut</th>
          </tr></thead>
          <tbody>
            {result.tags.map((t, i) => (
              <tr key={t.name} className="border-b border-slate-800/60">
                <td className="py-1.5 pr-3 text-slate-300">{t.name} <span className="text-slate-600">{t.unit}</span></td>
                <td className="py-1.5 px-2 text-right"><input type="number" className="input-field text-right w-24" value={t.simulated} onChange={e => update(i, 'simulated', Number(e.target.value))} /></td>
                <td className="py-1.5 px-2 text-right"><input type="number" className="input-field text-right w-24" value={t.measured} onChange={e => update(i, 'measured', Number(e.target.value))} /></td>
                <td className={`py-1.5 px-2 text-right font-mono ${t.withinTolerance ? 'text-slate-300' : 'text-amber-400'}`}>{t.biasPct >= 0 ? '+' : ''}{formatDecimalGrouped(t.biasPct, 1)}%</td>
                <td className="py-1.5 pl-2"><span className={`badge ${t.withinTolerance ? 'badge-success' : 'badge-warning'}`}>{t.withinTolerance ? 'OK' : 'Dérive'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="card-sm"><div className="text-xs text-slate-400">Note d'accord</div><div className={`text-lg font-bold ${result.score >= 90 ? 'text-emerald-400' : result.score >= 75 ? 'text-amber-400' : 'text-red-400'}`}>{formatDecimalGrouped(result.score, 0)}/100</div></div>
        <div className="card-sm"><div className="text-xs text-slate-400">Tags dans la tolérance</div><div className="text-lg font-bold text-white">{result.withinToleranceCount}/{result.tags.length}</div></div>
      </div>
    </div>
  );
}

// ─── Monte-Carlo multi-objectifs ──────────────────────────────────────────────

function MonteCarloPanel({ runs }: { runs: SimRunResult[] }) {
  const [gradeUncPct, setGradeUncPct] = useState(10);
  const [recStdPts, setRecStdPts] = useState(2);
  const [ran, setRan] = useState(false);

  const scenarios: MCScenario[] = useMemo(() => runs.slice(0, 4).map((r, i) => {
    const grade = r.feed_input?.gold_grade ?? 1;
    const rec = r.global_results?.overall_recovery ?? 90;
    return {
      id: r.id, label: `Sim ${i + 1} (${new Date(r.created_at).toLocaleDateString('fr-CA')})`,
      inputs: [
        { name: 'grade', dist: { kind: 'normal', mean: grade, std: grade * gradeUncPct / 100, min: 0 } },
        { name: 'rec', dist: { kind: 'normal', mean: rec, std: recStdPts, min: 0, max: 100 } },
        { name: 'tph', dist: { kind: 'normal', mean: r.feed_input?.feed_rate ?? 500, std: 0 } },
        { name: 'opex', dist: { kind: 'normal', mean: r.global_results?.total_opex_per_t ?? 10, std: 0 } },
      ],
    };
  }), [runs, gradeUncPct, recStdPts]);

  const objectives: MCObjective[] = useMemo(() => [
    { key: 'oz', label: 'Or récupéré', unit: 'oz/j', direction: 'maximize', model: d => goldOuncesPerDay(d.tph, d.grade, d.rec / 100) },
    { key: 'opex', label: 'OPEX', unit: '$/t', direction: 'minimize', model: d => d.opex },
  ], []);

  const result = useMemo(() => ran && scenarios.length > 0 ? runMultiObjectiveMC(scenarios, objectives, 2000) : null, [ran, scenarios, objectives]);

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3"><Dices size={16} className="text-violet-400" /><h4 className="font-semibold text-white">Monte-Carlo multi-objectifs</h4></div>
      <p className="text-xs text-slate-400 mb-3">Propage l'incertitude des entrées (teneur, récupération) à travers les objectifs des simulations enregistrées, puis dresse le front de compromis médian et le front robuste (P10/P90).</p>
      {runs.length === 0 ? (
        <div className="text-sm text-slate-500">Lancez au moins une simulation pour l'analyse probabiliste.</div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div><label className="label">Incertitude teneur (±%)</label><input type="number" className="input-field w-28" value={gradeUncPct} onChange={e => { setGradeUncPct(Number(e.target.value)); setRan(false); }} /></div>
            <div><label className="label">Écart-type récup. (pts)</label><input type="number" className="input-field w-28" value={recStdPts} onChange={e => { setRecStdPts(Number(e.target.value)); setRan(false); }} /></div>
            <button onClick={() => setRan(true)} className="btn btn-primary text-sm"><Dices size={14} /> Lancer 2000 tirages</button>
          </div>

          {result && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-slate-400 uppercase border-b border-slate-700">
                  <th className="py-1.5 pr-3">Scénario</th>
                  <th className="py-1.5 px-2 text-right">Or oz/j P10</th>
                  <th className="py-1.5 px-2 text-right">P50</th>
                  <th className="py-1.5 px-2 text-right">P90</th>
                  <th className="py-1.5 px-2">Front médian</th>
                  <th className="py-1.5 pl-2">Front robuste</th>
                </tr></thead>
                <tbody>
                  {result.scenarios.map(s => {
                    const oz = s.objectives.oz;
                    const onMedian = result.paretoMedian.front.some(p => p.id === s.id);
                    const onRobust = result.paretoRobust.front.some(p => p.id === s.id);
                    const isKnee = result.paretoRobust.knee?.id === s.id;
                    return (
                      <tr key={s.id} className={`border-b border-slate-800/60 ${isKnee ? 'bg-emerald-500/5' : ''}`}>
                        <td className="py-1.5 pr-3 text-slate-300">{s.label}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-amber-300">{formatDecimalGrouped(oz.p10, 0)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-white">{formatDecimalGrouped(oz.p50, 0)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-emerald-300">{formatDecimalGrouped(oz.p90, 0)}</td>
                        <td className="py-1.5 px-2">{onMedian ? <span className="badge badge-info">non dominé</span> : <span className="text-slate-600 text-xs">dominé</span>}</td>
                        <td className="py-1.5 pl-2">{onRobust ? <span className={`badge ${isKnee ? 'badge-success' : 'badge-info'}`}>{isKnee ? 'meilleur compromis' : 'non dominé'}</span> : <span className="text-slate-600 text-xs">dominé</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="text-[10px] text-slate-500 mt-2">
                Front médian = compromis sur la valeur centrale (P50). Front robuste = compromis sur la valeur conservatrice (P10 en récupération/oz, P90 en OPEX) — la décision averse au risque.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Onglet ───────────────────────────────────────────────────────────────────

export default function AdvancedTab({ runs, lastRun }: { runs: SimRunResult[]; lastRun: SimRunResult | null }) {
  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-5xl space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-blue-400" />
          <h3 className="section-title">Validation avancée (Phase 7)</h3>
          <span className="text-xs text-slate-500">Calibration · réconciliation usine · Monte-Carlo multi-objectifs</span>
        </div>
        <CalibrationPanel />
        <ReconciliationPanel lastRun={lastRun} />
        <MonteCarloPanel runs={runs} />
      </div>
    </div>
  );
}
