// ─────────────────────────────────────────────────────────────────────────────
// Variographie — structure spatiale de la teneur.
//
// Le variogramme mesure comment deux teneurs se ressemblent en fonction de leur
// distance : proche = corrélé (semivariance faible), lointain = indépendant
// (palier). C'est LUI qui donne au krigeage ses poids — sans modèle de
// variogramme, pas d'estimation géostatistique, seulement de l'IDW.
//
// ⚠️ Morrison ne publie pas ses paramètres de variogramme (§8.1 de l'analyse) :
// ce module les ESTIME depuis les composites et laisse l'utilisateur ajuster.
//
// Fonctions PURES — réutilise lib/ml/linalg pour l'ajustement.
// ─────────────────────────────────────────────────────────────────────────────

import type { SamplePoint } from './statistics';

/** Type de modèle de variogramme théorique. */
export type VariogramType = 'spherical' | 'exponential' | 'gaussian';

/** Un point du variogramme expérimental (moyenne par classe de distance). */
export interface VariogramPoint {
  /** Distance moyenne de la classe (m). */
  lag: number;
  /** Semivariance γ(h). */
  semivariance: number;
  /** Nombre de paires dans la classe. */
  pairs: number;
}

/** Modèle de variogramme ajusté. */
export interface VariogramModel {
  type: VariogramType;
  /** Effet de pépite (semivariance à distance nulle). */
  nugget: number;
  /** Palier total (nugget + palier partiel). */
  sill: number;
  /** Portée (m) — distance au-delà de laquelle il n'y a plus de corrélation. */
  range: number;
}

/** Fonction de forme normalisée g(h/range) ∈ [0,1] pour chaque type de modèle. */
export function shapeFunction(type: VariogramType, h: number, range: number): number {
  if (range <= 0) return 1;
  const t = h / range;
  switch (type) {
    case 'spherical':
      return t >= 1 ? 1 : 1.5 * t - 0.5 * t ** 3;
    case 'exponential':
      return 1 - Math.exp(-3 * t);
    case 'gaussian':
      return 1 - Math.exp(-3 * t * t);
  }
}

/** Semivariance théorique γ(h) d'un modèle. */
export function modelSemivariance(model: VariogramModel, h: number): number {
  if (h <= 0) return 0;
  const partial = model.sill - model.nugget;
  return model.nugget + partial * shapeFunction(model.type, h, model.range);
}

/** Options de calcul du variogramme expérimental. */
export interface ExperimentalOptions {
  /** Largeur d'une classe de distance (m). */
  lagDistance: number;
  /** Nombre de classes. */
  nLags: number;
  /** Distance maximale considérée (défaut : lagDistance × nLags). */
  maxDistance?: number;
}

/**
 * Variogramme expérimental OMNIDIRECTIONNEL : pour chaque paire d'échantillons,
 * la demi-différence au carré est moyennée par classe de distance. (L'anisotropie
 * directionnelle est une extension ultérieure ; l'omnidirectionnel suffit à
 * l'échelle faisabilité et reste testable.)
 */
export function experimentalVariogram(samples: SamplePoint[], opts: ExperimentalOptions): VariogramPoint[] {
  if (!(opts.lagDistance > 0) || !(opts.nLags > 0)) {
    throw new Error('Paramètres de variogramme invalides (lagDistance et nLags doivent être > 0).');
  }
  const maxD = opts.maxDistance ?? opts.lagDistance * opts.nLags;
  const sums = new Array(opts.nLags).fill(0);
  const counts = new Array(opts.nLags).fill(0);
  const distSums = new Array(opts.nLags).fill(0);

  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i], b = samples[j];
      const h = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (h <= 0 || h > maxD) continue;
      const bin = Math.min(opts.nLags - 1, Math.floor(h / opts.lagDistance));
      sums[bin] += 0.5 * (a.value - b.value) ** 2;
      distSums[bin] += h;
      counts[bin] += 1;
    }
  }

  const out: VariogramPoint[] = [];
  for (let k = 0; k < opts.nLags; k++) {
    if (counts[k] === 0) continue;
    out.push({ lag: distSums[k] / counts[k], semivariance: sums[k] / counts[k], pairs: counts[k] });
  }
  return out;
}

/**
 * Ajuste un modèle théorique au variogramme expérimental.
 *
 * Méthode : pour une portée candidate donnée, γ = nugget·1 + partialSill·g(h/range)
 * est LINÉAIRE en (nugget, partialSill). On balaie une grille de portées et, pour
 * chacune, on résout les moindres carrés pondérés par le nombre de paires (clampés
 * à ≥ 0), en retenant la portée qui minimise l'erreur. Robuste et sans dépendance
 * d'optimiseur non linéaire.
 */
export function fitVariogramModel(
  points: VariogramPoint[],
  type: VariogramType = 'spherical',
): VariogramModel {
  const pts = points.filter(p => p.pairs > 0 && Number.isFinite(p.semivariance));
  if (pts.length < 2) {
    // Pas assez d'information : palier = variance apparente, pépite nulle.
    const sill = pts[0]?.semivariance ?? 0;
    const range = pts[0]?.lag ?? 1;
    return { type, nugget: 0, sill, range: range > 0 ? range : 1 };
  }

  const maxLag = Math.max(...pts.map(p => p.lag));
  let best: VariogramModel | null = null;
  let bestErr = Infinity;

  // 40 portées candidates de 10 % à 150 % de la distance max observée.
  for (let s = 1; s <= 40; s++) {
    const range = (maxLag * 1.5 * s) / 40 + 1e-6;

    // Moindres carrés pondérés 2×2 : minimise Σ w (γ - n - p·g)².
    let sww = 0, swg = 0, swgg = 0, swy = 0, swgy = 0;
    for (const pt of pts) {
      const g = shapeFunction(type, pt.lag, range);
      const w = pt.pairs;
      sww += w; swg += w * g; swgg += w * g * g;
      swy += w * pt.semivariance; swgy += w * g * pt.semivariance;
    }
    const det = sww * swgg - swg * swg;
    if (Math.abs(det) < 1e-12) continue;
    let nugget = (swy * swgg - swgy * swg) / det;
    let partial = (sww * swgy - swg * swy) / det;
    nugget = Math.max(0, nugget);
    partial = Math.max(0, partial);

    let err = 0;
    for (const pt of pts) {
      const g = shapeFunction(type, pt.lag, range);
      err += pt.pairs * (pt.semivariance - (nugget + partial * g)) ** 2;
    }
    if (err < bestErr) {
      bestErr = err;
      best = { type, nugget, sill: nugget + partial, range };
    }
  }

  return best ?? { type, nugget: 0, sill: pts[pts.length - 1].semivariance, range: maxLag };
}
