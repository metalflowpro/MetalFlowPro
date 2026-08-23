export interface PublicRuntimeConfig {
  appName: string;
  title: string;
  description: string;
  themeColor: string;
  siteUrl: string;
  ogImageUrl: string;
}

type PublicEnv = Record<string, string | undefined>;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function required(env: PublicEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`[MetalFlow Pro] Variable d'environnement publique manquante : ${key}.`);
  }
  return value;
}

export function resolvePublicRuntimeConfig(env: PublicEnv): PublicRuntimeConfig {
  const siteUrl = trimTrailingSlash(required(env, 'VITE_PUBLIC_SITE_URL'));
  try {
    const url = new URL(siteUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new Error('[MetalFlow Pro] VITE_PUBLIC_SITE_URL doit être une URL HTTP(S) absolue.');
  }

  return {
    appName: required(env, 'VITE_PUBLIC_APP_NAME'),
    title: required(env, 'VITE_PUBLIC_APP_TITLE'),
    description: required(env, 'VITE_PUBLIC_APP_DESCRIPTION'),
    themeColor: required(env, 'VITE_PUBLIC_THEME_COLOR'),
    siteUrl,
    ogImageUrl: required(env, 'VITE_PUBLIC_OG_IMAGE_URL'),
  };
}

function setMeta(selector: string, attr: 'content' | 'href', value: string): void {
  const node = document.querySelector(selector);
  if (node) node.setAttribute(attr, value);
}

export function applyPublicRuntimeConfig(config: PublicRuntimeConfig): void {
  document.title = config.title;
  setMeta('meta[name="description"]', 'content', config.description);
  setMeta('meta[name="theme-color"]', 'content', config.themeColor);
  setMeta('link[rel="canonical"]', 'href', `${config.siteUrl}/`);
  setMeta('meta[property="og:url"]', 'content', `${config.siteUrl}/`);
  setMeta('meta[property="og:title"]', 'content', config.appName);
  setMeta('meta[property="og:description"]', 'content', config.description);
  setMeta('meta[property="og:image"]', 'content', config.ogImageUrl);
  setMeta('meta[name="twitter:title"]', 'content', config.appName);
  setMeta('meta[name="twitter:description"]', 'content', config.description);
  setMeta('meta[name="twitter:image"]', 'content', config.ogImageUrl);
}
