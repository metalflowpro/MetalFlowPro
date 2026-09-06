import { describe, expect, it } from 'vitest';
import { controlChart, duplicatePrecision } from './qaqcAdvanced';

describe('advanced QA/QC', () => {
  it('calculates control limits and detects out-of-control values', () => {
    const chart = controlChart([10, 10.2, 9.8, 10.1, 40]);
    expect(chart.n).toBe(5);
    expect(chart.violations).toContain(4);
    expect(chart.status).toBe('fail');
  });

  it('measures duplicate precision using relative difference', () => {
    expect(duplicatePrecision([{ original: 10, duplicate: 11 }])).toMatchObject({ pairs: 1, status: 'pass' });
    expect(duplicatePrecision([{ original: 10, duplicate: 20 }]).status).toBe('warn');
  });
});

