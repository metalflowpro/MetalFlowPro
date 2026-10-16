/* eslint-disable react-refresh/only-export-components -- module de types, constantes et calculs de la page (aucun composant d'écran) : le rechargement à chaud n'a pas d'état à préserver ici. */
import {
  BarChart3,
  Database, Layers, TrendingUp,
  Activity, FlaskConical, Cpu, GitBranch,
  ShieldCheck, Scale, History,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchAll } from '../../lib/db/fetchAll';
import { TROY_OZ_GRAMS } from '../../lib/config/constants';
import { canonDomain, derivePregRobbing } from '../../lib/geomet/domains';
import {
  type ConfidenceLevel,
} from '../../lib/geomet/quality';
import { type ReconStatus,
} from '../../lib/geomet/reconciliation';

export type Tab = 'domains' | 'gid' | 'metallurgie' | 'blend' | 'lomsim' | 'graphs'
  | 'quality' | 'validation' | 'versions';

// Sous-vues internes de l'écran fusionné « Récupération & prédiction ».
export type MetalView = 'curves' | 'variability' | 'prediction';

export const METAL_VIEWS: { id: MetalView; label: string; icon: React.ReactNode }[] = [
  { id: 'curves',      label: 'Grade-Récup.',      icon: <TrendingUp size={11}/> },
  { id: 'variability', label: 'Variabilité',       icon: <Activity size={11}/> },
  { id: 'prediction',  label: 'Prédiction Métal.', icon: <FlaskConical size={11}/> },
];

export const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'domains',     label: 'Domaines GéoMet',        icon: <Layers size={11}/> },
  { id: 'gid',         label: 'Mapping GID',             icon: <Database size={11}/> },
  { id: 'metallurgie', label: 'Récupération & prédiction', icon: <TrendingUp size={11}/> },
  { id: 'lomsim',      label: 'Simulation LOM',          icon: <Cpu size={11}/> },
  { id: 'blend',       label: 'Optimisation Blend',      icon: <GitBranch size={11}/> },
  { id: 'graphs',      label: 'Graphiques',              icon: <BarChart3 size={11}/> },
  { id: 'quality',     label: 'Qualité & couverture',    icon: <ShieldCheck size={11}/> },
  { id: 'validation',  label: 'Validation & réconc.',    icon: <Scale size={11}/> },
  { id: 'versions',    label: 'Versions du modèle',      icon: <History size={11}/> },
];

// Regroupement des onglets en 4 sections de premier niveau. Chaque groupe
// expose ses sous-onglets (barre secondaire) tout en préservant l'intégralité
// des écrans existants.
type GroupId = 'domaines' | 'metallurgie' | 'simulation' | 'assurance';

export const TAB_GROUPS: { id: GroupId; label: string; icon: React.ReactNode; tabs: Tab[] }[] = [
  { id: 'domaines',    label: 'Domaines',        icon: <Layers size={11}/>,       tabs: ['domains', 'gid'] },
  { id: 'metallurgie', label: 'Métallurgie',     icon: <TrendingUp size={11}/>,   tabs: ['metallurgie', 'graphs'] },
  { id: 'simulation',  label: 'Simulation',      icon: <Cpu size={11}/>,          tabs: ['lomsim', 'blend'] },
  { id: 'assurance',   label: 'Assurance qualité', icon: <ShieldCheck size={11}/>, tabs: ['quality', 'validation', 'versions'] },
];

export const groupForTab = (t: Tab): GroupId =>
  TAB_GROUPS.find(g => g.tabs.includes(t))?.id ?? 'domaines';

// Libellés/couleurs partagés des niveaux de confiance (écran Qualité & couverture).
export const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; color: string; bg: string }> = {
  high:   { label: 'Élevée',          color: '#10B981', bg: 'bg-emerald-400/10 text-emerald-300' },
  medium: { label: 'Moyenne',         color: '#F59E0B', bg: 'bg-amber-400/10 text-amber-300' },
  low:    { label: 'Faible',          color: '#F06B6B', bg: 'bg-red-400/10 text-red-300' },
  none:   { label: 'Non caractérisé', color: '#6B7280', bg: 'bg-white/5 mf-txt3' },
};

export const RECON_STATUS_META: Record<ReconStatus, { label: string; bg: string }> = {
  acceptable: { label: 'Acceptable',      bg: 'bg-emerald-400/10 text-emerald-300' },
  review:     { label: 'À revoir',        bg: 'bg-amber-400/10 text-amber-300' },
  revise:     { label: 'Réviser modèle',  bg: 'bg-red-400/10 text-red-300' },
  na:         { label: '—',               bg: 'bg-white/5 mf-txt3' },
};

export const DOMAIN_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#F06B6B', '#8B5CF6', '#F88A44', '#06B6D4', '#84CC16'];

export const TROY = TROY_OZ_GRAMS;

export interface GeometDomain {
  id: string;
  project_id: string;
  name: string;
  gid_code: string | null;
  color: string | null;
  sample_count: number | null;
  lom_pct: number | null;
  avg_grg_pct: number | null;
  avg_cil_pct: number | null;
  avg_bwi_kwh_t: number | null;
  recovery_design: number | null;
  bwi_min: number | null;
  bwi_max: number | null;
  recovery_min: number | null;
  recovery_max: number | null;
  // Advanced fields
  sai_kwh_t: number | null;        // SAG Abrasion Index
  abi: number | null;               // Abrasion Bond Index
  rqi: number | null;               // Rock Quality Index
  clay_pct: number | null;          // Clay content
  sulphide_pct: number | null;      // Sulphide content
  carbonate_pct: number | null;     // Carbonate content
  grg_min: number | null;
  grg_max: number | null;
  cil_min: number | null;
  cil_max: number | null;
  flotation_pct: number | null;
  preg_robbing: boolean | null;     // Preg-robbing flag
  is_imported: boolean;
  notes: string | null;
  created_at?: string;
}

export interface LimsAggregate {
  domain: string;   // representative display name
  canon: string;    // normalized key used to match against Block Model / existing domains
  avg_leach_pct: number | null;
  leach_min: number | null;
  leach_max: number | null;
  avg_grg_pct: number | null;
  grg_min: number | null;
  grg_max: number | null;
  avg_bwi_kwh_t: number | null;
  bwi_min: number | null;
  bwi_max: number | null;
  avg_ai_index: number | null;      // Bond Abrasion Index (Ai) -> abi
  avg_scse_kwh_t: number | null;    // SAG circuit specific energy (kWh/t) -> sai_kwh_t
  avg_flotation_pct: number | null; // Flotation Au recovery -> flotation_pct
  // Ore-character parameters. These were previously never imported: the sync wrote
  // clay_pct/sulphide_pct/carbonate_pct as null and preg_robbing as false, so the
  // Mapping GID columns stayed empty even with the testwork present.
  avg_clay_pct: number | null;      // mineralogy argilite_pct -> clay_pct
  avg_sulphide_pct: number | null;  // chem s_sulfide_pct -> sulphide_pct (app-wide convention)
  avg_carbonate_pct: number | null; // mineralogy carbonates_pct -> carbonate_pct
  avg_preg_rob_pct: number | null;  // liberation au_preg_rob_pct (direct measurement)
  avg_c_organic_pct: number | null; // chem c_organic_pct (organic-carbon proxy)
  preg_robbing: boolean | null;     // derived; null when neither signal is available
  n_leach: number;
  n_grg: number;
  n_bwi: number;
  n_ai: number;
  n_flot: number;
  n_chem: number;
  n_min: number;
  n_lib: number;
}

// Mean / min / max over a list of numbers (nulls already filtered out by caller).
function stats(vals: number[]): { avg: number | null; min: number | null; max: number | null } {
  if (!vals.length) return { avg: null, min: null, max: null };
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return { avg, min: Math.min(...vals), max: Math.max(...vals) };
}

// The LIMS `domain` lives on the parent lims_samples row, not on the per-test tables.
// It is resolved here via an explicit sample_id → domain map (built once below), NOT
// via a PostgREST embed: since the composite project FK was added on the test tables
// (migration 20260727010000), lims_samples(domain) has two candidate relationships and
// the embed resolves to nothing — which silently dropped GRG/BWi/Ai/SAG/flotation into
// the "Non classifié" bucket and left those columns empty on every named domain.

// Single source of truth for LIMS→GéoMet aggregation. Pulls every geometallurgical
// parameter available per domain: recovery (leach/CIL, GRG), comminution work indices
// (Bond ball WI avg + range), Bond abrasion index, SAG specific energy and flotation.
export async function fetchLimsAggregates(projectId: string): Promise<LimsAggregate[]> {
  const [samplesRes, leachRes, grgRes, commRes, flotRes, chemRes, minRes, libRes] = await Promise.all([
    // lims_test_leaching has no FK to lims_samples (unlike knelson/comminution/flotation),
    // so its domain can't be embedded — we resolve it via this sample→domain map instead.
    // Paginé : un projet peut compter > 10 000 échantillons ; tronquer la carte
    // sample→domaine renverrait la plupart des mesures dans « Non classifié ».
    fetchAll(() => supabase.from('lims_samples').select('id, domain').eq('project_id', projectId)),
    // Real testwork tables (same as Analytics/Criteria): leach recovery lives on
    // lims_test_leaching, GRG on lims_test_knelson — not the lims_test_leach/gravity names.
    // On récupère les deux horizons de lixiviation : le 48 h est la base retenue,
    // le 24 h ne sert que de repli (convention app — ProjectContext/Analytics/routeEstimation).
    // Toutes les tables sont sélectionnées AVEC sample_id pour résoudre le domaine
    // via la carte sample→domaine (pas d'embed PostgREST, cf. note ci-dessus).
    fetchAll(() => supabase.from('lims_test_leaching').select('sample_id, leach_rec_24h_pct, leach_rec_48h_pct').eq('project_id', projectId)),
    fetchAll(() => supabase.from('lims_test_knelson').select('sample_id, grg_recovery_pct').eq('project_id', projectId).not('grg_recovery_pct', 'is', null)),
    fetchAll(() => supabase.from('lims_test_comminution').select('sample_id, bwi_kwh_t, ai_index, scse_kwh_t').eq('project_id', projectId)),
    fetchAll(() => supabase.from('lims_test_flotation').select('sample_id, au_recovery_pct').eq('project_id', projectId).not('au_recovery_pct', 'is', null)),
    // Ore character: sulphur-as-sulphide and organic carbon (chemistry), clay and
    // carbonate (quantitative mineralogy), preg-robbing (Au liberation).
    fetchAll(() => supabase.from('lims_test_chem').select('sample_id, s_sulfide_pct, c_organic_pct').eq('project_id', projectId)),
    fetchAll(() => supabase.from('lims_test_mineralogy').select('sample_id, argilite_pct, carbonates_pct').eq('project_id', projectId)),
    fetchAll(() => supabase.from('lims_test_liberation').select('sample_id, au_preg_rob_pct').eq('project_id', projectId)),
  ]);

  const samplesData = (samplesRes.error ? [] : samplesRes.data ?? []) as { id: string; domain: string | null }[];
  const domainBySample = new Map(samplesData.map(s => [s.id, s.domain]));
  const domOf = (sampleId: string | null | undefined): string | null => domainBySample.get(sampleId ?? '') ?? null;
  const leachData = (leachRes.error ? [] : leachRes.data ?? []) as { sample_id: string; leach_rec_24h_pct: number | null; leach_rec_48h_pct: number | null }[];
  const grgData   = (grgRes.error ? [] : grgRes.data ?? []) as { sample_id: string; grg_recovery_pct: number }[];
  const commData  = (commRes.error ? [] : commRes.data ?? []) as { sample_id: string; bwi_kwh_t: number | null; ai_index: number | null; scse_kwh_t: number | null }[];
  const flotData  = (flotRes.error ? [] : flotRes.data ?? []) as { sample_id: string; au_recovery_pct: number }[];
  const chemData  = (chemRes.error ? [] : chemRes.data ?? []) as { sample_id: string; s_sulfide_pct: number | null; c_organic_pct: number | null }[];
  const minData   = (minRes.error ? [] : minRes.data ?? []) as { sample_id: string; argilite_pct: number | null; carbonates_pct: number | null }[];
  const libData   = (libRes.error ? [] : libRes.data ?? []) as { sample_id: string; au_preg_rob_pct: number | null }[];

  // Bucket every measurement by canonical domain, remembering a display label.
  type Bucket = {
    label: string; leach: number[]; grg: number[]; bwi: number[]; ai: number[]; scse: number[]; flot: number[];
    clay: number[]; sulph: number[]; carb: number[]; pregRob: number[]; cOrg: number[];
  };
  const buckets = new Map<string, Bucket>();
  const bucketFor = (rawDomain: string | null): Bucket => {
    const canon = canonDomain(rawDomain);
    let b = buckets.get(canon);
    if (!b) {
      b = {
        label: rawDomain?.trim() || 'Non classifié',
        leach: [], grg: [], bwi: [], ai: [], scse: [], flot: [],
        clay: [], sulph: [], carb: [], pregRob: [], cOrg: [],
      };
      buckets.set(canon, b);
    }
    return b;
  };

  for (const r of leachData) {
    const v = r.leach_rec_48h_pct ?? r.leach_rec_24h_pct;   // 48 h préféré, 24 h en repli
    if (v != null) bucketFor(domOf(r.sample_id)).leach.push(v);
  }
  for (const r of grgData)   bucketFor(domOf(r.sample_id)).grg.push(r.grg_recovery_pct);
  for (const r of commData) {
    const b = bucketFor(domOf(r.sample_id));
    if (r.bwi_kwh_t   != null) b.bwi.push(r.bwi_kwh_t);
    if (r.ai_index    != null) b.ai.push(r.ai_index);
    if (r.scse_kwh_t  != null) b.scse.push(r.scse_kwh_t);
  }
  for (const r of flotData)  bucketFor(domOf(r.sample_id)).flot.push(r.au_recovery_pct);
  for (const r of chemData) {
    const b = bucketFor(domOf(r.sample_id));
    if (r.s_sulfide_pct != null) b.sulph.push(r.s_sulfide_pct);
    if (r.c_organic_pct != null) b.cOrg.push(r.c_organic_pct);
  }
  for (const r of minData) {
    const b = bucketFor(domOf(r.sample_id));
    if (r.argilite_pct   != null) b.clay.push(r.argilite_pct);
    if (r.carbonates_pct != null) b.carb.push(r.carbonates_pct);
  }
  for (const r of libData) {
    if (r.au_preg_rob_pct != null) bucketFor(domOf(r.sample_id)).pregRob.push(r.au_preg_rob_pct);
  }

  return [...buckets.entries()].map(([canon, b]) => {
    const leach = stats(b.leach), grg = stats(b.grg), bwi = stats(b.bwi);
    const avgPregRob = stats(b.pregRob).avg;
    const avgCOrg = stats(b.cOrg).avg;
    return {
      domain: b.label,
      canon,
      avg_leach_pct: leach.avg, leach_min: leach.min, leach_max: leach.max,
      avg_grg_pct: grg.avg, grg_min: grg.min, grg_max: grg.max,
      avg_bwi_kwh_t: bwi.avg, bwi_min: bwi.min, bwi_max: bwi.max,
      avg_ai_index: stats(b.ai).avg,
      avg_scse_kwh_t: stats(b.scse).avg,
      avg_flotation_pct: stats(b.flot).avg,
      avg_clay_pct: stats(b.clay).avg,
      avg_sulphide_pct: stats(b.sulph).avg,
      avg_carbonate_pct: stats(b.carb).avg,
      avg_preg_rob_pct: avgPregRob,
      avg_c_organic_pct: avgCOrg,
      preg_robbing: derivePregRobbing(avgPregRob, avgCOrg),
      n_leach: b.leach.length, n_grg: b.grg.length, n_bwi: b.bwi.length,
      n_ai: b.ai.length, n_flot: b.flot.length,
      n_chem: Math.max(b.sulph.length, b.cOrg.length),
      n_min: Math.max(b.clay.length, b.carb.length),
      n_lib: b.pregRob.length,
    };
  });
}

export interface BlockModelAggregate {
  domain: string;   // representative display name (rock type)
  canon: string;    // normalized key
  avg_grade_g_t: number | null;
  avg_density: number | null;
  n_blocks: number;
}

// Aggregate Block Model grade/density per rock type. Pages through ALL blocks — a single
// PostgREST response caps at ~1000 rows, so a large model (tens of thousands of blocks)
// would otherwise be silently truncated.
export async function fetchBlockAggregates(projectId: string): Promise<BlockModelAggregate[]> {
  type Bucket = { label: string; grade: number[]; dens: number[]; n: number };
  const buckets = new Map<string, Bucket>();
  const BATCH = 1000;
  let from = 0;
  let total = Infinity;
  let fetched = 0;
  while (fetched < total) {
    const { data, count, error } = await supabase
      .from('bm_blocks')
      .select('rock_type, au_g_t, density', from === 0 ? { count: 'exact' } : undefined)
      .eq('project_id', projectId)
      .not('au_g_t', 'is', null)
      .order('id')
      .range(from, from + BATCH - 1);
    if (error) break;
    if (from === 0 && count != null) total = count;
    const chunk = (data ?? []) as { rock_type: string | null; au_g_t: number; density: number | null }[];
    if (chunk.length === 0) break;
    for (const blk of chunk) {
      const canon = canonDomain(blk.rock_type);
      let b = buckets.get(canon);
      if (!b) { b = { label: blk.rock_type?.trim() || 'Non classifié', grade: [], dens: [], n: 0 }; buckets.set(canon, b); }
      b.n++;
      if (blk.au_g_t != null) b.grade.push(blk.au_g_t);
      if (blk.density != null) b.dens.push(blk.density);
    }
    fetched += chunk.length;
    from += chunk.length;
  }
  return [...buckets.entries()].map(([canon, b]) => ({
    domain: b.label,
    canon,
    avg_grade_g_t: b.grade.length ? b.grade.reduce((s, v) => s + v, 0) / b.grade.length : null,
    avg_density:   b.dens.length  ? b.dens.reduce((s, v) => s + v, 0) / b.dens.length  : null,
    n_blocks: b.n,
  }));
}

export interface LomSimRow {
  year: number;
  domain_mix: Record<string, number>;
  grade_g_t: number;
  tph: number;
  recovery_pct: number;
  bwi_kwh_t: number;
  energy_kwh_t: number;
  oz_year: number;
  notes: string;
}

// Ligne de réconciliation prédiction↔usine persistée (table geomet_reconciliation).
export interface ReconEntry {
  id: string;
  domain_id: string | null;
  domain_name: string | null;
  campaign_label: string;
  period_label: string | null;
  predicted_recovery_pct: number | null;
  observed_recovery_pct: number | null;
  observed_tonnage: number | null;
  observed_grade_gt: number | null;
  note: string | null;
  created_at: string;
}

// Instantané versionné du modèle de domaines (table geomet_model_version).
export interface ModelVersion {
  id: string;
  version_label: string;
  note: string | null;
  domain_count: number;
  weighted_recovery_pct: number | null;
  weighted_p80_um: number | null;
  status: 'draft' | 'published';
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export const BLANK_DOMAIN: Partial<GeometDomain> = {
  name: '', gid_code: '', lom_pct: undefined, avg_grg_pct: undefined,
  avg_cil_pct: undefined, avg_bwi_kwh_t: undefined, recovery_design: undefined,
  bwi_min: undefined, bwi_max: undefined, recovery_min: undefined, recovery_max: undefined,
  sai_kwh_t: undefined, abi: undefined, rqi: undefined, clay_pct: undefined,
  sulphide_pct: undefined, carbonate_pct: undefined, grg_min: undefined, grg_max: undefined,
  cil_min: undefined, cil_max: undefined, flotation_pct: undefined, preg_robbing: false,
  notes: '',
};
