/*
# Tables mass_balance_streams et carbon_footprint_items

## Titre
Ajout des tables pour le bilan massique auto-généré et l'empreinte carbone.

## Description
Ces tables permettent de stocker les flux de matières calculés automatiquement
depuis le flowsheet et les critères de conception, puis modifiés par l'utilisateur.
L'empreinte carbone est dérivée de la consommation énergétique et des réactifs.

## Nouvelles tables

### mass_balance_streams
Flux de matières entre opérations unitaires :
- id, project_id (FK), flowsheet_id (FK optionnel)
- stream_no : numéro de flux (S01, S02, …)
- from_node_id, to_node_id, from_tag, to_tag : nœuds source/destination
- name : désignation du flux
- mass_tph : débit solides (t/h)
- solids_pct : pourcentage solides (%)
- water_m3h : débit eau (m³/h)
- slurry_m3h : débit pulpe total (m³/h)
- au_g_t : teneur or (g/t)
- au_kg_h : débit or (kg/h)
- energy_kwh_h : énergie section (kWh/h)
- cn_kg_h, lime_kg_h : réactifs (kg/h)
- is_edited : flag modification utilisateur
- sort_order : ordre d'affichage

### carbon_footprint_items
Sources d'émissions GES par scope :
- id, project_id (FK)
- scope : 1 (direct), 2 (électricité), 3 (indirect)
- source : tag équipement ou catégorie
- description
- activity_value, activity_unit : valeur activité (kWh/an, kg/an, etc.)
- emission_factor, ef_unit : facteur d'émission
- tco2e_year : tonnes CO2e/année
- is_edited : flag modification utilisateur

## Sécurité
RLS activé sur les deux tables avec politiques owner-scoped
via project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()).
*/

CREATE TABLE IF NOT EXISTS mass_balance_streams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  flowsheet_id  uuid REFERENCES project_flowsheets(id) ON DELETE SET NULL,
  stream_no     text NOT NULL DEFAULT '',
  from_node_id  text,
  to_node_id    text,
  from_tag      text,
  to_tag        text,
  name          text NOT NULL DEFAULT '',
  mass_tph      numeric(12,2) DEFAULT 0,
  solids_pct    numeric(5,1)  DEFAULT 65,
  water_m3h     numeric(12,2) DEFAULT 0,
  slurry_m3h    numeric(12,2) DEFAULT 0,
  au_g_t        numeric(12,3) DEFAULT 0,
  au_kg_h       numeric(12,4) DEFAULT 0,
  energy_kwh_h  numeric(12,2) DEFAULT 0,
  cn_kg_h       numeric(10,3) DEFAULT 0,
  lime_kg_h     numeric(10,3) DEFAULT 0,
  is_edited     boolean DEFAULT false,
  sort_order    integer DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mb_streams_project ON mass_balance_streams(project_id);

ALTER TABLE mass_balance_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_mb_streams" ON mass_balance_streams;
CREATE POLICY "select_own_mb_streams" ON mass_balance_streams FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_mb_streams" ON mass_balance_streams;
CREATE POLICY "insert_own_mb_streams" ON mass_balance_streams FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_mb_streams" ON mass_balance_streams;
CREATE POLICY "update_own_mb_streams" ON mass_balance_streams FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_mb_streams" ON mass_balance_streams;
CREATE POLICY "delete_own_mb_streams" ON mass_balance_streams FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS carbon_footprint_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope            integer NOT NULL CHECK (scope IN (1, 2, 3)),
  source           text NOT NULL,
  description      text,
  activity_value   numeric(16,4) DEFAULT 0,
  activity_unit    text,
  emission_factor  numeric(12,6) DEFAULT 0,
  ef_unit          text,
  tco2e_year       numeric(12,2) DEFAULT 0,
  is_edited        boolean DEFAULT false,
  sort_order       integer DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carbon_project ON carbon_footprint_items(project_id);

ALTER TABLE carbon_footprint_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_carbon" ON carbon_footprint_items;
CREATE POLICY "select_own_carbon" ON carbon_footprint_items FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_carbon" ON carbon_footprint_items;
CREATE POLICY "insert_own_carbon" ON carbon_footprint_items FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_carbon" ON carbon_footprint_items;
CREATE POLICY "update_own_carbon" ON carbon_footprint_items FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_carbon" ON carbon_footprint_items;
CREATE POLICY "delete_own_carbon" ON carbon_footprint_items FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
