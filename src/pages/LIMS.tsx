import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Plus, Search, CheckCircle2, XCircle, AlertCircle, Clock,
  FlaskConical, BarChart3, Activity, Trash2, RefreshCw,
  TrendingUp, AlertTriangle, ChevronDown, ChevronUp, Settings, Tag,
  FileSpreadsheet, MapPin, Layers, Crosshair, Edit2, Save, X,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { ExcelImportModal } from '../components/lims/ExcelImportModal';
import { DeleteModal } from '../components/lims/DeleteModal';
import { supabase } from '../lib/supabase';
import { useProject } from '../lib/ProjectContext';
import { ALL_FAMILIES } from '../lib/limsTestFamilies';
import { reconcileSeparationTest, RECONCILIATION_TOLERANCE_PTS } from '../lib/analytics/metAccounting';
import type { Project, LimsSample } from '../types';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUSES = [
  { id: 'pending',  label: 'En cours', color: 'badge-gray',   icon: Clock },
  { id: 'passed',   label: 'Validé',   color: 'badge-green',  icon: CheckCircle2 },
  { id: 'failed',   label: 'Échoué',   color: 'badge-red',    icon: XCircle },
  { id: 'flagged',  label: 'Signalé',  color: 'badge-orange', icon: AlertCircle },
];

// Statistics helper
function stats(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const p = (pct: number) => sorted[Math.floor((pct / 100) * (n - 1))];
  return {
    n, mean: Math.round(mean * 100) / 100,
    std: Math.round(Math.sqrt(variance) * 100) / 100,
    min: sorted[0], max: sorted[n - 1],
    p10: p(10), p50: p(50), p90: p(90),
  };
}

type TestRecord = Record<string, unknown>;

interface SpatialSample {
  id: string;
  sample_id: string;
  hole_id: string | null;
  x_coord: number | null;
  y_coord: number | null;
  elevation: number | null;
  depth_from: number | null;
  depth_to: number | null;
  dip_deg: number | null;
  azimuth_deg: number | null;
  length_m: number | null;
  drill_type: string | null;
  domain: string | null;
  campaign: string | null;
  zone: string | null;
}

interface LIMSProps { project: Project; samples: LimsSample[]; onRefresh: () => void; }

// ─── Component ───────────────────────────────────────────────────────────────

export function LIMS({ project, samples, onRefresh }: LIMSProps) {
  const { campaigns, domains, addCampaign, deleteCampaign, addDomain, deleteDomain } = useProject();

  const [activeTab, setActiveTab] = useState<'samples' | 'families' | 'statistics' | 'qaqc' | 'completeness' | 'spatial' | 'config'>('samples');
  const [search, setSearch] = useState('');
  const [filterDomain, setFilterDomain] = useState('');
  const [filterCamp, setFilterCamp] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedFamily, setExpandedFamily] = useState<string | null>(null);

  const [newCampaignName, setNewCampaignName] = useState('');
  const [newDomainName, setNewDomainName] = useState('');
  const [newDomainColor, setNewDomainColor] = useState('#14B8A6');
  const [configSaving, setConfigSaving] = useState(false);

  // Generic state for all 11 test family data
  const [familyData, setFamilyData] = useState<Record<string, TestRecord[]>>({});

  // Spatial tab state
  const [spatialView, setSpatialView] = useState<'plan' | 'section' | 'depth'>('plan');
  const [spatialSamples, setSpatialSamples] = useState<SpatialSample[]>([]);
  const [spatialLoading, setSpatialLoading] = useState(false);
  const [editingSpatialId, setEditingSpatialId] = useState<string | null>(null);
  const [spatialEditForm, setSpatialEditForm] = useState<Partial<SpatialSample>>({});
  const [spatialSaving, setSpatialSaving] = useState(false);

  // "Add test" modal state
  const [form, setForm] = useState({
    sample_id: '', campaign: '', domain: '', ore_type: '', zone: '', notes: '',
    status: 'pending' as LimsSample['status'],
  });
  const [testFamily, setTestFamily] = useState(ALL_FAMILIES[0].code);
  const [linkSampleId, setLinkSampleId] = useState('');
  const [testForm, setTestForm] = useState<Record<string, string>>({});

  useEffect(() => { if (project.id) loadTestData(); }, [project.id]);
  useEffect(() => { if (project.id && activeTab === 'spatial') loadSpatialData(); }, [project.id, activeTab]);

  const loadTestData = useCallback(async () => {
    const results = await Promise.all(
      ALL_FAMILIES.map(f =>
        supabase.from(f.table as never).select('*').eq('project_id', project.id)
      )
    );
    const data: Record<string, TestRecord[]> = {};
    ALL_FAMILIES.forEach((f, i) => {
      data[f.code] = (results[i].data ?? []) as TestRecord[];
    });
    setFamilyData(data);
  }, [project.id]);

  const loadSpatialData = useCallback(async () => {
    setSpatialLoading(true);
    const { data } = await supabase
      .from('lims_samples')
      .select('id, sample_id, hole_id, x_coord, y_coord, elevation, depth_from, depth_to, dip_deg, azimuth_deg, length_m, drill_type, domain, campaign, zone')
      .eq('project_id', project.id)
      .order('created_at', { ascending: true });
    setSpatialSamples((data ?? []) as SpatialSample[]);
    setSpatialLoading(false);
  }, [project.id]);

  async function saveSpatialEdit() {
    if (!editingSpatialId) return;
    setSpatialSaving(true);
    await supabase.from('lims_samples').update({
      hole_id:     spatialEditForm.hole_id ?? null,
      x_coord:     spatialEditForm.x_coord ?? null,
      y_coord:     spatialEditForm.y_coord ?? null,
      elevation:   spatialEditForm.elevation ?? null,
      depth_from:  spatialEditForm.depth_from ?? null,
      depth_to:    spatialEditForm.depth_to ?? null,
      dip_deg:     spatialEditForm.dip_deg ?? null,
      azimuth_deg: spatialEditForm.azimuth_deg ?? null,
      length_m:    spatialEditForm.length_m ?? null,
      drill_type:  spatialEditForm.drill_type ?? 'DDH',
    }).eq('id', editingSpatialId).eq('project_id', project.id);
    setSpatialSamples(prev => prev.map(s =>
      s.id === editingSpatialId ? { ...s, ...spatialEditForm } : s
    ));
    setSpatialSaving(false);
    setEditingSpatialId(null);
  }

  const filtered = samples.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !search || s.sample_id.toLowerCase().includes(q) || (s.domain ?? '').toLowerCase().includes(q);
    const matchDomain = !filterDomain || s.domain === filterDomain;
    const matchCamp = !filterCamp || s.campaign === filterCamp;
    return matchSearch && matchDomain && matchCamp;
  });

  const counts = {
    total: samples.length,
    passed: samples.filter(s => s.status === 'passed').length,
    failed: samples.filter(s => s.status === 'failed').length,
    flagged: samples.filter(s => s.status === 'flagged').length,
    totalTests: Object.values(familyData).reduce((acc, arr) => acc + arr.length, 0),
  };

  async function handleAddCampaign() {
    if (!newCampaignName.trim()) return;
    setConfigSaving(true);
    await addCampaign(newCampaignName.trim());
    setNewCampaignName('');
    setConfigSaving(false);
  }

  async function handleAddDomain() {
    if (!newDomainName.trim()) return;
    setConfigSaving(true);
    await addDomain(newDomainName.trim(), { color: newDomainColor });
    setNewDomainName('');
    setConfigSaving(false);
  }

  async function handleSaveSample() {
    if (!form.sample_id.trim()) return;
    setSaving(true);
    try {
      await supabase.from('lims_samples').insert({
        project_id: project.id,
        sample_id: form.sample_id,
        campaign: form.campaign,
        domain: form.domain,
        test_type: testFamily.toUpperCase(),
        status: form.status,
      });
      setShowModal(false);
      onRefresh();
    } finally { setSaving(false); }
  }

  async function handleSaveTest() {
    if (!linkSampleId) return;
    const sampleRow = samples.find(s => s.sample_id === linkSampleId || s.id === linkSampleId);
    if (!sampleRow) return;
    const family = ALL_FAMILIES.find(f => f.code === testFamily);
    if (!family) return;
    setSaving(true);
    try {
      const row: Record<string, unknown> = { project_id: project.id, sample_id: sampleRow.id };
      for (const field of family.quickFields) {
        const val = testForm[field.key];
        if (!val) continue;
        if (field.numeric) {
          const n = parseFloat(val);
          if (!isNaN(n)) row[field.key] = n;
        } else {
          row[field.key] = val;
        }
      }
      await supabase.from(family.table as never).insert(row as never);
      setShowBulkModal(false);
      setTestForm({});
      await loadTestData();
    } finally { setSaving(false); }
  }

  // Derived stats for statistics tab
  const auVals     = (familyData['chem'] ?? []).map(r => Number(r.au_g_t)).filter(v => v > 0);
  const bwiVals    = (familyData['comminution'] ?? []).map(r => Number(r.bwi_kwh_t)).filter(v => v > 0);
  const grgVals    = (familyData['knelson'] ?? []).map(r => Number(r.grg_recovery_pct)).filter(v => v > 0);
  const pyVals     = (familyData['mineralogy'] ?? []).map(r => Number(r.pyrite_pct)).filter(v => v > 0);
  const flotVals   = (familyData['flotation'] ?? []).map(r => Number(r.au_recovery_pct)).filter(v => v > 0);
  const leachVals24 = (familyData['leaching'] ?? []).map(r => Number(r.leach_rec_24h_pct)).filter(v => v > 0);
  const leachVals48 = (familyData['leaching'] ?? []).map(r => Number(r.leach_rec_48h_pct)).filter(v => v > 0);
  const nacnVals   = (familyData['leaching'] ?? []).map(r => Number(r.nacn_consumption_kg_t)).filter(v => v > 0);

  // Kinetics average profile
  const leachData = familyData['leaching'] ?? [];

  // ── Réconciliation de comptabilité métallurgique ───────────────────────────
  // Un essai de séparation porte DEUX informations redondantes : la récupération
  // annoncée par le laboratoire, et celle qu'impliquent ses propres titres
  // (bilan à deux produits). Un écart signale une saisie fautive ou un bilan non
  // bouclé — à corriger AVANT que la route métallurgique ne s'appuie dessus.
  // On SIGNALE, on ne corrige jamais d'office : la donnée du labo fait foi tant
  // qu'un métallurgiste n'a pas tranché (pratique QA-QC / NI 43-101).
  const separationChecks = useMemo(() => {
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n !== 0 ? n : null;
    };
    const families: { code: string; label: string; recKey: string; pullKey: string }[] = [
      { code: 'knelson',   label: 'Gravité (Knelson)', recKey: 'grg_recovery_pct', pullKey: 'mass_pull_pct' },
      { code: 'flotation', label: 'Flottation',        recKey: 'au_recovery_pct',  pullKey: 'conc_wt_pct'   },
    ];
    const rows: {
      family: string; index: number; computed: number;
      reported: number | null; deltaPts: number | null; warnings: string[];
    }[] = [];
    let assayed = 0;
    for (const f of families) {
      (familyData[f.code] ?? []).forEach((r, i) => {
        const feed = num(r.au_feed_g_t), conc = num(r.au_conc_g_t), tail = num(r.au_tail_g_t);
        if (feed == null || conc == null || tail == null) return;   // titres incomplets
        assayed++;
        const rec = reconcileSeparationTest(
          { feed, concentrate: conc, tailings: tail },
          { recoveryPct: num(r[f.recKey]), massPullPct: num(r[f.pullKey]) },
        );
        if (!rec) {
          rows.push({
            family: f.label, index: i + 1, computed: NaN, reported: num(r[f.recKey]), deltaPts: null,
            warnings: [`Titres non séparables (f ${feed}, c ${conc}, t ${tail}) — le concentré doit être plus riche que le rejet, l'alimentation encadrée par les deux.`],
          });
          return;
        }
        if (!rec.consistent) {
          rows.push({
            family: f.label, index: i + 1, computed: rec.computedPct,
            reported: rec.reportedPct, deltaPts: rec.deltaPts, warnings: rec.warnings,
          });
        }
      });
    }
    return { assayed, issues: rows };
  }, [familyData]);
  const avgKinetics = [
    { h: 2,  key: 'leach_rec_2h_pct' },
    { h: 4,  key: 'leach_rec_4h_pct' },
    { h: 8,  key: 'leach_rec_8h_pct' },
    { h: 12, key: 'leach_rec_12h_pct' },
    { h: 24, key: 'leach_rec_24h_pct' },
    { h: 48, key: 'leach_rec_48h_pct' },
  ].map(pt => {
    const vals = leachData.map(r => Number(r[pt.key])).filter(v => v > 0);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { h: pt.h, key: pt.key, avg };
  });

  // Completeness: families sufficient at n >= 3
  const completeness = ALL_FAMILIES.map(f => ({
    ...f,
    count: (familyData[f.code] ?? []).length,
    sufficient: (familyData[f.code] ?? []).length >= 3,
  }));

  // Spatial computed values
  const DRILL_COLORS: Record<string, string> = { DDH: '#3B82F6', RC: '#F59E0B', AC: '#10B981', RAB: '#8B5CF6', OTHER: '#6B7280' };
  const domainColorMap = Object.fromEntries(domains.map(d => [d.name, d.color]));
  const spatialHoles = useMemo(() => {
    const map = new Map<string, SpatialSample[]>();
    for (const s of spatialSamples) {
      const key = s.hole_id ?? s.sample_id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return [...map.entries()].map(([holeId, rows]) => {
      const first = rows[0];
      const maxDepth = Math.max(...rows.map(r => r.depth_to ?? r.depth_from ?? 0).filter(v => v > 0), 0);
      return { holeId, rows, x: first.x_coord, y: first.y_coord, elev: first.elevation, maxDepth, domain: first.domain, campaign: first.campaign, drill_type: first.drill_type };
    });
  }, [spatialSamples]);
  const hasSpatial = spatialSamples.some(s => s.x_coord != null && s.y_coord != null);
  const hasDepth   = spatialSamples.some(s => s.depth_from != null || s.depth_to != null);
  const depthValues = spatialSamples.map(s => s.depth_to ?? s.depth_from).filter((v): v is number => v != null && v > 0);
  const maxDepthVal = depthValues.length ? Math.max(...depthValues) : 200;
  const HIST_BUCKETS = 10;
  const bucketSize = maxDepthVal / HIST_BUCKETS;
  const depthHistData = Array.from({ length: HIST_BUCKETS }, (_, i) => {
    const lo = i * bucketSize, hi = (i + 1) * bucketSize;
    return { lo: +lo.toFixed(0), hi: +hi.toFixed(0), count: depthValues.filter(d => d >= lo && d < hi).length };
  });
  const maxHistCount = Math.max(...depthHistData.map(b => b.count), 1);
  const drillTypes = spatialSamples.reduce<Record<string, number>>((acc, s) => {
    const t = s.drill_type ?? 'DDH'; acc[t] = (acc[t] ?? 0) + 1; return acc;
  }, {});
  // SVG collar map bounds
  const sXs = spatialHoles.filter(h => h.x != null).map(h => h.x!);
  const sYs = spatialHoles.filter(h => h.y != null).map(h => h.y!);
  const sXMin = sXs.length ? Math.min(...sXs) : 0, sXMax = sXs.length ? Math.max(...sXs) : 100;
  const sYMin = sYs.length ? Math.min(...sYs) : 0, sYMax = sYs.length ? Math.max(...sYs) : 100;
  const sPad = 40, sMapW = 520, sMapH = 360;
  const sXScale = (sXMax - sXMin) > 0 ? (sMapW - sPad * 2) / (sXMax - sXMin) : 1;
  const sYScale = (sYMax - sYMin) > 0 ? (sMapH - sPad * 2) / (sYMax - sYMin) : 1;
  const toSvgX = (x: number) => sPad + (x - sXMin) * sXScale;
  const toSvgY = (y: number) => sMapH - sPad - (y - sYMin) * sYScale;

  const TABS = [
    { id: 'samples',      label: 'Échantillons',      icon: FlaskConical },
    { id: 'spatial',      label: 'Distribution Spatiale', icon: MapPin },
    { id: 'families',     label: 'Familles tests',     icon: BarChart3 },
    { id: 'statistics',   label: 'Statistiques',       icon: TrendingUp },
    { id: 'qaqc',         label: 'QAQC',               icon: CheckCircle2 },
    { id: 'completeness', label: 'Complétude',          icon: AlertTriangle },
    { id: 'config',       label: 'Conf. LIMS',          icon: Settings },
  ];

  const currentFamily = ALL_FAMILIES.find(f => f.code === testFamily);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="LIMS — Gestion des Données Labo"
        subtitle={`${counts.total} échantillons · ${counts.totalTests} résultats · ${project.name}`}
        breadcrumb={['Données', 'LIMS']}
        actions={
          <>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>
              <FileSpreadsheet size={14} /> Importer Excel
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteModal(true)}>
              <Trash2 size={14} /> Supprimer
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkModal(true)}>
              <Plus size={14} /> Ajouter test
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Nouvel échantillon
            </button>
          </>
        }
      />

      <div className="px-8 py-6 space-y-5">
        {/* KPI strip */}
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Échantillons',  val: counts.total,           color: 'text-mf-txt' },
            { label: 'Validés',       val: counts.passed,          color: 'text-emerald-400' },
            { label: 'Échoués',       val: counts.failed,          color: 'text-red-400' },
            { label: 'Signalés',      val: counts.flagged,         color: 'text-orange-400' },
            { label: 'Résultats tests', val: counts.totalTests,    color: 'text-teal-400' },
          ].map(s => (
            <div key={s.label} className="card-sm text-center">
              <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.val}</div>
              <div className="text-xs text-mf-txt4 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t.id} className={`tab flex items-center gap-1.5 ${activeTab === t.id ? 'active' : ''}`}
              onClick={() => setActiveTab(t.id as typeof activeTab)}>
              <t.icon size={13} /> {t.label}
            </button>
          ))}
        </div>

        {/* ── TAB: SAMPLES ─────────────────────────────────────── */}
        {activeTab === 'samples' && (
          <>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mf-txt4" />
                <input className="input-field pl-9 text-sm" placeholder="Rechercher ID, domaine…"
                  value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="input-field w-36 text-sm" value={filterDomain} onChange={e => setFilterDomain(e.target.value)}>
                <option value="">Tous domaines</option>
                {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select className="input-field w-36 text-sm" value={filterCamp} onChange={e => setFilterCamp(e.target.value)}>
                <option value="">Campagnes</option>
                {campaigns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
                <RefreshCw size={13} />
              </button>
            </div>
            <div className="card overflow-hidden p-0">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ID Échantillon</th><th>Campagne</th><th>Domaine</th>
                    <th>Zone</th><th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const cfg = STATUSES.find(x => x.id === s.status) ?? STATUSES[0];
                    const Ico = cfg.icon;
                    return (
                      <tr key={s.id}>
                        <td><span className="font-mono text-amber-400 text-xs">{s.sample_id}</span></td>
                        <td><span className="badge badge-gray">{s.campaign || '—'}</span></td>
                        <td><span className="text-mf-txt2 text-xs">{s.domain ?? '—'}</span></td>
                        <td><span className="text-mf-txt4 text-xs">{(s as unknown as Record<string, unknown>)['zone'] as string ?? '—'}</span></td>
                        <td>
                          <span className={`badge ${cfg.color} gap-1 text-[10px]`}>
                            <Ico size={10} /> {cfg.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-10 text-mf-txt4">Aucun échantillon</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── TAB: FAMILIES ────────────────────────────────────── */}
        {activeTab === 'families' && (
          <div className="space-y-3">
            {ALL_FAMILIES.map(f => {
              const data = familyData[f.code] ?? [];
              return (
                <FamilySection
                  key={f.code}
                  title={f.label}
                  shortTitle={f.shortLabel}
                  group={f.group}
                  color={f.color}
                  count={data.length}
                  expanded={expandedFamily === f.code}
                  onToggle={() => setExpandedFamily(expandedFamily === f.code ? null : f.code)}
                >
                  <div className="overflow-x-auto">
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th>ID Échantillon</th>
                          {f.displayCols.map(c => (
                            <th key={c.key} className="text-right whitespace-nowrap">
                              {c.label}{c.unit ? ` (${c.unit})` : ''}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.slice(0, 20).map((row, i) => {
                          const sampleRow = samples.find(s => s.id === row.sample_id);
                          return (
                            <tr key={i}>
                              <td>
                                <span className="font-mono text-amber-400 text-xs">
                                  {sampleRow?.sample_id ?? String(row.sample_id ?? '').slice(0, 8)}
                                </span>
                              </td>
                              {f.displayCols.map(c => {
                                const val = row[c.key];
                                const numVal = typeof val === 'number' ? val : (val !== null && val !== undefined && val !== '' ? parseFloat(String(val)) : NaN);
                                return (
                                  <td key={c.key} className="num" style={{ color: c.color }}>
                                    {!isNaN(numVal) ? numVal : (val !== null && val !== undefined && val !== '' ? String(val) : '—')}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                        {data.length === 0 && (
                          <tr>
                            <td colSpan={f.displayCols.length + 1} className="text-center py-6 text-mf-txt4">
                              Aucun résultat — importez via Excel ou ajoutez manuellement
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                    {data.length > 20 && (
                      <p className="text-[10px] text-mf-txt4 px-4 py-2 text-right">
                        + {data.length - 20} autres résultats non affichés
                      </p>
                    )}
                  </div>
                </FamilySection>
              );
            })}
          </div>
        )}

        {/* ── TAB: STATISTICS ──────────────────────────────────── */}
        {activeTab === 'statistics' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Teneur Au — Analyse chimique',    vals: auVals,      unit: 'g/t',    color: '#F59E0B' },
                { label: 'Bond Ball WI — Comminution',       vals: bwiVals,     unit: 'kWh/t',  color: '#5BA4F5' },
                { label: 'GRG Récup. Au — Knelson',          vals: grgVals,     unit: '%',      color: '#2ECC8A' },
                { label: 'Pyrite — Minéralogie',             vals: pyVals,      unit: '%',      color: '#9D78F0' },
                { label: 'Récup. Au — Flottation',           vals: flotVals,    unit: '%',      color: '#F88A44' },
                { label: 'Récup. 24h — Lixiviation CN',      vals: leachVals24, unit: '%',      color: '#10B981' },
                { label: 'Récup. 48h — Lixiviation CN',      vals: leachVals48, unit: '%',      color: '#059669' },
                { label: 'Cons. NaCN — Lixiviation',         vals: nacnVals,    unit: 'kg/t',   color: '#6B7280' },
              ].map(st => {
                const s = stats(st.vals);
                return (
                  <div key={st.label} className="card">
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm font-semibold text-mf-txt">{st.label}</div>
                      <span className="text-[10px] font-mono" style={{ color: st.color }}>n={s?.n ?? 0}</span>
                    </div>
                    {s ? (
                      <div className="space-y-0">
                        {[
                          ['Moyenne', `${s.mean} ${st.unit}`],
                          ['Écart-type', `± ${s.std} ${st.unit}`],
                          ['Min', `${s.min} ${st.unit}`],
                          ['Max', `${s.max} ${st.unit}`],
                          ['P10', `${s.p10} ${st.unit}`],
                          ['P50 (médiane)', `${s.p50} ${st.unit}`],
                          ['P90', `${s.p90} ${st.unit}`],
                        ].map(([k, v]) => (
                          <div key={k as string} className="stat-row">
                            <span className="stat-key">{k}</span>
                            <span className="stat-val font-mono" style={{ color: st.color }}>{v}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-mf-txt4 text-center py-4">Données insuffisantes (n=0)</p>
                    )}
                  </div>
                );
              })}

              {/* Outlier detection */}
              <div className="card">
                <div className="text-sm font-semibold text-mf-txt mb-4">Détection d'anomalies</div>
                {(() => {
                  const outliers: { label: string; value: number; expected: string }[] = [];
                  const bwiS = stats(bwiVals);
                  if (bwiS) bwiVals.forEach((v, i) => {
                    if (Math.abs(v - bwiS.mean) > 2 * bwiS.std)
                      outliers.push({ label: `BWI #${i + 1}`, value: v, expected: `${bwiS.p10}–${bwiS.p90} kWh/t` });
                  });
                  const auS = stats(auVals);
                  if (auS) auVals.forEach((v, i) => {
                    if (Math.abs(v - auS.mean) > 2.5 * auS.std)
                      outliers.push({ label: `Au tête #${i + 1}`, value: v, expected: `${auS.p10}–${auS.p90} g/t` });
                  });
                  const leachS = stats(leachVals24);
                  if (leachS) leachVals24.forEach((v, i) => {
                    if (Math.abs(v - leachS.mean) > 2 * leachS.std)
                      outliers.push({ label: `Récup. lixiv. #${i + 1}`, value: v, expected: `${leachS.p10}–${leachS.p90}%` });
                  });
                  return outliers.length > 0 ? (
                    <div className="space-y-2">
                      {outliers.map((o, i) => (
                        <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
                          <AlertTriangle size={13} className="text-orange-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-medium text-mf-txt">{o.label}: {o.value}</div>
                            <div className="text-[10px] text-mf-txt4">Plage attendue: {o.expected}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 py-2">
                      <CheckCircle2 size={13} /> Aucune anomalie détectée
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Kinetics chart */}
            {leachData.length > 0 && (
              <div className="card">
                <div className="text-sm font-semibold text-mf-txt mb-1">Cinétique de lixiviation — profil moyen</div>
                <div className="text-[10px] text-mf-txt4 mb-4">Récupération Au (%) en fonction du temps · n={leachData.length} essais</div>
                <div className="relative h-44">
                  <svg viewBox="0 0 600 160" className="w-full h-full">
                    {/* grid lines */}
                    {[25, 50, 75, 100].map(y => (
                      <g key={y}>
                        <line x1="40" y1={150 - y * 1.3} x2="580" y2={150 - y * 1.3}
                          stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
                        <text x="34" y={154 - y * 1.3} fill="#6b7280" fontSize="9" textAnchor="end">{y}</text>
                      </g>
                    ))}
                    {/* x axis labels */}
                    {avgKinetics.map((pt, i) => {
                      const x = 40 + (i / (avgKinetics.length - 1)) * 540;
                      return <text key={pt.h} x={x} y="158" fill="#6b7280" fontSize="9" textAnchor="middle">{pt.h}h</text>;
                    })}
                    {/* Per-sample curves (faded) */}
                    {leachData.slice(0, 15).map((row, ri) => {
                      const pts = avgKinetics.map((pt, i) => {
                        const v = Number(row[pt.key as keyof typeof row]);
                        const x = 40 + (i / (avgKinetics.length - 1)) * 540;
                        const y = v > 0 ? 150 - v * 1.3 : null;
                        return { x, y };
                      }).filter(p => p.y !== null);
                      if (pts.length < 2) return null;
                      return (
                        <polyline key={ri}
                          points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                          fill="none" stroke="#10b981" strokeWidth="1" opacity="0.2" />
                      );
                    })}
                    {/* Average curve */}
                    {(() => {
                      const validPts = avgKinetics
                        .map((pt, i) => ({ x: 40 + (i / (avgKinetics.length - 1)) * 540, y: pt.avg !== null ? 150 - pt.avg * 1.3 : null }))
                        .filter(p => p.y !== null);
                      if (validPts.length < 2) return null;
                      return (
                        <g>
                          <polyline points={validPts.map(p => `${p.x},${p.y}`).join(' ')}
                            fill="none" stroke="#10b981" strokeWidth="2.5" />
                          {validPts.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y!} r="4" fill="#10b981" />
                          ))}
                        </g>
                      );
                    })()}
                  </svg>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-mf-txt4 mt-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-emerald-500 rounded inline-block" />Récup. moy.
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 h-0.5 bg-emerald-500/30 rounded inline-block" />Essais individuels
                  </span>
                  {leachVals48.length > 0 && (
                    <span className="ml-auto font-semibold text-emerald-400">
                      Récup. 48h moy. : {formatDecimalGrouped((leachVals48.reduce((a,b)=>a+b,0)/leachVals48.length), 1)}%
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: QAQC ────────────────────────────────────────── */}
        {activeTab === 'qaqc' && (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Blancs de procédé',    count: samples.filter(s => s.test_type === 'BLANK').length,     target: 5,  desc: '1 blanc / 20 échantillons' },
                { label: 'Standards certifiés',  count: samples.filter(s => s.test_type === 'STD').length,       target: 10, desc: '1 standard / 10 échantillons' },
                { label: 'Duplicatas terrain',   count: samples.filter(s => s.test_type === 'DUP').length,       target: 6,  desc: '1 dup / 20 échantillons' },
                { label: 'Duplicatas pulpe',     count: samples.filter(s => s.test_type === 'DUP_PULP').length,  target: 5,  desc: '5% du total' },
                { label: 'Coarse rejects',       count: samples.filter(s => s.test_type === 'COARSE').length,    target: 5,  desc: '5% du total' },
                { label: 'Round robin',          count: samples.filter(s => s.test_type === 'RR').length,        target: 3,  desc: 'Inter-laboratoire' },
              ].map(q => {
                const pct = q.target > 0 ? Math.min(100, Math.round((q.count / q.target) * 100)) : 0;
                const ok = q.count >= q.target;
                return (
                  <div key={q.label} className="card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-sm font-medium text-mf-txt">{q.label}</div>
                        <div className="text-[10px] text-mf-txt4 mt-0.5">{q.desc}</div>
                      </div>
                      <span className={`badge ${ok ? 'badge-green' : q.count > 0 ? 'badge-orange' : 'badge-red'} text-[10px]`}>
                        {q.count}/{q.target}
                      </span>
                    </div>
                    <div className="progress-bar mt-3">
                      <div className={`progress-fill ${ok ? 'bg-emerald-500' : 'bg-amber-500/70'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] text-mf-txt4 mt-1">{pct}% de la cible</div>
                  </div>
                );
              })}
            </div>

            {/* AU CV */}
            <div className="card">
              <div className="section-title mb-4">Coefficient de variation des teneurs Au (alerte si CV {'>'} 15%)</div>
              {auVals.length >= 3 ? (() => {
                const s = stats(auVals)!;
                const cv = (s.std / s.mean) * 100;
                const alert = cv > 15;
                return (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4">
                      <div className={`text-2xl font-bold font-mono ${alert ? 'text-red-400' : 'text-emerald-400'}`}>{formatDecimalGrouped(cv, 1)}%</div>
                      <div>
                        <div className="text-xs text-mf-txt">{alert ? 'Variabilité élevée — révision du programme d\'échantillonnage recommandée' : 'Variabilité acceptable'}</div>
                        <div className="text-[10px] text-mf-txt4">Au moy: {s.mean} g/t · σ: {s.std} g/t · n: {s.n}</div>
                      </div>
                    </div>
                    <div className="progress-bar h-2">
                      <div className={`progress-fill h-2 ${alert ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(cv, 50)}%` }} />
                    </div>
                    <div className="text-[10px] text-mf-txt4">Seuil alerte: 15% · Seuil critique: 30%</div>
                  </div>
                );
              })() : (
                <p className="text-xs text-mf-txt4">Minimum 3 teneurs Au (analyse chimique) requises (actuellement {auVals.length})</p>
              )}
            </div>

            {/* Comptabilité métallurgique — bilan à deux produits sur chaque séparateur */}
            <div className="card">
              <div className="flex items-center justify-between mb-1">
                <div className="section-title">Comptabilité métallurgique — bilan à deux produits</div>
                <span className={`badge text-[10px] ${
                  separationChecks.assayed === 0 ? 'badge-orange'
                    : separationChecks.issues.length === 0 ? 'badge-green' : 'badge-red'}`}>
                  {separationChecks.assayed === 0
                    ? 'aucun essai titré'
                    : `${separationChecks.assayed - separationChecks.issues.length}/${separationChecks.assayed} cohérents`}
                </span>
              </div>
              <div className="text-[10px] text-mf-txt4 mb-4">
                R = 100·c(f−t) / [f(c−t)] — récupération recalculée depuis les titres, comparée à celle annoncée
                (tolérance {RECONCILIATION_TOLERANCE_PTS} pts). Un écart est signalé, jamais corrigé d'office.
              </div>
              {separationChecks.assayed === 0 ? (
                <p className="text-xs text-mf-txt4">
                  Aucun essai de gravité ou de flottation ne porte les trois titres (alimentation, concentré, rejet)
                  nécessaires au bilan. Renseignez-les pour activer la réconciliation.
                </p>
              ) : separationChecks.issues.length === 0 ? (
                <p className="text-xs text-emerald-400">
                  Les {separationChecks.assayed} essais titrés bouclent : récupérations et tirages massiques annoncés
                  concordent avec les titres.
                </p>
              ) : (
                <div className="space-y-2">
                  {separationChecks.issues.map((it, i) => (
                    <div key={i} className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <AlertTriangle size={12} className="text-red-400 shrink-0" />
                        <span className="text-xs font-medium text-mf-txt">{it.family} — essai n° {it.index}</span>
                        {Number.isFinite(it.computed) && (
                          <span className="text-[10px] font-mono text-mf-txt3">
                            recalculé {formatDecimalGrouped(it.computed, 1)}%
                            {it.reported != null && <> · annoncé {formatDecimalGrouped(it.reported, 1)}%</>}
                            {it.deltaPts != null && <> · écart {it.deltaPts > 0 ? '+' : ''}{it.deltaPts} pts</>}
                          </span>
                        )}
                      </div>
                      {it.warnings.map((w, j) => (
                        <div key={j} className="text-[10px] text-mf-txt4 leading-relaxed">{w}</div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB: COMPLETENESS ────────────────────────────────── */}
        {activeTab === 'completeness' && (
          <div className="space-y-4">
            <div className="p-4 bg-blue-500/8 border border-blue-500/20 rounded-xl text-xs text-mf-txt3">
              Un programme de testwork est considéré <strong className="text-mf-txt">suffisant</strong> dès que n ≥ 3 tests valides par famille.
            </div>
            <div className="grid grid-cols-2 gap-3">
              {completeness.map(f => (
                <div key={f.code} className={`card flex items-center gap-4 ${f.sufficient ? 'border-emerald-500/20' : f.count > 0 ? 'border-amber-500/20' : ''}`}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${f.color}20` }}>
                    <Activity size={14} style={{ color: f.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-mf-txt truncate">{f.shortLabel}</div>
                    <div className="text-[10px] text-mf-txt4">{f.group}</div>
                    <div className="mt-1.5 progress-bar">
                      <div
                        className="progress-fill transition-all"
                        style={{ width: `${Math.min(100, (f.count / 3) * 100)}%`, backgroundColor: f.color }}
                      />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-base font-bold font-mono" style={{ color: f.color }}>{f.count}</div>
                    <div className={`text-[10px] ${f.sufficient ? 'text-emerald-400' : f.count > 0 ? 'text-amber-400' : 'text-mf-txt4'}`}>
                      {f.sufficient ? '✓ OK' : f.count > 0 ? `${f.count}/3` : 'À faire'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TAB: CONFIG ──────────────────────────────────────── */}
        {activeTab === 'config' && (
          <div className="grid grid-cols-2 gap-6">
            <div className="card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={15} className="text-amber-400" />
                <div className="text-sm font-semibold text-mf-txt">Campagnes d'échantillonnage</div>
              </div>
              <p className="text-xs text-mf-txt4">Définissez les campagnes pour ce projet.</p>
              <div className="flex gap-2">
                <input className="input-field flex-1 text-sm" placeholder="Nom (ex. Camp-2026-A)"
                  value={newCampaignName} onChange={e => setNewCampaignName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCampaign()} />
                <button className="btn btn-primary btn-sm" onClick={handleAddCampaign} disabled={configSaving || !newCampaignName.trim()}>
                  <Plus size={13} /> Ajouter
                </button>
              </div>
              <div className="space-y-1.5">
                {campaigns.length === 0 && (
                  <div className="text-xs text-mf-txt4 text-center py-6 border border-dashed border-mf-border rounded-lg">
                    Aucune campagne — ajoutez-en une ci-dessus
                  </div>
                )}
                {campaigns.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-mf-hover/30 border border-mf-border group">
                    <div>
                      <div className="text-xs font-semibold text-mf-txt">{c.name}</div>
                      {c.description && <div className="text-[10px] text-mf-txt4">{c.description}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-mf-txt4">
                        {samples.filter(s => s.campaign === c.name).length} éch.
                      </span>
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1"
                        onClick={() => deleteCampaign(c.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <Tag size={15} className="text-teal-400" />
                <div className="text-sm font-semibold text-mf-txt">Domaines géologiques</div>
              </div>
              <p className="text-xs text-mf-txt4">Domaines lithologiques / métallurgiques du gisement.</p>
              <div className="flex gap-2">
                <input className="input-field flex-1 text-sm" placeholder="Nom (ex. Oxyde HG)"
                  value={newDomainName} onChange={e => setNewDomainName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddDomain()} />
                <input type="color" className="w-9 h-9 rounded-lg border border-mf-border cursor-pointer bg-transparent"
                  value={newDomainColor} onChange={e => setNewDomainColor(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={handleAddDomain} disabled={configSaving || !newDomainName.trim()}>
                  <Plus size={13} /> Ajouter
                </button>
              </div>
              <div className="space-y-1.5">
                {domains.length === 0 && (
                  <div className="text-xs text-mf-txt4 text-center py-6 border border-dashed border-mf-border rounded-lg">
                    Aucun domaine — ajoutez-en un ci-dessus
                  </div>
                )}
                {domains.map(d => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-mf-hover/30 border border-mf-border group">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <div className="text-xs font-semibold text-mf-txt">{d.name}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-mf-txt4">
                        {samples.filter(s => s.domain === d.name).length} éch.
                      </span>
                      <button className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1"
                        onClick={() => deleteDomain(d.id)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: SPATIAL DISTRIBUTION ────────────────────────── */}
        {activeTab === 'spatial' && (
          <div className="space-y-4">
            {/* Header + view switcher */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold mf-txt">{spatialSamples.length} échantillons · {spatialHoles.length} forages</div>
                {spatialLoading && <RefreshCw size={13} className="animate-spin mf-txt4" />}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadSpatialData} className="btn btn-secondary p-1.5"><RefreshCw size={13} /></button>
                <div className="flex rounded-lg overflow-hidden border border-mf-border">
                  {(['plan', 'section', 'depth'] as const).map(v => (
                    <button key={v} onClick={() => setSpatialView(v)}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${spatialView === v ? 'bg-teal-500/20 text-teal-300' : 'mf-txt3 hover:mf-txt'}`}>
                      {v === 'plan' ? 'Plan (vue de dessus)' : v === 'section' ? 'Coupe transversale' : 'Histogramme profondeur'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              {/* Main map/chart area */}
              <div className="col-span-2 card-sm overflow-hidden">
                {spatialView === 'plan' && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <MapPin size={13} className="text-teal-400" />
                      <div className="text-xs font-semibold mf-txt">Vue en plan — Carte des collets de forage</div>
                    </div>
                    {!hasSpatial ? (
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Crosshair size={32} className="mf-txt4 opacity-30" />
                        <div className="text-xs mf-txt3 text-center max-w-xs">
                          Aucune coordonnée spatiale. Saisissez X/Y/élévation dans le tableau ci-dessous ou importez via Excel.
                        </div>
                      </div>
                    ) : (
                      <svg viewBox={`0 0 ${sMapW} ${sMapH}`} className="w-full rounded-lg bg-white/3 border border-mf-border">
                        {/* Grid */}
                        {[0, 1, 2, 3, 4].map(i => (
                          <g key={i}>
                            <line x1={sPad + i * (sMapW - sPad * 2) / 4} y1={sPad} x2={sPad + i * (sMapW - sPad * 2) / 4} y2={sMapH - sPad} stroke="#ffffff06" strokeWidth={1} />
                            <line x1={sPad} y1={sPad + i * (sMapH - sPad * 2) / 4} x2={sMapW - sPad} y2={sPad + i * (sMapH - sPad * 2) / 4} stroke="#ffffff06" strokeWidth={1} />
                          </g>
                        ))}
                        {/* Axis labels */}
                        <text x={sMapW / 2} y={sMapH - 6} textAnchor="middle" fontSize={9} fill="#ffffff30">Easting (m)</text>
                        <text x={10} y={sMapH / 2} textAnchor="middle" fontSize={9} fill="#ffffff30" transform={`rotate(-90, 10, ${sMapH / 2})`}>Northing (m)</text>
                        {/* Holes */}
                        {spatialHoles.filter(h => h.x != null && h.y != null).map(h => {
                          const cx = toSvgX(h.x!), cy = toSvgY(h.y!);
                          const col = domainColorMap[h.domain ?? ''] ?? DRILL_COLORS[h.drill_type ?? 'DDH'] ?? '#3B82F6';
                          return (
                            <g key={h.holeId}>
                              <circle cx={cx} cy={cy} r={7} fill={col + '33'} stroke={col} strokeWidth={1.5} />
                              <circle cx={cx} cy={cy} r={2.5} fill={col} />
                              <text x={cx + 10} y={cy + 3} fontSize={7} fill="#ffffffaa">{h.holeId.substring(0, 8)}</text>
                            </g>
                          );
                        })}
                      </svg>
                    )}
                  </>
                )}

                {spatialView === 'section' && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <Layers size={13} className="text-teal-400" />
                      <div className="text-xs font-semibold mf-txt">Coupe transversale — Profil des forages par profondeur</div>
                    </div>
                    {!hasDepth ? (
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Layers size={32} className="mf-txt4 opacity-30" />
                        <div className="text-xs mf-txt3 text-center">Saisissez les profondeurs (De/À) dans le tableau.</div>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const sw = 520, sh = 340;
                          const hList = spatialHoles.filter(h => h.maxDepth > 0).slice(0, 20);
                          const sMaxDepth = Math.max(...hList.map(h => h.maxDepth), 100);
                          const slotW = hList.length > 0 ? (sw - 60) / hList.length : 30;
                          return (
                            <svg viewBox={`0 0 ${sw} ${sh}`} className="w-full rounded-lg bg-white/3 border border-mf-border">
                              {/* Depth axis */}
                              {[0, 0.25, 0.5, 0.75, 1].map(f => {
                                const depth = f * sMaxDepth;
                                const y = 20 + f * (sh - 50);
                                return (
                                  <g key={f}>
                                    <line x1={40} y1={y} x2={sw - 10} y2={y} stroke="#ffffff08" strokeWidth={1} />
                                    <text x={36} y={y + 3} textAnchor="end" fontSize={8} fill="#ffffff40">{formatDecimalGrouped(depth, 0)}m</text>
                                  </g>
                                );
                              })}
                              {/* Surface line */}
                              <line x1={40} y1={20} x2={sw - 10} y2={20} stroke="#10B98180" strokeWidth={1.5} strokeDasharray="4 3" />
                              <text x={44} y={16} fontSize={7} fill="#10B98180">Surface</text>
                              {/* Holes */}
                              {hList.map((h, i) => {
                                const cx = 50 + i * slotW + slotW / 2;
                                const barH = (h.maxDepth / sMaxDepth) * (sh - 50);
                                const col = domainColorMap[h.domain ?? ''] ?? DRILL_COLORS[h.drill_type ?? 'DDH'] ?? '#3B82F6';
                                // Interval bars
                                const intervals = h.rows.filter(r => r.depth_from != null && r.depth_to != null);
                                return (
                                  <g key={h.holeId}>
                                    {/* Hole trace */}
                                    <line x1={cx} y1={20} x2={cx} y2={20 + barH} stroke={col + '60'} strokeWidth={3} />
                                    {intervals.map((r, j) => {
                                      const y1 = 20 + (r.depth_from! / sMaxDepth) * (sh - 50);
                                      const y2 = 20 + (r.depth_to! / sMaxDepth) * (sh - 50);
                                      return <rect key={j} x={cx - 3} y={y1} width={6} height={Math.max(2, y2 - y1)} fill={col} rx={1} />;
                                    })}
                                    {/* Collar dot */}
                                    <circle cx={cx} cy={20} r={3.5} fill={col} />
                                    <text x={cx} y={sh - 4} textAnchor="middle" fontSize={7} fill="#ffffffaa"
                                      transform={`rotate(-45, ${cx}, ${sh - 4})`}>{h.holeId.substring(0, 7)}</text>
                                  </g>
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </>
                    )}
                  </>
                )}

                {spatialView === 'depth' && (
                  <>
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart3 size={13} className="text-teal-400" />
                      <div className="text-xs font-semibold mf-txt">Distribution des profondeurs de prélèvement</div>
                    </div>
                    <svg viewBox="0 0 520 280" className="w-full">
                      {/* Y axis */}
                      {[0, 0.25, 0.5, 0.75, 1].map(f => (
                        <g key={f}>
                          <line x1={44} y1={10 + f * 230} x2={510} y2={10 + f * 230} stroke="#ffffff08" strokeWidth={1} />
                          <text x={40} y={13 + f * 230} textAnchor="end" fontSize={8} fill="#ffffff40">{Math.round((1 - f) * maxHistCount)}</text>
                        </g>
                      ))}
                      {/* Bars */}
                      {depthHistData.map((b, i) => {
                        const barH = (b.count / maxHistCount) * 230;
                        const x = 50 + i * (460 / HIST_BUCKETS) + 2;
                        const bw = 460 / HIST_BUCKETS - 4;
                        return (
                          <g key={i}>
                            <rect x={x} y={240 - barH} width={bw} height={barH} fill="#14B8A666" stroke="#14B8A6" strokeWidth={0.5} rx={2} />
                            <text x={x + bw / 2} y={256} textAnchor="middle" fontSize={7} fill="#ffffffaa">{b.lo}m</text>
                            {b.count > 0 && <text x={x + bw / 2} y={235 - barH} textAnchor="middle" fontSize={7} fill="#14B8A6">{b.count}</text>}
                          </g>
                        );
                      })}
                      <text x={280} y={274} textAnchor="middle" fontSize={9} fill="#ffffff30">Profondeur (m)</text>
                      <text x={12} y={130} textAnchor="middle" fontSize={9} fill="#ffffff30" transform="rotate(-90, 12, 130)">Nbre échantillons</text>
                    </svg>
                  </>
                )}
              </div>

              {/* Side panel — stats + legend */}
              <div className="space-y-3">
                {/* KPIs */}
                <div className="card-sm space-y-2">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Statistiques spatiales</div>
                  {[
                    { label: 'Forages',        val: spatialHoles.length.toString() },
                    { label: 'Avec coord. XY',  val: spatialHoles.filter(h => h.x != null).length.toString() },
                    { label: 'Avec profondeur', val: spatialHoles.filter(h => h.maxDepth > 0).length.toString() },
                    { label: 'Prof. max.',      val: spatialHoles.length ? `${formatDecimalGrouped(Math.max(...spatialHoles.map(h => h.maxDepth), 0), 0)} m` : '—' },
                    { label: 'Prof. moy.',      val: spatialHoles.filter(h => h.maxDepth > 0).length ? `${formatDecimalGrouped((spatialHoles.filter(h=>h.maxDepth>0).reduce((s,h)=>s+h.maxDepth,0)/spatialHoles.filter(h=>h.maxDepth>0).length), 0)} m` : '—' },
                    { label: 'Domaines',        val: [...new Set(spatialSamples.map(s=>s.domain).filter(Boolean))].length.toString() },
                  ].map(k => (
                    <div key={k.label} className="flex justify-between items-center text-xs">
                      <span className="mf-txt3">{k.label}</span>
                      <span className="font-semibold mf-txt font-mono">{k.val}</span>
                    </div>
                  ))}
                </div>

                {/* Drill type distribution */}
                <div className="card-sm space-y-2">
                  <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Types de forage</div>
                  {Object.entries(drillTypes).map(([type, cnt]) => (
                    <div key={type} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: DRILL_COLORS[type] ?? '#6B7280' }} />
                      <span className="mf-txt2 flex-1">{type}</span>
                      <span className="font-mono mf-txt3">{cnt}</span>
                      <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(cnt / spatialSamples.length) * 100}%`, backgroundColor: DRILL_COLORS[type] ?? '#6B7280' }} />
                      </div>
                    </div>
                  ))}
                  {Object.keys(drillTypes).length === 0 && <div className="text-xs mf-txt4">Aucun type enregistré</div>}
                </div>

                {/* Domain legend */}
                {domains.length > 0 && (
                  <div className="card-sm space-y-2">
                    <div className="text-xs font-semibold mf-txt3 uppercase tracking-wider">Domaines</div>
                    {domains.map(d => {
                      const cnt = spatialSamples.filter(s => s.domain === d.name).length;
                      return (
                        <div key={d.id} className="flex items-center gap-2 text-xs">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                          <span className="mf-txt2 flex-1">{d.name}</span>
                          <span className="font-mono mf-txt4">{cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Collar data table */}
            <div className="card-sm overflow-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Edit2 size={13} className="text-teal-400" />
                  <div className="text-xs font-semibold mf-txt">Données de collet — Saisie des coordonnées</div>
                </div>
                <div className="text-[10px] mf-txt4">Cliquer sur une ligne pour éditer les coordonnées spatiales</div>
              </div>
              <div className="overflow-x-auto">
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['Échantillon', 'Forage', 'Type', 'X (Est.)', 'Y (Nord.)', 'Élév. (mRL)', 'Prof. De (m)', 'Prof. À (m)', 'Pendage (°)', 'Azimut (°)', 'Longueur (m)', 'Domaine', ''].map(h => (
                        <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {spatialSamples.slice(0, 50).map(s => {
                      const isEditing = editingSpatialId === s.id;
                      const ef = isEditing ? spatialEditForm : s;
                      const numInput = (key: keyof SpatialSample, placeholder: string) => (
                        <input
                          type="number" step="any"
                          className="input-field text-xs w-20 py-0.5 px-1"
                          placeholder={placeholder}
                          value={(ef[key] as number | null) ?? ''}
                          onChange={e => setSpatialEditForm(prev => ({ ...prev, [key]: e.target.value === '' ? null : parseFloat(e.target.value) }))}
                        />
                      );
                      return (
                        <tr key={s.id} className={`border-b border-white/5 ${isEditing ? 'bg-teal-400/5' : 'hover:bg-white/3'}`}>
                          <td className="px-2 py-1.5 font-mono mf-txt2">{s.sample_id}</td>
                          <td className="px-2 py-1.5">
                            {isEditing ? (
                              <input className="input-field text-xs w-20 py-0.5 px-1" value={spatialEditForm.hole_id ?? ''} onChange={e => setSpatialEditForm(prev => ({ ...prev, hole_id: e.target.value || null }))} placeholder="DDH-001" />
                            ) : <span className="mf-txt3">{s.hole_id ?? '—'}</span>}
                          </td>
                          <td className="px-2 py-1.5">
                            {isEditing ? (
                              <select className="input-field text-xs w-16 py-0.5 px-1" value={spatialEditForm.drill_type ?? 'DDH'} onChange={e => setSpatialEditForm(prev => ({ ...prev, drill_type: e.target.value }))}>
                                {['DDH', 'RC', 'AC', 'RAB', 'OTHER'].map(t => <option key={t}>{t}</option>)}
                              </select>
                            ) : <span className="mf-txt3 text-[10px]">{s.drill_type ?? 'DDH'}</span>}
                          </td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('x_coord', 'X') : <span className="font-mono mf-txt3">{s.x_coord?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('y_coord', 'Y') : <span className="font-mono mf-txt3">{s.y_coord?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('elevation', 'mRL') : <span className="font-mono mf-txt3">{s.elevation?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('depth_from', '0') : <span className="font-mono mf-txt3">{s.depth_from?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('depth_to', '10') : <span className="font-mono mf-txt3">{s.depth_to?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('dip_deg', '-90') : <span className="font-mono mf-txt3">{s.dip_deg?.toFixed(0) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('azimuth_deg', '0') : <span className="font-mono mf-txt3">{s.azimuth_deg?.toFixed(0) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">{isEditing ? numInput('length_m', 'm') : <span className="font-mono mf-txt3">{s.length_m?.toFixed(1) ?? '—'}</span>}</td>
                          <td className="px-2 py-1.5">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: (domainColorMap[s.domain ?? ''] ?? '#6B7280') + '33', color: domainColorMap[s.domain ?? ''] ?? '#9CA3AF' }}>
                              {s.domain ?? '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {isEditing ? (
                              <div className="flex gap-1">
                                <button onClick={saveSpatialEdit} disabled={spatialSaving} className="btn btn-teal text-[10px] px-1.5 py-0.5 flex items-center gap-0.5">
                                  <Save size={10} /> OK
                                </button>
                                <button onClick={() => setEditingSpatialId(null)} className="btn btn-secondary text-[10px] px-1.5 py-0.5">
                                  <X size={10} />
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => { setEditingSpatialId(s.id); setSpatialEditForm({ ...s }); }}
                                className="text-teal-400/50 hover:text-teal-400 transition-colors">
                                <Edit2 size={12} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {spatialSamples.length > 50 && (
                  <div className="text-center text-xs mf-txt4 py-2">… {spatialSamples.length - 50} échantillons supplémentaires (limite d'affichage : 50)</div>
                )}
                {spatialSamples.length === 0 && !spatialLoading && (
                  <div className="text-center mf-txt4 text-xs py-8">Aucun échantillon — ajoutez-en via "Nouvel échantillon"</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MODAL: New sample ──────────────────────────────────────── */}
      {showModal && (
        <Modal title="Nouvel échantillon LIMS" subtitle="Enregistrer un échantillon"
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveSample} disabled={saving || !form.sample_id}>
                {saving ? 'Enregistrement…' : 'Ajouter'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">ID Échantillon *</label>
                <input className="input-field" placeholder="ex. KMG-016" value={form.sample_id}
                  onChange={e => setForm(f => ({ ...f, sample_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">Campagne</label>
                <select className="input-field" value={form.campaign}
                  onChange={e => setForm(f => ({ ...f, campaign: e.target.value }))}>
                  <option value="">— Sélectionner —</option>
                  {campaigns.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Domaine géologique</label>
                <select className="input-field" value={form.domain}
                  onChange={e => setForm(f => ({ ...f, domain: e.target.value }))}>
                  <option value="">— Sélectionner —</option>
                  {domains.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Zone / Secteur</label>
                <input className="input-field" placeholder="ex. Zone Nord" value={form.zone}
                  onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Statut</label>
              <select className="input-field" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value as LimsSample['status'] }))}>
                {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea className="input-field" rows={2} placeholder="Observations…" value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
        </Modal>
      )}

      {/* ── MODAL: Add test ──────────────────────────────────────────── */}
      {showBulkModal && (
        <Modal title="Ajouter un résultat de test" subtitle="Saisie rapide — pour les imports en masse, utilisez Import Excel"
          onClose={() => setShowBulkModal(false)} width="lg"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setShowBulkModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={handleSaveTest} disabled={saving || !linkSampleId}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Échantillon *</label>
                <select className="input-field" value={linkSampleId} onChange={e => setLinkSampleId(e.target.value)}>
                  <option value="">— Sélectionner —</option>
                  {samples.map(s => <option key={s.id} value={s.id}>{s.sample_id} ({s.domain ?? '—'})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Famille de test</label>
                <select className="input-field" value={testFamily}
                  onChange={e => { setTestFamily(e.target.value); setTestForm({}); }}>
                  {ALL_FAMILIES.map(f => <option key={f.code} value={f.code}>{f.shortLabel}</option>)}
                </select>
              </div>
            </div>

            <div className="border-t border-mf-border" />
            <div className="text-xs font-semibold text-mf-txt3 uppercase tracking-wider">
              Champs principaux — {currentFamily?.shortLabel}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {currentFamily?.quickFields.map(f => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  {f.select ? (
                    <select className="input-field" value={testForm[f.key] ?? ''}
                      onChange={e => setTestForm(prev => ({ ...prev, [f.key]: e.target.value }))}>
                      <option value="">— Sélectionner —</option>
                      {f.select.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input className="input-field font-mono" type={f.numeric ? 'number' : 'text'}
                      placeholder={f.placeholder}
                      value={testForm[f.key] ?? ''}
                      onChange={e => setTestForm(prev => ({ ...prev, [f.key]: e.target.value }))} />
                  )}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-mf-txt4 italic">
              Pour importer des résultats complets avec tous les champs, utilisez le bouton <strong>Importer Excel</strong>.
            </p>
          </div>
        </Modal>
      )}

      {/* ── MODAL: Excel Import ────────────────────────────────────── */}
      {showImportModal && (
        <ExcelImportModal
          project={project}
          samples={samples}
          onSuccess={() => { onRefresh(); loadTestData(); }}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* ── MODAL: Delete ──────────────────────────────────────────── */}
      {showDeleteModal && (
        <DeleteModal
          project={project}
          samples={samples}
          onSuccess={() => { onRefresh(); loadTestData(); }}
          onClose={() => setShowDeleteModal(false)}
        />
      )}
    </div>
  );
}

// ─── FamilySection sub-component ─────────────────────────────────────────────

function FamilySection({
  title, shortTitle, group, color, count, expanded, onToggle, children,
}: {
  title: string; shortTitle: string; group: string; color: string;
  count: number; expanded: boolean; onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${expanded ? 'border-amber-500/30' : 'border-mf-border'}`}>
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-mf-hover/30 transition-colors bg-mf-card">
        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="flex-1 text-sm font-semibold text-mf-txt">{shortTitle}</span>
        <span className="text-[10px] text-mf-txt4 hidden sm:block truncate max-w-xs">{group}</span>
        <span className="text-xs font-mono mr-2" style={{ color }}>{count} tests</span>
        {expanded ? <ChevronUp size={14} className="text-mf-txt4" /> : <ChevronDown size={14} className="text-mf-txt4" />}
      </button>
      {expanded && (
        <div className="border-t border-mf-border">
          <div className="px-4 py-2 bg-mf-hover/10">
            <p className="text-[10px] text-mf-txt4 truncate">{title}</p>
          </div>
          {children}
        </div>
      )}
    </div>
  );
}
