

import type { Project } from '../../types';
import { HOURS_PER_YEAR, DEFAULT_ASSUMPTIONS, computeProductionMetrics } from '../../lib/config/constants';
import { COMMON_DESIGN_FACTORS } from '../../lib/config/equipmentDesign';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectInputs {
  tph: number;                // t/h nominal throughput
  availability: number;       // % annual availability
  hours_per_year: number;     // calendar h/yr (project_settings override, else code default)
  gold_grade: number;         // g/t feed grade
  ore_sg: number;             // ore SG (t/m³)
  bwi: number;                // Bond Work Index kWh/t
  brwi: number;               // Bond Rod Work Index kWh/t
  f80_crush: number;          // F80 after crush µm
  p80_grind: number;          // P80 target µm
  grg_pct: number;            // GRG % of Au
  leach_rec_24h: number;      // CIL leach recovery 24h %
  leach_rec_48h: number;      // CIL leach recovery 48h %
  cip_rec: number;            // CIP recovery %
  flot_rec: number;           // Flotation Au recovery %
  flot_mass_pull: number;     // Flotation mass pull %
  slurry_density: number;     // CIL slurry % solids
  cyanide_cons: number;       // NaCN kg/t
  lime_cons: number;          // Lime kg/t
  dissolved_o2: number;       // mg/L DO in leach
  carbon_conc: number;        // g/L activated carbon in CIL
  elution_temp: number;       // °C elution temperature
  ew_current_density: number; // A/m² electrowinning
  thickener_area_factor: number; // m²/t/d unit area
  // ── Template Excel — critères de dimensionnement additionnels ──
  cwi: number;                // Bond Crushing Work Index kWh/t
  scse: number;              // SMC SAG specific energy (SCSE) kWh/t
  f80_rom_mm: number;         // ROM F80 (mm) — primary crusher feed
  p80_primary_mm: number;     // primary crusher product P80 (mm)
  p80_secondary_mm: number;   // secondary crusher product P80 (mm)
  p80_tertiary_mm: number;    // tertiary crusher product P80 (mm)
  f80_hpgr_mm: number;        // HPGR feed F80 (mm)
  p80_hpgr_mm: number;        // HPGR product P80 (mm)
  f80_sag_mm: number;         // SAG mill feed F80 (mm)
  p80_sag_mm: number;         // SAG mill product P80 (mm) — trommel/screen undersize
  f80_ball_um: number;        // ball mill feed F80 (µm) — SAG/HPGR/tertiary product
  // ball mill product P80 = p80_grind (final grind target, already defined above)
  f80_regrind_um: number;     // regrind mill feed F80 (µm) — concentrate/middlings
  p80_regrind_um: number;     // regrind mill product P80 (µm)
  avail_crush: number;        // crushing circuit availability %
  sf_crush: number;           // crusher design/safety factor %
  sf_grind: number;           // grinding design factor %
  eta_mech: number;           // crusher mechanical efficiency %
  eta_motor: number;          // mill motor efficiency %
  cl_ball: number;            // ball mill circulating load %
  cyclone_pct_solids: number; // cyclone feed % solids (w/w)
  ball_cons: number;          // steel grinding media consumption kg/t
  leach_k: number;            // leach 1st-order kinetic constant 1/h
  carbon_loading: number;     // loaded carbon Au g/t
}

export type Phase = 'SCOPING' | 'PRE-FEASIBILITY' | 'FEASIBILITY' | 'BFS' | 'DFS';

export interface CriteriaRow {
  id: string;
  parameter: string;
  value: string;
  unit: string;
  formula: string;
  source: string;
  comment: string;    // user fills
  reference: string;  // user fills
  isCalc: boolean;    // true = auto-calculated
  isAlert?: boolean;
}

// Upstream stream context propagated along the user-chosen process flow, so a unit's
// feed size reflects the product of whatever step actually precedes it.
export interface FlowContext {
  feedF80: number;        // µm — F80 of the material arriving from the previous flow step
  feedTph: number;        // t/h — solids tonnage arriving at this step along the chosen flow
  afterFlotation: boolean; // true when a flotation stage sits upstream (stream = concentrate)
}

/**
 * Base de conception À L'ÉCHELLE DU PROJET — ce qui sort de l'usine, pas ce que
 * dissout une cuve. La production annuelle en découle et doit être IDENTIQUE au
 * Tableau de bord : les deux écrans lisent la récupération de la route
 * recommandée (`effectiveRecoveryPct`) via `computeProductionMetrics`. Les
 * critères la calculaient auparavant sur la seule lixiviation 48 h brute, d'où
 * deux productions annuelles différentes pour un même projet.
 */
export interface DesignBasis {
  /** Récupération globale (%) de la route recommandée — repli : design projet. */
  globalRecoveryPct: number;
  /** Nom de la route dont elle provient, pour tracer la formule affichée. */
  routeLabel: string | null;
}

export interface EquipSection {
  id: string;
  label: string;
  code: string;
  icon: React.ReactNode;
  group: string;
  rows: (inputs: ProjectInputs, phase: Phase, ctx?: FlowContext, design?: DesignBasis) => CriteriaRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function r(n: number, dec = 1): string {
  if (!isFinite(n) || isNaN(n)) return '—';
  return n.toFixed(dec);
}

export function bond(wi: number, p80: number, f80: number): number {
  if (!wi || !p80 || !f80 || p80 <= 0 || f80 <= 0) return 0;
  // No useful comminution if the feed is already at/below the target size (e.g. a crusher
  // placed after grinding in the flow): energy is zero rather than negative.
  if (p80 >= f80) return 0;
  return wi * (10 / Math.sqrt(p80) - 10 / Math.sqrt(f80));
}

// ── Template-aligned sizing formulas (ref: Template_Critères_Conception_Usine_Or) ──

// Installed motor power: P_shaft / η_mech × (1 + install margin).  (03_CRUSHING B17)
export function installedPower(shaftKw: number, etaPct: number, marginPct: number): number {
  if (etaPct <= 0) return 0;
  return shaftKw / (etaPct / 100) * (1 + marginPct / 100);
}

// Slurry SG from ore SG and % solids w/w (water SG = 1).  (06_CLASSIFICATION B41)
export function pulpSG(sg: number, pctSolids: number): number {
  return 1 + (sg - 1) * pctSolids / 100;
}

// Total slurry volumetric flow m³/h = solids vol + water vol.  (09_LEACHING_CIL B9)
export function slurryQv(tph: number, sg: number, pctSolids: number): number {
  if (sg <= 0 || pctSolids <= 0) return 0;
  return tph / sg + tph * (100 - pctSolids) / pctSolids;
}

// Process-flow rank derived from the equipment code, so active equipment can be laid out
// in true process order (feed → crushing → screening → grinding → classification →
// gravity/flotation → leaching → ADR → dewatering → reagents/services/environment).
export function processRank(code: string): number {
  if (code === 'GEN') return -1;
  const m = code.match(/^(\d+)([a-z]*)$/i);
  if (m) return parseInt(m[1]) * 100 + (m[2] ? m[2].toLowerCase().charCodeAt(0) - 96 : 0);
  const digits = parseInt(code.replace(/\D/g, '')) || 0;
  if (/^SC/i.test(code)) return 450 + digits;   // screening: between crushing/HPGR and grinding
  if (/^R/i.test(code))  return 20000 + digits; // reagents
  if (/^U/i.test(code))  return 21000 + digits; // services / utilities
  if (/^E/i.test(code))  return 22000 + digits; // environment
  return 99999;
}

// Product P80 (µm) leaving a size-reduction unit — used to propagate feed size along the
// chosen flow. Units that don't reduce size pass the stream through unchanged.
export function productF80(id: string, feed: number, inp: ProjectInputs): number {
  switch (id) {
    case 'gyratory': case 'jaw':                         return inp.p80_primary_mm * 1000;
    case 'cone': case 'pebble_crusher':                  return inp.p80_secondary_mm * 1000;
    case 'cone_tertiary':                                return inp.p80_tertiary_mm * 1000;
    case 'hpgr':                                         return inp.p80_hpgr_mm * 1000;
    case 'sag': case 'ag':                               return Math.min(feed, inp.p80_sag_mm * 1000);
    case 'rod':                                          return Math.min(feed, 1000);
    case 'ball':                                         return inp.p80_grind;
    case 'towermill':                                    return 38;
    case 'vertimill':                                    return 40;   // regrind product P80
    case 'isamill':                                      return 15;
    default:                                             return feed; // no comminution
  }
}

// Feed to a regrind mill along the chosen flow. By default it regrinds the MAINSTREAM
// tonnage flowing down the circuit (e.g. cyclone underflow after primary grinding); only
// when a flotation stage sits upstream does it regrind the (much smaller) concentrate.
export function regrindFeed(inp: ProjectInputs, ctx?: FlowContext): { f80: number; tph: number; conc: boolean } {
  const conc = ctx?.afterFlotation ?? false;
  const f80 = ctx?.feedF80 ?? inp.f80_regrind_um;
  const tph = conc ? inp.tph * inp.flot_mass_pull / 100 : (ctx?.feedTph ?? inp.tph);
  return { f80, tph, conc };
}

// VSMA screen sizing: required area = undersize throughput / (C·M·K·S), and unit count.
// C = base capacity t/(m²·h) at the cut, M = efficiency factor, K = ∏ correction factors,
// S = stratification/deck factor. (Template 03_CRUSHING §2 & 04_HPGR §6)
export function vsmaScreen(undersizeTph: number, C: number, M: number, K: number, S: number, unitAreaM2: number): { area: number; n: number } {
  const denom = C * M * K * S;
  const area = denom > 0 ? undersizeTph / denom : 0;
  return { area, n: Math.max(1, Math.ceil(area / unitAreaM2)) };
}

// Rowland ball-mill efficiency corrections EF4 (oversize feed) & EF5 (fine grind).
export function rowlandEF(wi: number, f80: number, p80: number): number {
  const f80opt = 4000 * Math.sqrt(13 / wi);          // optimal feed size (05_GRINDING B16)
  const rr = f80 / p80;
  const ef4 = f80 > f80opt ? (rr + (wi - 7) * (f80 - f80opt) / f80opt) / rr : 1;
  const ef5 = p80 < 75 ? (p80 + 10.3) / (1.145 * p80) : 1;
  return ef4 * ef5;
}

export function phaseSuffix(phase: Phase): string {
  const map: Record<Phase, string> = {
    SCOPING: '±35%',
    'PRE-FEASIBILITY': '±25%',
    FEASIBILITY: '±15%',
    BFS: '±10%',
    DFS: '±5%',
  };
  return map[phase] ?? '';
}

export function uid(): string { return Math.random().toString(36).slice(2, 10); }

// ─── Design sizing helpers ────────────────────────────────────────────────────

// Annual throughput (t/an) at plant availability.
export function annualT(inp: ProjectInputs): number { return inp.tph * inp.availability / 100 * inp.hours_per_year; }

/**
 * Récupération de conception (%) : celle de la route recommandée. Repli sur la
 * lixiviation 48 h uniquement si aucune route n'est encore fondée sur du
 * testwork — jamais comme base par défaut (cf. DesignBasis).
 */
export function designRecovery(design: DesignBasis | undefined, inp?: ProjectInputs): number {
  return design?.globalRecoveryPct ?? inp?.leach_rec_48h ?? 0;
}

/**
 * Production annuelle (oz Au) — MÊME base que le Tableau de bord, via le helper
 * partagé `computeProductionMetrics`. Ne jamais réécrire la formule ici : c'est
 * la duplication qui avait fait diverger les deux écrans.
 */
export function annualOz(inp: ProjectInputs, design?: DesignBasis): number {
  return computeProductionMetrics(
    { target_tph: inp.tph, availability_pct: inp.availability, gold_grade_g_t: inp.gold_grade },
    { hoursPerYear: inp.hours_per_year },
    designRecovery(design, inp),
  ).annualOz;
}

// Solids volumetric flow (m³/h) of dry ore.
function _oreVolFlow(inp: ProjectInputs): number { return inp.ore_sg > 0 ? inp.tph / inp.ore_sg : 0; }

// Slurry volumetric flow (m³/h) at a given % solids (w/w), assuming water SG = 1.
export function slurryVolFlow(inp: ProjectInputs, pctSolids: number): number {
  if (pctSolids <= 0) return 0;
  const water_tph = inp.tph * (100 - pctSolids) / pctSolids;
  return inp.tph / inp.ore_sg + water_tph; // ore volume + water volume
}

// Tumbling-mill rotational speed (rpm) at a target % of critical speed for a mill of diameter D (m).
export function millRpm(diam_m: number, pctCritical: number): number {
  if (diam_m <= 0) return 0;
  const nc = 42.3 / Math.sqrt(diam_m); // critical speed, rpm (D in m)
  return nc * pctCritical / 100;
}

// A short calculated CriteriaRow (keeps the equipment tables terse).
export function cr(parameter: string, value: string, unit: string, formula: string, source = 'Calcul'): CriteriaRow {
  return { id: uid(), parameter, value, unit, formula, source, isCalc: true, comment: '', reference: '' };
}

// Common operating-basis rows appended to any equipment sheet that would otherwise be
// sparse — every unit is designed against the plant throughput and availability.
export function commonOps(inp: ProjectInputs): CriteriaRow[] {
  return [
    cr('Débit nominal usine (base)',   r(inp.tph, 0),                       't/h',  'Base de conception', 'Projet'),
    cr('Disponibilité de conception',  r(inp.availability, 0),              '%',    'Données projet', 'Projet'),
    cr("Heures d'opération / an",      r(inp.availability / 100 * inp.hours_per_year, 0), 'h/an', `Dispo% × ${inp.hours_per_year}`),
    cr('Débit massique annuel',        r(annualT(inp) / 1000, 0),           'kt/an',`TPH × Dispo% × ${inp.hours_per_year}`),
    cr(`Débit de conception (+${pctMargin(COMMON_DESIGN_FACTORS.designMarginFactor)}%)`,
       r(inp.tph * COMMON_DESIGN_FACTORS.designMarginFactor, 0), 't/h',
       `TPH × ${COMMON_DESIGN_FACTORS.designMarginFactor} (marge)`),
  ];
}

/** Marge de conception exprimée en % pour l'affichage (1.25 → 25). */
function pctMargin(factor: number): number {
  return Math.round((factor - 1) * 100);
}

// ─── Default project inputs ───────────────────────────────────────────────────

export function defaultInputs(project: Project, hoursPerYear: number = HOURS_PER_YEAR): ProjectInputs {
  return {
    tph: project.target_tph || 100,
    availability: project.availability_pct || 91,
    hours_per_year: hoursPerYear,
    gold_grade: project.gold_grade_g_t || 1.5,
    ore_sg: project.ore_sg || DEFAULT_ASSUMPTIONS.DEFAULT_ORE_SG_T_M3,
    bwi: DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T,
    brwi: DEFAULT_ASSUMPTIONS.DEFAULT_BOND_ROD_WI_KWH_T,
    f80_crush: 12000,
    p80_grind: 75,
    grg_pct: 25,
    leach_rec_24h: 88,
    leach_rec_48h: 91,
    cip_rec: 87,
    flot_rec: 82,
    flot_mass_pull: 8,
    slurry_density: 42,
    cyanide_cons: 0.45,
    lime_cons: 1.2,
    dissolved_o2: 8,
    carbon_conc: 15,
    elution_temp: 115,
    ew_current_density: 250,
    thickener_area_factor: 0.08,
    cwi: 16,
    scse: 9.5,
    // Chaîne de comminution — chaque F80 (alimentation) ≈ P80 produit de l'étage
    // amont, en ordre procédé : ROM → primaire → secondaire → tertiaire → HPGR →
    // SAG → ball mill → regrind. Valeurs de départ typiques circuit or dur.
    f80_rom_mm: 600,           // ROM (= alimentation concasseur primaire)
    p80_primary_mm: 150,       // produit primaire
    p80_secondary_mm: 35,      // produit secondaire (= alim. tertiaire)
    p80_tertiary_mm: 12,       // produit tertiaire (= alim. HPGR / SAG)
    f80_hpgr_mm: 35,           // alim. HPGR (= produit secondaire)
    p80_hpgr_mm: 6,            // produit HPGR
    f80_sag_mm: 150,           // alim. SAG (= produit primaire, circuit SAB)
    p80_sag_mm: 2,             // produit SAG (trommel undersize, = alim. ball ≈ 2000 µm)
    f80_ball_um: 2000,         // alim. ball mill (= produit SAG/HPGR)
    f80_regrind_um: 45,        // alim. regrind (concentré/mixtes)
    p80_regrind_um: 20,        // produit regrind (relibération)
    avail_crush: 75,
    sf_crush: 25,
    sf_grind: 15,
    eta_mech: 93,
    eta_motor: 96,
    cl_ball: 300,
    cyclone_pct_solids: 65,
    ball_cons: 0.6,
    leach_k: 0.15,
    carbon_loading: 3000,
  };
}
