-- ═══════════════════════════════════════════════════════════════════════════
-- S6 — Service de calcul mfp-compute et reproductibilité.
-- Chantier S6 / Faiblesses F1 (reproductibilité) + F7 (retries/snapshots).
--
-- S4 a posé le CONTRAT serveur de provenance (mfp_value_provenance append-only,
-- mfp_record_value_provenance() SECURITY DEFINER, input_hash/output_hash/
-- engine_version, trigger bloquant la mutation directe des colonnes calculées).
-- S6 exécute les calculs réels de façon reproductible et traçable.
--
-- Périmètre SQL testable (le moteur TS réel sera un client de ces RPC) :
--   1. Ledger mfp_compute_run : statut, snapshot d'entrée, hashes, moteur,
--      tentative, retry_of, claim concurrent (FOR UPDATE SKIP LOCKED), erreurs.
--   2. Moteur déterministe mfp_p80_engine : même (input, engine_version) → même
--      output_hash. Versionné : changer engine_version ou l'entrée change le hash.
--   3. RPC SECURITY DEFINER : mfp_enqueue_compute, mfp_claim_compute_run,
--      mfp_succeed_p80_compute_run, mfp_fail_compute_run, mfp_retry_compute_run,
--      mfp_replay_p80_compute (preuve de reproductibilité).
--   4. Invariants : transitions de statut uniquement via fonctions ; snapshot/
--      hash/engine immuables après création ; run succeeded/failed non
--      modifiable ; succès atomique (résultat métier + provenance S4 + statut
--      succeeded dans la même transaction) ; audit S2 sur chaque transition.
--   5. RLS : lecture par appartenance projet, écriture directe interdite.
--
-- Piège évité : ne jamais marquer succeeded avant d'avoir écrit le résultat
-- métier ET la provenance — tout dans la même transaction. Le worker n'écrit
-- jamais directement les colonnes calculées (sinon il contourne S4).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Ledger des calculs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfp_compute_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  compute_type    text NOT NULL,        -- 'p80', 'mass_balance', 'simulation', ...
  target_table    text NOT NULL,        -- 'p80_test_result', ...
  target_id       uuid,                 -- id de la ligne cible (nullable au enqueue)
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
  attempt         int  NOT NULL DEFAULT 1,
  max_attempts    int  NOT NULL DEFAULT 3,
  retry_of        uuid REFERENCES public.mfp_compute_run(id) ON DELETE SET NULL,
  -- snapshots / hashes (immuables après création)
  input_snapshot  jsonb NOT NULL,
  input_hash      text NOT NULL,
  output_snapshot jsonb,
  output_hash     text,
  -- moteur
  engine_name     text NOT NULL,
  engine_version  text NOT NULL,
  -- concurrence / cycle de vie
  claimed_by      uuid,
  claimed_at      timestamptz,
  finished_at     timestamptz,
  error_code      text,
  error_message   text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compute_run_pending
  ON public.mfp_compute_run (created_at) WHERE status = 'pending';

COMMENT ON TABLE public.mfp_compute_run IS
  'Ledger des calculs : reproductible (input_hash+engine_version→output_hash), '
  'concurrence contrôlée (claim SKIP LOCKED), retries chaînés. Transitions de '
  'statut et écritures uniquement via les fonctions mfp_* (trigger de verrou).';

-- ── 2. Moteur déterministe (P80) ───────────────────────────────────────────
-- Même (input_snapshot, engine_version) → même (output, output_hash).
-- Versionné : engine_version 'p80.v1' et 'p80.v2' appliquent des formules
-- différentes → output différent. Le moteur TS réel devra reproduire exactement
-- la même canonicalisation jsonb et les mêmes formules.
CREATE OR REPLACE FUNCTION public.mfp_p80_engine(p_input jsonb, p_engine_version text)
RETURNS TABLE (computed_p80 numeric, computed_recovery numeric, output_hash text)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_feed_p80     numeric := COALESCE((p_input->>'feed_p80')::numeric, 0);
  v_recovery_pct numeric := COALESCE((p_input->>'recovery_pct')::numeric, 0);
  v_p80          numeric;
  v_rec          numeric;
  v_out          jsonb;
BEGIN
  IF p_engine_version = 'p80.v1' THEN
    v_p80 := v_feed_p80;
    v_rec := v_recovery_pct;
  ELSIF p_engine_version = 'p80.v2' THEN
    -- raffinement : seuil plus fin, récupération ajustée
    v_p80 := round(v_feed_p80 * 0.95, 4);
    v_rec := round(v_recovery_pct * 0.98, 4);
  ELSE
    RAISE EXCEPTION 'Version de moteur P80 inconnue : %', p_engine_version;
  END IF;
  v_out := jsonb_build_object('computed_p80', v_p80, 'computed_recovery', v_rec,
                              'engine_version', p_engine_version);
  output_hash := encode(digest(v_out::text, 'sha256'), 'hex');
  RETURN QUERY SELECT v_p80, v_rec, output_hash;
END $$;

COMMENT ON FUNCTION public.mfp_p80_engine(jsonb, text) IS
  'Moteur de calcul P80 déterministe et versionné. Même entrée + même '
  'engine_version → même output_hash (preuve de reproductibilité S6).';

-- ── 3. Verrou d'écriture : seules les fonctions mfp_* modifient le ledger ────
CREATE OR REPLACE FUNCTION public.mfp_compute_run_guard()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- bypass posé par les fonctions contrôlées (SECURITY DEFINER)
  IF current_setting('mfp.compute.bypass', true) = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'mfp_compute_run : insertion directe interdite, utiliser mfp_enqueue_compute()';
  END IF;
  RAISE EXCEPTION 'mfp_compute_run : modification directe interdite, utiliser les fonctions mfp_* (statut, hashes, retry)';
END $$;

CREATE TRIGGER mfp_compute_run_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.mfp_compute_run
  FOR EACH ROW EXECUTE FUNCTION public.mfp_compute_run_guard();

-- S6 enregistre sa propre règle d'étanchéité pour la self-référence retry_of
-- (défense en profondeur : même si une voie d'écriture directe était ajoutée,
-- un run ne pourrait pas pointer son retry_of vers un run d'un autre projet).
INSERT INTO public.mfp_project_consistency_rule
  (child_table, child_fk_column, parent_table, parent_pk_column, enabled)
VALUES ('mfp_compute_run', 'retry_of', 'mfp_compute_run', 'id', true)
ON CONFLICT (child_table, child_fk_column, parent_table) DO NOTHING;

DO $$ BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS mfp_consistency ON public.mfp_compute_run';
  EXECUTE 'CREATE TRIGGER mfp_consistency BEFORE INSERT OR UPDATE ON public.mfp_compute_run '
          'FOR EACH ROW EXECUTE FUNCTION public.mfp_enforce_project_consistency()';
END $$;

-- ── 4. RPC : enqueue ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfp_enqueue_compute(
  p_project_id    uuid,
  p_compute_type  text,
  p_target_table  text,
  p_target_id      uuid,
  p_input_snapshot jsonb,
  p_engine_name    text,
  p_engine_version text,
  p_max_attempts   int DEFAULT 3)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_hash text;
BEGIN
  v_hash := encode(digest(p_input_snapshot::text, 'sha256'), 'hex');
  PERFORM set_config('mfp.compute.bypass','1',true);
  INSERT INTO mfp_compute_run (project_id, compute_type, target_table, target_id,
      input_snapshot, input_hash, engine_name, engine_version, max_attempts, created_by)
    VALUES (p_project_id, p_compute_type, p_target_table, p_target_id,
      p_input_snapshot, v_hash, p_engine_name, p_engine_version, p_max_attempts,
      NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
    RETURNING id INTO v_id;
  PERFORM set_config('mfp.compute.bypass','',true);
  PERFORM public.mfp_audit_log(p_project_id, 'enqueue', 'compute_run', v_id::text,
    NULL, jsonb_build_object('compute_type', p_compute_type, 'engine_version', p_engine_version,
                       'input_hash', v_hash, 'attempt', 1), NULL, 'system');
  RETURN v_id;
END $$;

-- ── 5. RPC : claim (concurrence sécurisée) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfp_claim_compute_run(p_worker_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_proj uuid;
BEGIN
  PERFORM set_config('mfp.compute.bypass','1',true);
  -- un worker ne prend qu'un run pending à la fois, sans bloquer les autres.
  -- autorisé pour tout membre approuvé du projet (le worker agit au nom du projet).
  SELECT c.id, c.project_id INTO v_id, v_proj
    FROM mfp_compute_run c
   WHERE c.status = 'pending'
     AND public.mfp_can_read(c.project_id, 'governance')
   ORDER BY c.created_at
   LIMIT 1
   FOR UPDATE SKIP LOCKED;
  IF v_id IS NULL THEN
    PERFORM set_config('mfp.compute.bypass','',true);
    RETURN NULL;
  END IF;
  UPDATE mfp_compute_run
     SET status = 'running', claimed_by = p_worker_id, claimed_at = now()
   WHERE id = v_id;
  PERFORM set_config('mfp.compute.bypass','',true);
  PERFORM public.mfp_audit_log(v_proj, 'claim', 'compute_run', v_id::text,
    NULL, jsonb_build_object('worker', p_worker_id), NULL, 'system');
  RETURN v_id;
END $$;

-- ── 6. RPC : succeed (atomique : résultat + provenance S4 + statut) ─────────
CREATE OR REPLACE FUNCTION public.mfp_succeed_p80_compute_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r        mfp_compute_run%ROWTYPE;
  v_p80    numeric; v_rec numeric; v_ohash text;
  v_out    jsonb; v_target uuid;
BEGIN
  SELECT * INTO r FROM mfp_compute_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run % introuvable', p_run_id; END IF;
  IF r.status <> 'running' THEN
    RAISE EXCEPTION 'Run % non exécutable (statut=%). Le revendiquer d''abord via mfp_claim_compute_run.',
      p_run_id, r.status;
  END IF;
  -- 1. calcul déterministe
  SELECT computed_p80, computed_recovery, output_hash
    INTO v_p80, v_rec, v_ohash
    FROM mfp_p80_engine(r.input_snapshot, r.engine_version);
  v_out := jsonb_build_object('computed_p80', v_p80, 'computed_recovery', v_rec,
                              'engine_version', r.engine_version);
  v_target := COALESCE(r.target_id, NULL);
  -- 2. écriture du résultat métier + provenance S4 (transaction unique)
  IF v_target IS NOT NULL THEN
    PERFORM mfp_record_p80_computation(v_target, v_p80, v_rec, 'p80_engine',
      jsonb_build_object('run_id', r.id::text, 'engine_version', r.engine_version,
                         'input_hash', r.input_hash),
      r.engine_version);
  END IF;
  -- 3. statut succeeded + output
  PERFORM set_config('mfp.compute.bypass','1',true);
  UPDATE mfp_compute_run
     SET status = 'succeeded', output_snapshot = v_out, output_hash = v_ohash,
         finished_at = now()
   WHERE id = p_run_id;
  PERFORM set_config('mfp.compute.bypass','',true);
  PERFORM public.mfp_audit_log(r.project_id, 'succeed', 'compute_run', p_run_id::text,
    NULL, jsonb_build_object('output_hash', v_ohash), NULL, 'system');
END $$;

-- ── 7. RPC : fail ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfp_fail_compute_run(
  p_run_id uuid, p_error_code text, p_error_message text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r mfp_compute_run%ROWTYPE;
BEGIN
  SELECT * INTO r FROM mfp_compute_run WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run % introuvable', p_run_id; END IF;
  IF r.status <> 'running' THEN
    RAISE EXCEPTION 'Run % non en cours (statut=%). Seul un run running peut échouer.',
      p_run_id, r.status;
  END IF;
  PERFORM set_config('mfp.compute.bypass','1',true);
  UPDATE mfp_compute_run
     SET status = 'failed', error_code = p_error_code,
         error_message = p_error_message, finished_at = now()
   WHERE id = p_run_id;
  PERFORM set_config('mfp.compute.bypass','',true);
  PERFORM public.mfp_audit_log(r.project_id, 'fail', 'compute_run', p_run_id::text,
    NULL, jsonb_build_object('error_code', p_error_code), NULL, 'system');
END $$;

-- ── 8. RPC : retry (chaîné, respecte max_attempts) ─────────────────────────
CREATE OR REPLACE FUNCTION public.mfp_retry_compute_run(p_run_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r mfp_compute_run%ROWTYPE; v_new uuid;
BEGIN
  SELECT * INTO r FROM mfp_compute_run WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run % introuvable', p_run_id; END IF;
  IF r.status <> 'failed' THEN
    RAISE EXCEPTION 'Seul un run failed peut être relancé (run % statut=%).',
      p_run_id, r.status;
  END IF;
  IF r.attempt >= r.max_attempts THEN
    RAISE EXCEPTION 'Run % : tentatives épuisées (%/%).', p_run_id, r.attempt, r.max_attempts;
  END IF;
  PERFORM set_config('mfp.compute.bypass','1',true);
  INSERT INTO mfp_compute_run (project_id, compute_type, target_table, target_id,
      input_snapshot, input_hash, engine_name, engine_version, max_attempts,
      attempt, retry_of, created_by)
    VALUES (r.project_id, r.compute_type, r.target_table, r.target_id,
      r.input_snapshot, r.input_hash, r.engine_name, r.engine_version, r.max_attempts,
      r.attempt + 1, r.id,
      NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid)
    RETURNING id INTO v_new;
  PERFORM set_config('mfp.compute.bypass','',true);
  PERFORM public.mfp_audit_log(r.project_id, 'retry', 'compute_run', v_new::text,
    NULL, jsonb_build_object('retry_of', p_run_id::text, 'attempt', r.attempt + 1), NULL, 'system');
  RETURN v_new;
END $$;

-- ── 9. RPC : replay (preuve de reproductibilité) ───────────────────────────
-- Recalcule l'output_hash depuis l'entrée stockée et confirme qu'il est
-- identique à celui du run réussi. Levée d'erreur si divergence.
CREATE OR REPLACE FUNCTION public.mfp_replay_p80_compute(p_run_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE r mfp_compute_run%ROWTYPE; v_ohash text;
BEGIN
  SELECT * INTO r FROM mfp_compute_run WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Run % introuvable', p_run_id; END IF;
  SELECT output_hash INTO v_ohash FROM mfp_p80_engine(r.input_snapshot, r.engine_version);
  IF r.output_hash IS DISTINCT FROM v_ohash THEN
    RAISE EXCEPTION 'Reproductibilité brisée pour le run % : stocké=%, recalculé=%',
      p_run_id, r.output_hash, v_ohash;
  END IF;
  RETURN v_ohash;
END $$;

-- ── 10. RLS : lecture par appartenance, pas d'écriture directe ─────────────
ALTER TABLE public.mfp_compute_run ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mfp_compute_run_select ON public.mfp_compute_run;
CREATE POLICY mfp_compute_run_select ON public.mfp_compute_run
  FOR SELECT TO authenticated
  USING (public.mfp_can_read(project_id, 'governance'));

-- Aucune politique INSERT/UPDATE/DELETE : l'écriture passe uniquement par les
-- fonctions SECURITY DEFINER (le trigger de verrou bloque le reste).
