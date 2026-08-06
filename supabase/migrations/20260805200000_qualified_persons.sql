/*
# Qualified Persons (QP) + sign-off des sections 43-101

Traçabilité réglementaire : qui (personne qualifiée) signe quelle section du
rapport, et à quelle date. Le NI 43-101 exige que chaque section technique soit
sous la responsabilité d'un QP nommé.

## qualified_persons — registre des personnes qualifiées (par projet)
- name, title, company, designation (P.Eng/P.Geo…), site_visit_date

## report_section_signoffs — rattachement QP → item de rapport
- section_key (clé Form 43-101F1 : 'resource','reserve',…), qp_id, signed_on

## Sécurité
RLS activée, policies anon+authenticated (cohérent avec le schéma).
*/

-- ── 1. qualified_persons ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qualified_persons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL,
  name            text NOT NULL,
  title           text,
  company         text,
  designation     text,               -- P.Eng, P.Geo, FAusIMM…
  site_visit_date date,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE qualified_persons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_qp" ON qualified_persons;
CREATE POLICY "anon_select_qp" ON qualified_persons FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_qp" ON qualified_persons;
CREATE POLICY "anon_insert_qp" ON qualified_persons FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_qp" ON qualified_persons;
CREATE POLICY "anon_update_qp" ON qualified_persons FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_qp" ON qualified_persons;
CREATE POLICY "anon_delete_qp" ON qualified_persons FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_qp_project ON qualified_persons (project_id);

-- ── 2. report_section_signoffs ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS report_section_signoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL,
  section_key   text NOT NULL,         -- clé Form 43-101F1 (resource, reserve, …)
  qp_id         uuid REFERENCES qualified_persons(id) ON DELETE SET NULL,
  signed_on     date,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (project_id, section_key)
);

ALTER TABLE report_section_signoffs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_signoff" ON report_section_signoffs;
CREATE POLICY "anon_select_signoff" ON report_section_signoffs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_signoff" ON report_section_signoffs;
CREATE POLICY "anon_insert_signoff" ON report_section_signoffs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_signoff" ON report_section_signoffs;
CREATE POLICY "anon_update_signoff" ON report_section_signoffs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_signoff" ON report_section_signoffs;
CREATE POLICY "anon_delete_signoff" ON report_section_signoffs FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_signoff_project ON report_section_signoffs (project_id);
