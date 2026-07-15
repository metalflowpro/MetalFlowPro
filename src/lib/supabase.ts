import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Fail fast with a clear message rather than a silent runtime crash deep in a query.
if (!supabaseUrl || !supabaseAnonKey) {
  const missing = [
    !supabaseUrl && 'VITE_SUPABASE_URL',
    !supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
  ].filter(Boolean).join(', ');
  throw new Error(
    `[MetalFlow Pro] Variable(s) d'environnement Supabase manquante(s) : ${missing}. ` +
    `Définissez-les dans le fichier .env (dev) ou dans les secrets de déploiement (prod).`
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
