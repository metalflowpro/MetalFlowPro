// ─────────────────────────────────────────────────────────────────────────────
// Coûts miniers — passage au modèle économique (capex_lines / opex_lines).
//
// Le modèle économique de l'app raisonne en régime établi :
//   • capex_lines  = CAPEX INITIAL, en M$, avec une contingence par ligne ;
//   • opex_lines   = OPEX en $ par tonne ALIMENTÉE à l'usine ;
//   • project_settings.sustaining_capex_musd_yr = capital de maintien annuel.
//
// On y injecte donc : le capital initial du module minier ligne par ligne
// (sans sa contingence — appliquée par le modèle via contingency_pct, pour ne
// pas la compter deux fois), l'OPEX minier moyen de la période de production
// rapporté à la tonne de minerai traitée (minerai miné = alimentation usine),
// et le capital de maintien minier moyen par année de production.
//
// Module pur — aucune dépendance Supabase / React.
// ─────────────────────────────────────────────────────────────────────────────

import type { MineCostResult } from './types';

/** Marqueur des lignes générées : permet de les remplacer sans toucher aux lignes manuelles. */
export const MINING_AUTO_NOTE = 'Généré — Module coûts miniers';
/** Catégorie CAPEX de l'Économie qui porte les travaux miniers. */
export const MINING_CAPEX_CATEGORY = 'Travaux miniers';
/** Catégorie OPEX de l'Économie qui porte les coûts miniers. */
export const MINING_OPEX_CATEGORY = 'Mine';

export interface CapexLinePayload {
  category: string;
  sub_category: string | null;
  description: string;
  value_musd: number;
  contingency_pct: number;
  source: string;
  notes: string;
}

export interface OpexLinePayload {
  category: string;
  description: string;
  value_usd_t: number;
  source: string;
  notes: string;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Lignes CAPEX initial (hors contingence, portée par contingency_pct). */
export function miningCapexLines(result: MineCostResult, contingencyPct: number): CapexLinePayload[] {
  return result.capex
    .filter(c => c.category !== 'Contingence' && c.initialUsd > 0)
    .map(c => ({
      category: MINING_CAPEX_CATEGORY,
      sub_category: c.category,
      description: `Mine — ${c.label}`,
      value_musd: round(c.initialUsd / 1e6, 3),
      contingency_pct: round(contingencyPct, 2),
      // 'factored' : seule valeur d'estimation automatique admise par
      // capex_lines_source_check (estimate|quote|vendor|budget|factored).
      source: 'factored',
      notes: MINING_AUTO_NOTE,
    }));
}

/** Lignes OPEX par centre de coût, en $/t de minerai alimenté (moyenne de production). */
export function miningOpexLines(result: MineCostResult): OpexLinePayload[] {
  const oreT = result.totals.productionOreTonnes;
  if (oreT <= 0) return [];
  return result.opex
    .filter(o => o.productionUsd > 0)
    .map(o => ({
      category: MINING_OPEX_CATEGORY,
      description: `Mine — ${o.label}`,
      value_usd_t: round(o.productionUsd / oreT, 3),
      source: 'estimate',
      notes: MINING_AUTO_NOTE,
    }));
}

/** Capital de maintien minier moyen (M$/an de production). */
export function miningSustainingMusdPerYear(result: MineCostResult): number {
  return round(result.totals.sustainingUsdPerYear / 1e6, 3);
}

/**
 * Nouveau capital de maintien du projet quand on (ré)applique la part minière :
 * on retire la part minière appliquée précédemment (mémorisée) avant d'ajouter
 * la nouvelle, pour que la part usine saisie ailleurs soit préservée et qu'une
 * ré-application ne cumule pas.
 */
export function mergedSustaining(current: number | null, previouslyApplied: number | null, mining: number): number {
  const base = Math.max(0, (current ?? 0) - (previouslyApplied ?? 0));
  return round(base + mining, 3);
}
