// ─────────────────────────────────────────────────────────────────────────────
// Clustering géométallurgique — module PUR.
//
// Les domaines géologiques (oxyde/transition/sulfure) ne coïncident pas toujours
// avec le comportement métallurgique. Ce module découvre les POPULATIONS
// métallurgiques réelles par k-means sur un vecteur de caractéristiques
// (BWi, S sulfure, C org, GRG, Au libre), standardisé en z-score. L'init est
// DÉTERMINISTE (farthest-first) : pas de Math.random → résultat reproductible
// d'un rendu à l'autre. Fournit aussi une suggestion de k par silhouette.
//
// Aucune dépendance Supabase/React. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export interface ClusterInput {
  id: string;
  /** Vecteur de caractéristiques (même longueur pour tous). */
  features: number[];
}

export interface ClusterResult {
  k: number;
  /** Index de cluster (0..k−1) par échantillon, dans l'ordre d'entrée. */
  assignments: number[];
  /** Centroïdes en unités RÉELLES (dé-standardisées). */
  centroids: number[][];
  /** Effectif par cluster. */
  sizes: number[];
  /** Inertie intra-cluster (dans l'espace standardisé). */
  inertia: number;
  /** Score silhouette moyen (−1..1) — cohésion/séparation. */
  silhouette: number;
}

function standardize(data: ClusterInput[]): { z: number[][]; mean: number[]; std: number[] } {
  const d = data[0].features.length;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of data) for (let j = 0; j < d; j++) mean[j] += row.features[j];
  for (let j = 0; j < d; j++) mean[j] /= data.length;
  for (const row of data) for (let j = 0; j < d; j++) std[j] += (row.features[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / data.length) || 1;
  const z = data.map(row => row.features.map((v, j) => (v - mean[j]) / std[j]));
  return { z, mean, std };
}

function dist2(a: number[], b: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s;
}

/** Init DÉTERMINISTE farthest-first : 1er centroïde = point le plus proche du
 *  centre global, puis à chaque étape le point le plus éloigné des centroïdes. */
function farthestFirstInit(z: number[][], k: number): number[][] {
  const n = z.length, d = z[0].length;
  const center = new Array(d).fill(0);
  for (const p of z) for (let j = 0; j < d; j++) center[j] += p[j] / n;
  let firstIdx = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) { const dd = dist2(z[i], center); if (dd < bestD) { bestD = dd; firstIdx = i; } }
  const centroids = [z[firstIdx].slice()];
  const chosen = new Set([firstIdx]);
  while (centroids.length < k) {
    let far = -1, farD = -1;
    for (let i = 0; i < n; i++) {
      if (chosen.has(i)) continue;
      let nearest = Infinity;
      for (const c of centroids) nearest = Math.min(nearest, dist2(z[i], c));
      if (nearest > farD) { farD = nearest; far = i; }
    }
    if (far < 0) break;
    chosen.add(far); centroids.push(z[far].slice());
  }
  return centroids;
}

function silhouetteScore(z: number[][], assign: number[], k: number): number {
  const n = z.length;
  if (k < 2 || n <= k) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const own = assign[i];
    let a = 0, aCount = 0;
    const bByCluster = new Array(k).fill(0);
    const bCount = new Array(k).fill(0);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dd = Math.sqrt(dist2(z[i], z[j]));
      if (assign[j] === own) { a += dd; aCount++; }
      else { bByCluster[assign[j]] += dd; bCount[assign[j]]++; }
    }
    a = aCount > 0 ? a / aCount : 0;
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && bCount[c] > 0) b = Math.min(b, bByCluster[c] / bCount[c]);
    if (!Number.isFinite(b)) continue;
    const s = (b - a) / Math.max(a, b || 1);
    total += s;
  }
  return total / n;
}

/** k-means déterministe. Renvoie null si k invalide ou trop peu de points. */
export function kmeansGeomet(data: ClusterInput[], k: number, maxIter = 50): ClusterResult | null {
  const n = data.length;
  if (n < 2 || k < 1 || k > n) return null;
  const { z, mean, std } = standardize(data);
  const centroids = farthestFirstInit(z, k);
  const assign = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) { const dd = dist2(z[i], centroids[c]); if (dd < bestD) { bestD = dd; best = c; } }
      if (assign[i] !== best) { assign[i] = best; changed = true; }
    }
    const d = z[0].length;
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) { counts[assign[i]]++; for (let j = 0; j < d; j++) sums[assign[i]][j] += z[i][j]; }
    for (let c = 0; c < k; c++) if (counts[c] > 0) for (let j = 0; j < d; j++) centroids[c][j] = sums[c][j] / counts[c];
    if (!changed) break;
  }

  const sizes = new Array(k).fill(0);
  let inertia = 0;
  for (let i = 0; i < n; i++) { sizes[assign[i]]++; inertia += dist2(z[i], centroids[assign[i]]); }
  const realCentroids = centroids.map(c => c.map((v, j) => v * std[j] + mean[j]));
  const silhouette = silhouetteScore(z, assign, k);

  return { k, assignments: assign, centroids: realCentroids, sizes, inertia: +inertia.toFixed(4), silhouette: +silhouette.toFixed(4) };
}

/** Suggère le meilleur k (2..maxK) par score silhouette. */
export function suggestK(data: ClusterInput[], maxK = 5): { k: number; silhouette: number } | null {
  const n = data.length;
  if (n < 4) return null;
  const hi = Math.min(maxK, n - 1);
  let best: { k: number; silhouette: number } | null = null;
  for (let k = 2; k <= hi; k++) {
    const r = kmeansGeomet(data, k);
    if (r && (!best || r.silhouette > best.silhouette)) best = { k, silhouette: r.silhouette };
  }
  return best;
}
