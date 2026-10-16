import { useState, useEffect, useMemo, useRef } from 'react';
import { formatDecimalGrouped } from '../../lib/format/number';
import { Target, Cpu, Sparkles, Brain,
} from 'lucide-react';
import type { CyanideModel, LeachKineticsParams } from '../../lib/config/metConstants';
import {
  trainRecoveryModel, predictRecovery, predictWithCI, modelQuality,
  type TrainingSample, type PredictionInput,
} from '../../lib/analytics/recoveryModel';
import { crossValidateRecovery, recommendGrind, aiDecisionGate, p80EffectState } from '../../lib/analytics/recoveryValidation';
import { AI_GOVERNANCE } from '../../lib/config/constants';
import { AiP80OptimizationPanel } from '../../components/analytics/AiP80OptimizationPanel';
import { MechanisticRecoveryPanel } from '../../components/analytics/MechanisticRecoveryPanel';
import { LeachCyanidePanel } from '../../components/analytics/LeachCyanidePanel';
import { MultistageAdsorptionPanel } from '../../components/analytics/MultistageAdsorptionPanel';
import type { Project } from '../../types';
import { LimsData, robustMean } from './model';

// ─────────────────────────────────────────────────────────────────────────────
// AI Recovery Prediction Tab — multivariate regression model from LIMS data
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paramètres minerai d'entrée du modèle, avec leurs BORNES D'AFFICHAGE (curseurs).
 * Ce sont des bornes UI définies une seule fois — pas des valeurs d'ore : le défaut
 * de chaque curseur vient des moyennes réelles du projet (voir featureMeans).
 */
const PREDICTION_FIELDS: ReadonlyArray<{ key: keyof PredictionInput; label: string; min: number; max: number; step: number }> = [
  { key: 'auGrade',  label: 'Teneur Au (g/t)', min: 0.1, max: 20,  step: 0.1  },
  { key: 'sSulfide', label: 'S sulfure (%)',   min: 0,   max: 10,  step: 0.1  },
  { key: 'cOrganic', label: 'C organique (%)', min: 0,   max: 5,   step: 0.05 },
  { key: 'bwi',      label: 'BWi (kWh/t)',     min: 5,   max: 30,  step: 0.5  },
  { key: 'grg',      label: 'GRG (%)',         min: 0,   max: 80,  step: 1    },
  { key: 'p80',      label: 'P80 (µm)',        min: 25,  max: 200, step: 1    },
  { key: 'auFree',   label: 'Au libre (%)',    min: 0,   max: 100, step: 1    },
];

export function PredictionTab({ data, project, recoveryCeilingPct, cyanideModel, leachKinetics }: { data: LimsData; project: Project; recoveryCeilingPct: number; cyanideModel?: CyanideModel; leachKinetics?: LeachKineticsParams }) {
  // Moyennes RÉELLES du projet par paramètre minerai — aucune valeur d'ore en dur.
  // Servent (a) de défaut aux curseurs (on simule à partir du minerai moyen réel,
  // pas d'un minerai fictif) et (b) de repli d'imputation quand un essai manque sur
  // un échantillon (mean-imputation standard, au lieu d'injecter un nombre magique
  // qui biaiserait la régression). Repli ultime si un paramètre n'a AUCUN essai :
  // le milieu de la plage d'affichage (borne UI, pas une teneur inventée).
  const featureMeans = useMemo<PredictionInput>(() => {
    const raw: Record<keyof PredictionInput, number | null> = {
      auGrade:  robustMean(data.chem.map(c => c.au_g_t)),
      sSulfide: robustMean(data.chem.map(c => c.s_sulfide_pct)),
      cOrganic: robustMean(data.chem.map(c => c.c_organic_pct)),
      bwi:      robustMean(data.comminution.map(c => c.bwi_kwh_t)),
      grg:      robustMean(data.knelson.map(k => k.grg_recovery_pct)),
      p80:      robustMean(data.knelson.map(k => k.p80_feed_um)),
      auFree:   robustMean(data.mineralogy.map(m => m.au_free_pct)),
    };
    const out = {} as PredictionInput;
    for (const f of PREDICTION_FIELDS) {
      const m = raw[f.key];
      const v = m == null ? (f.min + f.max) / 2 : m;
      out[f.key] = Math.min(f.max, Math.max(f.min, v));
    }
    return out;
  }, [data]);

  // Le curseur part du minerai moyen réel et suit les données tant que
  // l'utilisateur n'a pas ajusté un paramètre ; ensuite on respecte son scénario.
  const [predInput, setPredInput] = useState<PredictionInput | null>(null);
  const [showTests, setShowTests] = useState(false);
  // Sous-onglets : la Prédiction IA était une pile trop longue — on la découpe en
  // Prévision (le chiffre + le simulateur), Fiabilité (gouvernance/validation) et
  // Optimisation P80. La carte de prédiction porte déjà le statut du gate, donc
  // « Prévision » reste un atterrissage honnête même par défaut.
  const [subTab, setSubTab] = useState<'prevision' | 'fiabilite' | 'optim'>('prevision');
  const touchedRef = useRef(false);
  useEffect(() => { if (!touchedRef.current) setPredInput(featureMeans); }, [featureMeans]);
  const input = predInput ?? featureMeans;
  const setField = (key: keyof PredictionInput, value: number) => {
    touchedRef.current = true;
    setPredInput(prev => ({ ...(prev ?? featureMeans), [key]: value }));
  };

  const built = useMemo(() => {
    const leachMap = new Map<string, number>();
    for (const l of data.leaching ?? []) {
      const key = String(l.sample_id ?? '');
      // 48 h = récupération de conception (référence de l'app) ; 24 h en repli.
      const rec = l.leach_rec_48h_pct ?? l.leach_rec_24h_pct ?? 0;
      if (rec > 0) leachMap.set(key, rec);
    }

    const result: TrainingSample[] = [];
    // Groupe géométallurgique de chaque essai (domaine, sinon l'échantillon lui-même).
    // Sert à une validation croisée PAR GROUPE : les répétitions d'un même
    // échantillon ne fuitent pas entre entraînement et validation.
    const groups: string[] = [];
    for (const s of data.samples ?? []) {
      const key = String(s.id);
      const recovery = leachMap.get(key);
      if (recovery == null || recovery <= 0) continue;

      const chem = (data.chem ?? []).find(c => String(c.sample_id) === key);
      const comm = (data.comminution ?? []).find(c => String(c.sample_id) === key);
      const knel = (data.knelson ?? []).find(k => String(k.sample_id) === key);
      const min = (data.mineralogy ?? []).find(m => String(m.sample_id) === key);

      // Imputation par la moyenne du projet (pas de constante en dur).
      result.push({
        auGrade:  chem?.au_g_t         ?? featureMeans.auGrade,
        sSulfide: chem?.s_sulfide_pct  ?? featureMeans.sSulfide,
        cOrganic: chem?.c_organic_pct  ?? featureMeans.cOrganic,
        bwi:      comm?.bwi_kwh_t       ?? featureMeans.bwi,
        grg:      knel?.grg_recovery_pct ?? featureMeans.grg,
        p80:      knel?.p80_feed_um     ?? featureMeans.p80,
        auFree:   min?.au_free_pct      ?? featureMeans.auFree,
        recovery,
      });
      groups.push(s.domain ?? key);
    }
    return { samples: result, groups };
  }, [data, featureMeans]);
  const samples = built.samples;
  const sampleGroups = built.groups;
  // Niveaux de P80 distincts couverts par les essais (pour l'identifiabilité).
  const p80LevelCount = useMemo(
    () => new Set(samples.filter(s => s.p80 > 0).map(s => Math.round(s.p80))).size,
    [samples],
  );

  const model = useMemo(() => trainRecoveryModel(samples), [samples]);
  const prediction = useMemo(() => {
    if (!model) return null;
    return predictWithCI(model, input);
  }, [model, input]);
  // Validation croisée PAR GROUPE (domaine géométallurgique) : la vraie capacité
  // prédictive, sans fuite des répétitions d'un même échantillon.
  const cv = useMemo(() => crossValidateRecovery(samples, 5, { groups: sampleGroups }), [samples, sampleGroups]);
  // Gate de gouvernance : autorise ou non une recommandation automatique.
  const decision = useMemo(() => aiDecisionGate(cv, samples.length), [cv, samples.length]);
  // Diagnostic d'identifiabilité de l'effet du P80 (3 états).
  const p80Effect = useMemo(() => (model ? p80EffectState(model, cv, p80LevelCount) : null), [model, cv, p80LevelCount]);
  // Recommandation d'exploitation sur le levier réglable (P80 de broyage).
  // Le scan est borné au domaine des P80 réellement observés : extrapoler le
  // modèle linéaire hors des essais donnait des recommandations aberrantes
  // (« broyer plus grossier vers 270 µm → 100 % »).
  const grindReco = useMemo(() => {
    if (!model) return null;
    const p80Obs = samples.map(s => s.p80).filter(v => v > 0);
    return recommendGrind(model, input, {
      cv,
      p80Min: p80Obs.length ? Math.min(...p80Obs) : undefined,
      p80Max: p80Obs.length ? Math.max(...p80Obs) : undefined,
    });
  }, [model, input, cv, samples]);

  // ── Bilan mécaniste (innovation) : indépendant de l'OLS, il fonctionne avec un
  //    seul essai de libération. Rendu même quand le modèle statistique manque de
  //    données — c'est justement là qu'il apporte le plus. ──────────────────────
  const lib = data.liberation ?? [];
  const mechanisticPanel = (
    <MechanisticRecoveryPanel
      deportment={{
        free: robustMean(lib.map(r => r.au_free_pct)),
        sulphide: robustMean(lib.map(r => r.au_sulphides_pct)),
        silicate: robustMean(lib.map(r => r.au_silicates_pct)),
        occluded: robustMean(lib.map(r => r.au_occluded_pct)),
        pregRob: robustMean(lib.map(r => r.au_preg_rob_pct)),
      }}
      p80RefUm={robustMean(lib.map(r => r.p80_um))}
      grgPct={robustMean(data.knelson.map(k => k.grg_recovery_pct))}
      cOrgPct={robustMean(data.chem.map(c => c.c_organic_pct))}
      measuredRecoveryPct={robustMean(data.leaching.map(l => l.leach_rec_24h_pct ?? l.leach_rec_48h_pct))}
      leach24hPct={robustMean(data.leaching.map(l => l.leach_rec_24h_pct))}
      leach48hPct={robustMean(data.leaching.map(l => l.leach_rec_48h_pct))}
    />
  );

  // Cinétique de lixiviation (points représentatifs 2→48 h) + consommation NaCN.
  const leachPoints = ([
    [2, 'leach_rec_2h_pct'], [4, 'leach_rec_4h_pct'], [8, 'leach_rec_8h_pct'],
    [12, 'leach_rec_12h_pct'], [24, 'leach_rec_24h_pct'], [48, 'leach_rec_48h_pct'],
  ] as const)
    .map(([h, key]) => ({ hours: h as number, recoveryPct: robustMean(data.leaching.map(l => l[key])) }))
    .filter((p): p is { hours: number; recoveryPct: number } => p.recoveryPct != null && p.recoveryPct > 0);
  const leachCyanidePanel = (
    <LeachCyanidePanel
      leachPoints={leachPoints}
      cuPct={robustMean(data.chem.map(c => c.cu_pct))}
      sSulfidePct={robustMean(data.chem.map(c => c.s_sulfide_pct))}
      measuredNaCnKgT={robustMean(data.leaching.map(l => l.nacn_consumption_kg_t))}
      cyanideModel={cyanideModel}
      leachKinetics={leachKinetics}
    />
  );

  if (samples.length < 3) {
    return (
      <div className="space-y-4">
        {mechanisticPanel}
        {leachCyanidePanel}
        <MultistageAdsorptionPanel />
        <div className="card flex flex-col items-center gap-3 py-12">
          <Brain size={32} className="text-mf-border" />
          <div className="text-center max-w-md">
            <div className="text-sm font-semibold text-mf-txt mb-1">Modèle statistique (OLS) : données insuffisantes</div>
            <div className="text-xs text-mf-txt4">
              La régression IA nécessite au moins 3 échantillons LIMS avec lixiviation complète.
              Actuellement: {samples.length} échantillon{samples.length !== 1 ? 's' : ''} disponible{samples.length !== 1 ? 's' : ''}.
              Le bilan mécaniste ci-dessus reste exploitable dès un essai de libération.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const SUBTABS = [
    { id: 'prevision' as const, label: 'Prévision', icon: Brain },
    { id: 'fiabilite' as const, label: 'Fiabilité & validation', icon: Cpu },
    { id: 'optim' as const,     label: 'Optimisation P80', icon: Target },
  ];

  return (
    <div className="space-y-4">
      {/* Sous-onglets — découpe la Prédiction IA en pages courtes */}
      <div className="flex gap-1 border-b border-mf-border">
        {SUBTABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${subTab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-mf-txt3 hover:text-mf-txt'}`}>
            <t.icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {subTab === 'fiabilite' && (<>
      {/* Gate de décision IA (gouvernance) — sépare la PRÉDICTION de la DÉCISION. */}
      <div className={`card border-2 ${
        decision.status === 'autorisée' ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
        : decision.status === 'exploratoire' ? 'border-amber-500/40 bg-amber-500/[0.04]'
        : 'border-red-500/40 bg-red-500/[0.04]'
      }`}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-sm font-bold ${
            decision.status === 'autorisée' ? 'text-emerald-400'
            : decision.status === 'exploratoire' ? 'text-amber-400' : 'text-red-400'
          }`}>
            Décision IA : {decision.authorized ? 'recommandation autorisée' : `non autorisée (${decision.status})`}
          </span>
          <span className="text-[10px] text-mf-txt4">seuils : n≥{AI_GOVERNANCE.MIN_SAMPLES} · R²val≥{Math.round(AI_GOVERNANCE.MIN_VALIDATION_R2 * 100)}% · écart≤{Math.round(AI_GOVERNANCE.MAX_OVERFIT_GAP * 100)}pt</span>
        </div>
        {decision.reasons.map((r, i) => <div key={i} className="text-xs text-mf-txt3">• {r}</div>)}
        {decision.actions.length > 0 && (
          <div className="mt-1.5 text-xs text-mf-txt2"><strong>Action proposée :</strong> {decision.actions.join(' ')}</div>
        )}
      </div>

      {/* Model quality banner */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-amber-400" />
            <span className="section-title">Modèle de Prédiction IA — Récupération Or</span>
          </div>
          <span className={`badge ${model!.rSquared >= 0.7 ? 'badge-green' : model!.rSquared >= 0.5 ? 'badge-gold' : 'badge-orange'}`}>
            {modelQuality(model!)}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-3">
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.sampleCount}</div>
            <div className="text-[10px] text-mf-txt4">Échantillons</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-amber-400">{(model!.rSquared * 100).toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">R²</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.rmse.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">RMSE</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.mae.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">MAE</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold font-mono text-mf-txt">{model!.meanRecovery.toFixed(1)}%</div>
            <div className="text-[10px] text-mf-txt4">Récup. moy.</div>
          </div>
        </div>
      </div>

      {/* Validation croisée — la vraie capacité prédictive (hors échantillon) */}
      {cv && (
        <div className={`card border ${
          cv.verdict === 'robuste' ? 'border-emerald-500/30'
          : cv.verdict === 'acceptable' ? 'border-amber-500/30'
          : cv.verdict === 'insuffisant' ? 'border-mf-border'
          : 'border-red-500/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-teal-400" />
              <span className="section-title">Validation croisée (hors échantillon)</span>
            </div>
            <span className={`badge ${
              cv.verdict === 'robuste' ? 'badge-green'
              : cv.verdict === 'acceptable' ? 'badge-gold'
              : cv.verdict === 'insuffisant' ? 'badge-gray'
              : 'badge-orange'
            }`}>{cv.verdict}</span>
          </div>
          {!Number.isNaN(cv.cvRSquared) ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-teal-400">{(cv.cvRSquared * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">R² hors échantillon</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-mf-txt">{cv.cvRmse.toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">RMSE hors éch.</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-mf-txt4">{(cv.inSampleRSquared * 100).toFixed(1)}%</div>
                <div className="text-[10px] text-mf-txt4">R² in-sample</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold font-mono ${cv.overfitGap > 0.2 ? 'text-red-400' : 'text-mf-txt'}`}>
                  {(cv.overfitGap * 100).toFixed(0)} pt
                </div>
                <div className="text-[10px] text-mf-txt4">Écart (sur-apprentissage)</div>
              </div>
            </div>
          ) : null}
          <div className="text-xs text-mf-txt3">{cv.message}</div>
        </div>
      )}

      {/* Fiabilité du modèle — panneau complet d'indicateurs (spec §3/§5) */}
      {cv && (
        <div className={`card border ${cv.verdict === 'surajusté' ? 'border-red-500/30' : 'border-mf-border'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Cpu size={15} className="text-violet-400" />
              <span className="section-title">Fiabilité du modèle</span>
            </div>
            <span className={`badge ${
              cv.verdict === 'robuste' ? 'badge-green' : cv.verdict === 'acceptable' ? 'badge-gold'
              : cv.verdict === 'insuffisant' ? 'badge-gray' : 'badge-orange'
            }`}>{cv.verdict === 'surajusté' ? 'SUR-AJUSTEMENT' : cv.verdict}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { l: 'R² entraînement', v: `${(model!.rSquared * 100).toFixed(1)} %`, c: 'text-mf-txt' },
              { l: 'R² validation', v: Number.isNaN(cv.cvRSquared) ? '—' : `${(cv.cvRSquared * 100).toFixed(1)} %`, c: cv.cvRSquared >= AI_GOVERNANCE.MIN_VALIDATION_R2 ? 'text-emerald-400' : 'text-red-400' },
              { l: 'RMSE validation', v: Number.isNaN(cv.cvRmse) ? '—' : `${cv.cvRmse.toFixed(1)} pt`, c: 'text-mf-txt' },
              { l: 'MAE validation', v: Number.isNaN(cv.cvMae) ? '—' : `${cv.cvMae.toFixed(1)} pt`, c: 'text-mf-txt' },
              { l: 'Biais moyen', v: Number.isNaN(cv.biasCv) ? '—' : `${cv.biasCv >= 0 ? '+' : ''}${cv.biasCv.toFixed(1)} pt`, c: 'text-mf-txt' },
              { l: 'Échantillons', v: String(model!.sampleCount), c: model!.sampleCount >= AI_GOVERNANCE.MIN_SAMPLES ? 'text-emerald-400' : 'text-amber-400' },
              { l: 'Domaines géol.', v: String(cv.groupCount), c: 'text-mf-txt' },
              { l: 'Largeur IP 95 %', v: prediction ? `${(prediction.upper - prediction.lower).toFixed(1)} pt` : '—', c: 'text-mf-txt' },
            ].map(m => (
              <div key={m.l} className="rounded-md bg-white/[0.03] px-2.5 py-2">
                <div className="text-[9px] uppercase tracking-wider text-mf-txt4">{m.l}</div>
                <div className={`text-sm font-mono font-semibold ${m.c}`}>{m.v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => setShowTests(v => !v)} className="text-xs text-teal-400 hover:text-teal-300">
              {showTests ? 'Masquer' : 'Voir'} les essais nécessaires
            </button>
            <span className="text-[10px] text-mf-txt4">validation : {cv.validationMethod === 'group_holdout' ? 'par groupe (anti-fuite)' : 'k-fold indexé'}</span>
          </div>
          {showTests && (
            <div className="mt-2 rounded-md bg-white/[0.02] p-3 text-xs text-mf-txt3 space-y-1">
              {decision.actions.length > 0
                ? decision.actions.map((a, i) => <div key={i}>• {a}</div>)
                : <div>Base et validation suffisantes — voir l'onglet « Essais recommandés » ci-dessous pour affiner la couverture P80.</div>}
              <div className="text-[10px] text-mf-txt4 pt-1">Détail des niveaux P80 à compléter dans « Optimisation du P80 » → onglet « Essais recommandés ».</div>
            </div>
          )}
        </div>
      )}

      {/* Effet du P80 — trois états (identifié / incertain / non identifiable) */}
      {p80Effect && (
        <div className={`card border ${
          p80Effect.state === 'identifié' ? 'border-emerald-500/30'
          : p80Effect.state === 'incertain' ? 'border-amber-500/30' : 'border-red-500/30'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={15} className={
                p80Effect.state === 'identifié' ? 'text-emerald-400'
                : p80Effect.state === 'incertain' ? 'text-amber-400' : 'text-red-400'
              } />
              <span className="section-title">Effet du P80</span>
            </div>
            <span className={`badge ${
              p80Effect.state === 'identifié' ? 'badge-green'
              : p80Effect.state === 'incertain' ? 'badge-gold' : 'badge-orange'
            }`}>{p80Effect.state.replace('_', ' ')}</span>
          </div>
          <div className="mt-2 text-sm">
            {p80Effect.state === 'non_identifiable' ? (
              <span className="text-red-400">Effet apparent du P80 : <strong>non identifiable</strong></span>
            ) : (
              <span className="text-mf-txt2">Effet estimé : <strong className="font-mono">{p80Effect.marginalPerUm.toFixed(3)} pt/µm</strong> ({p80Effect.state})</span>
            )}
          </div>
          {p80Effect.cause && <div className="text-xs text-mf-txt4 mt-1">Cause probable : {p80Effect.cause}.</div>}
          <div className="text-xs text-mf-txt4 mt-1">Confiance : {p80Effect.confidence === 'high' ? 'élevée' : p80Effect.confidence === 'medium' ? 'moyenne' : 'faible'}
            {p80Effect.state !== 'identifié' && ' — le module propose des essais à P80 varié plutôt que de conclure que l\'effet est nul.'}</div>
        </div>
      )}
      </>)}

      {subTab === 'prevision' && (<>
      {mechanisticPanel}
      {leachCyanidePanel}
      <MultistageAdsorptionPanel />
      {/* Recommandation d'exploitation — sur le levier réglable (P80 broyage).
          Affichée aussi quand il n'y a pas d'action (maintenir / signe non
          physique), pour expliquer POURQUOI plutôt que de disparaître. */}
      {grindReco && (() => {
        const rec = grindReco.recommendation;
        const actionable = rec.direction !== 'maintenir';
        return (
          <div className={`card border ${actionable ? 'border-amber-500/25 bg-amber-500/[0.03]' : 'border-mf-border'}`}>
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${actionable ? 'bg-amber-500/15' : 'bg-mf-hover/40'}`}>
                <Target size={18} className={actionable ? 'text-amber-400' : 'text-mf-txt4'} />
              </div>
              <div className="flex-1">
                <div className="section-title mb-1">Recommandation d'exploitation</div>
                <p className="text-sm text-mf-txt2 leading-relaxed">{rec.message}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-mf-txt4">
                  {actionable && (
                    <>
                      <span>P80 optimal : <strong className="text-amber-400">{Math.round(rec.optimalP80)} µm</strong></span>
                      <span>Récup. prédite : <strong className="text-emerald-400">{rec.predictedRecovery.toFixed(1)} %</strong></span>
                    </>
                  )}
                  <span>Effet marginal : <strong className="text-mf-txt3">{rec.marginalPerUm.toFixed(3)} pt/µm</strong></span>
                  <span>{rec.confident ? '✓ modèle fiable' : '⚠ confiance limitée — valider par essai'}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-2 gap-4">
        {/* Prediction input panel */}
        <div className="card space-y-3">
          <div className="section-title">Simuler un scénario</div>
          <div className="text-xs text-mf-txt4">Défauts = minerai moyen du projet · ajustez pour simuler un scénario</div>
          {PREDICTION_FIELDS.map(f => (
            <div key={f.key}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-mf-txt3">{f.label}</span>
                <span className="font-mono text-mf-txt font-semibold">{formatDecimalGrouped(input[f.key], f.step < 1 ? 2 : 0)}</span>
              </div>
              <input
                type="range" min={f.min} max={f.max} step={f.step}
                value={input[f.key]}
                onChange={e => setField(f.key, Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>
          ))}
        </div>

        {/* Prediction result + feature importance */}
        <div className="space-y-4">
          <div className="card text-center py-6">
            <div className="text-xs text-mf-txt4 mb-2">Récupération prédite</div>
            <div className={`text-5xl font-bold font-mono mb-2 ${
              decision.status === 'autorisée' ? 'text-emerald-400'
              : decision.status === 'exploratoire' ? 'text-amber-400' : 'text-red-400'
            }`}>
              {prediction ? formatDecimalGrouped(prediction.point, 1) : '—'}%
            </div>
            {prediction && (
              <div className="text-xs text-mf-txt3">
                Intervalle de prédiction 95%: <span className="text-mf-txt font-mono">{formatDecimalGrouped(prediction.lower, 1)}% — {formatDecimalGrouped(prediction.upper, 1)}%</span>
              </div>
            )}
            <div className="mt-2 flex flex-col items-center gap-0.5">
              <span className={`text-[11px] font-semibold ${
                decision.status === 'autorisée' ? 'text-emerald-400'
                : decision.status === 'exploratoire' ? 'text-amber-400' : 'text-red-400'
              }`}>Statut : {decision.status}</span>
              <span className="text-[10px] text-mf-txt4">
                Validation externe : {cv && !Number.isNaN(cv.cvRSquared)
                  ? (cv.cvRSquared >= AI_GOVERNANCE.MIN_VALIDATION_R2 ? `R² ${(cv.cvRSquared * 100).toFixed(0)} %` : `insuffisante (R² ${(cv.cvRSquared * 100).toFixed(0)} %)`)
                  : 'non calculable'}
              </span>
            </div>
          </div>

          <div className="card">
            <div className="section-title mb-3">Importance des variables</div>
            <div className="space-y-2">
              {model!.featureImportance.map((fi) => {
                const maxImp = model!.featureImportance[0].normalized;
                const pct = maxImp > 0 ? (fi.normalized / maxImp) * 100 : 0;
                const labels: Record<string, string> = {
                  auGrade: 'Teneur Au', sSulfide: 'S sulfure', cOrganic: 'C organique',
                  bwi: 'BWi', grg: 'GRG', p80: 'P80', auFree: 'Au libre',
                };
                return (
                  <div key={fi.feature} className="flex items-center gap-2">
                    <div className="text-xs text-mf-txt3 w-24">{labels[fi.feature] ?? fi.feature}</div>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${fi.coefficient > 0 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="text-[10px] font-mono w-16 text-right text-mf-txt4">
                      {fi.coefficient > 0 ? '+' : ''}{fi.coefficient.toFixed(3)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-mf-border text-[10px] text-mf-txt4">
              Coefficients normalisés — barres vertes = effet positif sur récupération, rouges = effet négatif
            </div>
          </div>
        </div>
      </div>

      {/* Training data table */}
      <div className="card">
        <div className="section-title mb-3">Données d'entraînement ({samples.length} échantillons)</div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Au (g/t)</th><th>S (%)</th><th>Corg (%)</th><th>BWi</th>
                <th>GRG (%)</th><th>P80 (<span className="normal-case">µm</span>)</th><th>Au free (%)</th>
                <th>Récup. observée</th><th>Récup. prédite</th><th>Erreur</th>
              </tr>
            </thead>
            <tbody>
              {samples.slice(0, 20).map((s, i) => {
                const pred = predictRecovery(model!.coefficients, s);
                const err = s.recovery - pred;
                return (
                  <tr key={i}>
                    <td className="num">{s.auGrade.toFixed(2)}</td>
                    <td className="num">{s.sSulfide.toFixed(2)}</td>
                    <td className="num">{s.cOrganic.toFixed(2)}</td>
                    <td className="num">{s.bwi.toFixed(1)}</td>
                    <td className="num">{s.grg.toFixed(0)}</td>
                    <td className="num">{s.p80.toFixed(0)}</td>
                    <td className="num">{s.auFree.toFixed(0)}</td>
                    <td className="num font-semibold text-mf-txt">{s.recovery.toFixed(1)}%</td>
                    <td className="num text-amber-400">{pred.toFixed(1)}%</td>
                    <td className={`num ${Math.abs(err) < model!.rmse ? 'text-emerald-400' : 'text-orange-400'}`}>
                      {err > 0 ? '+' : ''}{err.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {samples.length > 20 && (
          <div className="text-center text-xs text-mf-txt4 mt-2">
            Affichage des 20 premiers sur {samples.length} échantillons
          </div>
        )}
      </div>
      </>)}

      {subTab === 'optim' && (
        <AiP80OptimizationPanel
          samples={samples}
          gradeGt={project.gold_grade_g_t}
          goldPriceUsdOz={project.gold_price_usd}
          recoveryCeilingPct={recoveryCeilingPct}
        />
      )}
    </div>
  );
}
