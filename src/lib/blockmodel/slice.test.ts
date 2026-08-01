import { describe, it, expect } from 'vitest';
import { sliceIndices, buildSlice, gradeColor, type SliceInputBlock } from './slice';

// Small 2×2×2 model, one block per cell.
function block(i: number, j: number, k: number, au: number): SliceInputBlock {
  return {
    i, j, k,
    cx: i * 10, cy: j * 10, cz: k * 10,
    au_g_t: au, density: 2.7, volume_m3: 1000,
    rock_type: k === 0 ? 'OX' : 'FR',
  };
}

const blocks: SliceInputBlock[] = [];
let g = 1;
for (let k = 0; k < 2; k++)
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++) blocks.push(block(i, j, k, g++));

describe('sliceIndices', () => {
  it('lists sorted unique indices per axis', () => {
    expect(sliceIndices(blocks, 'z')).toEqual([0, 1]);
    expect(sliceIndices(blocks, 'x')).toEqual([0, 1]);
    expect(sliceIndices(blocks, 'y')).toEqual([0, 1]);
  });
});

describe('buildSlice — plan view (z)', () => {
  it('extracts the bench k=0 as a 2×2 grid', () => {
    const s = buildSlice(blocks, 'z', 0)!;
    expect(s.cells).toHaveLength(4);
    expect(s.uMin).toBe(0); expect(s.uMax).toBe(1);
    expect(s.vMin).toBe(0); expect(s.vMax).toBe(1);
    expect(s.uLabel).toContain('Est');
    expect(s.vLabel).toContain('Nord');
    // Grades on k=0 are 1..4 → min 1, max 4.
    expect(s.gradeMin).toBe(1);
    expect(s.gradeMax).toBe(4);
  });

  it('returns null for an empty slice', () => {
    expect(buildSlice(blocks, 'z', 99)).toBeNull();
  });

  it('carries the dominant rock type per cell', () => {
    const s = buildSlice(blocks, 'z', 0)!;
    expect(s.cells.every(c => c.rock === 'OX')).toBe(true);
  });
});

describe('buildSlice — sections', () => {
  it('section x fixes i and spans (Nord, Élévation)', () => {
    const s = buildSlice(blocks, 'x', 0)!;
    expect(s.cells).toHaveLength(4);
    expect(s.uLabel).toContain('Nord');
    expect(s.vLabel).toContain('Élévation');
  });

  it('section y fixes j and spans (Est, Élévation)', () => {
    const s = buildSlice(blocks, 'y', 1)!;
    expect(s.cells).toHaveLength(4);
    expect(s.uLabel).toContain('Est');
  });
});

describe('buildSlice — tonnage-weighted grade aggregation', () => {
  it('averages colliding blocks by tonnage', () => {
    // Two blocks project onto the same plan cell (same i,j,k) with different grades.
    const a: SliceInputBlock = { i: 0, j: 0, k: 0, cx: 0, cy: 0, cz: 0, au_g_t: 2, density: 1, volume_m3: 100, rock_type: 'A' };
    const b: SliceInputBlock = { i: 0, j: 0, k: 0, cx: 0, cy: 0, cz: 0, au_g_t: 4, density: 1, volume_m3: 300, rock_type: 'A' };
    const s = buildSlice([a, b], 'z', 0)!;
    expect(s.cells).toHaveLength(1);
    // weighted: (2·100 + 4·300)/400 = 3.5
    expect(s.cells[0].grade).toBeCloseTo(3.5, 9);
    expect(s.cells[0].count).toBe(2);
    expect(s.cells[0].tonnes).toBe(400);
  });
});

describe('gradeColor', () => {
  it('returns an rgb string', () => {
    expect(gradeColor(1, 0, 10)).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });
  it('maps min and max to the palette endpoints', () => {
    expect(gradeColor(0, 0, 10)).toBe('rgb(30,58,95)');
    expect(gradeColor(10, 0, 10)).toBe('rgb(220,60,60)');
  });
  it('handles a degenerate range without dividing by zero', () => {
    expect(gradeColor(5, 5, 5)).toBe('rgb(30,58,95)');
  });
});
