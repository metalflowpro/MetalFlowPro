import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Mountain, TrendingUp, Layers, Truck, Target,
  CheckCircle2, AlertTriangle, Save, RefreshCw,
  Plus, Trash2, Pickaxe, DollarSign, Activity, Gauge,
  ArrowUpRight, ArrowDownRight, Map as MapIcon, GitBranch, X, RotateCcw,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';
import { TROY_OZ_GRAMS } from '../lib/config/constants';
import { useProject } from '../lib/ProjectContext';
import { resolveMineParams, type ResolvedMineParams, type ResolvedParam } from '../lib/mine/params';
import { domainCutoffs, blendedCutoff, blendedProperty, throughputForHardness, type DomainMetInputs } from '../lib/mine/cutoff';
import { type Block as PitBlock, type Shell } from '../lib/mine/pitOptimizer';
import { plantGrindEnergy } from '../lib/geomet/p80';
import type { PitWorkerRequest, PitWorkerResponse, PitViz } from '../lib/mine/pitOptimizer.worker';
import { Pit3D, PitSection, PitDiagnostic } from '../components/mine/PitViews';
import {
  disaggregateYear, fleetRequirements, drillBlastPlan, reconcile, reconVerdict,
  QUARTER_LABELS, MONTH_LABELS, type FleetSpec, type CalendarConfig,
} from '../lib/mine/planning';
import { isCompositeDomain, canonDomain } from '../lib/geomet/domains';
import { DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import { irr as computeIrr, npv as computeNpv } from '../lib/simulation/economics';

/* ─── Types ──────────────────────────────────────────────────────────────── */

/**
 * The module follows the mine-planning workflow end to end: each stage consumes
 * the previous one's output, so a number can never disagree with itself between
 * horizons — the ultimate pit sets the reserves, the reserves set the LOM, the
 * LOM sets the quarter, the quarter sets the day.
 */
const TABS = [
  '1 · Optimisation fosse',
  '2 · Conception minière',
  '3 · Planification stratégique',
  '4 · Planification tactique',
  '5 · Planification opérationnelle',
  '6 · Chaîne de valeur',
  '7 · Simulation & scénarios',
  '8 · Suivi & réconciliation',
] as const;
type Tab = typeof TABS[number];

interface MineParamsRow {
  id: string; project_id: string;
  method: string;
  stripping_ratio: number; slope_angle_deg: number; bench_height_m: number;
  trucks: string; shovel: string; drill: string;
  lom_years: number | null;
  reserves_mt: number;
  /** Null = follow the Projet's feed grade. */
  grade_g_t: number | null;
  /** Null = follow the computed geometallurgical breakeven cut-off. */
  cutoff_g_t: number | null;
  mining_cost_t: number;
  /** Null = follow Économie's OPEX total. */
  process_cost_t: number | null;
  ga_cost_m: number;
  /** Null = derive from the CAPEX. */
  sustaining_capex_m: number | null;
  discount_rate_pct: number;
  royalty_pct: number; nsr_pct: number;
  pump_cost_m: number; blasting_cost_t: number;
  ore_recovery_pct: number; dilution_pct: number;
  gold_price_sens: number;
  ramp_up_y1_pct: number;
  ramp_up_y2_pct: number;
  grade_decay_pct_yr: number;
  capex_unit_cost_usd_t: number;
}

/** Raw block-model row as stored. */
interface BmBlockRow {
  i: number; j: number; k: number; cz: number | string;
  au_g_t: number | string; density: number | string; volume_m3: number | string;
  rock_type: string | null;
}

/** GéoMet domain, reduced to the geometallurgy the mine model consumes. */
interface GeomDomainRow {
  name: string;
  avg_bwi_kwh_t: number | null;
  recovery_design: number | null;
  lom_pct: number | null;
}

interface MinePhaseRow {
  id: string; project_id: string;
  phase_name: string; year_start: number; year_end: number;
  zone: string; ore_type: string;
  grade_g_t: number; ore_mt: number; waste_mt: number; color: string;
}

interface ScenarioRow {
  id: string; name: string; description: string; color: string;
  reserves_mt: number; stripping_ratio: number; slope_angle_deg: number;
  lom_years: number; npv_musd: number;
  /** null when the cash-flow stream has no sign change — no IRR exists. */
  irr_pct: number | null;
  payback_years: number; aisc: number;
  capex_m: number; annual_oz: number; recommended: boolean;
}

interface DesignPit {
  id: string;
  project_id: string;
  name: string;
  pit_type: string;
  crest_rl: number | null;
  floor_rl: number | null;
  bench_height_m: number;
  berm_width_m: number;
  slope_angle_deg: number;
  ore_mt: number;
  waste_mt: number;
  grade_g_t: number;
  strip_ratio: number;
  status: 'planned' | 'active' | 'completed' | 'deferred';
  sequence_order: number;
  color: string;
  notes: string | null;
}

interface DesignBench {
  id: string;
  project_id: string;
  pit_id: string | null;
  bench_rl: number;
  ore_mt: number;
  waste_mt: number;
  grade_g_t: number;
  width_m: number | null;
  length_m: number | null;
  blast_pattern: string | null;
  explosive_type: string | null;
  powder_factor: number | null;
  ore_type: string | null;
  domain: string | null;
  notes: string | null;
}

interface EquipSchedule {
  id: string;
  project_id: string;
  pit_id: string | null;
  year: number;
  equipment_type: string;
  equipment_name: string;
  quantity: number;
  hours_year: number;
  cost_h: number;
  notes: string | null;
}

const PIT_STATUS_META: Record<string, { label: string; color: string }> = {
  planned:   { label: 'Planifié',   color: '#3B82F6' },
  active:    { label: 'En cours',   color: '#10B981' },
  completed: { label: 'Terminé',    color: '#6B7280' },
  deferred:  { label: 'Reporté',    color: '#F59E0B' },
};

const EQUIP_TYPES = ['Camion', 'Pelle/Excavatrice', 'Bouteur', 'Foreuse', 'Niveleuse', 'Compacteur', 'Chargeur', 'Arroseur', 'Autre'];
const EXPLOSIVE_TYPES = ['ANFO', 'Emulsion', 'ANFO lourd', 'Rioflex', 'Autre'];
const PIT_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#F06B6B', '#8B5CF6', '#06B6D4', '#F88A44', '#84CC16'];

const TROY = 1 / TROY_OZ_GRAMS;
const PHASE_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#F06B6B', '#8B5CF6', '#06B6D4'];
/**
 * Gold-price ladder for the pit-shell sweep, as multiples of the project's own
 * price rather than a fixed $1400–$3200 grid — a fixed grid stops straddling the
 * base case as soon as the gold price moves away from it.
 */
const PIT_PRICE_FACTORS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.45, 1.6] as const;

/**
 * Shape of the LOM schedule — the mine-plan behaviours that were previously
 * unnamed literals buried in the builder. Each is overridable per project via
 * mine_params where a column exists; the values here are the documented default.
 */
const MINE_MODEL = {
  /** Ramp-up: throughput in year 1 / year 2 (% of nameplate) before steady state. */
  RAMP_UP_Y1_PCT: 80,
  RAMP_UP_Y2_PCT: 92,
  /** Grade decays as the higher-grade core is depleted (%/yr). */
  GRADE_DECAY_PCT_YR: 1.6,
  /** Floor on cumulative grade decay — grade does not fall indefinitely. */
  GRADE_DECAY_FLOOR: 0.82,
  /** Stripping eases as the pit deepens (fraction per year), with a floor. */
  STRIP_DECAY_PER_YEAR: 0.022,
  STRIP_DECAY_FLOOR: 0.55,
  /** Dewatering costs more while the pit is being established. */
  DEWATERING_RAMP_YEARS: 3,
  DEWATERING_RAMP_FACTOR: 1.4,
  /** Benches the slope cone reaches up — deeper cones cost time, shallower ones under-strip. */
  CONE_LEVELS: 6,
  /** Revenue factors for the nested shells (Whittle-style price parameterisation). */
  SHELL_REVENUE_FACTORS: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4],
  /** Ceiling on blocks optimised in-browser; beyond it the model is truncated and flagged. */
  MAX_BLOCKS_OPTIMISED: 60000,
} as const;

/**
 * Scenario geometry: how each alternative pit differs from the base case.
 * Previously a scatter of unexplained multipliers (1.20, 1.22, 1.15…) applied
 * directly to the NPV — the NPV is now recomputed from the modified physicals
 * rather than scaled, so a scenario cannot claim value its own inputs do not support.
 */
const SCENARIO_SHAPES = [
  {
    id: 'expanded', name: 'Pit élargi', color: '#10B981',
    description: 'Angle –5° · Réserves +20 %',
    reservesFactor: 1.20, strippingFactor: 1.22, slopeDelta: -5, capexFactor: 1.10,
  },
  {
    id: 'steep', name: 'Pit resserré', color: '#3B82F6',
    description: 'Angle +5° · Réserves –12 %',
    reservesFactor: 0.88, strippingFactor: 0.82, slopeDelta: +5, capexFactor: 0.94,
  },
] as const;

/**
 * Seed for a brand-new mine plan.
 *
 * Anything another module owns is seeded NULL so it follows that module instead
 * of freezing a copy at creation time: grade comes from the Projet, process cost
 * and sustaining capex from Économie, recovery from the LIMS testwork.
 *
 * `discount_rate_pct`, `royalty_pct`, `nsr_pct` and `gold_price_sens` are
 * NOT NULL in the schema so a value must be supplied, but resolveMineParams
 * ignores them — project_settings and the Projet own those numbers. They are kept
 * only to satisfy the constraint.
 */
const DEFAULT_PARAMS: Omit<MineParamsRow, 'id' | 'project_id'> = {
  method: 'Open pit',
  stripping_ratio: 4.0, slope_angle_deg: 45, bench_height_m: 10,
  trucks: '', shovel: '', drill: '',
  lom_years: null,
  reserves_mt: 20.0, grade_g_t: null, cutoff_g_t: null,
  mining_cost_t: 2.8, process_cost_t: null, ga_cost_m: 8.0,
  // NOT NULL in the schema (default 6.0). Seeded non-null so the initial insert
  // succeeds; resolveMineParams ignores it and derives sustaining from the CAPEX.
  sustaining_capex_m: 6.0,
  discount_rate_pct: 10.0, royalty_pct: 3.0, nsr_pct: 1.5, gold_price_sens: 2000,
  pump_cost_m: 1.5, blasting_cost_t: 0.9, ore_recovery_pct: 95.0,
  dilution_pct: 5.0,
  ramp_up_y1_pct: MINE_MODEL.RAMP_UP_Y1_PCT,
  ramp_up_y2_pct: MINE_MODEL.RAMP_UP_Y2_PCT,
  grade_decay_pct_yr: MINE_MODEL.GRADE_DECAY_PCT_YR,
  capex_unit_cost_usd_t: 42000.0,
};

/* ─── LOM schedule builder ───────────────────────────────────────────────── */
function buildLOM(
  project: Project & { lom_years?: number },
  p: MineParamsRow,
  phases: MinePhaseRow[],
  hoursPerYear: number,
  mine: ResolvedMineParams,
  /** Throughput the blend hardness allows (t/h); null → nameplate. */
  deratedTph: number | null,
) {
  // Mine-to-mill: the mill is power-limited, so hard feed yields fewer tonnes.
  // A conventional schedule holds nameplate tph for the whole LOM.
  const effectiveTph = deratedTph ?? project.target_tph;
  const annualOreMt = (effectiveTph * (project.availability_pct / 100) * hoursPerYear) / 1e6;
  const lom = p.lom_years ?? project.lom_years ?? Math.max(1, Math.ceil(p.reserves_mt / Math.max(0.01, annualOreMt)));

  const rampY1 = (p.ramp_up_y1_pct ?? MINE_MODEL.RAMP_UP_Y1_PCT) / 100;
  const rampY2 = (p.ramp_up_y2_pct ?? MINE_MODEL.RAMP_UP_Y2_PCT) / 100;
  const decayRate = (p.grade_decay_pct_yr ?? MINE_MODEL.GRADE_DECAY_PCT_YR) / 100;

  return Array.from({ length: Math.max(1, lom) }, (_, i) => {
    const rampUp = i === 0 ? rampY1 : i === 1 ? rampY2 : 1.0;
    const gradeDecay = Math.max(MINE_MODEL.GRADE_DECAY_FLOOR, 1 - i * decayRate);
    const grade = mine.goldGradeGt.value * gradeDecay;
    const ore = annualOreMt * rampUp * ((100 + p.dilution_pct) / 100) * (p.ore_recovery_pct / 100);
    const waste = ore * p.stripping_ratio * Math.max(MINE_MODEL.STRIP_DECAY_FLOOR, 1 - i * MINE_MODEL.STRIP_DECAY_PER_YEAR);
    const total = ore + waste;

    // Contained gold, then RECOVERED gold. The metallurgical recovery (LIMS
    // testwork, via ProjectContext) was previously absent altogether: revenue,
    // NPV and AISC were all computed on contained ounces, as if the plant
    // recovered 100 % of the gold it was fed.
    const containedOz = ore * 1e6 * grade * TROY;
    const recoveredOz = containedOz * (mine.metRecoveryPct.value / 100);
    const royaltyFactor = 1 - mine.royaltyPct.value / 100;
    const netOz = recoveredOz * royaltyFactor;
    const revM = (netOz * mine.goldPriceUsdOz.value) / 1e6;

    const miningM = p.mining_cost_t * total;
    const processM = mine.processCostUsdT.value * ore;
    const blastM = p.blasting_cost_t * total;
    const pumpM = p.pump_cost_m * (i < MINE_MODEL.DEWATERING_RAMP_YEARS ? MINE_MODEL.DEWATERING_RAMP_FACTOR : 1.0);
    const gaM = p.ga_cost_m;
    const costM = miningM + processM + blastM + pumpM + gaM;
    const ebitdaM = revM - costM;
    const capexYear = i === 0 ? mine.capexMusd.value : mine.sustainingCapexMusd.value;
    const fcfM = ebitdaM - capexYear;
    const aisc = netOz > 0 ? ((costM + capexYear / lom) * 1e6) / netOz : 0;

    return {
      year: i + 1, grade, ore, waste, total,
      oz_k: +(recoveredOz / 1000).toFixed(1),
      contained_oz_k: +(containedOz / 1000).toFixed(1),
      net_oz_k: +(netOz / 1000).toFixed(1),
      rev_m: +revM.toFixed(1),
      cost_m: +costM.toFixed(1),
      ebitda_m: +ebitdaM.toFixed(1),
      fcf_m: +fcfM.toFixed(1),
      aisc: +aisc.toFixed(0),
      rs: +(waste / Math.max(0.001, ore)).toFixed(1),
    };
  });
}

/* ─── Scenario builder ───────────────────────────────────────────────────── */
/**
 * Build a scenario by rebuilding its actual life-of-mine cash flow.
 *
 * The previous version scaled the base-case NPV by unexplained factors (×1.15,
 * ×0.84, ×1.28…) and reported an "IRR" that was `ebitda/capex × 0.85` clamped to
 * 5–80 % — not an internal rate of return at all. Both are decision-grade numbers.
 * Each scenario now runs the same LOM builder on its own modified physicals, and
 * NPV/IRR come from the shared, unit-tested economic engine.
 */
function buildScenarios(
  project: Project & { lom_years?: number },
  p: MineParamsRow,
  hoursPerYear: number,
  mine: ResolvedMineParams,
  deratedTph: number | null,
): ScenarioRow[] {
  const dr = mine.discountRatePct.value / 100;

  function evaluate(shape: {
    id: string; name: string; color: string; description: string;
    reservesFactor: number; strippingFactor: number; slopeDelta: number; capexFactor: number;
    recommended: boolean;
  }): ScenarioRow {
    const sp: MineParamsRow = {
      ...p,
      reserves_mt: p.reserves_mt * shape.reservesFactor,
      stripping_ratio: p.stripping_ratio * shape.strippingFactor,
      slope_angle_deg: p.slope_angle_deg + shape.slopeDelta,
      lom_years: null, // let reserves and throughput set the mine life
    };
    const sMine: ResolvedMineParams = {
      ...mine,
      capexMusd: { ...mine.capexMusd, value: mine.capexMusd.value * shape.capexFactor },
    };

    const rows = buildLOM(project, sp, [], hoursPerYear, sMine, deratedTph);
    const lom_years = rows.length;

    // Standard DCF shape: the initial CAPEX is spent during construction, at t=0,
    // BEFORE any ore is milled. buildLOM books it inside year 1 instead, alongside
    // that year's full revenue — so the project never had a negative year, no rate
    // could zero the stream, and the old unguarded IRR chased a root that did not
    // exist and blew up to 4.5e+31 %. Construction is separated here.
    const opFcfs = rows.map(r => r.ebitda_m - sMine.sustainingCapexMusd.value);
    const npv_musd = computeNpv(opFcfs, dr) - sMine.capexMusd.value;
    // null when the stream still never changes sign — reported as "—", not invented.
    const irrRaw = computeIrr([-sMine.capexMusd.value, ...opFcfs]);
    const irr_pct = irrRaw != null ? irrRaw * 100 : null;

    const annual_oz = rows.length ? rows.reduce((s, r) => s + r.net_oz_k * 1000, 0) / rows.length : 0;
    const aisc = rows.length ? rows.reduce((s, r) => s + r.aisc, 0) / rows.length : 0;

    // Payback: the year cumulative free cash flow first turns positive.
    let cum = 0;
    let payback_years = lom_years;
    for (const r of rows) {
      const prev = cum;
      cum += r.fcf_m;
      if (prev < 0 && cum >= 0) {
        payback_years = r.year - 1 + (cum !== prev ? -prev / (cum - prev) : 0);
        break;
      }
    }

    return {
      id: shape.id, name: shape.name, color: shape.color, description: shape.description,
      reserves_mt: sp.reserves_mt, stripping_ratio: sp.stripping_ratio,
      slope_angle_deg: sp.slope_angle_deg, lom_years, annual_oz,
      npv_musd, irr_pct,
      payback_years, aisc, capex_m: sMine.capexMusd.value,
      recommended: shape.recommended,
    };
  }

  const base = evaluate({
    id: 'base', name: 'Base Case', color: '#F59E0B',
    description: `Pit $${mine.goldPriceUsdOz.value}/oz · RS ${p.stripping_ratio}:1 · Talus ${p.slope_angle_deg}°`,
    reservesFactor: 1, strippingFactor: 1, slopeDelta: 0, capexFactor: 1, recommended: false,
  });

  const alternatives = SCENARIO_SHAPES.map(s => evaluate({ ...s, recommended: false }));
  const all = [base, ...alternatives];

  // The recommendation follows the computed NPV instead of being asserted.
  const best = all.reduce((a, b) => (b.npv_musd > a.npv_musd ? b : a));
  return all.map(s => ({ ...s, recommended: s.id === best.id }));
}

/* ─── SVG helpers ────────────────────────────────────────────────────────── */
function MiniSparkline({ values, color, w = 80, h = 28 }: { values: number[]; color: string; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const mn = Math.min(...values), mx = Math.max(...values);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = mx === mn ? h / 2 : h - ((v - mn) / (mx - mn)) * h;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

interface MineOptProps { project: Project & { lom_years?: number } }

export function MineOpt({ project }: MineOptProps) {
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
  const [benchmarkOverrides, setBenchmarkOverrides] = useState<{ aiscUsdOz: number | null; hurdlePct: number | null; strippingRatio: number | null }>({
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
  const [showPhaseForm, setShowPhaseForm] = useState(false);
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
    setPhases((phRes.data ?? []) as MinePhaseRow[]);
    setDesignPits((pitsRes.data ?? []) as DesignPit[]);
    setDesignBenches((benchRes.data ?? []) as DesignBench[]);
    setEquipSchedule((equipRes.data ?? []) as EquipSchedule[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  async function saveParams() {
    if (!params) return;
    setSaving(true);
    await supabase.from('mine_params').upsert({ ...params, project_id: project.id }, { onConflict: 'project_id' });
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
      .upsert({ ...next, project_id: project.id }, { onConflict: 'project_id' });
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
      .insert({ ...DEFAULT_PARAMS, project_id: project.id })
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

  async function addPhase() {
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
    }).select('*').maybeSingle();
    if (data) setPhases(prev => [...prev, data as MinePhaseRow]);
    setShowPhaseForm(false); setPhaseForm({});
  }

  async function deletePhase(id: string) {
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
    const density = blocks.length ? blocks[0].density : 2.7;
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

  const maxShellTonnes = shells.length
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

        {/* ═══ TABLEAU DE BORD ═══ */}
        {activeTab === '3 · Planification stratégique' && (
          <div className="space-y-5">
            {/* ── Sources importées ──────────────────────────────────────────
                Every economic input, and the module it came from. Nothing in this
                page is a number typed into the mine model unless it says so. */}
            <div className="card-sm">
              <div className="flex items-center gap-2 mb-3">
                <GitBranch size={12} className="text-teal-400" />
                <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Sources des hypothèses</div>
                <span className="text-[10px] mf-txt4">— chaque valeur est importée du module qui la possède</span>
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2.5">
                {([
                  ['Récupération métall.', mine.metRecoveryPct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['Teneur alimentation', mine.goldGradeGt, (v: number) => `${formatDecimalGrouped(v, 2)} g/t`],
                  ['Prix de l\'or', mine.goldPriceUsdOz, (v: number) => `$${formatDecimalGrouped(v, 0)}/oz`],
                  ['Taux d\'actualisation', mine.discountRatePct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['Redevances', mine.royaltyPct, (v: number) => `${formatDecimalGrouped(v, 1)} %`],
                  ['OPEX procédé', mine.processCostUsdT, (v: number) => `$${formatDecimalGrouped(v, 2)}/t`],
                  ['CAPEX initial', mine.capexMusd, (v: number) => `${formatDecimalGrouped(v, 1)} M$`],
                  ['CAPEX maintien', mine.sustainingCapexMusd, (v: number) => `${formatDecimalGrouped(v, 1)} M$/an`],
                ] as [string, ResolvedParam, (v: number) => string][]).map(([label, param, fmt]) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[10px] mf-txt4 truncate">{label}</div>
                    <div className="text-sm font-bold mf-txt">{fmt(param.value)}</div>
                    <div className={`text-[9px] truncate ${
                      param.origin === 'override' ? 'text-amber-400'
                        : param.origin === 'defaut' ? 'text-red-400/80'
                        : 'text-emerald-400/80'}`} title={param.source}>
                      {param.origin === 'override' ? '✎ ' : param.origin === 'defaut' ? '⚠ ' : '↓ '}{param.source}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Cut-off géométallurgique ───────────────────────────────────
                Conventional planners apply ONE recovery and ONE cost to every
                block. Recovery and grinding energy are properties of the ore. */}
            {cutoffs.length > 0 && (
              <div className="card-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Target size={12} className="text-violet-400" />
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Teneur de coupure géométallurgique</div>
                </div>
                <div className="text-[10px] mf-txt4 mb-3">
                  Chaque domaine porte sa propre coupure, calculée sur <strong className="mf-txt3">sa</strong> récupération et
                  <strong className="mf-txt3"> son</strong> énergie de broyage — un sulfure dur qui récupère moins doit porter plus d'or
                  pour se payer qu'un oxyde tendre. Une coupure unique envoie du sulfure sous-marginal au moulin et de l'oxyde payant au stérile.
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Domaine', 'Récup.', 'BWi', 'Énergie', 'Coût procédé', '% alim.', 'Coupure marginale', 'Coupure équilibre'].map(h => (
                          <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cutoffs.map(c => (
                        <tr key={c.canon} className="border-b border-white/5">
                          <td className="px-3 py-1.5 font-semibold mf-txt">{c.label}</td>
                          <td className="px-3 py-1.5 text-emerald-400">{formatDecimalGrouped(c.recoveryPct, 1)} %</td>
                          <td className="px-3 py-1.5 text-sky-400">{formatDecimalGrouped(c.bwiKwhT, 1)}</td>
                          <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(c.grindEnergyKwhT, 1)} kWh/t</td>
                          <td className="px-3 py-1.5 mf-txt3">${formatDecimalGrouped(c.processCostUsdT, 2)}/t</td>
                          <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((c.feedShare * 100), 0)} %</td>
                          <td className="px-3 py-1.5 font-bold text-amber-400">
                            {Number.isFinite(c.marginalCutoffGt) ? `${formatDecimalGrouped(c.marginalCutoffGt, 2)} g/t` : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-bold text-violet-300">
                            {Number.isFinite(c.breakevenCutoffGt) ? `${formatDecimalGrouped(c.breakevenCutoffGt, 2)} g/t` : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-white/4">
                        <td className="px-3 py-1.5 font-bold mf-txt">Blend ({feedFromLom ? 'répartition LOM' : 'parts égales'})</td>
                        <td className="px-3 py-1.5" colSpan={5} />
                        <td className="px-3 py-1.5 font-bold text-amber-400">{blendedMarginalCutoff?.toFixed(2) ?? '—'} g/t</td>
                        <td className="px-3 py-1.5 font-bold text-violet-300">{blendedBreakevenCutoff?.toFixed(2) ?? '—'} g/t</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {p?.cutoff_g_t != null && blendedBreakevenCutoff != null && (() => {
                  const drift = Math.abs(p.cutoff_g_t - blendedBreakevenCutoff) > 0.1;
                  return (
                    <div className={`text-[10px] mt-2 ${drift ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {drift ? '⚠' : '✓'} Coupure saisie {formatDecimalGrouped(p.cutoff_g_t, 2)} g/t vs. coupure
                      d'équilibre calculée {formatDecimalGrouped(blendedBreakevenCutoff, 2)} g/t.
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Débit dérasé par la dureté ─────────────────────────────── */}
            {deratedTph != null && blendedBwi != null && (
              <div className="card-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge size={12} className="text-amber-400" />
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Débit limité par la puissance (mine-to-mill)</div>
                </div>
                <div className="text-[10px] mf-txt4 mb-3">
                  Un circuit de broyage est limité par sa puissance installée, pas par le tonnage : à kW constants,
                  un minerai plus dur passe moins vite. Les planificateurs conventionnels tiennent le débit nominal
                  sur toute la vie de mine, ce qui surestime la production des années riches en sulfure.
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Débit nominal', val: `${formatDecimalGrouped(project.target_tph, 0)} t/h`, color: 'mf-txt3' },
                    { label: 'BWi du blend', val: `${formatDecimalGrouped(blendedBwi, 2)} kWh/t`, color: 'text-sky-400' },
                    { label: 'Débit réalisable', val: `${formatDecimalGrouped(deratedTph, 0)} t/h`, color: deratedTph < project.target_tph ? 'text-amber-400' : 'text-emerald-400' },
                    {
                      label: 'Écart vs nominal',
                      val: `${formatDecimalGrouped((((deratedTph - project.target_tph) / project.target_tph) * 100), 1)} %`,
                      color: deratedTph < project.target_tph ? 'text-red-400' : 'text-emerald-400',
                    },
                  ].map(k => (
                    <div key={k.label}>
                      <div className="text-[10px] mf-txt4">{k.label}</div>
                      <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                    </div>
                  ))}
                </div>
                <div className="text-[10px] mf-txt4 mt-2">
                  Référence de dureté : le domaine le plus tendre ({formatDecimalGrouped(Math.min(...metDomains.map(d => d.bwiKwhT)), 1)} kWh/t),
                  auquel le débit nominal est réputé atteint. Le plan LOM ci-dessous utilise le débit réalisable.
                </div>
              </div>
            )}

            {/* Production profile + FCF sparklines */}
            <div className="grid grid-cols-3 gap-4">
              {/* Production chart */}
              <div className="col-span-2 card-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-semibold text-mf-txt">Production & Revenus — {lom.length} ans LOM</div>
                    <div className="text-xs text-mf-txt4">koz Au / an · Revenus nets M$ / an</div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-mf-txt4">
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-500 inline-block" />koz Au</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-500/50 inline-block" />Rev. M$</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500/50 inline-block" />FCF M$</span>
                  </div>
                </div>
                <svg viewBox={`0 0 640 180`} className="w-full">
                  {/* grid */}
                  {[0, 0.25, 0.5, 0.75, 1].map(f => (
                    <line key={f} x1={40} y1={10 + f * 150} x2={630} y2={10 + f * 150} stroke="#ffffff08" strokeWidth={1} />
                  ))}
                  {lom.map((y, i) => {
                    const bw = 590 / lom.length;
                    const x = 40 + i * bw + bw * 0.1;
                    const bwInner = bw * 0.8;
                    const ozH = (y.oz_k / maxOz) * 130;
                    const revH = (y.rev_m / maxRev) * 130;
                    const fcfH = Math.abs(y.fcf_m) / maxRev * 130;
                    return (
                      <g key={i}>
                        <rect x={x + bwInner * 0.35} y={10 + 130 - revH} width={bwInner * 0.3} height={revH} rx={1} fill="#0ea5e988" />
                        <rect x={x + bwInner * 0.05} y={10 + 130 - ozH} width={bwInner * 0.28} height={ozH} rx={1} fill="#f59e0b" opacity={0.9} />
                        <rect x={x + bwInner * 0.67} y={y.fcf_m >= 0 ? 10 + 130 - fcfH : 10 + 130} width={bwInner * 0.28} height={fcfH} rx={1} fill={y.fcf_m >= 0 ? '#10b98166' : '#f0696a88'} />
                        <text x={x + bwInner / 2} y={175} fill="#6B7280" fontSize={8} textAnchor="middle">{y.year}</text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              {/* Summary metrics */}
              <div className="space-y-3">
                {[
                  { label: 'Production pic', val: `${formatDecimalGrouped(peakOz, 1)} koz/an`, trend: '+', color: 'text-amber-400' },
                  { label: 'AISC moyen LOM', val: `$${formatDecimalGrouped(avgAisc, 0)}/oz`, trend: avgAisc < project.gold_price_usd * 0.6 ? '+' : '-', color: avgAisc < project.gold_price_usd * 0.6 ? 'text-emerald-400' : 'text-amber-400' },
                  { label: 'Marge EBITDA', val: `${totalRev > 0 ? formatDecimalGrouped(((lom.reduce((s, y) => s + y.ebitda_m, 0) / totalRev) * 100), 0) : '—'}%`, trend: '+', color: 'text-sky-400' },
                  { label: 'FCF cumulé', val: `${formatDecimalGrouped(totalFcf, 0)} M$`, trend: totalFcf > 0 ? '+' : '-', color: totalFcf > 0 ? 'text-emerald-400' : 'text-red-400' },
                ].map(m => (
                  <div key={m.label} className="card-sm flex items-center gap-3">
                    <div className="flex-1">
                      <div className="text-xs text-mf-txt4">{m.label}</div>
                      <div className={`text-lg font-bold font-mono ${m.color}`}>{m.val}</div>
                    </div>
                    {m.trend === '+' ? <ArrowUpRight size={18} className="text-emerald-500/60" /> : <ArrowDownRight size={18} className="text-red-400/60" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Scenario comparison quick view */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Comparaison rapide — 5 scénarios</div>
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['Scénario', 'Réserves', 'LOM', 'VAN₁₀', 'TRI', 'AISC', 'Retour', 'Rec.'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-mf-txt3 font-semibold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios.map(sc => (
                      <tr key={sc.id} className={`border-b border-white/5 hover:bg-white/4 ${sc.id === selectedScenario ? 'bg-amber-400/5' : ''}`}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: sc.color }} />
                            <span className="font-medium text-mf-txt">{sc.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-amber-300 font-mono">{formatDecimalGrouped(sc.reserves_mt, 1)} Mt</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{sc.lom_years} ans</td>
                        <td className="px-3 py-1.5 font-semibold font-mono" style={{ color: sc.npv_musd >= 0 ? '#10B981' : '#F06B6B' }}>{formatDecimalGrouped(sc.npv_musd, 0)} M$</td>
                        <td className="px-3 py-1.5 text-sky-400">{sc.irr_pct != null ? `${formatDecimalGrouped(sc.irr_pct, 1)}%` : "—"}</td>
                        <td className="px-3 py-1.5 text-purple-400">${formatDecimalGrouped(sc.aisc, 0)}</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{formatDecimalGrouped(sc.payback_years, 1)} ans</td>
                        <td className="px-3 py-1.5">{sc.recommended && <span className="text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/25 px-1.5 py-0.5 rounded">★ Recommandé</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══ PLAN LOM ═══ */}
        {activeTab === '3 · Planification stratégique' && (
          <div className="space-y-5">
            {/* Paramètres */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Paramètres du modèle minier</div>
              <div className="grid grid-cols-4 gap-3">
                {([
                  { label: 'Méthode', key: 'method', type: 'select', options: ['Open pit', 'Souterrain', 'Open pit + Souterrain'] },
                  { label: 'RS moyen (s/m)', key: 'stripping_ratio', type: 'number', step: 0.1 },
                  { label: 'Angle talus global (°)', key: 'slope_angle_deg', type: 'number', step: 1 },
                  { label: 'Hauteur banc (m)', key: 'bench_height_m', type: 'number', step: 1 },
                  { label: 'Réserves (Mt)', key: 'reserves_mt', type: 'number', step: 0.5 },
                  { label: 'Teneur réserves (g/t)', key: 'grade_g_t', type: 'number', step: 0.01 },
                  { label: 'CoG (g/t Au)', key: 'cutoff_g_t', type: 'number', step: 0.01 },
                  { label: 'Dilution minière (%)', key: 'dilution_pct', type: 'number', step: 0.5 },
                  { label: 'Récupération minerai (%)', key: 'ore_recovery_pct', type: 'number', step: 0.5 },
                  { label: 'Coût extraction ($/t total)', key: 'mining_cost_t', type: 'number', step: 0.1 },
                  { label: 'Coût traitement ($/t minerai)', key: 'process_cost_t', type: 'number', step: 0.5 },
                  { label: 'Sautage ($/t total)', key: 'blasting_cost_t', type: 'number', step: 0.05 },
                  { label: 'G&A (M$/an)', key: 'ga_cost_m', type: 'number', step: 0.5 },
                  { label: 'Pompage (M$/an)', key: 'pump_cost_m', type: 'number', step: 0.5 },
                  { label: 'CAPEX soutien (M$/an)', key: 'sustaining_capex_m', type: 'number', step: 0.5 },
                  { label: 'Taux actualisation (%)', key: 'discount_rate_pct', type: 'number', step: 0.5 },
                  { label: 'Redevances royalties (%)', key: 'royalty_pct', type: 'number', step: 0.25 },
                  { label: 'NSR (%)', key: 'nsr_pct', type: 'number', step: 0.25 },
                  { label: 'Camions', key: 'trucks', type: 'text' },
                  { label: 'Pelle / Chargeuse', key: 'shovel', type: 'text' },
                  { label: 'Montée en régime An 1 (%)', key: 'ramp_up_y1_pct', type: 'number', step: 1 },
                  { label: 'Montée en régime An 2 (%)', key: 'ramp_up_y2_pct', type: 'number', step: 1 },
                  { label: 'Déclin teneur (%/an)', key: 'grade_decay_pct_yr', type: 'number', step: 0.1 },
                  { label: 'Coût CAPEX unitaire ($/t-j)', key: 'capex_unit_cost_usd_t', type: 'number', step: 500 },
                ] as { label: string; key: keyof MineParamsRow; type: string; step?: number; options?: string[] }[]).map(f => (
                  <div key={f.key}>
                    <label className="label">{f.label}</label>
                    {f.type === 'select' ? (
                      <select
                        className="input-field w-full text-xs"
                        value={String(params[f.key] ?? '')}
                        onChange={e => upd(f.key, e.target.value as never)}
                      >
                        {f.options?.map(o => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        type={f.type} step={f.step}
                        className="input-field w-full font-mono text-xs"
                        value={String(params[f.key] ?? '')}
                        onChange={e => upd(f.key, (f.type === 'number' ? Number(e.target.value) : e.target.value) as never)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={saveParams} disabled={saving} className="btn btn-secondary text-xs flex items-center gap-1.5">
                  <Save size={12} /> Sauvegarder
                </button>
              </div>
            </div>

            {/* LOM Table */}
            <div className="overflow-x-auto">
              <table className="tbl w-full text-xs">
                <thead>
                  <tr>
                    {['An', 'Minerai (Mt)', 'Stérile (Mt)', 'RS', 'Teneur (g/t)', 'Oz brut (koz)', 'Oz net (koz)', 'Rev. net (M$)', 'Coûts (M$)', 'EBITDA (M$)', 'FCF (M$)', 'AISC ($/oz)'].map(h => (
                      <th key={h} className="text-right px-2 py-2 text-mf-txt3 font-semibold text-[10px] first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lom.map((y, i) => (
                    <tr key={i} className={`border-b border-white/5 hover:bg-white/4 ${i === 0 ? 'bg-amber-400/4' : ''}`}>
                      <td className="px-2 py-1.5 font-mono text-[10px] text-mf-txt3">An {y.year}</td>
                      <td className="px-2 py-1.5 text-right">{formatDecimalGrouped(y.ore, 2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{formatDecimalGrouped(y.waste, 2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{y.rs}</td>
                      <td className="px-2 py-1.5 text-right text-amber-400 font-semibold">{formatDecimalGrouped(y.grade, 3)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-300">{y.oz_k}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-400 font-semibold">{y.net_oz_k}</td>
                      <td className="px-2 py-1.5 text-right">{y.rev_m}</td>
                      <td className="px-2 py-1.5 text-right text-orange-400">{y.cost_m}</td>
                      <td className="px-2 py-1.5 text-right font-semibold" style={{ color: y.ebitda_m >= 0 ? '#10B981' : '#F06B6B' }}>{y.ebitda_m}</td>
                      <td className="px-2 py-1.5 text-right font-bold" style={{ color: y.fcf_m >= 0 ? '#10B981' : '#F06B6B' }}>{y.fcf_m}</td>
                      <td className="px-2 py-1.5 text-right text-purple-400">{y.aisc}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-white/10 font-bold text-amber-400 bg-amber-400/4">
                    <td className="px-2 py-2">TOTAL</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.ore, 0), 2)}</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.waste, 0), 2)}</td>
                    <td colSpan={2} className="px-2 py-2 text-right text-mf-txt4">—</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(lom.reduce((s, y) => s + y.oz_k, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.net_oz_k, 0), 1)}</td>
                    <td className="px-2 py-2 text-right">{formatDecimalGrouped(totalRev, 1)}</td>
                    <td className="px-2 py-2 text-right text-orange-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.cost_m, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(lom.reduce((s, y) => s + y.ebitda_m, 0), 1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{formatDecimalGrouped(totalFcf, 1)}</td>
                    <td className="px-2 py-2 text-right text-mf-txt4">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ PLAN D'EXPLOITATION ═══ */}
        {activeTab === '2 · Conception minière' && (
          <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="flex items-center justify-between">
              <div className="flex rounded-lg overflow-hidden border border-mf-border">
                {(['pits', 'benches', 'equipment', 'plan', '3d'] as const).map(t => (
                  <button key={t} onClick={() => setDesignTab(t)}
                    className={`px-4 py-2 text-xs font-semibold transition-colors ${designTab === t ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
                    {t === 'pits' ? 'Phases Pit' : t === 'benches' ? 'Bancs & Géologie' : t === 'equipment' ? 'Flotte & Équipements' : t === 'plan' ? 'Vue d\'ensemble' : 'Vue 3D'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {designTab === 'pits' && (
                  <button onClick={() => setShowPitForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Nouvelle phase pit
                  </button>
                )}
                {designTab === 'benches' && (
                  <button onClick={() => setShowBenchForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Ajouter banc
                  </button>
                )}
                {designTab === 'equipment' && (
                  <button onClick={() => setShowEquipForm(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={12} /> Planifier équipement
                  </button>
                )}
              </div>
            </div>

            {/* ── Pits tab ── */}
            {designTab === 'pits' && (
              <div className="space-y-3">
                {/* Summary KPIs */}
                {designPits.length > 0 && (
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Phases pit',      val: designPits.length.toString(),                                                             color: 'text-amber-400' },
                      { label: 'Minerai total',    val: `${formatDecimalGrouped(designPits.reduce((s,p)=>s+p.ore_mt,0), 1)} Mt`,                               color: 'text-emerald-400' },
                      { label: 'Stérile total',    val: `${formatDecimalGrouped(designPits.reduce((s,p)=>s+p.waste_mt,0), 1)} Mt`,                             color: 'text-sky-400' },
                      { label: 'RS global',        val: designPits.reduce((s,p)=>s+p.ore_mt,0)>0 ? `${formatDecimalGrouped((designPits.reduce((s,p)=>s+p.waste_mt,0)/designPits.reduce((s,p)=>s+p.ore_mt,0)), 1)}:1` : '—', color: 'text-orange-400' },
                    ].map(k => (
                      <div key={k.label} className="card-sm py-2">
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`text-lg font-bold font-mono ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pit list */}
                {designPits.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                      <MapIcon size={28} className="text-amber-400" />
                    </div>
                    <div className="text-center">
                      <div className="text-sm font-semibold mf-txt mb-1">Aucune phase pit définie</div>
                      <div className="text-xs mf-txt4 max-w-xs">Définissez les phases d'excavation (push-backs), les enveloppes de pit et les paramètres géotechniques.</div>
                    </div>
                    <button onClick={() => setShowPitForm(true)} className="btn btn-teal flex items-center gap-2 text-xs">
                      <Plus size={13} /> Créer la Phase 1
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {designPits.map((pit) => {
                      const benches = designBenches.filter(b => b.pit_id === pit.id);
                      const depth = pit.crest_rl != null && pit.floor_rl != null ? pit.crest_rl - pit.floor_rl : null;
                      const nBenches = depth != null ? Math.floor(depth / pit.bench_height_m) : null;
                      const isSelected = selectedPitId === pit.id;
                      return (
                        <div key={pit.id}
                          className={`card-sm cursor-pointer transition-all ${isSelected ? 'border-amber-400/50 bg-amber-400/5' : 'hover:border-white/15'}`}
                          onClick={() => setSelectedPitId(isSelected ? null : pit.id)}>
                          <div className="flex items-start gap-3">
                            <div className="w-2 self-stretch rounded-full shrink-0 mt-1" style={{ backgroundColor: pit.color, minHeight: 40 }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="text-sm font-semibold mf-txt">{pit.name}</div>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: PIT_STATUS_META[pit.status]?.color + '22', color: PIT_STATUS_META[pit.status]?.color }}>
                                  {PIT_STATUS_META[pit.status]?.label}
                                </span>
                                <span className="text-[10px] mf-txt4">{pit.pit_type === 'open_pit' ? 'Ciel ouvert' : 'Souterrain'}</span>
                              </div>
                              <div className="grid grid-cols-5 gap-3 text-xs">
                                {[
                                  { label: 'Minerai',    val: `${pit.ore_mt} Mt`, sub: `@ ${pit.grade_g_t} g/t` },
                                  { label: 'Stérile',    val: `${pit.waste_mt} Mt`, sub: `RS ${pit.strip_ratio?.toFixed(1)}:1` },
                                  { label: 'Profondeur', val: depth != null ? `${formatDecimalGrouped(depth, 0)} m` : '—', sub: `${pit.crest_rl ?? '?'} → ${pit.floor_rl ?? '?'} mRL` },
                                  { label: 'Talus',      val: `${pit.slope_angle_deg}°`, sub: `Bancs ${pit.bench_height_m}m` },
                                  { label: 'Bancs définis', val: benches.length.toString(), sub: nBenches != null ? `${nBenches} théoriques` : '' },
                                ].map(k => (
                                  <div key={k.label}>
                                    <div className="mf-txt4 text-[10px]">{k.label}</div>
                                    <div className="font-semibold mf-txt font-mono">{k.val}</div>
                                    <div className="text-[10px] mf-txt4">{k.sub}</div>
                                  </div>
                                ))}
                              </div>
                              {pit.notes && <div className="text-[10px] mf-txt4 mt-2 italic">{pit.notes}</div>}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <select value={pit.status} onClick={e => e.stopPropagation()}
                                onChange={e => updateDesignPit(pit.id, { status: e.target.value as DesignPit['status'] })}
                                className="input-field text-[10px] py-0.5 px-1 w-24">
                                {Object.entries(PIT_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select>
                              <button onClick={e => { e.stopPropagation(); deleteDesignPit(pit.id); }}
                                className="text-red-400/50 hover:text-red-400 transition-colors p-1">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Benches tab ── */}
            {designTab === 'benches' && (
              <div className="space-y-3">
                {/* Pit selector */}
                {designPits.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs mf-txt3">Filtrer par pit:</span>
                    <button onClick={() => setSelectedPitId(null)}
                      className={`px-2.5 py-1 rounded text-xs ${selectedPitId == null ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
                      Tous
                    </button>
                    {designPits.map(p => (
                      <button key={p.id} onClick={() => setSelectedPitId(p.id)}
                        className={`px-2.5 py-1 rounded text-xs ${selectedPitId === p.id ? 'text-white' : 'mf-txt3 hover:mf-txt'}`}
                        style={selectedPitId === p.id ? { backgroundColor: p.color + '33', color: p.color } : {}}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Bench section visualization + table */}
                {(() => {
                  const filtered = selectedPitId ? designBenches.filter(b => b.pit_id === selectedPitId) : designBenches;
                  const pit = designPits.find(p => p.id === selectedPitId);
                  if (filtered.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Layers size={28} className="mf-txt4 opacity-30" />
                      <div className="text-xs mf-txt3">Aucun banc — ajoutez des niveaux de bancs pour détailler le plan d'extraction</div>
                    </div>
                  );
                  const maxOre = Math.max(...filtered.map(b => b.ore_mt + b.waste_mt), 1);
                  const minRL = Math.min(...filtered.map(b => b.bench_rl));
                  const maxRL = Math.max(...filtered.map(b => b.bench_rl));
                  return (
                    <div className="grid grid-cols-3 gap-4">
                      {/* Section view */}
                      <div className="card-sm col-span-1">
                        <div className="text-xs font-semibold mf-txt mb-3 flex items-center gap-1.5">
                          <Layers size={12} className="text-amber-400" />
                          Coupe de pit — {filtered.length} bancs
                        </div>
                        <svg viewBox="0 0 220 340" className="w-full">
                          {filtered.map((b, i) => {
                            const yFrac = maxRL === minRL ? 0.5 : (maxRL - b.bench_rl) / (maxRL - minRL);
                            const y = 20 + yFrac * 290;
                            const totalMt = b.ore_mt + b.waste_mt;
                            const oreBarW = totalMt > 0 ? (b.ore_mt / totalMt) * 120 : 0;
                            const wasteBarW = totalMt > 0 ? (b.waste_mt / totalMt) * 120 : 0;
                            const pitCol = pit?.color ?? '#F59E0B';
                            return (
                              <g key={b.id}>
                                <rect x={40} y={y - 7} width={oreBarW} height={12} fill="#10B98144" stroke="#10B981" strokeWidth={0.5} rx={1} />
                                <rect x={40 + oreBarW} y={y - 7} width={wasteBarW} height={12} fill={pitCol + '33'} stroke={pitCol} strokeWidth={0.5} rx={1} />
                                <text x={36} y={y + 3} textAnchor="end" fontSize={7} fill="#ffffffaa">{b.bench_rl}m</text>
                                {b.grade_g_t > 0 && <text x={40 + oreBarW + wasteBarW + 3} y={y + 3} fontSize={6} fill="#10B981aa">{b.grade_g_t}g/t</text>}
                              </g>
                            );
                          })}
                          <text x={105} y={330} textAnchor="middle" fontSize={7} fill="#ffffff30">Tonnage (relative)</text>
                        </svg>
                      </div>
                      {/* Table */}
                      <div className="col-span-2 overflow-x-auto">
                        <table className="tbl w-full text-xs">
                          <thead>
                            <tr>{['RL (mRL)', 'Minerai (Mt)', 'Stérile (Mt)', 'Teneur (g/t)', 'Larg. (m)', 'Long. (m)', 'Schéma tir', 'Explosif', 'Facteur poudre', 'Type minerai', ''].map(h => (
                              <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold whitespace-nowrap">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {filtered.map(b => (
                              <tr key={b.id} className="border-b border-white/5 hover:bg-white/3">
                                <td className="px-2 py-1.5 font-mono font-semibold mf-txt">{b.bench_rl}</td>
                                <td className="px-2 py-1.5 font-mono text-emerald-300">{b.ore_mt}</td>
                                <td className="px-2 py-1.5 font-mono mf-txt3">{b.waste_mt}</td>
                                <td className="px-2 py-1.5 font-mono text-amber-300">{b.grade_g_t > 0 ? b.grade_g_t : '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.width_m ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.length_m ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.blast_pattern ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.explosive_type ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.powder_factor ?? '—'}</td>
                                <td className="px-2 py-1.5 mf-txt3">{b.ore_type ?? '—'}</td>
                                <td className="px-2 py-1.5">
                                  <button onClick={() => deleteDesignBench(b.id)} className="text-red-400/40 hover:text-red-400 transition-colors">
                                    <Trash2 size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Equipment tab ── */}
            {designTab === 'equipment' && (
              <div className="space-y-3">
                {/* Pit filter */}
                {designPits.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs mf-txt3">Filtrer:</span>
                    <button onClick={() => setSelectedPitId(null)} className={`px-2.5 py-1 rounded text-xs ${selectedPitId == null ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>Tous</button>
                    {designPits.map(p => (
                      <button key={p.id} onClick={() => setSelectedPitId(p.id)} className={`px-2.5 py-1 rounded text-xs ${selectedPitId === p.id ? 'text-white' : 'mf-txt3 hover:mf-txt'}`} style={selectedPitId === p.id ? { backgroundColor: p.color + '33', color: p.color } : {}}>{p.name}</button>
                    ))}
                  </div>
                )}

                {/* Equipment schedule table */}
                {(() => {
                  const filtered = selectedPitId ? equipSchedule.filter(e => e.pit_id === selectedPitId) : equipSchedule;
                  if (filtered.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Truck size={28} className="mf-txt4 opacity-30" />
                      <div className="text-xs mf-txt3">Aucun équipement planifié — définissez la flotte minière par année et par phase</div>
                    </div>
                  );
                  // Group by year
                  const yearMap = new Map<number, EquipSchedule[]>();
                  for (const e of filtered) {
                    if (!yearMap.has(e.year)) yearMap.set(e.year, []);
                    yearMap.get(e.year)!.push(e);
                  }
                  const totalAnnualCost = (e: EquipSchedule) => e.quantity * e.hours_year * e.cost_h / 1e6;
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { label: 'Équipements', val: filtered.length.toString(), color: 'text-amber-400' },
                          { label: 'Unités total', val: filtered.reduce((s,e)=>s+e.quantity,0).toString(), color: 'text-sky-400' },
                          { label: 'Coût flotte/an', val: `${formatDecimalGrouped(filtered.reduce((s,e)=>s+totalAnnualCost(e),0), 1)} M$`, color: 'text-emerald-400' },
                        ].map(k => <div key={k.label} className="card-sm py-2"><div className="text-[10px] mf-txt4">{k.label}</div><div className={`text-lg font-bold font-mono ${k.color}`}>{k.val}</div></div>)}
                      </div>
                      {[...yearMap.entries()].sort((a,b)=>a[0]-b[0]).map(([year, items]) => (
                        <div key={year} className="card-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-lg bg-amber-400/15 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-amber-400">{year}</span>
                            </div>
                            <div className="text-xs font-semibold mf-txt">Année {year}</div>
                            <div className="text-[10px] mf-txt4">{items.reduce((s,e)=>s+e.quantity,0)} unités · {formatDecimalGrouped(items.reduce((s,e)=>s+totalAnnualCost(e),0), 2)} M$</div>
                          </div>
                          <div className="space-y-1">
                            {items.map(e => (
                              <div key={e.id} className="flex items-center gap-3 py-1.5 px-2 rounded bg-white/3 text-xs">
                                <Truck size={11} className="text-amber-400 shrink-0" />
                                <span className="font-semibold mf-txt w-32 shrink-0 truncate">{e.equipment_name}</span>
                                <span className="mf-txt4 text-[10px] w-20 shrink-0">{e.equipment_type}</span>
                                <span className="font-mono mf-txt3">{e.quantity}× · {e.hours_year}h/an</span>
                                <span className="font-mono text-emerald-300 ml-auto">{formatDecimalGrouped(totalAnnualCost(e), 2)} M$/an</span>
                                {e.notes && <span className="text-[10px] mf-txt4 italic">{e.notes}</span>}
                                <button onClick={() => deleteEquipSchedule(e.id)} className="text-red-400/40 hover:text-red-400 transition-colors ml-1 shrink-0">
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Plan overview tab ── */}
            {designTab === 'plan' && (
              <div className="space-y-4">
                {/* Timeline Gantt-style */}
                {designPits.length === 0 ? (
                  <div className="text-center mf-txt4 text-xs py-16">Définissez des phases pit pour visualiser le plan d'exploitation</div>
                ) : (() => {
                  const lomLen = Math.max(params?.lom_years ?? 10, 1);
                  const yearCols = Array.from({ length: lomLen }, (_, i) => i + 1);
                  const totalOre = designPits.reduce((s,p)=>s+p.ore_mt,0);
                  const totalWaste = designPits.reduce((s,p)=>s+p.waste_mt,0);
                  const annualMine = params ? annualOreMt : null;

                  return (
                    <div className="space-y-4">
                      {/* Summary bar */}
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          { label: 'Phases pit',     val: designPits.length.toString(),               color: 'text-amber-400' },
                          { label: 'Minerai total',  val: `${formatDecimalGrouped(totalOre, 1)} Mt`,                color: 'text-emerald-400' },
                          { label: 'Stérile total',  val: `${formatDecimalGrouped(totalWaste, 1)} Mt`,              color: 'text-sky-400' },
                          { label: 'RS global',      val: totalOre>0 ? `${formatDecimalGrouped((totalWaste/totalOre), 1)}:1` : '—', color: 'text-orange-400' },
                          { label: 'Extraction/an',  val: annualMine!=null ? `${formatDecimalGrouped(annualMine, 2)} Mt/an` : '—', color: 'text-purple-400' },
                        ].map(k => <div key={k.label} className="card-sm py-2"><div className="text-[10px] mf-txt4">{k.label}</div><div className={`text-base font-bold font-mono ${k.color}`}>{k.val}</div></div>)}
                      </div>

                      {/* Gantt chart */}
                      <div className="card-sm overflow-x-auto">
                        <div className="text-xs font-semibold mf-txt mb-3 flex items-center gap-2">
                          <GitBranch size={13} className="text-amber-400" />
                          Séquencement des phases — LOM {lomLen} ans
                        </div>
                        <div className="min-w-max">
                          {/* Header */}
                          <div className="flex mb-1">
                            <div className="w-40 shrink-0" />
                            {yearCols.map(y => (
                              <div key={y} className="w-12 text-center text-[10px] mf-txt4 font-mono">An {y}</div>
                            ))}
                          </div>
                          {/* Phase rows */}
                          {designPits.map(pit => {
                            const startYear = pit.sequence_order;
                            const pitOrePerYear = annualMine ?? 1;
                            const durationYears = Math.max(1, Math.ceil(pit.ore_mt / Math.max(0.01, pitOrePerYear)));
                            return (
                              <div key={pit.id} className="flex items-center mb-1.5">
                                <div className="w-40 shrink-0 text-xs mf-txt truncate pr-2">{pit.name}</div>
                                {yearCols.map(y => {
                                  const active = y >= startYear && y < startYear + durationYears;
                                  return (
                                    <div key={y} className={`w-12 h-7 border-r border-white/3 ${active ? 'first:rounded-l last:rounded-r' : ''}`}
                                      style={active ? { backgroundColor: pit.color + '40', borderTop: `2px solid ${pit.color}` } : {}}>
                                      {active && y === startYear && (
                                        <div className="text-[8px] px-1 truncate" style={{ color: pit.color }}>{pit.name.substring(0, 6)}</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                          {/* Equipment rows */}
                          {equipSchedule.length > 0 && (
                            <>
                              <div className="text-[10px] mf-txt4 mt-3 mb-1 uppercase tracking-wider">Équipements planifiés</div>
                              {[...new Set(equipSchedule.map(e=>e.equipment_type))].map(type => {
                                const items = equipSchedule.filter(e=>e.equipment_type===type);
                                return (
                                  <div key={type} className="flex items-center mb-1">
                                    <div className="w-40 shrink-0 text-[10px] mf-txt3 truncate pr-2 flex items-center gap-1">
                                      <Truck size={9} /> {type}
                                    </div>
                                    {yearCols.map(y => {
                                      const qty = items.filter(e=>e.year===y).reduce((s,e)=>s+e.quantity,0);
                                      return (
                                        <div key={y} className="w-12 h-7 flex items-center justify-center border-r border-white/3">
                                          {qty > 0 && <span className="text-[9px] font-bold text-sky-300 font-mono">{qty}</span>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Tonnage chart by phase */}
                      <div className="card-sm">
                        <div className="text-xs font-semibold mf-txt mb-3">Tonnage par phase (minerai vs stérile)</div>
                        <svg viewBox="0 0 640 200" className="w-full">
                          {designPits.map((pit, i) => {
                            const bw = 580 / designPits.length;
                            const x = 30 + i * bw + bw * 0.1;
                            const bwInner = bw * 0.8;
                            const maxMt = Math.max(...designPits.map(p => p.ore_mt + p.waste_mt), 1);
                            const wasteH = (pit.waste_mt / maxMt) * 150;
                            const oreH = (pit.ore_mt / maxMt) * 150;
                            return (
                              <g key={pit.id}>
                                <rect x={x} y={160 - wasteH - oreH} width={bwInner * 0.48} height={wasteH} fill={pit.color + '44'} stroke={pit.color} strokeWidth={0.5} rx={1} />
                                <rect x={x + bwInner * 0.52} y={160 - oreH} width={bwInner * 0.48} height={oreH} fill="#10B98155" stroke="#10B981" strokeWidth={0.5} rx={1} />
                                <text x={x + bwInner / 2} y={174} textAnchor="middle" fontSize={7} fill="#ffffffaa">{pit.name.substring(0, 8)}</text>
                              </g>
                            );
                          })}
                          <line x1={25} y1={10} x2={25} y2={165} stroke="#ffffff15" strokeWidth={1} />
                          <line x1={25} y1={165} x2={625} y2={165} stroke="#ffffff15" strokeWidth={1} />
                          <text x={450} y={195} fontSize={8} fill="#ffffff30">Stérile (gauche)  ·  Minerai (droite)</text>
                        </svg>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {designTab === '3d' && (
              <div className="space-y-4">
                {!pitViz || pitViz.surface.length === 0 ? (
                  <div className="card-sm text-center py-16">
                    <MapIcon size={26} className="text-mf-txt4 mx-auto mb-3" />
                    <div className="text-sm font-semibold mf-txt mb-1">Aucune fosse optimisée</div>
                    <div className="text-xs mf-txt4 max-w-md mx-auto">
                      Lancez l'optimisation dans <strong className="mf-txt3">1 · Optimisation fosse</strong> — la vue 3D
                      affiche alors la surface de la fosse ultime (fond de fosse par colonne), issue du modèle de blocs réel.
                    </div>
                  </div>
                ) : (
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-2">Fosse ultime — vue 3D</div>
                    <Pit3D viz={pitViz} />
                    <PitDiagnostic viz={pitViz} />
                  </div>
                )}
              </div>
            )}

            {/* ── Modal: Nouvelle phase pit ── */}
            {showPitForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowPitForm(false)}>
                <div className="card w-[540px] space-y-4 max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><MapIcon size={14} className="text-amber-400" /> Nouvelle phase pit</div>
                    <button onClick={() => setShowPitForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Nom *', key: 'name', type: 'text', placeholder: 'Phase 1 – Pit principal' },
                      { label: 'Type', key: 'pit_type', type: 'select', options: ['open_pit', 'underground'] },
                      { label: 'RL crête (m)', key: 'crest_rl', type: 'number', placeholder: '500' },
                      { label: 'RL fond (m)', key: 'floor_rl', type: 'number', placeholder: '350' },
                      { label: 'Hauteur banc (m)', key: 'bench_height_m', type: 'number', placeholder: '10' },
                      { label: 'Largeur berm (m)', key: 'berm_width_m', type: 'number', placeholder: '8' },
                      { label: 'Angle talus (°)', key: 'slope_angle_deg', type: 'number', placeholder: '45' },
                      { label: 'Minerai (Mt)', key: 'ore_mt', type: 'number', placeholder: '5.0' },
                      { label: 'Stérile (Mt)', key: 'waste_mt', type: 'number', placeholder: '20.0' },
                      { label: 'Teneur (g/t Au)', key: 'grade_g_t', type: 'number', placeholder: '2.5' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(pitForm[f.key as keyof typeof pitForm] as string) ?? ''} onChange={e => setPitForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o} value={o}>{o === 'open_pit' ? 'Ciel ouvert' : 'Souterrain'}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(pitForm[f.key as keyof typeof pitForm] as string | number) ?? ''}
                            onChange={e => setPitForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                    <div className="col-span-2 space-y-1">
                      <label className="mf-txt3 text-[10px] uppercase tracking-wider">Notes</label>
                      <textarea className="input-field w-full text-xs h-16 resize-none" placeholder="Observations géotechniques, contraintes, etc."
                        value={pitForm.notes ?? ''} onChange={e => setPitForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowPitForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addDesignPit} disabled={designSaving || !pitForm.name?.trim()} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Créer phase pit'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Modal: Nouveau banc ── */}
            {showBenchForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowBenchForm(false)}>
                <div className="card w-[500px] space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><Layers size={14} className="text-amber-400" /> Ajouter un banc</div>
                    <button onClick={() => setShowBenchForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {designPits.length > 0 && (
                      <div className="col-span-2 space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">Phase pit</label>
                        <select className="input-field w-full text-xs" value={benchForm.pit_id ?? selectedPitId ?? ''} onChange={e => setBenchForm(prev => ({ ...prev, pit_id: e.target.value || null }))}>
                          <option value="">— Tous les pits —</option>
                          {designPits.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                    {[
                      { label: 'RL Banc (mRL) *', key: 'bench_rl', type: 'number', placeholder: '450' },
                      { label: 'Minerai (Mt)',     key: 'ore_mt',    type: 'number', placeholder: '0.5' },
                      { label: 'Stérile (Mt)',     key: 'waste_mt',  type: 'number', placeholder: '2.0' },
                      { label: 'Teneur Au (g/t)',  key: 'grade_g_t', type: 'number', placeholder: '2.5' },
                      { label: 'Largeur (m)',      key: 'width_m',   type: 'number', placeholder: '200' },
                      { label: 'Longueur (m)',     key: 'length_m',  type: 'number', placeholder: '400' },
                      { label: 'Schéma tir',       key: 'blast_pattern', type: 'text', placeholder: '4x4' },
                      { label: 'Explosif',         key: 'explosive_type', type: 'select', options: EXPLOSIVE_TYPES },
                      { label: 'Facteur poudre',   key: 'powder_factor', type: 'number', placeholder: '0.35' },
                      { label: 'Type minerai',     key: 'ore_type',  type: 'text', placeholder: 'Oxyde / Sulfure' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(benchForm[f.key as keyof typeof benchForm] as string) ?? ''} onChange={e => setBenchForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(benchForm[f.key as keyof typeof benchForm] as string | number) ?? ''}
                            onChange={e => setBenchForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowBenchForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addDesignBench} disabled={designSaving || benchForm.bench_rl == null} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Ajouter banc'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Modal: Planifier équipement ── */}
            {showEquipForm && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowEquipForm(false)}>
                <div className="card w-[480px] space-y-4" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold mf-txt flex items-center gap-2"><Truck size={14} className="text-amber-400" /> Planifier un équipement</div>
                    <button onClick={() => setShowEquipForm(false)} className="mf-txt4 hover:mf-txt"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {[
                      { label: 'Nom équipement *', key: 'equipment_name', type: 'text', placeholder: 'CAT 793D (220t)' },
                      { label: 'Type',             key: 'equipment_type',  type: 'select', options: EQUIP_TYPES },
                      { label: 'Année *',          key: 'year',            type: 'number', placeholder: '1' },
                      { label: 'Quantité',         key: 'quantity',        type: 'number', placeholder: '3' },
                      { label: 'Heures/an',        key: 'hours_year',      type: 'number', placeholder: '6000' },
                      { label: 'Coût/h ($)',       key: 'cost_h',          type: 'number', placeholder: '250' },
                    ].map(f => (
                      <div key={f.key} className="space-y-1">
                        <label className="mf-txt3 text-[10px] uppercase tracking-wider">{f.label}</label>
                        {f.type === 'select' ? (
                          <select className="input-field w-full text-xs" value={(equipForm[f.key as keyof typeof equipForm] as string) ?? ''} onChange={e => setEquipForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                            {f.options?.map(o => <option key={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input type={f.type} className="input-field w-full text-xs" placeholder={f.placeholder}
                            value={(equipForm[f.key as keyof typeof equipForm] as string | number) ?? ''}
                            onChange={e => setEquipForm(prev => ({ ...prev, [f.key]: f.type === 'number' ? (e.target.value === '' ? undefined : parseFloat(e.target.value)) : e.target.value }))} />
                        )}
                      </div>
                    ))}
                    <div className="col-span-2 space-y-1">
                      <label className="mf-txt3 text-[10px] uppercase tracking-wider">Notes</label>
                      <input type="text" className="input-field w-full text-xs" placeholder="Spécifications, fournisseur, etc."
                        value={equipForm.notes ?? ''} onChange={e => setEquipForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowEquipForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                    <button onClick={addEquipSchedule} disabled={designSaving || !equipForm.equipment_name?.trim() || !equipForm.year} className="btn btn-teal text-xs flex items-center gap-1.5">
                      <Save size={12} /> {designSaving ? 'Sauvegarde…' : 'Planifier'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ PIT SHELL & GÉOTECHNIQUE ═══ */}
        {activeTab === '1 · Optimisation fosse' && (
          <div className="space-y-4">
            {blocksLoading ? (
              <div className="card-sm text-center py-12">
                <RefreshCw size={22} className="text-amber-400 mx-auto mb-3 animate-spin" />
                <div className="text-sm font-semibold mf-txt mb-1">Chargement du modèle de blocs…</div>
                <div className="text-xs mf-txt4">Le reste du module reste utilisable pendant ce temps.</div>
              </div>
            ) : blocks.length === 0 ? (
              <div className="card-sm text-center py-12">
                <Mountain size={28} className="text-mf-txt4 mx-auto mb-3" />
                <div className="text-sm font-semibold mf-txt mb-1">Aucun modèle de blocs</div>
                <div className="text-xs mf-txt4 max-w-lg mx-auto">
                  L'optimisation Lerchs-Grossmann s'exécute sur le modèle de blocs du projet.
                  Importez-le dans le module <strong className="mf-txt3">Block Model</strong> — sans lui, l'enveloppe
                  économique ne peut pas être calculée, seulement supposée.
                </div>
              </div>
            ) : (
              <>
                {blocksTruncated && (
                  <div className="p-2.5 rounded-md bg-amber-400/8 border border-amber-400/20 text-xs text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={12} />
                    Modèle tronqué à {MINE_MODEL.MAX_BLOCKS_OPTIMISED.toLocaleString('fr-CA')} blocs pour
                    l'optimisation en navigateur — la fosse affichée ne couvre pas tout le gisement.
                  </div>
                )}

                {/* Optimisation is explicit: nine max-flow solves over the whole
                    model is heavy, synchronous work. Running it automatically froze
                    the tab — the engineer chooses when to pay for it. */}
                <div className="card-sm flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-xs font-semibold mf-txt">
                      {blocks.length.toLocaleString('fr-CA')} blocs chargés
                      {blockSize.x > 0 && ` · ${formatDecimalGrouped(blockSize.x, 0)} × ${formatDecimalGrouped(blockSize.y, 0)} m`}
                    </div>
                    <div className="text-[10px] mf-txt4">
                      {optimising
                        ? `Shell ${optimProgress.done}/${optimProgress.total} — calcul hors du fil d'affichage, la page reste utilisable.`
                        : shells.length
                          ? `${shells.length} shells optimisées${edgeCount ? ` · ${formatDecimalGrouped((edgeCount / 1e6), 1)} M arcs de préséance par shell` : ''} — relancer après un changement d'hypothèse.`
                          : 'L\'optimisation n\'est pas lancée automatiquement : elle est lourde et se lance à la demande.'}
                    </div>
                    {optimising && optimProgress.total > 0 && (
                      <div className="w-64 h-1 bg-white/10 rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-amber-400 transition-all"
                          style={{ width: `${(optimProgress.done / optimProgress.total) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {optimising && (
                      <button onClick={cancelOptimisation} className="btn btn-secondary text-xs">Annuler</button>
                    )}
                    <button onClick={runPitOptimisation} disabled={optimising}
                      className="btn bg-amber-400 text-gray-900 hover:bg-amber-300 font-semibold flex items-center gap-2 disabled:opacity-50">
                      {optimising
                        ? <><RefreshCw size={13} className="animate-spin" /> Optimisation…</>
                        : <><Target size={13} /> {shells.length ? 'Relancer l\'optimisation' : 'Lancer l\'optimisation Lerchs-Grossmann'}</>}
                    </button>
                  </div>
                </div>

                {optimError && (
                  <div className="p-2.5 rounded-md bg-red-400/8 border border-red-400/20 text-xs text-red-300 flex items-center gap-2">
                    <AlertTriangle size={12} /> {optimError}
                  </div>
                )}

                {/* Ultimate pit */}
                {ultimatePit && (
                  <div className="card-sm">
                    <div className="flex items-center gap-2 mb-1">
                      <Target size={12} className="text-emerald-400" />
                      <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Fosse ultime — fermeture maximale (Lerchs-Grossmann)</div>
                    </div>
                    <div className="text-[10px] mf-txt4 mb-3">
                      Optimum <strong className="mf-txt3">prouvé</strong> par coupe minimale sur le graphe de préséance
                      ({blocks.length.toLocaleString('fr-CA')} blocs, talus {params.slope_angle_deg}°) — pas une heuristique.
                      Chaque bloc est valorisé avec la récupération et l'énergie de broyage de <em>son</em> domaine géométallurgique,
                      ce qu'une récupération unique à l'échelle du gisement ne peut pas exprimer.
                    </div>
                    <div className="grid grid-cols-6 gap-3">
                      {[
                        { label: 'Valeur non actualisée', val: `${formatDecimalGrouped((ultimatePit.result.totalValueUsd / 1e6), 1)} M$`, color: 'text-emerald-400' },
                        { label: 'Minerai', val: `${formatDecimalGrouped((ultimatePit.result.oreTonnes / 1e6), 2)} Mt`, color: 'text-amber-400' },
                        { label: 'Stérile', val: `${formatDecimalGrouped((ultimatePit.result.wasteTonnes / 1e6), 2)} Mt`, color: 'mf-txt3' },
                        { label: 'Ratio décapage', val: `${formatDecimalGrouped(ultimatePit.result.strippingRatio, 2)}:1`, color: 'text-sky-400' },
                        { label: 'Onces contenues', val: `${formatDecimalGrouped((ultimatePit.result.containedOz / 1000), 0)} koz`, color: 'mf-txt3' },
                        { label: 'Onces récupérables', val: `${formatDecimalGrouped((ultimatePit.result.recoveredOz / 1000), 0)} koz`, color: 'text-amber-400' },
                      ].map(k => (
                        <div key={k.label}>
                          <div className="text-[10px] mf-txt4">{k.label}</div>
                          <div className={`text-lg font-bold ${k.color}`}>{k.val}</div>
                        </div>
                      ))}
                    </div>
                    {p?.reserves_mt != null && ultimatePit.result.oreTonnes > 0 && (() => {
                      const optMt = ultimatePit.result.oreTonnes / 1e6;
                      const drift = Math.abs(p.reserves_mt - optMt) / optMt > 0.1;
                      return (
                        <div className={`text-[10px] mt-2 ${drift ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {drift ? '⚠' : '✓'} Réserves saisies {formatDecimalGrouped(p.reserves_mt, 1)} Mt vs. fosse optimale {formatDecimalGrouped(optMt, 2)} Mt.
                          {drift && ' Le plan LOM utilise les réserves saisies — les aligner sur la fosse optimisée.'}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Nested shells */}
                {shells.length > 0 && (
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Shells économiques emboîtées</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Une optimisation par facteur de revenu. Les shells basses révèlent le cœur à haute valeur qui se paie
                    en premier — elles deviennent la séquence de pushbacks de l'étape 3.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="tbl w-full text-xs">
                      <thead>
                        <tr>
                          {['Facteur', 'Prix Au', 'Blocs', 'Minerai (Mt)', 'Stérile (Mt)', 'RS', 'koz récup.', 'Valeur (M$)'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shells.map(s => {
                          const isBase = Math.abs(s.revenueFactor - 1) < 1e-9;
                          return (
                            <tr key={s.revenueFactor} className={`border-b border-white/5 ${isBase ? 'bg-amber-400/5' : ''}`}>
                              <td className={`px-3 py-1.5 font-mono ${isBase ? 'text-amber-400 font-bold' : 'mf-txt3'}`}>
                                {formatDecimalGrouped(s.revenueFactor, 2)}{isBase ? ' ★' : ''}
                              </td>
                              <td className="px-3 py-1.5 mf-txt3">${formatDecimalGrouped(s.goldPriceUsdOz, 0)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{s.result.blocksInPit.toLocaleString('fr-CA')}</td>
                              <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped((s.result.oreTonnes / 1e6), 2)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((s.result.wasteTonnes / 1e6), 2)}</td>
                              <td className="px-3 py-1.5 text-sky-400">{formatDecimalGrouped(s.result.strippingRatio, 2)}</td>
                              <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped((s.result.recoveredOz / 1000), 0)}</td>
                              <td className="px-3 py-1.5 font-bold text-emerald-400">{formatDecimalGrouped((s.result.totalValueUsd / 1e6), 1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                )}

                {/* Pit shell cross-section */}
                {pitViz && pitViz.section.some(s => s.floorByI.some(v => v !== null)) && (
                  <div className="card-sm">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-2">Coupe des shells (Pit Shell)</div>
                    <PitSection viz={pitViz} />
                  </div>
                )}

                {/* Geotech */}
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Paramètres géotechniques</div>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Angle de talus', val: `${params.slope_angle_deg}°`, sub: 'Contraint la préséance' },
                      { label: 'Hauteur de banc', val: `${params.bench_height_m} m`, sub: 'Résolution du cône' },
                      { label: 'Taille de bloc', val: `${formatDecimalGrouped(blockSize.x, 0)} × ${formatDecimalGrouped(blockSize.y, 0)} m`, sub: 'Lue du modèle' },
                      { label: 'Niveaux du cône', val: `${MINE_MODEL.CONE_LEVELS}`, sub: 'Bancs de préséance' },
                    ].map(g => (
                      <div key={g.label}>
                        <div className="text-[10px] mf-txt4">{g.label}</div>
                        <div className="text-lg font-bold mf-txt">{g.val}</div>
                        <div className="text-[9px] mf-txt4">{g.sub}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === '4 · Planification tactique' && (
          <div className="space-y-4">
            {!planYear ? (
              <div className="card-sm text-center py-10 text-sm mf-txt4">Le plan stratégique (étape 3) doit exister d'abord.</div>
            ) : (
              <>
                <div className="card-sm">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Calendrier d'exploitation</div>
                    {([
                      ['Année du plan', tacticalYear, (v: number) => setTacticalYear(v), 1, lom.length],
                      ['Jours/an', cal.daysPerYear, (v: number) => setCal(c => ({ ...c, daysPerYear: v })), 1, 366],
                      ['Quarts/jour', cal.shiftsPerDay, (v: number) => setCal(c => ({ ...c, shiftsPerDay: v })), 1, 4],
                      ['Heures/quart', cal.hoursPerShift, (v: number) => setCal(c => ({ ...c, hoursPerShift: v })), 1, 24],
                    ] as [string, number, (v: number) => void, number, number][]).map(([label, val, set, min, max]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span className="text-[10px] mf-txt4">{label}</span>
                        <input type="number" min={min} max={max} value={val}
                          onChange={e => set(Math.max(min, Math.min(max, +e.target.value || min)))}
                          className="input-field text-xs w-16 py-0.5 text-right" />
                      </div>
                    ))}
                    <span className="text-[10px] mf-txt4">
                      → {(cal.daysPerYear * cal.shiftsPerDay * cal.hoursPerShift).toLocaleString('fr-CA')} h/an opérationnelles
                    </span>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plan trimestriel — an {planYear.year}</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Désagrégation du plan annuel : les trimestres bouclent exactement sur l'année, par construction.
                    La saisonnalité redistribue le tonnage sans changer le total.
                  </div>
                  <div className="overflow-x-auto">
                    <table className="tbl w-full text-xs">
                      <thead><tr>{['Trimestre', 'Saisonnalité', 'Jours', 'Minerai (Mt)', 'Stérile (Mt)', 'Total (Mt)', 'Teneur', 'koz'].map(h => (
                        <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                      <tbody>
                        {quarters.map((q, i) => (
                          <tr key={q.label} className="border-b border-white/5">
                            <td className="px-3 py-1.5 font-semibold mf-txt">{q.label}</td>
                            <td className="px-3 py-1.5">
                              <input type="number" step="0.1" min="0" value={seasonality[i] ?? 1}
                                onChange={e => setSeasonality(prev => prev.map((v, n) => n === i ? (+e.target.value || 0) : v))}
                                className="input-field text-xs w-14 py-0.5 text-right" />
                            </td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.days, 0)}</td>
                            <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(q.oreMt, 2)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.wasteMt, 2)}</td>
                            <td className="px-3 py-1.5 font-semibold mf-txt">{formatDecimalGrouped(q.totalMt, 2)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(q.gradeGt, 2)} g/t</td>
                            <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(q.ozK, 1)}</td>
                          </tr>
                        ))}
                        <tr className="bg-white/4">
                          <td className="px-3 py-1.5 font-bold mf-txt" colSpan={3}>Total an {planYear.year}</td>
                          <td className="px-3 py-1.5 font-bold text-amber-400">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.oreMt, 0), 2)}</td>
                          <td className="px-3 py-1.5 font-bold mf-txt3">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.wasteMt, 0), 2)}</td>
                          <td className="px-3 py-1.5 font-bold mf-txt">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.totalMt, 0), 2)}</td>
                          <td />
                          <td className="px-3 py-1.5 font-bold text-amber-400">{formatDecimalGrouped(quarters.reduce((s2, q) => s2 + q.ozK, 0), 1)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-3">Plan mensuel — an {planYear.year}</div>
                  {/* items-stretch, not items-end: the columns must take the chart's
                      height, otherwise the bar's percentage height resolves against an
                      auto-height parent and collapses to zero — labels render, bars do not. */}
                  <div className="flex items-stretch gap-1 h-24">
                    {(() => {
                      const mx = Math.max(...months.map(x => x.totalMt), 0.001);
                      return months.map(m => (
                        <div key={m.label} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                          <div className="text-[8px] mf-txt4">{formatDecimalGrouped(m.totalMt, 1)}</div>
                          <div className="w-full flex-1 flex items-end">
                            <div className="w-full rounded-t bg-gradient-to-t from-amber-600 to-amber-400"
                              style={{ height: `${Math.max((m.totalMt / mx) * 100, m.totalMt > 0 ? 2 : 0)}%` }}
                              title={`${m.label} — ${formatDecimalGrouped(m.totalMt, 2)} Mt`} />
                          </div>
                          <div className="text-[8px] mf-txt4">{m.label}</div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Allocation des équipements — an {planYear.year}</div>
                  {impliedCapacity.length === 0 ? (
                    <div className="text-[10px] mf-txt4 py-3">
                      Aucun équipement planifié pour cette année. Renseignez le calendrier de flotte dans
                      <strong className="mf-txt3"> 2 · Conception minière</strong>.
                    </div>
                  ) : (
                    <>
                      <div className="text-[10px] mf-txt4 mb-3">
                        La capacité machine n'est pas stockée dans le calendrier de flotte : plutôt que de l'inventer, la colonne
                        <strong className="mf-txt3"> capacité implicite</strong> montre le t/h que chaque unité doit tenir pour livrer
                        l'année avec les heures engagées. Saisissez la capacité réelle pour obtenir le besoin en unités.
                      </div>
                      <div className="flex items-center gap-3 mb-2">
                        {([['Disponibilité (%)', 'availabilityPct'], ['Utilisation (%)', 'utilisationPct']] as const).map(([label, key]) => (
                          <div key={key} className="flex items-center gap-1.5">
                            <span className="text-[10px] mf-txt4">{label}</span>
                            <input type="number" min="1" max="100" value={fleetDerate[key]}
                              onChange={e => setFleetDerate(d => ({ ...d, [key]: +e.target.value || 1 }))}
                              className="input-field text-xs w-14 py-0.5 text-right" />
                          </div>
                        ))}
                      </div>
                      <div className="overflow-x-auto">
                        <table className="tbl w-full text-xs">
                          <thead><tr>{['Équipement', 'Unités', 'h/an', 'Capacité implicite', 'Capacité réelle (t/h)', 'Unités requises', 'Écart', 'Coût M$/an'].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                          <tbody>
                            {impliedCapacity.map((e, i) => {
                              const req = fleetForQuarter[i];
                              const cap = fleetCapacity[e.equipment.split(' — ')[0]] ?? 0;
                              return (
                                <tr key={e.equipment} className="border-b border-white/5">
                                  <td className="px-3 py-1.5 mf-txt">{e.equipment}</td>
                                  <td className="px-3 py-1.5 mf-txt3">{e.units}</td>
                                  <td className="px-3 py-1.5 mf-txt3">{e.hoursYear.toLocaleString('fr-CA')}</td>
                                  <td className="px-3 py-1.5 font-semibold text-sky-400">{formatDecimalGrouped(e.impliedTph, 0)} t/h</td>
                                  <td className="px-3 py-1.5">
                                    <input type="number" min="0" value={cap || ''} placeholder="—"
                                      onChange={ev => setFleetCapacity(m => ({ ...m, [e.equipment.split(' — ')[0]]: +ev.target.value || 0 }))}
                                      className="input-field text-xs w-20 py-0.5 text-right" />
                                  </td>
                                  <td className="px-3 py-1.5 font-semibold mf-txt">{cap > 0 && req ? formatDecimalGrouped(req.unitsRequired, 1) : '—'}</td>
                                  <td className={`px-3 py-1.5 font-semibold ${cap > 0 && req && req.gapUnits > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {cap > 0 && req ? (req.gapUnits > 0 ? `−${formatDecimalGrouped(req.gapUnits, 1)}` : '✓') : '—'}
                                  </td>
                                  <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(e.annualCostM, 2)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === '5 · Planification opérationnelle' && (
          <div className="space-y-4">
            {!daily || !planYear ? (
              <div className="card-sm text-center py-10 text-sm mf-txt4">Le plan stratégique (étape 3) doit exister d'abord.</div>
            ) : (
              <>
                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plans hebdomadaire & journalier — an {planYear.year}, {currentMonth?.label}</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Dérivés du plan mensuel, lui-même dérivé de l'année : les horizons ne peuvent pas diverger entre eux.
                  </div>
                  <div className="grid grid-cols-6 gap-3">
                    {[
                      { label: 'Minerai / semaine', val: `${formatDecimalGrouped((weekly!.oreMt * 1e6 / 1000), 1)} kt`, color: 'text-amber-400' },
                      { label: 'Stérile / semaine', val: `${formatDecimalGrouped((weekly!.wasteMt * 1e6 / 1000), 1)} kt`, color: 'mf-txt3' },
                      { label: 'Total / semaine', val: `${formatDecimalGrouped((weekly!.totalMt * 1e6 / 1000), 1)} kt`, color: 'mf-txt' },
                      { label: 'Minerai / jour', val: `${(daily.oreMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'text-amber-400' },
                      { label: 'Stérile / jour', val: `${(daily.wasteMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'mf-txt3' },
                      { label: 'Total / jour', val: `${(daily.totalMt * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 })} t`, color: 'mf-txt' },
                    ].map(k => (
                      <div key={k.label}>
                        <div className="text-[10px] mf-txt4">{k.label}</div>
                        <div className={`text-base font-bold ${k.color}`}>{k.val}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card-sm">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider mb-1">Plan de forage & sautage — journalier</div>
                  <div className="text-[10px] mf-txt4 mb-3">
                    Déduit de la géométrie du patron : chaque trou couvre banlieue × espacement × hauteur de banc de roche,
                    donc le tonnage fixe le nombre de trous, et les trous fixent les mètres et l'explosif.
                    Densité lue du modèle de blocs ({blocks.length ? formatDecimalGrouped(blocks[0].density, 2) : '2.70'} t/m³).
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mb-3">
                    {([
                      ['Banlieue (m)', 'burdenM'], ['Espacement (m)', 'spacingM'],
                      ['Sur-forage (m)', 'subDrillM'], ['Facteur poudre (kg/t)', 'powderFactorKgT'],
                      ['Tonnes/sautage', 'tonnesPerBlast'],
                    ] as const).map(([label, key]) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-[10px] mf-txt4">{label}</span>
                        <input type="number" step="0.01" min="0" value={dbCfg[key]}
                          onChange={e => setDbCfg(c => ({ ...c, [key]: +e.target.value || 0 }))}
                          className="input-field text-xs w-20 py-0.5 text-right" />
                      </div>
                    ))}
                    <span className="text-[10px] mf-txt4">Hauteur de banc {p?.bench_height_m} m (étape 2)</span>
                  </div>
                  {blastPlan && (
                    <div className="grid grid-cols-6 gap-3">
                      {[
                        { label: 'Volume à abattre', val: `${blastPlan.volumeM3.toLocaleString('fr-CA', { maximumFractionDigits: 0 })} m³` },
                        { label: 'Trous de mine', val: formatDecimalGrouped(blastPlan.holes, 0) },
                        { label: 'Mètres forés', val: `${blastPlan.drillMetres.toLocaleString('fr-CA', { maximumFractionDigits: 0 })} m` },
                        { label: 'Explosif', val: `${formatDecimalGrouped((blastPlan.explosiveKg / 1000), 1)} t` },
                        { label: 'Sautages', val: formatDecimalGrouped(blastPlan.blasts, 2) },
                        { label: 'Mètres/trou', val: `${formatDecimalGrouped((p!.bench_height_m + dbCfg.subDrillM), 1)} m` },
                      ].map(k => (
                        <div key={k.label}>
                          <div className="text-[10px] mf-txt4">{k.label}</div>
                          <div className="text-base font-bold text-sky-400">{k.val}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === '6 · Chaîne de valeur' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              {scenarios.map(sc => (
                <div
                  key={sc.id}
                  onClick={() => setSelectedScenario(sc.id)}
                  className={`card-sm cursor-pointer transition-all border-2 ${selectedScenario === sc.id ? 'border-amber-500/50 bg-amber-400/5' : 'border-transparent hover:border-white/10'}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-start gap-2">
                      <div className="w-3 h-3 rounded-full mt-1 shrink-0" style={{ background: sc.color }} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-mf-txt text-sm">{sc.name}</span>
                          {sc.recommended && <span className="text-[10px] bg-amber-400/15 text-amber-300 border border-amber-400/25 px-1.5 py-0.5 rounded">★</span>}
                        </div>
                        <div className="text-xs text-mf-txt4 mt-0.5">{sc.description}</div>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedScenario === sc.id ? 'border-amber-500 bg-amber-500' : 'border-white/20'}`}>
                      {selectedScenario === sc.id && <div className="w-2 h-2 rounded-full bg-gray-900" />}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'VAN₁₀', val: `${formatDecimalGrouped(sc.npv_musd, 0)} M$`, color: sc.npv_musd >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'TRI', val: sc.irr_pct != null ? `${formatDecimalGrouped(sc.irr_pct, 1)}%` : '—', color: 'text-sky-400' },
                      { label: 'Retour', val: `${formatDecimalGrouped(sc.payback_years, 1)} ans`, color: 'text-amber-400' },
                      { label: 'AISC', val: `$${formatDecimalGrouped(sc.aisc, 0)}/oz`, color: 'text-purple-400' },
                    ].map(kpi => (
                      <div key={kpi.label} className="bg-white/5 rounded-lg p-2 text-center">
                        <div className={`text-sm font-bold font-mono ${kpi.color}`}>{kpi.val}</div>
                        <div className="text-[10px] text-mf-txt4">{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex gap-4 text-xs text-mf-txt4 flex-wrap">
                    <span>RS: {formatDecimalGrouped(sc.stripping_ratio, 1)}:1</span>
                    <span>Talus: {sc.slope_angle_deg}°</span>
                    <span>LOM: {sc.lom_years} ans</span>
                    <span>Réserves: {formatDecimalGrouped(sc.reserves_mt, 1)} Mt</span>
                    <span>CAPEX: {formatDecimalGrouped(sc.capex_m, 0)} M$</span>
                    <span>Oz/an: {formatDecimalGrouped((sc.annual_oz / 1000), 0)} koz</span>
                  </div>
                </div>
              ))}
            </div>

            {/* VAN waterfall */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Décomposition VAN — Base Case</div>
              {chosen && (() => {
                const capexM = chosen.capex_m;
                const annualOz = chosen.annual_oz;
                const grossRevM = (annualOz * mine.goldPriceUsdOz.value / 1e6) * chosen.lom_years;
                const royaltiesM = grossRevM * mine.royaltyPct.value / 100;
                const opexM = (mine.processCostUsdT.value * params.reserves_mt * 1e6 / 1e6);
                const mineM = (params.mining_cost_t * params.reserves_mt * (1 + params.stripping_ratio) * 1e6 / 1e6);
                const bars = [
                  { label: 'Rev. bruts', val: grossRevM, color: '#10B981', positive: true },
                  { label: 'Redevances', val: -royaltiesM, color: '#F06B6B', positive: false },
                  { label: 'Opex traitement', val: -opexM, color: '#F59E0B', positive: false },
                  { label: 'Coûts miniers', val: -mineM, color: '#F59E0B', positive: false },
                  { label: 'G&A total', val: -(params.ga_cost_m * chosen.lom_years), color: '#8B5CF6', positive: false },
                  { label: 'Pompage', val: -(params.pump_cost_m * chosen.lom_years), color: '#8B5CF6', positive: false },
                  { label: 'CAPEX initial', val: -capexM, color: '#F06B6B', positive: false },
                  { label: 'VAN₁₀', val: chosen.npv_musd, color: chosen.npv_musd >= 0 ? '#10B981' : '#F06B6B', positive: chosen.npv_musd >= 0 },
                ];
                const maxAbs = Math.max(...bars.map(b => Math.abs(b.val)), 1);
                return (
                  <div className="space-y-2">
                    {bars.map(b => (
                      <div key={b.label} className="flex items-center gap-3 text-xs">
                        <div className="w-28 text-mf-txt3 text-right shrink-0">{b.label}</div>
                        <div className="flex-1 relative h-5">
                          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10" />
                          <div
                            className="absolute top-0.5 h-4 rounded"
                            style={{
                              [b.positive ? 'left' : 'right']: '50%',
                              width: `${(Math.abs(b.val) / maxAbs) * 48}%`,
                              background: b.color,
                              opacity: 0.75,
                            }}
                          />
                        </div>
                        <div className="w-24 font-mono font-semibold shrink-0 text-right" style={{ color: b.color }}>
                          {b.positive ? '+' : ''}{formatDecimalGrouped(b.val, 0)} M$
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ═══ RISQUES & SENSIBILITÉ ═══ */}
        {activeTab === '7 · Simulation & scénarios' && (
          <div className="space-y-5">
            {/* Sensitivity selector */}
            <div className="card-sm">
              <div className="flex items-center gap-4 mb-4">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Analyse de sensibilité — VAN₁₀</div>
                <div className="flex gap-2 ml-auto">
                  {([
                    { id: 'gold_price', label: 'Prix Or' },
                    { id: 'stripping', label: 'RS' },
                    { id: 'grade', label: 'Teneur' },
                    { id: 'opex', label: 'OpEx' },
                    { id: 'recovery', label: 'Récup.' },
                  ] as { id: typeof sensitivityParam; label: string }[]).map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setSensitivityParam(opt.id)}
                      className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${sensitivityParam === opt.id ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-white/5 text-mf-txt3 hover:bg-white/8'}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <svg viewBox="0 0 640 220" className="w-full">
                {[0, 0.25, 0.5, 0.75, 1].map(f => (
                  <line key={f} x1={60} y1={10 + f * 170} x2={620} y2={10 + f * 170} stroke="#ffffff08" strokeWidth={1} />
                ))}
                {sensitivityRows.map((r, i) => {
                  const bw = 560 / sensitivityRows.length;
                  const x = 60 + i * bw;
                  const maxNpv = Math.max(...sensitivityRows.map(s => Math.abs(s.npv)), 1);
                  const mid = 10 + 85;
                  const h = (Math.abs(r.npv) / maxNpv) * 85;
                  return (
                    <g key={i}>
                      <rect
                        x={x + 4} y={r.npv >= 0 ? mid - h : mid} width={bw - 8} height={h}
                        rx={2} fill={r.npv >= 0 ? '#10B981' : '#F06B6B'} opacity={0.8}
                      />
                      <text x={x + bw / 2} y={210} fill="#6B7280" fontSize={9} textAnchor="middle">{r.pct > 0 ? '+' : ''}{r.pct}%</text>
                      <text x={x + bw / 2} y={r.npv >= 0 ? mid - h - 4 : mid + h + 12} fill="#9CA3AF" fontSize={8} textAnchor="middle">{formatDecimalGrouped(r.npv, 0)}</text>
                    </g>
                  );
                })}
                <line x1={60} y1={95} x2={620} y2={95} stroke="#ffffff30" strokeWidth={1} strokeDasharray="4 2" />
                <text x={10} y={99} fill="#6B7280" fontSize={8}>0</text>
                <text x={320} y={218} fill="#6B7280" fontSize={9} textAnchor="middle">Variation paramètre (%)</text>
              </svg>
            </div>

            {/* Risk register */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Registre des risques miniers</div>
              <div className="space-y-2">
                {[
                  { cat: 'Géotechnique', risk: 'Glissement de talus phase 3', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Études renforcement / filets + drains horizontaux' },
                  { cat: 'Hydrogéologie', risk: 'Débit d\'eau supérieur aux estimations', prob: 'Faible', impact: 'Moyen', level: 'medium', mitigation: 'Système pompage dimensionné ×1.5 · monitoring piézométrique' },
                  { cat: 'Ressources', risk: 'Dégradation teneur sous CoG', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Forage infill 25m × 25m avant mining · contrôle grade en temps réel' },
                  { cat: 'Économique', risk: 'Baisse prix or sous AISC', prob: 'Faible', impact: 'Critique', level: 'high', mitigation: 'Couverture (hedging) 30% production années 1–3' },
                  { cat: 'Environnement', risk: 'Contamination acide (DMA)', prob: 'Moyen', impact: 'Élevé', level: 'high', mitigation: 'Test NP/PA · co-disposal stériles réactifs avec calcaire' },
                  { cat: 'Réglementaire', risk: 'Retard obtention permis', prob: 'Faible', impact: 'Moyen', level: 'medium', mitigation: 'Plan de consultation communautaire précoce · ESIA phase 2' },
                  { cat: 'Opérationnel', risk: 'Disponibilité flotte < 85%', prob: 'Faible', impact: 'Faible', level: 'low', mitigation: 'Contrat full-service OEM · stock pièces critiques 90 jours' },
                  { cat: 'Géopolitique', risk: 'Instabilité fiscale / redevances', prob: 'Faible', impact: 'Élevé', level: 'medium', mitigation: 'Convention minière stabilitéclause · arbitrage CIRDI' },
                ].map(r => (
                  <div key={r.risk} className="flex items-start gap-3 p-3 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                    <div className={`mt-0.5 shrink-0 w-2 h-2 rounded-full ${r.level === 'high' ? 'bg-red-500' : r.level === 'medium' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-mf-txt">{r.risk}</span>
                        <span className="text-[10px] text-mf-txt4 bg-white/5 px-1.5 py-0.5 rounded">{r.cat}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${r.level === 'high' ? 'bg-red-500/15 text-red-400' : r.level === 'medium' ? 'bg-amber-500/15 text-amber-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
                          {r.prob} × {r.impact}
                        </span>
                      </div>
                      <div className="text-xs text-mf-txt4 mt-1">{r.mitigation}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ RAPPORT EXÉCUTIF ═══ */}
        {activeTab === '8 · Suivi & réconciliation' && (
          <div className="space-y-4">
            <div className="card-sm">
              <div className="flex items-center gap-2 mb-1">
                <Activity size={12} className="text-violet-400" />
                <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Réconciliation Mine — Modèle — Usine (F1 / F2 / F3)</div>
              </div>
              <div className="text-[10px] mf-txt4 mb-3">
                Le standard de l'industrie pour savoir si le modèle de ressources dit la vérité.
                <strong className="mf-txt3"> F1 = Mine ÷ Modèle</strong> : le modèle prédit-il ce qu'on extrait ?
                <strong className="mf-txt3"> F2 = Usine ÷ Mine</strong> : la mine livre-t-elle ce qu'elle annonce ?
                <strong className="mf-txt3"> F3 = F1 × F2</strong> : le facteur de bout en bout. Un F3 à 1,15 sur les onces
                signifie un modèle systématiquement optimiste — et tout plan bâti dessus hérite du biais.
              </div>

              <div className="p-2.5 rounded-md bg-sky-400/8 border border-sky-400/20 text-[10px] text-sky-300 mb-3 flex items-start gap-2">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                <span>
                  Aucune table de production réelle n'existe dans la base : les valeurs mesurées sont saisies ici et
                  ne sont pas persistées. Une table <code>mine_production_actuals</code> (tonnes/teneur par période,
                  à la mine et à l'usine) rendrait ce suivi durable et automatisable.
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <div className="text-[10px] font-semibold mf-txt3 uppercase mb-1.5">Modèle (plan an {planYear?.year ?? '—'})</div>
                  <div className="text-xs mf-txt4">Tonnes : <strong className="mf-txt">{planYear ? (planYear.ore * 1e6).toLocaleString('fr-CA', { maximumFractionDigits: 0 }) : '—'}</strong></div>
                  <div className="text-xs mf-txt4">Teneur : <strong className="mf-txt">{planYear ? formatDecimalGrouped(planYear.grade, 2) : '—'} g/t</strong></div>
                  <div className="text-[9px] mf-txt4 mt-1">↓ Importé du plan stratégique</div>
                </div>
                {([
                  ['Mine (réel)', 'mineTonnes', 'mineGrade'],
                  ['Usine (réel)', 'plantTonnes', 'plantGrade'],
                ] as const).map(([label, tKey, gKey]) => (
                  <div key={label}>
                    <div className="text-[10px] font-semibold mf-txt3 uppercase mb-1.5">{label}</div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] mf-txt4 w-12">Tonnes</span>
                      <input type="number" min="0" value={actuals[tKey] || ''} placeholder="—"
                        onChange={e => setActuals(a => ({ ...a, [tKey]: +e.target.value || 0 }))}
                        className="input-field text-xs w-28 py-0.5 text-right" />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] mf-txt4 w-12">Teneur</span>
                      <input type="number" step="0.01" min="0" value={actuals[gKey] || ''} placeholder="—"
                        onChange={e => setActuals(a => ({ ...a, [gKey]: +e.target.value || 0 }))}
                        className="input-field text-xs w-28 py-0.5 text-right" />
                    </div>
                  </div>
                ))}
              </div>

              {!hasActuals ? (
                <div className="text-[10px] mf-txt4 py-2">Saisissez les tonnes et teneurs réelles pour calculer les facteurs.</div>
              ) : reconciliation && (
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead><tr>{['Facteur', 'Tonnes', 'Teneur', 'Onces', 'Verdict'].map(h => (
                      <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>))}</tr></thead>
                    <tbody>
                      {([
                        ['F1 — Mine ÷ Modèle', reconciliation.f1Tonnes, reconciliation.f1Grade, reconciliation.f1Ounces],
                        ['F2 — Usine ÷ Mine', reconciliation.f2Tonnes, reconciliation.f2Grade, reconciliation.f2Ounces],
                        ['F3 — Usine ÷ Modèle', reconciliation.f3Tonnes, reconciliation.f3Grade, reconciliation.f3Ounces],
                      ] as [string, number | null, number | null, number | null][]).map(([label, t, g, o]) => {
                        const v = reconVerdict(o);
                        const cls = v === 'ok' ? 'text-emerald-400' : v === 'warn' ? 'text-amber-400' : v === 'bad' ? 'text-red-400' : 'mf-txt4';
                        const fmt = (x: number | null) => (x != null && Number.isFinite(x) ? formatDecimalGrouped(x, 3) : '—');
                        return (
                          <tr key={label} className="border-b border-white/5">
                            <td className="px-3 py-1.5 font-semibold mf-txt">{label}</td>
                            <td className="px-3 py-1.5 mf-txt3">{fmt(t)}</td>
                            <td className="px-3 py-1.5 mf-txt3">{fmt(g)}</td>
                            <td className={`px-3 py-1.5 font-bold ${cls}`}>{fmt(o)}</td>
                            <td className={`px-3 py-1.5 ${cls}`}>
                              {v === 'ok' ? '✓ Dans la tolérance ±5 %' : v === 'warn' ? '⚠ Écart 5–10 %' : v === 'bad' ? '✗ Écart > 10 %' : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {reconVerdict(reconciliation.f1Grade) === 'bad' && (
                    <div className="text-[10px] text-red-300 mt-2">
                      La teneur extraite s'écarte de plus de 10 % du modèle — vérifier la dilution, le contrôle de teneur
                      et l'estimation avant de rebâtir un plan sur ce modèle.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === '8 · Suivi & réconciliation' && chosen && (
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 space-y-4">
              {/* Recommendation */}
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Recommandation — Plan minier retenu</div>
                <div className="p-4 rounded-lg bg-amber-400/8 border border-amber-400/20 mb-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 size={16} className="text-amber-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-mf-txt mb-1">Scénario Base Case — Recommandé</div>
                      <div className="text-xs text-mf-txt3 leading-relaxed">
                        Le scénario Base Case présente le meilleur équilibre VAN/risque. Le pit shell optimisé à ${project.gold_price_usd}/oz
                        avec un talus de {params.slope_angle_deg}° offre {params.reserves_mt} Mt à {formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t Au ({reservesOrigin}).
                        La production annuelle de ~{formatDecimalGrouped((chosen.annual_oz / 1000), 0)} koz sur {chosen.lom_years} ans génère une
                        VAN₁₀ de {formatDecimalGrouped(chosen.npv_musd, 0)} M$ avec un TRI de {chosen.irr_pct != null ? `${formatDecimalGrouped(chosen.irr_pct, 1)}%` : '—'}.
                        L'AISC de ${formatDecimalGrouped(chosen.aisc, 0)}/oz offre une marge opérationnelle robuste face aux cycles du prix de l'or.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Évaluation par domaine</div>
                <div className="space-y-2">
                  {[
                    { label: "Plan d'exploitation",  status: 'ok',   text: `${params.method} · ${chosen.lom_years} ans · ${phases.length > 0 ? `${phases.length} phases séquentielles` : 'phases à définir'}` },
                    { label: 'Géotechnique',          status: 'ok',   text: `Angle global ${params.slope_angle_deg}° · IFS 1.35 statique · Fond fosse –340 m` },
                    { label: 'Hydrogéologie',         status: 'warn', text: 'Déwatering à dimensionner phase 2 — débit estimé 420 m³/h' },
                    { label: 'Flotte minière',        status: 'ok',   text: `${params.trucks} · ${params.shovel} · ${params.drill}` },
                    { label: 'Gestion stériles',      status: 'ok',   text: 'RSF interne phase 1 · Extension externe phases 2–3 · ≥ 500m usine' },
                    { label: 'Gestion eaux & DMA',    status: 'warn', text: 'Tests NP/PA à compléter · Protocole co-disposal à finaliser' },
                    { label: 'Conformité & Permis',   status: 'ok',   text: 'ESIA phase 1 validée · PAE & RCP en cours · Consultation communautaire active' },
                    { label: 'Couverture (hedging)',  status: 'warn', text: 'Couverture 30% production recommandée pour années 1–3' },
                  ].map(pt => (
                    <div key={pt.label} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-white/8">
                      {pt.status === 'ok'
                        ? <CheckCircle2 size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                        : <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />}
                      <div>
                        <div className="text-xs font-semibold text-mf-txt">{pt.label}</div>
                        <div className="text-xs text-mf-txt4">{pt.text}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next steps */}
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Plan d'action — Prochaines étapes</div>
                <div className="space-y-2">
                  {[
                    { priority: '1', step: 'Études géotechniques phase 2 approfondies (forages géoméca.)', timeline: '3 mois' },
                    { priority: '2', step: 'Dimensionnement final système de déwatering + simulation 3D', timeline: '4 mois' },
                    { priority: '3', step: 'Appel d\'offres flotte minière (camions + pelles)', timeline: '6 mois' },
                    { priority: '4', step: 'Mise à jour modèle de blocs — forage infill 25m × 25m', timeline: '8 mois' },
                    { priority: '5', step: 'Validation réserves NI 43-101 / JORC par QP indépendant', timeline: '10 mois' },
                    { priority: '6', step: 'Finalisation ESIA & obtention permis d\'exploitation', timeline: '12 mois' },
                  ].map(s => (
                    <div key={s.priority} className="flex items-center gap-3 p-2.5 rounded-lg border border-white/5">
                      <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-amber-400">{s.priority}</span>
                      </div>
                      <div className="flex-1 text-xs text-mf-txt">{s.step}</div>
                      <div className="text-[10px] text-mf-txt4 shrink-0">{s.timeline}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-3">
              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Indicateurs retenus</div>
                {[
                  ['Réserves',         `${params.reserves_mt} Mt @ ${formatDecimalGrouped(mine.goldGradeGt.value, 2)} g/t (${reservesOrigin})`],
                  ['Dilution minière', `${params.dilution_pct}%`],
                  ['Prod. annuelle',   `${formatDecimalGrouped((chosen.annual_oz / 1000), 0)} koz Au`],
                  ['Prod. totale LOM', `${formatDecimalGrouped(totalOz, 0)} koz Au`],
                  ['VAN₁₀',           `${formatDecimalGrouped(chosen.npv_musd, 0)} M USD`],
                  ['TRI',             chosen.irr_pct != null ? `${formatDecimalGrouped(chosen.irr_pct, 1)}%` : '—'],
                  ['Retour invest.',  `${formatDecimalGrouped(chosen.payback_years, 1)} ans`],
                  ['AISC',            `$${formatDecimalGrouped(chosen.aisc, 0)}/oz`],
                  ['LOM',             `${chosen.lom_years} ans`],
                  ['CAPEX initial',   `${formatDecimalGrouped(chosen.capex_m, 0)} M$`],
                  ['CAPEX soutien',   `${params.sustaining_capex_m} M$/an`],
                  ['Rev. totaux LOM', `${formatDecimalGrouped(totalRev, 0)} M$`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                    <span className="text-mf-txt3">{k}</span>
                    <span className="text-amber-400 font-semibold">{v}</span>
                  </div>
                ))}
              </div>

              <div className="card-sm bg-emerald-400/4 border border-emerald-400/15">
                <div className="flex items-start gap-2">
                  <Activity size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                  <div className="text-xs text-mf-txt3 leading-relaxed">
                    Niveau de confiance global : <strong className="text-emerald-400">PEA / PFS</strong>.
                    Les réserves sont classifiées selon les standards CIM 2019 / NI 43-101.
                    Validation par un QP indépendant requise avant décision d'investissement finale (DIF).
                  </div>
                </div>
              </div>

              <div className="card-sm">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-2">Benchmarks sectoriels</div>
                {[
                  {
                    label: `AISC vs pair ($${benchmarks.aiscUsdOz}/oz)`,
                    val: chosen.aisc < benchmarks.aiscUsdOz ? 'Inférieur au pair ✓' : 'Supérieur au pair',
                    ok: chosen.aisc < benchmarks.aiscUsdOz,
                  },
                  {
                    // The hurdle defaults to the project's own discount rate — a project
                    // that clears its cost of capital is the meaningful test, not a
                    // hardcoded 15 %.
                    label: `TRI vs hurdle (${benchmarks.hurdlePct}%)`,
                    val: chosen.irr_pct == null ? '—' : chosen.irr_pct > benchmarks.hurdlePct ? 'Supérieur au hurdle ✓' : 'Inférieur au hurdle',
                    ok: (chosen.irr_pct ?? 0) > benchmarks.hurdlePct,
                  },
                  {
                    label: `RS vs médiane (${benchmarks.strippingRatio}:1)`,
                    val: params.stripping_ratio < benchmarks.strippingRatio ? 'Favorable ✓' : 'Élevé',
                    ok: params.stripping_ratio < benchmarks.strippingRatio,
                  },
                  { label: 'LOM vs projet', val: chosen.lom_years >= 8 ? 'LOM suffisant ✓' : 'LOM court', ok: chosen.lom_years >= 8 },
                ].map(b => (
                  <div key={b.label} className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                    <span className="text-mf-txt3">{b.label}</span>
                    <span className={b.ok ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>{b.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
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
