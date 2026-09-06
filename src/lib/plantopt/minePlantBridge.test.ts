import { describe, expect, it } from 'vitest';
import { evaluateMinePlantScenario } from './minePlantBridge';

describe('mine-plant bridge', () => {
  it('caps mine feed at plant capacity and calculates contained ounces', () => {
    const result = evaluateMinePlantScenario({ name: 'Base', tonnesPerHour: 1200, gradeGpt: 2, recoveryPct: 90, availabilityPct: 80 }, 1000, 8000);
    expect(result.throughputTph).toBe(1000);
    expect(result.utilizationPct).toBe(100);
    expect(result.annualContainedOz).toBeGreaterThan(0);
  });
});

