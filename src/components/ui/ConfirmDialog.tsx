// ─────────────────────────────────────────────────────────────────────────────
// Boîte de confirmation générique, pour les actions destructrices.
//
// Sept pages supprimaient des données sans aucune confirmation ni annulation.
// Ce composant impose un point d'arrêt avant destruction, avec le nom de
// l'élément concerné, sans imposer aux appelants d'écrire chacun leur modale.
//
// Usage via le hook `useConfirm` : `const confirm = useConfirm();` puis
// `if (await confirm({ title, message })) { … }`.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, createContext, useContext, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style destructeur (rouge) par défaut ; false pour une confirmation neutre. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Fournit la fonction de confirmation à tout l'arbre. Monter une fois à la racine. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setState({ opts, resolve }));
  }, []);

  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.opts.title}
          onClose={() => close(false)}
          width="sm"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? 'Annuler'}
              </button>
              <button
                className={state.opts.destructive === false ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={() => close(true)}
              >
                {state.opts.confirmLabel ?? 'Supprimer'}
              </button>
            </>
          }
        >
          <div className="flex items-start gap-3">
            {state.opts.destructive !== false && (
              <div className="w-9 h-9 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} className="text-red-400" />
              </div>
            )}
            <p className="text-sm text-mf-txt3 leading-relaxed">{state.opts.message}</p>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Renvoie une fonction `confirm(opts) → Promise<boolean>`. Résout à `true` si
 * l'utilisateur confirme, `false` s'il annule ou ferme.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm doit être utilisé dans un <ConfirmProvider>');
  return ctx;
}
