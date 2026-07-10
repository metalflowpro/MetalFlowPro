/*
# Table project_flowsheets — Constructeur de flowsheet interactif

## Titre
Ajout de la table pour stocker les flowsheets personnalisés construits par l'utilisateur.

## Description
Chaque projet peut avoir plusieurs flowsheets (PFD) construits interactivement
depuis la bibliothèque d'équipements. Les nœuds (équipements positionnés sur le
canvas) et les arêtes (connexions entre équipements) sont stockés en JSON.

## Nouvelles tables

### project_flowsheets
- id : uuid PK
- project_id : FK vers projects (owner-scoped via RLS)
- name : nom du flowsheet (ex. "Base Case — Gravity+CIL")
- nodes : tableau JSON des nœuds {id, equipCode, abbrev, color, tag, label, x, y}
- edges : tableau JSON des arêtes {id, from, to}
- created_at / updated_at

## Sécurité
RLS activé. 4 politiques CRUD owner-scoped via
  project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
*/

CREATE TABLE IF NOT EXISTS project_flowsheets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL DEFAULT 'Nouveau flowsheet',
  nodes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flowsheets_project ON project_flowsheets(project_id);

ALTER TABLE project_flowsheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_flowsheets" ON project_flowsheets;
CREATE POLICY "select_own_flowsheets" ON project_flowsheets FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_flowsheets" ON project_flowsheets;
CREATE POLICY "insert_own_flowsheets" ON project_flowsheets FOR INSERT TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "update_own_flowsheets" ON project_flowsheets;
CREATE POLICY "update_own_flowsheets" ON project_flowsheets FOR UPDATE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "delete_own_flowsheets" ON project_flowsheets;
CREATE POLICY "delete_own_flowsheets" ON project_flowsheets FOR DELETE TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE user_id = auth.uid()));
