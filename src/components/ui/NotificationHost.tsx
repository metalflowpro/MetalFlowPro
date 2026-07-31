// Affiche les notifications applicatives (échecs d'écriture, succès) en pile
// flottante. Monté une fois à la racine ; il écoute le bus lib/notify.
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  subscribeNotifications, dismissNotification,
  type Notification,
} from '../../lib/notify';

const STYLE: Record<Notification['level'], { icon: typeof Info; cls: string }> = {
  error:   { icon: AlertTriangle, cls: 'border-red-500/40 bg-red-500/10 text-red-200' },
  success: { icon: CheckCircle2,  cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' },
  info:    { icon: Info,          cls: 'border-blue-500/40 bg-blue-500/10 text-blue-200' },
};

export function NotificationHost() {
  const [items, setItems] = useState<Notification[]>([]);
  useEffect(() => subscribeNotifications(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(92vw,380px)]">
      {items.map(n => {
        const s = STYLE[n.level];
        const Icon = s.icon;
        return (
          <div
            key={n.id}
            role="alert"
            className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur-sm animate-fade-in ${s.cls}`}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{n.message}</div>
              {n.detail && <div className="text-[11px] opacity-80 mt-0.5 break-words">{n.detail}</div>}
            </div>
            <button
              onClick={() => dismissNotification(n.id)}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
