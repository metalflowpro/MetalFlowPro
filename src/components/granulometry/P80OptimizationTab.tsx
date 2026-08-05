// ─────────────────────────────────────────────────────────────────────────────
// Section « P80 Optimisation » — Granulométrie/PSD.
//
// Organisée selon la démarche métier en DEUX TEMPS :
//   Phase 1 — Laboratoire : essais broyage + granulométrie + lixiviation à
//     différents P80 pour identifier la MAILLE DE LIBÉRATION optimale de l'or
//     (→ P80 cible labo).
//   Phase 2 — Usine : TRANSPOSITION du P80 labo aux conditions réelles (facteur
//     K_indus), ARBITRAGE ÉCONOMIQUE récupération vs coût énergétique, et
//     CONTRÔLE OPÉRATIONNEL (plage cible + actions correctives).
//
// Tout le calcul vit dans lib/geomet/p80Optimization (pur, testé) ; ce composant
// ne fait que saisir, mettre en scène et persister l'audit. Le ruban de synthèse
// en tête montre le fil labo → usine d'un coup d'œil.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, type ReactNode } from 'react';
import {
  Target, Zap, TrendingUp, Factory, Play, CheckCircle2,
  FlaskConical, ArrowRight, SlidersHorizontal, Gauge,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { supabase } from '../../lib/supabase';
import {
  runP80Optimization,
  type P80OptimizationInputs, type P80OptimizationResult,
  type DataSufficiency, type ScenarioPoint, type KIndusMode,
} from '../../lib/geomet/p80Optimization';
import { P80GranulometricHero } from './P80GranulometricHero';
import type { Project } from '../../types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface P80OptimizationTabProps {
  project: Project;
  /** BWi moteur (pondéré domaines ou saisi) + provenance. */
  bwi: number;
  bwiIsMeasured: boolean;
  nSamples: number;
  hasRecoveryData: boolean;
  /** F80 alimentation broyage (µm) — Critères ou saisi. */
  f80Um: number;
  auFreePct: number | null;
  recoveryCeilingPct: number;
  plantFactor: number;
  elecCostUsdKwh: number;
  /** Courbe PSD de l'échantillon LIMS sélectionné (µm, % passant). */
  limsPsdCurve: Array<{ sieve: number; passing: number }>;
  limsSampleLabel: string | null;
  /**
   * P80 labo représentatif du module : lu sur la courbe combinée de tous les
   * essais PSD (pondérée par domaine). Distinct du P80 de la courbe affichée,
   * qui n'est qu'un échantillon — c'est cette valeur qui fait autorité.
   */
  labP80MeanUm: number | null;
  /** Contrôle : moyenne pondérée des P80 individuels (percentile ≠ moyenne). */
  labP80ControlUm: number | null;
  /** true si la pondération repose sur un vrai partage d'alimentation. */
  p80WeightedByFeed: boolean;
  /** P80 process des Critères de conception (contrainte aval), si présent. */
  dcP80Grind: number | null;
  // ── Emplacements ────────────────────────────────────────────────────────
  // Blocs rendus par la page parente (ils pilotent son propre état) mais
  // placés ici pour tomber dans la bonne phase, au lieu d'allonger la section
  // au-dessus et au-dessous du composant.
  /** Bandeau « Confiance sur le P80 mesuré » (Phase 1). */
  slotConfidence?: ReactNode;
  /** Frontière P80 limitée par la libération (Phase 1). */
  slotLiberationFrontier?: ReactNode;
  /** Validation du P80 recalculé depuis les courbes PSD mesurées (Phase 1). */
  slotValidation?: ReactNode;
  /** Modèle de broyage labo → P80 produit et conseils de réglage (Phase 1). */
  slotLabGrind?: ReactNode;
  /** Paramètres du moteur (F80, BWi, facteur usine, élec.) — conditions usine (Phase 2). */
  slotParams?: ReactNode;
  /** Bandeau de synchronisation vers Critères & Mine Opt (Phase 2). */
  slotSync?: ReactNode;
}

// ─── Petits helpers de rendu ─────────────────────────────────────────────────

const CONF_BADGE: Record<string, { label: string; cls: string }> = {
  high:   { label: 'Confiance élevée',  cls: 'bg-emerald-500/15 text-emerald-400' },
  medium: { label: 'Confiance moyenne', cls: 'bg-amber-500/15 text-amber-400' },
  low:    { label: 'Confiance faible',  cls: 'bg-red-500/15 text-red-400' },
};

const SCENARIO_COLORS: Record<string, string> = {
  bond_energy: '#f59e0b',
  recovery_driven: '#14b8a6',
  curve_driven: '#9d78f0',
};

function fmtUm(v: number): string {
  return v >= 1000 ? `${formatDecimalGrouped(v / 1000, v >= 10000 ? 0 : 1)} mm` : `${formatDecimalGrouped(v, 0)} µm`;
}

// ─── Phases ──────────────────────────────────────────────────────────────────
//
// La section suivait un pipeline unique très dense. Elle est réorganisée selon
// le déroulé de travail réel du métallurgiste : d'abord le labo (maille de
// libération), puis l'usine (transposition + arbitrage économique + contrôle).

type Phase = 'lab' | 'plant';

const PHASES: Array<{ id: Phase; num: string; label: string; icon: typeof Target }> = [
  { id: 'lab',   num: '1', label: 'Laboratoire — maille de libération',    icon: FlaskConical },
  { id: 'plant', num: '2', label: 'Usine — transposition & optimisation',  icon: Factory },
];

// ─── Graphes SVG ─────────────────────────────────────────────────────────────

const GW = 580, GH = 220, GPL = 52, GPR = 16, GPT = 14, GPB = 32;
const GPW = GW - GPL - GPR, GPH = GH - GPT - GPB;

function xLogScale(v: number, min: number, max: number) {
  return GPL + (Math.log10(v / min) / Math.log10(max / min)) * GPW;
}

/** Courbe générique vs P80 (récupération ou énergie) avec optimum + scénarios. */
function P80CurveChart({ points, field, unit, color, markers, optimumP80 }: {
  points: ScenarioPoint[];
  field: 'recoveryPct' | 'energyKwhT';
  unit: string;
  color: string;
  markers: Array<{ p80: number; color: string; label: string }>;
  optimumP80: number;
}) {
  if (points.length < 2) return null;
  const xs = points.map(p => p.p80);
  const min = Math.min(...xs) * 0.9, max = Math.max(...xs) * 1.1;
  const vals = points.map(p => p[field]);
  const vMax = Math.max(...vals) * 1.08, vMin = Math.min(...vals) * 0.92;
  const y = (v: number) => GPT + (1 - (v - vMin) / (vMax - vMin || 1)) * GPH;
  const line = [...points].sort((a, b) => a.p80 - b.p80).map(p => `${xLogScale(p.p80, min, max)},${y(p[field])}`).join(' ');
  return (
    <svg viewBox={`0 0 ${GW} ${GH}`} className="w-full" style={{ height: GH }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <g key={f}>
          <line x1={GPL} y1={GPT + f * GPH} x2={GW - GPR} y2={GPT + f * GPH} stroke="rgba(255,255,255,0.05)" />
          <text x={GPL - 6} y={GPT + f * GPH + 3} fill="#6b7280" fontSize="8" textAnchor="end">
            {formatDecimalGrouped(vMax - f * (vMax - vMin), 1)}
          </text>
        </g>
      ))}
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" />
      {points.map((p, i) => (
        <circle key={i} cx={xLogScale(p.p80, min, max)} cy={y(p[field])} r="2.5" fill={color} opacity={0.8} />
      ))}
      {/* Optimum du pipeline (P80 usine) */}
      <line x1={xLogScale(optimumP80, Math.min(min, optimumP80), Math.max(max, optimumP80))} y1={GPT}
        x2={xLogScale(optimumP80, Math.min(min, optimumP80), Math.max(max, optimumP80))} y2={GPT + GPH}
        stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 3" />
      {/* Marqueurs de scénarios */}
      {markers.map((m, i) => {
        const pt = points.reduce((b, p) => (Math.abs(p.p80 - m.p80) < Math.abs(b.p80 - m.p80) ? p : b));
        return (
          <g key={i}>
            <circle cx={xLogScale(pt.p80, min, max)} cy={y(pt[field])} r="5.5" fill="none" stroke={m.color} strokeWidth="2" />
            <text x={xLogScale(pt.p80, min, max) + 7} y={y(pt[field]) - 5} fill={m.color} fontSize="8">{m.label}</text>
          </g>
        );
      })}
      <text x={GW / 2} y={GH - 4} fill="#9ca3af" fontSize="8" textAnchor="middle">P80 (µm, échelle log) → · {unit}</text>
    </svg>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function P80OptimizationTab(props: P80OptimizationTabProps) {
  const { project } = props;

  const [phase, setPhase] = useState<Phase>('lab');

  // Cette section tourne sur les valeurs projet auto-synchronisées et des
  // défauts documentés : la source PSD est l'échantillon LIMS sélectionné, et
  // K_indus / débit / puissance prennent leurs valeurs par défaut.
  const activeCurve = props.limsPsdCurve;
  const throughputTph = project.target_tph;

  // Facteur usine K_indus — le levier de transposition labo → usine (Phase 2).
  const [kMode, setKMode] = useState<KIndusMode>('default');
  const [kManual, setKManual] = useState<number>(1.18);
  const [kCircuitEff, setKCircuitEff] = useState<number>(80);
  const [kStability, setKStability] = useState<number>(85);
  const [kGap, setKGap] = useState<number>(5);

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dataSufficiency: DataSufficiency = useMemo(() => ({
    hasPsd: activeCurve.length >= 3,
    hasMeasuredWi: props.bwiIsMeasured,
    hasRecoveryData: props.hasRecoveryData,
    nSamples: props.nSamples,
  }), [activeCurve.length, props.bwiIsMeasured, props.hasRecoveryData, props.nSamples]);

  // ── Pipeline complet (recalculé en continu ; le bouton fige + audite) ──────
  const inputs: P80OptimizationInputs = useMemo(() => ({
    psdCurve: activeCurve,
    psdMeta: { source: 'lims', sampleId: props.limsSampleLabel, unit: 'um' },
    f80Um: props.f80Um,
    headF80Um: 600_000,
    bwi: props.bwi,
    recovery: { auFreePct: props.auFreePct, recoveryCeilingPct: props.recoveryCeilingPct },
    goldGradeGt: project.gold_grade_g_t,
    goldPriceUsdOz: project.gold_price_usd,
    elecCostUsdKwh: props.elecCostUsdKwh,
    plantFactor: props.plantFactor,
    throughputTph,
    availablePowerKw: null,
    designEnergyTargetKwhT: null,
    processMaxP80Um: props.dcP80Grind != null ? Math.round(props.dcP80Grind * 1.25) : null,
    kIndusMode: kMode,
    kIndusManual: kManual,
    kIndusInputs: { circuitEfficiencyPct: kCircuitEff, processStabilityPct: kStability, testVsPlantGapPct: kGap },
    labTargetEngineerUm: null,
    withRegrind: false,
    data: dataSufficiency,
  }), [activeCurve, props, project, throughputTph, dataSufficiency,
    kMode, kManual, kCircuitEff, kStability, kGap]);

  const result: P80OptimizationResult = useMemo(() => runP80Optimization(inputs), [inputs]);

  // Fige le résultat courant dans l'historique d'audit (table p80_optimization_runs).
  async function simulateAndSave() {
    setSaving(true);
    const { error } = await supabase.from('p80_optimization_runs').insert({
      project_id: project.id,
      p80_lims_um: result.p80Lims.valueUm,
      p80_target_lab_um: result.labTarget.valueUm,
      p80_optimal_plant_um: Math.round(result.p80OptimalPlantUm),
      k_indus: result.kIndus.k,
      k_indus_mode: result.kIndus.mode,
      specific_energy_kwh_t: result.finalGrindEnergy.totalKwhT,
      total_power_kw: result.finalGrindEnergy.totalPowerKw,
      scenario_selected: result.scenarios.selected.id,
      confidence_level: result.confidence,
      inputs: result.audit,
      results: {
        scenarios: result.scenarios.scenarios,
        circuits: result.circuits,
        selection_reason: result.scenarios.selectionReason,
      },
      comment: result.comment,
    });
    if (error) setSaveError(`Audit non enregistré (${error.message}).`);
    else { setSavedAt(new Date().toLocaleTimeString('fr-FR')); setSaveError(null); }
    setSaving(false);
  }

  // ── Valeurs dérivées pour la mise en scène ─────────────────────────────────
  const scenMarkers = result.scenarios.scenarios.map(s => ({
    p80: s.p80Um, color: SCENARIO_COLORS[s.id],
    label: s.id === 'bond_energy' ? 'Bond' : s.id === 'recovery_driven' ? 'Récup.' : 'Courbe',
  }));

  const labTargetUm = Math.round(result.labTarget.valueUm);
  const plantP80Um = Math.round(result.p80OptimalPlantUm);
  const conf = CONF_BADGE[result.confidence];

  // Plage de contrôle opérationnel usine : la plage acceptable labo transposée
  // (× K_indus). Illustre le suivi en exploitation — purement présentationnel.
  const ctrlLo = Math.round(result.labTarget.rangeUm[0] * result.kIndus.k);
  const ctrlHi = Math.round(result.labTarget.rangeUm[1] * result.kIndus.k);

  // Contrôle du facteur K_indus, rendu dans le corps de la Phase 2.
  const kControl = (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-mf-txt4 mb-1">Facteur usine K</div>
      <div className="flex items-center gap-1">
        {(['default', 'auto', 'manual'] as KIndusMode[]).map(m => (
          <button key={m} onClick={() => setKMode(m)}
            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
              kMode === m ? 'bg-teal-500/10 text-teal-300 border-teal-500/30' : 'text-mf-txt4 border-mf-border hover:text-mf-txt3'}`}>
            {m === 'default' ? 'Défaut' : m === 'auto' ? 'Auto' : 'Manuel'}
          </button>
        ))}
      </div>
      {kMode === 'manual' && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input type="number" step="0.01" min="1" max="1.45" value={kManual}
            onChange={e => setKManual(+e.target.value || 1.18)}
            className="input-field font-mono text-xs max-w-[84px] py-1" />
          <span className="text-[10px] text-mf-txt4">1,00 – 1,45</span>
        </div>
      )}
      {kMode === 'auto' && (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <KMini label="Rdt %" value={kCircuitEff} onChange={setKCircuitEff} />
          <KMini label="Stab %" value={kStability} onChange={setKStability} />
          <KMini label="Écart %" value={kGap} onChange={setKGap} />
        </div>
      )}
      <div className="mt-1 text-[10px] text-mf-txt4">{result.kIndus.basis.join(' ')}</div>
    </div>
  );

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── Ruban de synthèse : le fil labo → usine, toujours visible ───────
          Oriente la lecture avant d'entrer dans le détail des deux phases. */}
      <div className="rounded-xl border border-mf-border bg-mf-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <RibbonStep icon={<FlaskConical size={13} className="text-teal-400" />}
            label="P₈₀ cible labo" value={`${labTargetUm} µm`} sub="maille de libération" />
          <RibbonArrow note={`× K ${result.kIndus.k.toFixed(2)}`} />
          <RibbonStep icon={<Factory size={13} className="text-teal-300" />}
            label="Consigne usine" value={`${plantP80Um} µm`} sub="transposée" accent />
          <div className="mx-1 h-8 w-px bg-mf-border hidden sm:block" />
          <RibbonStep label="Énergie broyage" value={`${formatDecimalGrouped(result.finalGrindEnergy.totalKwhT, 1)} kWh/t`} />
          <RibbonStep label="Récupération" value={`${formatDecimalGrouped(result.scenarios.selected.recoveryPct, 1)} %`} valueCls="text-teal-400" />
          <RibbonStep label="Valeur nette" value={`${formatDecimalGrouped(result.scenarios.selected.netUsdT, 1)} $/t`} valueCls="text-emerald-400" />
          <span className={`ml-auto px-2 py-0.5 text-[10px] rounded-full ${conf.cls}`}>{conf.label}</span>
        </div>
      </div>

      {/* ── Sélecteur de phase ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-mf-border overflow-x-auto">
        {PHASES.map(p => (
          <button
            key={p.id}
            onClick={() => setPhase(p.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
              phase === p.id
                ? 'border-teal-400 text-teal-400'
                : 'border-transparent text-mf-txt3 hover:text-mf-txt'
            }`}
          >
            <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
              phase === p.id ? 'bg-teal-500/15 text-teal-300' : 'bg-mf-panel text-mf-txt4'}`}>
              {p.num}
            </span>
            <p.icon size={13} /> {p.label}
          </button>
        ))}
      </div>

      {/* ══ PHASE 1 : Laboratoire — maille de libération ══════════════════ */}
      {phase === 'lab' && (
      <div className="space-y-4">
        <PhaseIntro
          text="En laboratoire, on broie des échantillons représentatifs à différentes finesses,
                on trace la granulométrie, puis on lixivie à chaque P80 pour trouver la maille où
                l'or se libère le mieux — la meilleure récupération métallurgique. C'est le P₈₀ cible labo."
        />

        {/* Fiabilité de la mesure du P80 (essais LIMS). */}
        {props.slotConfidence}
        {props.slotValidation}

        {/* Détermination de la maille : récupération vs P80 ancrée sur la
            déportation minéralogique mesurée. */}
        {props.slotLiberationFrontier}

        {/* Comment atteindre la cible en labo : broyage → P80 produit. */}
        {props.slotLabGrind}

        {/* Résultat de la Phase 1 : le P80 cible labo. */}
        <div className="rounded-xl border border-teal-500/30 bg-teal-500/5 p-4">
          <div className="flex items-start gap-4 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-teal-400/80 font-medium">
                Résultat Phase 1 · P₈₀ cible labo
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-light tracking-tight text-teal-300 tabular-nums leading-none">
                  {labTargetUm}
                </span>
                <span className="text-base font-light text-mf-txt3">µm</span>
              </div>
              <div className="mt-1 text-[10px] text-mf-txt4">
                Plage acceptable {Math.round(result.labTarget.rangeUm[0])} – {Math.round(result.labTarget.rangeUm[1])} µm
              </div>
            </div>
            <div className="flex-1 min-w-[240px] text-xs text-mf-txt3 leading-relaxed self-center">
              {result.labTarget.justification}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-teal-500/15 flex items-center gap-2 text-[11px] text-teal-300">
            <ArrowRight size={13} className="shrink-0" />
            Étape suivante : transposer ce P₈₀ labo aux conditions usine (Phase 2).
          </div>
        </div>
      </div>
      )}

      {/* ══ PHASE 2 : Usine — transposition & optimisation économique ═════ */}
      {phase === 'plant' && (
      <div className="space-y-4">
        <PhaseIntro
          text="Le P₈₀ labo n'est pas directement applicable à l'usine (temps de résidence,
                classification imparfaite, débit). On le transpose via le facteur K, on arbitre
                récupération vs coût énergétique pour fixer la consigne, puis on encadre le
                contrôle opérationnel."
        />

        {/* ── Transposition labo → usine (facteur K) → consigne ──────────── */}
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <SlidersHorizontal size={14} className="text-teal-400" />
            <div className="text-sm font-semibold text-mf-txt">Transposition labo → usine</div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,220px)_1fr] gap-4 items-start">
            <div className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">
              <div className="text-[11px] text-mf-txt3 mb-2">
                Consigne usine = <strong className="text-mf-txt">{labTargetUm} µm</strong> labo
                × K <strong className="text-mf-txt">{result.kIndus.k.toFixed(2)}</strong>
                = <strong className="text-teal-300">{plantP80Um} µm</strong>
              </div>
              {kControl}
            </div>
            <div className="text-[11px] text-mf-txt4 leading-relaxed self-center">
              L'usine tourne plus grossier que le labo : variabilité d'alimentation, cyclones
              imparfaits, contraintes de débit. Le facteur K (P₈₀ usine = P₈₀ labo × K) porte
              cette correction ; la planche ci-dessous montre la consigne obtenue sur la
              granulométrie mesurée.
            </div>
          </div>
        </div>

        {/* Planche « Granular Silence » : la consigne usine, montrée. */}
        <P80GranulometricHero
          curve={activeCurve}
          sampleLabel={props.limsSampleLabel}
          measuredP80Um={result.p80Lims.valueUm}
          representativeP80Um={props.labP80MeanUm}
          labTargetP80Um={result.labTarget.valueUm}
          plantP80Um={result.p80OptimalPlantUm}
          kIndus={result.kIndus.k}
          energyKwhT={result.finalGrindEnergy.totalKwhT}
          powerKw={result.finalGrindEnergy.totalPowerKw}
          designDeltaPct={result.finalGrindEnergy.designDeltaPct}
          throughputTph={throughputTph}
          scenarioLabel={result.scenarios.selected.label}
          confidence={result.confidence}
        />

        {/* ── Arbitrage économique : 3 scénarios ────────────────────────── */}
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-teal-400" />
              <div className="text-sm font-semibold text-mf-txt">Arbitrage économique récupération vs énergie</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={simulateAndSave} disabled={saving}>
              <Play size={13} /> {saving ? 'Simulation…' : 'Simuler les scénarios'}
            </button>
          </div>
          <div className="text-[10px] text-mf-txt4 mb-3">
            On cherche le P₈₀ qui maximise la valeur nette : revenu du gain de récupération moins le surcoût de broyage.
          </div>
          {savedAt && <div className="text-[10px] text-emerald-400 mb-2">✓ Simulation enregistrée dans l'audit à {savedAt}</div>}
          {saveError && <div className="text-[10px] text-amber-400 mb-2">{saveError}</div>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.scenarios.scenarios.map(s => {
              const selected = s.id === result.scenarios.selected.id;
              return (
                <div key={s.id} className={`rounded-lg border p-3 ${selected ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-mf-border bg-mf-panel/40'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: SCENARIO_COLORS[s.id] }}>{s.label}</span>
                    {selected && <span className="badge badge-green text-[9px]">Retenu</span>}
                  </div>
                  <div className="text-[10px] text-mf-txt4 mb-2">{s.objective}</div>
                  <div className="grid grid-cols-2 gap-1.5 text-center">
                    <div className="rounded bg-mf-bg/40 p-1.5">
                      <div className="text-[9px] text-mf-txt4">P80</div>
                      <div className="text-sm font-mono font-semibold text-mf-txt">{s.p80Um} µm</div>
                    </div>
                    <div className="rounded bg-mf-bg/40 p-1.5">
                      <div className="text-[9px] text-mf-txt4">Énergie</div>
                      <div className="text-sm font-mono font-semibold text-amber-400">{formatDecimalGrouped(s.energyKwhT, 1)}</div>
                    </div>
                    <div className="rounded bg-mf-bg/40 p-1.5">
                      <div className="text-[9px] text-mf-txt4">Récup.</div>
                      <div className="text-sm font-mono font-semibold text-teal-400">{formatDecimalGrouped(s.recoveryPct, 1)} %</div>
                    </div>
                    <div className="rounded bg-mf-bg/40 p-1.5">
                      <div className="text-[9px] text-mf-txt4">Net $/t</div>
                      <div className="text-sm font-mono font-semibold text-emerald-400">{formatDecimalGrouped(s.netUsdT, 1)}</div>
                    </div>
                  </div>
                  {s.powerKw != null && <div className="mt-1.5 text-[10px] text-mf-txt4 text-center">Puissance requise ≈ {formatDecimalGrouped(s.powerKw, 0)} kW</div>}
                  <div className="mt-1.5 text-[10px] text-mf-txt3">{s.note}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-start gap-2 text-xs text-emerald-300 px-3 py-2 rounded-lg bg-emerald-500/5">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            {result.scenarios.selectionReason}
          </div>
        </div>

        {/* ── Courbes récupération & énergie vs P80 ──────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="text-sm font-semibold text-mf-txt mb-1 flex items-center gap-2">
              <TrendingUp size={14} className="text-teal-400" /> Récupération vs P80
            </div>
            <div className="text-[10px] text-mf-txt4 mb-2">Ligne verte pointillée = P80 optimal usine · cercles = scénarios · le surbroyage dégrade la récupération sous le seuil</div>
            <P80CurveChart points={result.scenarios.points} field="recoveryPct" unit="Récupération (%)"
              color="#14b8a6" markers={scenMarkers} optimumP80={result.p80OptimalPlantUm} />
          </div>
          <div className="rounded-xl border border-mf-border bg-mf-card p-4">
            <div className="text-sm font-semibold text-mf-txt mb-1 flex items-center gap-2">
              <Zap size={14} className="text-amber-400" /> Énergie vs P80
            </div>
            <div className="text-[10px] text-mf-txt4 mb-2">Énergie usine = Bond labo × EF5 Rowland × facteur usine/labo {props.plantFactor.toFixed(2)}</div>
            <P80CurveChart points={result.scenarios.points} field="energyKwhT" unit="Énergie (kWh/t)"
              color="#f59e0b" markers={scenMarkers} optimumP80={result.p80OptimalPlantUm} />
          </div>
        </div>

        {/* ── Conditions usine (paramètres du moteur) ────────────────────── */}
        {props.slotParams}

        {/* ── Recommandation P80 par circuit ─────────────────────────────── */}
        <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 text-sm font-semibold text-mf-txt">Recommandation P80 par circuit</div>
          <div className="px-4 pb-2 text-[10px] text-mf-txt4">
            Hiérarchie : contraintes mécaniques → granulométrie aval → récupération → énergie → robustesse. Le P80 diffère par circuit.
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Circuit</th>
                <th className="text-right">P80 cible</th>
                <th className="text-right">P80 recommandé</th>
                <th className="text-right">Énergie Bond <span className="normal-case">(kWh/t)</span></th>
                <th className="text-right">Δ Récup. <span className="normal-case">(pt)</span></th>
                <th>Confiance</th>
                <th>Justification</th>
              </tr>
            </thead>
            <tbody>
              {result.circuits.map(c => {
                const cb = CONF_BADGE[c.confidence];
                return (
                  <tr key={c.type}>
                    <td className="text-mf-txt2">{c.label}</td>
                    <td className="num text-mf-txt4">{fmtUm(c.p80TargetUm)}</td>
                    <td className="num font-semibold text-emerald-400">{fmtUm(c.p80RecommendedUm)}</td>
                    <td className="num text-amber-400">{formatDecimalGrouped(c.specificEnergyKwhT, 2)}</td>
                    <td className="num text-teal-400">{c.recoveryImpactPct != null ? (c.recoveryImpactPct >= 0 ? '+' : '') + formatDecimalGrouped(c.recoveryImpactPct, 2) : '—'}</td>
                    <td><span className={`px-1.5 py-0.5 text-[10px] rounded-full ${cb.cls}`}>{c.confidence}</span></td>
                    <td className="text-[10px] text-mf-txt4">{c.rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Contrôle opérationnel : plage cible + actions correctives ──── */}
        <div className="rounded-xl border border-mf-border bg-mf-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={14} className="text-teal-400" />
            <div className="text-sm font-semibold text-mf-txt">Contrôle opérationnel en usine</div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div>
              <div className="text-[10px] text-mf-txt4">Plage cible P₈₀ (déversoirs / cyclones)</div>
              <div className="text-lg font-mono font-semibold text-teal-300">{ctrlLo} – {ctrlHi} µm</div>
            </div>
            <div className="flex-1 min-w-[260px] text-[11px] text-mf-txt4 leading-relaxed">
              Surveiller le P₈₀ par prélèvements réguliers sur les circuits de broyage/classification.
              Si le P₈₀ dérive <strong className="text-amber-300">grossier</strong> (&gt; {ctrlHi} µm) :
              resserrer les cyclones, augmenter la charge de broyage ou la densité de pulpe. S'il dérive
              <strong className="text-amber-300"> fin</strong> (&lt; {ctrlLo} µm) : risque de surbroyage
              (sliming, pertes en résidus) et surcoût énergétique — desserrer en conséquence.
            </div>
          </div>
        </div>

        {/* Synchronisation vers Critères & Mine Opt. */}
        {props.slotSync}
      </div>
      )}
    </div>
  );
}

// ─── Sous-composants de présentation ─────────────────────────────────────────

function RibbonStep({ icon, label, value, sub, valueCls, accent }: {
  icon?: ReactNode; label: string; value: string; sub?: string; valueCls?: string; accent?: boolean;
}) {
  return (
    <div className={accent ? 'rounded-lg bg-teal-500/5 px-2 py-1' : ''}>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-mf-txt4">
        {icon}{label}
      </div>
      <div className={`font-mono font-semibold text-sm ${valueCls ?? 'text-mf-txt'}`}>{value}</div>
      {sub && <div className="text-[9px] text-mf-txt4">{sub}</div>}
    </div>
  );
}

function RibbonArrow({ note }: { note: string }) {
  return (
    <div className="flex flex-col items-center text-mf-txt4">
      <ArrowRight size={16} />
      <span className="text-[9px] font-mono">{note}</span>
    </div>
  );
}

function PhaseIntro({ text }: { text: string }) {
  return (
    <p className="text-xs text-mf-txt3 leading-relaxed max-w-4xl">{text}</p>
  );
}

// Mini-champ numérique pour les sous-paramètres du mode K « Auto ».
function KMini({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-mf-txt4">{label}</span>
      <input type="number" value={value} onChange={e => onChange(+e.target.value || 0)}
        className="input-field font-mono text-[11px] py-0.5" />
    </label>
  );
}
