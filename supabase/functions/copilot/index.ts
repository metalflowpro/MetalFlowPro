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
// The function verifies the caller's Supabase JWT (functions require a valid
// Authorization header by default) so only authenticated users can spend tokens.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("COPILOT_MODEL") ?? "claude-sonnet-5";
const MAX_TOKENS = Number(Deno.env.get("COPILOT_MAX_TOKENS") ?? "1024");
const MAX_QUESTION_CHARS = Number(Deno.env.get("COPILOT_MAX_QUESTION_CHARS") ?? "4000");
const MAX_CONTEXT_CHARS = Number(Deno.env.get("COPILOT_MAX_CONTEXT_CHARS") ?? "30000");
const ALLOWED_ORIGIN = Deno.env.get("COPILOT_ALLOWED_ORIGIN") ?? "https://metalflowpro.com";

const CORS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY non configurée (supabase secrets set)." }, 500);
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

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Number.isFinite(MAX_TOKENS) && MAX_TOKENS > 0 ? MAX_TOKENS : 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    // Do not relay provider response bodies: they may contain internal request metadata.
    await res.text();
    return json({ error: `Erreur API Claude (${res.status})` }, 502);
  }

  const data = await res.json();
  const answer = (data.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();

  return json({ answer, model: MODEL, usage: data.usage ?? null });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
