-- ═══════════════════════════════════════════════════════════════════════════
-- S5 — Étanchéité complète et intégrité référentielle.
-- Chantier S5 / Faiblesse F4.
--
-- Problème : (1) deux tables (lims_import_log, mine_design_pits) ont un
-- project_id SANS FK vers projects — risque d'orphelins ; (2) de ~55 relations
-- enfant→parent où l'enfant a project_id ET le parent a project_id, la FK est
-- mono-colonne (sample_id, config_id, flowsheet_id...) : elle garantit
-- l'EXISTENCE du parent, mais PAS que l'enfant et le parent sont du MÊME projet.
-- Un lims_test_chem(project_id=A, sample_id=échantillon_de_B) passe la FK mais
-- viole l'étanchéité projet — une fuite de données entre projets.
--
-- Solution (couple FK existantes + garde déclenchée + project_id immuable) :
--   1. Ajoute les FK manquantes project_id → projects(id).
--   2. Table de règles mfp_project_consistency_rule auto-peuplée depuis le
--      schéma (data-driven) : pour chaque relation à risque détectée, on enregistre
--      (enfant, fk_col, parent, pk_col).
--   3. Trigger mfp_enforce_project_consistency (SECURITY DEFINER) déployé sur
--      chaque enfant à risque : au INSERT/UPDATE, vérifie que parent.project_id
--      = enfant.project_id. Une fk_col NULL ne déclenche pas de fausse erreur.
--   4. Trigger mfp_project_id_immutable sur TOUTES les tables projetées : on ne
--      peut pas changer un project_id après création (sinon l'étanchéité peut
--      être contournée en déplaçant un parent).
--   5. Vue mfp_project_consistency_gap : relations à risque sans règle active.
--      Un test affirme 0 gap — la couverture est auto-vérifiée.
--
-- Pas de retrofit massif de FK composites (risque DDL, deux modèles d'intégrité).
-- Les FK existantes gèrent l'existence et les cascades ; le trigger ajoute
-- l'étanchéité projet avec des erreurs explicites (pas le piège T3b).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. FK manquantes project_id → projects ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.lims_import_log'::regclass AND contype='f'
      AND confrelid='public.projects'::regclass) THEN
    ALTER TABLE public.lims_import_log
      ADD CONSTRAINT lims_import_log_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.mine_design_pits'::regclass AND contype='f'
      AND confrelid='public.projects'::regclass) THEN
    ALTER TABLE public.mine_design_pits
      ADD CONSTRAINT mine_design_pits_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── 2. Table de règles de cohérence projet ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mfp_project_consistency_rule (
  child_table          text NOT NULL,
  child_project_column text NOT NULL DEFAULT 'project_id',
  child_fk_column      text NOT NULL,
  parent_table         text NOT NULL,
  parent_project_column text NOT NULL DEFAULT 'project_id',
  parent_pk_column     text NOT NULL DEFAULT 'id',
  enabled              boolean NOT NULL DEFAULT true,
  PRIMARY KEY (child_table, child_fk_column, parent_table)
);

COMMENT ON TABLE mfp_project_consistency_rule IS
  'Règles d''étanchéité projet : pour chaque relation enfant→parent à risque (les deux ont project_id, parent≠projects, FK mono-colonne), on vérifie que parent.project_id = enfant.project_id. Auto-peuplée depuis le schéma.';

-- Auto-peuplement : on détecte les FK mono-colonnes enfant→parent où les deux
-- ont project_id et parent ≠ projects. L'ordre des colonnes est respecté via
-- unnest() WITH ORDINALITY (sinon le join ANY() mélange les colonnes).
INSERT INTO mfp_project_consistency_rule
  (child_table, child_project_column, child_fk_column, parent_table, parent_project_column, parent_pk_column, enabled)
WITH fk_cols AS (
  SELECT cl.relname  AS child,
         cl2.relname AS parent,
         array_agg(a.attname  ORDER BY o.ord) AS child_cols,
         array_agg(af.attname ORDER BY o.ord) AS parent_cols
  FROM pg_constraint con
  JOIN pg_class cl  ON cl.oid=con.conrelid
  JOIN pg_class cl2 ON cl2.oid=con.confrelid
  JOIN unnest(con.conkey)  WITH ORDINALITY AS o(attnum, ord)  ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS o2(attnum, ord) ON o2.ord = o.ord
  JOIN pg_attribute a  ON a.attrelid=con.conrelid  AND a.attnum=o.attnum
  JOIN pg_attribute af ON af.attrelid=con.confrelid AND af.attnum=o2.attnum
  WHERE con.contype='f'
  GROUP BY cl.relname, cl2.relname, con.oid
)
SELECT f.child, 'project_id', f.child_cols[1], f.parent, 'project_id', f.parent_cols[1], true
FROM fk_cols f
WHERE array_length(f.child_cols,1)=1
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_name=f.child  AND c.column_name='project_id' AND c.table_schema='public')
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_name=f.parent AND c.column_name='project_id' AND c.table_schema='public')
  AND f.parent <> 'projects'
ON CONFLICT (child_table, child_fk_column, parent_table) DO NOTHING;

-- ── 3. Trigger d'étanchéité projet ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfp_enforce_project_consistency()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  r             RECORD;
  v_child_proj  uuid;
  v_fk          text;
  v_parent_proj uuid;
BEGIN
  FOR r IN
    SELECT child_project_column, child_fk_column, parent_table,
           parent_project_column, parent_pk_column
    FROM public.mfp_project_consistency_rule
    WHERE child_table = TG_TABLE_NAME AND enabled
  LOOP
    EXECUTE format('SELECT ($1).%I::text', r.child_project_column) INTO v_child_proj USING NEW;
    EXECUTE format('SELECT ($1).%I::text', r.child_fk_column)      INTO v_fk        USING NEW;
    IF v_fk IS NULL THEN CONTINUE; END IF;  -- fk nullable : pas de fausse erreur
    EXECUTE format('SELECT %I FROM %I WHERE %I::text = $1',
                   r.parent_project_column, r.parent_table, r.parent_pk_column)
      INTO v_parent_proj USING v_fk;
    IF v_parent_proj IS NULL THEN CONTINUE; END IF;  -- parent introuvable : la FK gère
    IF v_parent_proj IS DISTINCT FROM v_child_proj THEN
      RAISE EXCEPTION
        'Étanchéité projet violée : %.% (%) référence un parent du projet % au lieu de %. Déplacez la donnée dans une ligne du bon projet.',
        TG_TABLE_NAME, r.child_fk_column, v_fk, v_parent_proj, v_child_proj;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Déploiement du trigger sur chaque enfant à risque déclaré dans la config.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT DISTINCT child_table FROM public.mfp_project_consistency_rule WHERE enabled LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS mfp_consistency ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER mfp_consistency BEFORE INSERT OR UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION mfp_enforce_project_consistency()', t);
  END LOOP;
END $$;

-- ── 4. Immutabilité de project_id sur toutes les tables projetées ──────────
CREATE OR REPLACE FUNCTION public.mfp_project_id_immutable()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION
      'project_id est immuable sur % (ancien %, nouveau %). Un enregistrement ne change pas de projet ; créez une nouvelle ligne.',
      TG_TABLE_NAME, OLD.project_id, NEW.project_id;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t2 ON t2.table_name=c.table_name AND t2.table_schema='public'
    WHERE c.column_name='project_id' AND c.table_schema='public'
      AND t2.table_type='BASE TABLE' AND c.table_name<>'projects'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS mfp_project_id_immutable ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER mfp_project_id_immutable BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION mfp_project_id_immutable()', t);
  END LOOP;
END $$;

-- ── 5. Vue de couverture : relations à risque sans règle active ────────────
CREATE OR REPLACE VIEW mfp_project_consistency_gap AS
WITH fk_cols AS (
  SELECT cl.relname  AS child,
         cl2.relname AS parent,
         array_agg(a.attname  ORDER BY o.ord) AS child_cols,
         array_agg(af.attname ORDER BY o.ord) AS parent_cols
  FROM pg_constraint con
  JOIN pg_class cl  ON cl.oid=con.conrelid
  JOIN pg_class cl2 ON cl2.oid=con.confrelid
  JOIN unnest(con.conkey)  WITH ORDINALITY AS o(attnum, ord)  ON true
  JOIN unnest(con.confkey) WITH ORDINALITY AS o2(attnum, ord) ON o2.ord = o.ord
  JOIN pg_attribute a  ON a.attrelid=con.conrelid  AND a.attnum=o.attnum
  JOIN pg_attribute af ON af.attrelid=con.confrelid AND af.attnum=o2.attnum
  WHERE con.contype='f'
  GROUP BY cl.relname, cl2.relname, con.oid
)
SELECT f.child, f.parent, f.child_cols[1] AS fk_col
FROM fk_cols f
WHERE array_length(f.child_cols,1)=1
  AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=f.child  AND c.column_name='project_id' AND c.table_schema='public')
  AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=f.parent AND c.column_name='project_id' AND c.table_schema='public')
  AND f.parent <> 'projects'
  AND NOT EXISTS (
    SELECT 1 FROM public.mfp_project_consistency_rule r
    WHERE r.child_table=f.child AND r.child_fk_column=f.child_cols[1] AND r.enabled);

COMMENT ON VIEW mfp_project_consistency_gap IS
  'Relations enfant→parent à risque d''étanchéité (les deux ont project_id, FK mono-colonne, parent≠projects) sans règle active de cohérence. Doit toujours être vide.';
