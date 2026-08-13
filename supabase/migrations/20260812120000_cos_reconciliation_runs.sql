-- ═══════════════════════════════════════════════════════════════════════════
-- Sauvegarde des scénarios de réconciliation (metal accounting, AMIRA P754).
--
-- Les panneaux de réconciliation réseau du COS (réseau WLS multi-composant 1B,
-- bilinéaire tonnage+teneur 1D/1E, élimination sérielle 1F) étaient jusqu'ici
-- EN MÉMOIRE SEULE. Or le metal accounting est une fonction de GOUVERNANCE :
-- P754 exige une piste d'audit — quel circuit, quelles mesures, quel résultat,
-- à quelle date. Cette table fige un scénario complet (entrées + résultat) pour
-- le recharger, le comparer et le tracer.
--
-- `input` = { nodes, streams, method, ... } tel que saisi ; `result_summary` =
-- extrait du résultat (clôtures, erreurs grossières, capteurs/analyses suspects,
-- éliminations) — assez pour l'audit sans re-calcul. Owner-scoped comme les
-- autres tables enfant (la RLS sur `projects` porte déjà le verrou d'approbation).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cos_reconciliation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label          text NOT NULL DEFAULT 'Réconciliation',
  -- 'network' (1B) | 'bilinear' (1D) | 'bilinear_iter' (1E) | 'serial' (1F)
  method         text NOT NULL DEFAULT 'network',
  input          jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cos_recon_runs_project
  ON public.cos_reconciliation_runs (project_id, created_at DESC);

ALTER TABLE public.cos_reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cos_recon_runs_owner_all ON public.cos_reconciliation_runs;
CREATE POLICY cos_recon_runs_owner_all ON public.cos_reconciliation_runs
  FOR ALL TO authenticated
  USING      (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));
