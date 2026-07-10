/*
# MetalFlow Pro — Cross-Module Synergy & Configurable Parameters

## Title
Ajout des tables de paramètres configurables et de suivi de progression des modules.

## Description
Ce schéma élimine toutes les valeurs hardcodées de l'application en les déplaçant dans des tables 
configurables par projet. Il ajoute également un système de suivi de la progression par module 
(module_status) et un mécanisme de propagation de données entre modules (module_links).

## Nouvelles tables

### project_settings
Paramètres financiers et opérationnels configurables par projet (remplace les constantes hardcodées).
- hours_per_year (défaut null — l'utilisateur saisit)
- discount_rate_pct : taux d'actualisation (%)
- sustaining_capex_musd_yr : CAPEX de maintien annuel (M$/an)
- contingency_pct : pourcentage de contingence
- lom_years : durée de vie LOM (ans)
- debt_equity_ratio_pct : ratio dette/équité
- grid_ef_kg_co2_kwh : facteur d'émission réseau (kgCO₂/kWh)
- nacn_co2_factor, cao_co2_factor, diesel_co2_l : facteurs carbone réactifs
- refinery_charge_usd_oz : frais de raffinage ($/oz)
- royalty_pct : redevances minières (%)
- working_capital_pct : fonds de roulement (% CAPEX)

### module_status  
Suivi de la complétude de chaque module par projet.
- module_id : identifiant du module (ex: 'lims', 'blockmodel', 'criteria')
- completion_pct : pourcentage de complétude (0-100)
- record_count : nombre d'enregistrements dans ce module
- last_updated : dernière mise à jour
- is_linked : si ce module est lié à un autre (synergy)
- linked_from : liste des modules sources

### lims_campaigns
Campagnes d'échantillonnage définies par l'utilisateur par projet.
- name : nom de la campagne
- description : description
- start_date / end_date : dates de campagne
- sample_count_target : objectif d'échantillons
- is_active : campagne en cours

### lims_domains
Domaines géologiques/lithologiques définis par l'utilisateur.
- name : nom du domaine
- code : code court
- color : couleur hex
- description

### process_factors
Facteurs de consommation d'énergie et de réactifs configurables par projet et par équipement.
- equipment_type : type d'équipement
- energy_kwh_t : consommation énergétique (kWh/t)
- nacn_kg_t : consommation NaCN (kg/t)
- cao_kg_t : consommation CaO (kg/t)
- source : source des données (default/testwork/vendor/design)
- notes

### capex_lines
Lignes CAPEX détaillées par projet (remplace les calculs hardcodés de mockData).
- category : catégorie (Mining, Processing, Infrastructure...)
- sub_category : sous-catégorie
- description : description de la ligne
- value_musd : valeur en M$
- contingency_pct : contingence applicable
- source : source (estimate/quote/vendor)
- notes

### opex_lines  
Lignes OPEX détaillées par projet.
- category : catégorie (Labour, Energy, Reagents...)
- value_usd_t : coût par tonne traitée
- source : source
- notes

## Sécurité
RLS activé sur toutes les tables, politiques owner-scoped via project_id.
*/

-- ============================================================
-- 1. PROJECT SETTINGS
-- ============================================================

CREATE TABLE IF NOT EXISTS project_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  hours_per_year        numeric CHECK (hours_per_year BETWEEN 1 AND 8760),
  discount_rate_pct     numeric CHECK (discount_rate_pct BETWEEN 0 AND 50),
  sustaining_capex_musd_yr numeric CHECK (sustaining_capex_musd_yr >= 0),
  contingency_pct       numeric CHECK (contingency_pct BETWEEN 0 AND 50),
  lom_years             integer CHECK (lom_years BETWEEN 1 AND 50),
  debt_equity_ratio_pct numeric CHECK (debt_equity_ratio_pct BETWEEN 0 AND 100),
  grid_ef_kg_co2_kwh    numeric CHECK (grid_ef_kg_co2_kwh >= 0),
  nacn_co2_factor       numeric CHECK (nacn_co2_factor >= 0),
  cao_co2_factor        numeric CHECK (cao_co2_factor >= 0),
  diesel_co2_l          numeric CHECK (diesel_co2_l >= 0),
  refinery_charge_usd_oz numeric CHECK (refinery_charge_usd_oz >= 0),
  royalty_pct           numeric CHECK (royalty_pct BETWEEN 0 AND 20),
  working_capital_pct   numeric CHECK (working_capital_pct BETWEEN 0 AND 50),
  smelting_charge_pct   numeric CHECK (smelting_charge_pct BETWEEN 0 AND 10),
  updated_at            timestamptz DEFAULT now()
);

ALTER TABLE project_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_project_settings" ON project_settings;
CREATE POLICY "select_own_project_settings" ON project_settings FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_project_settings" ON project_settings;
CREATE POLICY "insert_own_project_settings" ON project_settings FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_project_settings" ON project_settings;
CREATE POLICY "update_own_project_settings" ON project_settings FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_project_settings" ON project_settings;
CREATE POLICY "delete_own_project_settings" ON project_settings FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 2. MODULE STATUS
-- ============================================================

CREATE TABLE IF NOT EXISTS module_status (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  module_id      text NOT NULL,
  completion_pct numeric NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  record_count   integer NOT NULL DEFAULT 0,
  last_updated   timestamptz DEFAULT now(),
  is_linked      boolean DEFAULT false,
  linked_from    text[],
  metadata       jsonb,
  UNIQUE (project_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_module_status_project ON module_status(project_id);

ALTER TABLE module_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_module_status" ON module_status;
CREATE POLICY "select_own_module_status" ON module_status FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_module_status" ON module_status;
CREATE POLICY "insert_own_module_status" ON module_status FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_module_status" ON module_status;
CREATE POLICY "update_own_module_status" ON module_status FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_module_status" ON module_status;
CREATE POLICY "delete_own_module_status" ON module_status FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 3. LIMS CAMPAIGNS
-- ============================================================

CREATE TABLE IF NOT EXISTS lims_campaigns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  description          text,
  start_date           date,
  end_date             date,
  sample_count_target  integer,
  is_active            boolean DEFAULT true,
  created_at           timestamptz DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE lims_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_lims_campaigns" ON lims_campaigns;
CREATE POLICY "select_own_lims_campaigns" ON lims_campaigns FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_lims_campaigns" ON lims_campaigns;
CREATE POLICY "insert_own_lims_campaigns" ON lims_campaigns FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_lims_campaigns" ON lims_campaigns;
CREATE POLICY "update_own_lims_campaigns" ON lims_campaigns FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_lims_campaigns" ON lims_campaigns;
CREATE POLICY "delete_own_lims_campaigns" ON lims_campaigns FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 4. LIMS DOMAINS
-- ============================================================

CREATE TABLE IF NOT EXISTS lims_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text,
  color       text DEFAULT '#6B7280',
  description text,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE lims_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_lims_domains" ON lims_domains;
CREATE POLICY "select_own_lims_domains" ON lims_domains FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_lims_domains" ON lims_domains;
CREATE POLICY "insert_own_lims_domains" ON lims_domains FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_lims_domains" ON lims_domains;
CREATE POLICY "update_own_lims_domains" ON lims_domains FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_lims_domains" ON lims_domains;
CREATE POLICY "delete_own_lims_domains" ON lims_domains FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 5. PROCESS FACTORS
-- ============================================================

CREATE TABLE IF NOT EXISTS process_factors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  equipment_type   text NOT NULL,
  energy_kwh_t     numeric CHECK (energy_kwh_t >= 0),
  nacn_kg_t        numeric CHECK (nacn_kg_t >= 0),
  cao_kg_t         numeric CHECK (cao_kg_t >= 0),
  water_m3_t       numeric CHECK (water_m3_t >= 0),
  balls_kg_t       numeric CHECK (balls_kg_t >= 0),
  source           text CHECK (source IN ('default','testwork','vendor','design','estimate')) DEFAULT 'estimate',
  notes            text,
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (project_id, equipment_type)
);

ALTER TABLE process_factors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_process_factors" ON process_factors;
CREATE POLICY "select_own_process_factors" ON process_factors FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_process_factors" ON process_factors;
CREATE POLICY "insert_own_process_factors" ON process_factors FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_process_factors" ON process_factors;
CREATE POLICY "update_own_process_factors" ON process_factors FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_process_factors" ON process_factors;
CREATE POLICY "delete_own_process_factors" ON process_factors FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 6. CAPEX LINES
-- ============================================================

CREATE TABLE IF NOT EXISTS capex_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category         text NOT NULL,
  sub_category     text,
  description      text NOT NULL,
  value_musd       numeric NOT NULL DEFAULT 0 CHECK (value_musd >= 0),
  contingency_pct  numeric DEFAULT 0 CHECK (contingency_pct BETWEEN 0 AND 100),
  source           text CHECK (source IN ('estimate','quote','vendor','budget','factored')) DEFAULT 'estimate',
  notes            text,
  sort_order       integer DEFAULT 0,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_capex_lines_project ON capex_lines(project_id);

ALTER TABLE capex_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_capex" ON capex_lines;
CREATE POLICY "select_own_capex" ON capex_lines FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_capex" ON capex_lines;
CREATE POLICY "insert_own_capex" ON capex_lines FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_capex" ON capex_lines;
CREATE POLICY "update_own_capex" ON capex_lines FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_capex" ON capex_lines;
CREATE POLICY "delete_own_capex" ON capex_lines FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

-- ============================================================
-- 7. OPEX LINES
-- ============================================================

CREATE TABLE IF NOT EXISTS opex_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category     text NOT NULL,
  description  text NOT NULL,
  value_usd_t  numeric NOT NULL DEFAULT 0 CHECK (value_usd_t >= 0),
  source       text CHECK (source IN ('estimate','quote','vendor','budget')) DEFAULT 'estimate',
  notes        text,
  sort_order   integer DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opex_lines_project ON opex_lines(project_id);

ALTER TABLE opex_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_opex" ON opex_lines;
CREATE POLICY "select_own_opex" ON opex_lines FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_opex" ON opex_lines;
CREATE POLICY "insert_own_opex" ON opex_lines FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_opex" ON opex_lines;
CREATE POLICY "update_own_opex" ON opex_lines FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_opex" ON opex_lines;
CREATE POLICY "delete_own_opex" ON opex_lines FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
