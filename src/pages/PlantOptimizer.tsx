import { useState, useEffect, useCallback } from 'react';
import {
  Gauge, Play, Save, RotateCcw, Plus, Trash2, GitCompare, Loader2, X,
  TrendingUp, TrendingDown, Link2, Boxes, FlaskConical,
} from 'lucide-react';
import type { Project } from '../types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { KpiCard } from '../components/ui/KpiCard';
import { Modal } from '../components/ui/Modal';
import { useProject } from '../lib/ProjectContext';
import { formatDecimalGrouped } from '../lib/format/number';
import { PLANT_OPT_RUN_DEFAULTS, defaultDistribution } from '../lib/plantopt/config';
import { buildModelFromProject } from '../lib/plantopt/projectModel';
import { buildExamplePlant } from '../lib/plantopt/examplePlant';
import { runSimulation } from '../lib/plantopt/engine';
import {
  addArea, deleteArea, patchArea, setCapacityDist, setFailureDist, getFailureMode, addStream,
} from '../lib/plantopt/modelOps';
import {
  listScenarios, saveScenario, logOptimizationRun,
  type PlantOptScenario,
} from '../lib/plantopt/scenarioStore';
import type { Area, DistributionSpec, PlantModel, SimConfig, SimResult } from '../lib/plantopt/types';
import { DistributionEditor } from '../components/plantopt/DistributionEditor';
import { FlowsheetCanvas } from '../components/plantopt/FlowsheetCanvas';
import { BottleneckBars, TornadoChart, ThroughputHistogram } from '../components/plantopt/ResultCharts';
import { AiresTable } from '../components/plantopt/AiresTable';
import { StreamsBuffersTable } from '../components/plantopt/StreamsBuffersTable';
import { CommonCausesEditor } from '../components/plantopt/CommonCausesEditor';
import { HardnessPanel, GradeRecoveryPanel } from '../components/plantopt/FeedScenarioEditor';
import { DataImportPanel } from '../components/plantopt/DataImportPanel';
import { OptimizationTab } from '../components/plantopt/OptimizationTab';
import { ReportTab } from '../components/plantopt/ReportTab';
import { notifySuccess } from '../lib/notify';

type Tab = 'model' | 'results' | 'optim' | 'report';

export default function PlantOptimizer({ project }: { project: Project }) {
  const { assumptions } = useProject();
  const buildOpts = { horizonHours: assumptions?.hoursPerYear };

  const [model, setModel] = useState<PlantModel>(() => buildModelFromProject(project, buildOpts));
  const [config, setConfig] = useState<SimConfig>({ ...PLANT_OPT_RUN_DEFAULTS });
  const [result, setResult] = useState<SimResult | null>(null);
  const [baseline, setBaseline] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [tab, setTab] = useState<Tab>('model');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAreaEditor, setShowAreaEditor] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [connectSource, setConnectSource] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<PlantOptScenario[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [historicalSeed, setHistoricalSeed] = useState<string>('');

  // Re-dériver le modèle depuis le projet quand on change de projet actif.
  useEffect(() => {
    setModel(buildModelFromProject(project, { horizonHours: assumptions?.hoursPerYear }));
    setResult(null); setBaseline(null); setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const refreshScenarios = useCallback(() => { listScenarios(project.id).then(setScenarios); }, [project.id]);
  useEffect(() => { refreshScenarios(); }, [refreshScenarios]);

  const selectedArea = selectedId ? model.areas.find(a => a.id === selectedId) ?? null : null;

  // ── Exécution ────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (running) return;
    setRunning(true); setProgress(0);
    try {
      const r = await runSimulation({ model, config, onProgress: setProgress });
      setResult(r);
      setTab('results');
      await logOptimizationRun(project.id, model, config, r);
    } finally { setRunning(false); }
  }

  function resetFromProject() {
    setModel(buildModelFromProject(project, { horizonHours: assumptions?.hoursPerYear }));
    setResult(null); setSelectedId(null); setConnectMode(false); setConnectSource(null);
    notifySuccess('Modèle réinitialisé', 'Aires re-dérivées des paramètres du projet actif.');
  }

  function loadExample() {
    setModel(buildExamplePlant({
      targetTph: project.target_tph,
      availabilityFraction: (project.availability_pct > 0 ? project.availability_pct : 91) / 100,
      horizonHours: assumptions?.hoursPerYear,
    }));
    setResult(null); setSelectedId(null); setConnectMode(false); setConnectSource(null);
    notifySuccess('Exemple chargé', 'Usine complète mise à l\'échelle du débit du projet.');
  }

  async function handleSave() {
    const name = (scenarioName.trim() || `Scénario ${scenarios.length + 1}`);
    await saveScenario({ projectId: project.id, name, model, config, result });
    setScenarioName('');
    notifySuccess('Scénario enregistré', 'Modèle, réglages et résultat archivés (traçables).');
    refreshScenarios();
  }

  function loadScenario(id: string) {
    const s = scenarios.find(x => x.id === id);
    if (!s) return;
    setModel(s.model); setConfig(s.config); setResult(null); setSelectedId(null);
    notifySuccess('Scénario chargé', `« ${s.name} » — relancez la simulation pour recalculer.`);
  }

  // ── Édition d'aire / connexions ────────────────────────────────────────────
  function handleAreaSelect(id: string) {
    if (connectMode) { setConnectSource(id); return; }
    setSelectedId(id); setShowAreaEditor(true);
  }
  function handleConnect(src: string, tgt: string) {
    setModel(m => addStream(m, src, tgt));
    setConnectSource(null);
  }
  function toggleConnectMode() {
    setConnectMode(v => !v); setConnectSource(null);
  }
  function handleAddArea() {
    const { model: m, newId } = addArea(model);
    setModel(m); setSelectedId(newId); setShowAreaEditor(true);
  }

  const currency = model.currency;
  const spread = result ? result.throughputP90 - result.throughputP10 : 0;

  const TABS: { id: Tab; label: string }[] = [
    { id: 'model', label: 'Modèle & données' },
    { id: 'results', label: 'Résultats' },
    { id: 'optim', label: 'Optimisation & back-test' },
    { id: 'report', label: 'Rapport & export' },
  ];

  return (
    <div>
      <PageHeader
        icon={<Gauge size={20} />}
        title="Plant Optimizer"
        subtitle="Simulation Monte Carlo RAM/DES — identifiez les goulots macro de votre usine et priorisez le debottlenecking."
        breadcrumb={['Optimisation', 'Plant Optimizer']}
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <select value="" onChange={e => e.target.value && loadScenario(e.target.value)}
              className="input-field text-xs py-1.5 max-w-[160px]">
              <option value="">Charger un scénario…</option>
              {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={scenarioName} onChange={e => setScenarioName(e.target.value)}
              placeholder="Nom du scénario…" className="input-field text-xs py-1.5 max-w-[140px]" />
            <button onClick={handleSave} className="btn btn-sm btn-secondary"><Save size={14} /> Sauver</button>
            <button onClick={resetFromProject} className="btn btn-sm btn-secondary"><RotateCcw size={14} /> Réinitialiser</button>
            <button onClick={handleRun} disabled={running} className="btn btn-sm btn-primary">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? `Calcul… ${Math.round(progress * 100)}%` : 'Lancer la simulation'}
            </button>
          </div>
        }
      />

      {/* Barre d'onglets */}
      <div className="px-8 border-b border-mf-border flex items-center gap-1">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-3 text-sm border-b-2 transition-colors flex items-center gap-2 ${
              tab === t.id ? 'border-amber-400 text-amber-300 font-medium' : 'border-transparent text-mf-txt4 hover:text-mf-txt2'
            }`}>
            {t.label}
            {t.id === 'results' && result && (
              <span className="text-[10px] bg-amber-500/20 text-amber-300 rounded-full px-2 py-0.5 font-mono">
                {Math.round(result.throughputP50)}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="p-8 space-y-6">
        {/* Bandeau synchro projet */}
        <div className="text-xs text-mf-txt4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Amorcé depuis <span className="text-mf-txt3 font-medium">{project.code}</span></span>
          <span>Débit projet : <span className="font-mono text-mf-txt3">{formatDecimalGrouped(project.target_tph, 0)} t/h</span></span>
          <span>Disponibilité cible : <span className="font-mono text-mf-txt3">{project.availability_pct}%</span></span>
          <span>Récupération : <span className="font-mono text-mf-txt3">{project.recovery_pct}%</span></span>
        </div>

        {tab === 'model' && (
          <>
            {/* Éditeur de flowsheet */}
            <Section
              title="Éditeur de flowsheet (PFD) — glisser-déposer, flux & tampons"
              subtitle={connectMode ? (connectSource ? 'Cliquez l\'aire cible.' : 'Cliquez l\'aire source puis la cible.') : 'Glissez les aires pour les repositionner. Cliquez pour éditer.'}
              actions={
                <div className="flex items-center gap-2">
                  <button onClick={handleAddArea} className="btn btn-sm btn-secondary"><Plus size={13} /> Ajouter une aire</button>
                  <button onClick={toggleConnectMode} className={`btn btn-sm ${connectMode ? 'btn-primary' : 'btn-secondary'}`}>
                    <Link2 size={13} /> {connectMode ? 'Mode connexion : actif' : 'Connecter des flux'}
                  </button>
                  <button onClick={loadExample} className="btn btn-sm btn-secondary"><FlaskConical size={13} /> Exemple : usine complète</button>
                </div>
              }
            >
              <FlowsheetCanvas
                model={model} result={result} selectedId={selectedId}
                connectMode={connectMode} connectSource={connectSource}
                onSelect={handleAreaSelect} onMove={(id, x, y) => setModel(m => patchArea(m, id, { x, y }))}
                onConnect={handleConnect}
              />
            </Section>

            <Section title="Flux & tampons">
              <StreamsBuffersTable model={model} onModel={setModel} />
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Section title="Paramètres de simulation">
                <div className="grid grid-cols-3 gap-3">
                  <NumberField label="Itérations" value={config.iterations} min={1} step={100}
                    onChange={v => setConfig(c => ({ ...c, iterations: Math.max(1, Math.round(v)) }))} />
                  <NumberField label="Graine (seed)" value={config.seed}
                    onChange={v => setConfig(c => ({ ...c, seed: Math.round(v) }))} />
                  <NumberField label="Horizon (heures)" value={config.horizonHours ?? model.horizonHours} min={1} step={24}
                    onChange={v => { setConfig(c => ({ ...c, horizonHours: Math.max(1, v) })); setModel(m => ({ ...m, horizonHours: Math.max(1, v) })); }} />
                  <NumberField label="Rodage (h)" value={config.warmupHours} min={0} step={24}
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

              <Section title="Import de données GMAO / Historian (CSV, Excel)">
                <DataImportPanel model={model} onModel={setModel} onHistorical={vals => setHistoricalSeed(vals.join('\n'))} />
              </Section>
            </div>

            <Section title="Aires (capacité PERT & OPEX)">
              <AiresTable model={model} selectedId={selectedId} onModel={setModel} onSelect={handleAreaSelect} />
            </Section>

            <Section title="Causes communes (événements corrélés multi-aires)"
              subtitle="Un événement (coupure électrique, eau…) met plusieurs aires à l'arrêt simultanément — modélise la corrélation de défaillance (facteur β).">
              <CommonCausesEditor model={model} onModel={setModel} />
            </Section>

            <Section title="Scénario d'alimentation — corrélation dureté → capacité">
              <HardnessPanel model={model} onModel={setModel} />
            </Section>

            <Section title="Teneur → récupération métallurgique">
              <GradeRecoveryPanel model={model} onModel={setModel} />
            </Section>
          </>
        )}

        {tab === 'results' && (
          result ? (
            <>
              <div className="flex justify-end">
                <button onClick={() => setBaseline(result)} className="btn btn-sm btn-secondary"><GitCompare size={13} /> Définir comme référence (avant)</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard label="Débit P10 (t/h)" value={formatDecimalGrouped(result.throughputP10, 0)} color="red" sub="Borne prudente (90% des scénarios)" />
                <KpiCard label="Débit P50 (t/h)" value={formatDecimalGrouped(result.throughputP50, 0)} color="teal" sub="Médiane" icon={<TrendingUp size={16} />} />
                <KpiCard label="Débit P90 (t/h)" value={formatDecimalGrouped(result.throughputP90, 0)} color="purple" sub="Borne optimiste (10%)" />
                <KpiCard label="Disponibilité usine" value={(100 * result.availability).toFixed(1)} unit="%" color="blue" sub="Moyenne pondérée" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <KpiCard label="Coût / tonne (OPEX)" value={`${result.costPerTonne.toFixed(2)} ${currency}`} color="gold" sub="Moyenne Monte Carlo" />
                <KpiCard label="Récupération" value={(100 * result.recoveryMean).toFixed(1)} unit="%" color="green" sub="Facteur métallurgique moyen" />
                <KpiCard label="Incertitude P10↔P90" value={`${formatDecimalGrouped(spread, 0)} t/h`} color="gold" sub="Plage de confiance" />
              </div>

              {baseline && (
                <Section title="Comparaison vs référence" actions={<button onClick={() => setBaseline(null)} className="btn btn-sm btn-secondary"><X size={13} /> Effacer</button>}>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Delta label="Débit P50" before={baseline.throughputP50} after={result.throughputP50} unit="t/h" />
                    <Delta label="Débit P10" before={baseline.throughputP10} after={result.throughputP10} unit="t/h" />
                    <Delta label="Disponibilité" before={100 * baseline.availability} after={100 * result.availability} unit="%" />
                    <Delta label="Coût/t" before={baseline.costPerTonne} after={result.costPerTonne} unit={currency} lowerIsBetter />
                  </div>
                </Section>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Section title="Distribution du débit (P10 / P50 / P90)"><ThroughputHistogram result={result} /></Section>
                <Section title="Probabilité de goulot par aire" subtitle="Part des itérations où l'aire limite le débit de l'usine.">
                  <BottleneckBars areas={model.areas} result={result} />
                </Section>
              </div>

              <Section title="Analyse de sensibilité (tornado) — impact sur P50"
                subtitle="Débit moyen lorsque la capacité de chaque aire est dans son décile bas (orange) vs. haut (vert). Plus la barre est large, plus le levier est décisif.">
                <TornadoChart result={result} />
              </Section>
            </>
          ) : (
            <EmptyRun onGo={handleRun} />
          )
        )}

        {tab === 'optim' && <OptimizationTab model={model} config={config} initialHistorical={historicalSeed} />}

        {tab === 'report' && <ReportTab model={model} config={config} result={result} projectCode={project.code} />}
      </div>

      {/* Éditeur détaillé d'aire (modale) */}
      {showAreaEditor && selectedArea && (
        <Modal title={`Aire — ${selectedArea.name}`} subtitle="Capacité, coût et modes de défaillance" width="lg"
          onClose={() => setShowAreaEditor(false)}>
          <AreaDetailEditor
            key={selectedArea.id} model={model} area={selectedArea} currency={currency}
            onPatch={patch => setModel(m => patchArea(m, selectedArea.id, patch))}
            onCapacity={spec => setModel(m => setCapacityDist(m, selectedArea.id, spec))}
            onFailure={(k, spec) => setModel(m => setFailureDist(m, selectedArea.id, k, spec))}
            onDelete={() => { setModel(m => deleteArea(m, selectedArea.id)); setShowAreaEditor(false); }}
          />
        </Modal>
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
        {Icon && <Icon size={12} />}{diff > 0 ? '+' : ''}{diff.toFixed(1)} ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
      </div>
    </div>
  );
}

function EmptyRun({ onGo }: { onGo: () => void }) {
  return (
    <div className="text-center py-16 text-mf-txt4">
      <Boxes size={32} className="mx-auto mb-3 opacity-50" />
      <p className="text-sm mb-4">Aucun résultat. Lancez la simulation pour identifier le goulot et le débit réalisable.</p>
      <button onClick={onGo} className="btn btn-primary"><Play size={14} /> Lancer la simulation</button>
    </div>
  );
}

function AreaDetailEditor({ model, area, currency, onPatch, onCapacity, onFailure, onDelete }: {
  model: PlantModel; area: Area; currency: string;
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
          <input type="number" step={0.1} className="input-field font-mono" value={area.opexPerTonne} onChange={e => onPatch({ opexPerTonne: Number(e.target.value) })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-mf-txt3">
        <input type="checkbox" checked={!!area.hardnessSensitive} onChange={e => onPatch({ hardnessSensitive: e.target.checked || undefined })} />
        Sensible à la dureté du minerai
      </label>
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
        <button onClick={onDelete} className="btn btn-sm text-red-400 hover:bg-red-500/10 border border-red-500/30"><Trash2 size={13} /> Supprimer l'aire</button>
      </div>
    </div>
  );
}
