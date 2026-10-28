// /api/hub: nhl-hub (the NHL centre's data and every other sport's desk) behind Cloudflare's cache. The function is
// public data (scores, standings, news, injuries, leaders), so one answer serves everyone: the first request in a
// refresh window calls the function, the rest are served from the edge. When a copy is past its window it is still
// served at once while a fresh one is fetched in the background (stale-while-revalidate), and when the function or
// the feed behind it fails, the last good copy is served rather than an error.
import type { Env } from './index';

// how long a copy is fresh, by task (seconds); the function's own ttl wins when it sends one (a final game, a live one)
const FRESH: Record<string, number> = {
  scores: 15, game: 15, espn: 30, lines: 60, x: 120, team: 300, standings: 300, schedule: 600, news: 600, leaders: 600,
  'sport-news': 600, 'sport-standings': 1800, 'sport-injuries': 3600, 'sport-leaders': 3600,
  'fan-sport-league': 3600, 'fan-sport': 1800, 'fan-sport-history': 21600,
};
// and how long past that a stale copy may still be served while a fresh one is fetched, or when the source is down
const KEEP = 6 * 3600;

const ok = (q: URLSearchParams) => /^[a-z-]{1,20}$/.test(q.get('task') ?? 'scores')
  && [...q.keys()].every((k) => ['task', 'date', 'id', 'abbrev', 'sport', 'league', 'club'].includes(k));

export async function hub(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  if (!ok(url.searchParams)) return Response.json({ error: 'bad request' }, { status: 400 });
  // one cache entry per question, whatever order its parameters came in
  const q = new URLSearchParams([...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const key = new Request(`${url.origin}/api/hub?${q}`, { method: 'GET' });
  const task = q.get('task') ?? 'scores';
  const cache = caches.default;
  const hit = await cache.match(key);
  const age = hit ? (Date.now() - Number(hit.headers.get('x-fetched') ?? 0)) / 1000 : Infinity;
  const fresh = Number(hit?.headers.get('x-fresh') ?? FRESH[task] ?? 30);
  if (hit && age < fresh) return out(hit, 'hit');
  if (hit) { ctx.waitUntil(refill(q, key, task, env).catch(() => {})); return out(hit, 'stale'); }
  try { return out(await refill(q, key, task, env), 'miss'); }
  catch (e) { return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502 }); }
}

async function refill(q: URLSearchParams, key: Request, task: string, env: Env): Promise<Response> {
  const r = await fetch(`${env.SUPABASE_URL}/functions/v1/nhl-hub?${q}`, { headers: { apikey: env.SUPABASE_ANON, authorization: `Bearer ${env.SUPABASE_ANON}` } });
  const body = await r.text();
  let parsed: { error?: string; ttl?: number } | null = null;
  try { parsed = JSON.parse(body); } catch { /* not JSON: an error page */ }
  if (!r.ok || !parsed || parsed.error) throw new Error(parsed?.error ?? `nhl-hub ${r.status}`);
  const fresh = Math.max(5, Math.min(21600, parsed.ttl ? Math.round(parsed.ttl / 1000) : FRESH[task] ?? 30));
  const res = new Response(body, { headers: {
    'content-type': 'application/json', 'cache-control': `public, max-age=${fresh + KEEP}`,
    'x-fetched': String(Date.now()), 'x-fresh': String(fresh),
  } });
  await caches.default.put(key, res.clone());
  return res;
}

// the browser keeps a copy only briefly, so a page that polls still sees the edge's fresh one
const out = (r: Response, how: string) => new Response(r.body, { headers: {
  'content-type': 'application/json', 'cache-control': 'public, max-age=10', 'x-cache': how,
} });

// /api/img?u=<picture>: a club's logo for the share cards the phone draws (src/lib/fanCards.ts). The NHL's logos come
// without the header a canvas needs to use them, so the Worker fetches the picture and sends it on with one; only the
// leagues' own picture hosts are allowed, and a copy is kept at the edge for a day.
const IMG_HOSTS = ['assets.nhle.com', 'a.espncdn.com'];
const IMG_MAX = 2_000_000;
export async function img(req: Request, ctx: ExecutionContext): Promise<Response> {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  let target: URL;
  try { target = new URL(u); } catch { return new Response('bad request', { status: 400 }); }
  if (target.protocol !== 'https:' || !IMG_HOSTS.includes(target.hostname)) return new Response('bad request', { status: 400 });
  const key = new Request(`${new URL(req.url).origin}/api/img?u=${encodeURIComponent(target.href)}`, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  // never follow a redirect off the allowed hosts, and nothing bigger than a logo needs to be
  const r = await fetch(target.href, { redirect: 'manual', cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
  if (!r.ok) return new Response('not found', { status: 404 });
  const type = r.headers.get('content-type') ?? (target.pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
  if (!/^image\//.test(type)) return new Response('not an image', { status: 415 });
  if (Number(r.headers.get('content-length') ?? 0) > IMG_MAX) return new Response('too large', { status: 413 });
  const body = await r.arrayBuffer();
  if (body.byteLength > IMG_MAX) return new Response('too large', { status: 413 });
  // an SVG opened on its own runs in a sandbox with nothing allowed: it is a picture, never a page
  const res = new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400', 'access-control-allow-origin': '*',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff' } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

// the hub's data for the Worker's own use (the fan pages' pictures, worker/fans.ts): the same edge cache, parsed
export async function hubData<T>(origin: string, env: Env, ctx: ExecutionContext, q: Record<string, string>): Promise<T | null> {
  const r = await hub(new Request(`${origin}/api/hub?${new URLSearchParams(q)}`), env, ctx).catch(() => null);
  if (!r?.ok) return null;
  const body = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  return body && !body.error ? body : null;
}
