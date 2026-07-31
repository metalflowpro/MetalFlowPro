// ─────────────────────────────────────────────────────────────────────────────
// Section « P80 Optimisation » — Granulométrie/PSD.
//
// Pipeline affiché : P80 LIMS (PSD) → P80 cible labo → P80 optimal usine
// (×K_indus) → énergie Bond par circuit → 3 scénarios (Bond Energy /
// Recovery-driven / Curve-driven) → recommandation par circuit + export.
// Tout le calcul vit dans lib/geomet/p80Optimization (pur, testé) ; ce
// composant ne fait que saisir, afficher et persister l'audit.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useMemo, type ReactNode } from 'react';
import { Target, Zap, TrendingUp, Factory, Play, CheckCircle2 } from 'lucide-react';
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
  // placés ici pour qu'ils tombent dans la bonne sous-page, au lieu d'allonger
  // la section au-dessus et au-dessous du composant.
  /** Paramètres du moteur (P80 cible, F80, BWi, facteur usine, élec.). */
  slotParams?: ReactNode;
  /** Validation du P80 recalculé depuis les courbes PSD mesurées. */
  slotValidation?: ReactNode;
  /** Modèle de broyage labo → P80 produit et conseils de réglage. */
  slotLabGrind?: ReactNode;
  /** Bandeau de synchronisation vers Critères & Mine Opt. */
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

// ─── Sous-pages ──────────────────────────────────────────────────────────────
//
// La section couvrait tout le pipeline sur une seule page très longue. Elle est
// découpée selon le déroulé de travail de l'ingénieur : renseigner les entrées,
// comparer les scénarios, lire la recommandation par circuit, produire le
// rapport. Le bandeau de synthèse reste au-dessus des sous-pages.

type SubTab = 'scenarios' | 'circuits';

const SUB_TABS: Array<{ id: SubTab; label: string; icon: typeof Target }> = [
  { id: 'scenarios', label: 'Scénarios & courbes', icon: TrendingUp },
  { id: 'circuits',  label: 'Recommandations',     icon: Factory },
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

  const [subTab, setSubTab] = useState<SubTab>('scenarios');

  // Cette section tourne sur les valeurs projet auto-synchronisées et des
  // défauts documentés : la source PSD est l'échantillon LIMS sélectionné, et
  // K_indus / débit / puissance prennent leurs valeurs par défaut. Le réglage
  // manuel de ces paramètres vivait dans l'ancien onglet « Données & paramètres ».
  const activeCurve = props.limsPsdCurve;
  const throughputTph = project.target_tph;

  // Facteur usine K_indus — le seul levier conservé, sur le héros. Les autres
  // réglages (débit, PSD, F80…) restent sur les valeurs projet auto-synchronisées.
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
  // ── Rendu ──────────────────────────────────────────────────────────────────
  const scenMarkers = result.scenarios.scenarios.map(s => ({
    p80: s.p80Um, color: SCENARIO_COLORS[s.id],
    label: s.id === 'bond_energy' ? 'Bond' : s.id === 'recovery_driven' ? 'Récup.' : 'Courbe',
  }));

  return (
    <div className="space-y-4">
      {/* ── Planche « Granular Silence » : la décision + la granulométrie ────
          Remplace les quatre cartes-KPI. Toujours visible : c'est le résultat
          du pipeline, montré plutôt qu'énuméré. */}
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
        kIndusControl={
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
        }
      />

      {/* ── Barre de sous-pages ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-mf-border overflow-x-auto">
        {SUB_TABS.map(s => (
          <button
            key={s.id}
            onClick={() => setSubTab(s.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
              subTab === s.id
                ? 'border-teal-400 text-teal-400'
                : 'border-transparent text-mf-txt3 hover:text-mf-txt'
            }`}
          >
            <s.icon size={13} /> {s.label}
            {s.id === 'circuits' && (
              <span className="ml-1 px-1.5 py-0.5 text-[9px] rounded-full bg-mf-panel text-mf-txt4">
                {result.circuits.length}
              </span>
            )}
          </button>
        ))}
      </div>


      {/* ══ SOUS-PAGE : Scénarios ═════════════════════════════════════════ */}
      {subTab === 'scenarios' && (
      <div className="space-y-4">
      {/* ── 3. Scénarios ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-mf-border bg-mf-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-mf-txt">Comparaison des scénarios d'optimisation</div>
          <button className="btn btn-primary btn-sm" onClick={simulateAndSave} disabled={saving}>
            <Play size={13} /> {saving ? 'Simulation…' : 'Simuler les scénarios'}
          </button>
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

      {/* ── 4. Graphes récupération & énergie vs P80 ──────────────────────── */}
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

      </div>
      )}

      {/* ══ SOUS-PAGE : Recommandations par circuit ═══════════════════════ */}
      {subTab === 'circuits' && (
      <div className="space-y-4">
      {/* ── 5. Recommandations par circuit ────────────────────────────────── */}
      {/* (le modèle de broyage labo est rendu après le tableau, plus bas) */}
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

      {/* Comment atteindre ces cibles : modèle de broyage labo + conseils. */}
      {props.slotLabGrind}
      </div>
      )}

    </div>
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
