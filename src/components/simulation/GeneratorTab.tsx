import { useState, useMemo } from 'react';
import { Sparkles, Wand2, AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { useProject } from '../../lib/ProjectContext';
import {
  generateFlowsheets, GENERATION_OBJECTIVE_LABEL,
  type GenerationObjective, type GenerationResult, type MaturityLevel, type GeneratorFeed,
} from '../../lib/simulation/generator';
import { matchTemplateForRoute, FLOWSHEET_TEMPLATES } from '../../lib/simulation/templateLibrary';
import { QUALITY_UI, CONFIDENCE_UI } from './simUi';

const MATURITY_LABEL: Record<MaturityLevel, string> = {
  conceptual: 'Conceptuel',
  pea: 'PEA',
  pre_feasibility: 'Pré-faisabilité',
  feasibility: 'Faisabilité',
  plant_optimization: 'Optimisation usine',
};

const EXCLUDABLE = ['POX', 'BIOX', 'Flottation', 'Gravité', 'Heap Leach', 'HPGR'];

/**
 * Générateur automatique de flowsheet (§6). Ne recalcule aucune récupération :
 * il consomme les routes déjà chiffrées par le contexte projet (estimateRoutes)
 * et la caractérisation minerai, puis classe 2-5 scénarios explicables.
 */
export default function GeneratorTab({ onUseTemplate }: { onUseTemplate: (templateId: string) => void }) {
  const { project, characterization, routeCandidates } = useProject();

  const [objective, setObjective] = useState<GenerationObjective>('max_recovery');
  const [maturity, setMaturity] = useState<MaturityLevel>('pre_feasibility');
  const [throughput, setThroughput] = useState<number>(project.target_tph || 500);
  const [preferredRoute, setPreferredRoute] = useState<string>('auto');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [maxScenarios, setMaxScenarios] = useState<number>(3);
  const [result, setResult] = useState<GenerationResult | null>(null);

  const feed: GeneratorFeed = useMemo(() => ({
    goldGrade: project.gold_grade_g_t || 0,
    grgPct: characterization.grgPct,
    sulphidePct: characterization.sulphidePct,
    corgPct: characterization.organicCarbonPct,
    bwiKwhT: null,   // câblage BWi (module comminution) à venir → hypothèse
    labP80Um: null,  // câblage Étude P80 à venir → hypothèse
    plantP80Um: null,
  }), [project.gold_grade_g_t, characterization]);

  function run() {
    const res = generateFlowsheets({
      request: {
        objective, maturity, designThroughputTph: throughput,
        preferredRoute: preferredRoute === 'auto' ? null : preferredRoute,
        excludedTechnologies: excluded, maxScenarios,
      },
      candidateRoutes: routeCandidates,
      feed,
      sampleCounts: characterization.sampleCounts as unknown as Record<string, number>,
      templateMatcher: matchTemplateForRoute,
    });
    setResult(res);
  }

  const routeOptions = useMemo(() => ['auto', ...routeCandidates.map(r => r.route)], [routeCandidates]);

  return (
    <div className="p-6 overflow-y-auto h-full">
      <div className="max-w-5xl space-y-4">
        {/* Configuration */}
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-amber-400" />
            <h3 className="section-title">Générer un flowsheet recommandé</h3>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="label">Objectif principal</label>
              <select className="input-field" value={objective} onChange={e => setObjective(e.target.value as GenerationObjective)}>
                {(Object.keys(GENERATION_OBJECTIVE_LABEL) as GenerationObjective[]).map(o => (
                  <option key={o} value={o}>{GENERATION_OBJECTIVE_LABEL[o]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Niveau de maturité</label>
              <select className="input-field" value={maturity} onChange={e => setMaturity(e.target.value as MaturityLevel)}>
                {(Object.keys(MATURITY_LABEL) as MaturityLevel[]).map(m => (
                  <option key={m} value={m}>{MATURITY_LABEL[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Débit de conception (t/h)</label>
              <input type="number" className="input-field" value={throughput} min={1}
                onChange={e => setThroughput(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Route préférée</label>
              <select className="input-field" value={preferredRoute} onChange={e => setPreferredRoute(e.target.value)}>
                {routeOptions.map(r => <option key={r} value={r}>{r === 'auto' ? 'Auto — toutes les routes' : r}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Scénarios (2 à 5)</label>
              <input type="number" className="input-field" value={maxScenarios} min={2} max={5}
                onChange={e => setMaxScenarios(Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Technologies exclues</label>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {EXCLUDABLE.map(tech => {
                  const on = excluded.includes(tech);
                  return (
                    <button key={tech} type="button"
                      onClick={() => setExcluded(prev => on ? prev.filter(t => t !== tech) : [...prev, tech])}
                      className={`px-2 py-0.5 text-xs rounded-full border ${on ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'border-slate-600 text-slate-400 hover:border-slate-400'}`}>
                      {tech}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Aperçu de la caractérisation utilisée */}
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400 border-t border-slate-700 pt-3">
            <span>Teneur Au : <span className="text-white font-mono">{formatDecimalGrouped(project.gold_grade_g_t, 2)} g/t</span></span>
            <span>GRG : <span className="font-mono">{characterization.grgPct != null ? `${formatDecimalGrouped(characterization.grgPct, 1)} %` : '— (hypothèse)'}</span></span>
            <span>Sulfures : <span className="font-mono">{characterization.sulphidePct != null ? `${formatDecimalGrouped(characterization.sulphidePct, 1)} %` : '— (hypothèse)'}</span></span>
            <span>C org. : <span className="font-mono">{characterization.organicCarbonPct != null ? `${formatDecimalGrouped(characterization.organicCarbonPct, 2)} %` : '— (hypothèse)'}</span></span>
            <span>Routes chiffrables : <span className="font-mono">{routeCandidates.length}</span></span>
          </div>

          <button onClick={run} disabled={routeCandidates.length === 0} className="btn btn-primary mt-4">
            <Wand2 size={14} /> Générer les scénarios
          </button>
          {routeCandidates.length === 0 && (
            <div className="mt-2 text-xs text-amber-400">Aucune route chiffrable — ajoutez des essais LIMS (lixiviation, GRG…) au projet.</div>
          )}
        </div>

        {/* Résultats */}
        {result && (
          <>
            {result.warnings.length > 0 && (
              <div className="card border-amber-600/40 bg-amber-500/5">
                <div className="flex items-center gap-2 mb-2 text-amber-300 text-sm font-medium">
                  <AlertTriangle size={14} /> Avertissements
                </div>
                <ul className="space-y-1 text-xs text-amber-200/80 list-disc list-inside">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            {result.scenarios.map(s => {
              const q = QUALITY_UI[s.quality];
              const conf = CONFIDENCE_UI[s.confidence];
              const template = s.templateId ? FLOWSHEET_TEMPLATES.find(t => t.id === s.templateId) : null;
              return (
                <div key={s.id} className="card">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${q.dot}`} title={q.label} />
                        <span className="text-xs uppercase tracking-wide text-slate-400">Scénario {s.rank}</span>
                        <span className={`badge ${s.rank === 1 ? 'badge-success' : 'badge-info'}`}>{s.title}</span>
                      </div>
                      <div className="text-white font-semibold mt-1">{s.route}</div>
                    </div>
                    <span className={`badge ${conf.badge}`}>confiance {conf.label}</span>
                  </div>

                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Récupération Au', value: `${formatDecimalGrouped(s.recoveryPct, 1)} %` },
                      { label: 'Or récupéré', value: `${formatDecimalGrouped(s.ozPerDay, 0)} oz/j` },
                      { label: 'P80 broyage', value: s.primaryGrindP80Um != null ? `${formatDecimalGrouped(s.primaryGrindP80Um, 0)} µm` : '—' },
                      { label: 'Débit', value: `${formatDecimalGrouped(s.throughputTph, 0)} t/h` },
                    ].map(k => (
                      <div key={k.label} className="p-2 rounded bg-slate-800">
                        <div className="text-xs text-slate-400">{k.label}</div>
                        <div className="font-semibold text-white">{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Barre données / hypothèses */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>Données utilisées : {s.dataPct}%</span>
                      <span>Hypothèses : {s.assumptionPct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden flex">
                      <div className="bg-emerald-500" style={{ width: `${s.dataPct}%` }} />
                      <div className="bg-amber-500" style={{ width: `${s.assumptionPct}%` }} />
                    </div>
                  </div>

                  {s.decisionLog.length > 0 && (
                    <div className="text-xs text-slate-400 mb-2">{s.decisionLog.join(' · ')}</div>
                  )}
                  {s.assumptions.length > 0 && (
                    <details className="text-xs text-slate-500 mb-3">
                      <summary className="cursor-pointer hover:text-slate-300">Hypothèses ({s.assumptions.length})</summary>
                      <ul className="mt-1 space-y-0.5 list-disc list-inside">
                        {s.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                      </ul>
                    </details>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => s.templateId && onUseTemplate(s.templateId)}
                      disabled={!s.templateId}
                      className="btn btn-secondary text-sm"
                      title={s.templateId ? 'Instancier le template dans l\'éditeur' : 'Aucun template de topologie associé'}>
                      <ArrowRight size={14} /> Utiliser ce scénario
                    </button>
                    {template && <span className="text-xs text-slate-500">→ template « {template.name} »</span>}
                  </div>
                </div>
              );
            })}

            {result.decisionLog.length > 0 && (
              <div className="card">
                <div className="flex items-center gap-2 mb-2 text-slate-300 text-sm font-medium">
                  <Info size={14} /> Journal de décision (caractérisation)
                </div>
                <ul className="space-y-1 text-xs text-slate-400 list-disc list-inside">
                  {result.decisionLog.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
