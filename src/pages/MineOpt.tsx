import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Mountain, TrendingUp, Layers, Target,
  CheckCircle2, Save, RefreshCw, Pickaxe, DollarSign, Gauge, RotateCcw,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { useConfirm } from '../components/ui/ConfirmDialog';
import type { Project } from '../types';
import { useProject } from '../lib/ProjectContext';
import { resolveMineParams, type ResolvedMineParams, type ResolvedParam } from '../lib/mine/params';
import { domainCutoffs, blendedCutoff, blendedProperty, throughputForHardness, type DomainMetInputs } from '../lib/mine/cutoff';
import { type Block as PitBlock, type Shell } from '../lib/mine/pitOptimizer';
import { plantGrindEnergy } from '../lib/geomet/p80';
import type { PitWorkerRequest, PitWorkerResponse, PitViz } from '../lib/mine/pitOptimizer.worker';
import {
  disaggregateYear, fleetRequirements, drillBlastPlan, reconcile,
  QUARTER_LABELS, MONTH_LABELS, type FleetSpec, type CalendarConfig,
} from '../lib/mine/planning';
import { isCompositeDomain, canonDomain } from '../lib/geomet/domains';
import { DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import { BmBlockRow, DEFAULT_PARAMS, DesignBench, DesignPit, EquipSchedule, GeomDomainRow, MINE_MODEL, MineParamsRow, MinePhaseRow, PHASE_COLORS, PIT_COLORS, TABS, Tab, buildLOM, buildScenarios } from './mineopt/model';
import { ModelParamsTab } from './mineopt/ModelParamsTab';
import { PitOptimizationTab } from './mineopt/PitOptimizationTab';
import { MineDesignTab } from './mineopt/MineDesignTab';
import { StrategicPlanTab } from './mineopt/StrategicPlanTab';
import { TacticalPlanTab } from './mineopt/TacticalPlanTab';
import { OperationalPlanTab } from './mineopt/OperationalPlanTab';
import { ValueChainTab } from './mineopt/ValueChainTab';
import { ScenariosTab } from './mineopt/ScenariosTab';
import { ReconciliationTab } from './mineopt/ReconciliationTab';

interface MineOptProps { project: Project & { lom_years?: number } }

export function MineOpt({ project }: MineOptProps) {
  const confirm = useConfirm();
  // Every economic input is imported from the module that owns it (see lib/mine/params).
  // Nothing about the ore or the money is invented here.
  const {
    assumptions, effectiveRecoveryPct, globalRecoveryPct,
    totalCapex, totalOpex, capexLines, opexLines,
  } = useProject();
  const hoursPerYear = assumptions.hoursPerYear;
  const annualOreMt = (project.target_tph * (project.availability_pct / 100) * hoursPerYear) / 1e6;

  // GéoMet domains + design criteria: the geometallurgy the cut-off and the
  // hardness-derated throughput are built on.
  const [geomDomains, setGeomDomains] = useState<GeomDomainRow[]>([]);
  const [dcInputs, setDcInputs] = useState<{ f80: number | null; p80: number | null }>({ f80: null, p80: null });

  /**
   * Operating calendar and pattern configuration for the tactical/operational
   * horizons. These have no table of their own, so they live in screen state with
   * documented defaults and are fully editable — nothing here is a silent constant.
   */
  const [cal, setCal] = useState<CalendarConfig>({ daysPerYear: 350, shiftsPerDay: 2, hoursPerShift: 12 });
  const [tacticalYear, setTacticalYear] = useState(1);
  const [seasonality, setSeasonality] = useState<number[]>([1, 1, 1, 1]);
  const [dbCfg, setDbCfg] = useState({
    burdenM: 5, spacingM: 6, subDrillM: 1, powderFactorKgT: 0.25, tonnesPerBlast: 50000,
  });
  /** Machine capacity per equipment type (t/h) — the schedule does not store it. */
  const [fleetCapacity, setFleetCapacity] = useState<Record<string, number>>({});
  /** Availability and utilisation derates applied to nominal capacity. */
  const [fleetDerate, setFleetDerate] = useState({ availabilityPct: 85, utilisationPct: 80 });
  /**
   * Peer benchmarks. Editable rather than baked in: a "$1200/oz peer AISC" ages
   * badly, and the IRR hurdle should follow the project's own cost of capital.
   */
  const [benchmarkOverrides, _setBenchmarkOverrides] = useState<{ aiscUsdOz: number | null; hurdlePct: number | null; strippingRatio: number | null }>({
    aiscUsdOz: null, hurdlePct: null, strippingRatio: null,
  });
  /** Étape 8 — actuals. No table exists for them, so they are entered here. */
  const [actuals, setActuals] = useState({
    mineTonnes: 0, mineGrade: 0, plantTonnes: 0, plantGrade: 0,
  });

  // Block model — the substrate the Lerchs-Grossmann optimisation runs on.
  const [blocks, setBlocks] = useState<PitBlock[]>([]);
  const [blockSize, setBlockSize] = useState({ x: 10, y: 10, z: 10 });
  const [blocksTruncated, setBlocksTruncated] = useState(false);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [blocksLoaded, setBlocksLoaded] = useState(false);
  const [shells, setShells] = useState<Shell[]>([]);
  const [pitViz, setPitViz] = useState<PitViz | null>(null);
  const [optimising, setOptimising] = useState(false);
  const [optimError, setOptimError] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [resetDone, setResetDone] = useState(false);
  const [optimProgress, setOptimProgress] = useState({ done: 0, total: 0 });
  const [edgeCount, setEdgeCount] = useState(0);
  const workerRef = useRef<Worker | null>(null);

  // A solve outliving its page would keep burning a core in the background.
  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const [activeTab, setActiveTab] = useState<Tab>('1 · Optimisation fosse');
  const [params, setParams] = useState<MineParamsRow | null>(null);
  const [phases, setPhases] = useState<MinePhaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState('base');
  const [_showPhaseForm, setShowPhaseForm] = useState(false);
  const [phaseForm, setPhaseForm] = useState<Partial<MinePhaseRow>>({});
  const [sensitivityParam, setSensitivityParam] = useState<'gold_price' | 'stripping' | 'grade' | 'opex' | 'recovery'>('gold_price');

  // Plan d'Exploitation state
  const [designPits, setDesignPits] = useState<DesignPit[]>([]);
  const [designBenches, setDesignBenches] = useState<DesignBench[]>([]);
  const [equipSchedule, setEquipSchedule] = useState<EquipSchedule[]>([]);
  const [selectedPitId, setSelectedPitId] = useState<string | null>(null);
  const [showPitForm, setShowPitForm] = useState(false);
  const [pitForm, setPitForm] = useState<Partial<DesignPit>>({});
  const [showBenchForm, setShowBenchForm] = useState(false);
  const [benchForm, setBenchForm] = useState<Partial<DesignBench>>({});
  const [showEquipForm, setShowEquipForm] = useState(false);
  const [equipForm, setEquipForm] = useState<Partial<EquipSchedule>>({});
  const [designTab, setDesignTab] = useState<'pits' | 'benches' | 'equipment' | 'plan' | '3d'>('pits');
  const [designSaving, setDesignSaving] = useState(false);

  /**
   * Load the block model for the pit optimisation.
   *
   * PostgREST caps a response at ~1000 rows, so this pages. The optimiser is a
   * min-cut over the whole model and runs in the browser, hence the hard ceiling:
   * past it the model is truncated and the UI says so, rather than quietly
   * optimising a fraction of the deposit and reporting it as the ultimate pit.
   */
  const loadBlockModel = useCallback(async (): Promise<PitBlock[]> => {
    const BATCH = 1000;
    const out: PitBlock[] = [];
    let from = 0;
    let truncated = false;
    setBlocksLoading(true);

    for (;;) {
      const { data, error } = await supabase
        .from('bm_blocks')
        .select('i,j,k,cz,au_g_t,density,volume_m3,rock_type')
        .eq('project_id', project.id)
        .order('id')
        .range(from, from + BATCH - 1);
      if (error || !data || data.length === 0) break;
      for (const b of data as BmBlockRow[]) {
        out.push({
          i: b.i, j: b.j, k: b.k, cz: Number(b.cz),
          auGt: Number(b.au_g_t), density: Number(b.density),
          volumeM3: Number(b.volume_m3),
          canon: canonDomain(b.rock_type),
        });
      }
      if (data.length < BATCH) break;
      if (out.length >= MINE_MODEL.MAX_BLOCKS_OPTIMISED) { truncated = true; break; }
      from += BATCH;
    }

    setBlocks(out);
    setBlocksTruncated(truncated);

    // Block dimensions from the model's own geometry: the cone template needs the
    // real spacing, and assuming a cubic 10 m block would silently mis-shape the pit.
    if (out.length > 1) {
      const side = Math.cbrt(out[0].volumeM3);
      const dz = (() => {
        const zs = [...new Set(out.map(b => b.k))].sort((a, b) => a - b);
        if (zs.length < 2) return side;
        const byK = new Map<number, number>();
        for (const b of out) if (!byK.has(b.k)) byK.set(b.k, b.cz);
        const a = byK.get(zs[0]), c = byK.get(zs[1]);
        return a != null && c != null ? Math.abs(c - a) : side;
      })();
      setBlockSize({ x: side, y: side, z: dz });
    }

    setBlocksLoading(false);
    setBlocksLoaded(true);
    return out;
  }, [project.id]);

  /** Load the block model only when étape 1 is actually opened. */
  useEffect(() => {
    if (activeTab === '1 · Optimisation fosse' && !blocksLoaded && !blocksLoading) {
      void loadBlockModel();
    }
  }, [activeTab, blocksLoaded, blocksLoading, loadBlockModel]);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, phRes, pitsRes, benchRes, equipRes, geomRes, dcRes] = await Promise.all([
      supabase.from('mine_params').select('*').eq('project_id', project.id).maybeSingle(),
      supabase.from('mine_phases').select('*').eq('project_id', project.id).order('year_start'),
      supabase.from('mine_design_pits').select('*').eq('project_id', project.id).order('sequence_order'),
      supabase.from('mine_design_benches').select('*').eq('project_id', project.id).order('bench_rl', { ascending: false }),
      supabase.from('mine_design_equipment_schedule').select('*').eq('project_id', project.id).order('year'),
      supabase.from('geomet_domains').select('name,avg_bwi_kwh_t,recovery_design,lom_pct').eq('project_id', project.id),
      supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle(),
    ]);
    setParams(pRes.data as MineParamsRow | null);
    setGeomDomains((geomRes.data ?? []) as GeomDomainRow[]);
    // The block model is deliberately NOT awaited here: it pages through tens of
    // thousands of rows and would hold the whole module on a spinner. Only étape 1
    // needs it, so it loads on demand.
    const dcInp = (dcRes.data?.content as { inputs?: Record<string, number> } | undefined)?.inputs;
    setDcInputs({
      f80: typeof dcInp?.f80_crush === 'number' ? dcInp.f80_crush : null,
      p80: typeof dcInp?.p80_grind === 'number' ? dcInp.p80_grind : null,
    });
    setPhases((phRes.data ?? []) as unknown as MinePhaseRow[]);
    setDesignPits((pitsRes.data ?? []) as DesignPit[]);
    setDesignBenches((benchRes.data ?? []) as DesignBench[]);
    setEquipSchedule((equipRes.data ?? []) as EquipSchedule[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  async function saveParams() {
    if (!params) return;
    setSaving(true);
    await supabase.from('mine_params').upsert({ ...params, project_id: project.id } as never, { onConflict: 'project_id' });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  /**
   * Re-align the plan on the modules that own its numbers.
   *
   * When the module is first initialised, mine_params is seeded with placeholders
   * (20 Mt, 2.5 g/t, 28 $/t…). Those columns are nullable precisely so null can
   * mean "follow the source" — but a seeded value looks exactly like a deliberate
   * override, so the placeholder silently outranks the project's real grade and
   * Économie's real OPEX, for the life of the project.
   *
   * This clears them. Genuinely mine-owned parameters (talus, ratio de décapage,
   * coût minier, G&A, dilution, banc) are NOT touched: no other module owns them.
   */
  async function resetParamsToModules() {
    if (!params) return;
    setSaving(true);
    setShowReset(false);
    const patch: Partial<MineParamsRow> = {
      grade_g_t: null,          // → Projet
      process_cost_t: null,     // → Économie (OPEX)
      cutoff_g_t: null,         // → coupure géométallurgique calculée
      lom_years: null,          // → réserves ÷ débit
      // sustaining_capex_m is NOT NULL in the schema and already ignored by
      // resolveMineParams (derived from CAPEX), so it is not nulled here.
    };
    // Reserves come from the optimised pit once étape 1 has run; otherwise the
    // existing figure is left alone rather than replaced by another guess.
    if (ultimatePit && ultimatePit.result.oreTonnes > 0) {
      patch.reserves_mt = +(ultimatePit.result.oreTonnes / 1e6).toFixed(2);
    }
    const next = { ...params, ...patch };
    const { error } = await supabase.from('mine_params')
      .upsert({ ...next, project_id: project.id } as never, { onConflict: 'project_id' });
    if (!error) {
      setParams(next);
      setResetDone(true);
      setTimeout(() => setResetDone(false), 3000);
    }
    setSaving(false);
  }

  async function initParams() {
    setSaving(true);
    setSaveError('');
    const { data, error } = await supabase
      .from('mine_params')
      .insert({ ...DEFAULT_PARAMS, project_id: project.id } as never)
      .select('*')
      .maybeSingle();
    // Surface the failure instead of leaving the button silently doing nothing.
    if (error) setSaveError(`Initialisation échouée : ${error.message}`);
    else if (data) setParams(data as MineParamsRow);
    setSaving(false);
  }

  function upd<K extends keyof MineParamsRow>(key: K, val: MineParamsRow[K]) {
    setParams(prev => prev ? { ...prev, [key]: val } : null);
  }

  async function _addPhase() {
    if (!phaseForm.phase_name) return;
    const { data } = await supabase.from('mine_phases').insert({
      project_id: project.id,
      phase_name: phaseForm.phase_name ?? 'Phase',
      year_start: phaseForm.year_start ?? 1,
      year_end: phaseForm.year_end ?? 3,
      zone: phaseForm.zone ?? '',
      ore_type: phaseForm.ore_type ?? '',
      grade_g_t: phaseForm.grade_g_t ?? 0,
      ore_mt: phaseForm.ore_mt ?? 0,
      waste_mt: phaseForm.waste_mt ?? 0,
      color: PHASE_COLORS[phases.length % PHASE_COLORS.length],
    } as never).select('*').maybeSingle();
    if (data) setPhases(prev => [...prev, data as unknown as MinePhaseRow]);
    setShowPhaseForm(false); setPhaseForm({});
  }

  async function _deletePhase(id: string) {
    const ok = await confirm({ title: 'Supprimer cette phase minière ?', message: 'Cette phase du plan d’exploitation sera supprimée.' });
    if (!ok) return;
    await supabase.from('mine_phases').delete().eq('id', id).eq('project_id', project.id);
    setPhases(prev => prev.filter(p => p.id !== id));
  }

  // ── Plan d'Exploitation CRUD ──────────────────────────────────────────────

  async function addDesignPit() {
    if (!pitForm.name?.trim()) return;
    setDesignSaving(true);
    const { data } = await supabase.from('mine_design_pits').insert({
      project_id: project.id,
      name: pitForm.name,
      pit_type: pitForm.pit_type ?? 'open_pit',
      crest_rl: pitForm.crest_rl ?? null,
      floor_rl: pitForm.floor_rl ?? null,
      bench_height_m: pitForm.bench_height_m ?? params?.bench_height_m ?? 10,
      berm_width_m: pitForm.berm_width_m ?? 8,
      slope_angle_deg: pitForm.slope_angle_deg ?? params?.slope_angle_deg ?? 45,
      ore_mt: pitForm.ore_mt ?? 0,
      waste_mt: pitForm.waste_mt ?? 0,
      grade_g_t: pitForm.grade_g_t ?? params?.grade_g_t ?? 0,
      status: pitForm.status ?? 'planned',
      sequence_order: designPits.length + 1,
      color: PIT_COLORS[designPits.length % PIT_COLORS.length],
      notes: pitForm.notes ?? null,
    }).select('*').maybeSingle();
    if (data) setDesignPits(prev => [...prev, data as DesignPit]);
    setDesignSaving(false);
    setShowPitForm(false);
    setPitForm({});
  }

  async function updateDesignPit(id: string, patch: Partial<DesignPit>) {
    await supabase.from('mine_design_pits').update(patch).eq('id', id).eq('project_id', project.id);
    setDesignPits(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  }

  async function deleteDesignPit(id: string) {
    const ok = await confirm({ title: 'Supprimer cette fosse ?', message: 'Cette fosse et sa conception seront supprimées.' });
    if (!ok) return;
    await supabase.from('mine_design_pits').delete().eq('id', id).eq('project_id', project.id);
    setDesignPits(prev => prev.filter(p => p.id !== id));
    if (selectedPitId === id) setSelectedPitId(null);
  }

  async function addDesignBench() {
    if (benchForm.bench_rl == null) return;
    setDesignSaving(true);
    const { data } = await supabase.from('mine_design_benches').insert({
      project_id: project.id,
      pit_id: selectedPitId,
      bench_rl: benchForm.bench_rl,
      ore_mt: benchForm.ore_mt ?? 0,
      waste_mt: benchForm.waste_mt ?? 0,
      grade_g_t: benchForm.grade_g_t ?? 0,
      width_m: benchForm.width_m ?? null,
      length_m: benchForm.length_m ?? null,
      blast_pattern: benchForm.blast_pattern ?? '4x4',
      explosive_type: benchForm.explosive_type ?? 'ANFO',
      powder_factor: benchForm.powder_factor ?? 0.35,
      ore_type: benchForm.ore_type ?? null,
      domain: benchForm.domain ?? null,
      notes: benchForm.notes ?? null,
    }).select('*').maybeSingle();
    if (data) setDesignBenches(prev => [...prev, data as DesignBench].sort((a, b) => b.bench_rl - a.bench_rl));
    setDesignSaving(false);
    setShowBenchForm(false);
    setBenchForm({});
  }

  async function deleteDesignBench(id: string) {
    const ok = await confirm({ title: 'Supprimer ce gradin ?', message: 'Ce gradin sera supprimé de la conception.' });
    if (!ok) return;
    await supabase.from('mine_design_benches').delete().eq('id', id).eq('project_id', project.id);
    setDesignBenches(prev => prev.filter(b => b.id !== id));
  }

  async function addEquipSchedule() {
    if (!equipForm.equipment_name?.trim() || !equipForm.year) return;
    setDesignSaving(true);
    const { data } = await supabase.from('mine_design_equipment_schedule').insert({
      project_id: project.id,
      pit_id: selectedPitId,
      year: equipForm.year,
      equipment_type: equipForm.equipment_type ?? 'Camion',
      equipment_name: equipForm.equipment_name,
      quantity: equipForm.quantity ?? 1,
      hours_year: equipForm.hours_year ?? 6000,
      cost_h: equipForm.cost_h ?? 0,
      notes: equipForm.notes ?? null,
    }).select('*').maybeSingle();
    if (data) setEquipSchedule(prev => [...prev, data as EquipSchedule]);
    setDesignSaving(false);
    setShowEquipForm(false);
    setEquipForm({});
  }

  async function deleteEquipSchedule(id: string) {
    const ok = await confirm({ title: 'Supprimer cette ligne d’équipement ?', message: 'Cette entrée du calendrier d’équipement sera supprimée.' });
    if (!ok) return;
    await supabase.from('mine_design_equipment_schedule').delete().eq('id', id).eq('project_id', project.id);
    setEquipSchedule(prev => prev.filter(e => e.id !== id));
  }

  const p = params;

  // ── Imported inputs ────────────────────────────────────────────────────────
  // Every economic figure below is resolved from its owning module, with any
  // value typed into this page layered on top as an explicit override.
  const mine: ResolvedMineParams = useMemo(() => resolveMineParams({
    goldGradeGt: project.gold_grade_g_t,
    goldPriceUsdOz: project.gold_price_usd,
    targetTph: project.target_tph,
    availabilityPct: project.availability_pct,
    effectiveRecoveryPct,
    recoveryFromTestwork: globalRecoveryPct != null,
    discountRate: assumptions.discountRate,
    royaltyFraction: assumptions.royaltyFraction,
    lomYears: assumptions.lomYears,
    hoursPerYear,
    totalCapexMusd: totalCapex,
    totalOpexUsdT: totalOpex,
    opexLineCount: opexLines.length,
    capexLineCount: capexLines.length,
    f80Um: dcInputs.f80,
    p80Um: dcInputs.p80,
  }, p ?? {}), [project, effectiveRecoveryPct, globalRecoveryPct, assumptions, hoursPerYear, totalCapex, totalOpex, opexLines.length, capexLines.length, dcInputs, p]);

  /**
   * Geometallurgy per primary domain, imported from GéoMet.
   * Composites ("mixte") are excluded — they are the blend of the others, so
   * giving one its own feed share would count the same ore twice.
   */
  const metDomains: DomainMetInputs[] = useMemo(() => {
    const primary = geomDomains.filter(d => !isCompositeDomain(d.name));
    const lomTotal = primary.reduce((s, d) => s + (d.lom_pct ?? 0), 0);
    return primary.map(d => ({
      canon: canonDomain(d.name),
      label: d.name,
      recoveryPct: d.recovery_design ?? effectiveRecoveryPct,
      bwiKwhT: d.avg_bwi_kwh_t ?? 15.5,
      feedShare: lomTotal > 0 ? (d.lom_pct ?? 0) / lomTotal : (primary.length ? 1 / primary.length : 0),
    }));
  }, [geomDomains, effectiveRecoveryPct]);

  const feedFromLom = useMemo(
    () => geomDomains.filter(d => !isCompositeDomain(d.name)).some(d => (d.lom_pct ?? 0) > 0),
    [geomDomains],
  );

  /** Blended BWi across the feed — the hardness the mill actually sees. */
  const blendedBwi = useMemo(() => blendedProperty(metDomains, d => d.bwiKwhT), [metDomains]);

  /** Per-domain mine-to-mill cut-off grades. */
  const cutoffs = useMemo(() => domainCutoffs(metDomains, {
    goldPriceUsdOz: mine.goldPriceUsdOz.value,
    // The OPEX from Économie already covers the plant; grinding energy is priced
    // per domain on top, so it must not be double-counted in the base cost. Uses
    // PLANT energy (lab × plant factor × EF5) so the subtraction matches what
    // domainCutoffs adds back — otherwise the base cost would be off.
    processCostExGrindUsdT: Math.max(0, mine.processCostUsdT.value - (blendedBwi != null
      ? plantGrindEnergy(blendedBwi, mine.f80Um.value, mine.p80Um.value) * DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH
      : 0)),
    miningCostUsdT: p?.mining_cost_t ?? 0,
    strippingRatio: p?.stripping_ratio ?? 0,
    gaCostUsdT: annualOreMt > 0 ? (p?.ga_cost_m ?? 0) / annualOreMt : 0,
    royaltyFraction: mine.royaltyPct.value / 100,
    elecCostUsdKwh: DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH,
    f80Um: mine.f80Um.value,
    p80Um: mine.p80Um.value,
  }), [metDomains, mine, p, annualOreMt, blendedBwi]);

  const blendedMarginalCutoff = useMemo(() => blendedCutoff(cutoffs, 'marginalCutoffGt'), [cutoffs]);
  const blendedBreakevenCutoff = useMemo(() => blendedCutoff(cutoffs, 'breakevenCutoffGt'), [cutoffs]);

  /**
   * Throughput the blend hardness actually allows. A comminution circuit is
   * power-limited: harder feed means fewer tonnes through the same installed kW.
   * Conventional schedules hold tph at nameplate regardless of what is fed.
   */
  const deratedTph = useMemo(() => {
    if (blendedBwi == null || !metDomains.length) return null;
    const softest = Math.min(...metDomains.map(d => d.bwiKwhT));
    return throughputForHardness(project.target_tph, softest, blendedBwi, mine.f80Um.value, mine.p80Um.value);
  }, [blendedBwi, metDomains, project.target_tph, mine]);
  const lom = useMemo(() => p ? buildLOM(project, p, phases, hoursPerYear, mine, deratedTph) : [], [project, p, phases, hoursPerYear, mine, deratedTph]);
  const scenarios = useMemo(() => p ? buildScenarios(project, p, hoursPerYear, mine, deratedTph) : [], [project, p, hoursPerYear, mine, deratedTph]);
  const chosen = scenarios.find(s => s.id === selectedScenario) ?? scenarios[0];
  const lom_years = p?.lom_years ?? project.lom_years ?? (p ? Math.max(1, Math.ceil(p.reserves_mt / Math.max(0.01, annualOreMt))) : assumptions.lomYears);

  const totalOz = lom.reduce((s, y) => s + y.oz_k, 0);
  const totalRev = lom.reduce((s, y) => s + y.rev_m, 0);
  const totalFcf = lom.reduce((s, y) => s + y.fcf_m, 0);
  const peakOz = lom.length ? Math.max(...lom.map(y => y.oz_k)) : 0;
  const avgAisc = lom.length ? lom.reduce((s, y) => s + y.aisc, 0) / lom.length : 0;

  /* Sensitivity sweep */
  const sensitivityRows = useMemo(() => {
    if (!p) return [];
    const deltas = [-20, -15, -10, -5, 0, +5, +10, +15, +20];
    return deltas.map(pct => {
      const factor = 1 + pct / 100;
      // Perturb the RESOLVED values, not the raw columns: those may be null
      // (meaning "follow the owning module"), so scaling them would scale nothing.
      const scale = (par: ResolvedParam) => ({ ...par, value: par.value * factor });
      const sMine: ResolvedMineParams = {
        ...mine,
        ...(sensitivityParam === 'gold_price' ? { goldPriceUsdOz: scale(mine.goldPriceUsdOz) } : {}),
        ...(sensitivityParam === 'grade' ? { goldGradeGt: scale(mine.goldGradeGt) } : {}),
        ...(sensitivityParam === 'opex' ? { processCostUsdT: scale(mine.processCostUsdT) } : {}),
        ...(sensitivityParam === 'recovery'
          ? { metRecoveryPct: { ...mine.metRecoveryPct, value: Math.min(100, mine.metRecoveryPct.value * factor) } }
          : {}),
      };
      const sParams: MineParamsRow = {
        ...p,
        ...(sensitivityParam === 'stripping' ? { stripping_ratio: p.stripping_ratio * factor } : {}),
        ...(sensitivityParam === 'opex' ? { mining_cost_t: p.mining_cost_t * factor } : {}),
      };
      const scenarios_local = buildScenarios(project, sParams, hoursPerYear, sMine, deratedTph);
      const base = scenarios_local.find(s => s.id === 'base');
      return { pct, npv: base?.npv_musd ?? 0, irr: base?.irr_pct ?? null, aisc: base?.aisc ?? 0 };
    });
  }, [p, project, sensitivityParam, hoursPerYear, mine, deratedTph]);

  /**
   * Étape 1 — nested pit shells by Lerchs-Grossmann on the real block model.
   *
   * This replaces a fabricated reserves-vs-price curve (reserves × factor^0.72),
   * which produced a smooth line no deposit has ever followed. Each shell here is
   * an actual maximum-weight closure of the block precedence graph.
   */
  /**
   * Run the optimisation. Explicitly triggered, never automatic.
   *
   * Nine max-flow solves over the whole block model is heavy, synchronous work.
   * Running it from a useMemo froze the tab on every input change; the engineer
   * now chooses when to pay for it, and the result is kept until they re-run.
   */
  async function runPitOptimisation() {
    if (!p) return;
    setOptimising(true);
    setOptimError('');
    setOptimProgress({ done: 0, total: MINE_MODEL.SHELL_REVENUE_FACTORS.length });
    try {
      const loaded = blocks.length ? blocks : await loadBlockModel();
      if (!loaded.length) { setOptimising(false); return; }

      const domainEcon: Record<string, { recoveryPct: number; bwiKwhT: number }> = {};
      for (const d of metDomains) domainEcon[d.canon] = { recoveryPct: d.recoveryPct, bwiKwhT: d.bwiKwhT };

      // Plant energy (not lab) so the pit valuation prices grinding the same way
      // as the cut-off and Granulométrie.
      const grindKwhT = blendedBwi != null
        ? plantGrindEnergy(blendedBwi, mine.f80Um.value, mine.p80Um.value)
        : 0;

      // Off the UI thread: the solve is irreducibly heavy and used to lock the tab
      // ("Page ne répondant pas"). The worker keeps the page alive and reports
      // progress shell by shell.
      const worker = new Worker(new URL('../lib/mine/pitOptimizer.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current?.terminate();
      workerRef.current = worker;

      const res = await new Promise<{ shells: Shell[]; viz: PitViz | null }>((resolve, reject) => {
        worker.onmessage = (ev: MessageEvent<PitWorkerResponse>) => {
          const m = ev.data;
          if (m.type === 'progress') setOptimProgress({ done: m.done, total: m.total });
          else if (m.type === 'done') { setEdgeCount(m.edgesPerShell); resolve({ shells: m.shells, viz: m.viz }); }
          else reject(new Error(m.message));
        };
        worker.onerror = () => reject(new Error('Le calcul d\'optimisation a échoué.'));
        const req: PitWorkerRequest = {
          blocks: loaded,
          inputs: {
            goldPriceUsdOz: mine.goldPriceUsdOz.value,
            processCostExGrindUsdT: Math.max(0, mine.processCostUsdT.value - grindKwhT * DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH),
            miningCostUsdT: p.mining_cost_t,
            gaCostUsdT: annualOreMt > 0 ? p.ga_cost_m / annualOreMt : 0,
            royaltyFraction: mine.royaltyPct.value / 100,
            elecCostUsdKwh: DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH,
            f80Um: mine.f80Um.value,
            p80Um: mine.p80Um.value,
            domains: domainEcon,
            fallback: { recoveryPct: effectiveRecoveryPct, bwiKwhT: blendedBwi ?? 15.5 },
          },
          slopeAngleDeg: p.slope_angle_deg,
          blockSizeX: blockSize.x,
          blockSizeY: blockSize.y,
          benchHeight: p.bench_height_m,
          coneLevels: MINE_MODEL.CONE_LEVELS,
          revenueFactors: [...MINE_MODEL.SHELL_REVENUE_FACTORS],
        };
        worker.postMessage(req);
      });

      worker.terminate();
      workerRef.current = null;
      setShells(res.shells);
      setPitViz(res.viz);
    } catch (e: unknown) {
      setOptimError(e instanceof Error ? e.message : 'Erreur pendant l\'optimisation.');
    }
    setOptimising(false);
  }

  /** Stop a running solve — a long optimisation must be abandonable. */
  function cancelOptimisation() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setOptimising(false);
    setOptimError('Optimisation annulée.');
  }

  /** The ultimate pit = the shell at the project's own gold price (factor 1.0). */
  const ultimatePit = useMemo(
    () => shells.find(s => Math.abs(s.revenueFactor - 1) < 1e-9) ?? shells[shells.length - 1] ?? null,
    [shells],
  );

  // ── Étapes 4 & 5 — disaggregation of the strategic plan ────────────────────
  // Derived, never stored: a tactical plan that can drift from the annual plan it
  // belongs to is a reconciliation problem manufactured in advance.
  const planYear = useMemo(() => lom.find(y => y.year === tacticalYear) ?? lom[0] ?? null, [lom, tacticalYear]);

  const quarters = useMemo(
    () => (planYear ? disaggregateYear(planYear, 4, QUARTER_LABELS, cal, seasonality) : []),
    [planYear, cal, seasonality],
  );
  const months = useMemo(
    () => (planYear ? disaggregateYear(planYear, 12, MONTH_LABELS, cal) : []),
    [planYear, cal],
  );

  /**
   * Fleet specs from the equipment schedule (étape 2).
   *
   * The schedule stores units and hours/year but no machine capacity, so rather
   * than inventing a t/h the capacity is entered here per equipment type and the
   * *implied* requirement is shown beside it — the plan's tonnage divided by the
   * hours the schedule actually commits. An engineer compares that to the real
   * machine; nothing is assumed on their behalf.
   */
  const fleetSpecs: FleetSpec[] = useMemo(() => {
    const forYear = equipSchedule.filter(e => e.year === tacticalYear);
    return forYear.map(e => ({
      equipment: `${e.equipment_type} — ${e.equipment_name}`,
      nominalTph: fleetCapacity[e.equipment_type] ?? 0,
      availabilityPct: fleetDerate.availabilityPct,
      utilisationPct: fleetDerate.utilisationPct,
      unitsAvailable: e.quantity,
    }));
  }, [equipSchedule, tacticalYear, fleetCapacity, fleetDerate]);

  const fleetForQuarter = useMemo(
    () => (quarters[0] ? fleetRequirements(quarters[0], cal, fleetSpecs) : []),
    [quarters, cal, fleetSpecs],
  );

  /** t/h each unit must sustain to deliver the year, given the hours committed. */
  const impliedCapacity = useMemo(() => {
    if (!planYear) return [];
    const totalT = (planYear.ore + planYear.waste) * 1e6;
    return equipSchedule.filter(e => e.year === tacticalYear).map(e => {
      const committedHours = e.quantity * e.hours_year;
      return {
        equipment: `${e.equipment_type} — ${e.equipment_name}`,
        units: e.quantity,
        hoursYear: e.hours_year,
        impliedTph: committedHours > 0 ? totalT / committedHours : 0,
        annualCostM: (e.quantity * e.hours_year * e.cost_h) / 1e6,
      };
    });
  }, [equipSchedule, tacticalYear, planYear]);

  /** Weekly and daily plans — the operational horizon, from the same month. */
  const currentMonth = months[0] ?? null;
  const weekly = useMemo(() => {
    if (!currentMonth) return null;
    const weeks = currentMonth.days / 7;
    return weeks > 0 ? { oreMt: currentMonth.oreMt / weeks, wasteMt: currentMonth.wasteMt / weeks, totalMt: currentMonth.totalMt / weeks } : null;
  }, [currentMonth]);
  const daily = useMemo(() => {
    if (!currentMonth || currentMonth.days <= 0) return null;
    return {
      oreMt: currentMonth.oreMt / currentMonth.days,
      wasteMt: currentMonth.wasteMt / currentMonth.days,
      totalMt: currentMonth.totalMt / currentMonth.days,
    };
  }, [currentMonth]);

  const blastPlan = useMemo(() => {
    if (!daily || !p) return null;
    // Density comes from the block model where available — not assumed.
    const density = blocks.length ? blocks[0].density : DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3;
    return drillBlastPlan(daily.totalMt * 1e6, {
      ...dbCfg, benchHeightM: p.bench_height_m, rockDensity: density,
    });
  }, [daily, p, dbCfg, blocks]);

  // ── Étape 8 — réconciliation ───────────────────────────────────────────────
  const reconciliation = useMemo(() => {
    if (!planYear) return null;
    return reconcile(
      { tonnes: planYear.ore * 1e6, gradeGt: planYear.grade },
      { tonnes: actuals.mineTonnes, gradeGt: actuals.mineGrade },
      { tonnes: actuals.plantTonnes, gradeGt: actuals.plantGrade },
    );
  }, [planYear, actuals]);

  const hasActuals = actuals.mineTonnes > 0 || actuals.plantTonnes > 0;

  /**
   * Where the reserves figure comes from.
   *
   * `mine_params.reserves_mt` is seeded at 20 Mt when the module is initialised —
   * a placeholder, not an estimate. Once étape 1 has run, the optimised pit is the
   * authority; until then the number is labelled as manual so it cannot pass for a
   * result.
   */
  const reservesOrigin = useMemo(() => {
    if (!ultimatePit || ultimatePit.result.oreTonnes <= 0) return 'saisie manuelle';
    const optMt = ultimatePit.result.oreTonnes / 1e6;
    const matches = p?.reserves_mt != null && Math.abs(p.reserves_mt - optMt) / optMt <= 0.1;
    return matches ? 'fosse optimisée (étape 1)' : 'saisie manuelle ≠ fosse optimisée';
  }, [ultimatePit, p]);

  /** Benchmarks: overridable, otherwise derived from the project's own economics. */
  const benchmarks = useMemo(() => ({
    // Sub-60 % of the gold price is the conventional read of a healthy AISC margin.
    aiscUsdOz: benchmarkOverrides.aiscUsdOz ?? Math.round(mine.goldPriceUsdOz.value * 0.6),
    // Clearing the project's discount rate is the meaningful hurdle.
    hurdlePct: benchmarkOverrides.hurdlePct ?? Math.round(mine.discountRatePct.value),
    strippingRatio: benchmarkOverrides.strippingRatio ?? 6,
  }), [benchmarkOverrides, mine]);

  const _maxShellTonnes = shells.length
    ? Math.max(...shells.map(s => s.result.oreTonnes + s.result.wasteTonnes), 1)
    : 1;
  const maxOz = lom.length ? Math.max(...lom.map(y => y.oz_k), 1) : 1;
  const maxRev = lom.length ? Math.max(...lom.map(y => y.rev_m), 1) : 1;

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="text-xs mf-txt3">Chargement…</div></div>;
  }

  if (!params) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          icon={<Pickaxe size={20} />}
          title="Mine & Optimisation"
          subtitle={`Modélisation · Planification · Optimisation minière — ${project.name}`}
          breadcrumb={['Optimisation', 'Mine & Opt.']}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 flex items-center justify-center">
            <Mountain size={40} className="text-amber-400" />
          </div>
          <div className="text-center max-w-md">
            <div className="text-base font-semibold mf-txt mb-2">Aucun paramètre minier configuré</div>
            <div className="text-sm mf-txt4 leading-relaxed">
              Initialisez les paramètres du plan minier pour accéder au plan LOM, optimisation pit shell,
              séquençage des phases, modèles économiques et analyse de risques.
            </div>
          </div>
          <button
            onClick={initParams} disabled={saving}
            className="btn bg-amber-400 text-gray-900 hover:bg-amber-300 font-semibold flex items-center gap-2 px-6 py-2.5 shadow-lg shadow-amber-400/20"
          >
            <Pickaxe size={15} /> {saving ? 'Initialisation…' : 'Initialiser les paramètres miniers'}
          </button>
          {saveError && (
            <div className="max-w-md text-center text-xs text-red-400 bg-red-400/8 border border-red-400/20 rounded-md px-3 py-2">
              {saveError}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<Pickaxe size={20} />}
        title="Mine & Optimisation"
        subtitle={`Modélisation LOM · Pit Shell · Séquençage · Analyse économique — ${project.name}`}
        breadcrumb={['Optimisation', 'Mine & Opt.']}
        actions={
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Sauvegardé</span>}
            {resetDone && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Réinitialisé</span>}
            <button onClick={load} className="btn btn-secondary p-1.5" title="Recharger depuis la base"><RefreshCw size={13} /></button>
            <button onClick={() => setShowReset(true)} disabled={saving}
              className="btn btn-secondary flex items-center gap-1.5 text-xs" title="Réaligner les hypothèses sur les modules qui les possèdent">
              <RotateCcw size={12} /> Réinitialiser
            </button>
            <button onClick={saveParams} disabled={saving} className="btn bg-amber-400 text-gray-900 hover:bg-amber-300 font-semibold flex items-center gap-1.5 text-xs">
              <Save size={12} /> {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="px-4 py-3 border-b border-mf-border grid grid-cols-6 gap-3">
        {[
          // Reads the RESOLVED grade, not params.grade_g_t: that column is seeded at
          // 2.5 g/t when the module is initialised and silently outranked the project's
          // own feed grade. The sub-line names where each figure comes from.
          {
            label: 'Réserves',
            val: `${params.reserves_mt} Mt`,
            sub: `@ ${formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t · ${reservesOrigin}`,
            color: 'text-amber-400', icon: Mountain,
          },
          { label: 'Production tot.', val: `${formatDecimalGrouped(totalOz, 0)} koz`,          sub: `LOM ${lom_years} ans`,                  color: 'text-emerald-400', icon: Target },
          { label: 'VAN₁₀',          val: chosen ? `${formatDecimalGrouped(chosen.npv_musd, 0)} M$` : '—', sub: chosen?.irr_pct != null ? `TRI ~${formatDecimalGrouped(chosen.irr_pct, 1)}%` : 'TRI —', color: (chosen?.npv_musd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400', icon: TrendingUp },
          { label: 'FCF total',      val: `${formatDecimalGrouped(totalFcf, 0)} M$`,           sub: `Rev. ${formatDecimalGrouped(totalRev, 0)} M$`,         color: totalFcf >= 0 ? 'text-emerald-400' : 'text-red-400', icon: DollarSign },
          { label: 'AISC moyen',     val: `$${formatDecimalGrouped(avgAisc, 0)}/oz`,           sub: `RS = ${params.stripping_ratio}:1`,       color: 'text-sky-400',     icon: Gauge },
          { label: 'CoG actuel', val: params.cutoff_g_t != null ? `${params.cutoff_g_t} g/t` : (blendedBreakevenCutoff != null ? `${formatDecimalGrouped(blendedBreakevenCutoff, 2)} g/t` : '—'), sub: params.cutoff_g_t != null ? `saisi · ${params.method}` : `calculé · ${params.method}`, color: 'text-purple-400', icon: Layers },
        ].map(s => (
          <div key={s.label} className="flex items-start gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
              <s.icon size={13} className={s.color} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-mf-txt4">{s.label}</div>
              <div className={`text-sm font-bold font-mono leading-tight ${s.color}`}>{s.val}</div>
              <div className="text-[10px] text-mf-txt4">{s.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-mf-border px-4 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === t ? 'border-amber-400 text-amber-300' : 'border-transparent text-mf-txt3 hover:text-mf-txt'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">

        {/* ═══ PARAMÈTRES DU MODÈLE MINIER ═══
            Section dédiée : les hypothèses possédées par d'autres modules sont
            IMPORTÉES automatiquement (lecture seule, avec leur source), et les
            paramètres propres au modèle minier sont SAISIS ici — un bouton
            « Importer » permet de recopier la valeur d'un module dans le champ
            éditable quand les deux existent. */}
        {activeTab === 'Paramètres du modèle minier' && <ModelParamsTab Number={Number} String={String} mine={mine} params={params} saveParams={saveParams} saving={saving} upd={upd} />}

        {/* ═══ TABLEAU DE BORD ═══ */}
        {<StrategicPlanTab Math={Math} Number={Number} activeTab={activeTab} avgAisc={avgAisc} blendedBreakevenCutoff={blendedBreakevenCutoff} blendedBwi={blendedBwi} blendedMarginalCutoff={blendedMarginalCutoff} cutoffs={cutoffs} deratedTph={deratedTph} feedFromLom={feedFromLom} lom={lom} maxOz={maxOz} maxRev={maxRev} metDomains={metDomains} p={p} peakOz={peakOz} project={project} scenarios={scenarios} selectedScenario={selectedScenario} totalFcf={totalFcf} totalRev={totalRev} />}

        {/* ═══ PLAN LOM ═══ */}
        

        {/* ═══ PLAN D'EXPLOITATION ═══ */}
        {activeTab === '2 · Conception minière' && <MineDesignTab Map={Map} Math={Math} Object={Object} Set={Set} addDesignBench={addDesignBench} addDesignPit={addDesignPit} addEquipSchedule={addEquipSchedule} annualOreMt={annualOreMt} benchForm={benchForm} deleteDesignBench={deleteDesignBench} deleteDesignPit={deleteDesignPit} deleteEquipSchedule={deleteEquipSchedule} designBenches={designBenches} designPits={designPits} designSaving={designSaving} designTab={designTab} equipForm={equipForm} equipSchedule={equipSchedule} params={params} pitForm={pitForm} pitViz={pitViz} selectedPitId={selectedPitId} setBenchForm={setBenchForm} setDesignTab={setDesignTab} setEquipForm={setEquipForm} setPitForm={setPitForm} setSelectedPitId={setSelectedPitId} setShowBenchForm={setShowBenchForm} setShowEquipForm={setShowEquipForm} setShowPitForm={setShowPitForm} showBenchForm={showBenchForm} showEquipForm={showEquipForm} showPitForm={showPitForm} updateDesignPit={updateDesignPit} />}

        {/* ═══ PIT SHELL & GÉOTECHNIQUE ═══ */}
        {activeTab === '1 · Optimisation fosse' && <PitOptimizationTab Math={Math} blockSize={blockSize} blocks={blocks} blocksLoading={blocksLoading} blocksTruncated={blocksTruncated} cancelOptimisation={cancelOptimisation} edgeCount={edgeCount} optimError={optimError} optimProgress={optimProgress} optimising={optimising} p={p} params={params} pitViz={pitViz} runPitOptimisation={runPitOptimisation} shells={shells} ultimatePit={ultimatePit} />}

        {activeTab === '4 · Planification tactique' && <TacticalPlanTab Math={Math} cal={cal} fleetCapacity={fleetCapacity} fleetDerate={fleetDerate} fleetForQuarter={fleetForQuarter} impliedCapacity={impliedCapacity} lom={lom} months={months} planYear={planYear} quarters={quarters} seasonality={seasonality} setCal={setCal} setFleetCapacity={setFleetCapacity} setFleetDerate={setFleetDerate} setSeasonality={setSeasonality} setTacticalYear={setTacticalYear} tacticalYear={tacticalYear} />}

        {activeTab === '5 · Planification opérationnelle' && <OperationalPlanTab blastPlan={blastPlan} blocks={blocks} currentMonth={currentMonth} daily={daily} dbCfg={dbCfg} p={p} planYear={planYear} setDbCfg={setDbCfg} weekly={weekly} />}

        {activeTab === '6 · Chaîne de valeur' && <ValueChainTab Math={Math} chosen={chosen} mine={mine} params={params} scenarios={scenarios} selectedScenario={selectedScenario} setSelectedScenario={setSelectedScenario} />}

        {/* ═══ RISQUES & SENSIBILITÉ ═══ */}
        {activeTab === '7 · Simulation & scénarios' && <ScenariosTab Math={Math} sensitivityParam={sensitivityParam} sensitivityRows={sensitivityRows} setSensitivityParam={setSensitivityParam} />}

        {/* ═══ RAPPORT EXÉCUTIF ═══ */}
        {<ReconciliationTab Number={Number} activeTab={activeTab} actuals={actuals} benchmarks={benchmarks} chosen={chosen} hasActuals={hasActuals} mine={mine} params={params} phases={phases} planYear={planYear} project={project} reconciliation={reconciliation} reservesOrigin={reservesOrigin} setActuals={setActuals} totalOz={totalOz} totalRev={totalRev} />}

        
      </div>

      {/* Reset overwrites values the user may have typed — it asks first, and says
          exactly what it will and will not touch. */}
      {showReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setShowReset(false)}>
          <div className="card-sm max-w-lg w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <RotateCcw size={14} className="text-amber-400" />
              <div className="text-sm font-semibold mf-txt">Réaligner sur les modules sources</div>
            </div>
            <div className="text-xs mf-txt3 space-y-2 mb-4">
              <p>
                Les paramètres ci-dessous repasseront sur le module qui les possède, au lieu de garder
                la valeur inscrite ici à l'initialisation du plan :
              </p>
              <ul className="space-y-1 mf-txt4">
                <li>• <strong className="mf-txt3">Teneur</strong> → Projet ({formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t)</li>
                <li>• <strong className="mf-txt3">OPEX procédé</strong> → Économie{totalOpex > 0 ? ` (${formatDecimalGrouped(totalOpex, 2)} $/t)` : ' (aucune ligne — la saisie sera conservée)'}</li>
                <li>• <strong className="mf-txt3">CAPEX maintien</strong> → dérivé du CAPEX</li>
                <li>• <strong className="mf-txt3">Teneur de coupure</strong> → coupure géométallurgique calculée{blendedBreakevenCutoff != null ? ` (${formatDecimalGrouped(blendedBreakevenCutoff, 2)} g/t)` : ''}</li>
                <li>• <strong className="mf-txt3">Durée LOM</strong> → réserves ÷ débit</li>
                {ultimatePit && ultimatePit.result.oreTonnes > 0
                  ? <li>• <strong className="mf-txt3">Réserves</strong> → fosse optimisée ({formatDecimalGrouped((ultimatePit.result.oreTonnes / 1e6), 2)} Mt)</li>
                  : <li className="text-amber-400/80">• <strong>Réserves</strong> : inchangées — lancez l'étape 1 pour les aligner sur la fosse optimisée.</li>}
              </ul>
              <p className="mf-txt4">
                Conservés (aucun autre module ne les possède) : talus, ratio de décapage, hauteur de banc,
                coût minier, G&A, dilution, récupération minière, sautage, dénoyage.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowReset(false)} className="btn btn-secondary text-xs">Annuler</button>
              <button onClick={resetParamsToModules} disabled={saving}
                className="btn bg-amber-400 text-gray-900 hover:bg-amber-300 font-semibold text-xs">
                {saving ? 'Réinitialisation…' : 'Réaligner et enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
