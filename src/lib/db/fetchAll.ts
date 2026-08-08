// ─────────────────────────────────────────────────────────────────────────────
// Lecture Supabase PAGINÉE — contourne le plafond PostgREST de 1000 lignes.
//
// Un `supabase.from(...).select('*')` renvoie AU PLUS 1000 lignes, silencieusement.
// Sur un projet réel (des milliers d'analyses de forage, > 10 000 échantillons
// LIMS), cela tronque les données : coupes de forage incomplètes, block model
// estimé sur une poignée de trous, paramètres LIMS jamais agrégés. On pagine donc
// par `.range()` jusqu'à épuisement.
//
// Générique et découplé de supabase.ts (pas d'import) : l'appelant fournit une
// FABRIQUE de requête (une requête fraîche par page — un builder PostgREST n'est
// pas réutilisable après await).
// ─────────────────────────────────────────────────────────────────────────────

/** Taille de page — le plafond dur de PostgREST. */
export const PAGE_SIZE = 1000;

/** Une requête bornable par `.range()`, résolvant vers { data, error }. */
export interface RangeQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Lit TOUTES les lignes d'une requête en paginant par `.range()`.
 *
 * `make` doit retourner une requête FRAÎCHE à chaque appel (filtres + order
 * appliqués, SANS range) — p. ex.
 *   fetchAll(() => supabase.from('dh_assay').select('*').eq('project_id', id).order('hole_id'))
 *
 * S'arrête dès qu'une page renvoie moins de `PAGE_SIZE` lignes. Sur erreur, rend
 * les lignes déjà lues et l'erreur (l'appelant décide s'il dégrade ou échoue).
 */
export async function fetchAll<T>(make: () => RangeQuery<T>): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await make().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: out, error };
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}
