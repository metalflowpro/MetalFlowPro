import { describe, it, expect } from 'vitest';
import { kmeansGeomet, suggestK, type ClusterInput } from './geometClustering';

const twoGroups: ClusterInput[] = [
  { id: 'a1', features: [0, 0] }, { id: 'a2', features: [0.5, 0.3] }, { id: 'a3', features: [0.2, -0.1] },
  { id: 'b1', features: [10, 10] }, { id: 'b2', features: [9.5, 10.2] }, { id: 'b3', features: [10.3, 9.8] },
];

describe('kmeansGeomet', () => {
  it('sépare deux populations bien distinctes', () => {
    const r = kmeansGeomet(twoGroups, 2)!;
    expect(r).not.toBeNull();
    // Les 3 premiers dans un cluster, les 3 derniers dans l'autre.
    expect(r.assignments[0]).toBe(r.assignments[1]);
    expect(r.assignments[1]).toBe(r.assignments[2]);
    expect(r.assignments[3]).toBe(r.assignments[4]);
    expect(r.assignments[4]).toBe(r.assignments[5]);
    expect(r.assignments[0]).not.toBe(r.assignments[3]);
    expect(r.sizes.sort()).toEqual([3, 3]);
    expect(r.silhouette).toBeGreaterThan(0.5);
  });

  it('est déterministe (même entrée → même sortie)', () => {
    const a = kmeansGeomet(twoGroups, 2)!;
    const b = kmeansGeomet(twoGroups, 2)!;
    expect(a.assignments).toEqual(b.assignments);
  });

  it('centroïdes en unités réelles', () => {
    const r = kmeansGeomet(twoGroups, 2)!;
    const cx = r.centroids.map(c => c[0]).sort((a, b) => a - b);
    expect(cx[0]).toBeLessThan(3);   // groupe A ~0
    expect(cx[1]).toBeGreaterThan(7); // groupe B ~10
  });

  it('k invalide → null', () => {
    expect(kmeansGeomet(twoGroups, 0)).toBeNull();
    expect(kmeansGeomet(twoGroups, 99)).toBeNull();
    expect(kmeansGeomet([{ id: 'x', features: [1] }], 2)).toBeNull();
  });
});

describe('suggestK', () => {
  it('suggère k=2 pour des données à deux groupes', () => {
    const s = suggestK(twoGroups, 4)!;
    expect(s.k).toBe(2);
    expect(s.silhouette).toBeGreaterThan(0.5);
  });
  it('trop peu d’échantillons → null', () => {
    expect(suggestK([{ id: 'x', features: [1] }, { id: 'y', features: [2] }])).toBeNull();
  });
});
