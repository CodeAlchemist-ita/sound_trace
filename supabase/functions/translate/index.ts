// Translates song lyrics to Italian with DeepL, on explicit request from the app.
// Auth: the caller's Spotify access token (like the friends function).
//
// POST { text } → { text, detectedSourceLanguage }
//   400 bad_request (not a non-empty string) · 413 too_long (over 10 000 characters)
//   401/403 bad Spotify token · 405 not POST · 429 quota (DeepL monthly limit)
//   500 not_configured (no DEEPL_API_KEY secret) · 502 failed
//
// Privacy: the text is forwarded to DeepL and returned. It is never logged and never
// stored (no database, no cache); error bodies from DeepL are not logged either.
import { bearer, cors, json, spotifyMe } from '../_shared/http.ts';

const MAX_CHARS = 10_000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const token = bearer(req);
  if (!token) return json({ error: 'unauthorized' }, 401);
  const me = await spotifyMe(token);
  if (!me.ok) return json({ error: me.status === 403 ? 'forbidden' : 'unauthorized' }, me.status === 403 ? 403 : 401);

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = body?.text;
  if (typeof text !== 'string' || text.trim().length === 0) return json({ error: 'bad_request' }, 400);
  if (text.length > MAX_CHARS) return json({ error: 'too_long' }, 413);

  const key = Deno.env.get('DEEPL_API_KEY');
  if (!key) return json({ error: 'not_configured' }, 500);
  const endpoint = key.endsWith(':fx') ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: [text], target_lang: 'IT', preserve_formatting: true }),
    });
    if (res.status === 456) return json({ error: 'quota' }, 429);
    if (!res.ok) return json({ error: 'failed' }, 502);
    const data = (await res.json()) as { translations?: { detected_source_language?: string; text?: string }[] };
    const first = data.translations?.[0];
    if (typeof first?.text !== 'string') return json({ error: 'failed' }, 502);
    return json({ text: first.text, detectedSourceLanguage: first.detected_source_language ?? null });
  } catch {
    return json({ error: 'failed' }, 502);
  }
});
