import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, Camera, Lock, Layers, Zap, Droplets,
  FlaskConical, Wind, Gauge, BarChart3, CheckCircle2,
  ChevronDown, ChevronRight, RefreshCw, Info,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProjectInputs {
  tph: number;                // t/h nominal throughput
  availability: number;       // % annual availability
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
  f80_rom_mm: number;         // ROM F80 (mm)
  p80_primary_mm: number;     // primary crusher product P80 (mm)
  p80_secondary_mm: number;   // secondary crusher product P80 (mm)
  p80_hpgr_mm: number;        // HPGR product P80 (mm)
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

type Phase = 'SCOPING' | 'PRE-FEASIBILITY' | 'FEASIBILITY' | 'BFS' | 'DFS';

interface CriteriaRow {
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

interface EquipSection {
  id: string;
  label: string;
  code: string;
  icon: React.ReactNode;
  group: string;
  rows: (inputs: ProjectInputs, phase: Phase) => CriteriaRow[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function r(n: number, dec = 1): string {
  if (!isFinite(n) || isNaN(n)) return '—';
  return n.toFixed(dec);
}

function bond(wi: number, p80: number, f80: number): number {
  if (!wi || !p80 || !f80 || p80 <= 0 || f80 <= 0) return 0;
  return wi * (10 / Math.sqrt(p80) - 10 / Math.sqrt(f80));
}

// ── Template-aligned sizing formulas (ref: Template_Critères_Conception_Usine_Or) ──

// Installed motor power: P_shaft / η_mech × (1 + install margin).  (03_CRUSHING B17)
function installedPower(shaftKw: number, etaPct: number, marginPct: number): number {
  if (etaPct <= 0) return 0;
  return shaftKw / (etaPct / 100) * (1 + marginPct / 100);
}

// Slurry SG from ore SG and % solids w/w (water SG = 1).  (06_CLASSIFICATION B41)
function pulpSG(sg: number, pctSolids: number): number {
  return 1 + (sg - 1) * pctSolids / 100;
}

// Total slurry volumetric flow m³/h = solids vol + water vol.  (09_LEACHING_CIL B9)
function slurryQv(tph: number, sg: number, pctSolids: number): number {
  if (sg <= 0 || pctSolids <= 0) return 0;
  return tph / sg + tph * (100 - pctSolids) / pctSolids;
}

// VSMA screen sizing: required area = undersize throughput / (C·M·K·S), and unit count.
// C = base capacity t/(m²·h) at the cut, M = efficiency factor, K = ∏ correction factors,
// S = stratification/deck factor. (Template 03_CRUSHING §2 & 04_HPGR §6)
function vsmaScreen(undersizeTph: number, C: number, M: number, K: number, S: number, unitAreaM2: number): { area: number; n: number } {
  const denom = C * M * K * S;
  const area = denom > 0 ? undersizeTph / denom : 0;
  return { area, n: Math.max(1, Math.ceil(area / unitAreaM2)) };
}

// Rowland ball-mill efficiency corrections EF4 (oversize feed) & EF5 (fine grind).
function rowlandEF(wi: number, f80: number, p80: number): number {
  const f80opt = 4000 * Math.sqrt(13 / wi);          // optimal feed size (05_GRINDING B16)
  const rr = f80 / p80;
  const ef4 = f80 > f80opt ? (rr + (wi - 7) * (f80 - f80opt) / f80opt) / rr : 1;
  const ef5 = p80 < 75 ? (p80 + 10.3) / (1.145 * p80) : 1;
  return ef4 * ef5;
}

function phaseSuffix(phase: Phase): string {
  const map: Record<Phase, string> = {
    SCOPING: '±35%',
    'PRE-FEASIBILITY': '±25%',
    FEASIBILITY: '±15%',
    BFS: '±10%',
    DFS: '±5%',
  };
  return map[phase] ?? '';
}

function uid(): string { return Math.random().toString(36).slice(2, 10); }

// ─── Design sizing helpers ────────────────────────────────────────────────────

// Annual throughput (t/an) at plant availability.
function annualT(inp: ProjectInputs): number { return inp.tph * inp.availability / 100 * 8760; }
// Solids volumetric flow (m³/h) of dry ore.
function oreVolFlow(inp: ProjectInputs): number { return inp.ore_sg > 0 ? inp.tph / inp.ore_sg : 0; }
// Slurry volumetric flow (m³/h) at a given % solids (w/w), assuming water SG = 1.
function slurryVolFlow(inp: ProjectInputs, pctSolids: number): number {
  if (pctSolids <= 0) return 0;
  const water_tph = inp.tph * (100 - pctSolids) / pctSolids;
  return inp.tph / inp.ore_sg + water_tph; // ore volume + water volume
}
// Tumbling-mill rotational speed (rpm) at a target % of critical speed for a mill of diameter D (m).
function millRpm(diam_m: number, pctCritical: number): number {
  if (diam_m <= 0) return 0;
  const nc = 42.3 / Math.sqrt(diam_m); // critical speed, rpm (D in m)
  return nc * pctCritical / 100;
}
// A short calculated CriteriaRow (keeps the equipment tables terse).
function cr(parameter: string, value: string, unit: string, formula: string, source = 'Calcul'): CriteriaRow {
  return { id: uid(), parameter, value, unit, formula, source, isCalc: true, comment: '', reference: '' };
}

// Common operating-basis rows appended to any equipment sheet that would otherwise be
// sparse — every unit is designed against the plant throughput and availability.
function commonOps(inp: ProjectInputs): CriteriaRow[] {
  return [
    cr('Débit nominal usine (base)',   r(inp.tph, 0),                       't/h',  'Base de conception', 'Projet'),
    cr('Disponibilité de conception',  r(inp.availability, 0),              '%',    'Données projet', 'Projet'),
    cr("Heures d'opération / an",      r(inp.availability / 100 * 8760, 0), 'h/an', 'Dispo% × 8760'),
    cr('Débit massique annuel',        r(annualT(inp) / 1000, 0),           'kt/an','TPH × Dispo% × 8760'),
    cr('Débit de conception (+25%)',   r(inp.tph * 1.25, 0),                't/h',  'TPH × 1.25 (marge)'),
  ];
}

// ─── Section definitions ──────────────────────────────────────────────────────

const SECTIONS_RAW: EquipSection[] = [

  // ── GÉNÉRAL ─────────────────────────────────────────────────────────────
  {
    id: 'general', label: 'Paramètres Généraux', code: 'GEN', group: 'general',
    icon: <BarChart3 size={13} />,
    rows: (inp, phase) => [
      { id: uid(), parameter: 'Débit nominal de traitement',  value: r(inp.tph, 0),                      unit: 't/h',  formula: 'Données projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Disponibilité usine annuelle', value: r(inp.availability, 0),             unit: '%',    formula: 'Données projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Heures opération / an',        value: r(inp.availability/100*8760, 0),    unit: 'h/an', formula: 'Dispo% × 8760',                     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Teneur or alimentation',       value: r(inp.gold_grade, 2),               unit: 'g/t',  formula: 'Modèle de blocs',                   source: 'Gisement', isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Densité du minerai (SG)',      value: r(inp.ore_sg, 2),                   unit: 't/m³', formula: 'Testwork LIMS',                     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Précision estimée',            value: phaseSuffix(phase),                 unit: '',     formula: `Phase ${phase}`,                    source: 'Phase',    isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Production annuelle (oz Au)',  value: r(inp.tph*inp.availability/100*8760*inp.gold_grade*inp.leach_rec_24h/100/31.1035, 0), unit: 'oz/an', formula: 'TPH×H/an×Grade×Rec/31.1', source: 'Calcul', isCalc: true, comment: '', reference: '' },
    ],
  },

  // ── MANUTENTION MINERAI ──────────────────────────────────────────────────
  {
    id: 'grizzly', label: 'Grizzly / Scalpeur ROM', code: '01a', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const slot = inp.f80_crush / 1000 * 0.8;
      const width_m = Math.max(1.5, inp.tph * 1.3 / 300); // ~300 t/h per m width
      return [
        cr('Capacité nominale',         r(inp.tph, 0),        't/h', 'Débit projet', 'Projet'),
        cr('Capacité design (×1.3)',    r(inp.tph * 1.3, 0),  't/h', 'TPH × 1.3'),
        cr('Débit massique annuel',     r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('Ouverture barreaux grizzly', r(slot, 0),          'mm',  'F80×0.8/1000'),
        cr('Dimension max ROM (P100)',  r(inp.f80_crush / 1000 * 2, 0), 'mm', 'F80×2/1000'),
        cr('Largeur grizzly (approx)',  r(width_m, 1),        'm',   '≈ Q_design / 300 t/(m·h)'),
        cr('Passant sous-taille estimé', r(70, 0),            '%',   'Typique ROM primaire'),
        { id: uid(), parameter: 'Angle d\'inclinaison', value: '30–40', unit: '°', formula: 'Grizzly statique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'apron', label: 'Alimentateur à Tablier', code: '01b', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité nominale',             value: r(inp.tph, 0),               unit: 't/h', formula: 'Débit projet',              source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Capacité design (×1.3)',        value: r(inp.tph*1.3, 0),           unit: 't/h', formula: 'TPH × 1.3',                 source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Vitesse tablier',               value: '0.05–0.15',                 unit: 'm/s', formula: 'Typique apron feeder',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Largeur tablier',               value: r(Math.max(1200, inp.tph*5), 0), unit: 'mm', formula: 'TPH×5 min 1200',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
    ],
  },
  {
    id: 'conveyor', label: 'Convoyeurs à Bande', code: '01c', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const cap = inp.tph * 1.25;
      const speed = 2.0;                               // m/s design
      const load_kg_m = cap * 1000 / 3600 / speed;     // belt loading kg per m
      const lift_m = 10;                               // assumed vertical lift
      const power_kw = cap * 9.81 * lift_m / 3600 / 0.85; // lift power / drive eff.
      return [
        cr('Capacité convoyage',        r(cap, 0),        't/h', 'TPH × 1.25'),
        cr('Débit massique annuel',     r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('Vitesse de conception',     r(speed, 1),      'm/s', 'Typique convoyage'),
        cr('Largeur courroie estimée',  r(Math.max(600, inp.tph * 4), 0), 'mm', 'TPH×4 min 600'),
        cr('Charge linéaire courroie',  r(load_kg_m, 0),  'kg/m', 'Cap / (3.6 × vitesse)'),
        cr('Puissance entraînement (lift 10 m)', r(power_kw, 0), 'kW', 'Cap×g×H / 3600 / 0.85'),
        { id: uid(), parameter: 'Angle convoyeur (max)', value: '14–18', unit: '°', formula: 'Max inclinaison minerai', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'stockpile', label: 'Stockpile / Dôme de Stockage', code: '01d', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const live = inp.tph*16; const total = inp.tph*72;
      const vol = total/inp.ore_sg;
      const diam = Math.pow(vol*3/(Math.PI*0.5), 1/3)*2;
      const autonomy_live_h = 16;
      const reclaim_tph = inp.tph * 1.1;              // reclaim feeders slightly above nominal
      return [
        cr('Capacité utile (live)',    r(live, 0),   't',  'TPH × 16h'),
        cr('Capacité totale (3 jours)', r(total, 0), 't',  'TPH × 72h'),
        cr('Autonomie utile',          r(autonomy_live_h, 0), 'h', 'Capacité live / TPH'),
        cr('Volume total stockage',    r(vol, 0),    'm³', 'Masse totale / SG'),
        cr('Diamètre dôme estimé',     r(diam, 0),   'm',  '(V×3/(π×0.5))^(1/3)×2'),
        cr('Débit de reprise (reclaim)', r(reclaim_tph, 0), 't/h', 'TPH × 1.1'),
        { id: uid(), parameter: 'Angle repos minerai', value: '35–40', unit: '°', formula: 'Typique minerai concassé', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Fraction reprise gravitaire', value: '30–40', unit: '%', formula: 'Reste par bulldozer', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'silo', label: 'Silo / Trémie Tampon', code: '01e', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const mass = inp.tph * 4;
      const vol = mass / inp.ore_sg;
      const diam = Math.pow(4 * vol / (Math.PI * 1.5), 1 / 3);   // H/D≈1.5
      return [
        cr('Capacité trémie (4 h)',   r(mass, 0),  't',  'TPH × 4h'),
        cr('Volume utile',            r(vol, 0),   'm³', 'Masse / SG'),
        cr('Autonomie',               r(4, 0),     'h',  'Capacité / TPH'),
        cr('Diamètre estimé (H/D≈1.5)', r(diam, 1),'m',  'D=(4V/(π×1.5))^(1/3)'),
        cr('Débit d\'extraction',     r(inp.tph * 1.25, 0), 't/h', 'TPH × 1.25'),
        { id: uid(), parameter: 'Angle talus parois', value: '55–65', unit: '°', formula: 'Écoulement massique (mass-flow)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre orifice sortie', value: '≥ 6× top size', unit: 'mm', formula: 'Anti-voûtage', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'sampling', label: 'Échantillonnage & Pesée', code: '01f', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const sample_kg = Math.max(0.5, inp.tph / 200);
      const cuts_per_h = 3;                            // 1 / 20 min
      const daily_kg = sample_kg * cuts_per_h * 24;
      return [
        cr('Masse min. représentative', r(sample_kg, 2), 'kg', 'TPH/200 min 0.5 kg'),
        cr('Fréquence d\'échantillonnage', r(cuts_per_h, 0), '/h', '1 coupe / 20 min'),
        cr('Masse échantillon / jour',  r(daily_kg, 0),  'kg/j', 'Masse × coupes/h × 24'),
        cr('Balance de pesée (bande)',  r(inp.tph * 1.3, 0), 't/h', 'TPH × 1.3'),
        cr('Ouverture coupe échantillonneur', r(inp.f80_crush / 1000 * 3, 0), 'mm', '≥ 3× top size'),
        { id: uid(), parameter: 'Précision balance', value: '±0.5', unit: '%', formula: 'Standard industrie (MI 002)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Norme échantillonnage', value: 'ISO 13292 / Gy', unit: '', formula: 'Théorie de Gy', source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'dedusting', label: 'Dépoussiérage', code: '01g', group: 'feed',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const air_m3min = inp.tph * 0.5;
      const air_c_h = 4;                               // air-to-cloth ratio m³/min/m²  (m/min)
      const bag_area = air_m3min / air_c_h;
      const fan_kw = air_m3min / 60 * 2500 / 1000 / 0.7; // ΔP≈2.5 kPa, fan eff 70%
      return [
        cr('Débit air extrait (total)', r(air_m3min, 0), 'm³/min', 'TPH × 0.5'),
        cr('Ratio air/tissu',           r(air_c_h, 1),   'm/min', 'Typique filtre à manches'),
        cr('Surface filtrante (manches)', r(bag_area, 0),'m²',   'Débit air / ratio air-tissu'),
        cr('Puissance ventilateur',     r(fan_kw, 0),    'kW',   'Q×ΔP / 0.7 (η ventilateur)'),
        { id: uid(), parameter: 'Points de dépoussiérage', value: 'Concasseurs, SAG, chutes, cribles', unit: '', formula: 'Points de transfert', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Émissions PM10 cible', value: '<10', unit: 'mg/m³', formula: 'Réglementation air', source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── CONCASSAGE ───────────────────────────────────────────────────────────
  {
    id: 'jaw', label: 'Concasseur à Mâchoires', code: '03a', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, phase) => [
      { id: uid(), parameter: 'Capacité nominale',              value: r(inp.tph, 0),               unit: 't/h', formula: 'Débit projet',               source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Capacité design (×1.25)',        value: r(inp.tph*1.25, 0),          unit: 't/h', formula: 'TPH × 1.25',                source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'CSS nominal',                    value: r(inp.f80_crush/1000*12, 0), unit: 'mm',  formula: 'F80×12/1000',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: `Précision (${phase})`,           value: phaseSuffix(phase),          unit: '',    formula: `Phase ${phase}`,             source: 'Phase',    isCalc: true,  comment: '', reference: '' },
    ],
  },
  {
    id: 'gyratory', label: 'Concasseur Giratoire', code: '03b', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, phase) => {
      // Template 03_CRUSHING — primary crusher via Bond CWi + installed power.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1); // aligned on crush availability
      const f80 = inp.f80_rom_mm * 1000;
      const p80 = inp.p80_primary_mm * 1000;
      const r80 = p80 > 0 ? f80 / p80 : 0;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 30);
      const gape = inp.f80_rom_mm * 1.2;
      return [
        cr('Capacité nominale',            r(inp.tph, 0),      't/h',  'Débit projet', 'Projet'),
        cr('Débit DESIGN concassage',      r(q_design, 0),     't/h',  'Q_broyage × dispo_broy / dispo_conc'),
        cr('Débit massique annuel',        r(inp.tph * inp.avail_crush / 100 * 8760 / 1000, 0), 'kt/an', 'TPH × dispo_conc% × 8760'),
        cr('F80 alimentation (ROM)',       r(f80, 0),          'µm',   'F80 ROM × 1000'),
        cr('P80 produit primaire',         r(p80, 0),          'µm',   'P80 concassage primaire × 1000'),
        cr('Ratio de réduction R80',       r(r80, 1),          '',     'F80 / P80'),
        cr('Bond Crushing WI (CWi)',       r(inp.cwi, 1),      'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 3),            'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre (P_shaft)',    r(p_shaft, 0),      'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE moteur',   r(p_install, 0),    'kW',   'P_shaft / η_méca × (1 + 30%)'),
        cr('Ouverture alimentation (gape)', r(gape, 0),        'mm',   '1.2 × F80 ROM'),
        { id: uid(), parameter: 'Vitesse excentrique', value: '85–120', unit: 'rpm', formula: 'Typique giratoire primaire', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Modèle suggéré', value: 'FLS 54-75 / Metso 50-65', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: `Précision (${phase})`, value: phaseSuffix(phase), unit: '', formula: `Phase ${phase}`, source: 'Phase', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cone', label: 'Concasseur à Cône', code: '03c', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const css = Math.max(12, inp.f80_crush/1000*0.6);
      return [
        { id: uid(), parameter: 'Capacité nominale',            value: r(inp.tph, 0),       unit: 't/h', formula: 'Débit projet',               source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Capacité design (×1.25)',      value: r(inp.tph*1.25, 0),  unit: 't/h', formula: 'TPH × 1.25',                source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'CSS nominal',                  value: r(css, 0),           unit: 'mm',  formula: 'F80×0.6/1000 min 12',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Granulométrie produit P80',    value: r(css*1.5, 0),       unit: 'mm',  formula: 'CSS × 1.5',                 source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'hpgr', label: 'HPGR', code: '04', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité design',                value: r(inp.tph*1.15, 0),  unit: 't/h',   formula: 'TPH × 1.15',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Pression spécifique',            value: '3.5',               unit: 'N/mm²', formula: 'Typique 3–4 N/mm²',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Énergie spécifique',             value: r(inp.bwi*0.35, 1),  unit: 'kWh/t', formula: 'BWI × 0.35',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Rapport de réduction cible',     value: '4–6',               unit: '',      formula: 'Typique HPGR',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'pebble_crusher', label: 'Concasseur à Galets (Pebble)', code: '03d', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit cailloux estimé',          value: r(inp.tph*0.15, 0),           unit: 't/h', formula: 'TPH × 15% recircul.',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'CSS nominal pebble',             value: '12–18',                      unit: 'mm',  formula: 'Typique pebble crusher',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Alimentation max',               value: r(inp.f80_crush/1000*0.08, 0), unit: 'mm', formula: 'F80×0.08',                 source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
    ],
  },

  // ── BROYAGE ──────────────────────────────────────────────────────────────
  {
    id: 'sag', label: 'Broyeur SAG', code: '05b', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e = bond(inp.bwi*1.3, inp.p80_grind, inp.f80_crush)*0.55;
      const pw = e*inp.tph;
      const vol = inp.tph/inp.ore_sg/0.35;
      const d = Math.pow(vol/(Math.PI/4*1.5), 1/3);
      return [
        { id: uid(), parameter: 'Débit de conception',        value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',                       source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'F80 alimentation',           value: r(inp.f80_crush, 0),  unit: 'µm',    formula: 'P80 concasseur',                     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 produit cible',          value: r(inp.p80_grind, 0),  unit: 'µm',    formula: 'Testwork comminution',               source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'BWi',                        value: r(inp.bwi, 1),        unit: 'kWh/t', formula: 'Testwork LIMS',                      source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique SAG',     value: r(e, 2),              unit: 'kWh/t', formula: 'Wi×1.3×(10/√P80−10/√F80)×0.55',    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',        value: r(pw, 0),             unit: 'kW',    formula: 'E_sag × TPH',                        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre estimé',            value: r(d, 1),              unit: 'm',     formula: 'V=TPH/(SG×0.35); D=(V/(π/4×L))^⅓', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Charge en boulets (%)',      value: '10–12',              unit: '%v',    formula: 'Typique SAG',                        source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse critique (%)',       value: '72–78',              unit: '%Vc',   formula: 'Typique SAG',                        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ag', label: 'Broyeur AG', code: '05a', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e = bond(inp.bwi*1.2, inp.p80_grind, inp.f80_crush)*0.65;
      return [
        { id: uid(), parameter: 'Débit de conception',        value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'F80 alimentation',           value: r(inp.f80_crush, 0),  unit: 'µm',    formula: 'P80 concasseur',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 produit',                value: r(inp.p80_grind, 0),  unit: 'µm',    formula: 'Testwork',                 source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique AG',      value: r(e, 2),              unit: 'kWh/t', formula: 'Bond×1.2×0.65',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',        value: r(e*inp.tph, 0),      unit: 'kW',    formula: 'E × TPH',                  source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ball', label: 'Broyeur à Boulets', code: '05c', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const f80 = inp.f80_crush/5;
      const e = bond(inp.bwi, inp.p80_grind, f80);
      return [
        { id: uid(), parameter: 'Débit de conception',        value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',                  source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'F80 alimentation (post-SAG)',value: r(f80, 0),             unit: 'µm',    formula: 'F80_crush / 5',                source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 cible',                  value: r(inp.p80_grind, 0),  unit: 'µm',    formula: 'Testwork comminution',          source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'BWi',                        value: r(inp.bwi, 1),        unit: 'kWh/t', formula: 'Testwork LIMS',                source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique Bond',    value: r(e, 2),              unit: 'kWh/t', formula: 'Wi(10/√P80−10/√F80)',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',        value: r(e*inp.tph, 0),      unit: 'kW',    formula: 'E × TPH',                      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre boulets grinding',  value: r(Math.min(100,Math.max(25,inp.bwi*3)), 0), unit: 'mm', formula: 'min(100,max(25,BWi×3))', source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Charge en boulets (%)',      value: '35–40',              unit: '%v',    formula: 'Typique ball mill',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'rod', label: 'Broyeur à Barres', code: '05d', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e = bond(inp.brwi, 1000, inp.f80_crush)*1.1;
      return [
        { id: uid(), parameter: 'Débit de conception',        value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',              source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'BRWi',                       value: r(inp.brwi, 1),       unit: 'kWh/t', formula: 'Testwork LIMS',             source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique Rod',     value: r(e, 2),              unit: 'kWh/t', formula: 'BRWi(10/√1000−10/√F80)×1.1', source: 'Calcul', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',        value: r(e*inp.tph, 0),      unit: 'kW',    formula: 'E_rod × TPH',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 produit (typ.)',         value: '1000–3000',          unit: 'µm',    formula: 'Rod mill sortant',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── REBROYAGE ────────────────────────────────────────────────────────────
  {
    id: 'vertimill', label: 'Vertimill', code: '05g', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const p80r = 30; const e = bond(inp.bwi*0.7, p80r, inp.p80_grind);
      return [
        { id: uid(), parameter: 'F80 alimentation',           value: r(inp.p80_grind, 0), unit: 'µm',    formula: 'P80 broyage primaire',    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 cible',                  value: r(p80r, 0),          unit: 'µm',    formula: 'Selon circuit aval',      source: 'Pratique', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique',         value: r(e, 2),             unit: 'kWh/t', formula: 'Bond(BWI×0.7)',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit concentré traité',     value: r(inp.tph*inp.flot_mass_pull/100, 1), unit: 't/h', formula: 'TPH×Mass_pull%', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'isamill', label: 'IsaMill', code: '05f', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const p80i = 15; const e = bond(inp.bwi*0.6, p80i, inp.p80_grind)*1.2;
      return [
        { id: uid(), parameter: 'F80 alimentation',           value: r(inp.p80_grind, 0), unit: 'µm',    formula: 'P80 broyage',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 cible ultra-fin',        value: r(p80i, 0),          unit: 'µm',    formula: 'Typique IsaMill',      source: 'Pratique', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique',         value: r(e, 1),             unit: 'kWh/t', formula: 'Bond×0.6×1.2',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Milieux broyants',           value: '2–3',               unit: 'mm',    formula: 'Céramique IsaMill',   source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'towermill', label: 'Tower Mill', code: '05h', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const p80t = 38; const e = bond(inp.bwi*0.65, p80t, inp.p80_grind);
      const feed_tph = inp.tph * inp.flot_mass_pull / 100;
      const power = e * feed_tph;
      const media_kg_h = 0.08 * power;
      return [
        cr('F80 alimentation',       r(inp.p80_grind, 0), 'µm',    'P80 broyage'),
        cr('P80 cible',              r(p80t, 0),          'µm',    'Typique Tower Mill'),
        cr('Débit traité (concentré)', r(feed_tph, 1),    't/h',   'TPH × Mass_pull%'),
        cr('Énergie spécifique',     r(e, 1),             'kWh/t', 'Bond(BWi×0.65)'),
        cr('Puissance broyeur',      r(power, 0),         'kW',    'E × débit traité'),
        cr('Puissance moteur (marge)', r(power * 1.1, 0), 'kW',    'Puissance × 1.10'),
        cr('Consommation media',     r(media_kg_h, 1),    'kg/h',  '≈0.08 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '12–25', unit: 'mm', formula: 'Boulets/galets céramique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── CLASSIFICATION ───────────────────────────────────────────────────────
  {
    id: 'hydrocyclone', label: 'Hydrocyclones', code: '06a', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      const n = Math.max(2, Math.ceil(vol/150));
      return [
        { id: uid(), parameter: 'Volume pulpe à classifier',    value: r(vol, 0),        unit: 'm³/h', formula: 'TPH/SG/(%sol)',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Nb cyclones (+1 secours)',      value: `${n}+1`,         unit: '',     formula: 'Vol / 150 m³/h par cycl.',   source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'D50 coupure cible',             value: r(inp.p80_grind*0.6, 0), unit: 'µm', formula: 'P80 × 0.6',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit / cyclone',               value: r(vol/n, 0),      unit: 'm³/h', formula: 'Vol_total / N',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Pression alimentation',         value: '80–120',         unit: 'kPa',  formula: 'Typique classification',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'screen', label: 'Cribles Vibrants', code: '06b', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit de conception',            value: r(inp.tph, 0),                    unit: 't/h', formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Surface efficace totale',        value: r(inp.tph/25, 1),                 unit: 'm²',  formula: 'TPH / 25 t/(m²·h)',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',            value: r(inp.p80_grind/1000*1.5, 1),     unit: 'mm',  formula: 'P80/1000×1.5',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Inclinaison',                    value: '15–20',                          unit: '°',   formula: 'Typique crible',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ── SÉPARATION PHYSIQUE ──────────────────────────────────────────────────
  {
    id: 'xrt', label: 'Tri Optique (Ore Sorting XRT)', code: '02a', group: 'physep',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const reject = 0.25;                             // 25% waste rejection
      const product = inp.tph * (1 - reject);
      const n_machines = Math.max(1, Math.ceil(inp.tph / 120)); // ~120 t/h per module
      return [
        cr('Débit alimentation',       r(inp.tph, 0),     't/h', 'Débit projet', 'Projet'),
        cr('Débit produit (accepté)',  r(product, 0),     't/h', 'Alim × (1 − rejet)'),
        cr('Débit rejet (stérile)',    r(inp.tph * reject, 0), 't/h', 'Alim × rejet 25%'),
        cr('Nb machines de tri',       r(n_machines, 0),  '',    '≈ Alim / 120 t/h par module'),
        cr('Rejet massique cible',     r(reject * 100, 0),'%',   'Selon testwork minéralogie'),
        { id: uid(), parameter: 'Granulométrie traitée', value: '20–150', unit: 'mm', formula: 'Typique XRT sorting', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse courroie tri', value: '2.5–3.5', unit: 'm/s', formula: 'Typique ore sorting', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'dms', label: 'Séparation Milieu Dense (DMS)', code: '02b', group: 'physep',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const medium_flow = inp.tph * 4;                 // medium recirculation ≈ 4× feed
      const vessel_vol = inp.tph / inp.ore_sg / 0.5;
      return [
        cr('Débit alimentation',       r(inp.tph, 0),      't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('Débit médium recirculé',   r(medium_flow, 0),  'm³/h','≈ 4 × débit alimentation'),
        cr('Volume cuve/cyclone DMS',  r(vessel_vol, 0),   'm³',  'Alim / SG / 50%'),
        { id: uid(), parameter: 'Densité milieu dense', value: '2.65–3.1', unit: 'SG', formula: 'Selon minéraux gangue', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Efficacité séparation (Ep)', value: '0.03–0.06', unit: 'SG', formula: 'Testwork DMS', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Médium FeSi (conso)', value: '0.1–0.5', unit: 'kg/t', formula: 'Pertes typiques FeSi', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'magsep', label: 'Séparation Magnétique', code: '02c', group: 'physep',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const mag_frac = 0.12;
      return [
        cr('Débit alimentation',       r(inp.tph, 0),         't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('Débit fraction magnétique', r(inp.tph * mag_frac, 0), 't/h', 'Alim × 12%'),
        cr('Débit fraction non-magn.', r(inp.tph * (1 - mag_frac), 0), 't/h', 'Alim × 88%'),
        { id: uid(), parameter: 'Intensité champ', value: '0.5–2.0', unit: 'T', formula: 'Selon minéraux magnétiques', source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Type', value: 'LIMS / WHIMS', unit: '', formula: 'Selon susceptibilité', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'flash_flot', label: 'Flash Flotation', code: '08a', group: 'physep',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const vol = slurryVolFlow(inp, inp.slurry_density);
      const ret_min = 2;
      const cell_vol = vol * ret_min / 60;
      const air = cell_vol * 0.8;                       // ≈0.8 m³ air/min per m³ cell
      return [
        cr('Débit alimentation',   r(inp.tph, 0),   't/h',  'Débit projet', 'Projet'),
        cr('Volume pulpe',         r(vol, 0),       'm³/h', 'TPH/SG/(%sol)'),
        cr('Temps de rétention',   r(ret_min, 0),   'min',  'Typique flash flotation'),
        cr('Volume cellule flash', r(cell_vol, 0),  'm³',   'Q_pulpe × t_ret/60'),
        cr('Débit d\'air',         r(air, 0),       'm³/min','≈0.8 m³/min par m³ cellule'),
        cr('Récupération Au estimée', r(inp.grg_pct * 0.8, 1), '%', 'GRG × 80% (approx.)'),
      ];
    },
  },
  {
    id: 'column_flot', label: 'Colonnes de Flottation', code: '08b', group: 'physep',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      const vol = conc_tph / inp.ore_sg / 0.35;
      const cell_vol = vol * 20 / 60;
      const diam = Math.sqrt(cell_vol / 10 * 4 / Math.PI); // assuming ~10 m height
      const wash_water = vol * 0.15;
      return [
        cr('Débit concentré rougher', r(conc_tph, 1), 't/h', 'TPH × Mass_pull%'),
        cr('Volume pulpe',           r(vol, 0),       'm³/h','Concentré / SG / 35%'),
        cr('Volume colonne (20 min)', r(cell_vol, 0), 'm³',  'Q × 20 min/60'),
        cr('Diamètre colonne (H≈10 m)', r(diam, 1),   'm',   '√(4V/(π×H))'),
        cr('Débit eau de lavage',    r(wash_water, 1),'m³/h','≈15% du débit pulpe'),
        { id: uid(), parameter: 'Hauteur colonne', value: '8–12', unit: 'm', formula: 'Typique flottation colonne', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Biais (bias) positif', value: '0.1–0.3', unit: 'cm/s', formula: 'Eau lavage > entraînement', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── TRAITEMENT ───────────────────────────────────────────────────────────
  {
    id: 'gravity', label: 'Gravimétrie (GRG)', code: '07', group: 'treatment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const au_grav = inp.tph * inp.gold_grade * inp.grg_pct/100;
      const n_conc = Math.max(1, Math.ceil(inp.tph/50));
      return [
        { id: uid(), parameter: 'GRG (récupération gravité)',    value: r(inp.grg_pct, 1),    unit: '%',    formula: 'Testwork Knelson LIMS',     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Au alimentation',               value: r(inp.gold_grade, 2), unit: 'g/t',  formula: 'Teneur modèle de blocs',    source: 'Gisement', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Or récupéré gravité',           value: r(au_grav, 1),        unit: 'g/h',  formula: 'TPH × Grade × GRG%',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit concentré Knelson',       value: r(inp.tph*2, 0),      unit: 'kg/h', formula: 'TPH × 2 kg/t',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Nb concentrateurs (N+1)',        value: `${n_conc}+1`,        unit: '',     formula: 'TPH / 50 t/h par unité',    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 alimentation',              value: r(inp.p80_grind, 0),  unit: 'µm',   formula: 'P80 broyage',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'intensive_leach', label: 'Lixiviation Intensive (ILR)', code: '07b', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit concentré gravitaire',     value: r(inp.tph*2, 0),    unit: 'kg/h', formula: 'TPH × 2 kg/t',                  source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Temps de rétention ILR',         value: '4–8',              unit: 'h',    formula: 'Typique batch ILR',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'NaCN concentration ILR',         value: '20–50',            unit: 'g/L',  formula: 'Haute teneur NaCN',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Récupération ILR (cycle)',       value: '90–97',            unit: '%',    formula: 'Typique Acacia/Gekko ILR',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'flotation', label: 'Flottation', code: '08', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      const vcell = vol*20/60;
      const n = Math.max(6, Math.ceil(vcell/30));
      return [
        { id: uid(), parameter: 'Récupération Au',               value: r(inp.flot_rec, 1),   unit: '%',    formula: 'Testwork LIMS',             source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Mass pull',                     value: r(inp.flot_mass_pull,1), unit: '%', formula: 'Testwork LIMS',              source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume total cellules',         value: r(vcell, 0),          unit: 'm³',   formula: 'Q × 20 min/60',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Nombre de cellules',            value: r(n, 0),              unit: '',     formula: 'V_total / 30 m³',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 alimentation',              value: r(inp.p80_grind, 0),  unit: 'µm',   formula: 'P80 broyage',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'pH alimentation',               value: '8.0–9.0',           unit: '',     formula: 'Typique flottation sulf.',   source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Collecteur (PAX)',               value: '30–50',             unit: 'g/t',  formula: 'Testwork flottation',       source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'trash_screen', label: 'Crible Trash (Pré-lixiviation)', code: '06t', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit pulpe',                    value: r(inp.tph/inp.ore_sg/(inp.slurry_density/100), 0), unit: 'm³/h', formula: 'TPH/SG/(%sol)', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',            value: '0.5–1.0',           unit: 'mm',  formula: 'Élimination débris',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Type de tamis',                  value: 'Wedge wire',        unit: '',    formula: 'Résistant abrasion',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'preleach_thickener', label: 'Épaississeur Pré-Lixiviation', code: '11p', group: 'treatment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const ua = inp.thickener_area_factor;
      const td = inp.tph*inp.availability/100*24;
      const area = td*ua/1000;
      return [
        { id: uid(), parameter: 'Débit traitement',             value: r(inp.tph, 0),    unit: 't/h',      formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Aire unitaire',                value: r(ua, 3),         unit: 'm²/(t/j)', formula: 'Testwork décantation',     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface épaississeur',        value: r(area, 0),        unit: 'm²',       formula: 'T/j × Aire/1000',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre estimé',              value: r(Math.sqrt(area*4/Math.PI), 1), unit: 'm', formula: '√(4A/π)',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Densité soutirage cible',     value: '50–55',           unit: '% sol',    formula: 'Testwork décantation',     source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cil', label: 'Lixiviation CIL / CIP', code: '09', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      const vtank = vol*24/6;
      const au_out = inp.tph*inp.gold_grade*inp.leach_rec_24h/100;
      return [
        { id: uid(), parameter: 'Densité pulpe CIL',            value: r(inp.slurry_density,0), unit: '% sol', formula: 'Testwork lixiviation',     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume pulpe / heure',         value: r(vol, 0),               unit: 'm³/h',  formula: 'TPH/SG/(%sol)',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au 24h',          value: r(inp.leach_rec_24h,1),  unit: '%',     formula: 'Testwork LIMS',            source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au 48h',          value: r(inp.leach_rec_48h,1),  unit: '%',     formula: 'Testwork LIMS',            source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume par cuve (6 cuves)',    value: r(vtank, 0),             unit: 'm³',    formula: 'Q×24h / 6',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Or en solution / heure',       value: r(au_out, 1),            unit: 'g/h',   formula: 'TPH × Grade × Rec%',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN consommation',            value: r(inp.cyanide_cons, 1),  unit: 'kg/t',  formula: 'Testwork LIMS',            source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Chaux (CaO)',                  value: r(inp.lime_cons, 1),     unit: 'kg/t',  formula: 'Testwork LIMS',            source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Oxygène dissous cible',        value: r(inp.dissolved_o2, 0),  unit: 'mg/L',  formula: 'Testwork (>6 mg/L)',       source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Charbon actif',                value: r(inp.carbon_conc, 0),   unit: 'g/L',   formula: 'Testwork CIL',             source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'pH cible',                     value: '10.5–11.0',            unit: '',      formula: 'Stabilité NaCN',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'adr', label: 'ADR — Élution & Électrolyse', code: '10', group: 'treatment',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const au_g_h = inp.tph*inp.gold_grade*inp.leach_rec_24h/100;
      const au_oz_d = au_g_h*24/31.1035;
      const cols = Math.max(1, Math.ceil(au_oz_d/800));
      const cells = Math.max(1, Math.ceil(au_oz_d/400));
      return [
        { id: uid(), parameter: 'Or en solution entrant',      value: r(au_g_h, 1),          unit: 'g/h',  formula: 'TPH × Grade × Rec%',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Production or estimée',        value: r(au_oz_d, 0),         unit: 'oz/j', formula: 'Au_g/h × 24 / 31.1',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température élution',          value: r(inp.elution_temp,0), unit: '°C',   formula: 'AARL:110–120°C / Zadra:85°C',  source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Nb colonnes élution',          value: r(cols, 0),            unit: '',     formula: 'Au_oz/j / 800 oz/col/j',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Densité courant EW',           value: r(inp.ew_current_density,0), unit: 'A/m²', formula: 'Testwork / pratique', source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Nombre de cellules EW',        value: r(cells, 0),           unit: '',     formula: 'Au_oz/j / 400 oz/cellule/j',   source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Efficacité EW',                value: '95–98',               unit: '%',    formula: 'Industrie',                    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'o2_plant', label: 'Usine d\'Oxygène', code: '09o', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      const o2 = vol * inp.dissolved_o2 / 1000;
      return [
        { id: uid(), parameter: 'Débit O₂ requis (CIL)',        value: r(o2, 1),          unit: 'kg/h', formula: 'V_pulpe × DO_mg/L / 1000',  source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Pureté oxygène',               value: '>90',             unit: '%',    formula: 'VPSA / cryogénique',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression injection',           value: '150–300',         unit: 'kPa',  formula: 'Pression hydrostatique+',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'interstage_screens', label: 'Tamis Interstades (CIL/CIP)', code: '09s', group: 'treatment',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit pulpe par tamis',          value: r(inp.tph/inp.ore_sg/(inp.slurry_density/100)/6, 0), unit: 'm³/h', formula: 'Q_CIL / 6 cuves', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',            value: '0.8–1.0',          unit: 'mm',  formula: 'Rétention charbon ≥1mm',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Nombre de tamis',                value: '7 (6 inter + 1)', unit: '',     formula: 'N_cuves + 1',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'acid_wash', label: 'Lavage Acide du Charbon', code: '10a', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Concentration acide',            value: '3–5',              unit: '% HCl', formula: 'Lavage acide charbon',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Temps de contact',               value: '30–60',            unit: 'min',   formula: 'Dissolution Ca, Mg, carbonates', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Neutralisation effluent',        value: 'NaOH / Chaux',    unit: '',      formula: 'pH > 9 avant rejet',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'carbon_reg', label: 'Régénération Charbon (Four)', code: '10b', group: 'treatment',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const carbon_kg_h = inp.carbon_conc * inp.tph/inp.ore_sg/(inp.slurry_density/100) * 0.002;
      return [
        { id: uid(), parameter: 'Débit charbon régénéré',      value: r(carbon_kg_h, 1), unit: 'kg/h',  formula: 'C_g/L × V × 0.2%',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température four',            value: '650–750',         unit: '°C',    formula: 'Pyrolyse contaminants org.',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Rendement régénération',      value: '98–99',           unit: '%',     formula: 'Charbon actif haute qualité',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Perte attrition',             value: '1–3',             unit: '%/cyc', formula: 'Pertes mécaniques',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'merrill_crowe', label: 'Merrill-Crowe (Zn)', code: '10z', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Or en solution (filtrat)',       value: r(inp.tph*inp.gold_grade*inp.leach_rec_24h/100, 1), unit: 'g/h', formula: 'TPH×Grade×Rec%', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      { id: uid(), parameter: 'Consommation zinc (Zn)',         value: '0.05–0.2',         unit: 'kg/t', formula: 'Selon teneur en solution',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Clarification requise',          value: '<1 NTU',           unit: '',     formula: 'Turbidité avant précipitation', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Déaération O₂',                 value: '<0.5',             unit: 'mg/L', formula: 'Pompe à vide / tour déaération', source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ── OXYDATION RÉFRACTAIRE ────────────────────────────────────────────────
  {
    id: 'pox', label: 'Autoclave POX', code: '09c', group: 'refractory',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const feed = inp.tph*(inp.flot_mass_pull > 0 ? inp.flot_mass_pull/100 : 1);
      return [
        { id: uid(), parameter: 'Débit alimentation POX',      value: r(feed, 1),       unit: 't/h', formula: 'Concentré flot. ou tout-venant', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température d\'opération',    value: '190–230',        unit: '°C',  formula: 'POX haute pression soufre',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression totale',             value: '2.0–3.5',        unit: 'MPa', formula: 'Selon minéralogie',               source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention',          value: '60–90',          unit: 'min', formula: 'Selon teneur soufre',             source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Oxydation S cible',          value: '>95',            unit: '%',   formula: 'Testwork POX',                    source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'biox', label: 'Bio-Oxydation (BIOX)', code: '09e', group: 'refractory',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const feed = inp.tph*(inp.flot_mass_pull > 0 ? inp.flot_mass_pull/100 : 0.3);
      return [
        { id: uid(), parameter: 'Débit alimentation BIOX',     value: r(feed, 1),       unit: 't/h', formula: 'Concentré flotation',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température opération',       value: '35–45',          unit: '°C',  formula: 'Bactéries thiobacillus',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention total',    value: '3–6',            unit: 'j',   formula: 'Selon teneur soufre',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'pH opération',               value: '1.2–1.8',        unit: '',    formula: 'Acidothermophiles actifs',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Oxydation S cible',          value: '>80',            unit: '%',   formula: 'Testwork BIOX',                  source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'roasting', label: 'Rôtissage (Roasting)', code: '09d', group: 'refractory',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const feed = inp.tph*(inp.flot_mass_pull > 0 ? inp.flot_mass_pull/100 : 0.3);
      return [
        { id: uid(), parameter: 'Débit alimentation',           value: r(feed, 1),       unit: 't/h', formula: 'Concentré flotation',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température four',             value: '550–700',        unit: '°C',  formula: 'Oxydation pyrite/arsénopyrite',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'SO₂ / As — traitement gaz',  value: 'REQUIS',         unit: '',    formula: 'Réglementation As/SO₂',          source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au post-roasting', value: '88–95',        unit: '%',   formula: 'Testwork',                        source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'albion', label: 'Procédé Albion', code: '09f', group: 'refractory',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const feed = inp.tph*(inp.flot_mass_pull > 0 ? inp.flot_mass_pull/100 : 0.3);
      return [
        { id: uid(), parameter: 'Débit alimentation',           value: r(feed, 1),       unit: 't/h', formula: 'Concentré flot. ultra-fin',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'P80 alimentation (IsaMill)',   value: '10–15',          unit: 'µm',  formula: 'Ultra-fin avant Albion',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Température oxydation',        value: '85–95',          unit: '°C',  formula: 'Autothermique avec O₂',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Oxydation S cible',           value: '>90',            unit: '%',   formula: 'Testwork Albion',                 source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── RÉACTIFS ─────────────────────────────────────────────────────────────
  {
    id: 'cn_prep', label: 'Préparation Cyanure', code: 'R01', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const cn_kg_h = inp.cyanide_cons * inp.tph;
      return [
        { id: uid(), parameter: 'Consommation NaCN',            value: r(inp.cyanide_cons, 2), unit: 'kg/t',  formula: 'Testwork LIMS',               source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit NaCN',                   value: r(cn_kg_h, 1),          unit: 'kg/h',  formula: 'NaCN_cons × TPH',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage min. (30 jours)',     value: r(cn_kg_h*24*30/1000, 0), unit: 't',   formula: 'Débit × 720h / 1000',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Concentration stock NaCN',     value: '30–50',                unit: '% m/v', formula: 'Solution stock pour dosage',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'lime_prep', label: 'Extinction de Chaux', code: 'R02', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const lime_kg_h = inp.lime_cons * inp.tph;
      return [
        { id: uid(), parameter: 'Consommation chaux',           value: r(inp.lime_cons, 2),    unit: 'kg/t',  formula: 'Testwork LIMS',               source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Débit chaux (CaO)',            value: r(lime_kg_h, 1),        unit: 'kg/h',  formula: 'Lime_cons × TPH',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Capacité extincteur',          value: r(lime_kg_h*1.3, 0),    unit: 'kg/h',  formula: 'Débit × 1.3',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage silo (7 jours)',      value: r(lime_kg_h*24*7/1000, 0), unit: 't', formula: 'Débit × 168h / 1000',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'floculant_prep', label: 'Préparation Floculant', code: 'R03', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const floc_kg_h = 20 * inp.tph / 1000;
      return [
        { id: uid(), parameter: 'Consommation floculant',       value: '15–30',                unit: 'g/t',   formula: 'Testwork floculant',           source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Débit floculant',              value: r(floc_kg_h, 2),        unit: 'kg/h',  formula: 'Floc_g/t × TPH / 1000',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume cuve préparation',      value: r(floc_kg_h*4/5, 1),    unit: 'm³',    formula: 'Prépa 0.25% en 4h',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Maturité solution',            value: '45–60',                unit: 'min',   formula: 'Temps hydratation polymère',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'flot_reagents', label: 'Réactifs Flottation', code: 'R04', group: 'reagents',
    icon: <FlaskConical size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Collecteur (PAX / NaAMX)',       value: '30–50',    unit: 'g/t',  formula: 'Testwork flottation',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Moussant (MIBC)',                value: '10–20',    unit: 'g/t',  formula: 'Testwork flottation',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Déprimant (NaCN / Na₂S)',       value: '100–300',  unit: 'g/t',  formula: 'Selon minéralogie',               source: 'Testwork', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Régulateur pH (CaO)',            value: '500–1500', unit: 'g/t',  formula: 'pH alimentation 8–9',            source: 'Testwork', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ── SERVICES & UTILITÉS ──────────────────────────────────────────────────
  {
    id: 'water_sys', label: 'Systèmes d\'Eau', code: 'U01', group: 'services',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const w = inp.tph*2.5/inp.ore_sg;
      return [
        { id: uid(), parameter: 'Consommation eau totale',      value: r(w, 0),          unit: 'm³/h', formula: 'TPH × 2.5 / SG',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Eau process (CIL/CIP)',        value: r(w*0.6, 0),      unit: 'm³/h', formula: '60% du total',                source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Recyclage eau clarifiée',      value: '>70',            unit: '%',    formula: 'Objectif récupération eau',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'compressed_air', label: 'Air Comprimé & Soufflantes', code: 'U02', group: 'services',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit air instrument',           value: r(inp.tph*0.05, 1), unit: 'm³/min', formula: 'TPH × 0.05',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Pression air instrument',        value: '700–800',           unit: 'kPa',    formula: 'Standard instrumentation', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Pression air service',           value: '600–700',           unit: 'kPa',    formula: 'Standard service',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'pumps', label: 'Pompes à Pulpe (Principales)', code: 'U03', group: 'services',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const vol = inp.tph/inp.ore_sg/(inp.slurry_density/100);
      return [
        { id: uid(), parameter: 'Volume pulpe à pomper',        value: r(vol, 0),          unit: 'm³/h', formula: 'TPH/SG/(%sol)',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Capacité pompe design (×1.2)', value: r(vol*1.2, 0),      unit: 'm³/h', formula: 'Q × 1.2',                  source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Revêtement pompe',             value: 'Gomme / Métal dur', unit: '',    formula: 'Selon %solides et d50',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'power_supply', label: 'Alimentation Électrique', code: 'U04', group: 'services',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const e_sag = bond(inp.bwi*1.3, inp.p80_grind, inp.f80_crush)*0.55*inp.tph;
      const e_ball = bond(inp.bwi, inp.p80_grind, inp.f80_crush/5)*inp.tph;
      const total = (e_sag + e_ball) * 1.4;
      return [
        { id: uid(), parameter: 'Puissance SAG estimée',        value: r(e_sag, 0),       unit: 'kW', formula: 'Énergie SAG × TPH',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance Ball estimée',       value: r(e_ball, 0),      unit: 'kW', formula: 'Énergie Ball × TPH',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Charge totale estimée',        value: r(total, 0),       unit: 'kW', formula: '(SAG+Ball) × 1.4',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Tension distribution usine',   value: '6.6 / 4.16',     unit: 'kV', formula: 'Selon puissance moteurs',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ── ENVIRONNEMENT ────────────────────────────────────────────────────────
  {
    id: 'detox', label: 'Détoxification Cyanure', code: 'E01', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit résidus à traiter',        value: r(inp.tph/inp.ore_sg/0.4, 0), unit: 'm³/h', formula: 'TPH/SG/40%sol', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'NaCN résiduel avant détox',      value: '50–200',           unit: 'mg/L', formula: 'Post-lixiviation',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'NaCN cible (ICMC)',              value: '<50',              unit: 'mg/L', formula: 'Code international cyanure',  source: 'Réglement', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Conso H₂O₂',                    value: '0.3–0.5',          unit: 'kg/t', formula: 'Pratique détox H₂O₂',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'CN− aval résiduel',             value: '<1',               unit: 'mg/L', formula: 'ICMC Gold Standard',          source: 'Réglement', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'sart', label: 'SART (Cu Cyanicide)', code: 'E02', group: 'environment',
    icon: <FlaskConical size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Application SART',               value: 'Si Cu >100 ppm', unit: '',     formula: 'Cuivre lixivié > seuil',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'pH ajustement H₂SO₄',          value: '2.5–3.5',         unit: '',     formula: 'Précipitation CuCN',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Recyclage NaCN',                 value: '90–95',           unit: '%',    formula: 'Réduction conso NaCN',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'dry_stack', label: 'Résidus Filtrés (Dry Stack)', code: 'E03', group: 'environment',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const vol = inp.tph/1.5;
      const area = vol/0.1;
      return [
        { id: uid(), parameter: 'Débit résidus filtrés',        value: r(inp.tph, 0),    unit: 't/h', formula: 'Débit projet',                  source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface filtrante totale',     value: r(area, 0),       unit: 'm²',  formula: 'Vol / 0.1 m³/(m²·h)',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Humidité gâteau cible',        value: '12–16',          unit: '%',   formula: 'Résidus empilables à sec',      source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'effluent', label: 'Traitement des Effluents', code: 'E04', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Volume effluents à traiter',     value: r(inp.tph*0.1, 0), unit: 'm³/h', formula: 'TPH × 10%',                    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'As total cible effluent',        value: '<0.1',            unit: 'mg/L', formula: 'Réglementation eau',            source: 'Réglement', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Cu soluble cible',               value: '<0.3',            unit: 'mg/L', formula: 'Réglementation eau',            source: 'Réglement', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ── SÉPARATION SOLIDE-LIQUIDE ────────────────────────────────────────────
  {
    id: 'thickener', label: 'Épaississeur', code: '11a', group: 'slsep',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const ua = inp.thickener_area_factor;
      const td = inp.tph*inp.availability/100*24;
      const area = td*ua/1000;
      return [
        { id: uid(), parameter: 'Débit de conception',          value: r(inp.tph, 0),    unit: 't/h',      formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Tonnes/jour',                  value: r(td, 0),         unit: 't/j',      formula: 'TPH × H/j',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Aire unitaire (testwork)',     value: r(ua, 3),         unit: 'm²/(t/j)', formula: 'Testwork décantation',     source: 'LIMS',     isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface totale épaississeur',  value: r(area, 0),       unit: 'm²',       formula: 'T/j × Aire/1000',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre épaississeur',        value: r(Math.sqrt(area*4/Math.PI), 1), unit: 'm', formula: '√(4A/π)',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Densité boue soutirage',       value: '45–55',          unit: '% sol',    formula: 'Testwork décantation',     source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Flocculant consommation',      value: '15–30',          unit: 'g/t',      formula: 'Testwork floculant',       source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'filter', label: 'Filtre Presse', code: '11b', group: 'slsep',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const vol = inp.tph/1.5; const area = vol/0.1;
      return [
        { id: uid(), parameter: 'Débit de conception',          value: r(inp.tph, 0),    unit: 't/h', formula: 'Débit projet',               source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface filtrante totale',     value: r(area, 0),       unit: 'm²',  formula: 'Vol / 0.1 m³/(m²·h)',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Humidité gâteau',              value: '15–18',          unit: '%',   formula: 'Testwork filtration',        source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression filtration',          value: '8–12',           unit: 'bar', formula: 'Typique filtre presse',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'tailings', label: 'Gestion Résidus (TSF)', code: '11c', group: 'slsep',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const vol = inp.tph*0.999/inp.ore_sg/0.4;
      return [
        { id: uid(), parameter: 'Débit résidus',                value: r(inp.tph*0.999, 0), unit: 't/h', formula: 'TPH (≈totalité)',            source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume pulpe résidus',         value: r(vol, 0),           unit: 'm³/h', formula: 'TPH/SG/40%sol',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN résiduel avant détox',    value: '50–200',            unit: 'mg/L', formula: 'Post-lixiviation',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN cible (ICMC)',            value: '<50',               unit: 'mg/L', formula: 'ICMC Code',                  source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── CONCASSAGE ──────────────────────────────────
  {
    id: 'jaw', label: 'Concasseur à Mâchoires', code: '03a', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp, phase) => {
      // Template 03_CRUSHING — primary jaw via Bond CWi + installed power.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1);
      const f80 = inp.f80_rom_mm * 1000;
      const p80 = inp.p80_primary_mm * 1000;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 30);
      return [
        cr('Capacité nominale',            r(inp.tph, 0),      't/h',  'Débit projet', 'Projet'),
        cr('Débit DESIGN concassage',      r(q_design, 0),     't/h',  'Q_broyage × dispo_broy / dispo_conc'),
        cr('F80 alimentation (ROM)',       r(f80, 0),          'µm',   'F80 ROM × 1000'),
        cr('P80 produit primaire',         r(p80, 0),          'µm',   'P80 concassage primaire × 1000'),
        cr('Ratio de réduction R80',       r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('Bond Crushing WI (CWi)',       r(inp.cwi, 1),      'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 3),            'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre (P_shaft)',    r(p_shaft, 0),      'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE moteur',   r(p_install, 0),    'kW',   'P_shaft / η_méca × (1 + 30%)'),
        cr('Ouverture alimentation (gape)', r(inp.f80_rom_mm * 1.2, 0), 'mm', '1.2 × F80 ROM'),
        { id: uid(), parameter: `Précision (${phase})`,               value: phaseSuffix(phase),   unit: '',      formula: `Phase ${phase}`,                 source: 'Phase',    isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'cone', label: 'Concasseur à Cône', code: '03c', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => {
      // Template 03_CRUSHING §3 — secondary cone via Bond CWi on secondary size reduction.
      const q_grind = inp.tph * (1 + inp.sf_grind / 100);
      const q_design = q_grind * inp.availability / Math.max(inp.avail_crush, 1);
      const f80 = inp.p80_primary_mm * 1000;
      const p80 = inp.p80_secondary_mm * 1000;
      const w = bond(inp.cwi, p80, f80);
      const p_shaft = w * q_design;
      const p_install = installedPower(p_shaft, inp.eta_mech, 25);
      const css = inp.p80_secondary_mm * 0.85;
      return [
        cr('Débit alimentation (design)',  r(q_design, 0),  't/h',  'Débit design concassage'),
        cr('F80 alimentation',             r(f80, 0),       'µm',   'P80 primaire × 1000'),
        cr('P80 produit secondaire',       r(p80, 0),       'µm',   'P80 sec. × 1000'),
        cr('Ratio de réduction',           r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('CSS estimé',                   r(css, 0),       'mm',   '≈0.85 × P80 sec.'),
        cr('Énergie Bond W (secondaire)',  r(w, 3),         'kWh/t','10·CWi·(1/√P80 − 1/√F80)'),
        cr('Puissance arbre',              r(p_shaft, 0),   'kW',   'W × débit design'),
        cr('PUISSANCE INSTALLÉE',          r(p_install, 0), 'kW',   'P_shaft / η_méca × (1 + 25%)'),
        { id: uid(), parameter: 'Modèle suggéré', value: 'Metso MP1000 / HP500', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'hpgr', label: 'HPGR', code: '04', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => {
      // Template 04_HPGR — m-dot capacity, pressing force, twin-motor installed power.
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const recycle = 25;                              // % edge + screen recycle
      const q_roll = fresh * (1 + recycle / 100);
      const D = 2.4, L = 1.7, N = 18;                  // roll geometry (m, m, rpm)
      const u = Math.PI * D * N / 60;                  // peripheral speed m/s
      const mdot = 250;                                // ts/(h·m³) specific throughput
      const cap_unit = mdot * D * L * u;               // capacity per unit t/h
      const n_units = Math.max(1, Math.ceil(q_roll / cap_unit));
      const f_sp = 4.5;                                // N/mm² specific pressing force
      const force_kn = f_sp * D * 1000 * L;            // kN per roll
      const e_sp = 2.3;                                // kWh/t specific energy
      const p_net = e_sp * cap_unit;                   // kW per unit (net)
      const p_roll = installedPower(p_net / 2, 95, 15);// per roll (twin), η 95%, margin 15%
      const p_total = p_roll * 2 * n_units;
      return [
        cr('Débit fresh feed (design)',    r(fresh, 0),     't/h',  'TPH × (1 + facteur design broyage)'),
        cr('Recycle (edge + crible)',      r(recycle, 0),   '%',    'Edge recycle 15–30 %'),
        cr('Débit total roll',             r(q_roll, 0),    't/h',  'Fresh × (1 + recycle)'),
        cr('Vitesse périphérique u',       r(u, 2),         'm/s',  'π·D·N/60'),
        cr('Capacité unitaire M',          r(cap_unit, 0),  't/h',  'ṁ · D · L · u'),
        cr('Nombre HPGR requis',           r(n_units, 0),   'unités','Q_total / capacité unitaire'),
        cr('Force spécifique F_sp',        r(f_sp, 1),      'N/mm²','3.0–5.5 typique', 'Testwork'),
        cr('Force totale par rouleau',     r(force_kn, 0),  'kN',   'F_sp · D · L'),
        cr('Énergie spécifique E_sp',      r(e_sp, 1),      'kWh/t','1.5–2.8 kWh/t'),
        cr('Puissance installée / rouleau', r(p_roll, 0),   'kW',   '(E·M/2) / η × (1+15%)'),
        cr('PUISSANCE TOTALE HPGR',        r(p_total, 0),   'kW',   '2 rouleaux × N unités'),
        { id: uid(), parameter: 'Diamètre × longueur rouleaux', value: `${D} × ${L}`, unit: 'm', formula: 'Aspect L/D ≈ 0.7', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Crible humide post-HPGR', value: '6', unit: 'mm', formula: 'Coupure circuit fermé', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── BROYAGE ────────────────────────────────────
  {
    id: 'sag', label: 'Broyeur SAG', code: '05b', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e_sag = bond(inp.bwi * 1.3, inp.p80_grind, inp.f80_crush) * 0.55;
      const power = e_sag * inp.tph;
      const vol_m3 = inp.tph / inp.ore_sg / 0.35;
      const aspect = 1.5;                          // L/D for a typical SAG
      const diam_m = Math.pow(vol_m3 / (Math.PI / 4 * aspect), 1 / 3);
      const len_m = diam_m * aspect;
      const motor_kw = power * 1.10;               // 10% design margin
      const rpm = millRpm(diam_m, 75);             // at 75% of critical
      const charge_vol = vol_m3 * 0.11;            // ~11% ball charge by mill volume
      const ball_charge_t = charge_vol * 7.8;      // steel media bulk density ≈ 7.8 t/m³
      const media_kg_h = 0.10 * power;             // ≈0.10 kg/kWh SAG media wear
      return [
        cr('Débit de conception',          r(inp.tph, 0),       't/h',   'Débit projet', 'Projet'),
        cr('Débit massique annuel',        r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('F80 alimentation',             r(inp.f80_crush, 0), 'µm',    'P80 concasseur'),
        cr('P80 produit cible',            r(inp.p80_grind, 0), 'µm',    'Testwork comminution', 'LIMS'),
        cr('BWi (Bond Work Index)',        r(inp.bwi, 1),       'kWh/t', 'Testwork LIMS', 'LIMS'),
        cr('Énergie spécifique SAG',       r(e_sag, 2),         'kWh/t', 'Bond: Wi×1.3×(10/√P80−10/√F80)×0.55'),
        cr('Puissance au broyeur',         r(power, 0),         'kW',    'E_sag × TPH'),
        cr('Puissance moteur installée',   r(motor_kw, 0),      'kW',    'Puissance × 1.10 (marge)'),
        cr('Diamètre intérieur (approx)',  r(diam_m, 1),        'm',     'V=TPH/(SG×0.35); D=(V/(π/4×L/D))^(1/3)'),
        cr('Longueur (L/D≈1.5)',           r(len_m, 1),         'm',     'D × 1.5'),
        cr('Vitesse de rotation (75% Vc)', r(rpm, 1),           'rpm',   'Nc=42.3/√D; N=Nc×0.75'),
        cr('Masse charge boulets',         r(ball_charge_t, 0), 't',     'V×11% × 7.8 t/m³'),
        cr('Consommation media (acier)',   r(media_kg_h, 0),    'kg/h',  '≈0.10 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Charge en boulets (%)',        value: '10–12',             unit: '%v',    formula: 'Typique SAG',                    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse critique (%)',         value: '72–78',             unit: '%Vc',   formula: 'Typique SAG',                    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ag', label: 'Broyeur AG', code: '05a', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e_ag = bond(inp.bwi * 1.2, inp.p80_grind, inp.f80_crush) * 0.65;
      const power = e_ag * inp.tph;
      return [
        { id: uid(), parameter: 'Débit de conception',     value: r(inp.tph, 0),       unit: 't/h',   formula: 'Débit projet',        source: 'Projet', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'F80 alimentation',        value: r(inp.f80_crush, 0), unit: 'µm',    formula: 'P80 concasseur',      source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'P80 produit',             value: r(inp.p80_grind, 0), unit: 'µm',    formula: 'Testwork',            source: 'LIMS',   isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Énergie spécifique AG',   value: r(e_ag, 2),          unit: 'kWh/t', formula: 'Bond×1.2×0.65',       source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance installée',     value: r(power, 0),         unit: 'kW',    formula: 'E_ag × TPH',          source: 'Calcul', isCalc: true, comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse critique (%)',    value: '70–76',             unit: '%Vc',   formula: 'Typique AG',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'ball', label: 'Broyeur à Boulets', code: '05c', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      // Template 05_GRINDING — ball mill with Rowland EF corrections + Bond power & sizing.
      const q_design = inp.tph * (1 + inp.sf_grind / 100);
      const f80 = inp.p80_hpgr_mm * 1000 * 0.75;       // 0.75 × HPGR product
      const p80 = inp.p80_grind;                       // cyclone OF primary target
      const w = bond(inp.bwi, p80, f80);               // uncorrected Bond
      const ef = rowlandEF(inp.bwi, f80, p80);         // EF4 × EF5
      const w_corr = w * ef;
      const p_shaft = w_corr * q_design;
      const p_install = installedPower(p_shaft, inp.eta_motor, inp.sf_grind);
      // Split across parallel grinding lines so a single mill stays within real limits (~22 MW / GMD).
      const n_lines = Math.max(1, Math.ceil(p_install / 22000));
      const p_line = p_install / n_lines;
      // Mill diameter (per line) from Bond/Rowland mill-power formula P = k·D^2.3·L, L=LD·D ⇒ P=k·D^3.3.
      const Jb = 0.30, phi = 0.75, rho = 4.65, LD = 1.5;
      const k = 7.33 * Jb * phi * (1 - 0.937 * Jb) * rho * LD;
      const D = Math.pow(p_line / k, 1 / 3.3);
      const media_kg_h = inp.ball_cons * inp.tph;
      return [
        cr('Débit alimentation (design)',  r(q_design, 0),  't/h',  'TPH × (1 + facteur design broyage)'),
        cr('F80 alimentation',             r(f80, 0),       'µm',   '0.75 × P80 HPGR'),
        cr('P80 cible (cyclone OF)',       r(p80, 0),       'µm',   'Cible broyage', 'LIMS'),
        cr('Ratio de réduction',           r(p80 > 0 ? f80 / p80 : 0, 1), '', 'F80 / P80'),
        cr('Bond BWi',                     r(inp.bwi, 1),   'kWh/t','Testwork LIMS', 'LIMS'),
        cr('Énergie Bond W',               r(w, 2),         'kWh/t','10·BWi·(1/√P80 − 1/√F80)'),
        cr('Corrections Rowland (EF4·EF5)', r(ef, 3),       '',     'F80,opt=4000√(13/Wi); EF fines'),
        cr('Énergie corrigée W_corr',      r(w_corr, 2),    'kWh/t','W × ∏ EFi'),
        cr('Puissance arbre requise',      r(p_shaft, 0),   'kW',   'W_corr × débit'),
        cr('PUISSANCE INSTALLÉE totale',   r(p_install, 0), 'kW',   'P_shaft / η_moteur × (1 + marge)'),
        cr('Nombre de lignes de broyage',  r(n_lines, 0),   '',     '⌈P / 22 MW par broyeur⌉'),
        cr('Puissance par broyeur',        r(p_line, 0),    'kW',   'P_totale / N_lignes'),
        cr('Diamètre intérieur D (EGL)',   r(D, 1),         'm',    'De P_ligne=k·D^3.3 (Bond/Rowland)'),
        cr('Longueur intérieure L',        r(D * LD, 1),    'm',    'D × L/D (1.5)'),
        cr('Vitesse de rotation (75% Vc)', r(millRpm(D, 75), 1), 'rpm', 'Nc=42.3/√D; N=Nc×0.75'),
        cr('Top size boulet recharge',     r(Math.min(100, Math.max(25, inp.bwi * 3)), 0), 'mm', 'Formule Bond d_b'),
        cr('Consommation boulets acier',   r(media_kg_h, 0),'kg/h', 'Conso spécifique × TPH'),
        { id: uid(), parameter: 'Remplissage boulets J_b', value: '28–35', unit: '%v', formula: 'Std ball mill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Configuration moteur', value: 'Twin pinion / GMD', unit: '', formula: 'Selon puissance', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'rod', label: 'Broyeur à Barres', code: '05d', group: 'grinding',
    icon: <RefreshCw size={13} />,
    rows: (inp) => {
      const e_rod = bond(inp.brwi, 1000, inp.f80_crush) * 1.1;
      const power = e_rod * inp.tph;
      const vol = inp.tph / inp.ore_sg / 0.40;
      const aspect = 1.5;
      const diam = Math.pow(vol / (Math.PI / 4 * aspect), 1 / 3);
      const rpm = millRpm(diam, 65);
      return [
        cr('Débit de conception',    r(inp.tph, 0),   't/h',   'Débit projet', 'Projet'),
        cr('BRWi',                   r(inp.brwi, 1),  'kWh/t', 'Testwork LIMS', 'LIMS'),
        cr('Énergie spécifique Rod', r(e_rod, 2),     'kWh/t', 'BRWi(10/√1000−10/√F80)×1.1'),
        cr('Puissance au broyeur',   r(power, 0),     'kW',    'E_rod × TPH'),
        cr('Puissance moteur (marge)', r(power * 1.1, 0), 'kW','Puissance × 1.10'),
        cr('Diamètre intérieur',     r(diam, 1),      'm',     'V=TPH/(SG×0.40); D=(V/(π/4×1.5))^(1/3)'),
        cr('Longueur (L/D≈1.5)',     r(diam * aspect, 1), 'm', 'D × 1.5'),
        cr('Vitesse de rotation (65% Vc)', r(rpm, 1), 'rpm',   'Nc=42.3/√D; N=Nc×0.65'),
        { id: uid(), parameter: 'P80 produit (typ.)', value: '1000–3000', unit: 'µm', formula: 'Rod mill sortant', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Charge en barres (%)', value: '35–40', unit: '%v', formula: 'Typique rod mill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── REBROYAGE ───────────────────────────────────
  {
    id: 'vertimill', label: 'Vertimill', code: '05g', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const f80_re = inp.p80_grind;
      const p80_re = inp.flot_rec > 0 ? 30 : 45;
      const e_vert = bond(inp.bwi * 0.7, p80_re, f80_re);
      const feed_tph = inp.tph * inp.flot_mass_pull / 100;
      const power = e_vert * feed_tph;
      const media_kg_h = 0.08 * power;
      return [
        cr('F80 alimentation rebroyage', r(f80_re, 0),   'µm',    'P80 broyage primaire'),
        cr('P80 cible rebroyage',    r(p80_re, 0),       'µm',    'Selon circuit aval'),
        cr('Débit concentré traité', r(feed_tph, 1),     't/h',   'TPH × Mass_pull%'),
        cr('Énergie spécifique',     r(e_vert, 2),       'kWh/t', 'Bond(BWi×0.7)'),
        cr('Puissance broyeur',      r(power, 0),        'kW',    'E × débit traité'),
        cr('Puissance moteur (marge)', r(power * 1.1, 0),'kW',    'Puissance × 1.10'),
        cr('Consommation media',     r(media_kg_h, 1),   'kg/h',  '≈0.08 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '12–25', unit: 'mm', formula: 'Boulets acier/céramique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'isamill', label: 'IsaMill', code: '05f', group: 'regrind',
    icon: <Gauge size={13} />,
    rows: (inp) => {
      const p80_isa = 15;
      const e_isa = bond(inp.bwi * 0.6, p80_isa, inp.p80_grind) * 1.2;
      const feed_tph = inp.tph * inp.flot_mass_pull / 100;
      const power = e_isa * feed_tph;
      return [
        cr('F80 alimentation',    r(inp.p80_grind, 0), 'µm',    'P80 broyage'),
        cr('P80 cible ultra-fin', r(p80_isa, 0),       'µm',    'Typique IsaMill'),
        cr('Débit concentré traité', r(feed_tph, 1),   't/h',   'TPH × Mass_pull%'),
        cr('Énergie spécifique',  r(e_isa, 1),         'kWh/t', 'Bond(BWi×0.6)×1.2'),
        cr('Puissance broyeur',   r(power, 0),         'kW',    'E × débit traité'),
        cr('Consommation media (céramique)', r(0.05 * power, 2), 'kg/h', '≈0.05 kg/kWh × Puissance'),
        { id: uid(), parameter: 'Milieux broyants', value: '2–3', unit: 'mm', formula: 'Céramique IsaMill', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb passes / disques', value: '8', unit: '', formula: 'Config. IsaMill M-série', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── CLASSIFICATION ──────────────────────────────
  {
    id: 'hydrocyclone', label: 'Hydrocyclones', code: '06a', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => {
      // Template 06_CLASSIFICATION — cyclone cluster sizing from circulating load + pump power.
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const cs = inp.cyclone_pct_solids;
      const feed_tph = fresh * (1 + inp.cl_ball / 100);
      const qv = feed_tph / inp.ore_sg + feed_tph * (100 - cs) / cs;
      const cap_unit = 600;                            // m³/h per gMAX26/Cavex cyclone at ~90 kPa
      const n_op = Math.max(1, Math.ceil(qv / cap_unit));
      const d50 = inp.p80_grind / 1.5;                 // Plitt: d50 ≈ P80/1.5
      const rho = pulpSG(inp.ore_sg, cs);
      const tdh = 25;                                  // m pump head
      const p_hyd = qv * rho * 9.81 * tdh / 3600;      // hydraulic kW
      const p_pump = installedPower(p_hyd, 65, 25);    // pump η 65%, motor margin 25%
      return [
        cr('Débit fresh feed broyage',     r(fresh, 0),   't/h',  'TPH × (1 + facteur design)'),
        cr('Charge circulante',            r(inp.cl_ball, 0), '%', 'Std 250–350 % ball mill'),
        cr('Débit feed cyclone (solides)', r(feed_tph, 0),'t/h',  'Fresh × (1 + CL)'),
        cr('Débit volumique pulpe',        r(qv, 0),      'm³/h', 'Q_solides + Q_liquide'),
        cr('Cible d50c (cut size)',        r(d50, 0),     'µm',   'Plitt: ≈ P80/1.5'),
        cr('Capacité unitaire cyclone',    r(cap_unit, 0),'m³/h', 'À 80–100 kPa'),
        cr('Nb cyclones opérationnels',    r(n_op, 0),    '',     'Q_v / capacité unitaire'),
        cr('Total cluster (N+1)',          r(n_op + 1, 0),'',     'Op + 1 secours'),
        cr('Densité pulpe',                r(rho, 2),     't/m³', '1 + (SG−1)·Cs'),
        cr('Puissance hydraulique pompe',  r(p_hyd, 0),   'kW',   'Q·ρ·g·H / 3600'),
        cr('PUISSANCE pompe alim.',        r(p_pump, 0),  'kW',   'P_hyd / η_pompe × (1 + marge)'),
        { id: uid(), parameter: 'Pression opérationnelle', value: '70–120', unit: 'kPa', formula: 'Std ball mill circuit', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Diamètre cyclone', value: '≈660 (gMAX26)', unit: 'mm', formula: 'Selon d50c', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'screen', label: 'Cribles Vibrants', code: '06b', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const rate = 25;                               // t/(m²·h) specific screening rate
      const area = inp.tph / rate;
      const n_decks = 2;
      const width_m = Math.max(1.2, Math.sqrt(area / (2.5 * n_decks))); // area ≈ W × (2.5W) per deck
      const len_m = width_m * 2.5;
      return [
        cr('Débit de conception',      r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Débit massique annuel',    r(annualT(inp) / 1000, 0), 'kt/an', 'TPH × Dispo% × 8760'),
        cr('Taux de criblage',         r(rate, 0),     't/(m²·h)', 'Typique crible vibrant'),
        cr('Surface efficace totale',  r(area, 1),     'm²',  'TPH / 25 t/(m²·h)'),
        cr('Largeur × longueur (approx)', `${r(width_m,1)} × ${r(len_m,1)}`, 'm', 'Aire ≈ L×2.5L par pont'),
        cr('Ouverture de maille',      r(inp.p80_grind / 1000 * 1.5, 1), 'mm', 'P80/1000×1.5'),
        { id: uid(), parameter: 'Nombre de ponts (decks)', value: '1–2',        unit: '',   formula: 'Selon séparation',   source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Efficacité de criblage',  value: '90–95',      unit: '%',  formula: 'Typique',            source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Accélération (g-force)',  value: '4.5–5.5',    unit: 'g',  formula: 'Typique crible',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Inclinaison',             value: '15–20',      unit: '°',  formula: 'Typique crible',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── GRAVIMÉTRIE ────────────────────────────────
  {
    id: 'gravity', label: 'Gravimétrie (GRG)', code: '07', group: 'treatment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 07_GRAVITY — GRG circuit on a bleed of cyclone underflow.
      const uf_bleed = 20;                             // % cyclone UF to gravity
      const q_grav = inp.tph * (1 + inp.sf_grind / 100) * uf_bleed / 100;
      const cap_unit = 150;                            // t/h per KC-XD48
      const n_conc = Math.max(1, Math.ceil(q_grav / cap_unit));
      const eta_unit = 60;                             // % per pass
      const eta_ilr = 95;                              // % ILR on concentrate
      const grav_global = inp.grg_pct / 100 * eta_unit / 100 * eta_ilr / 100 * 100;
      const conc_t_d = q_grav * 0.001 * 24 * inp.availability / 100; // ~1000:1 upgrade
      return [
        cr('Débit fresh feed broyage',    r(inp.tph * (1 + inp.sf_grind / 100), 0), 't/h', 'Design broyage'),
        cr('% UF cyclone → gravimétrie',  r(uf_bleed, 0), '%',   'Std 20–40 % UF'),
        cr('Débit feed gravimétrie',      r(q_grav, 0),   't/h', 'UF × % détourné'),
        cr('GRG dans minerai',            r(inp.grg_pct, 1), '%','Test GRG (Knelson lab)', 'LIMS'),
        cr('Récupération unitaire (pass)', r(eta_unit, 0),'%',   'Knelson par passage'),
        cr('Capacité unitaire (KC-XD48)', r(cap_unit, 0), 't/h', 'À 30–40 % solides'),
        cr('Nombre concentrateurs',       r(n_conc, 0),   '',    'Feed / capacité unitaire'),
        cr('Total installé (N+1)',        r(n_conc + 1, 0), '',  'Op + 1 secours'),
        cr('Masse concentré grav. / jour', r(conc_t_d, 2),'t/j', 'Ratio enrichissement ~1000:1'),
        cr('Récup. circuit grav. global', r(grav_global, 1), '%', 'GRG × η_pass × η_ILR'),
        { id: uid(), parameter: '[NaCN] leach intensif (ILR)', value: '30', unit: 'g/L', formula: 'Élevé (Acacia/ILR)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps cycle ILR', value: '24', unit: 'h', formula: 'Batch intensif', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── FLOTTATION ─────────────────────────────────
  {
    id: 'flotation', label: 'Flottation', code: '08', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      // Template 08_FLOTATION — rougher / scavenger / cleaner cell counts.
      const cs = 35;                                   // % solids rougher feed
      const qv = slurryQv(inp.tph, inp.ore_sg, cs);
      const froth = 1.2;                               // aeration bulking factor
      const t_ro = 15, v_ro = 200;
      const n_ro = Math.max(5, Math.ceil(qv * t_ro / 60 * froth / v_ro));
      const t_sc = 10, v_sc = 150;
      const n_sc = Math.max(4, Math.ceil(qv * t_sc / 60 * froth / v_sc));
      const conc_ro = inp.tph * inp.flot_mass_pull / 100;
      return [
        cr('Débit alimentation',          r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('% solides feed rougher',      r(cs, 0),       '%',   'Std rougher feed'),
        cr('Débit volumique pulpe',       r(qv, 0),       'm³/h','Q_solides + Q_liquide'),
        cr('Récupération Au flottation',  r(inp.flot_rec, 1), '%', 'Testwork LIMS', 'LIMS'),
        cr('Temps rétention rougher',     r(t_ro, 0),     'min', 'Std 10–20 min'),
        cr('Volume rougher (×foisonnement)', r(qv * t_ro / 60 * froth, 0), 'm³', 'Q·t/60 × 1.2'),
        cr('Nb cellules rougher (200 m³)', r(n_ro, 0),    '',    'V / 200 m³, min 5'),
        cr('Temps rétention scavenger',   r(t_sc, 0),     'min', 'Std 8–15 min'),
        cr('Nb cellules scavenger (150 m³)', r(n_sc, 0),  '',    'V_scav / 150 m³'),
        cr('Mass pull (concentré)',       r(inp.flot_mass_pull, 1), '%', 'Testwork LIMS', 'LIMS'),
        cr('Débit concentré rougher',     r(conc_ro, 1),  't/h', 'Feed × mass pull'),
        { id: uid(), parameter: 'Étages cleaner', value: '2 (cleaner + recleaner)', unit: '', formula: 'Std', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Collecteur (PAX) / Moussant (MIBC)', value: '30–50 / 10–20', unit: 'g/t', formula: 'Testwork flottation', source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── CIL / CIP ───────────────────────────────────
  {
    id: 'cil', label: 'Lixiviation CIL / CIP', code: '09', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      // Template 09_LEACHING_CIL — kinetics, tank sizing, agitation, carbon circuit.
      const cs = inp.slurry_density;
      const qv = slurryQv(inp.tph, inp.ore_sg, cs);
      const ret_h = 24;
      const rec_theo = (1 - Math.exp(-inp.leach_k * ret_h)) * 100;
      const vol_req = qv * ret_h;
      const vol_design = vol_req * 1.2;                 // +20% margin
      const n_tanks = 8;
      const vol_tank = vol_design / n_tanks;
      const h_tank = 14;
      const d_tank = Math.sqrt((4 * vol_tank / Math.PI) / h_tank);
      const agit_kw = vol_tank * 0.1;                  // 0.1 kW/m³
      const agit_total = agit_kw * n_tanks;
      const carbon_tank = vol_tank * inp.carbon_conc / 1000; // t per tank
      const carbon_total = carbon_tank * (n_tanks - 1);
      const cn_kg_h = inp.cyanide_cons * inp.tph;
      const lime_kg_h = inp.lime_cons * inp.tph;
      const au_out = inp.tph * inp.gold_grade * inp.leach_rec_24h / 100;
      return [
        cr('Débit alimentation (solides)', r(inp.tph, 0),   't/h',  'Cyclone OF secondaire', 'Projet'),
        cr('Densité pulpe CIL (%solides)', r(cs, 0),        '%',    'Std 40–50 % CIL', 'LIMS'),
        cr('Débit volumique pulpe',        r(qv, 0),        'm³/h', 'TPH/SG + eau'),
        cr('Temps de rétention total',     r(ret_h, 0),     'h',    'Testwork cyanuration', 'LIMS'),
        cr('Constante cinétique k',        r(inp.leach_k, 2), '1/h','Testwork (1er ordre)', 'LIMS'),
        cr('Récup. théorique 1−e^(−k·t)',  r(rec_theo, 1),  '%',    '1 − exp(−k·t)'),
        cr('Volume utile requis',          r(vol_req, 0),   'm³',   'Q_v × t_rétention'),
        cr('Volume design (+20%)',         r(vol_design, 0),'m³',   'V_requis × 1.2'),
        cr('Nombre de cuves',              r(n_tanks, 0),   '',     'Std 6–10 en série'),
        cr('Volume unitaire',              r(vol_tank, 0),  'm³',   'V_design / N_cuves'),
        cr('Hauteur cuve H',               r(h_tank, 0),    'm',    'Std 12–16 m'),
        cr('Diamètre cuve D',              r(d_tank, 1),    'm',    '√(4V/πH)'),
        cr('Aspect ratio H/D',             r(h_tank / d_tank, 2), '', 'Std 1.0–1.5'),
        cr('Puissance agitateur / cuve',   r(agit_kw, 0),   'kW',   '0.1 kW/m³ × V_cuve'),
        cr('Puissance agitation totale',   r(agit_total, 0),'kW',   'P_cuve × N'),
        cr('Inventaire charbon / cuve',    r(carbon_tank, 1),'t',   'V_cuve × g/L / 1000'),
        cr('Inventaire charbon total',     r(carbon_total, 1),'t',  '× (N−1) cuves chargées'),
        cr('Or en solution / heure',       r(au_out, 1),    'g/h',  'TPH × Grade × Rec%'),
        cr('NaCN débit',                   r(cn_kg_h, 0),   'kg/h', 'NaCN_cons × TPH'),
        cr('Chaux (CaO) débit',            r(lime_kg_h, 0), 'kg/h', 'Lime_cons × TPH'),
        cr('Charge Au charbon (loaded)',   r(inp.carbon_loading, 0), 'g/t', 'Std 2000–5000 g/t', 'LIMS'),
        { id: uid(), parameter: 'pH lixiviation cible', value: '10.5–11.0', unit: '', formula: 'Stabilité NaCN', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Cribles inter-cuves', value: 'Kemix / MPS', unit: '', formula: 'Rétention charbon', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── ADR (Élution + EW) ──────────────────────────
  {
    id: 'adr', label: 'ADR — Élution & Électrolyse', code: '10', group: 'treatment',
    icon: <Zap size={13} />,
    rows: (inp) => {
      // Template 10_ADR — elution column, electrowinning (Faraday), carbon regen.
      const au_prod_kg_a = inp.tph * inp.gold_grade * inp.leach_rec_24h / 100 * inp.availability / 100 * 8760 / 1000;
      // Elution
      const carbon_batch = 5;                          // t transferred per cycle
      const au_per_cycle = carbon_batch * inp.carbon_loading / 1000; // kg
      const col_vol = carbon_batch / 0.5;              // ρ_carbon ≈ 0.5 t/m³
      const col_h = 5;
      const col_d = Math.sqrt((4 * col_vol / Math.PI) / col_h);
      const eluate = carbon_batch * 8;                 // ≈8 bed volumes m³
      // Electrowinning (Faraday)
      const cath_area = 24;                            // m² (12 cathodes × 2 m²)
      const current = inp.ew_current_density * cath_area; // A
      const voltage = 4;
      const ew_kw = voltage * current / 1000;
      const faraday = 0.735;                           // g Au per A·h
      const ew_eff = 92;
      const ew_prod_kg_d = current * (ew_eff / 100) * 0.001 * 24 * faraday;
      return [
        cr('Production or annuelle',       r(au_prod_kg_a, 0), 'kg/an', 'TPH × Grade × Rec × Dispo × 8760'),
        cr('Méthode élution',              'AARL',          '',     'AARL / Zadra'),
        cr('Charge charbon / cycle',       r(carbon_batch, 1), 't', 'Batch colonne'),
        cr('Charge Au sur charbon',        r(inp.carbon_loading, 0), 'g/t', 'Loaded carbon', 'LIMS'),
        cr('Production Au / cycle',        r(au_per_cycle, 1), 'kg', 'Masse × g/t / 1000'),
        cr('Volume colonne élution',       r(col_vol, 1),   'm³',   'Charbon / 0.5 t/m³'),
        cr('Diamètre colonne',             r(col_d, 2),     'm',    '√(4V/πH), H=5 m'),
        cr('Débit éluat (≈8 BV)',          r(eluate, 0),    'm³/cycle', 'Charbon × 8 bed volumes'),
        cr('Température élution',           r(inp.elution_temp, 0), '°C', 'AARL 100–130°C', 'LIMS'),
        cr('Densité courant EW',           r(inp.ew_current_density, 0), 'A/m²', 'Std 150–300', 'LIMS'),
        cr('Surface cathodes',             r(cath_area, 0), 'm²',   '12 cathodes × 2 m²'),
        cr('Courant total EW',             r(current, 0),   'A',    'Densité × surface'),
        cr('Puissance EW',                 r(ew_kw, 1),     'kW',   'V × I / 1000'),
        cr('Production Au EW (Faraday)',   r(ew_prod_kg_d, 2), 'kg/j', 'I·η·0.735 g/A·h × 24'),
        { id: uid(), parameter: 'Rendement Faraday', value: '92', unit: '%', formula: 'Standard', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Four régénération', value: '650–800', unit: '°C', formula: 'Rotary kiln', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── ÉPAISSISSEUR ────────────────────────────────
  {
    id: 'thickener', label: 'Épaississeur', code: '11a', group: 'utilities',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 11_THICKENING — sized on Solids Loading Rate (SLR).
      const slr = 0.8;                                  // t/(m²·h) with flocculant (tailings)
      const area = inp.tph / slr;
      const diam = Math.sqrt(4 * area / Math.PI);
      const floc_dose = 30;                             // g/t
      const floc_kg_d = inp.tph * 24 * floc_dose / 1000;
      const floc_t_a = floc_kg_d * 365 * inp.availability / 100 / 1000;
      return [
        cr('Débit solides',               r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Solids Loading Rate (SLR)',   r(slr, 2),      't/(m²·h)', 'Std 0.8–1.2 avec floculant'),
        cr('Surface requise',             r(area, 0),     'm²',  'Débit / SLR'),
        cr('Diamètre épaississeur',       r(diam, 1),     'm',   '√(4A/π)'),
        cr('Dosage floculant',            r(floc_dose, 0),'g/t', 'PAM anionique 20–40 g/t'),
        cr('Consommation floculant / jour', r(floc_kg_d, 0), 'kg/j', 'TPH × 24 × dose / 1000'),
        cr('Consommation annuelle',       r(floc_t_a, 1), 't/an','× 365 × dispo%'),
        { id: uid(), parameter: '% solides UF cible', value: '55–65', unit: '% sol', formula: 'Pour pompage', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Hauteur paroi', value: '4–6', unit: 'm', formula: 'Std HRT', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Type', value: 'High-Rate Thickener (HRT)', unit: '', formula: 'Compact + floculant', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'filter', label: 'Filtre Presse', code: '11b', group: 'utilities',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const cake_density = 1.5;
      const filter_rate = 0.10;                       // t/(m²·h) dry cake specific rate
      const area_filter = inp.tph / filter_rate;
      const dry_solids_d = inp.tph * inp.availability / 100 * 24;
      return [
        cr('Débit de conception',        r(inp.tph, 0),  't/h', 'Débit projet', 'Projet'),
        cr('Solides secs / jour',        r(dry_solids_d, 0), 't/j', 'TPH × Dispo% × 24'),
        cr('Taux de filtration',         r(filter_rate, 2), 't/(m²·h)', 'Testwork filtration', 'Testwork'),
        cr('Surface filtrante totale',   r(area_filter, 0), 'm²', 'TPH / 0.10 t/(m²·h)'),
        cr('Densité gâteau',             r(cake_density, 2), 't/m³', 'Typique gâteau filtré'),
        { id: uid(), parameter: 'Humidité gâteau résiduel',     value: '15–18',              unit: '%',     formula: 'Testwork filtration',      source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de cycle',               value: '10–20',              unit: 'min',   formula: 'Typique filtre presse',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression filtration',          value: '8–12',               unit: 'bar',   formula: 'Typique filtre presse',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'tailings', label: 'Gestion Résidus (TSF)', code: '11c', group: 'utilities',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const tailings_tph = inp.tph * (1 - 0.001);
      const vol_pulp = tailings_tph / inp.ore_sg / 0.4;
      return [
        { id: uid(), parameter: 'Débit résidus',                  value: r(tailings_tph, 0),  unit: 't/h',  formula: 'TPH − concentré (≈TPH)',     source: 'Calcul',    isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Volume pulpe résidus',           value: r(vol_pulp, 0),      unit: 'm³/h', formula: 'TPH_tail/SG/40%sol',         source: 'Calcul',    isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN résiduel avant détox',      value: '50–200',            unit: 'mg/L', formula: 'Post-lixiviation typique',   source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN résiduel cible (INCO/SO₂)', value: '<50',              unit: 'mg/L', formula: 'Réglementation ICMC',        source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Conso H₂O₂ (détox)',            value: '0.3–0.5',           unit: 'kg/t', formula: 'Pratique INCO',              source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'SO₂ (si procédé SO₂/air)',       value: '0.2–0.3',           unit: 'kg/t', formula: 'Pratique SO₂/air',           source: 'Pratique',  isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'CN− aval résiduel cible',        value: '<1',               unit: 'mg/L', formula: 'ICMC Gold Standard',         source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── MANUTENTION & ALIMENTATION ─────────────────────
  {
    id: 'reclaim', label: 'Reprise Minerai (Reclaim)', code: '01a', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => {
      const tph_d = inp.tph * 1.25;
      return [
        { id: uid(), parameter: 'Capacité convoyeur reprise',    value: r(tph_d, 0),       unit: 't/h',  formula: 'TPH × 1.25',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Stockage tampon (live)',        value: r(inp.tph * 8, 0), unit: 't',    formula: 'TPH × 8h stockage',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Granulométrie max alimentation',value: r(inp.f80_crush / 1000 * 3, 0), unit: 'mm', formula: 'F80×3',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Vitesse courroie convoyeur',    value: '1.5–2.5',         unit: 'm/s',  formula: 'Typique convoyage',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'apron', label: 'Alimentateur Tablier (Apron)', code: '01b', group: 'feed',
    icon: <Layers size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité nominale',              value: r(inp.tph, 0),     unit: 't/h',  formula: 'Débit projet',             source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Capacité de conception (×1.3)', value: r(inp.tph*1.3,0),  unit: 't/h',  formula: 'TPH × 1.3',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Vitesse tablier',                value: '0.05–0.15',       unit: 'm/s',  formula: 'Typique apron feeder',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Largeur tablier',                value: r(Math.max(1200, inp.tph * 5), 0), unit: 'mm', formula: 'TPH×5 min 1200', source: 'Calcul', isCalc: true, comment: '', reference: '' },
    ],
  },
  {
    id: 'scalper', label: 'Crible de Précriblage (Scalper)', code: '02', group: 'feed',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Capacité criblage',      value: r(inp.tph * 1.2, 0), unit: 't/h', formula: 'TPH × 1.2',             source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Ouverture de maille',    value: '50–150',            unit: 'mm',  formula: 'Selon circuit',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Surface efficace',       value: r(inp.tph / 30, 1), unit: 'm²',  formula: 'TPH / 30 t/(m²·h)',     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
    ],
  },

  // ─────────────────────────── PRÉTRAITEMENT AVANCÉ ───────────────────────────
  // ── CIRCUIT DE TAMISAGE / CRIBLAGE (VSMA) ────────────────────────────────
  {
    id: 'scalp_screen', label: 'Scalping Screen (post primaire)', code: 'SC1', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      // Template 03_CRUSHING §2 — scalping screen after the primary crusher (VSMA).
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_primary_mm;
      const pass_pct = 60;
      const undersize = q * pass_pct / 100;
      const oversize = q - undersize;
      const C = 40, M = 0.9, K = 0.8, S = 1;           // dry single-deck banana
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),         't/h', 'Sortie concasseur primaire'),
        cr('Coupure (mesh)',               r(cut, 0),       'mm',  'P80 concassage primaire'),
        cr('% passant à la coupure',       r(pass_pct, 0),  '%',   'Analyse granulo'),
        cr('Débit undersize (fin)',        r(undersize, 0), 't/h', 'Feed × % passant'),
        cr('Débit oversize (→ concasseur 2)', r(oversize, 0),'t/h','Feed − undersize'),
        cr('Capacité base C (VSMA)',       r(C, 0),         't/(m²·h)', 'Coupure sèche'),
        cr('Facteurs M·K·S',               r(M * K * S, 2), '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),      'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),         'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Type', value: 'Banana simple pont', unit: '', formula: 'Haute capacité', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Inclinaison', value: '15–20', unit: '°', formula: 'Crible incliné', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'double_deck', label: 'Double Deck Screen (post primaire/sec.)', code: 'SC2', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const top_cut = inp.p80_primary_mm;              // upper deck
      const bot_cut = inp.p80_secondary_mm;            // lower deck
      const undersize = q * 0.55;                      // final product passing both decks
      const C = 35, M = 0.9, K = 0.75, S = 0.9;        // double-deck derate on lower deck
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Sortie concassage'),
        cr('Coupure pont supérieur',       r(top_cut, 0),    'mm',  'Séparation grossière'),
        cr('Coupure pont inférieur',       r(bot_cut, 0),    'mm',  'Produit final'),
        cr('Débit produit final (u/size)', r(undersize, 0),  't/h', '≈55 % feed passant les 2 ponts'),
        cr('Débit recyclage (o/size)',     r(q - undersize, 0), 't/h', 'Retour concasseur'),
        cr('Capacité base C (VSMA)',       r(C, 0),          't/(m²·h)', 'Pont inférieur limitant'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),          'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Nombre de ponts', value: '2 (double deck)', unit: '', formula: '2 coupures', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'banana_screen', label: 'Banana Deck Screen (haute capacité)', code: 'SC3', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_hpgr_mm > 0 ? inp.p80_hpgr_mm : inp.p80_secondary_mm;
      const undersize = q * 0.75;
      const C = 55, M = 0.9, K = 0.8, S = 1;           // banana multi-slope: higher base capacity
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 26);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Circuit concassage/HPGR'),
        cr('Coupure',                      r(cut, 0),        'mm',  'Produit circuit fermé'),
        cr('Débit undersize',              r(undersize, 0),  't/h', '≈75 % passant (multi-pente)'),
        cr('Débit oversize (recyclage)',   r(q - undersize, 0), 't/h', 'Retour broyage/concassage'),
        cr('Capacité base C (VSMA banana)', r(C, 0),         't/(m²·h)', 'Multi-pente haute capacité'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections × strat.'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3.6×7.3 = 26 m²)', r(n, 0),          'unités', 'Surface / 26 m²'),
        { id: uid(), parameter: 'Nombre de pentes', value: '3–5', unit: '', formula: 'Profil banana', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Accélération', value: '4.5–5.5', unit: 'g', formula: 'Typique', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'single_deck', label: 'Single Deck Screen', code: 'SC4', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const q = inp.tph * (1 + inp.sf_grind / 100) * inp.availability / Math.max(inp.avail_crush, 1);
      const cut = inp.p80_secondary_mm;
      const undersize = q * 0.7;
      const C = 40, M = 0.9, K = 0.8, S = 1;
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 24);
      return [
        cr('Débit alimentation (design)',  r(q, 0),          't/h', 'Débit design concassage'),
        cr('Coupure (mesh)',               r(cut, 0),        'mm',  'Séparation unique'),
        cr('Débit undersize',              r(undersize, 0),  't/h', '≈70 % passant'),
        cr('Débit oversize',               r(q - undersize, 0), 't/h', 'Refus'),
        cr('Capacité base C (VSMA)',       r(C, 0),          't/(m²·h)', 'Simple pont'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3×8 = 24 m²)',     r(n, 0),          'unités', 'Surface / 24 m²'),
        { id: uid(), parameter: 'Type', value: 'Incliné simple pont', unit: '', formula: 'Séparation simple', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'wet_screen_hpgr', label: 'Crible humide (post-HPGR)', code: 'SC5', group: 'screening',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      // Template 04_HPGR §6 — wet screen closing the HPGR circuit.
      const fresh = inp.tph * (1 + inp.sf_grind / 100);
      const q_roll = fresh * 1.25;                      // incl. recycle
      const undersize = fresh;                          // steady-state pass = fresh feed
      const oversize = q_roll - undersize;
      const C = 22, M = 0.85, K = 0.75, S = 1;          // wet screening base capacity
      const { area, n } = vsmaScreen(undersize, C, M, K, S, 26);
      return [
        cr('Débit feed crible (roll)',     r(q_roll, 0),     't/h', 'Débit total HPGR (incl. recycle)'),
        cr('Coupure crible humide',        r(inp.p80_hpgr_mm, 1), 'mm', 'P80 cible HPGR'),
        cr('Undersize (→ ball mill)',      r(undersize, 0),  't/h', 'Fresh feed (steady state)'),
        cr('Oversize (→ recyclage HPGR)',  r(oversize, 0),   't/h', 'Retour HPGR'),
        cr('Capacité base C (humide)',     r(C, 0),          't/(m²·h)', 'Wet screening'),
        cr('Facteurs M·K·S',               r(M * K * S, 2),  '',    'Efficacité × corrections'),
        cr('Surface utile requise',        r(area, 1),       'm²',  'Undersize / (C·M·K·S)'),
        cr('Nb cribles (3.6×7.3 = 26 m²)', r(n, 0),          'unités', 'Banana wet screen'),
        { id: uid(), parameter: 'Eau de lavage (spray)', value: '0.5–1.0', unit: 'm³/t', formula: 'Wet screening', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'trommels', label: 'Trommel SAG', code: '05i', group: 'screening',
    icon: <Wind size={13} />,
    rows: (inp) => {
      const vol_m3h = inp.tph / inp.ore_sg / 0.35;
      return [
        { id: uid(), parameter: 'Débit pulpe à cribler',    value: r(vol_m3h, 0),    unit: 'm³/h', formula: 'TPH/SG/0.35',          source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Ouverture maille trommel', value: '8–12',           unit: 'mm',   formula: 'Typique circuit SAG',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Angle trommel',            value: '4–6',            unit: '°',    formula: 'Inclinaison standard', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'pebble_crusher', label: 'Concasseur de Cailloux (Pebble)', code: '03d', group: 'crushing',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const pebble_tph = inp.tph * 0.15;
      return [
        { id: uid(), parameter: 'Débit cailloux estimé',     value: r(pebble_tph, 0),   unit: 't/h',  formula: 'TPH × 15% (recirculation)', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'CSS nominal pebble',        value: '12–18',             unit: 'mm',   formula: 'Typique pebble crusher',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Taille d\'alimentation max', value: r(inp.f80_crush/1000*0.08, 0), unit: 'mm', formula: 'F80×0.08 (pebbles)', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── CLASSIFICATION AVANCÉE ─────────────────────────
  {
    id: 'deslime', label: 'Déslimage / Cyclones de déslamage', code: '06c', group: 'classification',
    icon: <Wind size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Débit alimentation',     value: r(inp.tph, 0), unit: 't/h', formula: 'Débit projet',          source: 'Projet',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Coupure D50 cible',      value: '20–38',       unit: 'µm',  formula: 'Selon procédé aval',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Dilution de lavage',     value: '3–5',         unit: 'vol', formula: 'Lavage cailloux/sables', source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ─────────────────────────── TRAITEMENT AVANCÉ ──────────────────────────────
  {
    id: 'intensive_leach', label: 'Réacteur de Lixiviation Intensif (ILR)', code: '07b', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph_kg = inp.tph * 0.002 * 1000;
      return [
        { id: uid(), parameter: 'Débit concentré gravitaire', value: r(conc_tph_kg, 1),   unit: 'kg/h',  formula: 'TPH × 0.2%',                    source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention ILR',    value: '4–8',                unit: 'h',     formula: 'Typique batch ILR',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN conc. ILR',            value: '20–50',              unit: 'g/L',   formula: 'Haute teneur NaCN',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'DO ILR',                    value: '>20',                unit: 'mg/L',  formula: 'Surpression O₂',                 source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération ILR (cycle)',  value: '90–97',              unit: '%',     formula: 'Typique Acacia/Gekko ILR',       source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'heap_leach', label: 'Lixiviation en Tas (Heap Leach)', code: '09b', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const area_ha = inp.tph * inp.availability / 100 * 8760 / 1_000_000 * 5;
      return [
        { id: uid(), parameter: 'Débit minerai empilé',          value: r(inp.tph, 0),        unit: 't/h',   formula: 'Débit projet',                    source: 'Projet',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Surface empreinte (estimée)',   value: r(area_ha, 1),        unit: 'ha',    formula: 'Mt_an × 5 m² / t (approx)',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Hauteur empilage max',          value: '6–15',               unit: 'm',     formula: 'Selon géotechnique',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Taux arrosage NaCN',            value: '8–15',               unit: 'L/(m²·h)', formula: 'Application de solution',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'NaCN conc. solution',          value: '0.5–2.0',            unit: 'g/L',   formula: 'Lixiviation en tas standard',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au (oxyde typiq.)', value: '65–80',             unit: '%',     formula: 'Minerai oxydé / transiton.',     source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Durée de lixiviation',          value: '30–90',              unit: 'jours', formula: 'Cinétique testwork',              source: 'Testwork', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'pox', label: 'Oxydation sous Pression (POX / HPOX)', code: '09c', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      const o2_tph = conc_tph * 0.12;
      return [
        { id: uid(), parameter: 'Débit concentré flotation',    value: r(conc_tph, 1),    unit: 't/h',   formula: 'TPH × mass_pull%',               source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation O₂',              value: r(o2_tph, 2),      unit: 't/h',   formula: 'Conc_tph × 0.12 (typique sulfures)', source: 'Calcul', isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température POX',              value: '190–220',         unit: '°C',    formula: 'POX acide (haute T)',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pression partielle O₂',       value: '700–1000',        unit: 'kPa',   formula: 'Autoclave POX',                   source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Neutralisation CaCO₃',        value: '80–150',          unit: 'kg/t',  formula: 'Post-POX neutralisation',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb autoclaves (N+1)',          value: `${Math.max(1, Math.ceil(conc_tph / 30))}+1`, unit: '', formula: 'Conc_tph / 30 t/h/autoclave', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'roasting', label: 'Grillage (Roasting)', code: '09d', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      return [
        { id: uid(), parameter: 'Débit concentré traité',     value: r(conc_tph, 1),  unit: 't/h',   formula: 'TPH × mass_pull%',         source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température grillage',       value: '550–650',       unit: '°C',    formula: 'Grillage sulfures',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'SO₂ capté (scrubber)',       value: '>98',           unit: '%',     formula: 'Exigence environnementale', source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Récupération Au post-grillage', value: '92–96',     unit: '%',     formula: 'Testwork grillage',         source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Nb fours (N+1)',             value: `${Math.max(1, Math.ceil(conc_tph / 20))}+1`, unit: '', formula: 'Conc_tph/20 t/h/four', source: 'Calcul', isCalc: true, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'biox', label: 'Bio-Oxydation (BIOX)', code: '09e', group: 'treatment',
    icon: <FlaskConical size={13} />,
    rows: (inp) => {
      const conc_tph = inp.tph * inp.flot_mass_pull / 100;
      return [
        { id: uid(), parameter: 'Débit concentré alimenté',   value: r(conc_tph, 1),  unit: 't/h',  formula: 'TPH × mass_pull%',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température bio-réacteurs',  value: '37–42',         unit: '°C',   formula: 'Thermophiles mésophiles',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps de rétention',         value: '4–6',           unit: 'jours',formula: 'Testwork BIOX',              source: 'Testwork', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Air (sparge)',               value: '0.15–0.25',     unit: 'vvm',  formula: 'Volume air / vol. réacteur / min', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Neutralisation post-BIOX',   value: '50–120',        unit: 'kg/t', formula: 'CaCO₃ / Ca(OH)₂',           source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── ADR AVANCÉ ─────────────────────────────────────
  {
    id: 'carbon_reg', label: 'Régénération Charbon Actif', code: '10b', group: 'adr',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const carbon_t_d = inp.tph * inp.availability / 100 * 24 * inp.carbon_conc / 1e6;
      return [
        { id: uid(), parameter: 'Besoin charbon actif',       value: r(inp.tph * inp.carbon_conc / 1000, 1), unit: 'kg/h', formula: 'TPH × C_conc(g/L)/1000', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Température régénération',   value: '700–750',       unit: '°C',   formula: 'Four rotatif charbon actif', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Rendement réactivation',     value: '90–95',         unit: '%',    formula: 'Activité vs charbon vierge', source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pertes charbon (make-up)',   value: '0.1–0.2',       unit: '%/j',  formula: 'Abrasion + fines perdues',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'smelt', label: 'Four de Fusion (Smelting / Induction)', code: '10c', group: 'adr',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const au_g_h = inp.tph * inp.gold_grade * inp.leach_rec_24h / 100;
      const dore_kg_d = au_g_h * 24 / 1000 / 0.85;
      return [
        { id: uid(), parameter: 'Débit doré produit',          value: r(dore_kg_d, 1),  unit: 'kg/j',  formula: 'Au/j / 0.85 (85% Au dans doré)', source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Fréquence de fusion',         value: '1 × /j',         unit: '',      formula: 'Pratique standard',               source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Température fusion (induction)', value: '1150–1250',   unit: '°C',    formula: 'Four à induction',                source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Flux (borax + salpêtre)',     value: '5–8',            unit: '% wt',  formula: 'Séparation laitier',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Pureté lingot doré',          value: '90–98',          unit: '% Au',  formula: 'Avant raffinage (Parting)',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── TRAITEMENT EAU & EFFLUENTS ─────────────────────
  {
    id: 'water_treat', label: 'Traitement Eau (WTP)', code: '12a', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const vol_m3h = inp.tph / inp.ore_sg / 0.4;
      return [
        { id: uid(), parameter: 'Volume eau procédé recyclée',  value: r(vol_m3h * 0.7, 0), unit: 'm³/h', formula: 'Vol_pulpe × 70% retour eau',     source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Eau fraîche appoint',          value: r(vol_m3h * 0.3, 0), unit: 'm³/h', formula: 'Vol_pulpe × 30% make-up',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'pH rejet eaux usées',          value: '>7.0',              unit: '',     formula: 'Exigence permis eau',             source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'CN− total rejet aqueux',       value: '<0.5',              unit: 'mg/L', formula: 'ICMC / réglementation locale',   source: 'Réglement', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'As rejet aqueux',              value: '<0.1',              unit: 'mg/L', formula: 'Réglementation locale',           source: 'Réglement', isCalc: false, comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'detox', label: 'Détoxification Résidus (INCO / SO₂/Air)', code: '12b', group: 'environment',
    icon: <Droplets size={13} />,
    rows: (inp) => {
      const tails_tph = inp.tph;
      const so2_tph = tails_tph * 0.0003;
      return [
        { id: uid(), parameter: 'Débit pulpe à détoxifier',    value: r(tails_tph, 0),  unit: 't/h',  formula: 'Débit résidus post-CIL',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation SO₂',            value: r(so2_tph, 3),    unit: 't/h',  formula: 'TPH × 0.3 kg/t SO₂',              source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Consommation CuSO₄ (cataly.)', value: '2–5',           unit: 'g/t',  formula: 'Catalyseur INCO',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Temps rétention détox',       value: '1–2',            unit: 'h',    formula: 'Pratique détoxification',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'pH détox cible',              value: '8.5–9.5',        unit: '',     formula: 'Optimum SO₂/air',                  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      ];
    },
  },

  // ─────────────────────────── INSTRUMENTATION & CONTRÔLE ─────────────────────
  {
    id: 'process_control', label: 'Contrôle de Procédé / DCS', code: '13a', group: 'instruments',
    icon: <Gauge size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Nb boucles de contrôle estimé',    value: r(inp.tph / 10 + 50, 0), unit: '',    formula: 'TPH/10 + 50 (approx.)',      source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      { id: uid(), parameter: 'Type DCS',                         value: 'DCS / PLC hybride',      unit: '',    formula: 'Standard industrie',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Redondance système critique',      value: '1oo2 / 2oo3',            unit: '',    formula: 'Sécurité SIL-2',             source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Alarmes de procédé (estimé)',      value: r(inp.tph / 10 + 100, 0), unit: '',    formula: 'Typique usine de traitement', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Disponibilité DCS visée',          value: '>99.9',                  unit: '%',   formula: 'Redondance système',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
  {
    id: 'online_analyzer', label: 'Analyseurs En Ligne', code: '13b', group: 'instruments',
    icon: <Gauge size={13} />,
    rows: () => [
      { id: uid(), parameter: 'Analyseur élémentaire on-stream',  value: 'Courier / Geoscan',   unit: '',     formula: 'XRF en ligne (Outotec/Panalyt.)', source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Granulométrie en ligne',           value: 'PSI / Lasentec',      unit: '',     formula: 'Contrôle circuit de broyage',    source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Densité pulpe (nucléaire)',        value: '1.5–2.0',             unit: 't/m³', formula: 'Capteur gamma densitomètre',      source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'pH en ligne CIL',                  value: '10.5–11.0',           unit: '',     formula: 'Contrôle pH lixiviation',         source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'DO en ligne CIL',                  value: '>6',                  unit: 'mg/L', formula: 'Sonde ORP/O₂ en ligne',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Débitmètre magnétique (EMF)',       value: 'Krohne / Endress',    unit: '',     formula: 'Débit pulpe principaux',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },

  // ─────────────────────────── ALIMENTATIONS EN ÉNERGIE ───────────────────────
  {
    id: 'power_supply', label: 'Alimentation Électrique', code: '14a', group: 'electrical',
    icon: <Zap size={13} />,
    rows: (inp) => {
      const e_sag = inp.bwi * 1.3 * (10/Math.sqrt(inp.p80_grind) - 10/Math.sqrt(inp.f80_crush)) * 0.55 * inp.tph;
      const e_ball = inp.bwi * (10/Math.sqrt(inp.p80_grind) - 10/Math.sqrt(inp.f80_crush / 5)) * inp.tph;
      const total_kw = Math.max(100, e_sag + e_ball) * 1.3;
      return [
        { id: uid(), parameter: 'Puissance installée estimée',    value: r(total_kw, 0),       unit: 'kW',   formula: '(E_SAG + E_Ball) × 1.3',           source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Puissance connectée (×1.15)',    value: r(total_kw * 1.15, 0), unit: 'kW',  formula: 'Puissance installée × 1.15',       source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
        { id: uid(), parameter: 'Tension distribution principale', value: '33–66',              unit: 'kV',   formula: 'Selon poste HTB disponible',        source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Facteur de puissance visé',      value: '>0.92',              unit: '',     formula: 'PFC (correction fp)',               source: 'Pratique', isCalc: false, comment: '', reference: '' },
        { id: uid(), parameter: 'Groupe électrogène secours',     value: r(total_kw * 0.15, 0), unit: 'kW',  formula: 'Puissance × 15% (secours)',        source: 'Calcul',   isCalc: true,  comment: '', reference: '' },
      ];
    },
  },
  {
    id: 'vfd', label: 'Variateurs de Fréquence (VFD/ASD)', code: '14b', group: 'electrical',
    icon: <Zap size={13} />,
    rows: (inp) => [
      { id: uid(), parameter: 'Moteurs critiques avec VFD',        value: 'SAG, Ball, Pompes CIL', unit: '',   formula: 'Économies énergie / contrôle',  source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Standard isolation moteurs',        value: 'NEMA MG-1 Partie 31',   unit: '',   formula: 'Moteurs avec VFD',              source: 'Pratique', isCalc: false, comment: '', reference: '' },
      { id: uid(), parameter: 'Économie énergie estimée (VFD)',    value: '10–20',                 unit: '%',  formula: 'vs. démarrage direct',          source: 'Pratique', isCalc: false, comment: '', reference: '' },
    ],
  },
];

// Some equipment were defined twice in SECTIONS_RAW (a first set + a refined second set),
// which made each duplicate appear twice in the equipment list and criteria tables.
// Deduplicate by id: preserve first-appearance order, keep the last (refined) definition.
const SECTIONS: EquipSection[] = (() => {
  const order: string[] = [];
  const byId: Record<string, EquipSection> = {};
  for (const s of SECTIONS_RAW) {
    if (!(s.id in byId)) order.push(s.id);
    byId[s.id] = s;
  }
  return order.map(id => byId[id]);
})();

// Group registry — matches screenshot order
const GROUP_META: Record<string, { label: string; icon: React.ReactNode }> = {
  general:        { label: 'Général',                    icon: <BarChart3 size={13}/> },
  feed:           { label: 'Manutention Minerai',        icon: <Layers size={13}/> },
  crushing:       { label: 'Concassage',                 icon: <Zap size={13}/> },
  grinding:       { label: 'Broyage',                    icon: <RefreshCw size={13}/> },
  regrind:        { label: 'Rebroyage',                  icon: <Gauge size={13}/> },
  screening:      { label: 'Tamisage / Criblage',       icon: <Wind size={13}/> },
  classification: { label: 'Classification',             icon: <Wind size={13}/> },
  physep:         { label: 'Séparation Physique',        icon: <Layers size={13}/> },
  treatment:      { label: 'Traitement',                 icon: <FlaskConical size={13}/> },
  refractory:     { label: 'Oxydation Réfractaire',      icon: <RefreshCw size={13}/> },
  reagents:       { label: 'Réactifs',                   icon: <FlaskConical size={13}/> },
  services:       { label: 'Services & Utilités',        icon: <Zap size={13}/> },
  environment:    { label: 'Environnement',              icon: <Droplets size={13}/> },
  slsep:          { label: 'Séparation Solide-Liquide',  icon: <Layers size={13}/> },
};

// ─── Default active equipment ─────────────────────────────────────────────────

const DEFAULT_ACTIVE: Record<string, boolean> = {
  general: true,
  // Manutention Minerai
  grizzly: true, apron: true, conveyor: true, stockpile: true,
  silo: false, sampling: true, dedusting: true,
  // Concassage
  jaw: false, gyratory: false, cone: true, hpgr: false, pebble_crusher: false,
  // Broyage
  sag: true, ag: false, ball: true, rod: false,
  // Rebroyage
  vertimill: false, isamill: false, towermill: false,
  // Classification
  hydrocyclone: true, screen: false,
  // Séparation Physique
  xrt: false, dms: false, magsep: false, flash_flot: false, column_flot: false,
  // Traitement
  gravity: true, intensive_leach: true, flotation: false,
  trash_screen: true, preleach_thickener: true, cil: true, adr: true,
  o2_plant: true, interstage_screens: true, acid_wash: true, carbon_reg: true, merrill_crowe: false,
  // Oxydation Réfractaire
  pox: false, biox: false, roasting: false, albion: false,
  // Réactifs
  cn_prep: true, lime_prep: true, floculant_prep: true, flot_reagents: false,
  // Services & Utilités
  water_sys: true, compressed_air: true, pumps: true, power_supply: true,
  // Environnement
  detox: true, sart: false, dry_stack: false, effluent: true,
  // Séparation Solide-Liquide
  thickener: true, filter: false, tailings: true,
};

// ─── Default project inputs ───────────────────────────────────────────────────

function defaultInputs(project: Project): ProjectInputs {
  return {
    tph: project.target_tph || 100,
    availability: project.availability_pct || 91,
    gold_grade: project.gold_grade_g_t || 1.5,
    ore_sg: project.ore_sg || 2.75,
    bwi: 16.5,
    brwi: 17.2,
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
    f80_rom_mm: 600,
    p80_primary_mm: 150,
    p80_secondary_mm: 35,
    p80_hpgr_mm: 6,
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

// ─── Main component ───────────────────────────────────────────────────────────

interface CriteriaProps { project: Project }

export function Criteria({ project }: CriteriaProps) {
  const [inputs, setInputs] = useState<ProjectInputs>(() => defaultInputs(project));
  const [activeEquip, setActiveEquip] = useState<Record<string, boolean>>(DEFAULT_ACTIVE);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [userEdits, setUserEdits] = useState<Record<string, { comment: string; reference: string }>>({});
  const [snapshots, setSnapshots] = useState<{ id: string; label: string; created_at: string }[]>([]);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [limsLoaded, setLimsLoaded] = useState(false);

  const phase = (project.phase ?? 'FEASIBILITY') as Phase;

  // ── Load saved state ──────────────────────────────────────────────────────
  useEffect(() => { loadDraft(); loadSnapshots(); loadLimsData(); }, [project.id]);

  async function loadLimsData() {
    try {
      const { data } = await supabase
        .from('lims_test_records')
        .select('family_code, data')
        .eq('project_id', project.id);
      if (!data?.length) return;
      const patch: Partial<ProjectInputs> = {};
      for (const rec of data) {
        const d = rec.data as Record<string, unknown>;
        if (rec.family_code === 'comminution') {
          if (typeof d.bwi_kwh_t === 'number') patch.bwi = d.bwi_kwh_t;
          if (typeof d.brwi_kwh_t === 'number') patch.brwi = d.brwi_kwh_t;
          if (typeof d.sg_t_m3 === 'number') patch.ore_sg = d.sg_t_m3;
          if (typeof d.p80_feed_um === 'number') patch.f80_crush = d.p80_feed_um;
        }
        if (rec.family_code === 'leaching') {
          if (typeof d.leach_rec_24h_pct === 'number') patch.leach_rec_24h = d.leach_rec_24h_pct;
          if (typeof d.leach_rec_48h_pct === 'number') patch.leach_rec_48h = d.leach_rec_48h_pct;
          if (typeof d.nacn_consumption_kg_t === 'number') patch.cyanide_cons = d.nacn_consumption_kg_t;
          if (typeof d.lime_kg_t === 'number') patch.lime_cons = d.lime_kg_t;
          if (typeof d.do_mg_l === 'number') patch.dissolved_o2 = d.do_mg_l;
        }
        if (rec.family_code === 'gravity') {
          if (typeof d.grg_recovery_pct === 'number') patch.grg_pct = d.grg_recovery_pct;
        }
        if (rec.family_code === 'flotation') {
          if (typeof d.au_recovery_pct === 'number') patch.flot_rec = d.au_recovery_pct;
          if (typeof d.mass_pull_pct === 'number') patch.flot_mass_pull = d.mass_pull_pct;
        }
      }
      if (Object.keys(patch).length > 0) {
        setInputs(prev => ({ ...prev, ...patch }));
        setLimsLoaded(true);
      }
    } catch (_) { /* silent */ }
  }

  async function loadDraft() {
    const { data } = await supabase
      .from('dc_draft')
      .select('content')
      .eq('project_id', project.id)
      .maybeSingle();
    if (data?.content) {
      const c = data.content as {
        inputs?: ProjectInputs;
        equip?: Record<string, boolean>;
        userEdits?: Record<string, { comment: string; reference: string }>;
      };
      // Merge saved draft over defaults so inputs added after the draft was saved
      // (e.g. the template sizing parameters) fall back to sensible defaults.
      if (c.inputs) setInputs({ ...defaultInputs(project), ...c.inputs });
      if (c.equip) setActiveEquip(c.equip);
      if (c.userEdits) setUserEdits(c.userEdits);
    }
  }

  async function loadSnapshots() {
    const { data } = await supabase
      .from('dc_snapshots')
      .select('id, label, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setSnapshots(data ?? []);
  }

  const saveDraft = useCallback(async (
    inp: ProjectInputs,
    eq: Record<string, boolean>,
    edits: Record<string, { comment: string; reference: string }>,
  ) => {
    setSaving(true);
    await supabase.from('dc_draft').upsert({
      project_id: project.id,
      content: { inputs: inp, equip: eq, userEdits: edits },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'project_id' });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [project.id]);

  function updateInput(k: keyof ProjectInputs, v: number) {
    setInputs(prev => {
      const next = { ...prev, [k]: v };
      saveDraft(next, activeEquip, userEdits);
      return next;
    });
  }

  function toggleEquip(id: string) {
    setActiveEquip(prev => {
      const next = { ...prev, [id]: !prev[id] };
      saveDraft(inputs, next, userEdits);
      return next;
    });
  }

  function updateUserEdit(rowId: string, col: 'comment' | 'reference', val: string) {
    setUserEdits(prev => {
      const next = { ...prev, [rowId]: { ...prev[rowId], comment: prev[rowId]?.comment ?? '', reference: prev[rowId]?.reference ?? '', [col]: val } };
      saveDraft(inputs, activeEquip, next);
      return next;
    });
  }

  // ── Computed rows per section ──────────────────────────────────────────────
  const computedSections = useMemo(() => {
    return SECTIONS
      .filter(s => activeEquip[s.id] !== false || s.id === 'general')
      .map(s => {
        const base = s.rows(inputs, phase);
        // Ensure no equipment sheet is sparse: top up thinner units with the common
        // operating-basis rows (plant throughput, availability, annual tonnage, design flow).
        const computed = s.id === 'general' || base.length >= 8
          ? base
          : [...base, ...commonOps(inputs)];
        return { ...s, computed };
      });
  }, [inputs, activeEquip, phase]);

  const totalRows = computedSections.reduce((a, s) => a + s.computed.length, 0);

  // ── Snapshot ──────────────────────────────────────────────────────────────
  async function createSnapshot() {
    if (!snapshotLabel.trim()) return;
    const hash = btoa(JSON.stringify({ inputs, activeEquip })).slice(0, 32);
    await supabase.from('dc_snapshots').insert({
      project_id: project.id,
      label: snapshotLabel.trim(),
      content: { inputs, equip: activeEquip, userEdits },
      content_hash: hash,
    });
    setSnapshotLabel('');
    setShowSnapshot(false);
    loadSnapshots();
  }

  async function restoreSnapshot(id: string) {
    const { data } = await supabase
      .from('dc_snapshots').select('content').eq('id', id).maybeSingle();
    if (data?.content) {
      const c = data.content as {
        inputs?: ProjectInputs;
        equip?: Record<string, boolean>;
        userEdits?: Record<string, { comment: string; reference: string }>;
      };
      // Merge saved draft over defaults so inputs added after the draft was saved
      // (e.g. the template sizing parameters) fall back to sensible defaults.
      if (c.inputs) setInputs({ ...defaultInputs(project), ...c.inputs });
      if (c.equip) setActiveEquip(c.equip);
      if (c.userEdits) setUserEdits(c.userEdits);
      setShowHistory(false);
    }
  }

  // ── Groups for sidebar ─────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const seen: Record<string, EquipSection[]> = {};
    for (const s of SECTIONS) {
      if (!seen[s.group]) seen[s.group] = [];
      seen[s.group].push(s);
    }
    return Object.entries(seen).map(([gid, secs]) => ({
      gid,
      ...GROUP_META[gid],
      sections: secs,
    }));
  }, []);

  const INPUT_FIELDS: { key: keyof ProjectInputs; label: string; unit: string; step: string; source: string }[] = [
    { key: 'tph',           label: 'Débit nominal',          unit: 't/h',    step: '1',    source: 'Projet' },
    { key: 'availability',  label: 'Disponibilité usine',    unit: '%',      step: '0.1',  source: 'Projet' },
    { key: 'gold_grade',    label: 'Teneur or alimentation', unit: 'g/t',    step: '0.01', source: 'Modèle blocs' },
    { key: 'ore_sg',        label: 'Densité minerai (SG)',   unit: 't/m³',   step: '0.01', source: 'LIMS' },
    { key: 'bwi',           label: 'Bond Work Index (BWi)',  unit: 'kWh/t',  step: '0.1',  source: 'LIMS' },
    { key: 'brwi',          label: 'Bond Rod Work Index',    unit: 'kWh/t',  step: '0.1',  source: 'LIMS' },
    { key: 'f80_crush',     label: 'F80 après concassage',   unit: 'µm',     step: '100',  source: 'Concassage' },
    { key: 'p80_grind',     label: 'P80 cible broyage',      unit: 'µm',     step: '1',    source: 'LIMS' },
    { key: 'grg_pct',       label: 'GRG (%)',                unit: '%',      step: '0.1',  source: 'LIMS' },
    { key: 'leach_rec_24h', label: 'Récupération CIL 24h',   unit: '%',      step: '0.1',  source: 'LIMS' },
    { key: 'leach_rec_48h', label: 'Récupération CIL 48h',   unit: '%',      step: '0.1',  source: 'LIMS' },
    { key: 'flot_rec',      label: 'Récupération flottation', unit: '%',     step: '0.1',  source: 'LIMS' },
    { key: 'flot_mass_pull',label: 'Mass pull flottation',   unit: '%',      step: '0.1',  source: 'LIMS' },
    { key: 'slurry_density',label: 'Densité pulpe CIL',      unit: '% sol', step: '0.5',  source: 'LIMS' },
    { key: 'cyanide_cons',  label: 'Consommation NaCN',      unit: 'kg/t',   step: '0.01', source: 'LIMS' },
    { key: 'lime_cons',     label: 'Consommation chaux',     unit: 'kg/t',   step: '0.1',  source: 'LIMS' },
    { key: 'dissolved_o2',  label: 'Oxygène dissous',        unit: 'mg/L',   step: '0.5',  source: 'LIMS' },
    { key: 'carbon_conc',   label: 'Charbon actif (CIL)',    unit: 'g/L',    step: '1',    source: 'LIMS' },
    { key: 'elution_temp',  label: 'Température élution',    unit: '°C',     step: '1',    source: 'LIMS' },
    { key: 'ew_current_density', label: 'Densité courant EW', unit: 'A/m²', step: '10',   source: 'Pratique' },
    { key: 'thickener_area_factor', label: 'Aire unit. épaiss.', unit: 'm²/(t/j)', step: '0.001', source: 'LIMS' },
    { key: 'cwi',               label: 'Bond Crushing WI (CWi)', unit: 'kWh/t', step: '0.1',  source: 'LIMS' },
    { key: 'scse',              label: 'SMC SCSE (SAG)',        unit: 'kWh/t', step: '0.1',  source: 'LIMS' },
    { key: 'f80_rom_mm',        label: 'F80 ROM',               unit: 'mm',    step: '10',   source: 'Concassage' },
    { key: 'p80_primary_mm',    label: 'P80 concassage primaire', unit: 'mm',  step: '5',    source: 'Concassage' },
    { key: 'p80_secondary_mm',  label: 'P80 concassage secondaire', unit: 'mm', step: '1',   source: 'Concassage' },
    { key: 'p80_hpgr_mm',       label: 'P80 HPGR',              unit: 'mm',    step: '0.5',  source: 'Concassage' },
    { key: 'avail_crush',       label: 'Disponibilité concassage', unit: '%',  step: '1',    source: 'Projet' },
    { key: 'sf_crush',          label: 'Facteur design concassage', unit: '%', step: '1',    source: 'Projet' },
    { key: 'sf_grind',          label: 'Facteur design broyage', unit: '%',    step: '1',    source: 'Projet' },
    { key: 'eta_mech',          label: 'Rendement méca. concasseur', unit: '%', step: '1',   source: 'Pratique' },
    { key: 'eta_motor',         label: 'Rendement moteur broyeur', unit: '%',  step: '1',    source: 'Pratique' },
    { key: 'cl_ball',           label: 'Charge circulante ball mill', unit: '%', step: '10', source: 'Pratique' },
    { key: 'cyclone_pct_solids', label: 'Cyclone feed % solides', unit: '%',   step: '1',    source: 'Pratique' },
    { key: 'ball_cons',         label: 'Consommation boulets acier', unit: 'kg/t', step: '0.05', source: 'LIMS' },
    { key: 'leach_k',           label: 'Constante cinétique leach (k)', unit: '1/h', step: '0.01', source: 'LIMS' },
    { key: 'carbon_loading',    label: 'Charge Au charbon (loaded)', unit: 'g/t', step: '100', source: 'LIMS' },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<Settings size={20}/>}
        title="Critères de Conception"
        breadcrumb={['Projet', 'Ingénierie', 'Critères de Conception']}
        actions={
          <div className="flex gap-2 items-center">
            {limsLoaded && (
              <span className="flex items-center gap-1 text-[11px] text-teal-400 bg-teal-400/10 border border-teal-400/20 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={11}/> LIMS auto-chargé
              </span>
            )}
            {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={13}/> Sauvegardé</span>}
            {saving && <span className="text-xs mf-txt4">Sauvegarde…</span>}
            <button onClick={() => setShowInputs(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Info size={13}/> Paramètres
            </button>
            <button onClick={() => setShowSnapshot(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Camera size={13}/> Snapshot
            </button>
            <button onClick={() => setShowHistory(true)} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Lock size={13}/> Historique
            </button>
          </div>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <div className="w-60 shrink-0 border-r mf-border overflow-y-auto p-3 space-y-1">
          <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider mb-2">Équipements Actifs</div>
          {groups.map(grp => (
            <div key={grp.gid}>
              <button
                onClick={() => setCollapsed(c => ({ ...c, [grp.gid]: !c[grp.gid] }))}
                className="flex items-center gap-1.5 w-full text-[11px] font-semibold mf-txt3 hover:mf-txt py-1 transition-colors"
              >
                {collapsed[grp.gid] ? <ChevronRight size={11}/> : <ChevronDown size={11}/>}
                {grp.icon}
                <span>{grp.label}</span>
                <span className="ml-auto text-[9px] text-emerald-400/70">
                  {grp.sections.filter(s => activeEquip[s.id] !== false).length}/{grp.sections.length}
                </span>
              </button>
              {!collapsed[grp.gid] && (
                <div className="ml-3 space-y-0.5 mb-1">
                  {grp.sections.map(sec => (
                    <label key={sec.id} className="flex items-center gap-2 cursor-pointer group py-0.5">
                      <input
                        type="checkbox"
                        checked={activeEquip[sec.id] !== false}
                        onChange={() => sec.id !== 'general' && toggleEquip(sec.id)}
                        disabled={sec.id === 'general'}
                        className="accent-teal-400 w-3.5 h-3.5"
                      />
                      <span className={`text-[11px] transition-colors ${activeEquip[sec.id] !== false ? 'mf-txt' : 'mf-txt4'}`}>
                        {sec.label}
                      </span>
                      <span className="text-[9px] mf-txt4 ml-auto">{sec.code}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Summary */}
          <div className="mt-3 pt-3 border-t mf-border">
            <div className="text-[10px] mf-txt3 uppercase tracking-wider mb-1">Résumé</div>
            <div className="text-[11px] mf-txt4">Phase: <span className="mf-txt">{project.phase}</span></div>
            <div className="text-[11px] mf-txt4">Précision: <span className="text-amber-400">{phaseSuffix(phase)}</span></div>
            <div className="text-[11px] mf-txt4 mt-0.5">{totalRows} paramètres calculés</div>
          </div>
        </div>

        {/* ── Main table ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          <div className="p-3 pb-1 flex items-center gap-3">
            <span className="text-xs font-semibold mf-txt">Critères de Conception — {project.name}</span>
            <span className="text-[11px] text-amber-400 border border-amber-400/20 bg-amber-400/10 px-1.5 py-0.5 rounded-full">{phaseSuffix(phase)} · {project.phase}</span>
            <span className="text-[11px] mf-txt4 ml-2">{totalRows} lignes · colonnes Commentaire & Référence à remplir manuellement</span>
          </div>

          <div className="overflow-x-auto px-3 pb-6">
            <table className="tbl text-xs w-full min-w-[900px]">
              <thead>
                <tr className="sticky top-0 z-10 bg-[var(--mf-bg,#0f1117)]">
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-16">CODE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-72">PARAMÈTRE</th>
                  <th className="text-right px-2 py-2 mf-txt3 font-semibold w-28">VALEUR</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-20">UNITÉ</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-60">FORMULE / BASIS</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-24">SOURCE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-48 border-l border-amber-400/20 bg-amber-400/5">COMMENTAIRE</th>
                  <th className="text-left px-2 py-2 mf-txt3 font-semibold w-40 bg-amber-400/5">RÉFÉRENCE</th>
                </tr>
              </thead>
              <tbody>
                {computedSections.map(sec => (
                  <>
                    {/* Section header row */}
                    <tr key={`hdr-${sec.id}`} className="bg-teal-400/10 border-y border-teal-400/20">
                      <td colSpan={8} className="px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {sec.icon}
                          <span className="text-xs font-semibold text-teal-300">{sec.code} — {sec.label}</span>
                          <span className="text-[10px] mf-txt4 ml-2">{sec.computed.length} paramètres</span>
                        </div>
                      </td>
                    </tr>
                    {/* Parameter rows */}
                    {sec.computed.map((row, i) => (
                      <ParameterRow
                        key={row.id + i}
                        row={row}
                        userEdit={userEdits[row.id]}
                        onEditChange={updateUserEdit}
                      />
                    ))}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── Inputs Modal ──────────────────────────────────────────────────────── */}
      {showInputs && (
        <Modal title="Paramètres d'Entrée — Sources de Données" onClose={() => setShowInputs(false)}>
          <div className="p-4 space-y-1 min-w-[520px] max-h-[80vh] overflow-y-auto">
            <div className="text-xs mf-txt4 mb-3">
              Les valeurs marquées <span className="text-teal-400">LIMS</span> sont auto-chargées depuis le module LIMS.
              Les autres peuvent être ajustées manuellement.
            </div>
            <div className="grid grid-cols-2 gap-2">
              {INPUT_FIELDS.map(f => (
                <div key={f.key} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] mf-txt3">{f.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                      f.source === 'LIMS' ? 'bg-teal-400/10 text-teal-400 border-teal-400/20' :
                      f.source === 'Projet' || f.source === 'Modèle blocs' ? 'bg-blue-400/10 text-blue-400 border-blue-400/20' :
                      'bg-white/5 text-white/40 border-white/10'
                    }`}>{f.source}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step={f.step}
                      value={inputs[f.key]}
                      onChange={e => updateInput(f.key, parseFloat(e.target.value) || 0)}
                      className="input-field flex-1 text-xs py-0.5"
                    />
                    <span className="text-[10px] mf-txt4 w-12 shrink-0">{f.unit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ── Snapshot Modal ────────────────────────────────────────────────────── */}
      {showSnapshot && (
        <Modal title="Créer un Snapshot" onClose={() => setShowSnapshot(false)}>
          <div className="p-4 space-y-3 min-w-[360px]">
            <div className="text-xs mf-txt3">Enregistrez l'état actuel comme référence figée (Rev A, B, C…)</div>
            <input
              className="input-field w-full"
              placeholder="Ex: Rev A — PFS 2025-07"
              value={snapshotLabel}
              onChange={e => setSnapshotLabel(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSnapshot(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={createSnapshot} disabled={!snapshotLabel.trim()} className="btn btn-teal">
                <Camera size={13}/> Créer
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── History Modal ─────────────────────────────────────────────────────── */}
      {showHistory && (
        <Modal title="Historique des Snapshots" onClose={() => setShowHistory(false)}>
          <div className="p-4 min-w-[400px] space-y-2">
            {snapshots.length === 0 && (
              <div className="text-center mf-txt3 py-8 text-sm">Aucun snapshot enregistré</div>
            )}
            {snapshots.map(s => (
              <div key={s.id} className="flex items-center gap-3 card-sm py-2">
                <Lock size={13} className="mf-txt3 shrink-0"/>
                <div className="flex-1">
                  <div className="text-xs font-semibold mf-txt">{s.label}</div>
                  <div className="text-[10px] mf-txt4">{new Date(s.created_at).toLocaleString('fr-CA')}</div>
                </div>
                <button onClick={() => restoreSnapshot(s.id)} className="btn btn-sm btn-secondary text-xs">
                  Restaurer
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── Parameter row sub-component ─────────────────────────────────────────────

interface ParameterRowProps {
  row: CriteriaRow;
  userEdit?: { comment: string; reference: string };
  onEditChange: (rowId: string, col: 'comment' | 'reference', val: string) => void;
}

function ParameterRow({ row, userEdit, onEditChange }: ParameterRowProps) {
  const [editingComment, setEditingComment] = useState(false);
  const [editingRef, setEditingRef] = useState(false);

  const comment = userEdit?.comment ?? '';
  const reference = userEdit?.reference ?? '';

  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03] group">
      <td className="px-2 py-1 w-16">
        <span className="text-[10px] mf-txt4">{row.id.slice(0, 6)}</span>
      </td>
      <td className="px-2 py-1 w-72">
        <span className="mf-txt text-xs">{row.parameter}</span>
      </td>
      <td className="px-2 py-1 w-28 text-right">
        <span className={`font-mono text-xs font-semibold ${row.isCalc ? 'text-teal-300' : 'text-amber-300'}`}>
          {row.value}
        </span>
      </td>
      <td className="px-2 py-1 w-20">
        <span className="text-[11px] mf-txt4">{row.unit}</span>
      </td>
      <td className="px-2 py-1 w-60">
        <span className="text-[10px] text-blue-400/70 font-mono leading-tight">{row.formula}</span>
      </td>
      <td className="px-2 py-1 w-24">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          row.source === 'LIMS' ? 'bg-teal-400/10 text-teal-400' :
          row.source === 'Calcul' ? 'bg-blue-400/10 text-blue-400' :
          row.source === 'Projet' || row.source === 'Gisement' ? 'bg-purple-400/10 text-purple-400' :
          row.source === 'Pratique' ? 'bg-amber-400/10 text-amber-400' :
          row.source === 'Réglement' ? 'bg-red-400/10 text-red-400' :
          'bg-white/5 text-white/40'
        }`}>{row.source}</span>
      </td>
      {/* Comment — user fills */}
      <td className="px-1 py-0.5 w-48 border-l border-amber-400/10">
        {editingComment ? (
          <input
            autoFocus
            className="input-field w-full text-xs py-0.5 bg-amber-400/5"
            value={comment}
            onChange={e => onEditChange(row.id, 'comment', e.target.value)}
            onBlur={() => setEditingComment(false)}
          />
        ) : (
          <div
            className="text-xs mf-txt px-1 py-0.5 min-h-[20px] cursor-pointer rounded hover:bg-amber-400/10 italic text-white/40"
            onClick={() => setEditingComment(true)}
          >
            {comment || <span className="text-[10px] text-white/20">cliquer pour saisir…</span>}
          </div>
        )}
      </td>
      {/* Reference — user fills */}
      <td className="px-1 py-0.5 w-40">
        {editingRef ? (
          <input
            autoFocus
            className="input-field w-full text-xs py-0.5 bg-amber-400/5"
            value={reference}
            onChange={e => onEditChange(row.id, 'reference', e.target.value)}
            onBlur={() => setEditingRef(false)}
          />
        ) : (
          <div
            className="text-xs mf-txt px-1 py-0.5 min-h-[20px] cursor-pointer rounded hover:bg-amber-400/10 italic text-white/40"
            onClick={() => setEditingRef(true)}
          >
            {reference || <span className="text-[10px] text-white/20">référence…</span>}
          </div>
        )}
      </td>
    </tr>
  );
}
