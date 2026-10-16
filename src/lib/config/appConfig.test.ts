import { describe, expect, it } from 'vitest';
import { renderPublicMetaHtml, resolvePublicRuntimeConfig } from './appConfig';

describe('resolvePublicRuntimeConfig', () => {
  const config = {
    VITE_PUBLIC_APP_TITLE: 'Custom Flow title',
    VITE_PUBLIC_APP_DESCRIPTION: 'Custom Flow description',
    VITE_PUBLIC_THEME_COLOR: '#123456',
    VITE_PUBLIC_OG_IMAGE_URL: 'https://example.com/share.svg',
  };

  it('normalizes the public site URL and derives share image URLs from it', () => {
    const cfg = resolvePublicRuntimeConfig({
      ...config,
      VITE_PUBLIC_SITE_URL: 'https://example.com/app/',
      VITE_PUBLIC_APP_NAME: 'Custom Flow',
    });

    expect(cfg.siteUrl).toBe('https://example.com/app');
    expect(cfg.appName).toBe('Custom Flow');
    expect(cfg.ogImageUrl).toBe('https://example.com/share.svg');
  });

  it('fails fast when deployment metadata is not configured', () => {
    expect(() => resolvePublicRuntimeConfig({})).toThrow('VITE_PUBLIC_SITE_URL');
  });
});

describe('renderPublicMetaHtml', () => {
  const html = `<head><meta name="theme-color" content="" /><title></title><meta name="description" content="" />
<link rel="canonical" href="https://example.com/" /><meta property="og:url" content="https://example.com/" />
<meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:image" content="" />
<meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta name="twitter:image" content="" /></head>`;
  const cfg = resolvePublicRuntimeConfig({
    VITE_PUBLIC_SITE_URL: 'https://metalflowpro.com/',
    VITE_PUBLIC_APP_NAME: 'MetalFlow Pro',
    VITE_PUBLIC_APP_TITLE: 'MetalFlow Pro — "Études" & <métallurgie>',
    VITE_PUBLIC_APP_DESCRIPTION: 'Plateforme',
    VITE_PUBLIC_THEME_COLOR: '#0b0d10',
    VITE_PUBLIC_OG_IMAGE_URL: 'https://metalflowpro.com/og-image.svg',
  });
  const out = renderPublicMetaHtml(html, cfg);

  it('remplit le titre, la description et l’URL canonique dans le HTML brut', () => {
    expect(out).toContain('<link rel="canonical" href="https://metalflowpro.com/" />');
    expect(out).toContain('<meta property="og:url" content="https://metalflowpro.com/" />');
    expect(out).toContain('<meta name="theme-color" content="#0b0d10" />');
    expect(out).toContain('<meta property="og:image" content="https://metalflowpro.com/og-image.svg" />');
    expect(out).not.toContain('example.com');
  });

  it('échappe les valeurs (pas d’injection HTML via les variables)', () => {
    expect(out).toContain('<title>MetalFlow Pro — &quot;Études&quot; &amp; &lt;métallurgie&gt;</title>');
  });
});
