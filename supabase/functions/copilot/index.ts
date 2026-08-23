// MetalFlow Pro — Copilote LLM (T1)
//
// Supabase Edge Function (Deno). Proxies questions to the Claude API so the
// API key NEVER reaches the browser. The client sends a question plus a compact
// project context; this function adds a domain system prompt and returns the
// answer text.
//
// Deploy:  supabase functions deploy copilot
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Auth: the gateway already requires a JWT, but we re-verify it here and
// refuse unapproved accounts so a leaked anon key cannot spend tokens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function requiredSetting(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Secret/configuration requis manquant : ${name}`);
  return value;
}

function positiveIntegerSetting(name: string): number {
  const value = Number(requiredSetting(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} doit être un entier strictement positif.`);
  }
  return value;
}

const ANTHROPIC_API_KEY = requiredSetting("ANTHROPIC_API_KEY");
const MODEL = requiredSetting("COPILOT_MODEL");
const ANTHROPIC_API_URL = requiredSetting("COPILOT_API_URL");
const ANTHROPIC_VERSION = requiredSetting("COPILOT_ANTHROPIC_VERSION");
const MAX_TOKENS = positiveIntegerSetting("COPILOT_MAX_TOKENS");
const MAX_QUESTION_CHARS = positiveIntegerSetting("COPILOT_MAX_QUESTION_CHARS");
const MAX_CONTEXT_CHARS = positiveIntegerSetting("COPILOT_MAX_CONTEXT_CHARS");
const ALLOWED_ORIGINS = requiredSetting("COPILOT_ALLOWED_ORIGIN")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RATE_WINDOW_MS = positiveIntegerSetting("COPILOT_RATE_WINDOW_MS");
const RATE_MAX = positiveIntegerSetting("COPILOT_RATE_MAX");

const SUPABASE_URL = requiredSetting("SUPABASE_URL");
const SUPABASE_ANON_KEY = requiredSetting("SUPABASE_ANON_KEY");

const hits = new Map<string, number[]>();

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const prev = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    hits.set(userId, prev);
    return true;
  }
  prev.push(now);
  hits.set(userId, prev);
  return false;
}

const SYSTEM_PROMPT = `Tu es le copilote d'ingénierie de MetalFlow Pro, une plateforme d'études
métallurgiques et minières (or). Tu aides des ingénieurs procédé et des géologues.

Règles :
- Réponds en français, de façon concise et technique, avec les unités correctes
  (g/t, t/h, koz/an, $/oz, kWh/t, %).
- Appuie-toi UNIQUEMENT sur le contexte projet fourni. Si une donnée manque,
  dis-le explicitement et indique dans quel module la saisir plutôt que d'inventer.
- Pour tout calcul, montre la formule et les valeurs utilisées.
- Tu donnes des avis d'ingénierie, jamais de conseil financier personnalisé.`;

interface CopilotRequest {
  question: string;
  context?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { ...CORS, "content-type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return originAllowed(req)
      ? new Response("ok", { headers: CORS })
      : new Response(null, { status: 403 });
  }
  if (req.method !== "POST") return json({ error: "POST attendu." }, 405);
  if (!originAllowed(req)) return json({ error: "Origine non autorisée." }, 403);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "Authentification requise." }, 401);
  }
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) return json({ error: "Session invalide." }, 401);

  const { data: profile } = await sb
    .from("app_users")
    .select("status")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.status !== "approved") {
    return json({ error: "Compte non approuvé." }, 403);
  }

  if (rateLimited(user.id)) {
    return json({ error: "Trop de requêtes. Réessayez dans quelques minutes." }, 429);
  }

  let body: CopilotRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corps JSON invalide." }, 400);
  }
  if (!body.question?.trim()) return json({ error: "Question manquante." }, 400);
  const question = body.question.trim();
  const serializedContext = JSON.stringify(body.context ?? {}, null, 2);
  if (question.length > MAX_QUESTION_CHARS) return json({ error: "Question trop longue." }, 413);
  if (serializedContext.length > MAX_CONTEXT_CHARS) return json({ error: "Contexte projet trop volumineux." }, 413);

  const userContent =
    `Contexte projet (JSON) :\n${serializedContext}\n\n` +
    `Question : ${question}`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    await res.text();
    return json({ error: `Erreur API Claude (${res.status})` }, 502);
  }

  const data = await res.json();
  const answer = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();

  return json({ answer, model: MODEL });
});
