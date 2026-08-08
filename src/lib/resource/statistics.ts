// ─────────────────────────────────────────────────────────────────────────────
// Statistiques d'estimation — synthèse, écrêtage, déclustering.
//
// Avant d'interpoler, on caractérise la population de composites : dispersion
// (le coefficient de variation pilote le choix de méthode), valeurs extrêmes
// (une teneur aberrante non écrêtée surestime la ressource) et biais
// d'échantillonnage spatial (les zones sur-forées tirent la moyenne vers le
// haut → déclustering par cellules). Ces trois traitements conditionnent la
// crédibilité de l'estimation qui suit.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Point d'échantillon 3D porteur d'une valeur (teneur composite). */
export interface SamplePoint {
  x: number;
  y: number;
  z: number;
  value: number;
  /** Trou d'origine (optionnel) — sert à compter les trous distincts pour la classification CIM. */
  holeId?: string;
}

/** Synthèse statistique d'une série. */
export interface SummaryStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  variance: number;
  stdev: number;
  /** Coefficient de variation = écart-type / moyenne (0 si moyenne nulle). */
  cv: number;
}

/** Synthèse statistique d'une série de valeurs (ignore les non-finies). */
export function summaryStats(values: number[]): SummaryStats {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return { n: 0, min: 0, max: 0, mean: 0, median: 0, variance: 0, stdev: 0, cv: 0 };
  const mean = v.reduce((s, x) => s + x, 0) / n;
  const variance = v.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const median = n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  return { n, min: v[0], max: v[n - 1], mean, median, variance, stdev, cv: mean !== 0 ? stdev / mean : 0 };
}

/** Options d'écrêtage des valeurs fortes (top-cut). */
export interface CapOptions {
  /**
   * Méthode de seuil :
   *   • 'absolute'   → toute valeur > `threshold` est ramenée à `threshold`.
   *   • 'percentile' → seuil = quantile `threshold` (0–1) de la série ; les
   *     valeurs au-dessus y sont ramenées.
   */
  method: 'absolute' | 'percentile';
  threshold: number;
}

/** Quantile linéaire (interpolation) d'une série triée non vide. */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = Math.min(sorted.length - 1, Math.max(0, p * (sorted.length - 1)));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

/**
 * Écrête (plafonne) les valeurs fortes. Retourne une NOUVELLE série ; l'écrêtage
 * est documenté (méthode + seuil) plutôt que caché — il modifie la ressource.
 */
export function capOutliers(values: number[], opts: CapOptions): number[] {
  let cap: number;
  if (opts.method === 'absolute') {
    cap = opts.threshold;
  } else {
    const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
    if (sorted.length === 0) return values.slice();
    cap = quantile(sorted, opts.threshold);
  }
  return values.map(v => (Number.isFinite(v) && v > cap ? cap : v));
}

/** Taille de cellule de déclustering (m) sur chaque axe. */
export interface CellSize {
  x: number;
  y: number;
  z: number;
}

/**
 * Poids de déclustering par cellules. Les échantillons d'une même cellule se
 * partagent un poids unitaire (1/effectif de la cellule), puis l'ensemble est
 * normalisé pour sommer à N. Un cluster sur-échantillonné pèse ainsi comme un
 * seul point, corrigeant le biais spatial de la moyenne.
 */
export function declusterWeights(points: SamplePoint[], cell: CellSize): number[] {
  if (points.length === 0) return [];
  if (!(cell.x > 0 && cell.y > 0 && cell.z > 0)) {
    throw new Error('Taille de cellule invalide (chaque axe doit être > 0).');
  }
  const key = (p: SamplePoint) =>
    `${Math.floor(p.x / cell.x)}|${Math.floor(p.y / cell.y)}|${Math.floor(p.z / cell.z)}`;

  const counts = new Map<string, number>();
  const keys = points.map(p => {
    const k = key(p);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    return k;
  });

  const raw = keys.map(k => 1 / (counts.get(k) as number));
  const sum = raw.reduce((s, w) => s + w, 0);
  const scale = points.length / sum; // normalise pour sommer à N
  return raw.map(w => w * scale);
}

/** Moyenne pondérée (par ex. par les poids de déclustering). */
export function weightedMean(values: number[], weights: number[]): number {
  let num = 0, den = 0;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    num += values[i] * weights[i];
    den += weights[i];
  }
  return den > 0 ? num / den : 0;
}
