// The fan zones at the edge (25 October 2026, Patrick: "make it so that it is easy to share with others"):
//   /fans, /fans/about, /fans/<CLUB>, /fans/<CLUB>/pulse and /fans/<CLUB>?post=<id>   a page a chat app reads when the
//       link is pasted (the club's own name, colours and logo, its fans' calls, or the post itself), which sends a person
//       straight on to the app (#/fans/…)
//   /og/fans/<CLUB>.png (?post=<id>) and /og/fans/<CLUB>-pulse.png   the pictures those pages point at
//   /api/fans and /api/fans/<CLUB>   the fans' open data: every club's activity, or one club's pulse and every post, as
//       JSON for anyone (five minutes at the edge, any origin). Names are a first name and an initial; no account is in it.
// Everything is read with the public key from fan_index, fan_pulse, fan_export and fan_posts (migration 337).
import type { Env } from './index';
import { cached, el, mark, page, PRODUCT, rgba, rpc, tag, type Node } from './preview';
import { CLUB_NAMES, clubTheme } from '../src/data/clubColors';
import { CLUB_CALLS, KINDS } from '../src/lib/fanLists';

interface Split { total: number; choices: { choice: string; n: number; name: string | null }[] }
interface Pulse { club: string; season: number; people: number; calls: Record<string, Split>; counts: Record<string, number> }
interface Post { id: number; club: string; kind: string; title: string; body: string; author: string; ups: number; downs: number }

const known = (c: string) => c === 'NHL' || !!CLUB_NAMES[c];
const nameOf = (c: string) => (c === 'NHL' ? 'The NHL' : CLUB_NAMES[c] ?? c);
const pulseOf = (env: Env, club: string) => rpc<Pulse>(env, 'fan_pulse', { p_club: club });
async function postOf(env: Env, id: number): Promise<Post | null> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/fan_posts?id=eq.${id}&select=id,club,kind,title,body,author,ups,downs`, {
    headers: { apikey: env.SUPABASE_ANON, authorization: `Bearer ${env.SUPABASE_ANON}` },
  });
  const rows = r.ok ? ((await r.json()) as Post[]) : [];
  return rows[0] ?? null;
}

// what the fans call loudest, in words: the leader of the club's goalie, need and MVP calls
function loudest(p: Pulse | null): string | null {
  if (!p?.people) return null;
  const say = (topic: string, words: (label: string) => string) => {
    const s = p.calls[topic];
    const top = s?.choices[0];
    if (!s?.total || !top) return null;
    const def = CLUB_CALLS.find((d) => d.key === topic);
    const label = def?.choices?.find((c) => c[0] === top.choice)?.[1] ?? top.name ?? top.choice;
    return `${Math.round((top.n / s.total) * 100)}% ${words(label)}`;
  };
  return [say('goalie', (l) => `want ${l} in goal`), say('need', (l) => `say the need is ${l.toLowerCase()}`), say('mvp', (l) => `call ${l} the MVP`)].filter(Boolean).slice(0, 2).join(' · ') || null;
}

// the club's own logo for the picture (the version for a dark ground), drawn in as data
async function logo(club: string): Promise<string | null> {
  try {
    const r = await fetch(`https://assets.nhle.com/logos/nhl/svg/${club}_dark.svg`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  } catch { return null; }
}

// ── the pages ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fansPage(rest: string, url: URL, env: Env): Promise<Response> {
  const m = /^\/([A-Za-z]{3})(\/pulse)?\/?$/.exec(rest);
  const club = m ? m[1].toUpperCase() : null;
  const pulse = !!m?.[2];
  const about = /^\/about\/?$/.test(rest);
  const post = Number(url.searchParams.get('post')) || null;
  const hash = about ? '/fans/about' : club && known(club) ? `/fans/${club}${pulse ? '/pulse' : ''}` : '/fans';
  const go = `${url.origin}/#${hash}${post ? `?post=${post}` : ''}`;
  if (club && !known(club)) return Response.redirect(`${url.origin}/#/fans`, 302);
  const theme = clubTheme(club ?? 'NHL');
  if (!club) {
    const image = `${url.origin}/og/fans/NHL.png?v=${tag('fan-zones-1')}`;
    return about
      ? page({ title: 'How the NHL fan zones work', description: 'Where every number comes from, how the reads are made, what the fans add, and what is open: the code, the methods and the fans’ own data.', image, url: url.href, go, color: theme.primary })
      : page({ title: 'NHL fan zones', description: 'Every NHL club read like a front office, free and open: the playoff chances, the numbers, the goalies and the moves, with the fans’ own calls, ideas and knowledge base.', image, url: url.href, go, color: theme.primary });
  }
  const name = nameOf(club);
  if (post) {
    const p = await postOf(env, post);
    if (p && p.club === club) {
      const kind = KINDS.find((k) => k.key === p.kind);
      const score = p.ups - p.downs;
      return page({
        title: p.title.length > 110 ? `${p.title.slice(0, 107)}…` : p.title,
        description: `${kind?.one ?? 'A post'} on the ${club === 'NHL' ? 'NHL' : name} fan board, by ${p.author} (${score >= 0 ? '+' : ''}${score} from the fans).${p.body ? ` ${p.body.slice(0, 160)}${p.body.length > 160 ? '…' : ''}` : ''}`,
        image: `${url.origin}/og/fans/${club}.png?post=${p.id}&v=${tag(`${p.title}|${score}`)}`, url: url.href, go, color: theme.primary,
      });
    }
  }
  const p = await pulseOf(env, club).catch(() => null);
  const said = loudest(p);
  if (pulse) {
    return page({
      title: `${name} fan pulse`,
      description: p?.people ? `What ${p.people} fan${p.people === 1 ? '' : 's'} think${said ? `: ${said}` : ''}. Every call, the top ideas and questions, open to everyone.` : `What ${name} fans think: every call, the top ideas and questions, open to everyone. Be the first to have your say.`,
      image: `${url.origin}/og/fans/${club}-pulse.png?v=${tag(`${p?.people ?? 0}|${said ?? ''}`)}`, url: url.href, go, color: theme.primary,
    });
  }
  return page({
    title: club === 'NHL' ? 'NHL fan zones' : `${name} fan zone`,
    description: `The ${name}, read like a front office: the playoff chances, the numbers, the crease and the moves. ${p?.people ? `${p.people} fan${p.people === 1 ? ' has' : 's have'} their say${said ? `: ${said}` : ''}.` : 'Make your calls, post your ideas and vote.'}`,
    image: `${url.origin}/og/fans/${club}.png?v=${tag(`${p?.people ?? 0}|${said ?? ''}`)}`, url: url.href, go, color: theme.primary,
  });
}

// ── the pictures ──────────────────────────────────────────────────────────────────────────────────────────────────
function fanCard(o: { color: string; deep: string; logo: string | null; eyebrow: string; name: string; line: string; chips: string[]; cta: string }): Node {
  const big = o.name.length > 26 ? 76 : o.name.length > 18 ? 96 : 116;
  return el('div', { width: 1200, height: 630, background: '#05080f', position: 'relative', fontFamily: 'Inter', color: '#fff' },
    el('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(135deg, ${o.deep} 0%, #05080f 72%)` }),
    el('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(225deg, ${rgba(o.color, 0.32)} 0%, rgba(5, 8, 15, 0) 48%)` }),
    o.logo ? { type: 'img', props: { src: o.logo, width: 420, height: 420, style: { position: 'absolute', right: -30, top: 70, opacity: 0.95 } } } : null,
    el('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: 14, backgroundImage: `linear-gradient(180deg, ${o.color}, ${rgba(o.color, 0)})` }),
    el('div', { flexDirection: 'column', justifyContent: 'space-between', padding: '54px 72px 54px 82px', width: '100%', height: '100%' },
      el('div', { alignItems: 'center', gap: 18 },
        { type: 'img', props: { src: mark(o.color), width: 60, height: 60 } },
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: 38, letterSpacing: 1 },
          el('span', { color: o.color }, 'SUPER'), el('span', { marginLeft: 10, color: '#fff' }, 'POOLS'),
          el('span', { marginLeft: 16, color: '#94a3b8', fontStyle: 'normal', fontWeight: 700, fontSize: 30, letterSpacing: 4 }, 'FAN ZONES'))),
      el('div', { flexDirection: 'column', maxWidth: 770 },
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 30, letterSpacing: 6, color: o.color, textTransform: 'uppercase' }, o.eyebrow),
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: big, lineHeight: 0.95, marginTop: 10, textTransform: 'uppercase' }, o.name),
        el('div', { fontSize: 31, fontWeight: 500, color: '#cbd5e1', marginTop: 20, lineHeight: 1.25 }, o.line)),
      el('div', { alignItems: 'center', justifyContent: 'space-between' },
        el('div', { gap: 12 }, ...o.chips.map((c) => el('div', { fontSize: 23, fontWeight: 700, color: '#e2e8f0', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '10px 22px' }, c))),
        el('div', { fontSize: 29, fontWeight: 700, color: '#0b1220', background: o.color, borderRadius: 999, padding: '15px 32px' }, o.cta))));
}

export function fansImage(file: string, url: URL, req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return cached(req, ctx, async () => {
    const m = /^([A-Za-z]{3})(-pulse)?$/.exec(file);
    const club = m?.[1].toUpperCase() ?? '';
    if (!m || !known(club)) return null;
    const t = clubTheme(club);
    const deep = t.secondary;
    const pic = await logo(club);
    const name = nameOf(club);
    const post = Number(url.searchParams.get('post')) || null;
    if (post) {
      const p = await postOf(env, post);
      if (p && p.club === club) {
        const kind = KINDS.find((k) => k.key === p.kind);
        const score = p.ups - p.downs;
        return fanCard({ color: t.primary, deep, logo: pic, eyebrow: `${kind?.one ?? 'A post'} from the ${club === 'NHL' ? 'NHL' : name} fans`,
          name: p.title.length > 80 ? `${p.title.slice(0, 77)}…` : p.title, line: `By ${p.author}`,
          chips: [`${score >= 0 ? '+' : ''}${score} from the fans`, 'Vote on it'], cta: 'Have your say →' });
      }
    }
    if (club === 'NHL') {
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Free and open', name: 'Every club, read like a front office',
        line: 'The playoff chances, the numbers, the goalies and the moves for all 32 NHL clubs, and what their fans think.',
        chips: ['32 clubs', 'The fans’ calls', 'Open data'], cta: 'Find your club →' });
    }
    const p = await pulseOf(env, club).catch(() => null);
    const said = loudest(p);
    if (m[2]) {
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Fan pulse', name,
        line: p?.people ? `What ${p.people} fan${p.people === 1 ? '' : 's'} think${said ? `: ${said}` : ''}.` : 'What the fans think: every call, the top ideas and the questions.',
        chips: p?.people ? [`${p.people} fan${p.people === 1 ? '' : 's'}`, `${p.counts?.idea ?? 0} idea${p.counts?.idea === 1 ? '' : 's'}`, 'Open to all'] : ['Be the first', 'Open to all'], cta: 'See the pulse →' });
    }
    return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Fan zone', name,
      line: said ? `Read like a front office. The fans: ${said}.` : 'Read like a front office: the chances, the numbers, the crease and the moves.',
      chips: [p?.people ? `${p.people} fan${p.people === 1 ? '' : 's'} in` : 'Free and open', 'Make your call'], cta: 'Open the zone →' });
  });
}

// ── the open data ─────────────────────────────────────────────────────────────────────────────────────────────────
const ABOUT = 'The fans’ own data from the Super Pools NHL fan zones. Names show as a first name and an initial; no account is in it. How it works: https://app.superpoolsai.com/fans/about';
export async function fansApi(rest: string, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
  const m = /^(?:\/([A-Za-z]{3}))?\/?$/.exec(rest);
  const club = m?.[1]?.toUpperCase() ?? null;
  if (!m || (club && !known(club))) return new Response(JSON.stringify({ error: 'No such club. Use a club’s three letters (EDM, TOR...) or NHL.' }), { status: 404, headers: cors });
  const key = new Request(`${url.origin}/api/fans${club ? `/${club}` : ''}`, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const body = club ? await rpc<object>(env, 'fan_export', { p_club: club }) : await rpc<object>(env, 'fan_index', {}).then((x) => (x ? { clubs: x } : null));
  if (!body) return new Response(JSON.stringify({ error: 'The fan zones are busy. Try again in a minute.' }), { status: 502, headers: cors });
  const res = new Response(JSON.stringify({ ...body, about: ABOUT, from: PRODUCT.name, at: new Date().toISOString() }), {
    headers: { ...cors, 'cache-control': 'public, max-age=300' },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

