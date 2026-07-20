import { useState, useEffect, useMemo, useRef } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import {
  Layers, RefreshCw, CheckCircle2, Info, BarChart3, TrendingUp,
  Activity, Target, Zap, AlertTriangle, Star,
  FlaskConical, Microscope,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { supabase } from '../lib/supabase';
import { useProject } from '../lib/ProjectContext';
import { DEFAULT_ASSUMPTIONS } from '../lib/config/constants';
import { domainWeightedMean, canonDomain, type DomainValue, type DomainWeights } from '../lib/geomet/domains';
import { runP80Engine, bondEnergy, recoveryModel, rowlandEF5 } from '../lib/geomet/p80';
import {
  p80FromPsd, passingCurveFromRetained, grindProductP80, appliedEnergyKwhT,
  timeToReachP80, grindRecommendations, GRIND_REFERENCE,
} from '../lib/geomet/psd';
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

/** GéoMet domain, reduced to what the P80 engine needs: its share of the mill feed. */
interface DomainRow { name: string; lom_pct: number | null }

interface AllData {
  samples: LimsSample[];
  psd: LimsPsdRow[];
  chem: LimsChemRow[];
  comminution: LimsComRow[];
  liberation: LimsLibRow[];
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
  const [domainRows, setDomainRows] = useState<DomainRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [p80Target, setP80Target] = useState(75);
  const [bwiOverride, setBwiOverride] = useState<number | null>(null);
  const [plantFactorOverride, setPlantFactorOverride] = useState<number | null>(null);
  // $/kWh — defaults to the shared assumption (Québec grid via Économie); editable
  // like the other engine inputs so nothing the optimum depends on is frozen.
  const [elecCostOverride, setElecCostOverride] = useState<number | null>(null);
  // Lab grind parameters (batch ball mill) — drive the predicted product P80 and
  // the recommendations to reach the economic optimum.
  const [grindSpeed, setGrindSpeed] = useState<number>(GRIND_REFERENCE.SPEED_PCT);
  const [grindCharge, setGrindCharge] = useState<number>(GRIND_REFERENCE.BALL_CHARGE_PCT);
  const [grindTime, setGrindTime] = useState(45);
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
    const [s, psd, chem, comm, lib, dc, doms] = await Promise.all([
      supabase.from('lims_samples').select('id,sample_id,domain,campaign').eq('project_id', project.id),
      supabase.from('lims_test_psd').select('*').eq('project_id', project.id),
      supabase.from('lims_test_chem').select('sample_id,au_g_t,s_sulfide_pct').eq('project_id', project.id),
      supabase.from('lims_test_comminution').select('sample_id,bwi_kwh_t,sg_t_m3').eq('project_id', project.id),
      supabase.from('lims_test_liberation').select('*').eq('project_id', project.id),
      supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle(),
      // Feed share per domain (GéoMet → Optimisation Blend, persisted as lom_pct).
      // Without it the engine has to assume every domain contributes equally.
      supabase.from('geomet_domains').select('name,lom_pct').eq('project_id', project.id),
    ]);
    const d: AllData = {
      samples: (s.data ?? []) as LimsSample[],
      psd: (psd.data ?? []) as LimsPsdRow[],
      chem: (chem.data ?? []) as LimsChemRow[],
      comminution: (comm.data ?? []) as LimsComRow[],
      liberation: (lib.data ?? []) as LimsLibRow[],
    };
    setData(d);
    setDomainRows((doms.data ?? []) as DomainRow[]);
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
  const auFreeVals = data.liberation.map(r => r.au_free_pct).filter((v): v is number => v !== null && v > 0);

  function mean(a: number[]) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  function stdDev(a: number[]) {
    const m = mean(a); if (!m || a.length < 2) return null;
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
  }

  // ── Engine inputs: weighted per domain, composites excluded ────────────────
  // A flat mean over every sample was wrong twice over: it folded in the "mixte"
  // composites (which are themselves blends of the primary domains, so the same
  // ore was counted twice), and it weighted by testing effort rather than by ore
  // — 41 sulphide tests outvoted 18 oxide tests for reasons unrelated to the mill
  // feed. Both drive BWi and Au-libre, hence the optimal P80.
  const domainBySample = useMemo(
    () => new Map(data.samples.map(s => [s.id, s.domain])),
    [data.samples],
  );
  const tagged = (rows: { sample_id: string | null }[], pick: (r: never) => number | null): DomainValue[] =>
    rows.flatMap(r => {
      const v = pick(r as never);
      return v != null && v > 0 ? [{ value: v, domain: (r.sample_id ? domainBySample.get(r.sample_id) : null) ?? null }] : [];
    });

  // Feed share per canonical domain, from GéoMet's persisted blend (lom_pct). When
  // no split has been saved, domainWeightedMean falls back to equal weights and
  // reports it, so the basis is stated rather than assumed.
  const feedWeights = useMemo<DomainWeights>(() => {
    const w: DomainWeights = {};
    for (const d of domainRows) {
      if (d.lom_pct != null && d.lom_pct > 0) w[canonDomain(d.name)] = d.lom_pct;
    }
    return w;
  }, [domainRows]);

  const bwiAgg = useMemo(
    () => domainWeightedMean(tagged(data.comminution, (r: LimsComRow) => r.bwi_kwh_t), feedWeights),
    [data.comminution, domainBySample, feedWeights],
  );
  const auFreeAgg = useMemo(
    () => domainWeightedMean(tagged(data.liberation, (r: LimsLibRow) => r.au_free_pct), feedWeights),
    [data.liberation, domainBySample, feedWeights],
  );

  // P80 measured on the PSD tests. Kept consistent with BWi and Au libre in the
  // same KPI row: domain-weighted, composites excluded — not a flat sample mean
  // (which folded in the "mixte" composites and weighted by testing effort, giving
  // ~107 µm). This is the LAB-measured grind, distinct from the design/target P80.
  const p80Agg = useMemo(
    () => domainWeightedMean(tagged(data.psd, (r: LimsPsdRow) => r.p80_um), feedWeights),
    [data.psd, domainBySample, feedWeights],
  );
  const avgP80 = p80Agg.mean;
  const avgBwi = bwiAgg.mean;
  const avgAuFree = auFreeAgg.mean;

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
  const elecCostUsdKwh = elecCostOverride ?? DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH;
  // Plant/lab grinding factor: lab Bond energy under-states what a real mill needs.
  // Editable — the engineer dials in their circuit's measured Wio/Wi.
  const plantFactor = plantFactorOverride ?? DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR;

  // The engine itself lives in lib/geomet/p80 so GéoMet resolves the same optimal
  // P80 from the same inputs, instead of hardcoding 75 µm as the optimum.
  const engine = useMemo(() => runP80Engine({
    bwi: bwiForEngine,
    f80_um: f80,
    auFreePct: auFreeForEngine,
    recoveryCeilingPct: recCeiling,
    goldGradeGt: grade,
    goldPriceUsdOz: goldPrice,
    elecCostUsdKwh,
    plantFactor,
  }), [bwiForEngine, f80, auFreeForEngine, recCeiling, goldPrice, grade, elecCostUsdKwh, plantFactor]);

  const enginePoints = engine.points.map(pt => ({ ...pt, score: pt.netUsd }));
  const optimalIdx = engine.optimalIndex;
  const optimal = enginePoints[optimalIdx];

  // ── P80 recalculé depuis les PSD mesurées ─────────────────────────────────
  // Log-linear interpolation of 80 % passing on each test's own sieve curve —
  // validates the lab-reported p80_um instead of trusting it blindly.
  const psdValidation = useMemo(() => {
    const mapping: [number, keyof LimsPsdRow][] = [
      [500, 'plus_500um_pct'], [212, 'plus_212um_pct'], [150, 'plus_150um_pct'],
      [106, 'plus_106um_pct'], [75, 'plus_75um_pct'], [53, 'plus_53um_pct'],
      [38, 'plus_38um_pct'],
    ];
    const rows = data.psd.map(r => {
      const curve = passingCurveFromRetained(mapping.map(([sz, k]) => ({ sieve: sz, pct: r[k] as number | null })));
      return { reported: r.p80_um, computed: p80FromPsd(curve) };
    }).filter((x): x is { reported: number | null; computed: number } => x.computed != null);
    if (!rows.length) return null;
    const meanComputed = rows.reduce((s, x) => s + x.computed, 0) / rows.length;
    const paired = rows.filter(x => x.reported != null && x.reported > 0);
    const meanDelta = paired.length
      ? paired.reduce((s, x) => s + (x.computed - (x.reported as number)), 0) / paired.length
      : null;
    return { n: rows.length, meanComputed, meanDelta, nPaired: paired.length };
  }, [data.psd]);

  // ── Modèle de broyage labo (vitesse / charge / temps → P80 produit) ───────
  const grindParams = { speedPctCritical: grindSpeed, ballChargePct: grindCharge, timeMin: grindTime };
  const grindPredicted = grindProductP80(bwiForEngine, f80, grindParams);
  const grindEnergy = appliedEnergyKwhT(grindParams);
  const grindTimeOpt = timeToReachP80(bwiForEngine, f80, optimal.p80, grindSpeed, grindCharge);
  const grindRecs = grindRecommendations(bwiForEngine, f80, optimal.p80, grindParams);

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
        {avgP80 !== null && <span className="text-xs text-teal-300">P80 moy. labo: <strong>{formatDecimalGrouped(avgP80, 0)} µm</strong></span>}
        <div className="h-3 w-px bg-teal-500/30" />
        {avgBwi !== null && <span className="text-xs text-teal-300">BWi moy: <strong>{formatDecimalGrouped(avgBwi, 1)} kWh/t</strong></span>}
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
                    { label: 'P80 moyen (labo)', val: avgP80, unit: 'µm', color: '#14B8A6', icon: <Target size={14} className="text-teal-400"/> },
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
                    <div className="text-[10px] text-mf-txt4 mb-4">n={p80vals.length} · min={formatDecimalGrouped(Math.min(...p80vals), 0)} µm · max={formatDecimalGrouped(Math.max(...p80vals), 0)} µm · σ={stdDev(p80vals)?.toFixed(1) ?? '—'} µm</div>
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
                          <text x={xLog(avgP80, 20, 600)} y={8} fill="#f59e0b" fontSize="8" textAnchor="middle">μ={formatDecimalGrouped(avgP80, 0)}</text>
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
                              <div className="text-2xl font-mono font-bold" style={{ color: f.color }}>{formatDecimalGrouped(m, 1)}<span className="text-xs text-mf-txt4 font-normal ml-1">%</span></div>
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
                                  {d.value > 8 && <span className="text-[9px] font-bold text-white">{formatDecimalGrouped(d.value, 1)}%</span>}
                                </div>
                              </div>
                              <div className="text-xs font-mono font-bold w-10 text-right" style={{ color: d.color }}>{formatDecimalGrouped(d.value, 1)}%</div>
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
                                    {d.value > 5 && <text x={lx} y={ly} fill={d.color} fontSize="9" textAnchor="middle" dominantBaseline="middle" fontWeight="600">{formatDecimalGrouped(d.value, 0)}%</text>}
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
                                <span className="text-[10px] text-mf-txt3">{d.label}: {formatDecimalGrouped(d.value, 1)}%</span>
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
                            {s.val !== null && s.val !== undefined ? formatDecimalGrouped(s.val, 1) : '—'}
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
                  <div className="grid grid-cols-6 gap-4">
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
                    <div>
                      <label className="label" title="Wio/Wi — l'usine broie moins efficacement que le labo">Facteur usine/labo</label>
                      <input type="number" step="0.01" min="1" className="input-field"
                        placeholder={`Défaut: ${DEFAULT_ASSUMPTIONS.PLANT_LAB_GRIND_FACTOR}`}
                        value={plantFactorOverride ?? ''}
                        onChange={e => setPlantFactorOverride(e.target.value ? +e.target.value : null)} />
                    </div>
                    <div>
                      <label className="label" title="Prix du kWh — partagé avec le modèle OPEX (Économie)">Élec. ($/kWh)</label>
                      <input type="number" step="0.001" min="0" className="input-field"
                        placeholder={`Défaut: ${DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH.toFixed(3)}`}
                        value={elecCostOverride ?? ''}
                        onChange={e => setElecCostOverride(e.target.value ? +e.target.value : null)} />
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="text-[10px] text-mf-txt4 mb-1">Énergie moteur</div>
                      <div className="text-xs text-teal-400 font-semibold">
                        BWi={formatDecimalGrouped(bwiForEngine, 1)} · ×{formatDecimalGrouped(plantFactor, 2)} usine
                      </div>
                    </div>
                  </div>

                  {/* Every input the optimum depends on, with its owning module — the
                      engine imports everything; nothing here is a hidden constant. */}
                  <div className="mt-3 pt-3 border-t border-mf-border/60 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mf-txt4">
                    <span>Teneur <strong className="text-mf-txt3">{formatDecimalGrouped(grade, 2)} g/t</strong> · Projet</span>
                    <span>Prix or <strong className="text-mf-txt3">{formatDecimalGrouped(goldPrice, 0)} $/oz</strong> · Projet</span>
                    <span>Plafond récup. <strong className="text-mf-txt3">{formatDecimalGrouped(recCeiling, 1)} %</strong> · LIMS (globale)</span>
                    <span>Au libre <strong className="text-mf-txt3">{auFreeForEngine != null ? `${formatDecimalGrouped(auFreeForEngine, 1)} %` : '—'}</strong> · LIMS pondéré</span>
                    <span>BWi <strong className="text-mf-txt3">{formatDecimalGrouped(bwiForEngine, 1)} kWh/t</strong> · {bwiOverride != null ? 'saisi' : 'LIMS pondéré'}</span>
                    <span>F80 <strong className="text-mf-txt3">{formatDecimalGrouped(f80, 0)} µm</strong> · {dcF80Crush != null && f80 === dcF80Crush ? 'Critères' : 'saisi'}</span>
                    <span>Élec. <strong className="text-mf-txt3">{formatDecimalGrouped(elecCostUsdKwh, 3)} $/kWh</strong> · {elecCostOverride != null ? 'saisi' : 'défaut partagé (Économie)'}</span>
                  </div>

                  {/* The lab-to-plant correction, made explicit: a lab Bond mill grinds
                      more efficiently than an industrial circuit, and the gap widens as
                      the grind gets finer. This is why the plant optimum sits coarser
                      than the lab curve alone would suggest. */}
                  <div className="mt-3 pt-3 border-t border-mf-border/60 text-[10px] text-mf-txt4">
                    Énergie de broyage = Bond labo × <strong className="text-mf-txt3">{formatDecimalGrouped(plantFactor, 2)}</strong> (facteur usine/labo, {plantFactorOverride != null ? 'saisi' : 'défaut documenté'})
                    × <strong className="text-mf-txt3">EF5 de Rowland</strong> (correction finesse, automatique : {formatDecimalGrouped(rowlandEF5(optimal.p80), 2)} au P80 optimal).
                    Le broyage fin s'écarte davantage du labo, ce qui recule l'optimum économique vers plus grossier.
                    {optimal.labEnergy > 0 && (
                      <> Au P80 optimal ({optimal.p80} µm) : {formatDecimalGrouped(optimal.labEnergy, 1)} kWh/t labo → <strong className="text-sky-300">{formatDecimalGrouped(optimal.energy, 1)} kWh/t usine</strong> (+{formatDecimalGrouped((((optimal.energy / optimal.labEnergy) - 1) * 100), 0)} %).</>
                    )}
                    {' '}Le F80 déplace l'énergie <em>totale</em> (terme −10·BWi/√F80, identique pour chaque P80 candidat) mais quasiment pas le coût <em>marginal</em> du broyage fin — c'est pourquoi changer le F80 ne déplace normalement pas le P80 optimal.
                  </div>

                  {/* Where the engine inputs come from. These drive the optimal P80, so
                      the weighting must be legible rather than implied. */}
                  {bwiAgg.byDomain.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-mf-border/60 space-y-1.5">
                      <div className="text-[10px] text-mf-txt4">
                        {bwiAgg.weightedByFeed
                          ? <>BWi pondéré par la <strong className="text-emerald-400/90">répartition d'alimentation enregistrée</strong> (GéoMet → Optimisation Blend).</>
                          : <>BWi pondéré <strong className="text-amber-400/90">à parts égales par domaine</strong> — aucune répartition enregistrée. Enregistrez le blend dans <em>GéoMet → Optimisation Blend</em> pour que le design suive l'alimentation réelle.</>}
                        {' '}Jamais par nombre d'essais : l'effort d'échantillonnage ne doit pas piloter le design.
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                        {bwiAgg.byDomain.map(d => (
                          <span key={d.canon} className="text-mf-txt3">
                            {d.label}: <strong className="text-sky-300">{formatDecimalGrouped(d.mean, 1)}</strong>
                            <span className="text-mf-txt4"> ({d.n} essais · {formatDecimalGrouped((d.weight * 100), 0)}% alim.)</span>
                          </span>
                        ))}
                        <span className="text-mf-txt4">→ moyenne {bwiAgg.mean?.toFixed(1)} kWh/t</span>
                      </div>
                      {bwiAgg.compositeMean != null && (() => {
                        const delta = (bwiAgg.mean ?? 0) - bwiAgg.compositeMean;
                        const ok = Math.abs(delta) <= 1;
                        return (
                          <div className={`text-[10px] ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {ok ? '✓' : '⚠'} Composite mixte mesuré : {formatDecimalGrouped(bwiAgg.compositeMean, 1)} kWh/t
                            ({bwiAgg.compositeN} essais) — exclu du calcul car il est déjà la combinaison des
                            domaines ; écart {delta >= 0 ? '+' : ''}{formatDecimalGrouped(delta, 2)} kWh/t.
                          </div>
                        );
                      })()}
                    </div>
                  )}
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
                    <div className="text-xs text-mf-txt4">{formatDecimalGrouped(optimal.energy, 2)} kWh/t · {formatDecimalGrouped(optimal.recovery, 1)}% récup. · {formatDecimalGrouped(optimal.netUsd, 1)} $/t net</div>
                  </div>
                </div>

                {/* ── P80 recalculé depuis les PSD mesurées (validation) ────── */}
                {psdValidation && (
                  <div className="rounded-xl border border-mf-border bg-mf-card p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <div className="text-sm font-semibold text-mf-txt">P80 recalculé depuis les courbes PSD</div>
                    <span className="text-xs text-mf-txt3">
                      Interpolation log-linéaire du 80 % passant sur {psdValidation.n} essai{psdValidation.n > 1 ? 's' : ''} :{' '}
                      <strong className="text-sky-300">{formatDecimalGrouped(psdValidation.meanComputed, 0)} µm</strong> en moyenne
                    </span>
                    {psdValidation.meanDelta != null && (
                      <span className={`text-xs ${Math.abs(psdValidation.meanDelta) > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        Écart moyen vs P80 rapporté labo : {psdValidation.meanDelta >= 0 ? '+' : ''}{formatDecimalGrouped(psdValidation.meanDelta, 1)} µm
                        {Math.abs(psdValidation.meanDelta) > 10 ? ' — vérifier les tamisages' : ' — cohérent'}
                      </span>
                    )}
                  </div>
                )}

                {/* ── Broyage labo : vitesse / charge / temps → P80 produit ──
                    Batch model (Bond inversé) : l'énergie appliquée dépend de la
                    charge de boulets et de la vitesse ; le temps la cumule. */}
                <div className="rounded-xl border border-mf-border bg-mf-card p-4">
                  <div className="text-sm font-semibold text-mf-txt mb-3">Paramètres de broyage (labo) → P80 produit</div>
                  <div className="grid grid-cols-6 gap-4">
                    <div>
                      <label className="label" title="% de la vitesse critique — optimum en cataracte ~75 %">Vitesse (% critique)</label>
                      <input type="number" min="30" max="100" className="input-field" value={grindSpeed}
                        onChange={e => setGrindSpeed(+e.target.value || GRIND_REFERENCE.SPEED_PCT)} />
                    </div>
                    <div>
                      <label className="label" title="% du volume du broyeur occupé par les boulets">Charge boulets (% vol)</label>
                      <input type="number" min="5" max="45" className="input-field" value={grindCharge}
                        onChange={e => setGrindCharge(+e.target.value || GRIND_REFERENCE.BALL_CHARGE_PCT)} />
                    </div>
                    <div>
                      <label className="label">Temps de broyage (min)</label>
                      <input type="number" min="0" className="input-field" value={grindTime}
                        onChange={e => setGrindTime(Math.max(0, +e.target.value || 0))} />
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="text-[10px] text-mf-txt4 mb-1">Énergie appliquée</div>
                      <div className="text-sm font-mono font-semibold text-amber-400">{formatDecimalGrouped(grindEnergy, 1)} kWh/t</div>
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="text-[10px] text-mf-txt4 mb-1">P80 produit prédit</div>
                      <div className="text-sm font-mono font-semibold text-sky-300">{grindPredicted != null ? `${formatDecimalGrouped(grindPredicted, 0)} µm` : '—'}</div>
                    </div>
                    <div className="flex flex-col justify-end">
                      <div className="text-[10px] text-mf-txt4 mb-1">Temps pour P80 optimal</div>
                      <div className="text-sm font-mono font-semibold text-emerald-400">{grindTimeOpt != null ? `${formatDecimalGrouped(grindTimeOpt, 0)} min` : '—'}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-[10px] text-mf-txt4">
                    Modèle : Bond inversé — P80 = (E/(10·BWi) + 1/√F80)⁻² avec E = puissance spécifique (charge, vitesse) × temps.
                    Base labo (BWi {formatDecimalGrouped(bwiForEngine, 1)} kWh/t, F80 {formatDecimalGrouped(f80, 0)} µm) ; la correction usine reste dans le moteur d'optimum.
                  </div>

                  {/* Rapport : recommandations pour atteindre le P80 optimal */}
                  {grindRecs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-mf-border/60 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-mf-txt4">Recommandations d'optimisation du broyage</div>
                      {grindRecs.map((r, i) => (
                        <div key={i} className={`text-xs flex items-start gap-2 ${r.severity === 'action' ? 'text-amber-300' : 'text-emerald-400'}`}>
                          <span className="mt-0.5 shrink-0">{r.severity === 'action' ? '⚠' : '✓'}</span>
                          <span>{r.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
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
                        <th>P80 <span className="normal-case">(µm)</span></th>
                        <th className="text-right">Énergie <span className="normal-case">(kWh/t)</span></th>
                        <th className="text-right">Récup. (%) est.</th>
                        {/* energy × $/kWh = $/t — the old header said $/kWh, a wrong unit */}
                        <th className="text-right">Coût énergie ($/t)</th>
                        <th className="text-right">Revenu Au ($/t)</th>
                        <th className="text-right">Valeur nette ($/t)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {enginePoints.map((pt, i) => (
                        <tr key={i} className={i === optimalIdx ? 'bg-emerald-500/5' : pt.p80 === p80Target ? 'bg-purple-500/5' : ''}>
                          <td><span className="font-mono text-sm">{pt.p80}</span></td>
                          <td className="num text-amber-400">{formatDecimalGrouped(pt.energy, 2)}</td>
                          <td className="num text-teal-400">{formatDecimalGrouped(pt.recovery, 1)}</td>
                          <td className="num text-mf-txt3">{formatDecimalGrouped(pt.cost, 2)}</td>
                          <td className="num text-mf-txt3">{formatDecimalGrouped(pt.revenueUsdT, 1)}</td>
                          {/* net value in $/t, directly — the old "score" was net × 10, a unitless scaling */}
                          <td className="num">{formatDecimalGrouped(pt.netUsd, 1)}</td>
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
                                {item.val !== null && item.val !== undefined ? formatDecimalGrouped(item.val, 1) : '—'}
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
                        { name: 'SAG Mill', detail: `Ø5.5–9.8m · BWi est. ${formatDecimalGrouped(bwi, 1)} kWh/t`, icon: '②' },
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
                                  { label: 'Énergie est.', val: `${formatDecimalGrouped(energy, 1)} kWh/t`, color: '#f59e0b' },
                                  { label: 'Récup. est.', val: `${formatDecimalGrouped(rec, 0)}%`, color: rec > 85 ? '#10b981' : rec > 70 ? '#f59e0b' : '#ef4444' },
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
                                ['Min', formatDecimalGrouped(Math.min(...s.vals), 1)],
                                ['Max', formatDecimalGrouped(Math.max(...s.vals), 1)],
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
