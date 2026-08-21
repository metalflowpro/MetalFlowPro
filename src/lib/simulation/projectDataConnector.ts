// ─────────────────────────────────────────────────────────────────────────────
// Connecteur de données projet — module PUR (aucun React/DB).
//
// Flowsheet Simulation Pro ne doit consommer QUE des données du projet actif et,
// pour chaque champ, retenir la source la plus fiable disponible en appliquant la
// hiérarchie de priorité (§3). Ce connecteur reçoit les CANDIDATS déjà chargés
// (essais LIMS agrégés, critères de conception, Étude P80, réglages projet), les
// résout via {@link resolveSourced}, et produit un `ProjectDataBundle` où chaque
// champ porte sa valeur ET sa traçabilité (`Sourced<T>`).
//
// C'est LUI qui garantit que le générateur, l'éditeur et le snapshot d'entrée
// s'accordent sur « d'où vient ce chiffre » — sans dupliquer la logique de
// priorité dans chaque écran. Le chargement DB reste dans un hook mince en amont ;
// ici, tout est pur et testable.
// ─────────────────────────────────────────────────────────────────────────────

import type { RouteSampleCounts } from '../analytics/routeEstimation';
import {
  type Sourced, type QualityLevel, type SourceTier,
  resolveSourced, qualityFromTiers,
} from './provenance';
import type { GeneratorFeed } from './generator';
import type { FeedInput, OreType, ProcessNode } from './types';

// ─── Candidats d'entrée ───────────────────────────────────────────────────────

/**
 * Un champ peut avoir plusieurs candidats (essai, critère, défaut…). On fournit
 * chacun avec son niveau de source ; le connecteur retient le plus prioritaire
 * présent. `null`/`undefined` = candidat absent (sauté).
 */
export type Candidate = Sourced<number | null | undefined> | null | undefined;

export interface ConnectorInputs {
  throughputTph: Candidate[];
  goldGrade: Candidate[];
  silverGrade?: Candidate[];
  grgPct?: Candidate[];
  sulphidePct?: Candidate[];
  corgPct?: Candidate[];
  bwiKwhT?: Candidate[];
  labP80Um?: Candidate[];
  plantP80Um?: Candidate[];
  regrindP80Um?: Candidate[];
  targetRecoveryPct?: Candidate[];
  /** Récupération de flottation (or vers concentré, %) — essais/critères. */
  flotationAuRecoveryPct?: Candidate[];
  /** Récupération de lixiviation (CIL/CIP, %) — essais/critères. */
  leachRecoveryPct?: Candidate[];
  goldPriceUsd?: Candidate[];
  availabilityPct?: Candidate[];
  /** Décompte d'essais par famille — copié tel quel (pilote la couverture données). */
  sampleCounts?: RouteSampleCounts;
}

// ─── Bundle résolu ────────────────────────────────────────────────────────────

export interface ProjectDataBundle {
  throughputTph: Sourced<number> | null;
  goldGrade: Sourced<number> | null;
  silverGrade: Sourced<number> | null;
  grgPct: Sourced<number> | null;
  sulphidePct: Sourced<number> | null;
  corgPct: Sourced<number> | null;
  bwiKwhT: Sourced<number> | null;
  labP80Um: Sourced<number> | null;
  plantP80Um: Sourced<number> | null;
  regrindP80Um: Sourced<number> | null;
  targetRecoveryPct: Sourced<number> | null;
  flotationAuRecoveryPct: Sourced<number> | null;
  leachRecoveryPct: Sourced<number> | null;
  goldPriceUsd: Sourced<number> | null;
  availabilityPct: Sourced<number> | null;
  sampleCounts: RouteSampleCounts;
  /** Couleur de qualité GLOBALE du bundle (agrégée sur les champs présents). */
  quality: QualityLevel;
  /** Champs obligatoires manquants — bloque une simulation « fermée » (§7). */
  missingRequired: string[];
}

const EMPTY_COUNTS: RouteSampleCounts = {
  chem: 0, comminution: 0, knelson: 0, flotation: 0, leaching: 0, mineralogy: 0,
};

/** Champs sans lesquels une simulation ne peut pas être fermée. */
export const REQUIRED_FIELDS = ['throughputTph', 'goldGrade'] as const;

/**
 * Résout tous les champs via la hiérarchie de priorité et produit le bundle
 * tracé. Ne lit aucune base : tout arrive par `inputs`.
 */
export function buildProjectDataBundle(inputs: ConnectorInputs): ProjectDataBundle {
  const r = (c?: Candidate[]) => (c ? resolveSourced<number>(c) : null);

  const bundle = {
    throughputTph: r(inputs.throughputTph),
    goldGrade: r(inputs.goldGrade),
    silverGrade: r(inputs.silverGrade),
    grgPct: r(inputs.grgPct),
    sulphidePct: r(inputs.sulphidePct),
    corgPct: r(inputs.corgPct),
    bwiKwhT: r(inputs.bwiKwhT),
    labP80Um: r(inputs.labP80Um),
    plantP80Um: r(inputs.plantP80Um),
    regrindP80Um: r(inputs.regrindP80Um),
    targetRecoveryPct: r(inputs.targetRecoveryPct),
    flotationAuRecoveryPct: r(inputs.flotationAuRecoveryPct),
    leachRecoveryPct: r(inputs.leachRecoveryPct),
    goldPriceUsd: r(inputs.goldPriceUsd),
    availabilityPct: r(inputs.availabilityPct),
    sampleCounts: inputs.sampleCounts ?? EMPTY_COUNTS,
  };

  const presentTiers: SourceTier[] = Object.values(bundle)
    .filter((v): v is Sourced<number> => v != null && typeof v === 'object' && 'tier' in v)
    .map(v => v.tier);

  const missingRequired = REQUIRED_FIELDS.filter(f => bundle[f] == null);

  return {
    ...bundle,
    quality: qualityFromTiers(presentTiers),
    missingRequired,
  };
}

// ─── Adaptateurs vers les consommateurs ───────────────────────────────────────

/** Extrait la valeur d'un champ tracé, ou `fallback` s'il est absent. */
function val(s: Sourced<number> | null, fallback: number | null = null): number | null {
  return s ? s.value : fallback;
}

/**
 * Adapte le bundle en `GeneratorFeed` pour le générateur. Les champs absents
 * restent `null` — le générateur les traite alors comme des hypothèses (par
 * conception), pas comme des zéros trompeurs.
 */
export function toGeneratorFeed(bundle: ProjectDataBundle): GeneratorFeed {
  return {
    goldGrade: val(bundle.goldGrade, 0) ?? 0,
    grgPct: val(bundle.grgPct),
    sulphidePct: val(bundle.sulphidePct),
    corgPct: val(bundle.corgPct),
    bwiKwhT: val(bundle.bwiKwhT),
    labP80Um: val(bundle.labP80Um),
    plantP80Um: val(bundle.plantP80Um),
    regrindP80Um: val(bundle.regrindP80Um),
  };
}

/**
 * Adapte le bundle en `FeedInput` pour le moteur de simulation. `oreType` est
 * décidé en amont (caractérisation), `defaults` fournit les valeurs de repli
 * pour les champs que le projet ne renseigne pas encore — ces replis DOIVENT
 * être marqués comme hypothèses dans l'UI, jamais présentés comme mesurés.
 */
export function toFeedInput(
  bundle: ProjectDataBundle,
  oreType: OreType,
  defaults: Pick<FeedInput, 'silver_grade' | 'p80' | 'hardness_bwi' | 'sulphide_content' | 'carbon_content' | 'moisture'>,
): FeedInput {
  return {
    feed_rate: val(bundle.throughputTph, 0) ?? 0,
    gold_grade: val(bundle.goldGrade, 0) ?? 0,
    silver_grade: val(bundle.silverGrade, defaults.silver_grade) ?? defaults.silver_grade,
    p80: val(bundle.labP80Um, defaults.p80) ?? defaults.p80,
    hardness_bwi: val(bundle.bwiKwhT, defaults.hardness_bwi) ?? defaults.hardness_bwi,
    ore_type: oreType,
    sulphide_content: val(bundle.sulphidePct, defaults.sulphide_content) ?? defaults.sulphide_content,
    carbon_content: val(bundle.corgPct, defaults.carbon_content) ?? defaults.carbon_content,
    moisture: defaults.moisture,
  };
}

/**
 * Paramètres unitaires SOURCÉS depuis les données projet (§3) : associe à un
 * `unit_type` les paramètres à surcharger quand la donnée est présente. C'est le
 * mécanisme « zéro valeur en dur » — la récupération d'une unité vient des essais
 * (GRG, flottation, lixiviation) plutôt que d'un défaut, quand ils existent.
 */
export function sourcedUnitParameters(bundle: ProjectDataBundle): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  if (bundle.grgPct) out['gravity_concentrator'] = { grg_recovery: bundle.grgPct.value };
  if (bundle.flotationAuRecoveryPct) out['flotation_rougher'] = { au_recovery_pct: bundle.flotationAuRecoveryPct.value };
  // leachRecoveryPct est porté par le bundle (traçable) ; son injection dans le
  // modèle CIL/CIP (cinétique) attend un paramètre de récupération mesurée dédié
  // — ajouté avec les modèles par classe (Phase 2).
  return out;
}

/**
 * Applique les paramètres sourcés (§3) à une liste de nœuds, de façon IMMUTABLE.
 * Priorité : la donnée projet surcharge le défaut du modèle porté par le nœud.
 * Ne touche que les `unit_type` et paramètres pour lesquels une donnée existe —
 * les autres restent inchangés.
 */
export function applySourcedParameters(nodes: ProcessNode[], bundle: ProjectDataBundle): ProcessNode[] {
  const overrides = sourcedUnitParameters(bundle);
  return nodes.map(n => {
    const ov = overrides[n.unit_type];
    if (!ov) return n;
    return { ...n, parameters: { ...n.parameters, ...ov } };
  });
}

/**
 * Sérialise le bundle en snapshot immuable (§8) : chaque champ avec sa valeur,
 * son niveau de source et sa provenance — pour reproduire un résultat des mois
 * plus tard même si les données du projet ont évolué.
 */
export function snapshotBundle(bundle: ProjectDataBundle): Record<string, { value: number; tier: SourceTier; provenance?: string; note?: string } | null> {
  const out: Record<string, { value: number; tier: SourceTier; provenance?: string; note?: string } | null> = {};
  for (const [k, v] of Object.entries(bundle)) {
    if (v != null && typeof v === 'object' && 'tier' in v) {
      const s = v as Sourced<number>;
      out[k] = { value: s.value, tier: s.tier, provenance: s.provenance, note: s.note };
    }
  }
  return out;
}
