// Sync endpoint shared by the phone and PC apps.
// Auth: the caller sends its Spotify access token; we ask Spotify who it
// belongs to and only ever touch that user's rows (with the service role key).
//
// POST { action: "sync", push: Row[], importedUntil: number, since: number }
//   → { user, rows: (Row & { id })[], more: boolean, importedUntil: number }
// Optional "expectUser" in the body: refuse (409) if the token is another account's.
// POST { action: "wipe" } → { ok: true }
// "sync" answers 403 not_registered until the account is linked via the register function.
import { createClient } from '@supabase/supabase-js';

import { bearer, cors, json, spotifyMe } from '../_shared/http.ts';

const PAGE = 1000; // PostgREST returns at most 1000 rows per request by default

type Row = {
  played_at: number;
  track_uri: string | null;
  track_name: string;
  artist: string;
  album: string | null;
  ms_played: number;
  image_url: string | null;
  source: 'api' | 'import';
};

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null);

function cleanRow(r: Record<string, unknown>, userId: string) {
  const played_at = int(r.played_at);
  const ms_played = int(r.ms_played);
  const track_name = str(r.track_name, 500);
  const artist = str(r.artist, 500);
  if (played_at === null || ms_played === null || !track_name || !artist) return null;
  if (r.source !== 'api' && r.source !== 'import') return null;
  return {
    user_id: userId,
    played_at,
    ms_played: Math.min(ms_played, 2_147_483_647),
    track_name,
    artist,
    track_uri: str(r.track_uri, 200),
    album: str(r.album, 500),
    image_url: str(r.image_url, 500),
    source: r.source,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const token = bearer(req);
  const me = token ? await spotifyMe(token) : null;
  if (!me?.ok) return json({ error: 'spotify_token' }, 401);
  const userId = me.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'body' }, 400);
  }

  // A device remembers which account its data belongs to: never mix two accounts.
  if (typeof body.expectUser === 'string' && body.expectUser !== userId) {
    return json({ error: 'other_user', user: userId }, 409);
  }

  if (body.action === 'wipe') {
    const a = await db.from('plays').delete().eq('user_id', userId);
    const b = await db.from('sync_meta').delete().eq('user_id', userId);
    if (a.error || b.error) return json({ error: (a.error ?? b.error)!.message }, 500);
    return json({ ok: true });
  }
  if (body.action !== 'sync') return json({ error: 'action' }, 400);

  // Only accounts that registered in the app and linked Spotify may store data here.
  const { data: reg, error: regError } = await db
    .from('registrations')
    .select('email')
    .eq('spotify_id', userId)
    .maybeSingle();
  if (regError) return json({ error: regError.message }, 500);
  if (!reg) return json({ error: 'not_registered' }, 403);

  // 1. Store what the device sends (duplicates are ignored).
  const push = Array.isArray(body.push) ? body.push.slice(0, PAGE) : [];
  const rows = push.map((r) => cleanRow(r as Record<string, unknown>, userId)).filter((r) => r !== null);
  if (rows.length > 0) {
    const { error } = await db
      .from('plays')
      .upsert(rows, { onConflict: 'user_id,played_at,track_name,artist', ignoreDuplicates: true });
    if (error) return json({ error: error.message }, 500);
  }

  // 2. Imported history wins over API estimates: keep the furthest import date
  //    seen by any device and drop the API rows it covers.
  const { data: meta, error: metaError } = await db
    .from('sync_meta')
    .select('imported_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (metaError) return json({ error: metaError.message }, 500);
  const importedUntil = Math.max(Number(meta?.imported_until ?? 0), int(body.importedUntil) ?? 0);
  if (importedUntil > Number(meta?.imported_until ?? 0)) {
    const { error } = await db.from('sync_meta').upsert({ user_id: userId, imported_until: importedUntil });
    if (error) return json({ error: error.message }, 500);
  }
  if (importedUntil > 0) {
    const { error } = await db
      .from('plays')
      .delete()
      .eq('user_id', userId)
      .eq('source', 'api')
      .lte('played_at', importedUntil);
    if (error) return json({ error: error.message }, 500);
  }

  // 3. Send back everything after the device's cursor.
  const since = int(body.since) ?? 0;
  const { data, error } = await db
    .from('plays')
    .select('id, played_at, track_uri, track_name, artist, album, ms_played, image_url, source')
    .eq('user_id', userId)
    .gt('id', since)
    .order('id')
    .limit(PAGE);
  if (error) return json({ error: error.message }, 500);

  return json({ user: userId, rows: data as (Row & { id: number })[], more: data.length === PAGE, importedUntil });
});
