/*
# Simulation Engine, NI-43-101 Report & Enhanced Risk Register

## Summary
Full schema for the Simulation Pro engine (generic metallurgical flowsheet simulator),
the NI-43-101 report module with QP validation, and enhanced risk register with
auto-generation from project data.

## New Tables

### Simulation Engine
1. `sim_flowsheets` — Versioned flowsheet definitions per project
   - id, project_id, name, version, status (draft/calibrated/validated/archived)

2. `sim_nodes` — Process unit nodes on a flowsheet canvas
   - id, flowsheet_id, unit_type, label, position_x, position_y
   - parameters (jsonb), design_capacity, availability_pct, results (jsonb)

3. `sim_edges` — Stream connections between nodes
   - id, flowsheet_id, source_node_id, target_node_id, stream_type, stream_label
   - results (jsonb): mass_flow, gold_grade, solids_content, etc.

4. `sim_run_results` — Detailed results per simulation run
   - Extends the existing sim_runs concept with per-node and global results
   - id, flowsheet_id, project_id, mode, feed_input (jsonb), status
   - global_results (jsonb), node_results (jsonb), stream_results (jsonb)
   - iterations, convergence_error, scenario_label

5. `sim_expansion_scenarios` — Expansion scenario definitions and economics
   - id, flowsheet_id, project_id, label, target_increase_pct
   - modifications (jsonb), economics (jsonb)

### NI-43-101 Report
6. `ni43101_reports` — Report header per project
   - id, project_id, report_date, qp_name, qp_registration, status

7. `ni43101_sections` — Individual report sections with content and QP sign-off
   - id, report_id, project_id, section_number, section_title
   - content (text, user-editable), auto_generated_content (text)
   - is_validated (boolean), validated_by, validated_at, qp_notes

### Enhanced Risk Register
8. `risk_auto_sources` — Tracks which data source triggered which risk auto-generation
   - id, project_id, source_module, source_entity_id, risk_id

## Security
- All tables use RLS with authenticated user policies
- All tables isolated by project_id
- Policies scoped to authenticated user's projects
*/

-- ─── Simulation Flowsheets ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sim_flowsheets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','calibrated','validated','archived')),
  description   text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE sim_flowsheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_flowsheets" ON sim_flowsheets;
CREATE POLICY "select_own_sim_flowsheets" ON sim_flowsheets FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sim_flowsheets" ON sim_flowsheets;
CREATE POLICY "insert_own_sim_flowsheets" ON sim_flowsheets FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sim_flowsheets" ON sim_flowsheets;
CREATE POLICY "update_own_sim_flowsheets" ON sim_flowsheets FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sim_flowsheets" ON sim_flowsheets;
CREATE POLICY "delete_own_sim_flowsheets" ON sim_flowsheets FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── Simulation Nodes ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sim_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flowsheet_id    uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_type       text NOT NULL,
  label           text NOT NULL,
  position_x      real NOT NULL DEFAULT 100,
  position_y      real NOT NULL DEFAULT 100,
  parameters      jsonb NOT NULL DEFAULT '{}',
  design_capacity real,
  availability_pct real DEFAULT 91,
  results         jsonb,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE sim_nodes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_nodes" ON sim_nodes;
CREATE POLICY "select_own_sim_nodes" ON sim_nodes FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sim_nodes" ON sim_nodes;
CREATE POLICY "insert_own_sim_nodes" ON sim_nodes FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sim_nodes" ON sim_nodes;
CREATE POLICY "update_own_sim_nodes" ON sim_nodes FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sim_nodes" ON sim_nodes;
CREATE POLICY "delete_own_sim_nodes" ON sim_nodes FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── Simulation Edges (Streams) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sim_edges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flowsheet_id    uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_node_id  uuid NOT NULL,
  target_node_id  uuid NOT NULL,
  stream_type     text NOT NULL DEFAULT 'pulp'
                    CHECK (stream_type IN ('solid','liquid','pulp','gas','solution')),
  stream_label    text,
  results         jsonb,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE sim_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_edges" ON sim_edges;
CREATE POLICY "select_own_sim_edges" ON sim_edges FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sim_edges" ON sim_edges;
CREATE POLICY "insert_own_sim_edges" ON sim_edges FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sim_edges" ON sim_edges;
CREATE POLICY "update_own_sim_edges" ON sim_edges FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sim_edges" ON sim_edges;
CREATE POLICY "delete_own_sim_edges" ON sim_edges FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── Simulation Run Results ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sim_run_results (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flowsheet_id        uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode                text NOT NULL DEFAULT 'steady_state'
                        CHECK (mode IN ('steady_state','dynamic')),
  feed_input          jsonb NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('running','completed','failed','converged','diverged')),
  iterations          integer DEFAULT 0,
  convergence_error   real DEFAULT 0,
  scenario_label      text,
  global_results      jsonb,
  node_results        jsonb,
  stream_results      jsonb,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE sim_run_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_run_results" ON sim_run_results;
CREATE POLICY "select_own_sim_run_results" ON sim_run_results FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sim_run_results" ON sim_run_results;
CREATE POLICY "insert_own_sim_run_results" ON sim_run_results FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sim_run_results" ON sim_run_results;
CREATE POLICY "delete_own_sim_run_results" ON sim_run_results FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── Expansion Scenarios ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sim_expansion_scenarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flowsheet_id        uuid NOT NULL REFERENCES sim_flowsheets(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label               text NOT NULL,
  target_increase_pct real NOT NULL DEFAULT 30,
  modifications       jsonb NOT NULL DEFAULT '[]',
  economics           jsonb,
  run_id              uuid,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE sim_expansion_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_sim_expansion" ON sim_expansion_scenarios;
CREATE POLICY "select_own_sim_expansion" ON sim_expansion_scenarios FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_sim_expansion" ON sim_expansion_scenarios;
CREATE POLICY "insert_own_sim_expansion" ON sim_expansion_scenarios FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_sim_expansion" ON sim_expansion_scenarios;
CREATE POLICY "update_own_sim_expansion" ON sim_expansion_scenarios FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_sim_expansion" ON sim_expansion_scenarios;
CREATE POLICY "delete_own_sim_expansion" ON sim_expansion_scenarios FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── NI-43-101 Reports ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ni43101_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date       date,
  title             text NOT NULL DEFAULT 'Technical Report',
  qp_name           text,
  qp_registration   text,
  qp_firm           text,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','in_progress','review','completed')),
  completion_pct    integer DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE ni43101_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_ni43101_reports" ON ni43101_reports;
CREATE POLICY "select_own_ni43101_reports" ON ni43101_reports FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_ni43101_reports" ON ni43101_reports;
CREATE POLICY "insert_own_ni43101_reports" ON ni43101_reports FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_ni43101_reports" ON ni43101_reports;
CREATE POLICY "update_own_ni43101_reports" ON ni43101_reports FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── NI-43-101 Sections ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ni43101_sections (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id               uuid NOT NULL REFERENCES ni43101_reports(id) ON DELETE CASCADE,
  project_id              uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section_number          text NOT NULL,
  section_title           text NOT NULL,
  content                 text,
  auto_generated_content  text,
  is_validated            boolean DEFAULT false,
  validated_by            text,
  validated_at            timestamptz,
  qp_notes                text,
  status                  text NOT NULL DEFAULT 'empty'
                            CHECK (status IN ('empty','generated','edited','validated')),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

ALTER TABLE ni43101_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_ni43101_sections" ON ni43101_sections;
CREATE POLICY "select_own_ni43101_sections" ON ni43101_sections FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_ni43101_sections" ON ni43101_sections;
CREATE POLICY "insert_own_ni43101_sections" ON ni43101_sections FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_ni43101_sections" ON ni43101_sections;
CREATE POLICY "update_own_ni43101_sections" ON ni43101_sections FOR UPDATE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  ) WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_ni43101_sections" ON ni43101_sections;
CREATE POLICY "delete_own_ni43101_sections" ON ni43101_sections FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

-- ─── Risk Auto-Sources ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS risk_auto_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_module   text NOT NULL,
  risk_id         uuid REFERENCES risks(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE risk_auto_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_risk_auto_sources" ON risk_auto_sources;
CREATE POLICY "select_own_risk_auto_sources" ON risk_auto_sources FOR SELECT
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_risk_auto_sources" ON risk_auto_sources;
CREATE POLICY "insert_own_risk_auto_sources" ON risk_auto_sources FOR INSERT
  TO authenticated WITH CHECK (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_risk_auto_sources" ON risk_auto_sources;
CREATE POLICY "delete_own_risk_auto_sources" ON risk_auto_sources FOR DELETE
  TO authenticated USING (
    project_id IN (SELECT id FROM projects WHERE user_id = auth.uid())
  );
