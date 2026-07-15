import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Layers, RefreshCw, CheckCircle2, Info, BarChart3, TrendingUp,
  Activity, Target, Zap, AlertTriangle, Star,
  FlaskConical, Microscope,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { useProject } from '../lib/ProjectContext';
import { TROY_OZ_GRAMS, DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import type { Project } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIEVE_SIZES = [500, 212, 150, 106, 75, 53, 38];
const SIEVE_ALL = [...SIEVE_SIZES, 0];

type Tab = 'overview' | 'psd' | 'liberation' | 'p80engine' | 'scenarios' | 'database';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LimsPsdRow {
  id: string; sample_id: string | null; p80_um: number | null; d50_um: number | null;
  au_head_g_t: number | null; au_minus38_g_t: number | null; dist_au_minus38_pct: number | null;
  dist_au_plus212_pct: number | null; dist_au_plus75_pct: number | null;
  minus_38um_pct: number | null; plus_38um_pct: number | null; plus_53um_pct: number | null;
  plus_75um_pct: number | null; plus_106um_pct: number | null; plus_150um_pct: number | null;
  plus_212um_pct: number | null; plus_500um_pct: number | null;
}

interface LimsChemRow { sample_id: string; au_g_t: number | null; s_sulfide_pct: number | null; }
interface LimsComRow { sample_id: string; bwi_kwh_t: number | null; sg_t_m3: number | null; }
interface LimsLibRow { sample_id: string; p80_um: number | null; au_free_pct: number | null; au_sulphides_pct: number | null; au_silicates_pct: number | null; au_occluded_pct: number | null; au_preg_rob_pct: number | null; }

interface LimsSample { id: string; sample_id: string; domain: string | null; campaign: string | null; }

interface AllData {
  samples: LimsSample[];
  psd: LimsPsdRow[];
  chem: LimsChemRow[];
  comminution: LimsComRow[];
  liberation: LimsLibRow[];
}

// ─── Bond energy formula ──────────────────────────────────────────────────────

function bondEnergy(bwi: number, f80_um: number, p80_um: number): number {
  return Math.max(0, bwi * 10 * (1 / Math.sqrt(p80_um) - 1 / Math.sqrt(f80_um)));
}

// Recovery vs grind size, anchored on the project's achievable recovery (`ceiling`).
// The raw liberation curve is normalised so a fine grind (25 µm) reaches `ceiling`
// (the project's global gravity+leach recovery), keeping the module coherent with the
// Dashboard / Économie instead of an arbitrary 98 % asymptote.
function recoveryShape(p80_um: number, freeAu: number): number {
  const base = freeAu * (1 - Math.exp(-0.018 * (500 - p80_um)));
  const tailRec = (100 - freeAu) * 0.85 * (1 - Math.exp(-0.008 * (500 - p80_um)));
  return Math.max(0, base + tailRec);
}
function recoveryModel(p80_um: number, au_free_pct: number | null, ceiling = 96): number {
  const freeAu = au_free_pct ?? 60;
  const refFine = recoveryShape(25, freeAu) || 1;   // normalisation reference
  return Math.max(0, Math.min(ceiling, recoveryShape(p80_um, freeAu) / refFine * ceiling));
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

const W = 560, H = 240, PL = 48, PR = 20, PT = 16, PB = 36;
const PW = W - PL - PR, PH = H - PT - PB;

function xLog(v: number, vMin = 20, vMax = 600) {
  return PL + (Math.log10(v / vMin) / Math.log10(vMax / vMin)) * PW;
}
function yPct(p: number) { return PT + (1 - p / 100) * PH; }

function GrainCurve({ fractions, color, label }: {
  fractions: Array<{ sieve: number; passing: number }>;
  color: string; label: string;
}) {
  const pts = fractions.map(f => `${xLog(Math.max(f.sieve, 20))},${yPct(f.passing)}`).join(' ');
  return (
    <g>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      <polyline points={pts} fill={`${color}15`} stroke="none" />
      {fractions.map((f, i) => (
        <circle key={i} cx={xLog(Math.max(f.sieve, 20))} cy={yPct(f.passing)} r="3.5" fill={color} opacity="0.9" />
      ))}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props { project: Project; }

export function Granulometry({ project }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<AllData>({ samples: [], psd: [], chem: [], comminution: [], liberation: [] });
  const [loading, setLoading] = useState(true);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [p80Target, setP80Target] = useState(75);
  const [bwiOverride, setBwiOverride] = useState<number | null>(null);
  const [f80, setF80] = useState(12000);
  const [expandedGroup, setExpandedGroup] = useState<string | null>('all');
  // Grinding feed size (F80) from the design-criteria crushing circuit, so the engine
  // uses the real feed size instead of a hardcoded 12 mm.
  const [dcF80Crush, setDcF80Crush] = useState<number | null>(null);
  const [dcP80Grind, setDcP80Grind] = useState<number | null>(null);
  const syncedRef = useRef<string | null>(null);

  // Project-level recovery ceiling (global gravity + leach) for the recovery model.
  const { effectiveRecoveryPct } = useProject();

  useEffect(() => { loadAll(); }, [project.id]); // eslint-disable-line

  async function loadAll() {
    setLoading(true);
    const [s, psd, chem, comm, lib, dc] = await Promise.all([
      supabase.from('lims_samples').select('id,sample_id,domain,campaign').eq('project_id', project.id),
      supabase.from('lims_test_psd').select('*').eq('project_id', project.id),
      supabase.from('lims_test_chem').select('sample_id,au_g_t,s_sulfide_pct').eq('project_id', project.id),
      supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3').eq('project_id', project.id),
      supabase.from('lims_test_liberation').select('*').eq('project_id', project.id),
      supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle(),
    ]);
    const d: AllData = {
      samples: (s.data ?? []) as LimsSample[],
      psd: (psd.data ?? []) as LimsPsdRow[],
      chem: (chem.data ?? []) as LimsChemRow[],
      comminution: (comm.data ?? []) as LimsComRow[],
      liberation: (lib.data ?? []) as LimsLibRow[],
    };
    setData(d);
    const dcInp = (dc.data?.content as { inputs?: Record<string, number> } | undefined)?.inputs;
    setDcF80Crush(typeof dcInp?.f80_crush === 'number' ? dcInp.f80_crush : null);
    setDcP80Grind(typeof dcInp?.p80_grind === 'number' ? dcInp.p80_grind : null);
    if (d.psd.length && !selectedSampleId) setSelectedSampleId(d.psd[0].sample_id);
    setLoading(false);
  }

  const sampleMap = useMemo(() => new Map(data.samples.map(s => [s.id, s])), [data.samples]);
  const chemMap = useMemo(() => new Map(data.chem.map(r => [r.sample_id, r])), [data.chem]);
  const commMap = useMemo(() => new Map(data.comminution.map(r => [r.sample_id, r])), [data.comminution]);
  const libMap = useMemo(() => new Map(data.liberation.map(r => [r.sample_id, r])), [data.liberation]);

  const selectedPsd = data.psd.find(r => r.sample_id === selectedSampleId) ?? null;
  const selectedLib = selectedSampleId ? libMap.get(selectedSampleId) ?? null : null;
  const selectedComm = selectedSampleId ? commMap.get(selectedSampleId) ?? null : null;
  const selectedChem = selectedSampleId ? chemMap.get(selectedSampleId) ?? null : null;

  // Build PSD curve for selected sample
  const psdCurve = useMemo(() => {
    if (!selectedPsd) return [];
    const mapping: [number, keyof LimsPsdRow][] = [
      [500, 'plus_500um_pct'], [212, 'plus_212um_pct'], [150, 'plus_150um_pct'],
      [106, 'plus_106um_pct'], [75, 'plus_75um_pct'], [53, 'plus_53um_pct'],
      [38, 'plus_38um_pct'],
    ];
    let cum = 0;
    const pts: { sieve: number; passing: number }[] = [];
    for (const [sz, key] of mapping) {
      const retained = Number(selectedPsd[key] ?? 0);
      cum += retained;
      pts.push({ sieve: sz, passing: Math.max(0, 100 - cum) });
    }
    if (pts.length) pts.push({ sieve: 25, passing: selectedPsd.minus_38um_pct ?? 0 });
    return pts.filter(p => p.passing >= 0 && p.sieve > 0);
  }, [selectedPsd]);

  // Aggregate stats
  const p80vals = data.psd.map(r => r.p80_um).filter((v): v is number => v !== null && v > 0);
  const d50vals = data.psd.map(r => r.d50_um).filter((v): v is number => v !== null && v > 0);
  const auHeadVals = data.psd.map(r => r.au_head_g_t).filter((v): v is number => v !== null && v > 0);
  const auDistVals = data.psd.map(r => r.dist_au_minus38_pct).filter((v): v is number => v !== null && v > 0);
  const bwiVals = data.comminution.map(r => r.bwi_kwh_t).filter((v): v is number => v !== null && v > 0);
  const auFreeVals = data.liberation.map(r => r.au_free_pct).filter((v): v is number => v !== null && v > 0);

  function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  function stdDev(a: number[]) {
    const m = mean(a); if (!m || a.length < 2) return null;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  }

  const avgP80 = mean(p80vals);
  const avgBwi = mean(bwiVals);
  const avgAuFree = mean(auFreeVals);

  // Sync the engine inputs to the project once data is loaded: F80 from the crushing
  // circuit (design criteria), grind target from the measured PSD / criteria P80. Runs
  // once per project so the user can still override afterwards.
  useEffect(() => {
    if (loading || syncedRef.current === project.id) return;
    const f = dcF80Crush ?? 12000;
    const tgt = Math.round(dcP80Grind ?? avgP80 ?? 75);
    setF80(f);
    setP80Target(tgt);
    syncedRef.current = project.id;
  }, [loading, dcF80Crush, dcP80Grind, avgP80, project.id]);

  // P80 optimization engine
  const bwiForEngine = bwiOverride ?? avgBwi ?? 15.5;
  const auFreeForEngine = avgAuFree;
  const recCeiling = effectiveRecoveryPct;              // project global recovery
  const goldPrice = project.gold_price_usd;
  const grade = project.gold_grade_g_t;
  const elecCostUsdKwh = DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;

  const enginePoints = useMemo(() => {
    const pts: { p80: number; energy: number; recovery: number; score: number; cost: number; netUsd: number }[] = [];
    const p80list = [500, 300, 212, 150, 106, 75, 53, 38, 25];
    for (const p of p80list) {
      const energy = bondEnergy(bwiForEngine, f80, p);
      const recovery = recoveryModel(p, auFreeForEngine, recCeiling);
      // Economic objective: net value per tonne = recovered-gold revenue − grinding energy cost.
      // Maximising recovery/energy under-grinds; gold value dwarfs the marginal kWh.
      const revenueUsdT = grade * (recovery / 100) / TROY_OZ_GRAMS * goldPrice;
      const cost = energy * elecCostUsdKwh;             // $/t grinding energy
      const netUsd = revenueUsdT - cost;
      pts.push({ p80: p, energy, recovery, score: netUsd, cost, netUsd });
    }
    return pts;
  }, [bwiForEngine, f80, auFreeForEngine, recCeiling, goldPrice, grade]);

  const optimalIdx = enginePoints.reduce((best, pt, i) => pt.score > enginePoints[best].score ? i : best, 0);
  const optimal = enginePoints[optimalIdx];

  // Liberation donut data
  const libDonut = selectedLib ? [
    { label: 'Au libre', value: selectedLib.au_free_pct ?? 0, color: '#f59e0b' },
    { label: 'Assoc. sulfures', value: selectedLib.au_sulphides_pct ?? 0, color: '#9d78f0' },
    { label: 'Assoc. silicates', value: selectedLib.au_silicates_pct ?? 0, color: '#56657a' },
    { label: 'Occlus', value: selectedLib.au_occluded_pct ?? 0, color: '#f06b6b' },
    { label: 'Prég-robbing', value: selectedLib.au_preg_rob_pct ?? 0, color: '#ef4444' },
  ].filter(d => d.value > 0) : [];

  // Distribution Au per fraction
  const auDist = selectedPsd ? [
    { label: '+212µm', value: selectedPsd.dist_au_plus212_pct ?? 0, color: '#f59e0b' },
    { label: '+75µm', value: selectedPsd.dist_au_plus75_pct ?? 0, color: '#fbbf24' },
    { label: '-38µm', value: selectedPsd.dist_au_minus38_pct ?? 0, color: '#10b981' },
  ] : [];

  const TABS = [
    { id: 'overview' as const,  label: 'Vue d\'ensemble', icon: BarChart3 },
    { id: 'psd' as const,       label: 'Courbe PSD',       icon: Activity },
    { id: 'liberation' as const,label: 'Libération Au',    icon: Microscope },
    { id: 'p80engine' as const, label: 'P80 Optimisation', icon: Target },
    { id: 'scenarios' as const, label: 'Scénarios',        icon: TrendingUp },
    { id: 'database' as const,  label: 'Base de données',  icon: FlaskConical },
  ];

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Granulométrie & PSD"
        subtitle={`${project.code} · ${data.psd.length} essais PSD · ${data.liberation.length} libérations · LIMS sync auto`}
        breadcrumb={['Données', 'Granulométrie / PSD']}
        actions={
          <button onClick={loadAll} className="btn btn-secondary gap-1.5 text-xs py-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualiser LIMS
          </button>
        }
      />

      {/* LIMS sync banner */}
      <div className="mx-6 mt-3 bg-teal-500/8 border border-teal-500/25 rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-teal-400">
          <CheckCircle2 size={14} />
          <span className="text-xs font-semibold uppercase tracking-wide">Synchronisation LIMS automatique</span>
        </div>
        <div className="h-3 w-px bg-teal-500/30" />
        <span className="text-xs text-teal-300">{data.psd.length} essais PSD importés</span>
        <div className="h-3 w-px bg-teal-500/30" />
        <span className="text-xs text-teal-300">{data.liberation.length} libérations</span>
        <div className="h-3 w-px bg-teal-500/30" />
        {avgP80 !== null && <span className="text-xs text-teal-300">P80 moy: <strong>{avgP80.toFixed(0)} µm</strong></span>}
        <div className="h-3 w-px bg-teal-500/30" />
        {avgBwi !== null && <span className="text-xs text-teal-300">BWi moy: <strong>{avgBwi.toFixed(1)} kWh/t</strong></span>}
        {auFreeVals.length > 0 && (
          <>
            <div className="h-3 w-px bg-teal-500/30" />
            <span className="text-xs text-teal-300">Au libre moy: <strong>{avgAuFree?.toFixed(1)}%</strong></span>
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-mf-border px-6 flex gap-1 mt-4 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-teal-400 text-teal-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-mf-txt4 gap-2">
            <RefreshCw size={16} className="animate-spin" /> Chargement données LIMS…
          </div>
        ) : (

          <>
            {/* ── OVERVIEW ──────────────────────────────────────────────── */}
            {tab === 'overview' && (
              <div className="space-y-5">
                {/* KPI row */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Essais PSD (LIMS)', val: data.psd.length, unit: '', color: '#14B8A6', icon: <Layers size={14} className="text-teal-400"/> },
                    { label: 'P80 moyen', val: avgP80, unit: 'µm', color: '#14B8A6', icon: <Target size={14} className="text-teal-400"/> },
                    { label: 'Bond Wi moyen', val: avgBwi, unit: 'kWh/t', color: '#38BDF8', icon: <Zap size={14} className="text-sky-400"/> },
                    { label: 'Au libre moyen', val: avgAuFree, unit: '%', color: '#F59E0B', icon: <FlaskConical size={14} className="text-amber-400"/> },
                  ].map(k => (
                    <div key={k.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg bg-mf-hover border border-mf-border flex items-center justify-center">{k.icon}</div>
                        <span className="text-[10px] text-mf-txt4">{k.label}</span>
                      </div>
                      <div className="text-2xl font-mono font-bold" style={{ color: k.color }}>
                        {k.val !== null && k.val !== undefined ? (typeof k.val === 'number' ? k.val.toFixed(k.val < 10 ? 2 : 0) : k.val) : '—'}
                        {k.val !== null && k.val !== undefined && k.unit && <span className="text-xs text-mf-txt4 font-normal ml-1">{k.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* P80 distribution chart */}
                {p80vals.length > 0 && (
                  <div className="rounded-xl border border-mf-border bg-mf-card p-5">
                    <div className="text-sm font-semibold text-mf-txt mb-1">Distribution des P80 — tous essais LIMS</div>
                    <div className="text-[10px] text-mf-txt4 mb-4">n={p80vals.length} · min={Math.min(...p80vals).toFixed(0)} µm · max={Math.max(...p80vals).toFixed(0)} µm · σ={stdDev(p80vals)?.toFixed(1) ?? '—'} µm</div>
                    <svg viewBox="0 0 600 140" className="w-full h-36">
                      {/* Grid */}
                      {[25, 50, 75, 100, 125, 150, 200, 300, 500].map((v, i) => {
                        const x = xLog(v, 20, 600);
                        return (
                          <g key={i}>
                            <line x1={x} y1={10} x2={x} y2={110} stroke="rgba(255,255,255,0.05)" />
                            <text x={x} y={125} fill="#6b7280" fontSize="8" textAnchor="middle">{v}</text>
                          </g>
                        );
                      })}
                      <text x={300} y={138} fill="#6b7280" fontSize="8" textAnchor="middle">P80 (µm)</text>
                      {/* Dots per sample */}
                      {p80vals.map((v, i) => (
                        <circle key={i} cx={xLog(v, 20, 600)} cy={60 + (Math.sin(i * 2.3) * 20)} r="5" fill="#14b8a6" opacity="0.65">
                          <title>{`P80=${v}µm`}</title>
                        </circle>
                      ))}
                      {/* Mean line */}
                      {avgP80 && (
                        <>
                          <line x1={xLog(avgP80, 20, 600)} y1={10} x2={xLog(avgP80, 20, 600)} y2={110} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="4 2" />
                          <text x={xLog(avgP80, 20, 600)} y={8} fill="#f59e0b" fontSize="8" textAnchor="middle">μ={avgP80.toFixed(0)}</text>
                        </>
                      )}
                    </svg>
                  </div>
                )}

                {/* Au distribution per fraction overview */}
                {data.psd.length > 0 && (
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Distribution Au +212µm', key: 'dist_au_plus212_pct' as keyof LimsPsdRow, color: '#f59e0b', note: 'Au grossier' },
                      { label: 'Distribution Au +75µm', key: 'dist_au_plus75_pct' as keyof LimsPsdRow, color: '#fbbf24', note: 'Au fraction médiane' },
                      { label: 'Distribution Au -38µm', key: 'dist_au_minus38_pct' as keyof LimsPsdRow, color: '#10b981', note: 'Au fin (argile/slimes)' },
                    ].map(f => {
                      const vals = data.psd.map(r => Number(r[f.key])).filter(v => v > 0);
                      const m = mean(vals);
                      return (
                        <div key={f.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
                          <div className="text-xs font-semibold text-mf-txt mb-0.5">{f.label}</div>
                          <div className="text-[10px] text-mf-txt4 mb-3">{f.note} · n={vals.length}</div>
                          {m !== null ? (
                            <>
                              <div className="text-2xl font-mono font-bold" style={{ color: f.color }}>{m.toFixed(1)}<span className="text-xs text-mf-txt4 font-normal ml-1">%</span></div>
                              <div className="mt-2 h-1.5 bg-mf-border/30 rounded-full">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, m)}%`, backgroundColor: f.color, opacity: 0.7 }} />
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-mf-txt4">Pas de données</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Sample selector + mini-stats */}
                {data.psd.length > 0 && (
                  <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm font-semibold text-mf-txt">Sélectionner un échantillon</div>
                      <select className="input-field w-56 text-xs"
                        value={selectedSampleId ?? ''}
                        onChange={e => setSelectedSampleId(e.target.value || null)}>
                        <option value="">— Choisir —</option>
                        {data.psd.map(r => {
                          const s = sampleMap.get(r.sample_id ?? '');
                          return <option key={r.id} value={r.sample_id ?? ''}>{s?.sample_id ?? r.sample_id?.slice(0, 8)} · P80={r.p80_um ?? '?'}µm</option>;
                        })}
                      </select>
                    </div>
                    {selectedPsd && (
                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { label: 'P80', val: selectedPsd.p80_um, unit: 'µm', color: '#14b8a6' },
                          { label: 'D50', val: selectedPsd.d50_um, unit: 'µm', color: '#38bdf8' },
                          { label: 'Au tête', val: selectedPsd.au_head_g_t, unit: 'g/t', color: '#f59e0b' },
                          { label: 'Au -38µm', val: selectedPsd.au_minus38_g_t, unit: 'g/t', color: '#10b981' },
                        ].map(k => (
                          <div key={k.label} className="text-center p-3 rounded-lg bg-mf-hover/30 border border-mf-border/50">
                            <div className="text-[10px] text-mf-txt4 mb-1">{k.label}</div>
                            <div className="text-lg font-mono font-bold" style={{ color: k.color }}>
                              {k.val !== null && k.val !== undefined ? k.val.toFixed(k.val < 10 ? 2 : 0) : '—'}
                              <span className="text-[10px] text-mf-txt4 font-normal ml-1">{k.unit}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {data.psd.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-48 text-center rounded-xl border border-dashed border-mf-border">
                    <Layers size={32} className="text-mf-txt4 mb-3" />
                    <p className="text-sm font-semibold text-mf-txt mb-1">Aucun essai PSD dans LIMS</p>
                    <p className="text-xs text-mf-txt4 max-w-sm">Importez des données de granulométrie dans le module LIMS (famille PSD — gabarit Excel) pour les visualiser ici automatiquement.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── PSD CURVE ──────────────────────────────────────────── */}
            {tab === 'psd' && (
              <div className="space-y-4">
                {/* Sample selector */}
                <div className="flex items-center gap-3">
                  <label className="text-xs text-mf-txt4 shrink-0">Échantillon :</label>
                  <select className="input-field flex-1 max-w-sm text-sm"
                    value={selectedSampleId ?? ''}
                    onChange={e => setSelectedSampleId(e.target.value || null)}>
                    <option value="">— Choisir —</option>
                    {data.psd.map(r => {
                      const s = sampleMap.get(r.sample_id ?? '');
                      return <option key={r.id} value={r.sample_id ?? ''}>{s?.sample_id ?? r.sample_id?.slice(0, 8)} (P80={r.p80_um ?? '?'}µm, {s?.domain ?? '—'})</option>;
                    })}
                  </select>
                </div>

                {data.psd.length === 0 ? (
                  <div className="text-center text-mf-txt4 py-16 text-sm">Aucune donnée PSD dans LIMS</div>
                ) : psdCurve.length < 2 ? (
                  <div className="text-center text-mf-txt4 py-16 text-sm">Données de fractions insuffisantes pour tracer la courbe (importez via gabarit PSD LIMS)</div>
                ) : (
                  <>
                    {/* Main PSD curve */}
                    <div className="rounded-xl border border-mf-border bg-mf-card p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="text-sm font-semibold text-mf-txt">Courbe granulométrique — {sampleMap.get(selectedSampleId ?? '')?.sample_id ?? '—'}</div>
                          <div className="text-[10px] text-mf-txt4 mt-0.5">% Passant cumulé · échelle log</div>
                        </div>
                        <div className="flex items-center gap-4 text-[10px]">
                          {selectedPsd?.p80_um && <span className="text-teal-400 font-mono font-bold">P80 = {selectedPsd.p80_um} µm</span>}
                          {selectedPsd?.d50_um && <span className="text-sky-400 font-mono">D50 = {selectedPsd.d50_um} µm</span>}
                        </div>
                      </div>
                      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 260 }}>
                        {/* Grid */}
                        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(p => (
                          <g key={p}>
                            <line x1={PL} y1={yPct(p)} x2={PL + PW} y2={yPct(p)} stroke="rgba(255,255,255,0.04)" />
                            <text x={PL - 4} y={yPct(p) + 3} fill="#6b7280" fontSize="8" textAnchor="end">{p}</text>
                          </g>
                        ))}
                        {[25, 38, 53, 75, 106, 150, 212, 300, 500].map(v => {
                          const x = xLog(v);
                          return (
                            <g key={v}>
                              <line x1={x} y1={PT} x2={x} y2={PT + PH} stroke="rgba(255,255,255,0.04)" />
                              <text x={x} y={PT + PH + 14} fill="#6b7280" fontSize="8" textAnchor="middle">{v}</text>
                            </g>
                          );
                        })}
                        {/* Axis labels */}
                        <text x={PL + PW / 2} y={H - 2} fill="#9ca3af" fontSize="9" textAnchor="middle">Ouverture tamis (µm) — échelle logarithmique</text>
                        <text x={12} y={PT + PH / 2} fill="#9ca3af" fontSize="9" textAnchor="middle" transform={`rotate(-90,12,${PT + PH / 2})`}>% Passant cumulé</text>
                        {/* All-samples faded curves */}
                        {data.psd.slice(0, 15).map((r, ri) => {
                          if (r.sample_id === selectedSampleId) return null;
                          let cum = 0;
                          const pts = [
                            [500, r.plus_500um_pct], [212, r.plus_212um_pct], [150, r.plus_150um_pct],
                            [106, r.plus_106um_pct], [75, r.plus_75um_pct], [53, r.plus_53um_pct], [38, r.plus_38um_pct],
                          ].map(([sz, val]) => {
                            cum += Number(val ?? 0);
                            return `${xLog(Math.max(sz as number, 25))},${yPct(Math.max(0, 100 - cum))}`;
                          }).join(' ');
                          return <polyline key={ri} points={pts} fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.12" />;
                        })}
                        {/* P80 reference line */}
                        {selectedPsd?.p80_um && (
                          <>
                            <line x1={xLog(selectedPsd.p80_um)} y1={PT} x2={xLog(selectedPsd.p80_um)} y2={yPct(80)} stroke="#14b8a6" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
                            <line x1={PL} y1={yPct(80)} x2={xLog(selectedPsd.p80_um)} y2={yPct(80)} stroke="#14b8a6" strokeWidth="1" strokeDasharray="4 2" opacity="0.6" />
                            <circle cx={xLog(selectedPsd.p80_um)} cy={yPct(80)} r="5" fill="#14b8a6" opacity="0.9" />
                          </>
                        )}
                        {/* Main curve */}
                        <GrainCurve fractions={psdCurve} color="#14b8a6" label="PSD" />
                      </svg>
                    </div>

                    {/* Au distribution bar */}
                    {auDist.some(d => d.value > 0) && (
                      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                        <div className="text-sm font-semibold text-mf-txt mb-3">Distribution de l'or par fraction granulométrique</div>
                        <div className="space-y-2">
                          {auDist.map(d => (
                            <div key={d.label} className="flex items-center gap-3">
                              <div className="text-xs text-mf-txt3 w-20 shrink-0">{d.label}</div>
                              <div className="flex-1 h-5 bg-mf-border/20 rounded-full overflow-hidden relative">
                                <div className="h-full rounded-full transition-all duration-700 flex items-center pl-2"
                                  style={{ width: `${Math.min(100, d.value)}%`, backgroundColor: d.color, opacity: 0.8 }}>
                                  {d.value > 8 && <span className="text-[9px] font-bold text-white">{d.value.toFixed(1)}%</span>}
                                </div>
                              </div>
                              <div className="text-xs font-mono font-bold w-10 text-right" style={{ color: d.color }}>{d.value.toFixed(1)}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fraction table */}
                    <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
                      <div className="px-4 py-3 border-b border-mf-border">
                        <div className="text-xs font-bold text-mf-txt4 uppercase tracking-wider">Données par fraction</div>
                      </div>
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Fraction</th>
                            <th className="text-right">Retenu (%)</th>
                            <th className="text-right">Passant (%)</th>
                            <th className="text-right">Au (g/t)</th>
                            <th className="text-right">Distr. Au (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label: '+500 µm', passing: 100 - Number(selectedPsd?.plus_500um_pct ?? 0), retained: selectedPsd?.plus_500um_pct, au: null, dist: selectedPsd?.dist_au_plus212_pct },
                            { label: '+212 µm', passing: 100 - Number(selectedPsd?.plus_500um_pct ?? 0) - Number(selectedPsd?.plus_212um_pct ?? 0), retained: selectedPsd?.plus_212um_pct, au: null, dist: selectedPsd?.dist_au_plus212_pct },
                            { label: '+75 µm', passing: null, retained: selectedPsd?.plus_75um_pct, au: null, dist: selectedPsd?.dist_au_plus75_pct },
                            { label: '+38 µm', passing: null, retained: selectedPsd?.plus_38um_pct, au: null, dist: null },
                            { label: '−38 µm', passing: selectedPsd?.minus_38um_pct, retained: selectedPsd?.minus_38um_pct, au: selectedPsd?.au_minus38_g_t, dist: selectedPsd?.dist_au_minus38_pct },
                          ].map(row => (
                            <tr key={row.label}>
                              <td><span className="font-mono text-teal-400 text-xs">{row.label}</span></td>
                              <td className="num">{row.retained !== null && row.retained !== undefined ? Number(row.retained).toFixed(1) : '—'}</td>
                              <td className="num">{row.passing !== null && row.passing !== undefined ? Number(row.passing).toFixed(1) : '—'}</td>
                              <td className="num text-amber-400">{row.au !== null && row.au !== undefined ? Number(row.au).toFixed(3) : '—'}</td>
                              <td className="num text-emerald-400">{row.dist !== null && row.dist !== undefined ? Number(row.dist).toFixed(1) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── LIBERATION ─────────────────────────────────────────── */}
            {tab === 'liberation' && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <label className="text-xs text-mf-txt4 shrink-0">Échantillon :</label>
                  <select className="input-field flex-1 max-w-sm text-sm"
                    value={selectedSampleId ?? ''}
                    onChange={e => setSelectedSampleId(e.target.value || null)}>
                    <option value="">— Choisir —</option>
                    {data.liberation.map(r => {
                      const s = sampleMap.get(r.sample_id ?? '');
                      return <option key={r.sample_id} value={r.sample_id ?? ''}>{s?.sample_id ?? r.sample_id?.slice(0,8)} · Au libre={r.au_free_pct ?? '?'}%</option>;
                    })}
                  </select>
                </div>

                {data.liberation.length === 0 ? (
                  <div className="text-center text-mf-txt4 py-16 text-sm">Aucune donnée de libération dans LIMS — importez via le gabarit Libération Au</div>
                ) : selectedLib ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* Pie/donut chart SVG */}
                    <div className="rounded-xl border border-mf-border bg-mf-card p-5">
                      <div className="text-sm font-semibold text-mf-txt mb-3">Spéciation de l'or — {sampleMap.get(selectedSampleId ?? '')?.sample_id}</div>
                      {libDonut.length > 0 ? (
                        <>
                          <svg viewBox="0 0 220 220" className="w-full max-w-[220px] mx-auto">
                            {(() => {
                              const total = libDonut.reduce((s, d) => s + d.value, 0);
                              let startAngle = -Math.PI / 2;
                              const cx = 110, cy = 110, r = 80, inner = 50;
                              return libDonut.map((d, i) => {
                                const angle = (d.value / (total || 1)) * 2 * Math.PI;
                                const x1 = cx + r * Math.cos(startAngle);
                                const y1 = cy + r * Math.sin(startAngle);
                                const x2 = cx + r * Math.cos(startAngle + angle);
                                const y2 = cy + r * Math.sin(startAngle + angle);
                                const xi1 = cx + inner * Math.cos(startAngle);
                                const yi1 = cy + inner * Math.sin(startAngle);
                                const xi2 = cx + inner * Math.cos(startAngle + angle);
                                const yi2 = cy + inner * Math.sin(startAngle + angle);
                                const large = angle > Math.PI ? 1 : 0;
                                const path = `M ${xi1} ${yi1} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`;
                                const mid = startAngle + angle / 2;
                                const lx = cx + (r + 12) * Math.cos(mid);
                                const ly = cy + (r + 12) * Math.sin(mid);
                                startAngle += angle;
                                return (
                                  <g key={i}>
                                    <path d={path} fill={d.color} opacity="0.85" />
                                    {d.value > 5 && <text x={lx} y={ly} fill={d.color} fontSize="9" textAnchor="middle" dominantBaseline="middle" fontWeight="600">{d.value.toFixed(0)}%</text>}
                                  </g>
                                );
                              });
                            })()}
                            <text x="110" y="106" fill="#e5e7eb" fontSize="14" textAnchor="middle" fontWeight="700">{selectedLib.au_free_pct?.toFixed(0)}%</text>
                            <text x="110" y="120" fill="#9ca3af" fontSize="8" textAnchor="middle">Au libre</text>
                          </svg>
                          <div className="flex flex-wrap gap-2 justify-center mt-3">
                            {libDonut.map(d => (
                              <div key={d.label} className="flex items-center gap-1.5">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                <span className="text-[10px] text-mf-txt3">{d.label}: {d.value.toFixed(1)}%</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : <p className="text-xs text-mf-txt4 text-center py-8">Données de spéciation non disponibles</p>}
                    </div>

                    {/* Stats panel */}
                    <div className="space-y-3">
                      {[
                        { label: 'P80 broyage libération', val: selectedLib.p80_um, unit: 'µm', color: '#14b8a6', note: 'P80 cible pour libération optimale' },
                        { label: 'Au libre (%)', val: selectedLib.au_free_pct, unit: '%', color: '#f59e0b', note: selectedLib.au_free_pct !== null && selectedLib.au_free_pct < 50 ? '⚠ Faible libération — broyage fin requis' : '✓ Libération favorable' },
                        { label: 'Au assoc. sulfures', val: selectedLib.au_sulphides_pct, unit: '%', color: '#9d78f0', note: 'Flottation ou prétraitement' },
                        { label: 'Au occlus', val: selectedLib.au_occluded_pct, unit: '%', color: '#f06b6b', note: 'Non libérable par broyage seul' },
                        { label: 'Au prég-robbing', val: selectedLib.au_preg_rob_pct, unit: '%', color: '#ef4444', note: (selectedLib.au_preg_rob_pct ?? 0) > 2 ? '⚠ Risque prég-robbing' : 'Faible risque' },
                      ].map(s => (
                        <div key={s.label} className="rounded-lg border border-mf-border bg-mf-hover/20 p-3 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-semibold text-mf-txt">{s.label}</div>
                            <div className="text-[10px] text-mf-txt4 mt-0.5">{s.note}</div>
                          </div>
                          <div className="text-lg font-mono font-bold" style={{ color: s.color }}>
                            {s.val !== null && s.val !== undefined ? s.val.toFixed(1) : '—'}
                            <span className="text-xs text-mf-txt4 font-normal ml-1">{s.unit}</span>
                          </div>
                        </div>
                      ))}

                      {/* Comminution context */}
                      {selectedComm && (
                        <div className="rounded-lg border border-mf-border bg-mf-hover/20 p-3">
                          <div className="text-xs font-semibold text-mf-txt mb-2">Données comminution (LIMS)</div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>BWi: <span className="font-mono text-sky-400">{selectedComm.bwi_kwh_t?.toFixed(1)} kWh/t</span></div>
                            <div>SG: <span className="font-mono text-mf-txt">{selectedComm.sg_t_m3?.toFixed(2)} t/m³</span></div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-mf-txt4 py-12 text-sm">Sélectionnez un échantillon ci-dessus</div>
                )}

                {/* All liberation summary */}
                {data.liberation.length > 1 && (
                  <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-3">Synthèse libération — tous échantillons</div>
                    <div className="overflow-x-auto">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Échantillon</th>
                            <th className="text-right">P80 lib. (µm)</th>
                            <th className="text-right">Au libre (%)</th>
                            <th className="text-right">Au/sulf. (%)</th>
                            <th className="text-right">Au occlus (%)</th>
                            <th className="text-right">Prég-rob. (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.liberation.map(r => {
                            const s = sampleMap.get(r.sample_id ?? '');
                            return (
                              <tr key={r.sample_id} className={r.sample_id === selectedSampleId ? 'bg-teal-500/5' : ''}>
                                <td><span className="font-mono text-amber-400 text-xs">{s?.sample_id ?? r.sample_id?.slice(0, 8)}</span></td>
                                <td className="num text-teal-400">{r.p80_um ?? '—'}</td>
                                <td className="num text-amber-400">{r.au_free_pct?.toFixed(1) ?? '—'}</td>
                                <td className="num text-purple-400">{r.au_sulphides_pct?.toFixed(1) ?? '—'}</td>
                                <td className="num text-red-400">{r.au_occluded_pct?.toFixed(1) ?? '—'}</td>
                                <td className="num text-red-400">{r.au_preg_rob_pct?.toFixed(1) ?? '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── P80 ENGINE ──────────────────────────────────────────── */}
            {tab === 'p80engine' && (
              <div className="space-y-4">
                {/* Controls */}
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="text-sm font-semibold text-mf-txt mb-3">Paramètres d'optimisation</div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <label className="label">P80 cible (µm)</label>
                      <input type="number" className="input-field" value={p80Target}
                        onChange={e => setP80Target(+e.target.value || 75)} />
                    </div>
                    <div>
                      <label className="label">F80 alimentation (µm)</label>
                      <input type="number" className="input-field" value={f80}
                        onChange={e => setF80(+e.target.value || 12000)} />
                    </div>
                    <div>
                      <label className="label">BWi manuel (kWh/t)</label>
                      <input type="number" className="input-field" placeholder={`Auto: ${avgBwi?.toFixed(1) ?? '?'}`}
                        value={bwiOverride ?? ''}
                        onChange={e => setBwiOverride(e.target.value ? +e.target.value : null)} />
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="text-[10px] text-mf-txt4 mb-1">Données LIMS actives</div>
                      <div className="text-xs text-teal-400 font-semibold">
                        BWi={bwiForEngine.toFixed(1)} kWh/t · Au libre={auFreeForEngine?.toFixed(0) ?? '?'}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Optimal banner */}
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-6">
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Target size={20} className="text-emerald-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-emerald-400 mb-0.5">P80 optimal calculé</div>
                    <div className="text-sm text-mf-txt3">Valeur nette maximisée — revenu or (@ ${goldPrice}/oz) − coût énergie broyage</div>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-mono font-bold text-emerald-400">{optimal.p80} µm</div>
                    <div className="text-xs text-mf-txt4">{optimal.energy.toFixed(2)} kWh/t · {optimal.recovery.toFixed(1)}% récup. · {optimal.netUsd.toFixed(1)} $/t net</div>
                  </div>
                </div>

                {/* Dual-axis chart */}
                <div className="rounded-xl border border-mf-border bg-mf-card p-5">
                  <div className="text-sm font-semibold text-mf-txt mb-1">Énergie Bond vs Récupération — Courbe P80</div>
                  <div className="flex gap-4 mb-4 text-[10px]">
                    <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-amber-400 inline-block rounded" />Énergie (kWh/t)</span>
                    <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-teal-400 inline-block rounded" />Récupération (%)</span>
                    <span className="flex items-center gap-1.5"><span className="w-4 h-0.5 bg-emerald-400 inline-block rounded" style={{ borderTop: '2px dashed #10b981', display: 'inline-block' }} />P80 optimal</span>
                  </div>
                  <svg viewBox={`0 0 600 240`} className="w-full" style={{ height: 240 }}>
                    {[0, 25, 50, 75, 100].map(p => (
                      <line key={p} x1={45} y1={20 + (1 - p / 100) * 180} x2={570} y2={20 + (1 - p / 100) * 180} stroke="rgba(255,255,255,0.05)" />
                    ))}
                    {enginePoints.map((pt, i) => {
                      const x = 45 + (i / (enginePoints.length - 1)) * 525;
                      return <text key={i} x={x} y={218} fill="#6b7280" fontSize="8" textAnchor="middle">{pt.p80}</text>;
                    })}
                    <text x={310} y={235} fill="#9ca3af" fontSize="8" textAnchor="middle">P80 (µm) →</text>
                    {/* Energy */}
                    {(() => {
                      const maxE = Math.max(...enginePoints.map(p => p.energy));
                      const pts = enginePoints.map((pt, i) => `${45 + (i / (enginePoints.length - 1)) * 525},${20 + (1 - pt.energy / maxE) * 180}`).join(' ');
                      return <polyline points={pts} fill="none" stroke="#f59e0b" strokeWidth="2" />;
                    })()}
                    {/* Recovery */}
                    {(() => {
                      const pts = enginePoints.map((pt, i) => `${45 + (i / (enginePoints.length - 1)) * 525},${20 + (1 - pt.recovery / 100) * 180}`).join(' ');
                      return <polyline points={pts} fill="none" stroke="#14b8a6" strokeWidth="2" />;
                    })()}
                    {/* Optimal marker */}
                    {(() => {
                      const x = 45 + (optimalIdx / (enginePoints.length - 1)) * 525;
                      const y = 20 + (1 - optimal.recovery / 100) * 180;
                      return (
                        <>
                          <line x1={x} y1={20} x2={x} y2={200} stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 3" />
                          <circle cx={x} cy={y} r="6" fill="#10b981" />
                          <text x={x + 8} y={y - 4} fill="#10b981" fontSize="9">{optimal.p80}µm</text>
                        </>
                      );
                    })()}
                    {/* Target P80 marker */}
                    {(() => {
                      const idx = enginePoints.findIndex(p => p.p80 <= p80Target);
                      if (idx < 0) return null;
                      const x = 45 + (idx / (enginePoints.length - 1)) * 525;
                      return <line x1={x} y1={20} x2={x} y2={200} stroke="#9d78f0" strokeWidth="1.5" strokeDasharray="3 2" />;
                    })()}
                  </svg>
                </div>

                {/* Table */}
                <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>P80 (µm)</th>
                        <th className="text-right">Énergie (kWh/t)</th>
                        <th className="text-right">Récup. (%) est.</th>
                        <th className="text-right">Coût ($/ kWh)</th>
                        <th className="text-right">Score opt.</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {enginePoints.map((pt, i) => (
                        <tr key={i} className={i === optimalIdx ? 'bg-emerald-500/5' : pt.p80 === p80Target ? 'bg-purple-500/5' : ''}>
                          <td><span className="font-mono text-sm">{pt.p80}</span></td>
                          <td className="num text-amber-400">{pt.energy.toFixed(2)}</td>
                          <td className="num text-teal-400">{pt.recovery.toFixed(1)}</td>
                          <td className="num text-mf-txt3">{pt.cost.toFixed(3)}</td>
                          <td className="num">{(pt.score * 10).toFixed(1)}</td>
                          <td className="text-[10px]">
                            {i === optimalIdx && <span className="badge badge-green">Optimal</span>}
                            {pt.p80 === p80Target && i !== optimalIdx && <span className="badge badge-gray">Cible</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── SCENARIOS ──────────────────────────────────────────── */}
            {tab === 'scenarios' && (
              <div className="space-y-5">
                {/* Réfractarité / Preg-Robbing diagnostic */}
                {(() => {
                  const avgPregRob = mean(data.liberation.map(r => r.au_preg_rob_pct).filter((v): v is number => v !== null && v > 0));
                  const avgAuOcclus = mean(data.liberation.map(r => r.au_occluded_pct).filter((v): v is number => v !== null && v > 0));
                  const avgAuSulph = mean(data.liberation.map(r => r.au_sulphides_pct).filter((v): v is number => v !== null && v > 0));
                  const sSulfVals = data.chem.map(r => r.s_sulfide_pct).filter((v): v is number => v !== null && v > 0);
                  const avgSSulf = mean(sSulfVals);
                  const isPregRob = (avgPregRob ?? 0) > 2;
                  const isRefractory = (avgAuOcclus ?? 0) > 15 || (avgSSulf ?? 0) > 2;
                  const liberationOk = (avgAuFree ?? 0) > 60;

                  return (
                    <div className="rounded-xl border border-mf-border bg-mf-card p-5">
                      <div className="flex items-center gap-2 mb-4">
                        <AlertTriangle size={15} className="text-amber-400" />
                        <div className="text-sm font-bold text-mf-txt">Diagnostic de Réfractarité &amp; Prég-Robbing</div>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        {[
                          {
                            label: 'Au libre (MLA)',
                            val: avgAuFree,
                            unit: '%',
                            status: liberationOk ? 'ok' : 'warn',
                            note: liberationOk ? 'Libération favorable (> 60%)' : 'Libération insuffisante — broyage fin requis',
                          },
                          {
                            label: 'Au occlus',
                            val: avgAuOcclus,
                            unit: '%',
                            status: (avgAuOcclus ?? 0) > 15 ? 'critical' : 'ok',
                            note: (avgAuOcclus ?? 0) > 15 ? 'Occlusion > 15% — minéral réfractaire' : 'Occlusion faible — non réfractaire',
                          },
                          {
                            label: 'Au prég-robbing',
                            val: avgPregRob,
                            unit: '%',
                            status: isPregRob ? 'critical' : 'ok',
                            note: isPregRob ? 'Prég-robbing > 2% — risque sévère' : 'Risque prég-robbing faible',
                          },
                          {
                            label: 'Au assoc. sulfures',
                            val: avgAuSulph,
                            unit: '%',
                            status: (avgAuSulph ?? 0) > 30 ? 'warn' : 'ok',
                            note: (avgAuSulph ?? 0) > 30 ? 'Encapsulation sulfures importante — flottation requise' : 'Assoc. sulfures modérée',
                          },
                          {
                            label: 'S sulfure',
                            val: avgSSulf,
                            unit: '%',
                            status: (avgSSulf ?? 0) > 2 ? 'warn' : 'ok',
                            note: (avgSSulf ?? 0) > 2 ? 'S sulf. > 2% — sulfures porteurs, prétraitement à évaluer' : 'Teneur sulfures faible',
                          },
                          {
                            label: 'Bond Wi',
                            val: avgBwi,
                            unit: 'kWh/t',
                            status: (avgBwi ?? 0) > 18 ? 'warn' : 'ok',
                            note: (avgBwi ?? 0) > 18 ? 'Minerai dur (BWi > 18) — HPGR ou circuit SAG adapté' : 'Dureté acceptable — circuit standard Ball mill',
                          },
                        ].map(item => {
                          const color = item.status === 'critical' ? '#ef4444' : item.status === 'warn' ? '#f59e0b' : '#10b981';
                          const Icon = item.status === 'critical' ? AlertTriangle : item.status === 'warn' ? Info : CheckCircle2;
                          return (
                            <div key={item.label} className="p-3 rounded-lg border border-mf-border bg-mf-hover/20">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] text-mf-txt4">{item.label}</span>
                                <Icon size={11} style={{ color }} />
                              </div>
                              <div className="text-lg font-mono font-bold" style={{ color }}>
                                {item.val !== null && item.val !== undefined ? item.val.toFixed(1) : '—'}
                                <span className="text-[10px] text-mf-txt4 font-normal ml-1">{item.unit}</span>
                              </div>
                              <div className="text-[9px] text-mf-txt4 mt-1 leading-tight">{item.note}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Summary badge */}
                      {(isPregRob || isRefractory) ? (
                        <div className="flex items-start gap-3 p-3 bg-red-500/8 border border-red-500/25 rounded-lg">
                          <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-red-400 mb-0.5">Minerai réfractaire / prég-robbing détecté</div>
                            <div className="text-[10px] text-mf-txt3">
                              {isPregRob && `Prég-robbing: carbone organique absorbe l'or dissous — circuit CIP isolé ou traitement Corg (ozone, KMnO₄) requis. `}
                              {isRefractory && `Réfractarité: or encapsulé dans sulfures ou occlus — prétraitement oxydatif (POX, roasting, BioLeach) nécessaire avant lixiviation.`}
                            </div>
                          </div>
                        </div>
                      ) : (liberationOk ? (
                        <div className="flex items-start gap-3 p-3 bg-emerald-500/8 border border-emerald-500/25 rounded-lg">
                          <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                          <div className="text-[10px] text-emerald-300">Minerai non réfractaire — libération favorable. Circuit CIL/CIP direct applicable sans prétraitement.</div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-3 p-3 bg-amber-500/8 border border-amber-500/20 rounded-lg">
                          <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
                          <div className="text-[10px] text-mf-txt3">Données libération insuffisantes pour diagnostic complet — importez données MLA via LIMS.</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Circuit proposals */}
                <div className="text-xs font-bold uppercase tracking-wider text-mf-txt4 mb-1 px-0.5">Propositions de circuits de broyage</div>
                <div className="text-[10px] text-mf-txt4 mb-3 px-0.5">Basé sur BWi moy. = {avgBwi?.toFixed(1) ?? '?'} kWh/t · Au libre moy. = {avgAuFree?.toFixed(0) ?? '?'}%</div>
                {(() => {
                  const bwi = avgBwi ?? 15.5;
                  const auFreeAvg = avgAuFree ?? 60;
                  const sSulfAvg = mean(data.chem.map(r => r.s_sulfide_pct).filter((v): v is number => v !== null && v > 0)) ?? 0;

                  // 4 circuit scenarios with full equipment chain
                  const circuits = [
                    {
                      id: 'sag_ball',
                      label: 'SAG Mill + Ball Mill',
                      shortLabel: 'SAB',
                      equipment: [
                        { name: 'Concasseur primaire', detail: 'Gyratory (60×89" typ.)', icon: '①' },
                        { name: 'SAG Mill', detail: `Ø5.5–9.8m · BWi est. ${bwi.toFixed(1)} kWh/t`, icon: '②' },
                        { name: 'Ball Mill', detail: 'Ø4.0–7.3m · circuit fermé hydrocyclone', icon: '③' },
                        { name: 'Classification', detail: 'Hydrocyclones (P80 cible)', icon: '④' },
                      ],
                      p80Target: 75,
                      capex: bwi > 16 ? 'high' : 'medium',
                      opex: 'medium',
                      applicability: bwi >= 10 && bwi <= 22 ? 'high' : 'medium',
                      note: 'Circuit classique or — le plus répandu. SAG libère les masses, Ball mill affine à P80 cible.',
                      pros: ['Circuit flexible, adapté variabilité minerai', 'Throughput élevé (1000–10 000 t/j)', 'Bien documenté pour CIL/CIP'],
                      cons: ['CAPEX élevé pour grande usine', 'Consommation acier SAG'],
                      color: '#14b8a6',
                    },
                    {
                      id: 'hpgr_ball',
                      label: 'HPGR + Ball Mill',
                      shortLabel: 'HBM',
                      equipment: [
                        { name: 'Concasseur primaire', detail: 'Jaw / Gyratory', icon: '①' },
                        { name: 'Concasseur secondaire', detail: 'Cone Crusher (P100 ≈ 40mm)', icon: '②' },
                        { name: 'HPGR', detail: '3.5–7 bar · 1.0–1.4 kWh/t réduction énergie', icon: '③' },
                        { name: 'Ball Mill', detail: 'Ø3.5–5.5m · P80 75–106 µm', icon: '④' },
                      ],
                      p80Target: 90,
                      capex: 'high',
                      opex: bwi > 16 ? 'low' : 'medium',
                      applicability: bwi > 16 ? 'high' : 'medium',
                      note: 'Idéal pour minerais durs (BWi > 16). HPGR réduit énergie broyage de 15–25% vs SAG seul.',
                      pros: ['Économie énergie 15–25% vs SAG', 'Efficace pour minerais très durs', 'Moins de consommation acier'],
                      cons: ['CAPEX plus élevé que SAB', 'Usure galets HPGR', 'Sensible à l\'humidité'],
                      color: '#38bdf8',
                    },
                    {
                      id: 'crush_ball',
                      label: 'Concassage 3 étages + Ball Mill',
                      shortLabel: 'CBM',
                      equipment: [
                        { name: 'Concasseur primaire', detail: 'Jaw Crusher (P100 ≈ 150mm)', icon: '①' },
                        { name: 'Concasseur secondaire', detail: 'Cone Crusher standard', icon: '②' },
                        { name: 'Concasseur tertiaire', detail: 'Cone HP / VSI (P100 ≈ 12mm)', icon: '③' },
                        { name: 'Ball Mill', detail: 'Ø4.0–6.0m · circuit ouvert ou fermé', icon: '④' },
                      ],
                      p80Target: 106,
                      capex: 'medium',
                      opex: 'low',
                      applicability: bwi < 16 ? 'high' : 'medium',
                      note: 'Solution économique pour minerais tendres (BWi < 16). Capital initial réduit, opération simple.',
                      pros: ['CAPEX réduit 30–40% vs SAB', 'OpEx faible', 'Bonne flexibilité débit'],
                      cons: ['Limité aux minerais tendres (BWi < 16)', 'P80 grossier (> 90 µm typ.)', 'Moins adapté aux argiles'],
                      color: '#f59e0b',
                    },
                    {
                      id: 'sag_ball_isam',
                      label: 'SAG + Ball Mill + IsaMill (rebroyage)',
                      shortLabel: 'SAB+ISA',
                      equipment: [
                        { name: 'SAG Mill', detail: 'Ø6–10m · circuit primaire', icon: '①' },
                        { name: 'Ball Mill', detail: 'Ø4–7m · P80 ≈ 75 µm', icon: '②' },
                        { name: 'Flottation', detail: 'Bulk float pour concentré sulfures', icon: '③' },
                        { name: 'IsaMill / Vertimill', detail: 'Rebroyage concentré P80 20–40 µm', icon: '④' },
                      ],
                      p80Target: 25,
                      capex: 'high',
                      opex: 'high',
                      applicability: sSulfAvg > 1.5 || auFreeAvg < 50 ? 'high' : 'low',
                      note: 'Circuits réfractaires / sulfures. Le rebroyage fins libère l\'or occlus dans les sulfures flottés.',
                      pros: ['Maximise récupération Au occlus', 'Adapté minerais réfractaires', 'P80 ultra-fin < 30 µm'],
                      cons: ['CAPEX et OpEx très élevés', 'Procédé complexe', 'Requis seulement si réfractaire'],
                      color: '#9d78f0',
                    },
                  ];

                  return (
                    <div className="space-y-4">
                      {circuits.map((sc, idx) => {
                        const energy = bondEnergy(bwi, f80, sc.p80Target);
                        const rec = recoveryModel(sc.p80Target, avgAuFree, recCeiling);
                        const isRecommended = sc.applicability === 'high' && idx === circuits.findIndex(c => c.applicability === 'high');
                        const confColor = sc.applicability === 'high' ? '#10b981' : sc.applicability === 'medium' ? '#f59e0b' : '#6b7280';
                        const capexColor = { low: '#10b981', medium: '#f59e0b', high: '#ef4444' };

                        return (
                          <div key={sc.id} className={`rounded-xl border p-5 ${isRecommended ? `border-[${sc.color}]/30` : 'border-mf-border'} bg-mf-card`}
                            style={{ borderColor: isRecommended ? `${sc.color}40` : undefined, background: isRecommended ? `${sc.color}08` : undefined }}>
                            {/* Header */}
                            <div className="flex items-start justify-between gap-4 mb-4">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  {isRecommended && <Star size={12} fill={sc.color} style={{ color: sc.color }} />}
                                  <div className="text-sm font-bold text-mf-txt">{sc.label}</div>
                                  <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded" style={{ color: sc.color, backgroundColor: `${sc.color}20` }}>{sc.shortLabel}</span>
                                </div>
                                <div className="text-[10px] text-mf-txt4 max-w-lg leading-relaxed">{sc.note}</div>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <div className="text-center px-3 py-1.5 rounded-lg bg-mf-hover/50 border border-mf-border/50">
                                  <div className="text-[9px] text-mf-txt4">Applicabilité</div>
                                  <div className="text-xs font-semibold" style={{ color: confColor }}>{sc.applicability === 'high' ? 'Élevée' : sc.applicability === 'medium' ? 'Modérée' : 'Faible'}</div>
                                </div>
                                <div className="text-center px-3 py-1.5 rounded-lg bg-mf-hover/50 border border-mf-border/50">
                                  <div className="text-[9px] text-mf-txt4">CapEx</div>
                                  <div className="text-xs font-semibold" style={{ color: capexColor[sc.capex as keyof typeof capexColor] }}>{sc.capex.toUpperCase()}</div>
                                </div>
                                <div className="text-center px-3 py-1.5 rounded-lg bg-mf-hover/50 border border-mf-border/50">
                                  <div className="text-[9px] text-mf-txt4">OpEx</div>
                                  <div className="text-xs font-semibold" style={{ color: capexColor[sc.opex as keyof typeof capexColor] }}>{sc.opex.toUpperCase()}</div>
                                </div>
                              </div>
                            </div>

                            {/* Equipment chain */}
                            <div className="flex items-center gap-2 mb-4 flex-wrap">
                              {sc.equipment.map((eq, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="rounded-lg border border-mf-border/60 bg-mf-hover/30 px-3 py-2 text-center min-w-[110px]">
                                    <div className="text-[9px] font-mono font-bold mb-0.5" style={{ color: sc.color }}>{eq.icon} {eq.name}</div>
                                    <div className="text-[9px] text-mf-txt4 leading-tight">{eq.detail}</div>
                                  </div>
                                  {i < sc.equipment.length - 1 && (
                                    <div className="text-mf-txt4 text-lg font-light">→</div>
                                  )}
                                </div>
                              ))}
                            </div>

                            {/* Metrics + pros/cons */}
                            <div className="grid grid-cols-[auto_1fr_1fr] gap-4 items-start">
                              {/* KPIs */}
                              <div className="grid grid-cols-3 gap-3">
                                {[
                                  { label: 'P80 cible', val: `${sc.p80Target} µm`, color: sc.color },
                                  { label: 'Énergie est.', val: `${energy.toFixed(1)} kWh/t`, color: '#f59e0b' },
                                  { label: 'Récup. est.', val: `${rec.toFixed(0)}%`, color: rec > 85 ? '#10b981' : rec > 70 ? '#f59e0b' : '#ef4444' },
                                ].map(k => (
                                  <div key={k.label} className="text-center rounded-lg bg-mf-hover/30 border border-mf-border/40 px-3 py-2">
                                    <div className="text-[9px] text-mf-txt4 mb-0.5">{k.label}</div>
                                    <div className="text-sm font-mono font-bold" style={{ color: k.color }}>{k.val}</div>
                                  </div>
                                ))}
                              </div>
                              {/* Pros */}
                              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
                                <div className="text-[9px] font-bold text-emerald-400 uppercase mb-2">Avantages</div>
                                <div className="space-y-1">
                                  {sc.pros.map((p, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-mf-txt3">
                                      <CheckCircle2 size={9} className="text-emerald-400 shrink-0 mt-0.5" />{p}
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {/* Cons */}
                              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                                <div className="text-[9px] font-bold text-red-400 uppercase mb-2">Contraintes</div>
                                <div className="space-y-1">
                                  {sc.cons.map((c, i) => (
                                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-mf-txt3">
                                      <AlertTriangle size={9} className="text-red-400 shrink-0 mt-0.5" />{c}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── DATABASE ──────────────────────────────────────────── */}
            {tab === 'database' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-mf-txt">Tous les essais PSD — données LIMS</div>
                  <span className="badge badge-gray">{data.psd.length} essais</span>
                </div>
                {data.psd.length === 0 ? (
                  <div className="text-center text-mf-txt4 py-12 text-sm">Aucun essai PSD importé dans LIMS</div>
                ) : (
                  <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="tbl">
                        <thead>
                          <tr>
                            <th>Échantillon</th>
                            <th>Domaine</th>
                            <th className="text-right">P80 (µm)</th>
                            <th className="text-right">D50 (µm)</th>
                            <th className="text-right">Au tête (g/t)</th>
                            <th className="text-right">-38µm (%)</th>
                            <th className="text-right">Au -38µm (g/t)</th>
                            <th className="text-right">Dist. Au -38µm (%)</th>
                            <th>Libération</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.psd.map(r => {
                            const s = sampleMap.get(r.sample_id ?? '');
                            const lib = r.sample_id ? libMap.get(r.sample_id) : null;
                            return (
                              <tr key={r.id}
                                className={`cursor-pointer ${r.sample_id === selectedSampleId ? 'bg-teal-500/5' : ''}`}
                                onClick={() => setSelectedSampleId(r.sample_id)}>
                                <td><span className="font-mono text-amber-400 text-xs">{s?.sample_id ?? r.sample_id?.slice(0,8)}</span></td>
                                <td><span className="text-xs text-mf-txt3">{s?.domain ?? '—'}</span></td>
                                <td className="num text-teal-400">{r.p80_um ?? '—'}</td>
                                <td className="num">{r.d50_um ?? '—'}</td>
                                <td className="num text-amber-400">{r.au_head_g_t?.toFixed(3) ?? '—'}</td>
                                <td className="num">{r.minus_38um_pct?.toFixed(1) ?? '—'}</td>
                                <td className="num text-amber-400">{r.au_minus38_g_t?.toFixed(3) ?? '—'}</td>
                                <td className="num text-emerald-400">{r.dist_au_minus38_pct?.toFixed(1) ?? '—'}</td>
                                <td>
                                  {lib ? (
                                    <span className="text-[10px] text-amber-400 font-semibold">{lib.au_free_pct?.toFixed(0)}% libre</span>
                                  ) : (
                                    <span className="text-[10px] text-mf-txt4">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Stats summary */}
                {data.psd.length > 0 && (
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      { label: 'P80 (µm)', vals: p80vals, color: '#14b8a6' },
                      { label: 'D50 (µm)', vals: d50vals, color: '#38bdf8' },
                      { label: 'Au tête (g/t)', vals: auHeadVals, color: '#f59e0b' },
                      { label: 'Dist. Au -38µm (%)', vals: auDistVals, color: '#10b981' },
                    ].map(s => {
                      const m = mean(s.vals);
                      const sd = stdDev(s.vals);
                      return (
                        <div key={s.label} className="rounded-xl border border-mf-border bg-mf-card p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-semibold text-mf-txt">{s.label}</div>
                            <span className="text-[10px] font-mono" style={{ color: s.color }}>n={s.vals.length}</span>
                          </div>
                          {m !== null ? (
                            <div className="space-y-0">
                              {[
                                ['Moyenne', m.toFixed(s.vals[0] < 10 ? 2 : 1)],
                                ['Écart-type', `± ${sd?.toFixed(1) ?? '—'}`],
                                ['Min', Math.min(...s.vals).toFixed(1)],
                                ['Max', Math.max(...s.vals).toFixed(1)],
                              ].map(([k, v]) => (
                                <div key={k as string} className="stat-row">
                                  <span className="stat-key">{k}</span>
                                  <span className="stat-val font-mono" style={{ color: s.color }}>{v}</span>
                                </div>
                              ))}
                            </div>
                          ) : <p className="text-xs text-mf-txt4 py-2">Données insuffisantes</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
