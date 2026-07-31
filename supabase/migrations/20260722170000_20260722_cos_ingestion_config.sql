/*
# COS — Configuration d'ingestion

## Purpose
Stores per-project configuration for the COS input-data templates
(ingestion L2 → contextualisation L3): site code, timezone, data source
identifiers (OPC-UA, LIMS, CMMS, geomet) and shift window parameters.
Templates are generated from this config plus live module data — nothing
is hardcoded in the UI.

## New Tables
1. **cos_ingestion_config** — one row per project (UNIQUE project_id)

## Security
- RLS enabled, scoped to authenticated users via project ownership
  (EXISTS check against projects.user_id = auth.uid())
- 4 CRUD policies (SELECT, INSERT, UPDATE, DELETE)
*/

CREATE TABLE IF NOT EXISTS cos_ingestion_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  site_code text NOT NULL DEFAULT '',
  tz text NOT NULL DEFAULT 'America/Toronto',
  mine_name text NOT NULL DEFAULT '',
  lab_id text NOT NULL DEFAULT 'lab-central',
  opc_source_grinding text NOT NULL DEFAULT 'opcua:opc-server-01',
  opc_source_leaching text NOT NULL DEFAULT 'opcua:opc-server-02',
  opc_source_utilities text NOT NULL DEFAULT 'opcua:opc-server-03',
  lims_source text NOT NULL DEFAULT 'lims:lab-central',
  cmms_source text NOT NULL DEFAULT 'cmms:gmao-prod',
  geomet_source text NOT NULL DEFAULT 'mining:geomet-db',
  shift_start_utc_h numeric NOT NULL DEFAULT 12,
  shift_duration_h numeric NOT NULL DEFAULT 8,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE cos_ingestion_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_cos_ingestion_config" ON cos_ingestion_config;
CREATE POLICY "select_cos_ingestion_config" ON cos_ingestion_config FOR SELECT
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ingestion_config.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "insert_cos_ingestion_config" ON cos_ingestion_config;
CREATE POLICY "insert_cos_ingestion_config" ON cos_ingestion_config FOR INSERT
  TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ingestion_config.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "update_cos_ingestion_config" ON cos_ingestion_config;
CREATE POLICY "update_cos_ingestion_config" ON cos_ingestion_config FOR UPDATE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ingestion_config.project_id AND projects.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ingestion_config.project_id AND projects.user_id = auth.uid()));
DROP POLICY IF EXISTS "delete_cos_ingestion_config" ON cos_ingestion_config;
CREATE POLICY "delete_cos_ingestion_config" ON cos_ingestion_config FOR DELETE
  TO authenticated USING (EXISTS (SELECT 1 FROM projects WHERE projects.id = cos_ingestion_config.project_id AND projects.user_id = auth.uid()));
