// ─────────────────────────────────────────────────────────────────────────────
// Alias de lignes issus des types GÉNÉRÉS (database.types.ts).
//
// Le client Supabase n'est pas typé globalement (le typer casserait ~90 casts
// existants — chantier séparé). On expose ici les lignes des tables SENSIBLES
// (validation des comptes) pour que le code admin/approbation soit vérifié
// contre le schéma RÉEL de la base, et reste en phase si la table évolue.
// ─────────────────────────────────────────────────────────────────────────────

import type { Database } from '../database.types';

export type AppUserRow = Database['public']['Tables']['app_users']['Row'];
export type ProjectMetConstantsRow = Database['public']['Tables']['project_met_constants']['Row'];

/** Statut d'approbation — la contrainte CHECK de la base, exprimée en union TS. */
export type AppUserStatus = 'pending' | 'approved' | 'rejected';
