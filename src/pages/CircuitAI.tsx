import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cpu, RefreshCw, CheckCircle2, AlertTriangle, TrendingUp, Leaf, DollarSign, BarChart3, Star, Clock,
  Database, Target, Activity, GitBranch, Triangle,
  ChevronRight, ChevronDown, BookOpen, Award, Sparkles, Settings2, Save,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LimsSnapshot {
  n_leach: number; n_grg: number; n_bwi: number; n_head: number; n_flotation: number;
  avg_leach_24h: number | null; avg_leach_48h: number | null;
  avg_grg: number | null; avg_bwi: number | null;
  avg_corg: number | null; avg_sulf: number | null;
  avg_au: number | null; avg_au_free: number | null;
  avg_nacn: number | null; avg_flot_rec: number | null;
  avg_p80: number | null;
}

interface DimensionScore {
  id: string;
  label: string;
  score: number; // 0–100
  weight: number;
  color: string;
  rationale: string;
  data_points: string;
}

interface CircuitScore {
  code: string;
  label: string;
  shortLabel: string;
  description: string;
  totalScore: number; // weighted
  dimensions: DimensionScore[];
  recovery_pct: number;
  opex_usd_t: number;
  capex_indicator: 'low' | 'medium' | 'high';
  co2_t_oz: number;
  water_m3_t: number;
  npv_index: number; // 0–10 relative
  commissioning_months: number;
  confidence: 'haute' | 'moyenne' | 'faible';
  pros: string[];
  cons: string[];
  basis: string;
  is_recommended: boolean;
  risk_flags: string[];
  color: string;
  icon: string;
}

interface SavedRec {
  id: string; circuit_code: string; circuit_label: string;
  ai_score: number; recovery_pct: number; opex_usd_t: number;
  is_recommended: boolean; confidence: string; basis: string; created_at: string;
}

// ─── MetaScore config types & defaults ───────────────────────────────────────

interface MetascoreWeights {
  recovery: number; economics: number; risk: number;
  environment: number; schedule: number; dataQuality: number;
}

interface MetascoreThresholds {
  preg_robbing_corg: number;
  refractory_sulf: number;
  hard_ore_bwi: number;
  high_grade_threshold: number;
  heap_leach_kinetics: number;
  min_tests_high_conf: number;
  min_tests_med_conf: number;
}

interface OpexFormula { base: number; bwi_factor: number }

interface MetascoreOpex {
  cil: OpexFormula; rip: OpexFormula;
  heap: OpexFormula; flotation: OpexFormula;
  pox: OpexFormula; bioxidation: OpexFormula;
}

interface ScoringParams {
  economics_opex_factor: number;
  economics_capex_factor: number;
  environment_co2_factor: number;
  schedule_baseline_months: number;
  schedule_penalty_per_month: number;
  data_quality_target_tests: number;
}

interface MetascoreConfig {
  id?: string;
  dim_weights: MetascoreWeights;
  thresholds: MetascoreThresholds;
  opex_formulas: MetascoreOpex;
  scoring_params: ScoringParams;
}

const DEFAULT_CONFIG: MetascoreConfig = {
  dim_weights: {
    recovery: 0.30, economics: 0.22, risk: 0.18,
    environment: 0.12, schedule: 0.10, dataQuality: 0.08,
  },
  thresholds: {
    preg_robbing_corg: 0.25, refractory_sulf: 2.0, hard_ore_bwi: 18,
    high_grade_threshold: 1.5, heap_leach_kinetics: 0.68,
    min_tests_high_conf: 6, min_tests_med_conf: 3,
  },
  opex_formulas: {
    cil:        { base: 20, bwi_factor: 0.35 },
    rip:        { base: 22, bwi_factor: 0.40 },
    heap:       { base: 9,  bwi_factor: 0.12 },
    flotation:  { base: 12, bwi_factor: 0.20 },
    pox:        { base: 38, bwi_factor: 0.60 },
    bioxidation:{ base: 45, bwi_factor: 0.50 },
  },
  scoring_params: {
    economics_opex_factor: 1.5, economics_capex_factor: 20,
    environment_co2_factor: 130, schedule_baseline_months: 18,
    schedule_penalty_per_month: 3, data_quality_target_tests: 20,
  },
};

// ─── Multi-dimensional scoring engine ────────────────────────────────────────

function buildCircuits(snap: LimsSnapshot, project: Project, cfg: MetascoreConfig): CircuitScore[] {
  const W = cfg.dim_weights;
  const TH = cfg.thresholds;
  const OP = cfg.opex_formulas;
  const SP = cfg.scoring_params;

  const leach = snap.avg_leach_24h;
  const leach48 = snap.avg_leach_48h;
  const grg = snap.avg_grg;
  const bwi = snap.avg_bwi ?? 15;
  const corg = snap.avg_corg ?? 0;
  const sulf = snap.avg_sulf ?? 0;
  const auFree = snap.avg_au_free ?? 60;
  const grade = project.gold_grade_g_t;
  const pregRobbing = corg > TH.preg_robbing_corg;
  const refractory = sulf > TH.refractory_sulf;
  const hardOre = bwi > TH.hard_ore_bwi;

  function conf(n: number): 'haute' | 'moyenne' | 'faible' {
    return n >= TH.min_tests_high_conf ? 'haute' : n >= TH.min_tests_med_conf ? 'moyenne' : 'faible';
  }

  function clamp(v: number, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, v)); }

  // Helper: compute all 6 dimension scores for a circuit
  function dims(params: {
    rec: number;         // metallurgical recovery %
    opex: number;        // $/t milled
    capexFactor: number; // 0=low 1=high (relative 0–1)
    techRisk: number;    // 0–100 (higher = riskier)
    co2: number;         // t/oz
    waterFactor: number; // relative 0–1
    scheduleMths: number;
    nTests: number;
  }): DimensionScore[] {
    return [
      {
        id: 'recovery', label: 'Récupération métallurgique', weight: W.recovery,
        score: clamp(params.rec),
        color: '#10b981',
        rationale: `Récupération estimée ${params.rec.toFixed(1)}%`,
        data_points: `n_leach=${snap.n_leach}`,
      },
      {
        id: 'economics', label: 'Efficacité économique', weight: W.economics,
        score: clamp(100 - params.opex * SP.economics_opex_factor - params.capexFactor * SP.economics_capex_factor),
        color: '#f59e0b',
        rationale: `OPEX $${params.opex.toFixed(0)}/t · CapEx ${params.capexFactor < 0.4 ? 'faible' : params.capexFactor < 0.7 ? 'moyen' : 'élevé'}`,
        data_points: `grade=${grade.toFixed(2)} g/t`,
      },
      {
        id: 'risk', label: 'Profil de risque technique', weight: W.risk,
        score: clamp(100 - params.techRisk),
        color: '#ef4444',
        rationale: params.techRisk < 30 ? 'Technologie éprouvée, risque faible' : params.techRisk < 60 ? 'Risque modéré — validation requise' : 'Circuit complexe, risque élevé',
        data_points: `corg=${corg.toFixed(2)}% s=${sulf.toFixed(2)}%`,
      },
      {
        id: 'environment', label: 'Empreinte environnementale', weight: W.environment,
        score: clamp(100 - params.co2 * SP.environment_co2_factor - params.waterFactor * 20),
        color: '#06b6d4',
        rationale: `CO₂ ${params.co2.toFixed(2)} t/oz · eau ${params.waterFactor < 0.4 ? 'faible' : 'élevée'}`,
        data_points: '',
      },
      {
        id: 'schedule', label: 'Rapidité de mise en production', weight: W.schedule,
        score: clamp(100 - (params.scheduleMths - SP.schedule_baseline_months) * SP.schedule_penalty_per_month),
        color: '#8b5cf6',
        rationale: `Mise en production estimée ~${params.scheduleMths} mois`,
        data_points: '',
      },
      {
        id: 'dataQuality', label: 'Qualité & couverture données', weight: W.dataQuality,
        score: clamp((params.nTests / SP.data_quality_target_tests) * 100),
        color: '#6b7280',
        rationale: `${params.nTests} tests LIMS disponibles`,
        data_points: `leach=${snap.n_leach} grg=${snap.n_grg} bwi=${snap.n_bwi} head=${snap.n_head}`,
      },
    ];
  }

  function weighted(d: DimensionScore[]): number {
    return Math.round(d.reduce((s, x) => s + x.score * x.weight, 0));
  }

  const totalTests = snap.n_leach + snap.n_grg + snap.n_bwi + snap.n_head;

  // R_global = 1 - ∏(1 - Ri)  —  all Ri as fractions, result as percentage
  function seriesRec(...stages: number[]): number {
    return Math.max(0, Math.min(100, (1 - stages.reduce((p, r) => p * (1 - r), 1)) * 100));
  }

  // ── Circuit 1: Gravity + CIL ─────────────────────────────────────────────
  // Gravity on full feed (R_grav), then CIL on tails (R_cil on remaining fraction)
  // R_global = 1 - (1 - R_grav)(1 - R_cil)
  const gc_rec = leach
    ? seriesRec((grg ? grg / 100 * 0.90 : 0), ((leach - (pregRobbing ? 3 : 0)) / 100) * 0.95)
    : project.recovery_pct * 0.99;
  const gc_opex = +(OP.rip.base + bwi * OP.rip.bwi_factor).toFixed(1);
  const gc_dims = dims({ rec: gc_rec, opex: gc_opex, capexFactor: 0.45, techRisk: pregRobbing ? 45 : 20, co2: 0.18, waterFactor: 0.35, scheduleMths: 24, nTests: totalTests });

  // ── Circuit 2: Gravity + Leach + CIP ────────────────────────────────────
  // Same series logic with 48h leach kinetics and CIP adsorption efficiency
  const gcp_rec = leach48
    ? seriesRec((grg ? grg / 100 * 0.88 : 0), ((leach48 - (pregRobbing ? 1 : 0)) / 100) * 0.96)
    : gc_rec * 0.99;
  const gcp_opex = +(OP.rip.base + 2 + bwi * (OP.rip.bwi_factor + 0.02)).toFixed(1);
  const gcp_dims = dims({ rec: gcp_rec, opex: gcp_opex, capexFactor: 0.52, techRisk: pregRobbing ? 25 : 22, co2: 0.19, waterFactor: 0.37, scheduleMths: 26, nTests: totalTests });

  // ── Circuit 3: Direct CIL ────────────────────────────────────────────────
  // Single stage — R_global = R_leach (formula reduces to direct value)
  const cil_rec = leach ? Math.max(0, leach - (pregRobbing ? 5 : 0)) : project.recovery_pct * 0.97;
  const cil_opex = +(OP.cil.base + bwi * OP.cil.bwi_factor).toFixed(1);
  const cil_dims = dims({ rec: cil_rec, opex: cil_opex, capexFactor: 0.38, techRisk: pregRobbing ? 55 : 18, co2: 0.17, waterFactor: 0.33, scheduleMths: 22, nTests: totalTests });

  // ── Circuit 4: Direct CIP ────────────────────────────────────────────────
  // Single stage — CIP slightly less efficient than CIL due to inter-stage losses
  const cip_rec = leach ? clamp(leach * 0.985 - (pregRobbing ? 0.5 : 2)) : project.recovery_pct * 0.96;
  const cip_opex = +(OP.cil.base + 1 + bwi * (OP.cil.bwi_factor + 0.02)).toFixed(1);
  const cip_dims = dims({ rec: clamp(cip_rec), opex: cip_opex, capexFactor: 0.42, techRisk: pregRobbing ? 15 : 24, co2: 0.18, waterFactor: 0.34, scheduleMths: 23, nTests: totalTests });

  // ── Circuit 5: Flotation + Regrind + CIL ───────────────────────────────
  // Mass-balance: flotation captures R_flot fraction, regrind leach on conc + tail leach on flotation tails
  // R_global = R_flot × R_leach_conc + (1 - R_flot) × R_leach_tails
  const fl_rec = (() => {
    if (!leach) return project.recovery_pct * 0.91;
    const R_flot = (snap.avg_flot_rec ?? 75) / 100 * 0.94;
    const R_leach_conc = Math.min(0.97, (leach + 5) / 100);
    const R_leach_tails = Math.max(0, (leach - 10) / 100) * 0.75;
    return Math.min(97, (R_flot * R_leach_conc + (1 - R_flot) * R_leach_tails) * 100);
  })();
  const fl_opex = +(OP.flotation.base + (OP.cil.base * 1.3) + bwi * (OP.flotation.bwi_factor + OP.cil.bwi_factor)).toFixed(1);
  const fl_dims = dims({ rec: fl_rec, opex: fl_opex, capexFactor: 0.72, techRisk: refractory ? 30 : 42, co2: 0.24, waterFactor: 0.55, scheduleMths: 32, nTests: totalTests });

  // ── Circuit 6: Flotation + POX + CIL (refractory) ───────────────────────
  // Three stages in series: R = 1 - (1-R_flot)(1-R_pox)(1-R_cil)
  const pox_rec = (() => {
    if (!leach) return project.recovery_pct;
    const R_flot = (snap.avg_flot_rec ?? 80) / 100 * 0.93;
    const R_pox  = 0.97;  // POX/roasting liberates ~97% of locked Au
    const R_cil  = Math.min(0.97, leach / 100 * 1.06);
    return seriesRec(R_flot, R_pox, R_cil);
  })();
  const pox_opex = +(OP.pox.base + bwi * OP.pox.bwi_factor).toFixed(1);
  const pox_dims = dims({ rec: pox_rec, opex: pox_opex, capexFactor: 0.95, techRisk: 35, co2: 0.42, waterFactor: 0.70, scheduleMths: 42, nTests: totalTests });

  // ── Circuit 7: Heap Leach (ROM) ──────────────────────────────────────────
  // Single stage with lower kinetics — column-test efficiency from config
  const heapKinetics = TH.heap_leach_kinetics;
  const heap_rec = leach ? Math.min(72, leach * heapKinetics) : Math.min(65, project.recovery_pct * heapKinetics);
  const heap_opex = +(OP.heap.base + bwi * OP.heap.bwi_factor).toFixed(1);
  const heap_dims = dims({ rec: heap_rec, opex: heap_opex, capexFactor: 0.15, techRisk: refractory || pregRobbing ? 70 : 30, co2: 0.11, waterFactor: 0.20, scheduleMths: 16, nTests: totalTests });

  const raw: Omit<CircuitScore, 'totalScore' | 'is_recommended'>[] = [
    {
      code: 'GRAV+CIL', label: 'Gravité + CIL', shortLabel: 'G+CIL',
      description: 'Concentrateur Knelson récupère l\'or libre, le résidu part en CIL à carbone actif continu.',
      dimensions: gc_dims,
      recovery_pct: +gc_rec.toFixed(1), opex_usd_t: gc_opex,
      capex_indicator: 'medium', co2_t_oz: 0.18, water_m3_t: 2.2, npv_index: 7.5,
      commissioning_months: 24, confidence: conf(snap.n_leach + snap.n_grg),
      pros: ['Or libre valorisé gravitairement sans cyanure', 'Réduction charge CIL (-15% NaCN)', 'ROI rapide sur le concentré grav.'],
      cons: ['Investissement centrifuge Knelson', pregRobbing ? 'Pré-robbing CIL non résolu' : 'Circuit légèrement plus complexe'],
      basis: `GRG ${grg?.toFixed(1) ?? 'N/D'}% · CIL 24h ${leach?.toFixed(1) ?? 'N/D'}%`,
      risk_flags: pregRobbing ? ['Pré-robbing: CIL exposé au Corg'] : [],
      color: '#14B8A6', icon: 'layers',
    },
    {
      code: 'GRAV+CIP', label: 'Gravité + Leach + CIP', shortLabel: 'G+CIP',
      description: 'Knelson + lixiviation 48h distincte + adsorption CIP en série — optimal pour minerais à Corg.',
      dimensions: gcp_dims,
      recovery_pct: +clamp(gcp_rec).toFixed(1), opex_usd_t: gcp_opex,
      capex_indicator: 'medium', co2_t_oz: 0.19, water_m3_t: 2.4, npv_index: 7.8,
      commissioning_months: 26, confidence: conf(snap.n_leach + snap.n_grg),
      pros: ['Séparation lixiviation / adsorption = zéro pré-robbing', 'Récup. 48h supérieure à CIL', 'Gestion carbone actif optimale'],
      cons: ['Tanks lixiviation + tanks CIP → empreinte mécanique', 'Gestion charbon actif plus complexe'],
      basis: `GRG ${grg?.toFixed(1) ?? 'N/D'}% · Leach 48h ${leach48?.toFixed(1) ?? 'N/D'}%`,
      risk_flags: [],
      color: '#2563EB', icon: 'activity',
    },
    {
      code: 'CIL-STD', label: 'CIL Standard', shortLabel: 'CIL',
      description: 'Lixiviation + adsorption simultanées en cuves CIL — circuit le plus répandu au monde.',
      dimensions: cil_dims,
      recovery_pct: +clamp(cil_rec).toFixed(1), opex_usd_t: cil_opex,
      capex_indicator: 'medium', co2_t_oz: 0.17, water_m3_t: 2.0, npv_index: 7.2,
      commissioning_months: 22, confidence: conf(snap.n_leach),
      pros: ['Technologie éprouvée (>500 mines)', 'CAPEX réduit vs G+CIP', 'Mise en service rapide'],
      cons: [pregRobbing ? 'Pré-robbing sévère → perte récup. > 5%' : 'Moins robuste si Corg > 0.2%', 'Pas de bonus gravitaire'],
      basis: `CIL 24h LIMS ${leach?.toFixed(1) ?? 'N/D'}% · n=${snap.n_leach}`,
      risk_flags: pregRobbing ? [`CRITIQUE: Corg > ${TH.preg_robbing_corg}% — circuit CIP préférable`] : [],
      color: '#3B82F6', icon: 'flask',
    },
    {
      code: 'CIP-STD', label: 'CIP (Carbone en Pulpe)', shortLabel: 'CIP',
      description: 'Lixiviation puis adsorption CIP en série — carbone actif ajouté après l\'or dissous, protégé du Corg.',
      dimensions: cip_dims,
      recovery_pct: +clamp(cip_rec).toFixed(1), opex_usd_t: cip_opex,
      capex_indicator: 'medium', co2_t_oz: 0.18, water_m3_t: 2.1, npv_index: 7.4,
      commissioning_months: 23, confidence: conf(snap.n_leach),
      pros: ['Immunisé contre pré-robbing', 'Standard industrie pour Corg > 0.2%', 'Charbon contacté après dissolution complète'],
      cons: ['Temps de résidence total plus long', 'Superficie légèrement supérieure CIL'],
      basis: `Corg ${corg.toFixed(2)}% · CIL ${leach?.toFixed(1) ?? 'N/D'}%`,
      risk_flags: !pregRobbing ? ['CIL suffit si Corg < 0.2%'] : [],
      color: '#F59E0B', icon: 'target',
    },
    {
      code: 'FLOAT+REGRIND+CIL', label: 'Flottation + Rebroyage + CIL', shortLabel: 'F+R+CIL',
      description: 'Flottation bulk récupère sulfures aurifères, rebroyage concentré libère l\'or occlus, puis CIL.',
      dimensions: fl_dims,
      recovery_pct: +clamp(fl_rec).toFixed(1), opex_usd_t: fl_opex,
      capex_indicator: 'high', co2_t_oz: 0.24, water_m3_t: 3.2, npv_index: 6.8,
      commissioning_months: 32, confidence: conf(snap.n_head),
      pros: ['Optimal pour sulfures > 2%', 'Rebroyage libère Au occlus dans pyrite', 'Récup. globale maximisée pour minerai complexe'],
      cons: ['CAPEX élevé (IsaMill/Vertimill + flottation)', 'Procédé multi-étapes — risque opérationnel'],
      basis: `S sulf. ${sulf.toFixed(2)}% · n_head=${snap.n_head}`,
      risk_flags: sulf < 1 ? ['S% faible — flottation non justifiée économiquement'] : [],
      color: '#8B5CF6', icon: 'git-branch',
    },
    {
      code: 'POX+CIL', label: 'Flottation + POX + CIL', shortLabel: 'POX',
      description: 'Oxydation par pression en autoclave (220°C, 25 bar) — seule solution pour sulfures très réfractaires.',
      dimensions: pox_dims,
      recovery_pct: +pox_rec.toFixed(1), opex_usd_t: pox_opex,
      capex_indicator: 'high', co2_t_oz: 0.42, water_m3_t: 4.5, npv_index: 5.2,
      commissioning_months: 42, confidence: conf(snap.n_head),
      pros: ['Récupération maximale minerai réfractaire', 'Élimine soufre arsenical', 'Seule option si S% > 5%'],
      cons: ['CAPEX autoclave $150–250M+', 'OpEx très élevé (O₂, énergie)', 'Empreinte carbone importante'],
      basis: `S total ${sulf.toFixed(2)}% · Corg ${corg.toFixed(2)}%`,
      risk_flags: sulf < 3 ? ['POX rarement justifié si S% < 3%'] : [],
      color: '#EF4444', icon: 'zap',
    },
    {
      code: 'HEAP-ROM', label: 'Heap Leach ROM', shortLabel: 'HEAP',
      description: 'Lixiviation en tas sur minerai concassé grossier — faible CapEx, idéal basse teneur / oxyde.',
      dimensions: heap_dims,
      recovery_pct: +heap_rec.toFixed(1), opex_usd_t: heap_opex,
      capex_indicator: 'low', co2_t_oz: 0.11, water_m3_t: 1.2, npv_index: 5.8,
      commissioning_months: 16, confidence: conf(snap.n_leach),
      pros: ['CAPEX minimal (fraction CIL)', 'Mise en production 16–20 mois', 'Idéal basse teneur < 0.8 g/t'],
      cons: ['Récupération 30–40% inférieure au CIL', 'Non adapté sulfures / argiles', 'Risques réglementaires cyanure (tas)'],
      basis: `Grade ${grade.toFixed(2)} g/t · CIL ${leach?.toFixed(1) ?? 'N/D'}%`,
      risk_flags: (refractory || pregRobbing) ? ['Sulfures/Corg incompatibles avec heap leach'] : grade > TH.high_grade_threshold ? ['Teneur élevée — heap leach sous-performe économiquement'] : [],
      color: '#6B7280', icon: 'triangle',
    },
  ];

  const scored: CircuitScore[] = raw.map(c => ({
    ...c,
    totalScore: weighted(c.dimensions),
    is_recommended: false,
  })).sort((a, b) => b.totalScore - a.totalScore);

  if (scored.length > 0) scored[0].is_recommended = true;
  return scored;
}

// ─── Radar / spider chart SVG ─────────────────────────────────────────────────

function RadarChart({ dims, color }: { dims: DimensionScore[]; color: string }) {
  const N = dims.length;
  const cx = 120, cy = 110, r = 80;
  const angles = dims.map((_, i) => (2 * Math.PI * i) / N - Math.PI / 2);

  function pt(score: number, idx: number) {
    const a = angles[idx];
    const d = (score / 100) * r;
    return { x: cx + d * Math.cos(a), y: cy + d * Math.sin(a) };
  }

  const bgRings = [20, 40, 60, 80, 100];
  const dataPoints = dims.map((d, i) => pt(d.score, i));
  const dataPoly = dataPoints.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg viewBox="0 0 240 220" className="w-full" style={{ height: 200 }}>
      {/* bg rings */}
      {bgRings.map(pct => {
        const ring = dims.map((_, i) => {
          const a = angles[i]; const d = (pct / 100) * r;
          return `${cx + d * Math.cos(a)},${cy + d * Math.sin(a)}`;
        }).join(' ');
        return <polygon key={pct} points={ring} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}
      {/* axis spokes */}
      {dims.map((_, i) => {
        const end = pt(100, i);
        return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />;
      })}
      {/* data polygon */}
      <polygon points={dataPoly} fill={`${color}28`} stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {/* data points */}
      {dataPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="3.5" fill={color} opacity="0.9" />
      ))}
      {/* axis labels */}
      {dims.map((d, i) => {
        const a = angles[i]; const lx = cx + (r + 16) * Math.cos(a); const ly = cy + (r + 16) * Math.sin(a);
        return (
          <text key={i} x={lx} y={ly + 3} fill="#7F8DA3" fontSize="8" textAnchor="middle" dominantBaseline="middle">
            {d.label.split(' ')[0]}
          </text>
        );
      })}
      {/* center score */}
      <text x={cx} y={cy - 5} fill="white" fontSize="16" fontWeight="700" textAnchor="middle">
        {Math.round(dims.reduce((s, d) => s + d.score * d.weight, 0))}
      </text>
      <text x={cx} y={cy + 10} fill="#56657A" fontSize="8" textAnchor="middle">score</text>
    </svg>
  );
}

// ─── Dimension bar ────────────────────────────────────────────────────────────

function DimBar({ d, showRationale = false }: { d: DimensionScore; showRationale?: boolean }) {
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-mf-txt3">{d.label}</span>
        <span className="text-[10px] font-mono font-bold" style={{ color: d.color }}>{d.score.toFixed(0)}/100</span>
      </div>
      <div className="h-1.5 bg-mf-border/40 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${d.score}%`, backgroundColor: d.color, opacity: 0.8 }} />
      </div>
      {showRationale && <div className="text-[9px] text-mf-txt4 mt-0.5 leading-tight">{d.rationale}</div>}
    </div>
  );
}

// ─── Sensitivity tornado (SVG) ───────────────────────────────────────────────

function TornadoChart({ circuit }: { circuit: CircuitScore }) {
  const W = 420, H = 200, CX = 210, PAD = 10;
  const dims = [...circuit.dimensions].sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
  const barH = 16, gap = 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {/* center line */}
      <line x1={CX} y1={0} x2={CX} y2={H} stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3 2" />
      <text x={CX} y={H - 2} fill="#56657A" fontSize="8" textAnchor="middle">50</text>
      {dims.slice(0, 6).map((d, i) => {
        const y = PAD + i * (barH + gap);
        const barLen = ((d.score - 50) / 50) * (CX - 60);
        const x = barLen >= 0 ? CX : CX + barLen;
        const w = Math.abs(barLen);
        return (
          <g key={d.id}>
            <text x={55} y={y + barH / 2 + 3} fill="#7F8DA3" fontSize="8" textAnchor="end">{d.label.split(' ')[0]}</text>
            <rect x={x} y={y} width={w} height={barH} fill={d.color} opacity="0.7" rx="2" />
            <text x={barLen >= 0 ? CX + w + 3 : CX + barLen - 3} y={y + barH / 2 + 3}
              fill={d.color} fontSize="8" textAnchor={barLen >= 0 ? 'start' : 'end'} fontWeight="600">
              {d.score.toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'circuits' | 'matrix' | 'deep' | 'scenarios' | 'history' | 'settings';

interface Props { project: Project }

export function CircuitAI({ project }: Props) {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [snap, setSnap] = useState<LimsSnapshot | null>(null);
  const [circuits, setCircuits] = useState<CircuitScore[]>([]);
  const [saved, setSaved] = useState<SavedRec[]>([]);
  const [config, setConfig] = useState<MetascoreConfig>(DEFAULT_CONFIG);
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [lastAnalysis, setLastAnalysis] = useState<string | null>(null);
  const [selectedCircuit, setSelectedCircuit] = useState<string | null>(null);
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [scenario, setScenario] = useState({ leachBoost: 0, grgBoost: 0, bwiChange: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    // Clear stale state from previous project immediately
    setSnap(null);
    setCircuits([]);
    setSaved([]);
    const pid = project.id;
    const [hRes, cRes, gRes, lRes, recRes, libRes, flotRes, psdRes, cfgRes] = await Promise.all([
      supabase.from('lims_test_chem').select('au_g_t,s_sulfide_pct,c_organic_pct').eq('project_id', pid),
      supabase.from('lims_test_comminution').select('bwi_kwh_t').eq('project_id', pid),
      supabase.from('lims_test_knelson').select('grg_recovery_pct').eq('project_id', pid),
      supabase.from('lims_test_leaching').select('leach_rec_24h_pct,leach_rec_48h_pct,nacn_consumption_kg_t').eq('project_id', pid),
      supabase.from('circuit_recommendations').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(50),
      supabase.from('lims_test_liberation').select('au_free_pct').eq('project_id', pid),
      supabase.from('lims_test_flotation').select('au_recovery_pct').eq('project_id', pid),
      supabase.from('lims_test_psd').select('p80_um').eq('project_id', pid),
      supabase.from('metascore_config').select('*').eq('project_id', pid).maybeSingle(),
    ]);

    function m(vs: (number | null | undefined)[]): number | null {
      const v = vs.filter((x): x is number => x != null && !isNaN(x) && x > 0);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    }

    const heads   = (hRes.data ?? []) as { au_g_t: number | null; s_sulfide_pct: number | null; c_organic_pct: number | null }[];
    const coms    = (cRes.data ?? []) as { bwi_kwh_t: number | null }[];
    const gravs   = (gRes.data ?? []) as { grg_recovery_pct: number | null }[];
    const leachs  = (lRes.data ?? []) as { leach_rec_24h_pct: number | null; leach_rec_48h_pct: number | null; nacn_consumption_kg_t: number | null }[];
    const libs    = (libRes.data ?? []) as { au_free_pct: number | null }[];
    const flots   = (flotRes.data ?? []) as { au_recovery_pct: number | null }[];
    const psds    = (psdRes.data ?? []) as { p80_um: number | null }[];

    const snapshot: LimsSnapshot = {
      n_leach: leachs.length, n_grg: gravs.length,
      n_bwi: coms.length, n_head: heads.length, n_flotation: flots.length,
      avg_leach_24h: m(leachs.map(t => t.leach_rec_24h_pct)),
      avg_leach_48h: m(leachs.map(t => t.leach_rec_48h_pct)),
      avg_grg: m(gravs.map(t => t.grg_recovery_pct)),
      avg_bwi: m(coms.map(t => t.bwi_kwh_t)),
      avg_corg: m(heads.map(t => t.c_organic_pct)),
      avg_sulf: m(heads.map(t => t.s_sulfide_pct)),
      avg_au: m(heads.map(t => t.au_g_t)),
      avg_au_free: m(libs.map(t => t.au_free_pct)),
      avg_nacn: m(leachs.map(t => t.nacn_consumption_kg_t)),
      avg_flot_rec: m(flots.map(t => t.au_recovery_pct)),
      avg_p80: m(psds.map(t => t.p80_um)),
    };

    // Load or apply default config
    const loadedConfig: MetascoreConfig = cfgRes.data
      ? {
          id: cfgRes.data.id,
          dim_weights: { ...DEFAULT_CONFIG.dim_weights, ...cfgRes.data.dim_weights },
          thresholds: { ...DEFAULT_CONFIG.thresholds, ...cfgRes.data.thresholds },
          opex_formulas: { ...DEFAULT_CONFIG.opex_formulas, ...cfgRes.data.opex_formulas },
          scoring_params: { ...DEFAULT_CONFIG.scoring_params, ...cfgRes.data.scoring_params },
        }
      : DEFAULT_CONFIG;
    setConfigId(cfgRes.data?.id ?? null);
    setConfig(loadedConfig);

    setSnap(snapshot);
    setCircuits(buildCircuits(snapshot, project, loadedConfig));
    setSaved((recRes.data ?? []) as SavedRec[]);
    setLastAnalysis(recRes.data?.[0]?.created_at ?? null);
    setLoading(false);
  }, [project.id, project.recovery_pct, project.gold_grade_g_t]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // Scenario engine
  const scenarioCircuits = useMemo(() => {
    if (!snap) return circuits;
    const modified: LimsSnapshot = {
      ...snap,
      avg_leach_24h: snap.avg_leach_24h != null ? Math.min(99, snap.avg_leach_24h + scenario.leachBoost) : null,
      avg_leach_48h: snap.avg_leach_48h != null ? Math.min(99, snap.avg_leach_48h + scenario.leachBoost * 0.8) : null,
      avg_grg: snap.avg_grg != null ? Math.min(80, snap.avg_grg + scenario.grgBoost) : null,
      avg_bwi: snap.avg_bwi != null ? snap.avg_bwi + scenario.bwiChange : null,
    };
    return buildCircuits(modified, project, config);
  }, [snap, scenario, project, config]); // eslint-disable-line

  async function saveConfig() {
    setSavingConfig(true);
    const payload = {
      project_id: project.id,
      dim_weights: config.dim_weights,
      thresholds: config.thresholds,
      opex_formulas: config.opex_formulas,
      scoring_params: config.scoring_params,
      updated_at: new Date().toISOString(),
    };
    if (configId) {
      await supabase.from('metascore_config').update(payload).eq('id', configId).eq('project_id', project.id);
    } else {
      const { data } = await supabase.from('metascore_config').insert(payload).select('id').maybeSingle();
      if (data) setConfigId(data.id);
    }
    // Re-score circuits with new config
    if (snap) setCircuits(buildCircuits(snap, project, config));
    setSavingConfig(false);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2200);
  }

  async function handleAnalyse() {
    if (!snap) return;
    setAnalyzing(true);
    await supabase.from('circuit_recommendations').delete().eq('project_id', project.id);
    const rows = circuits.map(c => ({
      project_id: project.id,
      circuit_code: c.code, circuit_label: c.label,
      ai_score: c.totalScore, recovery_pct: c.recovery_pct,
      opex_usd_t: c.opex_usd_t, co2_t_oz: c.co2_t_oz,
      confidence: c.confidence, basis: c.basis,
      is_recommended: c.is_recommended, data_snapshot: snap,
    }));
    await supabase.from('circuit_recommendations').insert(rows);
    await load();
    setAnalyzing(false);
    setTab('circuits');
  }

  const totalTests = snap ? snap.n_leach + snap.n_grg + snap.n_bwi + snap.n_head : 0;
  const dataQuality = totalTests >= 15 ? 'haute' : totalTests >= 6 ? 'moyenne' : 'faible';
  const recommended = circuits.find(c => c.is_recommended);
  const selectedC = circuits.find(c => c.code === selectedCircuit) ?? recommended;

  const capexMap = { low: { label: 'Faible', color: '#10b981' }, medium: { label: 'Moyen', color: '#f59e0b' }, high: { label: 'Élevé', color: '#ef4444' } };

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader title="MetaScore Intelligence" breadcrumb={['Optimisation', 'MetaScore']} />
        <div className="flex items-center justify-center flex-1 text-mf-txt4 text-sm gap-2">
          <RefreshCw size={16} className="animate-spin" /> Chargement données LIMS…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="MetaScore Intelligence"
        subtitle={`Moteur d'optimisation multi-dimensionnel — ${totalTests} tests LIMS · ${project.name}`}
        breadcrumb={['Optimisation', 'MetaScore']}
        actions={
          <button onClick={handleAnalyse} disabled={analyzing || totalTests === 0}
            className={`btn flex items-center gap-2 font-bold text-sm px-5 transition-all ${analyzing || totalTests === 0 ? 'bg-amber-500/20 text-amber-400/50 border border-amber-500/20 cursor-not-allowed' : 'bg-amber-500 text-black hover:bg-amber-400 shadow-lg shadow-amber-500/20'}`}>
            {analyzing ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {analyzing ? 'Analyse en cours…' : 'Lancer MetaScore'}
          </button>
        }
      />

      {/* Data quality strip */}
      <div className="px-6 pt-4">
        {totalTests === 0 ? (
          <div className="p-3 bg-amber-500/8 border border-amber-500/20 rounded-xl flex gap-3 mb-4">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-mf-txt3">Importez des tests LIMS (lixiviation, gravimétrie, comminution, chimie tête) pour activer le moteur MetaScore.</div>
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2 mb-4">
            {[
              { label: 'Lixiviation', val: snap!.n_leach, target: 6, avg: snap!.avg_leach_24h, unit: '%', color: '#14B8A6' },
              { label: 'Gravimétrie', val: snap!.n_grg,   target: 3, avg: snap!.avg_grg,       unit: '%', color: '#F59E0B' },
              { label: 'Comminution', val: snap!.n_bwi,   target: 3, avg: snap!.avg_bwi,       unit: 'kWh/t', color: '#3B82F6' },
              { label: 'Chimie tête', val: snap!.n_head,  target: 5, avg: snap!.avg_au,         unit: 'g/t', color: '#8B5CF6' },
              { label: 'Au libre',    val: snap!.n_grg,   target: 3, avg: snap!.avg_au_free,    unit: '%', color: '#F06B6B' },
            ].map(d => {
              const ok = d.val >= d.target;
              return (
                <div key={d.label} className={`rounded-lg border p-3 ${ok ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-mf-border bg-mf-card'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[9px] font-semibold uppercase tracking-wider text-mf-txt4">{d.label}</div>
                    <span className="text-[9px] font-mono px-1 py-0.5 rounded border" style={{ color: d.color, borderColor: `${d.color}30` }}>{d.val}/{d.target}</span>
                  </div>
                  <div className="h-1 bg-mf-border/30 rounded-full overflow-hidden mb-1">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (d.val / d.target) * 100)}%`, backgroundColor: d.color, opacity: 0.7 }} />
                  </div>
                  <div className="text-[10px] text-mf-txt4 font-mono">
                    {d.avg != null ? `${d.avg.toFixed(1)} ${d.unit}` : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tab bar */}
        <div className="border-b border-mf-border flex gap-0.5 overflow-x-auto">
          {([
            { id: 'dashboard', label: 'Tableau de bord', icon: <BarChart3 size={13}/> },
            { id: 'circuits',  label: 'Circuits scorés',  icon: <Award size={13}/> },
            { id: 'matrix',    label: 'Matrice 6D',        icon: <Target size={13}/> },
            { id: 'deep',      label: 'Analyse profonde',  icon: <Cpu size={13}/> },
            { id: 'scenarios', label: 'Simulateur',        icon: <GitBranch size={13}/> },
            { id: 'history',   label: 'Historique',        icon: <Clock size={13}/> },
            { id: 'settings',  label: 'Paramètres',        icon: <Settings2 size={13}/> },
          ] as { id: Tab; label: string; icon: React.ReactNode }[]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── DASHBOARD ─────────────────────────────────────────────────── */}
        {tab === 'dashboard' && (
          <div className="space-y-5">
            {recommended && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                    <Sparkles size={22} className="text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <div className="text-base font-bold text-amber-400">Recommandation MetaScore — {recommended.label}</div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">Score {recommended.totalScore}/100</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${recommended.confidence === 'haute' ? 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10' : recommended.confidence === 'moyenne' ? 'text-amber-400 border-amber-500/25 bg-amber-500/10' : 'text-mf-txt4 border-mf-border'}`}>
                        Confiance {recommended.confidence}
                      </span>
                    </div>
                    <p className="text-sm text-mf-txt3 mb-3">{recommended.description}</p>
                    <div className="grid grid-cols-5 gap-3">
                      {[
                        { label: 'Récupération Au', val: `${recommended.recovery_pct}%`, color: '#10b981', icon: TrendingUp },
                        { label: 'OPEX estimé', val: `$${recommended.opex_usd_t}/t`, color: '#f88a44', icon: DollarSign },
                        { label: 'CO₂ eq.', val: `${recommended.co2_t_oz} t/oz`, color: '#38bdf8', icon: Leaf },
                        { label: 'Eau process', val: `${recommended.water_m3_t} m³/t`, color: '#06b6d4', icon: Activity },
                        { label: 'Mise en prod.', val: `${recommended.commissioning_months} mois`, color: '#8b5cf6', icon: Clock },
                      ].map(m => (
                        <div key={m.label} className="p-3 rounded-lg bg-mf-panel border border-mf-border text-center">
                          <m.icon size={14} className="mx-auto mb-1" style={{ color: m.color }} />
                          <div className="text-sm font-bold font-mono" style={{ color: m.color }}>{m.val}</div>
                          <div className="text-[9px] text-mf-txt4">{m.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Radar of recommended */}
                  <div className="shrink-0 w-52">
                    <RadarChart dims={recommended.dimensions} color={recommended.color} />
                  </div>
                </div>
              </div>
            )}

            {/* Risk flags */}
            {circuits.some(c => c.risk_flags.length > 0) && (
              <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle size={13} className="text-amber-400" />
                  <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Signaux détectés par le moteur MetaScore</div>
                </div>
                <div className="space-y-2">
                  {circuits.flatMap(c => c.risk_flags.map(f => ({ circuit: c.label, flag: f, color: c.color }))).map((rf, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/6 border border-amber-500/15">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: rf.color }} />
                      <div className="text-[10px] text-mf-txt3"><span className="font-semibold" style={{ color: rf.color }}>{rf.circuit}:</span> {rf.flag}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Metallurgical context panel */}
            {snap && (
              <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Contexte métallurgique du projet</div>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Récup. lixiviation moy. (24h)', val: snap.avg_leach_24h, unit: '%', color: '#10b981', status: snap.avg_leach_24h != null && snap.avg_leach_24h > 85 ? 'ok' : 'warn' },
                    { label: 'GRG Knelson moyen', val: snap.avg_grg, unit: '%', color: '#f59e0b', status: snap.avg_grg != null && snap.avg_grg > 20 ? 'ok' : 'info' },
                    { label: 'Bond Wi moyen', val: snap.avg_bwi, unit: 'kWh/t', color: '#38bdf8', status: snap.avg_bwi != null && snap.avg_bwi > 18 ? 'warn' : 'ok' },
                    { label: 'Corg (pré-robbing)', val: snap.avg_corg, unit: '%', color: snap.avg_corg != null && snap.avg_corg > 0.25 ? '#ef4444' : '#10b981', status: snap.avg_corg != null && snap.avg_corg > 0.25 ? 'critical' : 'ok' },
                    { label: 'S sulfure', val: snap.avg_sulf, unit: '%', color: snap.avg_sulf != null && snap.avg_sulf > 2 ? '#f59e0b' : '#10b981', status: snap.avg_sulf != null && snap.avg_sulf > 2 ? 'warn' : 'ok' },
                    { label: 'Au libre (MLA)', val: snap.avg_au_free, unit: '%', color: '#fbbf24', status: 'info' },
                    { label: 'P80 moyen LIMS', val: snap.avg_p80, unit: 'µm', color: '#14b8a6', status: 'info' },
                    { label: 'Cons. NaCN moy.', val: snap.avg_nacn, unit: 'kg/t', color: snap.avg_nacn != null && snap.avg_nacn > 3 ? '#f59e0b' : '#6b7280', status: snap.avg_nacn != null && snap.avg_nacn > 3 ? 'warn' : 'ok' },
                  ].filter(k => k.val != null).map(k => {
                    const iconColor = k.status === 'critical' ? '#ef4444' : k.status === 'warn' ? '#f59e0b' : k.status === 'ok' ? '#10b981' : '#6b7280';
                    return (
                      <div key={k.label} className="p-3 rounded-lg bg-mf-hover/20 border border-mf-border/60">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-mf-txt4 leading-tight">{k.label}</span>
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: iconColor }} />
                        </div>
                        <div className="text-base font-mono font-bold" style={{ color: k.color }}>
                          {k.val!.toFixed(k.val! < 10 ? 2 : 1)}
                          <span className="text-[9px] font-normal text-mf-txt4 ml-1">{k.unit}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {lastAnalysis && (
              <div className="flex items-center gap-2 text-xs text-mf-txt4 p-2.5 rounded-lg bg-mf-panel border border-mf-border">
                <Clock size={11} />
                Dernière analyse: {new Date(lastAnalysis).toLocaleString('fr-CA')}
                <span className="ml-auto text-amber-400 cursor-pointer hover:underline" onClick={() => setTab('history')}>Voir historique →</span>
              </div>
            )}
          </div>
        )}

        {/* ── CIRCUITS SCORÉS ───────────────────────────────────────────── */}
        {tab === 'circuits' && (
          <div className="space-y-3">
            {circuits.map((c, idx) => {
              const isOpen = selectedCircuit === c.code;
              return (
                <div key={c.code} className={`rounded-xl border overflow-hidden transition-all ${c.is_recommended ? 'border-amber-500/35' : 'border-mf-border'}`}
                  style={{ background: c.is_recommended ? `${c.color}06` : undefined }}>
                  <div className="flex items-center gap-4 px-5 py-4 cursor-pointer bg-mf-card hover:bg-mf-hover/20 transition-colors"
                    onClick={() => setSelectedCircuit(isOpen ? null : c.code)}>
                    {/* rank */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-400' : idx === 1 ? 'bg-mf-panel text-mf-txt3' : 'bg-mf-panel text-mf-txt4'}`}>{idx + 1}</div>
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                    {/* label */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold text-sm ${c.is_recommended ? 'text-amber-400' : 'text-mf-txt'}`}>{c.label}</span>
                        {c.is_recommended && <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">MetaScore #1</span>}
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${c.confidence === 'haute' ? 'text-emerald-400 border-emerald-500/20' : c.confidence === 'moyenne' ? 'text-amber-400 border-amber-500/20' : 'text-mf-txt4 border-mf-border'}`}>{c.confidence}</span>
                      </div>
                      <div className="text-[10px] text-mf-txt4 mt-0.5 truncate">{c.basis}</div>
                    </div>
                    {/* score + bar */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className={`text-2xl font-bold font-mono ${c.totalScore >= 80 ? 'text-amber-400' : c.totalScore >= 65 ? 'text-teal-400' : 'text-mf-txt4'}`}>{c.totalScore}</div>
                        <div className="text-[9px] text-mf-txt4">/ 100</div>
                      </div>
                      <div className="w-20 h-2 bg-mf-border rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${c.totalScore}%`, backgroundColor: c.color }} />
                      </div>
                    </div>
                    {/* KPIs */}
                    <div className="grid grid-cols-3 gap-2 shrink-0 w-52">
                      {[
                        { v: `${c.recovery_pct}%`, l: 'Récup.', color: '#10b981' },
                        { v: `$${c.opex_usd_t}`,   l: 'OPEX/t', color: '#f88a44' },
                        { v: `${c.co2_t_oz}`,       l: 'CO₂ t/oz', color: '#38bdf8' },
                      ].map(m => (
                        <div key={m.l} className="text-center p-1.5 rounded bg-mf-panel border border-mf-border">
                          <div className="text-xs font-bold font-mono" style={{ color: m.color }}>{m.v}</div>
                          <div className="text-[9px] text-mf-txt4">{m.l}</div>
                        </div>
                      ))}
                    </div>
                    <ChevronDown size={14} className={`text-mf-txt4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </div>

                  {isOpen && (
                    <div className="border-t border-mf-border bg-mf-panel/50 px-5 py-4">
                      <div className="grid grid-cols-[200px_1fr_1fr] gap-5">
                        {/* Radar */}
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-mf-txt4 mb-2">Profil 6D</div>
                          <RadarChart dims={c.dimensions} color={c.color} />
                        </div>
                        {/* Dimension bars */}
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-mf-txt4 mb-2">Score par dimension</div>
                          {c.dimensions.map(d => <DimBar key={d.id} d={d} showRationale />)}
                        </div>
                        {/* Pros / cons + risk */}
                        <div className="space-y-3">
                          <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                            <div className="text-[9px] font-bold text-emerald-400 uppercase mb-2">Avantages</div>
                            {c.pros.map(p => (
                              <div key={p} className="flex items-start gap-1.5 text-[10px] text-mf-txt3 mb-1">
                                <CheckCircle2 size={9} className="text-emerald-400 shrink-0 mt-0.5" />{p}
                              </div>
                            ))}
                          </div>
                          <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                            <div className="text-[9px] font-bold text-red-400 uppercase mb-2">Contraintes</div>
                            {c.cons.map(p => (
                              <div key={p} className="flex items-start gap-1.5 text-[10px] text-mf-txt3 mb-1">
                                <AlertTriangle size={9} className="text-red-400 shrink-0 mt-0.5" />{p}
                              </div>
                            ))}
                          </div>
                          {c.risk_flags.length > 0 && (
                            <div className="rounded-lg bg-amber-500/8 border border-amber-500/20 p-3">
                              <div className="text-[9px] font-bold text-amber-400 uppercase mb-2">Signaux risque</div>
                              {c.risk_flags.map((f, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-300 mb-1">
                                  <Triangle size={8} className="text-amber-400 shrink-0 mt-0.5" />{f}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-mf-border/60 text-[9px] text-mf-txt4 italic">{c.basis}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── MATRICE 6D ────────────────────────────────────────────────── */}
        {tab === 'matrix' && (
          <div className="space-y-5">
            <div className="p-3 bg-blue-500/8 border border-blue-500/20 rounded-xl text-xs text-mf-txt3">
              <span className="font-semibold text-mf-txt">Matrice d'évaluation 6 dimensions</span> — chaque dimension est pondérée selon son importance stratégique. Le score total MetaScore reflète l'adéquation globale du circuit avec le profil minéralogique et économique du projet.
            </div>

            {/* Weight legend */}
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'Récupération', w: config.dim_weights.recovery, color: '#10b981' },
                { label: 'Économique', w: config.dim_weights.economics, color: '#f59e0b' },
                { label: 'Risque', w: config.dim_weights.risk, color: '#ef4444' },
                { label: 'Environnement', w: config.dim_weights.environment, color: '#06b6d4' },
                { label: 'Calendrier', w: config.dim_weights.schedule, color: '#8b5cf6' },
                { label: 'Données', w: config.dim_weights.dataQuality, color: '#6b7280' },
              ].map(d => (
                <div key={d.label} className="flex items-center gap-1.5 text-[10px] text-mf-txt3">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                  {d.label} <span className="font-mono text-mf-txt4">({(d.w * 100).toFixed(0)}%)</span>
                </div>
              ))}
            </div>

            {/* Full matrix table */}
            <div className="rounded-xl border border-mf-border bg-mf-card overflow-x-auto">
              <table className="tbl w-full">
                <thead>
                  <tr>
                    <th className="text-left w-36">Circuit</th>
                    <th className="text-center text-emerald-400">Récup.</th>
                    <th className="text-center text-amber-400">Écon.</th>
                    <th className="text-center text-red-400">Risque</th>
                    <th className="text-center text-cyan-400">Envir.</th>
                    <th className="text-center text-purple-400">Délai</th>
                    <th className="text-center text-mf-txt4">Data</th>
                    <th className="text-center font-bold text-mf-txt">Total</th>
                    <th className="text-right">Récup. %</th>
                    <th className="text-right">OPEX $/t</th>
                    <th className="text-right">CapEx</th>
                    <th className="text-right">CO₂ t/oz</th>
                  </tr>
                </thead>
                <tbody>
                  {circuits.map(c => {
                    const byId = (id: string) => c.dimensions.find(d => d.id === id)?.score ?? 0;
                    return (
                      <tr key={c.code} className={c.is_recommended ? 'bg-amber-500/5' : ''}>
                        <td>
                          <div className="flex items-center gap-1.5">
                            {c.is_recommended && <Star size={10} className="text-amber-400 fill-amber-400 shrink-0" />}
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                            <span className="text-xs font-medium text-mf-txt">{c.shortLabel}</span>
                          </div>
                        </td>
                        {['recovery', 'economics', 'risk', 'environment', 'schedule', 'dataQuality'].map(dim => {
                          const s = byId(dim);
                          return (
                            <td key={dim} className="text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs font-mono font-bold" style={{ color: s >= 75 ? '#10b981' : s >= 55 ? '#f59e0b' : '#ef4444' }}>{s.toFixed(0)}</span>
                                <div className="w-8 h-1 bg-mf-border/30 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${s}%`, backgroundColor: s >= 75 ? '#10b981' : s >= 55 ? '#f59e0b' : '#ef4444', opacity: 0.8 }} />
                                </div>
                              </div>
                            </td>
                          );
                        })}
                        <td className="text-center">
                          <span className={`text-sm font-bold font-mono ${c.is_recommended ? 'text-amber-400' : ''}`}>{c.totalScore}</span>
                        </td>
                        <td className="num text-emerald-400 font-bold">{c.recovery_pct}%</td>
                        <td className="num text-orange-400">${c.opex_usd_t}</td>
                        <td className="text-center">
                          <span className="text-[10px] font-semibold" style={{ color: capexMap[c.capex_indicator].color }}>{capexMap[c.capex_indicator].label}</span>
                        </td>
                        <td className="num text-cyan-400">{c.co2_t_oz}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Visual radar comparison */}
            <div className="grid grid-cols-4 gap-4">
              {circuits.slice(0, 4).map(c => (
                <div key={c.code} className={`rounded-xl border p-4 ${c.is_recommended ? 'border-amber-500/30 bg-amber-500/5' : 'border-mf-border bg-mf-card'}`}>
                  <div className="flex items-center gap-1.5 mb-2">
                    {c.is_recommended && <Star size={10} className="text-amber-400 fill-amber-400" />}
                    <div className="text-xs font-semibold text-mf-txt">{c.label}</div>
                  </div>
                  <RadarChart dims={c.dimensions} color={c.color} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ANALYSE PROFONDE ──────────────────────────────────────────── */}
        {tab === 'deep' && selectedC && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <label className="text-xs text-mf-txt4">Circuit analysé :</label>
              <select className="input-field flex-1 max-w-xs text-sm" value={selectedC.code}
                onChange={e => setSelectedCircuit(e.target.value)}>
                {circuits.map(c => <option key={c.code} value={c.code}>{c.label} — Score {c.totalScore}</option>)}
              </select>
            </div>

            {/* Full profile */}
            <div className="grid grid-cols-[280px_1fr] gap-5">
              <div className="space-y-4">
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-2">Profil radar 6D</div>
                  <RadarChart dims={selectedC.dimensions} color={selectedC.color} />
                </div>
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Indicateurs clés</div>
                  {[
                    { label: 'Score MetaScore', val: `${selectedC.totalScore} / 100`, color: selectedC.color },
                    { label: 'Récupération Au', val: `${selectedC.recovery_pct}%`, color: '#10b981' },
                    { label: 'OPEX estimé', val: `$${selectedC.opex_usd_t}/t milled`, color: '#f88a44' },
                    { label: 'CapEx relatif', val: capexMap[selectedC.capex_indicator].label, color: capexMap[selectedC.capex_indicator].color },
                    { label: 'CO₂ eq.', val: `${selectedC.co2_t_oz} t/oz Au`, color: '#38bdf8' },
                    { label: 'Eau process', val: `${selectedC.water_m3_t} m³/t`, color: '#06b6d4' },
                    { label: 'Mise en prod.', val: `${selectedC.commissioning_months} mois`, color: '#8b5cf6' },
                    { label: 'Indice NPV relatif', val: `${selectedC.npv_index} / 10`, color: '#fbbf24' },
                  ].map(k => (
                    <div key={k.label} className="stat-row">
                      <span className="stat-key">{k.label}</span>
                      <span className="stat-val font-mono font-bold" style={{ color: k.color }}>{k.val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {/* Dimension detail */}
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Décomposition des dimensions (pondérées)</div>
                  <div className="space-y-3">
                    {selectedC.dimensions.map(d => (
                      <div key={d.id} className="p-3 rounded-lg bg-mf-hover/20 border border-mf-border/50 cursor-pointer"
                        onClick={() => setExpandedDim(expandedDim === d.id ? null : d.id)}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                            <span className="text-xs font-semibold text-mf-txt">{d.label}</span>
                            <span className="text-[9px] text-mf-txt4">({(d.weight * 100).toFixed(0)}% poids)</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-bold" style={{ color: d.color }}>{d.score.toFixed(0)}/100</span>
                            <span className="text-[9px] text-mf-txt4">→ {(d.score * d.weight).toFixed(1)} pts</span>
                            <ChevronRight size={12} className={`text-mf-txt4 transition-transform ${expandedDim === d.id ? 'rotate-90' : ''}`} />
                          </div>
                        </div>
                        <div className="h-2 bg-mf-border/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${d.score}%`, backgroundColor: d.color, opacity: 0.75 }} />
                        </div>
                        {expandedDim === d.id && (
                          <div className="mt-2 pt-2 border-t border-mf-border/50">
                            <div className="text-[10px] text-mf-txt3">{d.rationale}</div>
                            {d.data_points && <div className="text-[9px] text-mf-txt4 mt-0.5 font-mono">{d.data_points}</div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tornado sensitivity */}
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen size={12} className="text-mf-txt4" />
                    <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Analyse de sensibilité — impact de chaque dimension sur le score total</div>
                  </div>
                  <TornadoChart circuit={selectedC} />
                  <div className="text-[9px] text-mf-txt4 mt-2 text-center">Distance par rapport à 50 — dimensions les plus impactantes en haut</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── SIMULATEUR ────────────────────────────────────────────────── */}
        {tab === 'scenarios' && (
          <div className="space-y-5">
            <div className="p-3 bg-blue-500/8 border border-blue-500/20 rounded-xl text-xs text-mf-txt3">
              <span className="font-semibold text-mf-txt">Simulateur de scénarios MetaScore</span> — ajustez les paramètres ci-dessous et observez en temps réel l'impact sur le classement et les scores de tous les circuits.
            </div>

            {/* Sliders */}
            <div className="rounded-xl border border-mf-border bg-mf-card p-5">
              <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-4">Paramètres de simulation</div>
              <div className="grid grid-cols-3 gap-6">
                {[
                  { label: 'Boost récupération lixiviation', key: 'leachBoost' as const, min: -15, max: 15, unit: '%', color: '#10b981', base: snap?.avg_leach_24h },
                  { label: 'Boost GRG gravimétrie', key: 'grgBoost' as const, min: -20, max: 30, unit: '%', color: '#f59e0b', base: snap?.avg_grg },
                  { label: 'Variation Bond Wi', key: 'bwiChange' as const, min: -5, max: 8, unit: 'kWh/t', color: '#38bdf8', base: snap?.avg_bwi },
                ].map(s => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs text-mf-txt3">{s.label}</label>
                      <span className="text-xs font-mono font-bold" style={{ color: s.color }}>
                        {scenario[s.key] >= 0 ? '+' : ''}{scenario[s.key]} {s.unit}
                      </span>
                    </div>
                    <input type="range" min={s.min} max={s.max} step="0.5"
                      value={scenario[s.key]}
                      onChange={e => setScenario(prev => ({ ...prev, [s.key]: +e.target.value }))}
                      className="w-full accent-amber-500" />
                    <div className="flex justify-between text-[9px] text-mf-txt4 mt-0.5">
                      <span>{s.min}{s.unit}</span>
                      <span className="text-mf-txt4">Base: {s.base?.toFixed(1) ?? '?'} {s.unit}</span>
                      <span>+{s.max}{s.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setScenario({ leachBoost: 0, grgBoost: 0, bwiChange: 0 })}
                className="mt-4 text-xs text-mf-txt4 hover:text-mf-txt transition-colors">
                Réinitialiser →
              </button>
            </div>

            {/* Scenario results */}
            <div className="grid grid-cols-2 gap-4">
              {/* Before */}
              <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Classement actuel (données LIMS)</div>
                <div className="space-y-2">
                  {circuits.slice(0, 5).map((c, i) => (
                    <div key={c.code} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-mf-txt4 w-4">{i + 1}</span>
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                      <span className="text-xs text-mf-txt3 flex-1">{c.shortLabel}</span>
                      <div className="w-24 h-1.5 bg-mf-border/30 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${c.totalScore}%`, backgroundColor: c.color, opacity: 0.7 }} />
                      </div>
                      <span className="text-xs font-mono font-bold text-mf-txt w-8 text-right">{c.totalScore}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* After scenario */}
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-400 mb-3">Classement simulé (avec ajustements)</div>
                <div className="space-y-2">
                  {scenarioCircuits.slice(0, 5).map((c, i) => {
                    const base = circuits.find(x => x.code === c.code);
                    const delta = base ? c.totalScore - base.totalScore : 0;
                    return (
                      <div key={c.code} className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-mf-txt4 w-4">{i + 1}</span>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="text-xs text-mf-txt3 flex-1">{c.shortLabel}</span>
                        <div className="w-24 h-1.5 bg-mf-border/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${c.totalScore}%`, backgroundColor: c.color, opacity: 0.8 }} />
                        </div>
                        <span className="text-xs font-mono font-bold text-mf-txt w-8 text-right">{c.totalScore}</span>
                        {delta !== 0 && (
                          <span className={`text-[10px] font-mono w-10 text-right ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {delta > 0 ? '+' : ''}{delta.toFixed(0)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORIQUE ────────────────────────────────────────────────── */}
        {tab === 'history' && (
          <div className="space-y-4">
            {saved.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Database size={36} className="text-mf-txt4 mb-3" />
                <div className="text-sm text-mf-txt3 mb-1">Aucune analyse enregistrée</div>
                <div className="text-xs text-mf-txt4">Lancez MetaScore pour sauvegarder les recommandations.</div>
              </div>
            ) : (
              <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th><th>Circuit</th>
                      <th className="text-center">Score</th>
                      <th className="text-right">Récup.</th>
                      <th className="text-right">OPEX</th>
                      <th className="text-center">Confiance</th>
                      <th className="text-center">Top 1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saved.map(r => (
                      <tr key={r.id} className={r.is_recommended ? 'bg-amber-500/5' : ''}>
                        <td className="text-[10px] text-mf-txt4 font-mono">{new Date(r.created_at).toLocaleString('fr-CA')}</td>
                        <td className="font-medium text-mf-txt text-xs">{r.circuit_label}</td>
                        <td className="text-center font-bold font-mono text-amber-400">{r.ai_score?.toFixed(0)}</td>
                        <td className="num text-emerald-400">{r.recovery_pct?.toFixed(1)}%</td>
                        <td className="num">${r.opex_usd_t?.toFixed(1)}</td>
                        <td className="text-center text-xs text-mf-txt3">{r.confidence}</td>
                        <td className="text-center">{r.is_recommended && <Star size={13} className="text-amber-400 fill-amber-400 mx-auto" />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── PARAMÈTRES METASCORE ──────────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="space-y-5 max-w-4xl">
            <div className="p-3 bg-blue-500/8 border border-blue-500/20 rounded-xl text-xs text-mf-txt3">
              <span className="font-semibold text-mf-txt">Paramètres MetaScore</span> — personnalisez les poids de scoring, seuils métallurgiques et formules OPEX pour ce projet. Les valeurs par défaut sont des références industrielles.
            </div>

            {/* Dimension weights */}
            <div className="card-sm">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Poids des dimensions (total doit être 100%)</div>
                <div className="text-xs font-mono text-mf-txt3">
                  Somme: <span className={`font-bold ${Math.abs(Object.values(config.dim_weights).reduce((a,b)=>a+b,0)-1) < 0.001 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(Object.values(config.dim_weights).reduce((a,b)=>a+b,0)*100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                {([
                  { key: 'recovery' as const,    label: 'Récupération métallurgique', color: '#10b981' },
                  { key: 'economics' as const,   label: 'Efficacité économique',       color: '#f59e0b' },
                  { key: 'risk' as const,        label: 'Profil de risque technique',  color: '#ef4444' },
                  { key: 'environment' as const, label: 'Empreinte environnementale',  color: '#06b6d4' },
                  { key: 'schedule' as const,    label: 'Rapidité mise en production', color: '#8b5cf6' },
                  { key: 'dataQuality' as const, label: 'Qualité & couverture données',color: '#6b7280' },
                ]).map(f => (
                  <div key={f.key}>
                    <label className="label flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.color }} />
                      {f.label}
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" max="1" step="0.01"
                        className="input-field flex-1 font-mono text-xs"
                        value={config.dim_weights[f.key]}
                        onChange={e => setConfig(prev => ({ ...prev, dim_weights: { ...prev.dim_weights, [f.key]: parseFloat(e.target.value) || 0 } }))}
                      />
                      <span className="text-xs text-mf-txt4 w-8 text-right">{(config.dim_weights[f.key]*100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Metallurgical thresholds */}
            <div className="card-sm">
              <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-4">Seuils métallurgiques</div>
              <div className="grid grid-cols-3 gap-4">
                {([
                  { key: 'preg_robbing_corg' as const,  label: 'Seuil Corg pré-robbing (%)',      unit: '%' },
                  { key: 'refractory_sulf' as const,    label: 'Seuil S réfractaire (%)',          unit: '%' },
                  { key: 'hard_ore_bwi' as const,       label: 'Seuil minerai dur BWI (kWh/t)',    unit: 'kWh/t' },
                  { key: 'high_grade_threshold' as const,label: 'Seuil haute teneur (g/t)',         unit: 'g/t' },
                  { key: 'heap_leach_kinetics' as const, label: 'Efficacité cinétique heap leach',  unit: '(0–1)' },
                  { key: 'min_tests_high_conf' as const, label: 'Tests min. confiance haute',        unit: 'tests' },
                  { key: 'min_tests_med_conf' as const,  label: 'Tests min. confiance moyenne',      unit: 'tests' },
                ] as { key: keyof MetascoreThresholds; label: string; unit: string }[]).map(f => (
                  <div key={f.key}>
                    <label className="label">{f.label} <span className="text-mf-txt4 font-normal">({f.unit})</span></label>
                    <input type="number" step="0.01"
                      className="input-field w-full font-mono text-xs"
                      value={config.thresholds[f.key]}
                      onChange={e => setConfig(prev => ({ ...prev, thresholds: { ...prev.thresholds, [f.key]: parseFloat(e.target.value) || 0 } }))}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* OPEX base formulas */}
            <div className="card-sm">
              <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-1">Formules OPEX (base + BWI × facteur)</div>
              <div className="text-[10px] text-mf-txt4 mb-4">OPEX circuit = base ($/t) + BWI moyen × facteur BWI ($/t per kWh/t)</div>
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      <th className="text-left">Circuit</th>
                      <th className="text-right">Base ($/t)</th>
                      <th className="text-right">Facteur BWI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {([
                      { key: 'cil' as const,        label: 'CIL Standard' },
                      { key: 'rip' as const,        label: 'Gravité + CIL/CIP' },
                      { key: 'heap' as const,       label: 'Heap Leach ROM' },
                      { key: 'flotation' as const,  label: 'Flottation (composant)' },
                      { key: 'pox' as const,        label: 'POX + CIL (réfractaire)' },
                      { key: 'bioxidation' as const,label: 'Biooxydation (référence)' },
                    ]).map(f => (
                      <tr key={f.key} className="border-b border-white/5">
                        <td className="px-3 py-2 text-mf-txt font-medium">{f.label}</td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.5"
                            className="input-field w-20 font-mono text-xs text-right"
                            value={config.opex_formulas[f.key].base}
                            onChange={e => setConfig(prev => ({ ...prev, opex_formulas: { ...prev.opex_formulas, [f.key]: { ...prev.opex_formulas[f.key], base: parseFloat(e.target.value) || 0 } } }))}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" step="0.01"
                            className="input-field w-20 font-mono text-xs text-right"
                            value={config.opex_formulas[f.key].bwi_factor}
                            onChange={e => setConfig(prev => ({ ...prev, opex_formulas: { ...prev.opex_formulas, [f.key]: { ...prev.opex_formulas[f.key], bwi_factor: parseFloat(e.target.value) || 0 } } }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Save / reset */}
            <div className="flex items-center gap-3">
              {configSaved && <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Paramètres sauvegardés</span>}
              <button onClick={() => setConfig(DEFAULT_CONFIG)} className="btn btn-secondary text-xs ml-auto">Réinitialiser défauts</button>
              <button onClick={saveConfig} disabled={savingConfig} className="btn bg-amber-500 text-black hover:bg-amber-400 text-xs font-semibold flex items-center gap-1.5">
                <Save size={12} /> {savingConfig ? 'Sauvegarde…' : 'Sauvegarder paramètres'}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
