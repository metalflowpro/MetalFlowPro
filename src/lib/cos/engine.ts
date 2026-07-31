import type {
  CosEquipmentStatus,
  CosStream,
} from '../../types';

// ─── Equipment Health ─────────────────────────────────────────────

export interface HealthComponent {
  label: string;
  value: number;
  weight: number;
  max: number;
}

export function computeHealthIndex(components: HealthComponent[]): number {
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  if (totalWeight === 0) return 100;
  const weighted = components.reduce((s, c) => {
    const ratio = Math.max(0, Math.min(1, c.value / c.max));
    return s + ratio * c.weight;
  }, 0);
  return Math.round((weighted / totalWeight) * 100);
}

export function computeOEE(
  availability: number,
  performance: number,
  quality: number,
): number {
  return +((availability / 100) * (performance / 100) * (quality / 100) * 100).toFixed(1);
}

export function classifyHealth(index: number): {
  label: string;
  color: string;
} {
  if (index >= 80) return { label: 'Bon', color: 'text-emerald-400' };
  if (index >= 60) return { label: 'Surveillance', color: 'text-amber-400' };
  if (index >= 40) return { label: 'Dégradé', color: 'text-orange-400' };
  return { label: 'Critique', color: 'text-red-400' };
}

export function predictRUL(
  healthIndex: number,
  degradationRatePerHour: number,
): number | null {
  if (degradationRatePerHour <= 0) return null;
  return Math.max(0, Math.round(healthIndex / degradationRatePerHour));
}

export function failureProbability(
  rulH: number | null,
  horizonH: number,
): number {
  if (rulH == null || rulH <= 0) return 1;
  const ratio = horizonH / rulH;
  return Math.min(1, Math.max(0, ratio));
}

// ─── Blending Optimizer ───────────────────────────────────────────

export interface BlendInput {
  lotId: string;
  sourceName: string;
  auGt: number;
  bwi: number | null;
  sulfidesPct: number;
  organicCarbonPct: number;
  clayPct: number;
  tonnageT: number;
  isAvailable: boolean;
}

export interface BlendResult {
  sources: Array<{
    lotId: string;
    sourceName: string;
    proportionPct: number;
    tph: number;
    auGt: number;
    bwi: number | null;
  }>;
  blendedAuGt: number;
  blendedBwi: number | null;
  blendedSulfidesPct: number;
  blendedPrcPct: number;
  blendedClayPct: number;
  totalTph: number;
  predictedRecoveryPct: number;
  predictedNacnKgT: number;
  predictedCaoKgT: number;
  feasible: boolean;
  warnings: string[];
}

export interface BlendConstraints {
  targetTph: number;
  targetAuGt: number;
  minAuGt: number;
  maxAuGt: number;
  maxSulfidesPct: number;
  maxPrcPct: number;
  maxClayPct: number;
  maxBwi: number;
}

const DEFAULT_CONSTRAINTS: BlendConstraints = {
  targetTph: 250,
  targetAuGt: 1.8,
  minAuGt: 1.2,
  maxAuGt: 3.0,
  maxSulfidesPct: 8,
  maxPrcPct: 1.5,
  maxClayPct: 15,
  maxBwi: 18,
};

export function optimizeBlend(
  lots: BlendInput[],
  constraints: BlendConstraints = DEFAULT_CONSTRAINTS,
): BlendResult {
  const available = lots.filter(l => l.isAvailable && l.tonnageT > 0);
  const warnings: string[] = [];

  if (available.length === 0) {
    return {
      sources: [],
      blendedAuGt: 0,
      blendedBwi: null,
      blendedSulfidesPct: 0,
      blendedPrcPct: 0,
      blendedClayPct: 0,
      totalTph: 0,
      predictedRecoveryPct: 0,
      predictedNacnKgT: 0,
      predictedCaoKgT: 0,
      feasible: false,
      warnings: ['Aucun lot de minerai disponible'],
    };
  }

  // Simple greedy: weight by grade proximity to target and tonnage availability
  const target = constraints.targetAuGt;
  const scored = available.map(l => {
    const gradeScore = 1 / (1 + Math.abs(l.auGt - target));
    const hardScore = l.bwi ? 1 / (1 + Math.max(0, l.bwi - constraints.maxBwi)) : 1;
    const prcScore = l.organicCarbonPct > constraints.maxPrcPct ? 0.1 : 1;
    const score = gradeScore * hardScore * prcScore;
    return { lot: l, score };
  }).sort((a, b) => b.score - a.score);

  // Distribute proportions proportional to score, capped by tonnage
  const totalScore = scored.reduce((s, x) => s + x.score, 0);
  const sources: BlendResult['sources'] = [];
  let remainingTph = constraints.targetTph;

  for (const { lot, score } of scored) {
    if (remainingTph <= 0) break;
    const share = score / totalScore;
    let tph = Math.min(remainingTph, share * constraints.targetTph, lot.tonnageT * 0.1);
    if (tph <= 0) continue;
    tph = +tph.toFixed(1);
    remainingTph -= tph;
    sources.push({
      lotId: lot.lotId,
      sourceName: lot.sourceName,
      proportionPct: +((tph / constraints.targetTph) * 100).toFixed(1),
      tph,
      auGt: lot.auGt,
      bwi: lot.bwi,
    });
  }

  const totalTph = sources.reduce((s, x) => s + x.tph, 0);
  if (totalTph === 0) {
    return {
      sources: [],
      blendedAuGt: 0,
      blendedBwi: null,
      blendedSulfidesPct: 0,
      blendedPrcPct: 0,
      blendedClayPct: 0,
      totalTph: 0,
      predictedRecoveryPct: 0,
      predictedNacnKgT: 0,
      predictedCaoKgT: 0,
      feasible: false,
      warnings: ['Tonnage insuffisant pour atteindre le débit cible'],
    };
  }

  const blendedAuGt = sources.reduce((s, x) => s + x.auGt * x.tph, 0) / totalTph;
  const bwiVals = sources.filter(x => x.bwi != null);
  const blendedBwi = bwiVals.length > 0
    ? bwiVals.reduce((s, x) => s + (x.bwi ?? 0) * x.tph, 0) / bwiVals.reduce((s, x) => s + x.tph, 0)
    : null;

  const lotMap = new Map(available.map(l => [l.lotId, l]));
  const blendedSulfidesPct = sources.reduce((s, x) => {
    const lot = lotMap.get(x.lotId);
    return s + (lot?.sulfidesPct ?? 0) * x.tph;
  }, 0) / totalTph;
  const blendedPrcPct = sources.reduce((s, x) => {
    const lot = lotMap.get(x.lotId);
    return s + (lot?.organicCarbonPct ?? 0) * x.tph;
  }, 0) / totalTph;
  const blendedClayPct = sources.reduce((s, x) => {
    const lot = lotMap.get(x.lotId);
    return s + (lot?.clayPct ?? 0) * x.tph;
  }, 0) / totalTph;

  // Predictions (simplified empirical models)
  const predictedRecoveryPct = predictRecovery(blendedAuGt, blendedSulfidesPct, blendedPrcPct, blendedBwi);
  const predictedNacnKgT = predictNacn(blendedAuGt, blendedSulfidesPct);
  const predictedCaoKgT = predictCao(blendedSulfidesPct, blendedPrcPct);

  let feasible = true;
  if (blendedAuGt < constraints.minAuGt) {
    feasible = false;
    warnings.push(`Teneur blend ${blendedAuGt.toFixed(2)} g/t < minimum ${constraints.minAuGt} g/t`);
  }
  if (blendedAuGt > constraints.maxAuGt) {
    warnings.push(`Teneur blend ${blendedAuGt.toFixed(2)} g/t > maximum ${constraints.maxAuGt} g/t (dilution possible)`);
  }
  if (blendedSulfidesPct > constraints.maxSulfidesPct) {
    feasible = false;
    warnings.push(`Sulfures ${blendedSulfidesPct.toFixed(1)}% > limite ${constraints.maxSulfidesPct}%`);
  }
  if (blendedPrcPct > constraints.maxPrcPct) {
    warnings.push(`Carbone organique (PRC) ${blendedPrcPct.toFixed(2)}% > limite ${constraints.maxPrcPct}% — risque de preg-robbing`);
  }
  if (blendedClayPct > constraints.maxClayPct) {
    warnings.push(`Argiles ${blendedClayPct.toFixed(1)}% > limite ${constraints.maxClayPct}% — viscosité pulpe`);
  }
  if (blendedBwi != null && blendedBwi > constraints.maxBwi) {
    warnings.push(`BWI ${blendedBwi.toFixed(1)} > limite ${constraints.maxBwi} — débit broyeur réduit`);
  }

  return {
    sources,
    blendedAuGt: +blendedAuGt.toFixed(3),
    blendedBwi: blendedBwi != null ? +blendedBwi.toFixed(2) : null,
    blendedSulfidesPct: +blendedSulfidesPct.toFixed(2),
    blendedPrcPct: +blendedPrcPct.toFixed(3),
    blendedClayPct: +blendedClayPct.toFixed(2),
    totalTph: +totalTph.toFixed(1),
    predictedRecoveryPct: +predictedRecoveryPct.toFixed(1),
    predictedNacnKgT: +predictedNacnKgT.toFixed(2),
    predictedCaoKgT: +predictedCaoKgT.toFixed(2),
    feasible,
    warnings,
  };
}

export function predictRecovery(auGt: number, sulfides: number, prc: number, bwi: number | null): number {
  let r = 92;
  r -= Math.max(0, sulfides - 2) * 1.5;
  r -= Math.max(0, prc - 0.5) * 8;
  if (bwi != null && bwi > 14) r -= (bwi - 14) * 0.8;
  r -= Math.max(0, 2.5 - auGt) * 2;
  return Math.max(60, Math.min(96, r));
}

export function predictNacn(auGt: number, sulfides: number): number {
  let n = 0.35 + auGt * 0.05;
  n += sulfides * 0.08;
  return Math.max(0.2, Math.min(1.5, n));
}

export function predictCao(sulfides: number, prc: number): number {
  let c = 2.5 + sulfides * 0.15;
  c += prc * 0.5;
  return Math.max(1.5, Math.min(8, c));
}

// ─── Mass Balance / Reconciliation (AMIRA P754) ─────────────────

export interface ReconciliationInput {
  feedMassT: number;
  feedAuGt: number;
  productMassT: number;
  productAuGt: number;
  tailMassT: number;
  tailAuGt: number;
  deltaStockG: number;
  feedUncertaintyPct: number;
  productUncertaintyPct: number;
  tailUncertaintyPct: number;
}

export interface ReconciliationResult {
  feedMetalG: number;
  productMetalG: number;
  tailMetalG: number;
  recoveryPct: number;
  unaccountedMetalPct: number;
  variancePct: number;
  biasFlag: boolean;
  feasible: boolean;
  notes: string[];
}

export function runReconciliation(input: ReconciliationInput): ReconciliationResult {
  const feedMetalG = input.feedMassT * input.feedAuGt;
  const productMetalG = input.productMassT * input.productAuGt;
  const tailMetalG = input.tailMassT * input.tailAuGt;

  const outputMetal = productMetalG + tailMetalG + input.deltaStockG;
  const recoveryPct = feedMetalG > 0 ? (productMetalG / feedMetalG) * 100 : 0;
  const unaccountedMetalPct = feedMetalG > 0
    ? ((feedMetalG - outputMetal) / feedMetalG) * 100
    : 0;

  // Weighted variance (simplified — moindres carrés pondérés)
  const feedVar = (input.feedUncertaintyPct / 100) * feedMetalG;
  const productVar = (input.productUncertaintyPct / 100) * productMetalG;
  const tailVar = (input.tailUncertaintyPct / 100) * tailMetalG;
  const totalVar = Math.sqrt(feedVar ** 2 + productVar ** 2 + tailVar ** 2);
  const variancePct = feedMetalG > 0 ? (totalVar / feedMetalG) * 100 : 0;

  // P754 principle 10: bias flag if |unaccounted| > 2× variance
  const biasFlag = Math.abs(unaccountedMetalPct) > 2 * variancePct && variancePct > 0;
  const feasible = Math.abs(unaccountedMetalPct) < 15;

  const notes: string[] = [];
  if (biasFlag) {
    notes.push('Biais systématique détecté — investiguer la source (principe P754 n°10)');
  }
  if (Math.abs(unaccountedMetalPct) > 5) {
    notes.push('Métal non comptabilisé > 5% — vérifier les mesures de masse et teneur');
  }
  if (variancePct > 5) {
    notes.push('Variance élevée — améliorer la précision des instruments (P754 n°8)');
  }
  if (input.feedMassT === 0 && input.productMassT === 0 && input.tailMassT === 0) {
    notes.push('Aucune donnée de masse — réconciliation impossible');
  }

  return {
    feedMetalG: Math.round(feedMetalG),
    productMetalG: Math.round(productMetalG),
    tailMetalG: Math.round(tailMetalG),
    recoveryPct: +recoveryPct.toFixed(2),
    unaccountedMetalPct: +unaccountedMetalPct.toFixed(2),
    variancePct: +variancePct.toFixed(2),
    biasFlag,
    feasible,
    notes,
  };
}

// ─── Stream mass balance ──────────────────────────────────────────

export interface StreamBalance {
  totalFeedTph: number;
  totalOutputTph: number;
  massClosurePct: number;
  auFeedGt: number;
  auOutputGt: number;
  metalBalancePct: number;
  dataQualityIssues: string[];
}

export function computeStreamBalance(streams: CosStream[]): StreamBalance {
  const feeds = streams.filter(s => s.stream_type === 'feed');
  const outputs = streams.filter(s => s.stream_type === 'product' || s.stream_type === 'tail');
  const intermediates = streams.filter(s => s.stream_type === 'intermediate');

  const totalFeedTph = feeds.reduce((s, x) => s + x.mass_tph, 0);
  const totalOutputTph = outputs.reduce((s, x) => s + x.mass_tph, 0);
  const massClosurePct = totalFeedTph > 0
    ? (totalOutputTph / totalFeedTph) * 100
    : 0;

  const auFeedGt = totalFeedTph > 0
    ? feeds.reduce((s, x) => s + x.au_g_t * x.mass_tph, 0) / totalFeedTph
    : 0;
  const totalOutputMetal = outputs.reduce((s, x) => s + x.au_g_t * x.mass_tph, 0);
  const auOutputGt = totalOutputTph > 0 ? totalOutputMetal / totalOutputTph : 0;
  const feedMetal = feeds.reduce((s, x) => s + x.au_g_t * x.mass_tph, 0);
  const metalBalancePct = feedMetal > 0 ? (totalOutputMetal / feedMetal) * 100 : 0;

  const dataQualityIssues: string[] = [];
  for (const s of streams) {
    if (s.data_quality === 'frozen') {
      dataQualityIssues.push(`${s.stream_id}: capteur gelé`);
    }
    if (s.data_quality === 'missing') {
      dataQualityIssues.push(`${s.stream_id}: donnée manquante`);
    }
    if (s.data_quality === 'suspect') {
      dataQualityIssues.push(`${s.stream_id}: valeur suspecte`);
    }
    if (s.is_provisional) {
      dataQualityIssues.push(`${s.stream_id}: donnée provisoire non signée`);
    }
  }
  if (intermediates.length === 0 && feeds.length > 0) {
    dataQualityIssues.push('Aucun courant intermédiaire défini — bilan incomplet');
  }

  return {
    totalFeedTph: +totalFeedTph.toFixed(1),
    totalOutputTph: +totalOutputTph.toFixed(1),
    massClosurePct: +massClosurePct.toFixed(1),
    auFeedGt: +auFeedGt.toFixed(3),
    auOutputGt: +auOutputGt.toFixed(3),
    metalBalancePct: +metalBalancePct.toFixed(1),
    dataQualityIssues,
  };
}

// ─── Bottleneck detection ─────────────────────────────────────────

export function detectBottlenecks(equipment: CosEquipmentStatus[]): CosEquipmentStatus[] {
  return equipment
    .filter(e => e.state === 'running')
    .sort((a, b) => a.load_pct - b.load_pct)
    .slice(0, 3);
}

// ─── Alert generation helpers ────────────────────────────────────

export interface AlertSeed {
  alert_type: 'bottleneck' | 'anomaly' | 'drift' | 'threshold' | 'predictive';
  severity: 'urgent' | 'high' | 'medium' | 'low';
  entity: string;
  entity_name: string;
  domain: string;
  cause: string;
  description: string;
  evidence: Array<Record<string, unknown>>;
}

export function generateEquipmentAlerts(equipment: CosEquipmentStatus[]): AlertSeed[] {
  const alerts: AlertSeed[] = [];
  for (const eq of equipment) {
    if (eq.health_index < 40 && eq.state === 'running') {
      alerts.push({
        alert_type: 'predictive',
        severity: 'urgent',
        entity: eq.equipment_tag,
        entity_name: eq.equipment_name,
        domain: eq.section,
        cause: 'Dégradation santé équipement',
        description: `${eq.equipment_name}: indice de santé ${eq.health_index}/100 — risque de défaillance imminente`,
        evidence: [{ tag: 'health_index', value: eq.health_index }],
      });
    }
    if (eq.is_bottleneck) {
      alerts.push({
        alert_type: 'bottleneck',
        severity: 'high',
        entity: eq.equipment_tag,
        entity_name: eq.equipment_name,
        domain: eq.section,
        cause: 'Goulot d\'étranglement',
        description: `${eq.equipment_name} identifié comme goulot — charge ${eq.load_pct}%`,
        evidence: [{ tag: 'load_pct', value: eq.load_pct }],
      });
    }
    if (eq.failure_prob_24h > 0.5) {
      alerts.push({
        alert_type: 'predictive',
        severity: 'high',
        entity: eq.equipment_tag,
        entity_name: eq.equipment_name,
        domain: eq.section,
        cause: 'Probabilité de panne élevée 24h',
        description: `${eq.equipment_name}: P(défaillance 24h) = ${(eq.failure_prob_24h * 100).toFixed(0)}%`,
        evidence: [{ tag: 'failure_prob_24h', value: eq.failure_prob_24h }],
      });
    }
    if (eq.state === 'fault') {
      alerts.push({
        alert_type: 'threshold',
        severity: 'urgent',
        entity: eq.equipment_tag,
        entity_name: eq.equipment_name,
        domain: eq.section,
        cause: eq.downtime_reason ?? 'Panne en cours',
        description: `${eq.equipment_name} en panne`,
        evidence: [{ tag: 'state', value: 'fault' }],
      });
    }
  }
  return alerts;
}

export function generateStreamAlerts(streams: CosStream[]): AlertSeed[] {
  const alerts: AlertSeed[] = [];
  for (const s of streams) {
    if (s.data_quality === 'frozen') {
      alerts.push({
        alert_type: 'drift',
        severity: 'high',
        entity: s.stream_id,
        entity_name: s.name,
        domain: s.section,
        cause: 'Capteur gelé',
        description: `${s.name}: capteur gelé — variance nulle détectée`,
        evidence: [{ tag: 'data_quality', value: 'frozen' }],
      });
    }
    if (s.data_quality === 'out_of_range') {
      alerts.push({
        alert_type: 'threshold',
        severity: 'high',
        entity: s.stream_id,
        entity_name: s.name,
        domain: s.section,
        cause: 'Valeur hors plage',
        description: `${s.name}: mesure hors plage opérationnelle`,
        evidence: [{ tag: 'data_quality', value: 'out_of_range' }],
      });
    }
    if (s.is_provisional) {
      alerts.push({
        alert_type: 'anomaly',
        severity: 'low',
        entity: s.stream_id,
        entity_name: s.name,
        domain: s.section,
        cause: 'Donnée provisoire',
        description: `${s.name}: donnée provisoire en attente de validation`,
        evidence: [{ tag: 'is_provisional', value: true }],
      });
    }
  }
  return alerts;
}

// ─── Recommendation generation ───────────────────────────────────

export interface RecoSeed {
  domain: string;
  objective: string;
  description: string;
  actions: Array<{
    setpoint: string;
    value: number;
    unit: string;
    within_corridor: [number, number];
  }>;
  expected_delta: Record<string, string>;
  confidence: number;
  evidence: Array<Record<string, unknown>>;
  priority: number;
}

export function generateRecommendations(
  equipment: CosEquipmentStatus[],
  streams: CosStream[],
  blend: BlendResult | null,
): RecoSeed[] {
  const recos: RecoSeed[] = [];

  // Grinding optimization
  const grinder = equipment.find(e => e.section === 'grinding' && e.state === 'running');
  if (grinder && grinder.load_pct < 85) {
    recos.push({
      domain: 'grinding',
      objective: 'maximize_throughput_within_p80',
      description: `Broyeur ${grinder.equipment_name} sous-chargé (${grinder.load_pct}%) — augmenter le débit d'alimentation`,
      actions: [
        { setpoint: 'feed_rate', value: grinder.load_pct + 15, unit: 't/h', within_corridor: [380, 440] },
      ],
      expected_delta: { throughput: '+3.2%', recovery: '+0.1%' },
      confidence: 0.86,
      evidence: [
        { tag: 'mill_power', note: 'sous-chargé' },
        { tag: 'p80', note: 'cible respectée' },
      ],
      priority: 2,
    });
  }

  // Leaching optimization
  const cnStream = streams.find(s => s.stream_id === 'CN_FREE');
  if (cnStream && cnStream.au_g_t < 0.3) {
    recos.push({
      domain: 'leaching',
      objective: 'optimize_cyanide_dosage',
      description: 'Concentration CN⁻ libre basse — ajuster le dosage cyanure pour maintenir la lixiviation',
      actions: [
        { setpoint: 'nacn_dosage', value: 0.45, unit: 'kg/t', within_corridor: [0.3, 0.8] },
      ],
      expected_delta: { recovery: '+0.5%', cost: '+2%' },
      confidence: 0.78,
      evidence: [
        { tag: 'cn_free', value: cnStream.au_g_t, note: 'sous seuil' },
      ],
      priority: 3,
    });
  }

  // Blending recommendation
  if (blend && !blend.feasible && blend.warnings.length > 0) {
    recos.push({
      domain: 'blending',
      objective: 'stabilize_feed_grade',
      description: `Plan de blend non conforme: ${blend.warnings[0]}`,
      actions: [
        { setpoint: 'blend_ratio', value: 50, unit: '%', within_corridor: [30, 70] },
      ],
      expected_delta: { recovery: '+1.2%', variance: '-15%' },
      confidence: 0.72,
      evidence: blend.warnings.map(w => ({ note: w })),
      priority: 1,
    });
  }

  // Equipment predictive maintenance
  const atRisk = equipment.find(e => e.failure_prob_72h > 0.4 && e.state === 'running');
  if (atRisk) {
    recos.push({
      domain: 'maintenance',
      objective: 'predictive_maintenance',
      description: `${atRisk.equipment_name}: probabilité de panne 72h = ${(atRisk.failure_prob_72h * 100).toFixed(0)}% — planifier inspection`,
      actions: [
        { setpoint: 'inspection_window', value: 24, unit: 'h', within_corridor: [8, 72] },
      ],
      expected_delta: { downtime: '-4h', risk: 'reduced' },
      confidence: 0.81,
      evidence: [
        { tag: 'failure_prob_72h', value: atRisk.failure_prob_72h },
        { tag: 'health_index', value: atRisk.health_index },
      ],
      priority: 2,
    });
  }

  return recos.sort((a, b) => a.priority - b.priority);
}
