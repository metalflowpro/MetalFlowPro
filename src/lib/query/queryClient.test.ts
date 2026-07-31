import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from './queryClient';

describe('QueryClient', () => {
  it('caches a successful fetch and serves it without refetching while fresh', async () => {
    const clock = 1000;
    const qc = new QueryClient(() => clock);
    const fetcher = vi.fn().mockResolvedValue('A');

    expect(await qc.fetch('k', fetcher, 5000)).toBe('A');
    expect(await qc.fetch('k', fetcher, 5000)).toBe('A'); // still fresh
    expect(fetcher).toHaveBeenCalledTimes(1);             // served from cache
  });

  it('refetches once data is stale', async () => {
    let clock = 1000;
    const qc = new QueryClient(() => clock);
    const fetcher = vi.fn().mockResolvedValueOnce('A').mockResolvedValueOnce('B');

    expect(await qc.fetch('k', fetcher, 5000)).toBe('A');
    clock += 6000; // now stale
    expect(await qc.fetch('k', fetcher, 5000)).toBe('B');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent requests for the same key', async () => {
    const qc = new QueryClient(() => 1000);
    let resolve!: (v: string) => void;
    const fetcher = vi.fn().mockImplementation(() => new Promise<string>(r => { resolve = r; }));

    const p1 = qc.fetch('k', fetcher, 5000);
    const p2 = qc.fetch('k', fetcher, 5000);
    resolve('X');

    expect(await p1).toBe('X');
    expect(await p2).toBe('X');
    expect(fetcher).toHaveBeenCalledTimes(1); // shared in-flight promise
  });

  it('isStale is true for never-fetched keys and false right after a fetch', async () => {
    let clock = 1000;
    const qc = new QueryClient(() => clock);
    expect(qc.isStale('k', 5000)).toBe(true);
    await qc.fetch('k', async () => 1, 5000);
    expect(qc.isStale('k', 5000)).toBe(false);
    clock += 5000;
    expect(qc.isStale('k', 5000)).toBe(true);
  });

  it('invalidate forces the next fetch to refetch', async () => {
    const qc = new QueryClient(() => 1000);
    const fetcher = vi.fn().mockResolvedValueOnce('A').mockResolvedValueOnce('B');
    await qc.fetch('k', fetcher, 100_000);
    qc.invalidate('k');
    expect(await qc.fetch('k', fetcher, 100_000)).toBe('B');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('setData seeds the cache and notifies subscribers', async () => {
    const qc = new QueryClient(() => 1000);
    const cb = vi.fn();
    qc.subscribe('k', cb);
    qc.setData('k', 42);
    expect(qc.getEntry<number>('k')?.data).toBe(42);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('preserves last good data when a refetch errors', async () => {
    let clock = 1000;
    const qc = new QueryClient(() => clock);
    const fetcher = vi.fn()
      .mockResolvedValueOnce('A')
      .mockRejectedValueOnce(new Error('network'));

    await qc.fetch('k', fetcher, 1000);
    clock += 2000;
    await expect(qc.fetch('k', fetcher, 1000)).rejects.toThrow('network');
    expect(qc.getEntry<string>('k')?.data).toBe('A'); // stale-but-present
    expect(qc.getEntry<string>('k')?.error).toBeInstanceOf(Error);
  });
});
