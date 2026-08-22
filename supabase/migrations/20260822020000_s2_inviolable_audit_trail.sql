-- ═══════════════════════════════════════════════════════════════════════════
-- 20260822020000_s2_inviolable_audit_trail.sql
-- S2 — Piste d'audit inviolable. Corrige F2.
--
-- Le problème (mesuré sur le schéma existant) :
--   • audit_logs portait une politique FOR ALL `user_id = auth.uid()` : celui-là
--     même que la piste surveille pouvait UPDATE/DELETE ses propres lignes.
--   • user_id, previous_values, new_values, action étaient fournis par le
--     client → falsifiable (qui a fait quoi, et les valeurs d'avant/après).
--   • Le client auditLog.ts retombait sur un journal en mémoire quand l'écriture
--     échouait : l'interface se comportait comme si l'enregistrement avait
--     réussi. Croise le piège T3b (0 ligne silencieuse).
--
-- La solution :
--   1. audit_logs devient APPEND-ONLY. Un trigger BEFORE UPDATE/DELETE lève une
--      exception, quel que soit le rôle (défense en profondeur, indépendante
--      de la RLS). L'historique ne peut plus être réécrit, même par service_role.
--   2. user_id est dérivé du serveur : un trigger BEFORE INSERT impose
--      auth.uid() pour tout appelant authentifié. Le client ne peut plus
--      falsifier QUI a agi.
--   3. Aucune politique INSERT/UPDATE/DELETE pour authenticated : l'écriture
--      directe est impossible côté client. Seule la fonction SECURITY DEFINER
--      mfp_audit_log() peut insérer, en vérifiant l'appartenance au projet.
--   4. Lecture par appartenance : un membre lit les logs de son projet ; les
--      logs système (project_id NULL) sont réservés à l'administrateur.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Aménagement du schéma ───────────────────────────────────────────────
-- `source` distingue les entrées saisies par l'application (app) de celles
-- capturées automatiquement par un trigger métier (trigger). La capture
-- automatique large fait partie du déploiement S2 (voir § Fonction de capture).
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app'
    CHECK (source IN ('app','trigger','system'));

-- On retire la colonne user_id du contrôle client : elle devient NOT NULL sans
-- défaut (le trigger BEFORE INSERT la positionne depuis auth.uid()).
ALTER TABLE public.audit_logs ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE public.audit_logs ALTER COLUMN user_id SET NOT NULL;

-- ── 1. Politiques : lecture par appartenance, écriture directe interdite ───
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_owner_access" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_read"        ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert"      ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_update"      ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_delete"      ON public.audit_logs;

-- Lecture : les membres approuvés lisent les logs de leur projet ; les logs
-- système (project_id NULL) sont visibles de l'administrateur uniquement.
CREATE POLICY "audit_logs_read" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (project_id IS NOT NULL AND public.mfp_can_read(project_id, 'core'))
    OR (project_id IS NULL AND public.is_admin())
  );

-- Aucune politique INSERT / UPDATE / DELETE : un client ne peut ni ajouter ni
-- modifier ni supprimer de log. L'écriture passe exclusivement par
-- mfp_audit_log() (SECURITY DEFINER), qui s'exécute comme le propriétaire de
-- la fonction et contourne donc la RLS tout en imposant user_id = auth.uid().

-- ── 2. Trigger d'attribution serveur de user_id (anti-falsification du QUI) ─
CREATE OR REPLACE FUNCTION public.mfp_audit_set_user_id()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid;
BEGIN
  -- Pour tout appelant authentifié, user_id est imposé par le serveur depuis
  -- le JWT validé par PostgREST. Un appelant non authentifié (migration,
  -- ingestion système) peut fournir explicitement user_id.
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    NEW.user_id := v_uid;
  END IF;
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'audit_logs: user_id impossible à déterminer (ni JWT ni valeur système)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS audit_logs_set_user_id ON public.audit_logs;
CREATE TRIGGER audit_logs_set_user_id
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.mfp_audit_set_user_id();

-- ── 3. Trigger d'immuabilité (append-only, défense en profondeur) ──────────
-- Bloque UPDATE et DELETE quel que soit le rôle. La RLS interdit déjà ces
-- opérations pour authenticated ; ce trigger empêche aussi service_role de
-- réécrire l'historique. Une migration exceptionnelle peut le désactiver
-- temporairement (ALTER TABLE ... DISABLE TRIGGER).
CREATE OR REPLACE FUNCTION public.mfp_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs est inviolable : aucune modification ni suppression autorisée (append-only).';
END $$;

DROP TRIGGER IF EXISTS audit_logs_immutable_update ON public.audit_logs;
DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON public.audit_logs;
CREATE TRIGGER audit_logs_immutable_update
  BEFORE UPDATE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.mfp_audit_immutable();
CREATE TRIGGER audit_logs_immutable_delete
  BEFORE DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.mfp_audit_immutable();

-- ── 4. Fonction d'écriture unique (SECURITY DEFINER) ───────────────────────
-- C'est le SEUL point d'entrée d'écriture. Le client l'appelle via RPC ;
-- jamais d'INSERT direct. La fonction :
--   • impose user_id = auth.uid() (via le trigger) → le QUI est infalsifiable ;
--   • vérifie l'appartenance au projet → on ne peut pas journaliser contre un
--     projet auquel on n'appartient pas ;
--   • horodate côté serveur.
-- Les valeurs previous_values / new_values restent fournies par l'appelant :
-- leur inviolabilité totale (capture automatique côté serveur) relève de la
-- fonction de capture ci-dessous, déployée table par table.
CREATE OR REPLACE FUNCTION public.mfp_audit_log(
  p_project_id    uuid,
  p_action        text,
  p_entity_type   text,
  p_entity_id      text  DEFAULT NULL,
  p_previous_values jsonb DEFAULT NULL,
  p_new_values      jsonb DEFAULT NULL,
  p_metadata        jsonb DEFAULT NULL,
  p_source           text  DEFAULT 'app'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_log_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mfp_audit_log: aucun utilisateur authentifié (JWT manquant)';
  END IF;
  -- Appartenance au projet : on ne journalise que pour un projet auquel on
  -- appartient. Les logs système (project_id NULL) sont réservés au backend.
  IF p_project_id IS NOT NULL AND NOT public.mfp_can_read(p_project_id, 'core') THEN
    RAISE EXCEPTION 'mfp_audit_log: accès au projet % refusé', p_project_id;
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('app','trigger','system') THEN
    p_source := 'app';
  END IF;

  INSERT INTO public.audit_logs
    (project_id, user_id, action, entity_type, entity_id,
     previous_values, new_values, metadata, source)
  VALUES
    (p_project_id, v_uid, p_action, p_entity_type, p_entity_id,
     p_previous_values, p_new_values, COALESCE(p_metadata, '{}'::jsonb), p_source)
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END $$;

GRANT EXECUTE ON FUNCTION public.mfp_audit_log(
  uuid, text, text, text, jsonb, jsonb, jsonb, text) TO authenticated;

-- ── 5. Fonction de capture automatique (fondation du déploiement S2) ────────
-- Trigger générique à attacher aux tables métier critiques : capture
-- automatiquement les anciennes et nouvelles valeurs, côté serveur, sans
-- intervention du client. Démonstration sur `risks` ci-dessous ; le
-- déploiement large à toutes les tables fait partie de la suite S2.
CREATE OR REPLACE FUNCTION public.mfp_capture_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_proj  uuid;
  v_act   text;
  v_prev  jsonb;
  v_new   jsonb;
  v_log   uuid;
BEGIN
  -- Les opérations sans utilisateur authentifié (migrations, ingestion système)
  -- ne sont pas des actions utilisateur : on ne les capture pas. En production,
  -- tout transite par PostgREST avec un JWT, donc auth.uid() est toujours défini.
  IF auth.uid() IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- project_id est la première colonne project_id disponible
  BEGIN
    EXECUTE format('SELECT ($1).%I', 'project_id') INTO v_proj USING (CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END);
  EXCEPTION WHEN OTHERS THEN v_proj := NULL; END;

  v_act := lower(TG_OP);
  v_new := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  v_prev := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;

  -- Écrit via la fonction d'écriture unique → user_id imposé par le trigger.
  v_log := public.mfp_audit_log(
    v_proj, v_act, TG_TABLE_NAME,
    (CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE (v_prev->>'id') END),
    v_prev, v_new,
    jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'trigger', TG_NAME),
    'trigger'
  );
  RETURN COALESCE(NEW, OLD);
END $$;

-- Démonstration : capture automatique sur `risks`. Tout UPDATE/DELETE sur risks
-- est désormais tracé côté serveur, avec les vraies valeurs avant/après — le
-- client ne peut plus les falsifier.
DROP TRIGGER IF EXISTS risks_audit_capture ON public.risks;
CREATE TRIGGER risks_audit_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.risks
  FOR EACH ROW EXECUTE FUNCTION public.mfp_capture_audit();

-- ── 6. Privilèges ──────────────────────────────────────────────────────────
GRANT SELECT ON public.audit_logs TO authenticated;
