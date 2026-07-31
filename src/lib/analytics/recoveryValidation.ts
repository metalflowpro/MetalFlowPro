// ─────────────────────────────────────────────────────────────────────────────
// Validation et exploitation du modèle de récupération.
//
// Le modèle OLS existant rapporte un R² « in-sample » : mesuré sur les données
// qui ont servi à l'ajuster, il est optimiste — avec 7 variables et peu
// d'essais, il peut coller au bruit (sur-apprentissage). Un modèle vraiment
// PRÉDICTIF doit dire ce qu'il vaut sur des données qu'il n'a JAMAIS vues.
//
// Ce module ajoute :
//   1. la validation croisée k-fold → un R² et un RMSE hors échantillon, plus
//      honnêtes, et un diagnostic de sur-apprentissage (écart in/out) ;
//   2. la recommandation d'exploitation → sur le seul levier réglable en marche
//      (le P80 de broyage), le point qui maximise la récupération prédite, avec
//      l'effet marginal et un garde-fou sur la confiance.
//
// Module PUR, entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import {
  trainRecoveryModel, predictRecovery,
  type TrainingSample, type PredictionInput, type RecoveryModel,
} from './recoveryModel';

// ═══ Validation croisée k-fold ═══════════════════════════════════════════════

export interface CrossValidation {
  folds: number;
  /** R² hors échantillon (moyenne des plis) — la vraie capacité prédictive. */
  cvRSquared: number;
  /** RMSE hors échantillon (%). */
  cvRmse: number;
  /** R² in-sample du modèle entraîné sur tout le jeu (pour comparaison). */
  inSampleRSquared: number;
  /** Écart in-sample − out-of-sample : élevé ⇒ sur-apprentissage. */
  overfitGap: number;
  /** Diagnostic lisible. */
  verdict: 'robuste' | 'acceptable' | 'surajusté' | 'insuffisant';
  message: string;
}

/**
 * Validation croisée k-fold. Chaque pli est prédit par un modèle entraîné sur
 * les autres, puis on agrège l'erreur sur des données non vues.
 *
 * Le nombre de plis s'adapte à la taille : jamais plus de plis que
 * d'échantillons − 1, jamais moins de 2. En dessous de ~8 essais, la validation
 * croisée devient bruitée : on le signale plutôt que de prétendre le contraire.
 */
/** Nombre de variables explicatives du modèle (hors intercept). */
const FEATURES = 7;

export function crossValidateRecovery(samples: TrainingSample[], requestedFolds = 5): CrossValidation | null {
  const n = samples.length;
  const full = trainRecoveryModel(samples);

  // Un OLS à FEATURES variables + intercept exige n ≥ FEATURES+2 pour être
  // défini. La validation croisée en laisse-un-de-côté (LOO) entraîne sur n−1
  // lignes : il faut donc n−1 ≥ FEATURES+2, soit n ≥ FEATURES+3. En deçà, on
  // ne prétend pas valider — on le dit, plutôt que de renvoyer un R² trompeur.
  const minForCv = FEATURES + 3;
  if (!full || n < minForCv) {
    return {
      folds: 0,
      cvRSquared: NaN,
      cvRmse: NaN,
      inSampleRSquared: full ? +full.rSquared.toFixed(4) : NaN,
      overfitGap: NaN,
      verdict: 'insuffisant',
      message: full
        ? `${n} essais pour ${FEATURES} variables : validation croisée non fiable (il en faut ≥ ${minForCv}). R² in-sample ${(full.rSquared * 100).toFixed(0)} % à prendre avec prudence — ajouter des essais.`
        : `${n} essais insuffisants pour ajuster un modèle à ${FEATURES} variables (minimum ${FEATURES + 2}).`,
    };
  }

  // Le jeu d'entraînement de chaque pli doit garder ≥ FEATURES+2 lignes, sinon
  // le sous-modèle est singulier. Comme augmenter le nombre de plis AGRANDIT
  // les jeux d'entraînement (chaque test devient plus petit), on part du nombre
  // demandé et on l'augmente jusqu'à ce que les plis soient viables, borné par
  // le laisse-un-de-côté (folds = n).
  let folds = Math.max(2, Math.min(requestedFolds, n));
  const trainingViable = (f: number) => n - Math.ceil(n / f) >= FEATURES + 2;
  while (folds < n && !trainingViable(folds)) folds++;

  // Partition déterministe : on répartit les indices en round-robin (pas de
  // hasard — le résultat doit être reproductible d'un rendu à l'autre).
  const partitions: number[][] = Array.from({ length: folds }, () => []);
  samples.forEach((_, i) => partitions[i % folds].push(i));

  const oosPred: number[] = [];
  const oosActual: number[] = [];

  for (let f = 0; f < folds; f++) {
    const testIdx = new Set(partitions[f]);
    const train = samples.filter((_, i) => !testIdx.has(i));
    const test = samples.filter((_, i) => testIdx.has(i));
    const model = trainRecoveryModel(train);
    if (!model) continue; // pli dégénéré (colinéarité) : on l'ignore
    for (const s of test) {
      oosPred.push(predictRecovery(model.coefficients, s));
      oosActual.push(s.recovery);
    }
  }

  // Trop peu de prédictions hors échantillon récoltées : on rend le verdict
  // « insuffisant » plutôt que null, pour que l'UI affiche un message.
  if (oosPred.length < 2) {
    return {
      folds, cvRSquared: NaN, cvRmse: NaN,
      inSampleRSquared: +full.rSquared.toFixed(4), overfitGap: NaN,
      verdict: 'insuffisant',
      message: `Validation croisée impossible (plis dégénérés) — jeu trop petit ou variables colinéaires.`,
    };
  }

  const mean = oosActual.reduce((a, b) => a + b, 0) / oosActual.length;
  const ssTot = oosActual.reduce((a, y) => a + (y - mean) ** 2, 0);
  const ssRes = oosActual.reduce((a, y, i) => a + (y - oosPred[i]) ** 2, 0);
  const cvR2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const cvRmse = Math.sqrt(ssRes / oosPred.length);
  const gap = full.rSquared - cvR2;

  let verdict: CrossValidation['verdict'];
  let message: string;
  if (cvR2 >= 0.6 && gap < 0.15) {
    verdict = 'robuste';
    message = `Modèle robuste : R² hors échantillon ${(cvR2 * 100).toFixed(0)} %, proche du R² in-sample — il généralise.`;
  } else if (cvR2 >= 0.4) {
    verdict = 'acceptable';
    message = `Capacité prédictive modérée : R² hors échantillon ${(cvR2 * 100).toFixed(0)} % (RMSE ${cvRmse.toFixed(1)} pt).`;
  } else if (gap > 0.3) {
    verdict = 'surajusté';
    message = `Sur-apprentissage probable : R² in-sample ${(full.rSquared * 100).toFixed(0)} % mais seulement ${(cvR2 * 100).toFixed(0)} % hors échantillon. Réduire les variables ou ajouter des essais.`;
  } else {
    verdict = 'surajusté';
    message = `Faible pouvoir prédictif hors échantillon (R² ${(cvR2 * 100).toFixed(0)} %). Les prédictions restent indicatives.`;
  }

  return {
    folds,
    cvRSquared: +cvR2.toFixed(4),
    cvRmse: +cvRmse.toFixed(3),
    inSampleRSquared: +full.rSquared.toFixed(4),
    overfitGap: +gap.toFixed(4),
    verdict,
    message,
  };
}

// ═══ Recommandation d'exploitation ═══════════════════════════════════════════

export interface GrindRecommendation {
  /** P80 (µm) maximisant la récupération prédite dans la plage explorée. */
  optimalP80: number;
  /** Récupération prédite à ce P80. */
  predictedRecovery: number;
  /** Récupération prédite au P80 courant. */
  currentRecovery: number;
  /** Gain de récupération vs point courant (points de %). */
  gainPct: number;
  /** Sens de l'ajustement recommandé. */
  direction: 'broyer_plus_fin' | 'broyer_plus_grossier' | 'maintenir';
  /** Effet marginal moyen : points de récupération par µm (signe = sens). */
  marginalPerUm: number;
  confident: boolean;
  message: string;
}

export interface GrindScanPoint { p80: number; recovery: number }

/**
 * Sur le seul levier réglable en marche — le P80 de broyage — cherche le point
 * qui maximise la récupération prédite, toutes les autres caractéristiques du
 * minerai étant tenues à leur valeur courante.
 *
 * DEUX garde-fous indispensables sur un modèle linéaire ajusté sur peu d'essais :
 *
 * 1. **Domaine, pas d'extrapolation.** Le scan est borné à la plage des P80
 *    RÉELLEMENT observés (passée par l'appelant) : extrapoler un OLS loin des
 *    données (p.ex. vers 270 µm alors que les essais sont à 60-160 µm) produit
 *    des prédictions aberrantes (jusqu'à la borne 100 %).
 *
 * 2. **Prior métallurgique.** La récupération de l'or est limitée par la
 *    LIBÉRATION : un broyage plus GROSSIER (P80 ↑) ne peut pas l'augmenter. Un
 *    coefficient P80 positif ajusté sur peu d'essais est un artefact de
 *    colinéarité (GRG, Au libre et P80 co-varient), pas un levier réel. On ne
 *    recommande donc JAMAIS de broyer plus grossier « pour gagner » de la
 *    récupération — on signale l'artefact et on renvoie à l'essai.
 */
export function recommendGrind(
  model: RecoveryModel,
  current: PredictionInput,
  opts: { p80Min?: number; p80Max?: number; step?: number; cv?: CrossValidation | null } = {},
): { recommendation: GrindRecommendation; scan: GrindScanPoint[] } {
  const p80Min = opts.p80Min ?? 25;
  const p80Max = opts.p80Max ?? 300;
  const step = opts.step ?? 5;

  const scan: GrindScanPoint[] = [];
  for (let p = p80Min; p <= p80Max + 1e-9; p += step) {
    scan.push({ p80: +p.toFixed(1), recovery: predictRecovery(model.coefficients, { ...current, p80: p }) });
  }

  const currentRecovery = predictRecovery(model.coefficients, current);
  // Effet marginal du modèle : coefficient P80 (points de récup. par µm).
  const marginal = model.coefficients.p80;
  const SIGN_TOL = 1e-6;
  // Signe non physique : broyer plus grossier améliorerait la récupération (P80 ↑
  // ⇒ récup ↑). Impossible en libération — ne devrait plus arriver depuis la
  // régression sous contraintes de signe, mais on garde le garde-fou.
  const nonPhysicalSign = marginal > SIGN_TOL;
  // Effet P80 non estimable : la variable a été retirée du modèle (colinéarité) —
  // le broyage n'est pas un levier identifiable sur ce jeu.
  const noLever = Math.abs(marginal) <= SIGN_TOL;

  const confident =
    (!opts.cv
      ? model.rSquared >= 0.5
      : (opts.cv.verdict === 'robuste' || opts.cv.verdict === 'acceptable'))
    && !nonPhysicalSign && !noLever;

  let best: GrindScanPoint;
  let gain: number;
  let direction: GrindRecommendation['direction'];
  let message: string;

  if (nonPhysicalSign || noLever) {
    // Aucune direction bénéfique physiquement défendable : maintenir + expliquer.
    best = { p80: +current.p80.toFixed(1), recovery: currentRecovery };
    gain = 0;
    direction = 'maintenir';
    message = noLever
      ? `Le broyage n'est pas un levier de récupération identifiable sur ce jeu : l'effet du P80 n'est pas estimable ` +
        `(variable retirée pour colinéarité avec GRG / Au libre sur ${model.sampleCount} essais). ` +
        `Tout changement de P80 doit être validé par essai — ajouter des essais à P80 varié désambiguïserait l'effet.`
      : `Aucun gain de récupération par le broyage identifiable sur ce jeu : le coefficient P80 ajusté est positif ` +
        `(+${marginal.toFixed(3)} pt/µm), ce qui est non physique — un broyage plus grossier réduit la libération, ` +
        `pas l'inverse. C'est un artefact de colinéarité (GRG / Au libre / P80) sur ${model.sampleCount} essais. ` +
        `Ne pas broyer plus grossier ; valider tout changement de P80 par essai.`;
  } else {
    // marginal < 0 : la récupération croît vers le FIN — optimum à la borne fine
    // du DOMAINE OBSERVÉ (pas d'extrapolation au-delà des essais).
    best = scan.reduce((b, pt) => (pt.recovery > b.recovery ? pt : b), scan[0]);
    gain = best.recovery - currentRecovery;
    if (Math.abs(gain) < 0.3 || best.p80 >= current.p80) {
      best = { p80: +current.p80.toFixed(1), recovery: currentRecovery };
      gain = 0;
      direction = 'maintenir';
      message = `P80 courant (${Math.round(current.p80)} µm) déjà proche de l'optimum du modèle sur le domaine testé — pas d'ajustement justifié.`;
    } else {
      direction = 'broyer_plus_fin';
      message = `Broyer plus fin vers ${Math.round(best.p80)} µm : +${gain.toFixed(1)} pt de récupération prédite (${currentRecovery.toFixed(1)} → ${best.recovery.toFixed(1)} %).`;
      if (!confident) message += ' ⚠ Confiance limitée du modèle — valider par essai avant application.';
    }
  }

  return {
    recommendation: {
      optimalP80: best.p80,
      predictedRecovery: +best.recovery.toFixed(2),
      currentRecovery: +currentRecovery.toFixed(2),
      gainPct: +gain.toFixed(2),
      direction,
      marginalPerUm: +marginal.toFixed(4),
      confident,
      message,
    },
    scan,
  };
}
