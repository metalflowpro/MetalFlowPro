// ─────────────────────────────────────────────────────────────────────────────
// Desurvey — trace 3D d'un trou de forage par « minimum curvature ».
//
// Un trou est décrit par un collier (X,Y,Z de départ) et des stations de survey
// (profondeur mesurée MD, azimut, pendage). Le desurvey reconstitue les
// coordonnées le long du trou : c'est l'étape qui donne une position 3D à chaque
// intervalle d'analyse, donc le point d'entrée spatial de l'estimation de
// ressource. La méthode « minimum curvature » est le standard de l'industrie :
// elle relie deux stations par un arc de cercle plutôt qu'un segment droit.
//
// Conventions :
//   • azimut : degrés horaires depuis le Nord (0 = +Y, 90 = +X/Est).
//   • pendage (dip) : degrés depuis l'HORIZONTALE, NÉGATIF vers le bas
//     (convention Morrison « -45° » = 45° sous l'horizontale). Un trou vertical
//     descendant a un pendage de -90°.
//   • Z = élévation (positive vers le haut) : descendre diminue Z.
//
// Fonctions PURES — aucun import React/Supabase.
// ─────────────────────────────────────────────────────────────────────────────

/** Collier : origine 3D du trou et profondeur totale optionnelle. */
export interface Collar {
  holeId: string;
  x: number;
  y: number;
  z: number;
  maxDepth?: number;
}

/** Station de survey le long du trou. */
export interface SurveyStation {
  /** Profondeur mesurée depuis le collier (m). */
  depth: number;
  /** Azimut (degrés horaires depuis le Nord). */
  azimuth: number;
  /** Pendage (degrés sous l'horizontale, négatif vers le bas). */
  dip: number;
}

/** Point de la trace desurveyée : profondeur mesurée + coordonnées. */
export interface TracePoint {
  md: number;
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;

/** Vecteur unitaire de direction (Est, Nord, Haut) pour un azimut/pendage donnés. */
function directionVector(azimuthDeg: number, dipDeg: number): { e: number; n: number; u: number } {
  // Inclinaison sous l'horizontale (positive vers le bas).
  const inclDown = -dipDeg * DEG;
  const horiz = Math.cos(inclDown);
  const az = azimuthDeg * DEG;
  return {
    e: horiz * Math.sin(az),
    n: horiz * Math.cos(az),
    u: -Math.sin(inclDown), // vers le bas → composante verticale négative (Z diminue)
  };
}

/** Facteur de ratio « minimum curvature » entre deux stations (1 si dogleg nul). */
function ratioFactor(dogleg: number): number {
  if (dogleg < 1e-9) return 1;
  return (2 / dogleg) * Math.tan(dogleg / 2);
}

/**
 * Reconstitue la trace 3D d'un trou.
 *
 * - Les stations sont triées par profondeur.
 * - Si la première station est sous le collier (depth > 0), on prolonge
 *   tangentiellement depuis le collier avec l'orientation de cette station.
 * - Un trou sans station est traité comme vertical descendant (dip -90°) — cas
 *   dégradé signalé plutôt que silencieux : la trace reste droite vers le bas.
 *
 * @throws si le collier n'a pas de coordonnées finies.
 */
export function desurveyHole(collar: Collar, surveys: SurveyStation[]): TracePoint[] {
  if (![collar.x, collar.y, collar.z].every(Number.isFinite)) {
    throw new Error(`Collier « ${collar.holeId} » : coordonnées non finies.`);
  }

  const sorted = [...surveys].sort((a, b) => a.depth - b.depth);

  // Construire la liste des stations effectives, en partant du collier (MD 0).
  const stations: SurveyStation[] =
    sorted.length === 0
      ? [{ depth: 0, azimuth: 0, dip: -90 }, { depth: collar.maxDepth ?? 0, azimuth: 0, dip: -90 }]
      : sorted[0].depth > 0
        ? [{ depth: 0, azimuth: sorted[0].azimuth, dip: sorted[0].dip }, ...sorted]
        : sorted;

  const trace: TracePoint[] = [{ md: stations[0].depth, x: collar.x, y: collar.y, z: collar.z }];

  for (let i = 1; i < stations.length; i++) {
    const s1 = stations[i - 1];
    const s2 = stations[i];
    const dMd = s2.depth - s1.depth;
    if (dMd <= 0) continue; // stations dupliquées : ignorer

    const v1 = directionVector(s1.azimuth, s1.dip);
    const v2 = directionVector(s2.azimuth, s2.dip);

    // Angle de dogleg entre les deux directions (produit scalaire des unitaires).
    const dot = Math.min(1, Math.max(-1, v1.e * v2.e + v1.n * v2.n + v1.u * v2.u));
    const dogleg = Math.acos(dot);
    const rf = ratioFactor(dogleg);

    const prev = trace[trace.length - 1];
    const half = (dMd / 2) * rf;
    trace.push({
      md: s2.depth,
      x: prev.x + half * (v1.e + v2.e),
      y: prev.y + half * (v1.n + v2.n),
      z: prev.z + half * (v1.u + v2.u),
    });
  }

  return trace;
}

/**
 * Coordonnées à une profondeur mesurée donnée, par interpolation le long de la
 * trace. Exact pour un trou droit (orientation constante) ; approximation
 * linéaire entre stations dans un dogleg — suffisant à l'échelle faisabilité,
 * à raffiner si un survey très courbe l'exige.
 */
export function pointAtDepth(trace: TracePoint[], md: number): { x: number; y: number; z: number } {
  if (trace.length === 0) throw new Error('Trace vide.');
  if (md <= trace[0].md) return { x: trace[0].x, y: trace[0].y, z: trace[0].z };
  const last = trace[trace.length - 1];
  if (md >= last.md) return { x: last.x, y: last.y, z: last.z };

  for (let i = 1; i < trace.length; i++) {
    const a = trace[i - 1];
    const b = trace[i];
    if (md <= b.md) {
      const t = (md - a.md) / (b.md - a.md);
      return {
        x: a.x + t * (b.x - a.x),
        y: a.y + t * (b.y - a.y),
        z: a.z + t * (b.z - a.z),
      };
    }
  }
  return { x: last.x, y: last.y, z: last.z };
}

/** Point milieu (X,Y,Z) et longueur d'un intervalle [from, to] le long de la trace. */
export function intervalMidpoint(
  trace: TracePoint[],
  from: number,
  to: number,
): { x: number; y: number; z: number; length: number } {
  const mid = (from + to) / 2;
  const p = pointAtDepth(trace, mid);
  return { ...p, length: to - from };
}
