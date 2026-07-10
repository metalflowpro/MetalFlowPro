import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Mountain, TrendingUp, Layers, Truck, Target,
  CheckCircle2, AlertTriangle, Save, RefreshCw,
  Plus, Trash2, Pickaxe, DollarSign, Activity, Gauge,
  ArrowUpRight, ArrowDownRight, Zap, Map as MapIcon, GitBranch, X,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';

/* ─── Types ──────────────────────────────────────────────────────────────── */

const TABS = [
  'Tableau de bord',
  'Plan LOM',
  'Plan d\'Exploitation',
  'Pit Shell & Géotechnique',
  'Séquençage & Flotte',
  'Optimisation Économique',
  'Risques & Sensibilité',
  'Rapport Exécutif',
] as const;
type Tab = typeof TABS[number];

interface MineParamsRow {
  id: string; project_id: string;
  method: string;
  stripping_ratio: number; slope_angle_deg: number; bench_height_m: number;
  trucks: string; shovel: string; drill: string;
  lom_years: number | null;
  reserves_mt: number; grade_g_t: number; cutoff_g_t: number;
  mining_cost_t: number; process_cost_t: number; ga_cost_m: number;
  sustaining_capex_m: number; discount_rate_pct: number;
  royalty_pct: number; nsr_pct: number;
  pump_cost_m: number; blasting_cost_t: number;
  ore_recovery_pct: number; dilution_pct: number;
  gold_price_sens: number;
  ramp_up_y1_pct: number;
  ramp_up_y2_pct: number;
  grade_decay_pct_yr: number;
  capex_unit_cost_usd_t: number;
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
  lom_years: number; npv_musd: number; irr_pct: number;
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

const TROY = 1 / 31.1035;
const PHASE_COLORS = ['#10B981', '#F59E0B', '#3B82F6', '#F06B6B', '#8B5CF6', '#06B6D4'];
const PIT_PRICES = [1400, 1600, 1800, 2000, 2200, 2400, 2600, 2800, 3000, 3200];

const DEFAULT_PARAMS: Omit<MineParamsRow, 'id' | 'project_id'> = {
  method: 'Open pit',
  stripping_ratio: 4.0, slope_angle_deg: 45, bench_height_m: 10,
  trucks: '3 × CAT 793D (220t)', shovel: '1 × Komatsu PC5500', drill: '2 × Sandvik DX800i',
  lom_years: null,
  reserves_mt: 20.0, grade_g_t: 2.5, cutoff_g_t: 0.40,
  mining_cost_t: 2.8, process_cost_t: 28.0, ga_cost_m: 8.0,
  sustaining_capex_m: 6.0, discount_rate_pct: 10.0,
  royalty_pct: 3.0, nsr_pct: 1.5,
  pump_cost_m: 1.5, blasting_cost_t: 0.9, ore_recovery_pct: 95.0,
  dilution_pct: 5.0, gold_price_sens: 2000,
  ramp_up_y1_pct: 80.0,
  ramp_up_y2_pct: 92.0,
  grade_decay_pct_yr: 1.6,
  capex_unit_cost_usd_t: 42000.0,
};

/* ─── LOM schedule builder ───────────────────────────────────────────────── */
function buildLOM(project: Project & { lom_years?: number }, p: MineParamsRow, phases: MinePhaseRow[]) {
  const annualOreMt = (project.target_tph * (project.availability_pct / 100) * 8760) / 1e6;
  const lom = p.lom_years ?? project.lom_years ?? Math.max(1, Math.ceil(p.reserves_mt / Math.max(0.01, annualOreMt)));

  const rampY1 = (p.ramp_up_y1_pct ?? 80) / 100;
  const rampY2 = (p.ramp_up_y2_pct ?? 92) / 100;
  const decayRate = (p.grade_decay_pct_yr ?? 1.6) / 100;
  const capexUnitCost = p.capex_unit_cost_usd_t ?? 42000;

  return Array.from({ length: Math.max(1, lom) }, (_, i) => {
    const rampUp = i === 0 ? rampY1 : i === 1 ? rampY2 : 1.0;
    const gradeDecay = Math.max(0.82, 1 - i * decayRate);
    const grade = p.grade_g_t * gradeDecay;
    const ore = annualOreMt * rampUp * ((100 + p.dilution_pct) / 100) * (p.ore_recovery_pct / 100);
    const waste = ore * p.stripping_ratio * Math.max(0.55, 1 - i * 0.022);
    const total = ore + waste;

    const grossOz = ore * 1e6 * grade * TROY;
    const royaltyFactor = 1 - (p.royalty_pct + p.nsr_pct) / 100;
    const netOz = grossOz * royaltyFactor;
    const revM = (netOz * project.gold_price_usd) / 1e6;

    const miningM = (p.mining_cost_t * total * 1e6) / 1e6;
    const processM = (p.process_cost_t * ore * 1e6) / 1e6;
    const blastM = (p.blasting_cost_t * total * 1e6) / 1e6;
    const pumpM = p.pump_cost_m * (i < 3 ? 1.4 : 1.0);
    const gaM = p.ga_cost_m;
    const costM = miningM + processM + blastM + pumpM + gaM;
    const ebitdaM = revM - costM;
    const capexYear = i === 0 ? project.target_tph * 24 * capexUnitCost / 1e6 : p.sustaining_capex_m;
    const fcfM = ebitdaM - capexYear;
    const aisc = netOz > 0 ? ((costM + capexYear / lom) * 1e6) / netOz : 0;

    return {
      year: i + 1, grade, ore, waste, total,
      oz_k: +(grossOz / 1000).toFixed(1),
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
function buildScenarios(project: Project & { lom_years?: number }, p: MineParamsRow): ScenarioRow[] {
  const annualOreMt = (project.target_tph * (project.availability_pct / 100) * 8760) / 1e6;
  const lom_years = p.lom_years ?? project.lom_years ?? Math.max(1, Math.ceil(p.reserves_mt / Math.max(0.01, annualOreMt)));
  const annualOz = annualOreMt * 1e6 * p.grade_g_t * TROY * ((100 - p.royalty_pct - p.nsr_pct) / 100);
  const annualRevM = (annualOz * project.gold_price_usd) / 1e6;
  const annualCostM = (p.process_cost_t * annualOreMt * 1e6 + p.mining_cost_t * annualOreMt * (1 + p.stripping_ratio) * 1e6) / 1e6 + p.ga_cost_m;
  const ebitdaM = annualRevM - annualCostM;
  const capexUnitCost = p.capex_unit_cost_usd_t ?? 42000;
  const capexM = project.target_tph * 24 * capexUnitCost / 1e6;
  const dr = p.discount_rate_pct / 100;
  const annuity = (1 - Math.pow(1 + dr, -lom_years)) / dr;
  const npvBase = ebitdaM * annuity - capexM;
  const aisc = annualOz > 0 ? ((annualCostM * 1e6) + capexM * 1e6 / lom_years) / annualOz : 1200;

  function irr(npv: number, cap: number, eb: number, ly: number): number {
    return Math.max(5, Math.min(80, (eb / cap) * 100 * 0.85));
  }
  function payback(cap: number, eb: number): number {
    return Math.max(0.5, cap / Math.max(0.01, eb));
  }

  return [
    {
      id: 'base', name: 'Base Case', color: '#F59E0B',
      description: `Pit $${project.gold_price_usd}/oz · RS ${p.stripping_ratio}:1 · Talus ${p.slope_angle_deg}°`,
      reserves_mt: p.reserves_mt, stripping_ratio: p.stripping_ratio,
      slope_angle_deg: p.slope_angle_deg, lom_years, annual_oz: annualOz,
      npv_musd: npvBase, irr_pct: irr(npvBase, capexM, ebitdaM, lom_years),
      payback_years: payback(capexM, ebitdaM), aisc, capex_m: capexM, recommended: true,
    },
    {
      id: 'expanded', name: 'Pit élargi', color: '#10B981',
      description: `Angle –5° · Réserves +20% · LOM +3 ans`,
      reserves_mt: p.reserves_mt * 1.20, stripping_ratio: p.stripping_ratio * 1.22,
      slope_angle_deg: p.slope_angle_deg - 5, lom_years: lom_years + 3, annual_oz: annualOz * 1.05,
      npv_musd: npvBase * 1.15, irr_pct: irr(npvBase * 1.15, capexM * 1.10, ebitdaM * 1.10, lom_years + 3),
      payback_years: payback(capexM * 1.10, ebitdaM * 1.10), aisc: aisc * 1.07, capex_m: capexM * 1.10, recommended: false,
    },
    {
      id: 'conservative', name: 'Pit conservateur', color: '#3B82F6',
      description: `Angle +5° · Réserves –18% · CAPEX –10%`,
      reserves_mt: p.reserves_mt * 0.82, stripping_ratio: p.stripping_ratio * 0.80,
      slope_angle_deg: p.slope_angle_deg + 5, lom_years: Math.max(3, lom_years - 2), annual_oz: annualOz * 0.90,
      npv_musd: npvBase * 0.84, irr_pct: irr(npvBase * 0.84, capexM * 0.90, ebitdaM * 0.90, lom_years - 2),
      payback_years: payback(capexM * 0.90, ebitdaM * 0.92), aisc: aisc * 0.95, capex_m: capexM * 0.90, recommended: false,
    },
    {
      id: 'highgrade', name: 'Haute teneur sélectif', color: '#8B5CF6',
      description: `Séquence HG prioritaire — TRI optimisé court terme`,
      reserves_mt: p.reserves_mt * 0.62, stripping_ratio: p.stripping_ratio * 0.88,
      slope_angle_deg: p.slope_angle_deg, lom_years: Math.ceil(lom_years * 0.68), annual_oz: annualOz * 1.18,
      npv_musd: npvBase * 1.28, irr_pct: irr(npvBase * 1.28, capexM * 0.85, ebitdaM * 1.25, Math.ceil(lom_years * 0.68)),
      payback_years: payback(capexM * 0.85, ebitdaM * 1.25), aisc: aisc * 0.87, capex_m: capexM * 0.85, recommended: false,
    },
    {
      id: 'underground', name: 'UG + Open pit hybride', color: '#F06B6B',
      description: `Extension UG sous le fond de fosse — longhole stoping`,
      reserves_mt: p.reserves_mt * 1.35, stripping_ratio: p.stripping_ratio * 0.7,
      slope_angle_deg: p.slope_angle_deg, lom_years: lom_years + 5, annual_oz: annualOz * 1.08,
      npv_musd: npvBase * 1.08, irr_pct: irr(npvBase * 1.08, capexM * 1.30, ebitdaM * 1.05, lom_years + 5),
      payback_years: payback(capexM * 1.30, ebitdaM * 1.05), aisc: aisc * 1.12, capex_m: capexM * 1.30, recommended: false,
    },
  ];
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
  const [activeTab, setActiveTab] = useState<Tab>('Tableau de bord');
  const [params, setParams] = useState<MineParamsRow | null>(null);
  const [phases, setPhases] = useState<MinePhaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [designTab, setDesignTab] = useState<'pits' | 'benches' | 'equipment' | 'plan'>('pits');
  const [designSaving, setDesignSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [pRes, phRes, pitsRes, benchRes, equipRes] = await Promise.all([
      supabase.from('mine_params').select('*').eq('project_id', project.id).maybeSingle(),
      supabase.from('mine_phases').select('*').eq('project_id', project.id).order('year_start'),
      supabase.from('mine_design_pits').select('*').eq('project_id', project.id).order('sequence_order'),
      supabase.from('mine_design_benches').select('*').eq('project_id', project.id).order('bench_rl', { ascending: false }),
      supabase.from('mine_design_equipment_schedule').select('*').eq('project_id', project.id).order('year'),
    ]);
    setParams(pRes.data as MineParamsRow | null);
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

  async function initParams() {
    setSaving(true);
    const { data } = await supabase.from('mine_params').insert({ ...DEFAULT_PARAMS, project_id: project.id }).select('*').maybeSingle();
    if (data) setParams(data as MineParamsRow);
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
  const lom = useMemo(() => p ? buildLOM(project, p, phases) : [], [project, p, phases]);
  const scenarios = useMemo(() => p ? buildScenarios(project, p) : [], [project, p]);
  const chosen = scenarios.find(s => s.id === selectedScenario) ?? scenarios[0];
  const lom_years = p?.lom_years ?? project.lom_years ?? (p ? Math.max(1, Math.ceil(p.reserves_mt / Math.max(0.01, (project.target_tph * project.availability_pct / 100 * 8760) / 1e6))) : 10);

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
      const scenarios_local = buildScenarios(project, {
        ...p,
        ...(sensitivityParam === 'gold_price' ? { gold_price_sens: project.gold_price_usd * factor } : {}),
        ...(sensitivityParam === 'stripping' ? { stripping_ratio: p.stripping_ratio * factor } : {}),
        ...(sensitivityParam === 'grade' ? { grade_g_t: p.grade_g_t * factor } : {}),
        ...(sensitivityParam === 'opex' ? { process_cost_t: p.process_cost_t * factor, mining_cost_t: p.mining_cost_t * factor } : {}),
        ...(sensitivityParam === 'recovery' ? { ore_recovery_pct: Math.min(100, p.ore_recovery_pct * factor) } : {}),
      });
      const base = scenarios_local.find(s => s.id === 'base');
      return { pct, npv: base?.npv_musd ?? 0, irr: base?.irr_pct ?? 0, aisc: base?.aisc ?? 0 };
    });
  }, [p, project, sensitivityParam]);

  /* Pit shell sensitivity */
  const pitSensRows = useMemo(() => {
    if (!p) return [];
    return PIT_PRICES.map(price => {
      const factor = price / project.gold_price_usd;
      const reserves = p.reserves_mt * Math.pow(factor, 0.72);
      return { price, reserves };
    });
  }, [p, project.gold_price_usd]);

  const maxPitRes = pitSensRows.length ? Math.max(...pitSensRows.map(r => r.reserves)) : 1;
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
            <button onClick={load} className="btn btn-secondary p-1.5"><RefreshCw size={13} /></button>
            <button onClick={saveParams} disabled={saving} className="btn btn-secondary flex items-center gap-1.5 text-xs">
              <Save size={12} /> {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="px-4 py-3 border-b border-mf-border grid grid-cols-6 gap-3">
        {[
          { label: 'Réserves',       val: `${params.reserves_mt} Mt`,          sub: `@ ${params.grade_g_t} g/t Au`,          color: 'text-amber-400',   icon: Mountain },
          { label: 'Production tot.', val: `${totalOz.toFixed(0)} koz`,          sub: `LOM ${lom_years} ans`,                  color: 'text-emerald-400', icon: Target },
          { label: 'VAN₁₀',          val: chosen ? `${chosen.npv_musd.toFixed(0)} M$` : '—', sub: `TRI ~${chosen?.irr_pct.toFixed(1)}%`, color: (chosen?.npv_musd ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400', icon: TrendingUp },
          { label: 'FCF total',      val: `${totalFcf.toFixed(0)} M$`,           sub: `Rev. ${totalRev.toFixed(0)} M$`,         color: totalFcf >= 0 ? 'text-emerald-400' : 'text-red-400', icon: DollarSign },
          { label: 'AISC moyen',     val: `$${avgAisc.toFixed(0)}/oz`,           sub: `RS = ${params.stripping_ratio}:1`,       color: 'text-sky-400',     icon: Gauge },
          { label: 'CoG actuel',     val: `${params.cutoff_g_t} g/t`,            sub: params.method,                           color: 'text-purple-400',  icon: Layers },
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
        {activeTab === 'Tableau de bord' && (
          <div className="space-y-5">
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
                  { label: 'Production pic', val: `${peakOz.toFixed(1)} koz/an`, trend: '+', color: 'text-amber-400' },
                  { label: 'AISC moyen LOM', val: `$${avgAisc.toFixed(0)}/oz`, trend: avgAisc < project.gold_price_usd * 0.6 ? '+' : '-', color: avgAisc < project.gold_price_usd * 0.6 ? 'text-emerald-400' : 'text-amber-400' },
                  { label: 'Marge EBITDA', val: `${totalRev > 0 ? ((lom.reduce((s, y) => s + y.ebitda_m, 0) / totalRev) * 100).toFixed(0) : '—'}%`, trend: '+', color: 'text-sky-400' },
                  { label: 'FCF cumulé', val: `${totalFcf.toFixed(0)} M$`, trend: totalFcf > 0 ? '+' : '-', color: totalFcf > 0 ? 'text-emerald-400' : 'text-red-400' },
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
                        <td className="px-3 py-1.5 text-amber-300 font-mono">{sc.reserves_mt.toFixed(1)} Mt</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{sc.lom_years} ans</td>
                        <td className="px-3 py-1.5 font-semibold font-mono" style={{ color: sc.npv_musd >= 0 ? '#10B981' : '#F06B6B' }}>{sc.npv_musd.toFixed(0)} M$</td>
                        <td className="px-3 py-1.5 text-sky-400">{sc.irr_pct.toFixed(1)}%</td>
                        <td className="px-3 py-1.5 text-purple-400">${sc.aisc.toFixed(0)}</td>
                        <td className="px-3 py-1.5 text-mf-txt3">{sc.payback_years.toFixed(1)} ans</td>
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
        {activeTab === 'Plan LOM' && (
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
                      <td className="px-2 py-1.5 text-right">{y.ore.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{y.waste.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-mf-txt3">{y.rs}</td>
                      <td className="px-2 py-1.5 text-right text-amber-400 font-semibold">{y.grade.toFixed(3)}</td>
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
                    <td className="px-2 py-2 text-right">{lom.reduce((s, y) => s + y.ore, 0).toFixed(2)}</td>
                    <td className="px-2 py-2 text-right">{lom.reduce((s, y) => s + y.waste, 0).toFixed(2)}</td>
                    <td colSpan={2} className="px-2 py-2 text-right text-mf-txt4">—</td>
                    <td className="px-2 py-2 text-right">{lom.reduce((s, y) => s + y.oz_k, 0).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{lom.reduce((s, y) => s + y.net_oz_k, 0).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right">{totalRev.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-orange-400">{lom.reduce((s, y) => s + y.cost_m, 0).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{lom.reduce((s, y) => s + y.ebitda_m, 0).toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-emerald-400">{totalFcf.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-mf-txt4">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ PLAN D'EXPLOITATION ═══ */}
        {activeTab === "Plan d'Exploitation" && (
          <div className="space-y-4">
            {/* Sub-tab bar */}
            <div className="flex items-center justify-between">
              <div className="flex rounded-lg overflow-hidden border border-mf-border">
                {(['pits', 'benches', 'equipment', 'plan'] as const).map(t => (
                  <button key={t} onClick={() => setDesignTab(t)}
                    className={`px-4 py-2 text-xs font-semibold transition-colors ${designTab === t ? 'bg-amber-400/20 text-amber-300' : 'mf-txt3 hover:mf-txt'}`}>
                    {t === 'pits' ? 'Phases Pit' : t === 'benches' ? 'Bancs & Géologie' : t === 'equipment' ? 'Flotte & Équipements' : 'Vue d\'ensemble'}
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
                      { label: 'Minerai total',    val: `${designPits.reduce((s,p)=>s+p.ore_mt,0).toFixed(1)} Mt`,                               color: 'text-emerald-400' },
                      { label: 'Stérile total',    val: `${designPits.reduce((s,p)=>s+p.waste_mt,0).toFixed(1)} Mt`,                             color: 'text-sky-400' },
                      { label: 'RS global',        val: designPits.reduce((s,p)=>s+p.ore_mt,0)>0 ? `${(designPits.reduce((s,p)=>s+p.waste_mt,0)/designPits.reduce((s,p)=>s+p.ore_mt,0)).toFixed(1)}:1` : '—', color: 'text-orange-400' },
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
                                  { label: 'Profondeur', val: depth != null ? `${depth.toFixed(0)} m` : '—', sub: `${pit.crest_rl ?? '?'} → ${pit.floor_rl ?? '?'} mRL` },
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
                          { label: 'Coût flotte/an', val: `${filtered.reduce((s,e)=>s+totalAnnualCost(e),0).toFixed(1)} M$`, color: 'text-emerald-400' },
                        ].map(k => <div key={k.label} className="card-sm py-2"><div className="text-[10px] mf-txt4">{k.label}</div><div className={`text-lg font-bold font-mono ${k.color}`}>{k.val}</div></div>)}
                      </div>
                      {[...yearMap.entries()].sort((a,b)=>a[0]-b[0]).map(([year, items]) => (
                        <div key={year} className="card-sm">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-lg bg-amber-400/15 flex items-center justify-center">
                              <span className="text-[10px] font-bold text-amber-400">{year}</span>
                            </div>
                            <div className="text-xs font-semibold mf-txt">Année {year}</div>
                            <div className="text-[10px] mf-txt4">{items.reduce((s,e)=>s+e.quantity,0)} unités · {items.reduce((s,e)=>s+totalAnnualCost(e),0).toFixed(2)} M$</div>
                          </div>
                          <div className="space-y-1">
                            {items.map(e => (
                              <div key={e.id} className="flex items-center gap-3 py-1.5 px-2 rounded bg-white/3 text-xs">
                                <Truck size={11} className="text-amber-400 shrink-0" />
                                <span className="font-semibold mf-txt w-32 shrink-0 truncate">{e.equipment_name}</span>
                                <span className="mf-txt4 text-[10px] w-20 shrink-0">{e.equipment_type}</span>
                                <span className="font-mono mf-txt3">{e.quantity}× · {e.hours_year}h/an</span>
                                <span className="font-mono text-emerald-300 ml-auto">{totalAnnualCost(e).toFixed(2)} M$/an</span>
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
                  const annualMine = params ? (project.target_tph * (project.availability_pct/100) * 8760) / 1e6 : null;

                  return (
                    <div className="space-y-4">
                      {/* Summary bar */}
                      <div className="grid grid-cols-5 gap-3">
                        {[
                          { label: 'Phases pit',     val: designPits.length.toString(),               color: 'text-amber-400' },
                          { label: 'Minerai total',  val: `${totalOre.toFixed(1)} Mt`,                color: 'text-emerald-400' },
                          { label: 'Stérile total',  val: `${totalWaste.toFixed(1)} Mt`,              color: 'text-sky-400' },
                          { label: 'RS global',      val: totalOre>0 ? `${(totalWaste/totalOre).toFixed(1)}:1` : '—', color: 'text-orange-400' },
                          { label: 'Extraction/an',  val: annualMine!=null ? `${annualMine.toFixed(2)} Mt/an` : '—', color: 'text-purple-400' },
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
        {activeTab === 'Pit Shell & Géotechnique' && (
          <div className="grid grid-cols-3 gap-4">
            {/* LG params */}
            <div className="card-sm space-y-0">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Paramètres Lerchs-Grossmann</div>
              {[
                ['Prix Au pit shell', `$${project.gold_price_usd}/oz`],
                ['Coût extraction minerai', `$${params.mining_cost_t}/t`],
                ['Coût stérile', `$${(params.mining_cost_t * 0.82).toFixed(2)}/t`],
                ['Coût traitement', `$${params.process_cost_t}/t`],
                ['Sautage', `$${params.blasting_cost_t}/t`],
                ['Redevances totales', `${(params.royalty_pct + params.nsr_pct).toFixed(2)}%`],
                ['Récupération Au', `${project.recovery_pct}%`],
                ['CoG calculé', `${params.cutoff_g_t} g/t Au`],
                ['Angle talus IFS', `${params.slope_angle_deg}° (IFS 1.35)`],
                ['Réserves design', `${params.reserves_mt} Mt @ ${params.grade_g_t} g/t`],
                ['Stériles totaux', `${(params.reserves_mt * params.stripping_ratio).toFixed(1)} Mt`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5 border-b border-white/5 last:border-0 text-xs">
                  <span className="text-mf-txt3">{k}</span>
                  <span className="text-mf-txt font-semibold">{v}</span>
                </div>
              ))}
            </div>

            {/* Pit shell sensitivity chart */}
            <div className="col-span-2 card-sm space-y-4">
              <div>
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-1">Sensibilité réserves au prix de l'or (pit shell)</div>
                <div className="text-[10px] text-mf-txt4 mb-4">Réserves estimées (Mt) selon le prix de pit shell retenu</div>
                <div className="flex items-end gap-1.5 h-36 mb-2">
                  {pitSensRows.map(row => {
                    const isBase = Math.abs(row.price - project.gold_price_usd) < 150;
                    return (
                      <div key={row.price} className="flex-1 flex flex-col items-center gap-1">
                        <div className="text-[9px] font-mono text-mf-txt4">{row.reserves.toFixed(1)}</div>
                        <div
                          className={`w-full rounded-t-sm transition-colors ${isBase ? 'bg-amber-500' : 'bg-amber-500/25 hover:bg-amber-500/40'}`}
                          style={{ height: `${(row.reserves / maxPitRes) * 112}px` }}
                        />
                        <div className={`text-[9px] font-mono rotate-45 origin-center ${isBase ? 'text-amber-400 font-bold' : 'text-mf-txt4'}`}>{row.price}</div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[10px] text-mf-txt4 text-center mt-3">Prix pit shell (USD/oz)</div>
              </div>

              <div className="pt-4 border-t border-white/5">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Paramètres géotechniques & hydrogéologiques</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Angle inter-rampe', val: `${params.slope_angle_deg}°`, sub: 'Moyenne globale' },
                    { label: 'Hauteur de banc', val: `${params.bench_height_m} m`, sub: 'Standard opérationnel' },
                    { label: 'Largeur rampe', val: '22 m', sub: 'Double sens 220t' },
                    { label: 'IFS statique global', val: '1.35', sub: 'Minimum requis' },
                    { label: 'IFS dynamique', val: '1.10', sub: 'Condition sismique' },
                    { label: 'Nappe phréatique', val: '–55 m', sub: 'Pompage phase 1' },
                    { label: 'Débit pompage', val: '420 m³/h', sub: 'Estimation phase 1' },
                    { label: 'Fond de fosse ultime', val: '–340 m', sub: 'Niveau final' },
                    { label: 'Sismicité', val: 'PGA 0.12g', sub: 'Zone modérée' },
                  ].map(s => (
                    <div key={s.label} className="p-2.5 rounded-lg bg-white/4 border border-white/8">
                      <div className="text-[10px] text-mf-txt4 mb-0.5">{s.label}</div>
                      <div className="text-sm font-bold font-mono text-mf-txt">{s.val}</div>
                      <div className="text-[10px] text-mf-txt4">{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ SÉQUENÇAGE & FLOTTE ═══ */}
        {activeTab === 'Séquençage & Flotte' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Phases d'exploitation minière</div>
              <button
                onClick={() => { setPhaseForm({}); setShowPhaseForm(true); }}
                className="btn btn-secondary flex items-center gap-1.5 text-xs"
              >
                <Plus size={12} /> Ajouter phase
              </button>
            </div>

            {phases.length === 0 ? (
              <div className="text-center text-mf-txt4 py-16 text-xs">
                Aucune phase définie. Cliquez "Ajouter phase" pour créer le séquençage.
              </div>
            ) : (
              <>
                {/* Gantt */}
                <div className="card-sm overflow-x-auto">
                  <div className="text-xs font-semibold text-mf-txt3 mb-4 uppercase tracking-wider">Chronogramme des phases</div>
                  <div className="min-w-[600px]">
                    {(() => {
                      const maxYear = Math.max(...phases.map(p => p.year_end), lom_years);
                      const years = Array.from({ length: maxYear }, (_, i) => i + 1);
                      return (
                        <>
                          <div className="flex mb-1">
                            <div className="w-28 shrink-0" />
                            <div className="flex-1 flex">
                              {years.map(y => (
                                <div key={y} className="flex-1 text-center text-[9px] text-mf-txt4">{y}</div>
                              ))}
                            </div>
                          </div>
                          {phases.map(phase => (
                            <div key={phase.id} className="flex items-center gap-2 mb-2">
                              <div className="w-28 text-xs text-mf-txt truncate shrink-0">{phase.phase_name}</div>
                              <div className="flex-1 relative h-7 bg-white/4 rounded">
                                <div
                                  className="absolute top-0.5 h-6 rounded flex items-center px-2 text-[9px] font-semibold text-white truncate"
                                  style={{
                                    left: `${((phase.year_start - 1) / maxYear) * 100}%`,
                                    width: `${((phase.year_end - phase.year_start + 1) / maxYear) * 100}%`,
                                    backgroundColor: (phase.color ?? '#F59E0B') + 'BB',
                                    borderLeft: `2px solid ${phase.color ?? '#F59E0B'}`,
                                  }}
                                >
                                  Ans {phase.year_start}–{phase.year_end}
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      );
                    })()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {phases.map(phase => (
                    <div key={phase.id} className="card-sm">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: phase.color ?? '#F59E0B' }} />
                          <span className="font-semibold text-sm text-mf-txt">{phase.phase_name}</span>
                          {phase.zone && <span className="text-xs text-mf-txt4">— {phase.zone}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-mf-txt4 font-mono">Ans {phase.year_start}–{phase.year_end}</span>
                          <button onClick={() => deletePhase(phase.id)} className="text-red-400/30 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 gap-2 text-xs">
                        {[
                          { label: 'Type', val: phase.ore_type || '—' },
                          { label: 'Teneur g/t', val: phase.grade_g_t.toFixed(2), color: 'text-amber-400' },
                          { label: 'Minerai Mt', val: phase.ore_mt.toFixed(2) },
                          { label: 'Stérile Mt', val: phase.waste_mt.toFixed(2), color: 'text-mf-txt3' },
                          { label: 'RS phase', val: phase.ore_mt > 0 ? (phase.waste_mt / phase.ore_mt).toFixed(1) : '—', color: 'text-mf-txt3' },
                        ].map(f => (
                          <div key={f.label}>
                            <div className="text-mf-txt4 mb-0.5">{f.label}</div>
                            <div className={`font-semibold ${f.color ?? 'text-mf-txt'}`}>{f.val}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {showPhaseForm && (
              <div className="card-sm border border-amber-400/20 space-y-3">
                <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">Nouvelle phase</div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Nom *', key: 'phase_name', type: 'text', placeholder: 'Phase 1' },
                    { label: 'Zone / Secteur', key: 'zone', type: 'text', placeholder: 'Zone Nord' },
                    { label: 'Type minerai', key: 'ore_type', type: 'text', placeholder: 'Oxyde, Sulfure…' },
                    { label: 'An début', key: 'year_start', type: 'number', placeholder: '1' },
                    { label: 'An fin', key: 'year_end', type: 'number', placeholder: '3' },
                    { label: 'Teneur (g/t)', key: 'grade_g_t', type: 'number', placeholder: '2.5' },
                    { label: 'Minerai (Mt)', key: 'ore_mt', type: 'number', placeholder: '5.0' },
                    { label: 'Stérile (Mt)', key: 'waste_mt', type: 'number', placeholder: '20.0' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="label">{f.label}</label>
                      <input
                        type={f.type} placeholder={f.placeholder}
                        className="input-field w-full text-xs"
                        value={String((phaseForm as Record<string, unknown>)[f.key] ?? '')}
                        onChange={e => setPhaseForm(prev => ({
                          ...prev,
                          [f.key]: f.type === 'number' ? parseFloat(e.target.value) : e.target.value,
                        }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowPhaseForm(false)} className="btn btn-secondary text-xs">Annuler</button>
                  <button onClick={addPhase} disabled={!phaseForm.phase_name} className="btn btn-teal text-xs flex items-center gap-1.5">
                    <Plus size={11} /> Ajouter
                  </button>
                </div>
              </div>
            )}

            {/* Fleet section */}
            <div className="card-sm">
              <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider mb-3">Flotte minière configurée</div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Camions', icon: Truck, val: params.trucks, color: 'text-sky-400' },
                  { label: 'Pelle / Chargeuse', icon: Mountain, val: params.shovel, color: 'text-emerald-400' },
                  { label: 'Foreuse', icon: Zap, val: params.drill, color: 'text-amber-400' },
                ].map(f => (
                  <div key={f.label} className="p-3 rounded-lg bg-white/4 border border-white/8">
                    <div className="flex items-center gap-2 mb-1.5">
                      <f.icon size={13} className={f.color} />
                      <div className="text-[10px] text-mf-txt4">{f.label}</div>
                    </div>
                    <div className="text-sm font-semibold text-mf-txt">{f.val}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                {[
                  { label: 'Disponibilité mécanique', val: `${project.availability_pct}%` },
                  { label: 'Débit traitement', val: `${project.target_tph} t/h` },
                  { label: 'Débit total mine', val: `${(project.target_tph * project.availability_pct / 100 * 24 * (1 + params.stripping_ratio)).toFixed(0)} t/j` },
                  { label: 'Heures opération/an', val: `${(project.availability_pct / 100 * 8760).toFixed(0)} h` },
                ].map(s => (
                  <div key={s.label} className="p-2.5 rounded-lg bg-white/4 border border-white/8">
                    <div className="text-[10px] text-mf-txt4 mb-0.5">{s.label}</div>
                    <div className="text-sm font-bold font-mono text-mf-txt">{s.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ═══ OPTIMISATION ÉCONOMIQUE ═══ */}
        {activeTab === 'Optimisation Économique' && (
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
                      { label: 'VAN₁₀', val: `${sc.npv_musd.toFixed(0)} M$`, color: sc.npv_musd >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'TRI', val: `${sc.irr_pct.toFixed(1)}%`, color: 'text-sky-400' },
                      { label: 'Retour', val: `${sc.payback_years.toFixed(1)} ans`, color: 'text-amber-400' },
                      { label: 'AISC', val: `$${sc.aisc.toFixed(0)}/oz`, color: 'text-purple-400' },
                    ].map(kpi => (
                      <div key={kpi.label} className="bg-white/5 rounded-lg p-2 text-center">
                        <div className={`text-sm font-bold font-mono ${kpi.color}`}>{kpi.val}</div>
                        <div className="text-[10px] text-mf-txt4">{kpi.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 flex gap-4 text-xs text-mf-txt4 flex-wrap">
                    <span>RS: {sc.stripping_ratio.toFixed(1)}:1</span>
                    <span>Talus: {sc.slope_angle_deg}°</span>
                    <span>LOM: {sc.lom_years} ans</span>
                    <span>Réserves: {sc.reserves_mt.toFixed(1)} Mt</span>
                    <span>CAPEX: {sc.capex_m.toFixed(0)} M$</span>
                    <span>Oz/an: {(sc.annual_oz / 1000).toFixed(0)} koz</span>
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
                const grossRevM = (annualOz * project.gold_price_usd / 1e6) * chosen.lom_years;
                const royaltiesM = grossRevM * (params.royalty_pct + params.nsr_pct) / 100;
                const opexM = (params.process_cost_t * params.reserves_mt * 1e6 / 1e6);
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
                          {b.positive ? '+' : ''}{b.val.toFixed(0)} M$
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
        {activeTab === 'Risques & Sensibilité' && (
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
                      <text x={x + bw / 2} y={r.npv >= 0 ? mid - h - 4 : mid + h + 12} fill="#9CA3AF" fontSize={8} textAnchor="middle">{r.npv.toFixed(0)}</text>
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
        {activeTab === 'Rapport Exécutif' && chosen && (
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
                        avec un talus de {params.slope_angle_deg}° (IFS 1.35) offre {params.reserves_mt} Mt à {params.grade_g_t} g/t Au.
                        La production annuelle de ~{(chosen.annual_oz / 1000).toFixed(0)} koz sur {chosen.lom_years} ans génère une
                        VAN₁₀ de {chosen.npv_musd.toFixed(0)} M$ avec un TRI de {chosen.irr_pct.toFixed(1)}%.
                        L'AISC de ${chosen.aisc.toFixed(0)}/oz offre une marge opérationnelle robuste face aux cycles du prix de l'or.
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
                  ['Réserves',         `${params.reserves_mt} Mt @ ${params.grade_g_t} g/t`],
                  ['Dilution minière', `${params.dilution_pct}%`],
                  ['Prod. annuelle',   `${(chosen.annual_oz / 1000).toFixed(0)} koz Au`],
                  ['Prod. totale LOM', `${totalOz.toFixed(0)} koz Au`],
                  ['VAN₁₀',           `${chosen.npv_musd.toFixed(0)} M USD`],
                  ['TRI',             `${chosen.irr_pct.toFixed(1)}%`],
                  ['Retour invest.',  `${chosen.payback_years.toFixed(1)} ans`],
                  ['AISC',            `$${chosen.aisc.toFixed(0)}/oz`],
                  ['LOM',             `${chosen.lom_years} ans`],
                  ['CAPEX initial',   `${chosen.capex_m.toFixed(0)} M$`],
                  ['CAPEX soutien',   `${params.sustaining_capex_m} M$/an`],
                  ['Rev. totaux LOM', `${totalRev.toFixed(0)} M$`],
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
                  { label: 'AISC vs pair', val: chosen.aisc < 1200 ? 'Inférieur au pair ✓' : 'Supérieur au pair', ok: chosen.aisc < 1200 },
                  { label: 'TRI vs hurdle', val: chosen.irr_pct > 15 ? 'Supérieur au hurdle ✓' : 'Inférieur au hurdle', ok: chosen.irr_pct > 15 },
                  { label: 'RS vs médiane', val: params.stripping_ratio < 6 ? 'Favorable ✓' : 'Élevé', ok: params.stripping_ratio < 6 },
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
    </div>
  );
}
