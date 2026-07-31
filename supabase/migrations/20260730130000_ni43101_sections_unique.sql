/*
# NI 43-101 sections — natural key (report_id, section_number)

Prevents duplicate section rows for the same report. The application upserts
sections keyed by (report_id, section_number), so this pair must be unique.

Defensive: the UNIQUE constraint is added only when no existing duplicate pair
is present. If duplicates already exist, they are retained and a NOTICE is
emitted (the constraint is not forced, so the migration never fails).
This complements the composite FK ni43101_sections_report_project_fkey added by
20260727010000_project_isolation_integrity.sql.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ni43101_sections'::regclass
      AND conname = 'ni43101_sections_report_section_unique'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.ni43101_sections
      GROUP BY report_id, section_number
      HAVING count(*) > 1
    ) THEN
      ALTER TABLE public.ni43101_sections
        ADD CONSTRAINT ni43101_sections_report_section_unique
        UNIQUE (report_id, section_number);
    ELSE
      RAISE NOTICE 'Existing duplicate ni43101_sections(report_id, section_number) rows retained; unique constraint not added.';
    END IF;
  END IF;
END;
$$;
