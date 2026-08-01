// ─────────────────────────────────────────────────────────────────────────────
// Découpage d'un modèle de blocs en coupes 2D — module PUR.
//
// Transforme la nuée de blocs (i,j,k + coordonnées + teneur) en une grille 2D
// exploitable pour une visualisation « 3D légère » : vue en plan (banc Z) ou
// coupe verticale (section E-O ou N-S). C'est la couche calcul du visualiseur de
// coupes ; elle ne dépend ni de React ni de Supabase et se teste seule.
//
// La teneur d'une cellule est la moyenne pondérée par le tonnage des blocs qui
// s'y projettent (plusieurs blocs peuvent partager une cellule d'une section).
// ─────────────────────────────────────────────────────────────────────────────

export interface SliceInputBlock {
  i: number; j: number; k: number;
  cx: number; cy: number; cz: number;
  au_g_t: number;
  density: number;
  volume_m3: number;
  rock_type?: string | null;
}

/** 'z' = vue en plan (banc horizontal) ; 'x'/'y' = coupes verticales. */
export type SliceAxis = 'z' | 'x' | 'y';

export interface SliceCell {
  /** Indices de grille dans la coupe (colonne, ligne). */
  u: number;
  v: number;
  /** Teneur pondérée tonnage (g/t). */
  grade: number;
  /** Tonnage total de la cellule (t). */
  tonnes: number;
  /** Nombre de blocs projetés. */
  count: number;
  rock: string | null;
  /** Coordonnées réelles moyennes (m) — pour les libellés/tooltip. */
  uCoord: number;
  vCoord: number;
}

export interface Slice {
  axis: SliceAxis;
  /** Valeur de l'index fixé (k pour 'z', i pour 'x', j pour 'y'). */
  index: number;
  cells: SliceCell[];
  uMin: number; uMax: number;
  vMin: number; vMax: number;
  gradeMin: number; gradeMax: number;
  totalTonnes: number;
  /** Libellés d'axes selon l'orientation. */
  uLabel: string; vLabel: string;
}

/** Configuration d'axes par orientation : index fixé, axes u/v et libellés. */
const AXIS_MAP: Record<SliceAxis, {
  fixed: (b: SliceInputBlock) => number;
  u: (b: SliceInputBlock) => number;
  v: (b: SliceInputBlock) => number;
  uc: (b: SliceInputBlock) => number;
  vc: (b: SliceInputBlock) => number;
  uLabel: string; vLabel: string;
}> = {
  z: { fixed: b => b.k, u: b => b.i, v: b => b.j, uc: b => b.cx, vc: b => b.cy, uLabel: 'Est (X)',  vLabel: 'Nord (Y)' },
  x: { fixed: b => b.i, u: b => b.j, v: b => b.k, uc: b => b.cy, vc: b => b.cz, uLabel: 'Nord (Y)', vLabel: 'Élévation (Z)' },
  y: { fixed: b => b.j, u: b => b.i, v: b => b.k, uc: b => b.cx, vc: b => b.cz, uLabel: 'Est (X)',  vLabel: 'Élévation (Z)' },
};

/** Indices de coupe disponibles pour un axe, triés croissant (dédupliqués). */
export function sliceIndices(blocks: SliceInputBlock[], axis: SliceAxis): number[] {
  const cfg = AXIS_MAP[axis];
  return [...new Set(blocks.map(cfg.fixed))].sort((a, b) => a - b);
}

/**
 * Construit une coupe 2D à l'index donné. Renvoie `null` si aucun bloc ne s'y
 * trouve. Les cellules dont le tonnage total est nul sont conservées avec une
 * teneur 0 (bloc de densité/volume manquants) plutôt que supprimées.
 */
export function buildSlice(blocks: SliceInputBlock[], axis: SliceAxis, index: number): Slice | null {
  const cfg = AXIS_MAP[axis];
  const inSlice = blocks.filter(b => cfg.fixed(b) === index);
  if (inSlice.length === 0) return null;

  const acc = new Map<string, { u: number; v: number; gt: number; t: number; count: number; ucSum: number; vcSum: number; rock: Map<string, number> }>();
  for (const b of inSlice) {
    const u = cfg.u(b), v = cfg.v(b);
    const key = `${u}|${v}`;
    const t = (b.density || 0) * (b.volume_m3 || 0);
    let cell = acc.get(key);
    if (!cell) { cell = { u, v, gt: 0, t: 0, count: 0, ucSum: 0, vcSum: 0, rock: new Map() }; acc.set(key, cell); }
    cell.gt += b.au_g_t * t;
    cell.t += t;
    cell.count += 1;
    cell.ucSum += cfg.uc(b);
    cell.vcSum += cfg.vc(b);
    const r = b.rock_type ?? '—';
    cell.rock.set(r, (cell.rock.get(r) ?? 0) + t);
  }

  const cells: SliceCell[] = [];
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  let gradeMin = Infinity, gradeMax = -Infinity, totalTonnes = 0;
  for (const c of acc.values()) {
    const grade = c.t > 0 ? c.gt / c.t : 0;
    // Roche dominante par tonnage.
    let rock: string | null = null, best = -1;
    for (const [r, w] of c.rock) if (w > best) { best = w; rock = r; }
    cells.push({ u: c.u, v: c.v, grade, tonnes: c.t, count: c.count, rock, uCoord: c.ucSum / c.count, vCoord: c.vcSum / c.count });
    uMin = Math.min(uMin, c.u); uMax = Math.max(uMax, c.u);
    vMin = Math.min(vMin, c.v); vMax = Math.max(vMax, c.v);
    gradeMin = Math.min(gradeMin, grade); gradeMax = Math.max(gradeMax, grade);
    totalTonnes += c.t;
  }

  return {
    axis, index, cells,
    uMin, uMax, vMin, vMax,
    gradeMin: gradeMin === Infinity ? 0 : gradeMin,
    gradeMax: gradeMax === -Infinity ? 0 : gradeMax,
    totalTonnes,
    uLabel: cfg.uLabel, vLabel: cfg.vLabel,
  };
}

// ── Échelle de couleur teneur (bleu froid → rouge chaud) ────────────────────

const GRADE_STOPS: [number, number, number][] = [
  [30, 58, 95],    // bleu profond (stérile)
  [37, 99, 143],   // bleu
  [16, 150, 129],  // teal
  [132, 204, 22],  // vert-jaune
  [245, 158, 11],  // ambre
  [220, 60, 60],   // rouge (haute teneur)
];

/**
 * Couleur d'une teneur, normalisée entre min et max via une racine carrée
 * (perceptuellement plus lisible sur des distributions très asymétriques).
 */
export function gradeColor(grade: number, min: number, max: number): string {
  if (max <= min) return `rgb(${GRADE_STOPS[0].join(',')})`;
  const tRaw = (grade - min) / (max - min);
  const t = Math.sqrt(Math.max(0, Math.min(1, tRaw)));
  const seg = t * (GRADE_STOPS.length - 1);
  const i = Math.min(GRADE_STOPS.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = GRADE_STOPS[i], b = GRADE_STOPS[i + 1];
  const mix = (x: number, y: number) => Math.round(x + (y - x) * f);
  return `rgb(${mix(a[0], b[0])},${mix(a[1], b[1])},${mix(a[2], b[2])})`;
}
