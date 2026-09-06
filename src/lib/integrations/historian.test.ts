import { describe, expect, it } from 'vitest';
import { latestByTag, normalizeHistorianRows } from './historian';

describe('historian adapter', () => {
  it('normalizes common historian fields and drops invalid rows', () => {
    const readings = normalizeHistorianRows([{ tag: 'Mill/Feed', ts: '2026-01-01T00:00:00Z', val: '1200', unit: 't/h', status: 'GOOD' }, { tag: '', value: 2 }], 'opcua:test');
    expect(readings).toEqual([{ tag: 'Mill/Feed', timestamp: '2026-01-01T00:00:00Z', value: 1200, unit: 't/h', quality: 'good', source: 'opcua:test' }]);
  });

  it('keeps the latest reading per tag', () => {
    const readings = normalizeHistorianRows([{ tag: 'pH', timestamp: '2026-01-01T00:00:00Z', value: 10 }, { tag: 'pH', timestamp: '2026-01-01T01:00:00Z', value: 10.5 }]);
    expect(latestByTag(readings).get('pH')?.value).toBe(10.5);
  });
});

