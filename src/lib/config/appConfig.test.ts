import { describe, expect, it } from 'vitest';
import { resolvePublicRuntimeConfig } from './appConfig';

describe('resolvePublicRuntimeConfig', () => {
  it('normalizes the public site URL and derives share image URLs from it', () => {
    const cfg = resolvePublicRuntimeConfig({
      VITE_PUBLIC_SITE_URL: 'https://example.com/app/',
      VITE_PUBLIC_APP_NAME: 'Custom Flow',
    });

    expect(cfg.siteUrl).toBe('https://example.com/app');
    expect(cfg.appName).toBe('Custom Flow');
    expect(cfg.ogImageUrl).toBe('https://example.com/app/og-image.svg');
  });

  it('uses documented defaults when deployment metadata is not configured', () => {
    const cfg = resolvePublicRuntimeConfig({});
    expect(cfg.siteUrl).toBe('https://metalflowpro.com');
    expect(cfg.appName).toBe('MetalFlow Pro');
  });
});
