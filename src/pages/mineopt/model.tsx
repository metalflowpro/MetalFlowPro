/* eslint-disable react-refresh/only-export-components -- module de types, constantes et calculs de la page (aucun composant d'écran) : le rechargement à chaud n'a pas d'état à préserver ici. */


import type { Project } from '../../types';
import { TROY_OZ_GRAMS } from '../../lib/config/constants';
import { type ResolvedMineParams } from '../../lib/mine/params';

import { irr as computeIrr, npv as computeNpv } from '../../lib/simulation/economics';

/* ─── Types ──────────────────────────────────────────────────────────────── */

/**
 * The module follows the mine-planning workflow end to end: each stage consumes
 * the previous one's output, so a number can never disagree with itself between
 * horizons — the ultimate pit sets the reserves, the reserves set the LOM, the
 * LOM sets the quarter, the quarter sets the day.
 */
export const TABS = [
  'Paramètres du modèle minier',
  '1 · Optimisation fosse',
  '2 · Conception minière',
  '3 · Planification stratégique',
  '4 · Planification tactique',
  '5 · Planification opérationnelle',
  '6 · Chaîne de valeur',
  '7 · Simulation & scénarios',
  '8 · Suivi & réconciliation',
] as const;

export type Tab = typeof TABS[number];

export interface MineParamsRow {
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
export interface BmBlockRow {
  i: number; j: number; k: number; cz: number | string;
  au_g_t: number | string; density: number | string; volume_m3: number | string;
  rock_type: string | null;
}

/** GéoMet domain, reduced to the geometallurgy the mine model consumes. */
export interface GeomDomainRow {
  name: string;
  avg_bwi_kwh_t: number | null;
  recovery_design: number | null;
  lom_pct: number | null;
}

export interface MinePhaseRow {
  id: string; project_id: string;
  phase_name: string; year_start: number; year_end: number;
  zone: string; ore_type: string;
  grade_g_t: number; ore_mt: number; waste_mt: number; color: string;
}

export interface ScenarioRow {
  id: string; name: string; description: string; color: string;
  reserves_mt: number; stripping_ratio: number; slope_angle_deg: number;
  lom_years: number; npv_musd: number;
  /** null when the cash-flow stream has no sign change — no IRR exists. */
  irr_pct: number | null;
  payback_years: number; aisc: number;
  capex_m: number; annual_oz: number; recommended: boolean;
}

export interface DesignPit {
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

export interface DesignBench {
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

export interface EquipSchedule {
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

export const PIT_STATUS_META: Record<string, { label: string; color: string }> = {
  planned:   { label: 'Planifié',   color: '#3B82F6' },
  active:    { label: 'En cours',   color: '#10B981' },
  completed: { label: 'Terminé',    color: '#6B7280' },
  deferred:  { label: 'Reporté',    color: '#F59E0B' },
};

export const EQUIP_TYPES = ['Camion', 'Pelle/Excavatrice', 'Bouteur', 'Foreuse', 'Niveleuse', 'Compacteur', 'Chargeur', 'Arroseur', 'Autre'];

export const EXPLOSIVE_TYPES = ['ANFO', 'Emulsion', 'ANFO lourd', 'Rioflex', 'Autre'];

export const PIT_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#F06B6B', '#8B5CF6', '#06B6D4', '#F88A44', '#84CC16'];

export const TROY = 1 / TROY_OZ_GRAMS;

export const PHASE_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#F06B6B', '#8B5CF6', '#06B6D4'];

/**
 * Gold-price ladder for the pit-shell sweep, as multiples of the project's own
 * price rather than a fixed $1400–$3200 grid — a fixed grid stops straddling the
 * base case as soon as the gold price moves away from it.
 */
const _PIT_PRICE_FACTORS = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.45, 1.6] as const;

/**
 * Shape of the LOM schedule — the mine-plan behaviours that were previously
 * unnamed literals buried in the builder. Each is overridable per project via
 * mine_params where a column exists; the values here are the documented default.
 */
export const MINE_MODEL = {
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
export const DEFAULT_PARAMS: Omit<MineParamsRow, 'id' | 'project_id'> = {
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
export function buildLOM(
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
    const dilutionFactor = 1 + p.dilution_pct / 100;
    // Dilution adds barren tonnes to the recovered ore; it must lower feed grade
    // by the same factor so it cannot create contained gold.
    const grade = mine.goldGradeGt.value * gradeDecay / dilutionFactor;
    const ore = annualOreMt * rampUp * dilutionFactor * (p.ore_recovery_pct / 100);
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
export function buildScenarios(
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
function _MiniSparkline({ values, color, w = 80, h = 28 }: { values: number[]; color: string; w?: number; h?: number }) {
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
