export type MiningExportFormat = 'surpac' | 'datamine' | 'gems' | 'omf' | 'generic';

export interface NormalizedBlockRow {
  i: number; j: number; k: number;
  cx: number; cy: number; cz: number;
  density: number; volume_m3: number; au_g_t: number;
  rock_type: string | null;
}

const ALIASES: Record<string, string[]> = {
  i: ['i', 'ix', 'icent', 'col', 'xi', 'bi', 'block_i'],
  j: ['j', 'jy', 'jcent', 'row', 'yj', 'bj', 'block_j'],
  k: ['k', 'kz', 'kcent', 'lev', 'bk', 'bench', 'block_k'],
  cx: ['cx', 'xc', 'x', 'xcentre', 'xcent', 'xm', 'xcoord', 'east', 'easting', 'x_coordinate'],
  cy: ['cy', 'yc', 'y', 'ycentre', 'ycent', 'ym', 'ycoord', 'north', 'northing', 'y_coordinate'],
  cz: ['cz', 'zc', 'z', 'zcentre', 'zcent', 'zm', 'zcoord', 'elev', 'elevation', 'rl', 'z_coordinate'],
  density: ['density', 'dens', 'sg', 'sp_grav', 'sg_t', 'densite', 'bulk_density'],
  volume_m3: ['volume_m3', 'vol', 'volume', 'vol_m3', 'volm3', 'block_volume'],
  au_g_t: ['au_g_t', 'au', 'au_gt', 'au_ppm', 'gold', 'gold_g_t', 'grade', 'au_grade', 'aug_t', 'teneur', 'teneur_au', 'au_ppm'],
  rock_type: ['rock_type', 'rock', 'rocktype', 'litho', 'lithology', 'lith', 'code', 'domain', 'ore_type', 'oretype', 'type_roche'],
};

function norm(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\-/\\()]/g, '_').replace(/_+/g, '_').trim();
}

export function detectMiningExportFormat(headers: string[], fileName = ''): MiningExportFormat {
  const text = `${fileName} ${headers.join(' ')}`.toLowerCase();
  if (text.includes('omf') || text.includes('open mining format')) return 'omf';
  if (text.includes('surpac') || text.includes('sgems') || text.includes('pointid')) return 'surpac';
  if (text.includes('datamine') || text.includes('dm_') || text.includes('oretype')) return 'datamine';
  if (text.includes('gems') || text.includes('gemcom')) return 'gems';
  return 'generic';
}

export function mapMiningHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const header of headers) {
    const key = norm(header);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (!map[field] && aliases.some(alias => key === alias || key.endsWith(`_${alias}`))) map[field] = header;
    }
  }
  return map;
}

export function parseOmfBlocks(payload: unknown): NormalizedBlockRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as { blocks?: unknown; data?: unknown };
  const rows = Array.isArray(root.blocks) ? root.blocks : Array.isArray(root.data) ? root.data : [];
  return rows.flatMap(row => {
    if (!row || typeof row !== 'object') return [];
    const source = row as Record<string, unknown>;
    const number = (...keys: string[]) => {
      for (const key of keys) { const value = Number(source[key]); if (Number.isFinite(value)) return value; }
      return 0;
    };
    const text = (...keys: string[]) => keys.map(key => source[key]).find(value => value != null && String(value).trim() !== '') as string | undefined;
    return [{
      i: number('i', 'ix', 'block_i'), j: number('j', 'jy', 'block_j'), k: number('k', 'kz', 'block_k'),
      cx: number('cx', 'x', 'xcentre', 'x_center'), cy: number('cy', 'y', 'ycentre', 'y_center'), cz: number('cz', 'z', 'zcentre', 'z_center'),
      density: number('density', 'sg', 'bulk_density'), volume_m3: number('volume_m3', 'volume', 'vol'), au_g_t: number('au_g_t', 'au', 'gold', 'grade'),
      rock_type: text('rock_type', 'rock', 'domain', 'lithology') ?? null,
    } satisfies NormalizedBlockRow];
  });
}

