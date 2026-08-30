import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Playwright — tests de bout-en-bout (E2E) de MetalFlow Pro.
//
// Cible :
//   • Par défaut, un serveur `vite dev` local démarré par Playwright (avec des
//     variables publiques de remplacement, non secrètes, pour que l'app boote).
//   • Ou une URL externe via E2E_BASE_URL (ex. https://metalflowpro.com) — dans
//     ce cas aucun serveur local n'est lancé.
//
// Les parcours AUTHENTIFIÉS ne s'exécutent que si E2E_EMAIL / E2E_PASSWORD sont
// fournis (compte de test approuvé) ; sinon ils sont automatiquement ignorés.
// Aucun identifiant n'est stocké dans le repo.
// ─────────────────────────────────────────────────────────────────────────────

const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl || 'http://localhost:5173';

// Variables publiques de remplacement pour faire booter l'app en local (non
// secrètes). Les vraies valeurs Supabase, si présentes dans l'environnement, sont
// réutilisées ; sinon un placeholder suffit pour rendre l'écran d'accueil/login
// (aucun appel authentifié n'aboutit, l'app retombe proprement sur la landing).
const webServerEnv: Record<string, string> = {
  VITE_PUBLIC_SITE_URL: baseURL,
  VITE_PUBLIC_APP_NAME: 'MetalFlow Pro',
  VITE_PUBLIC_APP_TITLE: 'MetalFlow Pro',
  VITE_PUBLIC_APP_DESCRIPTION: 'Mineral processing plant design and optimization',
  VITE_PUBLIC_THEME_COLOR: '#0A0E17',
  VITE_PUBLIC_OG_IMAGE_URL: `${baseURL}/og.png`,
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: webServerEnv,
      },
});
