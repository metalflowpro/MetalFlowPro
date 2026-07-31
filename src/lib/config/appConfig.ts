export interface PublicRuntimeConfig {
  appName: string;
  title: string;
  description: string;
  themeColor: string;
  siteUrl: string;
  ogImageUrl: string;
}

type PublicEnv = Record<string, string | undefined>;

const DEFAULT_SITE_URL = 'https://metalflowpro.com';
const DEFAULT_APP_NAME = 'MetalFlow Pro';
const DEFAULT_DESCRIPTION =
  "MetalFlow Pro : plateforme intégrée d'études métallurgiques, de simulation de circuits et d'évaluation économique pour projets miniers (LIMS, block model, flowsheet, NI 43-101).";
const DEFAULT_TITLE = "MetalFlow Pro — Plateforme d'ingénierie métallurgique & minière";
const DEFAULT_THEME_COLOR = '#0b0d10';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function configured(env: PublicEnv, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

export function resolvePublicRuntimeConfig(env: PublicEnv): PublicRuntimeConfig {
  const siteUrl = trimTrailingSlash(configured(env, 'VITE_PUBLIC_SITE_URL', DEFAULT_SITE_URL));
  const appName = configured(env, 'VITE_PUBLIC_APP_NAME', DEFAULT_APP_NAME);
  return {
    appName,
    title: configured(env, 'VITE_PUBLIC_APP_TITLE', DEFAULT_TITLE),
    description: configured(env, 'VITE_PUBLIC_APP_DESCRIPTION', DEFAULT_DESCRIPTION),
    themeColor: configured(env, 'VITE_PUBLIC_THEME_COLOR', DEFAULT_THEME_COLOR),
    siteUrl,
    ogImageUrl: configured(env, 'VITE_PUBLIC_OG_IMAGE_URL', `${siteUrl}/og-image.svg`),
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
