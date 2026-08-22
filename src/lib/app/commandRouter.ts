// ─────────────────────────────────────────────────────────────────────────────
// MetalFlow Pro — Routeur de commandes applicatif (S7)
//
// Routeur mince qui mappe `module.action → handler`. Objectif : centraliser les
// écritures industrielles derrière la couche de données vérifiant le nombre de
// lignes, plutôt que de laisser des composants appeler directement le client
// supabase (où le piège T3b — 0 ligne silencieuse — n'est pas détecté).
//
// Chaque handler reçoit un contexte (userId, projectId) et doit utiliser les
// wrappers de src/lib/data/mutations. Les erreurs de persistance
// (DataNotPersistedError, AffectedRowsUnknownError) sont propagées telles quelles
// vers l'UI — l'utilisateur sait que l'enregistrement a échoué.
// ─────────────────────────────────────────────────────────────────────────────

import { UnknownCommandError } from '../data/errors';
import { updateWhere, rpcMutation } from '../data/mutations';

/** Contexte d'exécution d'une commande (issu du JWT / de la session). */
export interface CommandContext {
  userId: string;
  projectId: string;
}

/** Arguments libres d'une commande. */
export type CommandArgs = Record<string, unknown>;

/** Handler de commande. Doit lever en cas d'échec de persistance. */
export type CommandHandler = (
  ctx: CommandContext,
  args: CommandArgs,
) => Promise<unknown>;

const registry = new Map<string, CommandHandler>();

/** Clé de registre `module.action`. */
function key(module: string, action: string): string {
  return `${module}.${action}`;
}

/** Enregistre un handler pour `module.action`. */
export function registerCommand(
  module: string,
  action: string,
  handler: CommandHandler,
): void {
  if (registry.has(key(module, action))) {
    throw new Error(`Commande déjà enregistrée: ${key(module, action)}`);
  }
  registry.set(key(module, action), handler);
}

/** Distribue une commande. Lève UnknownCommandError si inconnue. */
export async function dispatch(
  module: string,
  action: string,
  ctx: CommandContext,
  args: CommandArgs = {},
): Promise<unknown> {
  const handler = registry.get(key(module, action));
  if (!handler) {
    throw new UnknownCommandError(
      `Commande inconnue: ${key(module, action)}. ` +
        `Aucun handler enregistré — l'écriture n'a pas eu lieu.`,
    );
  }
  return handler(ctx, args);
}

/** Liste les commandes enregistrées (utile pour les tests et le diagnostic). */
export function listCommands(): string[] {
  return [...registry.keys()].sort();
}

/** Vide le registre (pour les tests). */
export function clearCommands(): void {
  registry.clear();
}

// ── Chemins représentatifs enregistrés par défaut ───────────────────────────
// Deux chemins couvrent les deux familles d'écriture :
//   1. une mutation de table (update) via la couche de données ;
//   2. un appel RPC mutant (compute) — les RPC S6 lèvent déjà côté SQL, le
//      wrapper conserve ces erreurs et vérifie le retour non nul.

registerCommand('project', 'updateSettings', async (ctx, args) => {
  const settings = args.settings as Record<string, unknown>;
  return updateWhere(
    'project_settings',
    { project_id: ctx.projectId },
    settings,
    { label: `project.updateSettings (${ctx.projectId})`, expect: 'atLeastOne' },
  );
});

registerCommand('compute', 'enqueueP80', async (ctx, args) => {
  return rpcMutation('mfp_enqueue_compute', {
    p_project_id: ctx.projectId,
    p_compute_type: 'p80',
    p_target_table: 'p80_test_result',
    p_target_id: args.targetId ?? null,
    p_input_snapshot: args.inputSnapshot ?? {},
    p_engine_name: 'p80_engine',
    p_engine_version: args.engineVersion ?? 'p80.v1',
    p_max_attempts: args.maxAttempts ?? 3,
  }, { label: `compute.enqueueP80 (${ctx.projectId})` });
});
