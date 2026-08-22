-- ═══════════════════════════════════════════════════════════════════════════
-- S3 — Automate de cycle de vie et immuabilité du publié.
-- Chantier S3 / Faiblesse F2.
--
-- Problème : sim_flowsheets possède déjà un status (draft|calibrated|validated|
-- archived) et une colonne version, mais aucune règle de transition n'est
-- enforced côté serveur et rien n'empêche de modifier un flowsheet « validated ».
-- Les données techniques publiées — qui alimentent les rapports NI 43-101 —
-- ne sont donc pas immuables : un métallurgiste peut réécrire silencieusement un
-- flowsheet validé par le QP.
--
-- Solution :
--   1. Table de config data-driven mfp_lifecycle_status (entity_type, status,
--      is_locked, allowed_next) — le cycle de vie se configure, ne se code pas.
--   2. Helper mfp_lifecycle_is_allowed().
--   3. Trigger mfp_flowsheet_lifecycle sur sim_flowsheets : INSERT doit démarrer
--      à draft ; UPDATE ne peut changer status que via une transition autorisée ;
--      une ligne verrouillée (validated/archived) ne peut plus être mutée sauf
--      transition explicite validée→archivée ; DELETE refusé sur un publié.
--   4. Trigger mfp_node_lifecycle sur sim_nodes : bloque toute mutation de nœud
--      dont le flowsheet parent est verrouillé (sans quoi le publié restait
--      modifiable indirectement via ses nœuds).
--   5. Fonction SECURITY DEFINER mfp_fork_flowsheet_version() : chemin contrôlé
--      pour faire évoluer un flowsheet publié — crée une nouvelle version draft
--      (version+1) en copiant flowsheet + sim_nodes, puis journalise.
--
-- Important (leçon T3b) : l'immutabilité est enforced par TRIGGER qui lève une
-- erreur explicite, NON par une politique RLS restrictive. Une RLS USING trop
-- restrictive produirait le piège « 0 ligne silencieuse ». La RLS reste
-- l'autorisation large (mfp_can_write, posée par S1) ; les violations métier
-- (mutation de publié, transition interdite, suppression de publié) lèvent
-- côté SQL. S7 vérifiera tout de même le ROW_COUNT côté client.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Config du cycle de vie ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mfp_lifecycle_status (
  entity_type    text   NOT NULL,
  status         text   NOT NULL,
  is_locked      boolean NOT NULL DEFAULT false,   -- état publié / immuable
  allowed_next   text[] NOT NULL DEFAULT '{}',     -- transitions autorisées
  PRIMARY KEY (entity_type, status)
);

COMMENT ON TABLE mfp_lifecycle_status IS
  'Cycle de vie data-driven : pour un type d''entité, liste les états, lesquels sont verrouillés (publiés/immuables) et les transitions valides.';

-- Cycle de vie du flowsheet de simulation : linéaire, calibration requise
-- avant validation, le publié ne peut qu'être archivé, l'archivé est terminal.
INSERT INTO mfp_lifecycle_status (entity_type, status, is_locked, allowed_next) VALUES
  ('sim_flowsheet', 'draft',      false, ARRAY['calibrated']),
  ('sim_flowsheet', 'calibrated', false, ARRAY['validated','draft']),
  ('sim_flowsheet', 'validated',  true,  ARRAY['archived']),
  ('sim_flowsheet', 'archived',   true,  ARRAY[]::text[])
ON CONFLICT (entity_type, status) DO UPDATE
  SET is_locked = EXCLUDED.is_locked, allowed_next = EXCLUDED.allowed_next;

-- ── 2. Helper de transition ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION mfp_lifecycle_is_allowed(
  p_entity text, p_old text, p_new text
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mfp_lifecycle_status
    WHERE entity_type = p_entity
      AND status = p_old
      AND p_new = ANY(allowed_next)
  );
$$;

COMMENT ON FUNCTION mfp_lifecycle_is_allowed IS
  'Vrai si la transition p_old -> p_new est autorisée par la config du cycle de vie pour p_entity.';

-- ── 3. Nettoyage des politiques legacy par-table (remplacées par S1) ────────
-- S1 a posé des politiques canoniques (mfp_can_read/mfp_can_write) sur
-- sim_flowsheets/sim_nodes. Les anciennes politiques *_own_sim_* (basées sur
-- projects.user_id = auth.uid(), donc visibles du seul propriétaire) sont
-- redondantes et trompeuses : on les retire au profit du socle S1.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sim_flowsheets','sim_nodes'] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS select_own_%I ON public.%I;'
      'DROP POLICY IF EXISTS insert_own_%I ON public.%I;'
      'DROP POLICY IF EXISTS update_own_%I ON public.%I;'
      'DROP POLICY IF EXISTS delete_own_%I ON public.%I;',
      t, t, t, t, t, t, t, t);
  END LOOP;
END $$;

-- ── 4. Trigger de cycle de vie sur sim_flowsheets ───────────────────────────
CREATE OR REPLACE FUNCTION mfp_flowsheet_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_locked boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Un flowsheet démarre obligatoirement à draft (état initial non verrouillé).
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION
        'sim_flowsheet: un nouveau flowsheet doit démarrer à l''état ''draft'' (reçu: %).',
        NEW.status;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    SELECT l.is_locked INTO v_locked
    FROM mfp_lifecycle_status l
    WHERE l.entity_type = 'sim_flowsheet' AND l.status = OLD.status;
    IF COALESCE(v_locked, false) THEN
      RAISE EXCEPTION
        'sim_flowsheet: suppression interdite — le flowsheet est publié (status=%). Archivez-le.',
        OLD.status;
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Transition de statut : doit être explicitement autorisée par la config.
    IF NOT mfp_lifecycle_is_allowed('sim_flowsheet', OLD.status, NEW.status) THEN
      RAISE EXCEPTION
        'sim_flowsheet: transition de cycle de vie interdite ''%'' -> ''%''. Chemins autorisés depuis ''%'': %.',
        OLD.status, NEW.status, OLD.status,
        (SELECT array_agg(allowed_next) FROM mfp_lifecycle_status WHERE entity_type='sim_flowsheet' AND status=OLD.status);
    END IF;
    RETURN NEW;
  END IF;

  -- Statut inchangé : on regarde si l'état courant est verrouillé.
  SELECT l.is_locked INTO v_locked
  FROM mfp_lifecycle_status l
  WHERE l.entity_type = 'sim_flowsheet' AND l.status = OLD.status;
  IF COALESCE(v_locked, false) THEN
    RAISE EXCEPTION
      'sim_flowsheet: données publiées immuables (status=%). Pour modifier, créez une nouvelle version via SELECT mfp_fork_flowsheet_version(%).',
      OLD.status, OLD.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sim_flowsheets_lifecycle ON public.sim_flowsheets;
CREATE TRIGGER sim_flowsheets_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.sim_flowsheets
  FOR EACH ROW EXECUTE FUNCTION mfp_flowsheet_lifecycle();

-- ── 5. Trigger d'immuabilité des nœuds ──────────────────────────────────────
CREATE OR REPLACE FUNCTION mfp_node_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE v_status text; v_locked boolean;
BEGIN
  SELECT f.status, COALESCE(l.is_locked, false)
  INTO v_status, v_locked
  FROM public.sim_flowsheets f
  LEFT JOIN mfp_lifecycle_status l
    ON l.entity_type = 'sim_flowsheet' AND l.status = f.status
  WHERE f.id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.flowsheet_id ELSE NEW.flowsheet_id END);

  IF v_locked THEN
    RAISE EXCEPTION
      'sim_nodes: le flowsheet parent est publié (status=%) — % de nœud interdit. Créez une nouvelle version via mfp_fork_flowsheet_version.',
      v_status, lower(TG_OP);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS sim_nodes_lifecycle ON public.sim_nodes;
CREATE TRIGGER sim_nodes_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON public.sim_nodes
  FOR EACH ROW EXECUTE FUNCTION mfp_node_lifecycle();

-- ── 6. Fork de version (chemin contrôlé pour faire évoluer du publié) ─────
CREATE OR REPLACE FUNCTION mfp_fork_flowsheet_version(p_source_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_src        RECORD;
  v_new_id     uuid;
  v_new_ver    integer;
  v_uid        uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mfp_fork_flowsheet_version: aucun utilisateur authentifié (JWT manquant).';
  END IF;

  SELECT * INTO v_src FROM public.sim_flowsheets WHERE id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mfp_fork_flowsheet_version: flowsheet source % introuvable.', p_source_id;
  END IF;

  -- Le source doit être publié (validated/archived) : on ne fork pas un brouillon.
  IF v_src.status NOT IN ('validated','archived') THEN
    RAISE EXCEPTION
      'mfp_fork_flowsheet_version: le flowsheet source est à l''état ''%'' — on ne forke qu''un flowsheet publié (validated/archived). Éditez directement le brouillon ou forkez après validation.',
      v_src.status;
  END IF;

  -- Appartenance + droit d'écriture sur le domaine simulation (via S1).
  IF NOT public.mfp_can_write(v_src.project_id, 'simulation') THEN
    RAISE EXCEPTION 'mfp_fork_flowsheet_version: pas de droit d''écriture sur le domaine simulation pour ce projet.';
  END IF;

  -- Nouvelle version = max(version)+1 pour le même projet + même nom.
  SELECT COALESCE(max(version), 0) + 1 INTO v_new_ver
  FROM public.sim_flowsheets
  WHERE project_id = v_src.project_id AND name = v_src.name;

  INSERT INTO public.sim_flowsheets (project_id, name, version, status, description)
  VALUES (v_src.project_id, v_src.name, v_new_ver, 'draft', v_src.description)
  RETURNING id INTO v_new_id;

  -- Copie des nœuds (le nouveau flowsheet est draft → le trigger nœud autorise).
  INSERT INTO public.sim_nodes
    (flowsheet_id, project_id, unit_type, label, position_x, position_y,
     parameters, design_capacity, availability_pct, results)
  SELECT v_new_id, n.project_id, n.unit_type, n.label, n.position_x, n.position_y,
         n.parameters, n.design_capacity, n.availability_pct, n.results
  FROM public.sim_nodes n
  WHERE n.flowsheet_id = p_source_id;

  -- Journalisation de l'action de fork (via le canal S2).
  PERFORM public.mfp_audit_log(
    v_src.project_id, 'create', 'sim_flowsheets', v_new_id::text,
    jsonb_build_object('forked_from', p_source_id, 'forked_version', v_src.version),
    jsonb_build_object('new_version', v_new_ver, 'new_id', v_new_id),
    '{}'::jsonb, 'fork');

  RETURN v_new_id;
END $$;

REVOKE ALL ON FUNCTION mfp_fork_flowsheet_version(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mfp_fork_flowsheet_version(uuid) TO authenticated;

COMMENT ON FUNCTION mfp_fork_flowsheet_version IS
  'Crée une nouvelle version draft d''un flowsheet publié (validated/archived) en copiant flowsheet + nœuds. C''est le seul chemin pour faire évoluer une donnée technique publiée. L''original reste immuable.';
