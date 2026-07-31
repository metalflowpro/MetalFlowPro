// ─────────────────────────────────────────────────────────────────────────────
// Bilan mécaniste de récupération de l'or — module PUR.
//
// Le modèle OLS (recoveryModel.ts) prédit un CHIFFRE ; il ne dit pas POURQUOI.
// Ce module décompose la récupération en contributions par classe de
// déportation (cascade / waterfall), la RÉCONCILIE avec la récupération de
// lixiviation MESURÉE, et transforme l'écart en DIAGNOSTIC (réfractarité,
// preg-robbing non capté). Contrairement à l'OLS, il fonctionne avec UN SEUL
// essai de libération — c'est un prior physique, pas un modèle statistique.
//
// S'appuie sur src/lib/geomet/deportment.ts. Aucune dépendance Supabase/React.
// ─────────────────────────────────────────────────────────────────────────────

import {
  accessibleByClass, pregRobSeverity, predictRecoveryAtP80,
  liberationGain, DEFAULT_DEPORTMENT_MODEL,
  type GoldDeportment, type DeportmentInputs,
} from '../geomet/deportment';

// ═══ 1. Cascade de récupération (waterfall) ══════════════════════════════════

export interface RecoveryContribution {
  key: 'gravity' | 'cn_free' | 'cn_sulphide' | 'cn_silicate' | 'cn_oxide' | 'preg_loss';
  label: string;
  /** Points de récupération (signé : preg_loss < 0). */
  points: number;
}

export interface RecoveryLoss {
  key: 'occluded' | 'locked_unliberated' | 'cn_inefficiency' | 'preg_loss';
  label: string;
  /** Points d'or perdus (positifs). */
  points: number;
}

export interface RecoveryWaterfall {
  /** Récupération prédite (%) — identique à predictRecoveryAtP80 (source unique). */
  predictedPct: number;
  /** Contributions positives + perte preg-robbing, sommant à `predictedPct`. */
  contributions: RecoveryContribution[];
  /** Décomposition des pertes ; contributions positives + pertes = 100 %. */
  losses: RecoveryLoss[];
  /** Part de la récupération de l'or libre transitant par la gravité (pts). */
  gravityRoutePts: number;
}

/**
 * Décompose la récupération prédite à un P80 donné. La somme des contributions
 * égale exactement `predictRecoveryAtP80` (le moteur de déportation reste la
 * source unique du chiffre) ; la gravité est une RÉ-ATTRIBUTION de la
 * récupération de l'or libre (même efficacité cyanure), pas un ajout — sa valeur
 * est économique et de protection anti-preg-robbing.
 */
export function recoveryWaterfall(dep: GoldDeportment, p80Um: number, inp: DeportmentInputs): RecoveryWaterfall {
  const m = inp.model ?? DEFAULT_DEPORTMENT_MODEL;
  const acc = accessibleByClass(dep, p80Um, inp);
  const cn = m.cnEfficiency;

  const grgEff = (inp.grgPct != null && inp.grgPct > 0 ? inp.grgPct : 0) * m.gravityEfficiency;
  const gravCaptured = Math.min(dep.free, grgEff);       // or libre pris par gravité (% total)
  const gravityPts = gravCaptured * cn;
  const cnFreePts = (dep.free - gravCaptured) * cn;
  const pregLoss = dep.pregRob * pregRobSeverity(inp.cOrgPct);

  const contributions: RecoveryContribution[] = [
    { key: 'gravity',     label: 'Gravité (or libre)',       points: +gravityPts.toFixed(3) },
    { key: 'cn_free',     label: 'Cyanuration or libre',      points: +cnFreePts.toFixed(3) },
    { key: 'cn_sulphide', label: 'Cyanuration sulfures libérés', points: +(acc.sulphide * cn).toFixed(3) },
    { key: 'cn_silicate', label: 'Cyanuration silicates libérés', points: +(acc.silicate * cn).toFixed(3) },
    { key: 'cn_oxide',    label: 'Cyanuration oxydes',        points: +(acc.oxide * cn).toFixed(3) },
    { key: 'preg_loss',   label: 'Perte preg-robbing',        points: -+pregLoss.toFixed(3) },
  ];

  // Pertes (somme avec les contributions positives = 100 %).
  const lockedUnlib =
    dep.sulphide * (1 - liberationGain(m.sulphide, p80Um, inp.p80RefUm)) +
    dep.silicate * (1 - liberationGain(m.silicate, p80Um, inp.p80RefUm)) +
    dep.oxide * (1 - liberationGain(m.oxide, p80Um, inp.p80RefUm));
  const cnInefficiency = acc.total * (1 - cn);

  const losses: RecoveryLoss[] = [
    { key: 'occluded',           label: 'Occlus (réfractaire)',            points: +dep.occluded.toFixed(3) },
    { key: 'locked_unliberated', label: 'Verrouillé non libéré',           points: +lockedUnlib.toFixed(3) },
    { key: 'cn_inefficiency',    label: 'Inefficacité cyanuration',        points: +cnInefficiency.toFixed(3) },
    { key: 'preg_loss',          label: 'Preg-robbing',                    points: +pregLoss.toFixed(3) },
  ];

  const predicted = predictRecoveryAtP80(dep, p80Um, inp);
  return {
    predictedPct: +predicted.toFixed(2),
    contributions,
    losses,
    gravityRoutePts: +gravityPts.toFixed(2),
  };
}

// ═══ 2. Réconciliation avec la lixiviation mesurée ═══════════════════════════

export interface Reconciliation {
  predictedPct: number;
  measuredPct: number;
  /** Résidu = prédit − mesuré (pts). */
  residualPct: number;
  verdict: 'coherent' | 'pertes_inexpliquees' | 'modele_pessimiste' | 'sans_mesure';
  message: string;
}

/**
 * Confronte la récupération prédite (mécaniste) à la lixiviation mesurée. Le
 * SIGNE de l'écart est un diagnostic :
 *   • prédit ≫ mesuré  → pertes non captées (preg-robbing/réfractarité réels
 *     supérieurs au modèle) ⇒ enquêter.
 *   • prédit ≪ mesuré  → modèle trop pessimiste (maxLiberable sous-estimé, ou
 *     oxydation partielle en cours) ⇒ recalibrer.
 */
export function reconcile(predictedPct: number, measuredPct: number | null, tolPct = 3): Reconciliation {
  if (measuredPct == null || !Number.isFinite(measuredPct) || measuredPct <= 0) {
    return {
      predictedPct: +predictedPct.toFixed(2), measuredPct: NaN, residualPct: NaN,
      verdict: 'sans_mesure',
      message: 'Pas de récupération de lixiviation mesurée : le bilan mécaniste reste une prédiction non réconciliée.',
    };
  }
  const residual = predictedPct - measuredPct;
  if (Math.abs(residual) <= tolPct) {
    return {
      predictedPct: +predictedPct.toFixed(2), measuredPct: +measuredPct.toFixed(2), residualPct: +residual.toFixed(2),
      verdict: 'coherent',
      message: `Bilan cohérent : prédit ${predictedPct.toFixed(1)} % vs mesuré ${measuredPct.toFixed(1)} % (écart ${residual.toFixed(1)} pt ≤ ${tolPct}). La minéralogie explique la récupération.`,
    };
  }
  if (residual > 0) {
    return {
      predictedPct: +predictedPct.toFixed(2), measuredPct: +measuredPct.toFixed(2), residualPct: +residual.toFixed(2),
      verdict: 'pertes_inexpliquees',
      message: `Prédit ${predictedPct.toFixed(1)} % > mesuré ${measuredPct.toFixed(1)} % (+${residual.toFixed(1)} pt) : pertes non captées par la minéralogie — preg-robbing ou réfractarité supérieurs au modèle, ou cyanicides. À investiguer.`,
    };
  }
  return {
    predictedPct: +predictedPct.toFixed(2), measuredPct: +measuredPct.toFixed(2), residualPct: +residual.toFixed(2),
    verdict: 'modele_pessimiste',
    message: `Prédit ${predictedPct.toFixed(1)} % < mesuré ${measuredPct.toFixed(1)} % (${residual.toFixed(1)} pt) : le modèle sous-estime — maxLiberable trop bas ou oxydation partielle. Recalibrer les paramètres de libération.`,
  };
}

// ═══ 3. Indice de réfractarité ═══════════════════════════════════════════════

export interface RefractorinessInputs {
  /** Récupération lixiviation 24 h (%). */
  leach24hPct?: number | null;
  /** Récupération lixiviation 48 h (%). */
  leach48hPct?: number | null;
}

export interface Refractoriness {
  /** Indice 0 (free-milling) → 100 (double réfractaire). */
  index: number;
  class: 'free_milling' | 'legerement_refractaire' | 'refractaire' | 'double_refractaire';
  /** Or occlus + verrouillé non libérable (pts) — cause minéralogique. */
  lockedCeilingPct: number;
  /** Lenteur cinétique : gain 24→48 h rapporté au niveau 24 h (0–1). */
  kineticSlowness: number | null;
  message: string;
}

/**
 * Indice de réfractarité combinant (i) le plafond minéralogique (occlus +
 * sulfures verrouillés non libérables au broyage), (ii) la lenteur cinétique
 * (une lixiviation qui progresse encore fortement de 24 h à 48 h traîne), et
 * (iii) l'écart de réconciliation si fourni. Sert à orienter la route :
 * gravité+CIL vs flottation vs oxydation (POX/BIOX/roasting).
 */
export function refractoriness(
  dep: GoldDeportment, inp: DeportmentInputs, k: RefractorinessInputs = {},
  reconciliation?: Reconciliation | null,
): Refractoriness {
  const m = inp.model ?? DEFAULT_DEPORTMENT_MODEL;
  // Plafond minéralogique : or jamais libérable par broyage seul (à grind fin).
  const fineP80 = Math.max(1, inp.p80RefUm / 6);
  const acc = accessibleByClass(dep, fineP80, inp);
  const lockedCeiling = 100 - dep.free - acc.sulphide - acc.silicate - acc.oxide; // occlus + résidu verrouillé

  // Lenteur cinétique depuis 24 h / 48 h.
  let kineticSlowness: number | null = null;
  if (k.leach24hPct != null && k.leach48hPct != null && k.leach24hPct > 0 && k.leach48hPct >= k.leach24hPct) {
    kineticSlowness = Math.min(1, (k.leach48hPct - k.leach24hPct) / Math.max(1, k.leach24hPct));
  }

  // Score composite (pondérations transparentes).
  let index = 0.7 * Math.min(100, lockedCeiling)                     // minéralogie (dominante)
    + 20 * (kineticSlowness ?? 0)                                    // cinétique
    + (reconciliation && reconciliation.verdict === 'pertes_inexpliquees'
        ? Math.min(15, Math.max(0, reconciliation.residualPct))      // pertes non captées
        : 0);
  index = Math.max(0, Math.min(100, index));

  let cls: Refractoriness['class'];
  if (index < 15) cls = 'free_milling';
  else if (index < 30) cls = 'legerement_refractaire';
  else if (index < 55) cls = 'refractaire';
  else cls = 'double_refractaire';

  const routeHint =
    cls === 'free_milling' ? 'CIL/CIP direct (± gravité en tête).' :
    cls === 'legerement_refractaire' ? 'broyage plus fin et/ou gravité renforcée ; surveiller le preg-robbing.' :
    cls === 'refractaire' ? 'flottation des sulfures aurifères puis traitement du concentré ; oxydation à évaluer.' :
    'oxydation obligatoire (POX/BIOX/grillage) + CIL ; le carbone impose souvent CIL vs CIP.';

  return {
    index: +index.toFixed(1),
    class: cls,
    lockedCeilingPct: +Math.max(0, lockedCeiling).toFixed(2),
    kineticSlowness: kineticSlowness == null ? null : +kineticSlowness.toFixed(3),
    message: `Réfractarité ${cls.replace(/_/g, ' ')} (indice ${index.toFixed(0)}/100). ` +
      `Plafond minéralogique ${Math.max(0, lockedCeiling).toFixed(0)} pt d'or non libérable au broyage seul` +
      (kineticSlowness != null ? `, lenteur cinétique ${(kineticSlowness * 100).toFixed(0)} % (24→48 h)` : '') +
      `. Orientation : ${routeHint}`,
  };
}
