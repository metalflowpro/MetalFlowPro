// ─────────────────────────────────────────────────────────────────────────────
// Validation de l'estimation — validation croisée et courbe grade-tonnage.
//
// Un modèle de ressource n'est publiable qu'APRÈS vérification. Deux contrôles
// clés ici :
//   • validation croisée « leave-one-out » : on ré-estime chaque composite en
//     l'excluant, et on mesure le biais/la dispersion — un biais non nul signale
//     un modèle qui sur- ou sous-estime systématiquement.
//   • grade-tonnage : tonnage et teneur moyenne au-dessus d'une série de cut-offs,
//     l'objet même du rapport de ressource (cf. Table 1.1 de Morrison).
//
// Fonctions PURES.
// ─────────────────────────────────────────────────────────────────────────────

import { krigeBlock, selectNeighbours, type SearchConfig } from './kriging';
import type { VariogramModel } from './variogram';
import type { SamplePoint } from './statistics';

/** Indicateurs de validation croisée. */
export interface CrossValidationResult {
  n: number;
  /** Erreur moyenne (estimé − réel) : biais. Proche de 0 = non biaisé. */
  meanError: number;
  /** Erreur absolue moyenne. */
  meanAbsError: number;
  /** Racine de l'erreur quadratique moyenne. */
  rmse: number;
  /** Corrélation estimé/réel (Pearson), null si dégénérée. */
  correlation: number | null;
}

/**
 * Validation croisée leave-one-out par krigeage : chaque composite est ré-estimé
 * à partir des autres. Coûteux (O(n²)) — destiné à un échantillon, pas au modèle
 * complet.
 */
export function crossValidate(
  samples: SamplePoint[],
  model: VariogramModel,
  search: SearchConfig,
): CrossValidationResult {
  const est: number[] = [];
  const real: number[] = [];

  for (let i = 0; i < samples.length; i++) {
    const target = samples[i];
    const others = samples.slice(0, i).concat(samples.slice(i + 1));
    const neighbours = selectNeighbours(target, others, search);
    if (neighbours.length === 0) continue;
    const r = krigeBlock(target, neighbours, model);
    if (r.value == null) continue;
    est.push(r.value);
    real.push(target.value);
  }

  const n = est.length;
  if (n === 0) return { n: 0, meanError: 0, meanAbsError: 0, rmse: 0, correlation: null };

  let se = 0, sae = 0, sse = 0;
  for (let i = 0; i < n; i++) {
    const e = est[i] - real[i];
    se += e; sae += Math.abs(e); sse += e * e;
  }
  return {
    n,
    meanError: se / n,
    meanAbsError: sae / n,
    rmse: Math.sqrt(sse / n),
    correlation: pearson(est, real),
  };
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  const den = Math.sqrt(va * vb);
  return den > 0 ? cov / den : null;
}

/** Bloc estimé minimal pour le grade-tonnage. */
export interface GradeTonnageBlock {
  grade: number;
  tonnes: number;
}

/** Un palier de la courbe grade-tonnage. */
export interface GradeTonnagePoint {
  cutoff: number;
  tonnes: number;
  meanGrade: number;
  /** Métal contenu = Σ teneur × tonnage au-dessus du cut-off (unités cohérentes). */
  metal: number;
}

/**
 * Courbe grade-tonnage : pour chaque cut-off, tonnage et teneur moyenne des blocs
 * dont la teneur ≥ cut-off. Invariant attendu : tonnage décroît et teneur moyenne
 * croît avec le cut-off (le métal contenu, lui, décroît).
 */
export function gradeTonnage(blocks: GradeTonnageBlock[], cutoffs: number[]): GradeTonnagePoint[] {
  return cutoffs.map(cutoff => {
    let tonnes = 0, metal = 0;
    for (const b of blocks) {
      if (b.grade >= cutoff) {
        tonnes += b.tonnes;
        metal += b.grade * b.tonnes;
      }
    }
    return { cutoff, tonnes, meanGrade: tonnes > 0 ? metal / tonnes : 0, metal };
  });
}
