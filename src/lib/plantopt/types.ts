// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Modèle RAM/DES (Reliability · Availability · Maintainability)
//
// Types du modèle de simulation Monte-Carlo à événements discrets qui identifie
// les goulots macro d'une usine de traitement. Une USINE = une chaîne d'AIRES
// (concassage → broyage → …) reliées par des FLUX, chaque aire ayant une capacité
// incertaine (loi de probabilité) et des MODES DE DÉFAILLANCE (TTF/TTR) qui la
// mettent hors service par intermittence. Le moteur (`engine.ts`) fait tourner N
// itérations sur un horizon donné et agrège débit P10/P50/P90, disponibilité,
// probabilité de goulot par aire et sensibilités.
//
// ⚠️ Aucune valeur par défaut n'est codée dans ce fichier : les types décrivent la
// forme des données, les valeurs de départ viennent de `config.ts` (couche config
// surchargeable) et du projet actif (`projectModel.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Familles de lois de probabilité supportées par l'échantillonneur. */
export type DistributionKind =
  | 'constant'
  | 'uniform'
  | 'normal'
  | 'exponential'
  | 'weibull'
  | 'lognormal'
  | 'triangular'
  | 'pert'
  | 'empirical'
  | 'categorical';

/**
 * Spécification d'une loi : le `kind` détermine quels `params` sont lus.
 * Volontairement ouverte (`Record<string, …>`) pour rester sérialisable en JSONB
 * et éditable génériquement par l'UI ; l'échantillonneur valide/replie les champs.
 */
export interface DistributionSpec {
  kind: DistributionKind;
  params: Record<string, number | number[]>;
}

/** Une aire de traitement (unité macro : concassage, broyage, lixiviation…). */
export interface Area {
  id: string;
  name: string;
  /** Catégorie procédé (concassage, broyage, flottation…) — pilote la couleur/l'icône. */
  type?: string;
  /** Rang dans la chaîne : les aires sont traitées par ordre croissant. */
  processOrder: number;
  /** Coût opératoire variable de l'aire (devise/tonne traitée). */
  opexPerTonne: number;
  /** Loi de la capacité nominale instantanée de l'aire (t/h). */
  capacityDist: DistributionSpec;
  /** Position sur le canvas de l'éditeur de flowsheet (px). */
  x?: number;
  y?: number;
  /** Sensible à la dureté du minerai (voir `feedScenario.hardnessToCapacity`). */
  hardnessSensitive?: boolean;
  /** Sensibilité individuelle à la dureté (fraction) — surcharge `hardnessSensitive`. */
  hardnessSensitivity?: number;
  /** Récupération de base de l'aire (fraction 0–1) — pour les aires séparatrices. */
  baseRecovery?: number;
  /** Sensibilité de la récupération à la teneur d'alimentation (fraction). */
  gradeSensitivity?: number;
}

/** Un flux reliant deux aires, avec rendement massique (fraction transmise). */
export interface Stream {
  id: string;
  sourceAreaId: string;
  targetAreaId: string;
  /** Fraction du débit transmise vers l'aval (1 = pas de perte massique). */
  massYield?: number;
  /** Nature du flux (procédé, eau, réactif, concentré, rejet…) — cosmétique. */
  kind?: string;
}

/** Un tampon (stockage intermédiaire) entre deux aires successives. */
export interface Buffer {
  id: string;
  upstreamAreaId: string;
  downstreamAreaId: string;
  capacityTonnes: number;
  initialLevel?: number;
}

/** Un mode de défaillance d'une aire : cycle marche (TTF) / réparation (TTR). */
export interface FailureMode {
  id: string;
  areaId: string;
  /** Capacité résiduelle pendant la panne (fraction 0–1 ; 0 = arrêt total). */
  residualCapacity?: number;
  /** Time-To-Failure : loi du temps de bon fonctionnement (heures). */
  ttfDist: DistributionSpec;
  /** Time-To-Repair : loi du temps de réparation (heures). */
  ttrDist: DistributionSpec;
}

/** Un arrêt planifié périodique (maintenance préventive) sur une ou plusieurs aires. */
export interface PlannedStop {
  id: string;
  areaIds: string[];
  intervalHours: number;
  durationHours: number;
  /** Décalage du premier arrêt depuis t=0 (heures). */
  firstOffsetHours?: number;
}

/** Une cause commune : un événement rare qui abat simultanément plusieurs aires. */
export interface CommonCause {
  id: string;
  areaIds: string[];
  /** Facteur β (fraction de couplage, informatif). */
  beta?: number;
  ttfDist: DistributionSpec;
  ttrDist: DistributionSpec;
}

/** Scénario d'alimentation : incertitude sur la dureté et la teneur du minerai. */
export interface FeedScenario {
  id?: string;
  /** Loi de la dureté (échelle libre, comparée à `hardnessRef`). */
  hardnessDist?: DistributionSpec;
  hardnessRef?: number;
  /** Élasticité capacité↔dureté (fraction de capacité perdue par unité relative de dureté). */
  hardnessToCapacity?: number;
  /** Loi de la teneur d'alimentation. */
  gradeDist?: DistributionSpec;
  gradeRef?: number;
}

/** Le modèle d'usine complet, sérialisable (persisté en scénario). */
export interface PlantModel {
  id: string;
  /** Horizon de simulation (heures) — typiquement une année calendaire. */
  horizonHours: number;
  /** Devise d'affichage des coûts (ex. 'USD'). */
  currency: string;
  areas: Area[];
  streams: Stream[];
  buffers: Buffer[];
  failureModes: FailureMode[];
  plannedStops: PlannedStop[];
  commonCauses: CommonCause[];
  feedScenario?: FeedScenario;
}

/** Réglages d'exécution Monte-Carlo (indépendants du modèle physique). */
export interface SimConfig {
  iterations: number;
  seed: number;
  /** Période de rodage exclue des statistiques (heures) — vide les transitoires. */
  warmupHours: number;
  /** Pas de temps de l'intégration (heures). */
  timeStepHours: number;
  /** Horizon (heures) — surcharge `PlantModel.horizonHours` si défini. */
  horizonHours?: number;
}

/** Résultat d'une itération unique. */
export interface IterationResult {
  throughput: number;
  bottleneckAreaId: string;
  nominalCapacity: Record<string, number>;
  meanAvailableCapacity: Record<string, number>;
  minNominalCapacity: number;
  availability: number;
  recovery: number;
  recoveredThroughput: number;
}

/** Une entrée du diagramme tornado (sensibilité du débit à une aire). */
export interface SensitivityEntry {
  driver: string;
  low: number;
  high: number;
}

/** Résultat agrégé sur toutes les itérations. */
export interface SimResult {
  throughputP10: number;
  throughputP50: number;
  throughputP90: number;
  throughputMean: number;
  availability: number;
  costPerTonne: number;
  /** Probabilité qu'une aire soit le goulot, par areaId (somme = 1). */
  bottleneckProbability: Record<string, number>;
  sensitivity: SensitivityEntry[];
  /** Échantillons de débit triés (pour l'histogramme). */
  throughputSamples: number[];
  recoveryMean: number;
  recoveredThroughputP50: number;
}
