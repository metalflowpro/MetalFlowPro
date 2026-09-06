import { describe, expect, it } from 'vitest';
import { buildSensitivityTornado } from './financialDrivers';

describe('buildSensitivityTornado', () => {
  it('ranks drivers by absolute correlation and centers them on the base', () => {
    const result = buildSensitivityTornado(
      [
        { name: 'opex', correlation: -0.4 },
        { name: 'goldPrice', correlation: 0.9 },
        { name: 'grade', correlation: 0.6 },
      ],
      100,
      20,
      { goldPrice: 'Prix de l’or', grade: 'Teneur', opex: 'OPEX' },
    );

    expect(result.map(item => item.label)).toEqual(['Prix de l’or', 'Teneur', 'OPEX']);
    expect(result[0].low).toBeCloseTo(82);
    expect(result[0].high).toBeCloseTo(118);
    expect(result[2].correlation).toBe(-0.4);
  });

  it('returns no chart when there is no usable sensitivity', () => {
    expect(buildSensitivityTornado(undefined, 100, 20, {})).toEqual([]);
    expect(buildSensitivityTornado([{ name: 'x', correlation: 0 }], 100, 20, {})).toEqual([
      { label: 'x', low: 100, high: 100, correlation: 0 },
    ]);
  });
});

