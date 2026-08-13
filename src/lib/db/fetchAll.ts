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

/**
 * Une requête bornable par `.range()`, résolvant vers { data, error }. Le type
 * de ligne est volontairement LARGE (`unknown[]`) pour accepter n'importe quel
 * builder Supabase typé ; `fetchAll<T>` reprojette le résultat en `T[]`.
 */
export interface RangeQuery {
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
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
export async function fetchAll<T>(make: () => RangeQuery): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await make().range(from, from + PAGE_SIZE - 1);
    if (error) return { data: out, error };
    const chunk = (data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: out, error: null };
}

/** Nombre de pages demandées de front par `fetchAllParallel` (fenêtre). */
export const PARALLEL_WINDOW = 4;

/**
 * Variante PARALLÈLE de `fetchAll` : au lieu d'enchaîner les pages une par une
 * (chaque aller-retour réseau attend le précédent), on demande `window` pages de
 * front. Sur une grosse table (`dh_assay` de plusieurs milliers d'analyses), cela
 * divise le temps de chargement par ~`window` sans requête de comptage préalable
 * (on sur-demande d'au plus `window-1` pages vides en fin de table, ce qui est
 * bénin). L'ordre des lignes est préservé (concaténation dans l'ordre des pages).
 *
 * Contrat identique à `fetchAll` : `make` rend une requête FRAÎCHE (filtres + order,
 * sans range) ; sur erreur, on rend les lignes déjà lues + l'erreur.
 */
export async function fetchAllParallel<T>(
  make: () => RangeQuery,
  window: number = PARALLEL_WINDOW,
): Promise<{ data: T[]; error: unknown }> {
  const out: T[] = [];
  const win = Math.max(1, Math.floor(window));
  let base = 0;
  for (;;) {
    const pages = await Promise.all(
      Array.from({ length: win }, (_, k) => {
        const from = base + k * PAGE_SIZE;
        return make().range(from, from + PAGE_SIZE - 1);
      }),
    );
    // Concatène dans l'ordre, s'arrête à la 1re page courte (fin de table) ou en erreur.
    let done = false;
    for (const { data, error } of pages) {
      if (error) return { data: out, error };
      const chunk = (data ?? []) as T[];
      out.push(...chunk);
      if (chunk.length < PAGE_SIZE) { done = true; break; }
    }
    if (done) break;
    base += win * PAGE_SIZE;
  }
  return { data: out, error: null };
}
