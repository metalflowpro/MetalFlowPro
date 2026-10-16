// Jeu de données LIMS d'un projet (lecture seule) — partagé par Analytics.
// Mis en cache par useProjectQuery et invalidé par toute écriture, via la
// couche de données, sur l'une des tables listées.

import { supabase } from '../supabase';
import type { LimsData } from '../../pages/analytics/model';

export const LIMS_DATASET_TABLES = [
  'lims_samples', 'lims_test_chem', 'lims_test_mineralogy', 'lims_test_comminution', 'lims_test_knelson',
  'lims_test_flotation', 'lims_test_leaching', 'lims_test_elution', 'lims_test_liberation',
] as const;

export const EMPTY_LIMS_DATASET: LimsData = {
  samples: [], chem: [], mineralogy: [], comminution: [], knelson: [], flotation: [], leaching: [], elution: [], liberation: [],
};

export async function fetchLimsDataset(projectId: string): Promise<LimsData> {
  const [samples, chem, min, comm, knel, flot, leach, elu, lib] = await Promise.all([
    supabase.from('lims_samples').select('id,sample_id,domain,campaign').eq('project_id', projectId),
    supabase.from('lims_test_chem').select('*').eq('project_id', projectId),
    supabase.from('lims_test_mineralogy').select('sample_id,pyrite_pct,pyrrhotite_pct,au_free_pct,carbonates_pct,fe_oxides_pct').eq('project_id', projectId),
    supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3,axb_jk').eq('project_id', projectId),
    supabase.from('lims_test_knelson').select('sample_id,grg_recovery_pct,p80_feed_um').eq('project_id', projectId),
    supabase.from('lims_test_flotation').select('sample_id,au_recovery_pct,s_recovery_pct,au_feed_g_t').eq('project_id', projectId),
    supabase.from('lims_test_leaching').select('*').eq('project_id', projectId),
    supabase.from('lims_test_elution').select('sample_id,au_recovery_pct').eq('project_id', projectId),
    supabase.from('lims_test_liberation').select('sample_id,p80_um,au_free_pct,au_sulphides_pct,au_silicates_pct,au_occluded_pct,au_preg_rob_pct').eq('project_id', projectId),
  ]);
  // Une erreur de lecture doit se voir (et être réessayée), pas passer pour « aucune donnée ».
  const failed = [samples, chem, min, comm, knel, flot, leach, elu, lib].find(r => r.error);
  if (failed?.error) throw new Error(`Lecture LIMS impossible : ${failed.error.message}`);
  return {
    samples: (samples.data ?? []) as LimsData['samples'],
    chem: (chem.data ?? []) as LimsData['chem'],
    mineralogy: (min.data ?? []) as LimsData['mineralogy'],
    comminution: (comm.data ?? []) as LimsData['comminution'],
    knelson: (knel.data ?? []) as LimsData['knelson'],
    flotation: (flot.data ?? []) as LimsData['flotation'],
    leaching: (leach.data ?? []) as LimsData['leaching'],
    elution: (elu.data ?? []) as LimsData['elution'],
    liberation: (lib.data ?? []) as LimsData['liberation'],
  };
}
