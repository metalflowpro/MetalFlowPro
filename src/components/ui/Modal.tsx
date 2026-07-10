import { ReactNode, useEffect } from 'react';
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

export function Modal({ title, subtitle, onClose, children, footer, width = 'md' }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-box w-full ${WIDTH_MAP[width]}`}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4 border-b border-mf-border">
          <div>
            <h2 className="text-base font-semibold text-mf-txt">{title}</h2>
            {subtitle && <p className="text-xs text-mf-txt3 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
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
