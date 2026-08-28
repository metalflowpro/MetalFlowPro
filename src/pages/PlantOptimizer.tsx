import { useState, useEffect, useCallback } from 'react';
import {
  Gauge, Play, Save, RotateCcw, Plus, Trash2, GitCompare, AlertTriangle,
  TrendingUp, TrendingDown, Boxes, FolderOpen, Loader2, X,
} from 'lucide-react';
import type { Project } from '../types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { KpiCard } from '../components/ui/KpiCard';
import { useProject } from '../lib/ProjectContext';
import { formatDecimalGrouped } from '../lib/format/number';
import { PLANT_OPT_RUN_DEFAULTS, defaultDistribution } from '../lib/plantopt/config';
import { buildModelFromProject, makeNewArea, makePlantOptId } from '../lib/plantopt/projectModel';
import { runSimulation } from '../lib/plantopt/engine';
import {
  listScenarios, saveScenario, deleteScenario, logOptimizationRun,
  type PlantOptScenario,
} from '../lib/plantopt/scenarioStore';
import type {
  Area, DistributionSpec, FailureMode, PlantModel, SimConfig, SimResult,
} from '../lib/plantopt/types';
import { DistributionEditor } from '../components/plantopt/DistributionEditor';
import { FlowsheetCanvas } from '../components/plantopt/FlowsheetCanvas';
import { BottleneckBars, TornadoChart, ThroughputHistogram } from '../components/plantopt/ResultCharts';
import { notifySuccess } from '../lib/notify';

// ─── Helpers de mutation immuable du modèle ───────────────────────────────────

function patchArea(model: PlantModel, id: string, patch: Partial<Area>): PlantModel {
  return { ...model, areas: model.areas.map(a => (a.id === id ? { ...a, ...patch } : a)) };
}
function getFailureMode(model: PlantModel, areaId: string): FailureMode | undefined {
  return (model.failureModes ?? []).find(f => f.areaId === areaId);
}
function setFailureDist(model: PlantModel, areaId: string, key: 'ttfDist' | 'ttrDist', spec: DistributionSpec): PlantModel {
  const existing = getFailureMode(model, areaId);
  if (existing) {
    return { ...model, failureModes: model.failureModes.map(f => (f.id === existing.id ? { ...f, [key]: spec } : f)) };
  }
  const fm: FailureMode = {
    id: makePlantOptId('fm'),
    areaId,
    residualCapacity: 0,
    ttfDist: key === 'ttfDist' ? spec : { kind: 'weibull', params: { shape: 1.4, scale: 300 } },
    ttrDist: key === 'ttrDist' ? spec : { kind: 'lognormal', params: { mu: 1.8, sigma: 0.6 } },
  };
  return { ...model, failureModes: [...(model.failureModes ?? []), fm] };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlantOptimizer({ project }: { project: Project }) {
  const { assumptions } = useProject();
  const buildOpts = { horizonHours: assumptions?.hoursPerYear };

  const [model, setModel] = useState<PlantModel>(() => buildModelFromProject(project, buildOpts));
  const [config, setConfig] = useState<SimConfig>({ ...PLANT_OPT_RUN_DEFAULTS });
  const [result, setResult] = useState<SimResult | null>(null);
  const [baseline, setBaseline] = useState<{ result: SimResult; label: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<PlantOptScenario[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);

  // Re-dériver le modèle depuis le projet lorsqu'on change de projet actif.
  useEffect(() => {
    setModel(buildModelFromProject(project, { horizonHours: assumptions?.hoursPerYear }));
    setResult(null);
    setBaseline(null);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const refreshScenarios = useCallback(() => {
    listScenarios(project.id).then(setScenarios);
  }, [project.id]);
  useEffect(() => { refreshScenarios(); }, [refreshScenarios]);

  const selectedArea = selectedId ? model.areas.find(a => a.id === selectedId) ?? null : null;

  // ── Exécution ────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (running) return;
    setRunning(true);
    setProgress(0);
    try {
      const r = await runSimulation({
        model,
        config,
        onProgress: setProgress,
      });
      setResult(r);
      await logOptimizationRun(project.id, model, config, r);
    } finally {
      setRunning(false);
    }
  }

  function handleResetFromProject() {
    setModel(buildModelFromProject(project, { horizonHours: assumptions?.hoursPerYear }));
    setResult(null);
    setSelectedId(null);
    notifySuccess('Modèle réinitialisé', 'Aires re-dérivées des paramètres du projet actif.');
  }

  async function handleSave() {
    const name = window.prompt('Nom du scénario', `Scénario ${scenarios.length + 1}`);
    if (!name) return;
    await saveScenario({ projectId: project.id, name: name.trim(), model, config, result });
    notifySuccess('Scénario enregistré', 'Modèle, réglages et résultat archivés (traçables).');
    refreshScenarios();
  }

  function loadScenario(s: PlantOptScenario) {
    setModel(s.model);
    setConfig(s.config);
    setResult(null);
    setSelectedId(null);
    setShowLibrary(false);
    notifySuccess('Scénario chargé', `« ${s.name} » — relancez la simulation pour recalculer.`);
  }

  async function removeScenario(s: PlantOptScenario) {
    await deleteScenario(s.id, project.id);
    refreshScenarios();
  }

  function setAsBaseline() {
    if (result) setBaseline({ result, label: 'Base' });
  }

  // ── Édition d'aire ─────────────────────────────────────────────────────────
  function addArea() {
    const { area, stream } = makeNewArea(model);
    setModel(m => ({ ...m, areas: [...m.areas, area], streams: stream ? [...m.streams, stream] : m.streams }));
    setSelectedId(area.id);
  }
  function deleteArea(id: string) {
    setModel(m => ({
      ...m,
      areas: m.areas.filter(a => a.id !== id),
      streams: m.streams.filter(s => s.sourceAreaId !== id && s.targetAreaId !== id),
      buffers: (m.buffers ?? []).filter(b => b.upstreamAreaId !== id && b.downstreamAreaId !== id),
      failureModes: (m.failureModes ?? []).filter(f => f.areaId !== id),
      plannedStops: (m.plannedStops ?? []).map(p => ({ ...p, areaIds: p.areaIds.filter(x => x !== id) })).filter(p => p.areaIds.length > 0),
      commonCauses: (m.commonCauses ?? []).map(c => ({ ...c, areaIds: c.areaIds.filter(x => x !== id) })).filter(c => c.areaIds.length > 0),
    }));
    if (selectedId === id) setSelectedId(null);
  }

  const currency = model.currency;
  const spread = result ? result.throughputP90 - result.throughputP10 : 0;

  return (
    <div>
      <PageHeader
        icon={<Gauge size={20} />}
        title="Plant Optimizer"
        subtitle="Simulation Monte-Carlo RAM/DES — identification des goulots macro et du débit réalisable de l'usine"
        breadcrumb={['Optimisation', 'Plant Optimizer']}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowLibrary(true)} className="btn btn-sm btn-secondary">
              <FolderOpen size={14} /> Scénarios ({scenarios.length})
            </button>
            <button onClick={handleResetFromProject} className="btn btn-sm btn-secondary" title="Re-dériver le modèle des paramètres du projet">
              <RotateCcw size={14} /> Projet
            </button>
            <button onClick={handleSave} className="btn btn-sm btn-secondary">
              <Save size={14} /> Enregistrer
            </button>
            <button onClick={handleRun} disabled={running} className="btn btn-sm btn-primary">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? `Calcul… ${Math.round(progress * 100)}%` : 'Lancer'}
            </button>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {/* Bandeau de synchronisation projet */}
        <div className="text-xs text-mf-txt4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Amorcé depuis <span className="text-mf-txt3 font-medium">{project.code}</span></span>
          <span>Débit projet : <span className="font-mono text-mf-txt3">{formatDecimalGrouped(project.target_tph, 0)} t/h</span></span>
          <span>Disponibilité cible : <span className="font-mono text-mf-txt3">{project.availability_pct}%</span></span>
          <span>Récupération : <span className="font-mono text-mf-txt3">{project.recovery_pct}%</span></span>
          <span>Horizon : <span className="font-mono text-mf-txt3">{formatDecimalGrouped(config.horizonHours ?? model.horizonHours, 0)} h</span></span>
        </div>

        {/* Flowsheet */}
        <Section title="Chaîne de traitement" subtitle={result ? 'Teinte = probabilité d\'être le goulot (vert → rouge). Cliquez une aire pour l\'éditer.' : 'Cliquez une aire pour l\'éditer. Lancez la simulation pour révéler les goulots.'}>
          <FlowsheetCanvas model={model} result={result} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="mt-3">
            <button onClick={addArea} className="btn btn-sm btn-secondary"><Plus size={13} /> Ajouter une aire</button>
          </div>
        </Section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Réglages Monte-Carlo */}
          <Section title="Réglages Monte-Carlo" className="lg:col-span-1">
            <div className="space-y-3">
              <NumberField label="Itérations" value={config.iterations} min={1} step={100}
                onChange={v => setConfig(c => ({ ...c, iterations: Math.max(1, Math.round(v)) }))} />
              <NumberField label="Graine (reproductibilité)" value={config.seed}
                onChange={v => setConfig(c => ({ ...c, seed: Math.round(v) }))} />
              <NumberField label="Horizon (h)" value={config.horizonHours ?? model.horizonHours} min={1} step={24}
                onChange={v => { setConfig(c => ({ ...c, horizonHours: Math.max(1, v) })); setModel(m => ({ ...m, horizonHours: Math.max(1, v) })); }} />
              <NumberField label="Rodage exclu (h)" value={config.warmupHours} min={0} step={24}
                onChange={v => setConfig(c => ({ ...c, warmupHours: Math.max(0, v) }))} />
              <NumberField label="Pas de temps (h)" value={config.timeStepHours} min={0.25} step={0.25}
                onChange={v => setConfig(c => ({ ...c, timeStepHours: Math.max(0.25, v) }))} />
            </div>
            {running && (
              <div className="mt-4 h-1.5 rounded-full bg-mf-panel overflow-hidden">
                <div className="h-full bg-amber-500 transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </Section>

          {/* Éditeur d'aire sélectionnée */}
          <Section title={selectedArea ? `Aire — ${selectedArea.name}` : 'Éditeur d\'aire'} className="lg:col-span-2">
            {!selectedArea ? (
              <div className="text-sm text-mf-txt4 py-8 text-center">
                Sélectionnez une aire dans la chaîne ci-dessus pour éditer sa capacité, son coût et ses modes de défaillance.
              </div>
            ) : (
              <AreaEditor
                key={selectedArea.id}
                model={model}
                area={selectedArea}
                currency={currency}
                onPatch={patch => setModel(m => patchArea(m, selectedArea.id, patch))}
                onCapacity={spec => setModel(m => patchArea(m, selectedArea.id, { capacityDist: spec }))}
                onFailure={(key, spec) => setModel(m => setFailureDist(m, selectedArea.id, key, spec))}
                onDelete={() => deleteArea(selectedArea.id)}
              />
            )}
          </Section>
        </div>

        {/* Résultats */}
        {result && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard label="Débit P10" value={formatDecimalGrouped(result.throughputP10, 0)} unit="t/h" color="red" sub="conservateur" />
              <KpiCard label="Débit P50" value={formatDecimalGrouped(result.throughputP50, 0)} unit="t/h" color="amber" sub="médian réalisable" icon={<TrendingUp size={16} />} />
              <KpiCard label="Débit P90" value={formatDecimalGrouped(result.throughputP90, 0)} unit="t/h" color="green" sub="optimiste" />
              <KpiCard label="Disponibilité" value={(100 * result.availability).toFixed(1)} unit="%" color="blue" sub="moyenne simulée" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KpiCard label="Coût opératoire" value={`${result.costPerTonne.toFixed(2)} ${currency}`} unit="/t" color="purple" />
              <KpiCard label="Récupération moy." value={(100 * result.recoveryMean).toFixed(1)} unit="%" color="teal" />
              <KpiCard label="Incertitude (P90−P10)" value={formatDecimalGrouped(spread, 0)} unit="t/h" color="gold" />
              <KpiCard label="Débit récupéré P50" value={formatDecimalGrouped(result.recoveredThroughputP50, 0)} unit="t/h" color="green" sub="× récupération" />
            </div>

            {/* Comparaison scénario */}
            {baseline && (
              <Section title="Comparaison vs base" actions={<button onClick={() => setBaseline(null)} className="btn btn-sm btn-secondary"><X size={13} /> Effacer</button>}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Delta label="Débit P50" before={baseline.result.throughputP50} after={result.throughputP50} unit="t/h" />
                  <Delta label="Débit P10" before={baseline.result.throughputP10} after={result.throughputP10} unit="t/h" />
                  <Delta label="Disponibilité" before={100 * baseline.result.availability} after={100 * result.availability} unit="%" />
                  <Delta label="Coût/t" before={baseline.result.costPerTonne} after={result.costPerTonne} unit={currency} lowerIsBetter />
                </div>
              </Section>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section title="Probabilité de goulot par aire" subtitle="Où l'usine bute le plus souvent">
                <BottleneckBars areas={model.areas} result={result} />
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={setAsBaseline} className="btn btn-sm btn-secondary"><GitCompare size={13} /> Définir comme base de comparaison</button>
                </div>
              </Section>
              <Section title="Sensibilité (tornado)" subtitle="Effet sur le débit d'un abaissement/relèvement de capacité par aire">
                <TornadoChart result={result} />
              </Section>
            </div>

            <Section title="Distribution du débit" subtitle={`${result.throughputSamples.length} itérations`}>
              <ThroughputHistogram result={result} />
            </Section>
          </>
        )}

        {!result && !running && (
          <div className="text-center py-12 text-mf-txt4">
            <Boxes size={32} className="mx-auto mb-3 opacity-50" />
            <p className="text-sm">Ajustez le modèle puis cliquez <span className="text-amber-400 font-medium">Lancer</span> pour identifier le goulot et le débit réalisable.</p>
          </div>
        )}
      </div>

      {/* Bibliothèque de scénarios */}
      {showLibrary && (
        <ScenarioLibrary
          scenarios={scenarios}
          onLoad={loadScenario}
          onDelete={removeScenario}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </div>
  );
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function NumberField({ label, value, onChange, min, step }: { label: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type="number" className="input-field font-mono" value={value} min={min} step={step ?? 1}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  );
}

function Delta({ label, before, after, unit, lowerIsBetter }: { label: string; before: number; after: number; unit: string; lowerIsBetter?: boolean }) {
  const diff = after - before;
  const pct = before !== 0 ? (diff / Math.abs(before)) * 100 : 0;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const flat = Math.abs(diff) < 1e-9;
  const color = flat ? 'text-mf-txt4' : improved ? 'text-emerald-400' : 'text-red-400';
  const Icon = flat ? null : diff > 0 ? TrendingUp : TrendingDown;
  return (
    <div className="card border border-mf-border">
      <div className="text-xs text-mf-txt4 mb-1">{label}</div>
      <div className="text-lg font-bold text-mf-txt font-mono">{after.toFixed(unit === '%' || unit.length > 2 ? 1 : 0)} <span className="text-xs font-normal text-mf-txt4">{unit}</span></div>
      <div className={`text-xs flex items-center gap-1 mt-1 ${color}`}>
        {Icon && <Icon size={12} />}
        {diff > 0 ? '+' : ''}{diff.toFixed(1)} ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
      </div>
    </div>
  );
}

function AreaEditor({ model, area, currency, onPatch, onCapacity, onFailure, onDelete }: {
  model: PlantModel;
  area: Area;
  currency: string;
  onPatch: (patch: Partial<Area>) => void;
  onCapacity: (spec: DistributionSpec) => void;
  onFailure: (key: 'ttfDist' | 'ttrDist', spec: DistributionSpec) => void;
  onDelete: () => void;
}) {
  const fm = getFailureMode(model, area.id);
  const ttf = fm?.ttfDist ?? defaultDistribution('weibull');
  const ttr = fm?.ttrDist ?? defaultDistribution('lognormal');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nom</label>
          <input className="input-field" value={area.name} onChange={e => onPatch({ name: e.target.value })} />
        </div>
        <div>
          <label className="label">Coût opératoire ({currency}/t)</label>
          <input type="number" step={0.1} className="input-field font-mono" value={area.opexPerTonne}
            onChange={e => onPatch({ opexPerTonne: Number(e.target.value) })} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex items-center gap-2 text-mf-txt3">
          <input type="checkbox" checked={!!area.hardnessSensitive} onChange={e => onPatch({ hardnessSensitive: e.target.checked })} />
          Sensible à la dureté du minerai
        </label>
        <label className="flex items-center gap-2 text-mf-txt3">
          Récupération de base (0–1)
          <input type="number" step={0.01} min={0} max={1} className="input-field font-mono w-24 py-1"
            value={area.baseRecovery ?? ''} placeholder="—"
            onChange={e => onPatch({ baseRecovery: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
      </div>

      <div>
        <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Capacité (t/h)</div>
        <DistributionEditor value={area.capacityDist} onChange={onCapacity} unit="t/h" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Temps de bon fonctionnement (TTF)</div>
          <DistributionEditor value={ttf} onChange={spec => onFailure('ttfDist', spec)} unit="h" />
        </div>
        <div>
          <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Temps de réparation (TTR)</div>
          <DistributionEditor value={ttr} onChange={spec => onFailure('ttrDist', spec)} unit="h" />
        </div>
      </div>

      <div className="pt-2 border-t border-mf-border">
        <button onClick={onDelete} className="btn btn-sm text-red-400 hover:bg-red-500/10 border border-red-500/30">
          <Trash2 size={13} /> Supprimer l'aire
        </button>
      </div>
    </div>
  );
}

function ScenarioLibrary({ scenarios, onLoad, onDelete, onClose }: {
  scenarios: PlantOptScenario[];
  onLoad: (s: PlantOptScenario) => void;
  onDelete: (s: PlantOptScenario) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-mf-card border border-mf-border rounded-xl w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-mf-border">
          <div className="font-semibold text-mf-txt">Scénarios enregistrés</div>
          <button onClick={onClose} className="text-mf-txt4 hover:text-mf-txt2"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2">
          {scenarios.length === 0 && (
            <div className="text-sm text-mf-txt4 text-center py-8 flex flex-col items-center gap-2">
              <AlertTriangle size={20} className="opacity-50" />
              Aucun scénario enregistré pour ce projet.
            </div>
          )}
          {scenarios.map(s => {
            const sum = s.result_summary;
            return (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-lg bg-mf-panel border border-mf-border">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-mf-txt truncate">{s.name}</div>
                  <div className="text-[11px] text-mf-txt4">
                    {new Date(s.created_at).toLocaleString('fr-FR')}
                    {sum && ` · P50 ${Math.round(sum.throughputP50)} t/h · goulot ${sum.topBottleneckName} (${Math.round(sum.topBottleneckProb * 100)}%)`}
                  </div>
                </div>
                <button onClick={() => onLoad(s)} className="btn btn-sm btn-secondary">Charger</button>
                <button onClick={() => onDelete(s)} className="text-red-400 hover:bg-red-500/10 rounded p-1.5"><Trash2 size={14} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
