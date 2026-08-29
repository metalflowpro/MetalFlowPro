// ─────────────────────────────────────────────────────────────────────────────
// Plant Optimizer — Import AUTOMATIQUE depuis les autres modules du projet
//
// Plutôt que ressaisir les données, on va les chercher là où elles vivent déjà
// dans MetalFlow Pro :
//   • Récupération métallurgique : essais LIMS/Analytics (récupération effective
//     dérivée des essais, via ProjectContext) → aire de lixiviation.
//   • Horizon : heures/an résolues du projet (Paramètres) → horizon de simulation.
//   • OPEX par aire : lignes OPEX du module Économie ($/t par poste) → OPEX d'aire
//     par rapprochement de nom.
//   • Capacités : capacités des équipements (module Équipements) → capacité d'aire
//     par rapprochement de catégorie/nom.
//
// Fonctions PURES (aucun accès réseau ici) : la page assemble le « bundle » depuis
// useProject()/Supabase et passe les données. Le rapprochement se fait par nom
// normalisé et n'écrase que ce qui correspond — le reste du modèle est intact.
// ─────────────────────────────────────────────────────────────────────────────

import type { Area, PlantModel } from './types';

/** Ligne OPEX telle qu'exposée par le module Économie (ProjectContext.opexLines). */
export interface OpexLineLite {
  category: string;
  description: string;
  value_usd_t: number;
}

/** Équipement tel qu'exposé par le module Équipements (equipment_items). */
export interface EquipmentLite {
  name: string;
  category: string;
  sub_category?: string;
  capacity?: number | null;
  capacity_unit?: string | null;
  status?: string;
}

/** Données agrégées des autres modules, assemblées par la page. */
export interface ProjectDataBundle {
  /** Récupération globale dérivée des essais (%), ou null si pas d'essai. */
  effectiveRecoveryPct: number | null;
  /** Origine de la récupération (route active), pour l'affichage. */
  recoveryLabel?: string | null;
  /** Heures/an résolues (Paramètres projet). */
  hoursPerYear: number;
  /** Lignes OPEX du module Économie. */
  opexLines: OpexLineLite[];
  /** Équipements du projet. */
  equipment: EquipmentLite[];
}

/** Sources d'import activables. */
export type ImportSource = 'recovery' | 'horizon' | 'opex' | 'capacity';

export interface ImportSelection {
  recovery: boolean;
  horizon: boolean;
  opex: boolean;
  capacity: boolean;
}

export interface ImportOutcome {
  model: PlantModel;
  /** Messages récapitulatifs par source (ce qui a été appliqué). */
  messages: string[];
  /** Sources sans donnée exploitable (rien appliqué). */
  empty: ImportSource[];
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
/** Deux libellés se correspondent si l'un contient l'autre (après normalisation). */
function matches(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}
function central(params: Record<string, number | number[]>): number {
  const v = params.mode ?? params.mean ?? params.value ?? params.max ?? 0;
  return typeof v === 'number' ? v : 0;
}

/**
 * Aire porteuse de récupération. On privilégie l'aire qui PORTE DÉJÀ une
 * récupération (l'ancre métallurgique voulue par le modèle), puis l'unité de
 * lixiviation par son nom — en excluant la détox, qui est typée « leaching »
 * mais ne récupère pas de métal.
 */
function recoveryAnchor(model: PlantModel): Area | undefined {
  const sorted = [...model.areas].sort((a, b) => a.processOrder - b.processOrder);
  const isDetox = (a: Area) => matches(a.name, 'detox') || matches(a.name, 'cyanure');
  const withRec = [...sorted].reverse().find(a => a.baseRecovery !== undefined && !isDetox(a));
  if (withRec) return withRec;
  const leach = [...sorted].reverse().find(a =>
    !isDetox(a) && (matches(a.name, 'lixiviation') || matches(a.name, 'cil') || matches(a.name, 'cip') || norm(a.type ?? '').includes('leach')));
  return leach ?? sorted[sorted.length - 1];
}

/**
 * Applique le bundle au modèle selon la sélection de sources. Fonction pure :
 * renvoie un nouveau modèle + un récapitulatif.
 */
export function importFromModules(model: PlantModel, bundle: ProjectDataBundle, selection: ImportSelection): ImportOutcome {
  let out = model;
  const messages: string[] = [];
  const empty: ImportSource[] = [];

  // ── Récupération (essais) → aire porteuse ──────────────────────────────────
  if (selection.recovery) {
    if (bundle.effectiveRecoveryPct != null && bundle.effectiveRecoveryPct > 0) {
      const anchor = recoveryAnchor(out);
      if (anchor) {
        const frac = Math.min(1, bundle.effectiveRecoveryPct / 100);
        out = { ...out, areas: out.areas.map(a => (a.id === anchor.id ? { ...a, baseRecovery: frac } : a)) };
        const src = bundle.recoveryLabel ? ` (${bundle.recoveryLabel})` : '';
        messages.push(`Récupération ${bundle.effectiveRecoveryPct.toFixed(1)} %${src} → ${anchor.name}`);
      }
    } else {
      empty.push('recovery');
    }
  }

  // ── Horizon (heures/an résolues) ───────────────────────────────────────────
  if (selection.horizon) {
    if (bundle.hoursPerYear > 0) {
      out = { ...out, horizonHours: bundle.hoursPerYear };
      messages.push(`Horizon → ${Math.round(bundle.hoursPerYear)} h/an (Paramètres projet)`);
    } else {
      empty.push('horizon');
    }
  }

  // ── OPEX par aire (module Économie) ────────────────────────────────────────
  if (selection.opex) {
    const lines = bundle.opexLines.filter(l => l.value_usd_t > 0);
    if (lines.length === 0) {
      empty.push('opex');
    } else {
      const applied: string[] = [];
      out = {
        ...out,
        areas: out.areas.map(a => {
          const line = lines.find(l => matches(a.name, l.description) || matches(a.name, l.category) || matches(a.type ?? '', l.category));
          if (!line) return a;
          applied.push(a.name);
          return { ...a, opexPerTonne: line.value_usd_t };
        }),
      };
      if (applied.length) messages.push(`OPEX appliqué à ${applied.length} aire(s) : ${applied.join(', ')}`);
      else empty.push('opex');
    }
  }

  // ── Capacités (module Équipements) ─────────────────────────────────────────
  if (selection.capacity) {
    const withCap = bundle.equipment.filter(e => typeof e.capacity === 'number' && (e.capacity ?? 0) > 0);
    if (withCap.length === 0) {
      empty.push('capacity');
    } else {
      const applied: string[] = [];
      out = {
        ...out,
        areas: out.areas.map(a => {
          // Somme des capacités des équipements dont la catégorie/nom correspond à l'aire.
          const relevant = withCap.filter(e => matches(a.name, e.category) || matches(a.name, e.name) || matches(a.type ?? '', e.category) || (e.sub_category ? matches(a.name, e.sub_category) : false));
          if (relevant.length === 0) return a;
          const total = relevant.reduce((s, e) => s + (e.capacity ?? 0), 0);
          if (total <= 0) return a;
          // Conserve la forme relative de la loi triangulaire autour du nouveau mode.
          const oldMode = central(a.capacityDist.params) || total;
          const ratio = oldMode > 0 ? total / oldMode : 1;
          const p = a.capacityDist.params;
          const scaleParam = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) * ratio : undefined);
          const params: Record<string, number | number[]> =
            a.capacityDist.kind === 'triangular' || a.capacityDist.kind === 'pert'
              ? { min: scaleParam('min') ?? total * 0.9, mode: total, max: scaleParam('max') ?? total * 1.1 }
              : { ...p, mode: total };
          applied.push(a.name);
          return { ...a, capacityDist: { kind: a.capacityDist.kind === 'pert' ? 'pert' : 'triangular', params } };
        }),
      };
      if (applied.length) messages.push(`Capacités depuis Équipements → ${applied.length} aire(s) : ${applied.join(', ')}`);
      else empty.push('capacity');
    }
  }

  return { model: out, messages, empty };
}

/** Vrai si au moins une source du bundle contient des données exploitables. */
export function bundleHasData(bundle: ProjectDataBundle): Record<ImportSource, boolean> {
  return {
    recovery: bundle.effectiveRecoveryPct != null && bundle.effectiveRecoveryPct > 0,
    horizon: bundle.hoursPerYear > 0,
    opex: bundle.opexLines.some(l => l.value_usd_t > 0),
    capacity: bundle.equipment.some(e => typeof e.capacity === 'number' && (e.capacity ?? 0) > 0),
  };
}
