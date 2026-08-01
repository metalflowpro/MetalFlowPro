// ─────────────────────────────────────────────────────────────────────────────
// Petite algèbre linéaire — module PUR, sans dépendance.
//
// Juste ce qu'il faut pour résoudre les équations normales d'une régression
// (X'X β = X'y) sur un petit nombre de variables (p ≲ 12). Élimination de Gauss
// avec pivot partiel : stable pour ces tailles, aucune librairie externe.
//
// Entièrement testable.
// ─────────────────────────────────────────────────────────────────────────────

export type Matrix = number[][];
export type Vector = number[];

/** Transposée d'une matrice n×m → m×n. */
export function transpose(a: Matrix): Matrix {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const out: Matrix = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) out[j][i] = a[i][j];
  return out;
}

/** Produit matriciel A(n×k) · B(k×m) → n×m. */
export function matMul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const k = b.length;
  const m = b[0]?.length ?? 0;
  const out: Matrix = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  return out;
}

/** Produit matrice·vecteur A(n×m) · x(m) → n. */
export function matVec(a: Matrix, x: Vector): Vector {
  return a.map(row => row.reduce((s, v, j) => s + v * x[j], 0));
}

/**
 * Résout le système linéaire A·x = b (A carrée n×n) par élimination de Gauss
 * avec pivot partiel. Renvoie `null` si la matrice est singulière (pivot ~0) —
 * un résultat réel, pas une erreur : cela signale une colinéarité parfaite entre
 * variables explicatives, que l'appelant doit traiter (régularisation ridge).
 */
export function solve(A: Matrix, b: Vector): Vector | null {
  const n = A.length;
  // Matrice augmentée [A | b], copiée pour ne pas muter l'entrée.
  const M: Matrix = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Pivot partiel : plus grande magnitude sous la diagonale.
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null; // singulière
    [M[col], M[pivot]] = [M[pivot], M[col]];

    // Élimination.
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  // Après élimination complète (Gauss-Jordan), chaque ligne i est réduite à
  // M[i][i]·x[i] = M[i][n], d'où x[i] = M[i][n] / M[i][i].
  const x: Vector = new Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

/** Matrice identité n×n. */
export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

/**
 * Inverse d'une matrice carrée n×n (Gauss-Jordan sur [A | I]). Renvoie `null`
 * si singulière. Utilisée pour la variance des prédictions (terme de levier
 * xᵀ (XᵀX)⁻¹ x d'un intervalle de prédiction).
 */
export function inverse(A: Matrix): Matrix | null {
  const n = A.length;
  const M: Matrix = A.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pv = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= pv;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = 0; c < 2 * n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map(row => row.slice(n));
}
