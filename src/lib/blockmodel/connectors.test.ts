import { describe, expect, it } from 'vitest';
import { detectMiningExportFormat, mapMiningHeaders, parseOmfBlocks } from './connectors';

describe('block model connectors', () => {
  it('detects common mining export families', () => {
    expect(detectMiningExportFormat(['X', 'Y', 'AU'], 'project_surpac.csv')).toBe('surpac');
    expect(detectMiningExportFormat(['DM_X', 'ORETYPE', 'AU'], 'blocks.csv')).toBe('datamine');
    expect(detectMiningExportFormat(['GEMS_DOMAIN', 'AU'], 'gemcom_export.csv')).toBe('gems');
    expect(detectMiningExportFormat([], 'model.omf.json')).toBe('omf');
  });

  it('maps vendor-specific headers to the canonical schema', () => {
    expect(mapMiningHeaders(['XCOORD', 'YCOORD', 'ZCOORD', 'AU_PPM', 'BULK_DENSITY', 'ORETYPE'])).toMatchObject({
      cx: 'XCOORD', cy: 'YCOORD', cz: 'ZCOORD', au_g_t: 'AU_PPM', density: 'BULK_DENSITY', rock_type: 'ORETYPE',
    });
  });

  it('reads an OMF-like JSON block payload', () => {
    const rows = parseOmfBlocks({ blocks: [{ x: 10, y: 20, z: 30, au: 1.2, density: 2.7, volume: 100, domain: 'Oxide' }] });
    expect(rows).toEqual([{ i: 0, j: 0, k: 0, cx: 10, cy: 20, cz: 30, density: 2.7, volume_m3: 100, au_g_t: 1.2, rock_type: 'Oxide' }]);
  });
});

