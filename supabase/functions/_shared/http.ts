// Helpers shared by the Edge Functions.

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

export function bearer(req: Request) {
  return req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') || null;
}

export type SpotifyMe =
  | { ok: true; id: string; email: string | null; name: string | null; avatar: string | null }
  // 401: bad/expired token. 403: account not added to the app's User Management.
  | { ok: false; status: number };

// Spotify tokens live 1h; remember who they belong to for a few minutes.
type Me = { id: string; email: string | null; name: string | null; avatar: string | null };
const meCache = new Map<string, { me: Me; until: number }>();

/** Asks Spotify who owns the token. The email needs the user-read-email scope. */
export async function spotifyMe(token: string): Promise<SpotifyMe> {
  const hit = meCache.get(token);
  if (hit && hit.until > Date.now()) return { ok: true, ...hit.me };
  const res = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, status: res.status };
  const body = (await res.json()) as {
    id?: string;
    email?: string;
    display_name?: string | null;
    images?: { url: string; width?: number | null }[];
  };
  if (!body.id) return { ok: false, status: 401 };
  // Smallest picture is enough for an avatar.
  const images = [...(body.images ?? [])].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const me: Me = {
    id: body.id,
    email: body.email ? body.email.trim().toLowerCase() : null,
    name: body.display_name?.trim() || null,
    avatar: images[0]?.url ?? null,
  };
  if (meCache.size > 500) meCache.clear();
  meCache.set(token, { me, until: Date.now() + 5 * 60_000 });
  return { ok: true, ...me };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const email = v.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}
