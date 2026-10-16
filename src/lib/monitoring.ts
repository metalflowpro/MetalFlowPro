// ─────────────────────────────────────────────────────────────────────────────
// Suivi des erreurs en production (Sentry) — DORMANT tant que VITE_SENTRY_DSN
// n'est pas défini.
//
// Le SDK est chargé dynamiquement : sans DSN il n'est jamais téléchargé (aucun
// coût sur le bundle initial). Les erreurs survenues avant la fin du
// chargement sont mises en file puis envoyées.
//
// Données personnelles : collecte automatique désactivée (dataCollection) ;
// l'utilisateur n'est identifié que par son UUID Supabase, jamais son e-mail.
// ─────────────────────────────────────────────────────────────────────────────

type SentryModule = typeof import('@sentry/react');

/** Part des transactions de performance échantillonnées (0 = erreurs seules). */
export const MONITORING_DEFAULTS = { tracesSampleRate: 0 } as const;

let sentry: SentryModule | null = null;
const pending: { error: unknown; context?: Record<string, unknown> }[] = [];

export function isMonitoringEnabled(env: Record<string, string | undefined> = import.meta.env): boolean {
  return Boolean(env.VITE_SENTRY_DSN?.trim());
}

export async function initMonitoring(env: Record<string, string | undefined> = import.meta.env): Promise<void> {
  const dsn = env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return;
  const mod = await import('@sentry/react');
  mod.init({
    dsn,
    environment: env.VITE_SENTRY_ENVIRONMENT || env.MODE,
    release: env.VITE_APP_RELEASE,
    // Aucune collecte automatique de données personnelles ou de requêtes : pas
    // d'en-têtes (jeton Supabase), ni de corps (données projet), ni de cookies.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? MONITORING_DEFAULTS.tracesSampleRate),
  });
  sentry = mod;
  for (const p of pending.splice(0)) mod.captureException(p.error, p.context ? { extra: p.context } : undefined);
}

/** Signale une erreur (no-op sans DSN). */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!isMonitoringEnabled()) return;
  if (sentry) sentry.captureException(error, context ? { extra: context } : undefined);
  else pending.push({ error, context });
}

/** Associe les erreurs à l'utilisateur connecté (UUID seulement) ; null à la déconnexion. */
export function setMonitoringUser(userId: string | null): void {
  sentry?.setUser(userId ? { id: userId } : null);
}
