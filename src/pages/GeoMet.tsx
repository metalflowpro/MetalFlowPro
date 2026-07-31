import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  BarChart3, Plus, RefreshCw, CheckCircle2, AlertCircle, Download,
  Database, Layers, TrendingUp, Zap, Target, Trash2, Edit2, Save, X,
  Activity, FlaskConical, Cpu, GitBranch,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ui/ConfirmDialog';
import type { Project } from '../types';
import { TROY_OZ_GRAMS } from '../lib/config/constants';
import { useProject } from '../lib/ProjectContext';
import { canonDomain, isCompositeDomain, derivePregRobbing } from '../lib/geomet/domains';
import { REFERENCE_P80_UM, domainRecoveryAtP80, plantGrindEnergy } from '../lib/geomet/p80';

type Tab = 'domains' | 'gid' | 'curves' | 'blend' | 'variability' | 'prediction' | 'lomsim' | 'graphs';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'domains',     label: 'Domaines GéoMet',      icon: <Layers size={11}/> },
  { id: 'gid',         label: 'Mapping GID',           icon: <Database size={11}/> },
  { id: 'curves',      label: 'Grade-Récup.',          icon: <TrendingUp size={11}/> },
  { id: 'variability', label: 'Variabilité',           icon: <Activity size={11}/> },
  { id: 'prediction',  label: 'Prédiction Métal.',     icon: <FlaskConical size={11}/> },
  { id: 'lomsim',      label: 'Simulation LOM',        icon: <Cpu size={11}/> },
  { id: 'blend',       label: 'Optimisation Blend',    icon: <GitBranch size={11}/> },
  { id: 'graphs',      label: 'Graphiques',            icon: <BarChart3 size={11}/> },
];

const DOMAIN_COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#F06B6B', '#8B5CF6', '#F88A44', '#06B6D4', '#84CC16'];

interface GeometDomain {
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

interface LimsAggregate {
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

// The LIMS `domain` lives on the parent lims_samples row, not on the per-test tables —
// PostgREST returns it via the embedded relationship (object, or array on some setups).
type SampleEmbed = { domain: string | null } | { domain: string | null }[] | null | undefined;
const embedDomain = (e: SampleEmbed): string | null =>
  Array.isArray(e) ? (e[0]?.domain ?? null) : (e?.domain ?? null);

// Single source of truth for LIMS→GéoMet aggregation. Pulls every geometallurgical
// parameter available per domain: recovery (leach/CIL, GRG), comminution work indices
// (Bond ball WI avg + range), Bond abrasion index, SAG specific energy and flotation.
async function fetchLimsAggregates(projectId: string): Promise<LimsAggregate[]> {
  const [samplesRes, leachRes, grgRes, commRes, flotRes, chemRes, minRes, libRes] = await Promise.all([
    // lims_test_leaching has no FK to lims_samples (unlike knelson/comminution/flotation),
    // so its domain can't be embedded — we resolve it via this sample→domain map instead.
    supabase.from('lims_samples').select('id, domain').eq('project_id', projectId),
    // Real testwork tables (same as Analytics/Criteria): leach recovery lives on
    // lims_test_leaching, GRG on lims_test_knelson — not the lims_test_leach/gravity names.
    supabase.from('lims_test_leaching').select('sample_id, leach_rec_24h_pct').eq('project_id', projectId).not('leach_rec_24h_pct', 'is', null),
    supabase.from('lims_test_knelson').select('grg_recovery_pct, lims_samples(domain)').eq('project_id', projectId).not('grg_recovery_pct', 'is', null),
    supabase.from('lims_test_comminution').select('bwi_kwh_t, ai_index, scse_kwh_t, lims_samples(domain)').eq('project_id', projectId),
    supabase.from('lims_test_flotation').select('au_recovery_pct, lims_samples(domain)').eq('project_id', projectId).not('au_recovery_pct', 'is', null),
    // Ore character: sulphur-as-sulphide and organic carbon (chemistry), clay and
    // carbonate (quantitative mineralogy), preg-robbing (Au liberation).
    supabase.from('lims_test_chem').select('s_sulfide_pct, c_organic_pct, lims_samples(domain)').eq('project_id', projectId),
    supabase.from('lims_test_mineralogy').select('argilite_pct, carbonates_pct, lims_samples(domain)').eq('project_id', projectId),
    supabase.from('lims_test_liberation').select('au_preg_rob_pct, lims_samples(domain)').eq('project_id', projectId),
  ]);

  const samplesData = (samplesRes.error ? [] : samplesRes.data ?? []) as { id: string; domain: string | null }[];
  const domainBySample = new Map(samplesData.map(s => [s.id, s.domain]));
  const leachData = (leachRes.error ? [] : leachRes.data ?? []) as { leach_rec_24h_pct: number; sample_id: string }[];
  const grgData   = (grgRes.error ? [] : grgRes.data ?? []) as { grg_recovery_pct: number; lims_samples: SampleEmbed }[];
  const commData  = (commRes.error ? [] : commRes.data ?? []) as { bwi_kwh_t: number | null; ai_index: number | null; scse_kwh_t: number | null; lims_samples: SampleEmbed }[];
  const flotData  = (flotRes.error ? [] : flotRes.data ?? []) as { au_recovery_pct: number; lims_samples: SampleEmbed }[];
  const chemData  = (chemRes.error ? [] : chemRes.data ?? []) as { s_sulfide_pct: number | null; c_organic_pct: number | null; lims_samples: SampleEmbed }[];
  const minData   = (minRes.error ? [] : minRes.data ?? []) as { argilite_pct: number | null; carbonates_pct: number | null; lims_samples: SampleEmbed }[];
  const libData   = (libRes.error ? [] : libRes.data ?? []) as { au_preg_rob_pct: number | null; lims_samples: SampleEmbed }[];

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

  for (const r of leachData) bucketFor(domainBySample.get(r.sample_id) ?? null).leach.push(r.leach_rec_24h_pct);
  for (const r of grgData)   bucketFor(embedDomain(r.lims_samples)).grg.push(r.grg_recovery_pct);
  for (const r of commData) {
    const b = bucketFor(embedDomain(r.lims_samples));
    if (r.bwi_kwh_t   != null) b.bwi.push(r.bwi_kwh_t);
    if (r.ai_index    != null) b.ai.push(r.ai_index);
    if (r.scse_kwh_t  != null) b.scse.push(r.scse_kwh_t);
  }
  for (const r of flotData)  bucketFor(embedDomain(r.lims_samples)).flot.push(r.au_recovery_pct);
  for (const r of chemData) {
    const b = bucketFor(embedDomain(r.lims_samples));
    if (r.s_sulfide_pct != null) b.sulph.push(r.s_sulfide_pct);
    if (r.c_organic_pct != null) b.cOrg.push(r.c_organic_pct);
  }
  for (const r of minData) {
    const b = bucketFor(embedDomain(r.lims_samples));
    if (r.argilite_pct   != null) b.clay.push(r.argilite_pct);
    if (r.carbonates_pct != null) b.carb.push(r.carbonates_pct);
  }
  for (const r of libData) {
    if (r.au_preg_rob_pct != null) bucketFor(embedDomain(r.lims_samples)).pregRob.push(r.au_preg_rob_pct);
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

interface BlockModelAggregate {
  domain: string;   // representative display name (rock type)
  canon: string;    // normalized key
  avg_grade_g_t: number | null;
  avg_density: number | null;
  n_blocks: number;
}

// Aggregate Block Model grade/density per rock type. Pages through ALL blocks — a single
// PostgREST response caps at ~1000 rows, so a large model (tens of thousands of blocks)
// would otherwise be silently truncated.
async function fetchBlockAggregates(projectId: string): Promise<BlockModelAggregate[]> {
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

interface LomSimRow {
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

const BLANK_DOMAIN: Partial<GeometDomain> = {
  name: '', gid_code: '', lom_pct: undefined, avg_grg_pct: undefined,
  avg_cil_pct: undefined, avg_bwi_kwh_t: undefined, recovery_design: undefined,
  bwi_min: undefined, bwi_max: undefined, recovery_min: undefined, recovery_max: undefined,
  sai_kwh_t: undefined, abi: undefined, rqi: undefined, clay_pct: undefined,
  sulphide_pct: undefined, carbonate_pct: undefined, grg_min: undefined, grg_max: undefined,
  cil_min: undefined, cil_max: undefined, flotation_pct: undefined, preg_robbing: false,
  notes: '',
};

interface GeoMetProps { project: Project }

export function GeoMet({ project }: GeoMetProps) {
  const confirm = useConfirm();
  // Calendar hours/yr from the project's resolved assumptions (project_settings
  // override applied), so GeoMet throughput matches the other modules.
  const { assumptions } = useProject();
  const hoursPerYear = assumptions.hoursPerYear;

  const [tab, setTab] = useState<Tab>('domains');
  const [domains, setDomains] = useState<GeometDomain[]>([]);
  const [loading, setLoading] = useState(false);
  const [limsAggs, setLimsAggs] = useState<LimsAggregate[]>([]);
  const [bmAggs, setBmAggs] = useState<BlockModelAggregate[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [syncError, setSyncError] = useState('');

  // Modal states
  const [showNew, setShowNew] = useState(false);
  const [editDomain, setEditDomain] = useState<GeometDomain | null>(null);
  const [formData, setFormData] = useState<Partial<GeometDomain>>(BLANK_DOMAIN);
  const [formTab, setFormTab] = useState<'basic' | 'advanced' | 'metallurgy'>('basic');
  const [saving, setSaving] = useState(false);
  const [blendSaving, setBlendSaving] = useState(false);
  const [blendSaved, setBlendSaved] = useState(false);
  const [saved, setSaved] = useState(false);

  // Blend
  const [blendSplit, setBlendSplit] = useState<Record<string, number>>({});

  // Grade-recovery curve state
  const [curveP80, setCurveP80] = useState(75);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  // LOM Simulation
  const [lomYears, setLomYears] = useState(10);
  const [lomSimRows, setLomSimRows] = useState<LomSimRow[]>([]);
  const [lomCollapsed, setLomCollapsed] = useState<Record<number, boolean>>({});

  // Variability
  const [varP80, setVarP80] = useState(75);
  const [monteCarlo, setMonteCarlo] = useState<{ oz: number; rec: number }[]>([]);
  const [mcRunning, setMcRunning] = useState(false);

  // Grinding-circuit feed size from the design criteria (crusher product). The
  // energy figures previously hardcoded F80 = 300 µm — a regrind feed, not a
  // crushing product — which halved every kWh/t this module reported.
  const [dcF80, setDcF80] = useState(12000);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle();
      const f80 = (data?.content as { inputs?: { f80_crush?: number } } | undefined)?.inputs?.f80_crush;
      if (typeof f80 === 'number' && f80 > 0) setDcF80(f80);
    })();
  }, [project.id]);

  // Prediction inputs
  const [predP80, setPredP80] = useState(75);
  const [predGrade, setPredGrade] = useState(project.gold_grade_g_t);
  const [predTph, setPredTph] = useState(project.target_tph);

  const TROY = TROY_OZ_GRAMS;

  const loadDomains = useCallback(async () => {
    setLoading(true);
    setDomains([]);
    const { data } = await supabase
      .from('geomet_domains')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true });
    setDomains(data ?? []);
    setLoading(false);
  }, [project.id]);

  const loadLimsAggregates = useCallback(async () => {
    setLimsAggs(await fetchLimsAggregates(project.id));
  }, [project.id]);

  const loadBlockModelAggregates = useCallback(async () => {
    setBmAggs(await fetchBlockAggregates(project.id));
  }, [project.id]);

  async function syncAllData() {
    setImportLoading(true);
    setSyncDone(false);
    setSyncError('');

    try {
      // Fetch raw data — do NOT read limsAggs/bmAggs state (stale closure). LIMS and Block
      // Model aggregation are delegated to the shared helpers so the preview table and the
      // actual import always compute identical parameters, over ALL rows (both paginate).
      const [freshLimsAggs, freshBmAggs, domsRes] = await Promise.all([
        fetchLimsAggregates(project.id),
        fetchBlockAggregates(project.id),
        supabase.from('geomet_domains').select('*').eq('project_id', project.id).order('created_at', { ascending: true }),
      ]);

      const currentDomains = (domsRes.data ?? []) as GeometDomain[];

      // Update state for display
      setLimsAggs(freshLimsAggs);
      setBmAggs(freshBmAggs);

      if (freshLimsAggs.length === 0 && freshBmAggs.length === 0) {
        setSyncError('Aucune donnée LIMS ni Block Model trouvée pour ce projet. Importez d\'abord des données dans ces modules.');
        setImportLoading(false);
        return;
      }

      // Helper: generate unique GID code for a domain name
      const usedGids = new Set(currentDomains.map(d => d.gid_code?.toUpperCase()).filter(Boolean));
      function makeGid(name: string): string {
        const base = name.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().substring(0, 3).padEnd(3, 'X');
        if (!usedGids.has(base)) { usedGids.add(base); return base; }
        for (let i = 1; i <= 99; i++) {
          const candidate = base.substring(0, 2) + i;
          if (!usedGids.has(candidate)) { usedGids.add(candidate); return candidate; }
        }
        return base;
      }

      // Merge both sources into geomet_domains, keyed by canonical domain so that LIMS
      // ("oxide"/"transition"/"sulphide") and Block Model ("Oxide"/"Transitionnel"/"Sulfure")
      // land on the SAME domain instead of creating duplicates.
      const limsByCanon = new Map(freshLimsAggs.map(a => [a.canon, a]));
      const bmByCanon   = new Map(freshBmAggs.map(a => [a.canon, a]));
      const allCanons   = new Set<string>([...limsByCanon.keys(), ...bmByCanon.keys()]);
      let insertedCount = 0;
      for (const canon of allCanons) {
        const lims = limsByCanon.get(canon);
        const bm   = bmByCanon.get(canon);
        const existing = currentDomains.find(d => canonDomain(d.name) === canon);
        // Prefer an existing domain's name, else the Block Model rock type, else the LIMS label.
        const domName = existing?.name ?? bm?.domain ?? lims?.domain ?? canon;
        const sampleCount = lims ? lims.n_leach + lims.n_grg + lims.n_bwi + lims.n_ai + lims.n_flot : 0;
        if (existing) {
          // Only overwrite a field when LIMS actually has a value for it, so manual
          // edits on parameters absent from LIMS are preserved.
          const updates: Partial<GeometDomain> & { updated_at: string } = {
            ...(lims?.avg_leach_pct   != null ? { avg_cil_pct: lims.avg_leach_pct, recovery_design: lims.avg_leach_pct } : {}),
            ...(lims?.leach_min       != null ? { cil_min: lims.leach_min, recovery_min: lims.leach_min } : {}),
            ...(lims?.leach_max       != null ? { cil_max: lims.leach_max, recovery_max: lims.leach_max } : {}),
            ...(lims?.avg_grg_pct     != null ? { avg_grg_pct: lims.avg_grg_pct } : {}),
            ...(lims?.grg_min         != null ? { grg_min: lims.grg_min } : {}),
            ...(lims?.grg_max         != null ? { grg_max: lims.grg_max } : {}),
            ...(lims?.avg_bwi_kwh_t   != null ? { avg_bwi_kwh_t: lims.avg_bwi_kwh_t } : {}),
            ...(lims?.bwi_min         != null ? { bwi_min: lims.bwi_min } : {}),
            ...(lims?.bwi_max         != null ? { bwi_max: lims.bwi_max } : {}),
            ...(lims?.avg_ai_index    != null ? { abi: lims.avg_ai_index } : {}),
            ...(lims?.avg_scse_kwh_t  != null ? { sai_kwh_t: lims.avg_scse_kwh_t } : {}),
            ...(lims?.avg_flotation_pct != null ? { flotation_pct: lims.avg_flotation_pct } : {}),
            ...(lims?.avg_clay_pct      != null ? { clay_pct: lims.avg_clay_pct } : {}),
            ...(lims?.avg_sulphide_pct  != null ? { sulphide_pct: lims.avg_sulphide_pct } : {}),
            ...(lims?.avg_carbonate_pct != null ? { carbonate_pct: lims.avg_carbonate_pct } : {}),
            ...(lims?.preg_robbing      != null ? { preg_robbing: lims.preg_robbing } : {}),
            ...(lims ? { sample_count: sampleCount || (existing.sample_count ?? 0) } : {}),
            is_imported: true,
            updated_at: new Date().toISOString(),
          };
          const { error } = await supabase.from('geomet_domains').update(updates).eq('id', existing.id).eq('project_id', project.id);
          if (error) throw new Error(`Mise à jour du domaine "${domName}" échouée: ${error.message}`);
        } else if (lims || bm) {
          const { error } = await supabase.from('geomet_domains').insert({
            project_id: project.id,
            name: domName,
            gid_code: makeGid(domName),
            color: DOMAIN_COLORS[(currentDomains.length + insertedCount) % DOMAIN_COLORS.length],
            avg_cil_pct:    lims?.avg_leach_pct ?? null,
            avg_grg_pct:    lims?.avg_grg_pct ?? null,
            avg_bwi_kwh_t:  lims?.avg_bwi_kwh_t ?? null,
            sample_count:   lims ? sampleCount : bm?.n_blocks ?? 0,
            recovery_design: lims?.avg_leach_pct ?? null,
            recovery_min:   lims?.leach_min ?? null,
            recovery_max:   lims?.leach_max ?? null,
            cil_min:        lims?.leach_min ?? null,
            cil_max:        lims?.leach_max ?? null,
            grg_min:        lims?.grg_min ?? null,
            grg_max:        lims?.grg_max ?? null,
            bwi_min:        lims?.bwi_min ?? null,
            bwi_max:        lims?.bwi_max ?? null,
            abi:            lims?.avg_ai_index ?? null,
            sai_kwh_t:      lims?.avg_scse_kwh_t ?? null,
            flotation_pct:  lims?.avg_flotation_pct ?? null,
            is_imported: true,
            // Ore character now comes from the testwork instead of being hardcoded
            // null/false, which left the Mapping GID columns permanently empty.
            //
            // preg_robbing is `NOT NULL DEFAULT false` in the schema, so an unknown
            // verdict must be OMITTED (letting the default apply) rather than sent as
            // null — an explicit null violates the constraint and fails the whole sync.
            ...(lims?.preg_robbing != null ? { preg_robbing: lims.preg_robbing } : {}),
            clay_pct:       lims?.avg_clay_pct ?? null,
            sulphide_pct:   lims?.avg_sulphide_pct ?? null,
            carbonate_pct:  lims?.avg_carbonate_pct ?? null,
            rqi: null,
          });
          if (error) throw new Error(`Création du domaine "${domName}" échouée: ${error.message}`);
          insertedCount++;
        }
      }

      await loadDomains();
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 4000);
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : 'Erreur inconnue lors de la synchronisation.');
    }
    setImportLoading(false);
  }

  useEffect(() => {
    setLimsAggs([]);
    setBmAggs([]);
    setSyncError('');
    setSyncDone(false);
    loadDomains();
    loadLimsAggregates();
    loadBlockModelAggregates();
  }, [loadDomains, loadLimsAggregates, loadBlockModelAggregates]);

  // Primary domains are the only ones that can receive mill feed. Composites
  // ("mixte") are the *result* of blending them, so giving a composite its own
  // share would count the same ore twice. Declared here — above the effects that
  // depend on it — because a dependency array is evaluated during render.
  const primaryDomains = useMemo(() => domains.filter(d => !isCompositeDomain(d.name)), [domains]);
  const compositeDomains = useMemo(() => domains.filter(d => isCompositeDomain(d.name)), [domains]);

  /**
   * Feed share per primary domain, as a fraction summing to 1.
   *
   * Sourced from `lom_pct` — the persisted life-of-mine share of each domain —
   * falling back to an equal split when no domain carries one. This is the single
   * definition of "what the mill is fed", consumed by the blend, the LOM schedule
   * and (via Granulométrie) the BWi that drives the optimal P80.
   */
  const feedShare = useMemo(() => {
    const withLom = primaryDomains.filter(d => (d.lom_pct ?? 0) > 0);
    const total = withLom.reduce((s, d) => s + (d.lom_pct ?? 0), 0);
    if (total > 0) {
      return {
        fromLom: true,
        byId: Object.fromEntries(primaryDomains.map(d => [d.id, (d.lom_pct ?? 0) / total])) as Record<string, number>,
      };
    }
    const equal = primaryDomains.length ? 1 / primaryDomains.length : 0;
    return { fromLom: false, byId: Object.fromEntries(primaryDomains.map(d => [d.id, equal])) as Record<string, number> };
  }, [primaryDomains]);

  useEffect(() => {
    if (domains.length > 0) {
      setBlendSplit(Object.fromEntries(
        primaryDomains.map(d => [d.id, +((feedShare.byId[d.id] ?? 0) * 100).toFixed(1)]),
      ));
      if (!selectedDomainId) setSelectedDomainId(domains[0].id);
    }
  }, [domains.length, primaryDomains.length, feedShare]);

  // Auto-generate LOM schedule when domain data changes
  useEffect(() => {
    // The schedule feeds the mill from primary domains only — a composite ("mixte")
    // is their blend, so averaging it in alongside them would weight the same ore twice.
    if (primaryDomains.length === 0) return;
    const nPrimary = primaryDomains.length;
    const rows: LomSimRow[] = Array.from({ length: lomYears }, (_, i) => {
      const yr = i + 1;
      const phasePct = yr <= 3 ? 0.85 : yr <= 7 ? 1.0 : 0.92;
      const gradeFactor = yr <= 2 ? 1.15 : yr >= lomYears - 1 ? 0.80 : 1.0;
      const tph = project.target_tph * phasePct;
      const grade = project.gold_grade_g_t * gradeFactor;
      // Weighted by the persisted feed share (lom_pct), not by an assumed equal split.
      const blendedRec = primaryDomains.reduce((s, d) => {
        const pct = feedShare.byId[d.id] ?? 1 / nPrimary;
        return s + pct * domainRecoveryAtP80(d.recovery_design ?? project.recovery_pct, varP80);
      }, 0);
      const rec = Math.max(50, Math.min(99, blendedRec));
      const bwi = primaryDomains.reduce((s, d) => s + (d.avg_bwi_kwh_t ?? 16.8) * (feedShare.byId[d.id] ?? 1 / nPrimary), 0);
      const wi = bwi;
      // Plant energy at the scenario grind (varP80) — the recovery on this same
      // row already varies with it; the energy was frozen at P80 = 80 µm.
      const energy = plantGrindEnergy(wi, dcF80, varP80);
      const h = (project.availability_pct / 100) * hoursPerYear;
      const oz = tph * h * grade * (rec / 100) / TROY;
      const mix: Record<string, number> = Object.fromEntries(
        primaryDomains.map(d => [d.id, +((feedShare.byId[d.id] ?? 1 / nPrimary) * 100).toFixed(1)]),
      );
      return { year: yr, domain_mix: mix, grade_g_t: grade, tph, recovery_pct: rec, bwi_kwh_t: bwi, energy_kwh_t: energy, oz_year: oz, notes: '' };
    });
    setLomSimRows(rows);
  }, [primaryDomains, lomYears, project, varP80, hoursPerYear, feedShare, dcF80]);

  /**
   * Persist the blend split to `lom_pct` — the life-of-mine share of each domain.
   *
   * Until now the split lived only in screen state, so the BWi and recovery that
   * drive the optimal P80 had to assume an equal split. Writing it here makes the
   * feed blend a project fact that Granulométrie can weight on.
   */
  async function saveBlendToLom() {
    if (Math.abs(blendTotal - 100) > 1) return;
    setBlendSaving(true);
    setBlendSaved(false);
    setSyncError('');
    try {
      for (const d of primaryDomains) {
        const pct = +(blendSplit[d.id] ?? 0).toFixed(1);
        const { error } = await supabase.from('geomet_domains')
          .update({ lom_pct: pct, updated_at: new Date().toISOString() })
          .eq('id', d.id).eq('project_id', project.id);
        if (error) throw new Error(`Enregistrement de « ${d.name} » échoué: ${error.message}`);
      }
      // A composite is not fed to the mill: its LOM share must be cleared, not left
      // holding a stale value that would re-enter the weighting later.
      for (const d of compositeDomains) {
        await supabase.from('geomet_domains')
          .update({ lom_pct: null, updated_at: new Date().toISOString() })
          .eq('id', d.id).eq('project_id', project.id);
      }
      await loadDomains();
      setBlendSaved(true);
      setTimeout(() => setBlendSaved(false), 3000);
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : 'Erreur lors de l\'enregistrement du blend.');
    }
    setBlendSaving(false);
  }

  function openCreate() {
    setFormData(BLANK_DOMAIN);
    setEditDomain(null);
    setFormTab('basic');
    setShowNew(true);
  }

  function openEdit(d: GeometDomain) {
    setFormData({ ...d });
    setEditDomain(d);
    setFormTab('basic');
    setShowNew(true);
  }

  async function submitForm() {
    if (!formData.name?.trim()) return;
    setSaving(true);
    if (editDomain) {
      const { data } = await supabase.from('geomet_domains')
        .update({ ...formData, name: formData.name.trim() })
        .eq('id', editDomain.id).eq('project_id', project.id).select('*').maybeSingle();
      if (data) setDomains(prev => prev.map(d => d.id === editDomain.id ? data as GeometDomain : d));
    } else {
      const { data } = await supabase.from('geomet_domains').insert({
        project_id: project.id,
        color: DOMAIN_COLORS[domains.length % DOMAIN_COLORS.length],
        is_imported: false,
        sai_kwh_t: null, abi: null, rqi: null, clay_pct: null,
        sulphide_pct: null, carbonate_pct: null, grg_min: null, grg_max: null,
        cil_min: null, cil_max: null, flotation_pct: null, preg_robbing: false,
        ...formData,
        name: formData.name.trim(),
      }).select('*').maybeSingle();
      if (data) setDomains(prev => [...prev, data as GeometDomain]);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setShowNew(false);
  }

  async function deleteDomain(id: string) {
    const dom = domains.find(d => d.id === id);
    const ok = await confirm({
      title: 'Supprimer ce domaine géométallurgique ?',
      message: dom ? `Le domaine « ${dom.name} » et ses paramètres seront supprimés.` : 'Ce domaine sera supprimé.',
    });
    if (!ok) return;
    await supabase.from('geomet_domains').delete().eq('id', id).eq('project_id', project.id);
    setDomains(prev => prev.filter(d => d.id !== id));
  }

  function runMonteCarlo() {
    if (domains.length === 0) return;
    setMcRunning(true);
    const results: { oz: number; rec: number }[] = [];
    for (let i = 0; i < 500; i++) {
      const h = (project.availability_pct / 100) * hoursPerYear;
      let totalOz = 0;
      let totalRec = 0;
      domains.forEach(d => {
        const recBase = d.recovery_design ?? project.recovery_pct;
        const recRange = ((d.recovery_max ?? recBase + 3) - (d.recovery_min ?? recBase - 3)) / 2;
        const rec = recBase + recRange * (2 * Math.random() - 1);
        const bwiBase = d.avg_bwi_kwh_t ?? 16.8;
        const bwiRng = ((d.bwi_max ?? bwiBase + 2) - (d.bwi_min ?? bwiBase - 2)) / 2;
        const bwi = bwiBase + bwiRng * (2 * Math.random() - 1);
        const p80Noise = varP80 + 8 * (2 * Math.random() - 1);
        const recP80 = Math.max(50, Math.min(99, rec + (75 - p80Noise) * 0.07));
        const tph = project.target_tph * (0.92 + 0.16 * Math.random());
        const oz = tph * h * project.gold_grade_g_t * (recP80 / 100) / TROY;
        totalOz += oz / domains.length;
        totalRec += recP80 / domains.length;
      });
      results.push({ oz: totalOz, rec: totalRec });
    }
    results.sort((a, b) => a.oz - b.oz);
    setMonteCarlo(results);
    setMcRunning(false);
  }

  const blendTotal = primaryDomains.reduce((s, d) => s + (blendSplit[d.id] ?? 0), 0);

  const blendedRecovery = useMemo(() => {
    if (!primaryDomains.length) return 0;
    return primaryDomains.reduce((s, d) => {
      const pct = (blendSplit[d.id] ?? 0) / Math.max(blendTotal, 1);
      return s + pct * (d.recovery_design ?? project.recovery_pct);
    }, 0);
  }, [primaryDomains, blendSplit, blendTotal, project.recovery_pct]);

  const blendedBwi = useMemo(() => {
    if (!primaryDomains.length) return 0;
    return primaryDomains.reduce((s, d) => {
      const pct = (blendSplit[d.id] ?? 0) / Math.max(blendTotal, 1);
      return s + pct * (d.avg_bwi_kwh_t ?? 16.8);
    }, 0);
  }, [primaryDomains, blendSplit, blendTotal]);

  const blendedGrg = useMemo(() => {
    if (!primaryDomains.length) return 0;
    return primaryDomains.reduce((s, d) => {
      const pct = (blendSplit[d.id] ?? 0) / Math.max(blendTotal, 1);
      return s + pct * (d.avg_grg_pct ?? 0);
    }, 0);
  }, [primaryDomains, blendSplit, blendTotal]);

  /**
   * The measured composite ("mixte") to compare the computed blend against.
   * When the lab has run a mixte composite, the computed blend of the primary
   * domains should land close to it — a large gap means the blend model (or the
   * domain split) does not reflect what was actually tested.
   */
  const compositeReference = compositeDomains[0] ?? null;

  const annualOzBlended = useMemo(() => {
    const operatingHours = (project.availability_pct / 100) * hoursPerYear;
    return project.target_tph * operatingHours * project.gold_grade_g_t * (blendedRecovery / 100) / TROY;
  }, [blendedRecovery, project]);

  // Sensitivity ladder for the per-domain table. Includes REFERENCE_P80_UM so the
  // pivot row is always present.
  const P80_RANGE = [150, 125, 106, 90, REFERENCE_P80_UM, 63, 53, 45, 38];

  const importedCount = limsAggs.filter(a => domains.some(d => d.name.toLowerCase() === a.domain.toLowerCase() && d.is_imported)).length;

  // Prediction computed values
  const predRec = useMemo(() => {
    if (!domains.length) return project.recovery_pct;
    const dom = domains.find(d => d.id === selectedDomainId) ?? domains[0];
    return domainRecoveryAtP80(dom.recovery_design ?? project.recovery_pct, predP80);
  }, [domains, selectedDomainId, predP80, project]);

  const predAnnualOz = useMemo(() => {
    const h = (project.availability_pct / 100) * hoursPerYear;
    return predTph * h * predGrade * (predRec / 100) / TROY;
  }, [predTph, predGrade, predRec, project]);

  const predBwi = useMemo(() => {
    const dom = domains.find(d => d.id === selectedDomainId);
    return dom?.avg_bwi_kwh_t ?? 16.8;
  }, [domains, selectedDomainId]);

  const predEnergy = useMemo(() => {
    return plantGrindEnergy(predBwi, dcF80, predP80);
  }, [predBwi, predP80, dcF80]);

  // Monte Carlo stats
  const mcP10 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.1 * monteCarlo.length)].oz : null;
  const mcP50 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.5 * monteCarlo.length)].oz : null;
  const mcP90 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.9 * monteCarlo.length)].oz : null;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<BarChart3 size={20} />}
        title="Intelligence Géométallurgique"
        breadcrumb={['Projet', 'Géologie & Caractérisation', 'GéoMet']}
        actions={
          <div className="flex gap-2 items-center">
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={13} /> Sauvegardé</span>}
            {syncDone && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={13} /> Sync complète</span>}
            {syncError && (
              <span className="flex items-center gap-1 text-xs text-red-400 max-w-xs truncate" title={syncError}>
                <AlertCircle size={13} /> {syncError}
              </span>
            )}
            <button onClick={syncAllData} disabled={importLoading} className="btn btn-teal flex items-center gap-1.5 text-xs">
              <Database size={13} />
              {importLoading ? 'Sync…' : `Sync LIMS + Block Model`}
            </button>
            <button onClick={openCreate} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Plus size={13} /> Nouveau Domaine
            </button>
            <button onClick={() => { loadDomains(); loadLimsAggregates(); loadBlockModelAggregates(); }} className="btn btn-secondary p-1.5">
              <RefreshCw size={13} />
            </button>
          </div>
        }
      />

      <div className="flex gap-0 border-b mf-border px-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
              tab === t.id ? 'border-emerald-400 text-emerald-300' : 'border-transparent mf-txt3 hover:mf-txt'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* ── Domaines ─────────────────────────────────────────────────────── */}
        {tab === 'domains' && (
          <>
            {syncError && (
              <div className="mb-4 p-3 rounded-lg bg-red-400/8 border border-red-400/20 flex items-start gap-3">
                <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs text-red-300">{syncError}</div>
                <button onClick={() => setSyncError('')} className="text-red-400/50 hover:text-red-400"><X size={13} /></button>
              </div>
            )}
            {(limsAggs.length > 0 || bmAggs.length > 0) && importedCount < Math.max(limsAggs.length, bmAggs.length) && (
              <div className="mb-4 p-3 rounded-lg bg-emerald-400/8 border border-emerald-400/20 flex items-start gap-3">
                <Database size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 text-xs">
                  <div className="text-emerald-300 font-semibold mb-0.5">
                    {limsAggs.length > 0 && `${limsAggs.length} domaine(s) LIMS`}
                    {limsAggs.length > 0 && bmAggs.length > 0 && ' · '}
                    {bmAggs.length > 0 && `${bmAggs.length} domaine(s) Block Model`}
                    {' '}détectés
                  </div>
                  <div className="mf-txt3">
                    {limsAggs.length > 0 && `${limsAggs.reduce((s, a) => s + a.n_leach + a.n_grg + a.n_bwi + a.n_ai + a.n_flot, 0)} tests LIMS`}
                    {limsAggs.length > 0 && bmAggs.length > 0 && ' · '}
                    {bmAggs.length > 0 && `${bmAggs.reduce((s, a) => s + a.n_blocks, 0)} blocs BM`}
                    {' '}disponibles
                  </div>
                </div>
                <button onClick={syncAllData} disabled={importLoading} className="btn btn-teal text-xs flex items-center gap-1.5 shrink-0">
                  <Download size={11} /> Sync LIMS + Block Model
                </button>
              </div>
            )}

            {loading ? (
              <div className="text-center mf-txt3 py-16 text-sm">Chargement…</div>
            ) : domains.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 space-y-4">
                <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
                  <Layers size={36} className="mf-txt4" />
                </div>
                <div className="text-center">
                  <div className="text-sm font-semibold mf-txt2 mb-1">Aucun domaine géométallurgique</div>
                  <div className="text-xs mf-txt4 max-w-xs">Importez depuis le LIMS pour créer automatiquement les domaines, ou créez-en manuellement.</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={syncAllData} className="btn btn-teal flex items-center gap-1.5 text-xs">
                    <Database size={12} /> Sync LIMS + Block Model
                  </button>
                  <button onClick={openCreate} className="btn btn-secondary flex items-center gap-1.5 text-xs">
                    <Plus size={12} /> Créer manuellement
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Domaines', val: domains.length, color: 'text-sky-400' },
                    { label: 'Échantillons LIMS', val: domains.reduce((s, d) => s + (d.sample_count ?? 0), 0), color: 'text-emerald-400' },
                    { label: 'Récup. moy.', val: domains.filter(d => d.recovery_design != null).length ? `${formatDecimalGrouped((domains.reduce((s, d) => s + (d.recovery_design ?? 0), 0) / domains.filter(d => d.recovery_design != null).length), 1)}%` : '—', color: 'text-amber-400' },
                    { label: 'BWi moy.', val: domains.filter(d => d.avg_bwi_kwh_t != null).length ? `${formatDecimalGrouped((domains.reduce((s, d) => s + (d.avg_bwi_kwh_t ?? 0), 0) / domains.filter(d => d.avg_bwi_kwh_t != null).length), 1)} kWh/t` : '—', color: 'text-purple-400' },
                  ].map(k => (
                    <div key={k.label} className="card-sm py-2">
                      <div className="text-[10px] mf-txt4 mb-0.5">{k.label}</div>
                      <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {domains.map(d => {
                    const lims = limsAggs.find(a => a.domain.toLowerCase() === d.name.toLowerCase());
                    return (
                      <div key={d.id} className="card-sm space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                          <span className="font-semibold text-sm mf-txt">{d.name}</span>
                          {d.gid_code && <span className="text-[10px] mf-txt3 border border-white/15 rounded px-1.5 py-0.5 font-mono">{d.gid_code}</span>}
                          {d.is_imported && <span className="text-[10px] text-emerald-400 bg-emerald-400/10 rounded px-1.5 py-0.5 flex items-center gap-1"><Database size={9} /> LIMS</span>}
                          {d.preg_robbing && <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5 py-0.5">PR</span>}
                          <div className="ml-auto flex gap-1.5">
                            <button onClick={() => openEdit(d)} className="text-white/30 hover:text-white/70 transition-colors"><Edit2 size={11} /></button>
                            <button onClick={() => deleteDomain(d.id)} className="text-red-400/30 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-xs">
                          {[
                            { label: 'Échantillons', val: d.sample_count ?? '—', color: 'mf-txt' },
                            { label: 'LOM (%)', val: d.lom_pct != null ? `${formatDecimalGrouped(d.lom_pct, 0)}%` : '—', color: 'mf-txt' },
                            { label: 'GRG (%)', val: d.avg_grg_pct != null ? `${formatDecimalGrouped(d.avg_grg_pct, 1)}%` : '—', color: 'text-amber-300' },
                            { label: 'Leach (%)', val: d.avg_cil_pct != null ? `${formatDecimalGrouped(d.avg_cil_pct, 1)}%` : '—', color: 'text-emerald-300' },
                            { label: 'BWi (kWh/t)', val: d.avg_bwi_kwh_t != null ? formatDecimalGrouped(d.avg_bwi_kwh_t, 1) : '—', color: 'text-sky-300' },
                            { label: 'SAI (kWh/t)', val: d.sai_kwh_t != null ? formatDecimalGrouped(d.sai_kwh_t, 1) : '—', color: 'text-sky-400' },
                            { label: 'ABI (abrasion)', val: d.abi != null ? formatDecimalGrouped(d.abi, 3) : '—', color: 'text-orange-300' },
                            { label: 'Récup. design', val: d.recovery_design != null ? `${formatDecimalGrouped(d.recovery_design, 1)}%` : '—', color: 'text-emerald-400 font-bold' },
                          ].map(f => (
                            <div key={f.label}>
                              <div className="mf-txt4 mb-0.5 text-[10px]">{f.label}</div>
                              <div className={`text-xs ${f.color}`}>{f.val}</div>
                            </div>
                          ))}
                        </div>

                        {d.recovery_design != null && (
                          <div>
                            <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                              <span>Récupération</span>
                              <span style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(d.recovery_design, 1)}%</span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${d.recovery_design}%`, backgroundColor: d.color ?? '#10B981' }} />
                            </div>
                          </div>
                        )}

                        {lims && (
                          <div className="pt-1.5 border-t border-white/5 flex gap-3 text-[10px] mf-txt4">
                            {lims.n_leach > 0 && <span className="text-emerald-400">{lims.n_leach} lixiv.</span>}
                            {lims.n_grg > 0   && <span className="text-amber-400">{lims.n_grg} GRG</span>}
                            {lims.n_bwi > 0   && <span className="text-sky-400">{lims.n_bwi} BWi</span>}
                            {lims.n_ai > 0    && <span className="text-orange-400">{lims.n_ai} abrasion</span>}
                            {lims.n_flot > 0  && <span className="text-purple-400">{lims.n_flot} flott.</span>}
                          </div>
                        )}
                        {d.notes && <div className="text-[10px] mf-txt4 italic">{d.notes}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Mapping GID ──────────────────────────────────────────────────── */}
        {tab === 'gid' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines géométallurgiques</div>
            ) : (
              <>
                <div className="text-xs mf-txt3 font-semibold uppercase tracking-wider">Association Domaine ↔ Code GID (Modèle de blocs)</div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['', 'Domaine', 'Code GID', 'Échantillons', 'GRG (%)', 'Leach (%)', 'BWi (kWh/t)', 'SAI (kWh/t)', 'Argile (%)', 'Sulfures (%)', 'Preg-Rob.', 'Récupération', 'Importé'].map(h => (
                          <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {domains.map(d => (
                        <tr key={d.id} className="border-b border-white/5 hover:bg-white/4">
                          <td className="px-3 py-2"><div className="w-4 h-4 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} /></td>
                          <td className="px-3 py-2 font-semibold mf-txt">
                            <div className="flex items-center gap-1.5">
                              {d.name}
                              {isCompositeDomain(d.name) && (
                                <span className="text-[9px] font-medium text-violet-300 bg-violet-400/10 border border-violet-400/20 rounded px-1.5 py-0.5"
                                  title="Domaine composite : combinaison des domaines primaires. Exclu des allocations de blend et de la simulation LOM pour éviter de compter le même minerai deux fois.">
                                  COMPOSITE
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-amber-300">{d.gid_code ?? '—'}</td>
                          <td className="px-3 py-2 mf-txt3">{d.sample_count ?? '—'}</td>
                          <td className="px-3 py-2 text-amber-400">{d.avg_grg_pct != null ? `${formatDecimalGrouped(d.avg_grg_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 text-emerald-400">{d.avg_cil_pct != null ? `${formatDecimalGrouped(d.avg_cil_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 text-sky-400">{d.avg_bwi_kwh_t != null ? formatDecimalGrouped(d.avg_bwi_kwh_t, 1) : '—'}</td>
                          <td className="px-3 py-2 text-sky-300">{d.sai_kwh_t != null ? formatDecimalGrouped(d.sai_kwh_t, 2) : '—'}</td>
                          <td className="px-3 py-2 text-orange-300">{d.clay_pct != null ? `${formatDecimalGrouped(d.clay_pct, 1)}%` : '—'}</td>
                          <td className="px-3 py-2 mf-txt3">{d.sulphide_pct != null ? `${formatDecimalGrouped(d.sulphide_pct, 1)}%` : '—'}</td>
                          {/* Tri-state: unknown (no chem/liberation testwork) must not read as "no". */}
                          <td className="px-3 py-2">
                            {d.preg_robbing === true
                              ? <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5 py-0.5">OUI</span>
                              : d.preg_robbing === false
                                ? <span className="text-[10px] text-emerald-400/80">NON</span>
                                : <span className="mf-txt4" title="Aucun essai de libération ni carbone organique pour ce domaine">—</span>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-white/5 rounded-full h-2 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${d.recovery_design ?? 0}%`, backgroundColor: d.color ?? '#6B7280' }} />
                              </div>
                              <span className="text-xs font-semibold" style={{ color: d.color ?? '#9CA3AF' }}>
                                {d.recovery_design != null ? `${formatDecimalGrouped(d.recovery_design, 1)}%` : '—'}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">{d.is_imported ? <CheckCircle2 size={13} className="text-emerald-400" /> : <span className="mf-txt4">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2 items-start text-xs mf-txt3 bg-white/5 rounded-md p-3">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>Le code GID correspond au champ de lithologie dans votre modèle de blocs. Il permet d'assigner automatiquement une récupération métallurgique et un BWi à chaque bloc lors de la simulation de pit shell.</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Courbes Grade-Récupération ────────────────────────────────────── */}
        {tab === 'curves' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines pour visualiser les courbes</div>
            ) : (
              <>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="text-xs mf-txt3 font-semibold">Paramètre variable: P80 broyage</div>
                  <div className="flex items-center gap-2">
                    <input type="range" min="38" max="150" step="1" value={curveP80} onChange={e => setCurveP80(parseInt(e.target.value))} className="accent-emerald-400 w-32" />
                    <span className="text-xs text-emerald-400 font-bold w-16">{curveP80} µm</span>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Récupération prédite à P80 = {curveP80} µm</div>
                  <div className="space-y-2">
                    {domains.map(d => {
                      const rec = domainRecoveryAtP80(d.recovery_design ?? project.recovery_pct, curveP80);
                      const recMin = d.recovery_min != null ? domainRecoveryAtP80(d.recovery_min, curveP80) : null;
                      const recMax = d.recovery_max != null ? domainRecoveryAtP80(d.recovery_max, curveP80) : null;
                      return (
                        <div key={d.id} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                          <div className="w-28 text-xs mf-txt truncate">{d.name}</div>
                          <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                            {recMin != null && recMax != null && (
                              <div className="absolute h-full opacity-20 rounded-full"
                                style={{ left: `${recMin}%`, width: `${recMax - recMin}%`, backgroundColor: d.color ?? '#10B981' }} />
                            )}
                            <div className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${rec}%`, backgroundColor: (d.color ?? '#10B981') + 'AA' }} />
                          </div>
                          <div className="w-20 text-xs font-bold text-right" style={{ color: d.color ?? '#9CA3AF' }}>
                            {formatDecimalGrouped(rec, 2)}%
                            {recMin != null && recMax != null && (
                              <div className="text-[9px] mf-txt4">{formatDecimalGrouped(recMin, 1)}–{formatDecimalGrouped(recMax, 1)}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left px-3 py-2 mf-txt3 font-semibold">P80 (µm)</th>
                        {domains.map(d => (
                          <th key={d.id} className="text-right px-3 py-2 font-semibold" style={{ color: d.color ?? '#9CA3AF' }}>{d.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {P80_RANGE.map(p => (
                        <tr key={p} className={`border-b border-white/5 hover:bg-white/4 ${p === REFERENCE_P80_UM ? 'bg-amber-400/4' : ''}`}>
                          {/* This row is the REFERENCE grind the domain recoveries were
                              measured at — not an optimum. It used to be starred as if it
                              were, while Granulométrie computed a different optimal P80
                              economically. */}
                          <td className={`px-3 py-1.5 font-mono text-xs ${p === REFERENCE_P80_UM ? 'text-amber-400 font-bold' : 'mf-txt3'}`}>
                            {p}{p === REFERENCE_P80_UM ? ' ◆' : ''}
                          </td>
                          {domains.map(d => {
                            const base = d.recovery_design ?? project.recovery_pct;
                            const rec = domainRecoveryAtP80(base, p);
                            const delta = rec - base;
                            return (
                              <td key={d.id} className="px-3 py-1.5 text-right">
                                <span className={`font-semibold ${delta > 1 ? 'text-emerald-400' : delta < -1 ? 'text-red-400' : 'mf-txt'}`}>{formatDecimalGrouped(rec, 2)}%</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="text-xs mf-txt4 flex items-start gap-1.5">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" />
                  <span>
                    ◆ <strong>Référence</strong> P80 = {REFERENCE_P80_UM} µm (CIL standard) : le grind auquel les
                    récupérations par domaine sont mesurées, pivot de la correction empirique ±0,07 %/µm.
                    <strong> Ce n'est pas le P80 optimal</strong> — celui-ci est calculé économiquement (revenu or −
                    coût énergie) dans <em>Granulométrie / PSD → P80 Optimisation</em>, et peut différer de 75 µm.
                    Bandes min/max affichées si renseignées.
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Variabilité & Monte Carlo ─────────────────────────────────────── */}
        {tab === 'variability' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines pour l'analyse de variabilité</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 card-sm space-y-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Plage de variabilité par domaine</div>
                    {domains.map(d => {
                      const recBase = d.recovery_design ?? project.recovery_pct;
                      const bwiBase = d.avg_bwi_kwh_t ?? 16.8;
                      const recMin = d.recovery_min ?? recBase - 3;
                      const recMax = d.recovery_max ?? recBase + 3;
                      const bwiMin = d.bwi_min ?? bwiBase - 2;
                      const bwiMax = d.bwi_max ?? bwiBase + 2;
                      return (
                        <div key={d.id} className="border-b border-white/5 pb-3 last:border-0 last:pb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <span className="text-xs font-semibold mf-txt">{d.name}</span>
                            {d.preg_robbing && <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-1.5">PREG-ROBBING</span>}
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                                <span>Récupération (%)</span>
                                <span style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(recMin, 1)} – {formatDecimalGrouped(recMax, 1)}%</span>
                              </div>
                              <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
                                <div className="absolute h-full rounded-full opacity-30"
                                  style={{ left: `${recMin}%`, width: `${recMax - recMin}%`, backgroundColor: d.color ?? '#10B981' }} />
                                <div className="absolute h-full w-0.5 bg-white/60"
                                  style={{ left: `${recBase}%` }} />
                              </div>
                              <div className="flex justify-between text-[9px] mf-txt4 mt-0.5">
                                <span>P10: {formatDecimalGrouped(recMin, 1)}%</span>
                                <span className="font-bold" style={{ color: d.color ?? '#9CA3AF' }}>Design: {formatDecimalGrouped(recBase, 1)}%</span>
                                <span>P90: {formatDecimalGrouped(recMax, 1)}%</span>
                              </div>
                            </div>
                            <div>
                              <div className="flex justify-between text-[10px] mf-txt4 mb-1">
                                <span>BWi (kWh/t)</span>
                                <span className="text-sky-400">{formatDecimalGrouped(bwiMin, 1)} – {formatDecimalGrouped(bwiMax, 1)}</span>
                              </div>
                              <div className="h-3 bg-white/5 rounded-full overflow-hidden relative">
                                <div className="absolute h-full rounded-full bg-sky-400/30"
                                  style={{ left: `${(bwiMin / 30) * 100}%`, width: `${((bwiMax - bwiMin) / 30) * 100}%` }} />
                                <div className="absolute h-full w-0.5 bg-sky-300/80"
                                  style={{ left: `${(bwiBase / 30) * 100}%` }} />
                              </div>
                              <div className="flex justify-between text-[9px] mf-txt4 mt-0.5">
                                <span>Min: {formatDecimalGrouped(bwiMin, 1)}</span>
                                <span className="text-sky-400 font-bold">Moy: {formatDecimalGrouped(bwiBase, 1)}</span>
                                <span>Max: {formatDecimalGrouped(bwiMax, 1)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-3">
                    <div className="card-sm space-y-3">
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Simulation Monte Carlo</div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="mf-txt3">P80 cible (µm)</span>
                        <input type="range" min="38" max="150" value={varP80} onChange={e => setVarP80(parseInt(e.target.value))} className="w-24 accent-emerald-400" />
                        <span className="text-emerald-400 font-bold w-12">{varP80}</span>
                      </div>
                      <button onClick={runMonteCarlo} disabled={mcRunning} className="btn btn-teal w-full text-xs flex items-center justify-center gap-1.5">
                        <RefreshCw size={11} className={mcRunning ? 'animate-spin' : ''} />
                        {mcRunning ? 'Simulation…' : 'Lancer 500 itérations'}
                      </button>

                      {monteCarlo.length > 0 && (
                        <div className="space-y-2">
                          {[
                            { label: 'P10 (pessimiste)', val: mcP10, color: 'text-red-400' },
                            { label: 'P50 (médiane)', val: mcP50, color: 'text-amber-400' },
                            { label: 'P90 (optimiste)', val: mcP90, color: 'text-emerald-400' },
                          ].map(s => (
                            <div key={s.label} className="flex justify-between text-xs">
                              <span className="mf-txt3">{s.label}</span>
                              <span className={`font-bold ${s.color}`}>
                                {s.val != null ? `${formatDecimalGrouped((s.val / 1000), 1)} koz/an` : '—'}
                              </span>
                            </div>
                          ))}
                          <div className="pt-2 border-t border-white/10">
                            <div className="text-[10px] mf-txt4 mb-2">Distribution onces/an (500 runs)</div>
                            <div className="flex items-end gap-px h-12">
                              {(() => {
                                const min = monteCarlo[0].oz;
                                const max = monteCarlo[monteCarlo.length - 1].oz;
                                const bins = 20;
                                const binW = (max - min) / bins;
                                const counts = Array(bins).fill(0);
                                monteCarlo.forEach(r => {
                                  const b = Math.min(bins - 1, Math.floor((r.oz - min) / binW));
                                  counts[b]++;
                                });
                                const maxCount = Math.max(...counts);
                                return counts.map((c, i) => (
                                  <div key={i} className="flex-1 rounded-t"
                                    style={{ height: `${(c / maxCount) * 100}%`, backgroundColor: '#10B981AA' }} />
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Prédiction Métallurgique ──────────────────────────────────────── */}
        {tab === 'prediction' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines</div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 space-y-3">
                  <div className="card-sm space-y-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Paramètres de prédiction</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Domaine actif</label>
                        <select className="input-field w-full text-xs"
                          value={selectedDomainId ?? ''}
                          onChange={e => setSelectedDomainId(e.target.value)}>
                          {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">P80 broyage (µm)</label>
                        <div className="flex items-center gap-2">
                          <input type="range" min="38" max="150" value={predP80} onChange={e => setPredP80(parseInt(e.target.value))} className="flex-1 accent-emerald-400" />
                          <input type="number" className="input-field text-xs w-16 text-right" value={predP80} onChange={e => setPredP80(parseInt(e.target.value) || 75)} />
                        </div>
                      </div>
                      <div>
                        <label className="label">Teneur (g/t)</label>
                        <input type="number" step="0.01" className="input-field w-full text-xs" value={predGrade} onChange={e => setPredGrade(parseFloat(e.target.value) || project.gold_grade_g_t)} />
                      </div>
                      <div>
                        <label className="label">Débit (t/h)</label>
                        <input type="number" step="10" className="input-field w-full text-xs" value={predTph} onChange={e => setPredTph(parseFloat(e.target.value) || project.target_tph)} />
                      </div>
                    </div>
                  </div>

                  {/* Comparison table across all domains */}
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Comparaison tous domaines à P80 = {predP80} µm</div>
                    <table className="tbl w-full text-xs">
                      <thead>
                        <tr>
                          {['Domaine', 'Récup. (%)', 'BWi (kWh/t)', 'Énergie spéc. (kWh/t)', 'koz/an (design)', 'Notes'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {domains.map(d => {
                          const rec = domainRecoveryAtP80(d.recovery_design ?? project.recovery_pct, predP80);
                          const bwi = d.avg_bwi_kwh_t ?? 16.8;
                          const energy = plantGrindEnergy(bwi, dcF80, predP80);
                          const h = (project.availability_pct / 100) * hoursPerYear;
                          const oz = predTph * h * predGrade * (rec / 100) / TROY;
                          const isActive = d.id === selectedDomainId;
                          return (
                            <tr key={d.id} onClick={() => setSelectedDomainId(d.id)}
                              className={`border-b border-white/5 cursor-pointer transition-colors ${isActive ? 'bg-emerald-400/8' : 'hover:bg-white/4'}`}>
                              <td className="px-3 py-2 flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                                <span className="font-semibold mf-txt">{d.name}</span>
                              </td>
                              <td className="px-3 py-2 font-bold" style={{ color: d.color ?? '#9CA3AF' }}>{formatDecimalGrouped(rec, 2)}%</td>
                              <td className="px-3 py-2 text-sky-400">{formatDecimalGrouped(bwi, 1)}</td>
                              <td className="px-3 py-2 text-amber-300">{energy > 0 ? formatDecimalGrouped(energy, 1) : '—'}</td>
                              <td className="px-3 py-2 text-emerald-400 font-bold">{formatDecimalGrouped((oz / 1000), 1)}</td>
                              <td className="px-3 py-2 text-[10px] mf-txt4">
                                {d.preg_robbing ? '⚠ Preg-robbing' : d.clay_pct != null && d.clay_pct > 5 ? '⚠ Argile élevée' : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right — metrics for selected domain */}
                <div className="space-y-3">
                  {(() => {
                    const d = domains.find(dd => dd.id === selectedDomainId) ?? domains[0];
                    if (!d) return null;
                    return (
                      <>
                        <div className="card-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="text-xs font-semibold mf-txt">{d.name}</div>
                          </div>
                          {[
                            { label: 'Récupération prédite', val: `${formatDecimalGrouped(predRec, 2)}%`, color: 'text-emerald-400' },
                            { label: 'BWi moyen', val: predBwi > 0 ? `${formatDecimalGrouped(predBwi, 1)} kWh/t` : '—', color: 'text-sky-400' },
                            { label: 'Énergie spécifique', val: predEnergy > 0 ? `${formatDecimalGrouped(predEnergy, 1)} kWh/t` : '—', color: 'text-amber-400' },
                            { label: 'Production annuelle', val: `${formatDecimalGrouped((predAnnualOz / 1000), 1)} koz/an`, color: 'text-amber-400 font-bold' },
                          ].map(f => (
                            <div key={f.label} className="flex justify-between text-xs mb-2">
                              <span className="mf-txt3">{f.label}</span>
                              <span className={`font-semibold ${f.color}`}>{f.val}</span>
                            </div>
                          ))}
                        </div>

                        {d.preg_robbing && (
                          <div className="card-sm bg-red-400/5 border border-red-400/20 text-xs text-red-300 flex items-start gap-2">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span>Preg-robbing confirmé. Utiliser CIL avec lavages additionnels ou prétaitement carbone.</span>
                          </div>
                        )}

                        {(d.clay_pct ?? 0) > 5 && (
                          <div className="card-sm bg-orange-400/5 border border-orange-400/20 text-xs text-orange-300 flex items-start gap-2">
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span>Teneur argile {d.clay_pct?.toFixed(1)}% — risque colmatage, ajuster disponibilité et conso. floculant.</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Simulation LOM ───────────────────────────────────────────────── */}
        {tab === 'lomsim' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines</div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Plan de vie de mine — Simulation GéoMet</div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="mf-txt3">Durée LOM:</span>
                      <input type="number" min="1" max="30" className="input-field text-xs w-14 text-right" value={lomYears} onChange={e => setLomYears(parseInt(e.target.value) || 10)} />
                      <span className="mf-txt4">ans</span>
                    </div>
                  </div>
                  <div className="flex gap-3 text-xs">
                    {[
                      { label: 'Total onces', val: `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.oz_year, 0) / 1000), 0)} koz`, color: 'text-amber-400' },
                      { label: 'Récup. moy.', val: lomSimRows.length ? `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.recovery_pct, 0) / lomSimRows.length), 1)}%` : '—', color: 'text-emerald-400' },
                      { label: 'Énergie moy.', val: lomSimRows.length ? `${formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.energy_kwh_t, 0) / lomSimRows.length), 1)} kWh/t` : '—', color: 'text-sky-400' },
                    ].map(k => (
                      <div key={k.label} className="text-right">
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`font-bold ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* LOM bar chart */}
                <div className="card-sm">
                  <div className="text-xs mf-txt3 font-semibold mb-3 uppercase tracking-wider">Production annuelle (koz/an)</div>
                  {/* Each column must stretch to the chart height and give the bar a
                      parent with a definite height — a percentage height against an
                      auto-height parent resolves to zero, which left the bars invisible
                      while the labels still rendered. */}
                  <div className="flex items-stretch gap-1 h-32">
                    {(() => {
                      const maxOz = Math.max(...lomSimRows.map(x => x.oz_year), 1);
                      return lomSimRows.map(r => {
                        const h = Math.max((r.oz_year / maxOz) * 100, r.oz_year > 0 ? 2 : 0);
                        return (
                          <div key={r.year} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                            <div className="text-[9px] mf-txt4">{formatDecimalGrouped((r.oz_year / 1000), 0)}</div>
                            <div className="w-full flex-1 flex items-end">
                              <div className="w-full rounded-t transition-all"
                                style={{ height: `${h}%`, background: 'linear-gradient(180deg, #F59E0B 0%, #D97706 100%)' }}
                                title={`An ${r.year} — ${formatDecimalGrouped((r.oz_year / 1000), 1)} koz`} />
                            </div>
                            <div className="text-[9px] mf-txt4">{r.year}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Année', 'Débit (t/h)', 'Teneur (g/t)', 'Récup. (%)', 'BWi (kWh/t)', 'Énergie (kWh/t)', 'koz/an', 'Cumul (koz)', 'Notes'].map(h => (
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lomSimRows.map((r, i) => {
                        const cumOz = lomSimRows.slice(0, i + 1).reduce((s, x) => s + x.oz_year, 0);
                        return (
                          <tr key={r.year} className="border-b border-white/5 hover:bg-white/4">
                            <td className="px-2 py-1.5 font-semibold text-amber-400">An {r.year}</td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="10" className="input-field text-xs w-16 py-0.5 text-right"
                                value={formatDecimalGrouped(r.tph, 0)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, tph: parseFloat(e.target.value) || x.tph } : x))} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.01" className="input-field text-xs w-14 py-0.5 text-right"
                                value={formatDecimalGrouped(r.grade_g_t, 2)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, grade_g_t: parseFloat(e.target.value) || x.grade_g_t } : x))} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="number" step="0.1" className="input-field text-xs w-14 py-0.5 text-right"
                                value={formatDecimalGrouped(r.recovery_pct, 1)}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, recovery_pct: parseFloat(e.target.value) || x.recovery_pct } : x))} />
                            </td>
                            <td className="px-2 py-1.5 text-sky-400">{formatDecimalGrouped(r.bwi_kwh_t, 1)}</td>
                            <td className="px-2 py-1.5 text-amber-300">{r.energy_kwh_t > 0 ? formatDecimalGrouped(r.energy_kwh_t, 1) : '—'}</td>
                            <td className="px-2 py-1.5 font-bold text-amber-400">{formatDecimalGrouped((r.oz_year / 1000), 1)}</td>
                            <td className="px-2 py-1.5 text-emerald-400">{formatDecimalGrouped((cumOz / 1000), 1)}</td>
                            <td className="px-2 py-1.5">
                              <input className="input-field text-xs w-32 py-0.5 mf-txt3"
                                value={r.notes}
                                onChange={e => setLomSimRows(p => p.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                                placeholder="Commentaire…" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-400/40">
                        <td className="px-2 py-2 font-bold text-xs mf-txt" colSpan={6}>TOTAL LOM</td>
                        <td className="px-2 py-2 font-bold text-amber-400">{formatDecimalGrouped((lomSimRows.reduce((s, r) => s + r.oz_year, 0) / 1000), 1)} koz</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Blend & Optimisation ─────────────────────────────────────────── */}
        {tab === 'blend' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Créez d'abord des domaines géométallurgiques</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2 card-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Proportion de traitement par domaine</div>
                      <div className={`text-xs font-semibold ${Math.abs(blendTotal - 100) < 1 ? 'text-emerald-400' : 'text-red-400'}`}>
                        Total: {formatDecimalGrouped(blendTotal, 0)}%
                      </div>
                    </div>

                    {primaryDomains.map(d => (
                      <div key={d.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <span className="text-xs mf-txt">{d.name}</span>
                            {d.recovery_design != null && <span className="text-[10px] mf-txt4">({formatDecimalGrouped(d.recovery_design, 1)}%)</span>}
                            {d.preg_robbing && <span className="text-[10px] text-red-400">PR</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <input type="number" min="0" max="100" step="0.5" value={blendSplit[d.id] ?? 0}
                              onChange={e => setBlendSplit(prev => ({ ...prev, [d.id]: parseFloat(e.target.value) || 0 }))}
                              className="input-field text-xs text-right w-16 py-0.5" />
                            <span className="text-xs mf-txt4">%</span>
                          </div>
                        </div>
                        <input type="range" min="0" max="100" step="0.5" value={blendSplit[d.id] ?? 0}
                          onChange={e => setBlendSplit(prev => ({ ...prev, [d.id]: parseFloat(e.target.value) }))}
                          className="w-full" style={{ accentColor: d.color ?? '#10B981' }} />
                      </div>
                    ))}

                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={() => {
                        const equal = +(100 / Math.max(primaryDomains.length, 1)).toFixed(1);
                        setBlendSplit(Object.fromEntries(primaryDomains.map(d => [d.id, equal])));
                      }} className="btn btn-secondary text-xs">Équilibrer (100% / {primaryDomains.length})</button>

                      <button onClick={saveBlendToLom}
                        disabled={blendSaving || Math.abs(blendTotal - 100) > 1}
                        className="btn btn-teal text-xs flex items-center gap-1.5 disabled:opacity-40">
                        <Save size={11} /> {blendSaving ? 'Enregistrement…' : 'Enregistrer comme répartition LOM'}
                      </button>
                      {blendSaved && (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <CheckCircle2 size={12} /> Répartition enregistrée — le BWi et le P80 optimal la suivent
                        </span>
                      )}
                    </div>

                    <div className="text-[10px] mf-txt4 space-y-0.5">
                      {compositeReference && (
                        <div>
                          « {compositeReference.name} » est la combinaison de ces {primaryDomains.length} domaines — le blend calculé ci-contre <em>est</em> le mixte.
                        </div>
                      )}
                      <div>
                        {feedShare.fromLom
                          ? <>Répartition <strong className="text-emerald-400/90">enregistrée (lom_pct)</strong> : Granulométrie pondère le BWi et le P80 optimal dessus.</>
                          : <>Aucune répartition enregistrée — <strong className="text-amber-400/90">parts égales par défaut</strong>. Enregistrez-la pour que le BWi et le P80 optimal suivent l'alimentation réelle.</>}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {[
                      { label: 'Récupération blendée', val: `${formatDecimalGrouped(blendedRecovery, 2)}%`, color: 'text-emerald-400', icon: TrendingUp },
                      { label: 'BWi blendé', val: `${formatDecimalGrouped(blendedBwi, 2)} kWh/t`, color: 'text-sky-400', icon: Zap },
                      { label: 'GRG blendé', val: blendedGrg > 0 ? `${formatDecimalGrouped(blendedGrg, 1)}%` : '—', color: 'text-amber-400', icon: Target },
                      { label: 'Onces/an (blend)', val: `${formatDecimalGrouped((annualOzBlended / 1000), 1)} koz`, color: 'text-amber-400', icon: BarChart3 },
                    ].map(k => (
                      <div key={k.label} className="card-sm py-2.5">
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] mf-txt4">
                          <k.icon size={10} className={k.color} /> {k.label}
                        </div>
                        <div className={`text-xl font-bold ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                    {Math.abs(blendTotal - 100) > 1 && (
                      <div className="p-2.5 rounded-md bg-red-400/8 border border-red-400/20 text-xs text-red-300 flex items-center gap-2">
                        <AlertCircle size={11} /> Le total doit être 100%
                      </div>
                    )}

                    {/* Measured composite vs computed blend — a validation of the model,
                        not an extra feed source. */}
                    {compositeReference?.recovery_design != null && (() => {
                      const measured = compositeReference.recovery_design;
                      const delta = blendedRecovery - measured;
                      const ok = Math.abs(delta) <= 2;
                      return (
                        <div className="card-sm py-2.5">
                          <div className="flex items-center gap-1.5 mb-1 text-[10px] mf-txt4">
                            <GitBranch size={10} className="text-violet-400" /> Validation — {compositeReference.name} mesuré
                          </div>
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-bold mf-txt">{formatDecimalGrouped(measured, 1)}%</span>
                            <span className="text-[10px] mf-txt4">mesuré ({compositeReference.sample_count ?? 0} éch.)</span>
                          </div>
                          <div className={`text-[10px] mt-1 ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {ok ? '✓' : '⚠'} Écart blend calculé − mesuré : {delta >= 0 ? '+' : ''}{formatDecimalGrouped(delta, 2)} pt
                          </div>
                          {!ok && (
                            <div className="text-[10px] mf-txt4 mt-0.5">
                              Le blend s'écarte du composite testé — vérifier la répartition ou les récupérations par domaine.
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Représentation visuelle du blend</div>
                  <div className="flex h-8 rounded-lg overflow-hidden">
                    {primaryDomains.filter(d => (blendSplit[d.id] ?? 0) > 0).map(d => (
                      <div key={d.id} className="h-full transition-all flex items-center justify-center"
                        style={{ width: `${blendSplit[d.id] ?? 0}%`, backgroundColor: d.color ?? '#6B7280' }}
                        title={`${d.name}: ${formatDecimalGrouped((blendSplit[d.id] ?? 0), 1)}%`}>
                        {(blendSplit[d.id] ?? 0) > 10 && <span className="text-[9px] font-bold text-white/90">{formatDecimalGrouped((blendSplit[d.id] ?? 0), 0)}%</span>}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-2.5">
                    {domains.map(d => (
                      <div key={d.id} className="flex items-center gap-1.5 text-[10px] mf-txt3">
                        <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                        {d.name}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Graphiques ─────────────────────────────────────────────────────── */}
        {tab === 'graphs' && (
          <div className="space-y-4">
            {domains.length === 0 ? (
              <div className="text-center mf-txt3 py-16 text-sm">Aucune donnée à visualiser</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Récupération par Domaine (%)</div>
                    <div className="space-y-2">
                      {domains.map(d => {
                        const rec = d.recovery_design ?? 0;
                        return (
                          <div key={d.id} className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="w-20 text-xs mf-txt3 truncate">{d.name}</div>
                            <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                              {d.recovery_min != null && d.recovery_max != null && (
                                <div className="absolute h-full opacity-20 rounded-full"
                                  style={{ left: `${d.recovery_min}%`, width: `${d.recovery_max - d.recovery_min}%`, backgroundColor: d.color ?? '#10B981' }} />
                              )}
                              <div className="h-full rounded-full" style={{ width: `${rec}%`, backgroundColor: d.color ?? '#6B7280', opacity: 0.8 }} />
                            </div>
                            <div className="w-12 text-xs font-semibold text-right" style={{ color: d.color ?? '#9CA3AF' }}>
                              {rec > 0 ? `${formatDecimalGrouped(rec, 1)}%` : '—'}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center gap-3 border-t border-white/5 pt-2">
                        <div className="w-3 h-3 rounded-full shrink-0 border-2 border-white/30 bg-transparent" />
                        <div className="w-20 text-xs mf-txt4 truncate">Projet (réf.)</div>
                        <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden">
                          <div className="h-full rounded-full border-2 border-white/30" style={{ width: `${project.recovery_pct}%` }} />
                        </div>
                        <div className="w-12 text-xs text-white/30 text-right">{project.recovery_pct}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">BWi par Domaine (kWh/t)</div>
                    {domains.filter(d => d.avg_bwi_kwh_t != null).length === 0 ? (
                      <div className="text-xs mf-txt4 text-center py-8">Aucune donnée BWi</div>
                    ) : (() => {
                      const maxBwi = Math.max(...domains.map(d => d.avg_bwi_kwh_t ?? 0), 1);
                      return domains.map(d => {
                        const bwi = d.avg_bwi_kwh_t ?? 0;
                        return (
                          <div key={d.id} className="flex items-center gap-3 mb-2">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                            <div className="w-20 text-xs mf-txt3 truncate">{d.name}</div>
                            <div className="flex-1 bg-white/5 rounded-full h-5 overflow-hidden relative">
                              {d.bwi_min != null && d.bwi_max != null && (
                                <div className="absolute h-full bg-sky-400/15 rounded-full"
                                  style={{ left: `${(d.bwi_min / maxBwi) * 100}%`, width: `${((d.bwi_max - d.bwi_min) / maxBwi) * 100}%` }} />
                              )}
                              <div className="h-full rounded-full bg-sky-500/60 transition-all" style={{ width: `${(bwi / maxBwi) * 100}%` }} />
                            </div>
                            <div className="w-16 text-xs text-sky-400 text-right">{bwi > 0 ? `${formatDecimalGrouped(bwi, 1)}` : '—'}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Monte Carlo results histogram if available */}
                  {monteCarlo.length > 0 && (
                    <div className="card-sm">
                      <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Distribution Monte Carlo — Onces/an</div>
                      <div className="flex items-end gap-px h-24 mb-2">
                        {(() => {
                          const min = monteCarlo[0].oz;
                          const max = monteCarlo[monteCarlo.length - 1].oz;
                          const bins = 25;
                          const binW = (max - min) / bins;
                          const counts = Array(bins).fill(0);
                          monteCarlo.forEach(r => {
                            const b = Math.min(bins - 1, Math.floor((r.oz - min) / binW));
                            counts[b]++;
                          });
                          const maxCount = Math.max(...counts);
                          return counts.map((c, i) => {
                            const binMid = min + (i + 0.5) * binW;
                            const isP50 = i === Math.floor(bins / 2);
                            return (
                              <div key={i} className="flex-1 rounded-t transition-all"
                                title={`${formatDecimalGrouped((binMid / 1000), 1)} koz: ${c} simulations`}
                                style={{ height: `${(c / maxCount) * 100}%`, backgroundColor: isP50 ? '#F59E0B' : '#10B981AA' }} />
                            );
                          });
                        })()}
                      </div>
                      <div className="flex justify-between text-[10px] mf-txt4">
                        <span className="text-red-400">P10: {mcP10 != null ? `${formatDecimalGrouped((mcP10/1000), 1)} koz` : '—'}</span>
                        <span className="text-amber-400">P50: {mcP50 != null ? `${formatDecimalGrouped((mcP50/1000), 1)} koz` : '—'}</span>
                        <span className="text-emerald-400">P90: {mcP90 != null ? `${formatDecimalGrouped((mcP90/1000), 1)} koz` : '—'}</span>
                      </div>
                    </div>
                  )}
                </div>

                {domains.some(d => d.lom_pct != null) && (() => {
                  const total = domains.reduce((s, d) => s + (d.lom_pct ?? 0), 0) || 1;
                  let cumAngle = -Math.PI / 2;
                  const cx = 80, cy = 80, r = 62;
                  return (
                    <div className="card-sm">
                      <div className="text-xs font-semibold mf-txt3 mb-3 uppercase tracking-wider">Proportion LOM par domaine</div>
                      <div className="flex gap-8 items-center">
                        <svg viewBox="0 0 160 160" className="w-40 h-40 shrink-0">
                          {domains.map(d => {
                            if (!d.lom_pct) return null;
                            const angle = (d.lom_pct / total) * 2 * Math.PI;
                            const x1 = cx + r * Math.cos(cumAngle);
                            const y1 = cy + r * Math.sin(cumAngle);
                            cumAngle += angle;
                            const x2 = cx + r * Math.cos(cumAngle);
                            const y2 = cy + r * Math.sin(cumAngle);
                            const largeArc = angle > Math.PI ? 1 : 0;
                            return (
                              <path key={d.id}
                                d={`M${cx},${cy} L${x1},${y1} A${r},${r},0,${largeArc},1,${x2},${y2} Z`}
                                fill={d.color ?? '#6B7280'} opacity={0.85} />
                            );
                          })}
                          <circle cx={cx} cy={cy} r={28} fill="rgb(18,24,32)" />
                          <text x={cx} y={cy - 5} textAnchor="middle" fill="#9CA3AF" fontSize="9">LOM</text>
                          <text x={cx} y={cy + 8} textAnchor="middle" fill="#E5E7EB" fontSize="11" fontWeight="bold">{domains.length} dom.</text>
                        </svg>
                        <div className="space-y-2">
                          {domains.filter(d => d.lom_pct).map(d => (
                            <div key={d.id} className="flex items-center gap-2.5 text-xs">
                              <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.color ?? '#6B7280' }} />
                              <span className="mf-txt">{d.name}</span>
                              <span className="ml-auto mf-txt3">{d.lom_pct?.toFixed(0)}%</span>
                            </div>
                          ))}
                          <div className="pt-2 border-t border-white/5 text-[10px] mf-txt4">
                            Total: {formatDecimalGrouped(domains.reduce((s, d) => s + (d.lom_pct ?? 0), 0), 0)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Domain Form Modal ─────────────────────────────────────────────────── */}
      {showNew && (
        <Modal
          title={editDomain ? `Modifier: ${editDomain.name}` : 'Nouveau Domaine Géométallurgique'}
          onClose={() => setShowNew(false)}
        >
          <div className="p-4 space-y-3 min-w-[560px]">
            {/* Modal sub-tabs */}
            <div className="flex gap-0 border-b border-white/10 mb-3">
              {([
                { id: 'basic' as const, label: 'Données de base' },
                { id: 'advanced' as const, label: 'Propriétés physiques' },
                { id: 'metallurgy' as const, label: 'Métallurgie' },
              ]).map(t => (
                <button key={t.id} onClick={() => setFormTab(t.id)}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition-colors ${formTab === t.id ? 'border-emerald-400 text-emerald-300' : 'border-transparent mf-txt3 hover:mf-txt'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {formTab === 'basic' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Nom du domaine *</label>
                  <input className="input-field w-full" value={formData.name ?? ''} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Oxyde, Sulfure, Transitionnel" />
                </div>
                <div>
                  <label className="label">Code GID</label>
                  <input className="input-field w-full font-mono" value={formData.gid_code ?? ''} onChange={e => setFormData(p => ({ ...p, gid_code: e.target.value }))} placeholder="Ex: OX, SU, TR" />
                </div>
                <div>
                  <label className="label">Nb échantillons</label>
                  <input type="number" className="input-field w-full" value={formData.sample_count ?? ''} onChange={e => setFormData(p => ({ ...p, sample_count: parseInt(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">% LOM (proportion réserves)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.lom_pct ?? ''} onChange={e => setFormData(p => ({ ...p, lom_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
              </div>
            )}

            {formTab === 'advanced' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">BWi moyen (kWh/t)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.avg_bwi_kwh_t ?? ''} onChange={e => setFormData(p => ({ ...p, avg_bwi_kwh_t: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">SAI — SAG Abrasion (kWh/t)</label>
                  <input type="number" step="0.01" className="input-field w-full" value={formData.sai_kwh_t ?? ''} onChange={e => setFormData(p => ({ ...p, sai_kwh_t: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">ABI — Abrasion Bond Index</label>
                  <input type="number" step="0.001" className="input-field w-full" value={formData.abi ?? ''} onChange={e => setFormData(p => ({ ...p, abi: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">RQI — Rock Quality Index</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.rqi ?? ''} onChange={e => setFormData(p => ({ ...p, rqi: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">BWi min (kWh/t)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.bwi_min ?? ''} onChange={e => setFormData(p => ({ ...p, bwi_min: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">BWi max (kWh/t)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.bwi_max ?? ''} onChange={e => setFormData(p => ({ ...p, bwi_max: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Argile (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.clay_pct ?? ''} onChange={e => setFormData(p => ({ ...p, clay_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Sulfures (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.sulphide_pct ?? ''} onChange={e => setFormData(p => ({ ...p, sulphide_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Carbonates (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.carbonate_pct ?? ''} onChange={e => setFormData(p => ({ ...p, carbonate_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
              </div>
            )}

            {formTab === 'metallurgy' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">GRG moyen (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.avg_grg_pct ?? ''} onChange={e => setFormData(p => ({ ...p, avg_grg_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Leach / Lixiviation moyen (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.avg_cil_pct ?? ''} onChange={e => setFormData(p => ({ ...p, avg_cil_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">GRG min (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.grg_min ?? ''} onChange={e => setFormData(p => ({ ...p, grg_min: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">GRG max (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.grg_max ?? ''} onChange={e => setFormData(p => ({ ...p, grg_max: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Leach min (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.cil_min ?? ''} onChange={e => setFormData(p => ({ ...p, cil_min: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Leach max (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.cil_max ?? ''} onChange={e => setFormData(p => ({ ...p, cil_max: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Récupération de design (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.recovery_design ?? ''} onChange={e => setFormData(p => ({ ...p, recovery_design: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Flottation (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.flotation_pct ?? ''} onChange={e => setFormData(p => ({ ...p, flotation_pct: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Récup. min (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.recovery_min ?? ''} onChange={e => setFormData(p => ({ ...p, recovery_min: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div>
                  <label className="label">Récup. max (%)</label>
                  <input type="number" step="0.1" className="input-field w-full" value={formData.recovery_max ?? ''} onChange={e => setFormData(p => ({ ...p, recovery_max: parseFloat(e.target.value) || undefined }))} />
                </div>
                <div className="col-span-2 flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formData.preg_robbing ?? false}
                      onChange={e => setFormData(p => ({ ...p, preg_robbing: e.target.checked }))}
                      className="accent-red-400" />
                    <span className="text-xs mf-txt">Preg-robbing confirmé</span>
                  </label>
                  {formData.preg_robbing && (
                    <span className="text-[10px] text-red-400 bg-red-400/10 rounded px-2 py-1">
                      Impact sur récupération CIL — traitement spécial requis
                    </span>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="label">Notes</label>
              <textarea className="input-field w-full" rows={2} value={formData.notes ?? ''} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button onClick={() => setShowNew(false)} className="btn btn-secondary flex items-center gap-1.5"><X size={12} /> Annuler</button>
              <button onClick={submitForm} disabled={saving || !formData.name?.trim()} className="btn btn-teal flex items-center gap-1.5">
                <Save size={12} /> {saving ? 'Enregistrement…' : (editDomain ? 'Modifier' : 'Créer')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
