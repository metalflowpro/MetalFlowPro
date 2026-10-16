import { useState, useEffect } from 'react';
import { formatDecimalGrouped } from '../lib/format/number';
import { DollarSign, BarChart3, Plus, AlertCircle, CheckCircle2,
  Users, Zap, FlaskConical, Truck,
  Sparkles, Pickaxe, Factory,
  FileSpreadsheet,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { useProject } from '../lib/ProjectContext';
import { supabase } from '../lib/supabase';
import type { Project } from '../types';
import { TROY_OZ_GRAMS, HOURS_PER_YEAR, DEFAULT_ASSUMPTIONS, cadToUsd, computeProductionMetrics, parseSettingInput } from '../lib/config/constants';
import { irr as solveIrr } from '../lib/simulation/economics';
import { SensitivityTab } from '../components/economics/SensitivityTab';
import { FiscalTab } from '../components/economics/FiscalTab';
import { LomTab } from '../components/economics/LomTab';
import { MiningCostModule } from '../components/economics/mining/MiningCostModule';
import { useMiningCostModel } from '../components/economics/mining/useMiningCostModel';
import { buildPlantCapexLines, buildPlantOpexLines, labourRowAnnualCost, opexSummary } from '../lib/economics/plantCostBenchmarks';
import { MINING_AUTO_NOTE } from '../lib/mining/economicLines';

const TROY = 1 / TROY_OZ_GRAMS;

type Tab = 'overview' | 'capex' | 'opex' | 'lom' | 'sensitivity' | 'fiscal' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',     label: 'Vue Générale' },
  { id: 'capex',        label: 'CAPEX' },
  { id: 'opex',         label: 'OPEX Détaillé' },
  { id: 'lom',          label: 'Plan LOM' },
  { id: 'sensitivity',  label: 'Sensibilité' },
  { id: 'fiscal',       label: 'Régime Fiscal' },
  { id: 'settings',     label: 'Paramètres' },
];

// ─── Fiscal Regimes ───────────────────────────────────────────────────────────

// Fiscal regimes are now loaded from the `fiscal_regimes` database table,
// making them user-configurable instead of hardcoded in source code.
// The `project_fiscal_selection` table persists each project's chosen regime.

// ─── OPEX sub-tab types ───────────────────────────────────────────────────────

type OpexTab = 'summary' | 'labour' | 'power' | 'reagents' | 'mobile' | 'mine';

interface LabourRow { id: string; description: string; category: string; schedule: string; n_emp: number; sal_base_h: number; bonus_pct: number; benefits_pct: number; ot_pct: number; }
interface PowerRow  { id: string; wbs: string; description: string; kw_mec: number; eff_elec: number; load_factor: number; dispo: number; h_j: number; }
interface ReagentRow{ id: string; description: string; category: string; unit: string; conso_unit: number; cost_unit: number; source: string; }
interface MobileRow { id: string; description: string; type: string; qty: number; h_an: number; usd_h: number; }

function uid2() { return Math.random().toString(36).slice(2, 10); }

const CAPEX_CATEGORIES = ['Travaux miniers', 'Usine de traitement', 'Infrastructure', 'Gestion résidus', 'Services', 'EPCM', 'Contingence', 'Autre'];
const OPEX_CATEGORIES = ['Mine', 'Main-d\'œuvre', 'Énergie', 'Réactifs', 'Broyage', 'Diesel', 'Maintenance', 'Environnement', 'G&A', 'Royalties', 'Autre'];
const OPEX_AUTO_NOTE = 'Généré depuis Bilan + Critères';

/**
 * A single `project_settings` field.
 *
 * Kept in local state and only persisted on blur (or Enter): the previous version
 * called saveSettings on every keystroke, which issued one Supabase write per
 * character typed.
 *
 * Empty input means "no override" -> null, and the module falls back to the
 * documented default shown in `defaultHint`. Note the parsing deliberately does
 * NOT use `parseFloat(v) || null`: that turned a legitimate 0 into null, so a
 * royalty explicitly set to 0% silently reverted to the 3% default.
 */
function SettingField({ label, value, step, note, defaultHint, onCommit }: {
  label: string;
  value: number | null;
  step: string;
  note: string;
  defaultHint: string | null;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value != null ? String(value) : '');

  // Re-sync when the persisted value changes elsewhere (e.g. settings finish loading).
  useEffect(() => { setDraft(value != null ? String(value) : ''); }, [value]);

  function commit() {
    const next = parseSettingInput(draft, value);
    if (next === undefined) { setDraft(value != null ? String(value) : ''); return; }
    onCommit(next);
  }

  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number" step={step}
        placeholder={defaultHint ? `défaut ${defaultHint}` : '—'}
        className="input-field w-full"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <div className="text-[10px] mf-txt4 mt-0.5">
        {note}
        {defaultHint && draft.trim() === '' && (
          <span className="text-amber-400/80"> · défaut appliqué : {defaultHint}</span>
        )}
      </div>
    </div>
  );
}

interface EconomicsProps { project: Project }

export function Economics({ project }: EconomicsProps) {
  const {
    settings, saveSettings,
    capexLines, opexLines, totalCapex, totalOpex,
    addCapexLine, updateCapexLine, deleteCapexLine,
    addOpexLine, updateOpexLine, deleteOpexLine,
    effectiveRecoveryPct, assumptions,
  } = useProject();

  const [tab, setTab] = useState<Tab>('overview');
  const [opexTab, setOpexTab] = useState<OpexTab>('summary');
  const [capexView, setCapexView] = useState<'plant' | 'mine'>('plant');
  // Coûts miniers (CAPEX + OPEX) : un seul état partagé par les deux onglets.
  const mining = useMiningCostModel(project);
  // CAPEX de l'usine seule (hors lignes du module minier) — base des pièces et de
  // la maintenance usine, pour ne pas recompter la maintenance des engins miniers.
  const plantCapex = capexLines
    .filter(l => l.notes !== MINING_AUTO_NOTE)
    .reduce((s, l) => s + l.value_musd * (1 + l.contingency_pct / 100), 0);
  const [showNewCapex, setShowNewCapex] = useState(false);
  const [showNewOpex, setShowNewOpex] = useState(false);
  const [newCapex, setNewCapex] = useState({ category: '', description: '', value_musd: '', contingency_pct: '0', source: 'estimate', notes: '' });
  const [newOpex, setNewOpex] = useState({ category: '', description: '', value_usd_t: '', source: 'estimate', notes: '' });
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [editCapexId, setEditCapexId] = useState<string | null>(null);
  const [editOpexId, setEditOpexId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genDone, setGenDone] = useState(false);
  const [generatingOpex, setGeneratingOpex] = useState(false);
  const [genOpexDone, setGenOpexDone] = useState(false);

  // Fiscal regimes: state, DB load and persistence now live in <FiscalTab/>.

  // ── OPEX detailed sub-state ───────────────────────────────────────────────
  // USD is the reference currency. The seeds below come from CAD-denominated
  // Québec engineering benchmarks, converted via cadToUsd so their provenance
  // stays visible — they are NOT relabelled CAD figures.
  const [opexInputs, setOpexInputs] = useState({
    diesel_usd_l: DEFAULT_ASSUMPTIONS.DIESEL_COST_USD_L, essence_usd_l: cadToUsd(1.045), benefits_pct: 20, bonus_pct: 5,
    // Shared with Granulometry so both modules price the same kWh identically.
    elec_usd_kwh: DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH,
    avail_crush: 75, avail_plant: 92, recovery_pct: 0,
    annual_tonnes: project.annual_tonnes || 0,
  });
  const [labourRows, setLabourRows] = useState<LabourRow[]>([]);
  const [powerRows, setPowerRows]   = useState<PowerRow[]>([]);
  const [reagentRows, setReagentRows] = useState<ReagentRow[]>([]);
  const [mobileRows, setMobileRows]  = useState<MobileRow[]>([]);

  const discRate = assumptions.discountRate * 100;
  const lomYears = assumptions.lomYears;
  const sustainCapex = settings?.sustaining_capex_musd_yr ?? null;
  const royaltyPct = assumptions.royaltyFraction * 100;
  const refinery = assumptions.refineryChargeUsdOz;

  // ── Production base ────────────────────────────────────────────────────────
  const { annualTonnes, annualOz } = computeProductionMetrics(project, assumptions, effectiveRecoveryPct);
  const goldPrice = project.gold_price_usd;

  // ── Financial metrics ──────────────────────────────────────────────────────
  const revenueM = annualOz != null ? (annualOz * goldPrice * (1 - royaltyPct / 100)) / 1_000_000 : null;
  const refineryM = annualOz != null ? (annualOz * refinery) / 1_000_000 : null;
  const annualOpexM = totalOpex > 0 ? (totalOpex * annualTonnes) / 1_000_000 : null;
  const ebitdaM = (revenueM != null && annualOpexM != null && refineryM != null) ? revenueM - annualOpexM - refineryM : null;

  // DCF NPV using annuity factor for constant annual cash flows
  const annuityFactor = (discRate && lomYears && discRate > 0)
    ? (1 - Math.pow(1 + discRate / 100, -lomYears)) / (discRate / 100)
    : null;
  const annualFcf = (ebitdaM != null && sustainCapex != null) ? ebitdaM - sustainCapex : ebitdaM;
  const npv = (annualFcf != null && annuityFactor != null) ? annualFcf * annuityFactor - totalCapex : null;
  // Payback sur le FCF (EBITDA − maintien), pas sur l'EBITDA brut : le capital de
  // maintien sort de la caisse chaque année et allonge réellement le remboursement.
  const payback = (annualFcf != null && annualFcf > 0 && totalCapex > 0) ? totalCapex / annualFcf : null;
  // AISC (World Gold Council) = cash costs (OPEX + affinage + redevances) +
  // capital de MAINTIEN, par once vendue. Le CAPEX initial n'en fait PAS partie
  // — l'amortir ici sous-entendait un « AISC » invariant au phasage du capital
  // et gonflé en début de vie. Le CAPEX initial est porté par l'AIC ci-dessous.
  const aisc = (annualOz > 0 && totalOpex > 0)
    ? (totalOpex * annualTonnes
       + refinery * annualOz
       + (royaltyPct / 100) * annualOz * goldPrice
       + (sustainCapex ?? 0) * 1_000_000) / annualOz
    : null;
  // AIC = AISC + CAPEX initial amorti sur la LOM (l'ancienne formule, nommée juste).
  const aic = (aisc != null && annualOz != null && annualOz > 0 && totalCapex > 0 && lomYears)
    ? aisc + (totalCapex * 1_000_000) / (annualOz * lomYears)
    : null;
  const marginPct = (ebitdaM != null && revenueM != null && revenueM > 0) ? (ebitdaM / revenueM) * 100 : null;

  // ── IRR — moteur partagé (bisection bornée, lib/simulation/economics) ─────
  // L'ancien Newton-Raphson local avait une dérivée d'annuité fausse (signe et
  // règle du quotient) : convergence lente voire arrêt avant le zéro. Un seul
  // solveur IRR dans l'app, testé, au lieu de deux implémentations divergentes.
  const irr = (annualFcf != null && annualFcf > 0 && totalCapex > 0 && lomYears)
    ? (() => { const r = solveIrr([-totalCapex, ...Array.from({ length: lomYears }, () => annualFcf)]); return r != null ? r * 100 : null; })()
    : null;

  // ── LOM schedule ──────────────────────────────────────────────────────────
  const lomRows = (lomYears && annualTonnes && totalOpex > 0 && goldPrice > 0)
    ? Array.from({ length: lomYears }, (_, i) => {
        const yr = i + 1;
        const tonnes = annualTonnes;
        const grade = project.gold_grade_g_t;
        const recov = effectiveRecoveryPct / 100;
        const oz = tonnes * grade * recov * TROY;
        const revM = (oz * goldPrice * (1 - royaltyPct / 100)) / 1_000_000;
        const opM = (totalOpex * tonnes) / 1_000_000;
        const capM = yr === 1 ? totalCapex : (sustainCapex ?? 0);
        const fcf = revM - opM - capM;
        return { yr, tonnes, oz_k: oz / 1000, revM, opM, capM, fcf };
      }).map((r, i, arr) => ({
        ...r,
        // Year 1's FCF already includes the initial CAPEX through capM.
        cumFcf: arr.slice(0, i + 1).reduce((s, row) => s + row.fcf, 0),
      }))
    : [];

  // ── Sensitivity ───────────────────────────────────────────────────────────
  // The tornado + carbon-pricing views live in <SensitivityTab/> to keep this
  // page readable; all inputs are passed as props (see the 'sensitivity' tab).
  const baseNpv = npv ?? 0;

  const missingForCalc: string[] = [];
  if (capexLines.length === 0) missingForCalc.push('Lignes CAPEX');
  if (opexLines.length === 0) missingForCalc.push('Lignes OPEX');

  async function generateCapexFromCriteria() {
    setGenerating(true);
    setGenDone(false);

    const { data: draft } = await supabase
      .from('dc_draft')
      .select('content')
      .eq('project_id', project.id)
      .maybeSingle();

    const equip: Record<string, boolean> = (draft?.content as { equip?: Record<string, boolean> } | undefined)?.equip ?? {};
    const tph: number = (draft?.content as { inputs?: { tph?: number } } | undefined)?.inputs?.tph ?? project.target_tph;
    // Référentiel nommé + loi de capacité (six-dixièmes) : voir lib/economics/plantCostBenchmarks.
    // Les travaux miniers sont calculés par le module Coûts miniers (bascule « Mine »).
    const lines = buildPlantCapexLines(equip, tph);

    // Remove previously auto-generated lines so regenerating replaces (not duplicates) them,
    // while leaving any manually-added lines untouched.
    for (const l of capexLines.filter(l => l.notes === 'Généré depuis Critères de Conception')) {
      await deleteCapexLine(l.id);
    }
    // 'factored' is the only auto-estimate value allowed by the capex_lines_source_check
    // constraint (estimate|quote|vendor|budget|factored) — 'cdc-auto' was rejected (23514).
    for (const line of lines) {
      await addCapexLine({ ...line, sub_category: null, source: 'factored', notes: 'Généré depuis Critères de Conception' });
    }

    setGenerating(false);
    setGenDone(true);
    setTimeout(() => setGenDone(false), 4000);
  }

  // Auto-generate OPEX lines ($/t) from the mass balance (reagent + energy consumptions),
  // the active equipment and criteria (grinding media), and the plant size (labour,
  // maintenance, G&A). Persisted to opex_lines, replacing any prior auto-generated lines.
  async function generateOpexFromData() {
    setGeneratingOpex(true);
    setGenOpexDone(false);

    const [mbRes, dcRes] = await Promise.all([
      supabase.from('mass_balance_streams').select('cn_kg_h, lime_kg_h, energy_kwh_h').eq('project_id', project.id),
      supabase.from('dc_draft').select('content').eq('project_id', project.id).maybeSingle(),
    ]);
    const streams = (mbRes.data ?? []) as { cn_kg_h: number | null; lime_kg_h: number | null; energy_kwh_h: number | null }[];
    const content = (dcRes.data?.content ?? {}) as { equip?: Record<string, boolean>; inputs?: Record<string, number> };
    const equip = content.equip ?? {};
    const inp = content.inputs ?? {};
    const tph = inp.tph ?? project.target_tph;
    const hrs = assumptions.hoursPerYear;
    const annualTonnes = tph * (project.availability_pct / 100) * hrs;

    const sum = (k: 'cn_kg_h' | 'lime_kg_h' | 'energy_kwh_h') => streams.reduce((s, r) => s + (r[k] ?? 0), 0);
    const perT = (k: 'cn_kg_h' | 'lime_kg_h' | 'energy_kwh_h') => (sum(k) > 0 && tph > 0 ? sum(k) / tph : null);
    // Référentiel nommé (lib/economics/plantCostBenchmarks) : bilan massique > Critères > repli documenté.
    // La maintenance se base sur le CAPEX USINE : celle des engins miniers est déjà
    // dans l'OPEX minier (le CAPEX total l'aurait comptée deux fois).
    const lines = buildPlantOpexLines({
      equip, tph, annualTonnes,
      measured: { nacnKgT: perT('cn_kg_h'), limeKgT: perT('lime_kg_h'), energyKwhT: perT('energy_kwh_h') },
      criteria: { nacnKgT: inp.cyanide_cons ?? null, limeKgT: inp.lime_cons ?? null, ballKgT: inp.ball_cons ?? null },
      electricityUsdKwh: DEFAULT_ASSUMPTIONS.ELECTRICITY_COST_USD_KWH,
      totalCapexMusd: plantCapex,
    });

    // Replace previous auto lines (leave manual lines intact). source must be one of
    // estimate|quote|vendor|budget for opex_lines_source_check — 'estimate' for auto.
    for (const l of opexLines.filter(l => l.notes === OPEX_AUTO_NOTE)) await deleteOpexLine(l.id);
    for (const l of lines) await addOpexLine({ ...l, source: 'estimate', notes: OPEX_AUTO_NOTE });

    setGeneratingOpex(false);
    setGenOpexDone(true);
    setTimeout(() => setGenOpexDone(false), 4000);
  }

  async function handleSaveSettings(patch: Record<string, number | null>) {
    setSettingsSaving(true);
    await saveSettings(patch);
    setSettingsSaving(false);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2000);
  }

  async function handleAddCapex() {
    if (!newCapex.category || !newCapex.description || !newCapex.value_musd) return;
    await addCapexLine({
      category: newCapex.category,
      sub_category: null,
      description: newCapex.description,
      value_musd: parseFloat(newCapex.value_musd),
      contingency_pct: parseFloat(newCapex.contingency_pct) || 0,
      source: newCapex.source,
      notes: newCapex.notes || null,
    });
    setNewCapex({ category: '', description: '', value_musd: '', contingency_pct: '0', source: 'estimate', notes: '' });
    setShowNewCapex(false);
  }

  async function handleAddOpex() {
    if (!newOpex.category || !newOpex.description || !newOpex.value_usd_t) return;
    await addOpexLine({
      category: newOpex.category,
      description: newOpex.description,
      value_usd_t: parseFloat(newOpex.value_usd_t),
      source: newOpex.source,
      notes: newOpex.notes || null,
    });
    setNewOpex({ category: '', description: '', value_usd_t: '', source: 'estimate', notes: '' });
    setShowNewOpex(false);
  }

  const capexByCategory = capexLines.reduce<Record<string, number>>((acc, l) => {
    acc[l.category] = (acc[l.category] ?? 0) + l.value_musd * (1 + l.contingency_pct / 100);
    return acc;
  }, {});

  const opexByCategory = opexLines.reduce<Record<string, number>>((acc, l) => {
    acc[l.category] = (acc[l.category] ?? 0) + l.value_usd_t;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        icon={<DollarSign size={20} />}
        title="Modèle Économique"
        breadcrumb={['Projet', 'Économie', 'Modèle Financier']}
        actions={
          <div className="flex gap-2 items-center">
            {missingForCalc.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertCircle size={12} />
                <span>{missingForCalc[0]}{missingForCalc.length > 1 ? ` +${missingForCalc.length - 1}` : ''} manquant(s)</span>
              </div>
            )}
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-0 border-b mf-border px-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              tab === t.id ? 'border-amber-400 text-amber-300' : 'border-transparent mf-txt3 hover:mf-txt'
            }`}>{t.label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {/* ── Vue Générale ─────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-4">
            {missingForCalc.length > 0 && (
              <div className="card border-amber-400/30 bg-amber-400/5 flex gap-2 items-start">
                <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-300">
                  Calculs partiels — paramètres manquants: <b>{missingForCalc.join(', ')}</b>.
                  Configurez-les dans l'onglet <b>Paramètres</b>.
                </div>
              </div>
            )}
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'NPV (actualisation)', value: npv != null ? `${formatDecimalGrouped(npv, 1)} M$` : '—', color: npv != null && npv > 0 ? 'text-emerald-400' : 'text-red-400', note: discRate ? `@ ${discRate}% taux d'act.` : 'Taux non configuré' },
                { label: 'TRI (IRR)', value: irr != null ? `${formatDecimalGrouped(irr, 1)}%` : '—', color: irr != null && irr > 15 ? 'text-emerald-400' : 'text-amber-400', note: lomYears ? `sur ${lomYears} ans` : 'LOM non configuré' },
                { label: 'Délai de retour', value: payback != null ? `${formatDecimalGrouped(payback, 1)} ans` : '—', color: payback != null && payback < 5 ? 'text-emerald-400' : 'text-amber-400', note: totalCapex > 0 ? `CAPEX: ${formatDecimalGrouped(totalCapex, 1)} M$` : 'CAPEX non saisi' },
                { label: 'AISC estimé', value: aisc != null ? `$${formatDecimalGrouped(aisc, 0)}/oz` : '—', color: aisc != null && aisc < goldPrice * 0.6 ? 'text-emerald-400' : 'text-amber-400', note: `vs. prix Au: $${goldPrice}/oz` },
                { label: 'AIC (CAPEX initial incl.)', value: aic != null ? `$${formatDecimalGrouped(aic, 0)}/oz` : '—', color: aic != null && aic < goldPrice * 0.75 ? 'text-emerald-400' : 'text-amber-400', note: 'AISC + CAPEX initial / LOM' },
              ].map(k => (
                <div key={k.label} className="card-sm">
                  <div className="text-[10px] mf-txt4 mb-1">{k.label}</div>
                  <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
                  <div className="text-[10px] mf-txt4 mt-0.5">{k.note}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Revenus annuels', value: revenueM != null ? `${formatDecimalGrouped(revenueM, 1)} M$` : '—', note: annualOz != null ? `${formatDecimalGrouped((annualOz / 1000), 1)} koz/an` : 'Heures/an requis' },
                { label: 'OPEX annuel', value: annualOpexM != null ? `${formatDecimalGrouped(annualOpexM, 1)} M$` : '—', note: totalOpex > 0 ? `${formatDecimalGrouped(totalOpex, 2)} $/t` : 'OPEX à saisir' },
                { label: 'EBITDA', value: ebitdaM != null ? `${formatDecimalGrouped(ebitdaM, 1)} M$` : '—', note: marginPct != null ? `Marge: ${formatDecimalGrouped(marginPct, 1)}%` : '' },
              ].map(k => (
                <div key={k.label} className="card-sm">
                  <div className="text-[10px] mf-txt4 mb-0.5">{k.label}</div>
                  <div className="text-xl font-bold mf-txt">{k.value}</div>
                  <div className="text-[10px] mf-txt4">{k.note}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CAPEX ────────────────────────────────────────────────────────── */}
        {tab === 'capex' && (
          <div className="flex gap-0 border-b border-white/10 mb-3">
            {([
              { id: 'plant' as const, label: 'Usine & infrastructures', icon: <Factory size={11}/> },
              { id: 'mine' as const, label: 'Mine (ciel ouvert / souterrain)', icon: <Pickaxe size={11}/> },
            ]).map(v => (
              <button key={v.id} onClick={() => setCapexView(v.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                  capexView === v.id ? 'border-amber-400 text-amber-300' : 'border-transparent mf-txt3 hover:mf-txt'
                }`}>
                {v.icon}{v.label}
              </button>
            ))}
          </div>
        )}

        {tab === 'capex' && capexView === 'mine' && <MiningCostModule state={mining} view="capex" />}

        {tab === 'capex' && capexView === 'plant' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-sm font-semibold mf-txt">
                CAPEX Total: <span className="text-amber-400">{formatDecimalGrouped(totalCapex, 2)} M$</span>
              </div>
              <div className="flex gap-2 items-center">
                {genDone && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={12} /> Lignes générées</span>}
                <button
                  onClick={generateCapexFromCriteria}
                  disabled={generating}
                  className="btn btn-secondary text-xs flex items-center gap-1.5 border-amber-400/40 text-amber-300 hover:border-amber-400"
                >
                  <Sparkles size={13} className="text-amber-400" />
                  {generating ? 'Génération…' : 'Générer depuis CDC + Flowsheet'}
                </button>
                <button onClick={() => setShowNewCapex(true)} className="btn btn-teal text-xs flex items-center gap-1.5">
                  <Plus size={13}/> Ajouter ligne CAPEX
                </button>
              </div>
            </div>
            {capexLines.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <DollarSign size={36} className="opacity-30 mf-txt3" />
                <div className="text-sm mf-txt3">Aucune ligne CAPEX</div>
                <button
                  onClick={generateCapexFromCriteria}
                  disabled={generating}
                  className="btn btn-secondary text-xs flex items-center gap-2 border-amber-400/40 text-amber-300 hover:border-amber-400 px-4 py-2"
                >
                  <Sparkles size={14} className="text-amber-400" />
                  {generating ? 'Génération en cours…' : 'Générer depuis Critères de Conception + Flowsheet'}
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['Catégorie', 'Description', 'Valeur (M$)', 'Contingence (%)', 'Total avec cont.', 'Source', ''].map(h => (
                          <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {capexLines.map(l => (
                        <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                          <td className="px-3 py-1.5">
                            {editCapexId === l.id ? (
                              <select className="input-field text-xs w-32" value={l.category}
                                onChange={e => updateCapexLine(l.id, { category: e.target.value })}>
                                {CAPEX_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                              </select>
                            ) : <span className="mf-txt2">{l.category}</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            {editCapexId === l.id ? (
                              <input className="input-field text-xs w-48" value={l.description}
                                onChange={e => updateCapexLine(l.id, { description: e.target.value })} />
                            ) : l.description}
                          </td>
                          <td className="px-3 py-1.5">
                            {editCapexId === l.id ? (
                              <input type="number" step="0.1" className="input-field text-xs w-24" value={l.value_musd}
                                onChange={e => updateCapexLine(l.id, { value_musd: parseFloat(e.target.value) || 0 })} />
                            ) : <span className="font-semibold text-amber-300">{formatDecimalGrouped(l.value_musd, 2)}</span>}
                          </td>
                          <td className="px-3 py-1.5 mf-txt3">{formatDecimalGrouped(l.contingency_pct, 0)}%</td>
                          <td className="px-3 py-1.5 text-amber-400 font-semibold">
                            {formatDecimalGrouped((l.value_musd * (1 + l.contingency_pct / 100)), 2)}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="badge text-[9px] bg-white/5 mf-txt3 border border-white/10 px-1 py-0.5 rounded">{l.source}</span>
                          </td>
                          <td className="px-3 py-1.5 flex gap-1">
                            <button onClick={() => setEditCapexId(editCapexId === l.id ? null : l.id)}
                              className="text-sky-400/50 hover:text-sky-400 text-xs transition-colors">
                              {editCapexId === l.id ? '✓' : '✎'}
                            </button>
                            <button onClick={() => deleteCapexLine(l.id)} className="text-red-400/40 hover:text-red-400 transition-colors">×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* By category */}
                <div className="grid grid-cols-3 gap-3">
                  {Object.entries(capexByCategory).map(([cat, val]) => (
                    <div key={cat} className="card-sm text-xs">
                      <div className="mf-txt3 mb-0.5">{cat}</div>
                      <div className="font-semibold text-amber-400">{formatDecimalGrouped(val, 2)} M$</div>
                      <div className="text-[9px] mf-txt4">{totalCapex > 0 ? formatDecimalGrouped(((val / totalCapex) * 100), 1) : 0}%</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── OPEX DÉTAILLÉ ─────────────────────────────────────────────────── */}
        {tab === 'opex' && (
          <div className="space-y-0 flex flex-col h-full">
            {/* Sub-tabs */}
            <div className="flex gap-0 border-b border-white/10 mb-3">
              {([
                { id: 'summary' as OpexTab, label: 'Sommaire', icon: <BarChart3 size={11}/> },
                { id: 'labour'  as OpexTab, label: "Main d'oeuvre", icon: <Users size={11}/> },
                { id: 'power'   as OpexTab, label: 'Puissance élect.', icon: <Zap size={11}/> },
                { id: 'reagents' as OpexTab, label: 'Réactifs & Consommables', icon: <FlaskConical size={11}/> },
                { id: 'mobile' as OpexTab, label: 'Équip. mobiles', icon: <Truck size={11}/> },
                { id: 'mine' as OpexTab, label: 'Mine', icon: <Pickaxe size={11}/> },
              ]).map(st => (
                <button key={st.id} onClick={() => setOpexTab(st.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    opexTab === st.id ? 'border-amber-400 text-amber-300' : 'border-transparent mf-txt3 hover:mf-txt'
                  }`}>
                  {st.icon}{st.label}
                </button>
              ))}
            </div>

            {/* ── Inputs généraux (toujours visible) ───────── */}
            {opexTab === 'summary' && (
              <div className="space-y-3">
                {/* Auto-generated OPEX lines (persisted to opex_lines) */}
                <div className="card-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-sm font-semibold mf-txt">
                      OPEX Total: <span className="text-amber-400">{formatDecimalGrouped(totalOpex, 2)} $/t</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      {genOpexDone && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={12}/> Lignes générées</span>}
                      <button onClick={generateOpexFromData} disabled={generatingOpex}
                        className="btn btn-secondary text-xs flex items-center gap-1.5 border-amber-400/40 text-amber-300 hover:border-amber-400">
                        <Sparkles size={13} className="text-amber-400"/>
                        {generatingOpex ? 'Génération…' : 'Générer depuis Bilan + Critères'}
                      </button>
                      <button onClick={() => setShowNewOpex(true)} className="btn btn-teal text-xs flex items-center gap-1.5"><Plus size={13}/> Ajouter ligne</button>
                    </div>
                  </div>
                  {opexLines.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3">
                      <DollarSign size={32} className="opacity-30 mf-txt3"/>
                      <div className="text-sm mf-txt3">Aucune ligne OPEX</div>
                      <button onClick={generateOpexFromData} disabled={generatingOpex}
                        className="btn btn-secondary text-xs flex items-center gap-2 border-amber-400/40 text-amber-300 hover:border-amber-400 px-4 py-2">
                        <Sparkles size={14} className="text-amber-400"/>
                        {generatingOpex ? 'Génération en cours…' : 'Générer depuis Bilan Massique + Critères'}
                      </button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="tbl w-full text-xs">
                        <thead>
                          <tr>{['Catégorie', 'Description', 'Coût ($/t)', 'Source', ''].map(h => (
                            <th key={h} className="text-left px-3 py-2 mf-txt3 font-semibold">{h}</th>))}
                          </tr>
                        </thead>
                        <tbody>
                          {opexLines.map(l => (
                            <tr key={l.id} className="border-b border-white/5 hover:bg-white/5">
                              <td className="px-3 py-1.5">
                                {editOpexId === l.id
                                  ? <select className="input-field text-xs w-32" value={l.category} onChange={e => updateOpexLine(l.id, { category: e.target.value })}>{OPEX_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select>
                                  : <span className="mf-txt2">{l.category}</span>}
                              </td>
                              <td className="px-3 py-1.5">
                                {editOpexId === l.id
                                  ? <input className="input-field text-xs w-56" value={l.description} onChange={e => updateOpexLine(l.id, { description: e.target.value })}/>
                                  : l.description}
                              </td>
                              <td className="px-3 py-1.5">
                                {editOpexId === l.id
                                  ? <input type="number" step="0.01" className="input-field text-xs w-24" value={l.value_usd_t} onChange={e => updateOpexLine(l.id, { value_usd_t: parseFloat(e.target.value) || 0 })}/>
                                  : <span className="font-semibold text-amber-300">{formatDecimalGrouped(l.value_usd_t, 2)}</span>}
                              </td>
                              <td className="px-3 py-1.5"><span className="badge text-[9px] bg-white/5 mf-txt3 border border-white/10 px-1 py-0.5 rounded">{l.source}</span></td>
                              <td className="px-3 py-1.5 flex gap-1">
                                <button onClick={() => setEditOpexId(editOpexId === l.id ? null : l.id)} className="text-sky-400/50 hover:text-sky-400 text-xs transition-colors">{editOpexId === l.id ? '✓' : '✎'}</button>
                                <button onClick={() => deleteOpexLine(l.id)} className="text-red-400/40 hover:text-red-400 transition-colors">×</button>
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-white/5 font-semibold">
                            <td className="px-3 py-1.5" colSpan={2}>Total OPEX</td>
                            <td className="px-3 py-1.5 text-amber-400">{formatDecimalGrouped(totalOpex, 2)} $/t</td>
                            <td colSpan={2}></td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="grid grid-cols-4 gap-2 mt-3">
                        {Object.entries(opexByCategory).map(([cat, val]) => (
                          <div key={cat} className="card-sm text-[11px]"><div className="mf-txt3">{cat}</div><div className="font-semibold text-amber-300">{formatDecimalGrouped(val, 2)} $/t</div></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="card-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">INPUTS GÉNÉRAUX OPEX</div>
                    <button className="btn btn-secondary text-xs flex items-center gap-1.5"><FileSpreadsheet size={11}/> Sauvegarder</button>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <div className="text-xs font-semibold text-amber-400 mb-2">Paramètres généraux</div>
                      <div className="space-y-2">
                        {[
                          { key: 'diesel_usd_l', label: 'Diesel', unit: 'USD/L', step: '0.001' },
                          { key: 'essence_usd_l', label: 'Essence', unit: 'USD/L', step: '0.001' },
                          { key: 'benefits_pct', label: 'Avantages sociaux', unit: '%', step: '0.5' },
                          { key: 'bonus_pct', label: 'Bonus', unit: '%', step: '0.5' },
                          { key: 'elec_usd_kwh', label: 'Coût électricité', unit: 'USD/kWh', step: '0.001' },
                        ].map(f => (
                          <div key={f.key} className="flex items-center gap-2">
                            <span className="text-xs mf-txt3 w-40">{f.label}</span>
                            <input type="number" step={f.step}
                              value={opexInputs[f.key as keyof typeof opexInputs]}
                              onChange={e => setOpexInputs(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                              className="input-field text-xs text-right w-24 py-0.5" />
                            <span className="text-[10px] mf-txt4 w-16">{f.unit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-amber-400 mb-2">Paramètres procédé</div>
                      <div className="space-y-2">
                        {[
                          { key: 'annual_tonnes', label: 'Débit annuel', unit: 't/an', step: '1000' },
                          { key: 'avail_crush', label: 'Disponibilité concassage', unit: '%', step: '1' },
                          { key: 'avail_plant', label: 'Disponibilité usine', unit: '%', step: '1' },
                          { key: 'recovery_pct', label: 'Récupération Au', unit: '%', step: '0.1' },
                        ].map(f => (
                          <div key={f.key} className="flex items-center gap-2">
                            <span className="text-xs mf-txt3 w-40">{f.label}</span>
                            <input type="number" step={f.step}
                              value={opexInputs[f.key as keyof typeof opexInputs]}
                              onChange={e => setOpexInputs(p => ({ ...p, [f.key]: parseFloat(e.target.value) || 0 }))}
                              className="input-field text-xs text-right w-24 py-0.5" />
                            <span className="text-[10px] mf-txt4 w-16">{f.unit}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Summary table */}
                <div className="card-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">PROCESS OPERATING COSTS — SOMMAIRE</div>
                    <div className="flex gap-2">
                      <button onClick={() => setShowNewOpex(true)} className="btn btn-secondary text-xs flex items-center gap-1.5"><Plus size={11}/> Générer OPEX</button>
                      <button className="btn btn-secondary text-xs flex items-center gap-1.5"><FileSpreadsheet size={11}/> Export Excel</button>
                    </div>
                  </div>
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        <th className="text-left px-3 py-2 mf-txt3 font-semibold w-56">CATÉGORIE</th>
                        <th className="text-right px-3 py-2 mf-txt3 font-semibold">TOTAL USD/AN</th>
                        <th className="text-right px-3 py-2 mf-txt3 font-semibold">USD/T ALIMENTÉ</th>
                        <th className="text-right px-3 py-2 mf-txt3 font-semibold">USD/OZ AU</th>
                        <th className="text-right px-3 py-2 mf-txt3 font-semibold w-20">% DU TOTAL</th>
                      </tr>
                    </thead>
                    {(() => {
                      // Source unique (lib/economics/plantCostBenchmarks) : le total = somme des lignes.
                      const colors: Record<string, string> = { labour: 'bg-sky-400', power: 'bg-amber-400', reagents: 'bg-emerald-400', wear: 'bg-violet-400', mobile: 'bg-red-400', spares: 'bg-blue-400' };
                      const annT = opexInputs.annual_tonnes;
                      const summary = opexSummary({
                        labourRows, powerRows, reagentRows, mobileRows,
                        maintenanceUsdT: opexLines.filter(l => l.category === 'Maintenance').reduce((s, l) => s + l.value_usd_t, 0),
                        annualTonnes: annT,
                        electricityUsdKwh: opexInputs.elec_usd_kwh,
                        plantCapexMusd: plantCapex,
                      });
                      // Onces : teneur du projet, sans repli inventé — à défaut, la colonne affiche « — ».
                      const annOz = annT * project.gold_grade_g_t * ((opexInputs.recovery_pct || effectiveRecoveryPct) / 100) * TROY;
                      const perT = (v: number) => (annT > 0 ? formatDecimalGrouped(v / annT, 2) : '—');
                      const perOz = (v: number) => (annOz > 0 ? formatDecimalGrouped(v / annOz, 2) : '—');
                      return (<>
                        <tbody>
                          {summary.rows.map(row => (
                            <tr key={row.key} className="border-b border-white/5 hover:bg-white/4">
                              <td className="px-3 py-2 flex items-center gap-2"><div className={`w-2.5 h-2.5 rounded-full ${colors[row.key]}`}/><span className="mf-txt text-xs">{row.label}</span></td>
                              <td className="px-3 py-2 text-right mf-txt">{row.value.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                              <td className="px-3 py-2 text-right mf-txt3">{perT(row.value)}</td>
                              <td className="px-3 py-2 text-right mf-txt3">{perOz(row.value)}</td>
                              <td className="px-3 py-2 text-right mf-txt3">{row.pct > 0 ? `${formatDecimalGrouped(row.pct, 1)}%` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="border-t-2 border-amber-400/40">
                            <td className="px-3 py-2 font-bold text-xs mf-txt">Total Operating Cost</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-400">{summary.total.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-400">{perT(summary.total)}</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-400">{perOz(summary.total)}</td>
                            <td className="px-3 py-2 text-right font-bold text-amber-400">{summary.total > 0 ? '100%' : '—'}</td>
                          </tr>
                        </tfoot>
                      </>);
                    })()}
                  </table>
                </div>
              </div>
            )}

            {/* ── Main d'oeuvre ────────────────────────────────────────────── */}
            {opexTab === 'labour' && (
              <div className="card-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">
                    REGISTRE MAIN D'OEUVRE — {labourRows.length} EMPLOYÉS — ${labourRows.reduce((s,r)=>s+labourRowAnnualCost(r).total,0).toLocaleString('fr-CA',{maximumFractionDigits:0})} USD/AN
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setLabourRows(prev => [...prev, { id: uid2(), description: 'Opérateur broyage', category: 'Operations', schedule: '12h 4-4', n_emp: 4, sal_base_h: cadToUsd(38), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 10 }])}
                      className="btn btn-teal text-xs flex items-center gap-1.5"><Plus size={11}/> Ajouter poste</button>
                    <button onClick={() => {
                      const std: LabourRow[] = [
                        { id: uid2(), description: 'Surintendant usine',      category: 'Gestion',      schedule: 'Jour 5-2',  n_emp: 1,  sal_base_h: cadToUsd(65), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 0 },
                        { id: uid2(), description: 'Ingénieur procédé',        category: 'Ingénierie',   schedule: 'Jour 5-2',  n_emp: 2,  sal_base_h: cadToUsd(55), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 0 },
                        { id: uid2(), description: 'Opérateur SAG/Ball',       category: 'Operations',   schedule: '12h 4-4',   n_emp: 4,  sal_base_h: cadToUsd(40), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 10 },
                        { id: uid2(), description: 'Opérateur CIL/ADR',        category: 'Operations',   schedule: '12h 4-4',   n_emp: 4,  sal_base_h: cadToUsd(40), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 10 },
                        { id: uid2(), description: 'Technicien labo',          category: 'Laboratoire',  schedule: 'Jour 5-2',  n_emp: 3,  sal_base_h: cadToUsd(35), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 5 },
                        { id: uid2(), description: 'Mécanicien maintenance',   category: 'Maintenance',  schedule: 'Jour 5-2',  n_emp: 4,  sal_base_h: cadToUsd(42), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 15 },
                        { id: uid2(), description: 'Électricien/Instrumentiste', category: 'Maintenance', schedule: 'Jour 5-2', n_emp: 2,  sal_base_h: cadToUsd(45), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 10 },
                        { id: uid2(), description: 'Opérateur concassage',     category: 'Operations',   schedule: '12h 4-4',   n_emp: 2,  sal_base_h: cadToUsd(38), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 10 },
                        { id: uid2(), description: 'Agent environnement',      category: 'HSE',          schedule: 'Jour 5-2',  n_emp: 2,  sal_base_h: cadToUsd(38), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 0 },
                        { id: uid2(), description: 'Contremaître de quart',    category: 'Gestion',      schedule: '12h 4-4',   n_emp: 4,  sal_base_h: cadToUsd(52), bonus_pct: opexInputs.bonus_pct, benefits_pct: opexInputs.benefits_pct, ot_pct: 5 },
                      ];
                      setLabourRows(std);
                    }} className="btn btn-secondary text-xs">Générer registre standard</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs min-w-[900px]">
                    <thead>
                      <tr>
                        {['DESCRIPTION','CATÉGORIE','HORAIRE','# EMP.','SAL. BASE ($/H)','BASE ($/AN)','BONUS','AVANTAGES','OT','SALAIRE TOTAL','COÛT TOTAL',''].map(h=>(
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {labourRows.map(row => {
                        const { base: base_an, bonus, benefits: ben, overtime: ot, total: sal_tot } = labourRowAnnualCost(row);
                        return (
                          <tr key={row.id} className="border-b border-white/5 hover:bg-white/4">
                            <td className="px-2 py-1"><input className="input-field text-xs w-40 py-0.5" value={row.description} onChange={e=>setLabourRows(p=>p.map(r=>r.id===row.id?{...r,description:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input className="input-field text-xs w-24 py-0.5" value={row.category} onChange={e=>setLabourRows(p=>p.map(r=>r.id===row.id?{...r,category:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input className="input-field text-xs w-20 py-0.5" value={row.schedule} onChange={e=>setLabourRows(p=>p.map(r=>r.id===row.id?{...r,schedule:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" className="input-field text-xs w-14 py-0.5 text-right" value={row.n_emp} onChange={e=>setLabourRows(p=>p.map(r=>r.id===row.id?{...r,n_emp:parseInt(e.target.value)||1}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="0.5" className="input-field text-xs w-20 py-0.5 text-right" value={row.sal_base_h} onChange={e=>setLabourRows(p=>p.map(r=>r.id===row.id?{...r,sal_base_h:parseFloat(e.target.value)||0}:r))}/></td>
                            <td className="px-2 py-1 text-right mf-txt">{base_an.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right mf-txt3">{bonus.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right mf-txt3">{ben.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right mf-txt3">{ot.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right font-semibold mf-txt">{sal_tot.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right font-bold text-amber-300">{sal_tot.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1"><button onClick={()=>setLabourRows(p=>p.filter(r=>r.id!==row.id))} className="text-red-400/40 hover:text-red-400">×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-400/40">
                        <td colSpan={3} className="px-2 py-2 font-bold text-xs mf-txt">TOTAL MAIN D'OEUVRE</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{labourRows.reduce((s,r)=>s+r.n_emp,0)}</td>
                        <td colSpan={5}/>
                        <td colSpan={2} className="px-2 py-2 text-right font-bold text-amber-400">{labourRows.reduce((s,r)=>s+labourRowAnnualCost(r).total,0).toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── Puissance électrique ──────────────────────────────────────── */}
            {opexTab === 'power' && (
              <div className="card-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">
                    PUISSANCE ÉLECTRIQUE PAR ZONE WBS — {formatDecimalGrouped(powerRows.reduce((s,r)=>s+r.kw_mec,0), 0)} KW INSTALLÉS — ${powerRows.reduce((s,r)=>s+(r.kw_mec/Math.max(r.eff_elec,0.01)*r.load_factor*r.dispo/100*r.h_j*365*opexInputs.elec_usd_kwh),0).toLocaleString('fr-CA',{maximumFractionDigits:0})} USD/AN
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setPowerRows(prev=>[...prev,{id:uid2(),wbs:'05b',description:'Broyeur SAG',kw_mec:4000,eff_elec:0.95,load_factor:0.85,dispo:91,h_j:24}])} className="btn btn-teal text-xs flex items-center gap-1.5"><Plus size={11}/> Ajouter équipement</button>
                    <button onClick={()=>setPowerRows([
                      {id:uid2(),wbs:'01',description:'Convoyeurs reprise',kw_mec:250,eff_elec:0.94,load_factor:0.75,dispo:91,h_j:24},
                      {id:uid2(),wbs:'03c',description:'Concasseur cône',kw_mec:500,eff_elec:0.95,load_factor:0.85,dispo:75,h_j:16},
                      {id:uid2(),wbs:'05b',description:'Broyeur SAG',kw_mec:4000,eff_elec:0.96,load_factor:0.88,dispo:91,h_j:24},
                      {id:uid2(),wbs:'05c',description:'Broyeur à boulets',kw_mec:2500,eff_elec:0.96,load_factor:0.90,dispo:91,h_j:24},
                      {id:uid2(),wbs:'06a',description:'Pompes cyclones',kw_mec:400,eff_elec:0.94,load_factor:0.80,dispo:91,h_j:24},
                      {id:uid2(),wbs:'07',description:'Concentrateurs gravité',kw_mec:120,eff_elec:0.94,load_factor:0.90,dispo:85,h_j:24},
                      {id:uid2(),wbs:'09',description:'Agitateurs CIL',kw_mec:600,eff_elec:0.94,load_factor:0.92,dispo:91,h_j:24},
                      {id:uid2(),wbs:'10',description:'Pompes ADR/EW',kw_mec:180,eff_elec:0.94,load_factor:0.80,dispo:91,h_j:24},
                      {id:uid2(),wbs:'11a',description:'Épaississeur moteur',kw_mec:150,eff_elec:0.94,load_factor:0.70,dispo:91,h_j:24},
                      {id:uid2(),wbs:'GEN',description:'Éclairage & services',kw_mec:300,eff_elec:1.0,load_factor:0.75,dispo:100,h_j:24},
                    ])} className="btn btn-secondary text-xs">Générer depuis MER</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs min-w-[1000px]">
                    <thead>
                      <tr>
                        {['WBS','DESCRIPTION','KW MÉCA.','EFF. ÉLECT.','LOAD FACTOR','DISPO.','H/J','H/AN','KWH/AN','KWH/T','USD/AN','USD/T',''].map(h=>(
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {powerRows.map(row => {
                        const h_an = row.h_j * 365 * row.dispo / 100;
                        const kwh_an = row.kw_mec / Math.max(row.eff_elec,0.01) * row.load_factor * h_an;
                        const annT = opexInputs.annual_tonnes || 1;
                        const kwh_t = kwh_an / annT;
                        const usd_an = kwh_an * opexInputs.elec_usd_kwh;
                        const usd_t = usd_an / annT;
                        return (
                          <tr key={row.id} className="border-b border-white/5 hover:bg-white/4">
                            <td className="px-2 py-1"><input className="input-field text-xs w-12 py-0.5" value={row.wbs} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,wbs:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input className="input-field text-xs w-36 py-0.5" value={row.description} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,description:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" className="input-field text-xs w-16 py-0.5 text-right" value={row.kw_mec} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,kw_mec:parseFloat(e.target.value)||0}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="0.01" className="input-field text-xs w-14 py-0.5 text-right" value={row.eff_elec} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,eff_elec:parseFloat(e.target.value)||0.95}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="0.01" className="input-field text-xs w-14 py-0.5 text-right" value={row.load_factor} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,load_factor:parseFloat(e.target.value)||0.85}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="1" className="input-field text-xs w-14 py-0.5 text-right" value={row.dispo} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,dispo:parseFloat(e.target.value)||91}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="0.5" className="input-field text-xs w-12 py-0.5 text-right" value={row.h_j} onChange={e=>setPowerRows(p=>p.map(r=>r.id===row.id?{...r,h_j:parseFloat(e.target.value)||24}:r))}/></td>
                            <td className="px-2 py-1 text-right mf-txt3">{formatDecimalGrouped(h_an, 0)}</td>
                            <td className="px-2 py-1 text-right mf-txt">{formatDecimalGrouped((kwh_an/1000), 0)} k</td>
                            <td className="px-2 py-1 text-right mf-txt3">{formatDecimalGrouped(kwh_t, 2)}</td>
                            <td className="px-2 py-1 text-right font-semibold text-amber-300">{usd_an.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right mf-txt3">{formatDecimalGrouped(usd_t, 2)}</td>
                            <td className="px-2 py-1"><button onClick={()=>setPowerRows(p=>p.filter(r=>r.id!==row.id))} className="text-red-400/40 hover:text-red-400">×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-400/40">
                        <td colSpan={2} className="px-2 py-2 font-bold text-xs mf-txt">Total</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped(powerRows.reduce((s,r)=>s+r.kw_mec,0), 0)}</td>
                        <td colSpan={4}/>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped(powerRows.reduce((s,r)=>s+(r.h_j*365*r.dispo/100),0), 0)}</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped((powerRows.reduce((s,r)=>s+(r.kw_mec/Math.max(r.eff_elec,0.01)*r.load_factor*r.h_j*365*r.dispo/100),0)/1000), 0)} k</td>
                        <td/>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{powerRows.reduce((s,r)=>s+(r.kw_mec/Math.max(r.eff_elec,0.01)*r.load_factor*r.dispo/100*r.h_j*365*opexInputs.elec_usd_kwh),0).toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped((opexInputs.annual_tonnes>0?powerRows.reduce((s,r)=>s+(r.kw_mec/Math.max(r.eff_elec,0.01)*r.load_factor*r.dispo/100*r.h_j*365*opexInputs.elec_usd_kwh),0)/opexInputs.annual_tonnes:0), 2)}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── Réactifs & Consommables ──────────────────────────────────── */}
            {opexTab === 'reagents' && (
              <div className="card-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">
                    RÉACTIFS, MÉDIAS ET CONSOMMABLES — ${reagentRows.reduce((s,r)=>s+(r.conso_unit*opexInputs.annual_tonnes*r.cost_unit),0).toLocaleString('fr-CA',{maximumFractionDigits:0})} USD/AN
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>setReagentRows(prev=>[...prev,{id:uid2(),description:'NaCN',category:'Lixiviation',unit:'kg/t',conso_unit:0.45,cost_unit:cadToUsd(2.8),source:'DC+LIMS'}])} className="btn btn-teal text-xs flex items-center gap-1.5"><Plus size={11}/> Ajouter réactif</button>
                    <button onClick={()=>setReagentRows([
                      {id:uid2(),description:'NaCN (cyanure de sodium)',          category:'Lixiviation',    unit:'kg/t',conso_unit:0.45,cost_unit:cadToUsd(2.80),source:'DC+LIMS'},
                      {id:uid2(),description:'CaO (chaux vive)',                  category:'Lixiviation',    unit:'kg/t',conso_unit:1.20,cost_unit:cadToUsd(0.18),source:'DC+LIMS'},
                      {id:uid2(),description:'Charbon actif (make-up)',           category:'CIL/CIP',        unit:'kg/t',conso_unit:0.03,cost_unit:cadToUsd(2.50),source:'DC'},
                      {id:uid2(),description:'O₂ liquide (aération CIL)',         category:'CIL/CIP',        unit:'kg/t',conso_unit:0.80,cost_unit:cadToUsd(0.22),source:'Fournisseur'},
                      {id:uid2(),description:'NaOH (soude caustique)',            category:'ADR',            unit:'kg/t',conso_unit:0.15,cost_unit:cadToUsd(0.60),source:'DC'},
                      {id:uid2(),description:'HCl (nettoyage anodes EW)',         category:'ADR',            unit:'kg/t',conso_unit:0.05,cost_unit:cadToUsd(0.35),source:'Pratique'},
                      {id:uid2(),description:'Billes acier Ø125mm (SAG)',         category:'Broyage',        unit:'kg/t',conso_unit:0.35,cost_unit:cadToUsd(1.20),source:'Fournisseur'},
                      {id:uid2(),description:'Billes acier Ø50mm (Ball)',         category:'Broyage',        unit:'kg/t',conso_unit:0.25,cost_unit:cadToUsd(1.30),source:'Fournisseur'},
                      {id:uid2(),description:'Revêtements SAG (rubber/acier)',    category:'Broyage',        unit:'$/t',conso_unit:0.40,cost_unit:cadToUsd(1.00),source:'Fournisseur'},
                      {id:uid2(),description:'Revêtements Ball mill',             category:'Broyage',        unit:'$/t',conso_unit:0.18,cost_unit:cadToUsd(1.00),source:'Fournisseur'},
                      {id:uid2(),description:'Floculant (épaississeur)',          category:'Utilités',       unit:'g/t',conso_unit:20, cost_unit:cadToUsd(0.003),source:'DC'},
                      {id:uid2(),description:'SO₂ (détoxification CN)',           category:'Environnement',  unit:'kg/t',conso_unit:0.30,cost_unit:cadToUsd(0.25),source:'DC'},
                      {id:uid2(),description:'H₂O₂ (détox INCO)',                category:'Environnement',  unit:'kg/t',conso_unit:0.08,cost_unit:cadToUsd(1.20),source:'DC'},
                      {id:uid2(),description:'Flux fonderie (borax)',             category:'Fonderie',       unit:'kg/oz',conso_unit:0.05,cost_unit:cadToUsd(2.00),source:'Pratique'},
                      {id:uid2(),description:'Diesel (génératrice secours)',      category:'Énergie',        unit:'L/h',conso_unit:50, cost_unit:opexInputs.diesel_usd_l,source:'Inputs'},
                    ])} className="btn btn-secondary text-xs">Générer depuis DC + LIMS</button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="tbl w-full text-xs">
                    <thead>
                      <tr>
                        {['DESCRIPTION','CATÉGORIE','UNITÉ','CONSO. UNIT.','CONSO. ANNUELLE','COÛT UNIT. (USD)','SOURCE','TOTAL (USD/AN)','USD/T',''].map(h=>(
                          <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reagentRows.map(row => {
                        const annT = opexInputs.annual_tonnes || 1;
                        const conso_an = row.conso_unit * annT;
                        const total_usd = conso_an * row.cost_unit;
                        const usd_t = total_usd / annT;
                        return (
                          <tr key={row.id} className="border-b border-white/5 hover:bg-white/4">
                            <td className="px-2 py-1"><input className="input-field text-xs w-44 py-0.5" value={row.description} onChange={e=>setReagentRows(p=>p.map(r=>r.id===row.id?{...r,description:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input className="input-field text-xs w-24 py-0.5" value={row.category} onChange={e=>setReagentRows(p=>p.map(r=>r.id===row.id?{...r,category:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input className="input-field text-xs w-14 py-0.5" value={row.unit} onChange={e=>setReagentRows(p=>p.map(r=>r.id===row.id?{...r,unit:e.target.value}:r))}/></td>
                            <td className="px-2 py-1"><input type="number" step="0.001" className="input-field text-xs w-16 py-0.5 text-right" value={row.conso_unit} onChange={e=>setReagentRows(p=>p.map(r=>r.id===row.id?{...r,conso_unit:parseFloat(e.target.value)||0}:r))}/></td>
                            <td className="px-2 py-1 text-right mf-txt3">{conso_an.toLocaleString('fr-CA',{maximumFractionDigits:1})}</td>
                            <td className="px-2 py-1"><input type="number" step="0.01" className="input-field text-xs w-16 py-0.5 text-right" value={row.cost_unit} onChange={e=>setReagentRows(p=>p.map(r=>r.id===row.id?{...r,cost_unit:parseFloat(e.target.value)||0}:r))}/></td>
                            <td className="px-2 py-1 mf-txt3 text-[10px]">{row.source}</td>
                            <td className="px-2 py-1 text-right font-semibold text-amber-300">{total_usd.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                            <td className="px-2 py-1 text-right mf-txt3">{formatDecimalGrouped(usd_t, 2)}</td>
                            <td className="px-2 py-1"><button onClick={()=>setReagentRows(p=>p.filter(r=>r.id!==row.id))} className="text-red-400/40 hover:text-red-400">×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-amber-400/40">
                        <td colSpan={7} className="px-2 py-2 font-bold text-xs mf-txt">TOTAL OPEX RÉACTIFS</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{reagentRows.reduce((s,r)=>s+(r.conso_unit*opexInputs.annual_tonnes*r.cost_unit),0).toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                        <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped((opexInputs.annual_tonnes>0?reagentRows.reduce((s,r)=>s+(r.conso_unit*opexInputs.annual_tonnes*r.cost_unit),0)/opexInputs.annual_tonnes:0), 2)}</td>
                        <td/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* ── Équipements Mobiles ──────────────────────────────────────── */}
            {opexTab === 'mine' && <MiningCostModule state={mining} view="opex" />}

            {opexTab === 'mobile' && (
              <div className="card-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-semibold mf-txt3 uppercase tracking-wider">
                    ÉQUIPEMENTS MOBILES — ${mobileRows.reduce((s,r)=>s+(r.qty*r.h_an*r.usd_h),0).toLocaleString('fr-CA',{maximumFractionDigits:0})} USD/AN
                  </div>
                  <button onClick={()=>setMobileRows(prev=>[...prev,{id:uid2(),description:'Chariot élévateur',type:'Chariot',qty:1,h_an:2080,usd_h:cadToUsd(35)}])} className="btn btn-teal text-xs flex items-center gap-1.5"><Plus size={11}/> Ajouter</button>
                </div>
                <table className="tbl w-full text-xs">
                  <thead>
                    <tr>
                      {['DESCRIPTION','TYPE','QUANTITÉ','H/AN OPÉR.','USD/H','TOTAL (USD/AN)','USD/T',''].map(h=>(
                        <th key={h} className="text-left px-2 py-2 mf-txt3 font-semibold text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mobileRows.map(row => {
                      const tot = row.qty * row.h_an * row.usd_h;
                      const usd_t = (opexInputs.annual_tonnes > 0) ? tot / opexInputs.annual_tonnes : 0;
                      return (
                        <tr key={row.id} className="border-b border-white/5 hover:bg-white/4">
                          <td className="px-2 py-1"><input className="input-field text-xs w-44 py-0.5" value={row.description} onChange={e=>setMobileRows(p=>p.map(r=>r.id===row.id?{...r,description:e.target.value}:r))}/></td>
                          <td className="px-2 py-1"><input className="input-field text-xs w-24 py-0.5" value={row.type} onChange={e=>setMobileRows(p=>p.map(r=>r.id===row.id?{...r,type:e.target.value}:r))}/></td>
                          <td className="px-2 py-1"><input type="number" className="input-field text-xs w-14 py-0.5 text-right" value={row.qty} onChange={e=>setMobileRows(p=>p.map(r=>r.id===row.id?{...r,qty:parseInt(e.target.value)||1}:r))}/></td>
                          <td className="px-2 py-1"><input type="number" className="input-field text-xs w-16 py-0.5 text-right" value={row.h_an} onChange={e=>setMobileRows(p=>p.map(r=>r.id===row.id?{...r,h_an:parseFloat(e.target.value)||0}:r))}/></td>
                          <td className="px-2 py-1"><input type="number" step="0.5" className="input-field text-xs w-16 py-0.5 text-right" value={row.usd_h} onChange={e=>setMobileRows(p=>p.map(r=>r.id===row.id?{...r,usd_h:parseFloat(e.target.value)||0}:r))}/></td>
                          <td className="px-2 py-1 text-right font-semibold text-amber-300">{tot.toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                          <td className="px-2 py-1 text-right mf-txt3">{formatDecimalGrouped(usd_t, 2)}</td>
                          <td className="px-2 py-1"><button onClick={()=>setMobileRows(p=>p.filter(r=>r.id!==row.id))} className="text-red-400/40 hover:text-red-400">×</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-amber-400/40">
                      <td colSpan={5} className="px-2 py-2 font-bold text-xs mf-txt">Total</td>
                      <td className="px-2 py-2 text-right font-bold text-amber-400">{mobileRows.reduce((s,r)=>s+(r.qty*r.h_an*r.usd_h),0).toLocaleString('fr-CA',{maximumFractionDigits:0})}</td>
                      <td className="px-2 py-2 text-right font-bold text-amber-400">{formatDecimalGrouped((opexInputs.annual_tonnes>0?mobileRows.reduce((s,r)=>s+(r.qty*r.h_an*r.usd_h),0)/opexInputs.annual_tonnes:0), 2)}</td>
                      <td/>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Plan LOM ─────────────────────────────────────────────────────── */}
        {tab === 'lom' && <LomTab lomRows={lomRows} />}

        {/* ── Sensibilité ──────────────────────────────────────────────────── */}
        {tab === 'sensitivity' && (
          <SensitivityTab
            annualOz={annualOz}
            annualTonnes={annualTonnes}
            goldPrice={goldPrice}
            annualOpexM={annualOpexM}
            totalCapex={totalCapex}
            sustainCapex={sustainCapex}
            refinery={refinery}
            assumptions={assumptions}
            baseNpv={baseNpv}
          />
        )}
        {tab === 'fiscal' && (
          <FiscalTab
            project={project}
            annualOz={annualOz}
            annualTonnes={annualTonnes}
            goldPrice={goldPrice}
            revenueM={revenueM}
            ebitdaM={ebitdaM}
            totalOpex={totalOpex}
            refinery={refinery}
          />
        )}

        {/* ── Paramètres ───────────────────────────────────────────────────── */}
        {tab === 'settings' && (
          <div className="space-y-4 max-w-2xl">
            <div className="flex justify-between items-center">
              <div className="text-sm font-semibold mf-txt">Paramètres du Modèle Financier</div>
              {settingsSaved && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 size={12}/> Sauvegardé</span>}
              {settingsSaving && <span className="text-xs mf-txt4">Sauvegarde…</span>}
            </div>
            <p className="text-xs mf-txt4">
              Laisser un champ vide applique l'hypothèse par défaut documentée (indiquée sous le champ).
              Une valeur saisie surcharge ce défaut pour ce projet uniquement, dans tous les modules.
            </p>
            <div className="grid grid-cols-2 gap-4">
              {([
                // defaultHint = the value modules actually apply when the field is left empty
                // (see DEFAULT_ASSUMPTIONS / resolveSettings). null = no documented default.
                { key: 'hours_per_year',           label: 'Heures/an',                    step: '1',    note: 'Heures calendaires (× disponibilité dans les calculs)', defaultHint: String(HOURS_PER_YEAR) },
                { key: 'discount_rate_pct',         label: 'Taux d\'actualisation (%)',    step: '0.5',  note: 'DCF, après impôts',            defaultHint: String(DEFAULT_ASSUMPTIONS.DISCOUNT_RATE * 100) },
                { key: 'lom_years',                 label: 'Durée LOM (ans)',              step: '1',    note: 'Vie du projet',                defaultHint: String(DEFAULT_ASSUMPTIONS.LOM_YEARS) },
                { key: 'sustaining_capex_musd_yr',  label: 'CAPEX maintien (M$/an)',       step: '0.5',  note: 'Sustaining capital annuel',    defaultHint: null },
                { key: 'debt_equity_ratio_pct',     label: 'Ratio dette/équité (%)',       step: '1',    note: '% financement par dette',      defaultHint: null },
                { key: 'royalty_pct',               label: 'Redevances minières (%)',      step: '0.1',  note: 'Royalties sur revenus',        defaultHint: String(DEFAULT_ASSUMPTIONS.ROYALTY_FRACTION * 100) },
                { key: 'refinery_charge_usd_oz',    label: 'Frais raffinage ($/oz)',       step: '0.5',  note: 'Treatment + refining charges', defaultHint: String(DEFAULT_ASSUMPTIONS.REFINERY_CHARGE_USD_OZ) },
                { key: 'working_capital_pct',       label: 'Fonds de roulement (% CAPEX)', step: '1',    note: 'Working capital initial',      defaultHint: String(DEFAULT_ASSUMPTIONS.WORKING_CAPITAL_FRACTION * 100) },
                { key: 'grid_ef_kg_co2_kwh',        label: 'Facteur émission réseau',      step: '0.01', note: 'kgCO₂/kWh réseau électrique',  defaultHint: null },
                { key: 'nacn_co2_factor',           label: 'Facteur CO₂ NaCN (tCO₂/t)',   step: '0.01', note: 'Scope 3 — réactif',            defaultHint: null },
                { key: 'smelting_charge_pct',       label: 'Frais fonte (%)',              step: '0.1',  note: '% valeur lingot',              defaultHint: null },
                { key: 'contingency_pct',           label: 'Contingence globale (%)',      step: '1',    note: 'Appliqué au CAPEX total',      defaultHint: String(DEFAULT_ASSUMPTIONS.CONTINGENCY_FRACTION * 100) },
              ] as const).map(f => (
                <SettingField
                  key={f.key}
                  label={f.label}
                  step={f.step}
                  note={f.note}
                  defaultHint={f.defaultHint}
                  value={(settings?.[f.key] ?? null) as number | null}
                  onCommit={v => handleSaveSettings({ [f.key]: v })}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── New CAPEX Modal ───────────────────────────────────────────────────── */}
      {showNewCapex && (
        <Modal title="Ajouter une ligne CAPEX" onClose={() => setShowNewCapex(false)}>
          <div className="p-4 space-y-3 min-w-[420px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Catégorie *</label>
                <select className="input-field w-full" value={newCapex.category}
                  onChange={e => setNewCapex(p => ({ ...p, category: e.target.value }))}>
                  <option value="">— Sélectionner —</option>
                  {CAPEX_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Source</label>
                <select className="input-field w-full" value={newCapex.source}
                  onChange={e => setNewCapex(p => ({ ...p, source: e.target.value }))}>
                  {['estimate','quote','vendor','budget','factored'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Description *</label>
                <input className="input-field w-full" value={newCapex.description} placeholder="ex. SAG Mill 10.4m"
                  onChange={e => setNewCapex(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label className="label">Valeur (M$) *</label>
                <input type="number" step="0.1" className="input-field w-full" value={newCapex.value_musd}
                  onChange={e => setNewCapex(p => ({ ...p, value_musd: e.target.value }))} />
              </div>
              <div>
                <label className="label">Contingence (%)</label>
                <input type="number" step="1" className="input-field w-full" value={newCapex.contingency_pct}
                  onChange={e => setNewCapex(p => ({ ...p, contingency_pct: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input-field w-full" value={newCapex.notes}
                onChange={e => setNewCapex(p => ({ ...p, notes: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewCapex(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={handleAddCapex} disabled={!newCapex.category || !newCapex.description || !newCapex.value_musd} className="btn btn-teal">Ajouter</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── New OPEX Modal ─────────────────────────────────────────────────────── */}
      {showNewOpex && (
        <Modal title="Ajouter une ligne OPEX" onClose={() => setShowNewOpex(false)}>
          <div className="p-4 space-y-3 min-w-[360px]">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Catégorie *</label>
                <select className="input-field w-full" value={newOpex.category}
                  onChange={e => setNewOpex(p => ({ ...p, category: e.target.value }))}>
                  <option value="">— Sélectionner —</option>
                  {OPEX_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Source</label>
                <select className="input-field w-full" value={newOpex.source}
                  onChange={e => setNewOpex(p => ({ ...p, source: e.target.value }))}>
                  {['estimate','quote','vendor','budget'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Description *</label>
                <input className="input-field w-full" value={newOpex.description} placeholder="ex. Main-d'œuvre — Opérateurs"
                  onChange={e => setNewOpex(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className="label">Coût ($/t traitée) *</label>
                <input type="number" step="0.01" className="input-field w-full" value={newOpex.value_usd_t}
                  onChange={e => setNewOpex(p => ({ ...p, value_usd_t: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewOpex(false)} className="btn btn-secondary">Annuler</button>
              <button onClick={handleAddOpex} disabled={!newOpex.category || !newOpex.description || !newOpex.value_usd_t} className="btn btn-teal">Ajouter</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
