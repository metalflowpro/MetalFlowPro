/*
# Security and project-isolation completion

Corrects permissive policies introduced by the August drilling/resource/QP/metals
migrations and closes an OR-policy authorization bypass on projects. PostgreSQL
combines permissive policies with OR: the former `projects_approved_*` policies
checked approval but not ownership, so any approved user could access every project.
*/

-- Projects: approval AND ownership must be true in the same policy expression.
DROP POLICY IF EXISTS projects_approved_select ON public.projects;
DROP POLICY IF EXISTS projects_approved_insert ON public.projects;
DROP POLICY IF EXISTS projects_approved_update ON public.projects;
DROP POLICY IF EXISTS projects_approved_delete ON public.projects;
DROP POLICY IF EXISTS select_own_projects ON public.projects;
DROP POLICY IF EXISTS insert_own_projects ON public.projects;
DROP POLICY IF EXISTS update_own_projects ON public.projects;
DROP POLICY IF EXISTS delete_own_projects ON public.projects;

CREATE POLICY projects_owner_approved_select ON public.projects FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_approved());
CREATE POLICY projects_owner_approved_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_approved());
CREATE POLICY projects_owner_approved_update ON public.projects FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_approved())
  WITH CHECK (user_id = auth.uid() AND public.is_approved());
CREATE POLICY projects_owner_approved_delete ON public.projects FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_approved());

-- Replace every open policy added after the original RLS hardening.
DO $migration$
DECLARE
  table_name text;
  policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'dh_collar', 'dh_survey', 'dh_litho', 'dh_assay',
    'resource_estimation_runs', 'qualified_persons',
    'report_section_signoffs', 'project_metals'
  ] LOOP
    FOR policy_row IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      table_name || '_owner_select', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      table_name || '_owner_insert', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved())) WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      table_name || '_owner_update', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.user_id = auth.uid() AND public.is_approved()))',
      table_name || '_owner_delete', table_name);
  END LOOP;
END
$migration$;

-- Relational integrity and domain constraints for newly added technical data.
ALTER TABLE public.dh_collar
  ADD CONSTRAINT dh_collar_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.dh_survey
  ADD CONSTRAINT dh_survey_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT dh_survey_depth_nonnegative CHECK (depth >= 0),
  ADD CONSTRAINT dh_survey_azimuth_range CHECK (azimuth >= 0 AND azimuth < 360),
  ADD CONSTRAINT dh_survey_dip_range CHECK (dip BETWEEN -90 AND 90);
ALTER TABLE public.dh_litho
  ADD CONSTRAINT dh_litho_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT dh_litho_interval_valid CHECK (from_m >= 0 AND to_m > from_m);
ALTER TABLE public.dh_assay
  ADD CONSTRAINT dh_assay_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT dh_assay_interval_valid CHECK (from_m >= 0 AND to_m > from_m),
  ADD CONSTRAINT dh_assay_unit_valid CHECK (unit IN ('pct', 'g/t', 'ppm')),
  ADD CONSTRAINT dh_assay_qaqc_valid CHECK (qaqc_type IN ('sample', 'standard', 'blank', 'duplicate'));
ALTER TABLE public.resource_estimation_runs
  ADD CONSTRAINT resource_runs_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD CONSTRAINT resource_runs_method_valid CHECK (method IN ('kriging', 'idw'));
ALTER TABLE public.qualified_persons
  ADD CONSTRAINT qualified_persons_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE public.report_section_signoffs
  ADD CONSTRAINT report_signoffs_project_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

-- A sign-off cannot reference a QP belonging to another project.
ALTER TABLE public.qualified_persons ADD CONSTRAINT qualified_persons_id_project_key UNIQUE (id, project_id);
ALTER TABLE public.report_section_signoffs DROP CONSTRAINT IF EXISTS report_section_signoffs_qp_id_fkey;
ALTER TABLE public.report_section_signoffs
  ADD CONSTRAINT report_signoffs_qp_project_fkey
  FOREIGN KEY (qp_id, project_id) REFERENCES public.qualified_persons(id, project_id) ON DELETE SET NULL (qp_id);

ALTER TABLE public.project_metals
  ADD CONSTRAINT project_metals_grade_unit_valid CHECK (grade_unit IN ('pct', 'g/t')),
  ADD CONSTRAINT project_metals_price_unit_valid CHECK (price_unit IN ('usd/lb', 'usd/oz')),
  ADD CONSTRAINT project_metals_grade_nonnegative CHECK (grade IS NULL OR grade >= 0),
  ADD CONSTRAINT project_metals_price_nonnegative CHECK (price_usd IS NULL OR price_usd >= 0);
