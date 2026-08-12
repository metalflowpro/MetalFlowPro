// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation réseau MULTI-COMPOSANT (WLS) — onglet Réconciliation du COS.
//
// L'ingénieur décrit son circuit UNE fois (flux + nœuds de bilan), puis saisit,
// pour chaque COMPOSANT conservé (solides, eau, or, cyanure), la mesure d'usine
// et son incertitude par flux. Le moteur WLS ajuste chaque composant au minimum
// pour boucler chaque nœud, pondéré par la précision, et désigne le capteur
// suspect en cas d'erreur grossière (AMIRA P754 / metal accounting).
//
// Les flux propres à un composant (ex. ajout de NaCN) n'ont de mesure que pour
// CE composant : ils ne participent qu'à sa réconciliation (le moteur ignore un
// id de flux absent du composant courant).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo } from 'react';
import {
  Network, Play, Plus, Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Beaker, Filter,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { reconcile, type ReconNode, type ReconStream, type ReconResult } from '../../lib/reconciliation/wls';
import { eliminateGrossErrorsSerial, type SerialEliminationResult } from '../../lib/reconciliation/grossError';
import { ReconciliationRunsBar } from './ReconciliationRunsBar';

const COMPONENTS = [
  { key: 'solids',  label: 'Solides', unit: 't/h' },
  { key: 'water',   label: 'Eau',     unit: 'm³/h' },
  { key: 'gold',    label: 'Or',      unit: 'g/h' },
  { key: 'cyanide', label: 'Cyanure', unit: 'kg/h' },
] as const;
type CompKey = typeof COMPONENTS[number]['key'];

/** Mesure + précision par composant (chaînes pour l'édition ; vide = non mesuré). */
type CompCell = { m: string; p: string };
const cell = (m = '', p = '5'): CompCell => ({ m, p });
const emptyVals = (): Record<CompKey, CompCell> => ({ solids: cell(), water: cell(), gold: cell(), cyanide: cell() });

interface StreamRow {
  id: string;
  label: string;
  fixed: boolean;
  v: Record<CompKey, CompCell>;
}
interface NodeRow { id: string; label: string; inputs: string; outputs: string; }

// Exemple : broyage → flottation → lixiviation, avec ajout de NaCN à la lixiviation
// (flux propre au cyanure). Petits déséquilibres volontaires → ajustements visibles.
const EXAMPLE_STREAMS: StreamRow[] = [
  { id: 'feed',         label: 'Alimentation ROM',     fixed: false, v: { solids: cell('100','2'), water: cell('130','5'), gold: cell('500','6'), cyanide: cell() } },
  { id: 'ground',       label: 'Produit broyage',      fixed: false, v: { solids: cell('99','3'),  water: cell('130','5'), gold: cell('498','6'), cyanide: cell() } },
  { id: 'conc',         label: 'Concentré flottation', fixed: false, v: { solids: cell('30','5'),  water: cell('45','5'),  gold: cell('450','5'), cyanide: cell() } },
  { id: 'rougher_tail', label: 'Rejet ébauchage',      fixed: false, v: { solids: cell('66','5'),  water: cell('85','5'),  gold: cell('48','8'),  cyanide: cell() } },
  { id: 'cn_add',       label: 'Ajout NaCN',           fixed: false, v: { solids: cell(),          water: cell(),          gold: cell(),          cyanide: cell('25','5') } },
  { id: 'loaded',       label: 'Charbon chargé',       fixed: false, v: { solids: cell('2','8'),   water: cell('3','8'),   gold: cell('440','5'), cyanide: cell('3','8') } },
  { id: 'leach_tail',   label: 'Rejet lixiviation',    fixed: false, v: { solids: cell('27','5'),  water: cell('42','5'),  gold: cell('10','8'),  cyanide: cell('22','6') } },
];
const EXAMPLE_NODES: NodeRow[] = [
  { id: 'grind', label: 'Broyage',     inputs: 'feed',         outputs: 'ground' },
  { id: 'float', label: 'Flottation',  inputs: 'ground',       outputs: 'conc, rougher_tail' },
  { id: 'leach', label: 'Lixiviation', inputs: 'conc, cn_add', outputs: 'loaded, leach_tail' },
];

const emptyStream = (): StreamRow => ({ id: '', label: '', fixed: false, v: emptyVals() });
const emptyNode = (): NodeRow => ({ id: '', label: '', inputs: '', outputs: '' });

export function WlsReconciliationPanel({ projectId }: { projectId?: string }) {
  const [streams, setStreams] = useState<StreamRow[]>(EXAMPLE_STREAMS);
  const [nodes, setNodes] = useState<NodeRow[]>(EXAMPLE_NODES);
  const [active, setActive] = useState<CompKey>('solids');
  const [ran, setRan] = useState(true);
  const [serial, setSerial] = useState(false);

  const parsedNodes = useMemo<ReconNode[]>(() => nodes
    .filter(r => r.id.trim())
    .map(r => ({
      id: r.id.trim(),
      label: r.label.trim() || r.id.trim(),
      inputs: r.inputs.split(',').map(x => x.trim()).filter(Boolean),
      outputs: r.outputs.split(',').map(x => x.trim()).filter(Boolean),
    })), [nodes]);

  const streamsFor = (comp: CompKey): ReconStream[] => streams
    .filter(r => r.id.trim() && r.v[comp].m.trim() !== '')
    .map(r => ({
      id: r.id.trim(),
      label: r.label.trim() || r.id.trim(),
      measured: Number(r.v[comp].m),
      precisionPct: Number(r.v[comp].p) || 5,
      fixed: r.fixed,
    }));

  // Réconciliation de CHAQUE composant.
  const results = useMemo<Record<CompKey, ReconResult | null>>(() => {
    const out = {} as Record<CompKey, ReconResult | null>;
    for (const c of COMPONENTS) {
      const s = streamsFor(c.key);
      out[c.key] = ran && s.length && parsedNodes.length ? reconcile(parsedNodes, s) : null;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ran, streams, parsedNodes]);

  const result = results[active];
  const activeMeta = COMPONENTS.find(c => c.key === active)!;

  // Élimination sérielle (P754) du composant ACTIF, à la demande.
  const serialResult = useMemo<SerialEliminationResult | null>(() => {
    if (!serial || !ran) return null;
    const s = streamsFor(active);
    return s.length && parsedNodes.length ? eliminateGrossErrorsSerial(parsedNodes, s) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial, ran, active, streams, parsedNodes]);

  function loadExample() { setStreams(EXAMPLE_STREAMS); setNodes(EXAMPLE_NODES); setRan(true); }
  const setCell = (i: number, comp: CompKey, field: 'm' | 'p', val: string) =>
    setStreams(s => s.map((r, j) => j === i ? { ...r, v: { ...r.v, [comp]: { ...r.v[comp], [field]: val } } } : r));

  // Sauvegarde/rechargement de scénario (piste d'audit P754).
  const getInput = () => ({ streams, nodes, serial });
  const getSummary = () => ({
    components: COMPONENTS.map(c => {
      const r = results[c.key];
      return r ? { key: c.key, closurePct: r.closurePct, grossError: r.globalTest.gerossError, worstSensor: r.worstSensor?.id ?? null } : { key: c.key, empty: true };
    }),
    serial,
  });
  const onLoad = (input: Record<string, unknown>) => {
    const inp = input as { streams?: StreamRow[]; nodes?: NodeRow[]; serial?: boolean };
    if (Array.isArray(inp.streams)) setStreams(inp.streams);
    if (Array.isArray(inp.nodes)) setNodes(inp.nodes);
    setSerial(Boolean(inp.serial));
    setRan(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <Network size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <div><span className="font-semibold">Réconciliation réseau multi-composant (moindres carrés pondérés)</span> — ferme le bilan de chaque composant (solides, eau, or, cyanure) sur le même circuit.</div>
          <div>Un flux est d'autant moins corrigé que sa mesure est précise. Un flux sans mesure pour un composant (ex. ajout NaCN) ne participe qu'aux composants où il est renseigné. Test global χ² et test capteur : AMIRA P754.</div>
        </div>
      </div>

      {projectId && (
        <ReconciliationRunsBar
          projectId={projectId} method={serial ? 'serial' : 'network'}
          getInput={getInput} getSummary={getSummary} onLoad={onLoad} />
      )}

      {/* Synthèse par composant */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {COMPONENTS.map(c => {
          const r = results[c.key];
          const on = c.key === active;
          const gross = r?.globalTest.gerossError;
          return (
            <button key={c.key} onClick={() => setActive(c.key)}
              className={`text-left card-sm py-2.5 border transition-colors ${on ? 'border-amber-500/50 bg-amber-500/5' : 'border-mf-border hover:bg-mf-hover/40'}`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-mf-txt">{c.label}</span>
                {r && (gross
                  ? <ShieldAlert size={13} className="text-red-400" />
                  : <CheckCircle2 size={13} className="text-emerald-400" />)}
              </div>
              <div className="text-[10px] text-mf-txt4 mt-0.5">{c.unit}</div>
              <div className="text-sm font-bold mt-1">
                {r ? <span className={r.feasible ? 'text-emerald-400' : 'text-amber-400'}>{formatDecimalGrouped(r.closurePct, 1)} %</span> : <span className="text-mf-txt4">—</span>}
                <span className="text-[10px] text-mf-txt4 font-normal"> clôture</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Flux mesurés — colonnes Mesuré/Précision liées au composant ACTIF */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="section-title flex items-center gap-2"><Beaker size={15} className="text-amber-400" /> Flux mesurés · <span className="text-amber-300">{activeMeta.label} ({activeMeta.unit})</span></div>
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
                <th className="py-2 pr-3 text-right">Mesuré ({activeMeta.unit})</th>
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
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" placeholder="—" value={row.v[active].m} onChange={e => setCell(i, active, 'm', e.target.value)} /></td>
                  <td className="py-1.5 pr-3"><input type="number" className="input-field font-mono text-xs py-1 text-right" value={row.v[active].p} onChange={e => setCell(i, active, 'p', e.target.value)} /></td>
                  <td className="py-1.5 pr-3 text-center"><input type="checkbox" checked={row.fixed} onChange={e => setStreams(s => s.map((r, j) => j === i ? { ...r, fixed: e.target.checked } : r))} /></td>
                  <td className="py-1.5"><button className="text-mf-txt4 hover:text-red-400 p-1" onClick={() => setStreams(s => s.filter((_, j) => j !== i))}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-mf-txt4 mt-2">Astuce : changez de composant (cartes ci-dessus) pour saisir ses mesures. Laissez « Mesuré » vide si un flux ne concerne pas ce composant.</div>
      </div>

      {/* Nœuds de bilan (partagés) */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="section-title flex items-center gap-2"><Network size={15} className="text-teal-400" /> Nœuds de bilan (conservation entrée = sortie)</div>
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
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary btn-sm" onClick={() => setRan(true)}><Play size={13} /> Réconcilier tous les composants</button>
          <button
            className={`btn btn-sm ${serial ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setSerial(s => !s); setRan(true); }}
            title="Retire itérativement le capteur le plus suspect jusqu'à ce que le test global passe (AMIRA P754).">
            <Filter size={13} /> Élimination sérielle {serial ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Résultats du composant actif */}
      {result && result.feasible && (
        <>
          <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${result.globalTest.gerossError ? 'bg-red-500/5 border-red-500/30' : 'bg-emerald-500/5 border-emerald-500/30'}`}>
            {result.globalTest.gerossError ? <ShieldAlert size={16} className="text-red-400 shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />}
            <div className="text-xs space-y-1">
              <div className={result.globalTest.gerossError ? 'text-red-300 font-semibold' : 'text-emerald-300 font-semibold'}>
                {activeMeta.label} — test global : γ = {formatDecimalGrouped(result.globalTest.statistic, 1)} vs seuil χ²₉₅ = {formatDecimalGrouped(result.globalTest.threshold, 1)} ({result.globalTest.dof} ddl){' — '}{result.globalTest.gerossError ? 'erreur grossière détectée' : 'circuit cohérent'}
              </div>
              {result.notes.map((n, i) => <div key={i} className="text-mf-txt3">{n}</div>)}
              <div className="text-mf-txt4">Clôture après réconciliation : {formatDecimalGrouped(result.closurePct, 1)} %</div>
            </div>
          </div>

          {result.worstSensor && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertTriangle size={14} className="shrink-0" />
              Capteur le plus suspect ({activeMeta.label}) : <span className="font-semibold">{result.worstSensor.label ?? result.worstSensor.id}</span>{' '}(score {formatDecimalGrouped(result.worstSensor.score, 2)}) — à vérifier / recalibrer avant usage financier.
            </div>
          )}

          {/* Élimination sérielle des erreurs grossières (P754) */}
          {serial && serialResult && serialResult.initialGrossError && (
            <div className={`card overflow-hidden border ${serialResult.cleared ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
              <div className="section-title mb-2 flex items-center gap-2">
                <Filter size={14} className="text-blue-400" /> Élimination sérielle (AMIRA P754) — {activeMeta.label}
              </div>
              <div className="text-xs text-mf-txt3 mb-3">
                {serialResult.cleared
                  ? <span className="text-emerald-300">Circuit assaini après {serialResult.eliminated.length} retrait(s) — le test global passe.</span>
                  : <span className="text-red-300">Erreur grossière persistante après {serialResult.eliminated.length} retrait(s).</span>}
              </div>
              {serialResult.eliminated.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                        <th className="py-1.5 pr-3">#</th><th className="py-1.5 pr-3">Capteur retiré</th>
                        <th className="py-1.5 pr-3 text-right">Score</th><th className="py-1.5 pr-3 text-right">γ avant</th><th className="py-1.5 pr-3 text-right">Seuil χ²</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serialResult.eliminated.map((e, i) => (
                        <tr key={e.id} className="border-b border-mf-border/30">
                          <td className="py-1.5 pr-3 text-mf-txt4">{i + 1}</td>
                          <td className="py-1.5 pr-3 text-mf-txt2 font-medium">{e.label ?? e.id}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-red-400">{formatDecimalGrouped(e.score, 2)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(e.gammaBefore, 1)}</td>
                          <td className="py-1.5 pr-3 text-right font-mono text-mf-txt4">{formatDecimalGrouped(e.thresholdBefore, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-amber-300">Aucun capteur isolé désigné — biais multiples ou topologie à vérifier.</div>
              )}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="section-title mb-3">Débits réconciliés — {activeMeta.label} ({activeMeta.unit})</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                    <th className="py-2 pr-3">Flux</th><th className="py-2 pr-3 text-right">Mesuré</th><th className="py-2 pr-3 text-right">Réconcilié</th><th className="py-2 pr-3 text-right">Ajustement</th><th className="py-2 pr-3 text-right">Écart %</th><th className="py-2 pr-3">Capteur</th>
                  </tr>
                </thead>
                <tbody>
                  {result.streams.map(s => (
                    <tr key={s.id} className={`border-b border-mf-border/30 ${s.isSuspect ? 'bg-red-500/5' : ''}`}>
                      <td className="py-2 pr-3 text-mf-txt2">{s.label}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{formatDecimalGrouped(s.measured, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-emerald-400">{formatDecimalGrouped(s.reconciled, 2)}</td>
                      <td className={`py-2 pr-3 text-right font-mono ${Math.abs(s.adjustment) > 0.01 ? 'text-amber-400' : 'text-mf-txt4'}`}>{s.adjustment >= 0 ? '+' : ''}{formatDecimalGrouped(s.adjustment, 2)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-mf-txt3">{s.adjustmentPct >= 0 ? '+' : ''}{formatDecimalGrouped(s.adjustmentPct, 1)}</td>
                      <td className="py-2 pr-3">{s.isSuspect ? <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-400">suspect ({formatDecimalGrouped(s.suspicionScore, 1)})</span> : <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-emerald-500/10 text-emerald-400">ok</span>}</td>
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
          <AlertTriangle size={14} /> {activeMeta.label} : {result.notes.join(' ')}
        </div>
      )}
    </div>
  );
}
