import { useState, useEffect } from 'react';
import {
  FlaskConical, BarChart3,
  TrendingUp, AlertTriangle,
  RefreshCw, GitBranch,
  Activity, Cpu, Sparkles,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { useProject } from '../lib/ProjectContext';

import type { Project } from '../types';
import { LimsData, computeGeomet, computeRoutes, robustMean } from './analytics/model';
import { SyntheseTab } from './analytics/SyntheseTab';
import { ChartsTab } from './analytics/ChartsTab';
import { CorrelationsTab } from './analytics/CorrelationsTab';
import { RoutesTab } from './analytics/RoutesTab';
import { GeometTab } from './analytics/GeometTab';
import { PredictionTab } from './analytics/PredictionTab';

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { project: Project; }

export function Analytics({ project }: Props) {
  const { metConstants, effectiveRecoveryPct } = useProject();
  const [data, setData] = useState<LimsData>({ samples: [], chem: [], mineralogy: [], comminution: [], knelson: [], flotation: [], leaching: [], elution: [], liberation: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'synthese' | 'charts' | 'correlations' | 'routes' | 'geomet' | 'prediction'>('synthese');

  useEffect(() => { loadData(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setLoading(true);
    const [samples, chem, min, comm, knel, flot, leach, elu, lib] = await Promise.all([
      supabase.from('lims_samples').select('id,sample_id,domain,campaign').eq('project_id', project.id),
      supabase.from('lims_test_chem').select('*').eq('project_id', project.id),
      supabase.from('lims_test_mineralogy').select('sample_id,pyrite_pct,pyrrhotite_pct,au_free_pct,carbonates_pct,fe_oxides_pct').eq('project_id', project.id),
      supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3,axb_jk').eq('project_id', project.id),
      supabase.from('lims_test_knelson').select('sample_id,grg_recovery_pct,p80_feed_um').eq('project_id', project.id),
      supabase.from('lims_test_flotation').select('sample_id,au_recovery_pct,s_recovery_pct,au_feed_g_t').eq('project_id', project.id),
      supabase.from('lims_test_leaching').select('*').eq('project_id', project.id),
      supabase.from('lims_test_elution').select('sample_id,au_recovery_pct').eq('project_id', project.id),
      supabase.from('lims_test_liberation').select('sample_id,p80_um,au_free_pct,au_sulphides_pct,au_silicates_pct,au_occluded_pct,au_preg_rob_pct').eq('project_id', project.id),
    ]);
    setData({
      samples: (samples.data ?? []) as LimsData['samples'],
      chem: (chem.data ?? []) as LimsData['chem'],
      mineralogy: (min.data ?? []) as LimsData['mineralogy'],
      comminution: (comm.data ?? []) as LimsData['comminution'],
      knelson: (knel.data ?? []) as LimsData['knelson'],
      flotation: (flot.data ?? []) as LimsData['flotation'],
      leaching: (leach.data ?? []) as LimsData['leaching'],
      elution: (elu.data ?? []) as LimsData['elution'],
      liberation: (lib.data ?? []) as LimsData['liberation'],
    });
    setLoading(false);
  }

  const routes = computeRoutes(data, metConstants.routeStageEfficiencies, metConstants.adsorptionDecision);
  const maxRec = routes.length > 0 ? Math.max(...routes.map(r => r.recovery_pct)) : 100;
  const geomet = computeGeomet(data);
  const hasPregRobbing = (robustMean(data.chem.map(t => t.c_organic_pct)) ?? 0) > 0.2;
  const corgMean = robustMean(data.chem.map(t => t.c_organic_pct));

  const totalTests = data.chem.length + data.mineralogy.length + data.comminution.length +
    data.knelson.length + data.flotation.length + data.leaching.length;

  const TABS = [
    { id: 'synthese' as const,      label: 'Synthèse LIMS',         icon: <BarChart3 size={13}/> },
    { id: 'charts' as const,        label: 'Courbes & Histogrammes', icon: <Activity size={13}/> },
    { id: 'correlations' as const,  label: 'Corrélations',          icon: <GitBranch size={13}/> },
    { id: 'routes' as const,        label: 'Route Métallurgique',    icon: <TrendingUp size={13}/> },
    { id: 'geomet' as const,        label: 'Géométallurgie',         icon: <Cpu size={13}/> },
    { id: 'prediction' as const,    label: 'Prédiction IA',          icon: <Sparkles size={13}/> },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Analyse et Interprétation"
        subtitle={`${project.code} · ${data.samples.length} échantillons · ${totalTests} résultats de tests`}
        actions={
          <button onClick={loadData} className="btn btn-secondary gap-1.5 text-xs py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />Actualiser
          </button>
        }
      />

      <div className="border-b border-mf-border px-6 flex gap-1 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${activeTab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-mf-txt4 text-sm gap-2">
            <RefreshCw size={16} className="animate-spin" /> Chargement données LIMS…
          </div>
        ) : totalTests === 0 && data.samples.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <FlaskConical size={32} className="text-mf-txt4 mb-3" />
            <p className="text-sm font-semibold text-mf-txt mb-1">Aucune donnée LIMS disponible</p>
            <p className="text-xs text-mf-txt4 max-w-xs">Importez des échantillons et des résultats de tests dans le module LIMS pour générer l'analyse.</p>
          </div>
        ) : (
          <>
            {hasPregRobbing && (
              <div className="mb-5 p-3 bg-red-500/10 border border-red-500/25 rounded-lg flex items-start gap-3">
                <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-red-400 mb-0.5">Risque Prég-Robbing Détecté</div>
                  <div className="text-xs text-mf-txt3">Corg moyen = {corgMean!.toFixed(2)}% › seuil 0.20%. Circuit CIL avec prétraitement recommandé.</div>
                </div>
              </div>
            )}
            {activeTab === 'synthese' && <SyntheseTab data={data} routes={routes} hasPregRobbing={hasPregRobbing} />}
            {activeTab === 'charts' && <ChartsTab data={data} />}
            {activeTab === 'correlations' && <CorrelationsTab data={data} />}
            {activeTab === 'routes' && <RoutesTab routes={routes} maxRec={maxRec} data={data} adsorptionThresholds={metConstants.adsorptionDecision} />}
            {activeTab === 'geomet' && <GeometTab entries={geomet} data={data} />}
            {activeTab === 'prediction' && <PredictionTab data={data} project={project} recoveryCeilingPct={effectiveRecoveryPct} cyanideModel={metConstants.cyanideModel} leachKinetics={metConstants.leachKinetics} />}
          </>
        )}
      </div>
    </div>
  );
}
