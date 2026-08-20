import { useState, useEffect, useCallback } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Zap, TrendingUp, Activity, DollarSign, AlertTriangle, Layers, BarChart3, Settings2, RefreshCw, Circle, ArrowRight, Award,
} from 'lucide-react';
import { KpiCard } from '../components/ui/KpiCard';
import { BarChart } from '../components/ui/Chart';
import { SnapshotsPanel } from '../components/ui/SnapshotsPanel';
import { useProject } from '../lib/ProjectContext';
import { supabase, supabaseDynamic } from '../lib/supabase';
import type { Project } from '../types';
import { computeProductionMetrics } from '../lib/config/constants';

const PHASES = ['SCOPING', 'PRE-FEASIBILITY', 'FEASIBILITY', 'BFS', 'DFS', 'CONSTRUCTION', 'COMMISSIONING'];

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
  // Counted on lims_test_psd — the LIMS-synced tests the module actually runs on.
  // (lims_granulometry is the pre-sync vestigial table; counting it showed the
  // module as empty and left the P80 → Critères pipeline "en attente" forever.)
  { id: 'granulometry', label: 'Granulométrie',          table: 'lims_test_psd',       icon: <Activity size={13}/>,   page: 'granulometry', linkedTo: ['criteria','simulation'] },
  { id: 'criteria',     label: 'Critères de Conception', table: 'dc_draft',            icon: <Settings2 size={13}/>,  page: 'criteria', linkedTo: ['simulation','massbalance'] },
  { id: 'flowsheet',    label: 'Diagramme de Flot',      table: 'project_flowsheets',  icon: <Zap size={13}/>,        page: 'flowsheet', linkedTo: ['massbalance'] },
  { id: 'massbalance',  label: 'Bilan Massique',         table: 'mass_balance_streams',icon: <TrendingUp size={13}/>, page: 'massbalance', linkedTo: ['economics'] },
  { id: 'geomet',       label: 'GéoMet Intelligence',    table: 'geomet_domains',      icon: <Circle size={13}/>,     page: 'geomet', linkedTo: ['economics','simulation'] },
  { id: 'economics',    label: 'Modèle Économique',      table: 'capex_lines',         icon: <DollarSign size={13}/>, page: 'economics' },
  { id: 'risks',        label: 'Registre des Risques',   table: 'risks',               icon: <AlertTriangle size={13}/>, page: 'risks' },
];

interface DashboardProps { project: Project; onProjectUpdated?: (p: Project) => void }

export function Dashboard({ project, onProjectUpdated }: DashboardProps) {
  const {
    settings, totalCapex, totalOpex, capexLines, opexLines, moduleStatuses, upsertModuleStatus,
    globalRecoveryPct, effectiveRecoveryPct,
    recommendedRouteLabel, recommendedRouteStages, routeIsUserChoice, routeDowngrade, auditedRecoveryBasis,
    domainRecovery, leachDurationLabel,
    testworkAverages, routeCandidates, recoveryNotAlignedOn48h,
    assumptions,
  } = useProject();
  const [moduleCounts, setModuleCounts] = useState<Record<string, number>>({});
  const [activities, setActivities] = useState<{ module: string; action: string; ts: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const phaseIdx = PHASES.indexOf(project.phase);
  const hoursPerYear = assumptions.hoursPerYear;

  const loadModuleCounts = useCallback(async () => {
    setLoading(true);
    const counts: Record<string, number> = {};
    await Promise.all(MODULE_DEFS.map(async m => {
      const { count } = await supabaseDynamic
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
  }, [project.id, upsertModuleStatus]);

  useEffect(() => { loadModuleCounts(); }, [loadModuleCounts]);

  // ── Real-time: auto-refresh when any module table changes ──────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`dashboard-${project.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', filter: `project_id=eq.${project.id}` },
        () => { loadModuleCounts(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [project.id, loadModuleCounts]);

  // ── Récupération par étage ─────────────────────────────────────────────────
  // Les cartes et le graphique énumèrent les étages DE LA ROUTE RECOMMANDÉE,
  // suivis de la globale. Aucun étage n'est supposé : le tableau de bord
  // affichait « Gravité / Lixiviation » même pour une route qui n'en comportait
  // pas, et une globale qui ne découlait d'aucune des deux barres tracées.
  // Sans testwork, la seule barre honnête est la récupération design du projet.
  const STAGE_COLORS = ['text-amber-300', 'text-sky-300', 'text-violet-300'];
  const globalValue = globalRecoveryPct ?? project.recovery_pct;
  const stageCards = recommendedRouteStages.map((s, i) => ({
    label: s.label,
    short: s.label.replace(/\s*\(.*\)$/, ''),
    value: s.recovery_pct,
    note: s.note,
    color: STAGE_COLORS[i % STAGE_COLORS.length],
  }));
  // Une route à ÉTAGE UNIQUE (cyanuration directe, lixiviation en tas) n'a pas de
  // décomposition : son étage EST la route. Afficher deux cartes identiques et
  // deux barres identiques laissait croire à une composition qui n'existe pas —
  // on ne garde alors que la globale, dont la note porte le détail de l'étage.
  const singleStageRoute = stageCards.length === 1 && Math.abs(stageCards[0].value - globalValue) < 0.05;
  // ── Meilleure combinaison ───────────────────────────────────────────────────
  // `routeCandidates` est trié par récupération décroissante : la tête est la
  // meilleure combinaison que les ESSAIS soutiennent. Elle n'est pas forcément
  // la route active — celle-ci suit le flowsheet du métallurgiste, et c'est
  // volontaire. L'écart entre les deux est l'arbitrage à documenter, pas une
  // erreur à corriger en écrasant son choix.
  const bestRoute = routeCandidates[0] ?? null;
  // ── Meilleure route sur 48 h ────────────────────────────────────────────────
  // Réponse directe à « quelle route rend le plus, à la durée FINALE de
  // lixiviation ? ». Les candidates d'un même projet partagent la base de
  // lixiviation (48 h, ou repli 24 h) : la tête du classement EST donc la
  // meilleure route 48 h — sauf quand le projet retombe sur le repli 24 h, où
  // aucune route n'est alignée sur la référence de conception.
  const best48hRoute = bestRoute && !bestRoute.leachBasisIsFallback ? bestRoute : null;
  const confidenceLabel = (c: 'high' | 'medium' | 'low') =>
    c === 'high' ? 'élevée' : c === 'medium' ? 'moyenne' : 'faible';
  const activeRouteName = recommendedRouteLabel?.replace(/ · récup\. auditée$/, '') ?? null;
  const bestIsActive = bestRoute != null && bestRoute.route === activeRouteName;
  // ⚠️ Pas d'écart affiché quand une courbe AUDITÉE pilote la récupération : elle
  // supersède toute reconstitution par composition d'étages, et opposer une route
  // reconstituée à un chiffre déjà certifié compare deux natures de nombres.
  const bestGainPts = bestRoute && !bestIsActive && globalRecoveryPct != null && auditedRecoveryBasis == null
    ? bestRoute.recovery_pct - globalRecoveryPct
    : null;
  const measuredTestwork = testworkAverages.filter(t => t.meanPct != null);
  // La carte « Récup. Globale » a été retirée : le bandeau « Meilleure route ·
  // récupération 48 h » ci-dessus porte le chiffre de tête, et l'en-tête du projet
  // rappelle la globale. On ne garde ici que la décomposition PAR ÉTAGE d'une route
  // multi-étages ; une route à étage unique n'a rien à décomposer.
  const recoveryCards = singleStageRoute ? [] : stageCards;

  // ── Production metrics ─────────────────────────────────────────────────────
  const { annualTonnes, annualOz } = computeProductionMetrics(project, assumptions, effectiveRecoveryPct);
  const revenueM = (annualOz * project.gold_price_usd) / 1_000_000;
  // AISC (WGC) = cash costs (OPEX + affinage + redevances) + capital de maintien,
  // par once — le CAPEX initial n'en fait pas partie (c'est l'AIC). Même formule
  // que le module Économie pour que les deux cartes affichent le même chiffre.
  const aisc = (annualOz > 0 && totalOpex > 0)
    ? (totalOpex * annualTonnes
       + assumptions.refineryChargeUsdOz * annualOz
       + assumptions.royaltyFraction * annualOz * project.gold_price_usd
       + (settings?.sustaining_capex_musd_yr ?? 0) * 1_000_000) / annualOz
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
          <span className="text-mf-txt4">Recup. <span className="text-teal-400">{formatDecimalGrouped(effectiveRecoveryPct, 1)}%</span>{globalRecoveryPct != null && <span className="text-[9px] text-emerald-400/70 ml-1">globale</span>}</span>
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
            value={annualOz != null ? `${formatDecimalGrouped((annualOz / 1000), 1)} koz` : '—'}
            sub={hoursPerYear == null ? 'Configurer heures/an' : `${Math.round(annualTonnes! / 1000)}kt/an traitées`}
            icon={<Zap size={16} />}
            color="amber"
            trend={annualOz != null ? 'up' : undefined}
          />
          <KpiCard
            label="Revenus Annuels"
            value={revenueM != null ? `${formatDecimalGrouped(revenueM, 1)} M$` : '—'}
            sub={`@ ${project.gold_price_usd} $/oz`}
            icon={<DollarSign size={16} />}
            color="green"
          />
          <KpiCard
            label="CAPEX Total"
            value={totalCapex > 0 ? `${formatDecimalGrouped(totalCapex, 1)} M$` : '—'}
            sub={capexLines.length > 0 ? `${capexLines.length} ligne(s) CAPEX` : 'Saisir dans Économie'}
            icon={<TrendingUp size={16} />}
            color="blue"
          />
          <KpiCard
            label="AISC Estimé"
            value={aisc != null && aisc > 0 ? `${formatDecimalGrouped(aisc, 0)} $/oz` : '—'}
            sub={aisc == null ? 'OPEX requis' : 'Cash costs + maintien (WGC)'}
            icon={<Activity size={16} />}
            color={aisc != null && aisc < project.gold_price_usd * 0.6 ? 'green' : 'amber'}
          />
        </div>

        {/* Recovery breakdown — les étages sont ceux de la ROUTE RECOMMANDÉE, jamais
            un triplet supposé : une route sans gravité n'affiche pas de gravité. */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="section-title">Récupération de l'Or</div>
            <span className="text-[10px] text-mf-txt4">
              {globalRecoveryPct != null
                ? <>{routeIsUserChoice && !routeDowngrade ? 'Route retenue' : routeIsUserChoice ? 'Route chiffrée' : 'Route recommandée'} : <strong className="text-mf-txt3">{recommendedRouteLabel}</strong>{leachDurationLabel && <> · lixiviation {leachDurationLabel}</>}</>
                : 'Aucun testwork — valeur design projet'}
            </span>
          </div>
          {/* ── Meilleure route métallurgique sur 48 h ────────────────────────
              Ce que demande le tableau de bord : parmi les routes chiffrables
              par les essais du module LIMS, celle qui rend le PLUS à la durée
              finale de lixiviation (48 h). Provient du même moteur `estimateRoutes`
              que le classement plus bas — pas d'un calcul concurrent. */}
          {best48hRoute ? (
            <div className="mb-3 flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <Award size={17} className="text-emerald-300 shrink-0" />
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-wider text-emerald-300/70">Meilleure route · récupération 48 h</div>
                <div className="text-sm font-semibold text-mf-txt truncate" title={best48hRoute.basis}>{best48hRoute.route}</div>
              </div>
              <div className="ml-auto text-right shrink-0">
                <div className="text-2xl font-bold text-emerald-300">{formatDecimalGrouped(best48hRoute.recovery_pct, 1)}%</div>
                <div className="text-[9px] text-mf-txt4">
                  confiance {confidenceLabel(best48hRoute.confidence)} · données {best48hRoute.dataQualityScore}%
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-mf-border/60 bg-mf-panel/30 px-3 py-2 text-[10px] text-mf-txt4">
              <Award size={12} className="mt-px shrink-0" />
              <span>
                Aucune route n'est chiffrable sur un essai de lixiviation à <strong>48 h</strong>.
                Ajoutez un essai à la durée finale dans le module LIMS pour désigner la meilleure route.
              </span>
            </div>
          )}
          {/* La globale se lit à la durée FINALE de lixiviation. Sur un repli 24 h
              elle ne pilote plus rien : le dire, plutôt que de publier une
              conception assise sur une cinétique intermédiaire. */}
          {recoveryNotAlignedOn48h && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300/90">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              <span>
                Aucun essai de lixiviation à <strong>48 h</strong> : les routes ci-dessous reposent sur
                le repli <strong>{recoveryNotAlignedOn48h}</strong>, une cinétique intermédiaire.
                La récupération globale n'étant pas alignée sur 48 h, elle retombe sur la récupération
                design du projet. Ajoutez un essai à la durée finale pour la rétablir.
              </span>
            </div>
          )}
          {/* La route cochée dans « Critères de conception » n'était pas chiffrable :
              le dire, sinon le repli passe pour la décision du métallurgiste. */}
          {routeDowngrade && (
            <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[10px] text-amber-300/90">
              <AlertTriangle size={12} className="mt-px shrink-0" />
              <span>
                Votre flowsheet décrit <strong>{routeDowngrade.requested}</strong>, mais les essais LIMS ne
                permettent pas de la chiffrer. Les chiffres ci-dessous sont ceux de <strong>{routeDowngrade.actual}</strong> —
                un repli, pas la route que vous avez retenue. Ajoutez les essais manquants pour chiffrer la route cochée.
              </span>
            </div>
          )}
          {recoveryCards.length > 0 && (
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${recoveryCards.length}, minmax(0, 1fr))` }}>
              {recoveryCards.map(rc => (
                <div key={rc.label} className="rounded-lg border border-mf-border bg-mf-panel/40 p-3" title={rc.note}>
                  <div className="text-[10px] text-mf-txt4 mb-0.5 truncate">{rc.label}</div>
                  <div className={`text-2xl font-bold ${rc.color}`}>
                    {formatDecimalGrouped(rc.value, 1)}%
                  </div>
                  <div className="text-[9px] text-mf-txt4 mt-0.5 line-clamp-2">{rc.note}</div>
                </div>
              ))}
            </div>
          )}
          {/* ── Moyennes des essais LIMS ──────────────────────────────────────
              La MATIÈRE PREMIÈRE des routes, pas leur résultat. Le libellé doit
              porter la distinction : un essai mesure l'or DISSOUS en bouteille,
              une carte de récupération porte en plus le transfert usine et
              l'adsorption. Les deux séries ne se comparent pas terme à terme. */}
          <div className="mt-4 pt-3 border-t border-mf-border/60">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-medium text-mf-txt3">
                Moyennes des essais LIMS
              </div>
              <span className="text-[9px] text-mf-txt4">
                mesures de laboratoire, avant facteurs d'usine · {measuredTestwork.length}/{testworkAverages.length} famille(s) caractérisée(s)
              </span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${testworkAverages.length}, minmax(0, 1fr))` }}>
              {testworkAverages.map(t => (
                <div
                  key={t.key}
                  title={t.note}
                  className={`rounded-lg border p-2 ${t.meanPct != null
                    ? 'border-mf-border bg-mf-panel/40'
                    : 'border-dashed border-mf-border/60 bg-transparent'}`}
                >
                  <div className="text-[10px] text-mf-txt4 mb-0.5 truncate">{t.label}</div>
                  <div className={`text-lg font-bold ${t.meanPct != null ? 'text-mf-txt2' : 'text-mf-txt4'}`}>
                    {t.meanPct != null ? `${formatDecimalGrouped(t.meanPct, 1)}%` : '—'}
                  </div>
                  <div className="text-[9px] text-mf-txt4 mt-0.5">
                    {t.meanPct != null ? `moyenne · n = ${t.n}` : 'aucun essai'}
                  </div>
                  {/* La valeur AJUSTÉE prime sur la moyenne dans les routes : la
                      montrer évite qu'un écart légitime passe pour une erreur. */}
                  {t.fittedPct != null && (
                    <div className="text-[9px] text-sky-300/80 mt-0.5">
                      ajusté à la teneur : {formatDecimalGrouped(t.fittedPct, 1)}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Combinaisons candidates ───────────────────────────────────────
              La meilleure combinaison est celle des ESSAIS ; la route active est
              celle du MÉTALLURGISTE. Afficher les deux, et leur écart, sans
              jamais substituer l'une à l'autre. */}
          {routeCandidates.length > 0 && (
            <div className="mt-4 pt-3 border-t border-mf-border/60">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-medium text-mf-txt3">
                  Combinaisons candidates — récupération globale
                </div>
                <span className="text-[9px] text-mf-txt4">
                  {routeCandidates.length} route(s) chiffrable(s) par les essais du projet
                </span>
              </div>
              <div className="space-y-1">
                {routeCandidates.map((r, i) => {
                  const isActive = r.route === activeRouteName;
                  const isBest = i === 0;
                  return (
                    <div
                      key={r.route}
                      title={r.basis}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px] ${
                        isActive
                          ? 'border-emerald-500/40 bg-emerald-500/5'
                          : isBest
                            ? 'border-amber-500/30 bg-amber-500/5'
                            : 'border-mf-border/60 bg-mf-panel/20'}`}
                    >
                      <span className="w-4 text-center font-mono text-mf-txt4">{i + 1}</span>
                      <span className="flex-1 truncate text-mf-txt2">{r.route}</span>
                      {isBest && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] bg-amber-500/15 text-amber-300">meilleure</span>}
                      {isActive && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] bg-emerald-500/15 text-emerald-300">active</span>}
                      <span className="w-16 shrink-0 text-right text-[9px] text-mf-txt4">
                        confiance {r.confidence === 'high' ? 'élevée' : r.confidence === 'medium' ? 'moyenne' : 'faible'}
                      </span>
                      <span className="w-14 shrink-0 text-right text-[9px] text-mf-txt4">
                        données {r.dataQualityScore}%
                      </span>
                      <span className={`w-16 shrink-0 text-right font-mono font-bold ${isBest ? 'text-amber-300' : 'text-mf-txt2'}`}>
                        {formatDecimalGrouped(r.recovery_pct, 1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Un écart favorable est une OPPORTUNITÉ à instruire, pas une
                  correction à appliquer d'office : le flowsheet reste le choix
                  du métallurgiste, et une meilleure récupération se paie en
                  CAPEX et en OPEX que ce classement n'arbitre pas. */}
              {bestGainPts != null && bestGainPts > 0.05 && (
                <div className="text-[9px] text-amber-400/80 mt-2">
                  La meilleure combinaison chiffrable, <strong>{bestRoute?.route}</strong>, rendrait{' '}
                  {formatDecimalGrouped(bestGainPts, 1)} pt de plus que la route active
                  ({formatDecimalGrouped(bestRoute?.recovery_pct ?? 0, 1)}% contre {formatDecimalGrouped(globalValue, 1)}%).
                  À instruire au regard du CAPEX et de l'OPEX qu'elle ajoute — ce classement ne compare que la récupération.
                </div>
              )}
              {bestIsActive && routeCandidates.length > 1 && auditedRecoveryBasis == null && (
                <div className="text-[9px] text-emerald-400/70 mt-2">
                  La route active est déjà la meilleure combinaison que les essais soutiennent.
                </div>
              )}
              {auditedRecoveryBasis != null && (
                <div className="text-[9px] text-mf-txt4 mt-2">
                  Classement indicatif : la récupération du projet vient de sa courbe AUDITÉE, qui prime sur
                  toute reconstitution par composition d'étages.
                </div>
              )}
            </div>
          )}
          {domainRecovery && (
            <div className="mt-4 pt-3 border-t border-mf-border/60">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-medium text-mf-txt3">
                  Récupération par domaine géométallurgique
                </div>
                {/* Sans domaine mesuré, la comparaison métal / tonnage oppose deux
                    fois le même nombre : ne l'afficher que quand elle discrimine. */}
                <span className="text-[9px] text-mf-txt4">
                  {domainRecovery.hasMeasuredDomain
                    ? <>pondérée par le métal contenu · par tonnage : {formatDecimalGrouped(domainRecovery.tonnageWeightedPct, 1)}%</>
                    : <>parts de métal contenu réelles · récupérations toutes imputées</>}
                </span>
              </div>
              <div className="space-y-1">
                {domainRecovery.byDomain.map(d => (
                  <div key={d.domain} className="flex items-center gap-2 text-[10px]">
                    <span className="w-28 truncate text-mf-txt3 capitalize">{d.domain}</span>
                    <div className="flex-1 h-2 rounded bg-mf-panel/60 overflow-hidden">
                      <div
                        className={d.imputed ? 'h-full bg-amber-500/60' : 'h-full bg-teal-500/70'}
                        style={{ width: `${Math.min(100, d.metalSharePct)}%` }}
                      />
                    </div>
                    <span className="w-14 text-right font-mono text-mf-txt3">
                      {formatDecimalGrouped(d.recoveryPct, 1)}%
                    </span>
                    <span className="w-16 text-right text-mf-txt4">
                      {formatDecimalGrouped(d.metalSharePct, 0)}% du métal
                    </span>
                    {d.imputed && <span className="text-amber-400" title="Aucun essai sur ce domaine — récupération imputée">imputé</span>}
                  </div>
                ))}
              </div>
              {domainRecovery.imputedDomains.length > 0 && (
                <div className="text-[9px] text-amber-400/80 mt-2">
                  {domainRecovery.hasMeasuredDomain
                    ? <>{domainRecovery.imputedDomains.length} domaine(s) sans essais — à caractériser avant publication.</>
                    : <>Aucun domaine du modèle de blocs n'a d'essais rattachés : les {domainRecovery.imputedDomains.length} récupérations
                       ci-dessus recopient la récupération projet, elles ne la fondent pas. Vérifiez que le champ « domaine » des
                       échantillons LIMS emploie les mêmes libellés que la lithologie du modèle de blocs.</>}
                </div>
              )}
            </div>
          )}
          {/* Un histogramme d'UNE barre ne compare rien : il n'a de sens qu'à partir
              de deux étages à mettre en regard. */}
          {recoveryCards.length > 1 && (
            <div className="mt-4 pt-3 border-t border-mf-border/60">
              <BarChart
                labels={recoveryCards.map(rc => rc.short)}
                values={recoveryCards.map(rc => rc.value)}
                color="#2DD4BF"
                height={160}
                yFormat={v => `${v.toFixed(0)}%`}
              />
            </div>
          )}
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
              { label: 'Récupération', value: `${formatDecimalGrouped(effectiveRecoveryPct, 1)}%`, note: globalRecoveryPct != null ? 'globale (testwork)' : 'design' },
              { label: 'Disponibilité', value: `${project.availability_pct}%`, note: 'usine' },
              { label: 'Densité minerai', value: `${project.ore_sg} t/m³`, note: 'SG' },
              { label: 'Prix Au', value: `$${project.gold_price_usd}/oz`, note: 'hypothèse' },
              { label: 'Heures/an', value: hoursPerYear != null ? `${hoursPerYear}h` : '—', note: settings ? 'configuré' : 'à configurer' },
              { label: 'Taux actualisation', value: settings?.discount_rate_pct != null ? `${settings.discount_rate_pct}%` : '—', note: settings?.discount_rate_pct ? 'DCF' : 'à configurer' },
              { label: 'Durée LOM', value: settings?.lom_years != null ? `${settings.lom_years} ans` : '—', note: settings?.lom_years ? 'LOM' : 'à configurer' },
              { label: 'OPEX total', value: totalOpex > 0 ? `${formatDecimalGrouped(totalOpex, 2)} $/t` : '—', note: opexLines.length > 0 ? `${opexLines.length} lignes` : 'à saisir' },
              { label: 'CAPEX total', value: totalCapex > 0 ? `${formatDecimalGrouped(totalCapex, 1)} M$` : '—', note: capexLines.length > 0 ? `${capexLines.length} lignes` : 'à saisir' },
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

        {/* Scenario snapshots (T4) — decision memory */}
        <SnapshotsPanel
          project={project}
          settingsState={(settings ?? {}) as Record<string, unknown>}
          kpi={{
            annualOz: annualOz > 0 ? annualOz : null,
            revenueMusd: annualOz > 0 ? revenueM : null,
            totalCapexMusd: totalCapex,
            totalOpexUsdT: totalOpex,
            aiscUsdOz: aisc,
            effectiveRecoveryPct,
          }}
          onRestored={onProjectUpdated}
        />

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
