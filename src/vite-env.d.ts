/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_COPILOT_ENABLED?: 'true' | 'false';
  readonly VITE_PUBLIC_SITE_URL?: string;
  readonly VITE_PUBLIC_APP_NAME?: string;
  readonly VITE_PUBLIC_APP_TITLE?: string;
  readonly VITE_PUBLIC_APP_DESCRIPTION?: string;
  readonly VITE_PUBLIC_THEME_COLOR?: string;
  readonly VITE_PUBLIC_OG_IMAGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
