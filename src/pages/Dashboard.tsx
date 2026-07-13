import { useState, useEffect } from 'react';
import {
  Zap, TrendingUp, Activity, DollarSign, AlertTriangle, Layers, BarChart3, Settings2, RefreshCw, Circle, ArrowRight,
} from 'lucide-react';
import { KpiCard } from '../components/ui/KpiCard';
import { useProject } from '../lib/ProjectContext';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';

const PHASES = ['SCOPING', 'PRE-FEASIBILITY', 'FEASIBILITY', 'BFS', 'DFS', 'CONSTRUCTION', 'COMMISSIONING'];
const TROY = 1 / 31.1035;

interface ModuleDef {
  id: string;
  label: string;
  table: string;
  icon: React.ReactNode;
  page: string;
  linkedTo?: string[];
}

const MODULE_DEFS: ModuleDef[] = [
  { id: 'lims',         label: 'LIMS & Tests',          table: 'lims_samples',        icon: <Layers size={13}/>,     page: 'lims', linkedTo: ['analytics','granulometry'] },
  { id: 'blockmodel',   label: 'Block Model',            table: 'bm_blocks',           icon: <BarChart3 size={13}/>,  page: 'blockmodel', linkedTo: ['economics'] },
  { id: 'granulometry', label: 'Granulométrie',          table: 'lims_granulometry',   icon: <Activity size={13}/>,   page: 'granulometry', linkedTo: ['criteria','simulation'] },
  { id: 'criteria',     label: 'Critères de Conception', table: 'dc_draft',            icon: <Settings2 size={13}/>,  page: 'criteria', linkedTo: ['simulation','massbalance'] },
  { id: 'flowsheet',    label: 'Diagramme de Flot',      table: 'project_flowsheets',  icon: <Zap size={13}/>,        page: 'flowsheet', linkedTo: ['massbalance'] },
  { id: 'massbalance',  label: 'Bilan Massique',         table: 'mass_balance_streams',icon: <TrendingUp size={13}/>, page: 'massbalance', linkedTo: ['economics'] },
  { id: 'geomet',       label: 'GéoMet Intelligence',    table: 'geomet_domains',      icon: <Circle size={13}/>,     page: 'geomet', linkedTo: ['economics','simulation'] },
  { id: 'economics',    label: 'Modèle Économique',      table: 'capex_lines',         icon: <DollarSign size={13}/>, page: 'economics' },
  { id: 'risks',        label: 'Registre des Risques',   table: 'risks',               icon: <AlertTriangle size={13}/>, page: 'risks' },
];

interface DashboardProps { project: Project }

export function Dashboard({ project }: DashboardProps) {
  const {
    settings, totalCapex, totalOpex, capexLines, opexLines, moduleStatuses, upsertModuleStatus,
    gravityRecoveryPct, leachRecoveryPct, globalRecoveryPct, effectiveRecoveryPct,
  } = useProject();
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const [activities, setActivities] = useState<{ module: string; action: string; ts: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const phaseIdx = PHASES.indexOf(project.phase);
  const hoursPerYear = settings?.hours_per_year ?? null;

  useEffect(() => { loadModuleCounts(); }, [project.id]);

  async function loadModuleCounts() {
    setLoading(true);
    const counts: Record<string, number> = {};
    await Promise.all(MODULE_DEFS.map(async m => {
      const { count } = await supabase
        .from(m.table)
        .select('*', { count: 'exact', head: true })
        .eq('project_id', project.id);
      counts[m.id] = count ?? 0;
    }));
    setModuleCounts(counts);

    // Derive completion from record counts
    for (const m of MODULE_DEFS) {
      const n = counts[m.id] ?? 0;
      const pct = Math.min(100, n > 0 ? Math.min(100, 20 + n * 5) : 0);
      await upsertModuleStatus(m.id, { record_count: n, completion_pct: pct });
    }

    // Build recent activity from module_status
    const { data } = await supabase
      .from('module_status')
      .select('module_id,record_count,last_updated')
      .eq('project_id', project.id)
      .order('last_updated', { ascending: false })
      .limit(8);
    setActivities((data ?? []).map(r => ({
      module: MODULE_DEFS.find(m => m.id === r.module_id)?.label ?? r.module_id,
      action: `${r.record_count} enregistrement${r.record_count !== 1 ? 's' : ''}`,
      ts: r.last_updated ?? '',
    })));
    setLoading(false);
  }

  // ── Production metrics ─────────────────────────────────────────────────────
  const annualTonnes = hoursPerYear != null
    ? project.target_tph * (project.availability_pct / 100) * hoursPerYear
    : null;
  const annualOz = annualTonnes != null
    ? annualTonnes * project.gold_grade_g_t * (effectiveRecoveryPct / 100) * TROY
    : null;
  const revenueM = annualOz != null ? (annualOz * project.gold_price_usd) / 1_000_000 : null;
  const aisc = (annualOz && annualOz > 0 && totalOpex > 0)
    ? totalOpex * annualTonnes! / annualOz + (totalCapex * 1_000_000) / (annualOz * (settings?.lom_years ?? 10))
    : null;

  // ── Overall project readiness ─────────────────────────────────────────────
  const modulesWithData = MODULE_DEFS.filter(m => (moduleCounts[m.id] ?? 0) > 0).length;
  const overallReadiness = Math.round((modulesWithData / MODULE_DEFS.length) * 100);

  // ── Missing critical params ────────────────────────────────────────────────
  const missingParams: string[] = [];
  if (!hoursPerYear) missingParams.push('Heures/an (Paramètres)');
  if (!settings?.discount_rate_pct) missingParams.push('Taux d\'actualisation');
  if (capexLines.length === 0) missingParams.push('Lignes CAPEX');
  if (opexLines.length === 0) missingParams.push('Lignes OPEX');

  return (
    <div className="animate-fade-in">
      {/* Project Header Bar */}
      <div className="sticky top-0 z-20 px-8 py-3 bg-mf-card/90 backdrop-blur border-b border-mf-border flex items-center gap-6 text-sm">
        <div>
          <span className="text-amber-400 font-bold mr-2">{project.code}</span>
          <span className="text-mf-txt font-medium">{project.name}</span>
          <span className="text-mf-txt4 mx-2">·</span>
          <span className="text-mf-txt3">{project.country}</span>
        </div>
        <div className="flex items-center gap-4 ml-auto text-xs font-mono">
          <span className="text-mf-txt4">TPH <span className="text-mf-txt2">{project.target_tph}</span></span>
          <span className="text-mf-txt4">Grade <span className="text-amber-400">{project.gold_grade_g_t} g/t</span></span>
          <span className="text-mf-txt4">Recup. <span className="text-teal-400">{effectiveRecoveryPct.toFixed(1)}%</span>{globalRecoveryPct != null && <span className="text-[9px] text-emerald-400/70 ml-1">globale</span>}</span>
          <span className="text-mf-txt4">Au <span className="text-mf-txt2">${project.gold_price_usd}/oz</span></span>
          <span className="badge badge-gold">{project.phase}</span>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* Missing params alert */}
        {missingParams.length > 0 && (
          <div className="card border-amber-500/30 bg-amber-400/5 flex items-start gap-3">
            <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-amber-300 mb-1">Paramètres manquants — les calculs sont partiels</div>
              <div className="flex flex-wrap gap-2">
                {missingParams.map(p => (
                  <span key={p} className="text-[10px] bg-amber-400/10 text-amber-300 border border-amber-400/20 px-2 py-0.5 rounded-full">{p}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Phase pipeline */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="section-title">Pipeline Projet</div>
            <span className="text-xs text-mf-txt4">{project.phase}</span>
          </div>
          <div className="flex items-center gap-0">
            {PHASES.map((phase, i) => {
              const done = i < phaseIdx;
              const current = i === phaseIdx;
              return (
                <div key={phase} className="flex items-center flex-1 min-w-0">
                  <div className={`flex-1 h-1.5 ${i === 0 ? 'rounded-l-full' : ''} ${i === PHASES.length - 1 ? 'rounded-r-full' : ''}
                    ${done ? 'bg-amber-500' : current ? 'bg-amber-500/50' : 'bg-mf-border'}`} />
                  {i < PHASES.length - 1 && (
                    <div className={`relative w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 z-10 mx-[-1px]
                      ${done ? 'bg-amber-500 border-amber-400 text-gray-900' : current ? 'bg-amber-500/20 border-amber-500 text-amber-400' : 'bg-mf-card border-mf-border text-mf-txt4'}`}>
                      {done ? '✓' : i + 1}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between mt-2">
            {PHASES.map((p, i) => (
              <div key={p} className={`text-[9px] text-center flex-1 ${i === phaseIdx ? 'text-amber-400 font-semibold' : 'text-mf-txt4'}`}>{p}</div>
            ))}
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="Production Annuelle"
            value={annualOz != null ? `${(annualOz / 1000).toFixed(1)} koz` : '—'}
            sub={hoursPerYear == null ? 'Configurer heures/an' : `${Math.round(annualTonnes! / 1000)}kt/an traitées`}
            icon={<Zap size={16} />}
            color="amber"
            trend={annualOz != null ? 'up' : undefined}
          />
          <KpiCard
            label="Revenus Annuels"
            value={revenueM != null ? `${revenueM.toFixed(1)} M$` : '—'}
            sub={revenueM == null ? 'Configurer heures/an' : `@ ${project.gold_price_usd} $/oz`}
            icon={<DollarSign size={16} />}
            color="green"
          />
          <KpiCard
            label="CAPEX Total"
            value={totalCapex > 0 ? `${totalCapex.toFixed(1)} M$` : '—'}
            sub={capexLines.length > 0 ? `${capexLines.length} ligne(s) CAPEX` : 'Saisir dans Économie'}
            icon={<TrendingUp size={16} />}
            color="blue"
          />
          <KpiCard
            label="AISC Estimé"
            value={aisc != null && aisc > 0 ? `${aisc.toFixed(0)} $/oz` : '—'}
            sub={aisc == null ? 'OPEX + CAPEX requis' : 'Tout compris'}
            icon={<Activity size={16} />}
            color={aisc != null && aisc < project.gold_price_usd * 0.6 ? 'green' : 'amber'}
          />
        </div>

        {/* Recovery breakdown — gravity, leach and combined (from LIMS testwork) */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title">Récupération de l'Or</div>
            <span className="text-[10px] text-mf-txt4">
              {globalRecoveryPct != null ? 'Depuis testwork LIMS (Gravité + Leach)' : 'Aucun testwork — valeur design projet'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Récup. Gravité', value: gravityRecoveryPct, note: 'GRG × 0.90 (circuit)', color: 'text-amber-300' },
              { label: 'Récup. Lixiviation', value: leachRecoveryPct, note: 'Test leach 24 h', color: 'text-sky-300' },
              { label: 'Récup. Globale', value: globalRecoveryPct ?? project.recovery_pct, note: globalRecoveryPct != null ? '1 − (1−Grav)(1−Leach)' : 'design projet', color: 'text-emerald-300' },
            ].map(rc => (
              <div key={rc.label} className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">
                <div className="text-[10px] text-mf-txt4 mb-0.5">{rc.label}</div>
                <div className={`text-2xl font-bold ${rc.value != null ? rc.color : 'text-mf-txt4'}`}>
                  {rc.value != null ? `${rc.value.toFixed(1)}%` : '—'}
                </div>
                <div className="text-[9px] text-mf-txt4 mt-0.5">{rc.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Two-column: Module health + Data Pipeline */}
        <div className="grid grid-cols-2 gap-6">
          {/* Module Health */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="section-title">Santé des Modules</div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-mf-txt4">{modulesWithData}/{MODULE_DEFS.length} actifs</span>
                <button onClick={loadModuleCounts} disabled={loading} className="text-mf-txt4 hover:text-mf-txt transition-colors">
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>
            {/* Overall bar */}
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all" style={{ width: `${overallReadiness}%` }} />
              </div>
              <span className="text-xs font-bold text-amber-400 w-10 text-right">{overallReadiness}%</span>
            </div>
            <div className="space-y-2">
              {MODULE_DEFS.map(m => {
                const count = moduleCounts[m.id] ?? 0;
                const status = moduleStatuses.find(s => s.module_id === m.id);
                const pct = status?.completion_pct ?? (count > 0 ? Math.min(100, 20 + count * 5) : 0);
                const color = pct >= 70 ? '#10B981' : pct >= 30 ? '#F59E0B' : '#EF4444';
                return (
                  <div key={m.id} className="flex items-center gap-2">
                    <div className="w-4 text-mf-txt4">{m.icon}</div>
                    <div className="flex-1 text-[11px] mf-txt truncate">{m.label}</div>
                    <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                    <div className="text-[10px] w-8 text-right" style={{ color }}>{count > 0 ? count : '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Data Pipeline */}
          <div className="card space-y-3">
            <div className="section-title">Pipeline de Données</div>
            <div className="text-xs text-mf-txt4 mb-1">Synergies inter-modules actives</div>
            <div className="space-y-2">
              {[
                { from: 'lims', to: 'granulometry', label: 'Tests LIMS → Granulométrie', active: (moduleCounts['lims'] ?? 0) > 0 },
                { from: 'granulometry', to: 'criteria', label: 'P80 → Critères de Conception', active: (moduleCounts['granulometry'] ?? 0) > 0 },
                { from: 'criteria', to: 'simulation', label: 'DC → Simulation Pro', active: (moduleCounts['criteria'] ?? 0) > 0 },
                { from: 'blockmodel', to: 'economics', label: 'Tonnes/Grade → Économie', active: (moduleCounts['blockmodel'] ?? 0) > 0 },
                { from: 'geomet', to: 'economics', label: 'Domaines GéoMet → Économie', active: (moduleCounts['geomet'] ?? 0) > 0 },
                { from: 'flowsheet', to: 'massbalance', label: 'Flot → Bilan Massique', active: (moduleCounts['flowsheet'] ?? 0) > 0 },
                { from: 'massbalance', to: 'economics', label: 'Bilan → Modèle Économique', active: (moduleCounts['massbalance'] ?? 0) > 0 },
              ].map(link => (
                <div key={`${link.from}-${link.to}`} className={`flex items-center gap-2 text-xs transition-opacity ${link.active ? 'opacity-100' : 'opacity-30'}`}>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${link.active ? 'bg-emerald-400' : 'bg-mf-txt4'}`} />
                  <span className={link.active ? 'mf-txt' : 'mf-txt4'}>{link.label}</span>
                  {link.active && <ArrowRight size={10} className="text-emerald-400 ml-auto" />}
                  {!link.active && <span className="text-[10px] mf-txt4 ml-auto">En attente de données</span>}
                </div>
              ))}
            </div>
            {/* Project completion score */}
            <div className="mt-3 pt-3 border-t border-mf-border">
              <div className="text-xs text-mf-txt3 mb-1">Score de complétude global</div>
              <div className="flex items-center gap-3">
                <div className="text-2xl font-bold text-amber-400">{overallReadiness}%</div>
                <div className="flex-1">
                  <div className="text-[10px] mf-txt4">
                    {overallReadiness < 30 ? 'Démarrage — saisir les données de base'
                     : overallReadiness < 60 ? 'En cours — continuer les campagnes de test'
                     : overallReadiness < 85 ? 'Avancé — valider les modèles clés'
                     : 'Complet — prêt pour rapport de faisabilité'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Project Parameters Summary */}
        <div className="card">
          <div className="section-title mb-3">Paramètres Projet</div>
          <div className="grid grid-cols-6 gap-4 text-xs">
            {[
              { label: 'Débit', value: `${project.target_tph} t/h`, note: 'nominal' },
              { label: 'Teneur Au', value: `${project.gold_grade_g_t} g/t`, note: 'alimentation' },
              { label: 'Récupération', value: `${effectiveRecoveryPct.toFixed(1)}%`, note: globalRecoveryPct != null ? 'globale (testwork)' : 'design' },
              { label: 'Disponibilité', value: `${project.availability_pct}%`, note: 'usine' },
              { label: 'Densité minerai', value: `${project.ore_sg} t/m³`, note: 'SG' },
              { label: 'Prix Au', value: `$${project.gold_price_usd}/oz`, note: 'hypothèse' },
              { label: 'Heures/an', value: hoursPerYear != null ? `${hoursPerYear}h` : '—', note: settings ? 'configuré' : 'à configurer' },
              { label: 'Taux actualisation', value: settings?.discount_rate_pct != null ? `${settings.discount_rate_pct}%` : '—', note: settings?.discount_rate_pct ? 'DCF' : 'à configurer' },
              { label: 'Durée LOM', value: settings?.lom_years != null ? `${settings.lom_years} ans` : '—', note: settings?.lom_years ? 'LOM' : 'à configurer' },
              { label: 'OPEX total', value: totalOpex > 0 ? `${totalOpex.toFixed(2)} $/t` : '—', note: opexLines.length > 0 ? `${opexLines.length} lignes` : 'à saisir' },
              { label: 'CAPEX total', value: totalCapex > 0 ? `${totalCapex.toFixed(1)} M$` : '—', note: capexLines.length > 0 ? `${capexLines.length} lignes` : 'à saisir' },
              { label: 'Redevances', value: settings?.royalty_pct != null ? `${settings.royalty_pct}%` : '—', note: 'royalties' },
            ].map(p => (
              <div key={p.label} className="space-y-0.5">
                <div className="text-mf-txt4">{p.label}</div>
                <div className={`font-semibold ${p.value === '—' ? 'text-red-400/60' : 'text-mf-txt'}`}>{p.value}</div>
                <div className="text-[9px] text-mf-txt4">{p.note}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        {activities.length > 0 && (
          <div className="card">
            <div className="section-title mb-3">Activité Récente</div>
            <div className="space-y-1.5">
              {activities.map((a, i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-400 shrink-0" />
                  <span className="mf-txt font-medium">{a.module}</span>
                  <span className="mf-txt3">—</span>
                  <span className="mf-txt3">{a.action}</span>
                  <span className="ml-auto mf-txt4">{a.ts ? new Date(a.ts).toLocaleDateString('fr-CA') : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
