// ─────────────────────────────────────────────────────────────────────────────
// Étapes 4, 5 et 8 — planification tactique, opérationnelle et réconciliation.
//
// The tactical and operational plans are DERIVED from the strategic (LOM) plan
// rather than stored: a monthly plan that can drift from the annual plan it
// belongs to is a reconciliation problem waiting to happen. Disaggregating on
// demand keeps every horizon consistent by construction.
//
// Pure module — no Supabase, no React.
// ─────────────────────────────────────────────────────────────────────────────

/** One year of the strategic plan, as produced by the LOM builder. */
export interface AnnualPlan {
  year: number;
  ore: number;    // Mt
  waste: number;  // Mt
  grade: number;  // g/t
  oz_k: number;
}

export interface CalendarConfig {
  /** Operating days per year — drives every disaggregation below. */
  daysPerYear: number;
  /** Shifts per day and hours per shift, for the operating calendar. */
  shiftsPerDay: number;
  hoursPerShift: number;
}

// ─── Étape 4 — Planification tactique ────────────────────────────────────────

export interface PeriodPlan {
  label: string;
  index: number;
  oreMt: number;
  wasteMt: number;
  totalMt: number;
  gradeGt: number;
  ozK: number;
  days: number;
}

/**
 * Split a year into periods (quarters, months…).
 *
 * `seasonality` re-weights periods without changing the annual total — a northern
 * pit does not move the same tonnage in January as in July, but the year must
 * still tie back to the strategic plan.
 */
export function disaggregateYear(
  y: AnnualPlan,
  periods: number,
  labels: string[],
  cfg: CalendarConfig,
  seasonality?: number[],
): PeriodPlan[] {
  const weights = seasonality && seasonality.length === periods
    ? seasonality
    : Array(periods).fill(1);
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;

  return Array.from({ length: periods }, (_, i) => {
    const share = weights[i] / wSum;
    const oreMt = y.ore * share;
    const wasteMt = y.waste * share;
    return {
      label: labels[i] ?? `P${i + 1}`,
      index: i + 1,
      oreMt,
      wasteMt,
      totalMt: oreMt + wasteMt,
      // Grade is a property of the ore, not of the calendar: it does not get split.
      gradeGt: y.grade,
      ozK: y.oz_k * share,
      days: cfg.daysPerYear * share,
    };
  });
}

export const QUARTER_LABELS = ['T1', 'T2', 'T3', 'T4'];
export const MONTH_LABELS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export interface FleetRequirement {
  equipment: string;
  /** Units needed to move the period's tonnage. */
  unitsRequired: number;
  unitsAvailable: number;
  utilisationPct: number;
  /** Effective hourly capacity per unit, after availability. */
  effectiveTphPerUnit: number;
  gapUnits: number;
}

export interface FleetSpec {
  equipment: string;
  /** Nominal capacity of one unit (t/h). */
  nominalTph: number;
  /** Mechanical availability (%) — the share of calendar hours the unit can run. */
  availabilityPct: number;
  /** Utilisation of available hours (%) — queuing, shift change, blasting delays. */
  utilisationPct: number;
  unitsAvailable: number;
}

/**
 * Fleet needed to move a period's tonnage.
 *
 * Sizing on nominal capacity alone is the classic way to under-build a fleet:
 * a truck rated 200 t/h at 85 % availability and 80 % utilisation really moves
 * 136 t/h. Both derates are explicit here.
 */
export function fleetRequirements(
  period: PeriodPlan,
  cfg: CalendarConfig,
  specs: FleetSpec[],
): FleetRequirement[] {
  const operatingHours = period.days * cfg.shiftsPerDay * cfg.hoursPerShift;
  return specs.map(s => {
    const effectiveTphPerUnit = s.nominalTph * (s.availabilityPct / 100) * (s.utilisationPct / 100);
    const capacityPerUnitMt = (effectiveTphPerUnit * operatingHours) / 1e6;
    const unitsRequired = capacityPerUnitMt > 0 ? period.totalMt / capacityPerUnitMt : 0;
    return {
      equipment: s.equipment,
      unitsRequired,
      unitsAvailable: s.unitsAvailable,
      utilisationPct: s.unitsAvailable > 0 ? (unitsRequired / s.unitsAvailable) * 100 : 0,
      effectiveTphPerUnit,
      gapUnits: unitsRequired - s.unitsAvailable,
    };
  });
}

// ─── Étape 5 — Planification opérationnelle ──────────────────────────────────

export interface DrillBlastPlan {
  /** Tonnage to blast over the period. */
  tonnesToBlast: number;
  /** Volume of rock (m³) from the tonnage and density. */
  volumeM3: number;
  /** Metres of blasthole required. */
  drillMetres: number;
  /** Number of blastholes. */
  holes: number;
  /** Explosive mass (kg) from the powder factor. */
  explosiveKg: number;
  /** Blasts needed at the configured tonnage per blast. */
  blasts: number;
}

export interface DrillBlastConfig {
  /** Burden × spacing (m) — the pattern each hole covers. */
  burdenM: number;
  spacingM: number;
  benchHeightM: number;
  /** Sub-drill below grade (m). */
  subDrillM: number;
  /** Powder factor (kg explosive per tonne of rock). */
  powderFactorKgT: number;
  rockDensity: number;
  /** Tonnage per blast — sets how many blasts the period needs. */
  tonnesPerBlast: number;
}

/**
 * Drill & blast requirements for a period's tonnage.
 *
 * Derived from the pattern geometry rather than a rule of thumb: each hole covers
 * burden × spacing × bench height of rock, so the tonnage fixes the hole count,
 * and the hole count fixes the metres and the explosive.
 */
export function drillBlastPlan(tonnes: number, cfg: DrillBlastConfig): DrillBlastPlan {
  const volumeM3 = cfg.rockDensity > 0 ? tonnes / cfg.rockDensity : 0;
  const volumePerHole = cfg.burdenM * cfg.spacingM * cfg.benchHeightM;
  const holes = volumePerHole > 0 ? volumeM3 / volumePerHole : 0;
  const metresPerHole = cfg.benchHeightM + cfg.subDrillM;
  return {
    tonnesToBlast: tonnes,
    volumeM3,
    holes,
    drillMetres: holes * metresPerHole,
    explosiveKg: tonnes * cfg.powderFactorKgT,
    blasts: cfg.tonnesPerBlast > 0 ? tonnes / cfg.tonnesPerBlast : 0,
  };
}

// ─── Étape 8 — Réconciliation Mine / Modèle / Usine ──────────────────────────

/** Measured tonnes/grade at one point of the chain. */
export interface ReconPoint {
  tonnes: number;
  gradeGt: number;
}

export interface ReconciliationResult {
  /** F1 = Mine ÷ Modèle — did the ore we dug match the block model? */
  f1Tonnes: number | null;
  f1Grade: number | null;
  f1Ounces: number | null;
  /** F2 = Usine ÷ Mine — did the plant receive what the mine claimed to send? */
  f2Tonnes: number | null;
  f2Grade: number | null;
  f2Ounces: number | null;
  /** F3 = Usine ÷ Modèle — the end-to-end factor, F1 × F2. */
  f3Tonnes: number | null;
  f3Grade: number | null;
  f3Ounces: number | null;
}

const oz = (p: ReconPoint) => p.tonnes * p.gradeGt;
const ratio = (a: number, b: number): number | null => (Math.abs(b) > 1e-9 ? a / b : null);

/**
 * Mine–Model–Plant reconciliation factors (F1/F2/F3).
 *
 * The industry standard for asking whether the resource model is telling the
 * truth. F1 ≈ 1 means the model predicts what is dug; F2 ≈ 1 means the mine
 * delivers what it claims. A model that reads 1.15 on ounces is systematically
 * optimistic, and every plan built on it inherits that bias.
 */
export function reconcile(model: ReconPoint, mine: ReconPoint, plant: ReconPoint): ReconciliationResult {
  return {
    f1Tonnes: ratio(mine.tonnes, model.tonnes),
    f1Grade: ratio(mine.gradeGt, model.gradeGt),
    f1Ounces: ratio(oz(mine), oz(model)),
    f2Tonnes: ratio(plant.tonnes, mine.tonnes),
    f2Grade: ratio(plant.gradeGt, mine.gradeGt),
    f2Ounces: ratio(oz(plant), oz(mine)),
    f3Tonnes: ratio(plant.tonnes, model.tonnes),
    f3Grade: ratio(plant.gradeGt, model.gradeGt),
    f3Ounces: ratio(oz(plant), oz(model)),
  };
}

/** Verdict band for a reconciliation factor. ±5 % is the usual acceptance window. */
export function reconVerdict(factor: number | null, tolerance = 0.05): 'ok' | 'warn' | 'bad' | 'unknown' {
  if (factor == null || !Number.isFinite(factor)) return 'unknown';
  const dev = Math.abs(factor - 1);
  if (dev <= tolerance) return 'ok';
  if (dev <= tolerance * 2) return 'warn';
  return 'bad';
}
