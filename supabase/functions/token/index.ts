// Spotify tokens held by the server, and the scheduled sync.
//
// POST { action: "handover", refreshToken } + Authorization: Bearer <spotify access token>
//   → { key, accessToken, expiresAt, scope }
//   The device gives its refresh token to the server and keeps only the returned key.
// POST { action: "token", key, force? } → { accessToken, expiresAt, scope }
//   401 { error: "bad_key" | "revoked" }: the device must log in to Spotify again.
// POST { action: "playlists", key } → { ok: true }   (re-read the owner's playlists now, so friends see them)
// POST { action: "revoke", key } → { ok: true }   (logout; last device out stops the server sync)
// POST { action: "poll" } + header x-cron-secret → { users, saved, errors }
//   Called every 15 minutes by pg_cron: saves every user's latest plays.
import { createClient } from '@supabase/supabase-js';

import { bearer, cors, json, spotifyMe } from '../_shared/http.ts';
import {
  accessTokenFor,
  NoScopeError,
  pollUser,
  refreshPlaylists,
  refreshWithSpotify,
  RevokedError,
} from '../_shared/spotifyServer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison for the cron secret. */
function sameSecret(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function userOfKey(key: unknown) {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null;
  const hash = await sha256(key);
  const { data } = await db.from('device_keys').select('user_id').eq('key_hash', hash).maybeSingle();
  return data ? { userId: data.user_id as string, hash } : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body' }, 400);
  }

  if (body.action === 'poll') {
    if (!sameSecret(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) return json({ error: 'forbidden' }, 403);
    const { data: users, error } = await db
      .from('spotify_tokens')
      .select('user_id')
      .or('last_error.is.null,last_error.neq.revoked');
    if (error) return json({ error: error.message }, 500);
    let saved = 0;
    const errors: string[] = [];
    // A handful of users: one after the other keeps Spotify's rate limit happy.
    for (const { user_id } of users) {
      try {
        saved += await pollUser(db, user_id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${user_id}: ${message.slice(0, 200)}`);
        if (!(e instanceof RevokedError)) {
          await db.from('spotify_tokens').update({ last_error: message.slice(0, 500) }).eq('user_id', user_id);
        }
      }
    }
    if (errors.length) console.warn('poll errors', errors);
    return json({ users: users.length, saved, errors: errors.length });
  }

  if (body.action === 'handover') {
    const token = bearer(req);
    const me = token ? await spotifyMe(token) : null;
    if (!me?.ok) return json({ error: 'spotify_token' }, 401);
    const { data: reg, error: regError } = await db
      .from('registrations')
      .select('email')
      .eq('spotify_id', me.id)
      .maybeSingle();
    if (regError) return json({ error: regError.message }, 500);
    if (!reg) return json({ error: 'not_registered' }, 403);
    if (typeof body.refreshToken !== 'string' || body.refreshToken.length < 10 || body.refreshToken.length > 2000) {
      return json({ error: 'refreshToken' }, 400);
    }

    // Refresh right away: proves the token works and makes the server its only user.
    let fresh;
    try {
      fresh = await refreshWithSpotify(body.refreshToken);
    } catch (e) {
      return json({ error: e instanceof RevokedError ? 'bad_refresh' : 'spotify' }, e instanceof RevokedError ? 400 : 502);
    }
    const expiresAt = Date.now() + fresh.expires_in * 1000;
    const { error } = await db.from('spotify_tokens').upsert(
      {
        user_id: me.id,
        refresh_token: fresh.refresh_token ?? body.refreshToken,
        access_token: fresh.access_token,
        expires_at: expiresAt,
        scope: fresh.scope ?? null,
        last_error: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) return json({ error: error.message }, 500);

    const key = randomKey();
    const { error: keyError } = await db.from('device_keys').insert({ key_hash: await sha256(key), user_id: me.id });
    if (keyError) return json({ error: keyError.message }, 500);
    return json({ key, accessToken: fresh.access_token, expiresAt, scope: fresh.scope ?? null });
  }

  if (body.action === 'token') {
    const owner = await userOfKey(body.key);
    if (!owner) return json({ error: 'bad_key' }, 401);
    try {
      const row = await accessTokenFor(db, owner.userId, body.force === true);
      await db.from('device_keys').update({ last_used_at: new Date().toISOString() }).eq('key_hash', owner.hash);
      return json({ accessToken: row.access_token, expiresAt: row.expires_at, scope: row.scope });
    } catch (e) {
      if (e instanceof RevokedError) return json({ error: 'revoked' }, 401);
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  if (body.action === 'playlists') {
    const owner = await userOfKey(body.key);
    if (!owner) return json({ error: 'bad_key' }, 401);
    try {
      await refreshPlaylists(db, owner.userId, true);
      return json({ ok: true });
    } catch (e) {
      if (e instanceof RevokedError) return json({ error: 'revoked' }, 401);
      if (e instanceof NoScopeError) return json({ error: 'no_scope' }, 403);
      return json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  }

  if (body.action === 'revoke') {
    const owner = await userOfKey(body.key);
    if (!owner) return json({ ok: true });
    await db.from('device_keys').delete().eq('key_hash', owner.hash);
    const { count } = await db
      .from('device_keys')
      .select('key_hash', { count: 'exact', head: true })
      .eq('user_id', owner.userId);
    // Nobody signed in any more: stop syncing this account on the server.
    if (!count) await db.from('spotify_tokens').delete().eq('user_id', owner.userId);
    return json({ ok: true });
  }

  return json({ error: 'action' }, 400);
});
