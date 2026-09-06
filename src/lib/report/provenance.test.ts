import { describe, expect, it } from 'vitest';
import { buildProvenanceManifest } from './provenance';

describe('report provenance', () => {
  it('builds one lineage record per source', () => {
    expect(buildProvenanceManifest('S14', ['resource_estimation_runs', 'bm_blocks'], 'classification CIM', '2026-01-01T00:00:00Z')).toHaveLength(2);
    expect(buildProvenanceManifest('S14', ['', 'bm_blocks'], 'calc', 't')).toEqual([{ section: 'S14', source: 'bm_blocks', calculation: 'calc', generatedAt: 't' }]);
  });
});

