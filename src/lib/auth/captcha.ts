// Clé publique du captcha Turnstile ; null = captcha désactivé (aucun script chargé).
export function turnstileSiteKey(): string | null {
  return import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || null;
}
