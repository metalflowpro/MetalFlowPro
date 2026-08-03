import { ReactNode, useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
}

const WIDTH_MAP = {
  sm:  'max-w-sm',
  md:  'max-w-lg',
  lg:  'max-w-2xl',
  xl:  'max-w-4xl',
};

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Modal({ title, subtitle, onClose, children, footer, width = 'md' }: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Read the latest onClose through a ref so the mount effect below never needs
  // it as a dependency. Callers frequently pass an inline arrow (a fresh
  // reference every render); depending on it would re-run the effect on every
  // keystroke and steal focus back to the first field via the rAF refocus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape to close + a Tab focus-trap so keyboard users can't wander behind
  // the modal; restore focus to the previously-active element on unmount.
  // Runs ONCE on mount — re-running it would move focus out of the field the
  // user is typing in.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Move focus into the dialog after mount.
    requestAnimationFrame(() => {
      const first = boxRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? boxRef.current)?.focus();
    });

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      if (e.key !== 'Tab') return;
      const nodes = boxRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-overlay no-print"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={boxRef} className={`modal-box w-full ${WIDTH_MAP[width]}`} tabIndex={-1}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-mf-border">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-mf-txt">{title}</h2>
            {subtitle && <p className="text-xs text-mf-txt3 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="btn btn-ghost btn-sm -mr-1 -mt-1 rounded-lg"
          >
            <X size={16} />
          </button>
        </div>
        {/* Body */}
        <div className="px-6 py-5">{children}</div>
        {/* Footer */}
        {footer && (
          <div className="flex justify-end gap-3 px-6 pb-6 pt-2 border-t border-mf-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
