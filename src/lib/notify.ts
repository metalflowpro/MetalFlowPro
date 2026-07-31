// ─────────────────────────────────────────────────────────────────────────────
// Notifications applicatives — un bus minimal, sans dépendance.
//
// Motivation : sur 188 appels d'écriture Supabase, 21 seulement vérifiaient
// l'erreur retournée. Une écriture qui échoue (RLS, réseau, contrainte) était
// donc silencieuse — l'utilisateur croyait ses données enregistrées. Ce bus
// permet de remonter un échec à l'écran sans réécrire chaque appelant : le
// client Supabase instrumenté (lib/supabase) y pousse automatiquement.
// ─────────────────────────────────────────────────────────────────────────────

export type NotifyLevel = 'error' | 'success' | 'info';

export interface Notification {
  id: number;
  level: NotifyLevel;
  message: string;
  detail?: string;
  createdAt: number;
}

type Listener = (n: Notification[]) => void;

let queue: Notification[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...queue];
  for (const l of listeners) l(snapshot);
}

/** S'abonne au flux de notifications ; renvoie une fonction de désinscription. */
export function subscribeNotifications(fn: Listener): () => void {
  listeners.add(fn);
  fn([...queue]);
  return () => { listeners.delete(fn); };
}

/** Retire une notification (fermeture manuelle ou auto). */
export function dismissNotification(id: number) {
  queue = queue.filter(n => n.id !== id);
  emit();
}

/**
 * Publie une notification. Les erreurs restent jusqu'à fermeture manuelle
 * (une perte de données ne doit pas disparaître toute seule) ; succès et infos
 * s'effacent après quelques secondes.
 */
export function notify(level: NotifyLevel, message: string, detail?: string): number {
  const n: Notification = { id: ++seq, level, message, detail, createdAt: Date.now() };
  queue = [...queue, n].slice(-6); // borne la pile pour ne pas noyer l'écran
  emit();
  if (level !== 'error') {
    setTimeout(() => dismissNotification(n.id), 4500);
  }
  return n.id;
}

export const notifyError = (message: string, detail?: string) => notify('error', message, detail);
export const notifySuccess = (message: string, detail?: string) => notify('success', message, detail);
