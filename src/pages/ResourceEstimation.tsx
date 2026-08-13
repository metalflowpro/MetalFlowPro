import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layers, Play, Save, RefreshCw, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { fetchAllParallel } from '../lib/db/fetchAll';
import type { Project, DhCollarRow, DhSurveyRow, DhAssayRow, ResourceRunRow } from '../types';
import { buildSamplePoints, boundsOf, buildGrid, type HoleData } from '../lib/resource/pipeline';
import { summaryStats } from '../lib/resource/statistics';
import { experimentalVariogram, fitVariogramModel, type VariogramModel } from '../lib/resource/variogram';
import { estimateGrid } from '../lib/resource/estimate';
import { gradeTonnage, crossValidate } from '../lib/resource/validation';
import { isMeasuredOrIndicated, DEFAULT_THRESHOLDS, type ResourceClass, type ClassificationThresholds } from '../lib/resource/classification';
import { isKnownMetal, getMetal } from '../lib/metals/registry';
import { formatDecimalGrouped } from '../lib/format/number';
import { DEFAULT_ASSUMPTIONS, RESOURCE_CUTOFF_LADDERS } from '../lib/config/constants';

interface RunConfig {
  element: string;
  compositeLength: number;
  blockX: number; blockY: number; blockZ: number;
  searchRadius: number;
  maxSamples: number;
  minSamples: number;
  method: 'kriging' | 'idw';
}

interface RunResult {
  nBlocks: number;
  nEstimated: number;
  variogram: VariogramModel | null;
  stats: ReturnType<typeof summaryStats>;
  classCounts: Record<string, number>;
  gradeTonnage: { cutoff: number; tonnes: number; meanGrade: number; metal: number }[];
  crossValidation: ReturnType<typeof crossValidate> | null;
}

const CLASSES: ResourceClass[] = ['Mesuré', 'Indiqué', 'Inféré'];

export function ResourceEstimation({ project }: { project: Project }) {
  const [collars, setCollars] = useState<DhCollarRow[]>([]);
  const [surveys, setSurveys] = useState<DhSurveyRow[]>([]);
  const [assays, setAssays] = useState<DhAssayRow[]>([]);
  const [runs, setRuns] = useState<ResourceRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [saved, setSaved] = useState(false);

  const [cfg, setCfg] = useState<RunConfig>({
    element: 'Cu', compositeLength: 2, blockX: 20, blockY: 20, blockZ: 12,
    searchRadius: 100, maxSamples: 12, minSamples: 3, method: 'kriging',
  });
  const [cutoffsText, setCutoffsText] = useState(RESOURCE_CUTOFF_LADDERS['pct'].join(', '));
  const [thresholds, setThresholds] = useState<ClassificationThresholds>(DEFAULT_THRESHOLDS);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Pagination PARALLÈLE obligatoire : sans pagination, `dh_assay` était
      // plafonné à 1000 lignes, l'estimation ne voyait qu'une poignée de trous →
      // grille minuscule et TOUS les blocs classés Inféré (grade-tonnage
      // Mesuré+Indiqué à zéro). Le fan-out parallèle + les colonnes ciblées (pas
      // de `select('*')`) réduisent nettement le temps de chargement initial.
      const [c, s, a, r] = await Promise.all([
        fetchAllParallel<DhCollarRow>(() => supabase.from('dh_collar').select('id,hole_id,x,y,z,max_depth').eq('project_id', project.id).order('hole_id')),
        fetchAllParallel<DhSurveyRow>(() => supabase.from('dh_survey').select('id,hole_id,depth,azimuth,dip').eq('project_id', project.id).order('hole_id').order('depth')),
        fetchAllParallel<DhAssayRow>(() => supabase.from('dh_assay').select('id,hole_id,from_m,to_m,element,value').eq('project_id', project.id).eq('qaqc_type', 'sample').order('hole_id').order('from_m')),
        supabase.from('resource_estimation_runs').select('*').eq('project_id', project.id).order('created_at', { ascending: false }),
      ]);
      if (c.error) throw c.error;
      setCollars(c.data ?? []); setSurveys(s.data ?? []); setAssays(a.data ?? []);
      setRuns((r.data as ResourceRunRow[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    } finally { setLoading(false); }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const elements = useMemo(() => Array.from(new Set(assays.map(a => a.element))).sort(), [assays]);
  useEffect(() => { if (elements.length && !elements.includes(cfg.element)) setCfg(c => ({ ...c, element: elements[0] })); }, [elements, cfg.element]);

  const density = project.ore_sg > 0 ? project.ore_sg : DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3;
  const unit = isKnownMetal(cfg.element) ? getMetal(cfg.element).gradeUnit : '';
  // Cut-offs pré-remplis depuis la config, adaptés à l'unité de teneur (% vs g/t) —
  // ce ne sont que des points de la courbe grade-tonnage, éditables ci-dessous ; le
  // cut-off économique réel se calcule dans le module Économie.
  useEffect(() => {
    if (unit === 'g/t' || unit === 'pct') setCutoffsText(RESOURCE_CUTOFF_LADDERS[unit].join(', '));
  }, [unit]);
  const cutoffs = useMemo(() => {
    return cutoffsText.split(',').map(s => Number(s.trim())).filter(Number.isFinite).sort((a, b) => a - b);
  }, [cutoffsText]);

  function runEstimation() {
    setRunning(true); setError(null); setResult(null); setSaved(false);
    // Laisse le navigateur peindre l'état "running" avant le calcul synchrone.
    setTimeout(() => {
      try {
        const holes: HoleData[] = collars.map(c => ({
          collar: { holeId: c.hole_id, x: c.x, y: c.y, z: c.z, maxDepth: c.max_depth ?? undefined },
          surveys: surveys.filter(s => s.hole_id === c.hole_id).map(s => ({ depth: s.depth, azimuth: s.azimuth, dip: s.dip })),
          samples: assays.filter(a => a.hole_id === c.hole_id && a.element === cfg.element).map(a => ({ from: a.from_m, to: a.to_m, value: a.value })),
        }));

        const points = buildSamplePoints(holes, cfg.compositeLength);
        if (points.length < 3) throw new Error(`Trop peu de composites (${points.length}) pour ${cfg.element}. Vérifiez les analyses et colliers.`);

        const stats = summaryStats(points.map(p => p.value));
        const bounds = boundsOf(points)!;

        let model: VariogramModel | null = null;
        if (cfg.method === 'kriging') {
          const lag = Math.max(cfg.blockX, cfg.blockY);
          const vg = experimentalVariogram(points, { lagDistance: lag, nLags: 12 });
          model = fitVariogramModel(vg, 'spherical');
        }

        const grid = buildGrid(bounds, { x: cfg.blockX, y: cfg.blockY, z: cfg.blockZ });
        const cells = estimateGrid(grid, points, {
          method: cfg.method, model: model ?? undefined,
          search: { radius: cfg.searchRadius, maxSamples: cfg.maxSamples, minSamples: cfg.minSamples },
          thresholds,
        });

        const estimated = cells.filter(c => c.value != null);
        const classCounts: Record<string, number> = { 'Mesuré': 0, 'Indiqué': 0, 'Inféré': 0, 'Non classé': 0 };
        const blockTonnes = cfg.blockX * cfg.blockY * cfg.blockZ * density;
        const gtBlocks: { grade: number; tonnes: number }[] = [];
        for (const c of estimated) {
          const key = c.class ?? 'Non classé';
          classCounts[key] = (classCounts[key] ?? 0) + 1;
          // Seul le Mesuré+Indiqué compte comme ressource pour le grade-tonnage.
          if (isMeasuredOrIndicated(c.class)) gtBlocks.push({ grade: c.value as number, tonnes: blockTonnes });
        }

        const gt = gradeTonnage(gtBlocks, cutoffs);
        const cv = cfg.method === 'kriging' && model
          ? crossValidate(points, model, { radius: cfg.searchRadius, maxSamples: cfg.maxSamples, minSamples: cfg.minSamples })
          : null;

        setResult({ nBlocks: grid.length, nEstimated: estimated.length, variogram: model, stats, classCounts, gradeTonnage: gt, crossValidation: cv });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Estimation impossible.');
      } finally { setRunning(false); }
    }, 30);
  }

  async function saveRun() {
    if (!result) return;
    try {
      const { error: e } = await supabase.from('resource_estimation_runs').insert({
        project_id: project.id,
        name: `${cfg.element} — ${cfg.method === 'kriging' ? 'Krigeage' : 'IDW'} ${new Date().toLocaleDateString('fr')}`,
        element: cfg.element, method: cfg.method, composite_length_m: cfg.compositeLength,
        block_x: cfg.blockX, block_y: cfg.blockY, block_z: cfg.blockZ,
        search_radius_m: cfg.searchRadius, max_samples: cfg.maxSamples, min_samples: cfg.minSamples,
        variogram: result.variogram,
        summary: {
          nBlocks: result.nEstimated,
          classCounts: result.classCounts,
          gradeTonnage: result.gradeTonnage,
          // Écart-type des composites : sert de référence de tolérance au gate de
          // conformité (biais de validation croisée ≤ 10 % σ, voir lib/compliance/gates).
          compositeStats: { n: result.stats.n, mean: result.stats.mean, stdev: result.stats.stdev, cv: result.stats.cv },
          // Seuils/cut-offs réellement utilisés pour CE run, conservés pour la traçabilité
          // réglementaire (un run passé doit rester reproductible même si les défauts changent).
          thresholds,
          cutoffs,
          crossValidation: result.crossValidation
            ? { n: result.crossValidation.n, meanError: result.crossValidation.meanError, rmse: result.crossValidation.rmse, correlation: result.crossValidation.correlation }
            : null,
        },
      } as never);
      if (e) throw e;
      setSaved(true);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sauvegarde impossible.');
    }
  }

  async function toggleEffective(run: ResourceRunRow) {
    // Un seul run d'effet à la fois (exigence de date d'effet unique).
    await supabase.from('resource_estimation_runs').update({ is_effective: false }).eq('project_id', project.id);
    await supabase.from('resource_estimation_runs').update({
      is_effective: !run.is_effective,
      effective_date: !run.is_effective ? new Date().toISOString().slice(0, 10) : null,
    }).eq('id', run.id);
    load();
  }

  async function deleteRun(id: string) {
    await supabase.from('resource_estimation_runs').delete().eq('id', id);
    load();
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Estimation de Ressource"
        subtitle="Composites → variographie → krigeage → classification CIM → grade-tonnage"
        breadcrumb={['Projet', 'Géologie & Ressource', 'Estimation']}
        icon={<Layers size={20} />}
        actions={<button className="mf-btn-ghost" onClick={load}><RefreshCw size={14} /> Recharger</button>}
      />

      <div className="flex-1 overflow-auto px-8 py-6 space-y-6">
        {error && <div className="mf-alert-error"><AlertCircle size={16} /> {error}</div>}

        {loading ? (
          <div className="text-mf-txt3 text-sm">Chargement…</div>
        ) : collars.length === 0 ? (
          <div className="text-mf-txt3 text-sm">
            Aucun forage. Importez d'abord des colliers et analyses dans le module <strong>Forages</strong>.
          </div>
        ) : (
          <>
            {/* Configuration */}
            <div className="border border-mf-border rounded-lg p-5 bg-mf-panel">
              <h3 className="text-sm font-semibold text-mf-txt mb-4">Paramètres d'estimation</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Élément">
                  <select className="mf-input" value={cfg.element} onChange={e => setCfg({ ...cfg, element: e.target.value })}>
                    {elements.map(el => <option key={el} value={el}>{el}</option>)}
                  </select>
                </Field>
                <Field label="Méthode">
                  <select className="mf-input" value={cfg.method} onChange={e => setCfg({ ...cfg, method: e.target.value as 'kriging' | 'idw' })}>
                    <option value="kriging">Krigeage ordinaire</option>
                    <option value="idw">IDW (repli)</option>
                  </select>
                </Field>
                <Field label="Longueur composite (m)"><NumInput value={cfg.compositeLength} on={v => setCfg({ ...cfg, compositeLength: v })} min={0.5} step={0.5} /></Field>
                <Field label="Rayon de recherche (m)"><NumInput value={cfg.searchRadius} on={v => setCfg({ ...cfg, searchRadius: v })} min={1} step={10} /></Field>
                <Field label="Bloc X (m)"><NumInput value={cfg.blockX} on={v => setCfg({ ...cfg, blockX: v })} min={1} step={5} /></Field>
                <Field label="Bloc Y (m)"><NumInput value={cfg.blockY} on={v => setCfg({ ...cfg, blockY: v })} min={1} step={5} /></Field>
                <Field label="Bloc Z (m)"><NumInput value={cfg.blockZ} on={v => setCfg({ ...cfg, blockZ: v })} min={1} step={2} /></Field>
                <Field label="Voisins max"><NumInput value={cfg.maxSamples} on={v => setCfg({ ...cfg, maxSamples: v })} min={1} step={1} /></Field>
                <Field label="Voisins min"><NumInput value={cfg.minSamples} on={v => setCfg({ ...cfg, minSamples: v })} min={1} step={1} /></Field>
                <Field label={`Cut-offs (${unit || 'unité teneur'}, séparés par virgule)`}>
                  <input className="mf-input" value={cutoffsText} onChange={e => setCutoffsText(e.target.value)} placeholder="0, 0.2, 0.3, 0.5" />
                </Field>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button className="mf-btn-primary" onClick={runEstimation} disabled={running}>
                  <Play size={14} /> {running ? 'Estimation…' : 'Lancer l\'estimation'}
                </button>
                <span className="text-xs text-mf-txt4">Densité utilisée : {density} t/m³ (projet) · cut-offs en {unit || 'unité teneur'}</span>
              </div>
            </div>

            {/* Seuils de classification CIM — paramétrables par le QP, jamais figés (voir lib/resource/classification). */}
            <div className="border border-mf-border rounded-lg p-5 bg-mf-panel">
              <h3 className="text-sm font-semibold text-mf-txt mb-1">Seuils de classification CIM</h3>
              <p className="text-xs text-mf-txt4 mb-4">
                À ajuster au variogramme et à l'espacement de forage réels du dépôt — ce sont des seuils de jugement du QP, pas une règle universelle.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Mesuré — distance max (m)">
                  <NumInput value={thresholds.measured.maxDistance} min={1} step={5}
                    on={v => setThresholds(t => ({ ...t, measured: { ...t.measured, maxDistance: v } }))} />
                </Field>
                <Field label="Mesuré — composites min">
                  <NumInput value={thresholds.measured.minSamples} min={1} step={1}
                    on={v => setThresholds(t => ({ ...t, measured: { ...t.measured, minSamples: v } }))} />
                </Field>
                <Field label="Mesuré — trous min">
                  <NumInput value={thresholds.measured.minHoles} min={1} step={1}
                    on={v => setThresholds(t => ({ ...t, measured: { ...t.measured, minHoles: v } }))} />
                </Field>
                <Field label="Indiqué — distance max (m)">
                  <NumInput value={thresholds.indicated.maxDistance} min={1} step={5}
                    on={v => setThresholds(t => ({ ...t, indicated: { ...t.indicated, maxDistance: v } }))} />
                </Field>
                <Field label="Indiqué — composites min">
                  <NumInput value={thresholds.indicated.minSamples} min={1} step={1}
                    on={v => setThresholds(t => ({ ...t, indicated: { ...t.indicated, minSamples: v } }))} />
                </Field>
                <Field label="Indiqué — trous min">
                  <NumInput value={thresholds.indicated.minHoles} min={1} step={1}
                    on={v => setThresholds(t => ({ ...t, indicated: { ...t.indicated, minHoles: v } }))} />
                </Field>
                <Field label="Inféré — distance max (m)">
                  <NumInput value={thresholds.inferred.maxDistance} min={1} step={5}
                    on={v => setThresholds(t => ({ ...t, inferred: { maxDistance: v } }))} />
                </Field>
              </div>
            </div>

            {/* Résultats */}
            {result && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat label="Blocs estimés" value={`${formatDecimalGrouped(result.nEstimated)} / ${formatDecimalGrouped(result.nBlocks)}`} />
                  <Stat label="Composites" value={formatDecimalGrouped(result.stats.n)} />
                  <Stat label={`Teneur moy. composites (${unit})`} value={result.stats.mean.toFixed(3)} />
                  <Stat label="CV composites" value={result.stats.cv.toFixed(2)} />
                </div>

                {result.variogram && (
                  <div className="border border-mf-border rounded-lg p-4 bg-mf-panel">
                    <h4 className="text-sm font-semibold text-mf-txt mb-2">Variogramme ajusté ({result.variogram.type})</h4>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <KV k="Pépite (nugget)" v={result.variogram.nugget.toFixed(4)} />
                      <KV k="Palier (sill)" v={result.variogram.sill.toFixed(4)} />
                      <KV k="Portée (m)" v={result.variogram.range.toFixed(0)} />
                    </div>
                  </div>
                )}

                {/* Classification CIM */}
                <div className="border border-mf-border rounded-lg p-4 bg-mf-panel">
                  <h4 className="text-sm font-semibold text-mf-txt mb-3">Répartition par classe CIM</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {CLASSES.map(c => <Stat key={c} label={c} value={formatDecimalGrouped(result.classCounts[c] ?? 0)} />)}
                    <Stat label="Non classé" value={formatDecimalGrouped(result.classCounts['Non classé'] ?? 0)} />
                  </div>
                  <p className="text-xs text-mf-txt4 mt-3">
                    Seuls <strong>Mesuré + Indiqué</strong> alimentent le grade-tonnage ci-dessous. L'Inféré est
                    exclu (règle CIM / NI 43-101).
                  </p>
                </div>

                {/* Grade-tonnage (M+I) */}
                <div className="border border-mf-border rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-mf-panel border-b border-mf-border text-sm font-semibold text-mf-txt">
                    Grade-Tonnage — Ressource Mesurée + Indiquée
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-mf-panel/50 text-mf-txt3">
                      <tr><th className="text-left px-4 py-2">Cut-off ({unit})</th><th className="text-right px-4 py-2">Tonnes</th><th className="text-right px-4 py-2">Teneur moy.</th><th className="text-right px-4 py-2">Métal contenu</th></tr>
                    </thead>
                    <tbody>
                      {result.gradeTonnage.map(g => (
                        <tr key={g.cutoff} className="border-t border-mf-border">
                          <td className="px-4 py-2 text-mf-txt2">{g.cutoff}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-mf-txt2">{formatDecimalGrouped(Math.round(g.tonnes))}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-mf-txt2">{g.meanGrade.toFixed(3)}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-mf-txt2">{formatDecimalGrouped(Math.round(g.metal))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Courbe grade-tonnage — lecture visuelle du compromis cut-off. */}
                {result.gradeTonnage.length > 1 && (
                  <GradeTonnageChart data={result.gradeTonnage} unit={unit} />
                )}

                {result.crossValidation && result.crossValidation.n > 0 && (
                  <div className="border border-mf-border rounded-lg p-4 bg-mf-panel">
                    <h4 className="text-sm font-semibold text-mf-txt mb-3">Validation croisée (leave-one-out)</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Stat label="n" value={formatDecimalGrouped(result.crossValidation.n)} />
                      <Stat label="Biais (erreur moy.)" value={result.crossValidation.meanError.toFixed(4)} />
                      <Stat label="RMSE" value={result.crossValidation.rmse.toFixed(4)} />
                      <Stat label="Corrélation" value={result.crossValidation.correlation != null ? result.crossValidation.correlation.toFixed(3) : '—'} />
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button className="mf-btn-primary" onClick={saveRun}><Save size={14} /> Enregistrer ce run</button>
                  {saved && <span className="text-emerald-400 text-sm flex items-center gap-1"><CheckCircle2 size={14} /> Enregistré</span>}
                </div>
              </div>
            )}

            {/* Historique */}
            {runs.length > 0 && (
              <div className="border border-mf-border rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-mf-panel border-b border-mf-border text-sm font-semibold text-mf-txt">Runs enregistrés</div>
                <table className="w-full text-sm">
                  <thead className="bg-mf-panel/50 text-mf-txt3">
                    <tr><th className="text-left px-4 py-2">Nom</th><th className="px-4 py-2">Élément</th><th className="px-4 py-2">Méthode</th><th className="px-4 py-2">Blocs</th><th className="px-4 py-2">Effet</th><th className="px-4 py-2"></th></tr>
                  </thead>
                  <tbody>
                    {runs.map(r => (
                      <tr key={r.id} className="border-t border-mf-border">
                        <td className="px-4 py-2 text-mf-txt2">{r.name}</td>
                        <td className="px-4 py-2 text-center">{r.element}</td>
                        <td className="px-4 py-2 text-center">{r.method}</td>
                        <td className="px-4 py-2 text-center tabular-nums">{formatDecimalGrouped(r.summary?.nBlocks ?? 0)}</td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => toggleEffective(r)} className={`text-xs px-2 py-0.5 rounded ${r.is_effective ? 'bg-emerald-500/20 text-emerald-400' : 'text-mf-txt4 hover:text-mf-txt'}`}>
                            {r.is_effective ? `Effet ${r.effective_date ?? ''}` : 'Marquer'}
                          </button>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <button onClick={() => deleteRun(r.id)} className="text-mf-txt4 hover:text-red-400"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Courbe grade-tonnage classique : cut-off en abscisse, tonnage (décroissant,
 * axe gauche bleu) et teneur moyenne (croissante, axe droit ambre) en ordonnée.
 * Rend visible d'un coup d'œil le compromis « on remonte le cut-off → moins de
 * tonnes mais meilleure teneur », que le tableau seul ne montre pas.
 */
function GradeTonnageChart({ data, unit }: {
  data: { cutoff: number; tonnes: number; meanGrade: number; metal: number }[];
  unit: string;
}) {
  const W = 720, H = 300, padL = 64, padR = 64, padT = 16, padB = 44;
  const xs = data.map(d => d.cutoff);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const maxT = Math.max(1, ...data.map(d => d.tonnes));
  const maxG = Math.max(0.0001, ...data.map(d => d.meanGrade));
  const px = (x: number) => padL + (maxX === minX ? 0.5 : (x - minX) / (maxX - minX)) * (W - padL - padR);
  const pyT = (t: number) => padT + (1 - t / maxT) * (H - padT - padB);
  const pyG = (g: number) => padT + (1 - g / maxG) * (H - padT - padB);
  const line = (fy: (n: number) => number, key: 'tonnes' | 'meanGrade') =>
    data.map(d => `${px(d.cutoff)},${fy(d[key])}`).join(' ');
  const COL_T = '#38bdf8', COL_G = '#f59e0b';
  const fmtT = (t: number) => t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${(t / 1e3).toFixed(0)}k` : `${Math.round(t)}`;

  return (
    <div className="border border-mf-border rounded-lg p-4 bg-mf-panel">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-mf-txt">Courbe grade-tonnage (Mesuré + Indiqué)</h4>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5 text-mf-txt3"><span className="inline-block w-3 h-0.5" style={{ background: COL_T }} /> Tonnage</span>
          <span className="flex items-center gap-1.5 text-mf-txt3"><span className="inline-block w-3 h-0.5" style={{ background: COL_G }} /> Teneur moy. {unit && `(${unit})`}</span>
        </div>
      </div>
      <div className="overflow-auto">
        <svg width={W} height={H} className="block max-w-full">
          {/* grille horizontale */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = padT + f * (H - padT - padB);
            return <line key={f} x1={padL} y1={y} x2={W - padR} y2={y} stroke="#2a3548" strokeWidth={0.5} />;
          })}
          {/* axes */}
          <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke={COL_T} strokeWidth={1} />
          <line x1={W - padR} y1={padT} x2={W - padR} y2={H - padB} stroke={COL_G} strokeWidth={1} />
          {/* graduations tonnage (gauche) et teneur (droite) */}
          {[0, 0.5, 1].map(f => {
            const y = padT + (1 - f) * (H - padT - padB);
            return (
              <g key={f}>
                <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={10} fill={COL_T}>{fmtT(f * maxT)}</text>
                <text x={W - padR + 6} y={y + 3} textAnchor="start" fontSize={10} fill={COL_G}>{(f * maxG).toFixed(2)}</text>
              </g>
            );
          })}
          {/* graduations cut-off (abscisse) */}
          {data.map(d => (
            <text key={d.cutoff} x={px(d.cutoff)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="#7a8699">{d.cutoff}</text>
          ))}
          <text x={(padL + W - padR) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#9aa7ba">Cut-off ({unit || 'unité teneur'})</text>
          {/* courbes */}
          <polyline points={line(pyT, 'tonnes')} fill="none" stroke={COL_T} strokeWidth={2} />
          <polyline points={line(pyG, 'meanGrade')} fill="none" stroke={COL_G} strokeWidth={2} strokeDasharray="4 3" />
          {data.map(d => <circle key={`t${d.cutoff}`} cx={px(d.cutoff)} cy={pyT(d.tonnes)} r={2.8} fill={COL_T} />)}
          {data.map(d => <circle key={`g${d.cutoff}`} cx={px(d.cutoff)} cy={pyG(d.meanGrade)} r={2.8} fill={COL_G} />)}
        </svg>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="text-mf-txt3">{label}</span>{children}</label>;
}
function NumInput({ value, on, min, step }: { value: number; on: (v: number) => void; min: number; step: number }) {
  return <input type="number" className="mf-input" value={value} min={min} step={step}
    onChange={e => on(Math.max(min, Number(e.target.value) || min))} />;
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-mf-border rounded-lg p-3 bg-mf-panel">
      <div className="text-xs text-mf-txt4 mb-1">{label}</div>
      <div className="text-lg font-bold text-mf-txt tabular-nums">{value}</div>
    </div>
  );
}
function KV({ k, v }: { k: string; v: string }) {
  return <div><span className="text-mf-txt4">{k} : </span><span className="text-mf-txt2 font-medium tabular-nums">{v}</span></div>;
}
