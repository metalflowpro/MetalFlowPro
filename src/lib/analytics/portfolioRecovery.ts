// ─────────────────────────────────────────────────────────────────────────────
// RÉCUPÉRATION DE PORTEFEUILLE — dérive, pour CHAQUE projet, la moyenne des
// essais de lixiviation 48 h (LIMS) et la récupération GLOBALE alignée sur 48 h.
//
// ── Pourquoi ce module existe ────────────────────────────────────────────────
// Le tableau de bord d'un projet calcule sa globale dans ProjectContext, à
// partir d'un état riche (flowsheet retenu, courbe auditée, blend par domaine,
// surcharges de constantes). Cet état n'est chargé que pour le projet ACTIF.
// La vue portefeuille doit chiffrer TOUS les projets d'un coup : reproduire ici
// la chaîne complète serait N fois trop coûteux et divergerait à la première
// évolution du moteur.
//
// On réutilise donc les MÊMES briques pures que ProjectContext — moteur de
// routes, décisions d'adsorption / d'oxydation, ajustement d'étage — mais sur la
// route RECOMMANDÉE par les essais et les constantes PAR DÉFAUT :
//
//   • pas de flowsheet retenu par le métallurgiste (propre à chaque projet) ;
//   • pas de courbe auditée ni de blend par domaine (surcharges par projet).
//
// Conséquence assumée : la globale du portefeuille est une ESTIMATION « base
// essais » qui coïncide avec le tableau de bord tant que le projet suit la route
// recommandée sans courbe auditée ni domaine mesuré. Là où le métallurgiste a
// retenu une autre route, les deux chiffres diffèrent — la vue portefeuille le
// libelle « route recommandée », elle ne prétend pas au chiffre certifié.
//
// ── La règle des 48 h, identique au tableau de bord ──────────────────────────
// 48 h est la durée FINALE de lixiviation, donc la seule base de conception. Une
// route bâtie sur le repli 24 h reste estimée mais NE pilote PAS la globale : le
// projet retombe alors sur sa récupération design, exactement comme le fait
// `effectiveRecoveryPct` dans ProjectContext.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { estimateRoutes, type RouteSampleCounts } from './routeEstimation';
import { recommendAdsorptionCircuit } from './adsorptionCircuit';
import { recommendRefractoryCircuit } from './refractoryCircuit';
import { fitStageModel, predictStageRecovery, type StagePoint, type StageModel } from './stageRecoveryModel';
import { resolveMetConstants } from '../config/metConstants';

/** Agrégats d'essais LIMS d'un projet, déjà moyennés par l'appelant. */
export interface PortfolioRecoveryInput {
  /** Teneur d'alimentation du projet (g/t) — lit les modèles d'étage ajustés. */
  headGradeGt: number;
  /** Récupération design du projet (%) — repli quand aucune route 48 h n'existe. */
  designRecoveryPct: number;
  /** Débit nominal (t/h) — critère du choix de circuit oxydant. */
  throughputTph: number;

  /** Moyenne des essais de lixiviation 48 h (%), `null` sans essai. */
  leach48Pct: number | null;
  /** Moyenne des essais de lixiviation 24 h (%) — repli explicite. */
  leach24Pct: number | null;
  grgPct: number | null;
  organicCarbonPct: number | null;
  sulphidePct: number | null;
  flotationAuRecPct: number | null;
  auFreePct: number | null;
  nacnKgT: number | null;
  auFeedGt: number | null;

  /** Couples (teneur, récupération) pour l'ajustement d'étage. */
  leachPoints: StagePoint[];
  flotPoints: StagePoint[];
  counts: RouteSampleCounts;
}

export interface PortfolioRecovery {
  /**
   * Moyenne BRUTE des essais de lixiviation 48 h (%). C'est la valeur que le
   * tableau de bord affiche en « Lixiviation 48 h » — une mesure de laboratoire,
   * avant facteurs d'usine. `null` quand aucun essai 48 h n'existe.
   */
  leach48Pct: number | null;
  /**
   * Récupération globale (%) de la route recommandée, UNIQUEMENT si elle est
   * alignée sur 48 h. `null` sinon (aucune route chiffrable, ou route sur repli
   * 24 h) : la globale retombe alors sur la récupération design.
   */
  globalRecoveryPct: number | null;
  /** `globalRecoveryPct` quand disponible, sinon la récupération design. */
  effectiveRecoveryPct: number;
  /** Vrai quand on retombe sur le design faute de route 48 h chiffrable. */
  isDesignFallback: boolean;
  /** Nom de la route recommandée qui fonde la globale, `null` si non chiffrée. */
  routeLabel: string | null;
}

const atHeadGrade = (mdl: StageModel | null, gradeGt: number): number | null => {
  if (!mdl || mdl.weak) return null;
  return predictStageRecovery(mdl, gradeGt)?.recoveryPct ?? null;
};

/**
 * Dérive la moyenne 48 h et la globale « base essais » d'un projet.
 *
 * Miroir de la partie route-driven de ProjectContext : mêmes décisions
 * d'adsorption / d'oxydation, même ajustement d'étage à la teneur de tête, même
 * moteur de routes et même règle d'alignement sur 48 h.
 */
export function derivePortfolioRecovery(input: PortfolioRecoveryInput): PortfolioRecovery {
  const met = resolveMetConstants({});

  const adsorption = recommendAdsorptionCircuit(
    {
      organicCarbonPct: input.organicCarbonPct,
      nacnKgT: input.nacnKgT,
      auFeedGt: input.auFeedGt,
      sulphidePct: input.sulphidePct,
    },
    met.adsorptionDecision,
  );

  const refractory = recommendRefractoryCircuit(
    {
      sulphidePct: input.sulphidePct,
      organicCarbonPct: input.organicCarbonPct,
      arsenicPct: null,
      carbonatePct: null,
      throughputTph: input.throughputTph,
    },
    met.refractoryDecision,
  );

  // Modèles d'étage ajustés sur les essais du projet, lus à la teneur de tête —
  // c'est la valeur ajustée, pas la moyenne brute, qui alimente les routes.
  const flotFitted = atHeadGrade(fitStageModel(input.flotPoints, 'saturating', met.stageFit), input.headGradeGt);
  const leachFitted = atHeadGrade(fitStageModel(input.leachPoints, 'logarithmic', met.stageFit), input.headGradeGt);

  const routes = estimateRoutes({
    metrics: {
      leachRec48Pct: leachFitted ?? input.leach48Pct,
      leachRec24Pct: input.leach24Pct,
      grgPct: input.grgPct,
      organicCarbonPct: input.organicCarbonPct,
      flotationAuRecPct: flotFitted ?? input.flotationAuRecPct,
      sulphidePct: input.sulphidePct,
      auFreePct: input.auFreePct,
    },
    counts: input.counts,
    adsorptionCircuit: adsorption.recommendation,
    stageEfficiencies: met.routeStageEfficiencies,
    refractoryCircuit: refractory.recommendation,
    refractoryEfficiencies: met.refractoryCircuits,
  });

  const recommended = routes.find(r => r.recommended) ?? null;
  // La globale n'est chiffrée QUE si la route recommandée s'appuie sur le 48 h.
  const aligned = recommended != null && !recommended.leachBasisIsFallback;
  const globalRecoveryPct = aligned ? recommended.recovery_pct : null;

  return {
    leach48Pct: input.leach48Pct,
    globalRecoveryPct,
    effectiveRecoveryPct: globalRecoveryPct ?? input.designRecoveryPct,
    isDesignFallback: globalRecoveryPct == null,
    routeLabel: aligned ? recommended!.route : null,
  };
}
