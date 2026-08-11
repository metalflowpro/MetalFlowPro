// ─────────────────────────────────────────────────────────────────────────────
// Constantes métallurgiques SURCHARGEABLES par projet.
//
// Chaque gisement répond différemment aux réactifs : l'application centralise ses
// constantes (voir constants.ts) mais un métallurgiste doit pouvoir les caler sur
// les essais du site SANS toucher au code. Ce module fournit :
//   • le TYPE + les MÉTADONNÉES d'édition (libellé, unité, bornes) — l'éditeur est
//     data-driven et validé depuis ici ;
//   • `resolveMetConstants(overrides)` = défauts ⊕ surcharges de projet.
//
// Slice 1 : « efficacités d'étapes de route » (consommées par estimateRoutes). Le
// cadre est générique — ajouter un groupe = étendre GROUPS + le type + le résolveur.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

import { ROUTE_STAGE_EFFICIENCIES, type RouteStageEfficiencies } from '../analytics/routeEstimation';
import { ADSORPTION_DECISION_THRESHOLDS, type AdsorptionDecisionThresholds } from '../analytics/adsorptionCircuit';
import { CYANIDE_MODEL, type CyanideModel } from '../analytics/cyanideConsumer';

// Ré-export : les consommateurs importent les types depuis ce module de config.
export type { RouteStageEfficiencies, AdsorptionDecisionThresholds, CyanideModel };

/** Surcharges de projet — partielles : seuls les champs modifiés sont stockés. */
export interface MetConstantsOverrides {
  routeStageEfficiencies?: Partial<RouteStageEfficiencies>;
  adsorptionDecision?: Partial<AdsorptionDecisionThresholds>;
  cyanideModel?: Partial<CyanideModel>;
}

/** Constantes effectives, une fois les surcharges appliquées sur les défauts. */
export interface MetConstants {
  routeStageEfficiencies: RouteStageEfficiencies;
  adsorptionDecision: AdsorptionDecisionThresholds;
  cyanideModel: CyanideModel;
}

// ── Métadonnées d'édition (pilotent l'UI et la validation) ──────────────────
export interface MetFieldMeta {
  /** Nom du champ dans son groupe (clé de l'objet de surcharge). */
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface MetGroupMeta {
  id: keyof MetConstantsOverrides;
  label: string;
  description: string;
  fields: MetFieldMeta[];
}

/** Valeurs par défaut par groupe — source unique pour la résolution et le bornage. */
const GROUP_DEFAULTS: Record<keyof MetConstantsOverrides, Record<string, number>> = {
  routeStageEfficiencies: ROUTE_STAGE_EFFICIENCIES,
  adsorptionDecision: ADSORPTION_DECISION_THRESHOLDS,
  cyanideModel: CYANIDE_MODEL,
};

const D = ROUTE_STAGE_EFFICIENCIES;
const A = ADSORPTION_DECISION_THRESHOLDS;
const C = CYANIDE_MODEL;

export const MET_CONSTANT_GROUPS: MetGroupMeta[] = [
  {
    id: 'routeStageEfficiencies',
    label: 'Efficacités d\'étapes de route',
    description: 'Rendements et facteurs utilisés par l\'estimation des routes métallurgiques (module Analyse et Interprétation). À caler sur les essais du site.',
    fields: [
      { key: 'flotationAu',                 label: 'Récup. Au flottation',              unit: 'fraction', min: 0, max: 1,   step: 0.01, default: D.flotationAu },
      { key: 'flotationSulphides',          label: 'Récup. sulfures flottation',        unit: 'fraction', min: 0, max: 1,   step: 0.01, default: D.flotationSulphides },
      { key: 'flotationDefaultRecoveryPct', label: 'Récup. flottation par défaut',      unit: '%',        min: 0, max: 100, step: 1,    default: D.flotationDefaultRecoveryPct },
      { key: 'regrindLeachBonusPts',        label: 'Bonus lixiviation après rebroyage', unit: 'pts',      min: 0, max: 30,  step: 1,    default: D.regrindLeachBonusPts },
      { key: 'regrindLeachMax',             label: 'Plafond lixiviation concentré',     unit: 'fraction', min: 0, max: 1,   step: 0.01, default: D.regrindLeachMax },
      { key: 'tailsLeachPenaltyPts',        label: 'Pénalité lixiviation des rejets',   unit: 'pts',      min: 0, max: 50,  step: 1,    default: D.tailsLeachPenaltyPts },
      { key: 'tailsLeachEfficiency',        label: 'Efficacité lixiviation des rejets', unit: 'fraction', min: 0, max: 1,   step: 0.01, default: D.tailsLeachEfficiency },
      { key: 'oxidationLiberation',         label: 'Libération par oxydation (POX/grillage)', unit: 'fraction', min: 0, max: 1, step: 0.01, default: D.oxidationLiberation },
      { key: 'postOxidationLeachBonusPts',  label: 'Bonus lixiviation post-oxydation',  unit: 'pts',      min: 0, max: 30,  step: 1,    default: D.postOxidationLeachBonusPts },
      { key: 'postOxidationLeachMax',       label: 'Plafond lixiviation post-oxydation',unit: 'fraction', min: 0, max: 1,   step: 0.01, default: D.postOxidationLeachMax },
      { key: 'directLeachMaxPct',           label: 'Plafond cyanuration directe',       unit: '%',        min: 0, max: 100, step: 1,    default: D.directLeachMaxPct },
      { key: 'flotationRouteMaxPct',        label: 'Plafond route flottation',          unit: '%',        min: 0, max: 100, step: 1,    default: D.flotationRouteMaxPct },
      { key: 'gravityHighConfidenceGrgPct', label: 'GRG seuil haute confiance',         unit: '%',        min: 0, max: 100, step: 1,    default: D.gravityHighConfidenceGrgPct },
      { key: 'refractorySulphidesPct',      label: 'Sulfures seuil réfractaire',        unit: '%',        min: 0, max: 20,  step: 0.1,  default: D.refractorySulphidesPct },
      { key: 'directLeachHighConfidencePct',label: 'Cyanuration seuil haute confiance', unit: '%',        min: 0, max: 100, step: 1,    default: D.directLeachHighConfidencePct },
      { key: 'directLeachLowConfidencePct', label: 'Cyanuration seuil basse confiance', unit: '%',        min: 0, max: 100, step: 1,    default: D.directLeachLowConfidencePct },
    ],
  },
  {
    id: 'adsorptionDecision',
    label: 'Décision CIL vs CIP',
    description: 'Seuils d\'exploitation qui départagent CIL et CIP (module Analyse et Interprétation / MetaScore). À revoir par le métallurgiste selon le minerai.',
    fields: [
      { key: 'organicCarbonPct', label: 'Carbone organique — seuil preg-robbing', unit: '%',    min: 0, max: 5,  step: 0.05, default: A.organicCarbonPct },
      { key: 'nacnKgT',          label: 'NaCN — seuil consommation élevée',       unit: 'kg/t', min: 0, max: 10, step: 0.1,  default: A.nacnKgT },
      { key: 'auFeedGt',         label: 'Teneur de tête — seuil inventaire d\'or', unit: 'g/t',  min: 0, max: 30, step: 0.5,  default: A.auFeedGt },
      { key: 'sulphidePct',      label: 'Sulfures — seuil encrassement charbon',  unit: '%',    min: 0, max: 20, step: 0.1,  default: A.sulphidePct },
    ],
  },
  {
    id: 'cyanideModel',
    label: 'Modèle de consommation de cyanure',
    description: 'Paramètres stœchiométriques de la consommation de NaCN (module Prédiction — cinétique & cyanure). À caler sur les essais de consommation du site.',
    fields: [
      { key: 'KG_NACN_PER_KG_CU',        label: 'NaCN par Cu soluble',         unit: 'kg/kg', min: 0, max: 10, step: 0.05, default: C.KG_NACN_PER_KG_CU },
      { key: 'BASE_KG_T',                label: 'Consommation de base',         unit: 'kg/t',  min: 0, max: 5,  step: 0.05, default: C.BASE_KG_T },
      { key: 'KG_NACN_PER_PCT_S',        label: 'NaCN par % S sulfure',         unit: 'kg/t/%',min: 0, max: 5,  step: 0.01, default: C.KG_NACN_PER_PCT_S },
      { key: 'DEFAULT_CU_SOLUBLE_FRACTION', label: 'Fraction Cu soluble par défaut', unit: 'fraction', min: 0, max: 1, step: 0.01, default: C.DEFAULT_CU_SOLUBLE_FRACTION },
    ],
  },
];

/** Table {groupe → {clé → métadonnée}} pour le bornage, générée depuis les groupes. */
const FIELD_META = new Map(
  MET_CONSTANT_GROUPS.map(g => [g.id, new Map(g.fields.map(f => [f.key, f]))]),
);

/**
 * Nettoie des surcharges brutes (venant du stockage ou de l'UI) : pour CHAQUE
 * groupe connu, ne garde que les champs connus, finis et dans les bornes. Une
 * valeur invalide est ignorée (retour au défaut) plutôt que de corrompre un calcul.
 */
export function sanitizeOverrides(raw: unknown): MetConstantsOverrides {
  const out: MetConstantsOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const group of MET_CONSTANT_GROUPS) {
    const src = (raw as Record<string, unknown>)[group.id];
    if (!src || typeof src !== 'object') continue;
    const metaByKey = FIELD_META.get(group.id)!;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      const meta = metaByKey.get(k);
      if (meta && typeof v === 'number' && Number.isFinite(v) && v >= meta.min && v <= meta.max) clean[k] = v;
    }
    if (Object.keys(clean).length) (out as Record<string, unknown>)[group.id] = clean;
  }
  return out;
}

/** Constantes effectives = défauts ⊕ surcharges (nettoyées), groupe par groupe. */
export function resolveMetConstants(overrides?: MetConstantsOverrides | null): MetConstants {
  const ov = sanitizeOverrides(overrides);
  return {
    routeStageEfficiencies: { ...GROUP_DEFAULTS.routeStageEfficiencies, ...(ov.routeStageEfficiencies ?? {}) } as RouteStageEfficiencies,
    adsorptionDecision:     { ...GROUP_DEFAULTS.adsorptionDecision,     ...(ov.adsorptionDecision ?? {}) } as AdsorptionDecisionThresholds,
    cyanideModel:           { ...GROUP_DEFAULTS.cyanideModel,           ...(ov.cyanideModel ?? {}) } as CyanideModel,
  };
}
