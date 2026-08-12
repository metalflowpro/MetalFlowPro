// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation BILINÉAIRE (tonnage + teneur) — onglet Réconciliation du COS.
//
// L'ingénieur décrit son circuit UNE fois (flux + nœuds), saisit le TONNAGE
// mesuré de chaque flux (support conservé) et, par métal, la TENEUR d'analyse.
// Le moteur réconcilie d'abord les tonnages (conservation de masse), puis les
// teneurs à tonnages figés : le débit métal réconcilié m̂ = T̂·â est alors
// cohérent avec le tonnage réconcilié (metal accounting rigoureux, AMIRA P754).
//
// Différence avec l'onglet « Réconciliation réseau » (item 1B) : celui-ci
// réconcilie chaque composant en absolu et INDÉPENDAMMENT ; ici métal et
// tonnage sont couplés par le produit T·teneur.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import {
  Layers, Play, Plus, Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Beaker, Scale,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import {
  reconcileBilinear, type BilinearStream, type BilinearMetal, type BilinearResult,
} from '../../lib/reconciliation/bilinear';

const METALS: { key: string; label: string; unit: string }[] = [
  { key: 'au', label: 'Or',     unit: 'g/t' },
  { key: 'ag', label: 'Argent', unit: 'g/t' },
];
const METAL_DEFS: BilinearMetal[] = METALS.map(m => ({ key: m.key, label: m.label, gradeUnit: m.unit }));

/** Cellule d'édition (chaînes) : valeur + précision %. Vide = non mesuré. */
type Cell = { v: string; p: string };
const cell = (v = '', p = '5'): Cell => ({ v, p });
const emptyGrades = (): Record<string, Cell> => ({ au: cell(), ag: cell() });

interface StreamRow {
  id: string;
  label: string;
  tonnage: Cell;
  fixed: boolean;
  grades: Record<string, Cell>;
}
interface NodeRow { id: string; label: string; inputs: string; outputs: string; }

// Exemple : broyage → flottation → lixiviation. Tonnages avec petit déséquilibre,
// teneurs Or/Argent réalistes (concentré enrichi, rejet appauvri).
const EXAMPLE_STREAMS: StreamRow[] = [
  { id: 'feed',         label: 'Alimentation ROM',     tonnage: cell('100', '2'), fixed: false, grades: { au: cell('5', '6'),   ag: cell('20', '6') } },
  { id: 'conc',         label: 'Concentré flottation', tonnage: cell('30', '5'),  fixed: false, grades: { au: cell('14.5', '5'), ag: cell('58', '5') } },
  { id: 'rougher_tail', label: 'Rejet ébauchage',      tonnage: cell('68', '5'),  fixed: false, grades: { au: cell('0.9', '8'),  ag: cell('4.5', '8') } },
];
const EXAMPLE_NODES: NodeRow[] = [
  { id: 'float', label: 'Flottation', inputs: 'feed', outputs: 'conc, rougher_tail' },
];

const emptyStream = (): StreamRow => ({ id: '', label: '', tonnage: cell(), fixed: false, grades: emptyGrades() });
const emptyNode = (): NodeRow => ({ id: '', label: '', inputs: '', outputs: '' });

export function BilinearReconciliationPanel() {
  const [streams, setStreams] = useState<StreamRow[]>(EXAMPLE_STREAMS);
  const [nodes, setNodes] = useState<NodeRow[]>(EXAMPLE_NODES);
  const [active, setActive] = useState<string>('au');
  const [ran, setRan] = useState(true);

  const result = useMemo<BilinearResult | null>(() => {
    if (!ran) return null;
    const parsedNodes = nodes
      .filter(r => r.id.trim())
      .map(r => ({
        id: r.id.trim(),
        label: r.label.trim() || r.id.trim(),
        inputs: r.inputs.split(',').map(x => x.trim()).filter(Boolean),
        outputs: r.outputs.split(',').map(x => x.trim()).filter(Boolean),
      }));
    const parsedStreams: BilinearStream[] = streams
      .filter(r => r.id.trim() && r.tonnage.v.trim() !== '')
      .map(r => {
        const grades: BilinearStream['grades'] = {};
        for (const m of METALS) {
          const g = r.grades[m.key];
          if (g && g.v.trim() !== '') grades[m.key] = { value: Number(g.v), precisionPct: Number(g.p) || 5 };
        }
        return {
          id: r.id.trim(),
          label: r.label.trim() || r.id.trim(),
          tonnage: Number(r.tonnage.v),
          tonnagePrecisionPct: Number(r.tonnage.p) || 5,
          tonnageFixed: r.fixed,
          grades,
        };
      });
    if (!parsedStreams.length || !parsedNodes.length) return null;
    return reconcileBilinear({ nodes: parsedNodes, streams: parsedStreams, metals: METAL_DEFS });
  }, [ran, streams, nodes]);

  const activeMeta = METALS.find(m => m.key === active)!;
  const activeMetal = result?.metals.find(m => m.key === active) ?? null;

  function loadExample() { setStreams(EXAMPLE_STREAMS); setNodes(EXAMPLE_NODES); setRan(true); }
  const setTonnage = (i: number, field: 'v' | 'p', val: string) =>
    setStreams(s => s.map((r, j) => j === i ? { ...r, tonnage: { ...r.tonnage, [field]: val } } : r));
  const setGrade = (i: number, metal: string, field: 'v' | 'p', val: string) =>
    setStreams(s => s.map((r, j) => j === i ? { ...r, grades: { ...r.grades, [metal]: { ...r.grades[metal], [field]: val } } } : r));

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-violet-500/5 border border-violet-500/20">
        <Layers size={16} className="text-violet-400 shrink-0 mt-0.5" />
        <div className="text-xs text-violet-200 space-y-1">
          <div><span className="font-semibold">Réconciliation bilinéaire (tonnage + teneur)</span> — réconcilie le PRODUIT tonnage × teneur, pas chaque composant isolément.</div>
          <div>Étage 1 : tonnages réconciliés par conservation de masse. Étage 2 : teneurs réconciliées à tonnages figés → débit métal m̂ = T̂ × â cohérent. Test χ² sur le bilan métal (AMIRA P754).</div>
        </div>
      </div>

      {/* Synthèse tonnage + par métal */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="card-sm py-2.5 border border-teal-500/30 bg-teal-500/5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-mf-txt">Tonnage</span>
            <Scale size={13} className="text-teal-400" />
          </div>
          <div className="text-[10px] text-mf-txt4 mt-0.5">t/h · support</div>
          <div className="text-sm font-bold mt-1">
            {result?.tonnage.feasible ? <span className="text-emerald-400">{formatDecimalGrouped(result.tonnage.closurePct, 1)} %</span> : <span className="text-mf-txt4">—</span>}
            <span className="text-[10px] text-mf-txt4 font-normal"> clôture</span>
          </div>
        </div>
        {METALS.map(m => {
          const mr = result?.metals.find(x => x.key === m.key) ?? null;
          const on = m.key === active;
          const gross = mr?.globalTest.grossError;
          return (
            <button key={m.key} onClick={() => setActive(m.key)}
              className={`text-left card-sm py-2.5 border transition-colors ${on ? 'border-amber-500/50 bg-amber-500/5' : 'border-mf-border hover:bg-mf-hover/40'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-mf-txt">{m.label}</span>
                {mr?.feasible && (gross
                  ? <ShieldAlert size={13} className="text-red-400" />
                  : <CheckCircle2 size={13} className="text-emerald-400" />)}
              </div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">{m.unit}</div>
              <div className="text-sm font-bold mt-1">
                {mr?.feasible ? <span className="text-emerald-400">{formatDecimalGrouped(mr.metalClosurePct, 1)} %</span> : <span className="text-mf-txt4">—</span>}
                <span className="text-[10px] text-mf-txt4 font-normal"> métal</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Flux : tonnage (toujours) + teneur du métal ACTIF */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="section-title flex items-center gap-2"><Beaker size={15} className="text-amber-400" /> Flux · tonnage (t/h) + <span className="text-amber-300">teneur {activeMeta.label} ({activeMeta.unit})</span></div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={loadExample}>Charger l'exemple</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStreams(s => [...s, emptyStream()])}><Plus size={13} /> Flux</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-3">ID flux</th>
                <th className="py-2 pr-3">Libellé</th>
                <th className="py-2 pr-3 text-right">Tonnage (t/h)</th>
                <th className="py-2 pr-3 text-right">Préc. %</th>
                <th className="py-2 pr-3 text-right">Teneur {activeMeta.label} ({activeMeta.unit})</th>
                <th className="py-2 pr-3 text-right">Préc. %</th>
                <th className="py-2 pr-3 text-center">Réf. figée</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {streams.map((row, i) => (
                <tr key={i} className="border-b border-mf-border/30">
                  <td className="py-1.5 pr-3"><input className="input-field font-mono text-xs py-1" value={row.id} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, id: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input className="input-field text-xs py-1" value={row.label} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" placeholder="—" value={row.tonnage.v} onChange={e => setTonnage(i, 'v', e.target.value)} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" value={row.tonnage.p} onChange={e => setTonnage(i, 'p', e.target.value)} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" placeholder="—" value={row.grades[active].v} onChange={e => setGrade(i, active, 'v', e.target.value)} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" value={row.grades[active].p} onChange={e => setGrade(i, active, 'p', e.target.value)} /></td>
                  <td className="py-1.5 pr-3 text-center"><input type="checkbox" checked={row.fixed} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, fixed: e.target.checked } : r))} /></td>
                  <td className="py-1.5"><button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => setStreams(s => s.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-mf-txt4 mt-2">Astuce : changez de métal (cartes ci-dessus) pour saisir ses teneurs. « Réf. figée » rend le tonnage du flux non ajustable (pesée de référence).</div>
      </div>

      {/* Nœuds de bilan */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title flex items-center gap-2"><Layers size={15} className="text-teal-400" /> Nœuds de bilan (conservation entrée = sortie)</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setNodes(n => [...n, emptyNode()])}><Plus size={13} /> Nœud</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-3">ID nœud</th><th className="py-2 pr-3">Libellé</th>
                <th className="py-2 pr-3">Flux entrants (ids, virgule)</th><th className="py-2 pr-3">Flux sortants (ids, virgule)</th><th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((row, i) => (
                <tr key={i} className="border-b border-mf-border/30">
                  <td className="py-1.5 pr-3"><input className="input-field font-mono text-xs py-1" value={row.id} onChange={e => setNodes(n => n.map((r, j) => j === i ? { ...r, id: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input className="input-field text-xs py-1" value={row.label} onChange={e => setNodes(n => n.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input className="input-field font-mono text-xs py-1" value={row.inputs} onChange={e => setNodes(n => n.map((r, j) => j === i ? { ...r, inputs: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input className="input-field font-mono text-xs py-1" value={row.outputs} onChange={e => setNodes(n => n.map((r, j) => j === i ? { ...r, outputs: e.target.value } : r))} /></td>
                  <td className="py-1.5"><button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => setNodes(n => n.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3"><button className="btn btn-primary btn-sm" onClick={() => setRan(true)}><Play size={13} /> Réconcilier (tonnage + teneurs)</button></div>
      </div>

      {/* Résultats du métal actif */}
      {activeMetal && activeMetal.feasible && (
        <>
          <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${activeMetal.globalTest.grossError ? 'bg-red-500/5 border-red-500/30' : 'bg-emerald-500/5 border-emerald-500/30'}`}>
            {activeMetal.globalTest.grossError ? <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />}
            <div className="text-xs space-y-1">
              <div className={activeMetal.globalTest.grossError ? 'text-red-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                {activeMeta.label} — test bilan métal : γ = {formatDecimalGrouped(activeMetal.globalTest.statistic, 1)} vs seuil χ²₉₅ = {formatDecimalGrouped(activeMetal.globalTest.threshold, 1)} ({activeMetal.globalTest.dof} ddl){' — '}{activeMetal.globalTest.grossError ? 'erreur grossière détectée' : 'bilan métal cohérent'}
              </div>
              {activeMetal.notes.map((n, i) => <div key={i} className="text-mf-txt3">{n}</div>)}
              <div className="text-mf-txt4">Clôture métal après réconciliation : {formatDecimalGrouped(activeMetal.metalClosurePct, 1)} %</div>
            </div>
          </div>

          {activeMetal.worstAssay && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertTriangle size={14} className="shrink-0" />
              Analyse la plus suspecte ({activeMeta.label}) : <span className="font-semibold">{activeMetal.worstAssay.label ?? activeMetal.worstAssay.id}</span>{' '}(score {formatDecimalGrouped(activeMetal.worstAssay.score, 2)}) — à re-doser avant usage financier.
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="section-title mb-3">Teneurs réconciliées — {activeMeta.label} ({activeMeta.unit}) · débit métal m̂ = T̂ × â</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                    <th className="py-2 pr-3">Flux</th>
                    <th className="py-2 pr-3 text-right">T̂ (t/h)</th>
                    <th className="py-2 pr-3 text-right">Teneur mes.</th>
                    <th className="py-2 pr-3 text-right">Teneur réc.</th>
                    <th className="py-2 pr-3 text-right">Écart %</th>
                    <th className="py-2 pr-3 text-right">Métal m̂</th>
                    <th className="py-2 pr-3">Analyse</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMetal.grades.map(g => (
                    <tr key={g.id} className={`border-b border-mf-border/30 ${g.isSuspect ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 pr-3 text-mf-txt2">{g.label}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(g.reconciledTonnage, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(g.measuredGrade, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-400">{formatDecimalGrouped(g.reconciledGrade, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{g.gradeAdjustmentPct >= 0 ? '+' : ''}{formatDecimalGrouped(g.gradeAdjustmentPct, 1)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt2">{formatDecimalGrouped(g.reconciledMetalFlow, 1)}</td>
                      <td className="py-2 pr-3">{g.isSuspect ? <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-400">suspecte ({formatDecimalGrouped(g.suspicionScore, 1)})</span> : <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400">ok</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeMetal && !activeMetal.feasible && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 text-xs text-amber-300">
          <AlertTriangle size={14} /> {activeMeta.label} : {activeMetal.notes.join(' ')}
        </div>
      )}
    </div>
  );
}
