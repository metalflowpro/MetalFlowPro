// ─────────────────────────────────────────────────────────────────────────────
// Générateur automatique de flowsheet — module PUR (aucun React/DB).
//
// Le bouton « ✨ Générer un flowsheet recommandé » (§6) ne doit PAS fabriquer un
// circuit arbitraire ni inventer une récupération : il applique des règles
// EXPLICABLES aux données du projet et propose de 2 à 5 scénarios classés.
//
// PRINCIPE STRUCTURANT — on ne recalcule aucune récupération ici.
// Les routes candidates arrivent DÉJÀ chiffrées et métallurgiquement correctes
// par `analytics/routeEstimation.estimateRoutes` (séries vs séquentiel tranché,
// catalogue de formules arbitré, base usine). Le générateur se contente de :
//   1. FILTRER les routes selon les contraintes (technos exclues, route préférée) ;
//   2. les MAPPER vers un template de topologie (injecté, pour rester découplé) ;
//   3. les SCORER selon l'objectif demandé (récup, CAPEX, OPEX, oz/j, risque…) ;
//   4. classer, nommer, et JOINDRE le journal de décision + la couverture données.
//
// Ainsi le générateur ne peut jamais contredire le Tableau de bord ni rejouer le
// bug flottation-en-série : il hérite de la seule source de vérité de récupération.
// Aucune valeur métier n'est en dur : les seuils viennent de ROUTE_STAGE_EFFICIENCIES
// et les poids de score sont regroupés dans GENERATOR_CONFIG, éditable.
// ─────────────────────────────────────────────────────────────────────────────

import type { RouteEstimate } from '../analytics/routeEstimation';
import { ROUTE_STAGE_EFFICIENCIES } from '../analytics/routeEstimation';
import { TROY_OZ_GRAMS } from '../config/constants';
import {
  type QualityLevel, type SourceTier, qualityFromTiers, dataCoverage,
} from './provenance';

// ─── Requête de génération (§6) ──────────────────────────────────────────────

export type GenerationObjective =
  | 'max_recovery'      // Maximiser la récupération Au
  | 'max_oz_per_day'    // Maximiser les onces récupérées par jour
  | 'min_capex'         // Minimiser le CAPEX
  | 'min_opex'          // Minimiser l'OPEX
  | 'min_energy'        // Minimiser la consommation énergétique
  | 'min_risk'          // Minimiser le risque métallurgique
  | 'max_net_value'     // Maximiser la valeur nette estimée (screening)
  | 'compare_routes';   // Comparer plusieurs routes (pas d'objectif dominant)

export const GENERATION_OBJECTIVE_LABEL: Record<GenerationObjective, string> = {
  max_recovery: 'Maximiser la récupération Au',
  max_oz_per_day: 'Maximiser les onces récupérées par jour',
  min_capex: 'Minimiser le CAPEX',
  min_opex: "Minimiser l'OPEX",
  min_energy: 'Minimiser la consommation énergétique',
  min_risk: 'Minimiser le risque métallurgique',
  max_net_value: 'Maximiser la valeur nette estimée',
  compare_routes: 'Comparer plusieurs routes',
};

export type MaturityLevel =
  | 'conceptual' | 'pea' | 'pre_feasibility' | 'feasibility' | 'plant_optimization';

export interface GenerationRequest {
  objective: GenerationObjective;
  /** Sous-chaîne à retrouver dans le libellé de route, ou null/'auto' = toutes. */
  preferredRoute?: string | null;
  /** Débit de conception (t/h). Défaut : débit projet, injecté par l'appelant. */
  designThroughputTph: number;
  maturity: MaturityLevel;
  maxCapexUsd?: number | null;
  maxOpexUsdT?: number | null;
  riskTolerance?: 'low' | 'medium' | 'high';
  /** Technologies à exclure — mots-clés testés contre le libellé de route (POX, BIOX, flottation…). */
  excludedTechnologies?: string[];
  /** Nombre max de scénarios (borné à [2,5]). */
  maxScenarios?: number;
}

// ─── Caractérisation minerai (pour oz/j, P80 et journal de décision) ──────────

export interface GeneratorFeed {
  goldGrade: number;             // g/t — teneur de tête
  grgPct: number | null;         // or gravi-récupérable GRG (%)
  sulphidePct: number | null;    // sulfures (%)
  corgPct: number | null;        // carbone organique (%)
  bwiKwhT: number | null;        // Bond Ball Work Index (kWh/t)
  labP80Um?: number | null;      // P80 labo recommandé (µm) — Étude P80
  plantP80Um?: number | null;    // P80 usine candidat (µm)
  regrindP80Um?: number | null;  // P80 de rebroyage cible (µm), si concentré
}

// ─── Configuration (poids & seuils — éditable, rien en dur inline) ────────────

export const GENERATOR_CONFIG = {
  /** Bornes du nombre de scénarios rendus (§6 : « de deux à cinq »). */
  minScenarios: 2,
  maxScenarios: 5,
  /**
   * Poids du score composite quand l'objectif n'est pas mono-critère
   * (`compare_routes`) : équilibre récupération / économie / robustesse.
   */
  compareWeights: { recovery: 0.5, economy: 0.3, robustness: 0.2 },
  /** Score attribué à un indicateur qualitatif low/medium/high (sens « moins = mieux »). */
  indicatorScore: { low: 1, medium: 0.5, high: 0 } as Record<'low' | 'medium' | 'high', number>,
  /** Score de confiance → composante robustesse. */
  confidenceScore: { high: 1, medium: 0.6, low: 0.25 } as Record<'high' | 'medium' | 'low', number>,
  /**
   * Nombre MINIMUM d'essais LIMS (toutes familles) sous lequel on refuse de
   * déclarer un flowsheet « optimal » (§6 : ne jamais l'annoncer si les données
   * sont insuffisantes). Seuil de gouvernance, pas une valeur métallurgique.
   */
  minSamplesForOptimalClaim: 6,
  /** Part d'hypothèses (%) au-delà de laquelle la confiance est plafonnée à « faible ». */
  lowConfidenceAssumptionPct: 50,
} as const;

// ─── Sortie ──────────────────────────────────────────────────────────────────

export interface GeneratedScenario {
  id: string;
  rank: number;
  /** « Recommandé », « Priorité CAPEX », « Priorité OPEX / simplicité »… */
  title: string;
  route: string;
  templateId: string | null;
  recoveryPct: number;
  ozPerDay: number;
  primaryGrindP80Um: number | null;
  regrindP80Um: number | null;
  throughputTph: number;
  confidence: 'high' | 'medium' | 'low';
  dataPct: number;
  assumptionPct: number;
  capexIndicator: 'low' | 'medium' | 'high';
  opexIndicator: 'low' | 'medium' | 'high';
  score: number;
  quality: QualityLevel;
  /** Champs qui reposent sur une hypothèse (P80 absent, GRG absent…). */
  assumptions: string[];
  /** Règles explicables ayant orienté ce scénario. */
  decisionLog: string[];
}

export interface GenerationResult {
  scenarios: GeneratedScenario[];
  /** Journal de décision global (règles de caractérisation qui se sont déclenchées). */
  decisionLog: string[];
  /** Avertissements — dont « données insuffisantes pour déclarer optimal ». */
  warnings: string[];
  /** Faux quand la couverture d'essais interdit toute annonce d'optimalité. */
  dataSufficient: boolean;
}

// ─── Dépendances injectées ────────────────────────────────────────────────────

export interface GeneratorInputs {
  request: GenerationRequest;
  /** Routes candidates DÉJÀ chiffrées et triées par récupération décroissante. */
  candidateRoutes: RouteEstimate[];
  feed: GeneratorFeed;
  /** Décompte d'essais par famille — pilote la couverture données/hypothèses. */
  sampleCounts?: Partial<Record<string, number>>;
  /** Mappe un libellé de route vers un template de topologie (injecté, découplé). */
  templateMatcher?: (routeLabel: string) => string | null;
  /** Générateur d'identifiants (injecté pour la testabilité). */
  makeId?: () => string;
  config?: typeof GENERATOR_CONFIG;
}

// ─── Onces d'or par jour (§7) ─────────────────────────────────────────────────

/**
 * Au récupéré (oz troy / jour) = Q × G_Au × R × 24 / 31.1035.
 * Q en t/h, G_Au en g/t, R en décimal. Formule NOMINALE du CdC — la
 * disponibilité n'y entre pas (c'est un débit instantané × 24 h).
 */
export function goldOuncesPerDay(throughputTph: number, goldGradeGt: number, recoveryFraction: number): number {
  const gramsPerDay = throughputTph * goldGradeGt * recoveryFraction * 24;
  return gramsPerDay / TROY_OZ_GRAMS;
}

// ─── Utilitaires internes ────────────────────────────────────────────────────

function clampScenarioCount(n: number | undefined, cfg: typeof GENERATOR_CONFIG): number {
  const v = n ?? cfg.maxScenarios;
  return Math.max(cfg.minScenarios, Math.min(cfg.maxScenarios, Math.round(v)));
}

/** Une route est-elle écartée par une techno exclue ? (mots-clés vs libellé). */
function isExcluded(route: RouteEstimate, excluded: string[] | undefined): boolean {
  if (!excluded || excluded.length === 0) return false;
  const hay = route.route.toLowerCase();
  return excluded.some(tech => tech.trim() !== '' && hay.includes(tech.toLowerCase()));
}

/**
 * Niveaux de source des champs contributifs d'un scénario — sert à la couleur de
 * qualité ET à la couverture données/hypothèses. La récupération vient d'essais
 * (validée/estimée selon la confiance de la route) ; les P80/GRG absents comptent
 * comme hypothèses.
 */
function scenarioTiers(route: RouteEstimate, feed: GeneratorFeed): SourceTier[] {
  const tiers: SourceTier[] = [];
  // La récupération de la route : validée si confiance haute, sinon essai/estimé.
  tiers.push(route.confidence === 'high' ? 'testwork_validated' : 'design_criteria');
  // Chaque descripteur minéral présent est une mesure ; absent → hypothèse.
  tiers.push(feed.grgPct != null ? 'lims_approved' : 'user_assumption');
  tiers.push(feed.sulphidePct != null ? 'lims_approved' : 'user_assumption');
  tiers.push(feed.corgPct != null ? 'lims_approved' : 'user_assumption');
  tiers.push(feed.bwiKwhT != null ? 'testwork_validated' : 'user_assumption');
  // P80 : validé s'il vient de l'Étude P80, sinon défaut de template.
  tiers.push(feed.labP80Um != null ? 'testwork_validated' : 'template_default');
  return tiers;
}

function listAssumptions(feed: GeneratorFeed): string[] {
  const out: string[] = [];
  if (feed.grgPct == null) out.push('GRG absent — gravité supposée par défaut');
  if (feed.sulphidePct == null) out.push('Teneur en sulfures absente');
  if (feed.corgPct == null) out.push('Carbone organique absent — risque preg-robbing non évalué');
  if (feed.bwiKwhT == null) out.push('BWi absent — puissance de broyage estimée');
  if (feed.labP80Um == null) out.push('P80 labo recommandé absent — P80 par défaut du template');
  return out;
}

/**
 * Journal de décision GLOBAL — règles de caractérisation explicables (§6).
 * Elles REFLÈTENT la logique de routeEstimation (mêmes seuils importés), sans la
 * recalculer : elles expliquent à l'utilisateur POURQUOI telles routes ressortent.
 */
function buildDecisionLog(feed: GeneratorFeed): string[] {
  const log: string[] = [];
  const E = ROUTE_STAGE_EFFICIENCIES;
  if (feed.grgPct != null) {
    if (feed.grgPct >= E.gravityHighConfidenceGrgPct) {
      log.push(`GRG ${feed.grgPct.toFixed(1)} % ≥ ${E.gravityHighConfidenceGrgPct} % → gravité pertinente (or libre récupérable).`);
    } else {
      log.push(`GRG ${feed.grgPct.toFixed(1)} % < ${E.gravityHighConfidenceGrgPct} % → apport gravité limité.`);
    }
  }
  if (feed.sulphidePct != null && feed.sulphidePct >= E.refractorySulphidesPct) {
    log.push(`Sulfures ${feed.sulphidePct.toFixed(1)} % ≥ ${E.refractorySulphidesPct} % → flottation / prétraitement oxydant à envisager.`);
  }
  if (feed.corgPct != null && feed.corgPct > 0) {
    log.push(`Carbone organique ${feed.corgPct.toFixed(2)} % présent → risque preg-robbing : privilégier gravité + flottation, CIL du concentré plutôt que CIL direct.`);
  }
  if (feed.bwiKwhT != null) {
    log.push(`BWi ${feed.bwiKwhT.toFixed(1)} kWh/t → dimensionnement broyage (SAG/boulets, HPGR à évaluer si élevé).`);
  }
  if (feed.labP80Um != null) {
    log.push(`P80 labo recommandé ${feed.labP80Um.toFixed(0)} µm retenu comme point de départ de broyage (Étude P80).`);
  }
  if (feed.plantP80Um != null) {
    log.push(`P80 usine candidat ${feed.plantP80Um.toFixed(0)} µm retenu comme cible industrielle.`);
  }
  return log;
}

// ─── Scoring par objectif ─────────────────────────────────────────────────────

/** Score dans [0,1], « plus grand = mieux », selon l'objectif demandé. */
function scoreRoute(
  route: RouteEstimate,
  ctx: { objective: GenerationObjective; ozPerDay: number; maxOzPerDay: number; assumptionPct: number; feed: GeneratorFeed },
  cfg: typeof GENERATOR_CONFIG,
): number {
  const ind = cfg.indicatorScore;
  const conf = cfg.confidenceScore;
  const recNorm = route.recovery_pct / 100;
  switch (ctx.objective) {
    case 'max_recovery':
      return recNorm;
    case 'max_oz_per_day':
      return ctx.maxOzPerDay > 0 ? ctx.ozPerDay / ctx.maxOzPerDay : 0;
    case 'min_capex':
      return ind[route.capex_indicator];
    case 'min_opex':
      return ind[route.opex_indicator];
    case 'min_energy': {
      // Sans énergie par route, proxy documenté : OPEX (dominé par le broyage)
      // pénalisé si la route rebroie un concentré (« rebroyage »/« regrind »).
      const regrindPenalty = /rebroy|regrind/i.test(route.route) ? 0.2 : 0;
      return Math.max(0, ind[route.opex_indicator] - regrindPenalty);
    }
    case 'min_risk':
      return conf[route.confidence];
    case 'max_net_value':
      // Screening : revenu ∝ oz/j, moins une pénalité OPEX. Pas de $ inventé.
      return 0.7 * (ctx.maxOzPerDay > 0 ? ctx.ozPerDay / ctx.maxOzPerDay : 0)
        + 0.3 * ind[route.opex_indicator];
    case 'compare_routes':
    default: {
      const w = cfg.compareWeights;
      const economy = (ind[route.capex_indicator] + ind[route.opex_indicator]) / 2;
      const robustness = conf[route.confidence] * (1 - ctx.assumptionPct / 100);
      return w.recovery * recNorm + w.economy * economy + w.robustness * robustness;
    }
  }
}

/** Intitulé d'un scénario selon son rang et l'objectif. */
function scenarioTitle(rank: number, route: RouteEstimate): string {
  if (rank === 1) return 'Recommandé';
  // Les suivants sont nommés par leur trait dominant.
  if (route.capex_indicator === 'low') return 'Priorité CAPEX';
  if (route.opex_indicator === 'low') return 'Priorité OPEX / simplicité';
  if (route.recovery_pct >= 90) return 'Récupération maximale';
  return 'Alternative';
}

// ─── Point d'entrée ───────────────────────────────────────────────────────────

/**
 * Génère 2 à 5 scénarios classés à partir des routes candidates et de la
 * caractérisation minerai. Ne recalcule aucune récupération.
 */
export function generateFlowsheets(inputs: GeneratorInputs): GenerationResult {
  const cfg = inputs.config ?? GENERATOR_CONFIG;
  const { request, candidateRoutes, feed } = inputs;
  const makeId = inputs.makeId ?? (() => crypto.randomUUID());
  const warnings: string[] = [];

  // 1. Filtrage : route préférée puis technos exclues.
  let routes = candidateRoutes.slice();
  const pref = request.preferredRoute?.trim().toLowerCase();
  if (pref && pref !== 'auto' && pref !== '') {
    const filtered = routes.filter(r => r.route.toLowerCase().includes(pref));
    if (filtered.length > 0) routes = filtered;
    else warnings.push(`Route préférée « ${request.preferredRoute} » introuvable parmi les routes chiffrables — toutes les routes sont considérées.`);
  }
  const beforeExcl = routes.length;
  routes = routes.filter(r => !isExcluded(r, request.excludedTechnologies));
  if (routes.length < beforeExcl) {
    warnings.push(`${beforeExcl - routes.length} route(s) écartée(s) par les technologies exclues.`);
  }

  if (routes.length === 0) {
    return { scenarios: [], decisionLog: buildDecisionLog(feed), warnings: [...warnings, 'Aucune route ne satisfait les contraintes.'], dataSufficient: false };
  }

  // 2. oz/jour par route (pour l'objectif oz/j et max_net_value).
  const throughput = request.designThroughputTph;
  const ozByRoute = new Map<string, number>();
  for (const r of routes) ozByRoute.set(r.route, goldOuncesPerDay(throughput, feed.goldGrade, r.recovery_pct / 100));
  const maxOzPerDay = Math.max(...ozByRoute.values(), 0);

  // 3. Couverture données/hypothèses globale.
  const totalSamples = Object.values(inputs.sampleCounts ?? {}).reduce<number>((a, b) => a + (b ?? 0), 0);
  const dataSufficient = totalSamples >= cfg.minSamplesForOptimalClaim;
  if (!dataSufficient) {
    warnings.push(`Couverture d'essais insuffisante (${totalSamples} essai(s) < ${cfg.minSamplesForOptimalClaim}) — aucun flowsheet ne peut être déclaré « optimal ».`);
  }

  // 4. Score + tri.
  const scored = routes.map(route => {
    const ozPerDay = ozByRoute.get(route.route) ?? 0;
    const tiers = scenarioTiers(route, feed);
    const cov = dataCoverage(tiers);
    const score = scoreRoute(route, {
      objective: request.objective, ozPerDay, maxOzPerDay,
      assumptionPct: cov.assumptionPct, feed,
    }, cfg);
    return { route, ozPerDay, tiers, cov, score };
  });
  scored.sort((a, b) => b.score - a.score || b.route.recovery_pct - a.route.recovery_pct);

  // 5. Top N + habillage.
  const n = clampScenarioCount(request.maxScenarios, cfg);
  const top = scored.slice(0, n);
  const globalLog = buildDecisionLog(feed);

  const scenarios: GeneratedScenario[] = top.map((s, i) => {
    const rank = i + 1;
    // Confiance plafonnée à « faible » si trop d'hypothèses ou données insuffisantes.
    let confidence = s.route.confidence;
    if (s.cov.assumptionPct >= cfg.lowConfidenceAssumptionPct || !dataSufficient) {
      confidence = confidence === 'high' ? 'medium' : confidence;
      if (s.cov.assumptionPct >= cfg.lowConfidenceAssumptionPct) confidence = 'low';
    }
    return {
      id: makeId(),
      rank,
      title: scenarioTitle(rank, s.route),
      route: s.route.route,
      templateId: inputs.templateMatcher?.(s.route.route) ?? null,
      recoveryPct: s.route.recovery_pct,
      ozPerDay: s.ozPerDay,
      primaryGrindP80Um: feed.labP80Um ?? feed.plantP80Um ?? null,
      regrindP80Um: feed.regrindP80Um ?? null,
      throughputTph: throughput,
      confidence,
      dataPct: Math.round(s.cov.dataPct),
      assumptionPct: Math.round(s.cov.assumptionPct),
      capexIndicator: s.route.capex_indicator,
      opexIndicator: s.route.opex_indicator,
      score: s.score,
      quality: qualityFromTiers(s.tiers),
      assumptions: listAssumptions(feed),
      decisionLog: [`Route « ${s.route.route} » — ${s.route.basis}`],
    };
  });

  return { scenarios, decisionLog: globalLog, warnings, dataSufficient };
}
