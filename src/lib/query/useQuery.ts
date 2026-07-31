import { useState, useEffect, useCallback, useRef } from 'react';
import { queryClient } from './queryClient';

interface UseQueryOptions {
  /** Data older than this (ms) is refetched in the background. Default 30 s. */
  staleTime?: number;
  /** Skip fetching (e.g. until a dependency is ready). */
  enabled?: boolean;
}

interface UseQueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

/**
 * Thin React binding over the pure QueryClient (T7). Serves cached data
 * immediately, de-duplicates concurrent requests for the same key across the
 * app, and revalidates when stale. Re-renders when the cached entry changes
 * (including invalidation from elsewhere).
 */
export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { staleTime = 30_000, enabled = true }: UseQueryOptions = {},
): UseQueryResult<T> {
  const entry = key ? queryClient.getEntry<T>(key) : undefined;
  const [, forceRender] = useState(0);
  const [loading, setLoading] = useState(!entry || entry.updatedAt === 0);
  const [error, setError] = useState<unknown>(entry?.error);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (force: boolean) => {
    if (!key) return;
    setLoading(true);
    try {
      await queryClient.fetch(key, () => fetcherRef.current(), staleTime, force);
      setError(undefined);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [key, staleTime]);

  useEffect(() => {
    if (!key || !enabled) return;
    const unsub = queryClient.subscribe(key, () => forceRender(n => n + 1));
    run(false);
    return unsub;
  }, [key, enabled, run]);

  return {
    data: key ? queryClient.getEntry<T>(key)?.data : undefined,
    loading,
    error,
    refetch: () => run(true),
  };
}
