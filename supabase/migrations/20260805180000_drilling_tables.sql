/*
# Drilling database — collar / survey / lithology / assay

Point d'entrée « terrain » de la chaîne 43-101 : les 4 tables de forage qui
alimentent le desurvey (lib/drilling/desurvey), le compositage
(lib/drilling/compositing) puis l'estimation de ressource.

## Tables (toutes isolées par project_id, RLS activée)

### dh_collar — colliers
- hole_id, x/y/z (Est/Nord/Élévation, m), max_depth, hole_type, diameter, drilled_on

### dh_survey — déviation (downhole survey)
- hole_id, depth (MD, m), azimuth (0–360°), dip (négatif = vers le bas)

### dh_litho — géologie loguée par intervalle
- hole_id, from_m, to_m, lithology, alteration, mineralization

### dh_assay — analyses par intervalle, FORMAT LONG (une ligne par élément)
- hole_id, from_m, to_m, element ('Cu','Au','Mo','Ag',…), value, unit,
  lab_job, qaqc_type ('sample' | 'standard' | 'blank' | 'duplicate')

Le format long de dh_assay rend le multi-métal natif : ajouter un élément
n'impose aucune migration de schéma.

## Sécurité
RLS activée, policies anon+authenticated (pas d'auth requise), cohérent avec
les autres tables du projet.
*/

-- ── 1. dh_collar ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dh_collar (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL,
  hole_id     text NOT NULL,
  x           numeric NOT NULL,
  y           numeric NOT NULL,
  z           numeric NOT NULL,
  max_depth   numeric,
  hole_type   text NOT NULL DEFAULT 'resource',   -- resource|geotech|metallurgical|condemnation|monitoring
  diameter    text,
  drilled_on  date,
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (project_id, hole_id)
);

ALTER TABLE dh_collar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dh_collar" ON dh_collar;
CREATE POLICY "anon_select_dh_collar" ON dh_collar FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_dh_collar" ON dh_collar;
CREATE POLICY "anon_insert_dh_collar" ON dh_collar FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_dh_collar" ON dh_collar;
CREATE POLICY "anon_update_dh_collar" ON dh_collar FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_dh_collar" ON dh_collar;
CREATE POLICY "anon_delete_dh_collar" ON dh_collar FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dh_collar_project ON dh_collar (project_id, hole_id);

-- ── 2. dh_survey ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dh_survey (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL,
  hole_id     text NOT NULL,
  depth       numeric NOT NULL,                   -- MD (m)
  azimuth     numeric NOT NULL DEFAULT 0,         -- 0–360°, horaire depuis le Nord
  dip         numeric NOT NULL DEFAULT -90,       -- degrés sous l'horizontale, négatif = bas
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE dh_survey ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dh_survey" ON dh_survey;
CREATE POLICY "anon_select_dh_survey" ON dh_survey FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_dh_survey" ON dh_survey;
CREATE POLICY "anon_insert_dh_survey" ON dh_survey FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_dh_survey" ON dh_survey;
CREATE POLICY "anon_update_dh_survey" ON dh_survey FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_dh_survey" ON dh_survey;
CREATE POLICY "anon_delete_dh_survey" ON dh_survey FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dh_survey_project ON dh_survey (project_id, hole_id, depth);

-- ── 3. dh_litho ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dh_litho (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL,
  hole_id        text NOT NULL,
  from_m         numeric NOT NULL,
  to_m           numeric NOT NULL,
  lithology      text,
  alteration     text,
  mineralization text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE dh_litho ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dh_litho" ON dh_litho;
CREATE POLICY "anon_select_dh_litho" ON dh_litho FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_dh_litho" ON dh_litho;
CREATE POLICY "anon_insert_dh_litho" ON dh_litho FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_dh_litho" ON dh_litho;
CREATE POLICY "anon_update_dh_litho" ON dh_litho FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_dh_litho" ON dh_litho;
CREATE POLICY "anon_delete_dh_litho" ON dh_litho FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dh_litho_project ON dh_litho (project_id, hole_id, from_m);

-- ── 4. dh_assay (format long : une ligne par élément) ─────────────────────────

CREATE TABLE IF NOT EXISTS dh_assay (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL,
  hole_id     text NOT NULL,
  from_m      numeric NOT NULL,
  to_m        numeric NOT NULL,
  element     text NOT NULL,                      -- 'Cu','Au','Mo','Ag',…
  value       numeric,                            -- null = non dosé
  unit        text NOT NULL DEFAULT 'pct',        -- 'pct' | 'g/t' | 'ppm'
  lab_job     text,
  qaqc_type   text NOT NULL DEFAULT 'sample',     -- sample|standard|blank|duplicate
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE dh_assay ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_dh_assay" ON dh_assay;
CREATE POLICY "anon_select_dh_assay" ON dh_assay FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_dh_assay" ON dh_assay;
CREATE POLICY "anon_insert_dh_assay" ON dh_assay FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_dh_assay" ON dh_assay;
CREATE POLICY "anon_update_dh_assay" ON dh_assay FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_dh_assay" ON dh_assay;
CREATE POLICY "anon_delete_dh_assay" ON dh_assay FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_dh_assay_project ON dh_assay (project_id, hole_id, element, from_m);
