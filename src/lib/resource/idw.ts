// ─────────────────────────────────────────────────────────────────────────────
// IDW — pondération par l'inverse de la distance (méthode de repli).
//
// Estimateur simple et robuste : chaque voisin pèse en 1/dᵖ. Ne nécessite pas de
// variogramme, donc utile en début d'étude ou comme comparaison au krigeage.
// N'apporte PAS de variance d'estimation — d'où l'absence de classification
// objective quand on l'utilise seul (voir classification.ts, mode distance).
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

import type { SamplePoint } from './statistics';
import type { BlockCentroid, BlockEstimate } from './kriging';

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Estime un bloc par IDW à partir de voisins déjà sélectionnés.
 * `power` = 2 par défaut. Si un voisin coïncide avec le bloc (distance nulle),
 * sa valeur est renvoyée telle quelle (interpolation exacte).
 */
export function idwBlock(
  block: BlockCentroid,
  neighbours: SamplePoint[],
  power = 2,
): BlockEstimate {
  const n = neighbours.length;
  if (n === 0) return { value: null, krigingVariance: null, nSamples: 0, avgDistance: 0 };

  const dists = neighbours.map(s => distance(s, block));
  const avgDistance = dists.reduce((a, b) => a + b, 0) / n;

  const exact = dists.findIndex(d => d === 0);
  if (exact >= 0) {
    return { value: neighbours[exact].value, krigingVariance: null, nSamples: n, avgDistance };
  }

  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const w = 1 / dists[i] ** power;
    num += w * neighbours[i].value;
    den += w;
  }
  return { value: den > 0 ? num / den : null, krigingVariance: null, nSamples: n, avgDistance };
}
