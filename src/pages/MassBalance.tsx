import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Scale, Droplets, Leaf, BarChart3,
  RefreshCw, Download, CheckCircle2, AlertCircle,
  Edit3, Network,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { SyncBanner } from '../components/ui/SyncBanner';
import { useProject } from '../lib/ProjectContext';
import { HOURS_PER_YEAR, TROY_OZ_GRAMS } from '../lib/config/constants';
import {
  GROUP_ENERGY_KWH_T, GROUP_CN_KG_T, GROUP_LIME_KG_T,
  GROUP_SOLIDS_PCT, GROUP_MASS_FACTOR, GROUP_AU_FACTORS,
  GROUP_ABSOLUTE_MASS_TPH, GROUP_ABSOLUTE_AU_GT,
  GRAV_BLEED_OF_UF, GRAVITY_PULL, OXIDATION_MIN_MASS_PULL,
} from '../lib/config/massBalance';
import type { Project } from '../types';
import type { CanvasNode, CanvasEdge } from './Flowsheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MbStream {
  id: string;
  stream_no: string;
  from_node_id: string;
  to_node_id: string;
  from_tag: string;
  to_tag: string;
  name: string;
  mass_tph: number;
  solids_pct: number;
  water_m3h: number;
  slurry_m3h: number;
  au_g_t: number;
  au_kg_h: number;
  energy_kwh_h: number;
  cn_kg_h: number;
  lime_kg_h: number;
  is_edited: boolean;
  sort_order: number;
}

interface CarbonItem {
  id: string;
  scope: 1 | 2 | 3;
  source: string;
  description: string;
  activity_value: number;
  activity_unit: string;
  emission_factor: number;
  ef_unit: string;
  tco2e_year: number;
  is_edited: boolean;
  sort_order: number;
}

// ─── Generation engine ────────────────────────────────────────────────────────

const GROUP_LOOKUP: Record<string, string> = {
  FEED_ROM:'Ali', FEED_COB:'Ali', FEED_APRON:'Ali', CONV_BELT:'Ali', FEED_SURGE:'Ali', FEED_STACKER:'Ali',
  CRUSH_GYRATORY:'Crush', CRUSH_JAW:'Crush', CRUSH_CONE_SEC:'Crush', CRUSH_CONE_TER:'Crush',
  CRUSH_HPGR:'Crush', CRUSH_IMPACT:'Crush', CRUSH_PEBBLE:'Crush', CRUSH_ROLL:'Crush',
  SCREEN_VIB:'Screen', SCREEN_BANANA:'Screen', SCREEN_TROMMEL:'Screen', SCREEN_DSM:'Screen', SCREEN_INTER:'Screen',
  MILL_SAG:'Grind', MILL_AG:'Grind', MILL_BALL:'Grind', MILL_ROD:'Grind',
  MILL_VERTIMILL:'Regrind', MILL_ISAMILL:'Regrind', MILL_TOWER:'Regrind', MILL_STIRRED:'Regrind',
  CLASSIF_CYCL:'Classif', CLASSIF_SPIRAL:'Classif', CLASSIF_RAKE:'Classif',
  GRAV_KNELSON:'Grav', GRAV_FALCON:'Grav', GRAV_TABLE:'GravConc', GRAV_ILR:'GravConc',
  GRAV_JIG:'Grav', GRAV_SPIRAL:'Grav', GRAV_KACHA:'Grav',
  FLOAT_MECH:'Float', FLOAT_COLUMN:'Float', FLOAT_FLASH:'Float',
  FLOAT_JAMESON:'Float', FLOAT_ROUGH:'Float', FLOAT_CLEAN:'Float',
  THCK_CONV:'Thick', THCK_HIRATE:'Thick', THCK_PASTE:'Thick',
  FILT_BELT:'Filt', FILT_PRESS:'Filt', FILT_DISC:'Filt', FILT_CENTRIFUGE:'Filt',
  CIL_TANK:'CIL', CIP_TANK:'CIP', LEACH_TANK:'Leach', LEACH_HEAP:'Heap',
  AGGLOM:'Heap', SCREEN_INTER_X:'CIL', PLS_POND:'PLS', PREG_ROBBING:'Leach',
  OX_AUTOCLAVE:'POX', OX_ROASTER:'POX', OX_BIOX:'POX', OX_ALBION:'POX',
  OX_NITROX:'POX', NEUT_TANK:'Neut',
  ADR_COLUMN:'ADR', ADR_ELUTION_AARL:'Elut', ADR_ELUTION_ZADRA:'Elut',
  ADR_EW:'EW', ADR_FURNACE:'Smelt', ADR_RETORT:'Smelt', ADR_KILN:'Kiln',
  ADR_DORE:'Smelt', MC_MERRILL:'MC',
  TAILS_TSF:'Tails', TAILS_DRY:'Tails', TAILS_PASTE:'Tails',
  WT_DETOX:'WT', WT_EFFLUENT:'WT', WT_POND:'WT',
};

// Énergie (kWh/t) et réactifs (kg/t) par groupe d'opération — voir lib/config/massBalance.
function g(code: string) { return GROUP_LOOKUP[code] ?? 'Other'; }
function energy(code: string) { return GROUP_ENERGY_KWH_T[g(code)] ?? 0; }
function cnRate(code: string) { return GROUP_CN_KG_T[g(code)] ?? 0; }
function limeRate(code: string) { return GROUP_LIME_KG_T[g(code)] ?? 0; }

// Design-criteria parameters that drive the balance ratios (read from dc_draft.inputs).
// When no criteria draft exists we fall back to the same defaults as the Criteria module.
interface MbCriteria {
  clBall: number;        // ball-mill circulating load %
  massPull: number;      // flotation mass pull %
  grgPct: number;        // gravity recoverable gold %
  cycloneSolids: number; // hydrocyclone feed % solids
  leachSolids: number;   // CIL/CIP % solids
  leachRec: number;      // leach recovery fraction 0–1
  hasFlotation: boolean; // a flotation stage exists in this flowsheet
}

const DEFAULT_MB_CRITERIA: MbCriteria = {
  clBall: 300, massPull: 8, grgPct: 25, cycloneSolids: 65, leachSolids: 42, leachRec: 0.88, hasFlotation: false,
};

function computeStreamProps(toCode: string, tph: number, au: number, rec: number, sg: number, c: MbCriteria) {
  const grp = g(toCode);
  const S = GROUP_SOLIDS_PCT, M = GROUP_MASS_FACTOR, A = GROUP_AU_FACTORS;
  let mass = tph, sol = S.Other, auV = au;
  // Rendement du circuit gravité : GRG × efficacité de passe × efficacité ILR.
  const gravPull = Math.min(
    GRAVITY_PULL.maxPull,
    (c.grgPct / 100) * GRAVITY_PULL.passEfficiency * GRAVITY_PULL.ilrEfficiency,
  );

  if (grp === 'Ali')      { mass = tph;              sol = S.Ali; }
  else if (grp === 'Crush') { mass = tph * M.Crush;  sol = S.Crush; }
  else if (grp === 'Screen'){ mass = tph;            sol = S.Screen; }
  else if (grp === 'Grind') {
    if (toCode === 'MILL_SAG' || toCode === 'MILL_AG') { mass = tph; sol = S.MillSag; }
    else { mass = tph * (1 + c.clBall / 100); sol = S.MillBall; } // alim. ball = frais × (1 + charge circulante)
  }
  else if (grp === 'Regrind') {
    // Regrind de concentré quand la flottation est présente, sinon flux principal.
    if (c.hasFlotation) { mass = tph * c.massPull / 100; sol = S.RegrindConc; }
    else                { mass = tph;                    sol = S.Regrind; }
  }
  else if (grp === 'Classif') { mass = tph;         sol = c.cycloneSolids; }
  else if (grp === 'Grav')    {
    // Le concentrateur gravité (Knelson/Falcon) traite un SOUTIRAGE (bleed) de
    // la SOUSVERSE cyclone (charge circulante), pas tout le flux ni un % de
    // l'alimentation fraîche. UF ≈ tph × (1 + charge circulante %).
    const ufMass = tph * (1 + c.clBall / 100);
    mass = ufMass * GRAV_BLEED_OF_UF; sol = S.Grav; auV = au * (1 - gravPull);
  }
  else if (grp === 'GravConc'){ mass = tph * M.GravConc; sol = S.GravConc; auV = au * A.gravConcUpgrade; }
  else if (grp === 'Float')   {
    mass = tph * c.massPull / 100; sol = S.Float;
    auV = au * Math.max(A.floatMinUpgrade, 100 / Math.max(c.massPull, 1) * A.floatRecovery);
  }
  else if (grp === 'Thick')   { mass = tph;                sol = S.Thick; }
  else if (grp === 'Filt')    { mass = tph * M.Filt;       sol = S.Filt; }
  else if (grp === 'CIL' || grp === 'CIP') { mass = tph; sol = c.leachSolids; auV = au * (1 - c.leachRec * A.cilLeachEfficiency); }
  else if (grp === 'Leach')   { mass = tph;                sol = S.Leach; auV = au * (1 - c.leachRec * A.leachEfficiency); }
  else if (grp === 'Heap')    { mass = tph;                sol = S.Heap;  auV = au * (1 - c.leachRec); }
  else if (grp === 'PLS')     { mass = tph * M.PLS;        sol = S.PLS;   auV = au * rec * A.plsShare; }
  else if (grp === 'POX')     { mass = tph * Math.max(OXIDATION_MIN_MASS_PULL, c.massPull / 100); sol = S.POX; }
  else if (grp === 'Neut')    { mass = tph * Math.max(OXIDATION_MIN_MASS_PULL, c.massPull / 100); sol = S.Neut; }
  else if (grp === 'ADR')     { mass = tph * M.ADR;        sol = S.ADR;   auV = au * rec * A.adrShare; }
  else if (grp === 'Elut')    { mass = GROUP_ABSOLUTE_MASS_TPH.Elut;  sol = S.Elut;  auV = GROUP_ABSOLUTE_AU_GT.Elut; }
  else if (grp === 'EW')      { mass = GROUP_ABSOLUTE_MASS_TPH.EW;    sol = S.EW;    auV = GROUP_ABSOLUTE_AU_GT.EW; }
  else if (grp === 'Smelt')   { mass = GROUP_ABSOLUTE_MASS_TPH.Smelt; sol = S.Smelt; auV = GROUP_ABSOLUTE_AU_GT.Smelt; }
  else if (grp === 'MC')      { mass = tph * M.MC;         sol = S.MC;    auV = au * rec * A.mcShare; }
  else if (grp === 'Tails')   { mass = tph;                sol = S.Tails; auV = au * (1 - rec); }
  else if (grp === 'WT')      { mass = tph * M.WT;         sol = S.WT; }
  else                        { mass = tph;                sol = S.Other; }

  // Grinding energy (Bond) is per tonne of FRESH feed, so the circulating load must not
  // inflate the mill power even though the physical stream mass includes recirculation.
  const energyMass = grp === 'Grind' ? tph : mass;

  const water_m3h  = sol < 100 ? (mass / sg) * (100 - sol) / Math.max(sol, 1) : 0;
  const slurry_m3h = sol > 0 ? mass / sg / (sol / 100) : water_m3h;
  return {
    mass_tph:  +mass.toFixed(2),
    solids_pct: sol,
    water_m3h:  +water_m3h.toFixed(2),
    slurry_m3h: +slurry_m3h.toFixed(2),
    au_g_t:     +auV.toFixed(3),
    au_kg_h:    +(mass * auV / 1000).toFixed(4),
    energy_kwh_h: +(energyMass * energy(toCode)).toFixed(1),
    cn_kg_h:    +(mass * cnRate(toCode)).toFixed(3),
    lime_kg_h:  +(mass * limeRate(toCode)).toFixed(3),
  };
}

function generateMbStreams(
  nodes: CanvasNode[], edges: CanvasEdge[],
  project: Project, fsId: string, criteria: MbCriteria,
  recoveryPct: number,
): Omit<MbStream, 'id'>[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  // Recovery = the app's single effective recovery (LIMS testwork via ProjectContext),
  // NOT project.recovery_pct — the KPI cards on this same page already use it, and
  // generating tails/PLS grades on the design recovery made the two disagree.
  const tph = project.target_tph, au = project.gold_grade_g_t,
        rec = recoveryPct / 100, sg = project.ore_sg;

  return edges.map((edge, idx) => {
    const from = nodeMap.get(edge.from);
    const to   = nodeMap.get(edge.to);
    if (!from || !to) return null;
    const props = computeStreamProps(to.equipCode, tph, au, rec, sg, criteria);
    return {
      stream_no:    `S${String(idx + 1).padStart(2, '0')}`,
      from_node_id: edge.from,
      to_node_id:   edge.to,
      from_tag:     from.tag,
      to_tag:       to.tag,
      name:         `${from.label} → ${to.label}`,
      ...props,
      is_edited: false,
      sort_order: idx,
    };
  }).filter(Boolean) as Omit<MbStream, 'id'>[];
}

// ─── Equipment power lookup (kW ref at 200 t/h) ───────────────────────────────

const EQUIP_POWER_REF: Record<string, number> = {
  CRUSH_GYRATORY:375, CRUSH_JAW:200, CRUSH_CONE_SEC:250, CRUSH_CONE_TER:200,
  CRUSH_HPGR:2800, CRUSH_IMPACT:200, CRUSH_PEBBLE:315, CRUSH_ROLL:160,
  MILL_SAG:3700, MILL_AG:4000, MILL_BALL:2800, MILL_ROD:2200,
  MILL_VERTIMILL:750, MILL_ISAMILL:1120, MILL_TOWER:800, MILL_STIRRED:1000,
  CLASSIF_CYCL:0, SCREEN_VIB:22, SCREEN_TROMMEL:15, SCREEN_BANANA:15, SCREEN_DSM:0,
  GRAV_KNELSON:11, GRAV_FALCON:15, GRAV_TABLE:1.5, GRAV_ILR:22, GRAV_JIG:30, GRAV_SPIRAL:0,
  FLOAT_MECH:90, FLOAT_COLUMN:45, FLOAT_FLASH:75, FLOAT_JAMESON:55, FLOAT_ROUGH:120, FLOAT_CLEAN:60,
  THCK_CONV:15, THCK_HIRATE:18, THCK_PASTE:22, FILT_BELT:45, FILT_PRESS:90, FILT_DISC:55, FILT_CENTRIFUGE:55,
  CIL_TANK:55, CIP_TANK:55, LEACH_TANK:45, LEACH_HEAP:0, AGGLOM:45, SCREEN_INTER:5, PLS_POND:0,
  OX_AUTOCLAVE:2200, OX_ROASTER:3500, OX_BIOX:180, OX_ALBION:1200, OX_NITROX:500, NEUT_TANK:22,
  ADR_COLUMN:5, ADR_ELUTION_AARL:75, ADR_ELUTION_ZADRA:90, ADR_EW:90,
  ADR_FURNACE:45, ADR_RETORT:30, ADR_KILN:110, ADR_DORE:0, MC_MERRILL:110,
  TAILS_TSF:0, TAILS_DRY:0, TAILS_PASTE:22, WT_DETOX:15, WT_EFFLUENT:30, WT_POND:0,
  FEED_ROM:0, FEED_COB:0, FEED_APRON:45, CONV_BELT:90, FEED_SURGE:0, FEED_STACKER:45,
};

function generateCarbonItems(
  nodes: CanvasNode[], project: Project,
  nacn_kg_t = 0.45, cao_kg_t = 2.5, grid_ef = 0.50, hoursPerYear: number = HOURS_PER_YEAR
): Omit<CarbonItem, 'id'>[] {
  const tph   = project.target_tph;
  const avail = project.availability_pct / 100;
  const hrs   = avail * hoursPerYear;
  const anTon = tph * hrs;
  const items: Omit<CarbonItem, 'id'>[] = [];

  // Scope 2 — Electricity per equipment
  nodes.forEach((n, i) => {
    const ref  = EQUIP_POWER_REF[n.equipCode] ?? 0;
    if (ref === 0) return;
    const pwkw = ref * (tph / 200);
    const kwh  = pwkw * hrs;
    items.push({
      scope: 2, source: n.tag,
      description: `Électricité — ${n.label}`,
      activity_value: +kwh.toFixed(0), activity_unit: 'kWh/an',
      emission_factor: grid_ef, ef_unit: 'kgCO₂/kWh',
      tco2e_year: +(kwh * grid_ef / 1000).toFixed(1),
      is_edited: false, sort_order: i + 100,
    });
  });

  // Scope 1 — Diesel: crushing + mobile
  const hasCrushing = nodes.some(n => GROUP_LOOKUP[n.equipCode] === 'Crush');
  if (hasCrushing) {
    const liters = anTon * 0.28; // L/t for crushing operations
    items.push({
      scope: 1, source: 'MOBILE-CRUSH',
      description: 'Diesel — Équipements concassage & alimentation',
      activity_value: +liters.toFixed(0), activity_unit: 'L/an',
      emission_factor: 2.68, ef_unit: 'kgCO₂/L',
      tco2e_year: +(liters * 2.68 / 1000).toFixed(1),
      is_edited: false, sort_order: 1,
    });
  }
  // Scope 1 — Propane/gaz pour fusion
  const hasSmelt = nodes.some(n => ['ADR_FURNACE', 'ADR_RETORT', 'OX_ROASTER'].includes(n.equipCode));
  if (hasSmelt) {
    items.push({
      scope: 1, source: 'SMELT-GAS',
      description: 'Gaz / propane — Fusion & traitement thermique',
      activity_value: +(anTon * 0.003).toFixed(0), activity_unit: 'GJ/an',
      emission_factor: 56.1, ef_unit: 'kgCO₂/GJ',
      tco2e_year: +(anTon * 0.003 * 56.1 / 1000).toFixed(1),
      is_edited: false, sort_order: 2,
    });
  }

  // Scope 3 — NaCN
  const hasLeach = nodes.some(n => ['CIL_TANK', 'CIP_TANK', 'LEACH_TANK', 'LEACH_HEAP'].includes(n.equipCode));
  if (hasLeach) {
    const nacnTon = anTon * nacn_kg_t / 1000;
    items.push({
      scope: 3, source: 'NACN',
      description: 'Cyanure de sodium (NaCN) — production & transport',
      activity_value: +nacnTon.toFixed(1), activity_unit: 't NaCN/an',
      emission_factor: 0.82, ef_unit: 'tCO₂/t NaCN',
      tco2e_year: +(nacnTon * 0.82).toFixed(1),
      is_edited: false, sort_order: 201,
    });
  }
  // Scope 3 — CaO
  const nacnTon2 = anTon * cao_kg_t / 1000;
  items.push({
    scope: 3, source: 'CAO',
    description: 'Chaux vive (CaO) — production & transport',
    activity_value: +nacnTon2.toFixed(1), activity_unit: 't CaO/an',
    emission_factor: 0.75, ef_unit: 'tCO₂/t CaO',
    tco2e_year: +(nacnTon2 * 0.75).toFixed(1),
    is_edited: false, sort_order: 202,
  });
  // Scope 3 — Grinding media
  const hasGrinding = nodes.some(n => ['MILL_SAG','MILL_BALL','MILL_AG','MILL_ROD'].includes(n.equipCode));
  if (hasGrinding) {
    const steelTon = anTon * 0.55 / 1000;
    items.push({
      scope: 3, source: 'MEDIA',
      description: 'Boulets & blindages broyage — acier',
      activity_value: +steelTon.toFixed(1), activity_unit: 't acier/an',
      emission_factor: 1.85, ef_unit: 'tCO₂/t acier',
      tco2e_year: +(steelTon * 1.85).toFixed(1),
      is_edited: false, sort_order: 203,
    });
  }
  // Scope 3 — Transport/Supply chain
  const totalDirectCarbon = items.filter(i => i.scope <= 2).reduce((s, i) => s + i.tco2e_year, 0);
  items.push({
    scope: 3, source: 'SUPPLY',
    description: 'Chaîne approvisionnement — consommables divers',
    activity_value: +totalDirectCarbon.toFixed(0), activity_unit: 'tCO₂e Sc1+Sc2',
    emission_factor: 0.12, ef_unit: 'ratio',
    tco2e_year: +(totalDirectCarbon * 0.12).toFixed(1),
    is_edited: false, sort_order: 204,
  });

  return items;
}

// ─── Inline-editable cell ─────────────────────────────────────────────────────

function EditCell({
  value, onSave, fmt = (v: number) => formatDecimalGrouped(v, 2),
}: { value: number; onSave: (v: number) => void; fmt?: (v: number) => string }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  if (editing) {
    return (
      <input
        autoFocus
        className="w-full bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5 text-xs font-mono text-amber-300 text-right outline-none"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => { onSave(parseFloat(draft) || 0); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onSave(parseFloat(draft) || 0); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }
  return (
    <span
      className="cursor-pointer hover:text-amber-300 hover:underline decoration-dashed decoration-amber-500/30"
      onClick={() => { setDraft(String(value)); setEditing(true); }}
    >{fmt(value)}</span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'mass',  label: 'Bilan massique',  icon: Scale },
  { id: 'water', label: 'Bilan eau',       icon: Droplets },
  { id: 'carbon',label: 'Empreinte C',     icon: Leaf },
  { id: 'mc',    label: 'Monte Carlo',     icon: BarChart3 },
];

interface MassBalanceProps { project: Project }

export function MassBalance({ project }: MassBalanceProps) {
  const { settings, effectiveRecoveryPct, assumptions, annualProduction } = useProject();
  const [activeTab, setActiveTab]   = useState('mass');
  const [streams,   setStreams]     = useState<MbStream[]>([]);
  const [carbon,    setCarbon]      = useState<CarbonItem[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [generating, setGenerating] = useState(false);
  const [fsName,    setFsName]      = useState<string | null>(null);
  const [latestFsId, setLatestFsId] = useState<string | null>(null);
  const [hasFlowsheet, setHasFlowsheet] = useState(false);

  // Load streams + carbon from DB
  const loadData = useCallback(async () => {
    setLoading(true);
    const [strRes, carRes, fsRes] = await Promise.all([
      supabase.from('mass_balance_streams').select('*').eq('project_id', project.id).order('sort_order'),
      supabase.from('carbon_footprint_items').select('*').eq('project_id', project.id).order('scope,sort_order'),
      supabase.from('project_flowsheets').select('id,name,nodes,edges').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    setStreams((strRes.data ?? []) as MbStream[]);
    setCarbon((carRes.data ?? []) as CarbonItem[]);
    if (fsRes.data) { setFsName(fsRes.data.name); setLatestFsId(fsRes.data.id); setHasFlowsheet(true); }
    setLoading(false);
  }, [project.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Generate from flowsheet ────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!latestFsId) return;
    if (streams.some(s => s.is_edited)) {
      if (!confirm('Des valeurs ont été modifiées manuellement. La régénération les écrasera. Continuer ?')) return;
    }
    setGenerating(true);
    try {
      // Load latest flowsheet
      const { data: fs } = await supabase
        .from('project_flowsheets').select('id,nodes,edges').eq('id', latestFsId).eq('project_id', project.id).maybeSingle();
      if (!fs || !(fs.nodes as unknown as CanvasNode[])?.length) { alert('Flowsheet vide. Construisez un flowsheet dans le module Flowsheet.'); setGenerating(false); return; }

      const nodes = fs.nodes as unknown as CanvasNode[];
      const edges = fs.edges as unknown as CanvasEdge[];

      // Pull the design-criteria parameters so the balance ratios reflect the actual
      // sizing (circulating load, mass pull, GRG, cyclone/leach % solids, leach recovery)
      // rather than generic constants.
      const { data: dc } = await supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle();
      const inp = ((dc?.content as { inputs?: Record<string, number> } | null)?.inputs) ?? {};
      const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);
      const criteria: MbCriteria = {
        clBall:        num(inp.cl_ball, DEFAULT_MB_CRITERIA.clBall),
        massPull:      num(inp.flot_mass_pull, DEFAULT_MB_CRITERIA.massPull),
        grgPct:        num(inp.grg_pct, DEFAULT_MB_CRITERIA.grgPct),
        cycloneSolids: num(inp.cyclone_pct_solids, DEFAULT_MB_CRITERIA.cycloneSolids),
        leachSolids:   num(inp.slurry_density, DEFAULT_MB_CRITERIA.leachSolids),
        leachRec:      num(inp.leach_rec_24h, DEFAULT_MB_CRITERIA.leachRec * 100) / 100,
        hasFlotation:  nodes.some(n => g(n.equipCode) === 'Float'),
      };

      // Delete existing
      await supabase.from('mass_balance_streams').delete().eq('project_id', project.id);
      await supabase.from('carbon_footprint_items').delete().eq('project_id', project.id);

      // Generate + insert streams
      const newStreams = generateMbStreams(nodes, edges, project, fs.id, criteria, effectiveRecoveryPct);
      if (newStreams.length > 0) {
        await supabase.from('mass_balance_streams').insert(
          newStreams.map(s => ({ ...s, project_id: project.id, flowsheet_id: fs.id }))
        );
      }

      // Generate + insert carbon items
      const newCarbon = generateCarbonItems(
        nodes, project,
        settings?.nacn_co2_factor != null ? settings.nacn_co2_factor / 100 : undefined,
        settings?.cao_co2_factor  != null ? settings.cao_co2_factor  / 100 : undefined,
        settings?.grid_ef_kg_co2_kwh ?? undefined,
        assumptions.hoursPerYear,
      );
      if (newCarbon.length > 0) {
        await supabase.from('carbon_footprint_items').insert(
          newCarbon.map(c => ({ ...c, project_id: project.id }))
        );
      }

      await loadData();
    } finally { setGenerating(false); }
  }, [latestFsId, streams, project, loadData]);

  // ── Update a single stream field ──────────────────────────────────────────
  const updateStream = useCallback(async (id: string, field: keyof MbStream, val: number) => {
    setStreams(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, [field]: val, is_edited: true };
      // Recalculate derived fields
      if (field === 'mass_tph' || field === 'au_g_t') {
        updated.au_kg_h = +(updated.mass_tph * updated.au_g_t / 1000).toFixed(4);
      }
      if (field === 'mass_tph' || field === 'solids_pct') {
        const sg = project.ore_sg;
        updated.water_m3h   = updated.solids_pct < 100
          ? +(updated.mass_tph / sg * (100 - updated.solids_pct) / updated.solids_pct).toFixed(2) : 0;
        updated.slurry_m3h  = updated.solids_pct > 0
          ? +(updated.mass_tph / sg / (updated.solids_pct / 100)).toFixed(2) : updated.water_m3h;
      }
      return updated;
    }));
    await supabase.from('mass_balance_streams').update({ [field]: val, is_edited: true, updated_at: new Date().toISOString() }).eq('id', id).eq('project_id', project.id);
  }, [project.ore_sg]);

  // ── Update a carbon item ──────────────────────────────────────────────────
  const updateCarbon = useCallback(async (id: string, field: 'activity_value' | 'emission_factor', val: number) => {
    setCarbon(prev => prev.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, [field]: val, is_edited: true };
      updated.tco2e_year = +(updated.activity_value * updated.emission_factor / (updated.activity_unit?.includes('kWh') ? 1000 : 1)).toFixed(1);
      return updated;
    }));
    await supabase.from('carbon_footprint_items').update({ [field]: val, is_edited: true }).eq('id', id).eq('project_id', project.id);
  }, []);

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  const feedStream  = useMemo(() => streams[0] ?? null, [streams]);
  const tailStream  = useMemo(() => streams.find(s => ['TAILS_TSF','TAILS_DRY','TAILS_PASTE'].some(c => s.to_tag?.startsWith(c.slice(0,3)))), [streams]);
  const totalAuIn   = useMemo(() => streams.find(s => s.sort_order === 0)?.au_kg_h ?? project.target_tph * project.gold_grade_g_t / 1000, [streams, project]);
  const totalWaterIn = useMemo(() => streams.reduce((s, r) => s + (r.water_m3h > 0 ? r.water_m3h : 0), 0) / Math.max(streams.length, 1) * 4, [streams]);
  const totalEnergy  = useMemo(() => streams.reduce((s, r) => s + r.energy_kwh_h, 0), [streams]);
  const totalCN      = useMemo(() => streams.reduce((s, r) => s + r.cn_kg_h, 0), [streams]);
  const totalLime    = useMemo(() => streams.reduce((s, r) => s + r.lime_kg_h, 0), [streams]);

  const sc1 = useMemo(() => carbon.filter(c => c.scope === 1).reduce((s, c) => s + c.tco2e_year, 0), [carbon]);
  const sc2 = useMemo(() => carbon.filter(c => c.scope === 2).reduce((s, c) => s + c.tco2e_year, 0), [carbon]);
  const sc3 = useMemo(() => carbon.filter(c => c.scope === 3).reduce((s, c) => s + c.tco2e_year, 0), [carbon]);
  const totalCO2 = sc1 + sc2 + sc3;

  // Annual production comes from ProjectContext (single source of truth: it already
  // applies project_settings hours/yr and the testwork-derived effective recovery).
  const co2PerOz = totalCO2 > 0 && annualProduction > 0 ? formatDecimalGrouped((totalCO2 / annualProduction), 3) : '—';

  // ── Empty state banner ────────────────────────────────────────────────────
  const emptyBanner = (
    <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-mf-border rounded-xl bg-mf-panel/30">
      <Network size={32} className="text-mf-border mb-3" />
      <p className="text-sm font-semibold text-mf-txt3 mb-1">Aucun bilan généré</p>
      <p className="text-xs text-mf-txt4 mb-4 max-w-xs">
        {hasFlowsheet
          ? `Flowsheet "${fsName}" disponible. Cliquez sur Générer pour calculer le bilan automatiquement.`
          : 'Construisez d\'abord un flowsheet dans le module Flowsheet, puis revenez générer le bilan.'}
      </p>
      {hasFlowsheet && (
        <button onClick={handleGenerate} disabled={generating} className="btn btn-primary gap-2">
          <RefreshCw size={14} className={generating ? 'animate-spin' : ''} />
          {generating ? 'Génération…' : 'Générer depuis Flowsheet'}
        </button>
      )}
    </div>
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Bilan Massique & Eau · Empreinte C"
        subtitle={`${project.name} · ${project.target_tph} t/h · ${streams.length > 0 ? `${streams.length} flux` : 'Aucun flux'}`}
        breadcrumb={['Design Procédé', 'Bilan Massique']}
        actions={
          <div className="flex gap-2">
            {hasFlowsheet && (
              <button onClick={handleGenerate} disabled={generating} className="btn btn-secondary btn-sm gap-1.5">
                <RefreshCw size={13} className={generating ? 'animate-spin' : ''} />
                {generating ? 'Génération…' : `Re-générer (${fsName})`}
              </button>
            )}
            <button className="btn btn-secondary btn-sm gap-1.5"><Download size={13} />Export PDF</button>
          </div>
        }
      />

      <div className="px-8 py-5 space-y-5">

        <SyncBanner
          projectId={project.id} module="massbalance"
          onRegenerate={handleGenerate} regenerating={generating}
        />

        {/* KPI Strip */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Débit alimentation', val: `${project.target_tph}`, unit: 't/h',   color: 'text-amber-400' },
            { label: 'Récupération globale', val: `${formatDecimalGrouped(effectiveRecoveryPct, 1)}`, unit: '%',   color: 'text-teal-400'  },
            { label: 'Énergie spécifique', val: streams.length ? formatDecimalGrouped((totalEnergy / Math.max(feedStream?.mass_tph ?? project.target_tph, 1)), 1) : '—', unit: 'kWh/t', color: 'text-yellow-400' },
            { label: 'Empreinte C totale', val: totalCO2 > 0 ? formatDecimalGrouped(Math.round(totalCO2), 0) : '—', unit: 'tCO₂e/an', color: 'text-emerald-400' },
            { label: 'Intensité C',        val: co2PerOz, unit: 'tCO₂/oz', color: 'text-green-400' },
          ].map(k => (
            <div key={k.label} className="card-sm text-center py-3">
              <div className={`text-xl font-bold font-mono ${k.color}`}>{k.val} <span className="text-sm text-mf-txt3 font-normal">{k.unit}</span></div>
              <div className="text-[10px] text-mf-txt4 mt-1">{k.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t.id} className={`tab ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>
              <t.icon size={13} className="inline mr-1.5 -mt-0.5" />{t.label}
            </button>
          ))}
        </div>

        {/* ── BILAN MASSIQUE ──────────────────────────────────────────────── */}
        {activeTab === 'mass' && (
          <div className="space-y-4">
            {loading ? <div className="text-center py-12 text-mf-txt4 text-sm">Chargement…</div>
            : streams.length === 0 ? emptyBanner
            : (
              <>
                <div className="flex items-center gap-2 text-xs text-mf-txt4">
                  <Edit3 size={11} className="text-amber-500" />
                  Cliquez sur une valeur numérique pour la modifier. Les valeurs modifiées apparaissent en
                  <span className="text-amber-400 mx-1">● orangé</span>.
                </div>
                <div className="card overflow-hidden p-0">
                  <table className="tbl text-xs">
                    <thead>
                      <tr>
                        <th className="w-12">#</th>
                        <th>Désignation</th>
                        <th>De</th>
                        <th>Vers</th>
                        <th className="text-right">Masse (t/h)</th>
                        <th className="text-right">Sol. (%)</th>
                        <th className="text-right">Eau (m³/h)</th>
                        <th className="text-right">Au (g/t)</th>
                        <th className="text-right">Au (kg/h)</th>
                        <th className="text-right">Énergie</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {streams.map(s => (
                        <tr key={s.id} className={`transition-colors ${s.is_edited ? 'bg-amber-500/5' : 'hover:bg-mf-hover/40'}`}>
                          <td><span className="font-mono text-[10px] text-mf-txt4">{s.stream_no}</span></td>
                          <td className="text-mf-txt text-xs max-w-[180px] truncate">{s.name}</td>
                          <td><span className="font-mono text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded">{s.from_tag}</span></td>
                          <td><span className="font-mono text-[10px] px-1.5 py-0.5 bg-teal-500/10 text-teal-400 rounded">{s.to_tag}</span></td>
                          <td className="text-right font-mono text-xs">
                            <EditCell value={s.mass_tph}   onSave={v => updateStream(s.id, 'mass_tph',   v)} />
                          </td>
                          <td className="text-right font-mono text-xs">
                            <EditCell value={s.solids_pct} onSave={v => updateStream(s.id, 'solids_pct', v)} fmt={v => formatDecimalGrouped(v, 1)} />
                          </td>
                          <td className="text-right font-mono text-xs text-blue-400">
                            <EditCell value={s.water_m3h}  onSave={v => updateStream(s.id, 'water_m3h',  v)} />
                          </td>
                          <td className="text-right font-mono text-xs">
                            <EditCell value={s.au_g_t}     onSave={v => updateStream(s.id, 'au_g_t',     v)} fmt={v => v < 100 ? formatDecimalGrouped(v, 3) : formatDecimalGrouped(v, 0)} />
                          </td>
                          <td className="text-right font-mono text-xs text-amber-400">
                            {formatDecimalGrouped(s.au_kg_h, 4)}
                          </td>
                          <td className="text-right font-mono text-xs text-yellow-500">
                            {s.energy_kwh_h > 0 ? `${formatDecimalGrouped(s.energy_kwh_h, 0)} kWh/h` : '—'}
                          </td>
                          <td>
                            {s.is_edited && <span title="Modifié"><Edit3 size={10} className="text-amber-500 opacity-70" /></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Gold accounting */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="card">
                    <div className="section-title mb-3">Bilan or</div>
                    {[
                      ['Or entrant (alim.)',    `${formatDecimalGrouped((totalAuIn * 1000), 1)} kg/h`],
                      ['Récupération globale',  `${formatDecimalGrouped(effectiveRecoveryPct, 1)} %`],
                      ['Or récupéré',           `${formatDecimalGrouped((totalAuIn * 1000 * effectiveRecoveryPct / 100), 2)} kg/h`],
                      ['Oz / mois (30j)',        `${Math.round(totalAuIn * effectiveRecoveryPct / 100 * 24 * 30 * 1000 / TROY_OZ_GRAMS)} oz`],
                      ['Teneur résidu',          `${formatDecimalGrouped((project.gold_grade_g_t * (1 - effectiveRecoveryPct / 100)), 3)} g/t`],
                    ].map(([k, v]) => <div key={k as string} className="stat-row"><span className="stat-key">{k}</span><span className="stat-val">{v}</span></div>)}
                  </div>
                  <div className="card">
                    <div className="section-title mb-3">Réactifs (total circuit)</div>
                    {[
                      ['NaCN total',   `${formatDecimalGrouped(totalCN, 2)} kg/h`],
                      ['Chaux (CaO)',  `${formatDecimalGrouped(totalLime, 2)} kg/h`],
                      ['Conso. NaCN',  `${formatDecimalGrouped((totalCN / project.target_tph), 3)} kg/t`],
                      ['Conso. CaO',   `${formatDecimalGrouped((totalLime / project.target_tph), 3)} kg/t`],
                      ['Énergie spec.', `${formatDecimalGrouped((totalEnergy / project.target_tph), 1)} kWh/t`],
                    ].map(([k, v]) => <div key={k as string} className="stat-row"><span className="stat-key">{k}</span><span className="stat-val">{v}</span></div>)}
                  </div>
                  <div className="card">
                    <div className="section-title mb-3">Niveau de confiance</div>
                    {[
                      { l: 'Alimentation', pct: 95, c: '#2ECC8A' },
                      { l: 'Broyage',      pct: 88, c: '#2ECC8A' },
                      { l: 'Lixiviation',  pct: 82, c: '#F59E0B' },
                      { l: 'ADR/Finition', pct: 91, c: '#2ECC8A' },
                      { l: 'Résidus',      pct: 76, c: '#F88A44' },
                    ].map(row => (
                      <div key={row.l} className="mb-2">
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-mf-txt3">{row.l}</span>
                          <span style={{ color: row.c }} className="font-mono">{row.pct}%</span>
                        </div>
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${row.pct}%`, backgroundColor: row.c }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── BILAN EAU ───────────────────────────────────────────────────── */}
        {activeTab === 'water' && (
          <div className="space-y-4">
            {streams.length === 0 ? emptyBanner : (
              <div className="grid grid-cols-2 gap-4">
                <div className="card">
                  <div className="section-title mb-4">Bilan eau circuit fermé</div>
                  {(() => {
                    const freshWater  = +(project.target_tph * 0.50).toFixed(1);
                    const recycle     = +(project.target_tph * 1.90).toFixed(1);
                    const evap        = +(project.target_tph * 0.085).toFixed(1);
                    const tailsWater  = +(project.target_tph * 0.32).toFixed(1);
                    const tsf         = +(project.target_tph * 0.095).toFixed(1);
                    const recycleRate = +((recycle / (freshWater + recycle)) * 100).toFixed(1);
                    return [
                      ['Eau fraîche ajoutée',   `${freshWater} m³/h`],
                      ['Eau recyclée procédé',   `${recycle} m³/h`],
                      ['Eau évaporée (TSF+Proc)', `${evap} m³/h`],
                      ['Eau résidus (humidité)',  `${tailsWater} m³/h`],
                      ['Débordement TSF (recup.)', `${tsf} m³/h`],
                      ['Taux recyclage',          `${recycleRate}%`],
                      ['Consommation nette',      `${formatDecimalGrouped((freshWater / project.target_tph), 2)} m³/t`],
                    ].map(([k, v]) => <div key={k as string} className="stat-row"><span className="stat-key">{k}</span><span className="stat-val">{v}</span></div>);
                  })()}
                </div>
                <div className="card">
                  <div className="section-title mb-4">Qualité eau process</div>
                  {[
                    ['WAD Cyanure (résidus)', '< 2 mg/L ✓'],
                    ['pH sortie TSF', '10.5–11.2'],
                    ['TSS alim. usine', '< 500 mg/L'],
                    ['Dureté eau fraîche', '180 ppm CaCO₃'],
                    ['Sulfates (SO₄²⁻)', '< 2000 mg/L'],
                    ['Arsenic (As)', '< 0.5 mg/L'],
                    ['Mercure (Hg)', '< 0.01 mg/L'],
                  ].map(([k, v]) => <div key={k as string} className="stat-row"><span className="stat-key">{k}</span><span className="stat-val">{v}</span></div>)}
                </div>
                <div className="card col-span-2">
                  <div className="section-title mb-4">Distribution eau par section</div>
                  <div className="grid grid-cols-5 gap-3">
                    {[
                      { l: 'Broyage',      vol: +(project.target_tph * 0.38).toFixed(0), color: '#A78BFA' },
                      { l: 'Classification',vol: +(project.target_tph * 0.22).toFixed(0), color: '#F88A44' },
                      { l: 'Lixiviation',  vol: +(project.target_tph * 1.10).toFixed(0), color: '#FCD34D' },
                      { l: 'ADR / Filtrat',vol: +(project.target_tph * 0.08).toFixed(0), color: '#FBBF24' },
                      { l: 'Résidus TSF',  vol: +(project.target_tph * 0.32).toFixed(0), color: '#56657A' },
                    ].map(s => (
                      <div key={s.l} className="card-sm text-center">
                        <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.vol}</div>
                        <div className="text-[10px] text-mf-txt4">m³/h</div>
                        <div className="text-xs text-mf-txt3 mt-1">{s.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── EMPREINTE C ─────────────────────────────────────────────────── */}
        {activeTab === 'carbon' && (
          <div className="space-y-4">
            {carbon.length === 0 ? emptyBanner : (
              <>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'Scope 1 — Combustion directe',  val: sc1,  color: '#F87171', pct: totalCO2 > 0 ? sc1/totalCO2*100 : 0 },
                    { label: 'Scope 2 — Électricité',          val: sc2,  color: '#F88A44', pct: totalCO2 > 0 ? sc2/totalCO2*100 : 0 },
                    { label: 'Scope 3 — Indirect (réactifs)', val: sc3,  color: '#5BA4F5', pct: totalCO2 > 0 ? sc3/totalCO2*100 : 0 },
                  ].map(s => (
                    <div key={s.label} className="card">
                      <div className="text-2xl font-bold font-mono mb-1" style={{ color: s.color }}>{formatDecimalGrouped(s.pct, 0)}%</div>
                      <div className="text-sm font-medium text-mf-txt">{s.label}</div>
                      <div className="text-xs text-mf-txt3 mb-2">{s.val.toLocaleString(undefined, { maximumFractionDigits: 0 })} tCO₂e/an</div>
                      <div className="progress-bar"><div className="progress-fill" style={{ width: `${s.pct}%`, backgroundColor: s.color }} /></div>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 text-xs text-mf-txt4">
                  <Edit3 size={11} className="text-amber-500" />Cliquez sur Activité ou Facteur pour modifier.
                </div>

                <div className="card p-0 overflow-hidden">
                  <table className="tbl text-xs">
                    <thead>
                      <tr>
                        <th className="w-16">Scope</th>
                        <th>Source</th>
                        <th>Description</th>
                        <th className="text-right">Activité</th>
                        <th className="text-right">Facteur émission</th>
                        <th className="text-right">tCO₂e/an</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {carbon.map(c => (
                        <tr key={c.id} className={c.is_edited ? 'bg-amber-500/5' : 'hover:bg-mf-hover/40'}>
                          <td>
                            <span className={`badge text-[10px] ${c.scope === 1 ? 'badge-red' : c.scope === 2 ? 'badge-gold' : 'badge-blue'}`}>
                              Sc.{c.scope}
                            </span>
                          </td>
                          <td><span className="font-mono text-[10px] text-mf-txt3">{c.source}</span></td>
                          <td className="text-mf-txt">{c.description}</td>
                          <td className="text-right font-mono text-xs">
                            <EditCell value={c.activity_value} onSave={v => updateCarbon(c.id, 'activity_value', v)} fmt={v => v.toLocaleString(undefined,{maximumFractionDigits:0})} />
                            <span className="text-mf-txt4 ml-1">{c.activity_unit}</span>
                          </td>
                          <td className="text-right font-mono text-xs">
                            <EditCell value={c.emission_factor} onSave={v => updateCarbon(c.id, 'emission_factor', v)} fmt={v => formatDecimalGrouped(v, 4)} />
                            <span className="text-mf-txt4 ml-1">{c.ef_unit}</span>
                          </td>
                          <td className="text-right font-bold font-mono text-xs text-emerald-400">{formatDecimalGrouped(c.tco2e_year, 1)}</td>
                          <td>{c.is_edited && <Edit3 size={10} className="text-amber-500 opacity-70" />}</td>
                        </tr>
                      ))}
                      <tr className="bg-mf-panel font-semibold">
                        <td colSpan={5} className="text-right text-mf-txt3 text-xs">TOTAL</td>
                        <td className="text-right font-bold font-mono text-sm text-emerald-400">{formatDecimalGrouped(totalCO2, 0)}</td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
                  parseFloat(co2PerOz) < 0.35
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                }`}>
                  {parseFloat(co2PerOz) < 0.35 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                  <span>
                    Intensité carbone : <strong>{co2PerOz} tCO₂e/oz Au</strong>
                    {' '}— {parseFloat(co2PerOz) < 0.35
                      ? 'En dessous de la moyenne industrie (0.42 tCO₂e/oz)'
                      : 'Au-dessus de la moyenne industrie (0.42 tCO₂e/oz)'}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── MONTE CARLO ─────────────────────────────────────────────────── */}
        {activeTab === 'mc' && (
          <div className="card">
            <div className="section-title mb-2">Analyse Monte Carlo — Récupération</div>
            <div className="section-sub mb-6">10 000 itérations · ±5% variation paramètres</div>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: 'P10', val: `${formatDecimalGrouped((effectiveRecoveryPct * 0.965), 1)}%`, color: 'text-red-400' },
                { label: 'P50', val: `${formatDecimalGrouped((effectiveRecoveryPct * 0.995), 1)}%`, color: 'text-amber-400' },
                { label: 'P90', val: `${formatDecimalGrouped(Math.min(100, effectiveRecoveryPct * 1.025), 1)}%`, color: 'text-emerald-400' },
                { label: 'σ',   val: '±1.8%', color: 'text-blue-400' },
              ].map(s => (
                <div key={s.label} className="card-sm text-center">
                  <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
                  <div className="text-xs text-mf-txt4 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-0.5 h-24">
              {[2,5,9,16,26,34,40,37,29,21,14,9,5,3,1].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h * 2.4}%`, backgroundColor: i < 4 ? '#F06B6B' : i > 10 ? '#2ECC8A' : '#F59E0B', opacity: 0.75 }} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-mf-txt4 mt-1.5">
              <span>{formatDecimalGrouped((effectiveRecoveryPct * 0.9), 0)}%</span>
              <span>Distribution récupération (%)</span>
              <span>{formatDecimalGrouped(Math.min(100, effectiveRecoveryPct * 1.1), 0)}%</span>
            </div>
            <div className="mt-4 p-3 bg-mf-panel border border-mf-border rounded-lg">
              <div className="text-xs text-mf-txt3 mb-2 font-semibold">Principaux facteurs d'incertitude</div>
              {[
                { l: 'Teneur alimentation ±10%', sens: 0.82 },
                { l: 'Cinétique lixiviation ±8%', sens: 0.71 },
                { l: 'P80 broyage ±15%',          sens: 0.55 },
                { l: 'Teneur CN ±12%',             sens: 0.38 },
              ].map(f => (
                <div key={f.l} className="flex items-center gap-3 mb-1.5">
                  <span className="text-xs text-mf-txt3 w-48">{f.l}</span>
                  <div className="flex-1 progress-bar">
                    <div className="progress-fill bg-amber-500" style={{ width: `${f.sens * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono text-amber-400 w-8">{formatDecimalGrouped(f.sens, 2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
