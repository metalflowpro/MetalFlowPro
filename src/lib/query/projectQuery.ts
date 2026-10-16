// ─────────────────────────────────────────────────────────────────────────────
// Requêtes de PROJET mises en cache, invalidées par TABLE.
//
// Clé : `p|<projectId>|<table,table…>|<portée>`. Toute écriture passant par la
// couche de données (src/lib/data/mutations.ts) invalide les requêtes qui
// lisent la table écrite ; les écrans abonnés se rechargent seuls.
//
// Politique par défaut « affichage instantané + rechargement » (staleTime 0) :
// à chaque montage l'écran montre aussitôt les dernières données connues puis
// les relit. Tant que des écritures contournent la couche de données (garde
// P1.1), c'est ce qui garantit qu'aucune donnée périmée n'est conservée.
// ─────────────────────────────────────────────────────────────────────────────

import { queryClient } from './queryClient';
import { useQuery } from './useQuery';

export function projectQueryKey(projectId: string, tables: readonly string[], scope: string): string {
  return `p|${projectId}|${[...tables].sort().join(',')}|${scope}`;
}

function tablesOf(key: string): string[] {
  const parts = key.split('|');
  return parts[0] === 'p' && parts[2] ? parts[2].split(',') : [];
}

/** Invalide toutes les requêtes de projet qui lisent l'une de ces tables. */
export function invalidateTables(tables: readonly string[]): void {
  const set = new Set(tables);
  queryClient.invalidateMatching(key => tablesOf(key).some(t => set.has(t)));
}

export function useProjectQuery<T>(
  projectId: string | null | undefined,
  tables: readonly string[],
  scope: string,
  fetcher: () => Promise<T>,
  { staleTime = 0, enabled = true }: { staleTime?: number; enabled?: boolean } = {},
) {
  const key = projectId ? projectQueryKey(projectId, tables, scope) : null;
  return useQuery<T>(key, fetcher, { staleTime, enabled });
}
