import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import FlowsheetCanvas, {
  RFNode as Node, RFEdge as Edge, RFConnection as Connection,
  addEdge, useNodesState, useEdgesState,
} from '../components/simulation/FlowsheetCanvas';
import {
  Play, Save, AlertCircle, CheckCircle,
  TrendingUp, Zap, DollarSign, Gauge, Activity, Plus, Settings,
  BarChart3, Layers, RefreshCw, Target, Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import NodeConfigPanel from '../components/simulation/NodeConfigPanel';
import { solveFlowsheet, analyzeBottlenecks } from '../lib/simulation/engine';
import { runOptimization } from '../lib/simulation/optimizer';
import { computeScenarioEconomics, formatCurrency, formatOz } from '../lib/simulation/economics';
import { getUnit } from '../lib/simulation/unitRegistry';
import { useProject } from '../lib/ProjectContext';
import {
  ProcessNode, StreamEdge, FeedInput, SimRunResult, GlobalResults,
  NodeResult, StreamResult, OreType, ExpansionScenario, ScenarioModification,
  OptimizationResults,
} from '../lib/simulation/types';

interface Props { project: { id: string; name: string } }

// Feed defaults for a project whose testwork isn't wired in: débit and teneur
// come from the active project (Projet owns them); the rest stay generic, editable
// placeholders. Nothing here is a fixed 500 t/h — it follows the project.
function feedFromProject(p: { target_tph: number; gold_grade_g_t: number }): FeedInput {
  return {
    feed_rate: p.target_tph || 500,
    gold_grade: p.gold_grade_g_t || 2.5,
    silver_grade: 15, p80: 150,
    hardness_bwi: 14, ore_type: 'free_milling', sulphide_content: 5,
    carbon_content: 0.1, moisture: 8,
  };
}

function toRFNode(pn: ProcessNode): Node {
  const unit = getUnit(pn.unit_type);
  return {
    id: pn.id, type: 'processNode',
    position: { x: pn.position_x, y: pn.position_y },
    data: { label: pn.label ?? pn.unit_type, unit_type: pn.unit_type, color: unit?.color ?? '#64748b' },
  };
}

function toRFEdge(se: StreamEdge): Edge {
  return {
    id: se.id, source: se.source_node_id, target: se.target_node_id,
    label: se.stream_label, type: 'smoothstep',
    style: { stroke: '#64748b', strokeWidth: 2 },
  };
}

export default function Simulation({ project }: Props) {
  const { project: fullProject } = useProject();
  const [tab, setTab] = useState<'canvas' | 'params' | 'run' | 'results' | 'expansion' | 'optim'>('canvas');

  const [flowsheetId, setFlowsheetId] = useState<string | null>(null);
  const [flowsheetName, setFlowsheetName] = useState('Flowsheet principal');
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [processNodes, setProcessNodes] = useState<ProcessNode[]>([]);
  const [streamEdges, setStreamEdges] = useState<StreamEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const [feed, setFeed] = useState<FeedInput>(() => feedFromProject(fullProject));
  // Re-seed the feed from the project on a project switch; a manual edit within the
  // same project is preserved. Keyed on project.id so switching always resets.
  const feedTouched = useRef(false);
  useEffect(() => {
    feedTouched.current = false;
    setFeed(feedFromProject(fullProject));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const [isRunning, setIsRunning] = useState(false);
  const [lastRun, setLastRun] = useState<SimRunResult | null>(null);
  const [globalResults, setGlobalResults] = useState<GlobalResults | null>(null);
  const [nodeResults, setNodeResults] = useState<Record<string, NodeResult>>({});
  const [streamResults, setStreamResults] = useState<Record<string, StreamResult>>({});
  const [runHistory, setRunHistory] = useState<SimRunResult[]>([]);

  const [scenarios, setScenarios] = useState<ExpansionScenario[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFlowsheet();
    loadRunHistory();
    loadScenarios();
  }, [project.id]);

  async function loadFlowsheet() {
    setLoading(true);
    try {
      const { data: fs } = await supabase
        .from('sim_flowsheets')
        .select('*')
        .eq('project_id', project.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fs) { setLoading(false); return; }
      setFlowsheetId(fs.id);
      setFlowsheetName(fs.name);

      const [{ data: dbNodes }, { data: dbEdges }] = await Promise.all([
        supabase.from('sim_nodes').select('*').eq('flowsheet_id', fs.id),
        supabase.from('sim_edges').select('*').eq('flowsheet_id', fs.id),
      ]);

      const pNodes: ProcessNode[] = ((dbNodes ?? []) as ProcessNode[]).map((n) => ({
        id: n.id, flowsheet_id: n.flowsheet_id, project_id: n.project_id,
        unit_type: n.unit_type, label: n.label,
        position_x: n.position_x, position_y: n.position_y,
        parameters: n.parameters ?? {},
        design_capacity: n.design_capacity,
        availability_pct: n.availability_pct,
      }));

      const sEdges: StreamEdge[] = ((dbEdges ?? []) as StreamEdge[]).map((e) => ({
        id: e.id, flowsheet_id: e.flowsheet_id, project_id: e.project_id,
        source_node_id: e.source_node_id, target_node_id: e.target_node_id,
        stream_type: e.stream_type ?? 'pulp', stream_label: e.stream_label,
      }));

      setProcessNodes(pNodes);
      setStreamEdges(sEdges);
      setNodes(pNodes.map(toRFNode));
      setEdges(sEdges.map(toRFEdge));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }

  async function loadRunHistory() {
    const { data } = await supabase
      .from('sim_run_results')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setRunHistory(data as SimRunResult[]);
  }

  async function loadScenarios() {
    const { data } = await supabase
      .from('sim_expansion_scenarios')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    if (data) setScenarios(data as ExpansionScenario[]);
  }

  async function saveFlowsheet() {
    setSaving(true);
    try {
      let fsId = flowsheetId;
      if (!fsId) {
        const { data: newFs, error: fsErr } = await supabase
          .from('sim_flowsheets')
          .insert({ project_id: project.id, name: flowsheetName, version: 1, status: 'draft' })
          .select().single();
        if (fsErr) throw fsErr;
        fsId = newFs.id;
        setFlowsheetId(fsId);
      } else {
        await supabase.from('sim_flowsheets').update({ name: flowsheetName, updated_at: new Date().toISOString() }).eq('id', fsId).eq('project_id', project.id);
      }

      await supabase.from('sim_edges').delete().eq('flowsheet_id', fsId).eq('project_id', project.id);
      await supabase.from('sim_nodes').delete().eq('flowsheet_id', fsId).eq('project_id', project.id);

      const posMap = new Map(nodes.map(n => [n.id, n.position]));

      if (processNodes.length > 0) {
        await supabase.from('sim_nodes').insert(processNodes.map(pn => ({
          id: pn.id, flowsheet_id: fsId, project_id: project.id,
          unit_type: pn.unit_type, label: pn.label,
          position_x: posMap.get(pn.id)?.x ?? pn.position_x,
          position_y: posMap.get(pn.id)?.y ?? pn.position_y,
          parameters: pn.parameters,
          design_capacity: pn.design_capacity,
          availability_pct: pn.availability_pct,
        })));
      }
      if (streamEdges.length > 0) {
        await supabase.from('sim_edges').insert(streamEdges.map(se => ({
          id: se.id, flowsheet_id: fsId, project_id: project.id,
          source_node_id: se.source_node_id, target_node_id: se.target_node_id,
          stream_type: se.stream_type, stream_label: se.stream_label,
        })));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  }

  const handleAddNode = useCallback((unitType: string) => {
    const unit = getUnit(unitType);
    if (!unit) return;
    const id = `node_${Date.now()}`;
    const defaultParams: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(unit.defaultParameters)) {
      defaultParams[k] = v.default;
    }
    const newNode: ProcessNode = {
      id, flowsheet_id: flowsheetId ?? '', project_id: project.id,
      unit_type: unitType, label: unit.displayName,
      position_x: 200 + Math.random() * 400,
      position_y: 100 + Math.random() * 300,
      parameters: defaultParams,
      design_capacity: 500,
      availability_pct: 91,
    };
    setProcessNodes(prev => [...prev, newNode]);
    setNodes(prev => [...prev, toRFNode(newNode)]);
  }, [flowsheetId, project.id]);

  const handleUpdateNode = useCallback((nodeId: string, changes: Partial<ProcessNode>) => {
    setProcessNodes(prev => prev.map(n => n.id === nodeId ? { ...n, ...changes } : n));
    if (changes.label) {
      const nextLabel = changes.label;
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data: { ...n.data, label: nextLabel } } : n));
    }
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setProcessNodes(prev => prev.filter(n => n.id !== nodeId));
    setStreamEdges(prev => prev.filter(e => e.source_node_id !== nodeId && e.target_node_id !== nodeId));
    setNodes(prev => prev.filter(n => n.id !== nodeId));
    setEdges(prev => prev.filter(e => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId]);

  const handleConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const newEdge: StreamEdge = {
      id: `edge_${Date.now()}`,
      flowsheet_id: flowsheetId ?? '',
      project_id: project.id,
      source_node_id: connection.source,
      target_node_id: connection.target,
      stream_type: 'pulp',
    };
    setStreamEdges(prev => [...prev, newEdge]);
    setEdges(prev => addEdge({
      ...connection, id: newEdge.id, type: 'smoothstep',
      style: { stroke: '#64748b', strokeWidth: 2 },
    }, prev));
  }, [flowsheetId, project.id]);

  async function handleRunSimulation() {
    if (processNodes.length === 0) {
      setError('Ajoutez au moins une unité au flowsheet avant de lancer la simulation.');
      return;
    }
    setIsRunning(true);
    setError(null);
    try {
      const posMap = new Map(nodes.map(n => [n.id, n.position]));
      const syncedNodes = processNodes.map(pn => ({
        ...pn,
        position_x: posMap.get(pn.id)?.x ?? pn.position_x,
        position_y: posMap.get(pn.id)?.y ?? pn.position_y,
      }));

      const result = solveFlowsheet(syncedNodes, streamEdges, feed, {
        maxIterations: 100, tolerance: 1e-4, mode: 'steady_state',
      });

      setGlobalResults(result.globalResults);
      setNodeResults(result.nodeResults);
      setStreamResults(result.streams);

      const runPayload = {
        project_id: project.id,
        flowsheet_id: flowsheetId,
        mode: 'steady_state',
        feed_input: feed,
        status: result.status,
        iterations: result.iterations,
        convergence_error: result.convergenceError,
        global_results: result.globalResults,
        node_results: result.nodeResults,
        stream_results: result.streams,
      };

      const { data: runData } = await supabase
        .from('sim_run_results')
        .insert(runPayload)
        .select().single();

      if (runData) {
        setLastRun(runData as SimRunResult);
        setRunHistory(prev => [runData as SimRunResult, ...prev.slice(0, 9)]);
      }
      setTab('results');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setIsRunning(false);
  }

  const selectedProcessNode = useMemo(
    () => processNodes.find(n => n.id === selectedNodeId) ?? null,
    [processNodes, selectedNodeId]
  );

  const nodeResultsForCanvas = useMemo(() =>
    Object.fromEntries(Object.entries(nodeResults).map(([k, v]) => [k, { recovery: v.recovery }])),
    [nodeResults]
  );

  const bottlenecks = useMemo(
    () => analyzeBottlenecks(processNodes, nodeResults),
    [processNodes, nodeResults]
  );

  const tabs = [
    { id: 'canvas', label: 'Flowsheet', icon: Layers },
    { id: 'params', label: 'Alimentation', icon: Settings },
    { id: 'run', label: 'Lancement', icon: Play },
    { id: 'results', label: 'Résultats', icon: BarChart3 },
    { id: 'expansion', label: 'Scénarios', icon: TrendingUp },
    { id: 'optim', label: 'Optimisation', icon: Target },
  ] as const;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={20} className="text-blue-400" />
          <input
            className="text-lg font-semibold text-white bg-transparent border-none outline-none"
            value={flowsheetName}
            onChange={e => setFlowsheetName(e.target.value)}
          />
          {lastRun && (
            <span className={`badge ${lastRun.status === 'converged' ? 'badge-success' : 'badge-warning'}`}>
              {lastRun.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveFlowsheet} disabled={saving} className="btn btn-secondary text-sm">
            <Save size={14} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
          <button onClick={handleRunSimulation} disabled={isRunning} className="btn btn-primary text-sm">
            {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {isRunning ? 'Calcul…' : 'Simuler'}
          </button>
        </div>
      </div>

      <div className="tab-bar flex-shrink-0">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`tab ${tab === t.id ? 'active' : ''}`}>
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 bg-red-900/30 border border-red-700 rounded-lg text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === 'canvas' && (
          <div className="flex h-full">
            <FlowsheetCanvas
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={handleConnect}
              onNodeSelect={setSelectedNodeId}
              onAddNode={handleAddNode}
              onDeleteNode={handleDeleteNode}
              nodeResults={nodeResultsForCanvas}
            />
            <NodeConfigPanel
              node={selectedProcessNode}
              onUpdate={handleUpdateNode}
              onDelete={handleDeleteNode}
            />
          </div>
        )}

        {tab === 'params' && (
          <div className="p-6 overflow-y-auto h-full">
            <div className="max-w-2xl space-y-6">
              <div className="card">
                <h3 className="section-title mb-4">Alimentation du circuit</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'feed_rate', label: 'Débit alimentation', unit: 't/h', min: 1, max: 5000, step: 10 },
                    { key: 'gold_grade', label: 'Teneur Au', unit: 'g/t', min: 0.1, max: 100, step: 0.1 },
                    { key: 'silver_grade', label: 'Teneur Ag', unit: 'g/t', min: 0, max: 1000, step: 1 },
                    { key: 'p80', label: 'P80 alimentation', unit: 'µm', min: 50, max: 5000, step: 10 },
                    { key: 'hardness_bwi', label: 'BWI (dureté)', unit: 'kWh/t', min: 5, max: 50, step: 0.5 },
                    { key: 'sulphide_content', label: 'Teneurs sulfures', unit: '%', min: 0, max: 30, step: 0.5 },
                    { key: 'carbon_content', label: 'Carbone organique', unit: '%', min: 0, max: 5, step: 0.05 },
                    { key: 'moisture', label: 'Humidité', unit: '%', min: 0, max: 25, step: 0.5 },
                  ].map(field => (
                    <div key={field.key}>
                      <label className="label">{field.label} <span className="text-slate-500">({field.unit})</span></label>
                      <input
                        type="number"
                        className="input-field"
                        value={feed[field.key as keyof FeedInput] as number}
                        min={field.min}
                        max={field.max}
                        step={field.step}
                        onChange={e => { feedTouched.current = true; setFeed(prev => ({ ...prev, [field.key]: parseFloat(e.target.value) || 0 })); }}
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="label">Type de minerai</label>
                    <select
                      className="input-field"
                      value={feed.ore_type}
                      onChange={e => { feedTouched.current = true; setFeed(prev => ({ ...prev, ore_type: e.target.value as OreType })); }}
                    >
                      <option value="free_milling">Libre broyage (Free-milling)</option>
                      <option value="refractory">Réfractaire</option>
                      <option value="sulphide">Sulfuré</option>
                      <option value="oxide">Oxydé</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'run' && (
          <div className="p-6 overflow-y-auto h-full">
            <div className="max-w-2xl space-y-4">
              <div className="card">
                <h3 className="section-title mb-3">État du circuit</h3>
                <div className="space-y-2">
                  {[
                    { label: 'Unités de procédé', value: processNodes.length },
                    { label: 'Connexions', value: streamEdges.length },
                    { label: 'Débit alimentation', value: `${feed.feed_rate} t/h` },
                    { label: 'Teneur Au', value: `${feed.gold_grade} g/t` },
                  ].map(row => (
                    <div key={row.label} className="stat-row">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="num">{row.value}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleRunSimulation}
                  disabled={isRunning || processNodes.length === 0}
                  className="btn btn-primary w-full mt-4"
                >
                  {isRunning
                    ? <><RefreshCw size={16} className="animate-spin" /> Calcul en cours…</>
                    : <><Play size={16} /> Lancer la simulation</>}
                </button>
              </div>

              {runHistory.length > 0 && (
                <div className="card">
                  <h3 className="section-title mb-3">Historique des runs</h3>
                  <div className="space-y-2">
                    {runHistory.map(run => (
                      <div key={run.id} className="flex items-center justify-between p-2 rounded bg-slate-800">
                        <div>
                          <div className="text-sm text-white">{new Date(run.created_at).toLocaleString('fr-CA')}</div>
                          <div className="text-xs text-slate-400">
                            {run.global_results?.overall_recovery?.toFixed(1)}% récup • {run.iterations} itér.
                          </div>
                        </div>
                        <span className={`badge ${run.status === 'converged' ? 'badge-success' : 'badge-warning'}`}>
                          {run.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'results' && (
          <div className="p-6 overflow-y-auto h-full">
            {!globalResults ? (
              <div className="flex items-center justify-center h-64 text-slate-500">
                Lancez une simulation pour voir les résultats
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { label: 'Récupération globale', value: `${formatDecimalGrouped(globalResults.overall_recovery, 1)}%`, icon: TrendingUp, color: 'text-emerald-400' },
                    { label: 'Production doré', value: `${formatDecimalGrouped(globalResults.dore_production_kg_h, 2)} kg/h`, icon: Gauge, color: 'text-yellow-400' },
                    { label: 'Énergie totale', value: `${formatDecimalGrouped(globalResults.total_energy_kwh_t, 1)} kWh/t`, icon: Zap, color: 'text-blue-400' },
                    { label: 'OPEX total', value: `${formatCurrency(globalResults.total_opex_per_t)}/t`, icon: DollarSign, color: 'text-rose-400' },
                  ].map(kpi => (
                    <div key={kpi.label} className="card-sm">
                      <div className="flex items-center gap-2 mb-1">
                        <kpi.icon size={14} className={kpi.color} />
                        <span className="text-xs text-slate-400">{kpi.label}</span>
                      </div>
                      <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="card">
                    <h3 className="section-title mb-3">Résultats par unité</h3>
                    <div className="space-y-2">
                      {processNodes.map(pn => {
                        const nr = nodeResults[pn.id];
                        if (!nr) return null;
                        const unit = getUnit(pn.unit_type);
                        return (
                          <div key={pn.id} className="p-2 rounded bg-slate-800">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-white flex items-center gap-1">
                                <span>{unit?.icon}</span>{pn.label}
                              </span>
                              {nr.is_bottleneck && <span className="badge badge-error text-xs">Goulot</span>}
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 text-xs text-slate-400">
                              <span>Récup: <span className="text-emerald-400">{formatDecimalGrouped(nr.recovery, 1)}%</span></span>
                              <span>Énergie: <span className="text-blue-400">{formatDecimalGrouped(nr.energy_consumption, 1)} kWh/t</span></span>
                              <span>Débit: <span className="text-white">{formatDecimalGrouped(nr.product_rate, 0)} t/h</span></span>
                              <span>Util: <span className="text-yellow-400">{formatDecimalGrouped(nr.utilization_rate, 0)}%</span></span>
                            </div>
                            <div className="progress-bar mt-1">
                              <div
                                className="progress-fill"
                                style={{
                                  width: `${nr.utilization_rate}%`,
                                  backgroundColor: nr.is_bottleneck ? '#ef4444' : nr.utilization_rate > 80 ? '#f59e0b' : '#10b981',
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="card">
                      <h3 className="section-title mb-3">Résidus & Environnement</h3>
                      <div className="space-y-2">
                        {([
                          { label: 'Teneur résidus', value: `${formatDecimalGrouped(globalResults.tails_grade, 3)} g/t` },
                          { label: 'CN dans résidus', value: `${formatDecimalGrouped(globalResults.cn_in_tailings, 1)} ppm`, danger: globalResults.cn_in_tailings > 50 },
                          { label: 'Conso. cyanure', value: `${formatDecimalGrouped(globalResults.cyanide_consumption, 2)} kg/t` },
                          { label: 'Conso. chaux', value: `${formatDecimalGrouped(globalResults.lime_consumption, 2)} kg/t` },
                        ] as { label: string; value: string; danger?: boolean }[]).map(row => (
                          <div key={row.label} className="stat-row">
                            <span className="text-slate-400">{row.label}</span>
                            <span className={`num ${row.danger ? 'text-red-400' : ''}`}>{row.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="card">
                      <h3 className="section-title mb-3">Goulots d'étranglement</h3>
                      {bottlenecks.filter(b => b.severity !== 'ok').length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-emerald-400">
                          <CheckCircle size={14} /> Aucun goulot détecté
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {bottlenecks.filter(b => b.severity !== 'ok').map(b => {
                            const pn = processNodes.find(n => n.id === b.node_id);
                            return (
                              <div key={b.node_id} className="p-2 rounded bg-slate-800 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-white">{pn?.label ?? b.node_id}</span>
                                  <span className={`badge ${b.severity === 'critical' ? 'badge-error' : 'badge-warning'}`}>
                                    {formatDecimalGrouped(b.utilization_pct, 0)}%
                                  </span>
                                </div>
                                <div className="text-slate-400 mt-1">{b.recommended_action}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'expansion' && (
          <ExpansionTab
            project={project}
            processNodes={processNodes}
            streamEdges={streamEdges}
            feed={feed}
            scenarios={scenarios}
            onRefresh={loadScenarios}
          />
        )}

        {tab === 'optim' && (
          <OptimTab
            processNodes={processNodes}
            streamEdges={streamEdges}
            feed={feed}
            onApply={(nodeId, param, value) => handleUpdateNode(nodeId, {
              parameters: { ...(processNodes.find(n => n.id === nodeId)?.parameters ?? {}), [param]: value }
            })}
          />
        )}
      </div>
    </div>
  );
}

// ─── Expansion tab ────────────────────────────────────────────────────────────

function ExpansionTab({ project, processNodes, streamEdges, feed, scenarios, onRefresh }: {
  project: { id: string };
  processNodes: ProcessNode[];
  streamEdges: StreamEdge[];
  feed: FeedInput;
  scenarios: ExpansionScenario[];
  onRefresh: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [targetPct, setTargetPct] = useState(20);
  // Defaults follow the project (Projet owns the gold price, Paramètres own the
  // LOM) instead of generic 2000 $/oz / 10 ans — editable per scenario.
  const { project: ctxProject, assumptions } = useProject();
  const [goldPrice, setGoldPrice] = useState(ctxProject.gold_price_usd);
  const [mineLife, setMineLife] = useState(assumptions.lomYears);

  async function createScenario() {
    setCreating(true);
    try {
      const modNodes = processNodes.map(pn => ({
        ...pn,
        design_capacity: (pn.design_capacity ?? 500) * (1 + targetPct / 100),
      }));

      const capexTotal = targetPct * 500000;
      const modifications: ScenarioModification[] = processNodes.map(pn => ({
        node_id: pn.id,
        modification_type: 'upsize' as const,
        parameter: 'design_capacity',
        new_value: (pn.design_capacity ?? 500) * (1 + targetPct / 100),
        capex_estimate: capexTotal / Math.max(processNodes.length, 1),
        description: `Augmenter capacité de ${pn.label} de ${targetPct}%`,
      }));

      const econ = computeScenarioEconomics({
        baseNodes: processNodes,
        modifiedNodes: modNodes,
        edges: streamEdges,
        feed,
        modifications,
        goldPriceUsdOz: goldPrice,
        availabilityFraction: 0.91,
        mineLifeYears: mineLife,
        sustainingCapexPerYear: 2000000,
      });

      await supabase.from('sim_expansion_scenarios').insert({
        project_id: project.id,
        label: label || `Expansion +${targetPct}%`,
        target_increase_pct: targetPct,
        modifications,
        economics: econ,
      });

      onRefresh();
      setLabel('');
    } catch (err: unknown) {
      console.error(err);
    }
    setCreating(false);
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-4xl space-y-4">
        <div className="card">
          <h3 className="section-title mb-4">Nouveau scénario d'expansion</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Nom du scénario</label>
              <input className="input-field" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Expansion Phase 2" />
            </div>
            <div>
              <label className="label">Augmentation de capacité (%)</label>
              <input type="number" className="input-field" value={targetPct} min={5} max={200} onChange={e => setTargetPct(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Prix de l'or ($/oz)</label>
              <input type="number" className="input-field" value={goldPrice} min={1000} max={5000} onChange={e => setGoldPrice(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Durée de vie mine (ans)</label>
              <input type="number" className="input-field" value={mineLife} min={1} max={30} onChange={e => setMineLife(Number(e.target.value))} />
            </div>
          </div>
          <button onClick={createScenario} disabled={creating || processNodes.length === 0} className="btn btn-primary mt-4">
            {creating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
            {creating ? 'Calcul…' : 'Créer le scénario'}
          </button>
        </div>

        {scenarios.map(sc => {
          const econ = sc.economics;
          if (!econ) return null;
          return (
            <div key={sc.id} className="card">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold text-white">{sc.label}</h4>
                <span className="badge badge-info">+{sc.target_increase_pct}%</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                {([
                  { label: 'CAPEX total', value: formatCurrency(econ.capex_total) },
                  { label: 'VAN à 8%', value: formatCurrency(econ.npv_8pct), color: econ.npv_8pct >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'TRI', value: econ.irr != null ? `${formatDecimalGrouped((econ.irr * 100), 1)}%` : '—' },
                  { label: 'Payback', value: `${econ.payback_years === Infinity ? '∞' : formatDecimalGrouped(econ.payback_years, 1)} ans` },
                  { label: 'Oz supplémentaires', value: formatOz(econ.additional_oz_per_year) + '/an' },
                  { label: 'AISC', value: `${formatCurrency(econ.aisc_per_oz)}/oz` },
                  { label: 'Δ OPEX', value: `${econ.opex_delta_per_tonne >= 0 ? '+' : ''}${formatDecimalGrouped(econ.opex_delta_per_tonne, 2)}/t` },
                ] as { label: string; value: string; color?: string }[]).map(item => (
                  <div key={item.label} className="p-2 rounded bg-slate-800">
                    <div className="text-xs text-slate-400">{item.label}</div>
                    <div className={`font-semibold ${item.color ?? 'text-white'}`}>{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-slate-400 mb-1">Sensibilité au prix de l'or</div>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(econ.gold_price_sensitivity).map(([price, npv]) => (
                  <div key={price} className="px-2 py-1 rounded bg-slate-800 text-xs">
                    <span className="text-slate-400">{price}: </span>
                    <span className={npv >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatCurrency(npv)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Optimization tab ─────────────────────────────────────────────────────────

function OptimTab({ processNodes, streamEdges, feed, onApply }: {
  processNodes: ProcessNode[];
  streamEdges: StreamEdge[];
  feed: FeedInput;
  onApply: (nodeId: string, param: string, value: number) => void;
}) {
  const [objective, setObjective] = useState<'maximize_recovery' | 'minimize_opex' | 'maximize_npv'>('maximize_recovery');
  const [selectedNode, setSelectedNode] = useState('');
  const [selectedParam, setSelectedParam] = useState('');
  const [minVal, setMinVal] = useState(0);
  const [maxVal, setMaxVal] = useState(100);
  const [variables, setVariables] = useState<{ node_id: string; parameter: string; min: number; max: number; current?: number }[]>([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<OptimizationResults | null>(null);

  // NPV objective must be ranked on the project's own economics, not on generic
  // defaults, so the optimiser agrees with what the Economics module reports.
  const { project: ctxProject, assumptions } = useProject();
  const optimEconomics = useMemo(() => ({
    availability: ctxProject.availability_pct / 100,
    hoursPerYear: assumptions.hoursPerYear,
    goldPriceUsdOz: ctxProject.gold_price_usd,
    discountRate: assumptions.discountRate,
    lomYears: assumptions.lomYears,
  }), [ctxProject.availability_pct, ctxProject.gold_price_usd, assumptions]);

  const selectedNodeDef = processNodes.find(n => n.id === selectedNode);
  const unit = selectedNodeDef ? getUnit(selectedNodeDef.unit_type) : null;
  const paramKeys = unit ? Object.keys(unit.defaultParameters).filter(k => unit.defaultParameters[k].type === 'number') : [];

  function addVariable() {
    if (!selectedNode || !selectedParam) return;
    const current = selectedNodeDef?.parameters[selectedParam] as number | undefined;
    setVariables(prev => [...prev, { node_id: selectedNode, parameter: selectedParam, min: minVal, max: maxVal, current }]);
  }

  function runOpt() {
    setRunning(true);
    setTimeout(() => {
      try {
        const res = runOptimization(processNodes, streamEdges, feed, variables, [], objective, 15, 20, optimEconomics);
        setResults(res);
      } catch (err) {
        console.error(err);
      }
      setRunning(false);
    }, 50);
  }

  function applyOptimal() {
    if (!results) return;
    for (const [key, val] of Object.entries(results.optimal_parameters)) {
      const [nodeId, param] = key.split('.');
      onApply(nodeId, param, val as number);
    }
  }

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-3xl space-y-4">
        <div className="card">
          <h3 className="section-title mb-4">Configuration de l'optimisation</h3>
          <div className="space-y-3">
            <div>
              <label className="label">Objectif d'optimisation</label>
              <select className="input-field" value={objective} onChange={e => setObjective(e.target.value as 'maximize_recovery' | 'minimize_opex' | 'maximize_npv')}>
                <option value="maximize_recovery">Maximiser la récupération</option>
                <option value="minimize_opex">Minimiser l'OPEX</option>
                <option value="maximize_npv">Maximiser la VAN</option>
              </select>
            </div>

            <div className="border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="text-sm text-slate-300 font-medium">Ajouter une variable d'optimisation</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Unité</label>
                  <select className="input-field" value={selectedNode} onChange={e => { setSelectedNode(e.target.value); setSelectedParam(''); }}>
                    <option value="">— Choisir —</option>
                    {processNodes.map(pn => <option key={pn.id} value={pn.id}>{pn.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Paramètre</label>
                  <select className="input-field" value={selectedParam} onChange={e => setSelectedParam(e.target.value)}>
                    <option value="">— Choisir —</option>
                    {paramKeys.map(k => <option key={k} value={k}>{unit?.defaultParameters[k].label ?? k}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Min</label>
                  <input type="number" className="input-field" value={minVal} onChange={e => setMinVal(Number(e.target.value))} />
                </div>
                <div>
                  <label className="label">Max</label>
                  <input type="number" className="input-field" value={maxVal} onChange={e => setMaxVal(Number(e.target.value))} />
                </div>
              </div>
              <button onClick={addVariable} className="btn btn-secondary text-sm"><Plus size={12} /> Ajouter la variable</button>
            </div>

            {variables.length > 0 && (
              <div className="space-y-1">
                {variables.map((v, i) => {
                  const pn = processNodes.find(n => n.id === v.node_id);
                  const u = pn ? getUnit(pn.unit_type) : null;
                  return (
                    <div key={i} className="flex items-center justify-between p-2 rounded bg-slate-800 text-sm">
                      <span className="text-white">{pn?.label} — {u?.defaultParameters[v.parameter]?.label ?? v.parameter}</span>
                      <span className="text-slate-400 text-xs">[{v.min}, {v.max}]</span>
                      <button onClick={() => setVariables(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-300 ml-2">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <button onClick={runOpt} disabled={running || variables.length === 0} className="btn btn-primary">
              {running
                ? <><RefreshCw size={14} className="animate-spin" /> Optimisation en cours…</>
                : <><Target size={14} /> Lancer l'algorithme génétique</>}
            </button>
          </div>
        </div>

        {results && (
          <div className="card">
            <h3 className="section-title mb-3">Résultats d'optimisation</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card-sm">
                <div className="text-xs text-slate-400">Valeur initiale</div>
                <div className="text-lg font-bold text-white">{formatDecimalGrouped(results.base_value, 2)}</div>
              </div>
              <div className="card-sm">
                <div className="text-xs text-slate-400">Valeur optimale</div>
                <div className="text-lg font-bold text-emerald-400">{formatDecimalGrouped(results.optimal_value, 2)}</div>
              </div>
              <div className="card-sm">
                <div className="text-xs text-slate-400">Amélioration</div>
                <div className="text-lg font-bold text-blue-400">+{formatDecimalGrouped(results.improvement_pct, 1)}%</div>
              </div>
            </div>
            <div className="space-y-1 mb-4">
              {Object.entries(results.optimal_parameters).map(([key, val]) => {
                const [nodeId, param] = key.split('.');
                const pn = processNodes.find(n => n.id === nodeId);
                const u = pn ? getUnit(pn.unit_type) : null;
                return (
                  <div key={key} className="stat-row text-sm">
                    <span className="text-slate-400">{pn?.label} — {u?.defaultParameters[param]?.label ?? param}</span>
                    <span className="num">{typeof val === 'number' ? formatDecimalGrouped(val, 3) : val}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={applyOptimal} className="btn btn-primary">
              <CheckCircle size={14} /> Appliquer les paramètres optimaux
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
