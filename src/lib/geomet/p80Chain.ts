// ─────────────────────────────────────────────────────────────────────────────
// Cheminement du P80 — rend explicite la logique qui mène de la courbe PSD
// mesurée à la consigne de broyage.
//
// Le moteur `p80Optimization` calcule juste, mais il rend un RÉSULTAT : une
// grappe de valeurs finales. L'ingénieur qui doit signer la consigne a besoin
// d'autre chose — le RAISONNEMENT : d'où sort chaque nombre, quelle opération
// mène au suivant, quel levier le déplace, et où le raisonnement est fragile.
//
// Ce module ne recalcule rien. Il relit le résultat du moteur et le déroule en
// une chaîne d'étapes, chacune portant son calcul littéral (nombres
// substitués), la provenance de ses entrées et sa conséquence.
//
// Il ajoute une chose que le moteur ne donnait pas : la vérification de
// COHÉRENCE entre l'optimum métallurgique et les contraintes réelles du
// circuit. Le moteur calcule P80_usine = P80_labo × K sans le confronter à la
// fenêtre mécanique du broyeur ni au plafond procédé aval ; quand la consigne
// tombe hors de ces bornes, personne ne le voyait.
//
// Module PUR : aucune dépendance Supabase/React, entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  P80OptimizationResult, ScenarioPoint, CircuitDef,
} from './p80Optimization';

// ═══ 1. Étapes du cheminement ════════════════════════════════════════════════

export type ChainStepId =
  | 'mesure' | 'cible_labo' | 'passage_usine' | 'coherence'
  | 'energie' | 'arbitrage' | 'consigne';

export type ChainStatus = 'ok' | 'attention' | 'bloquant';

export interface ChainInput {
  label: string;
  value: string;
  /** D'où vient la donnée — LIMS, Critères, saisie, défaut documenté. */
  origin: string;
  /** true si la valeur est un défaut faute de mesure : le maillon est fragile. */
  isDefault?: boolean;
}

export interface ChainStep {
  id: ChainStepId;
  /** Rang dans le cheminement, 1-based. */
  order: number;
  title: string;
  /** La question à laquelle l'étape répond, formulée comme l'ingénieur se la pose. */
  question: string;
  /** Résultat de l'étape, déjà formaté. */
  value: string;
  /** Le calcul réellement fait, nombres substitués. null si l'étape ne calcule pas. */
  computation: string | null;
  inputs: ChainInput[];
  /** Ce que cette étape change pour la suite du cheminement. */
  soWhat: string;
  /** Ce sur quoi l'ingénieur peut agir pour déplacer cette valeur. */
  levers: string[];
  status: ChainStatus;
  /** Précisé dès que le statut n'est pas « ok ». */
  warning: string | null;
}

export interface ChainContext {
  bwi: number;
  bwiIsMeasured: boolean;
  f80Um: number;
  auFreePct: number | null;
  recoveryCeilingPct: number;
  throughputTph: number;
  elecCostUsdKwh: number;
  plantFactor: number;
  /** P80 process imposé par les Critères de conception, s'il existe. */
  dcP80GrindUm: number | null;
  /** Chaîne de circuits retenue (pour la fenêtre mécanique du broyeur final). */
  circuitChain: CircuitDef[];
  limsSampleLabel: string | null;
  /** Points de la courbe PSD chargée (celle de l'échantillon sélectionné). */
  psdPointCount: number;
  /**
   * P80 labo représentatif : lu sur la COURBE COMBINÉE de tous les essais PSD
   * (pondérée par domaine, composites exclus). C'est la valeur qui fait autorité
   * dans le module — la courbe chargée n'est qu'un échantillon parmi eux.
   */
  labP80MeanUm: number | null;
  /**
   * Contrôle : moyenne pondérée des P80 individuels. Diffère de labP80MeanUm car
   * le P80 est un percentile (moyenne des P80 ≠ P80 de la courbe moyenne). Affiché
   * à côté pour que l'écart entre les deux méthodes reste visible.
   */
  labP80ControlUm: number | null;
  /** Nombre d'essais PSD derrière ces valeurs. */
  psdTestCount: number;
  /** true si la pondération vient d'un vrai partage d'alimentation (lom_pct). */
  p80WeightedByFeed: boolean;
}

/** Au-delà de cet écart relatif, la courbe chargée ne représente plus le gisement. */
const SAMPLE_DEVIATION_ALERT = 0.25;

/**
 * Décimale à la française, sans dépendre de la locale du navigateur : le
 * verdict s'affiche à côté de tuiles formatées par l'application, et deux
 * séparateurs décimaux différents dans le même panneau se remarquent.
 */
function dec(v: number, digits = 1): string {
  return v.toFixed(digits).replace('.', ',');
}

/**
 * Taille lisible par un ingénieur : au-delà du centimètre, « 96 mm » se lit,
 * « 96026 µm » se déchiffre. Les consignes de concassage tombent dans cette
 * plage, celles de broyage restent en µm.
 */
function um(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)} mm`;
  if (v >= 1_000) return `${dec(v / 1000)} mm`;
  return `${Math.round(v)} µm`;
}

/** Fenêtre mécanique du dernier broyeur de la chaîne — la contrainte qui s'applique. */
export function finalMillWindow(chain: CircuitDef[]): { label: string; window: [number, number] } | null {
  const grinders = chain.filter(c => c.present && (c.type === 'ball' || c.type === 'regrind' || c.type === 'sag'));
  const last = grinders[grinders.length - 1];
  return last ? { label: last.label, window: last.p80WindowUm } : null;
}

/**
 * Confronte la consigne usine aux contraintes réelles du circuit.
 *
 * Deux bornes indépendantes : la fenêtre mécanique du broyeur final (ce que la
 * machine sait produire) et le plafond procédé aval issu des Critères (ce que
 * la lixiviation tolère). Une consigne hors bornes n'est pas une consigne.
 */
export interface CoherenceCheck {
  p80Um: number;
  millLabel: string | null;
  millWindowUm: [number, number] | null;
  belowMillWindow: boolean;
  aboveMillWindow: boolean;
  processMaxUm: number | null;
  aboveProcessMax: boolean;
  status: ChainStatus;
  message: string;
}

export function checkCoherence(
  p80PlantUm: number,
  chain: CircuitDef[],
  dcP80GrindUm: number | null,
): CoherenceCheck {
  const mill = finalMillWindow(chain);
  const w = mill?.window ?? null;
  const belowMillWindow = w != null && p80PlantUm < w[0];
  const aboveMillWindow = w != null && p80PlantUm > w[1];
  // Le P80 des Critères est une cible process ; on tolère la marge de 25 %
  // déjà retenue par le moteur pour la contrainte de balayage.
  const processMaxUm = dcP80GrindUm != null ? Math.round(dcP80GrindUm * 1.25) : null;
  const aboveProcessMax = processMaxUm != null && p80PlantUm > processMaxUm;

  const problems: string[] = [];
  if (belowMillWindow && w) {
    problems.push(
      `la consigne ${um(p80PlantUm)} est plus fine que ce que ${mill!.label} sait produire (plancher ${um(w[0])}) — il faut un étage de regrind ou relâcher la cible`,
    );
  }
  if (aboveMillWindow && w) {
    problems.push(
      `la consigne ${um(p80PlantUm)} est plus grossière que la fenêtre de ${mill!.label} (plafond ${um(w[1])}) — le broyeur est surdimensionné pour ce besoin`,
    );
  }
  if (aboveProcessMax && processMaxUm != null) {
    problems.push(
      `la consigne dépasse le plafond procédé aval ${um(processMaxUm)} (P80 Critères ${um(dcP80GrindUm!)} + 25 %) — la lixiviation ne suivra pas`,
    );
  }

  if (problems.length === 0) {
    const bornes: string[] = [];
    if (w) bornes.push(`fenêtre ${mill!.label} ${um(w[0])}–${um(w[1])}`);
    if (processMaxUm != null) bornes.push(`plafond procédé ${um(processMaxUm)}`);
    return {
      p80Um: p80PlantUm, millLabel: mill?.label ?? null, millWindowUm: w,
      belowMillWindow, aboveMillWindow, processMaxUm, aboveProcessMax,
      status: 'ok',
      message: bornes.length
        ? `Consigne réalisable : ${um(p80PlantUm)} tient dans ${bornes.join(' et ')}.`
        : `Consigne ${um(p80PlantUm)} — aucune borne de circuit renseignée pour la confronter.`,
    };
  }

  return {
    p80Um: p80PlantUm, millLabel: mill?.label ?? null, millWindowUm: w,
    belowMillWindow, aboveMillWindow, processMaxUm, aboveProcessMax,
    // Sortir de la fenêtre mécanique rend la consigne inapplicable telle quelle ;
    // dépasser le seul plafond procédé reste un arbitrage à trancher.
    status: belowMillWindow || aboveMillWindow ? 'bloquant' : 'attention',
    message: `Incohérence : ${problems.join(' ; ')}.`,
  };
}

// ═══ 2. Construction du cheminement ══════════════════════════════════════════

export function buildP80Chain(r: P80OptimizationResult, ctx: ChainContext): ChainStep[] {
  const steps: ChainStep[] = [];
  const coherence = checkCoherence(r.p80OptimalPlantUm, ctx.circuitChain, ctx.dcP80GrindUm);

  // ── 1. La mesure ───────────────────────────────────────────────────────────
  //
  // Deux nombres coexistent et ne disent pas la même chose : le P80 de la
  // courbe CHARGÉE (un échantillon) et le P80 labo REPRÉSENTATIF (moyenne
  // pondérée par domaine sur tous les essais). Afficher le premier en tête du
  // cheminement laissait croire que le gisement avait été mesuré à cette
  // valeur. C'est la moyenne qui fait autorité ; l'échantillon n'est que la
  // courbe servant au graphique.
  const sampleP80 = r.p80Lims.valueUm;
  const meanP80 = ctx.labP80MeanUm;
  const representative = meanP80 ?? sampleP80;
  const mesureOk = representative != null;

  // Écart de l'échantillon chargé à la moyenne — un échantillon très éloigné
  // n'est pas représentatif du minerai à broyer.
  const deviation = meanP80 != null && sampleP80 != null && meanP80 > 0
    ? (sampleP80 - meanP80) / meanP80
    : null;
  const sampleOff = deviation != null && Math.abs(deviation) > SAMPLE_DEVIATION_ALERT;

  // Écart entre les deux méthodes d'agrégation, pour le donner en clair.
  const control = ctx.labP80ControlUm;
  const methodGap = meanP80 != null && control != null && meanP80 > 0
    ? Math.abs(control - meanP80) / meanP80
    : null;

  const mesureInputs: ChainInput[] = [];
  if (meanP80 != null) {
    mesureInputs.push({
      label: 'Essais PSD',
      value: `${ctx.psdTestCount}`,
      origin: ctx.p80WeightedByFeed
        ? 'LIMS · pondérés par la part d\'alimentation des domaines'
        : 'LIMS · domaines à poids égaux, faute de partage d\'alimentation',
      isDefault: !ctx.p80WeightedByFeed,
    });
    if (control != null) {
      mesureInputs.push({
        label: 'Contrôle · moyenne des P80',
        value: um(control),
        origin: methodGap != null && methodGap > 0.05
          ? `écart ${dec(methodGap * 100, 0)} % avec la courbe combinée`
          : 'concorde avec la courbe combinée',
      });
    }
  }
  mesureInputs.push({
    label: 'Courbe affichée',
    value: sampleP80 != null ? um(sampleP80) : `${ctx.psdPointCount} points`,
    origin: r.p80Lims.source === 'lims'
      ? `LIMS${ctx.limsSampleLabel ? ` — ${ctx.limsSampleLabel}` : ''}`
      : 'import CSV / saisie',
    isDefault: sampleOff,
  });

  steps.push({
    id: 'mesure', order: 1,
    title: meanP80 != null ? 'Ce que dit le minerai testé' : 'Ce que dit l\'échantillon',
    question: 'Quelle est la granulométrie réellement mesurée ?',
    value: mesureOk ? um(representative!) : 'non calculable',
    computation: !mesureOk
      ? null
      : meanP80 != null
        ? `P80 lu sur la courbe granulométrique combinée des ${ctx.psdTestCount} essais (pondérée par domaine, composites exclus)` +
          (sampleP80 != null
            ? ` — la courbe affichée, ${ctx.limsSampleLabel ?? 'échantillon chargé'}, est à ${um(sampleP80)}`
            : '')
        : `P80 lu sur la courbe PSD par ${r.p80Lims.method === 'exact' ? 'point de tamis exact' : 'interpolation log-linéaire entre tamis'}`,
    inputs: mesureInputs,
    soWhat: !mesureOk
      ? 'Sans P80 mesuré, tout le cheminement repose sur des modèles et non sur les essais.'
      : meanP80 != null
        ? 'Point de départ factuel : le P80 est lu sur la courbe combinée de tous les essais, pas moyenné à partir des P80 individuels (le P80 étant un percentile, les deux diffèrent) et pas pris sur la seule courbe affichée. La moyenne des P80 est donnée à côté en contrôle. Cette étape situe le minerai testé ; elle ne fixe pas la consigne, qui se déduit de la réponse métallurgique à l\'étape suivante.'
        : 'Point de départ factuel. Il ne fixe pas la consigne : il situe le minerai tel qu\'il a été testé.',
    levers: ['Choisir un autre échantillon LIMS pour la courbe affichée', 'Renseigner le partage d\'alimentation des domaines dans GéoMet', 'Importer une courbe PSD complète'],
    status: !mesureOk || sampleOff ? 'attention' : 'ok',
    warning: !mesureOk
      ? 'La courbe fournie n\'encadre pas 80 % passant — ajoutez des tamis de part et d\'autre.'
      : sampleOff
        ? `La courbe affichée (${ctx.limsSampleLabel ?? 'échantillon chargé'}, ${um(sampleP80!)}) s'écarte de ${dec(Math.abs(deviation!) * 100, 0)} % du P80 combiné des ${ctx.psdTestCount} essais (${um(meanP80!)}) : elle illustre le graphique mais ne représente pas le minerai à broyer.`
        : null,
  });

  // ── 2. La cible métallurgique au laboratoire ───────────────────────────────
  const fixedByEngineer = r.labTarget.testType === 'engineer';
  steps.push({
    id: 'cible_labo', order: 2,
    title: 'La finesse qui paie, au laboratoire',
    question: 'À quelle finesse la récupération cesse-t-elle de progresser ?',
    value: um(r.labTarget.valueUm),
    computation: fixedByEngineer
      ? `Valeur imposée : ${um(r.labTarget.valueUm)} — la courbe de récupération n'est pas consultée`
      : `Maximum de la courbe récupération vs P80, balayée sur l'échelle normalisée ; plage à ≤ 0,5 pt du maximum : ${um(r.labTarget.rangeUm[0])}–${um(r.labTarget.rangeUm[1])}`,
    inputs: [
      { label: 'Or libre', value: ctx.auFreePct != null ? `${dec(ctx.auFreePct)} %` : 'non mesuré', origin: 'LIMS', isDefault: ctx.auFreePct == null },
      { label: 'Plafond de récupération', value: `${dec(ctx.recoveryCeilingPct)} %`, origin: 'Projet' },
    ],
    soWhat: fixedByEngineer
      ? 'Le reste du cheminement part de cette valeur imposée : les étapes suivantes la traduisent, elles ne la remettent pas en cause.'
      : 'C\'est la cible métallurgique pure — au laboratoire, sans les imperfections de l\'usine. Broyer plus fin au-delà coûte de l\'énergie sans gain, et finit par dégrader la récupération (surbroyage).',
    levers: ['Fixer le P80 labo à la main', 'Compléter les essais broyage-lixiviation', 'Corriger le plafond de récupération du projet'],
    status: ctx.auFreePct == null ? 'attention' : 'ok',
    warning: ctx.auFreePct == null
      ? 'Or libre non mesuré : la courbe de récupération repose sur le modèle par défaut, pas sur vos essais.'
      : null,
  });

  // ── 3. Le passage du laboratoire à l'usine ─────────────────────────────────
  steps.push({
    id: 'passage_usine', order: 3,
    title: 'Le passage à l\'usine',
    question: 'Pourquoi l\'usine ne peut-elle pas viser la valeur du laboratoire ?',
    value: um(r.p80OptimalPlantUm),
    computation: `${um(r.labTarget.valueUm)} × K_indus ${r.kIndus.k.toFixed(2)} = ${um(r.p80OptimalPlantUm)}`,
    inputs: [
      { label: 'K_indus', value: r.kIndus.k.toFixed(2), origin: r.kIndus.mode === 'manual' ? 'saisi' : r.kIndus.mode === 'auto' ? 'calculé (rendement, stabilité, écart essai/usine)' : 'défaut documenté', isDefault: r.kIndus.mode === 'default' },
    ],
    soWhat: `L'usine tourne toujours plus grossier que le laboratoire : alimentation variable, classification imparfaite, contrainte de débit. K_indus chiffre cet écart — ici +${Math.round((r.kIndus.k - 1) * 100)} %. C'est cette valeur, pas celle du laboratoire, qui devient la consigne.`,
    levers: ['Basculer K_indus en mode Auto et renseigner rendement / stabilité / écart essai-usine', 'Saisir un K mesuré sur une usine comparable'],
    status: r.kIndus.mode === 'default' ? 'attention' : 'ok',
    warning: r.kIndus.mode === 'default'
      ? `K_indus est au défaut ${r.kIndus.k.toFixed(2)} : il n'a pas été rattaché à ce circuit. C'est le maillon le moins étayé du cheminement, et il déplace la consigne de ${Math.round(r.p80OptimalPlantUm - r.labTarget.valueUm)} µm à lui seul.`
      : null,
  });

  // ── 4. La confrontation aux contraintes réelles ────────────────────────────
  steps.push({
    id: 'coherence', order: 4,
    title: 'La consigne est-elle réalisable ?',
    question: 'Le circuit sait-il produire cette granulométrie, et l\'aval l\'accepte-t-il ?',
    value: coherence.status === 'ok' ? 'réalisable' : coherence.status === 'attention' ? 'à arbitrer' : 'non réalisable',
    computation: coherence.millWindowUm
      ? `${um(coherence.p80Um)} confronté à la fenêtre ${coherence.millLabel} ${um(coherence.millWindowUm[0])}–${um(coherence.millWindowUm[1])}${coherence.processMaxUm != null ? ` et au plafond procédé ${um(coherence.processMaxUm)}` : ''}`
      : null,
    inputs: [
      { label: 'Broyeur final', value: coherence.millLabel ?? '—', origin: 'chaîne de circuits' },
      { label: 'P80 process Critères', value: ctx.dcP80GrindUm != null ? um(ctx.dcP80GrindUm) : 'aucun', origin: 'Critères de conception', isDefault: ctx.dcP80GrindUm == null },
    ],
    soWhat: coherence.message,
    levers: ['Ajouter un étage de regrind', 'Revoir le P80 process dans les Critères de conception', 'Ajuster K_indus'],
    status: coherence.status,
    warning: coherence.status === 'ok' ? null : coherence.message,
  });

  // ── 5. Le coût énergétique ─────────────────────────────────────────────────
  const e = r.finalGrindEnergy;
  steps.push({
    id: 'energie', order: 5,
    title: 'Ce que coûte cette finesse',
    question: 'Combien d\'énergie faut-il pour descendre à cette granulométrie ?',
    value: `${dec(e.totalKwhT)} kWh/t`,
    computation: `Bond sur la chaîne ${e.perCircuit.map(c => c.label).join(' → ')}${e.totalPowerKw != null ? ` ; × ${ctx.throughputTph} t/h = ${Math.round(e.totalPowerKw)} kW` : ''}`,
    inputs: [
      { label: 'BWi', value: `${dec(ctx.bwi)} kWh/t`, origin: ctx.bwiIsMeasured ? 'LIMS, pondéré par domaines' : 'défaut', isDefault: !ctx.bwiIsMeasured },
      { label: 'F80 alimentation', value: um(ctx.f80Um), origin: 'Critères / saisie' },
      { label: 'Facteur usine/labo', value: ctx.plantFactor.toFixed(2), origin: 'hypothèses projet' },
    ],
    soWhat: e.designDeltaPct != null
      ? `${e.designDeltaPct > 0 ? `Dépasse la cible design de ${Math.round(e.designDeltaPct)} % — l'installation devra suivre.` : `Reste ${Math.abs(Math.round(e.designDeltaPct))} % sous la cible design.`}`
      : 'C\'est la facture énergétique de la consigne. Elle n\'a de sens que confrontée au gain de récupération qu\'elle achète — c\'est l\'étape suivante.',
    levers: ['Renseigner la puissance installée disponible', 'Renseigner la cible design en kWh/t', 'Mesurer le BWi par domaine'],
    status: !ctx.bwiIsMeasured ? 'attention' : (e.designDeltaPct != null && e.designDeltaPct > 15 ? 'attention' : 'ok'),
    warning: !ctx.bwiIsMeasured
      ? 'BWi non mesuré : toute l\'énergie calculée est indicative. C\'est la première mesure à faire avant de figer un design.'
      : (e.designDeltaPct != null && e.designDeltaPct > 15
        ? `Énergie ${Math.round(e.designDeltaPct)} % au-dessus de la cible design — vérifier la puissance installée.`
        : null),
  });

  // ── 6. L'arbitrage économique ──────────────────────────────────────────────
  const sel = r.scenarios.selected;
  const bond = r.scenarios.scenarios.find(s => s.id === 'bond_energy');
  steps.push({
    id: 'arbitrage', order: 6,
    title: 'L\'arbitrage retenu',
    question: 'Entre économiser l\'énergie et gagner de la récupération, que choisit-on ?',
    value: sel.label,
    computation: bond && sel.id !== 'bond_energy'
      ? `${sel.label} ${um(sel.p80Um)} : ${(sel.recoveryPct - bond.recoveryPct >= 0 ? '+' : '')}${dec(sel.recoveryPct - bond.recoveryPct)} pt de récupération pour ${(sel.energyKwhT - bond.energyKwhT >= 0 ? '+' : '')}${dec(sel.energyKwhT - bond.energyKwhT)} kWh/t, soit ${dec(sel.netUsdT)} $/t net contre ${dec(bond.netUsdT)} $/t`
      : `${sel.label} à ${um(sel.p80Um)} — ${dec(sel.netUsdT)} $/t net`,
    inputs: [
      { label: 'Prix de l\'or', value: `${Math.round(r.audit.goldPriceUsdOz)} $/oz`, origin: 'Projet' },
      { label: 'Coût électrique', value: `${dec(ctx.elecCostUsdKwh, 3)} $/kWh`, origin: 'hypothèses projet' },
      { label: 'Teneur', value: `${dec(r.audit.goldGradeGt, 2)} g/t`, origin: 'Projet' },
    ],
    soWhat: r.scenarios.selectionReason,
    levers: ['Ajuster le prix de l\'or et le coût électrique', 'Comparer les trois scénarios dans l\'onglet Scénarios'],
    status: 'ok',
    warning: null,
  });

  // ── 7. La consigne par circuit ─────────────────────────────────────────────
  const ball = r.circuits.find(c => c.type === 'ball');
  steps.push({
    id: 'consigne', order: 7,
    title: 'La consigne, circuit par circuit',
    question: 'Que règle-t-on concrètement sur chaque machine ?',
    value: ball ? um(ball.p80RecommendedUm) : um(r.p80OptimalPlantUm),
    computation: r.circuits.filter(c => c.p80RecommendedUm > 0).map(c => `${c.label} → ${um(c.p80RecommendedUm)}`).join(' · '),
    inputs: [
      { label: 'Confiance globale', value: r.confidence, origin: 'complétude des données' },
    ],
    soWhat: 'Chaque circuit reçoit sa propre cible : la consigne usine ne se règle pas au même endroit sur un concasseur et sur un broyeur à boulets. Cette valeur est poussée automatiquement vers les Critères de conception et Mine Opt.',
    levers: ['Activer un circuit de regrind', 'Compléter les données pour relever la confiance'],
    status: r.confidence === 'low' ? 'attention' : 'ok',
    warning: r.confidence === 'low'
      ? 'Confiance faible : consigne provisoire, à ne pas figer en design avant de compléter les essais (AMIRA P754 — sign-off requis).'
      : null,
  });

  return steps;
}

/** Le maillon le plus fragile du cheminement — celui sur lequel agir en premier. */
export function weakestLink(steps: ChainStep[]): ChainStep | null {
  const blocking = steps.find(s => s.status === 'bloquant');
  if (blocking) return blocking;
  return steps.find(s => s.status === 'attention') ?? null;
}

// ═══ 3. « Et si on broyait autrement ? » ═════════════════════════════════════
//
// La question que pose tout ingénieur devant une consigne : pourquoi celle-ci
// et pas 75 µm ? Y répondre demandait jusqu'ici de lire deux graphiques et de
// faire la soustraction de tête. On interpole la courbe économique déjà
// calculée par le moteur et on rend l'écart directement.

export interface WhatIfPoint {
  p80Um: number;
  energyKwhT: number;
  recoveryPct: number;
  netUsdT: number;
}

export interface WhatIfResult extends WhatIfPoint {
  reference: WhatIfPoint;
  deltaEnergyKwhT: number;
  deltaRecoveryPct: number;
  deltaNetUsdT: number;
  /** Écart de valeur nette annualisé, si le débit et la disponibilité sont connus. */
  deltaNetUsdYear: number | null;
  better: boolean;
  verdict: string;
}

/** Interpolation linéaire en log(P80) sur la courbe économique du moteur. */
export function interpolateScenarioPoint(points: ScenarioPoint[], p80Um: number): WhatIfPoint | null {
  if (points.length === 0 || !(p80Um > 0)) return null;
  const sorted = [...points].sort((a, b) => a.p80 - b.p80);
  const at = (p: ScenarioPoint): WhatIfPoint => ({
    p80Um: p.p80, energyKwhT: p.energyKwhT, recoveryPct: p.recoveryPct, netUsdT: p.netUsdT,
  });
  if (p80Um <= sorted[0].p80) return at(sorted[0]);
  if (p80Um >= sorted[sorted.length - 1].p80) return at(sorted[sorted.length - 1]);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (p80Um >= a.p80 && p80Um <= b.p80) {
      const t = Math.log(p80Um / a.p80) / Math.log(b.p80 / a.p80);
      const mix = (x: number, y: number) => x + (y - x) * t;
      return {
        p80Um,
        energyKwhT: mix(a.energyKwhT, b.energyKwhT),
        recoveryPct: mix(a.recoveryPct, b.recoveryPct),
        netUsdT: mix(a.netUsdT, b.netUsdT),
      };
    }
  }
  return at(sorted[sorted.length - 1]);
}

export interface WhatIfOptions {
  throughputTph?: number | null;
  /** Heures d'exploitation par an, pour annualiser l'écart. */
  operatingHoursPerYear?: number;
}

/**
 * Compare un P80 quelconque à la consigne recommandée, sur la courbe
 * économique déjà calculée. Rien n'est resimulé : on lit la même courbe que
 * celle affichée, ce qui garantit que le chiffre annoncé et le graphique
 * racontent la même histoire.
 */
export function whatIfP80(
  points: ScenarioPoint[],
  recommendedP80Um: number,
  candidateP80Um: number,
  opts: WhatIfOptions = {},
): WhatIfResult | null {
  const cand = interpolateScenarioPoint(points, candidateP80Um);
  const ref = interpolateScenarioPoint(points, recommendedP80Um);
  if (!cand || !ref) return null;

  const deltaNetUsdT = cand.netUsdT - ref.netUsdT;
  const deltaEnergyKwhT = cand.energyKwhT - ref.energyKwhT;
  const deltaRecoveryPct = cand.recoveryPct - ref.recoveryPct;

  const hours = opts.operatingHoursPerYear ?? 8000;
  const deltaNetUsdYear = opts.throughputTph != null && opts.throughputTph > 0
    ? deltaNetUsdT * opts.throughputTph * hours
    : null;

  // Seuil de matérialité : sous 0,05 $/t l'écart est dans le bruit des
  // hypothèses (prix de l'or, coût élec.) et n'autorise aucune conclusion.
  const negligible = Math.abs(deltaNetUsdT) < 0.05;
  const finer = candidateP80Um < recommendedP80Um;
  const better = !negligible && deltaNetUsdT > 0;

  let verdict: string;
  if (Math.abs(candidateP80Um - recommendedP80Um) < 1) {
    verdict = 'C\'est la consigne recommandée.';
  } else if (negligible) {
    verdict = `Équivalent économiquement (${deltaNetUsdT >= 0 ? '+' : ''}${dec(deltaNetUsdT, 2)} $/t) : l'écart est dans le bruit des hypothèses. Trancher sur la robustesse du circuit, pas sur ce chiffre.`;
  } else if (better) {
    verdict = `Meilleur de ${dec(deltaNetUsdT, 2)} $/t — ${finer ? 'broyer plus fin' : 'broyer plus grossier'} rapporte ici ${deltaRecoveryPct >= 0 ? `+${dec(deltaRecoveryPct, 2)} pt` : `${dec(deltaRecoveryPct, 2)} pt`} de récupération pour ${deltaEnergyKwhT >= 0 ? '+' : ''}${dec(deltaEnergyKwhT)} kWh/t. Vérifier que le circuit le permet avant de retenir cette valeur.`;
  } else {
    verdict = `Moins bon de ${dec(Math.abs(deltaNetUsdT), 2)} $/t : ${finer
      ? `le surcroît d'énergie (+${dec(deltaEnergyKwhT)} kWh/t) n'est pas payé par le gain de récupération (${deltaRecoveryPct >= 0 ? '+' : ''}${dec(deltaRecoveryPct, 2)} pt)`
      : `l'énergie économisée (${dec(deltaEnergyKwhT)} kWh/t) ne compense pas la récupération perdue (${dec(deltaRecoveryPct, 2)} pt)`}.`;
  }

  return {
    ...cand, reference: ref,
    deltaEnergyKwhT, deltaRecoveryPct, deltaNetUsdT, deltaNetUsdYear,
    better, verdict,
  };
}
