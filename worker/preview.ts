// Link previews: the page a chat app reads when someone pastes an invite or a pool's link, and the picture it shows.
// The app routes in the hash (#/join/<code>), which no link preview can see, so every pool's invite used to unfurl as
// "SAK Superleague" with a broken picture. These pages carry the pool's own name, host, colour and a picture drawn
// for it, and send a person straight on to the app; a preview bot reads the tags and stops there.
// satori 0.15 (before text shaping moved to harfbuzz, which fetches its own WebAssembly by URL, which a Worker can't),
// with its layout engine handed in precompiled
import satori, { init as initSatori } from 'satori/wasm';
import initYoga from 'yoga-wasm-web';
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm';
import { Resvg, initWasm as initResvg } from '@resvg/resvg-wasm';
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm';
import barlow900i from './fonts/barlow-condensed-900-italic.ttf';
import barlow700 from './fonts/barlow-condensed-700.ttf';
import inter500 from './fonts/inter-500.ttf';
import inter700 from './fonts/inter-700.ttf';
import type { Env } from './index';

interface Brand { colors?: { gold?: string }; tagline?: string; wordmark?: { a?: string; b?: string } }
interface Invite { ok: boolean; reason: string | null; league?: string; short?: string; brand?: Brand | null; kind?: string; host?: string | null; members?: number; team?: string | null; next_question?: string | null; open_questions?: number }
interface Pool { id: number; slug: string; name: string; kind?: string; brand?: Brand | null; status?: string }

const PRODUCT = { name: 'Super Pools', site: 'superpoolsai.com', gold: '#f7c548' };
const hex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : PRODUCT.gold);
const rgba = (c: string, a: number) => `rgba(${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)}, ${a})`;
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
// a short tag for the picture's address, so a renamed or recoloured pool gets a new picture rather than a cached one
const tag = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };

async function rpc<T>(env: Env, fn: string, args: Record<string, unknown>): Promise<T | null> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: env.SUPABASE_ANON, authorization: `Bearer ${env.SUPABASE_ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  return r.ok ? ((await r.json()) as T) : null;
}
const invite = (env: Env, code: string) => rpc<Invite>(env, 'invite_preview', { p_code: code.toLowerCase() });
const poolBySlug = (env: Env, slug: string) => rpc<Pool>(env, 'league_by_host', { p_host: `${slug.toLowerCase()}.superpoolsai.com` });

// ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────────
function page(o: { title: string; description: string; image: string; url: string; go: string; color: string }) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${PRODUCT.name}">
<meta property="og:title" content="${esc(o.title)}"><meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${esc(o.url)}"><meta property="og:image" content="${esc(o.image)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.title)}">
<meta name="twitter:description" content="${esc(o.description)}"><meta name="twitter:image" content="${esc(o.image)}">
<meta name="theme-color" content="#05080f"><meta http-equiv="refresh" content="0;url=${esc(o.go)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080f;color:#e2e8f0;font:600 16px/1.4 -apple-system,system-ui,sans-serif}a{color:${o.color}}</style>
</head><body><p>Opening <a href="${esc(o.go)}">${esc(o.title)}</a>…</p><script>location.replace(${JSON.stringify(o.go)})</script></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

export async function invitePage(code: string, url: URL, env: Env) {
  const go = `${url.origin}/#/join/${encodeURIComponent(code)}`;
  const i = await invite(env, code);
  if (!i?.league) return Response.redirect(go, 302);
  const color = hex(i.brand?.colors?.gold);
  const fantasy = i.kind !== 'predict';
  const title = i.ok ? `You're invited to ${i.league}` : i.league;
  const description = !i.ok ? `This invite has ${i.reason === 'expired' ? 'expired' : 'been used'}. Ask for a fresh link.`
    : fantasy ? `Take ${i.team ? `the ${i.team} seat` : 'a seat'} in ${i.league}${i.brand?.tagline ? `: ${i.brand.tagline}` : ''}. Draft, lineups, trash talk and the table, on ${PRODUCT.name}.`
    // the first question is the pitch (migration 252): the link in a text thread already asks it
    : `${i.host ? `${i.host} invited you. ` : ''}${i.next_question ? `First up: "${i.next_question}" ` : ''}${i.members ? `${i.members} ${i.members === 1 ? 'player is' : 'players are'} in. ` : ''}Make your calls in a tap. Free, never money: just bragging rights.`;
  const image = `${url.origin}/og/j/${encodeURIComponent(code)}.png?v=${tag(`${i.league}|${color}|${i.host}|${i.members}|${i.ok}|${i.next_question ?? ''}`)}`;
  return page({ title, description, image, url: url.href, go, color });
}

export async function poolPage(slug: string, rest: string, url: URL, env: Env) {
  const go = `${url.origin}/#/p/${encodeURIComponent(slug)}${rest && rest !== '/' ? rest : ''}`;
  const p = await poolBySlug(env, slug);
  if (!p?.name) return Response.redirect(go, 302);
  const color = hex(p.brand?.colors?.gold);
  const description = p.brand?.tagline ? `${p.brand.tagline}. On ${PRODUCT.name}: free, never money.` : `${p.kind === 'predict' ? 'A pool' : 'A league'} on ${PRODUCT.name}. Free, never money: just bragging rights.`;
  const image = `${url.origin}/og/p/${encodeURIComponent(slug)}.png?v=${tag(`${p.name}|${color}`)}`;
  return page({ title: p.name, description, image, url: url.href, go, color });
}

// ── the picture ───────────────────────────────────────────────────────────────────────────────────────────────────
type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node =>
  ({ type, props: { style: { display: 'flex', ...style }, children: children.filter((c) => c !== null && c !== false) } });

// the faceoff dot, the product's mark (src/pages/Start.tsx ProductMark), in the pool's colour
const mark = (color: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111b30"/><circle cx="32" cy="32" r="17" fill="none" stroke="${color}" stroke-width="4"/><circle cx="32" cy="32" r="4.5" fill="${color}"/><g stroke="${color}" stroke-width="2.6" stroke-linecap="round"><line x1="25" y1="8" x2="25" y2="12.5"/><line x1="39" y1="8" x2="39" y2="12.5"/><line x1="25" y1="51.5" x2="25" y2="56"/><line x1="39" y1="51.5" x2="39" y2="56"/></g></svg>`)}`;

function card(o: { color: string; eyebrow: string; name: string; line: string; chips: string[]; cta: string }): Node {
  const big = o.name.length > 34 ? 84 : o.name.length > 22 ? 104 : 124;
  return el('div', { width: 1200, height: 630, background: '#05080f', position: 'relative', fontFamily: 'Inter', color: '#fff' },
    el('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(135deg, ${rgba(o.color, 0.34)} 0%, ${rgba(o.color, 0.08)} 38%, rgba(5, 8, 15, 0) 62%)` }),
    // the faceoff circle, large and faint, off the right edge
    el('div', { position: 'absolute', right: -170, top: 70, width: 560, height: 560, borderRadius: 999, border: `22px solid ${rgba(o.color, 0.16)}` }),
    el('div', { position: 'absolute', right: 85, top: 325, width: 50, height: 50, borderRadius: 999, background: rgba(o.color, 0.22) }),
    el('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: 14, backgroundImage: `linear-gradient(180deg, ${o.color}, ${rgba(o.color, 0)})` }),
    el('div', { flexDirection: 'column', justifyContent: 'space-between', padding: '56px 72px 56px 82px', width: '100%', height: '100%' },
      el('div', { alignItems: 'center', gap: 18 },
        { type: 'img', props: { src: mark(o.color), width: 64, height: 64 } },
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: 40, letterSpacing: 1 },
          el('span', { color: o.color }, 'SUPER'), el('span', { marginLeft: 10, color: '#fff' }, 'POOLS'))),
      el('div', { flexDirection: 'column' },
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 30, letterSpacing: 6, color: o.color, textTransform: 'uppercase' }, o.eyebrow),
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: big, lineHeight: 0.95, marginTop: 10, textTransform: 'uppercase', maxWidth: 1040 }, o.name),
        el('div', { fontSize: 32, fontWeight: 500, color: '#cbd5e1', marginTop: 22, maxWidth: 1000 }, o.line)),
      el('div', { alignItems: 'center', justifyContent: 'space-between' },
        el('div', { gap: 12 }, ...o.chips.map((c) => el('div', { fontSize: 24, fontWeight: 700, color: '#e2e8f0', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '10px 22px' }, c))),
        el('div', { fontSize: 30, fontWeight: 700, color: '#0b1220', background: o.color, borderRadius: 999, padding: '16px 34px' }, o.cta))));
}

let ready: Promise<unknown> | null = null;
const boot = () => (ready ??= Promise.all([initYoga(yogaWasm).then(initSatori), initResvg(resvgWasm)]));

async function png(tree: Node): Promise<Uint8Array> {
  await boot();
  const svg = await satori(tree as never, {
    width: 1200, height: 630,
    fonts: [
      { name: 'Barlow Condensed', data: barlow900i, weight: 900, style: 'italic' },
      { name: 'Barlow Condensed', data: barlow700, weight: 700, style: 'normal' },
      { name: 'Inter', data: inter500, weight: 500, style: 'normal' },
      { name: 'Inter', data: inter700, weight: 700, style: 'normal' },
    ],
  });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

// a picture is made once per name, colour and count (the ?v tag) and kept at the edge for a day
async function cached(req: Request, ctx: ExecutionContext, make: () => Promise<Node | null>): Promise<Response> {
  const hit = await caches.default.match(req);
  if (hit) return hit;
  const tree = await make();
  if (!tree) return new Response('Not found', { status: 404 });
  const res = new Response(await png(tree), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
  ctx.waitUntil(caches.default.put(req, res.clone()));
  return res;
}

export const inviteImage = (code: string, req: Request, env: Env, ctx: ExecutionContext) => cached(req, ctx, async () => {
  const i = await invite(env, code);
  if (!i?.league) return null;
  const fantasy = i.kind !== 'predict';
  return card({
    color: hex(i.brand?.colors?.gold), eyebrow: i.ok ? (fantasy ? 'You’re drafted in' : 'You’re invited') : 'This invite is closed',
    name: i.league,
    // a pool's picture asks its first question; who invited you and how many are in move to the chips
    line: fantasy ? (i.brand?.tagline ?? 'Draft, lineups, trash talk and the table.')
      : i.next_question ? `First up: ${i.next_question}` : `${i.host ? `${i.host} invited you` : 'Join in one tap'}${i.members ? ` · ${i.members} in` : ''}`,
    chips: fantasy ? ['Fantasy league', 'Phone-first']
      : i.next_question ? [i.host ? `${i.host} invited you` : 'Join in one tap', ...(i.members ? [`${i.members} in`] : []), 'Free, never money'] : ['Free', 'Never money', 'Bragging rights'],
    cta: i.ok ? 'Join →' : 'Ask for a new link',
  });
});

export const poolImage = (slug: string, req: Request, env: Env, ctx: ExecutionContext) => cached(req, ctx, async () => {
  const p = await poolBySlug(env, slug);
  if (!p?.name) return null;
  const pool = p.kind === 'predict';
  return card({
    color: hex(p.brand?.colors?.gold), eyebrow: pool ? 'A Super Pools pool' : 'A Super Pools league', name: p.name,
    line: p.brand?.tagline ?? (pool ? 'Make your calls, climb the table, wear the crown.' : 'Draft, lineups, trash talk and the table.'),
    chips: pool ? ['Free', 'Never money', 'Bragging rights'] : ['Fantasy league', 'Phone-first'], cta: 'Open →',
  });
});
