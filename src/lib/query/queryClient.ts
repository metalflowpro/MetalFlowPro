/**
 * Minimal dependency-free query cache (T7) — the pure core behind `useQuery`.
 *
 * Provides the three things a data layer actually needs here:
 *  1. an in-memory cache keyed by a stable string,
 *  2. request de-duplication (concurrent callers for the same key share one
 *     in-flight promise — no duplicate Supabase round-trips),
 *  3. stale-while-revalidate (serve cached data instantly, refetch in the
 *     background when older than `staleTime`).
 *
 * Kept framework-agnostic and injectable (`now`) so it is fully unit-testable
 * without a DOM — see queryClient.test.ts. `useQuery` is a thin React wrapper.
 */

export interface QueryEntry<T = unknown> {
  data?: T;
  error?: unknown;
  updatedAt: number;      // epoch ms of last successful fetch; 0 = never
  promise?: Promise<T>;   // in-flight request, if any
}

type Listener = () => void;

export class QueryClient {
  private store = new Map<string, QueryEntry>();
  private listeners = new Map<string, Set<Listener>>();
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  getEntry<T>(key: string): QueryEntry<T> | undefined {
    return this.store.get(key) as QueryEntry<T> | undefined;
  }

  isStale(key: string, staleTime: number): boolean {
    const e = this.store.get(key);
    if (!e || e.updatedAt === 0) return true;
    return this.now() - e.updatedAt >= staleTime;
  }

  /**
   * Return cached data when fresh; otherwise fetch. Concurrent calls for the
   * same key while a request is in flight share that single promise.
   * `force` bypasses the freshness check (used by refetch/invalidate flows).
   */
  fetch<T>(key: string, fetcher: () => Promise<T>, staleTime: number, force = false): Promise<T> {
    const existing = this.store.get(key) as QueryEntry<T> | undefined;

    if (existing?.promise) return existing.promise;                       // dedup
    if (!force && existing && existing.updatedAt !== 0 && !this.isStale(key, staleTime)) {
      return Promise.resolve(existing.data as T);                          // fresh cache hit
    }

    const promise = fetcher().then(
      data => {
        this.store.set(key, { data, updatedAt: this.now(), error: undefined });
        this.emit(key);
        return data;
      },
      err => {
        const prev = this.store.get(key);
        this.store.set(key, { ...prev, error: err, updatedAt: prev?.updatedAt ?? 0, promise: undefined });
        this.emit(key);
        throw err;
      },
    );

    this.store.set(key, { ...(existing ?? { updatedAt: 0 }), promise });
    return promise;
  }

  /** Manually seed/replace cached data (optimistic updates). */
  setData<T>(key: string, data: T): void {
    this.store.set(key, { data, updatedAt: this.now(), error: undefined });
    this.emit(key);
  }

  /** Mark a key stale so the next read refetches; optionally notify now. */
  invalidate(key: string): void {
    const e = this.store.get(key);
    if (e) this.store.set(key, { ...e, updatedAt: 0, promise: undefined });
    this.emit(key);
  }

  clear(): void {
    this.store.clear();
  }

  subscribe(key: string, cb: Listener): () => void {
    let set = this.listeners.get(key);
    if (!set) { set = new Set(); this.listeners.set(key, set); }
    set.add(cb);
    return () => { set!.delete(cb); };
  }

  private emit(key: string): void {
    this.listeners.get(key)?.forEach(cb => cb());
  }
}

/** App-wide singleton used by useQuery. */
export const queryClient = new QueryClient();
