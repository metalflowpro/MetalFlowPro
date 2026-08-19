// MetalFlow Pro — Webhook LIMS entrant (Phase 2, module étude P80)
//
// Supabase Edge Function (Deno). Un LIMS externe POST ses résultats d'essai
// PUBLIÉS/APPROUVÉS ici ; la fonction vérifie un secret partagé (par étude,
// table p80_ingestion_config), puis crée des p80_test_result RÉFÉRENÇANT le
// résultat LIMS d'origine (lims_result_id). Cela évite le polling et transmet
// des résultats structurés au module aval, comme recommandé par la spec §3.
//
// Le module ne modifie JAMAIS les tables LIMS : il n'écrit que ses propres
// tables p80_*. La fonction utilise le service role (RLS contournée côté serveur)
// mais l'autorisation réelle vient du secret partagé, pas d'un JWT utilisateur.
//
// Deploy:  supabase functions deploy lims-webhook --no-verify-jwt
// (--no-verify-jwt car l'appelant est un système LIMS, pas un utilisateur connecté ;
//  l'authentification se fait par le secret partagé x-lims-secret.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-lims-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface WebhookResult {
  lims_result_id: string;
  lims_result_version?: number | null;
  test_plan_id?: string | null;
  target_p80?: number | null;
  actual_p80?: number | null;
  au_feed?: number | null;
  au_concentrate?: number | null;
  au_tailings?: number | null;
  au_recovery?: number | null;
  reagent_consumption?: number | null;
  energy_consumption?: number | null;
  throughput?: number | null;
}
interface WebhookBody { study_id: string; results: WebhookResult[]; }

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...CORS, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST attendu" }, 405);

  const secret = req.headers.get("x-lims-secret");
  if (!secret) return json({ error: "En-tête x-lims-secret manquant" }, 401);

  let body: WebhookBody;
  try { body = await req.json(); } catch { return json({ error: "JSON invalide" }, 400); }
  if (!body?.study_id || !Array.isArray(body.results)) {
    return json({ error: "study_id et results[] requis" }, 400);
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Vérifie le secret partagé contre la config d'ingestion de l'étude.
  const { data: cfg, error: cfgErr } = await db
    .from("p80_ingestion_config")
    .select("id, project_id, study_id, enabled, secret")
    .eq("study_id", body.study_id)
    .maybeSingle();
  if (cfgErr) return json({ error: "Erreur config", detail: cfgErr.message }, 500);
  if (!cfg || !cfg.enabled) return json({ error: "Ingestion désactivée pour cette étude" }, 403);
  if (cfg.secret !== secret) return json({ error: "Secret invalide" }, 401);

  // Insère les résultats en RÉFÉRENÇANT le LIMS ; non révisés/à revoir par défaut
  // (un résultat non approuvé côté LIMS ne doit pas alimenter une reco officielle).
  const rows = body.results.map((r) => ({
    project_id: cfg.project_id,
    study_id: cfg.study_id,
    test_plan_id: r.test_plan_id ?? null,
    lims_result_id: r.lims_result_id,
    lims_result_version: r.lims_result_version ?? null,
    target_p80: r.target_p80 ?? null,
    actual_p80: r.actual_p80 ?? null,
    au_feed: r.au_feed ?? null,
    au_concentrate: r.au_concentrate ?? null,
    au_tailings: r.au_tailings ?? null,
    au_recovery: r.au_recovery ?? null,
    reagent_consumption: r.reagent_consumption ?? null,
    energy_consumption: r.energy_consumption ?? null,
    throughput: r.throughput ?? null,
    qc_status: "a_revoir",
    review_status: "non_revise",
  }));

  const { error: insErr, count } = await db
    .from("p80_test_result")
    .insert(rows, { count: "exact" });
  if (insErr) return json({ error: "Échec insertion", detail: insErr.message }, 500);

  await db.from("p80_audit_log").insert({
    project_id: cfg.project_id, study_id: cfg.study_id,
    entity: "result", action: "create", actor: "lims-webhook",
    new_value: { ingested: rows.length },
  });
  await db.from("p80_ingestion_config")
    .update({ last_triggered_at: new Date().toISOString() })
    .eq("id", cfg.id);

  return json({ ok: true, ingested: count ?? rows.length });
});
