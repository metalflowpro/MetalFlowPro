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
//   Grav. + IGR + Leach (résidus grav.) . R = R_g × R_IGR + (1−R_g) × R_l
//   Flot. + Leach (résidus flottation) .. R = 1 − (1−R_f)(1−R_l)
//   Grav.+Flot.+Leach (résidus flott.) .. R = 1 − (1−R_g)(1−R_f)(1−R_l)
//   Grav.+Flot.+Oxydation+Leach ......... R = R_g×R_ILR + (1−R_g)×R_f×R_ox×R_lo
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
  /**
   * Durée de lixiviation qui FONDE cette route ('48 h', ou le repli 24 h).
   *
   * La récupération globale du projet doit être ALIGNÉE SUR 48 h : c'est la
   * durée finale de lixiviation, donc la seule base de conception. Le 24 h ne
   * décrit qu'une cinétique intermédiaire. Une route bâtie sur ce repli reste
   * estimée — elle informe — mais elle ne peut pas piloter la globale sans le
   * dire, d'où ce drapeau porté jusqu'à l'écran.
   */
  leachBasisLabel: string;
  /** Vrai quand la route repose sur le repli 24 h, pas sur le 48 h de référence. */
  leachBasisIsFallback: boolean;
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
   * SCAVENGER sur les rejets de flottation cleaner/recleaner.
   *
   * ⚠️ DÉFAUT ZÉRO — un circuit qu'on n'a pas ne récupère rien. La valeur était
   * à 1 pt (PFS §13.5.3), donc AJOUTÉE SANS CONDITION à toute route comportant
   * une flottation, y compris aux flowsheets dépourvus de scavenger : la
   * récupération globale portait un point d'or venu d'un équipement inexistant.
   * La cascade de référence (gravité → flottation sur résidu → lixiviation sur
   * concentré) ne comporte aucun terme de ce genre. Un projet qui a réellement
   * ce circuit le renseigne dans l'éditeur de constantes métallurgiques.
   */
  scavengerGravityRecoveryPts: 0,
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

  // Toute route de ce moteur découle de la même base de lixiviation : on la
  // porte une fois ici, plutôt que de la recopier dans chaque littéral de route
  // — sept copies étant sept occasions de diverger.
  const routes: RouteEstimate[] = [];
  const push = (r: Omit<RouteEstimate, 'leachBasisLabel' | 'leachBasisIsFallback'>): void => {
    routes.push({ ...r, leachBasisLabel: leach.label, leachBasisIsFallback: leach.isFallback });
  };

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
    push({
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
  // ── CASCADE DE RÉFÉRENCE (arbitrée par le métallurgiste) ─────────────────
  //   1. la GRAVITÉ prend la première passe sur le tout-venant ;
  //   2. la FLOTTATION traite le RÉSIDU DE GRAVITÉ ;
  //   3. la LIXIVIATION traite le CONCENTRÉ DE FLOTTATION.
  //
  //     R = R_g + (1−R_g) × R_f × R_l,conc
  //
  // ⚠️ LES QUEUES DE FLOTTATION NE SONT PAS LIXIVIÉES. La flottation SÉPARE le
  // flux : ce qu'elle rejette part au parc à résidus et ne revoit aucun étage
  // aval. Ajouter un terme (1−R_f)·R_l reviendrait à décrire un AUTRE flowsheet —
  // celui qui lixivie aussi les queues — et gonflerait la récupération d'un or
  // que ce circuit-ci abandonne.
  //
  // ⚠️ Cette route peut donc rendre MOINS que « Gravité + CIL », qui lixivie
  // l'intégralité du résidu de gravité. Ce n'est pas une anomalie : les deux
  // flowsheets ne traitent pas les mêmes courants. Le classement des routes est
  // là pour rendre cet arbitrage visible, pas pour le masquer par une formule
  // qui crédite tout le monde de tout.
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
    push({
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
    push({
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
  // Même cascade que la route précédente, sans gravité en tête : la flottation
  // part du tout-venant et la lixiviation traite son CONCENTRÉ. Le REBROYAGE n'a
  // pas de récupération propre — il améliore la libération, donc il RELÈVE R_l
  // sur le concentré ; il n'ajoute pas d'étage.
  //
  //     R = R_f × R_l,rebroyé
  //
  // ⚠️ Cette route ne majore PAS la cyanuration directe, et c'est normal : elle
  // abandonne aux résidus l'or que la flottation n'a pas pris, là où le CIL
  // direct lixivie tout le tout-venant. Le commentaire affirmait l'inverse en
  // s'appuyant sur un invariant que les tests avaient déjà abandonné (comparer
  // deux flowsheets qui ne traitent pas les mêmes courants n'est pas une loi
  // générale — voir les INVARIANTS de bilan, seuls universels). La flottation ne
  // se justifie pas par la récupération brute mais par ce qu'elle concentre :
  // débit, réactifs, taille du circuit de cyanuration.
  if (m.flotationAuRecPct !== null) {
    const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
    const scav = E.scavengerGravityRecoveryPts / 100;
    const combined = Math.min(E.flotationRouteMaxPct, (rFlot * concentrateLeach + scav) * 100);
    push({
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
    push({
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
    push({
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

  // ── R16 — Gravité + lixiviation intensive (IGR) + cyanuration des résidus ─────
  // Le concentré de gravité part en LIXIVIATION INTENSIVE (IGR ≈ ILR), les RÉSIDUS
  // de gravité au circuit de cyanuration : R = R_g×R_IGR + (1−R_g)×R_l. Diffère de
  // « Gravité + CIL » (qui suppose la gravité finale) en créditant explicitement
  // l'étage IGR sur le concentré. Le flux lixivié — les résidus de gravité — est
  // nommé dans le libellé.
  if (m.grgPct !== null) {
    const rGrav = gravityCircuitRecovery(m.grgPct, E);
    const rIgr = E.intensiveLeachRecovery;
    const rCyan = cyanidation(leach.pct);
    const combined = Math.min(E.directLeachMaxPct, (rGrav * rIgr + (1 - rGrav) * rCyan) * 100);
    push({
      route: `Gravité (Knelson) + IGR + ${C} (résidus de gravité)`,
      recovery_pct: +combined.toFixed(1),
      confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
      basis: `Concentré de gravité en lixiviation intensive, résidus de gravité au ${C} : R = ${f1(rGrav * 100)} %×${f1(rIgr * 100)} % (IGR) + (1−${f1(rGrav * 100)} %)×${f1(rCyan * 100)} % = ${f1(combined)} % · ${gravNote(m.grgPct, E, rGrav)} · ${leachNote}`,
      stages: [
        { label: 'Gravité + IGR', recovery_pct: +(rGrav * rIgr * 100).toFixed(1), note: `${gravNote(m.grgPct, E, rGrav)}, concentré en lixiviation intensive ${f1(rIgr * 100)} %` },
        { label: `${C} (résidus de gravité)`, recovery_pct: +(rCyan * 100).toFixed(1), note: `lixiviation des résidus de gravité · ${leachNote}` },
      ],
      references: ['Laplante A.R. (2000) — Gravity Recoverable Gold', 'CIM Best Practices'],
      capex_indicator: 'medium', opex_indicator: ads.opex,
    });
  }

  // ── R12 — Gravité + Heap Leach (lixiviation en tas des résidus de gravité) ────
  // SÉRIE : le tas lixivie les résidus de gravité. R = 1−(1−R_g)(1−R_heap).
  if (m.grgPct !== null && m.auFreePct !== null && m.auFreePct > R.heapLeachMinAuFreePct) {
    const rGrav = gravityCircuitRecovery(m.grgPct, E);
    const rHeap = Math.max(0, Math.min(R.heapLeachMaxRecoveryPct, leach.pct * R.heapLeachEfficiency)) / 100;
    const combined = seriesRecovery(rGrav, rHeap);
    push({
      route: 'Gravité (Knelson) + Heap Leach',
      recovery_pct: +combined.toFixed(1),
      confidence: 'low',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.leaching, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Série — le tas lixivie les résidus de gravité : R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rHeap * 100)} %) = ${f1(combined)} % · ${gravNote(m.grgPct, E, rGrav)} · lixiviation en tas ${f1(leach.pct)} % × rendement colonne ${R.heapLeachEfficiency}`,
      stages: [
        { label: 'Gravité', recovery_pct: +(rGrav * 100).toFixed(1), note: gravNote(m.grgPct, E, rGrav) },
        { label: 'Heap Leach', recovery_pct: +(rHeap * 100).toFixed(1), note: `lixiviation en tas des résidus de gravité ${f1(leach.pct)} % × rendement colonne ${R.heapLeachEfficiency}` },
      ],
      references: ['Marsden & House, The Chemistry of Gold Extraction, 2nd ed. — Heap Leaching'],
      capex_indicator: 'low', opex_indicator: 'low',
    });
  }

  // ── R9 / R13 / R14 — Gravité + Flottation + Oxydation + Leach ─────────────────
  // Même cascade réfractaire que « Flottation + oxydation + CIL », avec une TÊTE
  // GRAVITÉ : concentré de gravité en lixiviation intensive, flottation sur le
  // résidu de gravité, son concentré oxydé (POX/BIOX/grillage/Albion selon la
  // chimie) puis lixivié. R = R_g×R_ILR + (1−R_g)×R_f×R_ox×R_lo. Libellé SANS
  // « (Knelson) » : il ne doit pas préfixer comme « Gravité (Knelson) + Flottation »
  // (route sur concentré), sa topologie étant différente.
  if (m.grgPct !== null && m.sulphidePct !== null && m.sulphidePct > E.refractorySulphidesPct) {
    const ox = REFRACTORY_CIRCUITS[inputs.refractoryCircuit ?? 'POX'];
    const rGrav = gravityCircuitRecovery(m.grgPct, E);
    const rFlot = ((m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct) / 100) * E.flotationSulphides;
    const rOx = circuitLiberation(ox.id, inputs.refractoryEfficiencies);
    const rCyan = Math.min(E.postOxidationLeachMax, cyanidation(leach.pct + ox.postOxidationLeachBonusPts));
    const fromGrav = rGrav * E.intensiveLeachRecovery;
    const fromFlot = (1 - rGrav) * rFlot * rOx * rCyan;
    const combined = Math.min(E.gravFlotLeachRouteMaxPct, (fromGrav + fromFlot) * 100);
    const pregHandled = rawPregLoss > 0 && ox.destroysOrganicCarbon;
    push({
      route: `Gravité + Flottation + ${ox.label} + ${C}`,
      recovery_pct: +combined.toFixed(1),
      confidence: pregHandled ? 'high' : 'medium',
      dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.flotation, w: 2 }, { n: n.leaching, w: 2 }, { n: n.chem, w: 2 }, { n: n.mineralogy, w: 1 }]),
      basis: `Tête gravité (concentré en lixiviation intensive) puis flottation + ${ox.name} + ${C} sur son concentré : R = ${f1(rGrav * 100)} %×${f1(E.intensiveLeachRecovery * 100)} % (ILR) + (1−${f1(rGrav * 100)} %)×${f1(rFlot * 100)} %×${f1(rOx * 100)} %×${f1(rCyan * 100)} % = ${f1(combined)} %${rawPregLoss > 0 ? (ox.destroysOrganicCarbon ? ' · détruit le carbone organique préempteur' : ' · ⚠ ne détruit PAS le carbone organique préempteur') : ''} · ${gravNote(m.grgPct, E, rGrav)} · rejets de flottation au parc à résidus (non lixiviés) · ${leachNote}`,
      stages: [
        { label: 'Gravité + ILR', recovery_pct: +(fromGrav * 100).toFixed(1), note: `${gravNote(m.grgPct, E, rGrav)}, concentré en lixiviation intensive ${f1(E.intensiveLeachRecovery * 100)} %` },
        { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct ?? E.flotationDefaultRecoveryPct)} % × rendement sulfures ${E.flotationSulphides} — sur les résidus de gravité` },
        { label: ox.label, recovery_pct: +(rOx * 100).toFixed(1), note: `${ox.name} — libération de l'or verrouillé dans les sulfures du concentré` },
        { label: C, recovery_pct: +(rCyan * 100).toFixed(1), note: `concentré oxydé, +${ox.postOxidationLeachBonusPts} pts après oxydation · ${leachNote}` },
      ],
      references: ['Adams M.D. (2016) — Gold Ore Processing', 'CIM Best Practices'],
      capex_indicator: 'high', opex_indicator: ox.opex,
    });
  }

  // ── Routes « SUR RÉSIDUS DE FLOTTATION » — topologie ADDITIVE ─────────────────
  // ⚠️ Réintroduites à la demande EXPLICITE du métallurgiste (18 août 2026). Ici la
  // lixiviation traite les RÉSIDUS de flottation (flux distinct RÉELLEMENT lixivié),
  // donc les contributions s'ADDITIONNENT : R = 1−∏(1−Rᵢ). Ces variantes rendent
  // MÉCANIQUEMENT plus que leurs jumelles « sur concentré » et coifferont souvent
  // le classement — c'est correct SI, et seulement si, le circuit lixivie vraiment
  // les queues de flottation. Le libellé nomme le flux pour lever l'ambiguïté qui
  // avait laissé passer le bug des 97,4 % (voir mémoire formules-recuperation).
  {
    const rCyanTails = cyanidation(leach.pct);
    // R15 — Flottation + cyanuration des résidus de flottation.
    if (m.flotationAuRecPct !== null) {
      const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
      const combined = seriesRecovery(rFlot, rCyanTails);
      push({
        route: `Flottation + ${C} (résidus de flottation)`,
        recovery_pct: +combined.toFixed(1),
        confidence: 'medium',
        dataQualityScore: weightedQuality([{ n: n.flotation, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
        basis: `Série — la lixiviation traite les RÉSIDUS de flottation (flux distinct, contributions additionnées) : R = 1−(1−${f1(rFlot * 100)} %)(1−${f1(rCyanTails * 100)} %) = ${f1(combined)} % · flottation ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} · ${leachNote}`,
        stages: [
          { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — son CONCENTRÉ est un produit, ses RÉSIDUS sont lixiviés` },
          { label: `${C} (résidus de flottation)`, recovery_pct: +(rCyanTails * 100).toFixed(1), note: `lixiviation des queues de flottation · ${leachNote}` },
        ],
        references: ['Marsden & House, The Chemistry of Gold Extraction, 2nd ed.'],
        capex_indicator: 'high', opex_indicator: ads.opex,
      });
    }
    // R4 — Gravité + Flottation + cyanuration des résidus de flottation.
    if (m.grgPct !== null && m.flotationAuRecPct !== null) {
      const rGrav = gravityCircuitRecovery(m.grgPct, E);
      const rFlot = (m.flotationAuRecPct / 100) * E.flotationAu;
      const combined = seriesRecovery(rGrav, rFlot, rCyanTails);
      push({
        route: `Gravité + Flottation + ${C} (résidus de flottation)`,
        recovery_pct: +combined.toFixed(1),
        confidence: m.grgPct > E.gravityHighConfidenceGrgPct ? 'high' : 'medium',
        dataQualityScore: weightedQuality([{ n: n.knelson, w: 2 }, { n: n.flotation, w: 2 }, { n: n.leaching, w: 3 }, { n: n.chem, w: 1 }]),
        basis: `Série sur trois étages — la lixiviation traite les RÉSIDUS de flottation : R = 1−(1−${f1(rGrav * 100)} %)(1−${f1(rFlot * 100)} %)(1−${f1(rCyanTails * 100)} %) = ${f1(combined)} % · ${gravNote(m.grgPct, E, rGrav)} · flottation ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} · ${leachNote}`,
        stages: [
          { label: 'Gravité', recovery_pct: +(rGrav * 100).toFixed(1), note: gravNote(m.grgPct, E, rGrav) },
          { label: 'Flottation', recovery_pct: +(rFlot * 100).toFixed(1), note: `essai ${f1(m.flotationAuRecPct)} % × rendement d'étage ${E.flotationAu} — sur les résidus de gravité` },
          { label: `${C} (résidus de flottation)`, recovery_pct: +(rCyanTails * 100).toFixed(1), note: `lixiviation des queues de flottation · ${leachNote}` },
        ],
        references: ['CIM Best Practices — Metallurgical Testing'],
        capex_indicator: 'high', opex_indicator: ads.opex,
      });
    }
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
