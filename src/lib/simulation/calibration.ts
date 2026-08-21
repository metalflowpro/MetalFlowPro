// ─────────────────────────────────────────────────────────────────────────────
// Calibration pilote / usine — module PUR (aucun React/DB).
//
// Phase 7 du CdC : corriger le biais SYSTÉMATIQUE du simulateur à partir de
// données pilote ou usine mesurées. On n'ajuste PAS le modèle physique : on
// dérive un FACTEUR de correction (mesuré / simulé) borné, appliqué aux
// prédictions futures. Une valeur calibrée porte la provenance `pilot_validated`
// (tier 2) — plus fiable qu'un critère de conception, moins qu'une mesure directe.
//
// Le facteur est BORNÉ : une donnée pilote ne doit pas faire dériver le
// simulateur au-delà du raisonnable (sinon c'est le modèle qu'il faut revoir,
// pas un facteur d'échelle). Le dépassement de borne est signalé (`clamped`).
// ─────────────────────────────────────────────────────────────────────────────

export interface CalibrationPoint {
  /** Valeur prédite par le simulateur. */
  simulated: number;
  /** Valeur mesurée en pilote / usine. */
  measured: number;
}

export interface CalibrationResult {
  /** Facteur multiplicatif de correction (mesuré/simulé), borné. */
  factor: number;
  /** Nombre de points de calage exploitables. */
  n: number;
  /** Biais moyen relatif (%) AVANT calage : (mesuré − simulé)/simulé. */
  meanBiasPct: number;
  confidence: 'high' | 'medium' | 'low';
  /** Vrai si le facteur a été ramené dans ses bornes (biais trop grand). */
  clamped: boolean;
}

export const CALIBRATION_CONFIG = {
  /** Bornes du facteur — un calage hors de cette plage signale un modèle à revoir. */
  minFactor: 0.5,
  maxFactor: 1.5,
  /** Nombre de points pour une confiance élevée / moyenne. */
  minPointsHigh: 5,
  minPointsMedium: 2,
} as const;

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Calcule le facteur de calibration à partir de couples (simulé, mesuré).
 * Facteur = moyenne(mesuré) / moyenne(simulé), borné. Sans point exploitable,
 * renvoie un facteur neutre (1) de confiance faible.
 */
export function computeCalibration(
  points: CalibrationPoint[],
  cfg: typeof CALIBRATION_CONFIG = CALIBRATION_CONFIG,
): CalibrationResult {
  const valid = points.filter(p =>
    Number.isFinite(p.simulated) && Number.isFinite(p.measured) && p.simulated > 0 && p.measured >= 0);
  const n = valid.length;
  if (n === 0) {
    return { factor: 1, n: 0, meanBiasPct: 0, confidence: 'low', clamped: false };
  }
  const sumSim = valid.reduce((a, p) => a + p.simulated, 0);
  const sumMeas = valid.reduce((a, p) => a + p.measured, 0);
  const raw = sumMeas / sumSim;
  const factor = clamp(raw, cfg.minFactor, cfg.maxFactor);
  const meanBiasPct = valid.reduce((a, p) => a + (p.measured - p.simulated) / p.simulated, 0) / n * 100;
  const confidence: CalibrationResult['confidence'] =
    n >= cfg.minPointsHigh ? 'high' : n >= cfg.minPointsMedium ? 'medium' : 'low';
  return { factor, n, meanBiasPct, confidence, clamped: Math.abs(raw - factor) > 1e-9 };
}

/** Applique un facteur de calibration à une valeur simulée. */
export function applyCalibration(value: number, factor: number): number {
  return value * factor;
}

/**
 * Applique une calibration à une RÉCUPÉRATION (%), en la bornant à [0,100] —
 * un facteur ne doit jamais produire une récupération non physique.
 */
export function calibrateRecoveryPct(recoveryPct: number, factor: number): number {
  return clamp(recoveryPct * factor, 0, 100);
}
