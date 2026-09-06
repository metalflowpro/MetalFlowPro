import { describe, expect, it } from 'vitest';
import { assessResourceQuality } from './quality';

const model = { type: 'spherical' as const, nugget: 0.1, sill: 1, range: 100 };

describe('assessResourceQuality', () => {
  it('passes a well-covered kriging run', () => {
    const result = assessResourceQuality({
      method: 'kriging', nComposites: 40, nBlocks: 100, nEstimated: 90,
      measured: 20, indicated: 40, variogram: model,
      crossValidation: { n: 40, meanError: 0.01, rmse: 0.2, correlation: 0.9 },
      compositeStdev: 1, gradeTonnagePoints: 5,
    });
    expect(result.status).toBe('pass');
    expect(result.coveragePct).toBe(90);
  });

  it('fails when the run cannot support an M+I resource', () => {
    const result = assessResourceQuality({
      method: 'kriging', nComposites: 2, nBlocks: 100, nEstimated: 20,
      measured: 0, indicated: 0, variogram: null,
      crossValidation: null, compositeStdev: 0, gradeTonnagePoints: 0,
    });
    expect(result.status).toBe('fail');
    expect(result.checks.filter(c => c.status === 'fail').map(c => c.id)).toEqual(
      expect.arrayContaining(['composites', 'coverage', 'variogram', 'resource-base', 'grade-tonnage']),
    );
  });

  it('warns transparently for IDW instead of presenting it as kriging', () => {
    const result = assessResourceQuality({
      method: 'idw', nComposites: 25, nBlocks: 10, nEstimated: 10,
      measured: 1, indicated: 2, variogram: null,
      crossValidation: null, compositeStdev: 1, gradeTonnagePoints: 2,
    });
    expect(result.status).toBe('warn');
    expect(result.checks.find(c => c.id === 'variogram')?.detail).toContain('IDW');
  });
});
