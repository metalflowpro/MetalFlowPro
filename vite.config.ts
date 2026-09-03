import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
});
