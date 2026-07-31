import { createClient } from '@supabase/supabase-js';
import { notifyError } from './notify';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Fail fast with a clear message rather than a silent runtime crash deep in a query.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ');
  throw new Error(
    `[MetalFlow Pro] Variable(s) d'environnement Supabase manquante(s) : ${missing}. ` +
    `Définissez-les dans le fichier .env (dev) ou dans les secrets de déploiement (prod).`
  );
}

const client = createClient(supabaseUrl, supabaseAnonKey);

// ─── Filet de sécurité sur les écritures ────────────────────────────────────
//
// Historiquement, la plupart des appels d'écriture ne vérifiaient pas l'erreur
// retournée : un échec (RLS, réseau, contrainte, table absente) passait
// inaperçu et l'utilisateur croyait ses données enregistrées. On instrumente
// donc `from()` : toute mutation (insert/update/upsert/delete) dont la réponse
// porte une `error` déclenche une notification visible, SANS modifier les
// appelants — ceux qui gèrent déjà l'erreur continuent de le faire.

const MUTATIONS = ['insert', 'update', 'upsert', 'delete'] as const;

const HUMAN_TABLE: Record<string, string> = {
  cos_ingestion_config: 'configuration d\'ingestion',
  p80_optimization_runs: 'historique P80',
};

function humanTable(t: string): string {
  return HUMAN_TABLE[t] ?? t.replace(/_/g, ' ');
}

/** Un PostgrestBuilder est « thenable » : on enveloppe son `.then` pour observer la réponse. */
function watchResult<T extends { then?: unknown }>(builder: T, table: string, op: string): T {
  const anyBuilder = builder as unknown as {
    then?: (onF: (v: { error?: { message?: string; code?: string } | null }) => unknown, onR?: (e: unknown) => unknown) => unknown;
  };
  if (typeof anyBuilder.then !== 'function') return builder;

  const originalThen = anyBuilder.then.bind(anyBuilder);
  anyBuilder.then = (onFulfilled, onRejected) =>
    originalThen((res) => {
      if (res && res.error) {
        notifyError(
          `Échec de l'enregistrement (${humanTable(table)})`,
          res.error.message ?? res.error.code ?? 'Erreur inconnue',
        );
      }
      return onFulfilled ? onFulfilled(res) : res;
    }, onRejected);
  return builder;
}

export const supabase = new Proxy(client, {
  get(target, prop, receiver) {
    if (prop !== 'from') return Reflect.get(target, prop, receiver);
    return (table: string) => {
      const query = target.from(table);
      return new Proxy(query, {
        get(qTarget, qProp, qReceiver) {
          const orig = Reflect.get(qTarget, qProp, qReceiver);
          if (typeof orig !== 'function') return orig;
          const method = String(qProp);
          return (...args: unknown[]) => {
            const out = (orig as (...a: unknown[]) => unknown).apply(qTarget, args);
            // Un builder de mutation est retourné : on surveille sa résolution.
            if (MUTATIONS.includes(method as typeof MUTATIONS[number]) && out && typeof out === 'object') {
              return watchResult(out as { then?: unknown }, table, method);
            }
            return out;
          };
        },
      });
    };
  },
}) as typeof client;
