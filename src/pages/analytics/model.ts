import { formatDecimalGrouped } from '../../lib/format/number';

import { estimateRoutes, type RouteEstimate } from '../../lib/analytics/routeEstimation';
import type { RouteStageEfficiencies, AdsorptionDecisionThresholds } from '../../lib/config/metConstants';
import { recommendAdsorptionCircuit, type AdsorptionDecision } from '../../lib/analytics/adsorptionCircuit';
import { ROUTE_ESTIMATION } from '../../lib/analytics/routeSelection';


// ─── Types ────────────────────────────────────────────────────────────────────

export interface LimsData {
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

export interface GeometEntry {
  sample_id: string;
  domain: string | null;
  ore_type: 'Oxyde' | 'Sulfure' | 'Transition' | 'Indéterminé';
  recovery_driver: string;
  anomaly: string | null;
  recommendation: string;
  score: number; // 0-100 metallurgical score
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function robustMean(vals: (number | null | undefined)[]): number | null {
  const v = vals.filter((x): x is number => typeof x === 'number' && !isNaN(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function pct(n: number, total: number) { return total > 0 ? Math.round((n / total) * 100) : 0; }

// ─── Route engine ─────────────────────────────────────────────────────────────

export function computeRoutes(data: LimsData, stageEfficiencies?: RouteStageEfficiencies, adsorptionDecision?: AdsorptionDecisionThresholds): RouteEstimate[] {
  // Le calcul vit dans lib/analytics/routeEstimation (pur, testé, PARTAGÉ avec
  // la section P80 de Granulométrie). Cette page ne fait qu'agréger les essais
  // LIMS en métriques ; dupliquer la logique ici garantirait que les deux
  // écrans finissent par recommander des circuits différents.
  return estimateRoutes({
    metrics: {
      leachRec24Pct:    robustMean(data.leaching.map(t => t.leach_rec_24h_pct)),
      leachRec48Pct:    robustMean(data.leaching.map(t => t.leach_rec_48h_pct)),
      grgPct:           robustMean(data.knelson.map(t => t.grg_recovery_pct)),
      organicCarbonPct: robustMean(data.chem.map(t => t.c_organic_pct)),
      flotationAuRecPct: robustMean(data.flotation.map(t => t.au_recovery_pct)),
      sulphidePct:      robustMean(data.chem.map(t => t.s_sulfide_pct)),
      auFreePct:        robustMean(data.mineralogy.map(t => t.au_free_pct)),
    },
    counts: {
      chem:        data.chem.length,
      comminution: data.comminution.length,
      knelson:     data.knelson.length,
      flotation:   data.flotation.length,
      leaching:    data.leaching.length,
      mineralogy:  data.mineralogy.length,
    },
    adsorptionCircuit: cilVsCip(data, adsorptionDecision).recommendation,
    stageEfficiencies,
  });
}

// ─── CIL vs CIP recommendation helper ────────────────────────────────────────

export function cilVsCip(data: LimsData, thresholds?: AdsorptionDecisionThresholds): AdsorptionDecision {
  // Décision déléguée au moteur partagé (lib/analytics/adsorptionCircuit) : la
  // section P80 de Granulométrie doit trancher CIL/CIP exactement pareil.
  return recommendAdsorptionCircuit({
    organicCarbonPct: robustMean(data.chem.map(t => t.c_organic_pct)),
    nacnKgT:          robustMean(data.leaching.map(t => t.nacn_consumption_kg_t)),
    auFeedGt:         robustMean(data.leaching.map(t => t.au_feed_g_t)),
    sulphidePct:      robustMean(data.chem.map(t => t.s_sulfide_pct)),
  }, thresholds);
}

// ─── Geomét analysis ─────────────────────────────────────────────────────────

export function computeGeomet(data: LimsData): GeometEntry[] {
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
