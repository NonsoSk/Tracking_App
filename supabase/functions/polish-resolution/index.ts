// polish-resolution: turns an officer's dictated (or hastily typed) resolution
// note into clear, correct English that keeps exactly what the officer meant.
// The officer always reviews the suggestion before it is saved.
//
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it exactly  polish-resolution , paste this file, Deploy.
// Secret: Edge Functions → Secrets → add  ANTHROPIC_API_KEY  (never put it in the app).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });

const SYSTEM = `You tidy up resolution notes written or dictated by Community Relations officers at Indorama Eleme Petrochemicals Limited in Rivers State, Nigeria. The note tells a community member how their grievance was resolved, and they will read it.

Rewrite the note so it is clear, correct and polite plain English:
- Fix grammar, spelling, punctuation and speech-to-text mistakes (wrong words that sound alike, missing full stops, repeated words, filler such as "uhm" or "you know").
- Keep every fact exactly: what was done, names, places, communities, dates, quantities and amounts. Where the officer's meaning is clear but badly worded, express that meaning well.
- Do not add facts, promises, apologies, deadlines or commitments that are not in the note, and do not remove any.
- Write in the first person plural for the company ("we") where the note speaks for the company, in a warm, respectful and professional tone. Keep it about as long as the original; short notes stay short.
- If part of the note is unclear, keep it as close to the original wording as you can rather than guessing.

Reply with the rewritten note only: no title, no quotation marks, no explanation.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Only signed-in, active staff may use it (the platform also checks the JWT).
  const auth = req.headers.get('Authorization') ?? '';
  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: access } = await caller.rpc('my_access');
  const a = access as { roles: string[]; is_active: boolean } | null;
  if (!a?.is_active || !a.roles.some((r) => r !== 'community_member')) return json({ error: 'not_allowed' }, 403);

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return json({ error: 'ai_not_configured' }, 503);

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) return json({ error: 'text_required' }, 400);
  if (text.length > 5000) return json({ error: 'text_too_long' }, 400);

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 4000,
      output_config: { effort: 'low' },          // a short rewrite: low effort is plenty
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',                      // if a request is declined, the API retries on its recommended model
      system: SYSTEM,
      messages: [{ role: 'user', content: `<note>\n${text}\n</note>` }],
    });

    if (response.stop_reason === 'refusal') return json({ error: 'ai_declined' }, 422);
    const out = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    if (!out) return json({ error: 'ai_empty' }, 502);
    return json({ text: out });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ai_not_configured' }, 503);
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'ai_busy' }, 429);
    if (error instanceof Anthropic.APIError) return json({ error: 'ai_unavailable', status: error.status }, 502);
    return json({ error: 'ai_unavailable' }, 502);
  }
});
