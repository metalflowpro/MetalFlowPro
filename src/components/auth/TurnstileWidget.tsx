// Captcha Cloudflare Turnstile — inactif tant que VITE_TURNSTILE_SITE_KEY n'est
// pas défini (aucun script tiers chargé). Le jeton obtenu est transmis à
// Supabase Auth (`options.captchaToken`), qui le vérifie côté serveur lorsque le
// captcha est activé dans le tableau de bord (Auth › Attack Protection).

import { useEffect, useRef } from 'react';
import { turnstileSiteKey } from '../../lib/auth/captcha';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile indisponible')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/**
 * `resetKey` : changer sa valeur force un nouveau défi (un jeton Turnstile
 * n'est valable qu'une fois — à réinitialiser après chaque tentative).
 */
export function TurnstileWidget({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const idRef = useRef<string | null>(null);
  const siteKey = turnstileSiteKey();

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      idRef.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: 'dark',
        language: 'fr',
        callback: (t: string) => onToken(t),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => {
      cancelled = true;
      if (idRef.current && window.turnstile) window.turnstile.remove(idRef.current);
      idRef.current = null;
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (idRef.current && window.turnstile) { window.turnstile.reset(idRef.current); onToken(null); }
  }, [resetKey, onToken]);

  if (!siteKey) return null;
  return <div ref={ref} className="flex justify-center" />;
}
