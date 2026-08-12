// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation de données par moindres carrés pondérés (WLS).
//
// Standard industriel du metal accounting (Narasimhan & Jordache ; AMIRA P754) :
// les débits mesurés d'un circuit ne bouclent jamais exactement (bruit capteur,
// dérive, biais). La réconciliation ajuste MINIMALEMENT les mesures pour que la
// conservation de la masse soit exacte à chaque nœud, en corrigeant d'autant
// moins un flux que sa mesure est précise.
//
//   minimiser (x − y)ᵀ W (x − y)   sous contrainte   A x = 0
//
//   y = mesures · x = valeurs réconciliées · W = diag(1/σ²) (poids = précision)
//   A = matrice d'incidence nœud×flux (bilan de chaque nœud interne)
//
// Solution fermée :  x = y − Σ Aᵀ (A Σ Aᵀ)⁻¹ A y   avec Σ = W⁻¹ = diag(σ²)
//
// On en tire aussi la détection d'erreur grossière : un test global (χ²) dit
// s'il reste une incohérence anormale, et un test par mesure désigne le capteur
// le plus suspect.
//
// Module PUR : pas de dépendance, algèbre linéaire maison (matrices petites,
// dimensionnées au nombre de nœuds). Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import { normalQuantile } from '../ml/distributions';

// ═══ Algèbre linéaire minimale ═══════════════════════════════════════════════

type Mat = number[][];
type Vec = number[];

function transpose(m: Mat): Mat {
  if (m.length === 0) return [];
  return m[0].map((_, j) => m.map(row => row[j]));
}

function matMul(a: Mat, b: Mat): Mat {
  const n = a.length, k = b.length, p = b[0]?.length ?? 0;
  const out: Mat = Array.from({ length: n }, () => new Array(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let x = 0; x < k; x++) {
      const aix = a[i][x];
      if (aix === 0) continue;
      for (let j = 0; j < p; j++) out[i][j] += aix * b[x][j];
    }
  }
  return out;
}

function matVec(a: Mat, v: Vec): Vec {
  return a.map(row => row.reduce((s, x, j) => s + x * v[j], 0));
}

/**
 * Résout S·z = r pour S symétrique définie positive (élimination de Gauss avec
 * pivot partiel). S est petite (nœuds × nœuds). Retourne null si singulière.
 */
function solveSPD(S: Mat, r: Vec): Vec | null {
  const n = S.length;
  const a = S.map((row, i) => [...row, r[i]]); // matrice augmentée
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[piv][col])) piv = row;
    }
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = a[row][col] / a[col][col];
      for (let j = col; j <= n; j++) a[row][j] -= f * a[col][j];
    }
  }
  return a.map((row, i) => row[n] / a[i][i]);
}

/** Inverse d'une matrice SPD via résolution colonne par colonne. Null si singulière. */
function invSPD(S: Mat): Mat | null {
  const n = S.length;
  const cols: Vec[] = [];
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0);
    e[j] = 1;
    const c = solveSPD(S, e);
    if (!c) return null;
    cols.push(c);
  }
  // cols[j] est la j-ième colonne de l'inverse
  return Array.from({ length: n }, (_, i) => cols.map(c => c[i]));
}

// ═══ Noyau de résolution (partagé linéaire / bilinéaire) ═════════════════════

export type ReconMat = Mat;
export type ReconVec = Vec;

/**
 * Résultat BRUT d'une réconciliation réseau, indépendant du sens physique des
 * flux. Prend une matrice d'incidence A quelconque (coefficients arbitraires,
 * pas seulement ±1), le vecteur de mesures y et les variances.
 *
 * Réutilisé tel quel par :
 *  - la réconciliation LINÉAIRE (`reconcile`) où A ∈ {−1, 0, +1} (conservation
 *    de masse d'un débit) ;
 *  - la réconciliation BILINÉAIRE (`reconcileBilinear`) où, à tonnages figés T̂,
 *    le bilan métal Σ ±T̂·a = 0 est linéaire en teneurs a avec A = ±T̂.
 *
 * Modèle : minimiser (x − y)ᵀ W (x − y) sous A x = 0, W = diag(1/σ²).
 * Solution fermée : x = y − Σ Aᵀ (A Σ Aᵀ)⁻¹ A y, Σ = diag(σ²).
 */
export interface NetworkWlsSolve {
  /** Valeurs réconciliées x = y + ajustement. */
  reconciled: Vec;
  /** Ajustement a = x − y. */
  adjustment: Vec;
  /** Variance de chaque ajustement (diagonale de Σ_a) — pour le test capteur. */
  adjustmentVar: Vec;
  /** Résidu de bilan mesuré r = A y (déséquilibre par contrainte, avant réconcil.). */
  residual: Vec;
  /** Statistique du test global γ = rᵀ S⁻¹ r ~ χ²(dof). */
  gamma: number;
  /** Degrés de liberté = nombre de contraintes (lignes de A). */
  dof: number;
  /** Seuil χ² au niveau de confiance. */
  threshold: number;
  /** γ dépasse le seuil ⇒ incohérence anormale. */
  grossError: boolean;
  /** Vrai si le système de contraintes est singulier (aucun ajustement calculable). */
  singular: boolean;
}

/**
 * Résout la réconciliation WLS pour une matrice d'incidence A quelconque.
 * NOYAU PUR : ne connaît ni le sens des flux, ni les libellés, ni la clôture.
 */
export function solveNetworkWls(
  A: Mat,
  y: Vec,
  variance: Vec,
  confidence: number = DEFAULT_RECON_CONFIDENCE,
): NetworkWlsSolve {
  const m = y.length;
  const dof = A.length;

  // Résidus de bilan mesurés r = A y.
  const r: Vec = matVec(A, y);

  // S = A Σ Aᵀ  (Σ = diag(variance)).
  const AtSigma: Mat = A.map(row => row.map((v, j) => v * variance[j])); // A·Σ (contrainte×flux)
  const S: Mat = matMul(AtSigma, transpose(A));                          // (contrainte×contrainte)

  const Sinv = invSPD(S);
  if (!Sinv) {
    return {
      reconciled: [...y], adjustment: new Array(m).fill(0), adjustmentVar: new Array(m).fill(0),
      residual: r, gamma: 0, dof, threshold: chi2Quantile(dof, confidence),
      grossError: false, singular: true,
    };
  }

  // Ajustement a = −Σ Aᵀ S⁻¹ r  →  x = y + a.
  const Sinv_r = matVec(Sinv, r);
  const At_Sinv_r = matVec(transpose(A), Sinv_r);        // Aᵀ S⁻¹ r  (longueur m)
  const adjustment: Vec = At_Sinv_r.map((v, j) => -variance[j] * v);
  const reconciled: Vec = y.map((yi, j) => yi + adjustment[j]);

  // Covariance des ajustements : Σ_a = Σ Aᵀ S⁻¹ A Σ. Diagonale seule.
  // diag(Σ_a)_j = variance_j² · (Aᵀ S⁻¹ A)_jj
  const SinvA: Mat = matMul(Sinv, A);                    // (contrainte×flux)
  const adjustmentVar: Vec = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let acc = 0;
    for (let i = 0; i < dof; i++) acc += A[i][j] * SinvA[i][j];
    adjustmentVar[j] = variance[j] * variance[j] * acc;
  }

  // Test global : γ = rᵀ S⁻¹ r ~ χ²(dof).
  const gamma = r.reduce((s, ri, i) => s + ri * Sinv_r[i], 0);
  const threshold = chi2Quantile(dof, confidence);

  return {
    reconciled, adjustment, adjustmentVar, residual: r,
    gamma, dof, threshold, grossError: gamma > threshold, singular: false,
  };
}

/** Seuil du test par mesure (exporté pour les moteurs dérivés, ex. bilinéaire). */
export function sensorSuspicionThreshold(confidence: number = DEFAULT_RECON_CONFIDENCE): number {
  return sensorThreshold(confidence);
}

// ═══ Modèle réseau ═══════════════════════════════════════════════════════════

export interface ReconStream {
  id: string;
  label?: string;
  /** Débit mesuré (t/h, ou masse-métal selon l'usage). */
  measured: number;
  /** Écart-type de la mesure ; sinon dérivé de `precisionPct`. */
  std?: number;
  /** Précision relative (%) → std = |measured|·precisionPct/100. Défaut 5 %. */
  precisionPct?: number;
  /** Mesure figée (bilan de référence non ajustable), ex. doré pesé. */
  fixed?: boolean;
}

export interface ReconNode {
  id: string;
  label?: string;
  /** Flux entrants (par id). */
  inputs: string[];
  /** Flux sortants (par id). */
  outputs: string[];
}

export interface ReconStreamResult {
  id: string;
  label?: string;
  measured: number;
  reconciled: number;
  adjustment: number;
  adjustmentPct: number;
  std: number;
  /** Score de suspicion capteur (|ajustement normalisé|). > seuil ⇒ biais probable. */
  suspicionScore: number;
  isSuspect: boolean;
}

export interface ReconResult {
  streams: ReconStreamResult[];
  /** Résidu de bilan par nœud AVANT réconciliation (déséquilibre mesuré). */
  nodeImbalance: Array<{ id: string; label?: string; imbalance: number }>;
  /** Statistique du test global (χ²) et son seuil. */
  globalTest: { statistic: number; threshold: number; dof: number; gerossError: boolean };
  /** Capteur le plus suspect, s'il dépasse le seuil. */
  worstSensor: { id: string; label?: string; score: number } | null;
  /** Métal (ou masse) total après réconciliation : entrée vs sortie du circuit. */
  closurePct: number;
  feasible: boolean;
  notes: string[];
}

/**
 * Niveau de confiance des tests de détection d'erreur grossière.
 *
 * 95 % est la convention du metal accounting (AMIRA P754), mais c'est un choix
 * de POLITIQUE de site, pas une constante : un circuit très instrumenté peut
 * resserrer à 99 % pour ne remonter que les dérives franches, un circuit peu
 * instrumenté desserrer pour ne pas noyer l'opérateur sous les faux positifs.
 * Les deux seuils (test par mesure et test global χ²) sont DÉRIVÉS de cette
 * seule valeur — ils étaient auparavant deux littéraux indépendants (1.96 et
 * 1.6448536) qu'un changement de niveau aurait désynchronisés.
 */
export const DEFAULT_RECON_CONFIDENCE = 0.95;

/** Seuil du test par mesure : quantile normal BILATÉRAL au niveau de confiance. */
function sensorThreshold(confidence: number): number {
  return normalQuantile(1 - (1 - confidence) / 2);
}

/**
 * Quantile χ² au niveau de confiance (approximation Wilson–Hilferty), suffisant
 * pour un drapeau. Test UNILATÉRAL (on ne s'alarme que d'une incohérence trop
 * grande, jamais d'un résidu trop petit).
 */
function chi2Quantile(dof: number, confidence: number): number {
  if (dof <= 0) return 0;
  const a = 2 / (9 * dof);
  const z = normalQuantile(confidence);
  return dof * Math.pow(1 - a + z * Math.sqrt(a), 3);
}

/** Précision relative (%) supposée d'un capteur sans écart-type ni précision déclarée. */
export const DEFAULT_SENSOR_PRECISION_PCT = 5;

// ═══ Réconciliation ══════════════════════════════════════════════════════════

/**
 * Réconcilie un réseau de flux mesurés par moindres carrés pondérés.
 *
 * Les flux `fixed` (mesures de référence) ne sont pas ajustés : leur variance
 * est fixée quasi nulle, ce qui les rend rigides dans le système.
 */
export function reconcile(
  nodes: ReconNode[],
  streams: ReconStream[],
  confidence: number = DEFAULT_RECON_CONFIDENCE,
): ReconResult {
  const notes: string[] = [];
  const idx = new Map(streams.map((s, i) => [s.id, i]));
  const m = streams.length;

  if (m === 0 || nodes.length === 0) {
    return {
      streams: [], nodeImbalance: [],
      globalTest: { statistic: 0, threshold: 0, dof: 0, gerossError: false },
      worstSensor: null, closurePct: 0, feasible: false,
      notes: ['Réseau vide : aucun flux ou aucun nœud.'],
    };
  }

  // Vecteur de mesures et variances.
  const y: Vec = streams.map(s => s.measured);
  const variance: Vec = streams.map(s => {
    if (s.fixed) return 1e-8; // mesure de référence quasi rigide
    if (s.std != null && s.std > 0) return s.std * s.std;
    const pct = s.precisionPct ?? DEFAULT_SENSOR_PRECISION_PCT;
    const sd = Math.max(1e-6, Math.abs(s.measured) * pct / 100);
    return sd * sd;
  });

  // Matrice d'incidence A (nœud × flux) : +1 entrant, −1 sortant.
  const A: Mat = nodes.map(node => {
    const row = new Array(m).fill(0);
    for (const sid of node.inputs)  { const j = idx.get(sid); if (j != null) row[j] += 1; }
    for (const sid of node.outputs) { const j = idx.get(sid); if (j != null) row[j] -= 1; }
    return row;
  });

  const solve = solveNetworkWls(A, y, variance, confidence);
  const r = solve.residual;
  const nodeImbalance = nodes.map((n, i) => ({ id: n.id, label: n.label, imbalance: +r[i].toFixed(4) }));

  if (solve.singular) {
    notes.push('Système de contraintes singulier — vérifier la topologie (nœud isolé ou flux dupliqué).');
    return {
      streams: streams.map(s => baseResult(s, variance[idx.get(s.id)!])),
      nodeImbalance,
      globalTest: { statistic: 0, threshold: 0, dof: nodes.length, gerossError: false },
      worstSensor: null, closurePct: 0, feasible: false, notes,
    };
  }

  const { adjustment, adjustmentVar: adjVar, reconciled: x, gamma, dof, threshold, grossError } = solve;

  const sensorThr = sensorThreshold(confidence);
  const streamResults: ReconStreamResult[] = streams.map((s, j) => {
    const std = Math.sqrt(variance[j]);
    const denom = Math.sqrt(Math.max(adjVar[j], 1e-12));
    const score = Math.abs(adjustment[j]) / denom;
    return {
      id: s.id, label: s.label,
      measured: s.measured,
      reconciled: +x[j].toFixed(4),
      adjustment: +adjustment[j].toFixed(4),
      adjustmentPct: s.measured !== 0 ? +((adjustment[j] / s.measured) * 100).toFixed(2) : 0,
      std: +std.toFixed(4),
      suspicionScore: +score.toFixed(3),
      isSuspect: !s.fixed && score > sensorThr,
    };
  });

  const suspects = streamResults.filter(s => s.isSuspect).sort((a, b) => b.suspicionScore - a.suspicionScore);
  const worstSensor = suspects.length > 0
    ? { id: suspects[0].id, label: suspects[0].label, score: suspects[0].suspicionScore }
    : null;

  // Clôture globale du circuit après réconciliation : sorties nettes / entrées.
  const feedIds = new Set(nodes.flatMap(n => n.inputs).filter(id => !nodes.some(nn => nn.outputs.includes(id))));
  const prodIds = new Set(nodes.flatMap(n => n.outputs).filter(id => !nodes.some(nn => nn.inputs.includes(id))));
  const totalIn = streamResults.filter(s => feedIds.has(s.id)).reduce((a, s) => a + s.reconciled, 0);
  const totalOut = streamResults.filter(s => prodIds.has(s.id)).reduce((a, s) => a + s.reconciled, 0);
  const closurePct = totalIn !== 0 ? +((totalOut / totalIn) * 100).toFixed(2) : 0;

  if (grossError) {
    notes.push(
      `Erreur grossière détectée (test global γ=${gamma.toFixed(1)} > seuil χ²₉₅=${threshold.toFixed(1)}). ` +
      (worstSensor ? `Capteur le plus suspect : ${worstSensor.label ?? worstSensor.id}.` : 'Vérifier les mesures.'),
    );
  } else {
    notes.push(`Réconciliation cohérente (test global γ=${gamma.toFixed(1)} ≤ seuil χ²₉₅=${threshold.toFixed(1)}).`);
  }

  return {
    streams: streamResults,
    nodeImbalance,
    globalTest: { statistic: +gamma.toFixed(2), threshold: +threshold.toFixed(2), dof, gerossError: grossError },
    worstSensor,
    closurePct,
    feasible: true,
    notes,
  };
}

function baseResult(s: ReconStream, variance: number): ReconStreamResult {
  return {
    id: s.id, label: s.label, measured: s.measured, reconciled: s.measured,
    adjustment: 0, adjustmentPct: 0, std: +Math.sqrt(variance).toFixed(4),
    suspicionScore: 0, isSuspect: false,
  };
}
