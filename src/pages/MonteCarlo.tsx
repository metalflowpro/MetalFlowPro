import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  SlidersHorizontal, Dices, Plus, Trash2, Save, Play, RefreshCw, AlertTriangle,
  TrendingUp, TrendingDown, Layers, Boxes,
} from 'lucide-react';
import { formatDecimalGrouped } from '../lib/format/number';
import { formatCurrency } from '../lib/simulation/economics';
import { useProject } from '../lib/ProjectContext';
import { DEFAULT_ASSUMPTIONS, P80_STUDY_DEFAULTS } from '../lib/config/constants';
import { runMonteCarloModel, type Correlation, type MonteCarloResult } from '../lib/simulation/monteCarlo';
import { qualityFromTiers, type SourceTier, type QualityLevel } from '../lib/simulation/provenance';
import { canonDomain } from '../lib/geomet/domains';
import { QUALITY_UI } from '../components/simulation/simUi';
import {
  MC_CIRCUITS, MC_SECTIONS, MC_OUTPUTS, MC_OUTPUT_KEYS, MC_MODEL_CONFIG, MC_VARIABLES,
  variablesForCircuit, defaultParams, toDistribution, makeModel, paramFromCenter,
  circuitHasLeach, circuitHasCarbon, leachExtraction, blendKeys,
  type MCCircuit, type MCSeed, type MCParam, type MCVariableDef, type MCOutputKey, type MCBlendDomain,
} from '../lib/simulation/monteCarloModel';

const KIND_OPTIONS: { value: MCParam['kind']; label: string }[] = [
  { value: 'normal', label: 'Normale' },
  { value: 'lognormal', label: 'Lognormale' },
  { value: 'triangular', label: 'Triangulaire' },
  { value: 'uniform', label: 'Uniforme' },
  { value: 'pert', label: 'PERT' },
];

function centerOf(p: MCParam): number {
  switch (p.kind) {
    case 'normal': return p.mean;
    case 'lognormal': return p.mean;
    case 'triangular': return p.mode;
    case 'uniform': return (p.min + p.max) / 2;
    case 'pert': return p.mode;
  }
}

function convertParam(prev: MCParam, kind: MCParam['kind'], def: MCVariableDef): MCParam {
  const cv = MC_MODEL_CONFIG.defaultCv[def.seedKey] ?? 0.1;
  return paramFromCenter(kind, centerOf(prev), cv, def.clamp);
}

// ─── Persistance locale des configurations ────────────────────────────────────

interface SavedConfig {
  name: string;
  circuit: MCCircuit;
  params: Record<string, MCParam>;
  correlations: Correlation[];
  iterations: number;
  blendEnabled?: boolean;
  blendDomains?: MCBlendDomain[];
}

const cfgStorageKey = (projectId: string) => `mfp_mc_configs_${projectId}`;
function loadConfigs(projectId: string): SavedConfig[] {
  try { const raw = localStorage.getItem(cfgStorageKey(projectId)); return raw ? (JSON.parse(raw) as SavedConfig[]) : []; } catch { return []; }
}
function saveConfigs(projectId: string, configs: SavedConfig[]) {
  try { localStorage.setItem(cfgStorageKey(projectId), JSON.stringify(configs)); } catch { /* quota/private mode */ }
}

// ─── Champ numérique + éditeur de loi ─────────────────────────────────────────

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="text-[11px] text-slate-400 uppercase">{label}</label>
      <input type="number" step="any" className="input-field" value={Number.isFinite(value) ? value : 0} onChange={e => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function ParamFields({ param, onChange }: { param: MCParam; onChange: (p: MCParam) => void }) {
  const set = (patch: Partial<MCParam>) => onChange({ ...param, ...patch } as MCParam);
  return (
    <div className="grid grid-cols-3 gap-2">
      {param.kind === 'normal' && (<>
        <NumField label="Moyenne" value={param.mean} onChange={v => set({ mean: v })} />
        <NumField label="Écart-type" value={param.std} onChange={v => set({ std: v })} />
      </>)}
      {param.kind === 'lognormal' && (<>
        <NumField label="Moyenne" value={param.mean} onChange={v => set({ mean: v })} />
        <NumField label="Écart-type" value={param.cv} onChange={v => set({ cv: v })} />
      </>)}
      {(param.kind === 'triangular' || param.kind === 'pert') && (<>
        <NumField label="Min" value={param.min} onChange={v => set({ min: v })} />
        <NumField label="Mode" value={param.mode} onChange={v => set({ mode: v })} />
        <NumField label="Max" value={param.max} onChange={v => set({ max: v })} />
      </>)}
      {param.kind === 'uniform' && (<>
        <NumField label="Min" value={param.min} onChange={v => set({ min: v })} />
        <NumField label="Max" value={param.max} onChange={v => set({ max: v })} />
      </>)}
    </div>
  );
}

function ParamEditor({ def, param, onChange }: { def: MCVariableDef; param: MCParam; onChange: (p: MCParam) => void }) {
  return (
    <div className="card-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="font-semibold text-white text-sm">{def.label} <span className="text-slate-500 font-normal">{def.unit}</span></div>
          <p className="text-[11px] text-slate-400 mt-0.5 max-w-xs">{def.hint}</p>
        </div>
        <select className="input-field w-36 text-sm" value={param.kind} onChange={e => onChange(convertParam(param, e.target.value as MCParam['kind'], def))}>
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <ParamFields param={param} onChange={onChange} />
    </div>
  );
}

// ─── Histogramme + tornado ────────────────────────────────────────────────────

function Histogram({ result, currency }: { result: MonteCarloResult; currency?: boolean }) {
  if (result.iterations === 0 || result.histogram.length === 0) return <div className="text-sm text-slate-500">Aucune donnée.</div>;
  const W = 640, H = 220, pad = 28;
  const maxCount = Math.max(...result.histogram);
  const n = result.histogram.length;
  const bw = (W - 2 * pad) / n;
  const min = result.binEdges[0], max = result.binEdges[n];
  const xOf = (v: number) => pad + ((v - min) / (max - min || 1)) * (W - 2 * pad);
  const fmt = (v: number) => currency ? formatCurrency(v, 0) : formatDecimalGrouped(v, Math.abs(v) < 10 ? 1 : 0);
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 480 }}>
        {result.histogram.map((c, i) => {
          const h = (c / maxCount) * (H - 2 * pad);
          return <rect key={i} x={pad + i * bw + 0.5} y={H - pad - h} width={Math.max(1, bw - 1)} height={h} fill="#6366f1" opacity={0.7} />;
        })}
        {([['P10', result.p10, '#f59e0b'], ['P50', result.p50, '#e2e8f0'], ['P90', result.p90, '#10b981']] as const).map(([lab, v, col]) => (
          <g key={lab}>
            <line x1={xOf(v)} x2={xOf(v)} y1={pad - 6} y2={H - pad} stroke={col} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={xOf(v)} y={pad - 10} fill={col} fontSize={11} textAnchor="middle">{lab}</text>
          </g>
        ))}
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="#475569" strokeWidth={1} />
        <text x={pad} y={H - 8} fill="#94a3b8" fontSize={10} textAnchor="start">{fmt(min)}</text>
        <text x={W - pad} y={H - 8} fill="#94a3b8" fontSize={10} textAnchor="end">{fmt(max)}</text>
      </svg>
    </div>
  );
}

function Tornado({ result, labelOf }: { result: MonteCarloResult; labelOf: (key: string) => string }) {
  const sens = (result.sensitivity ?? []).filter(s => Math.abs(s.correlation) > 0.01).slice(0, 10);
  if (sens.length === 0) return <div className="text-sm text-slate-500">Sensibilité indisponible.</div>;
  const maxAbs = Math.max(...sens.map(s => Math.abs(s.correlation)), 0.001);
  return (
    <div className="space-y-1.5">
      {sens.map(s => {
        const frac = Math.abs(s.correlation) / maxAbs;
        const pos = s.correlation >= 0;
        return (
          <div key={s.name} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-300 w-44 truncate" title={labelOf(s.name)}>{labelOf(s.name)}</span>
              <div className="flex-1 h-3 bg-slate-800 rounded relative overflow-hidden">
                <div className="h-full rounded" style={{ width: `${frac * 100}%`, backgroundColor: pos ? '#10b981' : '#ef4444' }} />
              </div>
            </div>
            <span className={`text-xs font-mono ${pos ? 'text-emerald-400' : 'text-red-400'}`}>{s.correlation >= 0 ? '+' : ''}{s.correlation.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Onglet principal ─────────────────────────────────────────────────────────

export default function MonteCarlo({ project: projectProp }: { project: { id: string; name: string } }) {
  const projectId = projectProp.id;
  const { project, effectiveRecoveryPct, globalRecoveryPct, assumptions, processFactors, totalOpex, adsorptionCircuit, characterization, domainRecovery } = useProject();

  const defaultCircuit: MCCircuit = adsorptionCircuit === 'CIP' ? 'cip' : 'cil';

  // ── Graine sourcée depuis les données projet (aucun centre en dur) ──────────
  const seed: MCSeed = useMemo(() => {
    const avg = (key: 'energy_kwh_t' | 'nacn_kg_t' | 'cao_kg_t'): number | null => {
      const vals = processFactors.map(f => f[key]).filter((v): v is number => typeof v === 'number' && v > 0);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const cyanideKgT = avg('nacn_kg_t') ?? DEFAULT_ASSUMPTIONS.CIL_NACN_FREEMILLING_KG_T;
    const limeKgT = avg('cao_kg_t') ?? DEFAULT_ASSUMPTIONS.LIME_CONSUMPTION_FREEMILLING_KG_T;
    const energyKwhT = avg('energy_kwh_t') ?? (characterization.bwiKwhT ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T) * DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR;

    const feedTpd = project.target_tph * 24;
    const availabilityFrac = project.availability_pct / 100;
    const p80Um = characterization.plantP80Um ?? characterization.labP80Um ?? P80_STUDY_DEFAULTS.TARGETS_UM[Math.floor(P80_STUDY_DEFAULTS.TARGETS_UM.length / 2)];
    const leachKPerH = MC_MODEL_CONFIG.fallbackLeachKPerH;
    const cilRetentionH = DEFAULT_ASSUMPTIONS.CIL_RETENTION_FREEMILLING_H;
    const adsLossPct = MC_MODEL_CONFIG.fallbackAdsLossPct;

    const cyanidePriceUsdKg = DEFAULT_ASSUMPTIONS.CYANIDE_COST_USD_KG;
    const limePriceUsdKg = DEFAULT_ASSUMPTIONS.LIME_COST_USD_KG;
    const electricityUsdKwh = DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;
    const goldPriceUsdOz = project.gold_price_usd;

    // « Autres coûts usine » ($/t) = OPEX projet moins les postes variables modélisés.
    const variableUnit = cyanideKgT * cyanidePriceUsdKg + limeKgT * limePriceUsdKg + energyKwhT * electricityUsdKwh;
    const otherCostsUsdT = Math.max(0, totalOpex - variableUnit);

    // Rmax calé pour que, aux paramètres nominaux, la récupération mécaniste
    // reproduise la récupération effective du projet (synchronisation).
    const hasLeach = circuitHasLeach(defaultCircuit);
    const hasCarbon = circuitHasCarbon(defaultCircuit);
    const nominalExt = leachExtraction(leachKPerH, cilRetentionH, hasLeach);
    const nominalAds = hasCarbon ? 1 - adsLossPct / 100 : 1;
    const targetRec = effectiveRecoveryPct / 100;
    const rmaxFrac = Math.max(0.05, Math.min(0.995, targetRec / Math.max(1e-6, nominalExt * nominalAds)));

    return {
      feedTpd, availabilityFrac, goldGradeGt: project.gold_grade_g_t, p80Um, rmaxFrac,
      leachKPerH, cilRetentionH, adsLossPct,
      cyanideKgT, limeKgT, energyKwhT,
      cyanidePriceUsdKg, limePriceUsdKg, electricityUsdKwh, otherCostsUsdT, goldPriceUsdOz,
      discountRate: assumptions.discountRate, lomYears: assumptions.lomYears,
    };
  }, [project, effectiveRecoveryPct, assumptions, processFactors, totalOpex, characterization, defaultCircuit]);

  // ── Domaines de blending seedés depuis la récupération par domaine (géomét.) ─
  const seededDomains: MCBlendDomain[] = useMemo(() => {
    const dr = domainRecovery;
    if (!dr || dr.byDomain.length < 2) return [];
    const total = dr.totalTonnes || dr.byDomain.reduce((a, b) => a + b.tonnes, 0) || 1;
    const cvShare = MC_MODEL_CONFIG.defaultCv.blendShare;
    const cvGrade = MC_MODEL_CONFIG.defaultCv.goldGradeGt;
    const cvRmax = MC_MODEL_CONFIG.defaultCv.rmaxFrac;
    return dr.byDomain.map(dc => ({
      id: canonDomain(dc.domain),
      name: dc.domain,
      share: paramFromCenter('normal', (dc.tonnes / total) * 100, cvShare, 'positive'),
      grade: paramFromCenter('lognormal', dc.gradeGt, cvGrade, 'positive'),
      rmax: paramFromCenter('pert', Math.min(0.995, dc.recoveryPct / 100), cvRmax, 'fraction'),
    }));
  }, [domainRecovery]);

  const [circuit, setCircuit] = useState<MCCircuit>(defaultCircuit);
  const [params, setParams] = useState<Record<string, MCParam>>(() => defaultParams(defaultCircuit, seed));
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [iterations, setIterations] = useState<number>(MC_MODEL_CONFIG.defaultIterations);
  const [blendEnabled, setBlendEnabled] = useState<boolean>(seededDomains.length > 0);
  const [blendDomains, setBlendDomains] = useState<MCBlendDomain[]>(seededDomains);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ outputs: Record<string, MonteCarloResult>; correlationsApplied: boolean; iterations: number } | null>(null);
  const [primary, setPrimary] = useState<MCOutputKey>('margin_year');

  const [configs, setConfigs] = useState<SavedConfig[]>(() => loadConfigs(projectId));
  const [configName, setConfigName] = useState('');

  useEffect(() => {
    setCircuit(defaultCircuit);
    setParams(defaultParams(defaultCircuit, seed));
    setCorrelations([]);
    setBlendDomains(seededDomains);
    setBlendEnabled(seededDomains.length > 0);
    setResult(null);
    setConfigs(loadConfigs(projectId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const activeVars = useMemo(() => variablesForCircuit(circuit), [circuit]);
  // Variables « à plat » réellement utilisées : quand le blending est actif, la
  // teneur et le Rmax global sont remplacés par les domaines.
  const flatVars = useMemo(
    () => activeVars.filter(v => !(blendEnabled && (v.key === 'gold_grade' || v.key === 'rmax'))),
    [activeVars, blendEnabled],
  );

  const labelOf = useCallback((key: string) => {
    if (key.startsWith('blend_')) {
      const m = key.match(/^blend_(.*)_(share|grade|rmax)$/);
      if (m) {
        const dom = blendDomains.find(d => d.id === m[1]);
        const part = m[2] === 'share' ? 'part' : m[2] === 'grade' ? 'teneur' : 'Rmax';
        return `${dom?.name ?? m[1]} · ${part}`;
      }
    }
    return MC_VARIABLES_LABEL[key] ?? key;
  }, [blendDomains]);

  const changeCircuit = (next: MCCircuit) => {
    setCircuit(next);
    const fresh = defaultParams(next, seed);
    setParams(prev => {
      const merged: Record<string, MCParam> = {};
      for (const v of variablesForCircuit(next)) merged[v.key] = prev[v.key] ?? fresh[v.key];
      return merged;
    });
    const keys = new Set(variablesForCircuit(next).map(v => v.key));
    setCorrelations(prev => prev.filter(c => keys.has(c.a) && keys.has(c.b)));
    setResult(null);
  };

  const resetToProject = () => {
    setParams(defaultParams(circuit, seed));
    setCorrelations([]);
    setBlendDomains(seededDomains);
    setResult(null);
  };

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const inputs = flatVars.map(v => ({ name: v.key, dist: toDistribution(params[v.key], v.clamp) }));
        const domainIds = blendEnabled ? blendDomains.map(d => d.id) : [];
        if (blendEnabled) {
          for (const dm of blendDomains) {
            const k = blendKeys(dm.id);
            inputs.push({ name: k.share, dist: toDistribution(dm.share, 'positive') });
            inputs.push({ name: k.grade, dist: toDistribution(dm.grade, 'positive') });
            inputs.push({ name: k.rmax, dist: toDistribution(dm.rmax, 'fraction') });
          }
        }
        const model = makeModel(circuit, seed, { blendDomainIds: domainIds });
        const res = runMonteCarloModel(inputs, correlations, model, MC_OUTPUT_KEYS, Math.max(1000, Math.min(200000, iterations)));
        setResult(res);
      } finally {
        setRunning(false);
      }
    }, 20);
  };

  const quality: QualityLevel = useMemo(() => {
    const tiers: SourceTier[] = [
      globalRecoveryPct != null ? 'testwork_validated' : 'design_criteria',
      'design_criteria', 'design_criteria', 'design_criteria',
      processFactors.length > 0 ? 'testwork_validated' : 'user_assumption',
      characterization.bwiKwhT != null ? 'testwork_validated' : 'user_assumption',
      characterization.plantP80Um != null || characterization.labP80Um != null ? 'testwork_validated' : 'user_assumption',
      'user_assumption', 'user_assumption', 'user_assumption',
    ];
    return qualityFromTiers(tiers);
  }, [globalRecoveryPct, processFactors, characterization]);
  const q = QUALITY_UI[quality];

  const saveCurrent = () => {
    const name = configName.trim();
    if (!name) return;
    const next: SavedConfig = { name, circuit, params, correlations, iterations, blendEnabled, blendDomains };
    setConfigs(prev => { const updated = [...prev.filter(c => c.name !== name), next]; saveConfigs(projectId, updated); return updated; });
    setConfigName('');
  };
  const applyConfig = (c: SavedConfig) => {
    setCircuit(c.circuit);
    // Fusion défensive : une config d'une version antérieure peut manquer des clés.
    setParams({ ...defaultParams(c.circuit, seed), ...c.params });
    setCorrelations(c.correlations);
    setIterations(c.iterations);
    setBlendEnabled(c.blendEnabled ?? false);
    setBlendDomains(c.blendDomains ?? seededDomains);
    setResult(null);
  };
  const deleteConfig = (name: string) => {
    setConfigs(prev => { const updated = prev.filter(c => c.name !== name); saveConfigs(projectId, updated); return updated; });
  };

  const outMeta = (key: string) => MC_OUTPUTS.find(o => o.key === key)!;
  const fmtOut = (key: MCOutputKey, v: number) => {
    const m = outMeta(key);
    if (m.unit === '%') return `${formatDecimalGrouped(v, 1)} %`;
    return m.currency ? formatCurrency(v, 0) : formatDecimalGrouped(v, Math.abs(v) < 10 ? 2 : 0);
  };

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-5xl space-y-4">
        <div className="flex items-center gap-2">
          <Dices size={18} className="text-violet-400" />
          <h3 className="section-title">Simulation Monte-Carlo</h3>
          <span className="text-xs text-slate-500">Modèle mécaniste (Rmax · libération · cinétique · pertes ADR) + blending géométallurgique</span>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg border bg-slate-800/60 border-slate-700">
          <span className={`w-2.5 h-2.5 rounded-full ${q.dot} flex-shrink-0`} />
          <div className="flex-1">
            <div className={`text-sm font-medium ${q.text}`}>Centres des lois — {q.label}</div>
            <div className="text-[11px] text-slate-400">
              Débit, teneur, disponibilité et prix or = critères du projet ; P80/BWi = essais ; réactifs/énergie = facteurs de procédé ; Rmax calé sur la récupération de la route active. Rien n'est en dur.
            </div>
          </div>
          <button onClick={resetToProject} className="btn btn-secondary text-xs"><RefreshCw size={12} /> Réinitialiser aux données projet</button>
        </div>

        {/* Circuit */}
        <div className="card">
          <h4 className="font-semibold text-white mb-1">Circuit de traitement</h4>
          <p className="text-xs text-slate-400 mb-2">Détermine les variables et les postes de coût simulés.</p>
          <select className="input-field max-w-md" value={circuit} onChange={e => changeCircuit(e.target.value as MCCircuit)}>
            {MC_CIRCUITS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">{MC_CIRCUITS.find(c => c.id === circuit)?.description}</p>
        </div>

        {/* Blending géométallurgique */}
        <BlendSection
          enabled={blendEnabled}
          onToggle={v => { setBlendEnabled(v); setResult(null); }}
          domains={blendDomains}
          onChange={d => { setBlendDomains(d); setResult(null); }}
          seed={seed}
          hasSeededDomains={seededDomains.length > 0}
        />

        {/* Paramètres d'entrée */}
        <div className="card">
          <div className="flex items-center gap-2 mb-1"><SlidersHorizontal size={16} className="text-amber-400" /><h4 className="font-semibold text-white">Paramètres d'entrée</h4></div>
          <p className="text-xs text-slate-400 mb-3">Distributions probabilistes des variables de procédé. Ajustables sans modifier le code.</p>
          {MC_SECTIONS.map(section => {
            const vars = flatVars.filter(v => v.section === section.id);
            if (vars.length === 0) return null;
            return (
              <div key={section.id} className="mb-4">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">{section.label}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {vars.map(v => <ParamEditor key={v.key} def={v} param={params[v.key]} onChange={p => setParams(prev => ({ ...prev, [v.key]: p }))} />)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Corrélations */}
        <CorrelationEditor vars={flatVars} correlations={correlations} onChange={setCorrelations} />

        {/* Itérations */}
        <div className="card flex flex-wrap items-end gap-4">
          <div>
            <label className="label">Nombre d'itérations</label>
            <input type="number" className="input-field w-48" value={iterations} min={1000} max={200000} step={1000} onChange={e => setIterations(Number(e.target.value))} />
            <p className="text-[11px] text-slate-500 mt-1">10 000 = bon compromis ; 100 000 = queues plus stables.</p>
          </div>
          <button onClick={run} disabled={running} className="btn btn-primary">
            {running ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />} {running ? 'Calcul…' : 'Lancer la simulation'}
          </button>
        </div>

        {/* Configs */}
        <div className="card">
          <div className="flex items-center gap-2 mb-2"><Save size={16} className="text-amber-400" /><h4 className="font-semibold text-white">Configurations sauvegardées</h4></div>
          <div className="flex items-center gap-2 mb-3">
            <input className="input-field flex-1 max-w-sm" placeholder="Nom de la configuration" value={configName} onChange={e => setConfigName(e.target.value)} />
            <button onClick={saveCurrent} disabled={!configName.trim()} className="btn btn-secondary text-sm"><Save size={14} /> Enregistrer</button>
          </div>
          {configs.length === 0 ? <p className="text-xs text-slate-500">Aucune configuration enregistrée.</p> : (
            <div className="space-y-1.5">
              {configs.map(c => (
                <div key={c.name} className="flex items-center justify-between p-2 rounded bg-slate-800 text-sm">
                  <div className="flex items-center gap-2">
                    <Layers size={13} className="text-slate-400" />
                    <span className="text-white">{c.name}</span>
                    <span className="text-[11px] text-slate-500">{MC_CIRCUITS.find(x => x.id === c.circuit)?.label} · {formatDecimalGrouped(c.iterations, 0)} itér.{c.blendEnabled ? ' · blend' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => applyConfig(c)} className="btn btn-secondary text-xs">Charger</button>
                    <button onClick={() => deleteConfig(c.name)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Résultats */}
        {result && result.iterations > 0 && (
          <div className="card space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="font-semibold text-white">Résultats — {formatDecimalGrouped(result.iterations, 0)} itérations valides</h4>
              {correlations.length > 0 && !result.correlationsApplied && (
                <span className="flex items-center gap-1 text-xs text-amber-400"><AlertTriangle size={13} /> Matrice de corrélation incohérente — tirages indépendants utilisés.</span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {MC_OUTPUTS.map(o => {
                const r = result.outputs[o.key];
                if (!r) return null;
                const selected = o.key === primary;
                return (
                  <button key={o.key} onClick={() => setPrimary(o.key)} className={`card-sm text-left transition ${selected ? 'ring-2 ring-violet-500' : 'hover:bg-slate-800'}`}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {o.direction === 'maximize' ? <TrendingUp size={13} className="text-emerald-400" /> : <TrendingDown size={13} className="text-rose-400" />}
                      <span className="text-xs text-slate-400">{o.label} <span className="text-slate-600">{o.unit}</span></span>
                    </div>
                    <div className="text-base font-bold text-white">{fmtOut(o.key, r.p50)}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">P10 {fmtOut(o.key, r.p10)} · P90 {fmtOut(o.key, r.p90)} · CV {(r.cv * 100).toFixed(0)}%</div>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-slate-300 mb-2">Distribution — {outMeta(primary).label}</div>
                <Histogram result={result.outputs[primary]} currency={outMeta(primary).currency} />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-300 mb-2">Sensibilité (corrélation de rang) — {outMeta(primary).label}</div>
                <Tornado result={result.outputs[primary]} labelOf={labelOf} />
                <p className="text-[10px] text-slate-500 mt-2">Barre verte = pousse la sortie dans le sens favorable ; rouge = défavorable. Longueur ∝ influence relative.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Section blending ─────────────────────────────────────────────────────────

function BlendSection({ enabled, onToggle, domains, onChange, seed, hasSeededDomains }: {
  enabled: boolean; onToggle: (v: boolean) => void;
  domains: MCBlendDomain[]; onChange: (d: MCBlendDomain[]) => void;
  seed: MCSeed; hasSeededDomains: boolean;
}) {
  // Défs synthétiques pour réutiliser l'éditeur de loi sur les champs de domaine.
  const shareDef: MCVariableDef = { key: 'share', label: 'Part', unit: '%', section: 'feed', circuits: 'all', defaultKind: 'normal', seedKey: 'availabilityFrac', hint: '', clamp: 'positive' };
  const gradeDef: MCVariableDef = { key: 'grade', label: 'Teneur', unit: 'g/t', section: 'feed', circuits: 'all', defaultKind: 'lognormal', seedKey: 'goldGradeGt', hint: '', clamp: 'positive' };
  const rmaxDef: MCVariableDef = { key: 'rmax', label: 'Rmax', unit: 'fraction', section: 'feed', circuits: 'all', defaultKind: 'pert', seedKey: 'rmaxFrac', hint: '', clamp: 'fraction' };

  const update = (i: number, patch: Partial<MCBlendDomain>) => onChange(domains.map((d, j) => j === i ? { ...d, ...patch } : d));
  const addDomain = () => {
    const id = `dom_${Date.now().toString(36)}`;
    onChange([...domains, {
      id, name: `Domaine ${domains.length + 1}`,
      share: paramFromCenter('normal', domains.length === 0 ? 100 : 20, MC_MODEL_CONFIG.defaultCv.blendShare, 'positive'),
      grade: paramFromCenter('lognormal', seed.goldGradeGt, MC_MODEL_CONFIG.defaultCv.goldGradeGt, 'positive'),
      rmax: paramFromCenter('pert', seed.rmaxFrac, MC_MODEL_CONFIG.defaultCv.rmaxFrac, 'fraction'),
    }]);
  };
  const remove = (i: number) => onChange(domains.filter((_, j) => j !== i));

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2"><Boxes size={16} className="text-cyan-400" /><h4 className="font-semibold text-white">Blending géométallurgique</h4></div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => onToggle(e.target.checked)} />
          Activer le mélange par domaine / type de minerai
        </label>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        L'alimentation devient un mélange de domaines, chacun avec sa teneur et son Rmax propres. La teneur se combine par la masse, la récupération par le <strong>métal contenu</strong>. Les parts fluctuantes capturent la variabilité du séquençage minier.
        {!hasSeededDomains && ' Aucun domaine mesuré dans le modèle de blocs — ajoutez-en manuellement (ex. Oxyde, Sulfuré, Réfractaire).'}
      </p>
      {enabled && (
        <div className="space-y-3">
          {domains.map((dm, i) => (
            <div key={dm.id} className="rounded-lg border border-slate-700 p-3">
              <div className="flex items-center justify-between mb-2">
                <input className="input-field w-56" value={dm.name} onChange={e => update(i, { name: e.target.value })} />
                <button onClick={() => remove(i)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <BlendField def={shareDef} label="Part (%)" param={dm.share} onChange={p => update(i, { share: p })} />
                <BlendField def={gradeDef} label="Teneur (g/t)" param={dm.grade} onChange={p => update(i, { grade: p })} />
                <BlendField def={rmaxDef} label="Rmax (fraction)" param={dm.rmax} onChange={p => update(i, { rmax: p })} />
              </div>
            </div>
          ))}
          <button onClick={addDomain} className="btn btn-secondary text-sm border-dashed w-full justify-center"><Plus size={14} /> Ajouter un domaine / type de minerai</button>
          <p className="text-[11px] text-slate-500">Les parts sont renormalisées à chaque tirage — inutile qu'elles somment exactement à 100.</p>
        </div>
      )}
    </div>
  );
}

function BlendField({ def, label, param, onChange }: { def: MCVariableDef; label: string; param: MCParam; onChange: (p: MCParam) => void }) {
  return (
    <div className="card-sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <select className="input-field w-28 text-xs" value={param.kind} onChange={e => onChange(convertParam(param, e.target.value as MCParam['kind'], def))}>
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <ParamFields param={param} onChange={onChange} />
    </div>
  );
}

// ─── Éditeur de corrélations (copule gaussienne) ──────────────────────────────

function CorrelationEditor({ vars, correlations, onChange }: { vars: MCVariableDef[]; correlations: Correlation[]; onChange: (c: Correlation[]) => void }) {
  const options = vars;
  const add = () => { if (options.length >= 2) onChange([...correlations, { a: options[0].key, b: options[1].key, rho: 0 }]); };
  const update = (i: number, patch: Partial<Correlation>) => onChange(correlations.map((c, j) => j === i ? { ...c, ...patch } : c));
  const remove = (i: number) => onChange(correlations.filter((_, j) => j !== i));
  return (
    <div className="card">
      <h4 className="font-semibold text-white mb-2">Corrélations entre variables</h4>
      <div className="space-y-2">
        {correlations.map((c, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <select className="input-field w-48" value={c.a} onChange={e => update(i, { a: e.target.value })}>
              {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <span className="text-slate-500">↔</span>
            <select className="input-field w-48" value={c.b} onChange={e => update(i, { b: e.target.value })}>
              {options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input type="number" step={0.05} min={-1} max={1} className="input-field w-24" value={c.rho} onChange={e => update(i, { rho: Math.max(-1, Math.min(1, Number(e.target.value))) })} />
            <button onClick={() => remove(i)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
          </div>
        ))}
        <button onClick={add} className="btn btn-secondary text-sm border-dashed w-full justify-center"><Plus size={14} /> Ajouter une corrélation</button>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Copule gaussienne : les variables corrélées sont tirées conjointement. Coefficient entre −1 et 1 (0 = indépendant).</p>
    </div>
  );
}

const MC_VARIABLES_LABEL: Record<string, string> = Object.fromEntries(
  MC_VARIABLES.map(v => [v.key, `${v.label} (${v.unit})`]),
);
