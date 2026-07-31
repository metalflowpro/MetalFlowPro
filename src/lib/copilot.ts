import { supabase } from './supabase';

/**
 * Client for the LLM copilot (T1). Talks to the `copilot` Supabase Edge
 * Function, which holds the Claude API key server-side. The feature is dormant
 * unless VITE_COPILOT_ENABLED === 'true', so the panel never renders (and no
 * calls are made) until the function is deployed and the flag is set.
 *
 * Activation:
 *   1. supabase functions deploy copilot
 *   2. supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   3. add VITE_COPILOT_ENABLED=true to the build env
 */

export const COPILOT_ENABLED = import.meta.env.VITE_COPILOT_ENABLED === 'true';

export interface CopilotAnswer {
  answer: string;
  model?: string;
}

export async function askCopilot(
  question: string,
  context: Record<string, unknown>,
): Promise<CopilotAnswer> {
  const { data, error } = await supabase.functions.invoke('copilot', {
    body: { question, context },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return { answer: data?.answer ?? '', model: data?.model };
}
