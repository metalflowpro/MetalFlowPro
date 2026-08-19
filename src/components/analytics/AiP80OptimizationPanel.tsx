import { useMemo, useState } from 'react';
import { Target, Factory, FlaskConical, ArrowRight } from 'lucide-react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { AI_GOVERNANCE, P80_STUDY_DEFAULTS, DEFAULT_ASSUMPTIONS } from '../../lib/config/constants';
import { scoreLabP80, type P80Candidate } from '../../lib/p80study/labScore';
import { optimisePlantP80, type PlantP80Inputs } from '../../lib/p80study/plantP80';
import { finesPenaltyAtP80 } from '../granulometry/study/studyCompute';
import type { TrainingSample } from '../../lib/analytics/recoveryModel';

interface Props {
  /** Échantillons d'entraînement (portent p80 + recovery + bwi + auFree). */
  samples: TrainingSample[];
  gradeGt: number;
  goldPriceUsdOz: number;
  recoveryCeilingPct: number;
}

type Tab = 'lab' | 'plant' | 'tests';

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

interface LabRow {
  p80: number; recovery: number; uncertainty: number; n: number;
  status: 'confirmé' | 'à confirmer' | 'insuffisant';
}

/**
 * Panneau « Optimisation P80 » de la Prédiction IA (spec §6). RÉUTILISE les
 * moteurs du module Étude P80 (labScore, plantP80) : rien n'est recalculé
 * différemment ici. Trois onglets : candidats labo, scénarios usine, essais
 * recommandés. Renvoie vers le module Granulométrie / Étude P80 pour le
 * workflow gouverné (sélection d'échantillons, plan d'essais, approbation).
 */
export function AiP80OptimizationPanel({ samples, gradeGt, goldPriceUsdOz, recoveryCeilingPct }: Props) {
  const [tab, setTab] = useState<Tab>('lab');

  // Regroupe les essais par niveau de P80 mesuré (arrondi au µm).
  const byLevel = useMemo(() => {
    const m = new Map<number, TrainingSample[]>();
    for (const s of samples) {
      if (!(s.p80 > 0)) continue;
      const lvl = Math.round(s.p80);
      const bucket = m.get(lvl) ?? [];
      bucket.push(s); m.set(lvl, bucket);
    }
    return m;
  }, [samples]);

  const labRows: LabRow[] = useMemo(() => {
    const rows: LabRow[] = [];
    for (const [p80, rs] of byLevel) {
      const recs = rs.map(r => r.recovery);
      const n = rs.length;
      const status: LabRow['status'] =
        n >= AI_GOVERNANCE.MIN_REPLICATES_PER_LEVEL ? 'confirmé'
        : n >= 1 ? 'à confirmer' : 'insuffisant';
      rows.push({ p80, recovery: mean(recs), uncertainty: std(recs), n, status });
    }
    return rows.sort((a, b) => b.p80 - a.p80);
  }, [byLevel]);

  // Score labo multi-critères sur les candidats (réutilise le moteur labScore).
  const labScore = useMemo(() => {
    const candidates: P80Candidate[] = labRows.map(r => ({
      p80Um: r.p80, recoveryPct: r.recovery,
      reagent: 0, energyKwhT: 0, finesPenalty: finesPenaltyAtP80(r.p80),
    }));
    return scoreLabP80(candidates);
  }, [labRows]);

  // Scénarios usine (réutilise plantP80). Entrées agrégées depuis les essais.
  const plant = useMemo(() => {
    const bwi = mean(samples.map(s => s.bwi).filter(v => v > 0)) || DEFAULT_ASSUMPTIONS.DEFAULT_BOND_BALL_WI_KWH_T;
    const auFree = mean(samples.map(s => s.auFree).filter(v => v > 0)) || null;
    const inputs: PlantP80Inputs = {
      bwi, f80Um: 10000, millPowerKw: 5000, gradeGt, goldPriceUsdOz,
      treatmentCostUsdT: 12, recoveryCeilingPct, auFreePct: auFree,
    };
    const ladder = labRows.map(r => r.p80);
    return optimisePlantP80(ladder.length ? ladder : P80_STUDY_DEFAULTS.TARGETS_UM, inputs, 'net_value_per_day');
  }, [samples, labRows, gradeGt, goldPriceUsdOz, recoveryCeilingPct]);

  // Essais recommandés (fonction B : DOE). Repère les niveaux P80 manquants ou
  // sous-répliqués vs la gouvernance, priorisés du plus informatif au moins.
  const recommendedTests = useMemo(() => {
    const targets = P80_STUDY_DEFAULTS.TARGETS_UM;
    const tol = AI_GOVERNANCE.MAX_P80_DEVIATION_FRACTION;
    const out: Array<{ priority: number; label: string }> = [];
    let priority = 1;
    for (const t of targets) {
      const near = labRows.find(r => Math.abs(r.p80 - t) / t <= tol);
      if (!near) {
        out.push({ priority: priority++, label: `Essai à P80 ${t} µm — niveau absent (désambiguïse l'effet du P80)` });
      } else if (near.n < AI_GOVERNANCE.MIN_REPLICATES_PER_LEVEL) {
        out.push({ priority: priority++, label: `Répétition à P80 ${t} µm — ${near.n}/${AI_GOVERNANCE.MIN_REPLICATES_PER_LEVEL} réplicat(s)` });
      }
    }
    const levels = labRows.length;
    if (levels < AI_GOVERNANCE.MIN_P80_LEVELS) {
      out.push({ priority: priority++, label: `Locked-cycle test au P80 candidat prioritaire (${levels}/${AI_GOVERNANCE.MIN_P80_LEVELS} niveaux couverts)` });
    }
    return out;
  }, [labRows]);

  const statusColor = (s: LabRow['status']) =>
    s === 'confirmé' ? 'text-emerald-400' : s === 'à confirmer' ? 'text-amber-400' : 'text-red-400';

  const TABS: Array<{ id: Tab; label: string; icon: typeof Target }> = [
    { id: 'lab', label: 'Laboratoire', icon: FlaskConical },
    { id: 'plant', label: 'Usine', icon: Factory },
    { id: 'tests', label: 'Essais recommandés', icon: Target },
  ];

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-teal-400" />
          <span className="section-title">Optimisation du P80</span>
        </div>
        <span className="text-[11px] text-mf-txt4 flex items-center gap-1">
          Workflow gouverné → module Granulométrie / Étude P80 <ArrowRight size={11} />
        </span>
      </div>

      <div className="flex gap-1 border-b border-mf-border mb-4">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 ${tab === t.id ? 'border-teal-400 text-teal-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'lab' && (
        labRows.length === 0 ? <Empty text="Aucun essai avec P80 mesuré." /> : (
          <table className="tbl">
            <thead><tr><th className="text-right">P80 (µm)</th><th className="text-right">Récupération</th><th className="text-right">Incertitude</th><th className="text-right">n essais</th><th>Statut</th></tr></thead>
            <tbody>
              {labRows.map(r => (
                <tr key={r.p80} className={labScore.best?.p80Um === r.p80 ? 'bg-teal-500/10' : ''}>
                  <td className="num text-xs font-bold">{r.p80}</td>
                  <td className="num text-xs">{r.recovery.toFixed(1)} %</td>
                  <td className="num text-xs text-mf-txt4">± {r.uncertainty.toFixed(1)} pt</td>
                  <td className="num text-xs">{r.n}</td>
                  <td className={`text-xs ${statusColor(r.status)}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}

      {tab === 'plant' && (
        plant.points.length === 0 ? <Empty text="Aucun P80 candidat pour le calcul usine." /> : (
          <>
            <table className="tbl">
              <thead><tr><th className="text-right">P80 cible (µm)</th><th className="text-right">Débit (t/h)</th><th className="text-right">Récup.</th><th className="text-right">Or/jour (oz)</th><th className="text-right">Valeur nette ($/j)</th></tr></thead>
              <tbody>
                {plant.points.map(p => (
                  <tr key={p.p80Um} className={plant.optimal?.p80Um === p.p80Um ? 'bg-sky-500/10' : ''}>
                    <td className="num text-xs font-bold">{Math.round(p.p80Um)}</td>
                    <td className="num text-xs">{formatDecimalGrouped(p.throughputTph, 1)}</td>
                    <td className="num text-xs">{p.recoveryPct.toFixed(1)} %</td>
                    <td className="num text-xs">{formatDecimalGrouped(p.ozPerDay, 1)}</td>
                    <td className="num text-xs font-mono text-emerald-400">{formatDecimalGrouped(p.netValueUsdDay, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-mf-txt4 mt-2">
              Entrées usine agrégées (F80 10 mm, puissance 5 MW, coût 12 $/t par défaut) — ajustables dans le module Étude P80.
              Un broyage plus fin monte la récupération mais peut réduire le débit et donc l'or/jour.
            </div>
          </>
        )
      )}

      {tab === 'tests' && (
        recommendedTests.length === 0
          ? <div className="text-xs text-emerald-400">Couverture P80 suffisante vs la gouvernance — aucun essai prioritaire manquant.</div>
          : (
            <div className="space-y-2">
              {recommendedTests.map(t => (
                <div key={t.priority} className="flex items-center gap-3 text-xs">
                  <span className="w-6 h-6 rounded-full bg-teal-500/15 text-teal-300 flex items-center justify-center font-bold shrink-0">{t.priority}</span>
                  <span className="text-mf-txt2">{t.label}</span>
                </div>
              ))}
              <div className="text-[10px] text-mf-txt4 mt-2">
                Ces essais maximisent l'information sur l'effet du P80 : ils désambiguïsent sa colinéarité avec le GRG et l'or libre.
              </div>
            </div>
          )
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-xs text-mf-txt4 py-4">{text}</div>;
}
