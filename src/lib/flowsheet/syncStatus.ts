// ─────────────────────────────────────────────────────────────────────────────
// PÉREMPTION DES MODULES AVAL — module PUR.
//
// ── Le problème ─────────────────────────────────────────────────────────────
// Les critères de conception alimentent une chaîne :
//
//     Assistant guidé → dc_draft → Flowsheet → project_flowsheets
//                                                  ├→ Bilan massique & eau
//                                                  └→ Équipements
//
// Mais RIEN ne propage : chaque module a son propre bouton « Générer », à
// actionner dans le bon ordre. Cocher le rebroyage dans l'assistant ne fait donc
// rien apparaître en aval, sans qu'aucun écran ne le signale — l'utilisateur
// croit son circuit à jour alors qu'il regarde un état ancien.
//
// ── Pourquoi ne PAS régénérer automatiquement ───────────────────────────────
// Les générateurs sont DESTRUCTIFS : celui des équipements supprime toutes les
// lignes du projet avant de réinsérer, celui du bilan massique efface flux et
// postes carbone. Les déclencher à chaque modification des critères effacerait
// sans prévenir les capacités, puissances et commentaires saisis à la main.
//
// On DÉTECTE donc la péremption et on la signale, en laissant la régénération
// explicite. C'est la même discipline que la réconciliation métallurgique :
// signaler l'écart, laisser l'ingénieur décider.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Modules qui dérivent des critères de conception, dans l'ordre de la chaîne. */
export type DownstreamModule = 'flowsheet' | 'massbalance' | 'equipment';

export const DOWNSTREAM_LABELS: Record<DownstreamModule, string> = {
  flowsheet: 'Flowsheet Ingénierie',
  massbalance: 'Bilan massique & eau',
  equipment: 'Équipements',
};

/**
 * De quoi chaque module dépend. Le flowsheet dérive des critères ; le bilan et
 * les équipements dérivent du FLOWSHEET, pas des critères directement — d'où une
 * chaîne, et non trois dépendances parallèles.
 */
export const DOWNSTREAM_SOURCE: Record<DownstreamModule, 'criteria' | 'flowsheet'> = {
  flowsheet: 'criteria',
  massbalance: 'flowsheet',
  equipment: 'flowsheet',
};

/** Horodatages des artefacts de la chaîne (ISO, `null` si jamais généré). */
export interface ChainTimestamps {
  /** Dernière écriture des critères de conception (`dc_draft.updated_at`). */
  criteriaAt: string | null;
  /** Dernière génération du flowsheet. */
  flowsheetAt: string | null;
  /** Dernière génération du bilan massique. */
  massBalanceAt: string | null;
  /** Dernière génération des équipements. */
  equipmentAt: string | null;
}

export type SyncState =
  /** Jamais généré — le module est vide. */
  | 'missing'
  /** Généré AVANT sa source : il reflète un état ancien. */
  | 'stale'
  /** À jour. */
  | 'current';

export interface ModuleSyncStatus {
  module: DownstreamModule;
  label: string;
  state: SyncState;
  /** Ce dont le module dérive, déjà libellé. */
  sourceLabel: string;
  /** Message prêt à afficher, explicitant l'action attendue. */
  message: string;
  /** Retard en minutes sur la source (0 si à jour ou jamais généré). */
  behindMinutes: number;
}

/** Tolérance : une génération déclenchée juste après une saisie reste « à jour ». */
export const SYNC_TOLERANCE_MS = 2000;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * État de synchronisation d'un module par rapport à sa source.
 *
 * Un module généré AVANT sa source est périmé. Sans source horodatée on ne peut
 * rien affirmer : le module est alors dit « à jour » plutôt que d'inventer une
 * alerte — un faux positif entraînerait des régénérations destructives inutiles.
 */
export function moduleSyncStatus(
  module: DownstreamModule,
  ts: ChainTimestamps,
): ModuleSyncStatus {
  const label = DOWNSTREAM_LABELS[module];
  const sourceIsCriteria = DOWNSTREAM_SOURCE[module] === 'criteria';
  const sourceLabel = sourceIsCriteria ? 'Critères de conception' : DOWNSTREAM_LABELS.flowsheet;
  const sourceAt = ms(sourceIsCriteria ? ts.criteriaAt : ts.flowsheetAt);
  const ownAt = ms(
    module === 'flowsheet' ? ts.flowsheetAt
      : module === 'massbalance' ? ts.massBalanceAt
      : ts.equipmentAt,
  );

  if (ownAt === null) {
    return {
      module, label, state: 'missing', sourceLabel, behindMinutes: 0,
      message: sourceAt === null
        ? `${label} n'a jamais été généré.`
        : `${label} n'a jamais été généré depuis ${sourceLabel}.`,
    };
  }
  if (sourceAt === null) {
    return { module, label, state: 'current', sourceLabel, behindMinutes: 0, message: `${label} est à jour.` };
  }
  const behind = sourceAt - ownAt;
  if (behind > SYNC_TOLERANCE_MS) {
    return {
      module, label, state: 'stale', sourceLabel,
      behindMinutes: Math.max(1, Math.round(behind / 60000)),
      message: `${sourceLabel} a été modifié après la dernière génération de ${label} — ce module reflète un état ancien.`,
    };
  }
  return { module, label, state: 'current', sourceLabel, behindMinutes: 0, message: `${label} est à jour.` };
}

export interface ChainSyncReport {
  statuses: ModuleSyncStatus[];
  /** Modules à régénérer, DANS L'ORDRE de la chaîne. */
  outOfDate: ModuleSyncStatus[];
  /** Vrai si toute la chaîne reflète les critères actuels. */
  allCurrent: boolean;
}

/**
 * État de toute la chaîne aval.
 *
 * L'ordre du rapport est celui de la chaîne : régénérer le bilan massique avant
 * le flowsheet reproduirait l'ancien circuit. C'est précisément ce que
 * l'utilisateur ne peut pas deviner en voyant trois boutons indépendants.
 */
export function chainSyncReport(ts: ChainTimestamps): ChainSyncReport {
  const order: DownstreamModule[] = ['flowsheet', 'massbalance', 'equipment'];
  const statuses = order.map(m => moduleSyncStatus(m, ts));
  const outOfDate = statuses.filter(s => s.state !== 'current');
  return { statuses, outOfDate, allCurrent: outOfDate.length === 0 };
}
