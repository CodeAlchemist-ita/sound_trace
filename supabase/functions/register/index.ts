// Registration in the app, before connecting Spotify.
//
// POST { action: "register", email }  → { ok: true, linked: boolean }
//   Saves the email (the one of the Spotify account). No auth: anyone may register,
//   but nothing else works until the owner enables the email on Spotify.
// POST { action: "link", email } + Authorization: Bearer <spotify token>
//   → { ok: true } | 409 { error: "email_mismatch", spotifyEmail } | 403 { error: "not_allowed" }
//   Checks with Spotify that the token's account has the registered email and
//   stores its Spotify id: from then on that account may use the sync function.
import { createClient } from '@supabase/supabase-js';

import { bearer, cleanEmail, cors, json, spotifyMe } from '../_shared/http.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body' }, 400);
  }
  const email = cleanEmail(body.email);
  if (!email) return json({ error: 'email' }, 400);

  if (body.action === 'register') {
    const { data: existing, error: readError } = await db
      .from('registrations')
      .select('spotify_id')
      .eq('email', email)
      .maybeSingle();
    if (readError) return json({ error: readError.message }, 500);
    const { error } = existing
      ? await db.from('registrations').update({ last_seen_at: new Date().toISOString() }).eq('email', email)
      : await db.from('registrations').insert({ email });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, linked: !!existing?.spotify_id });
  }

  if (body.action === 'link') {
    const token = bearer(req);
    const me = token ? await spotifyMe(token) : ({ ok: false, status: 401 } as const);
    if (!me.ok) return json({ error: me.status === 403 ? 'not_allowed' : 'spotify_token' }, me.status === 403 ? 403 : 401);
    if (!me.email) return json({ error: 'no_email_scope' }, 400);
    if (me.email !== email) return json({ error: 'email_mismatch', spotifyEmail: me.email }, 409);

    // One Spotify account ↔ one registration: free the id if it was linked to an older email.
    const unlink = await db.from('registrations').update({ spotify_id: null }).eq('spotify_id', me.id).neq('email', email);
    if (unlink.error) return json({ error: unlink.error.message }, 500);
    const now = new Date().toISOString();
    const { error } = await db
      .from('registrations')
      .upsert({ email, spotify_id: me.id, linked_at: now, last_seen_at: now }, { onConflict: 'email' });
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: 'action' }, 400);
});
