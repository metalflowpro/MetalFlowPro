/*
# Resource estimation runs — traçabilité des estimations de ressource

Stocke chaque passage d'estimation (Phase B) : sa configuration reproductible
(méthode, variogramme, maille, recherche) et sa synthèse (grade-tonnage,
répartition par classe CIM, validation croisée). On ne persiste PAS chaque bloc
estimé (potentiellement des dizaines de milliers) mais la config + le résumé,
suffisants pour l'audit et le rapport 43-101.

## Table resource_estimation_runs (isolée par project_id, RLS)
- name, element, method ('kriging'|'idw'), composite_length_m
- block_x/y/z, search_radius_m, max_samples, min_samples
- variogram          jsonb  { type, nugget, sill, range }
- classification     jsonb  seuils Mesuré/Indiqué/Inféré
- summary            jsonb  { gradeTonnage[], classCounts, crossValidation, nBlocks }
- is_effective       bool   marque le run retenu comme estimation d'effet
- effective_date     date   date d'effet de la ressource (exigence NI 43-101)

## Sécurité
RLS activée, policies anon+authenticated (cohérent avec le reste du schéma).
*/

CREATE TABLE IF NOT EXISTS resource_estimation_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL,
  name              text NOT NULL DEFAULT 'Estimation',
  element           text NOT NULL DEFAULT 'Cu',
  method            text NOT NULL DEFAULT 'kriging',
  composite_length_m numeric NOT NULL DEFAULT 2,
  block_x           numeric NOT NULL DEFAULT 20,
  block_y           numeric NOT NULL DEFAULT 20,
  block_z           numeric NOT NULL DEFAULT 12,
  search_radius_m   numeric NOT NULL DEFAULT 100,
  max_samples       integer NOT NULL DEFAULT 12,
  min_samples       integer NOT NULL DEFAULT 3,
  variogram         jsonb,
  classification    jsonb,
  summary           jsonb,
  is_effective      boolean NOT NULL DEFAULT false,
  effective_date    date,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE resource_estimation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_resource_runs" ON resource_estimation_runs;
CREATE POLICY "anon_select_resource_runs" ON resource_estimation_runs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_resource_runs" ON resource_estimation_runs;
CREATE POLICY "anon_insert_resource_runs" ON resource_estimation_runs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_resource_runs" ON resource_estimation_runs;
CREATE POLICY "anon_update_resource_runs" ON resource_estimation_runs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_resource_runs" ON resource_estimation_runs;
CREATE POLICY "anon_delete_resource_runs" ON resource_estimation_runs FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_resource_runs_project ON resource_estimation_runs (project_id, created_at DESC);
