import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3, Plus, RefreshCw, CheckCircle2, AlertCircle,
  Database, Save, X,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase, supabaseDynamic } from '../lib/supabase';
import { useConfirm } from '../components/ui/ConfirmDialog';
import type { Project } from '../types';
import { DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import { useProject } from '../lib/ProjectContext';
import { canonDomain, isCompositeDomain, lithologyRoot, PRIMARY_LITHOLOGY_CANONS } from '../lib/geomet/domains';
import { REFERENCE_P80_UM, domainRecoveryAtP80, plantGrindEnergy } from '../lib/geomet/p80';
import { blendMetrics, availabilityShares, DEFAULT_BLEND_OPT_PARAMS, type BlendDomain, type BlendMetrics, type AvailabilityDomain } from '../lib/geomet/blendOptimization';
import {
  domainConfidence, coverageBreakdown, qaChecks, type QaDomainRow, type QaFinding,
} from '../lib/geomet/quality';
import {
  evaluateRows, reconciliationSummary, reconciliationSuggestions,
  type ReconRow,
} from '../lib/geomet/reconciliation';
import { BLANK_DOMAIN, BlockModelAggregate, DOMAIN_COLORS, GeometDomain, LimsAggregate, LomSimRow, MetalView, ModelVersion, ReconEntry, TABS, TAB_GROUPS, TROY, Tab, fetchBlockAggregates, fetchLimsAggregates, groupForTab } from './geomet/model';
import { DomainsTab } from './geomet/DomainsTab';
import { GidTab } from './geomet/GidTab';
import { MetallurgyTab } from './geomet/MetallurgyTab';
import { LomSimTab } from './geomet/LomSimTab';
import { BlendTab } from './geomet/BlendTab';
import { GraphsTab } from './geomet/GraphsTab';
import { QualityTab } from './geomet/QualityTab';
import { ValidationTab } from './geomet/ValidationTab';
import { VersionsTab } from './geomet/VersionsTab';

interface GeoMetProps { project: Project }

export function GeoMet({ project }: GeoMetProps) {
  const confirm = useConfirm();
  // Calendar hours/yr from the project's resolved assumptions (project_settings
  // override applied), so GeoMet throughput matches the other modules.
  const { assumptions } = useProject();
  const hoursPerYear = assumptions.hoursPerYear;

  const [tab, setTab] = useState<Tab>('domains');
  const [metalView, setMetalView] = useState<MetalView>('curves');
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
  const [optResult, setOptResult] = useState<BlendMetrics | null>(null);

  // Grade-recovery curve state
  const [curveP80, setCurveP80] = useState(75);
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  // LOM Simulation
  const [lomYears, setLomYears] = useState(10);
  const [lomSimRows, setLomSimRows] = useState<LomSimRow[]>([]);

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

  // Validation & réconciliation (écran de support)
  const [reconRows, setReconRows] = useState<ReconEntry[]>([]);
  const [reconForm, setReconForm] = useState<Partial<ReconEntry>>({});
  const [reconSaving, setReconSaving] = useState(false);

  // Versions du modèle (écran de support)
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [versionLabel, setVersionLabel] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [versionSaving, setVersionSaving] = useState(false);

  const loadReconRows = useCallback(async () => {
    const { data } = await supabaseDynamic
      .from('geomet_reconciliation')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    setReconRows((data ?? []) as ReconEntry[]);
  }, [project.id]);

  const loadVersions = useCallback(async () => {
    const { data } = await supabaseDynamic
      .from('geomet_model_version')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false });
    setVersions((data ?? []) as ModelVersion[]);
  }, [project.id]);

  const loadDomains = useCallback(async () => {
    setLoading(true);
    setDomains([]);
    const { data } = await supabase
      .from('geomet_domains')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true });
    setDomains((data ?? []) as unknown as GeometDomain[]);
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

      let currentDomains = (domsRes.data ?? []) as GeometDomain[];

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

      // ── Nomenclature partagée LIMS ↔ Block Model ────────────────────────────
      // Le Block Model porte des lithologies COARSE ("Oxyde", "Sulfure") alors que
      // le LIMS les subdivise par teneur ("Oxyde MG/LG/HG"). Une lithologie coarse
      // du BM ne doit donc PAS créer un domaine générique séparé (les OX3/SU3
      // parasites) : elle est le PARENT des domaines LIMS granulaires de même
      // racine. On repère les racines déjà couvertes par un domaine granulaire
      // (canon ≠ racine) — LIMS ou existant — pour, ensuite, ne pas matérialiser
      // le parent coarse et nettoyer ceux déjà créés par un sync précédent.
      const rootsCoveredByGranular = new Set<string>();
      for (const a of freshLimsAggs) {
        const root = lithologyRoot(a.domain);
        if (a.canon !== root) rootsCoveredByGranular.add(root);
      }
      for (const d of currentDomains) {
        const root = lithologyRoot(d.name);
        if (canonDomain(d.name) !== root) rootsCoveredByGranular.add(root);
      }
      /** Un canon BM-only est un parent coarse redondant s'il EST une lithologie primaire déjà couverte par des domaines granulaires, sans données LIMS propres. */
      const isRedundantCoarse = (canon: string) =>
        !limsByCanon.has(canon) && PRIMARY_LITHOLOGY_CANONS.has(canon) && rootsCoveredByGranular.has(canon);

      // Nettoyage : supprimer les domaines coarse parasites déjà persistés, puis
      // les retirer de la liste de travail pour ne pas les ré-updater ensuite.
      // On les reconnaît à : importés + racine couverte par des granulaires + AUCUNE
      // métallurgie LIMS (recovery_design null) — leur sample_count provient du
      // Block Model (n_blocks), donc tester sample_count===0 les manquait.
      const spuriousIds = new Set(
        currentDomains
          .filter(d => d.is_imported && d.recovery_design == null && isRedundantCoarse(canonDomain(d.name)))
          .map(d => d.id),
      );
      for (const id of spuriousIds) {
        await supabase.from('geomet_domains').delete().eq('id', id).eq('project_id', project.id);
      }
      currentDomains = currentDomains.filter(d => !spuriousIds.has(d.id));

      let insertedCount = 0;
      for (const canon of allCanons) {
        // Un parent coarse redondant (lithologie primaire déjà couverte par des
        // domaines granulaires, sans données LIMS propres) ne doit ni être créé ni
        // toucher un domaine : ses blocs appartiennent aux domaines granulaires.
        if (isRedundantCoarse(canon)) continue;
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
    loadReconRows();
    loadVersions();
  }, [loadDomains, loadLimsAggregates, loadBlockModelAggregates, loadReconRows, loadVersions]);

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
  }, [domains, primaryDomains, feedShare, selectedDomainId]);

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
      const bwi = primaryDomains.reduce((s, d) => s + (d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T) * (feedShare.byId[d.id] ?? 1 / nPrimary), 0);
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
   * Optimisation automatique du blend : cherche la répartition d'alimentation qui
   * maximise les onces annuelles à partir des données des domaines (récupération,
   * BWi, preg-robbing), puis l'applique aux curseurs. L'utilisateur peut ensuite
   * l'ajuster et l'enregistrer comme répartition LOM.
   */
  function optimizeBlendAuto() {
    if (primaryDomains.length === 0) return;
    const optDomains: BlendDomain[] = primaryDomains.map(d => ({
      id: d.id,
      recoveryPct: d.recovery_design ?? project.recovery_pct,
      bwiKwhT: d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T,
      pregRobbing: !!d.preg_robbing,
    }));
    // Disponibilité = tonnage de ressource par lithologie coarse (Block Model),
    // réparti sur les sous-domaines granulaires au prorata des échantillons. Sur
    // la vie de la mine on traite tout le gisement : le blend reflète donc sa
    // composition en tonnage — un vrai mélange, pas 100 % du domaine le plus riche.
    const rootTonnage: Record<string, number> = {};
    for (const a of bmAggs) {
      const root = lithologyRoot(a.domain);
      rootTonnage[root] = (rootTonnage[root] ?? 0) + a.n_blocks * (a.avg_density ?? 1);
    }
    const availDomains: AvailabilityDomain[] = primaryDomains.map(d => ({
      id: d.id, root: lithologyRoot(d.name), sampleCount: d.sample_count ?? 0,
    }));
    const shares = availabilityShares(availDomains, rootTonnage);
    const result = blendMetrics(shares, optDomains, {
      targetTph: project.target_tph,
      operatingHours: (project.availability_pct / 100) * hoursPerYear,
      gradeGt: project.gold_grade_g_t,
      troyGrams: TROY,
      ...DEFAULT_BLEND_OPT_PARAMS,
    });
    setBlendSplit(Object.fromEntries(
      primaryDomains.map(d => [d.id, +((result.shares[d.id] ?? 0) * 100).toFixed(1)]),
    ));
    setOptResult(result);
  }

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
        const bwiBase = d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T;
        const bwiRng = ((d.bwi_max ?? bwiBase + 2) - (d.bwi_min ?? bwiBase - 2)) / 2;
        const _bwi = bwiBase + bwiRng * (2 * Math.random() - 1);
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
      return s + pct * (d.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T);
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
  }, [blendedRecovery, project, hoursPerYear]);

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
  }, [predTph, predGrade, predRec, project, hoursPerYear]);

  const predBwi = useMemo(() => {
    const dom = domains.find(d => d.id === selectedDomainId);
    return dom?.avg_bwi_kwh_t ?? DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T;
  }, [domains, selectedDomainId]);

  const predEnergy = useMemo(() => {
    return plantGrindEnergy(predBwi, dcF80, predP80);
  }, [predBwi, predP80, dcF80]);

  // Monte Carlo stats
  const mcP10 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.1 * monteCarlo.length)].oz : null;
  const mcP50 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.5 * monteCarlo.length)].oz : null;
  const mcP90 = monteCarlo.length > 0 ? monteCarlo[Math.floor(0.9 * monteCarlo.length)].oz : null;

  // ── Écran Qualité & couverture ─────────────────────────────────────────────
  // Tonnage par domaine : tonnage Block Model par racine lithologique, réparti
  // sur les sous-domaines au prorata des échantillons — même logique que le blend
  // (availabilityShares), pour que couverture et alimentation restent cohérentes.
  const tonnageByDomain = useMemo(() => {
    const rootTonnage: Record<string, number> = {};
    for (const a of bmAggs) {
      const root = lithologyRoot(a.domain);
      rootTonnage[root] = (rootTonnage[root] ?? 0) + a.n_blocks * (a.avg_density ?? 1);
    }
    const totalT = Object.values(rootTonnage).reduce((s, v) => s + v, 0);
    const avail: AvailabilityDomain[] = domains.map(d => ({
      id: d.id, root: lithologyRoot(d.name), sampleCount: d.sample_count ?? 0,
    }));
    const shares = availabilityShares(avail, rootTonnage);
    const byId: Record<string, number> = {};
    for (const d of domains) byId[d.id] = (shares[d.id] ?? 0) * totalT;
    return { byId, totalT };
  }, [domains, bmAggs]);

  const domainQuality = useMemo(() => {
    const byId: Record<string, ReturnType<typeof domainConfidence>> = {};
    for (const d of domains) {
      byId[d.id] = domainConfidence({
        sampleCount: d.sample_count ?? 0,
        hasRecovery: d.recovery_design != null,
        hasBwi: d.avg_bwi_kwh_t != null,
        recoveryMin: d.recovery_min, recoveryMax: d.recovery_max,
      });
    }
    return byId;
  }, [domains]);

  const coverage = useMemo(() => coverageBreakdown(
    domains.map(d => ({
      tonnage: tonnageByDomain.byId[d.id] ?? 0,
      confidence: domainQuality[d.id]?.confidence ?? 'none',
    })),
  ), [domains, tonnageByDomain, domainQuality]);

  const qaFindings = useMemo<QaFinding[]>(() => {
    const rows: QaDomainRow[] = domains.map(d => ({
      name: d.name, gidCode: d.gid_code, sampleCount: d.sample_count ?? 0,
      hasRecovery: d.recovery_design != null, hasBwi: d.avg_bwi_kwh_t != null,
      hasP80: false,   // aucun P80 recommandé n'est persisté par domaine — on s'appuie sur le BWi
      variability: domainQuality[d.id]?.variability ?? 'undercharacterized',
      tonnage: tonnageByDomain.byId[d.id] ?? null,
    }));
    const mapped = new Set(domains.map(d => canonDomain(d.name)));
    const blockDomains = bmAggs.map(a => ({ canon: a.canon, label: a.domain }));
    return qaChecks(rows, mapped, blockDomains);
  }, [domains, bmAggs, domainQuality, tonnageByDomain]);

  // ── Écran Validation & réconciliation ──────────────────────────────────────
  const reconInput = useMemo<ReconRow[]>(() => reconRows.map(r => ({
    domainName: r.domain_name ?? '—',
    predicted: r.predicted_recovery_pct,
    observed: r.observed_recovery_pct,
    tonnage: r.observed_tonnage,
  })), [reconRows]);
  const reconResults = useMemo(() => evaluateRows(reconInput), [reconInput]);
  const reconSummary = useMemo(() => reconciliationSummary(reconInput), [reconInput]);
  const reconSuggestions = useMemo(() => reconciliationSuggestions(reconInput), [reconInput]);

  async function currentUserEmail(): Promise<string | null> {
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  }

  async function addReconRow() {
    const dom = domains.find(d => d.id === reconForm.domain_id);
    if (reconForm.observed_recovery_pct == null) return;   // l'observé usine est la donnée clé
    setReconSaving(true);
    // Le prédit par défaut est la récupération de conception du domaine choisi.
    const predicted = reconForm.predicted_recovery_pct ?? dom?.recovery_design ?? null;
    const { data, error } = await supabaseDynamic.from('geomet_reconciliation').insert({
      project_id: project.id,
      domain_id: reconForm.domain_id ?? null,
      domain_name: dom?.name ?? reconForm.domain_name ?? null,
      campaign_label: reconForm.campaign_label?.trim() || 'Campagne',
      period_label: reconForm.period_label?.trim() || null,
      predicted_recovery_pct: predicted,
      observed_recovery_pct: reconForm.observed_recovery_pct,
      observed_tonnage: reconForm.observed_tonnage ?? null,
      observed_grade_gt: reconForm.observed_grade_gt ?? null,
      note: reconForm.note?.trim() || null,
    }).select('*').maybeSingle();
    if (!error && data) {
      setReconRows(prev => [data as ReconEntry, ...prev]);
      setReconForm({});
    } else if (error) {
      setSyncError(`Enregistrement de la réconciliation échoué: ${error.message}`);
    }
    setReconSaving(false);
  }

  async function deleteReconRow(id: string) {
    await supabaseDynamic.from('geomet_reconciliation').delete().eq('id', id).eq('project_id', project.id);
    setReconRows(prev => prev.filter(r => r.id !== id));
  }

  // ── Écran Versions du modèle ───────────────────────────────────────────────
  async function createVersion() {
    if (domains.length === 0) return;
    setVersionSaving(true);
    setSyncError('');
    // Récupération pondérée par la part d'alimentation (feed share) des domaines primaires.
    const wRec = primaryDomains.reduce(
      (s, d) => s + (feedShare.byId[d.id] ?? 0) * (d.recovery_design ?? project.recovery_pct), 0,
    );
    // Instantané reproductible : domaines figés + hypothèses de calcul.
    const snapshot = {
      created_at: new Date().toISOString(),
      assumptions: {
        hoursPerYear, dcF80,
        recovery_pct: project.recovery_pct,
        target_tph: project.target_tph,
        gold_grade_g_t: project.gold_grade_g_t,
      },
      domains: domains.map(d => ({
        name: d.name, gid_code: d.gid_code, sample_count: d.sample_count,
        recovery_design: d.recovery_design, recovery_min: d.recovery_min, recovery_max: d.recovery_max,
        avg_grg_pct: d.avg_grg_pct, avg_cil_pct: d.avg_cil_pct, avg_bwi_kwh_t: d.avg_bwi_kwh_t,
        flotation_pct: d.flotation_pct, preg_robbing: d.preg_robbing, lom_pct: d.lom_pct,
      })),
    };
    const label = versionLabel.trim() || `v${versions.length + 1}`;
    const email = await currentUserEmail();
    const { data, error } = await supabaseDynamic.from('geomet_model_version').insert({
      project_id: project.id,
      version_label: label,
      note: versionNote.trim() || null,
      snapshot,
      domain_count: domains.length,
      weighted_recovery_pct: wRec > 0 ? +wRec.toFixed(2) : null,
      weighted_p80_um: null,
      status: 'draft',
      created_by: email,
    }).select('*').maybeSingle();
    if (!error && data) {
      setVersions(prev => [data as ModelVersion, ...prev]);
      setVersionLabel(''); setVersionNote('');
    } else if (error) {
      setSyncError(`Création de la version échouée: ${error.message}`);
    }
    setVersionSaving(false);
  }

  async function publishVersion(v: ModelVersion) {
    const email = await currentUserEmail();
    const { data } = await supabaseDynamic.from('geomet_model_version').update({
      status: 'published', approved_by: email, approved_at: new Date().toISOString(),
    }).eq('id', v.id).eq('project_id', project.id).select('*').maybeSingle();
    if (data) setVersions(prev => prev.map(x => x.id === v.id ? data as ModelVersion : x));
  }

  async function deleteVersion(id: string) {
    const v = versions.find(x => x.id === id);
    const ok = await confirm({
      title: 'Supprimer cette version du modèle ?',
      message: v ? `La version « ${v.version_label} » et son instantané seront supprimés.` : 'Cette version sera supprimée.',
    });
    if (!ok) return;
    await supabaseDynamic.from('geomet_model_version').delete().eq('id', id).eq('project_id', project.id);
    setVersions(prev => prev.filter(x => x.id !== id));
  }

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

      {/* Navigation primaire : 5 sections regroupées */}
      <div className="flex gap-0 border-b mf-border px-4 overflow-x-auto">
        {TAB_GROUPS.map(g => {
          const active = groupForTab(tab) === g.id;
          return (
            <button
              key={g.id} onClick={() => setTab(g.tabs[0])}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                active ? 'border-emerald-400 text-emerald-300' : 'border-transparent mf-txt3 hover:mf-txt'
              }`}
            >
              {g.icon}{g.label}
            </button>
          );
        })}
      </div>

      {/* Navigation secondaire : sous-onglets de la section active (masquée si un seul) */}
      {(() => {
        const group = TAB_GROUPS.find(g => g.id === groupForTab(tab));
        if (!group || group.tabs.length < 2) return null;
        return (
          <div className="flex gap-0 border-b mf-border px-4 overflow-x-auto bg-white/[0.02]">
            {group.tabs.map(id => {
              const t = TABS.find(x => x.id === id)!;
              return (
                <button
                  key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                    tab === t.id ? 'border-emerald-400/70 text-emerald-300' : 'border-transparent mf-txt3 hover:mf-txt'
                  }`}
                >
                  {t.icon}{t.label}
                </button>
              );
            })}
          </div>
        );
      })()}

      <div className="flex-1 overflow-auto p-4">

        {/* ── Domaines ─────────────────────────────────────────────────────── */}
        {tab === 'domains' && <DomainsTab bmAggs={bmAggs} deleteDomain={deleteDomain} domains={domains} importLoading={importLoading} importedCount={importedCount} limsAggs={limsAggs} loading={loading} openCreate={openCreate} openEdit={openEdit} setSyncError={setSyncError} syncAllData={syncAllData} syncError={syncError} />}

        {/* ── Mapping GID ──────────────────────────────────────────────────── */}
        {tab === 'gid' && <GidTab domains={domains} />}

        {/* ── Récupération & prédiction (fusion Grade-Récup. / Variabilité / Prédiction) ─ */}
        {<MetallurgyTab P80_RANGE={P80_RANGE} curveP80={curveP80} dcF80={dcF80} domains={domains} hoursPerYear={hoursPerYear} mcP10={mcP10} mcP50={mcP50} mcP90={mcP90} mcRunning={mcRunning} metalView={metalView} monteCarlo={monteCarlo} predAnnualOz={predAnnualOz} predBwi={predBwi} predEnergy={predEnergy} predGrade={predGrade} predP80={predP80} predRec={predRec} predTph={predTph} project={project} runMonteCarlo={runMonteCarlo} selectedDomainId={selectedDomainId} setCurveP80={setCurveP80} setMetalView={setMetalView} setPredGrade={setPredGrade} setPredP80={setPredP80} setPredTph={setPredTph} setSelectedDomainId={setSelectedDomainId} setVarP80={setVarP80} tab={tab} varP80={varP80} />}

        

        {/* ── Variabilité & Monte Carlo ─────────────────────────────────────── */}
        

        {/* ── Prédiction Métallurgique ──────────────────────────────────────── */}
        

        {/* ── Simulation LOM ───────────────────────────────────────────────── */}
        {tab === 'lomsim' && <LomSimTab domains={domains} lomSimRows={lomSimRows} lomYears={lomYears} setLomSimRows={setLomSimRows} setLomYears={setLomYears} />}

        {/* ── Blend & Optimisation ─────────────────────────────────────────── */}
        {tab === 'blend' && <BlendTab annualOzBlended={annualOzBlended} blendSaved={blendSaved} blendSaving={blendSaving} blendSplit={blendSplit} blendTotal={blendTotal} blendedBwi={blendedBwi} blendedGrg={blendedGrg} blendedRecovery={blendedRecovery} compositeReference={compositeReference} domains={domains} feedShare={feedShare} optResult={optResult} optimizeBlendAuto={optimizeBlendAuto} primaryDomains={primaryDomains} saveBlendToLom={saveBlendToLom} setBlendSplit={setBlendSplit} setOptResult={setOptResult} />}

        {/* ── Graphiques ─────────────────────────────────────────────────────── */}
        {tab === 'graphs' && <GraphsTab domains={domains} mcP10={mcP10} mcP50={mcP50} mcP90={mcP90} monteCarlo={monteCarlo} project={project} />}

        {/* ── Qualité & couverture des données ──────────────────────────────── */}
        {tab === 'quality' && <QualityTab coverage={coverage} domainQuality={domainQuality} domains={domains} qaFindings={qaFindings} tonnageByDomain={tonnageByDomain} />}

        {/* ── Validation & réconciliation ───────────────────────────────────── */}
        {tab === 'validation' && <ValidationTab addReconRow={addReconRow} deleteReconRow={deleteReconRow} domains={domains} reconForm={reconForm} reconResults={reconResults} reconRows={reconRows} reconSaving={reconSaving} reconSuggestions={reconSuggestions} reconSummary={reconSummary} setReconForm={setReconForm} />}

        {/* ── Versions du modèle ────────────────────────────────────────────── */}
        {tab === 'versions' && <VersionsTab createVersion={createVersion} deleteVersion={deleteVersion} domains={domains} publishVersion={publishVersion} setVersionLabel={setVersionLabel} setVersionNote={setVersionNote} versionLabel={versionLabel} versionNote={versionNote} versionSaving={versionSaving} versions={versions} />}
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
