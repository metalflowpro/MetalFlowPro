// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation BILINÉAIRE (tonnage + teneur) — metal accounting rigoureux.
//
// La réconciliation linéaire par composant (`wls.ts` appelé par composant, cf.
// item 1B) ferme INDÉPENDAMMENT chaque bilan : elle ajuste les débits de solides
// d'un côté, les débits d'or de l'autre. Rien ne garantit alors que
//        or_réconcilié(flux) = tonnage_réconcilié(flux) × teneur(flux)
// reste cohérent : les deux ajustements ignorent leur produit.
//
// Le metal accounting rigoureux (Narasimhan & Jordache ; AMIRA P754) réconcilie
// le PRODUIT tonnage × teneur. Le bilan métal à un nœud,
//        Σ_entrées T·a − Σ_sorties T·a = 0,
// est BILINÉAIRE (produit de deux inconnues T et a). La méthode à DEUX ÉTAGES,
// standard en pratique, le rend linéaire :
//
//   Étape 1 — réconcilier les TONNAGES (conservation de masse, WLS linéaire A=±1)
//             → tonnages réconciliés T̂_j.
//   Étape 2 — À T̂ FIGÉ, le bilan métal devient LINÉAIRE en teneurs a_j, avec pour
//             chaque nœud des coefficients ±T̂_j : Σ ±T̂_j a_j = 0. On réconcilie
//             alors les TENEURS par WLS (pondérées par la précision d'analyse),
//             puis le débit métal réconcilié est m̂_j = T̂_j · â_j.
//
// Les teneurs réconciliées sont ainsi COHÉRENTES avec les tonnages réconciliés
// par construction. C'est une approximation (le vrai problème bilinéaire itère
// les deux étages) mais c'est la première passe rigoureuse admise en industrie,
// et elle réutilise exactement le noyau WLS de `wls.ts`.
//
// Module PUR : réutilise `solveNetworkWls` / `reconcile`. Aucune dépendance.
// ─────────────────────────────────────────────────────────────────────────────

import {
  reconcile, solveNetworkWls, sensorSuspicionThreshold,
  DEFAULT_RECON_CONFIDENCE, DEFAULT_SENSOR_PRECISION_PCT,
  type ReconNode, type ReconStream, type ReconResult,
} from './wls';

// ═══ Entrées ═════════════════════════════════════════════════════════════════

/** Mesure d'analyse (teneur) d'un flux pour un métal donné. */
export interface GradeMeasurement {
  /** Teneur mesurée (ex. g/t). */
  value: number;
  /** Écart-type d'analyse ; sinon dérivé de `precisionPct`. */
  std?: number;
  /** Précision relative d'analyse (%). Défaut `DEFAULT_SENSOR_PRECISION_PCT`. */
  precisionPct?: number;
  /** Teneur figée (référence non ajustable, ex. doré titré). */
  fixed?: boolean;
}

/** Flux du circuit : un débit-support (tonnage) mesuré + ses teneurs par métal. */
export interface BilinearStream {
  id: string;
  label?: string;
  /** Débit de solides mesuré (t/h) — le support conservé. */
  tonnage: number;
  /** Écart-type du tonnage ; sinon dérivé de `tonnagePrecisionPct`. */
  tonnageStd?: number;
  /** Précision relative du tonnage (%). Défaut `DEFAULT_SENSOR_PRECISION_PCT`. */
  tonnagePrecisionPct?: number;
  /** Tonnage figé (pesée de référence). */
  tonnageFixed?: boolean;
  /** Teneur mesurée par métal (clé = id du métal). Absente ⇒ flux non gradé pour ce métal. */
  grades: Record<string, GradeMeasurement>;
}

export interface BilinearMetal {
  key: string;
  label?: string;
  /** Unité de teneur, ex. « g/t » (documentaire). */
  gradeUnit?: string;
}

export interface BilinearInputs {
  nodes: ReconNode[];
  streams: BilinearStream[];
  metals: BilinearMetal[];
  confidence?: number;
}

// ═══ Sorties ═══════════════════════════════════════════════════════════════

export interface BilinearGradeResult {
  id: string;
  label?: string;
  measuredGrade: number;
  reconciledGrade: number;
  gradeAdjustment: number;
  gradeAdjustmentPct: number;
  /** Tonnage réconcilié utilisé (T̂). */
  reconciledTonnage: number;
  /** Débit métal réconcilié m̂ = T̂ · â. */
  reconciledMetalFlow: number;
  std: number;
  suspicionScore: number;
  isSuspect: boolean;
}

export interface BilinearMetalResult {
  key: string;
  label?: string;
  grades: BilinearGradeResult[];
  globalTest: { statistic: number; threshold: number; dof: number; grossError: boolean };
  worstAssay: { id: string; label?: string; score: number } | null;
  /** Clôture métal après réconciliation : Σ métal sorties / Σ métal entrées (%). */
  metalClosurePct: number;
  feasible: boolean;
  notes: string[];
}

export interface BilinearResult {
  /** Étage 1 : réconciliation linéaire des tonnages (support). */
  tonnage: ReconResult;
  /** Tonnage réconcilié par flux (T̂). */
  reconciledTonnage: Record<string, number>;
  /** Étage 2 : réconciliation des teneurs par métal, cohérente avec T̂. */
  metals: BilinearMetalResult[];
  feasible: boolean;
  notes: string[];
}

// ═══ Helpers ═══════════════════════════════════════════════════════════════

/** Flux d'alimentation (entrant d'un nœud, sortant d'aucun) et de production (l'inverse). */
function feedProdIds(nodes: ReconNode[]): { feed: Set<string>; prod: Set<string> } {
  const feed = new Set(nodes.flatMap(n => n.inputs).filter(id => !nodes.some(nn => nn.outputs.includes(id))));
  const prod = new Set(nodes.flatMap(n => n.outputs).filter(id => !nodes.some(nn => nn.inputs.includes(id))));
  return { feed, prod };
}

function gradeVariance(g: GradeMeasurement): number {
  if (g.fixed) return 1e-8;
  if (g.std != null && g.std > 0) return g.std * g.std;
  const pct = g.precisionPct ?? DEFAULT_SENSOR_PRECISION_PCT;
  const sd = Math.max(1e-6, Math.abs(g.value) * pct / 100);
  return sd * sd;
}

// ═══ Réconciliation bilinéaire ═══════════════════════════════════════════════

export function reconcileBilinear(inputs: BilinearInputs): BilinearResult {
  const { nodes, streams, metals } = inputs;
  const confidence = inputs.confidence ?? DEFAULT_RECON_CONFIDENCE;
  const notes: string[] = [];

  if (streams.length === 0 || nodes.length === 0) {
    return {
      tonnage: emptyReconResult('Réseau vide : aucun flux ou aucun nœud.'),
      reconciledTonnage: {}, metals: [], feasible: false,
      notes: ['Réseau vide : aucun flux ou aucun nœud.'],
    };
  }

  // ── Étage 1 : réconciliation linéaire des tonnages ────────────────────────
  const tonnageStreams: ReconStream[] = streams.map(s => ({
    id: s.id,
    label: s.label,
    measured: s.tonnage,
    std: s.tonnageStd,
    precisionPct: s.tonnagePrecisionPct,
    fixed: s.tonnageFixed,
  }));
  const tonnage = reconcile(nodes, tonnageStreams, confidence);

  const reconciledTonnage: Record<string, number> = {};
  for (const s of tonnage.streams) reconciledTonnage[s.id] = s.reconciled;

  if (!tonnage.feasible) {
    notes.push('Étage tonnage infaisable — les teneurs ne peuvent être réconciliées sans support cohérent.');
    return { tonnage, reconciledTonnage, metals: [], feasible: false, notes };
  }

  // ── Étage 2 : réconciliation des teneurs à tonnages figés ──────────────────
  const metalResults = reconcileGradesGivenTonnage(nodes, streams, metals, reconciledTonnage, confidence);

  notes.push(`Tonnage réconcilié (clôture ${tonnage.closurePct.toFixed(1)} %) puis ${metals.length} métal(aux) réconcilié(s) à teneurs cohérentes.`);

  return {
    tonnage,
    reconciledTonnage,
    metals: metalResults,
    feasible: true,
    notes,
  };
}

/**
 * Étage 2 réutilisable : réconcilie les teneurs de CHAQUE métal à tonnages
 * `reconciledTonnage` FIGÉS. Bilan métal Σ ±T̂·a = 0 (linéaire en a). Partagé
 * par la passe unique (`reconcileBilinear`) et l'itératif (`reconcileBilinearIterative`).
 */
function reconcileGradesGivenTonnage(
  nodes: ReconNode[],
  streams: BilinearStream[],
  metals: BilinearMetal[],
  reconciledTonnage: Record<string, number>,
  confidence: number,
): BilinearMetalResult[] {
  const { feed, prod } = feedProdIds(nodes);
  const sensorThr = sensorSuspicionThreshold(confidence);

  return metals.map(metal => {
    const graded = streams.filter(s => {
      const g = s.grades[metal.key];
      return g != null && Number.isFinite(g.value);
    });
    const label = metal.label ?? metal.key;

    if (graded.length === 0) {
      return {
        key: metal.key, label, grades: [],
        globalTest: { statistic: 0, threshold: 0, dof: 0, grossError: false },
        worstAssay: null, metalClosurePct: 0, feasible: false,
        notes: [`Aucune teneur renseignée pour ${label}.`],
      };
    }

    const gIdx = new Map(graded.map((s, j) => [s.id, j]));
    const a: number[] = graded.map(s => s.grades[metal.key]!.value);      // teneurs mesurées
    const variance: number[] = graded.map(s => gradeVariance(s.grades[metal.key]!));

    // Matrice d'incidence métal : coefficient de flux j au nœud i = ±T̂_j.
    const A: number[][] = nodes.map(node => {
      const row = new Array(graded.length).fill(0);
      for (const sid of node.inputs)  { const j = gIdx.get(sid); if (j != null) row[j] += reconciledTonnage[sid] ?? 0; }
      for (const sid of node.outputs) { const j = gIdx.get(sid); if (j != null) row[j] -= reconciledTonnage[sid] ?? 0; }
      return row;
    });

    const solve = solveNetworkWls(A, a, variance, confidence);
    const mNotes: string[] = [];

    if (solve.singular) {
      mNotes.push(`Contraintes métal singulières pour ${label} — vérifier que chaque nœud gradé est équilibrable.`);
      const grades = graded.map<BilinearGradeResult>(s => {
        const T = reconciledTonnage[s.id] ?? 0;
        const g = s.grades[metal.key]!;
        return {
          id: s.id, label: s.label, measuredGrade: g.value, reconciledGrade: g.value,
          gradeAdjustment: 0, gradeAdjustmentPct: 0, reconciledTonnage: T,
          reconciledMetalFlow: +(T * g.value).toFixed(4),
          std: +Math.sqrt(gradeVariance(g)).toFixed(4), suspicionScore: 0, isSuspect: false,
        };
      });
      return {
        key: metal.key, label, grades,
        globalTest: { statistic: 0, threshold: +solve.threshold.toFixed(2), dof: solve.dof, grossError: false },
        worstAssay: null, metalClosurePct: 0, feasible: false, notes: mNotes,
      };
    }

    const grades = graded.map<BilinearGradeResult>((s, j) => {
      const T = reconciledTonnage[s.id] ?? 0;
      const recGrade = solve.reconciled[j];
      const adj = solve.adjustment[j];
      const denom = Math.sqrt(Math.max(solve.adjustmentVar[j], 1e-12));
      const score = Math.abs(adj) / denom;
      const g = s.grades[metal.key]!;
      return {
        id: s.id, label: s.label,
        measuredGrade: g.value,
        reconciledGrade: +recGrade.toFixed(4),
        gradeAdjustment: +adj.toFixed(4),
        gradeAdjustmentPct: g.value !== 0 ? +((adj / g.value) * 100).toFixed(2) : 0,
        reconciledTonnage: T,
        reconciledMetalFlow: +(T * recGrade).toFixed(4),
        std: +Math.sqrt(variance[j]).toFixed(4),
        suspicionScore: +score.toFixed(3),
        isSuspect: !g.fixed && score > sensorThr,
      };
    });

    const suspects = grades.filter(g => g.isSuspect).sort((x, y) => y.suspicionScore - x.suspicionScore);
    const worstAssay = suspects.length > 0
      ? { id: suspects[0].id, label: suspects[0].label, score: suspects[0].suspicionScore }
      : null;

    const metalIn = grades.filter(g => feed.has(g.id)).reduce((acc, g) => acc + g.reconciledMetalFlow, 0);
    const metalOut = grades.filter(g => prod.has(g.id)).reduce((acc, g) => acc + g.reconciledMetalFlow, 0);
    const metalClosurePct = metalIn !== 0 ? +((metalOut / metalIn) * 100).toFixed(2) : 0;

    if (solve.grossError) {
      mNotes.push(
        `${label} : erreur grossière (γ=${solve.gamma.toFixed(1)} > seuil χ²=${solve.threshold.toFixed(1)}). ` +
        (worstAssay ? `Analyse la plus suspecte : ${worstAssay.label ?? worstAssay.id}.` : 'Vérifier les teneurs.'),
      );
    } else {
      mNotes.push(`${label} : bilan métal cohérent (γ=${solve.gamma.toFixed(1)} ≤ seuil χ²=${solve.threshold.toFixed(1)}).`);
    }

    return {
      key: metal.key, label, grades,
      globalTest: {
        statistic: +solve.gamma.toFixed(2), threshold: +solve.threshold.toFixed(2),
        dof: solve.dof, grossError: solve.grossError,
      },
      worstAssay, metalClosurePct, feasible: true, notes: mNotes,
    };
  });
}

// ═══ Réconciliation bilinéaire ITÉRATIVE ═════════════════════════════════════
//
// La passe unique (`reconcileBilinear`) fige les tonnages puis réconcilie les
// teneurs : les tonnages ignorent le bilan MÉTAL. La version itérative résout le
// vrai problème bilinéaire par linéarisations successives (substitution) :
//
//   Répéter jusqu'à convergence :
//     (a) teneurs â figées → réconcilier les TONNAGES sous conservation de masse
//         ET bilan métal Σ ±(â·T) = 0 (linéaire en T à â figé) ;
//     (b) tonnages T̂ figés → réconcilier les TENEURS (étage 2 partagé).
//
// Chaque demi-pas réutilise `solveNetworkWls`. Si le système tonnage combiné est
// singulier (contraintes dépendantes, ex. teneurs uniformes), on retombe sur la
// conservation de masse seule — dégradation sûre, jamais de NaN.

export interface BilinearIterOptions {
  /** Itérations maximales (défaut 20). */
  maxIter?: number;
  /** Tolérance de convergence sur la variation relative max de T̂ (défaut 1e-4). */
  tol?: number;
}

/** Réconcilie les tonnages sous masse + bilans métal (teneurs `grades` figées). */
function reconcileTonnageGivenGrades(
  nodes: ReconNode[],
  streams: BilinearStream[],
  metals: BilinearMetal[],
  grades: Record<string, Record<string, number>>, // grades[metalKey][streamId]
  confidence: number,
): { reconciledTonnage: Record<string, number>; tonnage: ReconResult } {
  // Réconciliation de masse seule (référence + repli si combiné singulier).
  const tonnageStreams: ReconStream[] = streams.map(s => ({
    id: s.id, label: s.label, measured: s.tonnage,
    std: s.tonnageStd, precisionPct: s.tonnagePrecisionPct, fixed: s.tonnageFixed,
  }));
  const massOnly = reconcile(nodes, tonnageStreams, confidence);

  const idx = new Map(streams.map((s, i) => [s.id, i]));
  const y = streams.map(s => s.tonnage);
  const variance = streams.map(s => tonnageVariance(s));

  // Lignes de contrainte : masse (±1) puis, par métal, bilan métal (±â).
  const A: number[][] = [];
  for (const node of nodes) {
    const row = new Array(streams.length).fill(0);
    for (const sid of node.inputs)  { const j = idx.get(sid); if (j != null) row[j] += 1; }
    for (const sid of node.outputs) { const j = idx.get(sid); if (j != null) row[j] -= 1; }
    A.push(row);
  }
  for (const metal of metals) {
    const g = grades[metal.key];
    if (!g) continue;
    for (const node of nodes) {
      const row = new Array(streams.length).fill(0);
      for (const sid of node.inputs)  { const j = idx.get(sid); if (j != null && g[sid] != null) row[j] += g[sid]; }
      for (const sid of node.outputs) { const j = idx.get(sid); if (j != null && g[sid] != null) row[j] -= g[sid]; }
      A.push(row);
    }
  }

  const solve = solveNetworkWls(A, y, variance, confidence);
  if (solve.singular) {
    // Repli : conservation de masse seule (déjà calculée).
    const rt: Record<string, number> = {};
    for (const s of massOnly.streams) rt[s.id] = s.reconciled;
    return { reconciledTonnage: rt, tonnage: massOnly };
  }

  const reconciledTonnage: Record<string, number> = {};
  streams.forEach((s, j) => { reconciledTonnage[s.id] = +solve.reconciled[j].toFixed(4); });
  return { reconciledTonnage, tonnage: massOnly };
}

export function reconcileBilinearIterative(
  inputs: BilinearInputs,
  opts: BilinearIterOptions = {},
): BilinearResult & { iterations: number; converged: boolean } {
  const { nodes, streams, metals } = inputs;
  const confidence = inputs.confidence ?? DEFAULT_RECON_CONFIDENCE;
  const maxIter = opts.maxIter ?? 20;
  const tol = opts.tol ?? 1e-4;

  if (streams.length === 0 || nodes.length === 0) {
    return {
      tonnage: emptyReconResult('Réseau vide : aucun flux ou aucun nœud.'),
      reconciledTonnage: {}, metals: [], feasible: false,
      notes: ['Réseau vide : aucun flux ou aucun nœud.'], iterations: 0, converged: false,
    };
  }

  // Teneurs courantes par métal/flux : initialisées aux mesures.
  const currentGrades: Record<string, Record<string, number>> = {};
  for (const metal of metals) {
    const g: Record<string, number> = {};
    for (const s of streams) {
      const gm = s.grades[metal.key];
      if (gm != null && Number.isFinite(gm.value)) g[s.id] = gm.value;
    }
    currentGrades[metal.key] = g;
  }

  let reconciledTonnage: Record<string, number> = {};
  let tonnageRes: ReconResult = emptyReconResult('');
  let metalResults: BilinearMetalResult[] = [];
  let prevT: Record<string, number> | null = null;
  let iterations = 0;
  let converged = false;

  for (let k = 0; k < maxIter; k++) {
    iterations = k + 1;
    // (a) tonnages sous masse + bilans métal, teneurs figées.
    const step = reconcileTonnageGivenGrades(nodes, streams, metals, currentGrades, confidence);
    reconciledTonnage = step.reconciledTonnage;
    tonnageRes = step.tonnage;

    // (b) teneurs à tonnages figés (étage 2 partagé).
    metalResults = reconcileGradesGivenTonnage(nodes, streams, metals, reconciledTonnage, confidence);
    for (const mr of metalResults) {
      const g = currentGrades[mr.key] ?? {};
      for (const gr of mr.grades) g[gr.id] = gr.reconciledGrade;
      currentGrades[mr.key] = g;
    }

    // Convergence : variation relative max des tonnages réconciliés.
    if (prevT) {
      let maxRel = 0;
      for (const s of streams) {
        const now = reconciledTonnage[s.id] ?? 0;
        const before = prevT[s.id] ?? 0;
        const denom = Math.max(Math.abs(before), 1e-9);
        maxRel = Math.max(maxRel, Math.abs(now - before) / denom);
      }
      if (maxRel < tol) { converged = true; break; }
    }
    prevT = { ...reconciledTonnage };
  }

  const feasible = tonnageRes.feasible && metalResults.some(m => m.feasible);
  const notes = [
    `Réconciliation bilinéaire itérative : ${iterations} itération(s), ${converged ? 'convergée' : 'non convergée (maxIter atteint)'}.`,
    `Tonnages réconciliés sous conservation de masse ET bilans métal simultanés ; teneurs cohérentes m̂ = T̂ × â.`,
  ];

  return { tonnage: tonnageRes, reconciledTonnage, metals: metalResults, feasible, notes, iterations, converged };
}

/** Variance du tonnage d'un flux (mêmes règles que `reconcile`). */
function tonnageVariance(s: BilinearStream): number {
  if (s.tonnageFixed) return 1e-8;
  if (s.tonnageStd != null && s.tonnageStd > 0) return s.tonnageStd * s.tonnageStd;
  const pct = s.tonnagePrecisionPct ?? DEFAULT_SENSOR_PRECISION_PCT;
  const sd = Math.max(1e-6, Math.abs(s.tonnage) * pct / 100);
  return sd * sd;
}

function emptyReconResult(note: string): ReconResult {
  return {
    streams: [], nodeImbalance: [],
    globalTest: { statistic: 0, threshold: 0, dof: 0, gerossError: false },
    worstSensor: null, closurePct: 0, feasible: false, notes: [note],
  };
}
