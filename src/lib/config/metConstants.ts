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

// Ré-export : les consommateurs importent le type depuis ce module de config.
export type { RouteStageEfficiencies };

/** Surcharges de projet — partielles : seuls les champs modifiés sont stockés. */
export interface MetConstantsOverrides {
  routeStageEfficiencies?: Partial<RouteStageEfficiencies>;
}

/** Constantes effectives, une fois les surcharges appliquées sur les défauts. */
export interface MetConstants {
  routeStageEfficiencies: RouteStageEfficiencies;
}

// ── Métadonnées d'édition (pilotent l'UI et la validation) ──────────────────
export interface MetFieldMeta {
  key: keyof RouteStageEfficiencies;
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

const D = ROUTE_STAGE_EFFICIENCIES;

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
];

/** Table {clé → métadonnée} du groupe route, pour le bornage. */
const ROUTE_FIELD_META = new Map(MET_CONSTANT_GROUPS[0].fields.map(f => [f.key, f]));

/**
 * Nettoie des surcharges brutes (venant du stockage ou de l'UI) : ne garde que
 * les champs connus, finis et dans les bornes. Une valeur invalide est ignorée
 * (retour au défaut) plutôt que de corrompre un calcul.
 */
export function sanitizeOverrides(raw: unknown): MetConstantsOverrides {
  const out: MetConstantsOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  const rse = (raw as MetConstantsOverrides).routeStageEfficiencies;
  if (rse && typeof rse === 'object') {
    const clean: Partial<RouteStageEfficiencies> = {};
    for (const [k, v] of Object.entries(rse)) {
      const meta = ROUTE_FIELD_META.get(k as keyof RouteStageEfficiencies);
      if (meta && typeof v === 'number' && Number.isFinite(v) && v >= meta.min && v <= meta.max) {
        clean[k as keyof RouteStageEfficiencies] = v;
      }
    }
    if (Object.keys(clean).length) out.routeStageEfficiencies = clean;
  }
  return out;
}

/** Constantes effectives = défauts ⊕ surcharges (nettoyées). */
export function resolveMetConstants(overrides?: MetConstantsOverrides | null): MetConstants {
  const ov = sanitizeOverrides(overrides);
  return {
    routeStageEfficiencies: { ...ROUTE_STAGE_EFFICIENCIES, ...(ov.routeStageEfficiencies ?? {}) },
  };
}
