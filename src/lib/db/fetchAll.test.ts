import { describe, it, expect } from 'vitest';
import { fetchAll, fetchAllParallel, PAGE_SIZE, type RangeQuery } from './fetchAll';

/** Fabrique une source paginée factice de `total` lignes {i}. */
function fakeSource(total: number, opts: { errorAtFrom?: number } = {}) {
  let calls = 0;
  const make = (): RangeQuery => ({
    range(from: number, to: number) {
      calls++;
      if (opts.errorAtFrom != null && from === opts.errorAtFrom) {
        return Promise.resolve({ data: null, error: new Error('boom') });
      }
      const rows = [];
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i });
      return Promise.resolve({ data: rows, error: null });
    },
  });
  return { make, callCount: () => calls };
}

describe('fetchAll — pagination au-delà du plafond 1000', () => {
  it('lit toutes les lignes sur plusieurs pages', async () => {
    const src = fakeSource(2500);
    const { data, error } = await fetchAll<{ i: number }>(src.make);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data[0].i).toBe(0);
    expect(data[2499].i).toBe(2499);
    // 1000 + 1000 + 500 → 3 pages (la dernière < PAGE_SIZE arrête la boucle).
    expect(src.callCount()).toBe(3);
  });

  it('s\'arrête en une page quand le total est un multiple exact et la suivante est vide', async () => {
    const src = fakeSource(PAGE_SIZE); // 1000 pile
    const { data } = await fetchAll<{ i: number }>(src.make);
    expect(data).toHaveLength(PAGE_SIZE);
    // 1re page pleine (1000) → on tente une 2e page (vide) qui stoppe.
    expect(src.callCount()).toBe(2);
  });

  it('jeu de données court : une seule page', async () => {
    const src = fakeSource(42);
    const { data } = await fetchAll<{ i: number }>(src.make);
    expect(data).toHaveLength(42);
    expect(src.callCount()).toBe(1);
  });

  it('remonte l\'erreur avec les lignes déjà lues', async () => {
    const src = fakeSource(3000, { errorAtFrom: PAGE_SIZE });
    const { data, error } = await fetchAll<{ i: number }>(src.make);
    expect(error).toBeInstanceOf(Error);
    expect(data).toHaveLength(PAGE_SIZE); // la 1re page a réussi
  });
});

describe('fetchAllParallel — pagination parallèle par fenêtre', () => {
  it('lit toutes les lignes dans l\'ordre, en fenêtres parallèles', async () => {
    const src = fakeSource(2500);
    const { data, error } = await fetchAllParallel<{ i: number }>(src.make, 4);
    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    expect(data[0].i).toBe(0);
    expect(data[2499].i).toBe(2499);
    // Une seule fenêtre de 4 pages couvre 4000 lignes ≥ 2500.
    expect(src.callCount()).toBe(4);
  });

  it('enchaîne plusieurs fenêtres quand le total les dépasse', async () => {
    const src = fakeSource(5001);
    const { data } = await fetchAllParallel<{ i: number }>(src.make, 2);
    expect(data).toHaveLength(5001);
    // 2+2+2 pages : 3e fenêtre lit la page courte (5000..5000) puis s'arrête.
    expect(data[5000].i).toBe(5000);
  });

  it('jeu de données court : une fenêtre suffit', async () => {
    const src = fakeSource(42);
    const { data } = await fetchAllParallel<{ i: number }>(src.make, 4);
    expect(data).toHaveLength(42);
  });

  it('remonte l\'erreur avec les lignes déjà lues (ordre préservé)', async () => {
    const src = fakeSource(3000, { errorAtFrom: PAGE_SIZE });
    const { data, error } = await fetchAllParallel<{ i: number }>(src.make, 4);
    expect(error).toBeInstanceOf(Error);
    // La page [0..999] a réussi ; la page en erreur interrompt la concaténation.
    expect(data).toHaveLength(PAGE_SIZE);
  });
});
