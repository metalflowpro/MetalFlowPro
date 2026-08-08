// ─────────────────────────────────────────────────────────────────────────────
// P80 Optimization — moteur complet de la section « P80 Optimisation ».
//
// Pipeline : P80 LIMS (PSD) → P80 cible labo → P80 optimal usine (×K_indus)
// → énergie Bond par circuit (+ chaînage, puissance) → 3 scénarios
// (Bond Energy / Recovery-driven / P80 Curve-driven) → recommandation
// hiérarchique par circuit avec niveau de confiance → commentaire ingénierie.
//
// Module PUR : pas de Supabase, pas de React — entièrement testable.
// S'appuie sur les primitives partagées de p80.ts / psd.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { TROY_OZ_GRAMS, DEFAULT_ASSUMPTIONS } from '../config/constants';
import { bondEnergy, plantGrindEnergy, recoveryModel, P80_LADDER } from './p80';
import { p80FromPsd, type PsdPoint } from './psd';

// ═══ 1. P80 LIMS depuis la courbe PSD ════════════════════════════════════════

export type SizeUnit = 'um' | 'mm';

export interface P80Measurement {
  /** P80 numérique, toujours restitué en µm. */
  valueUm: number | null;
  unit: 'um';
  method: 'exact' | 'log_interpolation' | 'insufficient_data';
  /** Courbe cumulative associée (µm, % passant). */
  curve: PsdPoint[];
  source: string;
  sampleId: string | null;
  dateAnalysis: string | null;
}

/**
 * P80 depuis une courbe cumulative, avec support des unités mm/µm et
 * conservation du lignage (source, échantillon, date).
 */
export function p80FromCurve(
  points: Array<{ sieve: number; passing: number }>,
  opts: { unit?: SizeUnit; source?: string; sampleId?: string | null; dateAnalysis?: string | null } = {},
): P80Measurement {
  const unit = opts.unit ?? 'um';
  const scale = unit === 'mm' ? 1000 : 1;
  const curve: PsdPoint[] = points
    .filter(p => p.sieve > 0 && Number.isFinite(p.passing))
    .map(p => ({ sieve: p.sieve * scale, passing: p.passing }))
    .sort((a, b) => a.sieve - b.sieve);

  const exact = curve.find(p => p.passing === 80) ?? null;
  const value = p80FromPsd(curve);
  return {
    valueUm: value,
    unit: 'um',
    method: value == null ? 'insufficient_data' : exact ? 'exact' : 'log_interpolation',
    curve,
    source: opts.source ?? 'manual',
    sampleId: opts.sampleId ?? null,
    dateAnalysis: opts.dateAnalysis ?? null,
  };
}

// ═══ 2. P80 cible labo ═══════════════════════════════════════════════════════

export type LabTestType = 'grind_leach' | 'flotation' | 'liberation' | 'engineer';

export interface LabTargetP80 {
  valueUm: number;
  testType: LabTestType;
  justification: string;
  /** Plage acceptable [min, max] µm. */
  rangeUm: [number, number];
}

export interface RecoveryCurveParams {
  auFreePct: number | null;
  recoveryCeilingPct: number;
  /** Seuil de surbroyage (µm) : en dessous, la récupération se dégrade. */
  overgrindThresholdUm?: number;
  /** Pente de dégradation (% récup. par µm sous le seuil). */
  overgrindPenaltyPctPerUm?: number;
}

export const DEFAULT_OVERGRIND = { thresholdUm: 45, penaltyPctPerUm: 0.06 } as const;

/**
 * Récupération métallurgique à un P80 donné — modèle de libération partagé
 * (recoveryModel) + pénalité de surbroyage sous un seuil configurable
 * (production de fines, pertes en slimes, viscosité pulpe).
 */
export function recoveryAtP80(p80Um: number, params: RecoveryCurveParams): number {
  const base = recoveryModel(p80Um, params.auFreePct, params.recoveryCeilingPct);
  const threshold = params.overgrindThresholdUm ?? DEFAULT_OVERGRIND.thresholdUm;
  const penalty = params.overgrindPenaltyPctPerUm ?? DEFAULT_OVERGRIND.penaltyPctPerUm;
  const overgrind = Math.max(0, threshold - p80Um) * penalty;
  return Math.max(0, base - overgrind);
}

/**
 * P80 cible labo = taille de meilleure réponse métallurgique sur l'échelle
 * scannée (compromis libération/récupération, surbroyage inclus), sauf si
 * l'ingénieur fixe une valeur.
 */
export function deriveLabTarget(
  params: RecoveryCurveParams,
  opts: { testType?: LabTestType; engineerValueUm?: number | null; ladder?: number[] } = {},
): LabTargetP80 {
  if (opts.engineerValueUm != null && opts.engineerValueUm > 0) {
    return {
      valueUm: opts.engineerValueUm,
      testType: 'engineer',
      justification: `Valeur fixée par l'ingénieur (${opts.engineerValueUm} µm).`,
      rangeUm: [opts.engineerValueUm * 0.85, opts.engineerValueUm * 1.15],
    };
  }
  const ladder = opts.ladder ?? P80_LADDER;
  const scored = ladder.map(p => ({ p80: p, rec: recoveryAtP80(p, params) }));
  const best = scored.reduce((b, s) => (s.rec > b.rec ? s : b), scored[0]);
  // Plage acceptable : tous les P80 dont la récupération est à ≤ 0.5 pt du max.
  const near = scored.filter(s => best.rec - s.rec <= 0.5).map(s => s.p80);
  return {
    valueUm: best.p80,
    testType: opts.testType ?? 'grind_leach',
    justification:
      `Meilleure réponse métallurgique à ${best.p80} µm (récupération ${best.rec.toFixed(1)} %) sur la courbe récupération vs P80 ; ` +
      `au-delà du seuil de surbroyage la finesse dégrade la performance.`,
    rangeUm: [Math.min(...near), Math.max(...near)],
  };
}

// ═══ 3. K_indus et P80 optimal usine ═════════════════════════════════════════

export type KIndusMode = 'default' | 'auto' | 'manual';

export interface KIndusInputs {
  /** Rendement de classification du circuit (%) — cyclones imparfaits ↗ K. */
  circuitEfficiencyPct?: number | null;
  /** Écart essai/exploitation observé (%) — usine plus grossière que le labo. */
  testVsPlantGapPct?: number | null;
  /** Stabilité du procédé (%) — un procédé instable impose une marge. */
  processStabilityPct?: number | null;
  /** Sensibilité récupération vs finesse (%/µm) — forte sensibilité ↘ K. */
  recoverySensitivityPctPerUm?: number | null;
}

export interface KIndusResult {
  k: number;
  mode: KIndusMode;
  basis: string[];
}

export const K_INDUS_DEFAULT = 1.18;
export const K_INDUS_BOUNDS: [number, number] = [1.0, 1.45];

/**
 * Heuristiques de repli utilisées quand une donnée d'essai manque.
 *
 * Chacune remplace une mesure de laboratoire absente par une règle de pouce
 * d'ingénierie. Elles doivent TOUTES céder la place à la valeur mesurée dès
 * qu'elle existe (le code applique systématiquement `mesure ?? repli`) :
 *   • cwiFromBwiRatio / cwiFloor : indice de concassage (CWi) déduit du BWi
 *     faute d'essai de concassage dédié. Le rapport CWi/BWi varie fortement
 *     selon la lithologie — un essai CWi (norme Bond) le remplace.
 *   • regrindWiFactor : le regrind broie des mixtes déjà concentrés, plus
 *     tenaces que l'alimentation ; on majore donc le Wi.
 *   • regrindP80Factor : cible de relibération du regrind, en fraction du P80
 *     usine.
 *   • defaultWiKwhT : dernier recours si aucun Wi n'est connu pour un type
 *     d'étage.
 *   • processMaxP80Factor : borne haute de la fenêtre procédé quand aucune
 *     contrainte explicite n'est saisie.
 */
export const P80_FALLBACK_HEURISTICS = {
  cwiFromBwiRatio: 0.75,
  cwiFloor: 8,
  regrindWiFactor: 1.1,
  regrindP80Factor: 0.5,
  defaultWiKwhT: 12,
  processMaxP80Factor: 1.2,
} as const;

/**
 * Barème d'ajustement du K_indus en mode « auto ».
 *
 * Chaque terme corrige le K de base à partir d'un indicateur d'exploitation :
 * on mesure l'écart de l'indicateur à un PIVOT (le niveau considéré comme
 * « normal », neutre) et on l'applique avec un POIDS. Un circuit moins efficace
 * ou un procédé moins stable que le pivot pousse le K vers le haut (l'usine
 * tourne plus grossier que le labo) ; l'inverse le tire vers le bas.
 *
 * ⚠️ Barème de jugement d'ingénierie, PAS une corrélation publiée : les pivots
 * et poids reflètent le comportement d'un circuit de broyage/CIL conventionnel
 * et doivent être recalés sur l'historique d'exploitation du site dès qu'il
 * existe (réconciliation labo/usine). Regroupés ici plutôt que dispersés dans le
 * calcul pour qu'un recalage soit une modification unique et visible.
 */
export const K_INDUS_AUTO_TUNING = {
  /** Rendement de circuit (%) considéré comme neutre, et poids de l'écart. */
  circuitEfficiencyPivotPct: 85,
  circuitEfficiencyWeight: 0.5,
  /** Stabilité de procédé (%) considérée comme neutre, et poids de l'écart. */
  processStabilityPivotPct: 90,
  processStabilityWeight: 0.3,
  /** Au-delà de cette sensibilité (%/µm), on reste délibérément proche du labo… */
  highRecoverySensitivityPctPerUm: 0.08,
  /** …en retranchant ce bonus au K. */
  highRecoverySensitivityCredit: 0.05,
} as const;

/**
 * Facteur de correction usine K_indus : P80_usine = P80_labo × K_indus.
 * L'usine tourne plus grossier que le labo (variabilité d'alimentation,
 * classification imparfaite, contraintes de débit).
 */
export function computeKIndus(
  mode: KIndusMode,
  inputs: KIndusInputs = {},
  manualValue?: number | null,
): KIndusResult {
  const clamp = (k: number) => Math.max(K_INDUS_BOUNDS[0], Math.min(K_INDUS_BOUNDS[1], k));
  if (mode === 'manual' && manualValue != null && manualValue > 0) {
    return { k: clamp(manualValue), mode, basis: [`Valeur saisie par l'utilisateur (${manualValue}).`] };
  }
  if (mode === 'auto') {
    let k = K_INDUS_DEFAULT;
    const basis: string[] = [`Base ${K_INDUS_DEFAULT}.`];
    const T = K_INDUS_AUTO_TUNING;
    if (inputs.circuitEfficiencyPct != null) {
      const adj = ((T.circuitEfficiencyPivotPct - Math.min(100, inputs.circuitEfficiencyPct)) / 100) * T.circuitEfficiencyWeight;
      k += adj;
      basis.push(`Rendement circuit ${inputs.circuitEfficiencyPct} % → ${adj >= 0 ? '+' : ''}${adj.toFixed(3)}.`);
    }
    if (inputs.processStabilityPct != null) {
      const adj = ((T.processStabilityPivotPct - Math.min(100, inputs.processStabilityPct)) / 100) * T.processStabilityWeight;
      k += adj;
      basis.push(`Stabilité procédé ${inputs.processStabilityPct} % → ${adj >= 0 ? '+' : ''}${adj.toFixed(3)}.`);
    }
    if (inputs.testVsPlantGapPct != null) {
      const adj = inputs.testVsPlantGapPct / 100;
      k += adj;
      basis.push(`Écart essai/exploitation ${inputs.testVsPlantGapPct} % → ${adj >= 0 ? '+' : ''}${adj.toFixed(3)}.`);
    }
    if (inputs.recoverySensitivityPctPerUm != null && inputs.recoverySensitivityPctPerUm > T.highRecoverySensitivityPctPerUm) {
      k -= T.highRecoverySensitivityCredit;
      basis.push(`Sensibilité récupération élevée (${inputs.recoverySensitivityPctPerUm} %/µm) → −${T.highRecoverySensitivityCredit.toFixed(3)} (rester proche du labo).`);
    }
    return { k: clamp(k), mode, basis };
  }
  return { k: K_INDUS_DEFAULT, mode: 'default', basis: [`Défaut documenté ${K_INDUS_DEFAULT} (Wio/Wi typique circuit CIL).`] };
}

// ═══ 4. Circuits et énergie Bond ═════════════════════════════════════════════

export type CircuitType =
  | 'crush_primary' | 'crush_secondary' | 'crush_tertiary'
  | 'sag' | 'ball' | 'regrind';

export interface CircuitDef {
  type: CircuitType;
  label: string;
  /** Fenêtre mécanique du P80 produit [min, max] µm. */
  p80WindowUm: [number, number];
  /** F80 par défaut (µm) si le chaînage ne l'impose pas. */
  defaultF80Um: number;
  /** Part de l'énergie totale portée par ce circuit (indicatif). */
  present: boolean;
}

/** Chaîne de comminution par défaut — chaque fenêtre est une contrainte mécanique. */
export function defaultCircuitChain(withRegrind = false): CircuitDef[] {
  return [
    { type: 'crush_primary',   label: 'Concassage primaire',   p80WindowUm: [80_000, 200_000], defaultF80Um: 600_000, present: true },
    { type: 'crush_secondary', label: 'Concassage secondaire', p80WindowUm: [20_000, 60_000],  defaultF80Um: 150_000, present: true },
    { type: 'crush_tertiary',  label: 'Concassage tertiaire',  p80WindowUm: [6_000, 15_000],   defaultF80Um: 40_000,  present: true },
    { type: 'sag',             label: 'Broyage SAG',           p80WindowUm: [800, 3_000],      defaultF80Um: 10_000,  present: true },
    { type: 'ball',            label: 'Broyage ball mill',     p80WindowUm: [45, 300],         defaultF80Um: 2_000,   present: true },
    { type: 'regrind',         label: 'Regrind',               p80WindowUm: [15, 75],          defaultF80Um: 150,     present: withRegrind },
  ];
}

export interface CircuitEnergyInput {
  type: CircuitType;
  label: string;
  f80Um: number;
  p80Um: number;
  /** Work index applicable au circuit (CWi concassage, BWi broyage), kWh/t. */
  wi: number;
  throughputTph?: number | null;
  availablePowerKw?: number | null;
}

export interface CircuitEnergyResult extends CircuitEnergyInput {
  specificEnergyKwhT: number;
  powerRequiredKw: number | null;
  powerUtilizationPct: number | null;
}

/** Énergie Bond d'un circuit : E = 10·Wi·(1/√P80 − 1/√F80), + puissance requise. */
export function circuitEnergy(input: CircuitEnergyInput): CircuitEnergyResult {
  const e = bondEnergy(input.wi, input.f80Um, input.p80Um);
  const power = input.throughputTph != null && input.throughputTph > 0 ? e * input.throughputTph : null;
  return {
    ...input,
    specificEnergyKwhT: e,
    powerRequiredKw: power,
    powerUtilizationPct: power != null && input.availablePowerKw ? (power / input.availablePowerKw) * 100 : null,
  };
}

export interface ChainEnergyResult {
  perCircuit: CircuitEnergyResult[];
  totalKwhT: number;
  totalPowerKw: number | null;
  /** Écart vs cible design (%), si une cible est fournie. */
  designDeltaPct: number | null;
}

/** Énergie totale d'une chaîne (étapes chaînées F80→P80→F80…). */
export function chainEnergy(
  circuits: CircuitEnergyInput[],
  designTargetKwhT?: number | null,
): ChainEnergyResult {
  const perCircuit = circuits.map(circuitEnergy);
  const totalKwhT = perCircuit.reduce((s, c) => s + c.specificEnergyKwhT, 0);
  const powers = perCircuit.map(c => c.powerRequiredKw).filter((p): p is number => p != null);
  return {
    perCircuit,
    totalKwhT,
    totalPowerKw: powers.length > 0 ? powers.reduce((s, p) => s + p, 0) : null,
    designDeltaPct: designTargetKwhT && designTargetKwhT > 0 ? ((totalKwhT - designTargetKwhT) / designTargetKwhT) * 100 : null,
  };
}

// ═══ 5. Scénarios d'optimisation ═════════════════════════════════════════════

export type ScenarioId = 'bond_energy' | 'recovery_driven' | 'curve_driven';

export interface ScenarioPoint {
  p80: number;
  energyKwhT: number;       // énergie usine (EF5 + facteur usine/labo)
  recoveryPct: number;
  energyCostUsdT: number;
  revenueUsdT: number;
  netUsdT: number;
  /** Pente économique marginale vs le point plus grossier précédent ($/t par µm). */
  marginalNetPerUm: number | null;
}

export interface ScenarioResult {
  id: ScenarioId;
  label: string;
  objective: string;
  p80Um: number;
  energyKwhT: number;
  powerKw: number | null;
  recoveryPct: number;
  netUsdT: number;
  /** Économie (négatif) ou surplus (positif) d'énergie vs le scénario retenu. */
  note: string;
}

export interface ScenarioInputs {
  bwi: number;
  f80Um: number;
  recovery: RecoveryCurveParams;
  goldGradeGt: number;
  goldPriceUsdOz: number;
  elecCostUsdKwh?: number;
  plantFactor?: number;
  throughputTph?: number | null;
  /** Contrainte process : P80 maximal admissible en aval (µm). */
  processMaxP80Um?: number | null;
  /** Contrainte mécanique du circuit de broyage final [min,max] µm. */
  millWindowUm?: [number, number];
  ladder?: number[];
}

export interface ScenariosResult {
  points: ScenarioPoint[];
  scenarios: ScenarioResult[];
  selected: ScenarioResult;
  selectionReason: string;
}

/** Balaye l'échelle P80 et construit la courbe économique complète. */
export function buildScenarioPoints(inputs: ScenarioInputs): ScenarioPoint[] {
  const elec = inputs.elecCostUsdKwh ?? DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;
  const pf = inputs.plantFactor ?? DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR;
  const ladder = [...(inputs.ladder ?? P80_LADDER)].sort((a, b) => b - a); // grossier → fin
  const pts: ScenarioPoint[] = ladder.map(p => {
    const energy = plantGrindEnergy(inputs.bwi, inputs.f80Um, p, pf, true);
    const rec = recoveryAtP80(p, inputs.recovery);
    const revenue = inputs.goldGradeGt * (rec / 100) / TROY_OZ_GRAMS * inputs.goldPriceUsdOz;
    const cost = energy * elec;
    return {
      p80: p, energyKwhT: energy, recoveryPct: rec,
      energyCostUsdT: cost, revenueUsdT: revenue, netUsdT: revenue - cost,
      marginalNetPerUm: null,
    };
  });
  for (let i = 1; i < pts.length; i++) {
    const dUm = pts[i - 1].p80 - pts[i].p80; // µm de finesse gagnés
    pts[i].marginalNetPerUm = dUm > 0 ? (pts[i].netUsdT - pts[i - 1].netUsdT) / dUm : null;
  }
  return pts;
}

/**
 * Les trois scénarios de la spec :
 *  - Bond Energy : minimiser l'énergie en respectant le P80 de procédé.
 *  - Recovery-driven : maximiser la récupération (courbe récup. vs P80).
 *  - Curve-driven : meilleur point de pente économique (gain marginal récup.
 *    vs coût marginal énergie) — maximum de la valeur nette.
 */
export function runScenarios(inputs: ScenarioInputs): ScenariosResult {
  const pts = buildScenarioPoints(inputs);
  const window = inputs.millWindowUm ?? [45, 300];
  const inWindow = pts.filter(p => p.p80 >= window[0] && p.p80 <= window[1]);
  const usable = inWindow.length > 0 ? inWindow : pts;
  const tph = inputs.throughputTph ?? null;
  const power = (e: number) => (tph != null && tph > 0 ? e * tph : null);

  // Bond Energy : P80 le plus grossier respectant la contrainte process → E min.
  const processMax = inputs.processMaxP80Um ?? window[1];
  const bondOk = usable.filter(p => p.p80 <= processMax);
  const bondPick = (bondOk.length > 0 ? bondOk : usable)
    .reduce((b, p) => (p.energyKwhT < b.energyKwhT ? p : b));

  // Recovery-driven : récupération maximale (le surbroyage est déjà pénalisé).
  const recPick = usable.reduce((b, p) => (p.recoveryPct > b.recoveryPct ? p : b));

  // Curve-driven : valeur nette maximale = pente marginale nulle (optimum économique).
  const curvePick = usable.reduce((b, p) => (p.netUsdT > b.netUsdT ? p : b));

  const mk = (id: ScenarioId, label: string, objective: string, p: ScenarioPoint, note: string): ScenarioResult => ({
    id, label, objective,
    p80Um: p.p80, energyKwhT: p.energyKwhT, powerKw: power(p.energyKwhT),
    recoveryPct: p.recoveryPct, netUsdT: p.netUsdT, note,
  });

  const scenarios: ScenarioResult[] = [
    mk('bond_energy', 'Bond Energy', 'Minimiser l\'énergie spécifique sous contrainte P80 procédé', bondPick,
      `Énergie minimale ${bondPick.energyKwhT.toFixed(2)} kWh/t sous P80 ≤ ${processMax} µm.`),
    mk('recovery_driven', 'Recovery-driven', 'Maximiser la récupération métallurgique', recPick,
      `Récupération maximale ${recPick.recoveryPct.toFixed(1)} % à ${recPick.p80} µm ; au-delà, le surbroyage dégrade la performance.`),
    mk('curve_driven', 'P80 Curve-driven', 'Meilleur compromis économique (pente marginale)', curvePick,
      `Valeur nette maximale ${curvePick.netUsdT.toFixed(1)} $/t : gain marginal de récupération = coût marginal d'énergie.`),
  ];

  // Sélection : meilleure valeur nette ; à égalité (< 0.5 $/t), le plus grossier (robustesse).
  const sorted = [...scenarios].sort((a, b) => b.netUsdT - a.netUsdT || b.p80Um - a.p80Um);
  const best = sorted[0];
  const runner = sorted[1];
  const selected = runner && best.netUsdT - runner.netUsdT < 0.5 && runner.p80Um > best.p80Um ? runner : best;
  const selectionReason =
    selected.id === best.id
      ? `${selected.label} retenu : valeur nette la plus élevée (${selected.netUsdT.toFixed(1)} $/t).`
      : `${selected.label} retenu : valeur nette équivalente à ${best.label} (Δ < 0.5 $/t) mais P80 plus grossier — robustesse opérationnelle.`;

  return { points: pts, scenarios, selected, selectionReason };
}

// ═══ 6. Recommandation hiérarchique par circuit ══════════════════════════════

export type ConfidenceLevel = 'low' | 'medium' | 'high';

export interface DataSufficiency {
  hasPsd: boolean;
  hasMeasuredWi: boolean;
  hasRecoveryData: boolean;
  nSamples: number;
}

export function confidenceFromData(d: DataSufficiency): ConfidenceLevel {
  const score = (d.hasPsd ? 1 : 0) + (d.hasMeasuredWi ? 1 : 0) + (d.hasRecoveryData ? 1 : 0) + (d.nSamples >= 5 ? 1 : 0);
  return score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low';
}

export interface CircuitRecommendation {
  type: CircuitType;
  label: string;
  p80TargetUm: number;
  p80RecommendedUm: number;
  specificEnergyKwhT: number;
  recoveryImpactPct: number | null;
  confidence: ConfidenceLevel;
  rationale: string;
}

export interface RecommendationInputs {
  /** P80 optimal usine du broyage final (µm). */
  plantP80Um: number;
  chain: CircuitDef[];
  /** Wi par circuit (CWi concassage / BWi broyage), kWh/t. */
  wiByType: Partial<Record<CircuitType, number>>;
  /** F80 tête de chaîne (µm). */
  headF80Um: number;
  recovery: RecoveryCurveParams;
  data: DataSufficiency;
  throughputTph?: number | null;
}

/**
 * P80 recommandé par circuit — hiérarchie de la spec :
 * 1. contraintes mécaniques (fenêtre du circuit), 2. granulométrie aval
 * (le produit d'une étape est l'alimentation de la suivante), 3. récupération,
 * 4. énergie, 5. robustesse. Le P80 diffère par circuit — jamais un unique
 * P80 global.
 */
export function recommendByCircuit(inputs: RecommendationInputs): CircuitRecommendation[] {
  const present = inputs.chain.filter(c => c.present);
  const confidence = confidenceFromData(inputs.data);
  const out: CircuitRecommendation[] = [];

  // Point d'ancrage : le broyeur PRINCIPAL vise le P80 optimal usine — le ball
  // mill en priorité, sinon le SAG. Le regrind n'est JAMAIS l'ancre : c'est une
  // étape de polissage qui va plus fin (0.5 × P80 usine, cf. plus bas). Auparavant
  // le reverse().find prenait le regrind comme « broyeur final », ce qui donnait
  // le P80 usine au regrind et une cible intermédiaire au ball mill — l'inverse.
  const finalGrinder =
    present.find(c => c.type === 'ball') ??
    present.find(c => c.type === 'sag') ??
    present.find(c => c.type === 'regrind') ??
    null;

  let f80 = inputs.headF80Um;
  for (let i = 0; i < present.length; i++) {
    const c = present[i];
    const [lo, hi] = c.p80WindowUm;
    const next = present[i + 1] ?? null;

    // Cible géométrique : progresser vers le P80 usine avec un ratio de
    // réduction régulier sur les étapes restantes (règle 2 — granulométrie aval).
    const stagesLeft = present.length - i;
    const geometric = f80 * Math.pow(inputs.plantP80Um / f80, 1 / stagesLeft);

    // Règle 1 — contrainte mécanique du circuit.
    let rec = Math.max(lo, Math.min(hi, geometric));
    const notes: string[] = [];
    if (geometric < lo) notes.push('borné par la fenêtre mécanique (min)');
    if (geometric > hi) notes.push('borné par la fenêtre mécanique (max)');

    // Règle 2 — compatibilité aval : le produit doit entrer dans l'étape suivante.
    if (next) {
      const nextMaxFeed = next.p80WindowUm[1] * 8; // ratio de réduction max ≈ 8 par étape
      if (rec > nextMaxFeed) {
        rec = nextMaxFeed;
        notes.push(`réduit pour alimenter ${next.label}`);
      }
    }

    // Le broyage final (règles 3-5) prend exactement le P80 optimal usine si sa
    // fenêtre le permet.
    if (finalGrinder && c.type === finalGrinder.type) {
      rec = Math.max(lo, Math.min(hi, inputs.plantP80Um));
      notes.length = 0;
      notes.push(
        rec === inputs.plantP80Um
          ? 'P80 optimal usine (récupération maximisée, énergie contenue)'
          : `P80 optimal usine ${inputs.plantP80Um} µm borné par la fenêtre mécanique [${lo}–${hi}]`,
      );
    }
    // Regrind après le broyeur final : plus fin que l'usine (relibération).
    if (c.type === 'regrind' && finalGrinder && finalGrinder.type !== 'regrind') {
      const f = P80_FALLBACK_HEURISTICS.regrindP80Factor;
      rec = Math.max(lo, Math.min(hi, inputs.plantP80Um * f));
      notes.length = 0;
      notes.push(`regrind ≈ ${f} × P80 usine pour la relibération des mixtes`);
    }

    const wi = inputs.wiByType[c.type] ?? P80_FALLBACK_HEURISTICS.defaultWiKwhT;
    const e = bondEnergy(wi, f80, rec);
    const isGrinding = c.type === 'sag' || c.type === 'ball' || c.type === 'regrind';
    // L'impact récupération n'a de sens que pour l'étape qui produit la
    // granulométrie finale — un P80 SAG intermédiaire ne se lixivie pas.
    const isFinalStage = finalGrinder != null && c.type === finalGrinder.type;
    const recImpact = isFinalStage
      ? recoveryAtP80(rec, inputs.recovery) - recoveryAtP80(inputs.plantP80Um, inputs.recovery)
      : null;

    out.push({
      type: c.type,
      label: c.label,
      p80TargetUm: Math.round(geometric),
      p80RecommendedUm: Math.round(rec),
      specificEnergyKwhT: e,
      recoveryImpactPct: recImpact != null ? +recImpact.toFixed(2) : null,
      // Le concassage est moins sensible aux données méta ; le broyage porte la confiance des essais.
      confidence: isGrinding ? confidence : confidence === 'low' ? 'low' : 'high',
      rationale: notes.join(' ; ') || 'progression géométrique standard',
    });
    f80 = rec; // chaînage : produit → alimentation suivante
  }
  return out;
}

// ═══ 7. Orchestration complète + commentaire ingénierie ══════════════════════

export interface P80OptimizationInputs {
  /** Courbe PSD (µm) pour le P80 LIMS ; vide si aucune. */
  psdCurve: Array<{ sieve: number; passing: number }>;
  psdMeta?: { source?: string; sampleId?: string | null; dateAnalysis?: string | null; unit?: SizeUnit };
  /** F80 alimentation broyage (µm). */
  f80Um: number;
  /** F80 tête de chaîne (ROM, µm). */
  headF80Um?: number;
  bwi: number;
  cwi?: number | null;
  recovery: RecoveryCurveParams;
  goldGradeGt: number;
  goldPriceUsdOz: number;
  elecCostUsdKwh?: number;
  plantFactor?: number;
  throughputTph?: number | null;
  availablePowerKw?: number | null;
  designEnergyTargetKwhT?: number | null;
  processMaxP80Um?: number | null;
  kIndusMode: KIndusMode;
  kIndusManual?: number | null;
  kIndusInputs?: KIndusInputs;
  labTargetEngineerUm?: number | null;
  labTestType?: LabTestType;
  withRegrind?: boolean;
  data: DataSufficiency;
}

export interface P80OptimizationResult {
  p80Lims: P80Measurement;
  labTarget: LabTargetP80;
  kIndus: KIndusResult;
  p80OptimalPlantUm: number;
  scenarios: ScenariosResult;
  circuits: CircuitRecommendation[];
  finalGrindEnergy: ChainEnergyResult;
  confidence: ConfidenceLevel;
  comment: string;
  /** Audit : toutes les entrées utilisées, sérialisables telles quelles. */
  audit: Omit<P80OptimizationInputs, 'psdCurve'> & { psdPointCount: number };
}

/** Commentaire d'ingénierie automatique (spec §11). */
export function engineeringComment(r: Omit<P80OptimizationResult, 'comment' | 'audit'>): string {
  const s = r.scenarios.selected;
  const ball = r.circuits.find(c => c.type === 'ball');
  const parts: string[] = [];
  parts.push(`P80 labo cible ${Math.round(r.labTarget.valueUm)} µm → P80 usine optimal ${Math.round(r.p80OptimalPlantUm)} µm (K_indus ${r.kIndus.k.toFixed(2)}, ${r.kIndus.mode === 'manual' ? 'saisi' : r.kIndus.mode === 'auto' ? 'calculé' : 'défaut'}).`);
  parts.push(`Scénario retenu : ${s.label} — ${r.scenarios.selectionReason}`);
  if (ball) parts.push(`Ball mill recommandé à ${ball.p80RecommendedUm} µm (${ball.specificEnergyKwhT.toFixed(1)} kWh/t Bond).`);
  const recGain = r.scenarios.scenarios.find(x => x.id === 'recovery_driven');
  const bond = r.scenarios.scenarios.find(x => x.id === 'bond_energy');
  if (recGain && bond && s.id !== 'bond_energy') {
    const dRec = recGain.recoveryPct - bond.recoveryPct;
    const dE = s.energyKwhT - bond.energyKwhT;
    if (dRec > 0) parts.push(`Justification : gain de récupération (+${dRec.toFixed(1)} pt) supérieur au surcoût énergétique (+${dE.toFixed(1)} kWh/t).`);
  }
  if (r.confidence === 'low') parts.push('⚠ Données insuffisantes — valeurs provisoires, confiance faible : compléter les essais PSD/BWi/récupération avant design.');
  return parts.join(' ');
}

/** Exécution complète du pipeline P80 Optimization. */
export function runP80Optimization(inputs: P80OptimizationInputs): P80OptimizationResult {
  const p80Lims = p80FromCurve(inputs.psdCurve, {
    unit: inputs.psdMeta?.unit ?? 'um',
    source: inputs.psdMeta?.source ?? 'lims',
    sampleId: inputs.psdMeta?.sampleId ?? null,
    dateAnalysis: inputs.psdMeta?.dateAnalysis ?? null,
  });

  const labTarget = deriveLabTarget(inputs.recovery, {
    engineerValueUm: inputs.labTargetEngineerUm,
    testType: inputs.labTestType,
  });

  const kIndus = computeKIndus(inputs.kIndusMode, inputs.kIndusInputs ?? {}, inputs.kIndusManual);
  const p80OptimalPlantUm = labTarget.valueUm * kIndus.k;

  const chain = defaultCircuitChain(inputs.withRegrind ?? false);
  const ballWindow = chain.find(c => c.type === 'ball')!.p80WindowUm;

  const scenarios = runScenarios({
    bwi: inputs.bwi,
    f80Um: inputs.f80Um,
    recovery: inputs.recovery,
    goldGradeGt: inputs.goldGradeGt,
    goldPriceUsdOz: inputs.goldPriceUsdOz,
    elecCostUsdKwh: inputs.elecCostUsdKwh,
    plantFactor: inputs.plantFactor,
    throughputTph: inputs.throughputTph,
    processMaxP80Um: inputs.processMaxP80Um ?? Math.round(p80OptimalPlantUm * P80_FALLBACK_HEURISTICS.processMaxP80Factor),
    millWindowUm: ballWindow,
  });

  const cwi = inputs.cwi ?? Math.max(
    P80_FALLBACK_HEURISTICS.cwiFloor,
    inputs.bwi * P80_FALLBACK_HEURISTICS.cwiFromBwiRatio,
  );
  const circuits = recommendByCircuit({
    plantP80Um: Math.round(p80OptimalPlantUm),
    chain,
    wiByType: {
      crush_primary: cwi,
      crush_secondary: cwi,
      crush_tertiary: cwi,
      sag: inputs.bwi,
      ball: inputs.bwi,
      regrind: inputs.bwi * P80_FALLBACK_HEURISTICS.regrindWiFactor,
    },
    headF80Um: inputs.headF80Um ?? 600_000,
    recovery: inputs.recovery,
    data: inputs.data,
    throughputTph: inputs.throughputTph,
  });

  // Énergie du broyage final (SAG + ball [+ regrind]) chaînée, avec puissance.
  const grindingRecs = circuits.filter(c => c.type === 'sag' || c.type === 'ball' || c.type === 'regrind');
  const finalGrindEnergy = chainEnergy(
    grindingRecs.map((c, i) => ({
      type: c.type,
      label: c.label,
      f80Um: i === 0 ? (inputs.f80Um || c.p80TargetUm * 8) : grindingRecs[i - 1].p80RecommendedUm,
      p80Um: c.p80RecommendedUm,
      wi: c.type === 'regrind' ? inputs.bwi * 1.1 : inputs.bwi,
      throughputTph: inputs.throughputTph,
      availablePowerKw: inputs.availablePowerKw,
    })),
    inputs.designEnergyTargetKwhT,
  );

  const confidence = confidenceFromData(inputs.data);
  const partial = {
    p80Lims, labTarget, kIndus, p80OptimalPlantUm, scenarios, circuits, finalGrindEnergy, confidence,
  };
  const comment = engineeringComment(partial as Omit<P80OptimizationResult, 'comment' | 'audit'>);

  const { psdCurve, ...auditRest } = inputs;
  return { ...partial, comment, audit: { ...auditRest, psdPointCount: psdCurve.length } };
}
