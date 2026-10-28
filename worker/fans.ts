// The fan zones at the edge (25 October 2026, Patrick: "make it so that it is easy to share with others"; later that day:
// "improve the look dramatically of sharing individual fan pages in messages and social media"):
//   /fans, /fans/about, /fans/<CLUB>, /fans/<CLUB>/<page> and /fans/<CLUB>?post=<id>   a page a chat app reads when the
//       link is pasted, which sends a person straight on to the app (#/fans/…); a page is the analysis, the outlook, the
//       history or the pulse
//   /og/fans/<CLUB>.png, /og/fans/<CLUB>-<page>.png (?post=<id>)   the pictures those pages point at, each drawn from the
//       page's own numbers: the grade, the record and the chances for a zone, the chances and the projected finish for its
//       outlook, the ranks for its analysis, the titles and the all-time numbers for its history, the fans' loudest calls
//       for its pulse, the post itself for a post. The numbers come from the hub's data at the edge (worker/hub.ts) read by
//       the site's own libraries (src/lib/fanZone.ts, fanDeep.ts, fanSport.ts, fanSportHistory.ts), so a picture says what
//       the page says.
//   /api/fans and /api/fans/<CLUB>   the fans' open data: every club's activity, or one club's pulse and every post, as
//       JSON for anyone (five minutes at the edge, any origin). Names are a first name and an initial; no account is in it.
// Everything is read with the public key from fan_index, fan_pulse, fan_export and fan_posts (migration 337).
// Every other league the zones carry (migration 338: the NFL, the NBA, the Premier League) the same way, its clubs from
// fan_clubs: /fans/<league>, /fans/<league>/<CLUB>(/<page>), /og/fans/<league>(/<CLUB>)(-<page>).png and
// /api/fans/<league>(/<CLUB>).
import type { Env } from './index';
import { cached, el, mark, page, PRODUCT, rgba, rpc, tag, type Node } from './preview';
import { hubData } from './hub';
import { CLUB_NAMES, clubTheme, leagueTheme, sportTheme } from '../src/data/clubColors';
import { CLUB_LORE } from '../src/data/clubHistory';
import { CLUB_CALLS, CLUB_CALLS_BY_SPORT, KINDS, type FanSport } from '../src/lib/fanLists';
import { assess, rankWord, type FanData } from '../src/lib/fanZone';
import { historyFacts, outlook, seasonName, type FanHistory, type Outlook } from '../src/lib/fanDeep';
import { assess as sportAssess, outlook as sportOutlook, table, type Chances, type SportLeague, type SportRead } from '../src/lib/fanSport';
import { facts as sportFacts, seasonLabel, titlesOf, totals, type SportHistory } from '../src/lib/fanSportHistory';

interface Split { total: number; choices: { choice: string; n: number; name: string | null }[] }
interface Pulse { club: string; season: number; people: number; calls: Record<string, Split>; counts: Record<string, number> }
interface Post { id: number; league?: string; club: string; kind: string; title: string; body: string; author: string; ups: number; downs: number }
type Page = '' | 'analysis' | 'outlook' | 'history' | 'pulse';
const PAGES = ['analysis', 'outlook', 'history', 'pulse'];
const PAGE_WORD: Record<Page, string> = { '': 'fan zone', analysis: 'the analysis', outlook: 'the outlook', history: 'the history', pulse: 'fan pulse' };

const known = (c: string) => c === 'NHL' || !!CLUB_NAMES[c];
// a link's text names how many fans have had their say once there are enough to say it proudly (the pre-launch review:
// "1 fan has their say" is no reason to tap); the pictures and the pulse page still count every one
const crowd = (p: { people?: number } | null | undefined) => (p?.people ?? 0) >= 10;
const nameOf = (c: string) => (c === 'NHL' ? 'The NHL' : CLUB_NAMES[c] ?? c);
const pct = (v: number) => (v >= 0.995 ? '>99%' : v > 0 && v < 0.005 ? '<1%' : `${Math.round(v * 100)}%`);
const pulseOf = (env: Env, club: string, league = 'nhl') => rpc<Pulse>(env, 'fan_pulse', { p_club: club, p_league: league }).catch(() => null);
async function postOf(env: Env, id: number): Promise<Post | null> {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/fan_posts?id=eq.${id}&select=id,league,club,kind,title,body,author,ups,downs`, {
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
// the fans' calls as bars for a pulse picture: the busiest first
const CALL_TITLES: Record<string, string> = { goalie: 'In goal', mvp: 'The MVP', move: 'The one to move', need: 'The need', window: 'The window', spring: 'The spring', gm: 'The GM', coach: 'The coach', qb: 'At quarterback', keeper: 'In goal', finish: 'The finish', cup: 'The Cup', hart: 'The Hart', vezina: 'The Vezina', norris: 'The Norris', dpoy: 'Defensive player', scorer: 'Golden Boot', poty: 'Player of the year', down: 'Going down', surprise: 'The surprise', letdown: 'The letdown' };
function pulseBars(p: Pulse | null, sport: FanSport, board: boolean): { label: string; pct: number; value: string }[] {
  if (!p?.people) return [];
  const defs = board ? [] : (sport === 'hockey' ? CLUB_CALLS : CLUB_CALLS_BY_SPORT[sport] ?? []);
  return Object.entries(p.calls).filter(([, s]) => s.total).sort((a, b) => b[1].total - a[1].total).slice(0, 3).map(([topic, s]) => {
    const top = s.choices[0];
    const def = defs.find((d) => d.key === topic);
    const label = def?.choices?.find((c) => c[0] === top.choice)?.[1] ?? top.name ?? (topic.startsWith('q-') ? { keep: 'Keep', adjust: 'Adjust', rethink: 'Rethink' }[top.choice] ?? top.choice : top.choice);
    return { label: `${CALL_TITLES[topic] ?? def?.short ?? topic}: ${label}`, pct: top.n / s.total, value: `${Math.round((top.n / s.total) * 100)}% of ${s.total}` };
  });
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

// the reads below simulate whole seasons; each is kept in the isolate for a few minutes per answer of the hub (its `at`),
// so a crawler or a loop of requests for the same page runs the simulation once, not once a request (28 October 2026)
const MEMO_MS = 5 * 60_000;
const memo = new Map<string, { at: number; v: unknown }>();
function remember<T>(key: string, make: () => T): T {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.v as T;
  const v = make();
  if (memo.size > 300) for (const [k, x] of memo) if (Date.now() - x.at >= MEMO_MS) memo.delete(k);
  memo.set(key, { at: Date.now(), v });
  return v;
}

// ── the NHL's numbers, read the way the page reads them
interface NhlRead { d: FanData; a: ReturnType<typeof assess>; out: Outlook | null }
async function nhlRead(origin: string, env: Env, ctx: ExecutionContext, club: string): Promise<NhlRead | null> {
  const d = await hubData<FanData>(origin, env, ctx, { task: 'fan', abbrev: club });
  if (!d?.standing) return null;
  return remember(`nhl:${club}:${d.at}`, () => ({ d, a: assess(d), out: outlook(d, 3000) }));
}
const nhlRecord = (r: NhlRead | null) => (r?.d.standing ? `${r.d.standing.w}-${r.d.standing.l}-${r.d.standing.otl} · ${r.d.standing.pts} pts` : '');
const nhlHist = (origin: string, env: Env, ctx: ExecutionContext, club: string) => hubData<FanHistory>(origin, env, ctx, { task: 'fan-history', abbrev: club });
const cupsOf = (h: FanHistory | null, club: string) => (CLUB_LORE[club]?.cups?.length ? CLUB_LORE[club].cups : (h?.seasons ?? []).filter((s) => s.po?.won && s.po.round >= 4).map((s) => Number(String(s.season).slice(4))));

// ── the pages ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fansPage(rest: string, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const sp = await sportPlace(env, rest);
  if (sp) return sportPage(sp, url, env, ctx);
  const m = /^\/([A-Za-z]{3})(?:\/(analysis|outlook|history|pulse))?\/?$/.exec(rest);
  const club = m ? m[1].toUpperCase() : null;
  const pg = (m?.[2] ?? '') as Page;
  const about = /^\/about\/?$/.test(rest);
  const post = Number(url.searchParams.get('post')) || null;
  const hash = about ? '/fans/about' : club && known(club) ? `/fans/${club}${pg ? `/${pg}` : ''}` : '/fans';
  const go = `${url.origin}/#${hash}${post ? `?post=${post}` : ''}`;
  if (club && !known(club)) return Response.redirect(`${url.origin}/#/fans`, 302);
  if (club === 'NHL' && pg && pg !== 'pulse') return Response.redirect(`${url.origin}/#/fans`, 302);
  const theme = clubTheme(club ?? 'NHL');
  if (!club) {
    const image = `${url.origin}/og/fans/NHL.png?v=${tag('fan-zones-2')}`;
    return about
      ? page({ title: 'How the fan zones work', description: 'Where every number comes from, how the reads are made, what the fans add, and what is open: the code, the methods and the fans’ own data.', image, url: url.href, go, color: theme.primary })
      : page({ title: 'Fan zones', description: 'Every club in the NHL, the NFL, the NBA and the Premier League read like a front office, free and open: the chances, the numbers, the players and the moves, with the fans’ own calls, ideas and knowledge base.', image, url: url.href, go, color: theme.primary });
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
  const p = await pulseOf(env, club);
  const said = loudest(p);
  const img = (v: string) => `${url.origin}/og/fans/${club}${pg ? `-${pg}` : ''}.png?v=${tag(v)}`;
  if (pg === 'pulse') {
    return page({
      title: `${name} fan pulse`,
      description: crowd(p) ? `What ${p!.people} fan${p!.people === 1 ? '' : 's'} think${said ? `: ${said}` : ''}. Every call, the top ideas and questions, open to everyone.` : `What ${name} fans think: every call, the top ideas and questions, open to everyone. Be the first to have your say.`,
      image: img(`${p?.people ?? 0}|${said ?? ''}`), url: url.href, go, color: theme.primary,
    });
  }
  if (club === 'NHL') {
    return page({ title: 'NHL fan zones', description: `Every NHL club read like a front office: the playoff chances, the numbers, the crease and the moves. ${crowd(p) ? `${p!.people} fan${p!.people === 1 ? ' has' : 's have'} their say.` : 'Make your calls, post your ideas and vote.'}`,
      image: img(`${p?.people ?? 0}`), url: url.href, go, color: theme.primary });
  }
  // the page's own numbers, for the words and the picture
  const r = await nhlRead(url.origin, env, ctx, club);
  const rec = nhlRecord(r);
  if (pg === 'outlook') {
    const o = r?.out;
    return page({ title: `${name}: the outlook`,
      description: o ? `${pct(o.playoffs)} to make the playoffs, ${pct(o.rounds.cup)} for the Cup, projected ${o.projected.mid} points (${o.projected.low} to ${o.projected.high}). The seeds, the first-round opponents, the spring round by round and the schedule, from ${o.sims.toLocaleString()} simulated seasons.` : `The ${name}' season played out a few thousand times: the chances, the seeds, the first round and the road ahead.`,
      image: img(`${rec}|${o ? `${o.playoffs.toFixed(3)}|${o.rounds.cup.toFixed(3)}|${o.projected.mid}` : ''}`), url: url.href, go, color: theme.primary });
  }
  if (pg === 'analysis') {
    const a = r?.a;
    return page({ title: `${name}: the analysis`,
      description: a ? `Grade ${a.grade}. ${a.summary} Every measure ranked among the 32, the splits, the players, the crease and what the front office should do.` : `The ${name} read like a front office: every measure ranked, the splits, the players, the crease and the moves.`,
      image: img(`${rec}|${a?.grade ?? ''}|${a?.strengths[0]?.key ?? ''}|${a?.weaknesses[0]?.key ?? ''}`), url: url.href, go, color: theme.primary });
  }
  if (pg === 'history') {
    const h = await nhlHist(url.origin, env, ctx, club);
    const cups = cupsOf(h, club);
    const tr = h?.totals.regular;
    return page({ title: `${name}: the history`,
      description: `${cups.length} Stanley Cup${cups.length === 1 ? '' : 's'}${cups.length ? ` (${cups.join(', ')})` : ''}${tr ? `, ${tr.w.toLocaleString()} wins all-time` : ''}. Every season, the records, the trophies, the draft, the people and the stories, from the NHL's record books.`,
      image: img(`${cups.length}|${tr?.w ?? 0}|${h?.seasons.length ?? 0}`), url: url.href, go, color: theme.primary });
  }
  return page({
    title: `${name} fan zone`,
    description: `${r?.a ? `Grade ${r.a.grade}, ${rec}${r.out ? `, ${pct(r.out.playoffs)} to make the playoffs` : ''}. ` : ''}The ${name}, read like a front office: the playoff chances, the numbers, the crease and the moves. ${crowd(p) ? `${p!.people} fan${p!.people === 1 ? ' has' : 's have'} their say${said ? `: ${said}` : ''}.` : 'Make your calls, post your ideas and vote.'}`,
    image: img(`${rec}|${r?.a?.grade ?? ''}|${r?.out ? r.out.playoffs.toFixed(3) : ''}|${p?.people ?? 0}|${said ?? ''}`), url: url.href, go, color: theme.primary,
  });
}

// ── the pictures ──────────────────────────────────────────────────────────────────────────────────────────────────
interface Tile { k: string; v: string; sub?: string; tone?: string }
interface Bar { label: string; pct: number; value: string }
interface CardSpec { color: string; deep: string; logo: string | null; eyebrow: string; name: string; big?: { v: string; label: string } | null; tiles?: Tile[]; bars?: Bar[]; line: string; chips?: string[]; cta: string }
// a page's picture: the brand, the club and the page, the big number with its label, the numbers as tiles (or the fans'
// calls as bars) beside it, the line and the way in
function fanCard(o: CardSpec): Node {
  const big = o.name.length > 26 ? 56 : o.name.length > 16 ? 68 : 84;
  const tiles = (o.tiles ?? []).slice(0, 4), bars = (o.bars ?? []).slice(0, 3);
  const right = tiles.length
    ? el('div', { flexWrap: 'wrap', gap: 12, width: 536, justifyContent: 'flex-end' }, ...tiles.map((t) => el('div', { flexDirection: 'column', width: 262, height: 118, padding: '14px 18px', borderRadius: 22, background: 'rgba(0,0,0,0.34)', border: '1px solid rgba(255,255,255,0.1)' },
      el('div', { fontSize: 17, fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 226 }, t.k),
      el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: 46, lineHeight: 1, marginTop: 6, color: t.tone === 'club' ? o.color : t.tone === 'good' ? '#34d399' : t.tone === 'bad' ? '#f87171' : t.tone === 'gold' ? '#fcd34d' : '#fff' }, t.v),
      t.sub ? el('div', { fontSize: 18, color: 'rgba(255,255,255,0.55)', marginTop: 4 }, t.sub.length > 30 ? `${t.sub.slice(0, 29)}…` : t.sub) : null)))
    : bars.length
      ? el('div', { flexDirection: 'column', gap: 16, width: 536 }, ...bars.map((b) => el('div', { flexDirection: 'column' },
        el('div', { justifyContent: 'space-between', fontSize: 24, fontWeight: 700 }, el('span', { color: '#f1f5f9' }, b.label.length > 40 ? `${b.label.slice(0, 39)}…` : b.label), el('span', { color: o.color }, b.value)),
        el('div', { height: 14, borderRadius: 7, background: 'rgba(255,255,255,0.08)', marginTop: 8 }, el('div', { width: `${Math.max(3, Math.round(b.pct * 100))}%`, height: 14, borderRadius: 7, background: o.color })))))
      : null;
  return el('div', { width: 1200, height: 630, background: '#05080f', position: 'relative', fontFamily: 'Inter', color: '#fff' },
    el('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(135deg, ${o.deep} 0%, #05080f 72%)` }),
    el('div', { position: 'absolute', left: 0, top: 0, width: 1200, height: 630, backgroundImage: `linear-gradient(225deg, ${rgba(o.color, 0.3)} 0%, rgba(5, 8, 15, 0) 48%)` }),
    o.logo ? { type: 'img', props: { src: o.logo, width: 380, height: 380, style: { position: 'absolute', right: -40, bottom: -70, opacity: 0.1 } } } : null,
    el('div', { position: 'absolute', left: 0, top: 0, bottom: 0, width: 14, backgroundImage: `linear-gradient(180deg, ${o.color}, ${rgba(o.color, 0)})` }),
    el('div', { flexDirection: 'column', padding: '44px 64px 44px 78px', width: '100%', height: '100%' },
      el('div', { alignItems: 'center', gap: 16 },
        { type: 'img', props: { src: mark(o.color), width: 50, height: 50 } },
        el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: 32, letterSpacing: 1 },
          el('span', { color: o.color }, 'SUPER'), el('span', { marginLeft: 8, color: '#fff' }, 'POOLS'),
          el('span', { marginLeft: 14, color: '#94a3b8', fontStyle: 'normal', fontWeight: 700, fontSize: 26, letterSpacing: 4 }, 'FAN ZONES')),
        o.logo ? { type: 'img', props: { src: o.logo, width: 54, height: 54, style: { marginLeft: 'auto' } } } : null),
      el('div', { flex: 1, gap: 28, marginTop: 22, alignItems: 'center' },
        el('div', { flexDirection: 'column', flex: 1, minWidth: 0 },
          el('div', { fontFamily: 'Barlow Condensed', fontWeight: 700, fontSize: 26, letterSpacing: 5, color: o.color, textTransform: 'uppercase' }, o.eyebrow),
          el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontStyle: 'italic', fontSize: big, lineHeight: 0.95, marginTop: 6, textTransform: 'uppercase' }, o.name),
          o.big ? el('div', { alignItems: 'flex-end', gap: 16, marginTop: 18 },
            el('div', { fontFamily: 'Barlow Condensed', fontWeight: 900, fontSize: o.big.v.length > 4 ? 96 : 124, lineHeight: 0.9, color: '#fff' }, o.big.v),
            el('div', { fontSize: 24, fontWeight: 700, color: 'rgba(255,255,255,0.7)', paddingBottom: 10, maxWidth: 240, lineHeight: 1.15 }, o.big.label)) : null),
        right),
      el('div', { alignItems: 'center', justifyContent: 'space-between', gap: 24, marginTop: 10 },
        el('div', { flexDirection: 'column', flex: 1, minWidth: 0 },
          el('div', { fontSize: 25, fontWeight: 500, color: '#cbd5e1', lineHeight: 1.25 }, o.line.length > 150 ? `${o.line.slice(0, 147)}…` : o.line),
          o.chips?.length ? el('div', { gap: 10, marginTop: 10 }, ...o.chips.slice(0, 3).map((c) => el('div', { fontSize: 20, fontWeight: 700, color: '#e2e8f0', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '7px 16px' }, c))) : null),
        el('div', { fontSize: 27, fontWeight: 700, color: '#0b1220', background: o.color, borderRadius: 999, padding: '14px 30px', flexShrink: 0 }, o.cta))));
}

export function fansImage(file: string, url: URL, req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  return cached(req, ctx, async () => {
    const pm = /-(analysis|outlook|history|pulse)$/.exec(file);
    const pg = (pm?.[1] ?? '') as Page;
    const bare = pm ? file.slice(0, -pm[0].length) : file;
    const sp = await sportPlace(env, `/${bare}${pg ? `/${pg}` : ''}`);
    if (sp) return sportImage(sp, url, env, ctx);
    const m = /^([A-Za-z]{3})$/.exec(bare);
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
          name: p.title.length > 80 ? `${p.title.slice(0, 77)}…` : p.title, line: p.body ? `${p.body.slice(0, 120)}${p.body.length > 120 ? '…' : ''}` : `By ${p.author}`,
          tiles: [{ k: 'From the fans', v: `${score >= 0 ? '+' : ''}${score}`, tone: score >= 0 ? 'good' : 'bad' }, { k: 'By', v: p.author.length > 12 ? p.author.slice(0, 11) : p.author }], chips: [kind?.label ?? 'Post', 'Vote on it'], cta: 'Have your say →' });
      }
    }
    if (club === 'NHL') {
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Free and open', name: 'Every club, read like a front office',
        line: 'The chances, the numbers, the players and the moves for every club in the NHL, the NFL, the NBA and the Premier League, and what their fans think.',
        chips: ['4 leagues', 'The fans’ calls', 'Open data'], cta: 'Find your club →' });
    }
    const p = await pulseOf(env, club);
    const said = loudest(p);
    if (pg === 'pulse') {
      const bars = pulseBars(p, 'hockey', false);
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Fan pulse', name, big: { v: String(p?.people ?? 0), label: p?.people === 1 ? 'fan has had their say' : 'fans have had their say' }, bars,
        line: p?.people ? `What the fans think${said ? `: ${said}` : ''}.` : 'What the fans think: every call, the top ideas and the questions. Be the first.',
        chips: p?.people ? [`${p.counts?.idea ?? 0} idea${p.counts?.idea === 1 ? '' : 's'}`, `${p.counts?.ask ?? 0} question${p.counts?.ask === 1 ? '' : 's'}`, 'Open to all'] : ['Be the first', 'Open to all'], cta: 'See the pulse →' });
    }
    const r = await nhlRead(url.origin, env, ctx, club);
    const rec = nhlRecord(r);
    const st = r?.d.standing;
    if (pg === 'outlook' && r?.out) {
      const o = r.out;
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'The outlook', name, big: { v: pct(o.playoffs), label: 'to make the playoffs' },
        tiles: [{ k: 'Projected points', v: String(o.projected.mid), sub: `${o.projected.low} to ${o.projected.high}` }, { k: 'Win the division', v: pct(o.division) }, { k: 'Stanley Cup', v: pct(o.rounds.cup), tone: 'gold' }, { k: 'First-round opponent', v: o.firstRound[0]?.abbrev ?? '–', sub: o.firstRound[0] ? `${pct(o.firstRound[0].chance)} of seasons` : undefined }],
        line: o.need != null && o.need > 0 ? `The playoff line sits near ${o.line} points: ${o.need} more from ${o.left} games, from ${o.sims.toLocaleString()} simulated seasons.` : `${rec}. The seeds, the first round and the spring round by round, from ${o.sims.toLocaleString()} simulated seasons.`,
        chips: [rec, `Top of the conference ${pct(o.conference)}`], cta: 'The outlook →' });
    }
    if (pg === 'analysis' && r?.a) {
      const a = r.a;
      const tiles: Tile[] = [...a.strengths.slice(0, 2).map((x) => ({ k: x.label, v: rankWord(x.rank), sub: x.fmt(x.value), tone: 'good' })), ...a.weaknesses.slice(0, 2).map((x) => ({ k: x.label, v: rankWord(x.rank), sub: x.fmt(x.value), tone: 'bad' }))];
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'The analysis', name, big: { v: a.grade, label: 'the grade so far' }, tiles, line: a.summary, chips: [rec, `${a.ranks.length} measures ranked`], cta: 'The analysis →' });
    }
    if (pg === 'history') {
      const h = await nhlHist(url.origin, env, ctx, club);
      const cups = cupsOf(h, club);
      const tr = h?.totals.regular, po = h?.totals.playoffs;
      const facts = h ? historyFacts(h) : [];
      return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'The history', name, big: { v: String(cups.length), label: cups.length === 1 ? 'Stanley Cup' : 'Stanley Cups' },
        tiles: [tr ? { k: 'All-time wins', v: tr.w.toLocaleString(), sub: `${tr.l.toLocaleString()} losses` } : null, tr?.ptsPct != null ? { k: 'Points %', v: tr.ptsPct.toFixed(3).replace(/^0/, '') } : null, h ? { k: 'Playoff springs', v: String(tr?.playoffSeasons ?? h.seasons.filter((s) => s.po).length), sub: `of ${h.seasons.length} seasons` } : null, po?.seriesW != null ? { k: 'Series won', v: `${po.seriesW}-${po.seriesL}` } : null].filter((x): x is Tile => !!x),
        line: cups.length ? `Champions in ${cups.join(', ')}. ${facts[0] ?? ''}` : facts[0] ?? `Every season since ${h?.first ? seasonName(h.first) : 'the start'}, the records, the trophies and the draft.`,
        chips: CLUB_LORE[club] ? [`Founded ${CLUB_LORE[club].founded}`] : [], cta: 'The history →' });
    }
    // the zone: the grade, the record and the chances
    return fanCard({ color: t.primary, deep, logo: pic, eyebrow: 'Fan zone', name, big: r?.a ? { v: r.a.grade, label: 'the grade so far' } : null,
      tiles: [st ? { k: 'Record', v: `${st.w}-${st.l}-${st.otl}`, sub: `${st.pts} pts · ${rankWord(st.leagueRank)} in the NHL` } : null, r?.out ? { k: 'Playoffs', v: pct(r.out.playoffs), sub: `~${r.out.projected.mid} points`, tone: 'club' } : null, r?.out ? { k: 'Stanley Cup', v: pct(r.out.rounds.cup), tone: 'gold' } : null, p?.people ? { k: 'Fans in', v: String(p.people), sub: said ? said.split(' · ')[0].slice(0, 28) : undefined } : { k: 'The fans', v: 'Open', sub: 'make your call' }].filter((x): x is Tile => !!x),
      line: r?.a ? r.a.summary : said ? `Read like a front office. The fans: ${said}.` : 'Read like a front office: the chances, the numbers, the crease and the moves.',
      chips: ['The analysis', 'The outlook', 'The history'], cta: 'Open the zone →' });
  });
}

// ── the open data ─────────────────────────────────────────────────────────────────────────────────────────────────
const ABOUT = 'The fans’ own data from the Super Pools fan zones. Names show as a first name and an initial; no account is in it. How it works: https://app.superpoolsai.com/fans/about';
export async function fansApi(rest: string, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json; charset=utf-8' };
  // the NHL's at /api/fans/nhl(/EDM) too, every other league's at /api/fans/<league>(/<CLUB>)
  const nhl = /^\/nhl(\/[A-Za-z]{3})?\/?$/.exec(rest);
  if (nhl) rest = nhl[1] ?? '';
  const sp = await sportPlace(env, rest);
  if (sp && !sp.page) return sportApi(sp, url, env, ctx, cors);
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

// ── the other leagues (migration 338) ─────────────────────────────────────────────────────────────────────────────
interface LeagueRow { key: string; name: string; sport: Exclude<FanSport, 'hockey'> }
interface ClubRow { code: string; name: string; short: string | null; logo: string | null; color: string | null; alt_color: string | null }
interface SportPlace { league: LeagueRow; club: ClubRow | null; page: Page }
const get = async <T>(env: Env, path: string): Promise<T | null> => {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_ANON, authorization: `Bearer ${env.SUPABASE_ANON}` } });
  return r.ok ? ((await r.json()) as T) : null;
};
// /nfl, /nfl/pulse, /nfl/KC, /nfl/KC/outlook: a league with a fan zone of its own (not the NHL's) and one of its clubs
async function sportPlace(env: Env, rest: string): Promise<SportPlace | null> {
  const m = /^\/([a-z][a-z0-9-]{1,11})(?:\/([A-Z0-9]{2,5}))?(?:\/(analysis|outlook|history|pulse))?\/?$/.exec(rest);
  if (!m || m[1] === 'nhl' || m[1] === 'about') return null;
  const league = (await get<LeagueRow[]>(env, `fan_leagues?key=eq.${m[1]}&active=eq.true&select=key,name,sport`))?.[0];
  if (!league || league.sport === ('hockey' as string)) return null;
  const club = m[2] ? (await get<ClubRow[]>(env, `fan_clubs?league=eq.${league.key}&code=eq.${m[2]}&active=eq.true&select=code,name,short,logo,color,alt_color`))?.[0] ?? null : null;
  const page = (m[3] ?? '') as Page;
  if (!club && page && page !== 'pulse') return null;
  return { league, club, page };
}
// what a club's fans call loudest, in the sport's own calls
const LOUD: Record<string, [string, (l: string) => string][]> = {
  football: [['qb', (l) => `want ${l} at quarterback`], ['need', (l) => `say the need is ${l.toLowerCase()}`], ['mvp', (l) => `call ${l} the MVP`]],
  basketball: [['mvp', (l) => `call ${l} the MVP`], ['need', (l) => `say the need is ${l.toLowerCase()}`], ['window', (l) => `say ${l.toLowerCase()}`]],
  soccer: [['finish', (l) => `see them finishing: ${l.toLowerCase()}`], ['need', (l) => `say the need is ${l.toLowerCase()}`], ['mvp', (l) => `call ${l} the player of the season`]],
};
function loudestIn(sport: string, p: Pulse | null): string | null {
  if (!p?.people) return null;
  const defs = CLUB_CALLS_BY_SPORT[sport as FanSport] ?? [];
  return (LOUD[sport] ?? []).map(([topic, words]) => {
    const s = p.calls[topic], top = s?.choices[0];
    if (!s?.total || !top) return null;
    const label = defs.find((d) => d.key === topic)?.choices?.find((c) => c[0] === top.choice)?.[1] ?? top.name ?? top.choice;
    return `${Math.round((top.n / s.total) * 100)}% ${words(label)}`;
  }).filter(Boolean).slice(0, 2).join(' · ') || null;
}
// ESPN's mark for a dark ground, drawn in as data: the club's, or the league's own
const LEAGUE_MARK: Record<string, string> = {
  nfl: 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nfl.png', nba: 'https://a.espncdn.com/i/teamlogos/leagues/500-dark/nba.png',
  epl: 'https://a.espncdn.com/i/leaguelogos/soccer/500-dark/23.png',
};
async function pngData(src: string | null | undefined): Promise<string | null> {
  if (!src || !/^https:\/\/a\.espncdn\.com\//.test(src)) return null;
  try {
    const r = await fetch(src, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/png;base64,${btoa(bin)}`;
  } catch { return null; }
}
const darkOf = (logo: string | null) => (logo && /\/500\//.test(logo) ? logo.replace('/500/', '/500-dark/') : logo);
const where = (sp: SportPlace) => `/fans/${sp.league.key}${sp.club ? `/${sp.club.code}` : ''}${sp.page ? `/${sp.page}` : ''}`;
const ogOf = (sp: SportPlace) => `/og/fans/${sp.league.key}${sp.club ? `/${sp.club.code}` : ''}${sp.page ? `-${sp.page}` : ''}.png`;

// the league's numbers, read the way the page reads them
interface SportLeagueRead { l: SportLeague; tb: ReturnType<typeof table>; out: ReturnType<typeof sportOutlook> }
async function sportLeagueRead(origin: string, env: Env, ctx: ExecutionContext, league: string): Promise<SportLeagueRead | null> {
  const l = await hubData<SportLeague>(origin, env, ctx, { task: 'fan-sport-league', league });
  if (!l?.clubs?.length) return null;
  return remember(`sport:${league}:${l.at}`, () => ({ l, tb: table(l), out: sportOutlook(l, l.sport === 'basketball' ? 2000 : 3000) }));
}
const sportHist = (origin: string, env: Env, ctx: ExecutionContext, league: string) => hubData<SportHistory>(origin, env, ctx, { task: 'fan-sport-history', league });
const recordOf = (sport: string, r: SportLeague['clubs'][number]) => (sport === 'soccer' ? `${r.pts ?? 0} pts · ${rankWord(r.seed ?? 0)}` : `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`);
// wins-losses(-ties), or soccer's wins-draws-losses
const wld = (soccer: boolean, r: { w: number; l: number; d: number }) => (soccer ? `${r.w}-${r.d}-${r.l}` : `${r.w}-${r.l}${r.d ? `-${r.d}` : ''}`);
// the chances in the sport's words
function chanceTiles(sport: string, ch: Chances, nameOf: (c: string) => string): Tile[] {
  if (sport === 'soccer') return [{ k: 'Champions', v: pct(ch.title), tone: 'gold' }, { k: 'Top four', v: pct(ch.top4), tone: 'club' }, { k: 'Projected points', v: String(ch.projected.mid), sub: `${ch.projected.low} to ${ch.projected.high}` }, { k: 'Relegated', v: pct(ch.relegated), tone: ch.relegated >= 0.25 ? 'bad' : undefined }];
  const opp = Object.entries(ch.opponents)[0];
  return [{ k: 'Projected wins', v: String(ch.projected.mid), sub: `${ch.projected.low} to ${ch.projected.high}` }, { k: sport === 'football' ? 'Win the division' : 'Top six', v: pct(sport === 'football' ? ch.division : ch.top6) },
    { k: sport === 'football' ? 'Super Bowl' : 'The title', v: pct(ch.title), tone: 'gold' }, { k: 'First-round opponent', v: opp ? (opp[0] === 'bye' ? 'A bye' : nameOf(opp[0])) : '–', sub: opp ? `${pct(opp[1])} of seasons` : undefined }];
}

async function sportPage(sp: SportPlace, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const post = Number(url.searchParams.get('post')) || null;
  const go = `${url.origin}/#${where(sp)}${post ? `?post=${post}` : ''}`;
  const board = sp.league.key.toUpperCase();
  const code = sp.club?.code ?? board;
  const theme = sp.club ? sportTheme(sp.club.color, sp.club.alt_color) : leagueTheme(sp.league.key);
  const name = sp.club?.name ?? `The ${sp.league.name}`;
  const soccer = sp.league.sport === 'soccer';
  if (post) {
    const p = await postOf(env, post);
    if (p && p.club === code && p.league === sp.league.key) {
      const kind = KINDS.find((k) => k.key === p.kind);
      const score = p.ups - p.downs;
      return page({
        title: p.title.length > 110 ? `${p.title.slice(0, 107)}…` : p.title,
        description: `${kind?.one ?? 'A post'} on the ${sp.club ? name : sp.league.name} fan board, by ${p.author} (${score >= 0 ? '+' : ''}${score} from the fans).${p.body ? ` ${p.body.slice(0, 160)}${p.body.length > 160 ? '…' : ''}` : ''}`,
        image: `${url.origin}${ogOf({ ...sp, page: '' })}?post=${p.id}&v=${tag(`${p.title}|${score}`)}`, url: url.href, go, color: theme.primary,
      });
    }
  }
  const p = await pulseOf(env, code, sp.league.key);
  const said = sp.club ? loudestIn(sp.league.sport, p) : null;
  const img = (v: string) => `${url.origin}${ogOf(sp)}?v=${tag(v)}`;
  if (sp.page === 'pulse') {
    return page({
      title: `${sp.club ? name : sp.league.name} fan pulse`,
      description: crowd(p) ? `What ${p!.people} fan${p!.people === 1 ? '' : 's'} think${said ? `: ${said}` : ''}. Every call, the top ideas and questions, open to everyone.` : `What the fans think: every call, the top ideas and questions, open to everyone. Be the first to have your say.`,
      image: img(`${p?.people ?? 0}|${said ?? ''}`), url: url.href, go, color: theme.primary,
    });
  }
  const r = await sportLeagueRead(url.origin, env, ctx, sp.league.key);
  if (!sp.club) {
    const fav = r?.out ? Object.entries(r.out.chances).sort((a, b) => b[1].title - a[1].title).slice(0, 3) : [];
    const nm = (c: string) => r?.l.clubs.find((x) => x.code === c)?.short ?? c;
    return page({ title: `${sp.league.name} fan zones`, description: `Every ${sp.league.name} club read like a front office, free and open: the chances, the numbers, the players and the moves, with the fans’ own calls, ideas and knowledge base.${fav.length ? ` ${soccer ? 'Title' : 'Title'} favourites: ${fav.map(([c, ch]) => `${nm(c)} ${pct(ch.title)}`).join(', ')}.` : ''}`,
      image: img(`${p?.people ?? 0}|${fav.map(([c, ch]) => `${c}${ch.title.toFixed(2)}`).join('')}`), url: url.href, go, color: theme.primary });
  }
  const row = r?.l.clubs.find((x) => x.code === code) ?? null;
  const ch = r?.out?.chances[code] ?? null;
  const a = r && row ? sportAssess(r.l, code, r.tb, r.out, null) : null;
  const rec = row ? recordOf(sp.league.sport, row) : '';
  if (sp.page === 'outlook') {
    return page({ title: `${name}: the outlook`,
      description: ch ? (soccer ? `${pct(ch.title)} for the title, ${pct(ch.top4)} top four, ${pct(ch.relegated)} relegated; projected ${ch.projected.mid} points. The table place by place, from ${r!.out!.sims.toLocaleString()} simulated seasons.` : `${pct(ch.playoffs)} to make the playoffs, ${pct(ch.title)} to win it all; projected ${ch.projected.mid} wins. The seeds, the first-round opponents and the race, from ${r!.out!.sims.toLocaleString()} simulated seasons.`) : `The ${name}' season played out a few thousand times: the chances, the seeds and the road ahead.`,
      image: img(`${rec}|${ch ? `${(soccer ? ch.top4 : ch.playoffs).toFixed(3)}|${ch.title.toFixed(3)}|${ch.projected.mid}` : ''}`), url: url.href, go, color: theme.primary });
  }
  if (sp.page === 'analysis') {
    return page({ title: `${name}: the analysis`,
      description: a ? `Grade ${a.grade}. ${a.summary} Every measure ranked in the ${sp.league.name}, the players and what the front office should do.` : `The ${name} read like a front office: every measure ranked, the players, the front office’s bigger questions and the moves.`,
      image: img(`${rec}|${a?.grade ?? ''}|${a?.strengths[0]?.key ?? ''}|${a?.weaknesses[0]?.key ?? ''}`), url: url.href, go, color: theme.primary });
  }
  if (sp.page === 'history') {
    const h = await sportHist(url.origin, env, ctx, sp.league.key);
    const t = titlesOf(h, sp.league.key, code);
    const tot = h ? totals(sp.league.sport, h.clubs[code] ?? []) : null;
    return page({ title: `${name}: the history`,
      description: `${t.count} ${t.count === 1 ? t.one : t.what}${t.count ? ` (the last in ${seasonLabel(sp.league.key, sp.league.sport, t.years[t.years.length - 1].year)})` : ''}${tot && h ? `; ${tot.w} wins since ${seasonLabel(sp.league.key, sp.league.sport, h.from)}, ${tot.playoffs} ${soccer ? 'top-four finishes' : 'playoff seasons'} in ${tot.seasons}` : ''}. Every season, the eras, the springs and the facts.`,
      image: img(`${t.count}|${tot?.w ?? 0}|${tot?.seasons ?? 0}`), url: url.href, go, color: theme.primary });
  }
  return page({
    title: `${name} fan zone`,
    description: `${a ? `Grade ${a.grade}, ${rec}${ch ? (soccer ? `, ${pct(ch.top4)} top four` : `, ${pct(ch.playoffs)} to make the playoffs`) : ''}. ` : ''}The ${name}, read like a front office: the chances, the numbers, the players and the moves. ${crowd(p) ? `${p!.people} fan${p!.people === 1 ? ' has' : 's have'} their say${said ? `: ${said}` : ''}.` : 'Make your calls, post your ideas and vote.'}`,
    image: img(`${rec}|${a?.grade ?? ''}|${ch ? (soccer ? ch.top4 : ch.playoffs).toFixed(3) : ''}|${p?.people ?? 0}|${said ?? ''}`), url: url.href, go, color: theme.primary,
  });
}

async function sportImage(sp: SportPlace, url: URL, env: Env, ctx: ExecutionContext): Promise<Node | null> {
  const board = sp.league.key.toUpperCase();
  const code = sp.club?.code ?? board;
  const t = sp.club ? sportTheme(sp.club.color, sp.club.alt_color) : leagueTheme(sp.league.key);
  const pic = await pngData(sp.club ? darkOf(sp.club.logo) : LEAGUE_MARK[sp.league.key]);
  const name = sp.club?.name ?? sp.league.name;
  const soccer = sp.league.sport === 'soccer';
  const post = Number(url.searchParams.get('post')) || null;
  if (post) {
    const p = await postOf(env, post);
    if (p && p.club === code && p.league === sp.league.key) {
      const kind = KINDS.find((k) => k.key === p.kind);
      const score = p.ups - p.downs;
      return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: `${kind?.one ?? 'A post'} from the ${name} fans`,
        name: p.title.length > 80 ? `${p.title.slice(0, 77)}…` : p.title, line: p.body ? `${p.body.slice(0, 120)}${p.body.length > 120 ? '…' : ''}` : `By ${p.author}`,
        tiles: [{ k: 'From the fans', v: `${score >= 0 ? '+' : ''}${score}`, tone: score >= 0 ? 'good' : 'bad' }, { k: 'By', v: p.author.length > 12 ? p.author.slice(0, 11) : p.author }], chips: [kind?.label ?? 'Post', 'Vote on it'], cta: 'Have your say →' });
    }
  }
  const p = await pulseOf(env, code, sp.league.key);
  const said = sp.club ? loudestIn(sp.league.sport, p) : null;
  if (sp.page === 'pulse') {
    const bars = pulseBars(p, sp.league.sport, !sp.club);
    return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: 'Fan pulse', name, big: { v: String(p?.people ?? 0), label: p?.people === 1 ? 'fan has had their say' : 'fans have had their say' }, bars,
      line: p?.people ? `What the fans think${said ? `: ${said}` : ''}.` : 'What the fans think: every call, the top ideas and the questions. Be the first.',
      chips: p?.people ? [`${p.counts?.idea ?? 0} idea${p.counts?.idea === 1 ? '' : 's'}`, `${p.counts?.ask ?? 0} question${p.counts?.ask === 1 ? '' : 's'}`, 'Open to all'] : ['Be the first', 'Open to all'], cta: 'See the pulse →' });
  }
  const r = await sportLeagueRead(url.origin, env, ctx, sp.league.key);
  const nm = (c: string) => r?.l.clubs.find((x) => x.code === c)?.short ?? c;
  if (!sp.club) {
    const fav = r?.out ? Object.entries(r.out.chances).sort((a, b) => b[1].title - a[1].title).slice(0, 4) : [];
    return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: `${sp.league.name} · free and open`, name: 'Every club, read like a front office',
      tiles: fav.map(([c, ch]) => ({ k: nm(c), v: pct(ch.title), sub: soccer ? 'to win the league' : 'to win it all', tone: 'club' as const })),
      line: `The chances, the numbers, the players and the moves for every ${sp.league.name} club, and what their fans think.`,
      chips: [`${r?.l.clubs.length ?? ''} clubs`, 'The fans’ calls', 'Open data'], cta: 'Find your club →' });
  }
  const row = r?.l.clubs.find((x) => x.code === code) ?? null;
  const ch = r?.out?.chances[code] ?? null;
  const a = r && row ? sportAssess(r.l, code, r.tb, r.out, null) : null;
  const rec = row ? recordOf(sp.league.sport, row) : '';
  if (sp.page === 'outlook' && ch) {
    return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: 'The outlook', name, big: soccer ? { v: pct(ch.top4), label: 'to finish in the top four' } : { v: pct(ch.playoffs), label: 'to make the playoffs' },
      tiles: chanceTiles(sp.league.sport, ch, nm), line: `${rec}. ${soccer ? 'The table place by place' : 'The seeds, the first round and the race'}, from ${r!.out!.sims.toLocaleString()} simulated seasons.`,
      chips: [rec], cta: 'The outlook →' });
  }
  if (sp.page === 'analysis' && a) {
    const tiles: Tile[] = [...a.strengths.slice(0, 2).map((x) => ({ k: x.label, v: rankWord(x.rank), sub: x.fmt(x.value), tone: 'good' })), ...a.weaknesses.slice(0, 2).map((x) => ({ k: x.label, v: rankWord(x.rank), sub: x.fmt(x.value), tone: 'bad' }))];
    return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: 'The analysis', name, big: { v: a.grade, label: a.early ? 'the grade, an early lean' : 'the grade so far' }, tiles, line: a.summary, chips: [rec, `${a.ranks.length} measures ranked`], cta: 'The analysis →' });
  }
  if (sp.page === 'history') {
    const h = await sportHist(url.origin, env, ctx, sp.league.key);
    const tt = titlesOf(h, sp.league.key, code);
    const tot = h ? totals(sp.league.sport, h.clubs[code] ?? []) : null;
    const S = (y: number) => seasonLabel(sp.league.key, sp.league.sport, y);
    const facts = h ? sportFacts(h, sp.league.key, code, name) : [];
    return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: 'The history', name, big: { v: String(tt.count), label: tt.count === 1 ? tt.one : tt.what },
      tiles: tot && h ? [{ k: `Since ${S(h.from)}`, v: wld(soccer, tot), sub: `${(tot.pct * 100).toFixed(1)}%` }, { k: soccer ? 'Top-four finishes' : 'Playoff seasons', v: String(tot.playoffs), sub: `of ${tot.seasons}` }, { k: sp.league.sport === 'football' ? 'Super Bowls' : sp.league.sport === 'basketball' ? 'Finals' : 'Top-two finishes', v: String(tot.finals) }, { k: 'Best season', v: tot.best ? S(tot.best.year) : '–', sub: tot.best ? wld(soccer, tot.best) : undefined }] : [],
      line: tt.count ? `${tt.what === 'English titles' ? 'Champions' : 'Champions'} in ${tt.years.slice(-6).map((y) => S(y.year)).join(', ')}${tt.years.length > 6 ? ' and more' : ''}. ${facts[1] ?? ''}` : facts[0] ?? 'Every season since the tables began, the eras, the springs and the facts.',
      chips: facts[0] ? [facts[0].replace(/\..*$/, '')] : [], cta: 'The history →' });
  }
  return fanCard({ color: t.primary, deep: t.secondary, logo: pic, eyebrow: `${sp.league.name} · fan zone`, name, big: a ? { v: a.grade, label: a.early ? 'the grade, an early lean' : 'the grade so far' } : null,
    tiles: [row ? { k: soccer ? 'In the table' : 'Record', v: soccer ? rankWord(row.seed ?? 0) : `${row.w}-${row.l}${row.d ? `-${row.d}` : ''}`, sub: soccer ? `${row.pts ?? 0} points` : row.div ?? undefined } : null,
      ch ? (soccer ? { k: 'Top four', v: pct(ch.top4), sub: `title ${pct(ch.title)}`, tone: 'club' } : { k: 'Playoffs', v: pct(ch.playoffs), sub: `~${ch.projected.mid} wins`, tone: 'club' }) : null,
      ch ? { k: soccer ? 'Champions' : sp.league.sport === 'football' ? 'Super Bowl' : 'The title', v: pct(ch.title), tone: 'gold' } : null,
      p?.people ? { k: 'Fans in', v: String(p.people), sub: said ? said.split(' · ')[0].slice(0, 28) : undefined } : { k: 'The fans', v: 'Open', sub: 'make your call' }].filter((x): x is Tile => !!x),
    line: a ? a.summary : said ? `Read like a front office. The fans: ${said}.` : 'Read like a front office: the chances, the numbers, the players and the moves.',
    chips: ['The analysis', 'The outlook', 'The history'], cta: 'Open the zone →' });
}

async function sportApi(sp: SportPlace, url: URL, env: Env, ctx: ExecutionContext, cors: Record<string, string>): Promise<Response> {
  const key = new Request(`${url.origin}/api/fans/${sp.league.key}${sp.club ? `/${sp.club.code}` : ''}`, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const body = sp.club ? await rpc<object>(env, 'fan_export', { p_club: sp.club.code, p_league: sp.league.key })
    : await rpc<object>(env, 'fan_index', { p_league: sp.league.key }).then((x) => (x ? { league: sp.league.key, clubs: x } : null));
  if (!body) return new Response(JSON.stringify({ error: 'The fan zones are busy. Try again in a minute.' }), { status: 502, headers: cors });
  const res = new Response(JSON.stringify({ ...body, about: ABOUT, from: PRODUCT.name, at: new Date().toISOString() }), {
    headers: { ...cors, 'cache-control': 'public, max-age=300' },
  });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
export type { SportRead };

// ── for the search engines (28 October 2026, the pre-launch review): the app's address had no robots.txt or sitemap, so
// a crawler got the app's own page for both. The fan zones are the public part; pools, invites and the API stay out.
export function robots(origin: string): Response {
  const body = ['User-agent: *', 'Allow: /fans', 'Disallow: /api/', 'Disallow: /j/', 'Disallow: /p/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
}
export async function sitemap(origin: string, env: Env, ctx: ExecutionContext): Promise<Response> {
  const key = new Request(`${origin}/sitemap.xml`, { method: 'GET' });
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const pages = ['', '/analysis', '/outlook', '/history', '/pulse'];
  const urls = ['/fans', '/fans/about', '/fans/NHL/pulse', ...Object.keys(CLUB_NAMES).sort().flatMap((c) => pages.map((pg) => `/fans/${c}${pg}`))];
  const leagues = (await get<{ key: string; sport: string }[]>(env, 'fan_leagues?active=eq.true&select=key,sport')) ?? [];
  const clubs = (await get<{ league: string; code: string }[]>(env, 'fan_clubs?active=eq.true&select=league,code&order=league,code')) ?? [];
  for (const l of leagues.filter((x) => x.sport !== 'hockey')) {
    urls.push(`/fans/${l.key}`, `/fans/${l.key}/pulse`);
    for (const c of clubs.filter((x) => x.league === l.key)) urls.push(...pages.map((pg) => `/fans/${l.key}/${c.code}${pg}`));
  }
  const esc = (u: string) => u.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(origin + u)}</loc><changefreq>daily</changefreq></url>`).join('\n')}\n</urlset>\n`;
  const res = new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=21600' } });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}
