import { describe, it, expect } from 'vitest';
import { transpose, matMul, matVec, solve, inverse, identity } from './linalg';

describe('linalg', () => {
  it('transposes', () => {
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
  });

  it('multiplies matrices', () => {
    expect(matMul([[1, 2], [3, 4]], [[5, 6], [7, 8]])).toEqual([[19, 22], [43, 50]]);
  });

  it('multiplies matrix by vector', () => {
    expect(matVec([[1, 2], [3, 4]], [1, 1])).toEqual([3, 7]);
  });

  it('solves a 2×2 system', () => {
    // 2x + y = 5 ; x + 3y = 10 → x = 1, y = 3
    const x = solve([[2, 1], [1, 3]], [5, 10])!;
    expect(x[0]).toBeCloseTo(1, 9);
    expect(x[1]).toBeCloseTo(3, 9);
  });

  it('solves a 3×3 system', () => {
    const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
    const b = [8, -11, -3];
    const x = solve(A, b)!; // known solution (2, 3, -1)
    expect(x[0]).toBeCloseTo(2, 9);
    expect(x[1]).toBeCloseTo(3, 9);
    expect(x[2]).toBeCloseTo(-1, 9);
  });

  it('returns null on a singular matrix', () => {
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });

  it('inverts a matrix (A·A⁻¹ = I)', () => {
    const A = [[4, 7], [2, 6]];
    const Ai = inverse(A)!;
    const prod = matMul(A, Ai);
    expect(prod[0][0]).toBeCloseTo(1, 9);
    expect(prod[0][1]).toBeCloseTo(0, 9);
    expect(prod[1][0]).toBeCloseTo(0, 9);
    expect(prod[1][1]).toBeCloseTo(1, 9);
  });

  it('returns null inverting a singular matrix', () => {
    expect(inverse([[1, 1], [1, 1]])).toBeNull();
  });

  it('builds identity', () => {
    expect(identity(3)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });
});
