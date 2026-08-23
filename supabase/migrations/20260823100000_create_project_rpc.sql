-- Création atomique d'un projet depuis l'identité JWT effective.
-- La fonction est SECURITY DEFINER afin que l'insertion de la ligne initiale
-- ne dépende pas des politiques RLS destinées aux lignes déjà existantes. Elle
-- réapplique explicitement les deux garde-fous de la policy projects_insert :
-- session authentifiée et compte approuvé.

CREATE OR REPLACE FUNCTION public.mfp_create_project(
  p_code text,
  p_name text,
  p_country text,
  p_phase text,
  p_target_tph numeric,
  p_gold_grade_g_t numeric,
  p_availability_pct numeric,
  p_recovery_pct numeric,
  p_ore_sg numeric,
  p_gold_price_usd numeric
)
RETURNS public.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project public.projects;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise pour créer un projet.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_approved() THEN
    RAISE EXCEPTION 'Compte non approuvé : création de projet refusée.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.projects (
    code, name, country, phase, target_tph, gold_grade_g_t,
    availability_pct, recovery_pct, ore_sg, gold_price_usd, user_id
  ) VALUES (
    p_code, p_name, p_country, p_phase, p_target_tph, p_gold_grade_g_t,
    p_availability_pct, p_recovery_pct, p_ore_sg, p_gold_price_usd, v_user_id
  )
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;

REVOKE ALL ON FUNCTION public.mfp_create_project(
  text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfp_create_project(
  text, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric
) TO authenticated;
