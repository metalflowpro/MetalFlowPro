import { describe, expect, it } from 'vitest';
import { resolvePublicRuntimeConfig } from './appConfig';

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
