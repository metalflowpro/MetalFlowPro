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

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Injecte les métadonnées publiques dans le `index.html` AU BUILD (plugin Vite).
 *
 * `applyPublicRuntimeConfig` ne les pose qu'après exécution du JavaScript :
 * les robots d'indexation et les aperçus de liens (LinkedIn, Slack, Teams…),
 * qui lisent le HTML brut, voyaient un titre vide et une URL canonique
 * `example.com`. Mêmes variables et même validation que l'exécution, donc les
 * deux chemins ne peuvent pas diverger.
 */
export function renderPublicMetaHtml(html: string, config: PublicRuntimeConfig): string {
  const e = escapeHtmlAttr;
  const url = `${config.siteUrl}/`;
  const replaceAttr = (src: string, selector: RegExp, value: string) =>
    src.replace(selector, (tag) => tag.replace(/(content|href)="[^"]*"/, `$1="${e(value)}"`));
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${e(config.title)}</title>`);
  out = replaceAttr(out, /<meta name="description"[^>]*>/, config.description);
  out = replaceAttr(out, /<meta name="theme-color"[^>]*>/, config.themeColor);
  out = replaceAttr(out, /<link rel="canonical"[^>]*>/, url);
  out = replaceAttr(out, /<meta property="og:url"[^>]*>/, url);
  out = replaceAttr(out, /<meta property="og:title"[^>]*>/, config.appName);
  out = replaceAttr(out, /<meta property="og:description"[^>]*>/, config.description);
  out = replaceAttr(out, /<meta property="og:image"[^>]*>/, config.ogImageUrl);
  out = replaceAttr(out, /<meta name="twitter:title"[^>]*>/, config.appName);
  out = replaceAttr(out, /<meta name="twitter:description"[^>]*>/, config.description);
  out = replaceAttr(out, /<meta name="twitter:image"[^>]*>/, config.ogImageUrl);
  return out;
}
