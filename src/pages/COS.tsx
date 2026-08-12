import { useState, useEffect, useCallback } from 'react';
import {
  Activity, AlertTriangle, Wrench, Blend, Scale, Bell, Lightbulb,
  TrendingUp, Gauge, Zap, ShieldCheck, Plus, RefreshCw,
  CheckCircle2, XCircle, ArrowRight, Cpu, Database,
  FileJson, Copy, Download, Save, Check, FileSpreadsheet, Upload, Code2,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { KpiCard } from '../components/ui/KpiCard';
import { Modal } from '../components/ui/Modal';
import { supabase } from '../lib/supabase';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  optimizeBlend, runReconciliation, computeStreamBalance,
  detectBottlenecks, generateEquipmentAlerts, generateStreamAlerts,
  generateRecommendations, classifyHealth,
  BLEND_GRADE_WINDOW, DEFAULT_BLEND_QUALITY_LIMITS,
  type BlendResult, type ReconciliationResult, type StreamBalance,
  type AlertSeed, type RecoSeed, type BlendInput,
} from '../lib/cos/engine';
import {
  COS_INGESTION_TEMPLATES, INGESTION_QUALITY_FLAGS, defaultIngestionConfig,
  groupTemplatesBySection,
  type IngestionConfig, type TemplateContext,
} from '../lib/cos/ingestionTemplates';
import { IngestionImportPanel } from '../components/cos/IngestionImportPanel';
import { CosExcelImportModal } from '../components/cos/CosExcelImportModal';
import { WlsReconciliationPanel } from '../components/cos/WlsReconciliationPanel';
import { DigitalTwinPanel } from '../components/cos/DigitalTwinPanel';
import { COS_TEMPLATES, downloadCosXlsxTemplate } from '../lib/cos/cosTemplates';
import { datasetDef, type ImportDatasetId } from '../lib/cos/ingestionImport';
import type { Project, CosEquipmentStatus, CosOreLot, CosStockpile, CosBlendPlan, CosStream, CosAlert, CosRecommendation } from '../types';

type Tab = 'overview' | 'equipment' | 'blending' | 'reconciliation' | 'twin' | 'alerts' | 'recommendations' | 'ingestion';

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview',        label: 'Vue usine',         icon: Activity },
  { id: 'equipment',       label: 'Équipements',        icon: Wrench },
  { id: 'blending',        label: 'Blending',           icon: Blend },
  { id: 'reconciliation',  label: 'Réconciliation',    icon: Scale },
  { id: 'twin',            label: 'Jumeau numérique',   icon: Activity },
  { id: 'alerts',          label: 'Alertes',            icon: Bell },
  { id: 'recommendations', label: 'Recommandations',   icon: Lightbulb },
  { id: 'ingestion',       label: 'Ingestion',          icon: FileJson },
];

interface CosPageProps { project: Project; }

export function COS({ project }: CosPageProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [equipment, setEquipment] = useState<CosEquipmentStatus[]>([]);
  const [oreLots, setOreLots] = useState<CosOreLot[]>([]);
  const [stockpiles, setStockpiles] = useState<CosStockpile[]>([]);
  const [blendPlans, setBlendPlans] = useState<CosBlendPlan[]>([]);
  const [streams, setStreams] = useState<CosStream[]>([]);
  const [alerts, setAlerts] = useState<CosAlert[]>([]);
  const [recommendations, setRecommendations] = useState<CosRecommendation[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const pid = project.id;
    const [eq, lots, sp, bp, st, al, rc] = await Promise.all([
      supabase.from('cos_equipment_status').select('*').eq('project_id', pid).order('equipment_tag'),
      supabase.from('cos_ore_lots').select('*').eq('project_id', pid).order('created_at', { ascending: false }),
      supabase.from('cos_stockpiles').select('*').eq('project_id', pid).order('name'),
      supabase.from('cos_blend_plans').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(10),
      supabase.from('cos_streams').select('*').eq('project_id', pid).order('stream_id'),
      supabase.from('cos_alerts').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(50),
      supabase.from('cos_recommendations').select('*').eq('project_id', pid).order('created_at', { ascending: false }).limit(50),
    ]);
    setEquipment((eq.data ?? []) as CosEquipmentStatus[]);
    setOreLots((lots.data ?? []) as CosOreLot[]);
    setStockpiles((sp.data ?? []) as CosStockpile[]);
    setBlendPlans((bp.data ?? []) as CosBlendPlan[]);
    setStreams((st.data ?? []) as CosStream[]);
    setAlerts((al.data ?? []) as CosAlert[]);
    setRecommendations((rc.data ?? []) as CosRecommendation[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // Derived data
  const blendInput: BlendInput[] = oreLots.map(l => ({
    lotId: l.lot_id, sourceName: l.source_name, auGt: l.au_g_t,
    bwi: l.bwi, sulfidesPct: l.sulfides_pct, organicCarbonPct: l.organic_carbon_pct,
    clayPct: l.clay_pct, tonnageT: l.tonnage_t, isAvailable: l.is_available,
  }));
  const blendResult = oreLots.length > 0 ? optimizeBlend(blendInput, {
    targetTph: project.target_tph, targetAuGt: project.gold_grade_g_t,
    minAuGt: project.gold_grade_g_t * BLEND_GRADE_WINDOW.minFactor,
    maxAuGt: project.gold_grade_g_t * BLEND_GRADE_WINDOW.maxFactor,
    ...DEFAULT_BLEND_QUALITY_LIMITS,
  }) : null;
  const streamBalance: StreamBalance = computeStreamBalance(streams);
  const bottlenecks = detectBottlenecks(equipment);
  const activeAlerts = alerts.filter(a => a.status === 'active');
  const pendingRecos = recommendations.filter(r => r.status === 'pending_approval');
  const avgHealth = equipment.length > 0
    ? equipment.reduce((s, e) => s + e.health_index, 0) / equipment.length
    : 100;
  const runningCount = equipment.filter(e => e.state === 'running').length;
  const faultCount = equipment.filter(e => e.state === 'fault').length;

  // Generated alerts from current data (not yet persisted)
  const generatedAlerts: AlertSeed[] = [
    ...generateEquipmentAlerts(equipment),
    ...generateStreamAlerts(streams),
  ];
  const generatedRecos: RecoSeed[] = generateRecommendations(equipment, streams, blendResult);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Système d'Exploitation Cognitif"
        subtitle={`COS — ${project.name} · ${equipment.length} équipements · ${activeAlerts.length} alertes actives`}
        breadcrumb={['Optimisation', 'COS']}
        icon={<Cpu size={20} />}
        actions={
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
          </button>
        }
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-8 py-3 border-b border-mf-border bg-mf-card/50">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          const badge = t.id === 'alerts' && activeAlerts.length > 0
            ? activeAlerts.length
            : t.id === 'recommendations' && pendingRecos.length > 0
            ? pendingRecos.length
            : 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : 'text-mf-txt4 hover:text-mf-txt2 hover:bg-mf-panel border border-transparent'
              }`}
            >
              <Icon size={15} />
              {t.label}
              {badge > 0 && (
                <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500/20 text-red-400">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-mf-txt4">
            <RefreshCw size={18} className="animate-spin mr-2" /> Chargement COS…
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <OverviewTab
                equipment={equipment}
                streams={streams}
                blendResult={blendResult}
                streamBalance={streamBalance}
                bottlenecks={bottlenecks}
                avgHealth={avgHealth}
                runningCount={runningCount}
                faultCount={faultCount}
                activeAlertCount={activeAlerts.length}
                pendingRecoCount={pendingRecos.length}
                generatedAlerts={generatedAlerts}
                generatedRecos={generatedRecos}
              />
            )}
            {tab === 'equipment' && (
              <EquipmentTab project={project} equipment={equipment} onRefresh={load} />
            )}
            {tab === 'blending' && (
              <BlendingTab project={project} oreLots={oreLots} blendPlans={blendPlans} blendResult={blendResult} onRefresh={load} />
            )}
            {tab === 'reconciliation' && (
              <ReconciliationTab project={project} streams={streams} streamBalance={streamBalance} onRefresh={load} />
            )}
            {tab === 'twin' && (
              <DigitalTwinPanel project={project} />
            )}
            {tab === 'alerts' && (
              <AlertsTab project={project} alerts={alerts} generatedAlerts={generatedAlerts} onRefresh={load} />
            )}
            {tab === 'recommendations' && (
              <RecommendationsTab project={project} recommendations={recommendations} generatedRecos={generatedRecos} onRefresh={load} />
            )}
            {tab === 'ingestion' && (
              <IngestionTab
                project={project}
                equipment={equipment}
                oreLots={oreLots}
                stockpiles={stockpiles}
                streams={streams}
                onImported={load}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Overview Tab
// ═══════════════════════════════════════════════════════════════

interface OverviewProps {
  equipment: CosEquipmentStatus[];
  streams: CosStream[];
  blendResult: BlendResult | null;
  streamBalance: StreamBalance;
  bottlenecks: CosEquipmentStatus[];
  avgHealth: number;
  runningCount: number;
  faultCount: number;
  activeAlertCount: number;
  pendingRecoCount: number;
  generatedAlerts: AlertSeed[];
  generatedRecos: RecoSeed[];
}

function OverviewTab({
  equipment, streams, blendResult, streamBalance, bottlenecks,
  avgHealth, runningCount, faultCount, activeAlertCount, pendingRecoCount,
  generatedAlerts, generatedRecos,
}: OverviewProps) {
  const healthClass = classifyHealth(avgHealth);
  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Santé moyenne" value={avgHealth.toFixed(0)} unit="/100" icon={<Gauge size={16} />} color={avgHealth >= 80 ? 'green' : avgHealth >= 60 ? 'gold' : 'red'} sub={healthClass.label} />
        <KpiCard label="Équipements actifs" value={runningCount} unit={`/${equipment.length}`} icon={<Activity size={16} />} color="teal" sub={`${faultCount} en panne`} />
        <KpiCard label="Débit total" value={streamBalance.totalFeedTph} unit="t/h" icon={<Zap size={16} />} color="blue" sub={`Clôture: ${streamBalance.massClosurePct}%`} />
        <KpiCard label="Alertes actives" value={activeAlertCount} icon={<AlertTriangle size={16} />} color={activeAlertCount > 0 ? 'red' : 'green'} sub={generatedAlerts.length > 0 ? `${generatedAlerts.length} détectées` : 'Aucune'} />
        <KpiCard label="Recos en attente" value={pendingRecoCount} icon={<Lightbulb size={16} />} color="gold" sub={generatedRecos.length > 0 ? `${generatedRecos.length} générées` : 'Aucune'} />
        <KpiCard label="Teneur blend" value={blendResult?.blendedAuGt ?? '—'} unit="g/t" icon={<TrendingUp size={16} />} color="gold" sub={blendResult ? `${blendResult.predictedRecoveryPct}% Récup.` : 'N/A'} />
      </div>

      {/* Process synoptic */}
      <div className="card">
        <div className="section-title mb-4">Synoptique procédé</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {PROCESS_SECTIONS.map(section => {
            const sectionEquip = equipment.filter(e => e.section === section.id);
            const sectionStreams = streams.filter(s => s.section === section.id);
            const hasIssue = sectionEquip.some(e => e.state === 'fault' || e.health_index < 50);
            const hasBottleneck = sectionEquip.some(e => e.is_bottleneck);
            return (
              <div
                key={section.id}
                className={`rounded-lg border p-3 ${
                  hasIssue ? 'border-red-500/30 bg-red-500/5'
                  : hasBottleneck ? 'border-amber-500/30 bg-amber-500/5'
                  : 'border-mf-border bg-mf-panel/50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-mf-txt2">{section.label}</span>
                  {hasIssue && <AlertTriangle size={12} className="text-red-400" />}
                  {hasBottleneck && !hasIssue && <Gauge size={12} className="text-amber-400" />}
                </div>
                <div className="text-[10px] text-mf-txt4 space-y-0.5">
                  <div>{sectionEquip.length} équipements · {sectionStreams.length} courants</div>
                  {sectionEquip.filter(e => e.state === 'running').length > 0 && (
                    <div className="text-emerald-400">{sectionEquip.filter(e => e.state === 'running').length} en marche</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottlenecks + Data quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Gauge size={15} className="text-amber-400" /> Goulots d'étranglement
          </div>
          {bottlenecks.length === 0 ? (
            <div className="text-sm text-mf-txt4 py-4 text-center">Aucun goulot détecté</div>
          ) : (
            <div className="space-y-2">
              {bottlenecks.map((eq, i) => (
                <div key={eq.id} className="flex items-center gap-3 p-2 rounded-lg bg-mf-panel/50">
                  <span className="text-xs font-bold text-amber-400">#{i + 1}</span>
                  <div className="flex-1">
                    <div className="text-sm text-mf-txt">{eq.equipment_name}</div>
                    <div className="text-[10px] text-mf-txt4">{eq.section} · charge {eq.load_pct}%</div>
                  </div>
                  <div className={`text-xs font-semibold ${eq.load_pct > 90 ? 'text-red-400' : 'text-amber-400'}`}>
                    {eq.load_pct}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Database size={15} className="text-blue-400" /> Qualité des données
          </div>
          {streamBalance.dataQualityIssues.length === 0 ? (
            <div className="text-sm text-mf-txt4 py-4 text-center">Tous les courants sont qualifiés "bon"</div>
          ) : (
            <div className="space-y-1.5">
              {streamBalance.dataQualityIssues.map((issue, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-mf-txt3 p-2 rounded-lg bg-mf-panel/50">
                  <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                  {issue}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent alerts + recommendations preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Bell size={15} className="text-red-400" /> Alertes détectées (temps réel)
          </div>
          {generatedAlerts.length === 0 ? (
            <div className="text-sm text-mf-txt4 py-4 text-center">Aucune alerte générée</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {generatedAlerts.slice(0, 8).map((a, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-mf-panel/50">
                  <AlertTriangle size={12} className={`mt-0.5 shrink-0 ${
                    a.severity === 'urgent' ? 'text-red-400'
                    : a.severity === 'high' ? 'text-orange-400'
                    : a.severity === 'medium' ? 'text-amber-400'
                    : 'text-mf-txt4'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-mf-txt2 truncate">{a.entity_name}</div>
                    <div className="text-[10px] text-mf-txt4">{a.description}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Lightbulb size={15} className="text-amber-400" /> Recommandations cognitives
          </div>
          {generatedRecos.length === 0 ? (
            <div className="text-sm text-mf-txt4 py-4 text-center">Aucune recommandation générée</div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {generatedRecos.slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-mf-panel/50">
                  <Lightbulb size={12} className="mt-0.5 text-amber-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-mf-txt2 truncate">{r.objective}</div>
                    <div className="text-[10px] text-mf-txt4">{r.description}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-emerald-400">Confiance: {(r.confidence * 100).toFixed(0)}%</span>
                      {Object.entries(r.expected_delta).map(([k, v]) => (
                        <span key={k} className="text-[10px] text-mf-txt4">{k}: {v}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const PROCESS_SECTIONS = [
  { id: 'crushing',  label: 'Concassage' },
  { id: 'grinding',  label: 'Broyage' },
  { id: 'gravity',   label: 'Gravimétrie' },
  { id: 'flotation', label: 'Flottation' },
  { id: 'leaching',  label: 'Lixiviation' },
  { id: 'adr',       label: 'ADR / Doré' },
];

// ═══════════════════════════════════════════════════════════════
// Equipment Tab
// ═══════════════════════════════════════════════════════════════

interface EquipmentTabProps {
  project: Project;
  equipment: CosEquipmentStatus[];
  onRefresh: () => void;
}

function EquipmentTab({ project, equipment, onRefresh }: EquipmentTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    equipment_tag: '', equipment_name: '', section: 'grinding',
    state: 'running' as CosEquipmentStatus['state'],
    load_pct: 0, availability_pct: 100, utilization_pct: 0,
    mtbf_h: 0, mttr_h: 0, health_index: 100,
  });

  async function handleAdd() {
    await supabase.from('cos_equipment_status').insert({
      project_id: project.id,
      ...form,
      load_pct: Number(form.load_pct),
      availability_pct: Number(form.availability_pct),
      utilization_pct: Number(form.utilization_pct),
      mtbf_h: Number(form.mtbf_h),
      mttr_h: Number(form.mttr_h),
      health_index: Number(form.health_index),
      oee_pct: (Number(form.availability_pct) / 100) * (Number(form.utilization_pct) / 100) * 100,
    });
    setShowModal(false);
    onRefresh();
  }

  async function updateField(id: string, field: string, value: unknown) {
    await supabase.from('cos_equipment_status').update({ [field]: value, last_updated: new Date().toISOString() }).eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
          <Plus size={14} /> Ajouter équipement COS
        </button>
      </div>

      {equipment.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-14 h-14 rounded-xl bg-mf-panel flex items-center justify-center">
            <Wrench size={24} className="text-mf-txt3" />
          </div>
          <div>
            <div className="text-mf-txt font-semibold mb-1">Aucun équipement suivi</div>
            <div className="text-sm text-mf-txt4 max-w-sm">
              Ajoutez des équipements pour suivre leur santé, disponibilité et prédiction de panne.
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {equipment.map(eq => {
            const hc = classifyHealth(eq.health_index);
            return (
              <div key={eq.id} className={`card border ${eq.is_bottleneck ? 'border-amber-500/30' : 'border-mf-border'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold text-mf-txt">{eq.equipment_name}</div>
                    <div className="text-[10px] text-mf-txt4 font-mono">{eq.equipment_tag} · {eq.section}</div>
                  </div>
                  <div className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                    eq.state === 'running' ? 'bg-emerald-500/15 text-emerald-400'
                    : eq.state === 'fault' ? 'bg-red-500/15 text-red-400'
                    : eq.state === 'maintenance' ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-mf-panel text-mf-txt4'
                  }`}>
                    {eq.state}
                  </div>
                </div>

                {/* Health bar */}
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="text-mf-txt4">Indice de santé</span>
                    <span className={`font-semibold ${hc.color}`}>{eq.health_index}/100 · {hc.label}</span>
                  </div>
                  <div className="h-2 rounded-full bg-mf-panel overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        eq.health_index >= 80 ? 'bg-emerald-500'
                        : eq.health_index >= 60 ? 'bg-amber-500'
                        : eq.health_index >= 40 ? 'bg-orange-500'
                        : 'bg-red-500'
                      }`}
                      style={{ width: `${eq.health_index}%` }}
                    />
                  </div>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-mf-panel/50 p-2">
                    <div className="text-[9px] text-mf-txt4 uppercase">Dispo.</div>
                    <div className="text-sm font-semibold text-mf-txt">{eq.availability_pct}%</div>
                  </div>
                  <div className="rounded-lg bg-mf-panel/50 p-2">
                    <div className="text-[9px] text-mf-txt4 uppercase">OEE</div>
                    <div className="text-sm font-semibold text-mf-txt">{eq.oee_pct}%</div>
                  </div>
                  <div className="rounded-lg bg-mf-panel/50 p-2">
                    <div className="text-[9px] text-mf-txt4 uppercase">Charge</div>
                    <div className="text-sm font-semibold text-mf-txt">{eq.load_pct}%</div>
                  </div>
                </div>

                {/* Predictive info */}
                <div className="mt-3 pt-3 border-t border-mf-border/50 space-y-1">
                  {eq.rul_h != null && (
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-mf-txt4">RUL</span>
                      <span className="text-mf-txt3 font-mono">{eq.rul_h} h</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-mf-txt4">P(panne 24h)</span>
                    <span className={`font-mono ${(eq.failure_prob_24h * 100) > 50 ? 'text-red-400' : 'text-mf-txt3'}`}>
                      {(eq.failure_prob_24h * 100).toFixed(0)}%
                    </span>
                  </div>
                  {eq.is_bottleneck && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-400">
                      <Gauge size={10} /> Goulot identifié
                    </div>
                  )}
                  {eq.downtime_reason && (
                    <div className="text-[10px] text-red-400">Cause: {eq.downtime_reason}</div>
                  )}
                </div>

                {/* State selector */}
                <select
                  value={eq.state}
                  onChange={e => updateField(eq.id, 'state', e.target.value)}
                  className="input-field mt-3 text-xs"
                >
                  <option value="running">Running</option>
                  <option value="idle">Idle</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="fault">Fault</option>
                </select>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <Modal title="Ajouter équipement COS" onClose={() => setShowModal(false)} width="md"
          footer={<><button className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button><button className="btn btn-primary" onClick={handleAdd}>Ajouter</button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Tag équipement *</label>
                <input className="input-field font-mono" placeholder="ex. MILL-01"
                  value={form.equipment_tag} onChange={e => setForm(f => ({ ...f, equipment_tag: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nom *</label>
                <input className="input-field" placeholder="ex. Broyeur SAG N°1"
                  value={form.equipment_name} onChange={e => setForm(f => ({ ...f, equipment_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Section</label>
                <select className="input-field" value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))}>
                  {PROCESS_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  <option value="general">Général</option>
                </select>
              </div>
              <div>
                <label className="label">État</label>
                <select className="input-field" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value as CosEquipmentStatus['state'] }))}>
                  <option value="running">Running</option>
                  <option value="idle">Idle</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="fault">Fault</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Charge (%)</label>
                <input type="number" className="input-field font-mono" value={form.load_pct} onChange={e => setForm(f => ({ ...f, load_pct: e.target.value as unknown as number }))} />
              </div>
              <div>
                <label className="label">Dispo. (%)</label>
                <input type="number" className="input-field font-mono" value={form.availability_pct} onChange={e => setForm(f => ({ ...f, availability_pct: e.target.value as unknown as number }))} />
              </div>
              <div>
                <label className="label">Santé (/100)</label>
                <input type="number" className="input-field font-mono" value={form.health_index} onChange={e => setForm(f => ({ ...f, health_index: e.target.value as unknown as number }))} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Blending Tab
// ═══════════════════════════════════════════════════════════════

interface BlendingTabProps {
  project: Project;
  oreLots: CosOreLot[];
  blendPlans: CosBlendPlan[];
  blendResult: BlendResult | null;
  onRefresh: () => void;
}

function BlendingTab({ project, oreLots, blendPlans, blendResult, onRefresh }: BlendingTabProps) {
  const [showLotModal, setShowLotModal] = useState(false);
  const [lotForm, setLotForm] = useState({
    lot_id: '', source_name: '', au_g_t: '', bwi: '', sulfides_pct: '',
    organic_carbon_pct: '', clay_pct: '', tonnage_t: '',
  });

  async function handleAddLot() {
    await supabase.from('cos_ore_lots').insert({
      project_id: project.id,
      lot_id: lotForm.lot_id,
      source_name: lotForm.source_name,
      au_g_t: Number(lotForm.au_g_t),
      bwi: lotForm.bwi ? Number(lotForm.bwi) : null,
      sulfides_pct: Number(lotForm.sulfides_pct) || 0,
      organic_carbon_pct: Number(lotForm.organic_carbon_pct) || 0,
      clay_pct: Number(lotForm.clay_pct) || 0,
      tonnage_t: Number(lotForm.tonnage_t),
    });
    setShowLotModal(false);
    setLotForm({ lot_id: '', source_name: '', au_g_t: '', bwi: '', sulfides_pct: '', organic_carbon_pct: '', clay_pct: '', tonnage_t: '' });
    onRefresh();
  }

  async function saveBlendPlan() {
    if (!blendResult) return;
    const shiftLabel = `${new Date().toISOString().slice(0, 10)} Quart`;
    const { data: plan } = await supabase.from('cos_blend_plans').insert({
      project_id: project.id,
      shift_label: shiftLabel,
      target_tph: project.target_tph,
      target_au_g_t: project.gold_grade_g_t,
      predicted_au_g_t: blendResult.blendedAuGt,
      predicted_recovery_pct: blendResult.predictedRecoveryPct,
      predicted_throughput_tph: blendResult.totalTph,
      predicted_nacn_kg_t: blendResult.predictedNacnKgT,
      predicted_cao_kg_t: blendResult.predictedCaoKgT,
      status: 'proposed',
    }).select('*').maybeSingle();

    if (plan && blendResult.sources.length > 0) {
      await supabase.from('cos_blend_sources').insert(
        blendResult.sources.map(s => ({
          project_id: project.id,
          blend_plan_id: plan.id,
          lot_id: s.lotId,
          source_name: s.sourceName,
          proportion_pct: s.proportionPct,
          tph: s.tph,
          au_g_t: s.auGt,
          bwi: s.bwi,
        })),
      );
    }
    onRefresh();
  }

  return (
    <div className="space-y-5">
      {/* Blend optimizer result */}
      {blendResult && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div className="section-title flex items-center gap-2">
              <Blend size={15} className="text-amber-400" /> Plan de blend optimisé
            </div>
            <button className="btn btn-primary btn-sm" onClick={saveBlendPlan}>
              <CheckCircle2 size={14} /> Sauvegarder le plan
            </button>
          </div>

          {/* Blend KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Teneur blend</div>
              <div className="text-lg font-bold text-amber-400">{blendResult.blendedAuGt} g/t</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Débit total</div>
              <div className="text-lg font-bold text-mf-txt">{blendResult.totalTph} t/h</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Récup. prédite</div>
              <div className="text-lg font-bold text-emerald-400">{blendResult.predictedRecoveryPct}%</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">CN⁻ prédit</div>
              <div className="text-lg font-bold text-mf-txt">{blendResult.predictedNacnKgT} kg/t</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Chaux prédite</div>
              <div className="text-lg font-bold text-mf-txt">{blendResult.predictedCaoKgT} kg/t</div>
            </div>
          </div>

          {/* Feasibility */}
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm mb-4 ${
            blendResult.feasible ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {blendResult.feasible ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            {blendResult.feasible ? 'Plan réalisable — toutes contraintes respectées' : 'Plan non conforme — contraintes dépassées'}
          </div>

          {/* Warnings */}
          {blendResult.warnings.length > 0 && (
            <div className="space-y-1 mb-4">
              {blendResult.warnings.map((w, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-amber-400 px-3 py-1.5 rounded-lg bg-amber-500/5">
                  <AlertTriangle size={11} /> {w}
                </div>
              ))}
            </div>
          )}

          {/* Sources table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                  <th className="py-2 pr-4">Lot</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4 text-right">Proportion</th>
                  <th className="py-2 pr-4 text-right">Débit (t/h)</th>
                  <th className="py-2 pr-4 text-right">Au (g/t)</th>
                  <th className="py-2 pr-4 text-right">BWI</th>
                </tr>
              </thead>
              <tbody>
                {blendResult.sources.map((s, i) => (
                  <tr key={i} className="border-b border-mf-border/30">
                    <td className="py-2 pr-4 font-mono text-xs text-mf-txt3">{s.lotId}</td>
                    <td className="py-2 pr-4 text-mf-txt2">{s.sourceName}</td>
                    <td className="py-2 pr-4 text-right text-mf-txt">{s.proportionPct}%</td>
                    <td className="py-2 pr-4 text-right text-mf-txt font-mono">{s.tph}</td>
                    <td className="py-2 pr-4 text-right text-amber-400 font-mono">{s.auGt}</td>
                    <td className="py-2 pr-4 text-right text-mf-txt3 font-mono">{s.bwi ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ore lots management */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="section-title">Lots de minerai ({oreLots.length})</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLotModal(true)}>
            <Plus size={14} /> Ajouter lot
          </button>
        </div>
        {oreLots.length === 0 ? (
          <div className="text-sm text-mf-txt4 py-8 text-center">
            Aucun lot de minerai. Ajoutez des lots pour calculer un plan de blend.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                  <th className="py-2 pr-3">Lot ID</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Au (g/t)</th>
                  <th className="py-2 pr-3 text-right">BWI</th>
                  <th className="py-2 pr-3 text-right">Sulfures %</th>
                  <th className="py-2 pr-3 text-right">PRC %</th>
                  <th className="py-2 pr-3 text-right">Tonnage (t)</th>
                  <th className="py-2 pr-3">Dispo</th>
                </tr>
              </thead>
              <tbody>
                {oreLots.map(lot => (
                  <tr key={lot.id} className="border-b border-mf-border/30">
                    <td className="py-2 pr-3 font-mono text-xs text-mf-txt3">{lot.lot_id}</td>
                    <td className="py-2 pr-3 text-mf-txt2">{lot.source_name}</td>
                    <td className="py-2 pr-3 text-right text-amber-400 font-mono">{lot.au_g_t}</td>
                    <td className="py-2 pr-3 text-right text-mf-txt3 font-mono">{lot.bwi ?? '—'}</td>
                    <td className="py-2 pr-3 text-right text-mf-txt3 font-mono">{lot.sulfides_pct}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${lot.organic_carbon_pct > 1 ? 'text-red-400' : 'text-mf-txt3'}`}>{lot.organic_carbon_pct}</td>
                    <td className="py-2 pr-3 text-right text-mf-txt font-mono">{formatDecimalGrouped(lot.tonnage_t, 0)}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${lot.is_available ? 'bg-emerald-500/15 text-emerald-400' : 'bg-mf-panel text-mf-txt4'}`}>
                        {lot.is_available ? 'Oui' : 'Non'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Saved blend plans */}
      {blendPlans.length > 0 && (
        <div className="card">
          <div className="section-title mb-4">Plans de blend sauvegardés</div>
          <div className="space-y-2">
            {blendPlans.map(bp => (
              <div key={bp.id} className="flex items-center justify-between p-3 rounded-lg bg-mf-panel/50">
                <div>
                  <div className="text-sm text-mf-txt">{bp.shift_label}</div>
                  <div className="text-[10px] text-mf-txt4">
                    {bp.predicted_au_g_t ?? '—'} g/t · {bp.predicted_recovery_pct ?? '—'}% récup · {bp.predicted_throughput_tph ?? '—'} t/h
                  </div>
                </div>
                <span className={`px-2 py-0.5 text-[10px] rounded-full ${
                  bp.status === 'executed' ? 'bg-emerald-500/15 text-emerald-400'
                  : bp.status === 'approved' ? 'bg-blue-500/15 text-blue-400'
                  : 'bg-mf-panel text-mf-txt4'
                }`}>
                  {bp.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showLotModal && (
        <Modal title="Ajouter lot de minerai" onClose={() => setShowLotModal(false)} width="md"
          footer={<><button className="btn btn-secondary" onClick={() => setShowLotModal(false)}>Annuler</button><button className="btn btn-primary" onClick={handleAddLot}>Ajouter</button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Lot ID *</label>
                <input className="input-field font-mono" placeholder="ex. LOT-001"
                  value={lotForm.lot_id} onChange={e => setLotForm(f => ({ ...f, lot_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">Source *</label>
                <input className="input-field" placeholder="ex. Stockpile Nord"
                  value={lotForm.source_name} onChange={e => setLotForm(f => ({ ...f, source_name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Au (g/t) *</label>
                <input type="number" step="0.01" className="input-field font-mono" value={lotForm.au_g_t} onChange={e => setLotForm(f => ({ ...f, au_g_t: e.target.value }))} />
              </div>
              <div>
                <label className="label">BWI</label>
                <input type="number" step="0.1" className="input-field font-mono" value={lotForm.bwi} onChange={e => setLotForm(f => ({ ...f, bwi: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tonnage (t) *</label>
                <input type="number" className="input-field font-mono" value={lotForm.tonnage_t} onChange={e => setLotForm(f => ({ ...f, tonnage_t: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Sulfures (%)</label>
                <input type="number" step="0.1" className="input-field font-mono" value={lotForm.sulfides_pct} onChange={e => setLotForm(f => ({ ...f, sulfides_pct: e.target.value }))} />
              </div>
              <div>
                <label className="label">C. organique (%)</label>
                <input type="number" step="0.01" className="input-field font-mono" value={lotForm.organic_carbon_pct} onChange={e => setLotForm(f => ({ ...f, organic_carbon_pct: e.target.value }))} />
              </div>
              <div>
                <label className="label">Argiles (%)</label>
                <input type="number" step="0.1" className="input-field font-mono" value={lotForm.clay_pct} onChange={e => setLotForm(f => ({ ...f, clay_pct: e.target.value }))} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Reconciliation Tab
// ═══════════════════════════════════════════════════════════════

interface ReconciliationTabProps {
  project: Project;
  streams: CosStream[];
  streamBalance: StreamBalance;
  onRefresh: () => void;
}

function ReconciliationTab({ project, streams, streamBalance, onRefresh }: ReconciliationTabProps) {
  const [reconMode, setReconMode] = useState<'rapide' | 'reseau'>('rapide');
  const [reconResult, setReconResult] = useState<ReconciliationResult | null>(null);
  const [reconForm, setReconForm] = useState({
    feed_mass_t: '', feed_au_g_t: '', product_mass_t: '', product_au_g_t: '',
    tail_mass_t: '', tail_au_g_t: '', delta_stock_g: '0',
    feed_uncertainty_pct: '5', product_uncertainty_pct: '3', tail_uncertainty_pct: '5',
  });
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [streamForm, setStreamForm] = useState({
    stream_id: '', name: '', section: 'leaching', stream_type: 'intermediate' as CosStream['stream_type'],
    mass_tph: '', au_g_t: '', data_quality: 'good' as CosStream['data_quality'],
  });

  async function handleRunReconciliation() {
    const result = runReconciliation({
      feedMassT: Number(reconForm.feed_mass_t) || 0,
      feedAuGt: Number(reconForm.feed_au_g_t) || 0,
      productMassT: Number(reconForm.product_mass_t) || 0,
      productAuGt: Number(reconForm.product_au_g_t) || 0,
      tailMassT: Number(reconForm.tail_mass_t) || 0,
      tailAuGt: Number(reconForm.tail_au_g_t) || 0,
      deltaStockG: Number(reconForm.delta_stock_g) || 0,
      feedUncertaintyPct: Number(reconForm.feed_uncertainty_pct) || 5,
      productUncertaintyPct: Number(reconForm.product_uncertainty_pct) || 3,
      tailUncertaintyPct: Number(reconForm.tail_uncertainty_pct) || 5,
    });
    setReconResult(result);
  }

  async function saveReconciliation() {
    if (!reconResult) return;
    const now = new Date();
    const label = `${now.toISOString().slice(0, 10)} Réconciliation`;
    await supabase.from('cos_reconciliation_periods').insert({
      project_id: project.id,
      period_type: 'day',
      period_label: label,
      start_time: new Date(now.getTime() - 86400000).toISOString(),
      end_time: now.toISOString(),
      feed_mass_t: Number(reconForm.feed_mass_t) || 0,
      feed_au_g_t: Number(reconForm.feed_au_g_t) || 0,
      product_mass_t: Number(reconForm.product_mass_t) || 0,
      product_au_g_t: Number(reconForm.product_au_g_t) || 0,
      tail_mass_t: Number(reconForm.tail_mass_t) || 0,
      tail_au_g_t: Number(reconForm.tail_au_g_t) || 0,
      feed_metal_g: reconResult.feedMetalG,
      product_metal_g: reconResult.productMetalG,
      tail_metal_g: reconResult.tailMetalG,
      delta_stock_g: Number(reconForm.delta_stock_g) || 0,
      unaccounted_metal_pct: reconResult.unaccountedMetalPct,
      recovery_pct: reconResult.recoveryPct,
      variance_pct: reconResult.variancePct,
      bias_flag: reconResult.biasFlag,
      has_provisional_data: streams.some(s => s.is_provisional),
      status: 'draft',
    });
    onRefresh();
  }

  async function handleAddStream() {
    await supabase.from('cos_streams').insert({
      project_id: project.id,
      stream_id: streamForm.stream_id,
      name: streamForm.name,
      section: streamForm.section,
      stream_type: streamForm.stream_type,
      mass_tph: Number(streamForm.mass_tph) || 0,
      au_g_t: Number(streamForm.au_g_t) || 0,
      data_quality: streamForm.data_quality,
    });
    setShowStreamModal(false);
    setStreamForm({ stream_id: '', name: '', section: 'leaching', stream_type: 'intermediate', mass_tph: '', au_g_t: '', data_quality: 'good' });
    onRefresh();
  }

  return (
    <div className="space-y-5">
      {/* P754 banner */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <ShieldCheck size={16} className="text-blue-400 shrink-0" />
        <div className="text-xs text-blue-300">
          Réconciliation conforme aux principes <span className="font-semibold">AMIRA P754</span> — Code of Practice for Metal Accounting
        </div>
      </div>

      {/* Bascule : bilan rapide (feed/product/tail) ou réconciliation réseau WLS */}
      <div className="flex items-center gap-1 border-b border-mf-border">
        {([['rapide', 'Bilan rapide'], ['reseau', 'Réconciliation réseau (WLS)']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setReconMode(id)}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
              reconMode === id ? 'border-teal-400 text-teal-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {reconMode === 'reseau' ? (
        <WlsReconciliationPanel />
      ) : (
      <>
      {/* Stream balance summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Débit alimentation" value={streamBalance.totalFeedTph} unit="t/h" icon={<Zap size={16} />} color="blue" sub={`${streams.filter(s => s.stream_type === 'feed').length} courants`} />
        <KpiCard label="Débit sortie" value={streamBalance.totalOutputTph} unit="t/h" icon={<ArrowRight size={16} />} color="teal" sub={`${streams.filter(s => s.stream_type === 'product' || s.stream_type === 'tail').length} courants`} />
        <KpiCard label="Clôture massique" value={streamBalance.massClosurePct} unit="%" icon={<Scale size={16} />} color={Math.abs(streamBalance.massClosurePct - 100) < 5 ? 'green' : 'red'} sub="Sortie/Entrée" />
        <KpiCard label="Balance métal" value={streamBalance.metalBalancePct} unit="%" icon={<TrendingUp size={16} />} color={Math.abs(streamBalance.metalBalancePct - 100) < 5 ? 'green' : 'red'} sub="Or produit/Or entré" />
      </div>

      {/* Streams table */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="section-title">Courants de matière ({streams.length})</div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowStreamModal(true)}>
            <Plus size={14} /> Ajouter courant
          </button>
        </div>
        {streams.length === 0 ? (
          <div className="text-sm text-mf-txt4 py-8 text-center">Aucun courant défini. Ajoutez les courants du procédé.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">Nom</th>
                  <th className="py-2 pr-3">Section</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Masse (t/h)</th>
                  <th className="py-2 pr-3 text-right">Au (g/t)</th>
                  <th className="py-2 pr-3">Qualité</th>
                </tr>
              </thead>
              <tbody>
                {streams.map(s => (
                  <tr key={s.id} className="border-b border-mf-border/30">
                    <td className="py-2 pr-3 font-mono text-xs text-mf-txt3">{s.stream_id}</td>
                    <td className="py-2 pr-3 text-mf-txt2">{s.name}</td>
                    <td className="py-2 pr-3 text-mf-txt4">{s.section}</td>
                    <td className="py-2 pr-3">
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                        s.stream_type === 'feed' ? 'bg-blue-500/15 text-blue-400'
                        : s.stream_type === 'product' ? 'bg-emerald-500/15 text-emerald-400'
                        : s.stream_type === 'tail' ? 'bg-red-500/15 text-red-400'
                        : 'bg-mf-panel text-mf-txt4'
                      }`}>{s.stream_type}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-mf-txt font-mono">{s.mass_tph}</td>
                    <td className="py-2 pr-3 text-right text-amber-400 font-mono">{s.au_g_t}</td>
                    <td className="py-2 pr-3">
                      <span className={`text-[10px] ${
                        s.data_quality === 'good' ? 'text-emerald-400'
                        : s.data_quality === 'frozen' ? 'text-blue-400'
                        : s.data_quality === 'missing' ? 'text-red-400'
                        : 'text-amber-400'
                      }`}>{s.data_quality}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reconciliation calculator */}
      <div className="card">
        <div className="section-title mb-4 flex items-center gap-2">
          <Scale size={15} className="text-amber-400" /> Calculateur de réconciliation métal
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Feed */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-blue-400">Alimentation</div>
            <div>
              <label className="label">Masse sèche (t)</label>
              <input type="number" className="input-field font-mono" value={reconForm.feed_mass_t} onChange={e => setReconForm(f => ({ ...f, feed_mass_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Teneur Au (g/t)</label>
              <input type="number" step="0.01" className="input-field font-mono" value={reconForm.feed_au_g_t} onChange={e => setReconForm(f => ({ ...f, feed_au_g_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Incertitude (%)</label>
              <input type="number" step="0.1" className="input-field font-mono" value={reconForm.feed_uncertainty_pct} onChange={e => setReconForm(f => ({ ...f, feed_uncertainty_pct: e.target.value }))} />
            </div>
          </div>

          {/* Product */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-emerald-400">Produit (Doré/Concentré)</div>
            <div>
              <label className="label">Masse sèche (t)</label>
              <input type="number" className="input-field font-mono" value={reconForm.product_mass_t} onChange={e => setReconForm(f => ({ ...f, product_mass_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Teneur Au (g/t)</label>
              <input type="number" step="0.01" className="input-field font-mono" value={reconForm.product_au_g_t} onChange={e => setReconForm(f => ({ ...f, product_au_g_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Incertitude (%)</label>
              <input type="number" step="0.1" className="input-field font-mono" value={reconForm.product_uncertainty_pct} onChange={e => setReconForm(f => ({ ...f, product_uncertainty_pct: e.target.value }))} />
            </div>
          </div>

          {/* Tail */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-red-400">Résidus</div>
            <div>
              <label className="label">Masse sèche (t)</label>
              <input type="number" className="input-field font-mono" value={reconForm.tail_mass_t} onChange={e => setReconForm(f => ({ ...f, tail_mass_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Teneur Au (g/t)</label>
              <input type="number" step="0.01" className="input-field font-mono" value={reconForm.tail_au_g_t} onChange={e => setReconForm(f => ({ ...f, tail_au_g_t: e.target.value }))} />
            </div>
            <div>
              <label className="label">Incertitude (%)</label>
              <input type="number" step="0.1" className="input-field font-mono" value={reconForm.tail_uncertainty_pct} onChange={e => setReconForm(f => ({ ...f, tail_uncertainty_pct: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="mt-3">
          <label className="label">Variation stock (g Au)</label>
          <input type="number" className="input-field font-mono max-w-xs" value={reconForm.delta_stock_g} onChange={e => setReconForm(f => ({ ...f, delta_stock_g: e.target.value }))} />
        </div>

        <div className="flex gap-2 mt-4">
          <button className="btn btn-primary" onClick={handleRunReconciliation}>
            <Scale size={14} /> Calculer la réconciliation
          </button>
          {reconResult && (
            <button className="btn btn-secondary" onClick={saveReconciliation}>
              <CheckCircle2 size={14} /> Sauvegarder
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {reconResult && (
        <div className="card">
          <div className="section-title mb-4">Résultats de la réconciliation</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Métal alimenté</div>
              <div className="text-lg font-bold text-mf-txt">{formatDecimalGrouped(reconResult.feedMetalG, 0)} g</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Métal produit</div>
              <div className="text-lg font-bold text-emerald-400">{formatDecimalGrouped(reconResult.productMetalG, 0)} g</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Métal résidu</div>
              <div className="text-lg font-bold text-red-400">{formatDecimalGrouped(reconResult.tailMetalG, 0)} g</div>
            </div>
            <div className="rounded-lg bg-mf-panel/50 p-3 text-center">
              <div className="text-[10px] text-mf-txt4 uppercase">Récupération</div>
              <div className="text-lg font-bold text-amber-400">{reconResult.recoveryPct}%</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${reconResult.biasFlag ? 'bg-red-500/10' : 'bg-mf-panel/50'}`}>
              <div className="text-[10px] text-mf-txt4 uppercase">Métal non comptabilisé</div>
              <div className={`text-lg font-bold ${Math.abs(reconResult.unaccountedMetalPct) > 5 ? 'text-red-400' : 'text-mf-txt'}`}>
                {reconResult.unaccountedMetalPct}%
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg bg-mf-panel/50 p-3">
              <div className="text-[10px] text-mf-txt4 uppercase">Variance (moindres carrés pondérés)</div>
              <div className="text-base font-semibold text-mf-txt">{reconResult.variancePct}%</div>
            </div>
            <div className={`rounded-lg p-3 ${reconResult.biasFlag ? 'bg-red-500/10' : 'bg-mf-panel/50'}`}>
              <div className="text-[10px] text-mf-txt4 uppercase">Biais systématique (P754 n°10)</div>
              <div className={`text-base font-semibold ${reconResult.biasFlag ? 'text-red-400' : 'text-emerald-400'}`}>
                {reconResult.biasFlag ? 'Détecté' : 'Aucun'}
              </div>
            </div>
          </div>

          {reconResult.notes.length > 0 && (
            <div className="space-y-1">
              {reconResult.notes.map((n, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-amber-400 px-3 py-1.5 rounded-lg bg-amber-500/5">
                  <AlertTriangle size={11} /> {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>
      )}

      {showStreamModal && (
        <Modal title="Ajouter courant de matière" onClose={() => setShowStreamModal(false)} width="md"
          footer={<><button className="btn btn-secondary" onClick={() => setShowStreamModal(false)}>Annuler</button><button className="btn btn-primary" onClick={handleAddStream}>Ajouter</button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Stream ID *</label>
                <input className="input-field font-mono" placeholder="ex. FEED" value={streamForm.stream_id} onChange={e => setStreamForm(f => ({ ...f, stream_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">Nom *</label>
                <input className="input-field" placeholder="ex. Alimentation broyeur" value={streamForm.name} onChange={e => setStreamForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">Section</label>
                <select className="input-field" value={streamForm.section} onChange={e => setStreamForm(f => ({ ...f, section: e.target.value }))}>
                  {PROCESS_SECTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input-field" value={streamForm.stream_type} onChange={e => setStreamForm(f => ({ ...f, stream_type: e.target.value as CosStream['stream_type'] }))}>
                  <option value="feed">Feed</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="product">Product</option>
                  <option value="tail">Tail</option>
                  <option value="reagent">Reagent</option>
                </select>
              </div>
              <div>
                <label className="label">Qualité</label>
                <select className="input-field" value={streamForm.data_quality} onChange={e => setStreamForm(f => ({ ...f, data_quality: e.target.value as CosStream['data_quality'] }))}>
                  <option value="good">Good</option>
                  <option value="suspect">Suspect</option>
                  <option value="missing">Missing</option>
                  <option value="frozen">Frozen</option>
                  <option value="out_of_range">Out of range</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Masse (t/h)</label>
                <input type="number" step="0.1" className="input-field font-mono" value={streamForm.mass_tph} onChange={e => setStreamForm(f => ({ ...f, mass_tph: e.target.value }))} />
              </div>
              <div>
                <label className="label">Au (g/t)</label>
                <input type="number" step="0.01" className="input-field font-mono" value={streamForm.au_g_t} onChange={e => setStreamForm(f => ({ ...f, au_g_t: e.target.value }))} />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Alerts Tab
// ═══════════════════════════════════════════════════════════════

interface AlertsTabProps {
  project: Project;
  alerts: CosAlert[];
  generatedAlerts: AlertSeed[];
  onRefresh: () => void;
}

function AlertsTab({ project, alerts, generatedAlerts, onRefresh }: AlertsTabProps) {
  async function persistGeneratedAlert(seed: AlertSeed) {
    await supabase.from('cos_alerts').insert({
      project_id: project.id,
      alert_type: seed.alert_type,
      severity: seed.severity,
      entity: seed.entity,
      entity_name: seed.entity_name,
      domain: seed.domain,
      cause: seed.cause,
      description: seed.description,
      evidence: seed.evidence,
      status: 'active',
    } as never);
    onRefresh();
  }

  async function updateAlertStatus(id: string, status: CosAlert['status']) {
    const updates: Record<string, unknown> = { status };
    if (status === 'acknowledged') updates.acknowledged_at = new Date().toISOString();
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();
    await supabase.from('cos_alerts').update(updates).eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'urgent': return 'bg-red-500/15 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      default: return 'bg-mf-panel text-mf-txt4 border-mf-border';
    }
  };

  return (
    <div className="space-y-5">
      {/* Generated alerts (not yet persisted) */}
      {generatedAlerts.length > 0 && (
        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Bell size={15} className="text-amber-400" /> Alertes détectées en temps réel ({generatedAlerts.length})
          </div>
          <div className="space-y-2">
            {generatedAlerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-mf-panel/50 border border-mf-border">
                <div className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${severityColor(a.severity)}`}>
                  {a.severity}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-mf-txt">{a.entity_name}</div>
                  <div className="text-xs text-mf-txt4">{a.description}</div>
                  <div className="text-[10px] text-mf-txt4 mt-1">
                    Type: {a.alert_type} · Domaine: {a.domain} · Cause: {a.cause}
                  </div>
                </div>
                <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => persistGeneratedAlert(a)}>
                  Enregistrer
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Persisted alerts */}
      <div className="card">
        <div className="section-title mb-4">Centre d'alertes ({alerts.length})</div>
        {alerts.length === 0 ? (
          <div className="text-sm text-mf-txt4 py-8 text-center">Aucune alerte enregistrée</div>
        ) : (
          <div className="space-y-2">
            {alerts.map(a => (
              <div key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                a.status === 'active' ? 'bg-mf-panel/50 border-mf-border'
                : a.status === 'acknowledged' ? 'bg-blue-500/5 border-blue-500/20'
                : 'bg-mf-panel/30 border-mf-border/50 opacity-60'
              }`}>
                <div className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${severityColor(a.severity)}`}>
                  {a.severity}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-mf-txt">{a.entity_name ?? a.entity}</div>
                  <div className="text-xs text-mf-txt4">{a.description}</div>
                  <div className="flex items-center gap-3 text-[10px] text-mf-txt4 mt-1">
                    <span>{a.alert_type}</span>
                    <span>·</span>
                    <span>{a.domain}</span>
                    {a.escalated_to && <><span>·</span><span className="text-amber-400">Escalade: {a.escalated_to}</span></>}
                    <span>·</span>
                    <span>{new Date(a.created_at).toLocaleString('fr-FR')}</span>
                  </div>
                </div>
                {a.status === 'active' && (
                  <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => updateAlertStatus(a.id, 'acknowledged')}>
                    Accuser
                  </button>
                )}
                {a.status === 'acknowledged' && (
                  <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => updateAlertStatus(a.id, 'resolved')}>
                    Résoudre
                  </button>
                )}
                {a.status !== 'resolved' && (
                  <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => updateAlertStatus(a.id, 'suppressed')}>
                    Supprimer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Recommendations Tab
// ═══════════════════════════════════════════════════════════════

interface RecommendationsTabProps {
  project: Project;
  recommendations: CosRecommendation[];
  generatedRecos: RecoSeed[];
  onRefresh: () => void;
}

function RecommendationsTab({ project, recommendations, generatedRecos, onRefresh }: RecommendationsTabProps) {
  const [operatorName, setOperatorName] = useState('');

  async function persistGeneratedReco(seed: RecoSeed) {
    await supabase.from('cos_recommendations').insert({
      project_id: project.id,
      domain: seed.domain,
      objective: seed.objective,
      description: seed.description,
      actions: seed.actions,
      expected_delta: seed.expected_delta,
      confidence: seed.confidence,
      evidence: seed.evidence,
      status: 'pending_approval',
      priority: seed.priority,
    } as never);
    onRefresh();
  }

  async function approveReco(id: string) {
    await supabase.from('cos_recommendations').update({
      status: 'approved',
      approved_by: operatorName || 'operator',
      approved_at: new Date().toISOString(),
    }).eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  async function rejectReco(id: string) {
    await supabase.from('cos_recommendations').update({
      status: 'rejected',
    }).eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  async function applyReco(rec: CosRecommendation) {
    await supabase.from('cos_recommendations').update({
      status: 'applied',
      applied_at: new Date().toISOString(),
    }).eq('id', rec.id).eq('project_id', project.id);

    await supabase.from('cos_operator_actions').insert({
      project_id: project.id,
      recommendation_id: rec.id,
      operator_name: operatorName || 'operator',
      setpoints_applied: rec.actions,
      result: 'pending',
      verified: false,
    });
    onRefresh();
  }

  async function verifyReco(id: string, notes: string) {
    await supabase.from('cos_recommendations').update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      result_notes: notes,
    }).eq('id', id).eq('project_id', project.id);
    onRefresh();
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'pending_approval': return 'bg-amber-500/15 text-amber-400';
      case 'approved': return 'bg-blue-500/15 text-blue-400';
      case 'applied': return 'bg-teal-500/15 text-teal-400';
      case 'verified': return 'bg-emerald-500/15 text-emerald-400';
      case 'rejected': return 'bg-red-500/15 text-red-400';
      default: return 'bg-mf-panel text-mf-txt4';
    }
  };

  return (
    <div className="space-y-5">
      {/* Operator name */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-mf-txt4">Opérateur:</label>
        <input className="input-field max-w-xs text-sm" placeholder="Nom de l'opérateur" value={operatorName} onChange={e => setOperatorName(e.target.value)} />
      </div>

      {/* Generated recommendations */}
      {generatedRecos.length > 0 && (
        <div className="card">
          <div className="section-title mb-4 flex items-center gap-2">
            <Lightbulb size={15} className="text-amber-400" /> Recommandations cognitives générées ({generatedRecos.length})
          </div>
          <div className="space-y-2">
            {generatedRecos.map((r, i) => (
              <div key={i} className="p-3 rounded-lg bg-mf-panel/50 border border-mf-border">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-mf-txt">{r.objective}</div>
                    <div className="text-xs text-mf-txt4 mt-0.5">{r.description}</div>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-400">
                    P{r.priority}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-mf-txt4 mb-2">
                  <span className="text-emerald-400">Confiance: {(r.confidence * 100).toFixed(0)}%</span>
                  <span>Domaine: {r.domain}</span>
                  {Object.entries(r.expected_delta).map(([k, v]) => (
                    <span key={k} className="text-mf-txt3">{k}: <span className="text-mf-txt2">{v}</span></span>
                  ))}
                </div>
                {/* Actions / setpoints */}
                <div className="space-y-1 mb-2">
                  {r.actions.map((a, j) => (
                    <div key={j} className="flex items-center gap-2 text-[10px] text-mf-txt3 px-2 py-1 rounded bg-mf-bg/50">
                      <span className="font-mono text-amber-400">{a.setpoint}</span>
                      <ArrowRight size={10} />
                      <span className="font-mono text-mf-txt">{a.value} {a.unit}</span>
                      <span className="text-mf-txt4">corridor: [{a.within_corridor[0]}, {a.within_corridor[1]}]</span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => persistGeneratedReco(r)}>
                  Enregistrer reco
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Persisted recommendations */}
      <div className="card">
        <div className="section-title mb-4">Workflow de recommandations ({recommendations.length})</div>
        {recommendations.length === 0 ? (
          <div className="text-sm text-mf-txt4 py-8 text-center">Aucune recommandation enregistrée</div>
        ) : (
          <div className="space-y-3">
            {recommendations.map(rec => (
              <div key={rec.id} className="p-4 rounded-lg bg-mf-panel/50 border border-mf-border">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-mf-txt">{rec.objective}</div>
                    {rec.description && <div className="text-xs text-mf-txt4 mt-0.5">{rec.description}</div>}
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${statusColor(rec.status)}`}>
                    {rec.status}
                  </span>
                </div>

                {/* Setpoints */}
                {rec.actions.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {rec.actions.map((a, j) => (
                      <div key={j} className="flex items-center gap-2 text-[10px] text-mf-txt3 px-2 py-1 rounded bg-mf-bg/50">
                        <span className="font-mono text-amber-400">{a.setpoint}</span>
                        <ArrowRight size={10} />
                        <span className="font-mono text-mf-txt">{a.value} {a.unit}</span>
                        <span className="text-mf-txt4">corridor: [{a.within_corridor[0]}, {a.within_corridor[1]}]</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Expected delta + confidence */}
                <div className="flex items-center gap-3 text-[10px] text-mf-txt4 mb-3">
                  <span className="text-emerald-400">Confiance: {(rec.confidence * 100).toFixed(0)}%</span>
                  {Object.entries(rec.expected_delta).map(([k, v]) => (
                    <span key={k} className="text-mf-txt3">{k}: <span className="text-mf-txt2">{v}</span></span>
                  ))}
                  <span>· Priorité P{rec.priority}</span>
                </div>

                {/* Audit trail */}
                <div className="flex items-center gap-3 text-[10px] text-mf-txt4 mb-3 pt-2 border-t border-mf-border/30">
                  {rec.approved_by && <span className="text-blue-400">Approuvé par {rec.approved_by}</span>}
                  {rec.approved_at && <span>{new Date(rec.approved_at).toLocaleString('fr-FR')}</span>}
                  {rec.applied_at && <span className="text-teal-400">Appliqué: {new Date(rec.applied_at).toLocaleString('fr-FR')}</span>}
                  {rec.verified_at && <span className="text-emerald-400">Vérifié: {new Date(rec.verified_at).toLocaleString('fr-FR')}</span>}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {rec.status === 'pending_approval' && (
                    <>
                      <button className="btn btn-sm btn-primary text-[11px]" onClick={() => approveReco(rec.id)}>
                        <CheckCircle2 size={12} /> Approuver
                      </button>
                      <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => rejectReco(rec.id)}>
                        <XCircle size={12} /> Rejeter
                      </button>
                    </>
                  )}
                  {rec.status === 'approved' && (
                    <button className="btn btn-sm btn-primary text-[11px]" onClick={() => applyReco(rec)}>
                      <Zap size={12} /> Appliquer setpoints
                    </button>
                  )}
                  {rec.status === 'applied' && (
                    <button className="btn btn-sm btn-secondary text-[11px]" onClick={() => verifyReco(rec.id, 'Résultat vérifié')}>
                      <ShieldCheck size={12} /> Vérifier
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Corridor safety notice */}
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
        <ShieldCheck size={16} className="text-amber-400 shrink-0" />
        <div className="text-xs text-amber-300">
          Tout passage en contrôle automatique nécessite des corridors pré-approuvés, validation humaine et reprise manuelle immédiate (kill-switch).
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Ingestion Tab — templates de données d'entrée (L2 → L3)
// ═══════════════════════════════════════════════════════════════

interface IngestionTabProps {
  project: Project;
  equipment: CosEquipmentStatus[];
  oreLots: CosOreLot[];
  stockpiles: CosStockpile[];
  streams: CosStream[];
  /** Recharge les données du module après un import réussi. */
  onImported: () => void;
}

const CONFIG_FIELDS: Array<{ key: keyof IngestionConfig; label: string; type: 'text' | 'number' }> = [
  { key: 'site_code',            label: 'Code site',              type: 'text' },
  { key: 'tz',                   label: 'Timezone site',          type: 'text' },
  { key: 'mine_name',            label: 'Mine (origine lots)',    type: 'text' },
  { key: 'lab_id',               label: 'Laboratoire',            type: 'text' },
  { key: 'opc_source_grinding',  label: 'Source OPC broyage',     type: 'text' },
  { key: 'opc_source_leaching',  label: 'Source OPC lixiviation', type: 'text' },
  { key: 'opc_source_utilities', label: 'Source OPC utilités',    type: 'text' },
  { key: 'lims_source',          label: 'Source LIMS',            type: 'text' },
  { key: 'cmms_source',          label: 'Source CMMS/GMAO',       type: 'text' },
  { key: 'geomet_source',        label: 'Source géomet/mine',     type: 'text' },
  { key: 'shift_start_utc_h',    label: 'Début quart (h UTC)',    type: 'number' },
  { key: 'shift_duration_h',     label: 'Durée quart (h)',        type: 'number' },
];

function IngestionTab({ project, equipment, oreLots, stockpiles, streams, onImported }: IngestionTabProps) {
  const [config, setConfig] = useState<IngestionConfig>(() => defaultIngestionConfig(project));
  const [configSource, setConfigSource] = useState<'db' | 'default'>('default');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [showImport, setShowImport] = useState(false);
  const [importDataset, setImportDataset] = useState<ImportDatasetId | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('cos_ingestion_config').select('*')
        .eq('project_id', project.id).maybeSingle();
      if (cancelled) return;
      if (!error && data) {
        const merged: Record<string, unknown> = { ...defaultIngestionConfig(project) };
        for (const f of CONFIG_FIELDS) {
          const v = (data as Record<string, unknown>)[f.key];
          if (v !== null && v !== undefined && v !== '') {
            merged[f.key] = f.type === 'number' ? Number(v) : String(v);
          }
        }
        setConfig(merged as unknown as IngestionConfig);
        setConfigSource('db');
      }
    })();
    return () => { cancelled = true; };
  }, [project]);

  async function saveConfig() {
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase.from('cos_ingestion_config').upsert(
      { project_id: project.id, ...config, updated_at: new Date().toISOString() },
      { onConflict: 'project_id' },
    );
    if (error) {
      setSaveError(`Sauvegarde impossible (${error.message}) — la migration cos_ingestion_config doit être exécutée dans Supabase. La config reste active pour cette session.`);
    } else {
      setConfigSource('db');
    }
    setSaving(false);
  }

  const ctx: TemplateContext = { config, project, now, equipment, oreLots, stockpiles, streams };
  const groups = groupTemplatesBySection(COS_INGESTION_TEMPLATES);

  function copyPayload(id: string, payload: string) {
    navigator.clipboard.writeText(payload).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(c => (c === id ? null : c)), 1500);
    });
  }

  function downloadPayload(id: string, format: string, payload: string) {
    const ext = format === 'csv' ? 'csv' : 'json';
    const blob = new Blob([payload], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cos-template-${id}-${config.site_code}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const importCounts = [
    { label: 'Équipements', n: equipment.length },
    { label: 'Lots', n: oreLots.length },
    { label: 'Stockpiles', n: stockpiles.length },
    { label: 'Courants', n: streams.length },
  ];

  return (
    <div className="space-y-5">
      {/* Conventions banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-blue-500/5 border border-blue-500/20">
        <Database size={16} className="text-blue-400 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-300 space-y-1">
          <div><span className="font-semibold">Ingestion des données d'usine</span> — téléchargez un gabarit Excel, remplissez-le, réimportez-le (ingestion L2 → contextualisation L3).</div>
          <div>Horodatage UTC ISO-8601 · masses en t (sec) / m³ (pulpe) · débits t/h · teneurs g/t (solides) / mg/L (solutions) · énergie kWh · réactifs kg / kg/t.</div>
          <div>Une unité hors catalogue canonique fait rejeter la ligne ; une valeur <span className="font-mono">substitute</span> impose un sign-off (AMIRA P754 n°6).</div>
        </div>
      </div>

      {/* ── Gabarits Excel — parcours principal, aligné sur le module LIMS ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <div className="section-title flex items-center gap-2">
            <FileSpreadsheet size={15} className="text-emerald-400" /> Gabarits Excel par type de données
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => { setImportDataset(null); setShowImport(true); }}>
            <Upload size={13} /> Importation Excel
          </button>
        </div>
        <div className="text-[11px] text-mf-txt4 mb-4">
          Chaque gabarit contient une feuille « Données » à remplir et une feuille « Guide » décrivant les colonnes,
          les unités acceptées et les règles de validation.
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {COS_TEMPLATES.map(tmpl => {
            const tdef = datasetDef(tmpl.dataset);
            return (
              <div
                key={tmpl.dataset}
                className="flex items-center gap-3 p-3 rounded-xl border border-mf-border bg-mf-panel/30 hover:border-mf-accent/40 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${tmpl.color}15` }}>
                  <FileSpreadsheet size={16} style={{ color: tmpl.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-mf-txt truncate">
                    <span className="font-mono text-[9px] text-mf-txt4 mr-1.5">{tmpl.section}</span>
                    {tmpl.label}
                  </div>
                  <div className="text-[10px] text-mf-txt4 mt-0.5">
                    {tmpl.columns.length} colonnes · {tmpl.columns.filter(c => c.required).length} obligatoires ·
                    <span className="font-mono"> {tdef.table}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    className="btn btn-secondary btn-sm text-[11px]"
                    title={`Télécharger le gabarit ${tmpl.label}`}
                    onClick={() => downloadCosXlsxTemplate(tmpl.dataset)}
                  >
                    <Download size={12} /> .xlsx
                  </button>
                  <button
                    className="btn btn-secondary btn-sm text-[11px]"
                    title={`Importer un fichier rempli pour ${tmpl.label}`}
                    onClick={() => { setImportDataset(tmpl.dataset); setShowImport(true); }}
                  >
                    <Upload size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showImport && (
        <CosExcelImportModal
          project={project}
          initialDataset={importDataset}
          onSuccess={onImported}
          onClose={() => setShowImport(false)}
        />
      )}

      {/* Config card */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="section-title flex items-center gap-2">
            <Cpu size={15} className="text-amber-400" /> Configuration d'ingestion
            <span className={`px-2 py-0.5 text-[10px] rounded-full ${configSource === 'db' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-mf-panel text-mf-txt4'}`}>
              {configSource === 'db' ? 'Sauvegardée' : 'Défauts projet'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { setConfig(defaultIngestionConfig(project)); }}>
              <RefreshCw size={13} /> Défauts
            </button>
            <button className="btn btn-primary btn-sm" onClick={saveConfig} disabled={saving}>
              <Save size={13} /> {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </button>
          </div>
        </div>
        {saveError && (
          <div className="flex items-center gap-2 text-xs text-amber-400 px-3 py-2 rounded-lg bg-amber-500/5 mb-3">
            <AlertTriangle size={12} className="shrink-0" /> {saveError}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {CONFIG_FIELDS.map(f => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input
                type={f.type}
                className="input-field font-mono text-xs"
                value={config[f.key]}
                onChange={e => setConfig(c => ({
                  ...c,
                  [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                }))}
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-mf-border/50 text-[10px] text-mf-txt4">
          <span className="font-semibold text-mf-txt3">Importé des modules :</span>
          {importCounts.map(c => (
            <span key={c.label} className={c.n > 0 ? 'text-emerald-400' : ''}>
              {c.label}: {c.n}
            </span>
          ))}
          <button className="ml-auto btn btn-secondary btn-sm text-[11px]" onClick={() => setNow(new Date())}>
            <RefreshCw size={12} /> Régénérer les payloads
          </button>
        </div>
      </div>

      {/* Quality flags reference */}
      <div className="card">
        <div className="section-title mb-3">Drapeaux de qualité communs</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] text-mf-txt4 uppercase border-b border-mf-border">
                <th className="py-2 pr-4">quality</th>
                <th className="py-2 pr-4">Code</th>
                <th className="py-2 pr-4">Sens</th>
              </tr>
            </thead>
            <tbody>
              {INGESTION_QUALITY_FLAGS.map(f => (
                <tr key={f.key} className="border-b border-mf-border/30">
                  <td className="py-1.5 pr-4 font-mono text-xs text-amber-400">{f.key}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs text-mf-txt3">{f.code}</td>
                  <td className="py-1.5 pr-4 text-xs text-mf-txt2">{f.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Contrat d'interface API — public intégrateurs, pas opérateurs ──
          Replié par défaut : les équipes d'usine passent par les gabarits Excel
          ci-dessus ; ces payloads servent à câbler un agent OPC-UA ou un ETL. */}
      <details className="card">
        <summary className="cursor-pointer section-title flex items-center gap-2 list-none">
          <Code2 size={15} className="text-blue-400" />
          Contrat d'interface API (JSON / CSV) — pour intégrateurs
          <span className="ml-2 text-[10px] font-normal text-mf-txt4">
            {COS_INGESTION_TEMPLATES.length} payloads de référence · régénérés depuis la configuration et les données réelles
          </span>
        </summary>
        <div className="mt-4 space-y-5">
          {/* Banc d'essai : coller un payload CSV/JSON pour vérifier qu'il passe
              la validation avant de câbler l'agent qui l'enverra. */}
          <IngestionImportPanel project={project} onImported={onImported} />

          {groups.map(g => (
        <div key={g.section}>
          <div className="section-title mb-4">{g.section}</div>
          <div className="space-y-4">
            {g.items.map(t => {
              const payload = t.build(ctx);
              return (
                <div key={t.id} className="rounded-lg border border-mf-border bg-mf-panel/30">
                  <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-mf-border/50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-mf-txt">{t.title}</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-mono uppercase rounded bg-mf-panel text-mf-txt4">{t.format}</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-mono rounded bg-blue-500/10 text-blue-400">{t.sourceOf(config)}</span>
                      </div>
                      <div className="text-xs text-mf-txt4 mt-1">{t.description}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button className="btn btn-secondary btn-sm text-[11px]" onClick={() => copyPayload(t.id, payload)}>
                        {copiedId === t.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        {copiedId === t.id ? 'Copié' : 'Copier'}
                      </button>
                      <button className="btn btn-secondary btn-sm text-[11px]" onClick={() => downloadPayload(t.id, t.format, payload)}>
                        <Download size={12} /> Télécharger
                      </button>
                    </div>
                  </div>
                  <pre className="px-4 py-3 text-[11px] leading-relaxed font-mono text-mf-txt3 overflow-x-auto max-h-72 overflow-y-auto whitespace-pre">
{payload}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
          ))}
        </div>
      </details>

      {/* Integration notes */}
      <div className="card">
        <div className="section-title mb-3">Notes d'intégration</div>
        <ul className="text-xs text-mf-txt3 space-y-1.5 list-disc pl-5">
          <li>Les flux temps réel (§1, §5) privilégient <span className="font-mono">NDJSON/Avro</span> sur le bus d'événements ; les données lab et CMMS (§2, §6) sont acceptées en REST + JSON ou en CSV par lot.</li>
          <li>Toute valeur <span className="font-mono text-amber-400">quality = substitute</span> ou <span className="font-mono text-amber-400">status = provisional</span> nécessite un sign-off (P754 n°6) avant usage dans le reporting financier.</li>
          <li>Les unités et <span className="font-mono">asset_path</span> doivent être conformes au catalogue de données ; les incohérences d'unité sont rejetées à l'ingestion.</li>
          <li>Les identifiants (<span className="font-mono">shift_id</span>, <span className="font-mono">lot_id</span>, <span className="font-mono">stockpile_id</span>, <span className="font-mono">stream_id</span>) sont des clés étrangères partagées entre modules ; leur résolution se fait dans la couche de contextualisation (L3).</li>
        </ul>
      </div>
    </div>
  );
}
