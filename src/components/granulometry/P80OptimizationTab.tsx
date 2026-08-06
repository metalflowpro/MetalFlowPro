// ─────────────────────────────────────────────────────────────────────────────
// Section « P80 Optimisation » — Granulométrie/PSD.
//
// Déroulé en QUATRE RÉPONSES, dans l'ordre où le métallurgiste se les pose :
//   1. Où broie-t-on aujourd'hui ?  → P80 moyen des essais
//   2. Où faudrait-il broyer ?      → P80 optimal LABO (maille de libération)
//   3. Que vise l'usine ?           → P80 optimal USINE (labo × facteur K)
//   4. Que construit-on ?           → circuit de comminution + route métallurgique
//
// Tout le calcul vit dans des moteurs PURS et testés :
//   • lib/geomet/p80Optimization — P80 labo, K_indus, P80 usine, scénarios
//   • lib/geomet/circuitSelection — configuration du circuit de comminution
//   • lib/analytics/routeEstimation — route métallurgique (PARTAGÉ avec la page
//     Analyse & Interprétation, pour que les deux écrans ne divergent jamais)
//
// Toute l'analyse détaillée (frontière de libération, arbitrage à 3 scénarios,
// réglages de broyage labo, contrôle opérationnel) reste disponible sous
// « Détails avancés », replié par défaut : un livrable 43-101 doit pouvoir
// justifier chaque chiffre, mais l'écran par défaut ne doit pas l'imposer.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, type ReactNode } from 'react';
import {
  Target, TrendingUp, Factory, Play, CheckCircle2, FlaskConical,
  ArrowRight, SlidersHorizontal, ChevronDown, Layers, Beaker, AlertTriangle,
} from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { supabase } from '../../lib/supabase';
import {
  runP80Optimization,
  type P80OptimizationInputs, type P80OptimizationResult,
  type DataSufficiency, type KIndusMode,
} from '../../lib/geomet/p80Optimization';
import { recommendComminutionCircuit } from '../../lib/geomet/circuitSelection';
import { estimateRoutes, type RouteMetrics, type RouteSampleCounts } from '../../lib/analytics/routeEstimation';
import { P80GranulometricHero } from './P80GranulometricHero';
import type { Project } from '../../types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface P80OptimizationTabProps {
  project: Project;
  bwi: number;
  bwiIsMeasured: boolean;
  nSamples: number;
  hasRecoveryData: boolean;
  f80Um: number;
  auFreePct: number | null;
  recoveryCeilingPct: number;
  plantFactor: number;
  elecCostUsdKwh: number;
  limsPsdCurve: Array<{ sieve: number; passing: number }>;
  limsSampleLabel: string | null;
  /** P80 labo représentatif : lu sur la courbe combinée de tous les essais. */
  labP80MeanUm: number | null;
  labP80ControlUm: number | null;
  p80WeightedByFeed: boolean;
  dcP80Grind: number | null;
  /** Métriques d'essais alimentant la route métallurgique (étape 4). */
  routeMetrics: RouteMetrics;
  routeCounts: RouteSampleCounts;
  // ── Emplacements (rendus par la page, rangés sous « Détails avancés ») ────
  slotConfidence?: ReactNode;
  slotLiberationFrontier?: ReactNode;
  slotValidation?: ReactNode;
  slotLabGrind?: ReactNode;
  slotParams?: ReactNode;
  slotSync?: ReactNode;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CONF_BADGE: Record<string, { label: string; cls: string }> = {
  high:   { label: 'Confiance élevée',  cls: 'bg-emerald-500/15 text-emerald-400' },
  medium: { label: 'Confiance moyenne', cls: 'bg-amber-500/15 text-amber-400' },
  low:    { label: 'Confiance faible',  cls: 'bg-red-500/15 text-red-400' },
};

const INDICATOR_CLS: Record<string, string> = {
  low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-red-400',
};
const INDICATOR_LABEL: Record<string, string> = { low: 'faible', medium: 'moyen', high: 'élevé' };

function fmtSize(um: number): string {
  return um >= 1000 ? `${formatDecimalGrouped(um / 1000, um >= 10_000 ? 0 : 1)} mm` : `${formatDecimalGrouped(um, 0)} µm`;
}

/** Une des 4 étapes : numéro, titre, valeur mise en avant, explication. */
function StepCard({ num, icon: Icon, title, value, unit, caption, children, accent = 'teal' }: {
  num: number;
  icon: typeof Target;
  title: string;
  value: string;
  unit?: string;
  caption: string;
  children?: ReactNode;
  accent?: 'teal' | 'emerald';
}) {
  const accentCls = accent === 'emerald' ? 'text-emerald-300' : 'text-teal-300';
  return (
    <div className="rounded-xl border border-mf-border bg-mf-card p-5">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center w-7 h-7 rounded-full bg-mf-panel border border-mf-border text-xs font-semibold text-mf-txt3 shrink-0">
          {num}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Icon size={14} className="text-mf-txt3" />
            <h3 className="text-sm font-semibold text-mf-txt">{title}</h3>
          </div>
          <div className="flex items-baseline gap-1.5 mb-1.5">
            <span className={`text-4xl font-bold tabular-nums ${accentCls}`}>{value}</span>
            {unit && <span className="text-base text-mf-txt3">{unit}</span>}
          </div>
          <p className="text-xs text-mf-txt3 leading-relaxed">{caption}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Bloc repliable pour l'analyse détaillée. */
function Collapsible({ title, subtitle, children, defaultOpen = false }: {
  title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-mf-border bg-mf-card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-mf-panel/40 transition-colors text-left"
      >
        <span>
          <span className="text-sm font-semibold text-mf-txt">{title}</span>
          {subtitle && <span className="block text-[11px] text-mf-txt4 mt-0.5">{subtitle}</span>}
        </span>
        <ChevronDown size={16} className={`text-mf-txt4 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-5 pb-5 space-y-4 border-t border-mf-border/60 pt-4">{children}</div>}
    </div>
  );
}

function KMini({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[9px] text-mf-txt4">{label}</span>
      <input type="number" value={value} onChange={e => onChange(+e.target.value || 0)}
        className="input-field font-mono text-[11px] py-0.5" />
    </label>
  );
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function P80OptimizationTab(props: P80OptimizationTabProps) {
  const { project } = props;

  const activeCurve = props.limsPsdCurve;
  const throughputTph = project.target_tph;

  // Facteur usine K_indus — le levier de transposition labo → usine (étape 3).
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

  const labTargetUm = Math.round(result.labTarget.valueUm);
  const plantP80Um = Math.round(result.p80OptimalPlantUm);
  const conf = CONF_BADGE[result.confidence];

  // ── Étape 1 — P80 moyen des essais ────────────────────────────────────────
  // Le P80 représentatif du module (courbe combinée pondérée) fait autorité ;
  // à défaut, le P80 de l'échantillon affiché.
  const meanP80Um = props.labP80MeanUm ?? result.p80Lims.valueUm;

  // ── Étape 4a — circuit de comminution ─────────────────────────────────────
  const circuit = useMemo(() => recommendComminutionCircuit({
    bwiKwhT: props.bwi,
    romF80Um: 600_000,
    targetP80Um: result.p80OptimalPlantUm,
    throughputTph,
  }), [props.bwi, result.p80OptimalPlantUm, throughputTph]);

  // ── Étape 4b — route métallurgique (moteur partagé avec Analytics) ────────
  const routes = useMemo(
    () => estimateRoutes({ metrics: props.routeMetrics, counts: props.routeCounts }),
    [props.routeMetrics, props.routeCounts],
  );
  const bestRoute = routes.find(r => r.recommended) ?? null;

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
        comminution_circuit: circuit.recommended?.id ?? null,
        metallurgical_route: bestRoute?.route ?? null,
      },
      comment: result.comment,
    });
    if (error) setSaveError(`Audit non enregistré (${error.message}).`);
    else { setSavedAt(new Date().toLocaleTimeString('fr-FR')); setSaveError(null); }
    setSaving(false);
  }

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

  return (
    <div className="space-y-4">
      {/* ── Bandeau de synthèse : le fil des 3 P80 d'un coup d'œil ─────────── */}
      <div className="rounded-xl border border-mf-border bg-mf-card px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-mf-txt4">P₈₀ moyen essais</div>
          <div className="text-xl font-bold text-mf-txt tabular-nums">
            {meanP80Um != null ? `${Math.round(meanP80Um)} µm` : '—'}
          </div>
        </div>
        <ArrowRight size={16} className="text-mf-txt4" />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-mf-txt4">P₈₀ optimal labo</div>
          <div className="text-xl font-bold text-teal-300 tabular-nums">{labTargetUm} µm</div>
        </div>
        <ArrowRight size={16} className="text-mf-txt4" />
        <div>
          <div className="text-[10px] uppercase tracking-wider text-mf-txt4">P₈₀ optimal usine</div>
          <div className="text-xl font-bold text-emerald-300 tabular-nums">{plantP80Um} µm</div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-mf-txt3">
            {formatDecimalGrouped(result.finalGrindEnergy.totalKwhT, 1)} kWh/t ·{' '}
            {formatDecimalGrouped(result.scenarios.selected.recoveryPct, 1)} % récup.
          </span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${conf.cls}`}>{conf.label}</span>
        </div>
      </div>

      {/* ── ÉTAPE 1 — P80 moyen des échantillons ──────────────────────────── */}
      <StepCard
        num={1} icon={Beaker}
        title="P₈₀ moyen des échantillons analysés"
        value={meanP80Um != null ? formatDecimalGrouped(meanP80Um, 0) : '—'}
        unit="µm"
        caption={
          meanP80Um == null
            ? "Aucune courbe PSD exploitable : importez des essais granulométriques pour établir la finesse de référence."
            : `Moyenne sur ${props.nSamples} essai${props.nSamples > 1 ? 's' : ''} PSD, lue par interpolation log-linéaire du 80 % passant sur la courbe combinée${props.p80WeightedByFeed ? ', pondérée par le partage d\'alimentation des domaines' : ' (domaines équipondérés — aucun partage d\'alimentation défini)'}. C'est la finesse où le minerai est broyé aujourd'hui, le point de départ de l'optimisation.`
        }
      >
        {props.labP80ControlUm != null && meanP80Um != null && Math.abs(props.labP80ControlUm - meanP80Um) > meanP80Um * 0.1 && (
          <div className="mt-2 text-[11px] text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>
              Contrôle : la moyenne des P₈₀ individuels vaut {Math.round(props.labP80ControlUm)} µm.
              Un écart de cet ordre avec le P₈₀ de la courbe combinée signale des essais hétérogènes —
              un percentile n'est pas une moyenne.
            </span>
          </div>
        )}
      </StepCard>

      {/* ── ÉTAPE 2 — P80 optimal labo ────────────────────────────────────── */}
      <StepCard
        num={2} icon={FlaskConical}
        title="P₈₀ optimal en laboratoire"
        value={formatDecimalGrouped(labTargetUm, 0)}
        unit="µm"
        caption={`${result.labTarget.justification} Plage acceptable ${Math.round(result.labTarget.rangeUm[0])} – ${Math.round(result.labTarget.rangeUm[1])} µm.`}
      >
        {meanP80Um != null && (
          <div className="mt-2 text-[11px] text-mf-txt3">
            {labTargetUm < meanP80Um
              ? `Il faut broyer PLUS FIN qu'aujourd'hui : ${Math.round(meanP80Um)} µm → ${labTargetUm} µm (−${Math.round(meanP80Um - labTargetUm)} µm).`
              : labTargetUm > meanP80Um
                ? `Le broyage actuel est plus fin que nécessaire : ${Math.round(meanP80Um)} µm → ${labTargetUm} µm (+${Math.round(labTargetUm - meanP80Um)} µm de marge).`
                : `Le broyage actuel est déjà à l'optimum labo.`}
          </div>
        )}
      </StepCard>

      {/* ── ÉTAPE 3 — P80 optimal usine ───────────────────────────────────── */}
      <StepCard
        num={3} icon={Factory}
        title="P₈₀ optimal en usine"
        value={formatDecimalGrouped(plantP80Um, 0)}
        unit="µm"
        accent="emerald"
        caption={`L'usine tourne plus grossier que le laboratoire — variabilité d'alimentation, classification imparfaite, contraintes de débit. Le facteur K porte cette correction : ${labTargetUm} µm × ${result.kIndus.k.toFixed(2)} = ${plantP80Um} µm. C'est la consigne de conception à transmettre aux Critères et au Flowsheet.`}
      >
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-[minmax(0,200px)_1fr] gap-4 items-start">
          <div className="rounded-lg border border-mf-border bg-mf-panel/40 p-3">{kControl}</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Énergie broyage', value: `${formatDecimalGrouped(result.finalGrindEnergy.totalKwhT, 1)} kWh/t` },
              { label: 'Récupération', value: `${formatDecimalGrouped(result.scenarios.selected.recoveryPct, 1)} %` },
              { label: 'Valeur nette', value: `${formatDecimalGrouped(result.scenarios.selected.netUsdT, 1)} $/t` },
            ].map(kv => (
              <div key={kv.label} className="rounded-lg border border-mf-border bg-mf-panel/40 p-2.5">
                <div className="text-[10px] text-mf-txt4 mb-0.5">{kv.label}</div>
                <div className="text-sm font-semibold text-mf-txt tabular-nums">{kv.value}</div>
              </div>
            ))}
          </div>
        </div>
      </StepCard>

      {/* ── ÉTAPE 4 — Recommandations ─────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-5">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-xs font-semibold text-emerald-300 shrink-0">
            4
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={14} className="text-emerald-400" />
              <h3 className="text-sm font-semibold text-mf-txt">Circuit de traitement recommandé</h3>
            </div>

            {/* 4a — Comminution */}
            <div className="rounded-lg border border-mf-border bg-mf-card p-4 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <Layers size={13} className="text-teal-400" />
                <span className="text-[10px] uppercase tracking-wider text-mf-txt4">Comminution — atteindre {plantP80Um} µm</span>
              </div>
              {circuit.recommended ? (
                <>
                  <div className="text-base font-semibold text-teal-300 mb-1">{circuit.recommended.label}</div>
                  <p className="text-[11px] text-mf-txt3 mb-3">{circuit.recommended.rationale}</p>
                  <table className="w-full text-xs">
                    <thead className="text-mf-txt4">
                      <tr className="border-b border-mf-border">
                        <th className="text-left font-normal py-1.5">Étage</th>
                        <th className="text-right font-normal py-1.5">Alim. F₈₀</th>
                        <th className="text-right font-normal py-1.5">Produit P₈₀</th>
                        <th className="text-right font-normal py-1.5">Énergie</th>
                      </tr>
                    </thead>
                    <tbody>
                      {circuit.recommended.stages.map(st => (
                        <tr key={st.label} className="border-b border-mf-border/50">
                          <td className="py-1.5 text-mf-txt2">{st.label}</td>
                          <td className="py-1.5 text-right tabular-nums text-mf-txt3">{fmtSize(st.f80Um)}</td>
                          <td className="py-1.5 text-right tabular-nums text-mf-txt3">{fmtSize(st.p80Um)}</td>
                          <td className="py-1.5 text-right tabular-nums text-mf-txt2">{formatDecimalGrouped(st.specificEnergyKwhT, 2)} kWh/t</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="py-1.5 text-mf-txt" colSpan={3}>Total comminution</td>
                        <td className="py-1.5 text-right tabular-nums text-teal-300">
                          {formatDecimalGrouped(circuit.recommended.totalEnergyKwhT, 2)} kWh/t
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mf-txt4">
                    {circuit.recommended.powerRequiredKw != null && (
                      <span>Puissance requise ≈ <strong className="text-mf-txt3">{formatDecimalGrouped(circuit.recommended.powerRequiredKw, 0)} kW</strong> à {throughputTph} t/h</span>
                    )}
                    <span>CAPEX <strong className={INDICATOR_CLS[circuit.recommended.capex]}>{INDICATOR_LABEL[circuit.recommended.capex]}</strong></span>
                    <span>OPEX <strong className={INDICATOR_CLS[circuit.recommended.opex]}>{INDICATOR_LABEL[circuit.recommended.opex]}</strong></span>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-amber-400">{circuit.summary}</p>
              )}
            </div>

            {/* 4b — Route métallurgique */}
            <div className="rounded-lg border border-mf-border bg-mf-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Beaker size={13} className="text-teal-400" />
                <span className="text-[10px] uppercase tracking-wider text-mf-txt4">Route métallurgique — extraire l'or</span>
              </div>
              {bestRoute ? (
                <>
                  <div className="flex items-baseline gap-3 mb-1">
                    <span className="text-base font-semibold text-teal-300">{bestRoute.route}</span>
                    <span className="text-sm text-mf-txt2 tabular-nums">{formatDecimalGrouped(bestRoute.recovery_pct, 1)} % récup.</span>
                  </div>
                  <p className="text-[11px] text-mf-txt3 mb-2">{bestRoute.basis}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-mf-txt4">
                    <span>CAPEX <strong className={INDICATOR_CLS[bestRoute.capex_indicator]}>{INDICATOR_LABEL[bestRoute.capex_indicator]}</strong></span>
                    <span>OPEX <strong className={INDICATOR_CLS[bestRoute.opex_indicator]}>{INDICATOR_LABEL[bestRoute.opex_indicator]}</strong></span>
                    <span>Qualité des données <strong className="text-mf-txt3">{bestRoute.dataQualityScore}/100</strong></span>
                  </div>
                  {routes.length > 1 && (
                    <div className="mt-3 pt-2 border-t border-mf-border/60">
                      <div className="text-[10px] text-mf-txt4 mb-1">Alternatives évaluées</div>
                      {routes.filter(r => !r.recommended).map(r => (
                        <div key={r.route} className="flex justify-between text-[11px] py-0.5">
                          <span className="text-mf-txt3">{r.route}</span>
                          <span className="text-mf-txt4 tabular-nums">{formatDecimalGrouped(r.recovery_pct, 1)} %</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-[10px] text-mf-txt4">
                    Même moteur que la page <strong className="text-mf-txt3">Analyse et Interprétation</strong> — les deux écrans ne peuvent pas diverger.
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-amber-400">
                  Aucune route ne peut être estimée : il manque les essais de lixiviation
                  (et, selon les routes, de gravimétrie Knelson ou de flottation). Importez-les
                  dans LIMS pour obtenir une recommandation.
                </p>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <button className="btn btn-primary btn-sm" onClick={simulateAndSave} disabled={saving}>
                <Play size={13} /> {saving ? 'Enregistrement…' : 'Figer ce résultat dans l\'audit'}
              </button>
              {savedAt && <span className="text-[11px] text-emerald-400 flex items-center gap-1"><CheckCircle2 size={12} /> Enregistré à {savedAt}</span>}
              {saveError && <span className="text-[11px] text-amber-400">{saveError}</span>}
            </div>
          </div>
        </div>
      </div>

      {props.slotSync}

      {/* ── Détails avancés ───────────────────────────────────────────────── */}
      <Collapsible
        title="Détails avancés"
        subtitle="Justification des chiffres ci-dessus : confiance sur la mesure, frontière de libération, arbitrage économique, réglages de broyage labo, paramètres du moteur."
      >
        {props.slotConfidence}
        {props.slotValidation}
        {props.slotLiberationFrontier}

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

        {props.slotLabGrind}

        {/* Arbitrage économique — les 3 stratégies et celle retenue. */}
        <div className="rounded-xl border border-mf-border bg-mf-panel/40 p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-teal-400" />
            <div className="text-sm font-semibold text-mf-txt">Arbitrage économique récupération vs énergie</div>
          </div>
          <div className="text-[10px] text-mf-txt4 mb-3">
            Trois stratégies concurrentes ; le P₈₀ usine retenu est celui de la stratégie gagnante.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {result.scenarios.scenarios.map(s => (
              <div key={s.id} className={`rounded-lg border p-3 ${
                s.id === result.scenarios.selected.id ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-mf-border bg-mf-card'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-mf-txt">{s.label}</span>
                  {s.id === result.scenarios.selected.id && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Retenu</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div><span className="text-mf-txt4">P₈₀ </span><strong className="text-mf-txt2 tabular-nums">{Math.round(s.p80Um)} µm</strong></div>
                  <div><span className="text-mf-txt4">Énergie </span><strong className="text-amber-400 tabular-nums">{formatDecimalGrouped(s.energyKwhT, 1)}</strong></div>
                  <div><span className="text-mf-txt4">Récup. </span><strong className="text-mf-txt2 tabular-nums">{formatDecimalGrouped(s.recoveryPct, 1)} %</strong></div>
                  <div><span className="text-mf-txt4">Net </span><strong className="text-emerald-400 tabular-nums">{formatDecimalGrouped(s.netUsdT, 1)} $/t</strong></div>
                </div>
                <p className="mt-2 text-[10px] text-mf-txt4 leading-snug">{s.note}</p>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-mf-txt3 flex items-center gap-1.5">
            <CheckCircle2 size={12} className="text-emerald-400" />
            {result.scenarios.selectionReason}
          </div>
        </div>

        {/* Configurations de circuit écartées — la traçabilité du choix 4a. */}
        {circuit.options.length > 1 && (
          <div className="rounded-xl border border-mf-border bg-mf-panel/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <SlidersHorizontal size={14} className="text-teal-400" />
              <div className="text-sm font-semibold text-mf-txt">Configurations de circuit évaluées</div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-mf-txt4">
                <tr className="border-b border-mf-border">
                  <th className="text-left font-normal py-1.5">Configuration</th>
                  <th className="text-right font-normal py-1.5">Énergie</th>
                  <th className="text-center font-normal py-1.5">Retenue</th>
                  <th className="text-left font-normal py-1.5 pl-3">Motif</th>
                </tr>
              </thead>
              <tbody>
                {circuit.options.map(o => (
                  <tr key={o.id} className="border-b border-mf-border/50 align-top">
                    <td className="py-1.5 text-mf-txt2">{o.label}</td>
                    <td className="py-1.5 text-right tabular-nums text-mf-txt3">{formatDecimalGrouped(o.totalEnergyKwhT, 2)}</td>
                    <td className="py-1.5 text-center">
                      {o.id === circuit.recommended?.id
                        ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Oui</span>
                        : <span className="text-mf-txt4">—</span>}
                    </td>
                    <td className="py-1.5 pl-3 text-[10px] text-mf-txt4 leading-snug">{o.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {props.slotParams}
      </Collapsible>
    </div>
  );
}
