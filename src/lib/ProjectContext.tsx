import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Project } from '../types';
import { estimateRoutes, type RouteSampleCounts, type RouteStage } from './analytics/routeEstimation';
import { chosenRoute } from './analytics/routeChoice';
import { recoveryFromCurve } from './analytics/recoveryCurve';
import { recommendRefractoryCircuit } from './analytics/refractoryCircuit';
import {
  fitStageModel, predictStageRecovery,
  type StagePoint, type StageModel,
} from './analytics/stageRecoveryModel';
import { recommendAdsorptionCircuit } from './analytics/adsorptionCircuit';
import { DEFAULT_ASSUMPTIONS, computeProductionMetrics, resolveSettings, type ResolvedAssumptions } from './config/constants';
import { resolveMetConstants, sanitizeOverrides, type MetConstants, type MetConstantsOverrides } from './config/metConstants';
import type { Json } from './database.types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSettings {
  id?: string;
  hours_per_year: number | null;
  discount_rate_pct: number | null;
  sustaining_capex_musd_yr: number | null;
  contingency_pct: number | null;
  lom_years: number | null;
  debt_equity_ratio_pct: number | null;
  grid_ef_kg_co2_kwh: number | null;
  nacn_co2_factor: number | null;
  cao_co2_factor: number | null;
  diesel_co2_l: number | null;
  refinery_charge_usd_oz: number | null;
  royalty_pct: number | null;
  working_capital_pct: number | null;
  smelting_charge_pct: number | null;
}

export interface ModuleStatus {
  module_id: string;
  completion_pct: number;
  record_count: number;
  last_updated: string | null;
  is_linked: boolean;
  linked_from: string[] | null;
  metadata: Record<string, unknown> | null;
}

export interface LimsCampaign {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  sample_count_target: number | null;
  is_active: boolean;
}

export interface LimsDomain {
  id: string;
  name: string;
  code: string | null;
  color: string;
  description: string | null;
}

export interface ProcessFactor {
  id: string;
  equipment_type: string;
  energy_kwh_t: number | null;
  nacn_kg_t: number | null;
  cao_kg_t: number | null;
  water_m3_t: number | null;
  balls_kg_t: number | null;
  source: string;
  notes: string | null;
}

export interface CapexLine {
  id: string;
  category: string;
  sub_category: string | null;
  description: string;
  value_musd: number;
  contingency_pct: number;
  source: string;
  notes: string | null;
  sort_order: number;
}

export interface OpexLine {
  id: string;
  category: string;
  description: string;
  value_usd_t: number;
  source: string;
  notes: string | null;
  sort_order: number;
}

// ─── Context shape ────────────────────────────────────────────────────────────

interface ProjectContextValue {
  project: Project;
  settings: ProjectSettings | null;
  moduleStatuses: ModuleStatus[];
  campaigns: LimsCampaign[];
  domains: LimsDomain[];
  processFactors: ProcessFactor[];
  capexLines: CapexLine[];
  opexLines: OpexLine[];
  loading: boolean;

  saveSettings: (s: Partial<ProjectSettings>) => Promise<void>;
  upsertModuleStatus: (moduleId: string, patch: Partial<ModuleStatus>) => Promise<void>;
  addCampaign: (name: string, opts?: Partial<LimsCampaign>) => Promise<LimsCampaign | null>;
  deleteCampaign: (id: string) => Promise<void>;
  addDomain: (name: string, opts?: Partial<LimsDomain>) => Promise<LimsDomain | null>;
  deleteDomain: (id: string) => Promise<void>;
  upsertProcessFactor: (equip: string, patch: Partial<ProcessFactor>) => Promise<void>;
  addCapexLine: (line: Omit<CapexLine, 'id' | 'sort_order'>) => Promise<CapexLine | null>;
  updateCapexLine: (id: string, patch: Partial<CapexLine>) => Promise<void>;
  deleteCapexLine: (id: string) => Promise<void>;
  addOpexLine: (line: Omit<OpexLine, 'id' | 'sort_order'>) => Promise<OpexLine | null>;
  updateOpexLine: (id: string, patch: Partial<OpexLine>) => Promise<void>;
  deleteOpexLine: (id: string) => Promise<void>;
  refresh: () => Promise<void>;

  // Derived / synergy helpers
  getModuleStatus: (id: string) => ModuleStatus | null;
  /** Effective assumptions: code defaults with project_settings overrides applied. */
  assumptions: ResolvedAssumptions;
  totalCapex: number;
  totalOpex: number;
  annualTonnes: number;     // t/yr = tph × hours/yr × availability (single source for every module)
  annualProduction: number; // troy oz/yr derived from project + settings + effective recovery
  // Recoveries derived from LIMS testwork (null when no testwork yet).
  gravityRecoveryPct: number | null;  // gravity circuit recovery from GRG testwork
  leachRecoveryPct: number | null;    // leach test recovery (24 h)
  globalRecoveryPct: number | null;   // combined gravity + leach (series)
  effectiveRecoveryPct: number;       // globalRecoveryPct when available, else project.recovery_pct
  /**
   * Nom de la route ACTIVE dont provient globalRecoveryPct : celle retenue par
   * l'utilisateur dans son flowsheet, à défaut celle recommandée par le moteur.
   */
  recommendedRouteLabel: string | null;
  /** Vrai quand la route active vient du flowsheet de l'utilisateur, pas du moteur. */
  routeIsUserChoice: boolean;
  /**
   * Formule de la courbe auditée quand elle pilote la récupération (projet doté
   * d'un PFS/FS publié), sinon null — la composition d'étages fait alors foi.
   */
  auditedRecoveryBasis: string | null;
  /**
   * Modèles d'étage ajustés sur les essais DU PROJET (méthode du rapport
   * technique) : récupération en fonction de la teneur d'alimentation, avec R²,
   * effectif et plage de validité. `null` quand les essais ne les soutiennent pas.
   */
  stageModels: { flotation: StageModel | null; leach: StageModel | null };
  /**
   * Étages de la route recommandée, dans l'ordre du procédé — source unique de
   * l'affichage par étage. Vide tant qu'aucun testwork ne fonde de route : un
   * écran ne doit jamais supposer qu'un projet passe par la gravité.
   */
  recommendedRouteStages: RouteStage[];
  /** Circuit d'adsorption retenu (CIL ou CIP), décidé sur les facteurs d'exploitation. */
  adsorptionCircuit: 'CIL' | 'CIP';
  /** Durée de lixiviation effectivement utilisée ('48 h', ou repli 24 h). */
  leachDurationLabel: string | null;
  /** Constantes métallurgiques effectives (défauts ⊕ surcharges de projet). */
  metConstants: MetConstants;
  /** Surcharges brutes stockées (partielles) — alimente l'éditeur. */
  metOverrides: MetConstantsOverrides;
  /** Enregistre les surcharges de constantes métallurgiques du projet. */
  saveMetOverrides: (o: MetConstantsOverrides) => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

/** Moyennes d'essais LIMS alimentant la récupération partagée de l'application. */
interface RecAgg {
  grg: number | null;
  /** Lixiviation à la durée FINALE (48 h) — la référence de conception. */
  leach48: number | null;
  /** Lixiviation à 24 h — point de cinétique, repli seulement. */
  leach24: number | null;
  corg: number | null;
  sulphide: number | null;
  nacn: number | null;
  auFeed: number | null;
  flotAu: number | null;
  auFree: number | null;
  /** Essais de flottation en couples (teneur, récupération) — base d'ajustement. */
  flotPoints: StagePoint[];
  /** Essais de lixiviation 48 h en couples (teneur, récupération). */
  leachPoints: StagePoint[];
  counts: RouteSampleCounts;
}

export function ProjectProvider({ project, children }: { project: Project; children: ReactNode }) {
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [moduleStatuses, setModuleStatuses] = useState<ModuleStatus[]>([]);
  const [campaigns, setCampaigns] = useState<LimsCampaign[]>([]);
  const [domains, setDomains] = useState<LimsDomain[]>([]);
  const [processFactors, setProcessFactors] = useState<ProcessFactor[]>([]);
  const [capexLines, setCapexLines] = useState<CapexLine[]>([]);
  const [opexLines, setOpexLines] = useState<OpexLine[]>([]);
  const [metOverrides, setMetOverrides] = useState<MetConstantsOverrides>({});
  /** Équipements retenus par l'utilisateur dans « Critères de conception ». */
  const [flowsheetEquip, setFlowsheetEquip] = useState<Record<string, boolean> | null>(null);
  const [recAgg, setRecAgg] = useState<RecAgg>({
    grg: null, leach48: null, leach24: null, corg: null, sulphide: null,
    nacn: null, auFeed: null, flotAu: null, auFree: null,
    flotPoints: [], leachPoints: [],
    counts: { chem: 0, comminution: 0, knelson: 0, flotation: 0, leaching: 0, mineralogy: 0 },
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const pid = project.id;
    const [settRes, modRes, camRes, domRes, pfRes, cxRes, oxRes, grgRes, leachRes, chemRes, flotRes, libRes, pmcRes, dcRes] = await Promise.all([
      supabase.from('project_settings').select('*').eq('project_id', pid).maybeSingle(),
      supabase.from('module_status').select('*').eq('project_id', pid),
      supabase.from('lims_campaigns').select('*').eq('project_id', pid).order('created_at'),
      supabase.from('lims_domains').select('*').eq('project_id', pid).order('name'),
      supabase.from('process_factors').select('*').eq('project_id', pid).order('equipment_type'),
      supabase.from('capex_lines').select('*').eq('project_id', pid).order('sort_order'),
      supabase.from('opex_lines').select('*').eq('project_id', pid).order('sort_order'),
      // Essais LIMS alimentant la récupération partagée. Le moteur de routes
      // (lib/analytics/routeEstimation) a besoin de l'ensemble : la récupération
      // affichée est celle de la route RECOMMANDÉE, pas d'un circuit supposé.
      supabase.from('lims_test_knelson').select('grg_recovery_pct').eq('project_id', pid),
      supabase.from('lims_test_leaching').select('leach_rec_24h_pct,leach_rec_48h_pct,nacn_consumption_kg_t,au_feed_g_t').eq('project_id', pid),
      supabase.from('lims_test_chem').select('c_organic_pct,s_sulfide_pct').eq('project_id', pid),
      // La teneur d'alimentation accompagne la récupération : c'est le couple
      // (teneur, récupération) qui permet d'AJUSTER le modèle d'étage du projet,
      // comme le fait un rapport technique, au lieu d'en moyenner les essais.
      supabase.from('lims_test_flotation').select('au_recovery_pct,au_feed_g_t').eq('project_id', pid),
      supabase.from('lims_test_liberation').select('au_free_pct').eq('project_id', pid),
      // Surcharges de constantes métallurgiques (fail-open si la table n'existe
      // pas encore : migration pas appliquée → défauts de l'app).
      supabase.from('project_met_constants').select('overrides').eq('project_id', pid).maybeSingle(),
      // Flowsheet composé par l'utilisateur dans « Critères de conception » : il
      // porte la route qu'il a RETENUE, laquelle prime sur la recommandation du
      // moteur pour tous les chiffres de l'application.
      supabase.from('dc_draft').select('content').eq('project_id', pid).maybeSingle(),
    ]);
    setMetOverrides(sanitizeOverrides((pmcRes.error ? null : pmcRes.data?.overrides) ?? null));
    // Fail-open : sans brouillon de critères, aucun choix utilisateur — on
    // retombera sur la route recommandée par le moteur.
    const dcContent = (dcRes.error ? null : dcRes.data?.content) as { equip?: Record<string, boolean> } | null;
    setFlowsheetEquip(dcContent?.equip ?? null);
    if (settRes.data) setSettings(settRes.data as ProjectSettings);
    else setSettings(null);
    setModuleStatuses((modRes.data ?? []) as ModuleStatus[]);
    setCampaigns((camRes.data ?? []) as LimsCampaign[]);
    setDomains((domRes.data ?? []) as LimsDomain[]);
    setProcessFactors((pfRes.data ?? []) as ProcessFactor[]);
    setCapexLines((cxRes.data ?? []) as CapexLine[]);
    setOpexLines((oxRes.data ?? []) as OpexLine[]);
    const avg = (rows: { [k: string]: number | null }[] | null, key: string): number | null => {
      const v = (rows ?? []).map(r => r[key]).filter((x): x is number => typeof x === 'number' && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    /** Couples (teneur, récupération) exploitables pour un ajustement. */
    const points = (rows: { [k: string]: number | null }[] | null, gradeKey: string, recKey: string): StagePoint[] =>
      (rows ?? []).flatMap(r => {
        const g = r[gradeKey], y = r[recKey];
        return typeof g === 'number' && g > 0 && typeof y === 'number' && y > 0
          ? [{ gradeGt: g, recoveryPct: y }] : [];
      });
    const leachRows = leachRes.error ? [] : (leachRes.data ?? []);
    const chemRows = chemRes.error ? [] : (chemRes.data ?? []);
    setRecAgg({
      grg: avg(grgRes.error ? [] : grgRes.data, 'grg_recovery_pct'),
      leach48: avg(leachRows, 'leach_rec_48h_pct'),
      leach24: avg(leachRows, 'leach_rec_24h_pct'),
      corg: avg(chemRows, 'c_organic_pct'),
      sulphide: avg(chemRows, 's_sulfide_pct'),
      nacn: avg(leachRows, 'nacn_consumption_kg_t'),
      auFeed: avg(leachRows, 'au_feed_g_t'),
      flotAu: avg(flotRes.error ? [] : flotRes.data, 'au_recovery_pct'),
      auFree: avg(libRes.error ? [] : libRes.data, 'au_free_pct'),
      // Couples (teneur, récupération) bruts — matière première des ajustements.
      flotPoints: points(flotRes.error ? [] : flotRes.data, 'au_feed_g_t', 'au_recovery_pct'),
      leachPoints: points(leachRows, 'au_feed_g_t', 'leach_rec_48h_pct'),
      counts: {
        chem: chemRows.length,
        comminution: 0,
        knelson: (grgRes.error ? [] : grgRes.data ?? []).length,
        flotation: (flotRes.error ? [] : flotRes.data ?? []).length,
        leaching: leachRows.length,
        mineralogy: (libRes.error ? [] : libRes.data ?? []).length,
      },
    });
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  async function saveMetOverrides(next: MetConstantsOverrides) {
    const overrides = sanitizeOverrides(next);
    setMetOverrides(overrides); // optimiste
    await supabase.from('project_met_constants').upsert(
      { project_id: project.id, overrides: overrides as unknown as Json, updated_at: new Date().toISOString() },
      { onConflict: 'project_id' },
    );
  }

  async function saveSettings(patch: Partial<ProjectSettings>) {
    const merged = { ...settings, ...patch } as ProjectSettings;
    const payload = { project_id: project.id, ...merged, updated_at: new Date().toISOString() };
    if (settings?.id) {
      await supabase.from('project_settings').update(payload).eq('id', settings.id).eq('project_id', project.id);
    } else {
      const { data } = await supabase.from('project_settings').insert(payload).select('*').maybeSingle();
      if (data) setSettings(data as ProjectSettings);
      return;
    }
    setSettings(merged);
  }

  async function upsertModuleStatus(moduleId: string, patch: Partial<ModuleStatus>) {
    const existing = moduleStatuses.find(m => m.module_id === moduleId);
    const payload = {
      project_id: project.id,
      module_id: moduleId,
      completion_pct: patch.completion_pct ?? existing?.completion_pct ?? 0,
      record_count: patch.record_count ?? existing?.record_count ?? 0,
      last_updated: new Date().toISOString(),
      is_linked: patch.is_linked ?? existing?.is_linked ?? false,
      linked_from: patch.linked_from ?? existing?.linked_from ?? null,
      metadata: (patch.metadata ?? existing?.metadata ?? null) as Json,
    };
    await supabase.from('module_status').upsert(payload, { onConflict: 'project_id,module_id' });
    setModuleStatuses(prev => {
      const idx = prev.findIndex(m => m.module_id === moduleId);
      const updated = { ...payload } as ModuleStatus;
      if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
      return [...prev, updated];
    });
  }

  async function addCampaign(name: string, opts: Partial<LimsCampaign> = {}) {
    const { data } = await supabase.from('lims_campaigns').insert({
      project_id: project.id, name, ...opts,
    }).select('*').maybeSingle();
    if (data) setCampaigns(prev => [...prev, data as LimsCampaign]);
    return data as LimsCampaign | null;
  }

  async function deleteCampaign(id: string) {
    await supabase.from('lims_campaigns').delete().eq('id', id).eq('project_id', project.id);
    setCampaigns(prev => prev.filter(c => c.id !== id));
  }

  async function addDomain(name: string, opts: Partial<LimsDomain> = {}) {
    const { data } = await supabase.from('lims_domains').insert({
      project_id: project.id, name, ...opts,
    }).select('*').maybeSingle();
    if (data) setDomains(prev => [...prev, data as LimsDomain]);
    return data as LimsDomain | null;
  }

  async function deleteDomain(id: string) {
    await supabase.from('lims_domains').delete().eq('id', id).eq('project_id', project.id);
    setDomains(prev => prev.filter(d => d.id !== id));
  }

  async function upsertProcessFactor(equip: string, patch: Partial<ProcessFactor>) {
    const existing = processFactors.find(p => p.equipment_type === equip);
    const payload = { project_id: project.id, equipment_type: equip, ...patch, updated_at: new Date().toISOString() };
    const { data } = await supabase.from('process_factors')
      .upsert(payload, { onConflict: 'project_id,equipment_type' })
      .select('*').maybeSingle();
    if (data) {
      setProcessFactors(prev => {
        const idx = prev.findIndex(p => p.equipment_type === equip);
        const next = [...prev];
        if (idx >= 0) { next[idx] = data as ProcessFactor; } else { next.push(data as ProcessFactor); }
        return next;
      });
    }
  }

  async function addCapexLine(line: Omit<CapexLine, 'id' | 'sort_order'>) {
    const maxOrder = capexLines.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data, error } = await supabase.from('capex_lines').insert({
      project_id: project.id, ...line, sort_order: maxOrder + 1,
    }).select('*').maybeSingle();
    if (error) console.error('[capex insert error]', error.code, error.message);
    if (data) setCapexLines(prev => [...prev, data as CapexLine]);
    return data as CapexLine | null;
  }

  async function updateCapexLine(id: string, patch: Partial<CapexLine>) {
    await supabase.from('capex_lines').update(patch).eq('id', id).eq('project_id', project.id);
    setCapexLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  async function deleteCapexLine(id: string) {
    await supabase.from('capex_lines').delete().eq('id', id).eq('project_id', project.id);
    setCapexLines(prev => prev.filter(l => l.id !== id));
  }

  async function addOpexLine(line: Omit<OpexLine, 'id' | 'sort_order'>) {
    const maxOrder = opexLines.reduce((m, l) => Math.max(m, l.sort_order), 0);
    const { data } = await supabase.from('opex_lines').insert({
      project_id: project.id, ...line, sort_order: maxOrder + 1,
    }).select('*').maybeSingle();
    if (data) setOpexLines(prev => [...prev, data as OpexLine]);
    return data as OpexLine | null;
  }

  async function updateOpexLine(id: string, patch: Partial<OpexLine>) {
    await supabase.from('opex_lines').update(patch).eq('id', id).eq('project_id', project.id);
    setOpexLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));
  }

  async function deleteOpexLine(id: string) {
    await supabase.from('opex_lines').delete().eq('id', id).eq('project_id', project.id);
    setOpexLines(prev => prev.filter(l => l.id !== id));
  }

  function getModuleStatus(id: string): ModuleStatus | null {
    return moduleStatuses.find(m => m.module_id === id) ?? null;
  }

  const totalCapex = capexLines.reduce((s, l) => s + l.value_musd * (1 + l.contingency_pct / 100), 0);
  const totalOpex = opexLines.reduce((s, l) => s + l.value_usd_t, 0);

  // ── Recoveries from testwork ─────────────────────────────────────────────
  // Both circuits carry their lab→plant transfer factor (shared constants):
  // gravity ≈ GRG × 0.90, leach ≈ bottle-roll × 0.95. Global = 1 − (1 − R_grav)(1 − R_leach).
  // The leach discount previously lived only in the Analytics route engine, so the
  // recommended-route recovery (90 %) contradicted the headline recovery (92.6 %)
  // built from the very same tests. Falls back to design recovery when no testwork.
  // Le circuit d'adsorption se décide sur les facteurs d'exploitation, PAS sur
  // l'essai : un essai labo est une lixiviation, ni un CIL ni un CIP.
  const adsorptionDecision = recommendAdsorptionCircuit({
    organicCarbonPct: recAgg.corg,
    nacnKgT: recAgg.nacn,
    auFeedGt: recAgg.auFeed,
    sulphidePct: recAgg.sulphide,
  }, resolveMetConstants(metOverrides).adsorptionDecision);

  // La récupération affichée est celle de la route RECOMMANDÉE, calculée par le
  // moteur partagé avec « Analyse et Interprétation » et la section P80. Le
  // Tableau de bord supposait auparavant un circuit Gravité+CIL et le comparait
  // à une route recommandée qui pouvait être tout autre — d'où deux chiffres
  // différents pour le même projet.
  // ── Modèles d'étage AJUSTÉS SUR LES ESSAIS DU PROJET ─────────────────────
  // Méthode du rapport technique (PFS §13.5) : chaque étage est une FONCTION de
  // la teneur d'alimentation, ajustée par régression sur les essais du projet —
  // pas une moyenne. Deux projets aux essais différents obtiennent donc des
  // modèles différents, ce qu'aucune constante partagée ne peut rendre.
  // La moyenne reste le repli quand les essais ne soutiennent pas d'ajustement
  // (trop peu de points, ou R² sous le seuil : on ne bâtit pas sur du bruit).
  const fitSettings = resolveMetConstants(metOverrides).stageFit;
  const flotModel = fitStageModel(recAgg.flotPoints, 'saturating', fitSettings);
  const leachModel = fitStageModel(recAgg.leachPoints, 'logarithmic', fitSettings);
  const atHeadGrade = (mdl: StageModel | null): number | null => {
    if (!mdl || mdl.weak) return null;
    return predictStageRecovery(mdl, project.gold_grade_g_t)?.recoveryPct ?? null;
  };
  const flotFitted = atHeadGrade(flotModel);
  const leachFitted = atHeadGrade(leachModel);

  // Circuit oxydant choisi sur la CHIMIE du minerai — POX, BIOX, grillage et
  // Albion ont des critères opposés, et seul le grillage détruit le carbone
  // organique préempteur. Arsenic et carbonate ne sont pas encore analysés dans
  // le LIMS : passés à null, leurs critères sont simplement ignorés.
  const met = resolveMetConstants(metOverrides);
  const refractoryDecision = recommendRefractoryCircuit({
    sulphidePct: recAgg.sulphide,
    organicCarbonPct: recAgg.corg,
    arsenicPct: null,
    carbonatePct: null,
    throughputTph: project.target_tph,
  }, met.refractoryDecision);

  const routes = estimateRoutes({
    metrics: {
      leachRec48Pct: leachFitted ?? recAgg.leach48,
      leachRec24Pct: recAgg.leach24,
      grgPct: recAgg.grg,
      organicCarbonPct: recAgg.corg,
      flotationAuRecPct: flotFitted ?? recAgg.flotAu,
      sulphidePct: recAgg.sulphide,
      auFreePct: recAgg.auFree,
    },
    counts: recAgg.counts,
    adsorptionCircuit: adsorptionDecision.recommendation,
    stageEfficiencies: met.routeStageEfficiencies,
    refractoryCircuit: refractoryDecision.recommendation,
    refractoryEfficiencies: met.refractoryCircuits,
  });
  const recommendedRoute = routes.find(r => r.recommended) ?? null;

  // ⚠️ LA DÉCISION APPARTIENT AU MÉTALLURGISTE. `estimateRoutes` recommande, il
  // ne décide pas : la route qui pilote TOUS les chiffres de l'application est
  // celle que l'utilisateur a retenue dans son flowsheet (« Critères de
  // conception »). On ne retombe sur la recommandation que si aucun flowsheet
  // ne désigne de route chiffrable — jamais pour écraser un choix explicite.
  const userRoute = chosenRoute(routes, flowsheetEquip);
  const activeRoute = userRoute ?? recommendedRoute;

  // Contributions par étage, conservées pour l'affichage détaillé.
  const gravityRecoveryPct = recAgg.grg != null ? +(recAgg.grg * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY).toFixed(1) : null;
  const leachBasePct = recAgg.leach48 ?? recAgg.leach24;
  const leachRecoveryPct = leachBasePct != null ? +(leachBasePct * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY).toFixed(1) : null;

  // ── Courbe de récupération AUDITÉE ────────────────────────────────────────
  // Quand le projet dispose d'un rapport technique publié, sa courbe certifiée
  // prime sur toute reconstitution par composition d'étages : reconstituer un
  // chiffre déjà audité, c'est au mieux l'approcher, au pire contredire le
  // document de référence. Les coefficients sont propres au projet (surcharges),
  // jamais écrits dans le code.
  const auditedCurve = recoveryFromCurve(project.gold_grade_g_t, resolveMetConstants(metOverrides).recoveryCurve);

  const globalRecoveryPct = auditedCurve?.recoveryPct ?? activeRoute?.recovery_pct ?? null;
  const effectiveRecoveryPct = globalRecoveryPct ?? project.recovery_pct;

  // Assumptions = documented code defaults with any project_settings override layered on top.
  // Resolving here (rather than reading settings?.x directly) keeps every consumer on the same
  // numbers: a project with no saved settings still gets the default calendar hours instead of 0.
  const assumptions = resolveSettings(settings);

  const { annualTonnes, annualOz: annualProduction } = computeProductionMetrics(project, assumptions, effectiveRecoveryPct);

  return (
    <ProjectContext.Provider value={{
      project, settings, moduleStatuses, campaigns, domains, processFactors,
      capexLines, opexLines, loading,
      saveSettings, upsertModuleStatus,
      addCampaign, deleteCampaign,
      addDomain, deleteDomain,
      upsertProcessFactor,
      addCapexLine, updateCapexLine, deleteCapexLine,
      addOpexLine, updateOpexLine, deleteOpexLine,
      refresh: load,
      getModuleStatus,
      assumptions, totalCapex, totalOpex, annualTonnes, annualProduction,
      gravityRecoveryPct, leachRecoveryPct, globalRecoveryPct, effectiveRecoveryPct,
      recommendedRouteLabel: auditedCurve ? `${activeRoute?.route ?? 'courbe auditée'} · récup. auditée` : activeRoute?.route ?? null,
      recommendedRouteStages: activeRoute?.stages ?? [],
      routeIsUserChoice: userRoute != null,
      auditedRecoveryBasis: auditedCurve?.basis ?? null,
      stageModels: { flotation: flotModel, leach: leachModel },
      adsorptionCircuit: adsorptionDecision.recommendation,
      leachDurationLabel: recAgg.leach48 != null ? '48 h' : recAgg.leach24 != null ? '24 h (repli)' : null,
      metConstants: resolveMetConstants(metOverrides),
      metOverrides,
      saveMetOverrides,
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside ProjectProvider');
  return ctx;
}
