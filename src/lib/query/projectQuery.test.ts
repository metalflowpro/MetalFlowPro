import { describe, it, expect } from 'vitest';
import { queryClient } from './queryClient';
import { invalidateTables, projectQueryKey } from './projectQuery';

describe('projectQuery', () => {
  it('clé stable quel que soit l’ordre des tables', () => {
    expect(projectQueryKey('p1', ['b', 'a'], 's')).toBe(projectQueryKey('p1', ['a', 'b'], 's'));
  });

  it('une écriture sur une table invalide seulement les requêtes qui la lisent', async () => {
    const kLims = projectQueryKey('p1', ['lims_samples', 'lims_test_chem'], 'analytics');
    const kRisk = projectQueryKey('p1', ['risks'], 'register');
    await queryClient.fetch(kLims, async () => 1, 60_000);
    await queryClient.fetch(kRisk, async () => 2, 60_000);
    invalidateTables(['lims_test_chem']);
    expect(queryClient.getEntry(kLims)?.updatedAt).toBe(0);
    expect(queryClient.getEntry(kRisk)?.updatedAt).not.toBe(0);
    // Les données restent affichables pendant la relecture (stale-while-revalidate).
    expect(queryClient.getEntry(kLims)?.data).toBe(1);
  });

  it('ignore les clés hors projet', async () => {
    await queryClient.fetch('autre-cle', async () => 3, 60_000);
    invalidateTables(['autre-cle']);
    expect(queryClient.getEntry('autre-cle')?.updatedAt).not.toBe(0);
  });
});
