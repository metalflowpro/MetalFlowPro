-- ═══════════════════════════════════════════════════════════════════════════
-- S4 — Provenance uniforme des valeurs calculées.
-- Chantier S4 / Faiblesse F5.
--
-- Problème : un modèle de provenance existe déjà côté client
-- (src/lib/simulation/provenance.ts : SourceTier, Provenance, Sourced<T>), mais
-- il n'est PAS enforced côté serveur ni uniforme. Les valeurs calculées éparpillées
-- dans la base (p80_test_result.computed_p80 / computed_recovery,
-- cos_reconciliation_runs.result_summary, sim_nodes.results, etc.) ne portent
-- AUCUNE trace de leur origine : on ne sait pas quelle méthode les a produites, à
-- partir de quelles sources, par quelle version du moteur, ni quand. Impossible
-- de reproduire ou d'auditer un résultat calculé.
--
-- Solution : un registre serveur uniforme et append-only de la provenance de
-- TOUTE valeur calculée, aligné sur le modèle client (SourceTier / Provenance).
-- Une valeur calculée ne peut être estampillée que par la fonction contrôlée
-- mfp_record_value_provenance(), qui enregistre méthode, sources, versions et
-- hashes. La démonstration porte sur p80_test_result : les colonnes calculées ne
-- peuvent plus être écrites directement par le client — seulement via la fonction
-- mfp_record_p80_computation() qui pose la valeur ET sa provenance.
--
-- Délimitation S4 vs S6 : S4 définit le CONTRAT serveur obligatoire de
-- provenance (format, champs, hashes, auteur) et prouve qu'une valeur calculée
-- peut être tracée. S6 (mfp-compute) exécutera réellement les calculs, gérera
-- reproductibilité, retries et snapshots. S4 prévoit donc engine_version,
-- method_version, input_hash, output_hash — mais ne construit pas le moteur.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Registre global de provenance des valeurs ───────────────────────────
CREATE TABLE IF NOT EXISTS mfp_value_provenance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid REFERENCES projects(id) ON DELETE CASCADE,
  entity_type      text NOT NULL,            -- 'p80_test_result', 'sim_nodes', ...
  entity_id        text NOT NULL,            -- id de l'enregistrement porteur
  field_name       text NOT NULL,            -- 'computed_p80'
  value            jsonb NOT NULL,           -- la valeur calculée estampillée
  value_provenance text NOT NULL             -- aligné sur provenance.ts
                   CHECK (value_provenance IN
                     ('measured','calculated','estimated','default','user_assumption')),
  source_tier      text                       -- aligné sur SourceTier
                   CHECK (source_tier IS NULL OR source_tier IN
                     ('lims_approved','pilot_validated','testwork_validated',
                      'design_criteria','template_default','user_assumption')),
  method_key       text,                     -- 'p80_log_interpolation'
  method_version   text,                     -- version de l'algorithme
  formula          text,                      -- formule lisible
  source_refs      jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{table,id,field}] consommés
  input_hash       text,                     -- empreinte des entrées (reproductibilité)
  output_hash      text,                     -- empreinte de la sortie
  engine_version   text,                     -- version du moteur de calcul (S6)
  computed_by      uuid,                      -- auth.uid() imposé par le serveur
  computed_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfp_prov_latest
  ON mfp_value_provenance (project_id, entity_type, entity_id, field_name, created_at DESC);

COMMENT ON TABLE mfp_value_provenance IS
  'Registre append-only de la provenance de toute valeur calculée de la plateforme. Aligné sur lib/simulation/provenance.ts. Une ligne = une valeur produite + son origine complète.';

-- ── 2. RLS : lecture par appartenance projet ; écriture via fonction seule ─
ALTER TABLE mfp_value_provenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfp_value_provenance_read ON mfp_value_provenance
  FOR SELECT TO authenticated
  USING (project_id IS NOT NULL AND public.mfp_can_read(project_id, 'core'));
-- Aucune politique INSERT/UPDATE/DELETE pour authenticated : l'écriture ne se
-- fait que par la fonction SECURITY DEFINER mfp_record_value_provenance().

-- ── 3. Append-only + user_id serveur (même motif que audit_logs en S2) ───────
CREATE OR REPLACE FUNCTION mfp_prov_set_computed_by()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  -- computed_by imposé par le serveur depuis le JWT (non falsifiable).
  NEW.computed_by := auth.uid();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mfp_prov_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'mfp_value_provenance est append-only : aucune modification ni suppression autorisée (la provenance est immuable).';
END $$;

DROP TRIGGER IF EXISTS mfp_prov_set_computed_by ON public.mfp_value_provenance;
CREATE TRIGGER mfp_prov_set_computed_by BEFORE INSERT ON public.mfp_value_provenance
  FOR EACH ROW EXECUTE FUNCTION mfp_prov_set_computed_by();

DROP TRIGGER IF EXISTS mfp_prov_immutable_update ON public.mfp_value_provenance;
CREATE TRIGGER mfp_prov_immutable_update BEFORE UPDATE ON public.mfp_value_provenance
  FOR EACH ROW EXECUTE FUNCTION mfp_prov_immutable();

DROP TRIGGER IF EXISTS mfp_prov_immutable_delete ON public.mfp_value_provenance;
CREATE TRIGGER mfp_prov_immutable_delete BEFORE DELETE ON public.mfp_value_provenance
  FOR EACH ROW EXECUTE FUNCTION mfp_prov_immutable();

-- ── 4. Fonction contrôlée d'enregistrement de provenance ───────────────────
CREATE OR REPLACE FUNCTION public.mfp_record_value_provenance(
  p_project_id     uuid,
  p_entity_type    text,
  p_entity_id      text,
  p_field_name     text,
  p_value          jsonb,
  p_value_provenance text DEFAULT 'calculated',
  p_source_tier     text   DEFAULT NULL,
  p_method_key      text   DEFAULT NULL,
  p_method_version  text   DEFAULT NULL,
  p_formula         text   DEFAULT NULL,
  p_source_refs     jsonb  DEFAULT '[]'::jsonb,
  p_input_hash      text   DEFAULT NULL,
  p_output_hash     text   DEFAULT NULL,
  p_engine_version  text   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mfp_record_value_provenance: aucun utilisateur authentifié (JWT manquant).';
  END IF;
  -- Appartenance au projet : on ne trace que pour un projet auquel on appartient.
  IF p_project_id IS NOT NULL AND NOT public.mfp_can_read(p_project_id, 'core') THEN
    RAISE EXCEPTION 'mfp_record_value_provenance: accès au projet % refusé', p_project_id;
  END IF;

  INSERT INTO public.mfp_value_provenance
    (project_id, entity_type, entity_id, field_name, value, value_provenance,
     source_tier, method_key, method_version, formula, source_refs,
     input_hash, output_hash, engine_version)
  VALUES
    (p_project_id, p_entity_type, p_entity_id, p_field_name, p_value,
     p_value_provenance, p_source_tier, p_method_key, p_method_version, p_formula,
     p_source_refs, p_input_hash, p_output_hash, p_engine_version)
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.mfp_record_value_provenance FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfp_record_value_provenance TO authenticated;

-- ── 5. Helper : dernière provenance d'un champ ──────────────────────────────
-- Fonction STABLE (non SECURITY DEFINER) : la RLS s'applique, un membre ne voit
-- que la provenance de son projet.
CREATE OR REPLACE FUNCTION public.mfp_provenance_for(
  p_entity_type text, p_entity_id text, p_field_name text
) RETURNS public.mfp_value_provenance
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.mfp_value_provenance
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND field_name = p_field_name
  ORDER BY created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.mfp_provenance_for TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Démonstration : p80_test_result — les colonnes calculées ne s'écrivent
--    que via la fonction qui estampille la provenance.
-- ═══════════════════════════════════════════════════════════════════════════

-- Trigger : bloque la mutation directe (par le client) des colonnes calculées.
-- La fonction contrôlée lève le verrou via la GUC locale mfp.provenance.bypass.
CREATE OR REPLACE FUNCTION public.mfp_p80_computed_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('mfp.provenance.bypass', true) IS DISTINCT FROM '1' THEN
    IF (NEW.computed_p80    IS DISTINCT FROM OLD.computed_p80)
    OR (NEW.computed_recovery IS DISTINCT FROM OLD.computed_recovery) THEN
      RAISE EXCEPTION
        'p80_test_result: les colonnes calculées (computed_p80, computed_recovery) ne sont pas modifiables directement. Utilisez SELECT mfp_record_p80_computation(...) pour poser la valeur ET sa provenance.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS p80_test_result_computed_immutable ON public.p80_test_result;
CREATE TRIGGER p80_test_result_computed_immutable
  BEFORE UPDATE ON public.p80_test_result
  FOR EACH ROW EXECUTE FUNCTION mfp_p80_computed_immutable();

-- Fonction d'enregistrement d'un résultat P80 calculé : pose la valeur ET
-- estampille la provenance des deux champs, dans la même transaction.
CREATE OR REPLACE FUNCTION public.mfp_record_p80_computation(
  p_result_id       uuid,
  p_computed_p80    numeric,
  p_computed_recovery numeric,
  p_p80_method      text,
  p_source_refs     jsonb,
  p_engine_version  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_proj    uuid;
  v_in_hash text := md5(p_source_refs::text);
  v_out_p80 text := md5(p_computed_p80::text);
  v_out_rec text := md5(p_computed_recovery::text);
BEGIN
  SELECT project_id INTO v_proj FROM public.p80_test_result WHERE id = p_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mfp_record_p80_computation: résultat P80 % introuvable.', p_result_id;
  END IF;

  -- Droit d'écriture sur le domaine granulometry (posé par S1).
  IF NOT public.mfp_can_write(v_proj, 'granulometry') THEN
    RAISE EXCEPTION 'mfp_record_p80_computation: pas de droit d''écriture sur le domaine granulometry pour ce projet.';
  END IF;

  -- 1) Pose la valeur calculée (lève le verrou d'immutabilité le temps de l'update).
  PERFORM set_config('mfp.provenance.bypass','1',true);
  UPDATE public.p80_test_result
  SET computed_p80 = p_computed_p80,
      computed_recovery = p_computed_recovery,
      p80_method = p_p80_method
  WHERE id = p_result_id;
  PERFORM set_config('mfp.provenance.bypass', NULL, true);

  -- 2) Estampille la provenance des deux champs calculés.
  PERFORM public.mfp_record_value_provenance(
    v_proj, 'p80_test_result', p_result_id::text, 'computed_p80',
    to_jsonb(p_computed_p80), 'calculated', 'testwork_validated',
    p_p80_method, '1', 'P80 = taille à 80% de passage cumulée (interpolation log de la PSD)',
    p_source_refs, v_in_hash, v_out_p80, p_engine_version);

  PERFORM public.mfp_record_value_provenance(
    v_proj, 'p80_test_result', p_result_id::text, 'computed_recovery',
    to_jsonb(p_computed_recovery), 'calculated', 'testwork_validated',
    'recovery_balance', '1', 'Récupération = (charge - stérile) / charge (bilan matière)',
    p_source_refs, v_in_hash, v_out_rec, p_engine_version);

  -- 3) Journalise l'action (source 'app', détail dans metadata — pas de nouvelle
  --    valeur audit_logs.source, pour ne pas modifier la contrainte CHECK de S2).
  PERFORM public.mfp_audit_log(
    v_proj, 'update', 'p80_test_result', p_result_id::text,
    NULL, jsonb_build_object('computed_p80', p_computed_p80, 'computed_recovery', p_computed_recovery),
    jsonb_build_object('engine_version', p_engine_version, 'p80_method', p_p80_method),
    'app');
END $$;

REVOKE ALL ON FUNCTION public.mfp_record_p80_computation FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mfp_record_p80_computation TO authenticated;
