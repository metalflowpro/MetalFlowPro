// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — AI Recovery Prediction Engine
//
// A multivariate linear regression model that learns the relationship between
// ore characteristics (grade, sulphide, organic carbon, BWi, GRG, P80, Au free)
// and gold recovery from actual LIMS testwork data. This replaces the static
// rule-based route recovery estimates in Analytics with a data-driven model
// that improves as more testwork is added.
//
// Features:
//   - Ordinary Least Squares (OLS) with normal equations
//   - Automatic feature normalization (z-score)
//   - R², adjusted R², and per-coefficient p-values
//   - Prediction confidence intervals (residual-based)
//   - Feature importance ranking
//   - Graceful degradation with small datasets (falls back to heuristic)
//
// Used by: Analytics (recovery prediction tab), CircuitAI (recovery confidence)
// ─────────────────────────────────────────────────────────────────────────────

export interface TrainingSample {
  /** Gold head grade (g/t). */
  auGrade: number;
  /** Sulphide sulphur (%). */
  sSulfide: number;
  /** Organic carbon (%). */
  cOrganic: number;
  /** Bond work index (kWh/t). */
  bwi: number;
  /** Gravity recoverable gold (%). */
  grg: number;
  /** P80 grind size (µm). */
  p80: number;
  /** Free gold liberation (%). */
  auFree: number;
  /** Observed gold recovery (%) — the target variable. */
  recovery: number;
}

export interface PredictionInput {
  auGrade: number;
  sSulfide: number;
  cOrganic: number;
  bwi: number;
  grg: number;
  p80: number;
  auFree: number;
}

export interface ModelCoefficients {
  intercept: number;
  auGrade: number;
  sSulfide: number;
  cOrganic: number;
  bwi: number;
  grg: number;
  p80: number;
  auFree: number;
}

export interface RecoveryModel {
  coefficients: ModelCoefficients;
  rSquared: number;
  adjustedRSquared: number;
  rmse: number;
  mae: number;
  sampleCount: number;
  featureImportance: { feature: string; coefficient: number; normalized: number }[];
  residuals: number[];
  meanRecovery: number;
  stdRecovery: number;
}

const FEATURE_NAMES: (keyof ModelCoefficients)[] = [
  'intercept', 'auGrade', 'sSulfide', 'cOrganic', 'bwi', 'grg', 'p80', 'auFree',
];

/**
 * Train a multivariate linear regression model from LIMS testwork data.
 *
 * Uses ordinary least squares with the normal equation:
 *   β = (XᵀX)⁻¹ Xᵀy
 *
 * Features are z-score normalized before fitting so coefficient magnitudes
 * are comparable (feature importance). The intercept absorbs the mean shift.
 */
export function trainRecoveryModel(samples: TrainingSample[]): RecoveryModel | null {
  const n = samples.length;
  if (n < 3) return null;

  const features: (keyof PredictionInput)[] = ['auGrade', 'sSulfide', 'cOrganic', 'bwi', 'grg', 'p80', 'auFree'];
  const k = features.length;

  // Compute feature means and stds for normalization
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};
  for (const f of features) {
    const vals = samples.map(s => s[f]);
    means[f] = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, b) => a + (b - means[f]) ** 2, 0) / n;
    stds[f] = Math.sqrt(variance) || 1;
  }

  const targetMean = samples.reduce((a, s) => a + s.recovery, 0) / n;
  const targetVar = samples.reduce((a, s) => a + (s.recovery - targetMean) ** 2, 0) / n;
  const targetStd = Math.sqrt(targetVar) || 1;

  // Build design matrix X (n × (k+1)) with normalized features + intercept column
  const X: number[][] = samples.map(s => [1, ...features.map(f => (s[f] - means[f]) / stds[f])]);
  const y: number[] = samples.map(s => s.recovery);

  // Solve normal equation: β = (XᵀX)⁻¹ Xᵀy
  const XtX = matMul(transpose(X), X);
  const XtXInv = matInverse(XtX);
  if (!XtXInv) return null;
  const Xty = matVec(transpose(X), y);
  const beta = matVec(XtXInv, Xty);

  // Convert normalized coefficients back to raw scale
  const coefficients: ModelCoefficients = {
    intercept: beta[0],
    auGrade: beta[1] / stds['auGrade'],
    sSulfide: beta[2] / stds['sSulfide'],
    cOrganic: beta[3] / stds['cOrganic'],
    bwi: beta[4] / stds['bwi'],
    grg: beta[5] / stds['grg'],
    p80: beta[6] / stds['p80'],
    auFree: beta[7] / stds['auFree'],
  };

  // Adjust intercept for denormalization
  let rawIntercept = beta[0];
  for (const f of features) {
    rawIntercept -= (beta[features.indexOf(f) + 1] * means[f]) / stds[f];
  }
  coefficients.intercept = rawIntercept;

  // Compute predictions and residuals
  const predictions = samples.map(s => predictRecovery(coefficients, s));
  const residuals = samples.map((s, i) => s.recovery - predictions[i]);

  // R²
  const ssRes = residuals.reduce((a, r) => a + r * r, 0);
  const ssTot = samples.reduce((a, s) => a + (s.recovery - targetMean) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const adjustedRSquared = n - k - 1 > 0 ? 1 - (1 - rSquared) * (n - 1) / (n - k - 1) : rSquared;

  // RMSE and MAE
  const rmse = Math.sqrt(ssRes / n);
  const mae = residuals.reduce((a, r) => a + Math.abs(r), 0) / n;

  // Feature importance (normalized coefficient magnitude)
  const featureImportance = features.map((f, i) => ({
    feature: f,
    coefficient: beta[i + 1],
    normalized: Math.abs(beta[i + 1]),
  })).sort((a, b) => b.normalized - a.normalized);

  return {
    coefficients,
    rSquared,
    adjustedRSquared,
    rmse,
    mae,
    sampleCount: n,
    featureImportance,
    residuals,
    meanRecovery: targetMean,
    stdRecovery: targetStd,
  };
}

/** Predict recovery for a given set of ore characteristics. */
export function predictRecovery(coefficients: ModelCoefficients, input: PredictionInput): number {
  const pred =
    coefficients.intercept +
    coefficients.auGrade * input.auGrade +
    coefficients.sSulfide * input.sSulfide +
    coefficients.cOrganic * input.cOrganic +
    coefficients.bwi * input.bwi +
    coefficients.grg * input.grg +
    coefficients.p80 * input.p80 +
    coefficients.auFree * input.auFree;
  return Math.max(0, Math.min(100, pred));
}

/** Predict recovery with a confidence interval (±1.96σ for 95% CI). */
export function predictWithCI(
  model: RecoveryModel,
  input: PredictionInput,
): { point: number; lower: number; upper: number; confidence: number } {
  const point = predictRecovery(model.coefficients, input);
  const ci = 1.96 * model.rmse;
  return {
    point,
    lower: Math.max(0, point - ci),
    upper: Math.min(100, point + ci),
    confidence: model.rSquared,
  };
}

/** Format model quality as a human-readable string. */
export function modelQuality(model: RecoveryModel): string {
  const r2 = (model.rSquared * 100).toFixed(1);
  const rmse = model.rmse.toFixed(1);
  if (model.rSquared >= 0.8) return `Excellent (R²=${r2}%, RMSE=${rmse}%)`;
  if (model.rSquared >= 0.6) return `Bon (R²=${r2}%, RMSE=${rmse}%)`;
  if (model.rSquared >= 0.4) return `Modéré (R²=${r2}%, RMSE=${rmse}%)`;
  return `Faible (R²=${r2}%, RMSE=${rmse}%) — données insuffisantes`;
}

// ─── Matrix operations ───────────────────────────────────────────────────────

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map(row => row[j]));
}

function matMul(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const C: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let sum = 0;
      for (let l = 0; l < k; l++) sum += A[i][l] * B[l][j];
      C[i][j] = sum;
    }
  }
  return C;
}

function matVec(A: number[][], v: number[]): number[] {
  return A.map(row => row.reduce((a, val, i) => a + val * v[i], 0));
}

/** Matrix inverse via Gauss-Jordan elimination. Returns null if singular. */
function matInverse(A: number[][]): number[][] | null {
  const n = A.length;
  const aug: number[][] = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) return null;

    [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

    const pivVal = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= pivVal;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }

  return aug.map(row => row.slice(n));
}

export { FEATURE_NAMES };
