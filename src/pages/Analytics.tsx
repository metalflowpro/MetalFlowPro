import { useState, useEffect, useMemo } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  FlaskConical, Layers, Zap, Droplets, BarChart3,
  TrendingUp, AlertTriangle, CheckCircle2, Info,
  RefreshCw, BookOpen, GitBranch, Microscope, Star,
  Activity, Target, Cpu, Sparkles, Brain,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { selectRecommendedRoute, ROUTE_ESTIMATION } from '../lib/analytics/routeSelection';
import {
  trainRecoveryModel, predictRecovery, predictWithCI, modelQuality,
  type TrainingSample, type PredictionInput,
} from '../lib/analytics/recoveryModel';
import { crossValidateRecovery, recommendGrind } from '../lib/analytics/recoveryValidation';
import { MechanisticRecoveryPanel } from '../components/analytics/MechanisticRecoveryPanel';
import { LeachCyanidePanel } from '../components/analytics/LeachCyanidePanel';
import { GeometClusters } from '../components/analytics/GeometClusters';
import { DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import type { Project } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LimsData {
  samples: Array<{ id: string; sample_id: string; domain: string | null; campaign: string | null }>;
  chem: Array<{ sample_id: string; au_g_t: number | null; s_total_pct: number | null; s_sulfide_pct: number | null; c_organic_pct: number | null; fe_pct: number | null; as_ppm: number | null; cu_pct: number | null }>;
  mineralogy: Array<{ sample_id: string; pyrite_pct: number | null; pyrrhotite_pct: number | null; au_free_pct: number | null; carbonates_pct: number | null; fe_oxides_pct: number | null }>;
  comminution: Array<{ sample_id: string; bwi_kwh_t: number | null; sg_t_m3: number | null; axb_jk: number | null }>;
  knelson: Array<{ sample_id: string; grg_recovery_pct: number | null; p80_feed_um: number | null }>;
  flotation: Array<{ sample_id: string; au_recovery_pct: number | null; s_recovery_pct: number | null; au_feed_g_t: number | null }>;
  leaching: Array<{ sample_id: string; leach_rec_24h_pct: number | null; leach_rec_48h_pct: number | null; nacn_consumption_kg_t: number | null; cao_consumption_kg_t: number | null; au_feed_g_t: number | null; leach_rec_2h_pct: number | null; leach_rec_4h_pct: number | null; leach_rec_8h_pct: number | null; leach_rec_12h_pct: number | null }>;
  elution: Array<{ sample_id: string; au_recovery_pct: number | null }>;
  liberation: Array<{ sample_id: string; p80_um: number | null; au_free_pct: number | null; au_sulphides_pct: number | null; au_silicates_pct: number | null; au_occluded_pct: number | null; au_preg_rob_pct: number | null }>;
}

interface RouteEstimate {
  route: string;
  recovery_pct: number;
  confidence: 'high' | 'medium' | 'low';
  /** 0–100 score based on how many LIMS tests support this route's key parameters. */
  dataQualityScore: number;
  basis: string;
  references: string[];
  recommended?: boolean;
  capex_indicator: 'low' | 'medium' | 'high';
  opex_indicator: 'low' | 'medium' | 'high';
}

interface GeometEntry {
  sample_id: string;
  domain: string | null;
  ore_type: 'Oxyde' | 'Sulfure' | 'Transition' | 'Indéterminé';
  recovery_driver: string;
  anomaly: string | null;
  recommendation: string;
  score: number; // 0-100 metallurgical score
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function robustMean(vals: (number | null | undefined)[]): number | null {
  const v = vals.filter((x): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function pct(n: number, total: number) { return total > 0 ? Math.round((n / total) * 100) : 0; }

// ─── Route engine ─────────────────────────────────────────────────────────────

function computeRoutes(data: LimsData): RouteEstimate[] {
  const leachRec = robustMean(data.leaching.map(t => t.leach_rec_24h_pct));
  const leachRec48 = robustMean(data.leaching.map(t => t.leach_rec_48h_pct));
  const grg = robustMean(data.knelson.map(t => t.grg_recovery_pct));
  const corg = robustMean(data.chem.map(t => t.c_organic_pct));
  const flotRec = robustMean(data.flotation.map(t => t.au_recovery_pct));

  // Data quality scoring: each route's confidence is weighted by how many
  // independent testwork results support its key parameters. A route based on
  // 2 leach tests is far less certain than one backed by 20.
  const nLeach = data.leaching.length;
  const nGrg = data.knelson.length;
  const nFlot = data.flotation.length;
  const nChem = data.chem.length;
  const nComm = data.comminution.length;
  const nMin = data.mineralogy.length;

  // 0–100 quality score from sample count: saturates at 15 tests per parameter.
  const qScore = (n: number): number => Math.min(100, Math.round((n / 15) * 100));
  // Weighted average of quality scores for the parameters a route depends on.
  const routeQuality = (params: { n: number; w: number }[]): number => {
    const totalW = params.reduce((s, p) => s + p.w, 0);
    return Math.round(params.reduce((s, p) => s + qScore(p.n) * p.w, 0) / totalW);
  };
  const sulfRec = robustMean(data.flotation.map(t => t.s_recovery_pct));
  const auFree = robustMean(data.mineralogy.map(t => t.au_free_pct));
  const sulfide = robustMean(data.chem.map(t => t.s_sulfide_pct));

  const pregPenalty = corg !== null && corg > ROUTE_ESTIMATION.pregRobbingCorgThresholdPct ? ROUTE_ESTIMATION.pregRobbingPenaltyPts : 0;
  const routes: RouteEstimate[] = [];

  // Helper: R_global = 1 - ∏(1 - Ri)  for sequential independent stages
  // Each Ri is expressed as a fraction (0–1). Returns percentage (0–100).
  function seriesRecovery(...stages: number[]): number {
    const global = 1 - stages.reduce((prod, r) => prod * (1 - r), 1);
    return Math.max(0, Math.min(100, global * 100));
  }

  // Route 1: Gravity + CIL
  // Gravity recovers R_grav of total feed. CIL treats the gravity tails (1 - R_grav fraction)
  // at efficiency R_leach_adj. R_global = 1 - (1 - R_grav)(1 - R_leach_adj)
  if (grg !== null && leachRec !== null) {
    // Shared lab→plant transfer factors (constants) — the same ones ProjectContext
    // applies to build the headline global recovery, so this route's estimate and
    // the Dashboard/Flowsheet figure agree by construction.
    const R_grav = (grg / 100) * DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY;
    const R_leach = ((leachRec - pregPenalty) / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY;
    const combined = seriesRecovery(R_grav, R_leach);
    routes.push({
      route: 'Gravité (Knelson) + CIL',
      recovery_pct: +combined.toFixed(1),
      confidence: grg > 10 ? 'high' : 'medium',
      dataQualityScore: routeQuality([{n: nGrg, w: 2}, {n: nLeach, w: 3}, {n: nChem, w: 1}]),
      basis: `R = 1−(1−${formatDecimalGrouped((R_grav*100), 1)}%)(1−${formatDecimalGrouped((R_leach*100), 1)}%) = ${formatDecimalGrouped(combined, 1)}% · Formule série — Laplante 2000`,
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Guidelines'],
      capex_indicator: 'medium',
      opex_indicator: 'low',
    });
  }

  // Route 2: Gravity + Leach + CIP
  // Same series formula: gravity on full feed, then CIP on tails with 48h leach kinetics
  if (grg !== null && leachRec !== null) {
    const R_grav = (grg / 100) * 0.88;
    const leach48eff = leachRec48 ?? leachRec;
    const R_cip = ((leach48eff - pregPenalty * 0.5) / 100) * 0.96;
    const combined = seriesRecovery(R_grav, R_cip);
    routes.push({
      route: 'Gravité + Lixiviation + CIP',
      recovery_pct: +combined.toFixed(1),
      confidence: 'medium',
      dataQualityScore: routeQuality([{n: nGrg, w: 2}, {n: nLeach, w: 3}, {n: nChem, w: 1}]),
      basis: `R = 1−(1−${formatDecimalGrouped((R_grav*100), 1)}%)(1−${formatDecimalGrouped((R_cip*100), 1)}%) = ${formatDecimalGrouped(combined, 1)}% · 48h leach + CIP`,
      references: ['Marsden & House, Gold Leaching, 3rd ed.', 'Adams M.D. (2016) — Gold Ore Processing'],
      capex_indicator: 'medium',
      opex_indicator: 'medium',
    });
  }

  // Route 3: Direct CIL/CIP (single stage — formula reduces to R = R_leach)
  if (leachRec !== null) {
    const rec = Math.max(0, Math.min(98, leachRec - pregPenalty));
    routes.push({
      route: 'Lixiviation directe CIL/CIP',
      recovery_pct: +rec.toFixed(1),
      confidence: rec >= 80 ? 'high' : rec >= 65 ? 'medium' : 'low',
      dataQualityScore: routeQuality([{n: nLeach, w: 3}, {n: nChem, w: 1}]),
      basis: `R = ${formatDecimalGrouped(rec, 1)}% (étape unique — bilan direct)${pregPenalty ? ` · −${pregPenalty}% pénalité Corg` : ''}`,
      references: ['CIM Best Practices — Metallurgical Testing', 'Marsden & House, Gold Leaching, 3rd ed.'],
      capex_indicator: 'medium',
      opex_indicator: 'medium',
    });
  }

  // Route 4: Flotation + Regrinding + Leach + CIP
  // Three sequential stages: flotation concentrates Au, regrind leach on conc., tail leach on flotation tails
  // Mass-balance approach: R_global = (Au_conc_leached + Au_tails_leached) / Au_feed
  if (flotRec !== null && leachRec !== null) {
    const R_flot = flotRec / 100 * 0.94;                            // flotation Au recovery efficiency
    const R_leach_conc = Math.min(0.97, (leachRec + 5) / 100);     // elevated leach kinetics after regrind
    const R_leach_tails = Math.max(0, (leachRec - 10) / 100) * 0.75; // leach on flotation tails (slower)
    // Mass-balance: fraction from conc stream + fraction from tails stream
    const auFromConc  = R_flot * R_leach_conc;
    const auFromTails = (1 - R_flot) * R_leach_tails;
    const combined = Math.min(97, (auFromConc + auFromTails) * 100);
    routes.push({
      route: 'Flottation + Rebroyage + Leach + CIP',
      recovery_pct: +combined.toFixed(1),
      confidence: sulfide !== null && sulfide > 1 ? 'medium' : 'low',
      dataQualityScore: routeQuality([{n: nFlot, w: 2}, {n: nLeach, w: 2}, {n: nChem, w: 1}, {n: nComm, w: 1}]),
      basis: `Bilan massique: or_conc(${formatDecimalGrouped((auFromConc*100), 1)}%) + or_queues(${formatDecimalGrouped((auFromTails*100), 1)}%) = ${formatDecimalGrouped(combined, 1)}%`,
      references: ['Wills B.A. — Mineral Processing Technology, 8th ed.'],
      capex_indicator: 'high',
      opex_indicator: 'medium',
    });
  }

  // Route 5: Flotation + POX/Roasting + CIL (refractory ore — three stages in series)
  if (sulfide !== null && sulfide > 2 && leachRec !== null) {
    const R_flot = (flotRec ?? 85) / 100 * 0.93;                   // float sulphides
    const R_pox  = 0.97;                                             // POX/roasting liberates ~97% of locked Au
    const R_cil  = Math.min(0.97, (leachRec + 8 - pregPenalty) / 100);
    const combined = seriesRecovery(R_flot, R_pox, R_cil);
    routes.push({
      route: 'Flottation + Prétraitement (POX/Roasting) + CIL',
      recovery_pct: +combined.toFixed(1),
      confidence: pregPenalty > 0 ? 'high' : 'medium',
      dataQualityScore: routeQuality([{n: nFlot, w: 2}, {n: nLeach, w: 2}, {n: nChem, w: 2}, {n: nMin, w: 1}]),
      basis: `R = 1−(1−${formatDecimalGrouped((R_flot*100), 1)}%)(1−${formatDecimalGrouped((R_pox*100), 0)}%)(1−${formatDecimalGrouped((R_cil*100), 1)}%) = ${formatDecimalGrouped(combined, 1)}%`,
      references: ['Adams M.D. (2016) — Gold Ore Processing', 'CIM Best Practices'],
      capex_indicator: 'high',
      opex_indicator: 'high',
    });
  }

  // Fallback: Heap Leach (single-stage, oxide ore)
  if (routes.length < 3 && leachRec !== null && auFree !== null && auFree > ROUTE_ESTIMATION.heapLeachMinAuFreePct) {
    const rec = Math.max(0, Math.min(ROUTE_ESTIMATION.heapLeachMaxRecoveryPct, leachRec * ROUTE_ESTIMATION.heapLeachEfficiency));
    routes.push({
      route: 'Lixiviation en tas (Heap Leach)',
      recovery_pct: +rec.toFixed(1),
      confidence: 'low',
      dataQualityScore: routeQuality([{n: nLeach, w: 2}, {n: nMin, w: 1}]),
      basis: `R = ${formatDecimalGrouped(rec, 1)}% (étape unique — cinétique colonne, Au libre ${formatDecimalGrouped(auFree, 0)}%)`,
      references: ['Marsden & House, Gold Leaching, 3rd ed. — Heap Leach Chapter'],
      capex_indicator: 'low',
      opex_indicator: 'low',
    });
  }

  // ── Single, reconciled recommendation ──────────────────────────────────────
  // This must live here, not in a tab: the reconciliation used to be applied only
  // inside the "Route Métallurgique" view, so "Synthèse LIMS" read the raw
  // highest-recovery flag and the two tabs recommended different circuits
  // (Gravité+Lixiviation+CIP 91 % vs Gravité+CIL 90 %) for the same project.
  //
  // Rule: take the highest recovery, but on a near-tie (≤1.5 pt, inside the noise
  // of the testwork) prefer the circuit whose adsorption stage matches the CIL/CIP
  // analysis — so the headline circuit and the adsorption advice never contradict.
  const sorted = routes.sort((a, b) => b.recovery_pct - a.recovery_pct);
  const best = selectRecommendedRoute(sorted, cilVsCip(data).recommendation);
  sorted.forEach(r => { r.recommended = r === best; });
  return sorted;
}

// ─── CIL vs CIP recommendation helper ────────────────────────────────────────

function cilVsCip(data: LimsData): { recommendation: 'CIL' | 'CIP'; reasons: string[]; warnings: string[] } {
  const corg = robustMean(data.chem.map(t => t.c_organic_pct));
  const auFeed = robustMean(data.leaching.map(t => t.au_feed_g_t));
  const nacn = robustMean(data.leaching.map(t => t.nacn_consumption_kg_t));
  const sulfide = robustMean(data.chem.map(t => t.s_sulfide_pct));

  const reasons: string[] = [];
  const warnings: string[] = [];
  let cilScore = 0, cipScore = 0;

  if (corg !== null && corg > 0.2) {
    cipScore += 3;
    warnings.push(`Corg ${formatDecimalGrouped(corg, 2)}% > 0.2% — risque prég-robbing; CIP isole le carbone actif`);
  } else {
    cilScore += 2;
    reasons.push('Corg faible — pas de risque prég-robbing, CIL simplifié');
  }

  if (nacn !== null && nacn > 2.5) {
    cipScore += 2;
    reasons.push(`NaCN ${formatDecimalGrouped(nacn, 1)} kg/t (élevé) — CIP réduit pertes cyanure`);
  } else {
    cilScore += 1;
  }

  if (auFeed !== null && auFeed > 5) {
    cipScore += 1;
    reasons.push(`Au tête élevé (${formatDecimalGrouped(auFeed, 1)} g/t) — CIP plus adapté pour teneurs riches`);
  } else {
    cilScore += 2;
    reasons.push(`Au tête modéré — CIL suffisant, investissement réduit`);
  }

  if (sulfide !== null && sulfide > 1.5) {
    cipScore += 1;
    warnings.push(`S sulf. ${formatDecimalGrouped(sulfide, 2)}% — sulfures peuvent interférer avec carbone actif en CIL`);
  }

  const recommendation = cipScore > cilScore ? 'CIP' : 'CIL';
  if (recommendation === 'CIL' && reasons.filter(r => r.includes('CIL')).length === 0) {
    reasons.push('Circuit CIL recommandé — plus simple, capex réduit, adapté au profil du minerai');
  }
  if (recommendation === 'CIP' && reasons.filter(r => r.includes('CIP')).length === 0) {
    reasons.push('Circuit CIP recommandé — meilleure gestion carbone actif, adapté aux minerais complexes');
  }

  return { recommendation, reasons, warnings };
}

// ─── Geomét analysis ─────────────────────────────────────────────────────────

function computeGeomet(data: LimsData): GeometEntry[] {
  const sampleMap = new Map(data.samples.map(s => [s.id, s]));

  const entries: GeometEntry[] = [];
  const chemMap = new Map(data.chem.map(r => [r.sample_id, r]));
  const minMap = new Map(data.mineralogy.map(r => [r.sample_id, r]));
  const leachMap = new Map(data.leaching.map(r => [r.sample_id, r]));
  const flotMap = new Map(data.flotation.map(r => [r.sample_id, r]));

  const allSampleIds = new Set([
    ...data.chem.map(r => r.sample_id),
    ...data.mineralogy.map(r => r.sample_id),
    ...data.leaching.map(r => r.sample_id),
  ]);

  for (const sid of allSampleIds) {
    const sample = sampleMap.get(sid);
    const chem = chemMap.get(sid);
    const min = minMap.get(sid);
    const leach = leachMap.get(sid);
    const flot = flotMap.get(sid);

    const au = chem?.au_g_t ?? null;
    const sSulf = chem?.s_sulfide_pct ?? null;
    const corg = chem?.c_organic_pct ?? null;
    const pyrite = min?.pyrite_pct ?? null;
    const auFree = min?.au_free_pct ?? null;
    const leachRec = leach?.leach_rec_24h_pct ?? null;
    const flotRecVal = flot?.au_recovery_pct ?? null;

    // Ore type classification
    let ore_type: GeometEntry['ore_type'] = 'Indéterminé';
    if (sSulf !== null && chem?.fe_pct !== null) {
      if (sSulf < 0.3) ore_type = 'Oxyde';
      else if (sSulf > 1.5) ore_type = 'Sulfure';
      else ore_type = 'Transition';
    }

    // Recovery driver
    let recovery_driver = 'Indéterminé';
    const drivers: string[] = [];
    if (auFree !== null && auFree > 50) drivers.push(`Au libre ${formatDecimalGrouped(auFree, 0)}% (lixiviation directe favorable)`);
    if (pyrite !== null && pyrite > 5) drivers.push(`Pyrite ${formatDecimalGrouped(pyrite, 1)}% (flottation / prétraitement)`);
    if (corg !== null && corg > 0.2) drivers.push(`Corg ${formatDecimalGrouped(corg, 2)}% (risque prég-robbing)`);
    if (drivers.length) recovery_driver = drivers.join(' · ');

    // Anomalies
    const anomalies: string[] = [];
    if (au !== null && au > 10) anomalies.push(`Teneur Au élevée (${formatDecimalGrouped(au, 2)} g/t)`);
    if (corg !== null && corg > 0.5) anomalies.push('Corg › 0.5% — prég-robbing sévère');
    if (leachRec !== null && leachRec < 50) anomalies.push(`Récup. lixiviation faible (${formatDecimalGrouped(leachRec, 0)}%)`);
    if (sSulf !== null && sSulf > 5) anomalies.push(`Sulfures élevés (S sulf. ${formatDecimalGrouped(sSulf, 1)}%)`);

    // Recommendation
    let recommendation = 'Données insuffisantes pour recommandation.';
    if (leachRec !== null) {
      if (leachRec >= 85 && (corg ?? 0) < 0.2) recommendation = 'CIL/CIP direct — fort potentiel. Prioriser essais en continu.';
      else if (leachRec >= 70 && (corg ?? 0) >= 0.2) recommendation = 'CIL avec prétraitement Corg (ozone ou carbone actif pré-conditionné).';
      else if (leachRec >= 60) recommendation = 'Évaluer gravimétrie + lixiviation résidu. Confirmer P80 optimal.';
      else if (sSulf !== null && sSulf > 2) recommendation = 'Minéral réfractaire. Évaluer flottation + POX/roasting avant lixiviation.';
      else recommendation = 'Récupération faible — compléter caractérisation minéralogique.';
    } else if (auFree !== null) {
      if (auFree > 70) recommendation = 'Au très libre — heap leach ou gravimétrie viable. Lancer essais D1.';
      else recommendation = 'Lancer essais de lixiviation (D1) pour qualifier la récupération.';
    }

    // Score (0–100)
    let score = 50;
    if (leachRec !== null) score = Math.min(100, leachRec - (corg ?? 0) * ROUTE_ESTIMATION.corgScorePenaltyPerPct + (auFree !== null && auFree > ROUTE_ESTIMATION.highAuFreeThresholdPct ? ROUTE_ESTIMATION.highAuFreeBonusPts : 0));
    if (flotRecVal !== null) score = Math.max(score, flotRecVal * ROUTE_ESTIMATION.flotationScoreFactor);

    entries.push({
      sample_id: sample?.sample_id ?? sid.slice(0, 8),
      domain: sample?.domain ?? null,
      ore_type,
      recovery_driver,
      anomaly: anomalies.length ? anomalies.join(' | ') : null,
      recommendation,
      score: Math.round(Math.max(0, Math.min(100, score))),
    });
  }

  return entries.sort((a, b) => b.score - a.score);
}

// ─── SVG Histogram ────────────────────────────────────────────────────────────

function Histogram({ values, label, unit, bins = 8, color = '#f59e0b' }: {
  values: number[]; label: string; unit: string; bins?: number; color?: string;
}) {
  const HW = 320, HH = 100, HPAD = 4;
  if (values.length === 0) {
    return (
      <div>
        <div className="text-xs font-semibold text-mf-txt mb-1">{label}</div>
        <div className="flex items-center justify-center h-24 text-xs text-mf-txt4 rounded-lg border border-dashed border-mf-border/50">Pas de données LIMS</div>
      </div>
    );
  }
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const binW = range / bins;
  const counts = Array(bins).fill(0);
  values.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - minV) / binW))]++; });
  const maxCount = Math.max(...counts, 1);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const barW = (HW - HPAD * 2) / bins;

  return (
    <div>
      <div className="text-xs font-semibold text-mf-txt mb-1">
        {label} <span className="text-mf-txt4 font-normal text-[10px]">n={values.length} · μ={formatDecimalGrouped(avg, 2)} {unit}</span>
      </div>
      <svg viewBox={`0 0 ${HW} ${HH + 18}`} className="w-full" style={{ height: 118 }}>
        {/* grid lines */}
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={HPAD} y1={HH - f * HH} x2={HW - HPAD} y2={HH - f * HH} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {/* bars */}
        {counts.map((c, i) => {
          const bh = Math.max(c > 0 ? 4 : 0, (c / maxCount) * HH);
          const x = HPAD + i * barW + 1;
          const w = barW - 2;
          const opacity = 0.45 + (c / maxCount) * 0.5;
          return (
            <g key={i}>
              <rect x={x} y={HH - bh} width={w} height={bh} fill={color} opacity={opacity} rx="2" />
              {c > 0 && bh > 14 && (
                <text x={x + w / 2} y={HH - bh + 10} fill="white" fontSize="8" textAnchor="middle" opacity="0.9">{c}</text>
              )}
            </g>
          );
        })}
        {/* mean line */}
        {(() => {
          const mx = HPAD + ((avg - minV) / range) * (HW - HPAD * 2);
          return (
            <line x1={mx} y1={0} x2={mx} y2={HH} stroke={color} strokeWidth="1.5" strokeDasharray="3 2" opacity="0.8" />
          );
        })()}
        {/* x-axis labels */}
        <text x={HPAD} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="start">{formatDecimalGrouped(minV, 1)}</text>
        <text x={HW / 2} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="middle">{unit}</text>
        <text x={HW - HPAD} y={HH + 13} fill="#56657A" fontSize="9" textAnchor="end">{formatDecimalGrouped(maxV, 1)}</text>
      </svg>
    </div>
  );
}

// ─── SVG Scatter ─────────────────────────────────────────────────────────────

function ScatterPlot({ xVals, yVals, xLabel, yLabel, color = '#f59e0b' }: {
  xVals: number[]; yVals: number[]; xLabel: string; yLabel: string; color?: string;
}) {
  if (xVals.length < 2) {
    return <div className="flex items-center justify-center h-36 text-xs text-mf-txt4">Données insuffisantes (min. 2 points)</div>;
  }
  const W = 260, H = 140, PAD = 28;
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const scaleX = (v: number) => PAD + ((v - xMin) / (xMax - xMin || 1)) * (W - PAD * 2);
  const scaleY = (v: number) => H - PAD - ((v - yMin) / (yMax - yMin || 1)) * (H - PAD * 2);

  // Simple linear regression
  const n = xVals.length;
  const xMean = xVals.reduce((a, b) => a + b, 0) / n;
  const yMean = yVals.reduce((a, b) => a + b, 0) / n;
  const num = xVals.reduce((s, x, i) => s + (x - xMean) * (yVals[i] - yMean), 0);
  const den = xVals.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const slope = den !== 0 ? num / den : 0;
  const intercept = yMean - slope * xMean;
  const r = den !== 0 ? num / Math.sqrt(den * yVals.reduce((s, y) => s + (y - yMean) ** 2, 0)) : 0;

  const lineX1 = xMin, lineY1 = slope * xMin + intercept;
  const lineX2 = xMax, lineY2 = slope * xMax + intercept;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 140 }}>
        {/* axes */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.1)" />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.1)" />
        {/* regression line */}
        <line x1={scaleX(lineX1)} y1={scaleY(lineY1)} x2={scaleX(lineX2)} y2={scaleY(lineY2)}
          stroke={color} strokeWidth="1" strokeDasharray="4 2" opacity="0.5" />
        {/* points */}
        {xVals.map((x, i) => (
          <circle key={i} cx={scaleX(x)} cy={scaleY(yVals[i])} r="3" fill={color} opacity="0.75" />
        ))}
        {/* axis labels */}
        <text x={W / 2} y={H - 2} fill="#6b7280" fontSize="8" textAnchor="middle">{xLabel}</text>
        <text x={8} y={H / 2} fill="#6b7280" fontSize="8" textAnchor="middle" transform={`rotate(-90,8,${H / 2})`}>{yLabel}</text>
      </svg>
      <div className="text-[10px] text-mf-txt4 text-right">r = {formatDecimalGrouped(r, 2)}{Math.abs(r) > 0.7 ? ' ✓ corrélation forte' : Math.abs(r) > 0.4 ? ' ~ corrélation modérée' : ' ✗ corrélation faible'}</div>
    </div>
  );
}

// ─── RouteBar ─────────────────────────────────────────────────────────────────

function RouteBar({ route, maxRec }: { route: RouteEstimate; maxRec: number }) {
  const pctWidth = maxRec > 0 ? (route.recovery_pct / maxRec) * 100 : 0;
  const p = { high: { fg: '#10b981', bg: 'bg-emerald-500/15 border-emerald-500/25', text: 'text-emerald-400' }, medium: { fg: '#f59e0b', bg: 'bg-amber-500/15 border-amber-500/25', text: 'text-amber-400' }, low: { fg: '#6b7280', bg: 'bg-mf-border/30 border-mf-border/50', text: 'text-mf-txt4' } };
  const c = p[route.confidence];
  const capexColor = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-red-400' };
  return (
    <div className={`mb-3 p-3 rounded-xl border transition-all ${route.recommended ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-mf-border/50 bg-mf-hover/20'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {route.recommended && <Star size={11} className="text-emerald-400 fill-emerald-400" />}
          <span className="text-xs font-medium text-mf-txt">{route.route}</span>
        </div>
        <span className={`text-sm font-mono font-bold ${route.recommended ? 'text-emerald-400' : 'text-mf-txt'}`}>{route.recovery_pct}%</span>
      </div>
      <div className="h-1.5 bg-mf-border/30 rounded-full overflow-hidden mb-2">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pctWidth}%`, backgroundColor: c.fg }} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${c.bg} ${c.text}`}>{route.confidence.toUpperCase()}</span>
        <span className="text-[9px] text-mf-txt4">CapEx: <span className={capexColor[route.capex_indicator]}>{route.capex_indicator.toUpperCase()}</span></span>
        <span className="text-[9px] text-mf-txt4">OpEx: <span className={capexColor[route.opex_indicator]}>{route.opex_indicator.toUpperCase()}</span></span>
        <span className="text-[10px] text-mf-txt4 flex-1 leading-tight">{route.basis}</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { project: Project; }

export function Analytics({ project }: Props) {
  const [data, setData] = useState<LimsData>({ samples: [], chem: [], mineralogy: [], comminution: [], knelson: [], flotation: [], leaching: [], elution: [], liberation: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'synthese' | 'charts' | 'correlations' | 'routes' | 'geomet' | 'prediction'>('synthese');

  useEffect(() => { loadData(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true);
    const [samples, chem, min, comm, knel, flot, leach, elu, lib] = await Promise.all([
      supabase.from('lims_samples').select('id,sample_id,domain,campaign').eq('project_id', project.id),
      supabase.from('lims_test_chem').select('*').eq('project_id', project.id),
      supabase.from('lims_test_mineralogy').select('sample_id,pyrite_pct,pyrrhotite_pct,au_free_pct,carbonates_pct,fe_oxides_pct').eq('project_id', project.id),
      supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3,axb_jk').eq('project_id', project.id),
      supabase.from('lims_test_knelson').select('sample_id,grg_recovery_pct,p80_feed_um').eq('project_id', project.id),
      supabase.from('lims_test_flotation').select('sample_id,au_recovery_pct,s_recovery_pct,au_feed_g_t').eq('project_id', project.id),
      supabase.from('lims_test_leaching').select('*').eq('project_id', project.id),
      supabase.from('lims_test_elution').select('sample_id,au_recovery_pct').eq('project_id', project.id),
      supabase.from('lims_test_liberation').select('sample_id,p80_um,au_free_pct,au_sulphides_pct,au_silicates_pct,au_occluded_pct,au_preg_rob_pct').eq('project_id', project.id),
    ]);
    setData({
      samples: (samples.data ?? []) as LimsData['samples'],
      chem: (chem.data ?? []) as LimsData['chem'],
      mineralogy: (min.data ?? []) as LimsData['mineralogy'],
      comminution: (comm.data ?? []) as LimsData['comminution'],
      knelson: (knel.data ?? []) as LimsData['knelson'],
      flotation: (flot.data ?? []) as LimsData['flotation'],
      leaching: (leach.data ?? []) as LimsData['leaching'],
      elution: (elu.data ?? []) as LimsData['elution'],
      liberation: (lib.data ?? []) as LimsData['liberation'],
    });
    setLoading(false);
  }

  const routes = computeRoutes(data);
  const maxRec = routes.length > 0 ? Math.max(...routes.map(r => r.recovery_pct)) : 100;
  const geomet = computeGeomet(data);
  const hasPregRobbing = (robustMean(data.chem.map(t => t.c_organic_pct)) ?? 0) > 0.2;
  const corgMean = robustMean(data.chem.map(t => t.c_organic_pct));

  const totalTests = data.chem.length + data.mineralogy.length + data.comminution.length +
    data.knelson.length + data.flotation.length + data.leaching.length;

  const TABS = [
    { id: 'synthese' as const,      label: 'Synthèse LIMS',         icon: <BarChart3 size={13}/> },
    { id: 'charts' as const,        label: 'Courbes & Histogrammes', icon: <Activity size={13}/> },
    { id: 'correlations' as const,  label: 'Corrélations',          icon: <GitBranch size={13}/> },
    { id: 'routes' as const,        label: 'Route Métallurgique',    icon: <TrendingUp size={13}/> },
    { id: 'geomet' as const,        label: 'Géométallurgie',         icon: <Cpu size={13}/> },
    { id: 'prediction' as const,    label: 'Prédiction IA',          icon: <Sparkles size={13}/> },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Analyse et Interprétation"
        subtitle={`${project.code} · ${data.samples.length} échantillons · ${totalTests} résultats de tests`}
        actions={
          <button onClick={loadData} className="btn btn-secondary gap-1.5 text-xs py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Actualiser
          </button>
        }
      />

      <div className="border-b border-mf-border px-6 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${activeTab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-mf-txt4 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Chargement données LIMS…
          </div>
        ) : totalTests === 0 && data.samples.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <FlaskConical size={32} className="text-mf-txt4 mb-3" />
            <p className="text-sm font-semibold text-mf-txt mb-1">Aucune donnée LIMS disponible</p>
            <p className="text-xs text-mf-txt4 max-w-xs">Importez des échantillons et des résultats de tests dans le module LIMS pour générer l'analyse.</p>
          </div>
        ) : (
          <>
            {hasPregRobbing && (
              <div className="mb-5 p-3 bg-red-500/10 border border-red-500/25 rounded-lg flex items-start gap-3">
                <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-red-400 mb-0.5">Risque Prég-Robbing Détecté</div>
                  <div className="text-xs text-mf-txt3">Corg moyen = {corgMean!.toFixed(2)}% › seuil 0.20%. Circuit CIL avec prétraitement recommandé.</div>
                </div>
              </div>
            )}
            {activeTab === 'synthese' && <SyntheseTab data={data} routes={routes} hasPregRobbing={hasPregRobbing} />}
            {activeTab === 'charts' && <ChartsTab data={data} />}
            {activeTab === 'correlations' && <CorrelationsTab data={data} />}
            {activeTab === 'routes' && <RoutesTab routes={routes} maxRec={maxRec} data={data} />}
            {activeTab === 'geomet' && <GeometTab entries={geomet} data={data} />}
            {activeTab === 'prediction' && <PredictionTab data={data} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Synthèse LIMS ──────────────────────────────────────────────────────

function SyntheseTab({ data, routes, hasPregRobbing }: { data: LimsData; routes: RouteEstimate[]; hasPregRobbing: boolean }) {
  const auMean = robustMean(data.chem.map(t => t.au_g_t));
  const bwiMean = robustMean(data.comminution.map(t => t.bwi_kwh_t));
  const grgMean = robustMean(data.knelson.map(t => t.grg_recovery_pct));
  const leachMean = robustMean(data.leaching.map(t => t.leach_rec_24h_pct));
  const leach48Mean = robustMean(data.leaching.map(t => t.leach_rec_48h_pct));
  const nacnMean = robustMean(data.leaching.map(t => t.nacn_consumption_kg_t));
  const caoMean = robustMean(data.leaching.map(t => t.cao_consumption_kg_t));
  const flotMean = robustMean(data.flotation.map(t => t.au_recovery_pct));
  const pyMean = robustMean(data.mineralogy.map(t => t.pyrite_pct));
  const auFreeMean = robustMean(data.mineralogy.map(t => t.au_free_pct));

  const KPIs = [
    { label: 'Échantillons', val: data.samples.length, unit: '', icon: <FlaskConical size={14} className="text-amber-400"/>, color: '#F59E0B' },
    { label: 'Au tête moy.', val: auMean, unit: 'g/t', icon: <Target size={14} className="text-amber-400"/>, color: '#F59E0B' },
    { label: 'Récup. lixiv. 24h', val: leachMean, unit: '%', icon: <Droplets size={14} className="text-emerald-400"/>, color: '#10B981' },
    { label: 'Récup. lixiv. 48h', val: leach48Mean, unit: '%', icon: <Droplets size={14} className="text-teal-400"/>, color: '#059669' },
    { label: 'GRG moy.', val: grgMean, unit: '%', icon: <Layers size={14} className="text-teal-400"/>, color: '#2ECC8A' },
    { label: 'Bond Wi moy.', val: bwiMean, unit: 'kWh/t', icon: <Zap size={14} className="text-sky-400"/>, color: '#5BA4F5' },
    { label: 'Cons. NaCN', val: nacnMean, unit: 'kg/t', icon: <Activity size={14} className="text-purple-400"/>, color: '#9D78F0' },
    { label: 'Cons. CaO', val: caoMean, unit: 'kg/t', icon: <Activity size={14} className="text-orange-400"/>, color: '#F88A44' },
  ];

  const families = [
    { label: 'Analyse chimique', n: data.chem.length, color: '#F59E0B' },
    { label: 'Minéralogie', n: data.mineralogy.length, color: '#9D78F0' },
    { label: 'Comminution', n: data.comminution.length, color: '#5BA4F5' },
    { label: 'Gravimétrie', n: data.knelson.length, color: '#2ECC8A' },
    { label: 'Flottation', n: data.flotation.length, color: '#F88A44' },
    { label: 'Lixiviation', n: data.leaching.length, color: '#10B981' },
    { label: 'Élution ADR', n: data.elution.length, color: '#F06B6B' },
  ];

  const recommended = routes.find(r => r.recommended);

  return (
    <div className="space-y-5">
      {/* KPI grid */}
      <div className="grid grid-cols-4 gap-3">
        {KPIs.map(k => (
          <div key={k.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{k.icon}</div>
              <span className="text-[10px] text-mf-txt4 leading-tight">{k.label}</span>
            </div>
            <div className="text-xl font-mono font-bold text-mf-txt">
              {typeof k.val === 'number' ? (
                <>
                  {k.val < 10 ? formatDecimalGrouped(k.val, 2) : formatDecimalGrouped(k.val, 1)}
                  <span className="text-xs text-mf-txt4 font-normal ml-1">{k.unit}</span>
                </>
              ) : k.val === null ? (
                <span className="text-sm text-mf-txt4">N/A</span>
              ) : (
                <>
                  {k.val}
                  <span className="text-xs text-mf-txt4 font-normal ml-1">{k.unit}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Recommended route banner */}
      {recommended && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
            <Star size={18} className="text-emerald-400 fill-emerald-400" />
          </div>
          <div className="flex-1">
            <div className="text-xs font-bold text-emerald-400 mb-0.5">Route recommandée</div>
            <div className="text-sm font-semibold text-mf-txt">{recommended.route}</div>
            <div className="text-xs text-mf-txt3 mt-0.5">{recommended.basis}</div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-mono font-bold text-emerald-400">{recommended.recovery_pct}%</div>
            <div className="text-[10px] text-mf-txt4">Récupération estimée</div>
          </div>
        </div>
      )}

      {/* Mineralogy summary */}
      {(pyMean !== null || auFreeMean !== null || flotMean !== null) && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Indicateurs minéralogiques & métallurgiques</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Au libre (MLA)', val: auFreeMean, unit: '%', warn: auFreeMean !== null && auFreeMean < 40, note: '< 40% — complexité de libération' },
              { label: 'Pyrite', val: pyMean, unit: '%', warn: pyMean !== null && pyMean > 8, note: '> 8% — risque d\'interférence flottation' },
              { label: 'Récup. flottation Au', val: flotMean, unit: '%', warn: flotMean !== null && flotMean < 75, note: '< 75% — flottation sous-performante' },
              { label: 'Corg (prég-robbing)', val: robustMean(data.chem.map(t => t.c_organic_pct)), unit: '%', warn: hasPregRobbing, note: '> 0.2% — circuit CIL avec prétraitement' },
            ].filter(f => f.val !== null).map(f => (
              <div key={f.label} className="flex items-center justify-between p-2 rounded-lg bg-mf-hover/30 border border-mf-border/50">
                <span className="text-xs text-mf-txt3">{f.label}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono font-semibold ${f.warn ? 'text-amber-400' : 'text-mf-txt'}`}>
                    {f.val!.toFixed(2)} {f.unit}
                  </span>
                  {f.warn ? <AlertTriangle size={11} className="text-amber-400" /> : <CheckCircle2 size={11} className="text-emerald-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completeness */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Complétude programme de testwork</div>
        <div className="grid grid-cols-4 gap-2">
          {families.map(f => (
            <div key={f.label} className="p-3 rounded-lg bg-mf-hover border border-mf-border/60 text-center">
              <div className="text-lg font-bold text-mf-txt font-mono">{f.n}</div>
              <div className="text-[10px] text-mf-txt4 mt-0.5 mb-2 leading-tight">{f.label}</div>
              <div className="h-1 bg-mf-border rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, f.n * 10)}%`, backgroundColor: f.color, opacity: 0.65 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Courbes & Histogrammes ─────────────────────────────────────────────

function ChartsTab({ data }: { data: LimsData }) {
  const auVals     = data.chem.map(t => t.au_g_t).filter((v): v is number => v !== null && v > 0);
  const bwiVals    = data.comminution.map(t => t.bwi_kwh_t).filter((v): v is number => v !== null && v > 0);
  const grgVals    = data.knelson.map(t => t.grg_recovery_pct).filter((v): v is number => v !== null && v > 0);
  const leachVals  = data.leaching.map(t => t.leach_rec_24h_pct).filter((v): v is number => v !== null && v > 0);
  const flotVals   = data.flotation.map(t => t.au_recovery_pct).filter((v): v is number => v !== null && v > 0);
  const pyVals     = data.mineralogy.map(t => t.pyrite_pct).filter((v): v is number => v !== null && v > 0);
  const auFreeVals = data.mineralogy.map(t => t.au_free_pct).filter((v): v is number => v !== null && v > 0);
  const nacnVals   = data.leaching.map(t => t.nacn_consumption_kg_t).filter((v): v is number => v !== null && v > 0);

  // Kinetics curve
  const leachRows = data.leaching;
  const kineticPts = [
    { h: 2,  key: 'leach_rec_2h_pct' as const },
    { h: 4,  key: 'leach_rec_4h_pct' as const },
    { h: 8,  key: 'leach_rec_8h_pct' as const },
    { h: 12, key: 'leach_rec_12h_pct' as const },
    { h: 24, key: 'leach_rec_24h_pct' as const },
    { h: 48, key: 'leach_rec_48h_pct' as const },
  ].map(pt => {
    const vals = leachRows.map(r => r[pt.key]).filter((v): v is number => v !== null && v > 0);
    return { h: pt.h, key: pt.key, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });

  const charts = [
    { values: auVals,     label: 'Distribution teneur Au (Analyse chim.)', unit: 'g/t',   color: '#f59e0b' },
    { values: leachVals,  label: 'Distribution récupération lixiviation 24h', unit: '%',  color: '#10b981' },
    { values: grgVals,    label: 'Distribution récupération GRG (Knelson)',  unit: '%',   color: '#2ecc8a' },
    { values: bwiVals,    label: 'Distribution Bond Ball WI',                unit: 'kWh/t', color: '#38bdf8' },
    { values: flotVals,   label: 'Distribution récupération flottation Au',  unit: '%',   color: '#f88a44' },
    { values: pyVals,     label: 'Distribution pyrite (Minéralogie)',        unit: '%',   color: '#9d78f0' },
    { values: auFreeVals, label: 'Distribution Au libre (MLA)',              unit: '%',   color: '#fbbf24' },
    { values: nacnVals,   label: 'Distribution consommation NaCN',           unit: 'kg/t', color: '#6b7280' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {charts.map(c => (
          <div key={c.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <Histogram {...c} bins={8} />
            {c.values.length > 1 && (
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-mf-border/60">
                {[
                  { k: 'Min', v: Math.min(...c.values) },
                  { k: 'Moy', v: c.values.reduce((a, b) => a + b, 0) / c.values.length },
                  { k: 'Max', v: Math.max(...c.values) },
                ].map(s => (
                  <div key={s.k} className="text-center">
                    <div className="text-[9px] text-mf-txt4 uppercase">{s.k}</div>
                    <div className="text-xs font-mono font-bold text-mf-txt">{formatDecimalGrouped(s.v, 1)} <span className="text-mf-txt4 text-[9px]">{c.unit}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Kinetics curve */}
      {leachRows.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-sm font-semibold text-mf-txt mb-1">Cinétique de lixiviation — profil moyen (n={leachRows.length} essais)</div>
          <div className="relative h-48">
            <svg viewBox="0 0 600 170" className="w-full h-full">
              {[25, 50, 75, 100].map(y => (
                <g key={y}>
                  <line x1="40" y1={158 - y * 1.4} x2="580" y2={158 - y * 1.4} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                  <text x="34" y={162 - y * 1.4} fill="#6b7280" fontSize="9" textAnchor="end">{y}%</text>
                </g>
              ))}
              {kineticPts.map((pt, i) => {
                const x = 40 + (i / (kineticPts.length - 1)) * 540;
                return <text key={pt.h} x={x} y="168" fill="#6b7280" fontSize="9" textAnchor="middle">{pt.h}h</text>;
              })}
              {/* Individual curves */}
              {leachRows.slice(0, 20).map((row, ri) => {
                const pts = kineticPts.map((pt, i) => {
                  const v = row[pt.key as keyof typeof row] as number | null;
                  const x = 40 + (i / (kineticPts.length - 1)) * 540;
                  const y = v && v > 0 ? 158 - v * 1.4 : null;
                  return { x, y };
                }).filter(p => p.y !== null);
                if (pts.length < 2) return null;
                return <polyline key={ri} points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="1" opacity="0.15" />;
              })}
              {/* Average */}
              {(() => {
                const pts = kineticPts.filter(pt => pt.avg !== null)
                  .map((pt, i) => ({ x: 40 + (kineticPts.findIndex(p => p.h === pt.h) / (kineticPts.length - 1)) * 540, y: 158 - pt.avg! * 1.4 }));
                if (pts.length < 2) return null;
                return (
                  <g>
                    <polyline points={pts.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#10b981" strokeWidth="2.5" />
                    {pts.map((p, i) => (
                      <g key={i}>
                        <circle cx={p.x} cy={p.y} r="4.5" fill="#10b981" />
                        <text x={p.x} y={p.y - 7} fill="#10b981" fontSize="8" textAnchor="middle">
                          {kineticPts[i].avg !== null ? `${kineticPts[i].avg!.toFixed(0)}%` : ''}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })()}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Corrélations ───────────────────────────────────────────────────────

interface ParamDef {
  key: string;
  label: string;
  unit: string;
  group: string;
  fn: (id: string, maps: DataMaps) => number | null | undefined;
}

interface DataMaps {
  chem: Map<string, LimsData['chem'][0]>;
  min: Map<string, LimsData['mineralogy'][0]>;
  leach: Map<string, LimsData['leaching'][0]>;
  comm: Map<string, LimsData['comminution'][0]>;
  flot: Map<string, LimsData['flotation'][0]>;
  knel: Map<string, LimsData['knelson'][0]>;
}

const PARAM_DEFS: ParamDef[] = [
  // Chimie
  { key: 'au_g_t',         label: 'Au tête',          unit: 'g/t',    group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.au_g_t },
  { key: 's_total',        label: 'S total',           unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.s_total_pct },
  { key: 's_sulfide',      label: 'S sulfure',         unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.s_sulfide_pct },
  { key: 'c_organic',      label: 'Corg',              unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.c_organic_pct },
  { key: 'fe_pct',         label: 'Fe',                unit: '%',      group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.fe_pct },
  { key: 'as_ppm',         label: 'As',                unit: 'ppm',    group: 'Chimie',        fn: (id, m) => m.chem.get(id)?.as_ppm },
  // Minéralogie
  { key: 'pyrite',         label: 'Pyrite',            unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.pyrite_pct },
  { key: 'pyrrhotite',     label: 'Pyrrhotite',        unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.pyrrhotite_pct },
  { key: 'au_free',        label: 'Au libre',          unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.au_free_pct },
  { key: 'carbonates',     label: 'Carbonates',        unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.carbonates_pct },
  { key: 'fe_oxides',      label: 'Oxydes Fe',         unit: '%',      group: 'Minéralogie',   fn: (id, m) => m.min.get(id)?.fe_oxides_pct },
  // Comminution
  { key: 'bwi',            label: 'Bond Wi',           unit: 'kWh/t',  group: 'Comminution',   fn: (id, m) => m.comm.get(id)?.bwi_kwh_t },
  { key: 'sg',             label: 'Densité SG',        unit: 't/m³',   group: 'Comminution',   fn: (id, m) => m.comm.get(id)?.sg_t_m3 },
  // Gravimétrie
  { key: 'grg',            label: 'GRG Knelson',       unit: '%',      group: 'Gravimétrie',   fn: (id, m) => m.knel.get(id)?.grg_recovery_pct },
  // Flottation
  { key: 'flot_au_rec',    label: 'Récup. flot. Au',   unit: '%',      group: 'Flottation',    fn: (id, m) => m.flot.get(id)?.au_recovery_pct },
  { key: 'flot_s_rec',     label: 'Récup. flot. S',    unit: '%',      group: 'Flottation',    fn: (id, m) => m.flot.get(id)?.s_recovery_pct },
  // Lixiviation
  { key: 'leach_rec_24h',  label: 'Récup. lixiv. 24h', unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_24h_pct },
  { key: 'leach_rec_48h',  label: 'Récup. lixiv. 48h', unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_48h_pct },
  { key: 'leach_rec_2h',   label: 'Récup. lixiv. 2h',  unit: '%',      group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.leach_rec_2h_pct },
  { key: 'nacn_cons',      label: 'Cons. NaCN',        unit: 'kg/t',   group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.nacn_consumption_kg_t },
  { key: 'cao_cons',       label: 'Cons. CaO',         unit: 'kg/t',   group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.cao_consumption_kg_t },
  { key: 'au_tail',        label: 'Au résidu',         unit: 'g/t',    group: 'Lixiviation',   fn: (id, m) => m.leach.get(id)?.au_feed_g_t },
];

interface SuggestedPair { xKey: string; yKey: string; label: string; color: string; interpretation: string }

const SUGGESTED_PAIRS: SuggestedPair[] = [
  { xKey: 'au_free',       yKey: 'leach_rec_24h', label: 'Au libre → Récup. 24h',   color: '#f59e0b', interpretation: 'Une corrélation positive confirme que la libération de l\'or contrôle directement la récupération par lixiviation. Attendu r > 0.6 pour un minerai oxydé.' },
  { xKey: 'pyrite',        yKey: 'leach_rec_24h', label: 'Pyrite → Récup. 24h',     color: '#9d78f0', interpretation: 'Une corrélation négative indique un minéral réfractaire. La pyrite encapsule l\'or et limite l\'accès du cyanure. r < −0.4 est préoccupant.' },
  { xKey: 'au_g_t',        yKey: 'leach_rec_24h', label: 'Teneur Au → Récup. 24h',  color: '#fbbf24', interpretation: 'Vérifie si la teneur impacte la cinétique. Une corrélation positive peut indiquer de l\'or libre associé aux zones riches.' },
  { xKey: 'bwi',           yKey: 'pyrite',        label: 'BWi → Pyrite',            color: '#38bdf8', interpretation: 'Dans certains gisements, la teneur en pyrite corrèle avec la dureté. Utile pour la modélisation géométallurgique.' },
  { xKey: 's_sulfide',     yKey: 'flot_s_rec',    label: 'S sulf. → Récup. S flot.', color: '#f88a44', interpretation: 'Validation de l\'efficacité de la flottation. Une corrélation positive forte (r > 0.7) confirme que le circuit sépare bien les sulfures.' },
  { xKey: 'nacn_cons',     yKey: 'leach_rec_24h', label: 'NaCN → Récup. 24h',       color: '#10b981', interpretation: 'Une corrélation négative révèle que la consommation élevée de NaCN est liée aux minéraux consommateurs et nuit à la récupération.' },
  { xKey: 'c_organic',     yKey: 'leach_rec_24h', label: 'Corg → Récup. 24h',       color: '#ef4444', interpretation: 'Le carbone organique (prég-robbing) absorbe l\'or dissous et réduit la récupération. Corrélation négative typique.' },
  { xKey: 'grg',           yKey: 'au_free',       label: 'GRG → Au libre',          color: '#2ecc8a', interpretation: 'L\'or récupérable par gravimétrie corrèle avec l\'Au libre. Valide la représentativité des tests Knelson.' },
];

function pearsonStats(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { r: 0, r2: 0, slope: 0, intercept: 0, pValue: null };
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const denX = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const denY = ys.reduce((s, y) => s + (y - yMean) ** 2, 0);
  const slope = denX !== 0 ? num / denX : 0;
  const intercept = yMean - slope * xMean;
  const r = denX !== 0 && denY !== 0 ? num / Math.sqrt(denX * denY) : 0;
  const r2 = r * r;
  // t-statistic and approximate p-value (two-tailed)
  let pValue: number | null = null;
  if (n > 2 && Math.abs(r) < 1) {
    const t = r * Math.sqrt((n - 2) / (1 - r2));
    const df = n - 2;
    // Approximation: p-value via Student t distribution (simplified)
    const x = df / (df + t * t);
    // Regularized incomplete beta approximation
    const p = x < 1 ? Math.min(1, 2 * betaInc(df / 2, 0.5, x)) : 1;
    pValue = Math.round(p * 10000) / 10000;
  }
  return { r, r2, slope, intercept, pValue };
}

function betaInc(a: number, b: number, x: number): number {
  // Simple continued fraction approximation for regularized incomplete beta
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  // Lentz's continued fraction
  let f = 1, c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d; f = d;
  for (let m = 1; m <= 100; m++) {
    const m2 = 2 * m;
    let delta = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + delta * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + delta / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; f *= d * c;
    delta = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + delta * d; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + delta / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const delta2 = d * c; f *= delta2;
    if (Math.abs(delta2 - 1) < 1e-10) break;
  }
  return front * f;
}

function logGamma(x: number): number {
  // Lanczos approximation coefficients (g=7). Canonical scientific constants;
  // trailing digits exceed f64 precision by design and round to the nearest double.
  // eslint-disable-next-line no-loss-of-precision
  const p = [0.99999999999999709182, 57.156235665862923517, -59.597960355475491248, 14.136097974741747174, -0.49191381609762019978, 3.3994649984811888699e-5, 4.6523628927048575665e-8, -9.8374475304879564677e-8, 1.5808870322491248884e-7];
  let r = p[0]; for (let i = 1; i < p.length; i++) r += p[i] / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(r) - Math.log(x);
}

function CorrelationsTab({ data }: { data: LimsData }) {
  const [xKey, setXKey] = useState('au_free');
  const [yKey, setYKey] = useState('leach_rec_24h');
  const [computed, setComputed] = useState(false);
  const [activePair, setActivePair] = useState<string | null>('au_free|leach_rec_24h');

  const maps: DataMaps = {
    chem:  new Map(data.chem.map(r => [r.sample_id, r])),
    min:   new Map(data.mineralogy.map(r => [r.sample_id, r])),
    leach: new Map(data.leaching.map(r => [r.sample_id, r])),
    comm:  new Map(data.comminution.map(r => [r.sample_id, r])),
    flot:  new Map(data.flotation.map(r => [r.sample_id, r])),
    knel:  new Map(data.knelson.map(r => [r.sample_id, r])),
  };

  const allIds = [...new Set([
    ...data.chem.map(r => r.sample_id),
    ...data.mineralogy.map(r => r.sample_id),
    ...data.leaching.map(r => r.sample_id),
    ...data.comminution.map(r => r.sample_id),
    ...data.flotation.map(r => r.sample_id),
    ...data.knelson.map(r => r.sample_id),
  ])];

  const xDef = PARAM_DEFS.find(p => p.key === xKey)!;
  const yDef = PARAM_DEFS.find(p => p.key === yKey)!;

  const { xs, ys } = (() => {
    const xs: number[] = [], ys: number[] = [];
    for (const id of allIds) {
      const x = xDef.fn(id, maps), y = yDef.fn(id, maps);
      if (x != null && y != null && !isNaN(x) && !isNaN(y) && isFinite(x) && isFinite(y)) {
        xs.push(x); ys.push(y);
      }
    }
    return { xs, ys };
  })();

  const stats = pearsonStats(xs, ys);

  const activeSuggested = SUGGESTED_PAIRS.find(p => p.xKey === xKey && p.yKey === yKey);
  const activeColor = activeSuggested?.color ?? '#f59e0b';

  function selectPair(s: SuggestedPair) {
    setXKey(s.xKey); setYKey(s.yKey);
    setActivePair(`${s.xKey}|${s.yKey}`);
    setComputed(true);
  }

  function handleCalculer() {
    setComputed(true);
    setActivePair(`${xKey}|${yKey}`);
  }

  const rAbs = Math.abs(stats.r);
  const intensity = rAbs >= 0.7 ? 'Forte' : rAbs >= 0.4 ? 'Modérée' : 'Faible';
  const intensityColor = rAbs >= 0.7 ? '#10b981' : rAbs >= 0.4 ? '#f59e0b' : '#6b7280';
  const rColor = stats.r >= 0.4 ? '#10b981' : stats.r <= -0.4 ? '#ef4444' : '#f59e0b';

  // gradient bar fill position (r from -1 to +1, fill to mark)
  const rBarPct = ((stats.r + 1) / 2) * 100;

  // Groups for select options
  const groups = [...new Set(PARAM_DEFS.map(p => p.group))];

  const interpretation = activeSuggested?.interpretation ?? (
    computed
      ? rAbs >= 0.7
        ? `Corrélation ${stats.r > 0 ? 'positive' : 'négative'} forte entre ${xDef.label} et ${yDef.label}. Cette relation est statistiquement significative et doit être intégrée à la modélisation géométallurgique.`
        : rAbs >= 0.4
          ? `Corrélation ${stats.r > 0 ? 'positive' : 'négative'} modérée. La relation existe mais d'autres facteurs influencent également ${yDef.label}. Compléter avec d'autres variables.`
          : `Corrélation faible entre ${xDef.label} et ${yDef.label}. Ces deux variables n'ont pas de relation linéaire directe dans cet ensemble de données.`
      : 'Sélectionnez des paramètres et cliquez Calculer pour générer l\'interprétation.'
  );

  // SVG scatter with regression
  const showScatter = computed && xs.length >= 2;
  const W = 440, H = 280, PL = 52, PR = 18, PT = 18, PB = 42;
  const xMin = xs.length ? Math.min(...xs) : 0, xMax = xs.length ? Math.max(...xs) : 1;
  const yMin = ys.length ? Math.min(...ys) : 0, yMax = ys.length ? Math.max(...ys) : 1;
  const xRange = xMax - xMin || 1, yRange = yMax - yMin || 1;
  const scaleX = (v: number) => PL + ((v - xMin) / xRange) * (W - PL - PR);
  const scaleY = (v: number) => H - PB - ((v - yMin) / yRange) * (H - PT - PB);
  const lineX1 = xMin - xRange * 0.02, lineX2 = xMax + xRange * 0.02;
  const lineY1 = stats.slope * lineX1 + stats.intercept;
  const lineY2 = stats.slope * lineX2 + stats.intercept;

  // axis ticks
  function axisTicks(min: number, max: number, count = 5) {
    const range = max - min || 1;
    const step = range / (count - 1);
    return Array.from({ length: count }, (_, i) => +(min + i * step).toPrecision(3));
  }

  return (
    <div className="space-y-4">
      {/* Suggested pairs chips */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4 mb-3">Paires suggérées</div>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PAIRS.map(s => {
            const isActive = activePair === `${s.xKey}|${s.yKey}`;
            return (
              <button key={`${s.xKey}|${s.yKey}`} onClick={() => selectPair(s)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all duration-200 ${isActive ? 'text-white border-transparent' : 'text-mf-txt3 border-mf-border bg-mf-hover hover:border-mf-txt4 hover:text-mf-txt'}`}
                style={isActive ? { backgroundColor: s.color, borderColor: s.color } : {}}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selectors row */}
      <div className="flex items-end gap-3">
        {/* X */}
        <div className="flex-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-mf-txt4 mb-1.5">Paramètre X (abscisse)</label>
          <select value={xKey} onChange={e => { setXKey(e.target.value); setActivePair(null); setComputed(false); }}
            className="w-full bg-mf-card border border-mf-border rounded-lg px-3 py-2 text-xs text-mf-txt focus:outline-none focus:border-amber-500/50">
            {groups.map(g => (
              <optgroup key={g} label={`── ${g}`}>
                {PARAM_DEFS.filter(p => p.group === g).map(p => (
                  <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {/* Y */}
        <div className="flex-1">
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-mf-txt4 mb-1.5">Paramètre Y (ordonnée)</label>
          <select value={yKey} onChange={e => { setYKey(e.target.value); setActivePair(null); setComputed(false); }}
            className="w-full bg-mf-card border border-mf-border rounded-lg px-3 py-2 text-xs text-mf-txt focus:outline-none focus:border-amber-500/50">
            {groups.map(g => (
              <optgroup key={g} label={`── ${g}`}>
                {PARAM_DEFS.filter(p => p.group === g).map(p => (
                  <option key={p.key} value={p.key}>{p.label} ({p.unit})</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button onClick={handleCalculer}
          className="px-5 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors">
          Calculer
        </button>
      </div>

      {/* Main panel */}
      {!computed ? (
        <div className="rounded-xl border border-dashed border-mf-border bg-mf-card p-10 flex flex-col items-center gap-3 text-center">
          <GitBranch size={28} className="text-mf-txt4" />
          <p className="text-sm text-mf-txt">Sélectionnez une paire de paramètres</p>
          <p className="text-xs text-mf-txt4 max-w-sm">Choisissez X et Y dans les listes ou cliquez sur une paire suggérée, puis appuyez sur <strong className="text-mf-txt">Calculer</strong>.</p>
        </div>
      ) : xs.length < 2 ? (
        <div className="rounded-xl border border-mf-border bg-mf-card p-8 flex flex-col items-center gap-3 text-center">
          <Info size={24} className="text-mf-txt4" />
          <p className="text-sm text-mf-txt">Données insuffisantes</p>
          <p className="text-xs text-mf-txt4">Aucune paire complète trouvée pour <strong>{xDef.label}</strong> ↔ <strong>{yDef.label}</strong>. Importez des données dans le module LIMS.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_280px] gap-4">
          {/* Scatter plot */}
          <div className="rounded-xl border border-mf-border bg-mf-card p-5">
            <div className="text-xs font-semibold text-mf-txt mb-0.5">Nuage de points &amp; régression</div>
            <div className="text-[10px] text-mf-txt4 mb-3">{xDef.label} ({xDef.unit}) vs {yDef.label} ({yDef.unit}) — n={xs.length} paires</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 260 }}>
              {/* grid */}
              {axisTicks(yMin, yMax).map(v => (
                <line key={v} x1={PL} y1={scaleY(v)} x2={W - PR} y2={scaleY(v)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              ))}
              {axisTicks(xMin, xMax).map(v => (
                <line key={v} x1={scaleX(v)} y1={PT} x2={scaleX(v)} y2={H - PB} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              ))}
              {/* axes */}
              <line x1={PL} y1={PT} x2={PL} y2={H - PB} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              <line x1={PL} y1={H - PB} x2={W - PR} y2={H - PB} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
              {/* axis ticks and labels */}
              {axisTicks(xMin, xMax).map(v => (
                <g key={v}>
                  <line x1={scaleX(v)} y1={H - PB} x2={scaleX(v)} y2={H - PB + 4} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                  <text x={scaleX(v)} y={H - PB + 14} fill="#6b7280" fontSize="9" textAnchor="middle">{v}</text>
                </g>
              ))}
              {axisTicks(yMin, yMax).map(v => (
                <g key={v}>
                  <line x1={PL - 4} y1={scaleY(v)} x2={PL} y2={scaleY(v)} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                  <text x={PL - 7} y={scaleY(v) + 3} fill="#6b7280" fontSize="9" textAnchor="end">{v}</text>
                </g>
              ))}
              {/* axis titles */}
              <text x={PL + (W - PL - PR) / 2} y={H - 4} fill="#9ca3af" fontSize="10" textAnchor="middle">{xDef.label} ({xDef.unit})</text>
              <text x={12} y={PT + (H - PT - PB) / 2} fill="#9ca3af" fontSize="10" textAnchor="middle" transform={`rotate(-90,12,${PT + (H - PT - PB) / 2})`}>{yDef.label} ({yDef.unit})</text>
              {/* regression line */}
              <line x1={scaleX(lineX1)} y1={scaleY(lineY1)} x2={scaleX(lineX2)} y2={scaleY(lineY2)}
                stroke={activeColor} strokeWidth="1.5" strokeDasharray="6 3" opacity="0.65" />
              {/* points */}
              {xs.map((x, i) => (
                <circle key={i} cx={scaleX(x)} cy={scaleY(ys[i])} r="4.5" fill={activeColor} opacity="0.7"
                  className="hover:opacity-100 transition-opacity">
                  <title>{xDef.label}: {formatDecimalGrouped(x, 3)} | {yDef.label}: {formatDecimalGrouped(ys[i], 3)}</title>
                </circle>
              ))}
            </svg>
          </div>

          {/* Stats panel */}
          <div className="rounded-xl border border-mf-border bg-mf-card p-4 flex flex-col gap-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-mf-txt4">Statistiques</div>

            {/* Pearson r */}
            <div>
              <div className="text-[10px] text-mf-txt4 mb-1">Coefficient de Pearson r</div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-3xl font-mono font-bold" style={{ color: rColor }}>{formatDecimalGrouped(stats.r, 3)}</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border"
                  style={{ color: intensityColor, borderColor: `${intensityColor}40`, backgroundColor: `${intensityColor}15` }}>
                  {intensity}
                </span>
              </div>
              {/* Gradient bar */}
              <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #ef4444, #6b7280, #10b981)' }}>
                <div className="absolute top-0 w-2 h-2.5 rounded-sm bg-white shadow" style={{ left: `calc(${rBarPct}% - 4px)` }} />
              </div>
              <div className="flex justify-between text-[9px] text-mf-txt4 mt-1">
                <span>−1</span><span>0</span><span>+1</span>
              </div>
            </div>

            {/* Stats grid */}
            <div className="space-y-2.5">
              {[
                { label: 'R²', val: formatDecimalGrouped(stats.r2, 4), note: `${formatDecimalGrouped((stats.r2 * 100), 1)}% variance expliquée` },
                { label: 'n paires', val: xs.length.toString(), note: '' },
                { label: 'p-value', val: stats.pValue != null ? (stats.pValue < 0.0001 ? '< 0.0001' : formatDecimalGrouped(stats.pValue, 4)) : 'N/A', note: stats.pValue != null ? (stats.pValue < 0.05 ? 'Significatif (α=0.05)' : 'Non significatif') : '' },
                { label: 'Équation', val: `y = ${formatDecimalGrouped(stats.slope, 3)}x ${stats.intercept >= 0 ? '+' : '−'} ${formatDecimalGrouped(Math.abs(stats.intercept), 3)}`, note: '' },
              ].map(s => (
                <div key={s.label} className="rounded-lg bg-mf-hover/40 border border-mf-border/50 px-3 py-2">
                  <div className="text-[9px] text-mf-txt4 uppercase tracking-wider">{s.label}</div>
                  <div className="text-xs font-mono font-semibold text-mf-txt mt-0.5">{s.val}</div>
                  {s.note && <div className="text-[9px] text-mf-txt4 mt-0.5">{s.note}</div>}
                </div>
              ))}
            </div>

            {/* Interpretation */}
            <div className="rounded-lg bg-blue-500/8 border border-blue-500/20 p-3 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-blue-400 mb-1.5">Interprétation métallurgique</div>
              <p className="text-[10px] text-mf-txt3 leading-relaxed">{interpretation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Route Métallurgique ─────────────────────────────────────────────────

function RoutesTab({ routes, maxRec, data }: { routes: RouteEstimate[]; maxRec: number; data: LimsData }) {
  if (routes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-center">
        <Info size={32} className="text-mf-txt4 mb-3" />
        <p className="text-sm font-semibold text-mf-txt mb-1">Données insuffisantes</p>
        <p className="text-xs text-mf-txt4 max-w-xs">Saisissez au minimum des données de lixiviation (D1) pour générer les routes.</p>
      </div>
    );
  }
  const allRefs = [...new Set(routes.flatMap(r => r.references))];
  const cilCip = cilVsCip(data);

  // The recommendation is decided once, in metallurgicalRoutes(), so every view
  // reads the same flag. Re-deciding it here is what made the tabs disagree.
  const recommended = routes.find(r => r.recommended);

  return (
    <div className="space-y-5">
      {/* Recommended highlight */}
      {recommended && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Star size={16} className="text-emerald-400 fill-emerald-400" />
            <span className="text-sm font-bold text-emerald-400">Circuit recommandé</span>
          </div>
          <div className="flex items-end gap-6">
            <div className="flex-1">
              <div className="text-base font-bold text-mf-txt mb-1">{recommended.route}</div>
              <div className="text-xs text-mf-txt3 mb-2">{recommended.basis}</div>
              <div className="flex gap-3 text-xs">
                <span>Confiance: <span className="font-semibold text-emerald-400">{recommended.confidence.toUpperCase()}</span></span>
                <span>CapEx: <span className="font-semibold">{recommended.capex_indicator.toUpperCase()}</span></span>
                <span>OpEx: <span className="font-semibold">{recommended.opex_indicator.toUpperCase()}</span></span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-mono font-bold text-emerald-400">{recommended.recovery_pct}%</div>
              <div className="text-xs text-mf-txt4">récupération estimée</div>
            </div>
          </div>

          {/* Adsorption sub-circuit — part of the SAME single recommendation */}
          <div className="mt-4 pt-4 border-t border-emerald-500/15">
            <div className="flex items-center gap-2 mb-2">
              <Droplets size={14} className={cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'} />
              <span className="text-xs text-mf-txt3">Circuit d'adsorption retenu :</span>
              <span className={`text-sm font-bold font-mono ${cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'}`}>{cilCip.recommendation}</span>
              <span className="text-[11px] text-mf-txt4">{cilCip.recommendation === 'CIL' ? 'Carbon-In-Leach — carbone actif en circuit ouvert' : 'Carbon-In-Pulp — tanks CIP séparés de la lixiviation'}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {cilCip.reasons.slice(0, 3).map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] text-mf-txt3">
                  <CheckCircle2 size={10} className={`shrink-0 mt-0.5 ${cilCip.recommendation === 'CIL' ? 'text-teal-400' : 'text-blue-400'}`} />
                  {r}
                </div>
              ))}
              {cilCip.warnings.map((w, i) => (
                <div key={`w${i}`} className="flex items-start gap-1.5 text-[10px] text-amber-300">
                  <AlertTriangle size={10} className="text-amber-400 shrink-0 mt-0.5" />
                  {w}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* All routes comparison */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-4">Analyse comparative — 5 circuits proposés</div>
        {routes.slice(0, 5).map(r => <RouteBar key={r.route} route={r} maxRec={maxRec} />)}
      </div>

      {/* Detail table */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-5">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Tableau comparatif — Récupération globale estimée</div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Circuit proposé</th>
                <th className="text-right">Récup. glob. (%)</th>
                <th>Confiance</th>
                <th>Qualité données</th>
                <th>CapEx</th>
                <th>OpEx</th>
                <th>Base de calcul</th>
              </tr>
            </thead>
            <tbody>
              {routes.slice(0, 5).map(r => (
                <tr key={r.route} className={r.recommended ? 'bg-emerald-500/5' : ''}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      {r.recommended && <Star size={10} className="text-emerald-400 fill-emerald-400 shrink-0" />}
                      <span className="text-xs text-mf-txt font-medium">{r.route}</span>
                    </div>
                  </td>
                  <td className={`num font-bold text-sm ${r.recommended ? 'text-emerald-400' : ''}`}>{r.recovery_pct}</td>
                  <td><span className={`badge text-[9px] ${r.confidence === 'high' ? 'badge-green' : r.confidence === 'medium' ? 'badge-orange' : 'badge-gray'}`}>{r.confidence}</span></td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-mf-border/40 overflow-hidden">
                        <div className={`h-full rounded-full ${r.dataQualityScore >= 67 ? 'bg-emerald-400' : r.dataQualityScore >= 33 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${r.dataQualityScore}%` }} />
                      </div>
                      <span className="text-[9px] text-mf-txt4 font-mono">{r.dataQualityScore}%</span>
                    </div>
                  </td>
                  <td><span className={`text-[10px] font-semibold ${r.capex_indicator === 'low' ? 'text-emerald-400' : r.capex_indicator === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>{r.capex_indicator.toUpperCase()}</span></td>
                  <td><span className={`text-[10px] font-semibold ${r.opex_indicator === 'low' ? 'text-emerald-400' : r.opex_indicator === 'medium' ? 'text-amber-400' : 'text-red-400'}`}>{r.opex_indicator.toUpperCase()}</span></td>
                  <td><span className="text-[10px] text-mf-txt4 leading-tight max-w-xs block">{r.basis}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Disclaimer + refs */}
      <div className="p-3 bg-amber-500/8 border border-amber-500/15 rounded-lg flex items-start gap-2">
        <Info size={13} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-mf-txt3">Ces estimations guident le choix du circuit mais ne remplacent pas une étude de faisabilité. La confiance augmente avec le nombre d'essais et la représentativité des composites.</div>
      </div>
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Références</div>
        <div className="space-y-1.5">
          {allRefs.map((ref, i) => (
            <div key={i} className="flex items-start gap-2.5 py-1.5 border-b border-mf-border/40">
              <div className="w-4 h-4 rounded bg-amber-500/15 border border-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-[8px] font-bold text-amber-500">{i + 1}</span>
              </div>
              <span className="text-xs text-mf-txt3">{ref}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Géométallurgie ─────────────────────────────────────────────────────

function GeometTab({ entries, data }: { entries: GeometEntry[]; data: LimsData }) {
  // Vecteurs de caractéristiques par échantillon pour le clustering métallurgique.
  const clusterInputs = useMemo(() => {
    const comm = new Map(data.comminution.map(c => [String(c.sample_id), c]));
    const chem = new Map(data.chem.map(c => [String(c.sample_id), c]));
    const knel = new Map(data.knelson.map(k => [String(k.sample_id), k]));
    const mineral = new Map(data.mineralogy.map(m => [String(m.sample_id), m]));
    const out: { id: string; features: number[] }[] = [];
    for (const s of data.samples) {
      const k = String(s.id);
      const bwi = comm.get(k)?.bwi_kwh_t, sS = chem.get(k)?.s_sulfide_pct, cO = chem.get(k)?.c_organic_pct,
        grg = knel.get(k)?.grg_recovery_pct, auF = mineral.get(k)?.au_free_pct;
      if ([bwi, sS, cO, grg, auF].every(v => v != null && Number.isFinite(v))) {
        out.push({ id: k, features: [bwi as number, sS as number, cO as number, grg as number, auF as number] });
      }
    }
    return out;
  }, [data]);

  const oreTypeCounts = entries.reduce((acc, e) => { acc[e.ore_type] = (acc[e.ore_type] ?? 0) + 1; return acc; }, {} as Record<string, number>);
  const anomalyCount = entries.filter(e => e.anomaly).length;
  const highScoreCount = entries.filter(e => e.score >= 80).length;
  const lowScoreCount = entries.filter(e => e.score < 50).length;

  const oreColors: Record<string, string> = { Oxyde: '#f59e0b', Sulfure: '#9d78f0', Transition: '#38bdf8', Indéterminé: '#6b7280' };

  return (
    <div className="space-y-5">
      <GeometClusters
        data={clusterInputs}
        featureNames={['BWi', 'S sulf.', 'C org.', 'GRG', 'Au libre']}
        featureUnits={['kWh/t', '%', '%', '%', '%']}
      />
      {/* Summary KPIs */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Échantillons analysés', val: entries.length, color: 'text-mf-txt', icon: <FlaskConical size={14} className="text-amber-400"/> },
          { label: 'Anomalies détectées', val: anomalyCount, color: anomalyCount > 0 ? 'text-amber-400' : 'text-emerald-400', icon: <AlertTriangle size={14} className="text-amber-400"/> },
          { label: 'Score métall. ≥ 80%', val: highScoreCount, color: 'text-emerald-400', icon: <CheckCircle2 size={14} className="text-emerald-400"/> },
          { label: 'Score métall. < 50%', val: lowScoreCount, color: lowScoreCount > 0 ? 'text-red-400' : 'text-mf-txt4', icon: <AlertTriangle size={14} className="text-red-400"/> },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{k.icon}</div>
              <span className="text-[10px] text-mf-txt4">{k.label}</span>
            </div>
            <div className={`text-2xl font-mono font-bold ${k.color}`}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* Ore type distribution */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Classification minéralogique — Distribution des types de minerai</div>
          <div className="flex gap-3 mb-3">
            {Object.entries(oreTypeCounts).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-mf-hover border border-mf-border/50 flex-1 text-center">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: oreColors[type] ?? '#6b7280' }} />
                <div>
                  <div className="text-xs font-bold text-mf-txt">{count}</div>
                  <div className="text-[10px] text-mf-txt4">{type}</div>
                  <div className="text-[9px] text-mf-txt4">{pct(count, entries.length)}%</div>
                </div>
              </div>
            ))}
          </div>
          {/* Bar chart */}
          <div className="space-y-1.5">
            {Object.entries(oreTypeCounts).map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <div className="text-xs text-mf-txt3 w-24 shrink-0">{type}</div>
                <div className="flex-1 h-2 bg-mf-border/30 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${pct(count, entries.length)}%`, backgroundColor: oreColors[type] ?? '#6b7280', opacity: 0.75 }} />
                </div>
                <div className="text-xs font-mono text-mf-txt4 w-8 text-right">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-sample table */}
      {entries.length > 0 ? (
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 py-3 border-b border-mf-border">
            <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Analyse par échantillon — Score métallurgique & Recommandations</div>
          </div>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID Échantillon</th>
                  <th>Domaine</th>
                  <th>Type minerai</th>
                  <th>Score</th>
                  <th>Driver récupération</th>
                  <th>Anomalie</th>
                  <th>Recommandation</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(e => (
                  <tr key={e.sample_id}>
                    <td><span className="font-mono text-amber-400 text-xs">{e.sample_id}</span></td>
                    <td><span className="text-xs text-mf-txt3">{e.domain ?? '—'}</span></td>
                    <td>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: oreColors[e.ore_type] ?? '#6b7280', backgroundColor: `${oreColors[e.ore_type] ?? '#6b7280'}20` }}>
                        {e.ore_type}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 bg-mf-border/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${e.score}%`, backgroundColor: e.score >= 80 ? '#10b981' : e.score >= 50 ? '#f59e0b' : '#ef4444' }} />
                        </div>
                        <span className={`text-xs font-mono font-bold ${e.score >= 80 ? 'text-emerald-400' : e.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>{e.score}</span>
                      </div>
                    </td>
                    <td><span className="text-[10px] text-mf-txt3 max-w-40 block leading-tight">{e.recovery_driver}</span></td>
                    <td>
                      {e.anomaly ? (
                        <div className="flex items-start gap-1">
                          <AlertTriangle size={11} className="text-amber-400 shrink-0 mt-0.5" />
                          <span className="text-[10px] text-amber-300 max-w-36 block leading-tight">{e.anomaly}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <CheckCircle2 size={11} className="text-emerald-400" />
                          <span className="text-[10px] text-emerald-400">Normal</span>
                        </div>
                      )}
                    </td>
                    <td><span className="text-[10px] text-mf-txt3 max-w-48 block leading-tight">{e.recommendation}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-32 text-center rounded-xl border border-dashed border-mf-border">
          <Microscope size={24} className="text-mf-txt4 mb-2" />
          <p className="text-xs text-mf-txt4">Complétez les analyses chimiques, minéralogiques et de lixiviation pour générer l'analyse géométallurgique.</p>
        </div>
      )}

      {/* Recommendations panel */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={13} className="text-amber-400" />
            <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4">Recommandations prioritaires</div>
          </div>
          <div className="space-y-2">
            {lowScoreCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/8 border border-red-500/20">
                <AlertTriangle size={12} className="text-red-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-red-400">{lowScoreCount} échantillon{lowScoreCount > 1 ? 's' : ''}</span> avec score métallurgique inférieur à 50 — investigation complémentaire requise (prétraitement, caractérisation minéralogique approfondie).</div>
              </div>
            )}
            {anomalyCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/8 border border-amber-500/20">
                <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-amber-400">{anomalyCount} anomalie{anomalyCount > 1 ? 's' : ''} détectée{anomalyCount > 1 ? 's' : ''}</span> — réviser protocole QAQC et confirmer résultats par duplicatas.</div>
              </div>
            )}
            {highScoreCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
                <CheckCircle2 size={12} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-mf-txt3"><span className="font-semibold text-emerald-400">{highScoreCount} échantillon{highScoreCount > 1 ? 's' : ''}</span> avec score ≥ 80 — potentiel de récupération favorable confirmé. Prioriser pour composites variabilité.</div>
              </div>
            )}
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-500/8 border border-blue-500/20">
              <Info size={12} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-mf-txt3">Score métallurgique calculé à partir de : récupération lixiviation, Au libre, teneur Corg, flottation Au. Score 0–100 — indicatif seulement, non substitut à l'étude de faisabilité.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Recovery Prediction Tab — multivariate regression model from LIMS data
// ─────────────────────────────────────────────────────────────────────────────

function PredictionTab({ data }: { data: LimsData }) {
  const [predInput, setPredInput] = useState<PredictionInput>({
    auGrade: 2.5, sSulfide: 0.5, cOrganic: 0.1, bwi: 15, grg: 35, p80: 75, auFree: 60,
  });

  const samples: TrainingSample[] = useMemo(() => {
    const leachMap = new Map<string, number>();
    for (const l of data.leaching ?? []) {
      const key = String(l.sample_id ?? '');
      const rec = l.leach_rec_24h_pct ?? l.leach_rec_48h_pct ?? 0;
      if (rec > 0) leachMap.set(key, rec);
    }

    const result: TrainingSample[] = [];
    for (const s of data.samples ?? []) {
      const key = String(s.id);
      const recovery = leachMap.get(key);
      if (recovery == null || recovery <= 0) continue;

      const chem = (data.chem ?? []).find(c => String(c.sample_id) === key);
      const comm = (data.comminution ?? []).find(c => String(c.sample_id) === key);
      const knel = (data.knelson ?? []).find(k => String(k.sample_id) === key);
      const min = (data.mineralogy ?? []).find(m => String(m.sample_id) === key);

      result.push({
        auGrade: chem?.au_g_t ?? 0,
        sSulfide: chem?.s_sulfide_pct ?? 0,
        cOrganic: chem?.c_organic_pct ?? 0,
        bwi: comm?.bwi_kwh_t ?? 15,
        grg: knel?.grg_recovery_pct ?? 0,
        p80: knel?.p80_feed_um ?? 75,
        auFree: min?.au_free_pct ?? 50,
        recovery,
      });
    }
    return result;
  }, [data]);

  const model = useMemo(() => trainRecoveryModel(samples), [samples]);
  const prediction = useMemo(() => {
    if (!model) return null;
    return predictWithCI(model, predInput);
  }, [model, predInput]);
  // Validation croisée : la vraie capacité prédictive (hors échantillon).
  const cv = useMemo(() => crossValidateRecovery(samples), [samples]);
  // Recommandation d'exploitation sur le levier réglable (P80 de broyage).
  // Le scan est borné au domaine des P80 réellement observés : extrapoler le
  // modèle linéaire hors des essais donnait des recommandations aberrantes
  // (« broyer plus grossier vers 270 µm → 100 % »).
  const grindReco = useMemo(() => {
    if (!model) return null;
    const p80Obs = samples.map(s => s.p80).filter(v => v > 0);
    return recommendGrind(model, predInput, {
      cv,
      p80Min: p80Obs.length ? Math.min(...p80Obs) : undefined,
      p80Max: p80Obs.length ? Math.max(...p80Obs) : undefined,
    });
  }, [model, predInput, cv, samples]);

  // ── Bilan mécaniste (innovation) : indépendant de l'OLS, il fonctionne avec un
  //    seul essai de libération. Rendu même quand le modèle statistique manque de
  //    données — c'est justement là qu'il apporte le plus. ──────────────────────
  const lib = data.liberation ?? [];
  const mechanisticPanel = (
    <MechanisticRecoveryPanel
      deportment={{
        free: robustMean(lib.map(r => r.au_free_pct)),
        sulphide: robustMean(lib.map(r => r.au_sulphides_pct)),
        silicate: robustMean(lib.map(r => r.au_silicates_pct)),
        occluded: robustMean(lib.map(r => r.au_occluded_pct)),
        pregRob: robustMean(lib.map(r => r.au_preg_rob_pct)),
      }}
      p80RefUm={robustMean(lib.map(r => r.p80_um))}
      grgPct={robustMean(data.knelson.map(k => k.grg_recovery_pct))}
      cOrgPct={robustMean(data.chem.map(c => c.c_organic_pct))}
      measuredRecoveryPct={robustMean(data.leaching.map(l => l.leach_rec_24h_pct ?? l.leach_rec_48h_pct))}
      leach24hPct={robustMean(data.leaching.map(l => l.leach_rec_24h_pct))}
      leach48hPct={robustMean(data.leaching.map(l => l.leach_rec_48h_pct))}
    />
  );

  // Cinétique de lixiviation (points représentatifs 2→48 h) + consommation NaCN.
  const leachPoints = ([
    [2, 'leach_rec_2h_pct'], [4, 'leach_rec_4h_pct'], [8, 'leach_rec_8h_pct'],
    [12, 'leach_rec_12h_pct'], [24, 'leach_rec_24h_pct'], [48, 'leach_rec_48h_pct'],
  ] as const)
    .map(([h, key]) => ({ hours: h as number, recoveryPct: robustMean(data.leaching.map(l => l[key])) }))
    .filter((p): p is { hours: number; recoveryPct: number } => p.recoveryPct != null && p.recoveryPct > 0);
  const leachCyanidePanel = (
    <LeachCyanidePanel
      leachPoints={leachPoints}
      cuPct={robustMean(data.chem.map(c => c.cu_pct))}
      sSulfidePct={robustMean(data.chem.map(c => c.s_sulfide_pct))}
      measuredNaCnKgT={robustMean(data.leaching.map(l => l.nacn_consumption_kg_t))}
    />
  );

  if (samples.length < 3) {
    return (
      <div className="space-y-4">
        {mechanisticPanel}
        {leachCyanidePanel}
        <div className="card flex flex-col items-center gap-3 py-12">
          <Brain size={32} className="text-mf-border" />
          <div className="text-center max-w-md">
            <div className="text-sm font-semibold text-mf-txt mb-1">Modèle statistique (OLS) : données insuffisantes</div>
            <div className="text-xs text-mf-txt4">
              La régression IA nécessite au moins 3 échantillons LIMS avec lixiviation complète.
              Actuellement: {samples.length} échantillon{samples.length !== 1 ? 's' : ''} disponible{samples.length !== 1 ? 's' : ''}.
              Le bilan mécaniste ci-dessus reste exploitable dès un essai de libération.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mechanisticPanel}
      {leachCyanidePanel}
      {/* Model quality banner */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-amber-400" />
            <span className="section-title">Modèle de Prédiction IA — Récupération Or</span>
          </div>
          <span className={`badge ${model!.rSquared >= 0.7 ? 'badge-green' : model!.rSquared >= 0.5 ? 'badge-gold' : 'badge-orange'}`}>
            {modelQuality(model!)}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.sampleCount}</div>
            <div className="text-[10px] text-mf-txt4">Échantillons</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-amber-400">{(model!.rSquared * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">R²</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.rmse.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">RMSE</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.mae.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">MAE</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.meanRecovery.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">Récup. moy.</div>
          </div>
        </div>
      </div>

      {/* Validation croisée — la vraie capacité prédictive (hors échantillon) */}
      {cv && (
        <div className={`card border ${
          cv.verdict === 'robuste' ? 'border-emerald-500/30'
          : cv.verdict === 'acceptable' ? 'border-amber-500/30'
          : cv.verdict === 'insuffisant' ? 'border-mf-border'
          : 'border-red-500/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-teal-400" />
              <span className="section-title">Validation croisée (hors échantillon)</span>
            </div>
            <span className={`badge ${
              cv.verdict === 'robuste' ? 'badge-green'
              : cv.verdict === 'acceptable' ? 'badge-gold'
              : cv.verdict === 'insuffisant' ? 'badge-gray'
              : 'badge-orange'
            }`}>{cv.verdict}</span>
          </div>
          {!Number.isNaN(cv.cvRSquared) ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-teal-400">{(cv.cvRSquared * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">R² hors échantillon</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-mf-txt">{cv.cvRmse.toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">RMSE hors éch.</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-mf-txt4">{(cv.inSampleRSquared * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">R² in-sample</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold font-mono ${cv.overfitGap > 0.2 ? 'text-red-400' : 'text-mf-txt'}`}>
                  {(cv.overfitGap * 100).toFixed(0)} pt
                </div>
                <div className="text-[10px] text-mf-txt4">Écart (sur-apprentissage)</div>
              </div>
            </div>
          ) : null}
          <div className="text-xs text-mf-txt3">{cv.message}</div>
        </div>
      )}

      {/* Recommandation d'exploitation — sur le levier réglable (P80 broyage).
          Affichée aussi quand il n'y a pas d'action (maintenir / signe non
          physique), pour expliquer POURQUOI plutôt que de disparaître. */}
      {grindReco && (() => {
        const rec = grindReco.recommendation;
        const actionable = rec.direction !== 'maintenir';
        return (
          <div className={`card border ${actionable ? 'border-amber-500/25 bg-amber-500/[0.03]' : 'border-mf-border'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${actionable ? 'bg-amber-500/15' : 'bg-mf-hover/40'}`}>
                <Target size={18} className={actionable ? 'text-amber-400' : 'text-mf-txt4'} />
              </div>
              <div className="flex-1">
                <div className="section-title mb-1">Recommandation d'exploitation</div>
                <p className="text-sm text-mf-txt2 leading-relaxed">{rec.message}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-mf-txt4">
                  {actionable && (
                    <>
                      <span>P80 optimal : <strong className="text-amber-400">{Math.round(rec.optimalP80)} µm</strong></span>
                      <span>Récup. prédite : <strong className="text-emerald-400">{rec.predictedRecovery.toFixed(1)} %</strong></span>
                    </>
                  )}
                  <span>Effet marginal : <strong className="text-mf-txt3">{rec.marginalPerUm.toFixed(3)} pt/µm</strong></span>
                  <span>{rec.confident ? '✓ modèle fiable' : '⚠ confiance limitée — valider par essai'}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-4">
        {/* Prediction input panel */}
        <div className="card space-y-3">
          <div className="section-title">Simuler un scénario</div>
          <div className="text-xs text-mf-txt4">Modifier les paramètres minerai pour prédire la récupération</div>
          {([
            { key: 'auGrade' as const, label: 'Teneur Au (g/t)', min: 0.1, max: 20, step: 0.1 },
            { key: 'sSulfide' as const, label: 'S sulfure (%)', min: 0, max: 10, step: 0.1 },
            { key: 'cOrganic' as const, label: 'C organique (%)', min: 0, max: 5, step: 0.05 },
            { key: 'bwi' as const, label: 'BWi (kWh/t)', min: 5, max: 30, step: 0.5 },
            { key: 'grg' as const, label: 'GRG (%)', min: 0, max: 80, step: 1 },
            { key: 'p80' as const, label: 'P80 (µm)', min: 25, max: 200, step: 1 },
            { key: 'auFree' as const, label: 'Au libre (%)', min: 0, max: 100, step: 1 },
          ]).map(f => (
            <div key={f.key}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-mf-txt3">{f.label}</span>
                <span className="font-mono text-mf-txt font-semibold">{predInput[f.key]}</span>
              </div>
              <input
                type="range" min={f.min} max={f.max} step={f.step}
                value={predInput[f.key]}
                onChange={e => setPredInput(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                className="w-full accent-amber-500"
              />
            </div>
          ))}
        </div>

        {/* Prediction result + feature importance */}
        <div className="space-y-4">
          <div className="card text-center py-6">
            <div className="text-xs text-mf-txt4 mb-2">Récupération prédite</div>
            <div className="text-5xl font-bold font-mono text-amber-400 mb-2">
              {prediction ? formatDecimalGrouped(prediction.point, 1) : '—'}%
            </div>
            {prediction && (
              <div className="text-xs text-mf-txt3">
                Intervalle de confiance 95%: <span className="text-mf-txt font-mono">{formatDecimalGrouped(prediction.lower, 1)}% — {formatDecimalGrouped(prediction.upper, 1)}%</span>
              </div>
            )}
            <div className="text-[10px] text-mf-txt4 mt-2">
              Confiance du modèle: {prediction ? (prediction.confidence * 100).toFixed(0) : 0}% (R²)
            </div>
          </div>

          <div className="card">
            <div className="section-title mb-3">Importance des variables</div>
            <div className="space-y-2">
              {model!.featureImportance.map((fi, i) => {
                const maxImp = model!.featureImportance[0].normalized;
                const pct = maxImp > 0 ? (fi.normalized / maxImp) * 100 : 0;
                const labels: Record<string, string> = {
                  auGrade: 'Teneur Au', sSulfide: 'S sulfure', cOrganic: 'C organique',
                  bwi: 'BWi', grg: 'GRG', p80: 'P80', auFree: 'Au libre',
                };
                return (
                  <div key={fi.feature} className="flex items-center gap-2">
                    <div className="text-xs text-mf-txt3 w-24">{labels[fi.feature] ?? fi.feature}</div>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${fi.coefficient > 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-mono w-16 text-right text-mf-txt4">
                      {fi.coefficient > 0 ? '+' : ''}{fi.coefficient.toFixed(3)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-mf-border text-[10px] text-mf-txt4">
              Coefficients normalisés — barres vertes = effet positif sur récupération, rouges = effet négatif
            </div>
          </div>
        </div>
      </div>

      {/* Training data table */}
      <div className="card">
        <div className="section-title mb-3">Données d'entraînement ({samples.length} échantillons)</div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Au (g/t)</th><th>S (%)</th><th>Corg (%)</th><th>BWi</th>
                <th>GRG (%)</th><th>P80 (<span className="normal-case">µm</span>)</th><th>Au free (%)</th>
                <th>Récup. observée</th><th>Récup. prédite</th><th>Erreur</th>
              </tr>
            </thead>
            <tbody>
              {samples.slice(0, 20).map((s, i) => {
                const pred = predictRecovery(model!.coefficients, s);
                const err = s.recovery - pred;
                return (
                  <tr key={i}>
                    <td className="num">{s.auGrade.toFixed(2)}</td>
                    <td className="num">{s.sSulfide.toFixed(2)}</td>
                    <td className="num">{s.cOrganic.toFixed(2)}</td>
                    <td className="num">{s.bwi.toFixed(1)}</td>
                    <td className="num">{s.grg.toFixed(0)}</td>
                    <td className="num">{s.p80.toFixed(0)}</td>
                    <td className="num">{s.auFree.toFixed(0)}</td>
                    <td className="num font-semibold text-mf-txt">{s.recovery.toFixed(1)}%</td>
                    <td className="num text-amber-400">{pred.toFixed(1)}%</td>
                    <td className={`num ${Math.abs(err) < model!.rmse ? 'text-emerald-400' : 'text-orange-400'}`}>
                      {err > 0 ? '+' : ''}{err.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {samples.length > 20 && (
          <div className="text-center text-xs text-mf-txt4 mt-2">
            Affichage des 20 premiers sur {samples.length} échantillons
          </div>
        )}
      </div>
    </div>
  );
}
