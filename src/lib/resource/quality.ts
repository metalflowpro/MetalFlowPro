import type { VariogramModel } from './variogram';

export type ResourceQualityStatus = 'pass' | 'warn' | 'fail';

export interface ResourceQualityCheck {
  id: string;
  label: string;
  status: ResourceQualityStatus;
  detail: string;
}

export interface ResourceQualityInput {
  method: 'kriging' | 'idw';
  nComposites: number;
  nBlocks: number;
  nEstimated: number;
  measured: number;
  indicated: number;
  variogram: VariogramModel | null;
  crossValidation: {
    n: number;
    meanError: number;
    rmse: number;
    correlation: number | null;
  } | null;
  compositeStdev: number;
  gradeTonnagePoints: number;
}

export interface ResourceQualityResult {
  status: ResourceQualityStatus;
  coveragePct: number;
  checks: ResourceQualityCheck[];
}

/**
 * Publishability-oriented checks for one estimation run. These are safeguards
 * for review, not a replacement for the QP's geological judgement or a CIM
 * classification rule.
 */
export function assessResourceQuality(input: ResourceQualityInput): ResourceQualityResult {
  const coveragePct = input.nBlocks > 0 ? (input.nEstimated / input.nBlocks) * 100 : 0;
  const checks: ResourceQualityCheck[] = [];
  const add = (check: ResourceQualityCheck) => checks.push(check);

  add({
    id: 'composites', label: 'Nombre de composites',
    status: input.nComposites >= 20 ? 'pass' : input.nComposites >= 3 ? 'warn' : 'fail',
    detail: `${input.nComposites} composite(s) disponible(s)`,
  });
  add({
    id: 'coverage', label: 'Couverture de la grille',
    status: coveragePct >= 80 ? 'pass' : coveragePct >= 50 ? 'warn' : 'fail',
    detail: `${coveragePct.toFixed(0)} % des blocs ont été estimés`,
  });
  add({
    id: 'variogram', label: 'Variogramme ajusté',
    status: input.method === 'idw' ? 'warn' : input.variogram ? 'pass' : 'fail',
    detail: input.method === 'idw' ? 'IDW : pas de variance géostatistique calculée' : input.variogram ? `Modèle ${input.variogram.type}, portée ${input.variogram.range.toFixed(0)} m` : 'Variogramme requis pour le krigeage',
  });
  add({
    id: 'cross-validation', label: 'Validation croisée',
    status: input.crossValidation == null || input.crossValidation.n < 3 ? 'warn' : 'pass',
    detail: input.crossValidation == null ? 'Non calculée' : `${input.crossValidation.n} composites testés · RMSE ${input.crossValidation.rmse.toFixed(4)}`,
  });

  const biasTolerance = Math.max(input.compositeStdev * 0.1, Number.EPSILON);
  const bias = input.crossValidation?.meanError;
  add({
    id: 'bias', label: 'Biais de validation',
    status: bias == null ? 'warn' : Math.abs(bias) <= biasTolerance ? 'pass' : 'warn',
    detail: bias == null ? 'Aucune mesure disponible' : `Erreur moyenne ${bias.toFixed(4)} · tolérance indicative ${biasTolerance.toFixed(4)}`,
  });
  add({
    id: 'resource-base', label: 'Base Mesurée + Indiquée',
    status: input.measured + input.indicated > 0 ? 'pass' : 'fail',
    detail: `${input.measured} bloc(s) Mesuré(s), ${input.indicated} bloc(s) Indiqué(s)`,
  });
  add({
    id: 'grade-tonnage', label: 'Courbe grade-tonnage',
    status: input.gradeTonnagePoints > 0 ? 'pass' : 'fail',
    detail: input.gradeTonnagePoints > 0 ? `${input.gradeTonnagePoints} cut-off(s) documenté(s)` : 'Aucun cut-off documenté',
  });

  const status: ResourceQualityStatus = checks.some(c => c.status === 'fail')
    ? 'fail'
    : checks.some(c => c.status === 'warn')
      ? 'warn'
      : 'pass';
  return { status, coveragePct, checks };
}
