// ─────────────────────────────────────────────────────────────────────────────
// Estimation des routes métallurgiques candidates — moteur PUR et PARTAGÉ.
//
// Partagé par « Analyse et Interprétation » et la section P80 de Granulométrie :
// dupliquer ce calcul garantirait la divergence des deux écrans.
//
// ── Trois principes de modélisation ─────────────────────────────────────────
//
// 1. LA DURÉE DE LIXIVIATION DE RÉFÉRENCE EST 48 h. La récupération de
//    conception se lit à la durée FINALE de lixiviation, pas au point
//    intermédiaire de 24 h qui ne fait que décrire la cinétique.
//
// 2. L'ESSAI N'EST PAS UN CIRCUIT. Un essai labo est une LIXIVIATION (bouteille
//    agitée) : il mesure l'or dissous. CIL et CIP sont deux façons de RÉCUPÉRER
//    cet or dissous sur charbon. La récupération se décompose donc :
//        R = R_lixiviation(48 h) × transfert_usine × efficacité_adsorption
//    et le choix CIL/CIP vient de ./adsorptionCircuit, sur les facteurs
//    d'exploitation déjà présents dans l'application.
//
// 3. DEUX TOPOLOGIES, DEUX FORMULES — les confondre est l'erreur classique.
//    Ce qui tranche est la question : « la lixiviation traite-t-elle les RÉSIDUS
//    de l'étage amont, ou son CONCENTRÉ ? »
//
//    • LIXIVIATION SUR RÉSIDUS — chaque étage traite le rejet du précédent et
//      rattrape ce que l'autre a laissé. Les contributions s'ADDITIONNENT :
//          R = 1 − ∏(1 − Rᵢ)
//    • LIXIVIATION SUR CONCENTRÉ — l'étage amont ORIENTE l'or vers un concentré,
//      et la lixiviation n'en extrait qu'une part. Les récupérations se
//      MULTIPLIENT, et ce que l'étage amont rejette ne revoit jamais la suite :
//          R = ∏ Rᵢ
//
//    Appliquer la formule des résidus à une lixiviation sur concentré produit des
//    récupérations supérieures à celle de l'étage de tête — jusqu'à 100 %.
//
// ── CATALOGUE DES ROUTES (référentiel arbitré par le métallurgiste) ─────────
//   CIL direct .......................... R = R_CIL
//   Gravité + Leach (résidus) ........... R = 1 − (1−R_g)(1−R_l)
//   Flottation + Leach (résidus) ........ R = 1 − (1−R_f)(1−R_l)
//   Flottation + Leach (concentré) ...... R = R_f × R_l
//   Grav. + Flot. + Leach (résidus) ..... R = 1 − (1−R_g)(1−R_f)(1−R_l)
//   Grav. + Flot. + Leach (concentré) ... R = R_g + (1−R_g) × R_f × R_l
//   Flot. + Rebroyage + Leach ........... R = R_f × R_l,rebroyé
//   Grav. + Flot. + Rebroyage + Leach ... R = R_g + (1−R_g) × R_f × R_l,rebroyé
//   Grav. + Flot. (concentré vendu) ..... R = 1 − (1−R_g)(1−R_f)
//   Heap Leach direct ................... R = R_heap
//   Gravité + Heap Leach ................ R = 1 − (1−R_g)(1−R_heap)
//
//   ⚠️ Le REBROYAGE n'a pas de récupération propre : il améliore la LIBÉRATION,
//   donc il se traduit par un R_l plus élevé (R_l,rebroyé > R_l), jamais par un
//   terme supplémentaire. Le gain se quantifie par un essai comparatif.
//
//   ⚠️ Une route « … + Leach (concentré) » ne crédite AUCUN or aux résidus de
//   l'étage séparateur : cet or part aux rejets. Si le flowsheet lixivie aussi
//   ces résidus, ce sont DEUX routes différentes, pas un terme à ajouter.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_ASSUMPTIONS } from '../config/constants';
import { ROUTE_ESTIMATION, selectRecommendedRoute } from './routeSelection';
import { ADSORPTION_CIRCUITS, type AdsorptionCircuitId } from './adsorptionCircuit';
import {
  REFRACTORY_CIRCUITS, circuitLiberation,
  type RefractoryCircuitId, type RefractoryCircuitEfficiencies,
} from './refractoryCircuit';

/**
 * Un étage de la route, tel qu'il doit être AFFICHÉ.
 *
 * Les écrans ne doivent JAMAIS re-supposer la composition d'une route (le
 * Tableau de bord affichait « Gravité / Lixiviation / Globale » même quand la
 * route recommandée n'avait pas de gravité, ou avait une flottation en plus) :
 * c'est la route elle-même qui énumère ses étages.
 */
export interface RouteStage {
  /** Nom de l'étage tel qu'affiché (« Gravité », « Flottation », « CIL »…). */
  label: string;
  /** Récupération de l'étage (%), sur SA propre alimentation. */
  recovery_pct: number;
  /** Ce que l'étage traite et d'où vient son chiffre — pour l'infobulle. */
  note: string;
}

/** Une route candidate et son estimation. */
export interface RouteEstimate {
  route: string;
  recovery_pct: number;
  confidence: 'high' | 'medium' | 'low';
  /** 0–100 : à quel point les essais LIMS soutiennent les paramètres de cette route. */
  dataQualityScore: number;
  basis: string;
  /**
   * Étages composant la route, dans l'ordre du procédé. Source unique de vérité
   * pour tout affichage par étage — cartes et graphiques du Tableau de bord.
   */
  stages: RouteStage[];
  references: string[];
  recommended?: boolean;
  capex_indicator: 'low' | 'medium' | 'high';
  opex_indicator: 'low' | 'medium' | 'high';
}

/**
 * Rendements des étages unitaires composant les routes.
 *
 * ⚠️ Facteurs de transposition labo → usine et rendements d'étage SPÉCIFIQUES
 * AU MINERAI ET AU CIRCUIT, à recaler sur les essais du projet.
 *
 * Note : l'efficacité d'adsorption (CIL/CIP) ne figure PAS ici — elle est portée
 * par ./adsorptionCircuit, puisqu'elle dépend du circuit retenu et non de l'étage.
 */
export const ROUTE_STAGE_EFFICIENCIES = {
  /**
   * Part du CYCLONE UNDERFLOW dérivée vers les concentrateurs gravimétriques.
   *
   * ⚠️ C'EST CE FACTEUR QUI PLAFONNE LA RÉCUPÉRATION GRAVIMÉTRIQUE, pas l'essai
   * GRG. Un circuit ne peut pas récupérer l'or qu'il ne voit jamais : on ne
   * dérive typiquement que 18–20 % de l'underflow vers la gravité. L'essai GRG
   * dit ce que le MINERAI offre ; cette fraction dit ce que le CIRCUIT traite —
   * la récupération d'usine est bornée par le plus contraignant des deux.
   *
   * Référence : Spanish Mountain PFS (2021) §13.5.1 / §17.2.4 — 18 % de
   * récupération gravimétrique primaire, circuit traitant une fraction de la
   * charge circulante. À caler sur le dimensionnement du circuit du projet.
   */
  gravityUnderflowBleedFraction: 0.20,
  /**
   * Récupération de la LIXIVIATION INTENSIVE du concentré gravimétrique (ILR).
   * Le concentré de gravité ne part pas au CIL principal : il est lixivié à
   * haute concentration de cyanure dans un réacteur dédié, d'où un rendement
   * proche de l'unité (PFS §13.5.4 : 98,5 %).
   */
  intensiveLeachRecovery: 0.985,
  /**
   * Récupération du circuit de cyanuration traitant un CONCENTRÉ DE FLOTTATION
   * rebroyé (%), adsorption comprise.
   *
   * ⚠️ NE JAMAIS y mettre la récupération d'un essai bouteille sur TOUT-VENANT.
   * Un concentré titrant ~10 g/t et rebroyé à ~22 µm lixivie bien mieux que le
   * minerai brut : le PFS retient ≈ 94 %, contre ≈ 80 % pour le tout-venant.
   * Confondre les deux était la principale erreur de modélisation de l'app.
   */
  concentrateLeachRecoveryPct: 94,
  /**
   * Contribution (pts de récupération globale) d'un circuit de GRAVITÉ
   * SCAVENGER sur les rejets de flottation cleaner/recleaner. Zéro si le
   * flowsheet n'en comporte pas (PFS §13.5.3 : 1 pt).
   */
  scavengerGravityRecoveryPts: 1,
  /** Rendement de la flottation de l'or (efficacité de l'étage). */
  flotationAu: 0.94,
  /** Rendement de flottation des sulfures avant prétraitement oxydant. */
  flotationSulphides: 0.93,
  /** Récupération par défaut de la flottation (%) quand aucun essai n'existe. */
  flotationDefaultRecoveryPct: 85,
  /** Gain de cinétique de lixiviation (pts) sur un concentré rebroyé. */
  regrindLeachBonusPts: 5,
  /** Plafond de lixiviation d'un concentré rebroyé (fraction). */
  regrindLeachMax: 0.97,
  /** Plafond de lixiviation après oxydation (fraction). */
  postOxidationLeachMax: 0.97,
  /** Plafond de récupération d'une lixiviation directe (%). */
  directLeachMaxPct: 98,
  /** Plafond de récupération d'une route flottation + lixiviation (%). */
  flotationRouteMaxPct: 97,
  /** Plafond de récupération d'une route gravité + flottation + lixiviation (%). */
  gravFlotLeachRouteMaxPct: 99.5,
  /** GRG (%) au-delà duquel la route gravité est jugée de confiance élevée. */
  gravityHighConfidenceGrgPct: 10,
  /** Sulfures (%) au-delà desquels une route oxydante est envisagée. */
  refractorySulphidesPct: 2,
  /** Récupération (%) au-delà de laquelle une lixiviation directe est de confiance élevée. */
  directLeachHighConfidencePct: 80,
  /** …et en deçà de laquelle elle devient de confiance faible. */
  directLeachLowConfidencePct: 65,
} as const;

/** Version modifiable (nombres) des efficacités d'étapes — base des surcharges par projet. */
export type RouteStageEfficiencies = { -readonly [K in keyof typeof ROUTE_STAGE_EFFICIENCIES]: number };

/** Nombre d'essais disponibles par famille — pilote le score de qualité de données. */
export interface RouteSampleCounts {
  chem: number;
  comminution: number;
  knelson: number;
  flotation: number;
  leaching: number;
  mineralogy: number;
}

/** Moyennes robustes des essais, déjà agrégées par l'appelant. */
export interface RouteMetrics {
  /**
   * Récupération de lixiviation à 48 h (%) — la DURÉE FINALE, référence de
   * conception. C'est cette valeur qui fonde toutes les routes.
   */
  leachRec48Pct: number | null;
  /**
   * Récupération à 24 h (%) — point de CINÉTIQUE intermédiaire. Sert de repli
   * explicite si le 48 h manque, jamais de référence par défaut.
   */
  leachRec24Pct: number | null;
  /** Or gravimétrique récupérable GRG (%). */
  grgPct: number | null;
  /** Carbone organique (%). */
  organicCarbonPct: number | null;
  /** Récupération de flottation de l'or (%). */
  flotationAuRecPct: number | null;
  /** Soufre sulfure (%). */
  sulphidePct: number | null;
  /** Or libre (%). */
  auFreePct: number | null;
}

export interface RouteEstimationInputs {
  metrics: RouteMetrics;
  counts: RouteSampleCounts;
  /**
   * Circuit d'adsorption retenu (voir ./adsorptionCircuit). REQUIS : une route
   * ne peut pas être nommée ni chiffrée sans savoir si l'or dissous est capté
   * en CIL ou en CIP.
   */
  adsorptionCircuit: AdsorptionCircuitId;
  /**
   * Efficacités d'étapes de route surchargées par le projet (éditeur de
   * constantes métallurgiques). Optionnel : à défaut, les valeurs par défaut de
   * l'application s'appliquent — les tests et appelants existants restent valides.
   */
  stageEfficiencies?: RouteStageEfficiencies;
  /**
   * Circuit de prétraitement oxydant retenu (voir ./refractoryCircuit). Décidé
   * sur la CHIMIE du minerai, jamais par défaut : POX, BIOX, grillage et Albion
   * n'ont ni la même libération, ni le même CAPEX, ni les mêmes critères.
   * Optionnel — à défaut, POX, ce qui préserve les appelants existants.
   */
  refractoryCircuit?: RefractoryCircuitId;
  /** Libérations des circuits oxydants surchargées par le projet. */
  refractoryEfficiencies?: RefractoryCircuitEfficiencies;
}

/** Nombre d'essais par paramètre au-delà duquel le score de qualité sature. */
export const QUALITY_SCORE_SATURATION_N = 15;

/** Score 0–100 de suffisance des données pour un effectif d'essais. */
export function qualityScore(n: number): number {
  return Math.min(100, Math.round((n / QUALITY_SCORE_SATURATION_N) * 100));
}

/** Moyenne pondérée des scores de qualité des paramètres dont dépend une route. */
export function weightedQuality(params: Array<{ n: number; w: number }>): number {
  const totalW = params.reduce((s, p) => s + p.w, 0);
  if (totalW <= 0) return 0;
  return Math.round(params.reduce((s, p) => s + qualityScore(p.n) * p.w, 0) / totalW);
}

/**
 * Étages en SÉRIE traitant chacun le REJET du précédent : R = 1 − ∏(1 − Rᵢ).
 * N'utiliser que lorsque chaque étage a une seconde chance sur l'or que le
 * précédent a laissé passer (gravité puis lixiviation des queues de gravité).
 */
export function seriesRecovery(...stages: number[]): number {
  const global = 1 - stages.reduce((prod, r) => prod * (1 - r), 1);
  return Math.max(0, Math.min(100, global * 100));
}

/**
 * Étages SÉQUENTIELS sur le MÊME flux : R = ∏ Rᵢ.
 * À utiliser dès qu'un étage SÉPARE le flux (flottation) : ce qu'il rejette ne
 * revoit aucun étage aval. Le résultat ne peut donc jamais dépasser le rendement
 * de l'étage de tête — propriété vérifiée par les tests.
 */
export function sequentialRecovery(...stages: number[]): number {
  const global = stages.reduce((prod, r) => prod * r, 1);
  return Math.max(0, Math.min(100, global * 100));
}

const f1 = (v: number) => v.toFixed(1);

/**
 * Récupération du CIRCUIT gravimétrique (fraction), doublement bornée :
 *   • par ce que le MINERAI offre — l'or gravi-récupérable (GRG) ;
 *   • par ce que le CIRCUIT voit — la part du cyclone underflow dérivée.
 * puis minorée du rendement des concentrateurs.
 *
 *     R_grav = min(GRG, fraction dérivée) × η_concentrateurs
 *
 * L'application prenait auparavant GRG × η, ce qui donnait 46 % là où le PFS du
 * projet retient 18 % : elle créditait le circuit d'un or qu'il ne voit jamais.
 */
export function gravityCircuitRecovery(
  grgPct: number,
  E: Pick<RouteStageEfficiencies, 'gravityUnderflowBleedFraction'>,
  concentratorEfficiency: number = DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY,
): number {
  const offeredByOre = Math.max(0, grgPct) / 100;
  const seenByCircuit = Math.max(0, E.gravityUnderflowBleedFraction);
  return Math.min(offeredByOre, seenByCircuit) * concentratorEfficiency;
}

/** Base de lixiviation retenue : 48 h de préférence, 24 h en repli explicite. */
function leachBasis(m: RouteMetrics): { pct: number; label: string; isFallback: boolean } | null {
  if (m.leachRec48Pct != null) return { pct: m.leachRec48Pct, label: '48 h', isFallback: false };
  if (m.leachRec24Pct != null) return { pct: m.leachRec24Pct, label: '24 h (repli — 48 h non mesuré)', isFallback: true };
  return null;
}

/**
 * Estime toutes les routes métallurgiques soutenues par les essais disponibles,
 * triées par récupération décroissante, la recommandée portant `recommended`.
 *
 * Une route n'est proposée que si les essais qui la fondent existent : pas de
 * route inventée sur des valeurs par défaut.
 */
export function estimateRoutes(inputs: RouteEstimationInputs): RouteEstimate[] {
  const { metrics: m, counts: n } = inputs;
  const E = inputs.stageEfficiencies ?? ROUTE_STAGE_EFFICIENCIES;
  const R = ROUTE_ESTIMATION;
  const ads = ADSORPTION_CIRCUITS[inputs.adsorptionCircuit];
  const C = ads.label; // 'CIL' | 'CIP' — nomme les routes

  const leach = leachBasis(m);
  if (!leach) return [];

  // Perte par preg-robbing, ATTÉNUÉE selon le circuit d'adsorption : en CIL le
  // charbon ajouté concurrence le carbone natif du minerai, en CIP non.
  const rawPregLoss = m.organicCarbonPct !== null && m.organicCarbonPct > R.pregRobbingCorgThresholdPct
    ? R.pregRobbingPenaltyPts
    : 0;
  const pregLoss = rawPregLoss * (1 - ads.pregRobbingMitigation);
  const pregNote = rawPregLoss > 0
    ? ` · preg-robbing −${f1(pregLoss)} pt (${C} : ${Math.round(ads.pregRobbingMitigation * 100)} % de la perte évitée)`
    : '';

  /** Récupération d'un circuit de cyanuration : lixiviation × usine × adsorption. */
  const cyanidation = (leachPct: number): number =>
    ((leachPct - pregLoss) / 100) * DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY * ads.adsorptionEfficiency;

  const leachNote = `lixiviation ${leach.label} ${f1(leach.pct)} % × transfert usine ${DEFAULT_ASSUMPTIONS.LEACH_PLANT_EFFICIENCY} × adsorption ${C} ${ads.adsorptionEfficiency}${pregNote}`;

  /** Explique laquelle des deux bornes plafonne le circuit gravimétrique. */
  const gravNote = (grgPct: number, eff: typeof E, rGrav: number): string => {
    const bleedPct = eff.gravityUnderflowBleedFraction * 100;
    const limiter = grgPct <= bleedPct
      ? `borné par le minerai — GRG ${f1(grgPct)} %`
      : `borné par le circuit — ${f1(bleedPct)} % du cyclone underflow dérivé vers la gravité (GRG ${f1(grgPct)} % non atteignable)`;
    return `${limiter} × rendement concentrateurs ${DEFAULT_ASSUMPTIONS.GRAVITY_PLANT_EFFICIENCY} = ${f1(rGrav * 100)} %`;
  };

  /**
   * Cyanuration d'un CONCENTRÉ de flottation rebroyé — paramètre PROPRE, jamais
   * l'essai bouteille sur tout-venant : un concentré titrant ~10 g/t lixivie
   * bien mieux que le minerai brut.
   */
  const concentrateLeach = Math.min(E.regrindLeachMax, E.concentrateLeachRecoveryPct / 100);
  const concentrateLeachNote =
    `lixiviation de CONCENTRÉ ${f1(concentrateLeach * 100)} % (paramètre de circuit, pas l'essai tout-venant — un concentré rebroyé lixivie mieux)`;

  const routes: RouteEstimate[] = [];

  // ⚠️ NOMENCLATURE DES ROUTES — « CIL » et « CIP » désignent le CIRCUIT DE
  // CYANURATION COMPLET, lixiviation comprise : en CIL le charbon est dans les
  // cuves de lixiviation, en CIP il est dans une cuverie qui suit la
  // lixiviation. Écrire « Lixiviation + CIL » est donc un pléonasme, et
  // « Lixiviation + CIP » laisse croire à un troisième étage. On nomme les
  // routes par ce qui précède le circuit de cyanuration, puis par le circuit
  // retenu : « Gravité (Knelson) + CIL » / « Gravité (Knelson) + CIP ».

  // ── Route 1 — Gravité + circuit de cyanuration ───────────────────────────
  // SÉRIE : la lixiviation traite les QUEUES de gravité, elle rattrape donc
  // l'or que la gravité a laissé passer.
  if (m.grgPct !== null) {
    const rGrav = gravityCircuitRecovery(m.grgPct, E);
    const rCyan = cyanidation(leach.pct);
    const combined = seriesRecovery(rGrav, rCyan);
    routes.push({
      route: `Gravité (Knelson) + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Série (la lixiviation traite les queues de gravité) : R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rCyan * 100)} %) = ${f1(combined)} % · ${gravNote(m.grgPct, E, rGrav)} · ${leachNote}`,
      stages: [
        { label: 'Gravité', recovery_pct: +(rGrav * 100).toFixed(1), note: gravNote(m.grgPct, E, rGrav) },
        { label: C, recovery_pct: +(rCyan * 100).toFixed(1), note: `sur les queues de gravité · ${leachNote}` },
      ],
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Guidelines'],
      capex_indicator: 'medium', opex_indicator: ads.opex,
    });
  }

  // ── Route — Gravité + Flottation + circuit de cyanuration ────────────────
  //
  // ⚠️ DANS CETTE ROUTE, RIEN N'EST JETÉ. Le nom se termine par « CIL » : le
  // circuit de cyanuration traite précisément ce que la flottation n'a pas pris.
  // Les DEUX courants issus de la flottation sont donc lixiviés —
  //   · le CONCENTRÉ, rebroyé / en réacteur intensif : il lixivie MIEUX, c'est
  //     la seule raison d'installer une flottation ;
  //   · les QUEUES, qui rejoignent le CIL principal.
  //
  //     R = R_g + (1−R_g) × [R_f·R_l,conc + (1−R_f)·R_l]
  //
  // Appliquer ici la formule « lixiviation sur concentré » (R_g + (1−R_g)·R_f·R_l)
  // reviendrait à envoyer les queues de flottation aux rejets : la route
  // descendait alors SOUS « Gravité + CIL » (78,7 % contre 86,6 %), c'est-à-dire
  // qu'ajouter un étage de scavenging DÉTRUISAIT de la récupération — un circuit
  // que personne ne construirait. Cette formule ne vaut que pour un flowsheet
  // qui abandonne réellement ses queues, ce que « + CIL » ne décrit pas.
  //
  // INVARIANT VÉRIFIÉ PAR LES TESTS : cette route majore « Gravité + CIL ».
  if (m.grgPct !== null && m.flotationAuRecPct !== null) {
    const rGrav = gravityCircuitRecovery(m.grgPct, E);
    const rIlr = E.intensiveLeachRecovery;
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const scav = E.scavengerGravityRecoveryPts / 100;
    // Le concentré de GRAVITÉ part en lixiviation intensive, celui de FLOTTATION
    // au circuit de cyanuration après rebroyage. Les rejets de flottation vont au
    // parc à résidus — la gravité scavenger en rattrape une part.
    const fromGrav = rGrav * rIlr;
    const fromFlot = (1 - rGrav) * rFlot * concentrateLeach;
    const combined = Math.min(E.gravFlotLeachRouteMaxPct, (fromGrav + fromFlot + scav) * 100);
    routes.push({
      route: `Gravité (Knelson) + Flottation + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.flotation, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Concentré de gravité en lixiviation intensive, concentré de flottation au ${C} après rebroyage : R = ${f1(rGrav * 100)} %×${f1(rIlr * 100)} % (ILR) + (1−${f1(rGrav * 100)} %)×${f1(rFlot * 100)} %×${f1(concentrateLeach * 100)} %${scav > 0 ? ` + ${f1(scav * 100)} pt (gravité scavenger)` : ''} = ${f1(combined)} % · ${gravNote(m.grgPct, E, rGrav)} · flottation ${f1(rFlot * 100)} % (essai ${f1(m.flotationAuRecPct)} %) · ${concentrateLeachNote} · rejets de flottation au parc à résidus (non lixiviés)`,
      stages: [
        { label: 'Gravité + ILR', recovery_pct: +(fromGrav * 100).toFixed(1), note: `${gravNote(m.grgPct, E, rGrav)}, puis lixiviation intensive du concentré ${f1(rIlr * 100)} %` },
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — sur les queues de gravité ; ses rejets partent au parc à résidus` },
        { label: C, recovery_pct: +(concentrateLeach * 100).toFixed(1), note: concentrateLeachNote },
      ],
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'Wills B.A. — Mineral Processing Technology, 8th ed.', 'CIM Best Practices'],
      capex_indicator: 'high', opex_indicator: ads.opex,
    });
  }

  // ── Route 2 — Cyanuration directe du tout-venant (étage unique) ──────────
  {
    const rec = Math.min(E.directLeachMaxPct, cyanidation(leach.pct) * 100);
    routes.push({
      route: `${C} direct (tout-venant, sans pré-concentration)`,
      recovery_pct: +rec.toFixed(1),
      confidence: rec >= E.directLeachHighConfidencePct ? 'high' : rec >= E.directLeachLowConfidencePct ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Étage unique : R = ${f1(rec)} % · ${leachNote}`,
      stages: [
        { label: C, recovery_pct: +rec.toFixed(1), note: `tout-venant, sans pré-concentration · ${leachNote}` },
      ],
      references: ['CIM Best Practices — Metallurgical Testing', 'Marsden & House, The Chemistry of Gold Extraction, 2nd ed.'],
      capex_indicator: ads.capex, opex_indicator: ads.opex,
    });
  }

  // ── Route 3 — Flottation + Rebroyage + circuit de cyanuration ────────────
  //
  // Même principe que la route précédente, sans gravité en tête : le nom se
  // termine par le circuit de cyanuration, donc les queues de flottation y vont
  // aussi. Le REBROYAGE n'a pas de récupération propre — il améliore la
  // libération, donc il RELÈVE R_l sur le concentré ; il n'ajoute pas d'étage.
  //
  //     R = R_f·R_l,rebroyé + (1−R_f)·R_l
  //
  // INVARIANT VÉRIFIÉ PAR LES TESTS : cette route majore la cyanuration directe.
  if (m.flotationAuRecPct !== null) {
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const scav = E.scavengerGravityRecoveryPts / 100;
    const combined = Math.min(E.flotationRouteMaxPct, (rFlot * concentrateLeach + scav) * 100);
    routes.push({
      route: `Flottation + Rebroyage + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.sulphidePct !== null && m.sulphidePct > 1 ? 'medium' : 'low',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 1 }, { n: n.comminution, w: 1 }]),
      basis: `Lixiviation du CONCENTRÉ rebroyé : R = ${f1(rFlot * 100)} % × ${f1(concentrateLeach * 100)} %${scav > 0 ? ` + ${f1(scav * 100)} pt (gravité scavenger)` : ''} = ${f1(combined)} % · le rebroyage ne récupère rien par lui-même, il relève la lixiviabilité du concentré (libération) · ${concentrateLeachNote} · rejets de flottation au parc à résidus (non lixiviés)`,
      stages: [
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — ses rejets partent au parc à résidus` },
        { label: `${C} (concentré rebroyé)`, recovery_pct: +(concentrateLeach * 100).toFixed(1), note: concentrateLeachNote },
      ],
      references: ['Wills B.A. — Mineral Processing Technology, 8th ed.'],
      capex_indicator: 'high', opex_indicator: ads.opex,
    });
  }

  // ── Route 4 — Flottation + Oxydation (POX/Grillage) + cyanuration ────────
  // SÉQUENTIELLE : l'or perdu aux rejets de flottation ne revoit NI l'oxydation
  // NI la lixiviation. La récupération ne peut donc pas dépasser celle de la
  // flottation — d'où le produit, et non la formule série.
  // Le circuit oxydant est CHOISI sur la chimie du minerai (voir
  // ./refractoryCircuit) : POX, BIOX, grillage et Albion ont des libérations,
  // des CAPEX et des critères OPPOSÉS — seul le grillage détruit le carbone
  // organique préempteur. Les traiter comme un seul « oxydation » masquait
  // l'arbitrage le plus structurant d'un projet réfractaire.
  if (m.sulphidePct !== null && m.sulphidePct > E.refractorySulphidesPct) {
    const ox = REFRACTORY_CIRCUITS[inputs.refractoryCircuit ?? 'POX'];
    const rFlot = ((m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct) / 100) * E.flotationSulphides;
    const rOx = circuitLiberation(ox.id, inputs.refractoryEfficiencies);
    const rCyan = Math.min(E.postOxidationLeachMax, cyanidation(leach.pct + ox.postOxidationLeachBonusPts));
    const combined = sequentialRecovery(rFlot, rOx, rCyan);
    // Le preg-robbing n'est un ARGUMENT de confiance que si le circuit retenu le
    // traite réellement : un POX sur minerai carboné ne règle pas le problème.
    const pregHandled = rawPregLoss > 0 && ox.destroysOrganicCarbon;
    routes.push({
      route: `Flottation + ${ox.label} + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: pregHandled ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Séquentielle (même flux, la flottation borne le tout) : R = ${f1(rFlot * 100)} % × ${f1(rOx * 100)} % × ${f1(rCyan * 100)} % = ${f1(combined)} % · ${ox.name}${rawPregLoss > 0 ? (ox.destroysOrganicCarbon ? ' — détruit le carbone organique préempteur' : ' — ⚠ ne détruit PAS le carbone organique : le preg-robbing subsiste') : ''} · ${leachNote}`,
      stages: [
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct)} % × rendement sulfures ${E.flotationSulphides} — borne toute la chaîne` },
        { label: ox.label, recovery_pct: +(rOx * 100).toFixed(1), note: `${ox.name} — libération de l'or verrouillé dans les sulfures du concentré` },
        { label: C, recovery_pct: +(rCyan * 100).toFixed(1), note: `concentré oxydé, +${ox.postOxidationLeachBonusPts} pts après oxydation · ${leachNote}` },
      ],
      references: ['Adams M.D. (2016) — Gold Ore Processing', 'CIM Best Practices'],
      capex_indicator: ox.capex, opex_indicator: ox.opex,
    });
  }

  // ── Repli — Lixiviation en tas (minerai oxydé, étage unique) ─────────────
  if (routes.length < 3 && m.auFreePct !== null && m.auFreePct > R.heapLeachMinAuFreePct) {
    const rec = Math.max(0, Math.min(R.heapLeachMaxRecoveryPct, leach.pct * R.heapLeachEfficiency));
    routes.push({
      route: 'Lixiviation en tas (Heap Leach)',
      recovery_pct: +rec.toFixed(1),
      confidence: 'low',
      dataQualityScore: weightedQuality([{ n: n.leaching, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Étage unique — cinétique colonne : R = ${f1(leach.pct)} % × ${R.heapLeachEfficiency} = ${f1(rec)} % (Au libre ${f1(m.auFreePct)} %)`,
      stages: [
        { label: 'Lixiviation en tas', recovery_pct: +rec.toFixed(1), note: `lixiviation ${leach.label} ${f1(leach.pct)} % × rendement colonne ${R.heapLeachEfficiency} (percolation plus grossière et plus lente)` },
      ],
      references: ['Marsden & House, The Chemistry of Gold Extraction, 2nd ed. — Heap Leaching'],
      capex_indicator: 'low', opex_indicator: 'low',
    });
  }

  // Recommandation UNIQUE : meilleure récupération. Toutes les routes de
  // cyanuration portent désormais le MÊME circuit d'adsorption, donc plus de
  // départage à faire entre un « CIL » et un « CIP » concurrents — la question
  // est tranchée en amont par recommendAdsorptionCircuit.
  const sorted = routes.sort((a, b) => b.recovery_pct - a.recovery_pct);
  const best = selectRecommendedRoute(sorted, inputs.adsorptionCircuit) ?? sorted[0];
  sorted.forEach(r => { r.recommended = r === best; });
  return sorted;
}
