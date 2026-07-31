// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation réseau (WLS) — onglet Réconciliation du COS.
//
// Va plus loin que le calcul feed/product/tail : l'ingénieur décrit son circuit
// (flux mesurés + nœuds de bilan), le moteur WLS ajuste les mesures au minimum
// pour boucler chaque nœud, pondéré par la précision, et désigne le capteur
// suspect en cas d'erreur grossière. Standard AMIRA P754 / metal accounting.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import {
  Network, Play, Plus, Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Beaker,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { reconcile, type ReconNode, type ReconStream } from '../../lib/reconciliation/wls';

interface StreamRow {
  id: string;
  label: string;
  measured: string;
  precisionPct: string;
  fixed: boolean;
}

interface NodeRow {
  id: string;
  label: string;
  inputs: string;   // ids séparés par virgule
  outputs: string;
}

// Exemple de démonstration : broyage → flottation → lixiviation, volontairement
// déséquilibré pour montrer l'ajustement et la détection de biais.
const EXAMPLE_STREAMS: StreamRow[] = [
  { id: 'feed',         label: 'Alimentation ROM',   measured: '100', precisionPct: '2',  fixed: false },
  { id: 'ground',       label: 'Produit broyage',    measured: '99',  precisionPct: '3',  fixed: false },
  { id: 'conc',         label: 'Concentré flottation', measured: '30', precisionPct: '5', fixed: false },
  { id: 'rougher_tail', label: 'Rejet ébauchage',    measured: '66',  precisionPct: '5',  fixed: false },
  { id: 'loaded',       label: 'Charbon chargé',     measured: '2',   precisionPct: '8',  fixed: false },
  { id: 'leach_tail',   label: 'Rejet lixiviation',  measured: '27',  precisionPct: '5',  fixed: false },
];
const EXAMPLE_NODES: NodeRow[] = [
  { id: 'grind', label: 'Broyage',     inputs: 'feed',   outputs: 'ground' },
  { id: 'float', label: 'Flottation',  inputs: 'ground', outputs: 'conc, rougher_tail' },
  { id: 'leach', label: 'Lixiviation', inputs: 'conc',   outputs: 'loaded, leach_tail' },
];

const emptyStream = (): StreamRow => ({ id: '', label: '', measured: '', precisionPct: '5', fixed: false });
const emptyNode = (): NodeRow => ({ id: '', label: '', inputs: '', outputs: '' });

export function WlsReconciliationPanel() {
  const [streams, setStreams] = useState<StreamRow[]>(EXAMPLE_STREAMS);
  const [nodes, setNodes] = useState<NodeRow[]>(EXAMPLE_NODES);
  const [ran, setRan] = useState(true);

  const parsed = useMemo(() => {
    const s: ReconStream[] = streams
      .filter(r => r.id.trim() && r.measured.trim() !== '')
      .map(r => ({
        id: r.id.trim(),
        label: r.label.trim() || r.id.trim(),
        measured: Number(r.measured),
        precisionPct: Number(r.precisionPct) || 5,
        fixed: r.fixed,
      }));
    const n: ReconNode[] = nodes
      .filter(r => r.id.trim())
      .map(r => ({
        id: r.id.trim(),
        label: r.label.trim() || r.id.trim(),
        inputs: r.inputs.split(',').map(x => x.trim()).filter(Boolean),
        outputs: r.outputs.split(',').map(x => x.trim()).filter(Boolean),
      }));
    return { s, n };
  }, [streams, nodes]);

  const result = useMemo(
    () => (ran && parsed.s.length && parsed.n.length ? reconcile(parsed.n, parsed.s) : null),
    [ran, parsed],
  );

  function loadExample() {
    setStreams(EXAMPLE_STREAMS);
    setNodes(EXAMPLE_NODES);
    setRan(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <Network size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <div><span className="font-semibold">Réconciliation réseau (moindres carrés pondérés)</span> — ajuste les débits mesurés au minimum pour boucler chaque nœud de bilan.</div>
          <div>Un flux est d'autant moins corrigé que sa mesure est précise. Le test global (χ²) et le test par capteur signalent une erreur grossière et désignent le capteur suspect (AMIRA P754).</div>
        </div>
      </div>

      {/* Flux mesurés */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title flex items-center gap-2"><Beaker size={15} className="text-amber-400" /> Flux mesurés</div>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={loadExample}>Charger l'exemple</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStreams(s => [...s, emptyStream()])}>
              <Plus size={13} /> Flux
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-3">ID flux</th>
                <th className="py-2 pr-3">Libellé</th>
                <th className="py-2 pr-3 text-right">Mesuré (t/h)</th>
                <th className="py-2 pr-3 text-right">Précision %</th>
                <th className="py-2 pr-3 text-center">Réf. figée</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {streams.map((row, i) => (
                <tr key={i} className="border-b border-mf-border/30">
                  <td className="py-1.5 pr-3"><input className="input-field font-mono text-xs py-1" value={row.id} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, id: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input className="input-field text-xs py-1" value={row.label} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, label: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" value={row.measured} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, measured: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" value={row.precisionPct} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, precisionPct: e.target.value } : r))} /></td>
                  <td className="py-1.5 pr-3 text-center"><input type="checkbox" checked={row.fixed} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, fixed: e.target.checked } : r))} /></td>
                  <td className="py-1.5"><button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => setStreams(s => s.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Nœuds de bilan */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title flex items-center gap-2"><Network size={15} className="text-teal-400" /> Nœuds de bilan (conservation entrée = sortie)</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setNodes(n => [...n, emptyNode()])}><Plus size={13} /> Nœud</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-3">ID nœud</th>
                <th className="py-2 pr-3">Libellé</th>
                <th className="py-2 pr-3">Flux entrants (ids, virgule)</th>
                <th className="py-2 pr-3">Flux sortants (ids, virgule)</th>
                <th className="py-2"></th>
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
        <div className="mt-3">
          <button className="btn btn-primary btn-sm" onClick={() => setRan(true)}>
            <Play size={13} /> Réconcilier le réseau
          </button>
        </div>
      </div>

      {/* Résultats */}
      {result && result.feasible && (
        <>
          {/* Test global */}
          <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${
            result.globalTest.gerossError
              ? 'bg-red-500/5 border-red-500/30'
              : 'bg-emerald-500/5 border-emerald-500/30'
          }`}>
            {result.globalTest.gerossError
              ? <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" />
              : <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />}
            <div className="text-xs space-y-1">
              <div className={result.globalTest.gerossError ? 'text-red-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                Test global : γ = {formatDecimalGrouped(result.globalTest.statistic, 1)} vs seuil χ²₉₅ = {formatDecimalGrouped(result.globalTest.threshold, 1)} ({result.globalTest.dof} ddl)
                {' — '}{result.globalTest.gerossError ? 'erreur grossière détectée' : 'circuit cohérent'}
              </div>
              {result.notes.map((n, i) => <div key={i} className="text-mf-txt3">{n}</div>)}
              <div className="text-mf-txt4">Clôture du circuit après réconciliation : {formatDecimalGrouped(result.closurePct, 1)} %</div>
            </div>
          </div>

          {/* Capteur suspect */}
          {result.worstSensor && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertTriangle size={14} className="shrink-0" />
              Capteur le plus suspect : <span className="font-semibold">{result.worstSensor.label ?? result.worstSensor.id}</span>
              {' '}(score {formatDecimalGrouped(result.worstSensor.score, 2)} &gt; 1,96) — à vérifier / recalibrer avant usage financier.
            </div>
          )}

          {/* Flux réconciliés */}
          <div className="card overflow-hidden">
            <div className="section-title mb-3">Débits réconciliés</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                    <th className="py-2 pr-3">Flux</th>
                    <th className="py-2 pr-3 text-right">Mesuré</th>
                    <th className="py-2 pr-3 text-right">Réconcilié</th>
                    <th className="py-2 pr-3 text-right">Ajustement</th>
                    <th className="py-2 pr-3 text-right">Écart %</th>
                    <th className="py-2 pr-3">Capteur</th>
                  </tr>
                </thead>
                <tbody>
                  {result.streams.map(s => (
                    <tr key={s.id} className={`border-b border-mf-border/30 ${s.isSuspect ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 pr-3 text-mf-txt2">{s.label}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(s.measured, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-400">{formatDecimalGrouped(s.reconciled, 2)}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${Math.abs(s.adjustment) > 0.01 ? 'text-amber-400' : 'text-mf-txt4'}`}>
                        {s.adjustment >= 0 ? '+' : ''}{formatDecimalGrouped(s.adjustment, 2)}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{s.adjustmentPct >= 0 ? '+' : ''}{formatDecimalGrouped(s.adjustmentPct, 1)}</td>
                      <td className="py-2 pr-3">
                        {s.isSuspect
                          ? <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-400">suspect ({formatDecimalGrouped(s.suspicionScore, 1)})</span>
                          : <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400">ok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {result && !result.feasible && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-500/10 text-xs text-amber-300">
          <AlertTriangle size={14} /> {result.notes.join(' ')}
        </div>
      )}
    </div>
  );
}
