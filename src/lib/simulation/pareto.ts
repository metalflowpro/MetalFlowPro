// ─────────────────────────────────────────────────────────────────────────────
// Optimisation multi-objectifs — front de Pareto.
//
// Un circuit ne s'optimise pas sur un seul critère : gagner un point de
// récupération peut coûter 15 % d'énergie et autant de CO₂. Agréger ces
// objectifs en une note unique impose des poids arbitraires et masque les
// arbitrages.
//
// La démarche de Pareto ne tranche pas à la place de l'ingénieur : elle écarte
// les solutions DOMINÉES (celles qu'une autre bat sur tous les critères à la
// fois) et présente le front des compromis non dominés. On y ajoute :
//   • la distance d'encombrement, pour garder un front bien réparti ;
//   • le point de compromis (« genou »), là où la courbure du front est
//     maximale — au-delà, chaque gain se paie disproportionnellement cher.
//
// L'optimiseur du projet déclarait un mode 'pareto' qui retombait en réalité
// sur la seule récupération : ce module lui donne son vrai sens.
//
// Module PUR : pas de solveur, pas de React — il opère sur des vecteurs
// d'objectifs déjà évalués. Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export type ObjectiveDirection = 'maximize' | 'minimize';

export interface ObjectiveSpec {
  key: string;
  label: string;
  unit: string;
  direction: ObjectiveDirection;
}

/** Objectifs standard d'un circuit de traitement. */
export const STANDARD_OBJECTIVES: ObjectiveSpec[] = [
  { key: 'recovery', label: 'Récupération',    unit: '%',      direction: 'maximize' },
  { key: 'energy',   label: 'Énergie',          unit: 'kWh/t',  direction: 'minimize' },
  { key: 'co2',      label: 'Empreinte CO₂',    unit: 'kg/t',   direction: 'minimize' },
  { key: 'opex',     label: 'OPEX',             unit: '$/t',    direction: 'minimize' },
];

export interface Candidate {
  id: string;
  label?: string;
  /** Valeurs des objectifs, par clé. */
  objectives: Record<string, number>;
  /** Réglages ayant produit ce point (informatif). */
  settings?: Record<string, number | string>;
}

export interface ParetoPoint extends Candidate {
  /** Rang 0 = front optimal ; 1 = front suivant, etc. */
  rank: number;
  /** Distance d'encombrement — Infinity aux extrémités du front. */
  crowding: number;
  /** Vrai si le point appartient au front non dominé. */
  onFront: boolean;
  /** Distance normalisée au point idéal (0 = idéal inatteignable). */
  distanceToIdeal: number;
}

export interface ParetoResult {
  points: ParetoPoint[];
  /** Front non dominé, trié par le premier objectif. */
  front: ParetoPoint[];
  /** Meilleur compromis : point du front le plus proche de l'idéal. */
  knee: ParetoPoint | null;
  /** Meilleur point pour chaque objectif pris isolément. */
  extremes: Record<string, ParetoPoint | null>;
  objectives: ObjectiveSpec[];
  /** Nombre de candidats écartés car dominés. */
  dominatedCount: number;
  summary: string;
  /**
   * Description de la grille réellement balayée. Absente quand le front est
   * construit à partir de candidats fournis directement plutôt que balayés.
   */
  scan?: ScanCoverage;
}

/**
 * Couverture du balayage. Permet de distinguer un front établi sur la grille
 * complète d'un front établi sur une grille amputée — la nuance change
 * l'interprétation : un front partiel peut manquer le vrai compromis.
 */
export interface ScanCoverage {
  /** Valeurs par variable demandées à l'appel. */
  requestedSteps: number;
  /** Valeurs par variable effectivement utilisées, après réduction éventuelle. */
  steps: number;
  /** Scénarios évalués. */
  evaluated: number;
  /** true si la grille a dû être amputée : le front n'est alors pas garanti. */
  truncated: boolean;
}

/**
 * `a` domine `b` s'il est au moins aussi bon sur tous les objectifs et
 * strictement meilleur sur au moins un.
 */
export function dominates(a: Candidate, b: Candidate, objectives: ObjectiveSpec[]): boolean {
  let strictlyBetter = false;
  for (const o of objectives) {
    const va = a.objectives[o.key];
    const vb = b.objectives[o.key];
    if (va == null || vb == null || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
    const better = o.direction === 'maximize' ? va > vb : va < vb;
    const worse  = o.direction === 'maximize' ? va < vb : va > vb;
    if (worse) return false;
    if (better) strictlyBetter = true;
  }
  return strictlyBetter;
}

/** Tri par non-domination : assigne un rang à chaque candidat (0 = front optimal). */
export function nonDominatedSort(candidates: Candidate[], objectives: ObjectiveSpec[]): number[] {
  const n = candidates.length;
  const ranks = new Array(n).fill(0);
  let remaining = candidates.map((_, i) => i);
  let rank = 0;

  while (remaining.length > 0) {
    const front = remaining.filter(i =>
      !remaining.some(j => j !== i && dominates(candidates[j], candidates[i], objectives)),
    );
    // Sécurité : si aucun point n'est non dominé (impossible en théorie, mais
    // des valeurs non finies pourraient le provoquer), on arrête pour ne pas
    // boucler indéfiniment.
    if (front.length === 0) {
      for (const i of remaining) ranks[i] = rank;
      break;
    }
    for (const i of front) ranks[i] = rank;
    const inFront = new Set(front);
    remaining = remaining.filter(i => !inFront.has(i));
    rank++;
  }
  return ranks;
}

/**
 * Distance d'encombrement (NSGA-II) : mesure l'espace autour de chaque point
 * du front. Les extrémités reçoivent Infinity pour ne jamais être écartées —
 * ce sont les solutions les plus performantes sur un objectif donné.
 */
export function crowdingDistance(front: Candidate[], objectives: ObjectiveSpec[]): number[] {
  const n = front.length;
  const dist = new Array(n).fill(0);
  if (n <= 2) return new Array(n).fill(Infinity);

  for (const o of objectives) {
    const order = front
      .map((c, i) => ({ i, v: c.objectives[o.key] }))
      .filter(x => Number.isFinite(x.v))
      .sort((a, b) => a.v - b.v);
    if (order.length < 2) continue;

    dist[order[0].i] = Infinity;
    dist[order[order.length - 1].i] = Infinity;

    const span = order[order.length - 1].v - order[0].v;
    if (span === 0) continue;

    for (let k = 1; k < order.length - 1; k++) {
      dist[order[k].i] += (order[k + 1].v - order[k - 1].v) / span;
    }
  }
  return dist;
}

/** Normalise une valeur en « qualité » 0–1 (1 = meilleur), selon le sens de l'objectif. */
function quality(value: number, min: number, max: number, direction: ObjectiveDirection): number {
  if (!Number.isFinite(value) || max === min) return 1;
  const t = (value - min) / (max - min);
  return direction === 'maximize' ? t : 1 - t;
}

/**
 * Construit le front de Pareto et désigne le meilleur compromis.
 *
 * Le compromis retenu est le point du front dont la distance euclidienne au
 * point idéal (le meilleur de chaque objectif, généralement inatteignable) est
 * minimale, une fois les objectifs normalisés — sans quoi une grandeur en
 * dollars écraserait un pourcentage.
 */
export function buildParetoFront(
  candidates: Candidate[],
  objectives: ObjectiveSpec[] = STANDARD_OBJECTIVES,
): ParetoResult {
  if (candidates.length === 0) {
    return {
      points: [], front: [], knee: null, extremes: {}, objectives,
      dominatedCount: 0,
      summary: 'Aucun scénario à comparer.',
    };
  }

  // On ne garde que les objectifs réellement présents dans les candidats.
  const active = objectives.filter(o =>
    candidates.some(c => Number.isFinite(c.objectives[o.key])),
  );
  const specs = active.length > 0 ? active : objectives;

  const ranks = nonDominatedSort(candidates, specs);

  // Bornes par objectif, pour normaliser.
  const bounds: Record<string, { min: number; max: number }> = {};
  for (const o of specs) {
    const vals = candidates.map(c => c.objectives[o.key]).filter(Number.isFinite);
    bounds[o.key] = vals.length
      ? { min: Math.min(...vals), max: Math.max(...vals) }
      : { min: 0, max: 0 };
  }

  const frontIdx = candidates.map((_, i) => i).filter(i => ranks[i] === 0);
  const frontCandidates = frontIdx.map(i => candidates[i]);
  const crowd = crowdingDistance(frontCandidates, specs);
  const crowdBy = new Map<number, number>();
  frontIdx.forEach((idx, k) => crowdBy.set(idx, crowd[k]));

  const points: ParetoPoint[] = candidates.map((c, i) => {
    // Distance au point idéal, dans l'espace des qualités normalisées.
    let sq = 0;
    for (const o of specs) {
      const q = quality(c.objectives[o.key], bounds[o.key].min, bounds[o.key].max, o.direction);
      sq += (1 - q) ** 2;
    }
    return {
      ...c,
      rank: ranks[i],
      crowding: crowdBy.get(i) ?? 0,
      onFront: ranks[i] === 0,
      distanceToIdeal: +Math.sqrt(sq / specs.length).toFixed(4),
    };
  });

  const front = points
    .filter(p => p.onFront)
    .sort((a, b) => (a.objectives[specs[0].key] ?? 0) - (b.objectives[specs[0].key] ?? 0));

  const knee = front.length
    ? front.reduce((best, p) => (p.distanceToIdeal < best.distanceToIdeal ? p : best), front[0])
    : null;

  const extremes: Record<string, ParetoPoint | null> = {};
  for (const o of specs) {
    const withVal = points.filter(p => Number.isFinite(p.objectives[o.key]));
    extremes[o.key] = withVal.length
      ? withVal.reduce((best, p) => {
          const better = o.direction === 'maximize'
            ? p.objectives[o.key] > best.objectives[o.key]
            : p.objectives[o.key] < best.objectives[o.key];
          return better ? p : best;
        }, withVal[0])
      : null;
  }

  const dominatedCount = points.length - front.length;
  const summary = front.length === 0
    ? 'Aucune solution non dominée identifiée.'
    : `${front.length} compromis non dominé(s) sur ${points.length} scénarios (${dominatedCount} dominé(s), écartés).` +
      (knee ? ` Meilleur compromis : ${knee.label ?? knee.id}.` : '');

  return { points, front, knee, extremes, objectives: specs, dominatedCount, summary };
}

/**
 * Facteur d'émission par défaut du réseau électrique (kg CO₂ / kWh).
 * Réseau québécois, très hydraulique — d'où une valeur faible. À ajuster selon
 * le pays d'implantation : c'est un paramètre, pas une constante universelle.
 */
export const DEFAULT_GRID_CO2_KG_PER_KWH = 0.035;

/** Empreinte CO₂ (kg/t) d'une consommation spécifique (kWh/t). */
export function co2FromEnergy(energyKwhT: number, gridFactor = DEFAULT_GRID_CO2_KG_PER_KWH): number {
  return Math.max(0, energyKwhT) * gridFactor;
}
