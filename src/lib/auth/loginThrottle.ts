// ─────────────────────────────────────────────────────────────────────────────
// Ralentissement progressif des tentatives de connexion (côté navigateur).
//
// Défense de premier niveau contre l'essai de mots de passe à la main : après
// LOGIN_THROTTLE.freeAttempts échecs pour un même e-mail, chaque nouvel échec
// impose un délai qui double, plafonné. Le verrou réel reste côté serveur
// (limites de Supabase Auth par IP + captcha) : un attaquant peut vider le
// stockage du navigateur, ce module ne remplace donc PAS ces protections — il
// rend l'abus visible et coûteux depuis l'interface.
//
// L'e-mail n'est jamais stocké en clair : la clé est une empreinte FNV-1a.
// ─────────────────────────────────────────────────────────────────────────────

export const LOGIN_THROTTLE = {
  /** Échecs autorisés sans délai. */
  freeAttempts: 3,
  /** Délai après le premier échec au-delà des essais libres (ms). */
  baseDelayMs: 2_000,
  /** Plafond du délai (ms). */
  maxDelayMs: 5 * 60_000,
  /** Les échecs plus anciens que cette fenêtre sont oubliés (ms). */
  resetAfterMs: 30 * 60_000,
} as const;

export interface ThrottleState {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

export interface ThrottleStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const PREFIX = 'mfp_login_throttle_';

/** Empreinte FNV-1a 32 bits de l'e-mail normalisé (pas de stockage en clair). */
export function emailKey(email: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PREFIX + h.toString(16);
}

/** Délai imposé après `failures` échecs consécutifs. */
export function delayAfter(failures: number, cfg = LOGIN_THROTTLE): number {
  const over = failures - cfg.freeAttempts;
  if (over <= 0) return 0;
  return Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** (over - 1));
}

function read(store: ThrottleStore, email: string, now: number, cfg = LOGIN_THROTTLE): ThrottleState {
  try {
    const raw = store.get(emailKey(email));
    if (!raw) return { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
    const s = JSON.parse(raw) as ThrottleState;
    if (now - s.lastFailureAt > cfg.resetAfterMs) return { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
    return s;
  } catch {
    return { failures: 0, lastFailureAt: 0, blockedUntil: 0 };
  }
}

/** Millisecondes restantes avant qu'une tentative soit permise (0 = permise). */
export function remainingLockMs(store: ThrottleStore, email: string, now: number, cfg = LOGIN_THROTTLE): number {
  if (!email.trim()) return 0;
  return Math.max(0, read(store, email, now, cfg).blockedUntil - now);
}

export function recordFailure(store: ThrottleStore, email: string, now: number, cfg = LOGIN_THROTTLE): ThrottleState {
  const prev = read(store, email, now, cfg);
  const failures = prev.failures + 1;
  const next: ThrottleState = { failures, lastFailureAt: now, blockedUntil: now + delayAfter(failures, cfg) };
  try { store.set(emailKey(email), JSON.stringify(next)); } catch { /* stockage indisponible */ }
  return next;
}

export function recordSuccess(store: ThrottleStore, email: string): void {
  try { store.remove(emailKey(email)); } catch { /* stockage indisponible */ }
}

/** Stockage du navigateur, tolérant aux modes privés / stockage bloqué. */
export const browserThrottleStore: ThrottleStore = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignoré */ } },
  remove: k => { try { localStorage.removeItem(k); } catch { /* ignoré */ } },
};

/** « 1 min 30 s », « 8 s » — pour le message d'attente. */
export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
