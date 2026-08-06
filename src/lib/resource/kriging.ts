// ─────────────────────────────────────────────────────────────────────────────
// Krigeage ordinaire — estimation d'un bloc à partir de ses voisins.
//
// Le krigeage ordinaire (OK) pondère les composites voisins pour estimer la
// teneur d'un bloc en MINIMISANT la variance d'estimation, sous contrainte que
// la somme des poids vaille 1. Contrairement à l'IDW, il exploite la structure
// spatiale (variogramme) : deux échantillons redondants (proches l'un de l'autre)
// se partagent l'influence au lieu de compter double. Il fournit AUSSI une
// variance de krigeage — l'ingrédient objectif de la classification CIM.
//
// Système OK (forme variogramme) :
//   [ Γ  1 ] [ w ]   [ γ0 ]
//   [ 1' 0 ] [ μ ] = [ 1  ]
// où Γ_ij = γ(h_ij) entre voisins, γ0_i = γ(voisin i ↔ bloc).
//   estimation = Σ w_i·v_i ;  variance = Σ w_i·γ0_i + μ.
//
// Fonctions PURES — réutilise lib/ml/linalg (solve).
// ─────────────────────────────────────────────────────────────────────────────

import { solve } from '../ml/linalg';
import { modelSemivariance, type VariogramModel } from './variogram';
import type { SamplePoint } from './statistics';

/** Résultat d'une estimation de bloc. */
export interface BlockEstimate {
  /** Teneur estimée (null si aucun voisin exploitable). */
  value: number | null;
  /** Variance de krigeage (null si non calculable). */
  krigingVariance: number | null;
  /** Nombre de voisins retenus. */
  nSamples: number;
  /** Distance moyenne des voisins retenus au bloc (m). */
  avgDistance: number;
}

/** Centre d'un bloc à estimer. */
export interface BlockCentroid {
  x: number;
  y: number;
  z: number;
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Krige un bloc à partir d'un jeu de voisins DÉJÀ sélectionnés.
 *
 * - 0 voisin → estimation nulle (null).
 * - 1 voisin → sa valeur (poids 1), variance = γ(distance).
 * - Système singulier (ex. doublons parfaits) → repli sur moyenne simple des
 *   voisins, variance non calculable, plutôt que de renvoyer NaN.
 */
export function krigeBlock(
  block: BlockCentroid,
  neighbours: SamplePoint[],
  model: VariogramModel,
): BlockEstimate {
  const n = neighbours.length;
  const dists = neighbours.map(s => distance(s, block));
  const avgDistance = n > 0 ? dists.reduce((a, b) => a + b, 0) / n : 0;

  if (n === 0) return { value: null, krigingVariance: null, nSamples: 0, avgDistance: 0 };
  if (n === 1) {
    return { value: neighbours[0].value, krigingVariance: modelSemivariance(model, dists[0]), nSamples: 1, avgDistance };
  }

  // Matrice (n+1)×(n+1) et second membre.
  const A: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      row.push(modelSemivariance(model, distance(neighbours[i], neighbours[j])));
    }
    row.push(1); // multiplicateur de Lagrange
    A.push(row);
  }
  A.push([...new Array(n).fill(1), 0]);

  const b = neighbours.map(s => modelSemivariance(model, distance(s, block)));
  b.push(1);

  const sol = solve(A, b);
  if (!sol) {
    // Système singulier → moyenne simple (dégradé signalé par variance null).
    const mean = neighbours.reduce((a, s) => a + s.value, 0) / n;
    return { value: mean, krigingVariance: null, nSamples: n, avgDistance };
  }

  const weights = sol.slice(0, n);
  const mu = sol[n];
  const value = weights.reduce((acc, w, i) => acc + w * neighbours[i].value, 0);
  const variance = weights.reduce((acc, w, i) => acc + w * b[i], 0) + mu;

  return { value, krigingVariance: Math.max(0, variance), nSamples: n, avgDistance };
}

/** Ellipsoïde de recherche des voisins (rayons par axe) + limites d'effectif. */
export interface SearchConfig {
  /** Rayon de recherche (m) — sphère isotrope en v1. */
  radius: number;
  /** Nombre maximal de voisins retenus (les plus proches). */
  maxSamples: number;
  /** Nombre minimal de voisins pour estimer (sinon bloc non estimé). */
  minSamples?: number;
}

/**
 * Sélectionne les voisins d'un bloc : dans le rayon, triés par distance, tronqués
 * à `maxSamples`. Renvoie [] si moins de `minSamples` voisins.
 */
export function selectNeighbours(
  block: BlockCentroid,
  samples: SamplePoint[],
  cfg: SearchConfig,
): SamplePoint[] {
  const within = samples
    .map(s => ({ s, d: distance(s, block) }))
    .filter(o => o.d <= cfg.radius)
    .sort((a, b) => a.d - b.d);
  if (within.length < (cfg.minSamples ?? 1)) return [];
  return within.slice(0, cfg.maxSamples).map(o => o.s);
}
