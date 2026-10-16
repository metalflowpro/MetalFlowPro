import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { renderPublicMetaHtml, resolvePublicRuntimeConfig } from './src/lib/config/appConfig';

/**
 * Métadonnées publiques (titre, description, canonique, Open Graph) écrites
 * dans le HTML au build. Sans variables VITE_PUBLIC_* (tests, e2e locaux), le
 * gabarit reste tel quel et l'exécution les pose comme avant.
 */
function publicMetaHtml(mode: string): Plugin {
  return {
    name: 'mfp-public-meta-html',
    transformIndexHtml(html) {
      try {
        const env = { ...loadEnv(mode, process.cwd(), 'VITE_PUBLIC_'), ...process.env };
        return renderPublicMetaHtml(html, resolvePublicRuntimeConfig(env));
      } catch {
        return html;
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), publicMetaHtml(mode)],
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['reactflow'],
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
  test: {
    // Les specs Playwright (e2e/) ne doivent PAS être ramassées par vitest :
    // elles utilisent le runner Playwright, pas vitest.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**', '**/e2e/**'],
  },
}));
