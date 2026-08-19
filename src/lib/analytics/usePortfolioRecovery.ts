// ─────────────────────────────────────────────────────────────────────────────
// Chargement de la récupération de portefeuille — un agrégat LIMS par projet.
//
// Charge en LOT (une requête `.in(project_id, …)` par table d'essais, pas N) les
// essais qui fondent la récupération, les groupe par projet, puis dérive pour
// chacun sa moyenne 48 h et sa globale « base essais » via derivePortfolioRecovery.
//
// Fail-open : une table illisible (migration non appliquée) laisse simplement le
// projet sans essais — il retombe sur sa récupération design, sans casser la liste.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import type { Project } from '../../types';
import type { StagePoint } from './stageRecoveryModel';
import { derivePortfolioRecovery, type PortfolioRecovery } from './portfolioRecovery';

type Row = Record<string, unknown> & { project_id: string };

/** Regroupe des lignes par project_id. */
function groupByProject(rows: Row[]): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = map.get(r.project_id);
    if (arr) arr.push(r); else map.set(r.project_id, [r]);
  }
  return map;
}

/** Moyenne des valeurs strictement positives d'une colonne. */
function avg(rows: Row[], key: string): number | null {
  const v = rows.map(r => Number(r[key])).filter(x => Number.isFinite(x) && x > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Couples (teneur, récupération) exploitables pour un ajustement d'étage. */
function points(rows: Row[], gradeKey: string, recKey: string): StagePoint[] {
  return rows.flatMap(r => {
    const g = Number(r[gradeKey]), y = Number(r[recKey]);
    return Number.isFinite(g) && g > 0 && Number.isFinite(y) && y > 0
      ? [{ gradeGt: g, recoveryPct: y }] : [];
  });
}

/** Tables d'essais LIMS interrogées — l'union tient le typage de `.from()`. */
type LimsTestTable =
  | 'lims_test_leaching'
  | 'lims_test_knelson'
  | 'lims_test_chem'
  | 'lims_test_flotation'
  | 'lims_test_liberation';

async function fetchIn(table: LimsTestTable, columns: string, ids: string[]): Promise<Row[]> {
  const { data, error } = await supabase.from(table).select(columns).in('project_id', ids);
  return error ? [] : ((data ?? []) as unknown as Row[]);
}

export interface PortfolioRecoveryState {
  /** Récupération dérivée par projet, indexée par project.id. */
  byProject: Map<string, PortfolioRecovery>;
  loading: boolean;
}

/**
 * Dérive la moyenne 48 h et la globale « base essais » de chaque projet fourni.
 * Recharge dès que l'ensemble des identifiants de projets change.
 */
export function usePortfolioRecovery(projects: Project[]): PortfolioRecoveryState {
  const [byProject, setByProject] = useState<Map<string, PortfolioRecovery>>(new Map());
  const [loading, setLoading] = useState(false);

  // Clé stable : la dérivation ne dépend que de l'ensemble des projets (id +
  // paramètres design qui alimentent le repli et l'ajustement à la teneur).
  const key = projects
    .map(p => `${p.id}:${p.gold_grade_g_t}:${p.recovery_pct}:${p.target_tph}`)
    .join('|');

  useEffect(() => {
    const ids = projects.map(p => p.id);
    if (ids.length === 0) { setByProject(new Map()); return; }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const [leach, knelson, chem, flot, lib] = await Promise.all([
        fetchIn('lims_test_leaching', 'project_id,leach_rec_24h_pct,leach_rec_48h_pct,nacn_consumption_kg_t,au_feed_g_t', ids),
        fetchIn('lims_test_knelson', 'project_id,grg_recovery_pct', ids),
        fetchIn('lims_test_chem', 'project_id,c_organic_pct,s_sulfide_pct', ids),
        fetchIn('lims_test_flotation', 'project_id,au_recovery_pct,au_feed_g_t', ids),
        fetchIn('lims_test_liberation', 'project_id,au_free_pct', ids),
      ]);
      if (cancelled) return;

      const gLeach = groupByProject(leach);
      const gKnelson = groupByProject(knelson);
      const gChem = groupByProject(chem);
      const gFlot = groupByProject(flot);
      const gLib = groupByProject(lib);

      const next = new Map<string, PortfolioRecovery>();
      for (const p of projects) {
        const leachRows = gLeach.get(p.id) ?? [];
        const chemRows = gChem.get(p.id) ?? [];
        const knelsonRows = gKnelson.get(p.id) ?? [];
        const flotRows = gFlot.get(p.id) ?? [];
        const libRows = gLib.get(p.id) ?? [];

        next.set(p.id, derivePortfolioRecovery({
          headGradeGt: p.gold_grade_g_t,
          designRecoveryPct: p.recovery_pct,
          throughputTph: p.target_tph,
          leach48Pct: avg(leachRows, 'leach_rec_48h_pct'),
          leach24Pct: avg(leachRows, 'leach_rec_24h_pct'),
          grgPct: avg(knelsonRows, 'grg_recovery_pct'),
          organicCarbonPct: avg(chemRows, 'c_organic_pct'),
          sulphidePct: avg(chemRows, 's_sulfide_pct'),
          flotationAuRecPct: avg(flotRows, 'au_recovery_pct'),
          auFreePct: avg(libRows, 'au_free_pct'),
          nacnKgT: avg(leachRows, 'nacn_consumption_kg_t'),
          auFeedGt: avg(leachRows, 'au_feed_g_t'),
          leachPoints: points(leachRows, 'au_feed_g_t', 'leach_rec_48h_pct'),
          flotPoints: points(flotRows, 'au_feed_g_t', 'au_recovery_pct'),
          counts: {
            chem: chemRows.length,
            comminution: 0,
            knelson: knelsonRows.length,
            flotation: flotRows.length,
            leaching: leachRows.length,
            mineralogy: libRows.length,
          },
        }));
      }
      setByProject(next);
      setLoading(false);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { byProject, loading };
}
