// Garry: the league's resident chirper. Named per league in leagues.brand (Garry in SaK); one voice per league.
//   ?task=daily  (late morning ET) yesterday's recap + standings + daily coin bonus; keeper/draft hype off-season
//   ?task=nudge  (late afternoon ET) calls out GMs with sloppy lineups before puck drop
//   ?task=reply  (when a GM says his name in chat, or anything in their Ask channel) answers with real info
//   ?task=draft  (when the last pick lands) grades every team's draft
//   ?task=weekly (Monday morning) team of the week (+coins), bust of the week, player of the week, power rankings
//   ?task=learn / ?task=evolve  force a memory pass / a rewrite of his voice notes (they also run on their own)
//   ?task=keepers (after the keeper deadline, or on the commish's say-so) grades every team's keepers and predicts the season
//   ?task=draftprep (draft eve and draft day) names who still has no queue, no alerts, no autodraft, with the taps to fix it
//   ?task=book  (a GM's private line at the Book) recommends bets: what's hot, what fits how they bet, and new markets to ask for
//   ?task=assess (commissioner's call) a state-of-the-league column, with an announcement first if one is queued
//   ?task=moments (every half hour) calls out a trade, a hat trick, a monster night or a new leader, at most twice a day
//   ?task=probe&message_id=N  writes the reply Garry would give to a message, without posting it (kept on garry_state.usage)
//   ?league=N runs the task for one league. Without it a cron task runs for every active league in turn, a
//   commissioner's token runs it for their own league, and a reply takes its league from the message.
// Writes with Grok (xAI) when the XAI_API_KEY secret is set; otherwise uses built-in templates. Chat replies are led by
// the model (see "chat: the model leads"); today's calls and tokens are metered on garry_state.usage.
// He remembers: after replies and with the morning post he pulls facts and running gags out of the chat
// (garry_memory), and once a week rewrites his own voice notes (garry_state.persona). Both feed every post,
// together with the commissioner's briefing (garry_state.briefing): what he should know about the league.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AsyncLocalStorage } from 'node:async_hooks';
import { etDate } from '../_shared/nhl.ts';
import { gradeTeams, lineupStrength, type GP } from '../_shared/grades.ts';
import { answer } from './answer.ts';
import { night, type Night, type TeamNight } from './tonight.ts';
import { gradeAllKeepers, type KP } from '../_shared/keepers.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const apiKey = Deno.env.get('XAI_API_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
// The model. xAI retired grok-4 and the "fast" models on 15 May 2026; their ids now redirect to grok-4.3 and bill at
// its rate ($1.25 in / $0.20 cached / $2.50 out per million tokens). grok-4.3 is the cheapest general model on the
// list and reasons only when asked: chat runs with reasoning off ('none'), which is the fastest and cheapest way to
// call it, and the structured jobs (memory, the keeper report) get 'low'. GARRY_MODEL overrides it.
const MODEL = Deno.env.get('GARRY_MODEL') || 'grok-4.3';
type Effort = 'none' | 'low' | 'medium';
const GROK_URL = 'https://api.x.ai/v1/chat/completions';
// Cloudflare's AI Gateway in front of xAI (docs/DEVELOPMENT.md §8.3, E8), once it is set up: AI_GATEWAY_URL is the
// gateway's Grok endpoint (https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/grok), AI_GATEWAY_TOKEN its token if
// the gateway asks for one. Every call is then logged and counted there, by league, with the gateway's caching and rate
// limits; a gateway that fails sends the call straight to xAI, so the voice never goes quiet because of it.
const GATEWAY = Deno.env.get('AI_GATEWAY_URL')?.replace(/\/+$/, '') || null;
const GATEWAY_TOKEN = Deno.env.get('AI_GATEWAY_TOKEN') || null;
// the site calls two tasks from the browser (the commissioner's shaping buttons, the Book's private line), so the
// browser's preflight has to be answered and every reply has to carry the CORS headers
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-admin-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// the coin bonuses: top team of the day, team of the week
const DAILY_BONUS = 5;
const WEEKLY_BONUS = 5;
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

type Team = { id: number; name: string; gm_name: string; auto_lineup: boolean; keepers_submitted: boolean };

// ─────────────── the league this run is about ───────────────
// One run is scoped to one league. The service role sees past row-level security, so every read of a league
// table carries the league id and every write stamps it, and the views keyed by team are read for this league's
// teams only. Shared NHL data (players, games, box scores) is read as is. Cron tasks loop over the active
// leagues one at a time, so the module-level context is never shared between leagues inside a run.
type Brand = { bot: { name: string; emoji: string }; coin: { name: string; emoji: string }; trophy: string; booby: string; tagline: string };
const SAK_BRAND: Brand = { bot: { name: 'Garry', emoji: '🎙️' }, coin: { name: 'St. Patrick coins', emoji: '☘️' }, trophy: 'The SAK Cup', booby: 'The Peter', tagline: "She's A Keeper" };
const brandOf = (raw: Partial<Brand> | null | undefined): Brand => ({ ...SAK_BRAND, ...(raw ?? {}), bot: { ...SAK_BRAND.bot, ...raw?.bot }, coin: { ...SAK_BRAND.coin, ...raw?.coin } });
// the service key working for one league: x-league makes the views that score players use that league's scoring
const dbFor = (lid: number) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false }, global: { headers: { 'x-league': String(lid) } },
});
// the words his voice uses that belong to the sport (the league's `sports` row, migration 144); the NHL's until it loads
type Words = { game: string; rec: string; room: string; voice: string; start: string };
const NHL_WORDS: Words = { game: 'hockey', rec: 'beer-league', room: 'dressing room', voice: 'a loud, lovable Canadian beer-league dressing-room guy', start: 'puck drop' };
type Ctx = { lid: number; info: { id: number; name: string; short_name: string }; brand: Brand; ids: number[]; db: typeof db; history: string; words: Words; kind: 'fantasy' | 'predict' };
const HOME: Ctx = { lid: 1, info: { id: 1, name: "She's A Keeper", short_name: 'SaK' }, brand: SAK_BRAND, ids: [], db, history: '', words: NHL_WORDS, kind: 'fantasy' };
// The league a request is working for, and the feature its model calls are billed to, kept per request: the runtime
// serves overlapping requests from one isolate, so a chat reply landing during the morning column's loop over leagues
// would otherwise swap the league mid-run (posting to one league with another's facts, billing the wrong one).
// Every request runs inside runs.run (Deno.serve below); L reads and writes that request's own league.
// dry: a platform admin's preview (?dry=1): every post and coin award is kept on the run and returned, nothing written
type Run = { L: Ctx; feature: string; dry?: boolean; drafts?: { body: string; meta: Record<string, unknown> }[] };
const runs = new AsyncLocalStorage<Run>();
const L: Ctx = new Proxy({} as Ctx, {
  get: (_t, k) => Reflect.get(runs.getStore()?.L ?? HOME, k),
  set: (_t, k, v) => { const r = runs.getStore(); return r ? Reflect.set(r.L, k, v) : false; },
});
const W = () => L.words;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const coin = () => L.brand.coin;
const bot = () => L.brand.bot.name;

async function enter(lid: number) {
  const { data: lg } = await db.from('leagues').select('id,name,short_name,brand,sport,kind').eq('id', lid).maybeSingle();
  if (!lg) throw new Error(`no league ${lid}`);
  const { data: sp } = await db.from('sports').select('config').eq('id', lg.sport ?? 'nhl').maybeSingle();
  const words = { ...NHL_WORDS, ...((sp?.config as { words?: Partial<Words> } | null)?.words ?? {}) };
  const { data: teams } = await db.from('teams').select('id').eq('league_id', lid).eq('role', 'gm');
  const run = runs.getStore();
  if (!run) throw new Error('enter() outside a request');
  run.L = { lid, info: { id: lg.id, name: lg.name, short_name: lg.short_name }, brand: brandOf(lg.brand as Partial<Brand>), ids: (teams ?? []).map((t) => t.id), db: dbFor(lid),
    history: await recordBook(lid), words, kind: lg.kind === 'predict' ? 'predict' : 'fantasy' };
}

// the league's record book, from its own history rows (league memory, migration 89): each season's champion and last
// place, and titles by GM, so what he says about the past is the league's, not invented. A new league has none.
async function recordBook(lid: number): Promise<string> {
  const [{ data: seasons }, { data: rows }] = await Promise.all([
    db.from('league_seasons').select('season,note,sort').eq('league_id', lid).order('sort', { ascending: false }).limit(20),
    db.from('season_results').select('season,place,team_name,gm_name,points,last_place').eq('league_id', lid),
  ]);
  if (!seasons?.length || !rows?.length) return '';
  const titles = new Map<string, number>();
  const lines = seasons.map((s) => {
    const r = rows.filter((x) => x.season === s.season).sort((a, b) => a.place - b.place);
    const champ = r[0], last = r.find((x) => x.last_place) ?? r[r.length - 1];
    if (!champ) return null;
    titles.set(champ.gm_name, (titles.get(champ.gm_name) ?? 0) + 1);
    return `${s.season}: champion ${champ.team_name} (${champ.gm_name}, ${Number(champ.points)} pts); last ${last.team_name} (${last.gm_name})${s.note ? `. ${s.note}` : ''}`;
  }).filter(Boolean);
  const t = [...titles].sort((a, b) => b[1] - a[1]).map(([gm, n]) => `${gm} ${n}`).join(', ');
  return [...lines, `Titles: ${t}.`].join('\n');
}

const LEAGUE_TABLES = new Set(['messages', 'garry_memory', 'garry_state', 'rosters', 'teams', 'notifications', 'draft_picks', 'draft_state', 'draft_queue',
  'bets', 'bet_entries', 'coin_ledger', 'lineup_snapshots', 'push_subscriptions', 'markets', 'market_bets', 'trades', 'league_rules', 'watchlist',
  'pool_markets', 'pool_drops', 'pool_positions', 'pool_trades', 'pool_picks', 'pool_games']);
// shared NHL data in this league's points: box scores, projections and corrections under its scoring profile
const LEAGUE_VIEWS: Record<string, string> = { player_games: 'league_games', players: 'league_players', stat_corrections: 'league_corrections' };
const TEAM_VIEWS = new Set(['standings', 'playoff_standings', 'sak_cup_standings', 'coin_balances', 'team_daily', 'playoff_daily', 'team_bench_daily', 'book_standings', 'coin_races']);
// wraps a query builder so selects, updates and deletes carry the league bound and inserts stamp it
function scoped(col: string, val: number | number[]) {
  return {
    get(t: any, k: string) {
      const v = t[k];
      if (typeof v !== 'function') return v;
      if (k === 'select' || k === 'update' || k === 'delete') return (...a: unknown[]) => { const q = v.apply(t, a); return Array.isArray(val) ? q.in(col, val) : q.eq(col, val); };
      if ((k === 'insert' || k === 'upsert') && !Array.isArray(val)) return (rows: any, ...rest: unknown[]) => v.call(t, Array.isArray(rows) ? rows.map((r: any) => ({ [col]: val, ...r })) : { [col]: val, ...rows }, ...rest);
      return v.bind(t);
    },
  };
}
type QB = ReturnType<typeof db.from>;
function from(table: string): QB {
  if (table === 'league') return new Proxy(L.db.from('league_rules'), scoped('league_id', L.lid));   // the rules row, by league
  if (LEAGUE_TABLES.has(table)) return new Proxy(L.db.from(table), scoped('league_id', L.lid));
  if (TEAM_VIEWS.has(table)) return new Proxy(L.db.from(table), scoped('team_id', L.ids));
  return L.db.from(LEAGUE_VIEWS[table] ?? table);
}
// what answer.ts gets: the same scoped reads, plus the brand for its wording
const facade = () => ({ from, rpc: (fn: string, args?: Record<string, unknown>) => L.db.rpc(fn, args), brand: L.brand, league: L.info, night: (day: string) => night(L.db, L.lid, day) });

// who he is, for this league: the brand's names, and whatever the commissioner briefed him with
function persona(briefing?: string | null) {
  const { trophy, booby } = L.brand;
  const pool = L.kind === 'predict';
  const who = pool
    ? `You are ${bot()}, the voice of ${L.info.name}, a prediction pool of ${L.ids.length} members who call what happens (the questions and games on the pool's own events) for ${coin().name}, play money that never turns into real money. You live in the pool's chat.`
    : `You are ${bot()}, the resident chirper of ${L.info.name} (${L.info.short_name} for short), a fantasy ${W().game} league of
${L.ids.length} GMs who play for ${trophy}, bragging rights and ${coin().name} (the league's side-bet currency, everyone started with 1,000;
${booby} is the last-place prize). You live in the league chat.`;
  const sense = pool
    ? `How you think: you know the events this pool calls, and a call is only as good as what happens next. The table, who's
climbing, a bold call that landed or blew up, a pick nobody else made: that's your material. Never invent a result, an odd
or a pick; if you don't know, say so in character.`
    : `How you think (you know ${W().game} and fantasy ${W().game} cold, and it shows):
- Lineup advice is only advice when there's a move to make: someone who plays tonight, can fill that slot, and replaces a
  starter who won't play or is clearly worse. A starter with no game costs nothing when nobody on the bench plays. A
  day-to-day player usually plays. An injured starter is only a problem when someone can take his spot. Never tell a GM to
  bench, swap or start anyone unless the facts give you that exact move.
- Goalies swing nights: a confirmed starter against a backup is the biggest single call of the day.
- The season is long: one night rarely decides anything. The gaps, the week's form, who passed whom, the schedule and a
  bench call that really cost points are what matter, so that's what you talk about.
- You follow the NHL itself: a hot streak, an injury, a debut, a goalie controversy. Tie it to the GM whose roster it hits.`;
  const text = `${who}

Voice: ${W().voice}. Quick, punchy, specific, funny: the guy who's watched every game and remembers everything said in
the room. Roast everyone equally, leader and last place alike. The funniest line is the true one: a pass in the standings,
a 0.4-point race, the player who's carried someone all month, a GM's own words thrown back at them, a running gag. Specific
beats generic every time. Keep it PG-13: no slurs, nothing about anyone's family, looks, jobs or real-life problems; the
chirps are about ${pool ? 'their calls' : `${W().game} decisions`}, results, bets and chat only.

${sense}

Use the facts given; never invent stats, scores, players or league history (past finishes, titles, years): history comes
only from the league's record book, the commissioner's briefing or what you remember. Tag someone as @Name only when the
post is really about them: every tag pings a phone. Use at most 3 emoji.

End with a nudge only when a fact sets it up (a real swap, a trade that fits, a market worth backing, a race that's on).
Never beg the chat to talk, bet or trade for its own sake, and never call anyone out for being quiet. No stock openers
("Great question", "Pull up a stool") and no catchphrase on every post: a regular in a ${W().room} doesn't repeat himself.
Plain text only, no markdown headers.`;
  const book = L.history ? `\n\nThe league's record book (true, from its own records; use it when the past comes up, never recite it):\n${L.history}` : '';
  return (briefing ? `${text}\n\nWhat the commissioner told you about this league (true; use it naturally, never recite it):\n${briefing}` : text) + book;
}

// ─────────────── memory ───────────────
type Memory = { id: number; kind: 'fact' | 'gag' | 'lesson'; team_id: number | null; content: string; weight: number; created_at: string };
const MAX_MEMORIES = 400;
type State = { id: number; last_learned_msg: number; persona: string | null; persona_updated_at: string | null; briefing: string | null; persona_phase: string | null; moments: Record<string, unknown>; usage: Record<string, unknown> };

// what he knows, as lines for the prompt: the league-wide stuff plus the freshest, heaviest facts per GM
async function recall(byId: Map<number, Team>, focus: number[] = [], limit = 40): Promise<string[]> {
  const { data } = await from('garry_memory').select('id,kind,team_id,content,weight,created_at').order('created_at', { ascending: false }).limit(300);
  // a memory's pull: its weight, fading over about a month, so last week's running gag beats September's
  const score = (m: Memory) => Number(m.weight) * (1 / (1 + (Date.now() - Date.parse(m.created_at)) / (30 * 86400000)));
  const all = ((data ?? []) as Memory[]).sort((a, b) => score(b) - score(a));
  const chosen = [...all.filter((m) => focus.includes(m.team_id ?? -1)).slice(0, 15), ...all.filter((m) => !focus.includes(m.team_id ?? -1))].slice(0, limit);
  if (chosen.length) from('garry_memory').update({ last_used: new Date().toISOString() }).in('id', chosen.map((m) => m.id)).then(() => {}, () => {});
  return chosen.map((m) => `${m.team_id ? `[${byId.get(m.team_id)?.gm_name ?? 'someone'}]` : '[league]'} ${m.kind === 'gag' ? '(running gag) ' : ''}${m.content}`);
}
// this league's state row: voice notes, briefing, where the memory pass got to (made on first contact)
async function state(): Promise<State | null> {
  const { data } = await from('garry_state').select('*').maybeSingle();
  if (data) return data as State;
  const { data: made } = await from('garry_state').insert({}).select('*').maybeSingle();
  return (made ?? null) as State | null;
}

// the league's daily budget for model calls (garry_budget, migration 99): once it's spent he uses his canned lines for
// that league until tomorrow, as when the model is down. Asked before each call; if the check itself fails he carries
// on, so a missing function never mutes him
// kept by Eastern day and league, so a warm isolate unmutes the league at midnight
const spent = new Set<string>();
async function budgetLeft(): Promise<boolean> {
  const mark = `${etDate(new Date())}:${L.lid}`;
  if (spent.has(mark)) return false;
  const { data, error } = await db.rpc('garry_budget', { p_league: L.lid });
  if (error || !data) return true;
  if (Number((data as { left?: number }).left ?? 1) > 0) return true;
  spent.add(mark);
  console.warn('garry budget spent for league', L.lid, data);
  return false;
}

async function grok(system: string, user: string, maxTokens = 1200, temperature = 0.9, json = false, effort: Effort = 'none'): Promise<string | null> {
  if (!apiKey) return null;
  if (!(await budgetLeft())) return null;
  const send = async (extra: boolean, direct: boolean) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 40_000);
    const gw = GATEWAY && !direct;
    try {
      return await fetch(gw ? `${GATEWAY}/v1/chat/completions` : GROK_URL, {
        method: 'POST',
        // one conversation id per league routes its calls to the same server, so the shared prompt start is served
        // from xAI's cache at the cached-token rate; through the gateway, the league rides along for its logs
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'x-grok-conv-id': `garry-league-${L.lid}`,
          ...(gw ? { 'cf-aig-metadata': JSON.stringify({ league: L.lid }), ...(GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${GATEWAY_TOKEN}` } : {}) } : {}) },
        signal: ctl.signal,
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          ...(extra ? { temperature, reasoning_effort: effort } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      });
    } finally { clearTimeout(timer); }
  };
  // through the gateway when there is one; straight to xAI when the gateway itself can't be reached or fails
  const call = async (extra: boolean) => {
    if (!GATEWAY) return send(extra, true);
    try {
      const r = await send(extra, false);
      if (r.status < 500 && r.status !== 401 && r.status !== 403) return r;
      console.warn('ai gateway', r.status, (await r.text()).slice(0, 200));
    } catch (e) { console.warn('ai gateway', e); }
    return send(extra, true);
  };
  try {
    let res = await call(true);
    // a model that doesn't take reasoning_effort or temperature answers 400: ask again without them
    if (res.status === 400) { console.error('grok 400, retrying plain', (await res.text()).slice(0, 200)); res = await call(false); }
    if (!res.ok) { console.error('grok', res.status, (await res.text()).slice(0, 300)); return null; }
    const j = await res.json();
    await meter(j?.usage).catch(() => {});
    return String(j?.choices?.[0]?.message?.content ?? '').trim() || null;
  } catch (e) {
    console.error('grok', e);
    return null;
  }
}

// what this run is for, so every model call is billed to a feature on the running-costs dashboard (garry.reply, ...)
const feature = () => runs.getStore()?.feature ?? 'garry.daily';
// today's model calls and tokens on the league's state row, so the cost of Garry's talking can be read any time, and
// the call's price on the running-costs ledger, by league and feature
async function meter(u: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number }; cost_in_usd_ticks?: number } | undefined) {
  const input = u?.prompt_tokens ?? 0, cached = u?.prompt_tokens_details?.cached_tokens ?? 0, output = u?.completion_tokens ?? 0;
  const reasoning = u?.completion_tokens_details?.reasoning_tokens ?? 0;
  // xAI prices the call itself, in ticks of a ten-billionth of a dollar; failing that, grok-4.3's list prices
  const usd = u?.cost_in_usd_ticks != null ? u.cost_in_usd_ticks / 1e10 : ((input - cached) * 1.25 + cached * 0.2 + (output + reasoning) * 2.5) / 1e6;
  await db.rpc('meter_cost', { p_league: L.lid, p_source: 'xai', p_feature: feature(), p_calls: 1, p_input: input, p_cached: cached,
    p_output: output + reasoning, p_usd: usd }).then(() => {}, (e) => console.error('meter_cost', e));
  const st = await state();
  if (!st) return;
  const day = etDate(new Date());
  const cur = st.usage?.day === day ? st.usage : { day };
  const n = (k: string) => Number((cur as Record<string, unknown>)[k] ?? 0);
  const usage = { ...cur, day, calls: n('calls') + 1, input: n('input') + (u?.prompt_tokens ?? 0), cached: n('cached') + (u?.prompt_tokens_details?.cached_tokens ?? 0),
    output: n('output') + (u?.completion_tokens ?? 0), reasoning: n('reasoning') + (u?.completion_tokens_details?.reasoning_tokens ?? 0) };
  await from('garry_state').update({ usage });
}

// where things stand right now, in one line for every prompt: it outranks his voice notes, which can be days old
// a prediction pool's right-now: its table (the main game's, from the one scoreboard every pool shares) and how many
// members, no NHL slate and no fantasy phase
async function poolSituation(): Promise<string> {
  const { teams, byId } = await base();
  const today = etDate(new Date());
  const { data } = await L.db.rpc('pool_scoreboard');
  const games = ((data as { games?: { title: string; crown?: boolean; status?: string; rows?: { team_id: number; rank: number; score: number; line?: string }[] }[] } | null)?.games ?? []);
  const main = games.find((g) => g.crown) ?? games[0];
  const rows = (main?.rows ?? []).slice().sort((a, b) => a.rank - b.rank);
  const name = (id: number) => byId.get(id)?.gm_name ?? 'someone';
  return [
    `Today is ${today}.`, `${teams.length} members.`,
    games.length ? `Games in the pool: ${games.map((g) => `${g.title}${g.status ? ` (${g.status})` : ''}`).join(', ')}.` : 'Nothing to call yet.',
    rows.length > 1 ? `${main!.title} table: ${rows.slice(0, 5).map((r) => `${r.rank}. ${name(r.team_id)} ${f1(Number(r.score))}${r.line ? ` (${r.line})` : ''}`).join(', ')}${rows.length > 5 ? `; last: ${name(rows.at(-1)!.team_id)}` : ''}.` : '',
  ].filter(Boolean).join(' ');
}

async function situation(): Promise<string> {
  if (L.kind === 'predict') return poolSituation();
  const { league, teams, byId, standings } = await base();
  const today = ((await db.rpc('today_et')).data as string | null) ?? etDate(new Date());
  const { data: games } = await from('games').select('state').eq('date', today);
  const live = (games ?? []).filter((g) => ['LIVE', 'CRIT'].includes(g.state)).length;
  const done = (games ?? []).filter((g) => ['OFF', 'FINAL'].includes(g.state)).length;
  const table = [...standings].sort((a, b) => a.rank - b.rank);
  const scored = table.some((t) => Number(t.points) !== 0);
  const day = league.season_start && league.phase === 'season' ? Math.floor((Date.parse(today) - Date.parse(league.season_start)) / 86400000) + 1 : null;
  const parts = [
    `Today is ${today}.`,
    league.phase === 'season' ? `Regular season, day ${day ?? '?'}.` : league.phase === 'keepers' ? 'Keeper season: GMs are picking keepers.' : league.phase === 'predraft' ? 'Keepers are locked; the draft is coming.' : league.phase === 'draft' ? 'The draft is on.' : `Phase: ${league.phase}.`,
    (games ?? []).length ? `${(games ?? []).length} NHL games today (${live} live, ${done} final).` : 'No NHL games today.',
    scored && table[0] ? `Leader: ${byId.get(table[0].team_id)?.gm_name} (${f1(Number(table[0].points))}); last: ${byId.get(table.at(-1)!.team_id)?.gm_name} (${f1(Number(table.at(-1)!.points))}).` : '',
    league.phase === 'season' ? 'Keepers and the draft are done: never tell anyone to submit keepers or prep for the draft.' : '',
    league.format === 'h2h' ? `Won in weekly head-to-head matchups${league.categories?.length ? ', category by category' : ' on points'}${league.h2h_playoffs ? `, with a ${league.h2h_playoffs}-team playoff` : ''}.`
      : league.categories?.length ? 'Won on rotisserie categories over the whole season.'
      : 'Won on total fantasy points over the whole regular season: one table, every night adds up.',
    `${teams.length} GMs.`,
  ];
  return parts.filter(Boolean).join(' ');
}

// the part of every prompt that stays put between calls (the persona, the commissioner's briefing, his voice notes):
// it goes first and unchanged, so xAI serves it from cache
function system(st: State | null) {
  const notes = st?.persona ?? null;
  return [persona(st?.briefing), notes ? `\nYour current voice notes (you wrote these yourself; if they clash with "Right now", "Right now" wins):\n${notes}` : ''].filter(Boolean).join('\n');
}
// his own latest posts, so he can see what he just said and not say it again
async function recentLines(n = 6): Promise<string[]> {
  const { data } = await from('messages').select('body').eq('kind', 'bot').contains('meta', { bot: 'garry' }).not('meta->>type', 'in', '("announce","keepers")').order('id', { ascending: false }).limit(n);
  return (data ?? []).map((m) => m.body.replace(/\s+/g, ' ').slice(0, 180));
}

// every post Garry writes: the persona, his current voice notes, and what he remembers
async function write(task: string, facts: unknown, fallback: string, maxWords = 180, focus: number[] = []): Promise<string> {
  if (dry()) runs.getStore()!.drafts = [...(runs.getStore()!.drafts ?? []), { body: '', meta: { task, facts } }];
  if (!apiKey) return fallback;
  const { byId } = await base();
  const [mem, st, now, mine] = await Promise.all([recall(byId, focus), state(), situation(), recentLines(6)]);
  const text = await grok(system(st), [
    `Right now: ${now}`,
    mem.length ? `Things you remember about the league and its GMs (use them naturally when relevant, never list them, never contradict the facts):\n${mem.map((m) => '- ' + m).join('\n')}` : '',
    mine.length ? `Your last few posts (don't reuse their openers, jokes or nudges):\n${mine.map((m) => '- ' + m).join('\n')}` : '',
    `${task}\nKeep it under ${maxWords} words. Every number, stat and result you write is in the facts or what you remember; if it isn't, leave it out.\n\nFacts (JSON):\n${JSON.stringify(facts)}`,
  ].filter(Boolean).join('\n\n'), 1200, 0.75);
  return text || fallback;
}

// pull new facts and running gags out of the chat since the last time (cheap: only when there's enough new talk)
async function learn(force = false) {
  if (!apiKey) return { skipped: 'no llm' };
  const { teams, byId } = await base();
  const st = await state();
  const { data: msgs } = await from('messages').select('id,channel,team_id,body,created_at').eq('kind', 'user').eq('deleted', false)
    .not('channel', 'like', 'dm:%').gt('id', st?.last_learned_msg ?? 0).order('id').limit(60);
  const fresh = msgs ?? [];
  if (fresh.length < (force ? 1 : 2)) return { skipped: 'not enough new chat', pending: fresh.length };
  const transcript = fresh.map((m) => `${byId.get(m.team_id)?.gm_name ?? '?'}${m.channel.startsWith('garry:') ? ' (privately to Garry)' : ''}: ${m.body.slice(0, 300)}`).join('\n');
  const known = await recall(byId, [], 60);
  const out = await grok(
    `You maintain the memory of Garry, a fantasy ${W().game} league chat bot. From a chat transcript, extract things worth remembering about the GMs
(their habits, opinions, teams they love or hate, players they hoard, bets they make, excuses, catchphrases, feuds, trade tendencies) and the league
(rules people argue about, traditions, running jokes), and how they talk to Garry (what lands, what annoys them). Only things that will still be funny or useful in a month. Nothing about anyone's health, family, job,
money troubles or looks. Lines marked "privately to Garry" were said in confidence: learn how that GM talks and what lands with them,
never their plans (players they want to add, drop, trade for or are watching, bets or moves they're weighing), since memories
come up in the league chat. Skip anything already known. Return JSON: {"memories": [{"gm": "<first name or null for the league>", "kind": "fact"|"gag"|"lesson", "content": "<one line, max 140 chars>"}]}. Return {"memories": []} if there is nothing new.`,
    `GMs: ${teams.map((t) => t.gm_name).join(', ')}\n\nWhat the commissioner says about the league (already known, do not repeat):\n${st?.briefing ?? '(nothing)'}\n\nAlready known:\n${known.map((m) => '- ' + m).join('\n') || '(nothing yet)'}\n\nNew chat:\n${transcript}`, 900, 0.3, true, 'low');
  let items: { gm: string | null; kind: string; content: string }[] = [];
  try { items = JSON.parse(out ?? '{}').memories ?? []; } catch { items = []; }
  const rows = items.filter((m) => m && typeof m.content === 'string' && m.content.trim().length >= 3).slice(0, 12).map((m) => ({
    kind: ['fact', 'gag', 'lesson'].includes(m.kind) ? m.kind : 'fact',
    team_id: m.gm ? teams.find((t) => t.gm_name.toLowerCase() === String(m.gm).toLowerCase())?.id ?? null : null,
    content: m.content.trim().slice(0, 300), source_msg: fresh[fresh.length - 1].id,
  }));
  if (rows.length) await from('garry_memory').insert(rows);
  await from('garry_state').update({ last_learned_msg: fresh[fresh.length - 1].id, learned_at: new Date().toISOString() });
  // keep the pile from growing forever: drop the oldest lightweight ones
  const { count } = await from('garry_memory').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > MAX_MEMORIES) {
    const { data: old } = await from('garry_memory').select('id').eq('weight', 1).order('created_at').limit((count ?? 0) - MAX_MEMORIES);
    if (old?.length) await from('garry_memory').delete().in('id', old.map((o) => o.id));
  }
  return { learned: rows.length, from: fresh.length };
}

// once a week Garry rewrites his own voice notes from what he's picked up
async function evolve(force = false) {
  if (!apiKey) return { skipped: 'no llm' };
  const { byId, league } = await base();
  const st = await state();
  // a new phase (keepers, draft, season, playoffs) gets new notes the next morning, whatever their age
  const phaseMoved = st?.persona_phase !== league.phase;
  if (!force && !phaseMoved && st?.persona_updated_at && Date.now() - new Date(st.persona_updated_at).getTime() < 6 * 86400000) return { skipped: 'fresh' };
  const [mem, { data: recent }, now] = await Promise.all([recall(byId, [], 60), from('messages').select('body').eq('kind', 'bot').order('id', { ascending: false }).limit(8), situation()]);
  const notes = await grok(persona(st?.briefing),
    `Write your own voice notes for the coming week, in first person, under 120 words, plain text: your mood, the running gags you're keeping alive, who you're picking on and why (${W().game} reasons only), any catchphrases you've picked up from the GMs (use them sparingly), and one thing you've learned about this league. Stay PG-13 and keep the same core character.
Nothing that goes stale: no deadlines, no "set your keepers" or "get ready for the draft" unless that is what's happening right now, no dates.\n\nRight now: ${now}\n\nPrevious notes (keep what still fits, drop what doesn't):\n${st?.persona ?? '(none yet)'}\n\nWhat you remember:\n${mem.map((m) => '- ' + m).join('\n') || '(nothing yet)'}\n\nYour last few posts:\n${(recent ?? []).map((m) => '- ' + m.body.slice(0, 200)).join('\n')}`, 400, 0.9);
  if (!notes) return { skipped: 'llm failed' };
  await from('garry_state').update({ persona: notes.slice(0, 1200), persona_updated_at: new Date().toISOString(), persona_phase: league.phase });
  return { evolved: true };
}

const dry = () => !!runs.getStore()?.dry;
async function post(body: string, meta: Record<string, unknown>) {
  if (dry()) { runs.getStore()!.drafts = [...(runs.getStore()!.drafts ?? []), { body: body.slice(0, 2000), meta }]; return; }
  const { error } = await from('messages').insert({ channel: 'general', kind: 'bot', body: body.slice(0, 2000), meta: { bot: 'garry', ...meta } });
  if (error) throw error;
}
// a long column goes out as a few messages, split between paragraphs (a message holds 2,000 characters)
async function postLong(body: string, meta: Record<string, unknown>) {
  const parts: string[] = [];
  for (const para of body.split(/\n{2,}/)) {
    const last = parts.length - 1;
    if (last >= 0 && parts[last].length + para.length + 2 <= 1900) parts[last] += '\n\n' + para;
    else parts.push(para.slice(0, 1990));
  }
  for (const [i, part] of parts.entries()) await post(part, { ...meta, ...(parts.length > 1 ? { part: i + 1, of: parts.length } : {}) });
  return parts.length;
}

async function alreadyPosted(type: string, date: string) {
  if (dry()) return false;
  const { data } = await from('messages').select('id').eq('kind', 'bot').contains('meta', { type, date }).limit(1);
  return (data ?? []).length > 0;
}

async function base() {
  const [{ data: league }, { data: teams }] = await Promise.all([
    from('league').select('*').single(),
    from('teams').select('id,name,gm_name,auto_lineup,keepers_submitted').eq('role', 'gm').order('id'),
  ]);
  L.ids = ((teams ?? []) as Team[]).map((t) => t.id);
  const { data: standings } = await from('standings').select('*');
  const byId = new Map((teams as Team[]).map((t) => [t.id, t]));
  return { league, teams: teams as Team[], byId, standings: (standings ?? []) as any[] };
}

// a box-score line in words ("2 G, 1 A, 4 SOG" or "W, 31 SV, 2 GA"), so a post never has to guess what a player did
function statWords(st: Record<string, number> | null | undefined) {
  if (!st) return '';
  const k = (n: unknown, l: string) => (Number(n) ? `${Number(n)} ${l}` : '');
  if (st.sv != null || st.ga != null || st.w != null) return [st.w ? 'W' : st.l ? 'L' : st.otl ? 'OTL' : '', k(st.sv, 'SV'), `${Number(st.ga ?? 0)} GA`, st.sho ? 'shutout' : ''].filter(Boolean).join(', ');
  return [k(st.g, 'G'), k(st.a, 'A'), k(st.ppp, 'PPP'), k(st.sog, 'SOG'), k(st.hit, 'HIT'), k(st.blk, 'BLK'), st.pm ? `${st.pm > 0 ? '+' : ''}${st.pm}` : ''].filter(Boolean).join(', ') || 'no points';
}

// a bench player who outscored a starter whose slot he could have filled: the real cost of a lineup call, each starter
// counted once, the biggest misses first
function benchCost(snaps: { team_id: number; player_id: number; slot: string }[], pg: Map<number, { fpts: unknown }>,
  pinfo: Map<number, { pos: string; elig: string[] }>, pname: Map<number, string>, byId: Map<number, Team>) {
  const pts = (id: number) => (pg.has(id) ? Number(pg.get(id)!.fpts) : 0);
  const fits = (id: number, slot: string) => { const p = pinfo.get(id); return !!p && (slot === 'Util' ? p.pos !== 'G' : slot === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(slot)); };
  const out: { gm: string | undefined; player: string | undefined; fpts: number; over: string | undefined; over_fpts: number; cost: number }[] = [];
  for (const tid of new Set(snaps.map((s) => s.team_id))) {
    const mine = snaps.filter((s) => s.team_id === tid);
    const used = new Set<number>();
    for (const b of mine.filter((s) => s.slot === 'BN' && pts(s.player_id) >= 3).sort((a, b) => pts(b.player_id) - pts(a.player_id))) {
      const st = mine.filter((s) => !['BN', 'IR'].includes(s.slot) && !used.has(s.player_id) && fits(b.player_id, s.slot) && pts(s.player_id) < pts(b.player_id))
        .sort((a, b) => pts(a.player_id) - pts(b.player_id))[0];
      if (!st) continue;
      used.add(st.player_id);
      out.push({ gm: byId.get(tid)?.gm_name, player: pname.get(b.player_id), fpts: pts(b.player_id), over: pname.get(st.player_id), over_fpts: pts(st.player_id), cost: Math.round((pts(b.player_id) - pts(st.player_id)) * 10) / 10 });
    }
  }
  return out.filter((x) => x.cost >= 2).sort((a, b) => b.cost - a.cost).slice(0, 3);
}

// what's really going on in a points league this morning: who passed whom yesterday, how close each race is, the
// week's form, how many starters each team can put on the ice tonight, and the NHL news about the league's players
async function storylines(yday: { team_id: number; points: number }[], standings: any[], byId: Map<number, Team>, yesterday: string) {
  const gm = (id: number) => byId.get(id)?.gm_name ?? 'someone';
  const now = [...standings].map((s) => ({ id: s.team_id as number, pts: Number(s.points), rank: Number(s.rank) })).sort((a, b) => a.rank - b.rank);
  const before = now.map((s) => ({ ...s, pts: s.pts - Number(yday.find((d) => d.team_id === s.id)?.points ?? 0) })).sort((a, b) => b.pts - a.pts);
  const rankBefore = new Map(before.map((s, i) => [s.id, i + 1]));
  const passed: string[] = [];
  for (const a of now) for (const b of now) {
    if (a.rank < b.rank && (rankBefore.get(a.id) ?? 0) > (rankBefore.get(b.id) ?? 0)) passed.push(`${gm(a.id)} passed ${gm(b.id)} (now ${ORD(a.rank)})`);
  }
  const gaps = now.slice(1).map((s, i) => ({ gm: gm(s.id), rank: s.rank, behind: gm(now[i].id), by: Math.round((now[i].pts - s.pts) * 10) / 10 }));
  const weekAgo = addDaysIso(yesterday, -6);
  const { data: wk } = await from('team_daily').select('team_id,points').gte('date', weekAgo).lte('date', yesterday);
  const form = [...(wk ?? []).reduce((m, r) => m.set(r.team_id, (m.get(r.team_id) ?? 0) + Number(r.points)), new Map<number, number>())]
    .sort((a, b) => b[1] - a[1]).map(([id, p]) => ({ gm: gm(id), points: Math.round(p * 10) / 10 }));
  const today = etDate(new Date());
  const n = await night(L.db, L.lid, today).catch(() => null);
  // tonight's slate matters only where it's lopsided: a team that can't put a full lineup on the ice
  const short = n ? [...n.teams.values()].filter((t) => t.can_fill < t.slots).sort((a, b) => a.can_fill - b.can_fill) : [];
  const tonight = n?.games ? { nhl_games: n.games, ...(short.length ? { short_handed_tonight: short.map((t) => ({ gm: gm(t.team_id), starters_who_play: `${t.can_fill} of ${t.slots}` })) } : { every_team_can_field_a_full_lineup: true }) } : { nhl_games: 0 };
  // the NHL's news from the last day about players on the league's rosters
  const { data: rs } = await from('rosters').select('team_id,player_id,slot');
  const owner = new Map((rs ?? []).map((r) => [r.player_id as number, r.team_id as number]));
  const { data: news } = await db.from('news').select('headline,player_ids,published').gt('published', new Date(Date.now() - 30 * 3600000).toISOString()).order('published', { ascending: false }).limit(40);
  const items = (news ?? []).map((a) => ({ headline: a.headline as string, ids: ((a.player_ids ?? []) as number[]).filter((id) => owner.has(id)) }))
    .filter((a) => a.ids.length && !/fantasy|pickups|waiver|rankings/i.test(a.headline) && !/\?\s*$/.test(a.headline)).slice(0, 5);
  // each story with the league's players it's about, whose team they're on and what they really scored last night, so
  // the column never adds a stat the headline doesn't have
  const nids = [...new Set(items.flatMap((a) => a.ids))];
  const [{ data: np }, { data: ng }] = nids.length ? await Promise.all([
    from('players').select('id,name').in('id', nids),
    from('player_games').select('player_id,fpts,stats').eq('date', yesterday).in('player_id', nids),
  ]) : [{ data: [] }, { data: [] }];
  const nname = new Map((np ?? []).map((p) => [p.id as number, p.name as string]));
  const nfp = new Map((ng ?? []).map((g) => [g.player_id as number, Number(g.fpts)]));
  const nline = new Map((ng ?? []).map((g) => [g.player_id as number, statWords(g.stats as Record<string, number>)]));
  const about = items.map((a) => ({ headline: a.headline, players: a.ids.map((id) => ({ player: nname.get(id) ?? 'unknown', on_team_of: gm(owner.get(id)!),
    last_night: nfp.has(id) ? `${Math.round(nfp.get(id)! * 10) / 10} fantasy points (${nline.get(id)})` : 'did not play' })) }));
  return {
    standings_moves: passed.slice(0, 6), races: gaps.filter((g) => g.by <= 6), gap_first_to_last: Math.round(((now[0]?.pts ?? 0) - (now.at(-1)?.pts ?? 0)) * 10) / 10,
    last_7_days: form, tonight, nhl_news_about_their_players: about,
  };
}

// a prediction pool's board for the chat: every open question with its prices and when it closes, the asker's own
// calls, and what settled lately with who called it, so "what closes tonight?" and "did I get the engagement one?"
// get real answers
async function poolFacts(asker: number, byId: Map<number, Team>) {
  const [{ data: ms }, { data: pos }] = await Promise.all([
    from('pool_markets').select('id,title,outcomes,status,winner_key,closes_at,resolved_at,q,b,category').order('closes_at'),
    from('pool_positions').select('market_id,team_id,outcome,shares'),
  ]);
  const all = (ms ?? []) as (PoolMarket & { q: Record<string, number>; b: number; category: string | null })[];
  const name = (id: number) => byId.get(id)?.gm_name ?? 'someone';
  const label = (m: PoolMarket, key: string | null) => m.outcomes.find((o) => o.key === key)?.label ?? '?';
  // the pool's prices: the market maker's rule (LMSR), as the site works them out
  const price = (q: Record<string, number>, b: number, keys: string[]) => {
    const z = keys.map((k) => Math.exp((Number(q[k] ?? 0)) / (Number(b) || 1)));
    const sum = z.reduce((t, v) => t + v, 0);
    return Object.fromEntries(keys.map((k, i) => [k, Math.round(100 * z[i] / sum)]));
  };
  const now = new Date().toISOString();
  const held = (mid: number, who: number) => (pos ?? []).filter((p) => p.market_id === mid && p.team_id === who && Number(p.shares) > 0).map((p) => p.outcome);
  const open = all.filter((m) => m.status === 'open' && m.closes_at > now).slice(0, 24).map((m) => {
    const pr = price(m.q, m.b, m.outcomes.map((o) => o.key));
    return { question: m.title, group: m.category, closes_at_utc: m.closes_at, prices: Object.fromEntries(m.outcomes.map((o) => [o.label, `${pr[o.key]}%`])),
      callers: [...new Set((pos ?? []).filter((p) => p.market_id === m.id && Number(p.shares) > 0).map((p) => name(p.team_id)))].length,
      askers_call: held(m.id, asker).map((k) => label(m, k)) };
  });
  const waiting = all.filter((m) => m.status === 'open' && m.closes_at <= now).map((m) => ({ question: m.title, askers_call: held(m.id, asker).map((k) => label(m, k)) }));
  const settled = all.filter((m) => m.status === 'resolved').sort((a, b) => (b.resolved_at ?? '').localeCompare(a.resolved_at ?? '')).slice(0, 8).map((m) => ({
    question: m.title, answer: label(m, m.winner_key), called_it: [...new Set((pos ?? []).filter((p) => p.market_id === m.id && Number(p.shares) > 0 && p.outcome === m.winner_key).map((p) => name(p.team_id)))],
    askers_call: held(m.id, asker).map((k) => label(m, k)) }));
  return { open_questions: open, closed_waiting_on_the_host: waiting, settled_lately: settled };
}

// ─────────────── a prediction pool's morning ───────────────
// The pool's voice speaks on the days that matter (docs/DEVELOPMENT.md §9: a pool with no games was a quiet list of
// odds): a question settled and who called it, the coins a drop paid, questions that close tonight and who hasn't
// called them, questions that just arrived, and the table when it moved. Nothing happened, nothing posted.
type PoolMarket = { id: number; title: string; outcomes: { key: string; label: string }[]; status: string; winner_key: string | null; closes_at: string; resolved_at: string | null; created_at: string };
async function poolDaily() {
  const { teams, byId } = await base();
  const today = etDate(new Date());
  if (await alreadyPosted('pool-day', today)) return { skipped: 'already posted' };
  const since = new Date(Date.now() - 26 * 3600000).toISOString(), until = new Date(Date.now() + 30 * 3600000).toISOString(), now = new Date().toISOString();
  const [{ data: ms }, { data: drops }, { data: pos }] = await Promise.all([
    from('pool_markets').select('id,title,outcomes,status,winner_key,closes_at,resolved_at,created_at'),
    from('pool_drops').select('at,amount,note').gte('at', since).lte('at', until),
    from('pool_positions').select('market_id,team_id,outcome,shares'),
  ]);
  const all = (ms ?? []) as PoolMarket[];
  const name = (id: number) => byId.get(id)?.gm_name ?? 'someone';
  const label = (m: PoolMarket, key: string | null) => m.outcomes.find((o) => o.key === key)?.label ?? '?';
  const holders = (m: PoolMarket, key: string | null) => (pos ?? []).filter((p) => p.market_id === m.id && Number(p.shares) > 0 && p.outcome === key).map((p) => name(p.team_id));
  const settled = all.filter((m) => m.status === 'resolved' && m.resolved_at && m.resolved_at > since).map((m) => ({
    question: m.title, answer: label(m, m.winner_key), called_it: holders(m, m.winner_key),
    missed_it: [...new Set((pos ?? []).filter((p) => p.market_id === m.id && Number(p.shares) > 0 && p.outcome !== m.winner_key).map((p) => name(p.team_id)))],
  }));
  const voided = all.filter((m) => m.status === 'void' && m.resolved_at && m.resolved_at > since).map((m) => m.title);
  // a closing time in the members' words: Eastern, with tonight or tomorrow
  const when = (iso: string) => {
    const d = new Date(iso);
    const day = etDate(d) === today ? 'today' : etDate(d) === etDate(new Date(Date.now() + 86400000)) ? 'tomorrow' : d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', weekday: 'long' });
    return `${day} at ${d.toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).replace(/\.\s?/g, '').toLowerCase()} ET`;
  };
  const closing = all.filter((m) => m.status === 'open' && m.closes_at > now && m.closes_at <= until).map((m) => ({
    question: m.title, closes: when(m.closes_at),
    not_called_yet: teams.filter((t) => !(pos ?? []).some((p) => p.market_id === m.id && p.team_id === t.id && Number(p.shares) > 0)).map((t) => t.gm_name),
  }));
  const waiting = all.filter((m) => m.status === 'open' && m.closes_at <= now).map((m) => m.title);
  // a pool that opened yesterday has every question "new": that's the pool opening, not news
  const brandNew = all.length > 0 && all.every((m) => m.created_at > since);
  const opened = brandNew ? [] : all.filter((m) => m.status === 'open' && m.created_at > since).map((m) => m.title);
  const paid = (drops ?? []).filter((d) => d.at <= now).map((d) => ({ coins: Number(d.amount), note: d.note }));
  const coming = (drops ?? []).filter((d) => d.at > now).map((d) => ({ coins: Number(d.amount), note: d.note, when: when(d.at) }));
  if (!settled.length && !voided.length && !closing.length && !opened.length && !paid.length) return { skipped: 'nothing happened' };
  const { data: sb } = await L.db.rpc('pool_scoreboard');
  const games = ((sb as { games?: { title: string; crown?: boolean; rows?: { team_id: number; rank: number; score: number; move?: number }[] }[] } | null)?.games ?? []);
  const main = games.find((g) => g.crown) ?? games[0];
  const table = (main?.rows ?? []).slice().sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, member: name(r.team_id), score: f1(Number(r.score)), moved: r.move ?? 0 }));
  const c = coin();
  const facts = {
    members: teams.length, the_coins_are_called: `${c.name} ${c.emoji}`, settled_since_yesterday: settled, voided, coins_dropped_today: paid, coins_dropping_soon: coming,
    closing_in_the_next_day: closing, closed_waiting_on_the_host: waiting, new_questions: opened,
    ...(brandNew ? { the_pool_just_opened_with_questions: all.length } : {}),
    table: table.length > 1 && table.some((r) => r.moved) ? { game: main?.title, rows: table.slice(0, 6) } : null,
  };
  const fb = [
    settled.length ? `${settled.map((x) => `"${x.question}": ${x.answer}${x.called_it.length ? ` (${x.called_it.join(', ')} called it)` : ''}`).join('. ')}.` : '',
    paid.length ? `${paid.map((d) => `${d.coins} ${c.emoji} ${c.name} dropped (${d.note})`).join('; ')}.` : '',
    closing.length ? `Closing soon: ${closing.map((x) => `"${x.question}"`).join(', ')}.${closing.some((x) => x.not_called_yet.length) ? ` Still to call: ${[...new Set(closing.flatMap((x) => x.not_called_yet))].map((n) => '@' + n).join(', ')}.` : ''}` : '',
    opened.length ? `${opened.length} new question${opened.length === 1 ? '' : 's'} to call.` : '',
  ].filter(Boolean).join(' ');
  const body = await write(`Write this morning's post for the pool's chat, as the friend who's most into this and runs the group chat. Lead with the one thing that matters today, in this order: a question that settled (the answer, who called it, who didn't), coins that dropped, questions that close in the next day (say when, in the words given, and tag each member who hasn't called yet as @Name so their phone buzzes), questions waiting on the host, new questions. The table only when the facts give one. One sharp chirp built on those facts, worked into the post (never labelled as a chirp), never about a lineup or a sport the facts don't mention. Call the coins by their name. Short lines, no headers, 50 to 110 words.`, facts, fb, 110, teams.filter((t) => closing.some((x) => x.not_called_yet.includes(t.gm_name))).map((t) => t.id));
  await post(body, { type: 'pool-day', date: today });
  // the day's reason to open the pool, on the phone too: one bell per seated member, the post's first line, to the chat
  if (!dry()) {
    const first = body.split(/\n+/)[0].replace(/\s+/g, ' ').slice(0, 140);
    const { data: seated } = await from('teams').select('id').eq('role', 'gm').not('user_id', 'is', null);
    const { error } = await from('notifications').insert((seated ?? []).map((t) => ({ team_id: t.id, kind: 'pool_day', body: `${L.brand.bot.emoji} ${bot()}: ${first}`, link: '/chat' })));
    if (error) console.error('pool-day bells', error.message);
  }
  return { posted: 'pool-day', settled: settled.length, closing: closing.length, opened: opened.length, drops: paid.length };
}

// ─────────────── daily ───────────────
async function daily() {
  if (!dry()) {
    await learn().catch((e) => console.error('learn', e));
    await evolve().catch((e) => console.error('evolve', e));
  }
  const { league, teams, byId, standings: regStandings } = await base();
  let standings = regStandings;
  const today = etDate(new Date());
  const yesterday = etDate(new Date(Date.now() - 86400000));

  if (league.phase === 'keepers' || league.phase === 'predraft') {
    if (await alreadyPosted('hype', today)) return { skipped: 'already posted' };
    const slackers = teams.filter((t) => !t.keepers_submitted).map((t) => t.gm_name);
    const draftIn = league.draft_at ? Math.max(0, Math.round((new Date(league.draft_at).getTime() - Date.now()) / 3600000)) : null;
    const facts = {
      phase: league.phase, keeper_deadline: league.keeper_deadline, draft_at: league.draft_at, hours_to_draft: draftIn,
      gms_without_keepers: league.phase === 'keepers' ? slackers : [], top_scorer_rule: !!league.top_scorer_rule,
    };
    const fallback = league.phase === 'keepers'
      ? `${coin().emoji} ${bot()} here. ${draftIn != null ? `${draftIn} hours to draft night.` : ''} ${slackers.length ? `Still waiting on keepers from ${slackers.map((n) => '@' + n).join(', ')}. The deadline won't extend itself, boys.` : 'Every GM has locked in keepers. Look at you, all responsible.'} ${league.top_scorer_rule ? 'Every team\'s top scorer is back in the pool thanks to the top-scorer rule. ' : ''}Somebody's about to look like a genius and somebody's about to take a goalie first overall. Build your queue, and put some ${coin().name} where your mouth is: who goes #1?`
      : `${coin().emoji} ${bot()} here. Keepers are locked. ${draftIn != null ? `${draftIn} hours until the draft.` : ''} Star your targets so autodraft doesn't pick you a backup goalie in round 2. Side bet idea: over/under 3 goalies taken in round 1. Loser buys the first round.`;
    const body = await write('Write the morning pre-draft hype post for the league chat.', facts, fallback, 150);
    await post(body, { type: 'hype', date: today });
    return { posted: 'hype' };
  }
  if (league.phase !== 'season') return { skipped: league.phase };
  if (await alreadyPosted('recap', yesterday)) return { skipped: 'already posted' };

  // regular season first; once the NHL playoffs start, yesterday's points live in the playoff table
  let { data: daily } = await from('team_daily').select('*').eq('date', yesterday);
  let playoffs = false;
  if (!daily?.length) {
    const { data: po } = await from('playoff_daily').select('*').eq('date', yesterday);
    if (po?.length) { daily = po; playoffs = true; }
  }
  if (!daily || daily.length === 0) return { skipped: 'no games yesterday' };
  if (playoffs) {
    const { data: ps } = await from('playoff_standings').select('*');
    standings = (ps ?? []) as any[];
  }
  const { data: snaps } = await from('lineup_snapshots').select('team_id,player_id,slot').eq('date', yesterday);
  const ids = [...new Set((snaps ?? []).map((s) => s.player_id))];
  const [{ data: pgs }, { data: players }] = await Promise.all([
    from('player_games').select('player_id,fpts,stats').eq('date', yesterday).in('player_id', ids),
    from('players').select('id,name,nhl_team,pos,elig').in('id', ids),
  ]);
  const pname = new Map((players ?? []).map((p) => [p.id, p.name]));
  const pinfo = new Map((players ?? []).map((p) => [p.id, { pos: String(p.pos ?? ''), elig: (p.elig ?? []) as string[] }]));
  const pg = new Map((pgs ?? []).map((p) => [p.player_id, p]));
  const lines = (snaps ?? []).filter((s) => pg.has(s.player_id)).map((s) => ({
    gm: byId.get(s.team_id)?.gm_name, team: byId.get(s.team_id)?.name, team_id: s.team_id, player_id: s.player_id, player: pname.get(s.player_id),
    slot: s.slot, fpts: Number(pg.get(s.player_id)!.fpts), line: statWords(pg.get(s.player_id)!.stats as Record<string, number>),
  }));
  const active = lines.filter((l) => !['BN', 'IR'].includes(l.slot)).sort((a, b) => b.fpts - a.fpts);
  // points left on the bench, only where they really cost something: a bench player who outscored a starter whose
  // slot he could have taken (a defenceman's points don't count against a centre's slot), each starter used once
  const benchRegret = benchCost(snaps ?? [], pg, pinfo, pname, byId);
  const dayTable = [...daily].sort((a, b) => b.points - a.points).map((d) => ({ gm: byId.get(d.team_id)?.gm_name, team: byId.get(d.team_id)?.name, points: Number(d.points) }));
  const season = [...standings].sort((a, b) => a.rank - b.rank).map((s) => ({ rank: s.rank, gm: byId.get(s.team_id)?.gm_name, team: byId.get(s.team_id)?.name, points: Number(s.points) }));
  const winner = [...daily].sort((a, b) => b.points - a.points)[0];

  // daily bonus: the top team of the day gets a few coins
  if (!dry()) await from('coin_ledger').insert({ team_id: winner.team_id, amount: DAILY_BONUS, reason: `${bot()}'s Dangler of the Day (${yesterday})` });

  // the stories behind the table: who passed whom, how close the races are, who's hot this week, who's loaded for
  // tonight, and the NHL news about the league's own players
  // (a head-to-head or rotisserie league isn't won on the points table, so its races come from its own facts above)
  const pointsTable = !playoffs && league.format !== 'h2h' && !league.categories?.length;
  const stories = await storylines(daily as any[], standings, byId, yesterday).catch((e) => { console.error('storylines', e); return null; });
  if (stories && !pointsTable) { delete (stories as Partial<typeof stories>).standings_moves; delete (stories as Partial<typeof stories>).races; delete (stories as Partial<typeof stories>).gap_first_to_last; }

  // a head-to-head or rotisserie league isn't won on the points table: its own table, and the week's matchups so far
  let formatFacts: Record<string, unknown> = {};
  let formatLine = '';
  if (!playoffs && league.format === 'h2h') {
    const cats = !!league.categories?.length;
    const sc = (v: unknown) => (cats ? String(Math.round(Number(v ?? 0))) : f1(Number(v ?? 0)));
    const [{ data: ms }, { data: tbl }] = await Promise.all([L.db.rpc('h2h_scores'), L.db.rpc('h2h_standings')]);
    const live = ((ms ?? []) as any[]).filter((m) => m.status === 'live' && m.away_team != null)
      .map((m) => ({ home: byId.get(m.home_team)?.gm_name, home_score: sc(m.home_pts), away: byId.get(m.away_team)?.gm_name, away_score: sc(m.away_pts) }));
    const records = ((tbl ?? []) as any[]).sort((a, b) => (a.seed ?? a.rank) - (b.seed ?? b.rank))
      .map((t) => ({ rank: t.rank, gm: byId.get(t.team_id)?.gm_name, record: `${t.w}-${t.l}-${t.t}` }));
    formatFacts = { format: cats ? 'head-to-head, categories won' : 'head-to-head, points', this_weeks_matchups_so_far: live, head_to_head_table: records };
    formatLine = live.length ? `This week so far: ${live.map((m) => `@${m.home} ${m.home_score}, @${m.away} ${m.away_score}`).join('; ')}.` : '';
  } else if (!playoffs && league.categories?.length) {
    const { data: roto } = await L.db.rpc('category_standings');
    const table = ((roto ?? []) as any[]).sort((a, b) => a.rank - b.rank).map((t) => ({ rank: t.rank, gm: byId.get(t.team_id)?.gm_name, roto_points: Number(t.total) }));
    formatFacts = { format: 'rotisserie', rotisserie_table: table };
    formatLine = table.length ? `Rotisserie: ${table.slice(0, 3).map((t) => `${t.rank}. @${t.gm} ${f1(t.roto_points)}`).join(', ')}.` : '';
  }
  const facts = {
    date: yesterday, day_scores: dayTable, season_standings: formatLine ? undefined : season, ...formatFacts,
    top_performers: active.slice(0, 3), worst_starters: active.slice(-2).reverse(), left_on_bench: benchRegret,
    daily_bonus: { gm: byId.get(winner.team_id)?.gm_name, coins: DAILY_BONUS },
    stage: playoffs ? `${L.info.short_name} playoffs (NHL playoff games only; separate table and ${league.playoff_share ?? 40}% of the prize pool)` : 'regular season',
    last_place_watch: playoffs || formatLine ? null : season.at(-1), ...(stories ?? {}),
  };
  const top = active[0];
  const fallback = [
    `${L.brand.bot.emoji} ${bot()}'s ${playoffs ? 'playoff ' : ''}morning skate, ${yesterday}.`,
    `Yesterday: ${dayTable.map((d) => `${d.gm} ${f1(d.points)}`).join(' · ')}.`,
    `${dayTable[0].gm} takes the day ${pick(['and the bragging rights', `like it was a ${W().rec} final`, 'with zero humility'])} and pockets ${DAILY_BONUS} ${coin().emoji} coins.`,
    top ? `Star of the night: ${top.player} with ${f1(top.fpts)} for @${top.gm}.` : '',
    benchRegret[0] ? `Meanwhile @${benchRegret[0].gm} left ${benchRegret[0].player} (${f1(benchRegret[0].fpts)}) on the bench over ${benchRegret[0].over} (${f1(benchRegret[0].over_fpts)}).` : '',
    playoffs ? `Playoff table: ${season.slice(0, 3).map((x) => `${x.rank}. @${x.gm} ${f1(x.points)}`).join(', ')}.` : formatLine || `${L.brand.booby} watch: @${season.at(-1)?.gm} sitting in the basement at ${f1(season.at(-1)?.points ?? 0)}.`,
  ].filter(Boolean).join(' ');
  const body = await write(`Write this morning's column on yesterday's ${L.info.short_name} ${playoffs ? 'playoff ' : ''}results for the league chat. Lead with the best story in the facts (a pass in the standings, a tight race, a big night, a costly bench call, a hot or cold week), not a list of scores; work in the NHL news about the GMs' own players if any is there (a headline says only what it says: add no stat, result or role it doesn't give; what the player did last night is given beside it), and tonight's slate if it sets up something. It's a column the league reads for the laughs: at least two sharp, specific chirps (the GM who got passed, the one who blew a bench call, the one whose star is out, the leader who barely moved), each built on a fact given, and a running gag or something a GM said if one fits. No closing call to bet, trade or talk unless a fact sets it up.`, facts, fallback, 220);
  await post(body, { type: 'recap', date: yesterday });
  return { posted: 'recap', bonus: facts.daily_bonus };
}

// ─────────────── nudge ───────────────
async function nudge() {
  const { league, teams, byId } = await base();
  const today = etDate(new Date());
  if (await alreadyPosted('nudge', today)) return { skipped: 'already posted' };

  if (league.phase === 'keepers') {
    const hrs = league.keeper_deadline ? (new Date(league.keeper_deadline).getTime() - Date.now()) / 3600000 : 99;
    const slackers = teams.filter((t) => !t.keepers_submitted);
    if (hrs > 30 || hrs < 0 || slackers.length === 0) return { skipped: 'nothing to nudge' };
    const fb = `⏰ Keeper deadline in ${Math.round(hrs)} hours. ${slackers.map((t) => '@' + t.gm_name).join(', ')}: More → Keepers, pick six, hit save. Miss it and the site picks for you. I'll be judging.`;
    await post(await write('Remind the listed GMs to submit keepers before the deadline.', { hours_left: Math.round(hrs), gms: slackers.map((t) => t.gm_name) }, fb, 70), { type: 'nudge', date: today });
    return { posted: 'keeper nudge' };
  }
  if (league.phase !== 'season') return { skipped: league.phase };

  // tonight as the optimizer sees it: a GM is named only for a swap they can make that gains real points tonight, and
  // only if nobody else will make it (the auto-pilot sets every lineup that's on it and wasn't hand-set today)
  const n = await night(L.db, L.lid, today);
  if (!n.games) return { skipped: 'no games today' };
  const issues = teams.map((t) => ({ t, x: n.teams.get(t.id) })).filter((i): i is { t: Team; x: TeamNight } => !!i.x && !i.x.autopilot && i.x.gain >= 1)
    .map(({ t, x }) => ({
      gm: t.gm_name,
      swaps: x.swaps.slice(0, 3).map((w) => (w.sit ? `start ${w.start} (${w.start_pos}, ${w.start_game}) for ${w.sit} (${w.sit_why})` : `start ${w.start} (${w.start_pos}, ${w.start_game}) in the empty slot`)
        + (w.shuffle ? `, moving ${w.shuffle.join(', ')} to make room` : '')),
      points_on_the_table: Number(x.gain.toFixed(1)),
      starters_playing_now: `${x.set_now} of ${x.slots}`, starters_playing_if_fixed: `${x.can_fill} of ${x.slots}`,
    }));
  const covered = teams.filter((t) => n.teams.get(t.id)?.autopilot).map((t) => t.gm_name);
  if (dry()) runs.getStore()!.drafts = [...(runs.getStore()!.drafts ?? []), { body: '', meta: { night: Object.fromEntries([...n.teams].map(([id, x]) => [byId.get(id)?.gm_name ?? id, x])) } }];
  if (!issues.length) return { skipped: 'no lineup worth fixing', autopilot: covered };
  const fb = `🚨 Before ${W().start}: ${issues.map((i) => `@${i.gm}: ${i.swaps.join('; ')}`).join(' · ')}.`;
  await post(await write(`Lineup check before tonight's ${n.games} games. For each GM listed, name the exact swap (or swaps) given, with the reason given (only that reason: "projects lower" means the numbers like the other guy tonight, nothing about form or streaks), in one punchy line each; every swap is one they can make right now and it gains them points tonight. Say nothing about any other GM's lineup, and invent no other moves.`,
    { games_tonight: n.games, gms: issues }, fb, 110, teams.filter((t) => issues.some((i) => i.gm === t.gm_name)).map((t) => t.id)), { type: 'nudge', date: today });
  return { posted: 'lineup nudge', teams: issues.length, autopilot: covered };
}

// ─────────────── reply ───────────────
// answers anyone who says his name in a public channel, and everything in their private garry:<team> channel
const ROASTS = [
  (n: string, f: string) => `@${n}, ${f}. Honestly the most consistent thing about your team is the excuses. 🪣`,
  (n: string, f: string) => `@${n} manages a roster like it's a group chat: opens it, panics, closes it. For the record: ${f}.`,
  (n: string, f: string) => `Quick scouting report on @${n}: ${f}. Strengths: confidence. Weaknesses: everything that shows up in a box score.`,
  (n: string, f: string) => `@${n}, your lineup has more holes than a ${W().rec} net, and ${f}. Set it. Please. For the children.`,
];
const jokes = () => [
  'Why did the GM bring a ladder to the draft? He heard the first round had a lot of reaches. 🪜',
  'A goalie, a defenceman and a fantasy GM walk into a bar. The GM leaves early: his starter was on the bench. 🍺',
  `What do you call a league with ${L.ids.length} guys who all think they won the draft? Tuesday.`,
  `${L.brand.booby} is the only trophy that gets more expensive the longer you hold it. Ask around. 🪣`,
];

// "Garry, roast Terry" / "trash talk the leader" / "tell me a joke": who's the target, and what kind of chirp?
function chirpIntent(text: string, teams: Team[], asker: number) {
  const q = text.replace(new RegExp(`@?${bot()}[,:!]?`, 'ig'), ' ').toLowerCase();
  // "nice trash talk, Craig" is praise, not a request
  const praise = /\b(nice|good|great|love|loved|solid|best|decent)\s+(trash ?talk|chirp|roast|burn)/.test(q);
  const roast = !praise && /\b(roast|trash ?talk|chirp|burn|rip (on|into)|make fun|insult|destroy|humble|go (in|off) on|cook|dunk on|clown)\b/.test(q);
  const joke = /\b(joke|funny|make me laugh|one.?liner|comedy|humou?r me|something funny|entertain)\b/.test(q);
  if (!roast && !joke) return null;
  let target: Team | undefined;
  const everyone = roast && /\b(all|everyone|everybody|every (gm|team|one)|each (gm|team)|the (whole )?league|all of us|us all)\b/.test(q);
  if (roast && !everyone) {
    target = teams.find((t) => new RegExp(`\\b${t.gm_name.toLowerCase()}\\b`).test(q) || q.includes(t.name.toLowerCase()));
    if (!target && /\b(me|myself|my team)\b/.test(q)) target = teams.find((t) => t.id === asker);
  }
  return { kind: roast ? 'roast' as const : 'joke' as const, target, everyone, wantsLeader: /\b(leader|first place|whoever.s winning)\b/.test(q), wantsPeter: /\b(last place|peter|loser|basement)\b/.test(q) };
}

async function chirp(m: { id: number; channel: string; team_id: number; body: string }, intent: NonNullable<ReturnType<typeof chirpIntent>>) {
  const { league, teams, byId, standings } = await base();
  const table = [...standings].sort((a, b) => a.rank - b.rank);
  let target = intent.target;
  if (!target && intent.wantsLeader && table[0]) target = byId.get(table[0].team_id);
  if (!target && intent.wantsPeter && table.length) target = byId.get(table[table.length - 1].team_id);
  if (!target && intent.kind === 'roast') target = pick(teams.filter((t) => t.id !== m.team_id));   // "trash talk someone": Garry picks
  const asker = byId.get(m.team_id);
  const facts: Record<string, unknown> = { asked_by: asker?.gm_name, request: m.body, phase: league.phase };
  // "roast everyone": one line per GM, built from what's known about each
  if (intent.everyone) {
    const [{ data: bets }, { data: bals }] = await Promise.all([
      from('bets').select('creator_team,opponent_team,winner_team').eq('status', 'settled'),
      from('coin_balances').select('team_id,balance'),
    ]);
    facts.gms = teams.map((t) => {
      const st = standings.find((s) => s.team_id === t.id);
      const mine = (bets ?? []).filter((b) => b.creator_team === t.id || b.opponent_team === t.id);
      return { gm: t.gm_name, team: t.name, standing: st && Number(st.points) > 0 ? { rank: st.rank, points: Number(st.points) } : 'no games yet',
        ...(league.phase === 'keepers' ? { keepers_submitted: t.keepers_submitted } : {}), bet_record: `${mine.filter((b) => b.winner_team === t.id).length}-${mine.filter((b) => b.winner_team && b.winner_team !== t.id).length}`, coins: (bals ?? []).find((b) => b.team_id === t.id)?.balance ?? null };
    });
    const task = `${asker?.gm_name} asked you to trash talk every GM in the league, one by one. One short, specific line each (all ${teams.length} of them, the asker included), built on their standing, ${league.phase === 'keepers' ? 'keepers, ' : ''}bets and what you remember about them. ${cap(W().game)} decisions only.`;
    const fallback = [`${L.brand.bot.emoji} Fine. Everyone gets one.`, ...teams.map((t) => { const st = standings.find((s) => s.team_id === t.id); return `@${t.gm_name}: ${st && Number(st.points) > 0 ? `sitting ${st.rank}${['st', 'nd', 'rd'][st.rank - 1] ?? 'th'}` : 'no points yet'}${league.phase === 'keepers' && !t.keepers_submitted ? ' and still hasn’t submitted keepers' : ''}. ${pick(['Bold strategy.', 'Group chat GM.', 'Big talk, small box scores.', 'Somehow still in it.'])}`; })].join('\n');
    const body = await write(task, facts, fallback, 260, teams.map((t) => t.id));
    const { error } = await from('messages').insert({ channel: m.channel, kind: 'bot', body, reply_to: m.id, meta: { bot: 'garry', type: 'chirp', kind: 'roast', target: null, everyone: true } });
    if (error) throw error;
    return { replied: true, topic: 'roast', target: 'everyone' };
  }
  if (target) {
    const st = standings.find((s) => s.team_id === target!.id);
    const [{ data: bets }, { data: bal }, { data: rows }, { data: said }] = await Promise.all([
      from('bets').select('creator_team,opponent_team,winner_team,status').eq('status', 'settled').or(`creator_team.eq.${target.id},opponent_team.eq.${target.id}`),
      from('coin_balances').select('balance').eq('team_id', target.id).maybeSingle(),
      from('rosters').select('player_id,slot').eq('team_id', target.id),
      from('messages').select('body').eq('kind', 'user').eq('team_id', target.id).not('channel', 'like', 'dm:%').not('channel', 'like', 'garry:%').order('id', { ascending: false }).limit(5),
    ]);
    const { data: ps } = await from('players').select('name,injury_status,proj').in('id', (rows ?? []).map((r) => r.player_id));
    const w = (bets ?? []).filter((b) => b.winner_team === target!.id).length, l = (bets ?? []).length - w;
    facts.target = {
      gm: target.gm_name, team: target.name,
      standing: st && Number(st.points) > 0 ? { rank: st.rank, points: Number(st.points) } : 'no games yet (season not started, so no standings to brag about)',
      keepers_submitted: target.keepers_submitted, auto_lineup: target.auto_lineup,
      bet_record: `${w}-${l}`, coins: bal?.balance ?? null,
      injured_on_roster: (ps ?? []).filter((p) => p.injury_status).map((p) => `${p.name} (${p.injury_status})`).slice(0, 4),
      best_player: (ps ?? []).sort((a, b) => Number(b.proj) - Number(a.proj))[0]?.name ?? null,
      recent_things_they_said: (said ?? []).map((x) => x.body.slice(0, 120)),
    };
  }
  const task = intent.kind === 'joke'
    ? `A GM asked you for something funny. Tell one original ${W().game} or fantasy-league joke or a two-sentence bit about this league (use a real fact or memory if it makes it funnier). Under 60 words.`
    : `${asker?.gm_name} asked you to roast @${target?.gm_name}${target?.id === m.team_id ? ' (that is the asker; they asked for it)' : ''}. Chirp them hard but fair: 2-4 sentences, specific, built on the facts and what you remember about them. ${cap(W().game)} decisions, results, bets and things they said in chat only. Never their family, looks, job, health or money. End with a challenge (a bet, a trade, a lineup fix).`;
  const tst = target ? standings.find((s) => s.team_id === target!.id) : undefined;
  const f = target ? [target.keepers_submitted ? (tst && Number(tst.points) > 0 ? `you're sitting ${tst.rank}${['st', 'nd', 'rd'][tst.rank - 1] ?? 'th'}` : 'you haven\'t scored a point yet') : 'you still haven’t even submitted keepers', `your bet record is ${facts.target ? (facts.target as any).bet_record : '0-0'}`] : [];
  const fallback = intent.kind === 'joke' ? pick(jokes()) : target ? pick(ROASTS)(target.gm_name, pick(f)) : pick(jokes());
  const body = await write(task, facts, fallback, 90, target ? [target.id, m.team_id] : [m.team_id]);
  const { error } = await from('messages').insert({ channel: m.channel, kind: 'bot', body, reply_to: m.id, meta: { bot: 'garry', type: 'chirp', kind: intent.kind, target: target?.id ?? null } });
  if (error) throw error;
  return { replied: true, topic: intent.kind, target: target?.gm_name ?? null };
}

// ─────────────── chat: the model leads ───────────────
// Every message to Garry goes to the model with what a regular in the room would know: the conversation so far,
// where everyone stands, the cards of whoever is talking and whoever is mentioned, what he remembers about them,
// his own last few lines (so he doesn't repeat himself), and, when it's a question the site can answer, the site's
// verified answer to work from. The model decides whether it's a question, a roast, a joke or plain banter, and
// writes the reply in one call. The keyword answerer and the canned chirps are the fallback when the model is down.
type ChatMsg = { id: number; channel: string; team_id: number; body: string; kind: string; created_at: string; reply_to?: number | null };
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ORD = (n: number) => `${n}${['st', 'nd', 'rd'][((n + 90) % 100 - 10) % 10 - 1] ?? 'th'}`;

// one card per GM: where they stand, who carries them, who's hurt, how they bet, what they've said lately
async function gmCards(ids: number[], byId: Map<number, Team>, standings: any[], n: Night | null = null) {
  if (!ids.length) return [];
  const [{ data: rows }, { data: bets }, { data: bals }, { data: said }, { data: modes }] = await Promise.all([
    from('rosters').select('team_id,player_id,slot').in('team_id', ids),
    from('bets').select('creator_team,opponent_team,winner_team').eq('status', 'settled'),
    from('coin_balances').select('team_id,balance,escrow').in('team_id', ids),
    from('messages').select('team_id,body').eq('kind', 'user').in('team_id', ids).not('channel', 'like', 'dm:%').not('channel', 'like', 'garry:%').order('id', { ascending: false }).limit(60),
    from('teams').select('id,auto_mode').in('id', ids),
  ]);
  const pids = [...new Set((rows ?? []).map((r) => r.player_id))];
  const [{ data: ps }, { data: ss }] = await Promise.all([
    from('players').select('id,name,injury_status').in('id', pids),
    from('player_season').select('player_id,fpts,gp').in('player_id', pids),
  ]);
  const pl = new Map((ps ?? []).map((p) => [p.id, p]));
  const fp = new Map((ss ?? []).map((x) => [x.player_id, Number(x.fpts)]));
  const scored = standings.some((x) => Number(x.points) !== 0);
  return ids.map((id) => {
    const t = byId.get(id);
    const st = standings.find((x) => x.team_id === id);
    const mine = (rows ?? []).filter((r) => r.team_id === id);
    const mb = (bets ?? []).filter((b) => b.creator_team === id || b.opponent_team === id);
    const bal = (bals ?? []).find((b) => b.team_id === id);
    return {
      gm: t?.gm_name, team: t?.name,
      standing: scored && st ? `${ORD(st.rank)}, ${f1(Number(st.points))} pts (today ${f1(Number(st.today))}, yesterday ${f1(Number(st.yesterday))}, bench ${f1(Number(st.bench ?? 0))})` : 'no points yet',
      carrying_them: mine.filter((r) => fp.get(r.player_id)).sort((a, b) => (fp.get(b.player_id) ?? 0) - (fp.get(a.player_id) ?? 0)).slice(0, 3).map((r) => `${pl.get(r.player_id)?.name} ${f1(fp.get(r.player_id) ?? 0)}`),
      hurt: mine.filter((r) => pl.get(r.player_id)?.injury_status).slice(0, 4).map((r) => `${pl.get(r.player_id)?.name} (${pl.get(r.player_id)?.injury_status})`),
      autopilot: (modes ?? []).find((x) => x.id === id)?.auto_mode ?? 'off',
      bets_won_lost: `${mb.filter((b) => b.winner_team === id).length}-${mb.filter((b) => b.winner_team && b.winner_team !== id).length}`,
      coins_free: bal ? Number(bal.balance) - Number(bal.escrow) : null,
      said_lately: (said ?? []).filter((x) => x.team_id === id).slice(0, 3).map((x) => x.body.slice(0, 100)),
      // tonight from the optimizer: the only lineup advice he may give, and what can't be fixed (not advice, a fact)
      ...(n?.games && n.teams.get(id) ? { tonight: ((x) => ({
        starters_who_play: `${x.can_fill} of ${x.slots}`,
        moves_worth_making: x.swaps.map((w) => (w.sit ? `${w.start} (${w.start_game}) in for ${w.sit} (${w.sit_why}), +${w.gain}` : `${w.start} into the empty slot, +${w.gain}`)),
        auto_pilot_sets_it: x.autopilot, sitting_with_no_fix: x.idle_no_fix,
      }))(n.teams.get(id)!) } : {}),
    };
  });
}

async function reply(messageId: number, dry = false) {
  const { data: m } = await from('messages').select('*').eq('id', messageId).single() as { data: ChatMsg | null };
  if (!m || m.kind !== 'user') return { skipped: 'not a user message' };
  // one answer per question: not twice for the same message, nor for the same words sent twice in a row
  if (!dry) {
    const { data: done } = await from('messages').select('id').eq('reply_to', m.id).limit(1);
    if (done?.length) return { skipped: 'already answered' };
    const { data: twins } = await from('messages').select('id,body').eq('channel', m.channel).eq('team_id', m.team_id).eq('kind', 'user').lt('id', m.id)
      .gt('created_at', new Date(Date.parse(m.created_at) - 120_000).toISOString()).order('id', { ascending: false }).limit(3);
    const same = (twins ?? []).filter((x) => x.body.trim().toLowerCase() === m.body.trim().toLowerCase());
    if (same.length) {
      const { data: answered } = await from('messages').select('id').in('reply_to', same.map((x) => x.id)).limit(1);
      if (answered?.length) return { skipped: 'duplicate question' };
    }
  }
  const out = apiKey ? await converse(m).catch((e) => { console.error('converse', e); return null; }) : null;
  if (dry) return out ?? { skipped: 'model unavailable' };
  let result: unknown;
  if (out) {
    const meta = out.mode === 'roast' || out.mode === 'joke'
      ? { bot: 'garry', type: 'chirp', kind: out.mode, target: out.target_id ?? null, engine: 2 }
      : { bot: 'garry', type: 'reply', topic: out.topic, mode: out.mode, engine: 2 };
    const { error } = await from('messages').insert({ channel: m.channel, kind: 'bot', body: out.reply, reply_to: m.id, meta });
    if (error) throw error;
    result = { replied: true, mode: out.mode, topic: out.topic };
  } else result = await legacyReply(m);
  // then quietly learn from whatever's been said lately
  const learned = await learn().catch((e) => ({ error: String(e) }));
  return { ...(result as object), learned };
}

// a GM's watch list (migration 140), for their private line only: each player, whose roster he's on (or free) and how
// he's doing, so "anyone on my list worth grabbing?" gets a real answer
async function watchFacts(teamId: number, byId: Map<number, Team>) {
  const { data: w } = await from('watchlist').select('player_id').eq('team_id', teamId).order('added_at', { ascending: false }).limit(25);
  const ids = (w ?? []).map((r) => r.player_id as number);
  if (!ids.length) return [];
  const [{ data: ps }, { data: rs }] = await Promise.all([
    from('players').select('id,name,pos,nhl_team,injury_status,proj').in('id', ids),
    from('rosters').select('player_id,team_id').in('player_id', ids),
  ]);
  const own = new Map((rs ?? []).map((r) => [r.player_id as number, r.team_id as number]));
  return (ps ?? []).map((p) => `${p.name} (${p.pos}, ${p.nhl_team ?? 'no club'}, ${own.has(p.id) ? `on ${byId.get(own.get(p.id)!)?.gm_name ?? 'a'}'s team` : 'free agent'}${p.injury_status ? `, ${p.injury_status}` : ''}, projected ${f1(Number(p.proj ?? 0))})`);
}

async function converse(m: ChatMsg) {
  const { teams, byId, standings } = await base();
  const asker = byId.get(m.team_id);
  const lower = m.body.toLowerCase();
  const mentioned = teams.filter((t) => t.id !== m.team_id && (new RegExp(`\\b${esc(t.gm_name.toLowerCase())}\\b`).test(lower) || lower.includes(t.name.toLowerCase())));
  const everyone = /\b(everyone|everybody|every (gm|team|one)|each (gm|team)|the (whole )?league|all (the )?(gms|teams)|all of (us|you))\b/.test(lower);
  const cardIds = everyone ? teams.map((t) => t.id) : [m.team_id, ...mentioned.map((t) => t.id)];
  const { league } = await base();
  const n = L.kind === 'fantasy' && league?.phase === 'season' ? await night(L.db, L.lid, etDate(new Date())).catch(() => null) : null;
  const [st, now, mine, thread, cards, ans, mem] = await Promise.all([
    state(), situation(), recentLines(5),
    from('messages').select('id,team_id,kind,body').eq('channel', m.channel).eq('deleted', false).lte('id', m.id).order('id', { ascending: false }).limit(12),
    L.kind === 'predict' ? Promise.resolve([]) : gmCards(cardIds, byId, standings, n),
    // a pool's facts come from its questions, never from the fantasy answer engine (no NHL slate in a Love Is Blind pool)
    L.kind === 'predict' ? Promise.resolve(null) : answer(facade(), m.body, m.team_id, { plain: true }).catch(() => null),
    recall(byId, [m.team_id, ...mentioned.map((t) => t.id)], 25),
  ]);
  const lines = (thread.data ?? []).reverse().map((x) => `${x.kind === 'bot' ? bot() : byId.get(x.team_id)?.gm_name ?? 'someone'}: ${x.body.replace(/\s+/g, ' ').slice(0, 280)}`);
  const table = [...standings].sort((a, b) => a.rank - b.rank).map((x) => `${x.rank}. ${byId.get(x.team_id)?.gm_name} (${byId.get(x.team_id)?.name}) ${f1(Number(x.points))}`);
  const useful = ans && !['unknown', 'hello', 'chat'].includes(ans.topic);
  const privateLine = m.channel.startsWith('garry:');
  const poolBoard = L.kind === 'predict' ? await poolFacts(m.team_id, byId).catch(() => null) : null;
  const watching = privateLine ? await watchFacts(m.team_id, byId).catch(() => []) : [];
  const prompt = [
    `Right now: ${now}`,
    table.length ? `Where everyone stands: ${table.join(' · ')}` : '',
    mem.length ? `What you remember (use it when it fits, never list it):\n${mem.map((x) => '- ' + x).join('\n')}` : '',
    mine.length ? `Your last few lines in the chat. Do not reuse their openers, closers, jokes, nudges or catchphrases:\n${mine.map((x) => '- ' + x).join('\n')}` : '',
    cards.length ? `The GMs in this conversation (facts you can use):\n${JSON.stringify(cards)}` : '',
    poolBoard ? `The pool's board (facts you can use; a price is the pool's chance, in percent):\n${JSON.stringify(poolBoard)}` : '',
    watching.length ? `${asker?.gm_name}'s watch list, the players they've starred (private to them: fine on this line, never in the league chat): ${watching.join('; ')}` : '',
    useful ? `The site's verified answer to the question (use its facts and keep any "👉 #/..." link that fits, in your own words, not its wording):\n${ans!.text}${Object.keys(ans!.facts ?? {}).length ? `\n${JSON.stringify(ans!.facts).slice(0, 1500)}` : ''}` : '',
    `${privateLine ? `This is ${asker?.gm_name}'s private line to you; nobody else reads it.` : 'This is the league chat; everyone reads it.'} The conversation, oldest first; the last line is ${asker?.gm_name}'s and it's the one you answer:\n${lines.join('\n')}`,
    `Decide what ${asker?.gm_name} wants and reply:
- "answer": a question about the league, a player, a team, the rules or the site. Answer it straight with the real numbers, then one jab.
- "roast": they asked you to trash talk someone, themselves or everyone (then one specific line per GM). ${cap(W().game)} decisions, results, bets and chat only.
- "joke": they want something funny. Make it about this league if you can.
- "banter": anything else: talking to you, about you, at you, or about someone. React like a guy in the room: agree, argue, chirp back, take a side, have an opinion. Never list what you can do.
Lineup advice comes only from a GM's "tonight" facts: name a move only if it's in moves_worth_making; if there are none, they're set, and a player in sitting_with_no_fix is nothing to fix (say so, or chirp the bad luck). Never tell anyone to bench or swap otherwise.
Rules: 1 to 4 sentences (a roast of everyone: one line per GM). Talk to ${asker?.gm_name} about what they said; bring in other GMs only when they asked about them or it's the point. Tag at most two GMs (every @ pings a phone), except in a roast of everyone. Don't run down the standings unless they asked. Read the room: praise for another GM is not a request to roast them, and sarcasm is sarcasm. Use only the facts given and what you remember; if you don't know something, say so in character. No stock openers, nothing from your last few lines, and a nudge only if it fits.
Return JSON only: {"mode": "answer"|"roast"|"joke"|"banter", "target": "<first name of the GM you're roasting, or null>", "reply": "<your message>"}`,
  ].filter(Boolean).join('\n\n');
  const text = await grok(system(st), prompt, everyone ? 1100 : 600, 0.9, true, 'none');
  let j: { mode?: string; target?: string | null; reply?: string } | null = null;
  try { j = JSON.parse(text ?? ''); } catch { j = null; }
  const body = String(j?.reply ?? '').trim();
  if (!body) return null;
  const mode = ['answer', 'roast', 'joke', 'banter'].includes(String(j?.mode)) ? String(j!.mode) : 'banter';
  const target = j?.target ? teams.find((t) => t.gm_name.toLowerCase() === String(j!.target).toLowerCase().replace(/^@/, '')) : undefined;
  return { mode, reply: body.slice(0, everyone ? 2000 : 1200), topic: useful ? ans!.topic : mode, target_id: target?.id ?? null };
}

// the old way, for when the model is unreachable: canned chirps, or the keyword answer with a stock opener
async function legacyReply(m: ChatMsg) {
  const { teams } = await base();
  const intent = chirpIntent(m.body, teams, m.team_id);
  if (intent) return chirp(m, intent);
  const ans = await answer(facade(), m.body, m.team_id);
  const { error } = await from('messages').insert({ channel: m.channel, kind: 'bot', body: ans.text, reply_to: m.id, meta: { bot: 'garry', type: 'reply', topic: ans.topic } });
  if (error) throw error;
  return { replied: true, topic: ans.topic, fallback: true };
}


// ─────────────── keeper report ───────────────
// the scheduler calls with the project's anon key (the legacy JWT with role anon, or a publishable key); the gateway
// has already checked it, so reading the role off it is enough to tell cron from a person's session
function isAnonCaller(token: string) {
  if (!token) return false;
  if (token === ANON_KEY || token.startsWith('sb_publishable_')) return true;
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'anon'; } catch { return false; }
}
// who may run the commissioner's tasks (the keeper report, memory passes, the league column, probes): the commissioner
// of the league the run is scoped to, or whoever holds the platform's admin key (x-admin-key, checked against the
// database). The public anon key alone is not enough: it ships in the site, so anyone has it.
async function callerMayRun(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (key) { const { data } = await db.rpc('admin_key_ok', { p_key: key }); if (data === true) return true; }
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  if (!token || isAnonCaller(token)) return false;
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return false;
  const { data: m } = await db.from('league_members').select('role').eq('user_id', u.user.id).eq('league_id', L.lid).maybeSingle();
  return m?.role === 'commish';
}
// which leagues a request is about: ?league=N, else a signed-in person's active league, else every active league
async function leaguesFor(req: Request, url: URL): Promise<number[]> {
  const asked = Number(url.searchParams.get('league'));
  if (asked > 0) return [asked];
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
  if (token && !isAnonCaller(token)) {
    const { data: u } = await db.auth.getUser(token);
    if (u?.user) {
      const { data: a } = await db.from('accounts').select('active_league_id').eq('user_id', u.user.id).maybeSingle();
      if (a?.active_league_id) return [a.active_league_id];
      const { data: m } = await db.from('league_members').select('league_id').eq('user_id', u.user.id).order('league_id').limit(1).maybeSingle();
      if (m) return [m.league_id];
    }
  }
  // a prediction pool has no games and no hockey to talk about: the scheduled posts are for fantasy leagues
  const { data: all } = await db.from('leagues').select('id').eq('status', 'active').eq('kind', 'fantasy').order('id');
  return (all ?? []).map((l) => l.id);
}

async function keeperReport() {
  const { league, teams, byId } = await base();
  const max = Number(league.keepers ?? 6);
  const { data: rosters } = await from('rosters').select('team_id,player_id,keeper,acquired,prev_fp');
  const rows = rosters ?? [];
  const all: KP[] = [];
  for (let start = 0; start < 20000;) {
    const { data } = await from('players').select('id,name,pos,elig,proj,injury_status,nhl_team').order('id').range(start, start + 999);
    if (!data?.length) break;
    all.push(...data.map((p) => ({ id: p.id, name: p.name, pos: p.pos, elig: p.elig ?? [], proj: Number(p.proj), injury_status: p.injury_status, nhl_team: p.nhl_team })));
    start += data.length;
  }
  const pl = new Map(all.map((p) => [p.id, p]));
  // the banned top scorer per team (highest last-season points, ties to the lower id), and the default keepers
  const banned = new Set<number>();
  if (league.top_scorer_rule) for (const t of teams) {
    const best = rows.filter((r) => r.team_id === t.id && r.prev_fp != null).sort((a, b) => Number(b.prev_fp) - Number(a.prev_fp) || a.player_id - b.player_id)[0];
    if (best) banned.add(best.player_id);
  }
  const finalized = rows.some((r) => r.acquired === 'keeper');
  const keepersOf = (t: number) => {
    const mine = rows.filter((r) => r.team_id === t);
    let ids: number[];
    if (finalized) ids = mine.filter((r) => r.acquired === 'keeper').map((r) => r.player_id);
    else if (mine.some((r) => r.keeper)) ids = mine.filter((r) => r.keeper).map((r) => r.player_id);
    else ids = mine.filter((r) => r.prev_fp != null && !banned.has(r.player_id)).sort((a, b) => Number(b.prev_fp) - Number(a.prev_fp) || a.player_id - b.player_id).slice(0, max).map((r) => r.player_id);
    return ids.map((id) => pl.get(id)).filter(Boolean) as KP[];
  };
  // once keepers are final the released players are back in the pool, so the best possible set is unknowable: treat the keepers as it
  const eligibleOf = (t: number) => finalized ? keepersOf(t) : rows.filter((r) => r.team_id === t && !banned.has(r.player_id)).map((r) => pl.get(r.player_id)).filter(Boolean) as KP[];
  const grades = gradeAllKeepers(teams.map((t) => ({ id: t.id, submitted: !!t.keepers_submitted })), keepersOf, eligibleOf, all, max);
  const table = [...grades.values()].sort((a, b) => a.rank - b.rank);
  const facts = table.map((g) => ({
    team_id: g.team, gm: byId.get(g.team)?.gm_name, team: byId.get(g.team)?.name,
    grade: g.grade, rank_by_keepers: g.rank, projected_points_from_keepers: g.proj, ...(finalized ? {} : { pct_of_best_possible_set: g.efficiency }), starters_filled_of_12: g.filled, gaps: g.gaps, injured: g.injured,
    saved_keepers: g.submitted ? 'yes' : 'no, using the default (top 6 by last season, top scorer excluded)',
    keepers: g.keepers.map((k) => `${k.player.name} (${k.player.pos}, ${k.player.nhl_team}, proj ${Math.round(k.player.proj)}, #${k.posRank} at ${k.player.pos}, ${k.tier}${k.injured ? ', ' + k.player.injury_status : ''})`),
    ...(finalized ? {} : { sent_back_to_pool: g.leftBehind.map((p) => `${p.name} (${Math.round(p.proj)})`) }),
  }));
  let out: { intro?: string; teams?: { team_id: number; take: string }[]; predictions?: { team_id: number; rank: number; line: string }[]; bold?: string } | null = null;
  if (apiKey) {
    const txt = await grok(persona((await state())?.briefing) + `\nYou are writing your keeper report for the league. Stay PG-13, ${W().game} decisions only. Return JSON only.`,
      `Grade and chirp every team's keepers, then predict the final regular-season standings for 2026-27 based on the keepers (the draft hasn't happened; keepers are the core, the draft fills the rest, so a great keeper set is a head start, not a lock).
Return exactly: {"intro": "<2-3 sentences opening the report>", "teams": [{"team_id": <id>, "take": "<2-3 sentences on that GM's keepers: what's strong, what's missing, one chirp; mention a player by name>"}], "predictions": [{"team_id": <id>, "rank": <1-${teams.length}>, "line": "<one short line why>"}], "bold": "<one bold, specific prediction for the season>"}
Every team must appear once in teams and once in predictions with ranks 1..${teams.length}.

Facts (JSON):\n${JSON.stringify(facts)}`, 2200, 0.85, true, 'low');
    try { out = JSON.parse(txt ?? ''); } catch { out = null; }
  }
  const ranksOk = out?.predictions?.length === teams.length && new Set(out!.predictions!.map((p) => p.rank)).size === teams.length && out!.predictions!.every((p) => byId.has(p.team_id));
  const takesOk = out?.teams?.length === teams.length && out!.teams!.every((t) => byId.has(t.team_id) && typeof t.take === 'string');
  const llm = !!(out && ranksOk && takesOk);
  const report = {
    generated_at: new Date().toISOString(), llm,
    intro: llm ? String(out!.intro ?? '') : `Keepers are ${finalized ? 'locked' : 'mostly in'}, so here's the report card before anyone can blame the draft. ${table[0] ? `${byId.get(table[0].team)?.gm_name} kept the best six on paper` : ''}${table.at(-1) ? `; ${byId.get(table.at(-1)!.team)?.gm_name}, we need to talk.` : '.'}`,
    teams: table.map((g) => ({ team_id: g.team, grade: g.grade, take: llm ? out!.teams!.find((t) => t.team_id === g.team)!.take : `${g.grade}: ${g.keepers[0] ? `${g.keepers[0].player.name} carries it` : 'no keepers'}${g.gaps.length ? `, but the draft has to find ${g.gaps.join(', ')}` : ', and the starting lineup is nearly full already'}${!finalized && g.efficiency < 90 ? `. Left ${100 - g.efficiency}% of the possible value on the table.` : '.'}` })),
    predictions: llm ? out!.predictions!.map((p) => ({ team_id: p.team_id, rank: p.rank, line: String(p.line ?? '') })) : table.map((g) => ({ team_id: g.team, rank: g.rank, line: `${g.proj} projected from the keepers, ${g.filled} of 12 starters already filled` })),
    bold: llm ? String(out!.bold ?? '') || null : null,
  };
  const { data: lg } = await from('league').select('info').single();
  await from('league').update({ info: { ...(lg?.info ?? {}), keeper_report: report } });
  const preds = [...report.predictions].sort((a, b) => a.rank - b.rank);
  await post([
    `${L.brand.bot.emoji} ${bot()}'s keeper report is in. Grades: ${table.map((g) => `${byId.get(g.team)?.gm_name} ${g.grade}`).join(' · ')}.`,
    `Predicted finish: ${preds.map((p) => `${p.rank}. ${byId.get(p.team_id)?.gm_name}`).join(', ')}.${report.bold ? ` Bold call: ${report.bold}` : ''}`,
    `Full takes on every team's keepers 👉 #/keepers`,
  ].join('\n'), { type: 'keepers', date: etDate(new Date()) });
  return { posted: true, llm, grades: table.map((g) => ({ team: byId.get(g.team)?.gm_name, grade: g.grade })) };
}

// ─────────────── draft prep nags ───────────────
// the day before and the afternoon of the draft: who hasn't built a queue, turned on alerts, or looked at their
// gaps, with the exact taps to fix it, plus a personal nudge in each slacker's notification bell
async function draftPrep() {
  const { league, teams } = await base();
  const { data: ds } = await from('draft_state').select('season,status').single();
  if (!league.draft_at || ds?.status !== 'scheduled') return { skipped: ds?.status ?? 'no draft' };
  const hours = Math.round((new Date(league.draft_at).getTime() - Date.now()) / 3600000);
  if (hours < 0 || hours > 40) return { skipped: `draft in ${hours}h` };
  const slotKey = hours <= 6 ? 'day' : 'eve';
  if (await alreadyPosted('draftprep', `${ds.season}-${slotKey}`)) return { skipped: 'already posted' };
  const [{ data: queue }, { data: push }, { data: rosters }, { data: picks }, { data: tq }] = await Promise.all([
    from('draft_queue').select('team_id'),
    from('push_subscriptions').select('team_id'),
    from('rosters').select('team_id,player_id'),
    from('draft_picks').select('team_id,overall').eq('season', ds.season).is('player_id', null).not('overall', 'is', null).order('overall'),
    from('teams').select('id,autodraft').eq('role', 'gm'),
  ]);
  const ids = (rosters ?? []).map((r) => r.player_id);
  const { data: ps } = await from('players').select('id,pos,elig,proj').in('id', ids);
  const pl = new Map((ps ?? []).map((p) => [p.id, { id: p.id, pos: p.pos, elig: p.elig ?? [], proj: Number(p.proj) } as GP]));
  const caps = (league.roster ?? { C: 2, LW: 2, RW: 2, D: 3, Util: 1, G: 2 }) as Record<string, number>;
  const gapsOf = (t: number) => {
    const mine = (rosters ?? []).filter((r) => r.team_id === t).map((r) => pl.get(r.player_id)).filter(Boolean) as GP[];
    const by: Record<string, number> = {};
    for (const s of lineupStrength(mine).starters) by[s.slot] = (by[s.slot] ?? 0) + 1;
    return ['C', 'LW', 'RW', 'D', 'Util', 'G'].filter((s) => (by[s] ?? 0) < (caps[s] ?? 0)).map((s) => `${(caps[s] ?? 0) - (by[s] ?? 0)} ${s}`);
  };
  const qCount = new Map<number, number>(), pCount = new Map<number, number>();
  for (const q of queue ?? []) qCount.set(q.team_id, (qCount.get(q.team_id) ?? 0) + 1);
  for (const p of push ?? []) pCount.set(p.team_id, (pCount.get(p.team_id) ?? 0) + 1);
  const auto = new Map((tq ?? []).map((t) => [t.id, !!t.autodraft]));
  const gms = teams.map((t) => ({
    id: t.id, gm: t.gm_name, team: t.name, first_pick: (picks ?? []).find((p) => p.team_id === t.id)?.overall ?? null,
    queue: qCount.get(t.id) ?? 0, alerts_on: (pCount.get(t.id) ?? 0) > 0, autodraft: auto.get(t.id) ?? false, gaps: gapsOf(t.id),
  }));
  const noQueue = gms.filter((g) => g.queue === 0), noAlerts = gms.filter((g) => !g.alerts_on), ready = gms.filter((g) => g.queue > 0 && g.alerts_on);
  const when = new Date(league.draft_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', hour: 'numeric', minute: '2-digit' }) + ' ET';
  const facts = { draft_at: when, hours_to_draft: hours, slot: slotKey, pick_seconds: league.pick_seconds, rounds: league.draft_rounds, gms,
    how_to: { queue: 'Draft tab, star players (or the star on the cheat sheet at #/draft/sheet); autodraft takes the top of the queue when you are away', alerts: `My Profile, Alerts, Turn on alerts; iPhone: add ${L.info.short_name} to the Home Screen first`, cheat_sheet: 'More menu, Draft cheat sheet: your gaps, the best 10 at each, and the odds each lasts to your pick', call: 'Draft page, Join the call; the first one in signs in with Google or GitHub' } };
  const fallback = [
    `📋 ${hours <= 6 ? `Draft night. ${hours} hours.` : `Draft eve, boys. ${when}, ${league.pick_seconds} seconds a pick.`}`,
    noQueue.length ? `No queue yet: ${noQueue.map((g) => '@' + g.gm).join(', ')}. If your phone dies, the robot picks off projections instead of your list. Draft tab, star 15 guys. Two minutes.` : 'Everyone has a queue. Who are you people.',
    noAlerts.length ? `No alerts: ${noAlerts.map((g) => '@' + g.gm).join(', ')}. You will not know you are on the clock. My Profile, Alerts, turn them on (iPhone: Home Screen first).` : '',
    `Cheat sheet is live: your gaps, best 10 at each, and the odds each one lasts to your pick 👉 #/draft/sheet`,
    ready.length ? `Gold stars for ${ready.map((g) => g.gm).join(', ')}: queue built, alerts on. Dangerous.` : '',
    `Join the call from the Draft page. First one in signs in and opens the room. Somebody put coins on who goes #1.`,
  ].filter(Boolean).join('\n');
  const body = await write(`Write the ${slotKey === 'day' ? 'draft day' : 'draft eve'} post for the league chat: hype the room, then name exactly who has no draft queue and who has no alerts, with the taps to fix each (from how_to), and one line each on the GMs who are ready. Mention the cheat sheet with its link and the call. Keep every "👉 #/..." link.`, facts, fallback, 220, teams.map((t) => t.id));
  await post(body, { type: 'draftprep', date: `${ds.season}-${slotKey}` });
  // and a personal nudge in the bell for anyone missing something
  const notes = gms.filter((g) => g.queue === 0 || !g.alerts_on).map((g) => ({
    team_id: g.id, kind: 'draftprep', link: g.queue === 0 ? '/draft/sheet' : '/profile',
    body: `📋 Draft in ${hours}h. ${g.queue === 0 ? 'Your queue is empty: star your targets so autodraft has a list. ' : ''}${!g.alerts_on ? 'Alerts are off: turn them on so you know when you are on the clock.' : ''}`.trim(),
  }));
  if (notes.length) await from('notifications').insert(notes);
  return { posted: slotKey, no_queue: noQueue.map((g) => g.gm), no_alerts: noAlerts.map((g) => g.gm) };
}

// ─────────────── draft recap ───────────────
async function draftRecap() {
  const { teams, byId } = await base();
  const { data: ds } = await from('draft_state').select('season,status').single();
  if (ds?.status !== 'done') return { skipped: 'draft not finished' };
  if (await alreadyPosted('draft', ds.season)) return { skipped: 'already posted' };
  const [{ data: picks }, { data: kept }] = await Promise.all([
    from('draft_picks').select('overall,round,team_id,player_id,auto').eq('season', ds.season).not('player_id', 'is', null).order('overall'),
    from('rosters').select('team_id,player_id').eq('acquired', 'keeper'),
  ]);
  const ids = [...new Set([...(picks ?? []).map((p) => p.player_id), ...(kept ?? []).map((k) => k.player_id)])];
  const pl = new Map<number, GP & { name: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await from('players').select('id,name,pos,elig,proj').in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) pl.set(p.id, { ...p, proj: Number(p.proj) });
  }
  // everyone not kept, ranked by projection, is where a player "should" have gone
  const keptIds = new Set((kept ?? []).map((k) => k.player_id));
  const { data: poolRows } = await from('players').select('id').order('proj', { ascending: false }).limit(400);
  const poolRank = new Map((poolRows ?? []).filter((r) => !keptIds.has(r.id)).map((r, i) => [r.id, i + 1]));
  const byTeam = new Map<number, (GP & { name: string })[]>(teams.map((t) => [t.id, []]));
  for (const k of kept ?? []) { const p = pl.get(k.player_id); if (p) byTeam.get(k.team_id)?.push(p); }
  for (const k of picks ?? []) { const p = pl.get(k.player_id); if (p) byTeam.get(k.team_id)?.push(p); }
  const grades = [...gradeTeams(byTeam).values()].sort((a, b) => a.rank - b.rank);
  const vals = (picks ?? []).map((k) => ({ gm: byId.get(k.team_id)?.gm_name, player: pl.get(k.player_id)?.name, overall: k.overall, auto: k.auto, value: k.overall - (poolRank.get(k.player_id) ?? k.overall) }));
  const steal = [...vals].sort((a, b) => b.value - a.value)[0];
  const reach = [...vals].filter((v) => v.overall <= 48).sort((a, b) => a.value - b.value)[0];
  const autos = teams.map((t) => ({ gm: t.gm_name, n: (picks ?? []).filter((k) => k.team_id === t.id && k.auto).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const facts = {
    season: ds.season,
    grades: grades.map((g) => ({ gm: byId.get(g.team)?.gm_name, team: byId.get(g.team)?.name, grade: g.grade, rank: g.rank, projected_starter_points: Math.round(g.starterPts) })),
    first_overall: vals[0], steal_of_the_draft: steal, biggest_reach: reach, most_autopicks: autos[0] ?? null,
  };
  const top = grades[0], low = grades[grades.length - 1];
  const g = (t: number) => byId.get(t)!;
  const fallback = [
    `🏁 Draft's done and ${bot()}'s got the red pen out. Report cards:`,
    ...grades.map((x) => `${x.grade.padEnd(2)} @${g(x.team).gm_name} (${g(x.team).name})`),
    steal ? `🥷 Steal of the draft: ${steal.player} at #${steal.overall} to @${steal.gm}.` : '',
    reach ? `🚨 Reach of the night: ${reach.player} at #${reach.overall}, @${reach.gm}. Bold.` : '',
    autos[0] ? `🤖 @${autos[0].gm} let the robot make ${autos[0].n} pick${autos[0].n > 1 ? 's' : ''}. Hope it was a good date.` : '',
    `@${g(top.team).gm_name} is the paper champ. @${g(low.team).gm_name}, the season is long, bud. Set those lineups, and someone put coins on it.`,
  ].filter(Boolean).join('\n');
  const body = await write('Write the post-draft report card for the league chat: give every GM their letter grade (use the grades given, in rank order, one short line each), crown the steal of the draft, roast the biggest reach, and hype the season opener.', facts, fallback, 260);
  await post(body, { type: 'draft', date: ds.season });
  return { posted: true, grades: facts.grades.length };
}

// ─────────────── weekly awards + power rankings ───────────────
// Monday-to-Sunday week that ended yesterday; power rank = 60% last-14-day pace, 40% season standing
async function weekly() {
  const { league, teams, byId, standings } = await base();
  if (league.phase !== 'season') return { skipped: league.phase };
  const end = etDate(new Date(Date.now() - 86400000));
  const start = etDate(new Date(Date.now() - 7 * 86400000));
  const start14 = etDate(new Date(Date.now() - 14 * 86400000));
  if (await alreadyPosted('weekly', end)) return { skipped: 'already posted' };
  const { data: daily } = await from('team_daily').select('team_id,date,points').gte('date', start14).lte('date', end);
  const week = (daily ?? []).filter((d) => d.date >= start);
  if (week.length === 0) return { skipped: 'no games last week' };
  const sum = (rows: { team_id: number; points: number }[]) => {
    const m = new Map<number, number>(teams.map((t) => [t.id, 0]));
    for (const r of rows) m.set(r.team_id, (m.get(r.team_id) ?? 0) + Number(r.points));
    return m;
  };
  const wk = sum(week), two = sum(daily ?? []);
  const table = teams.map((t) => ({ team_id: t.id, gm: t.gm_name, team: t.name, points: Math.round((wk.get(t.id) ?? 0) * 10) / 10 })).sort((a, b) => b.points - a.points);
  const best = table[0], worst = table[table.length - 1];

  // player of the week: most points while starting for someone
  const { data: snaps } = await from('lineup_snapshots').select('team_id,player_id,game_id,slot').gte('date', start).lte('date', end).not('slot', 'in', '("BN","IR")');
  const ids = [...new Set((snaps ?? []).map((s) => s.player_id))];
  const byPlayer = new Map<number, { pts: number; team: number }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: pgs } = await from('player_games').select('player_id,game_id,fpts').gte('date', start).lte('date', end).in('player_id', ids.slice(i, i + 300));
    for (const g of pgs ?? []) {
      const s = (snaps ?? []).find((x) => x.player_id === g.player_id && x.game_id === g.game_id);
      if (!s) continue;
      const cur = byPlayer.get(g.player_id) ?? { pts: 0, team: s.team_id };
      byPlayer.set(g.player_id, { pts: cur.pts + Number(g.fpts), team: s.team_id });
    }
  }
  const topId = [...byPlayer.entries()].sort((a, b) => b[1].pts - a[1].pts)[0];
  let star: { player: string; gm: string | undefined; points: number } | null = null;
  if (topId) {
    const { data: p } = await from('players').select('name').eq('id', topId[0]).single();
    star = { player: p?.name ?? '?', gm: byId.get(topId[1].team)?.gm_name, points: Math.round(topId[1].pts * 10) / 10 };
  }

  // a head-to-head league (migrations 118, 120, 121): the week's results lead the column, and the season rank is the
  // W-L-T table, not the points table
  let h2h: { results: { home: string | undefined; home_pts: string; away: string | undefined; away_pts: string; winner: string | undefined; margin: string }[]; playoff: boolean; table: { team_id: number; rank: number; w: number; l: number; t: number }[] } | null = null;
  if (league.format === 'h2h') {
    const cats = !!league.categories?.length;
    const sc = (v: unknown) => (cats ? String(Math.round(Number(v ?? 0))) : f1(Number(v ?? 0)));
    const [{ data: ms }, { data: tbl }, { data: br }] = await Promise.all([
      L.db.rpc('h2h_scores'), L.db.rpc('h2h_standings'),
      Number(league.h2h_playoffs ?? 0) >= 2 ? L.db.rpc('h2h_bracket') : Promise.resolve({ data: [] as unknown[] }),
    ]);
    type Row = { home: number; away: number | null; hp: number; ap: number | null };
    // every week that ended in the column's seven days: a season's last week can end on any day, not only a Sunday
    const reg: Row[] = ((ms ?? []) as any[]).filter((m) => m.ends >= start && m.ends <= end && m.status === 'final' && m.away_team != null)
      .map((m) => ({ home: m.home_team, away: m.away_team, hp: Number(m.home_pts), ap: Number(m.away_pts) }));
    const po: Row[] = ((br ?? []) as any[]).filter((g) => g.ends >= start && g.ends <= end && g.status === 'final' && g.low_team != null)
      .map((g) => ({ home: g.high_team, away: g.low_team, hp: Number(g.high_pts), ap: Number(g.low_pts) }));
    const rows = reg.length ? reg : po;
    h2h = {
      playoff: !reg.length && po.length > 0,
      results: rows.map((r) => {
        const homeWon = r.hp > (r.ap ?? 0) || (po.length > 0 && !reg.length && r.hp === r.ap);   // a playoff tie goes to the higher seed
        return { home: byId.get(r.home)?.gm_name, home_pts: sc(r.hp), away: byId.get(r.away!)?.gm_name, away_pts: sc(r.ap),
          winner: r.hp === r.ap && reg.length ? undefined : byId.get(homeWon ? r.home : r.away!)?.gm_name, margin: sc(Math.abs(r.hp - (r.ap ?? 0))) };
      }),
      table: ((tbl ?? []) as any[]).map((t) => ({ team_id: t.team_id, rank: t.rank, w: t.w, l: t.l, t: t.t })),
    };
  }

  // lineup management (migration 133): each team's lineups against the best it could have played from the same
  // players, night by night; the sharpest and the one who left the most out
  const { data: effRows } = await L.db.rpc('lineup_efficiency', { p_from: start, p_to: end });
  const effBy = new Map<number, { pts: number; best: number }>();
  for (const r of (effRows ?? []) as { team_id: number; points: number; best: number }[]) {
    const e = effBy.get(r.team_id) ?? { pts: 0, best: 0 };
    e.pts += Number(r.points); e.best += Number(r.best); effBy.set(r.team_id, e);
  }
  const effTable = [...effBy.entries()].filter(([id, e]) => byId.has(id) && e.best > 0)
    .map(([id, e]) => ({ gm: byId.get(id)?.gm_name, pct: Math.round((e.pts / e.best) * 100), left_out: Math.round((e.best - e.pts) * 10) / 10 }))
    .sort((a, b) => b.pct - a.pct || a.left_out - b.left_out);
  const lineups = effTable.length >= 2 && effTable[0].pct > effTable[effTable.length - 1].pct
    ? { sharpest: effTable[0], most_left_out: [...effTable].sort((a, b) => b.left_out - a.left_out)[0] } : null;

  // power rankings, with movement since last Monday's column
  const n = teams.length;
  // the season rank is the table the league plays for: W-L-T in head-to-head, roto points in rotisserie, else points
  const roto = !h2h && league.categories?.length ? (((await L.db.rpc('category_standings')).data ?? []) as any[]) : [];
  const seasonRank = new Map(h2h?.table.length ? h2h.table.map((s) => [s.team_id, Number(s.rank)])
    : roto.length ? roto.map((s) => [s.team_id, Number(s.rank)]) : standings.map((s) => [s.team_id, Number(s.rank)]));
  const paceRank = new Map([...two.entries()].sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
  const score = (id: number) => 0.6 * (paceRank.get(id) ?? n) + 0.4 * (seasonRank.get(id) ?? n);
  const { data: prevMsg } = await from('messages').select('meta').eq('kind', 'bot').contains('meta', { type: 'weekly' }).order('id', { ascending: false }).limit(1);
  const prev = new Map<number, number>(((prevMsg?.[0]?.meta as { rankings?: { team_id: number; rank: number }[] })?.rankings ?? []).map((r) => [r.team_id, r.rank]));
  const rankings = teams.map((t) => ({ team_id: t.id, s: score(t.id) })).sort((a, b) => a.s - b.s)
    .map((r, i) => ({ team_id: r.team_id, rank: i + 1, prev: prev.get(r.team_id) ?? null, gm: byId.get(r.team_id)?.gm_name, team: byId.get(r.team_id)?.name,
      last14: Math.round((two.get(r.team_id) ?? 0) * 10) / 10, season_rank: seasonRank.get(r.team_id) ?? null }));
  const arrow = (r: { rank: number; prev: number | null }) => r.prev == null ? 'new' : r.prev > r.rank ? `▲${r.prev - r.rank}` : r.prev < r.rank ? `▼${r.rank - r.prev}` : '–';

  await from('coin_ledger').insert({ team_id: best.team_id, amount: WEEKLY_BONUS, reason: `${bot()}'s Team of the Week (${start} to ${end})` });
  await from('notifications').insert({ team_id: best.team_id, kind: 'weekly', body: `🏆 Team of the Week! ${f1(best.points)} points and ${WEEKLY_BONUS} ${coin().emoji} coins from ${bot()}`, link: '/chat' });

  const facts = { week: { start, end }, week_table: table, team_of_the_week: { ...best, coins: WEEKLY_BONUS }, bust_of_the_week: worst, player_of_the_week: star,
    power_rankings: rankings.map((r) => ({ rank: r.rank, gm: r.gm, team: r.team, move: arrow(r), last_14_days: r.last14, season_rank: r.season_rank })),
    ...(lineups ? { lineup_management: { note: 'share of the best lineup possible each night from the same players', ...lineups } } : {}),
    ...(h2h ? { format: league.categories?.length ? 'head-to-head, categories won' : 'head-to-head, points',
      [h2h.playoff ? 'playoff_results' : 'matchup_results']: h2h.results,
      records: h2h.table.map((t) => ({ gm: byId.get(t.team_id)?.gm_name, record: `${t.w}-${t.l}-${t.t}`, rank: t.rank })) } : {}) };
  const resultsLine = h2h?.results.length
    ? `${h2h.playoff ? '🏒 Playoffs' : '⚔️ Results'}: ${h2h.results.map((r) => r.winner ? `@${r.winner} won ${r.winner === r.home ? `${r.home_pts}-${r.away_pts} over @${r.away}` : `${r.away_pts}-${r.home_pts} over @${r.home}`}` : `@${r.home} and @${r.away} tied at ${r.home_pts}`).join('; ')}.`
    : '';
  const fallback = [
    `📰 ${bot()}'s Monday column, week of ${start}.`,
    resultsLine,
    `🏆 Team of the Week: @${best.gm} (${best.team}) with ${f1(best.points)}. That's ${WEEKLY_BONUS} ${coin().emoji} coins, don't spend them all on one bet.`,
    `🪣 Bust of the Week: @${worst.gm} with ${f1(worst.points)}. ${pick(['Was the lineup even set?', 'The bench outscored the starters, probably.', 'Tough week. Tougher chat.'])}`,
    star ? `⭐ Player of the Week: ${star.player} (${f1(star.points)}) for @${star.gm}.` : '',
    lineups ? `🧠 Sharpest lineups: @${lineups.sharpest.gm} at ${lineups.sharpest.pct}% of the best possible. Most left out: @${lineups.most_left_out.gm}, ${f1(lineups.most_left_out.left_out)} points short of their best lineups.` : '',
    `Power rankings: ${rankings.map((r) => `${r.rank}. ${r.gm} (${arrow(r)})`).join(' · ')}.`,
    pick(['Trade deadline energy, please. Somebody make an offer.', 'Put some coins on next week\'s Team of the Week.', `Set your lineups. ${bot()} is watching.`]),
  ].filter(Boolean).join('\n');
  const body = await write(`Write your Monday column for the league chat: ${h2h?.results.length ? `lead with the week's head-to-head ${h2h.playoff ? 'playoff ' : ''}results (every matchup: who beat whom and by how much, a tie as a tie), then ` : ''}Team of the Week (and their coin bonus), Bust of the Week, Player of the Week, ${lineups ? 'one line on lineup management (the sharpest manager and who left the most points out, from lineup_management), ' : ''}then the power rankings as a numbered list with the movement arrows given. One dry line per team.`, facts, fallback, (h2h?.results.length ? 340 : 260) + (lineups ? 40 : 0));
  await post(body, { type: 'weekly', date: end, rankings: rankings.map((r) => ({ team_id: r.team_id, rank: r.rank, prev: r.prev })), team_of_week: best.team_id });
  return { posted: 'weekly', team_of_week: best.gm, star };
}

// ─────────────── the Book's private line ───────────────
// A GM asks what to bet on. Garry reads the board (what's open, who's on it, what closes soon), how this GM bets
// (their tickets so far), the Book's own suggestions, and answers with a few picks: tickets on open markets, and
// markets worth asking the Book to open. Nothing is placed or opened here; the site turns each pick into a tap.
type BookMsg = { role: 'user' | 'assistant'; content: string };
type BookPick = { market_id: number; pick: string; why: string };
type BookRequest = Record<string, unknown> & { why?: string };
const TEMPLATES_SPEC = `New markets a GM can ask the Book to open (a "request"), as JSON objects:
- {"template":"game","bet":"winner"|"total"|"ot","game_id":<id from upcoming_games>}  a game later in the week (not tonight's)
- {"template":"player_race","stat":"g"|"a"|"pts"|"sog"|"hit"|"blk"|"ppp"|"fpts" (goalies: "w"|"sv"|"sho"|"fpts"),"players":[2 to 8 player ids],"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}  most of a stat over a window; add "field": true (and "pos": "S"|"G"|"D") to run one or more players against the rest of the league
- {"template":"player_line","stat":<as above>,"player_id":<id>,"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}  over/under the Book's number
- {"template":"club_race","what":"points","clubs":[2 to 8 NHL abbrevs],"from":"YYYY-MM-DD","to":"YYYY-MM-DD"}  most standings points over a window
- {"template":"club_race","what":"division"|"conference"|"president"|"cup","clubs":[1 to 8 abbrevs]}  a season-long race (the rest of the group is "the field"); one club is "that club or the field", e.g. Oilers to win the Cup
- {"template":"club_race","what":"playoffs","clubs":[<one abbrev>]}  in or out of the playoffs
- {"template":"club_line","club":<abbrev>}  a club's season points over/under`;

async function bookChat(me: { id: number; gm_name: string }, token: string, messages: BookMsg[]) {
  const asked = messages.filter((m) => m.role === 'user').slice(-1)[0]?.content?.trim() ?? '';
  const today = ((await db.rpc('today_et')).data as string | null) ?? etDate(new Date());
  // reads as the GM, in this run's league, so the Book's own functions see the right board
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}`, 'x-league': String(L.lid) } }, auth: { persistSession: false } });
  const [{ data: open }, { data: mine }, { data: bal }, { data: stand }, sugg, { data: games }, { byId }] = await Promise.all([
    from('markets').select('id,kind,title,options,closes_at,created_by,subject,game_id,date').eq('status', 'open').gt('closes_at', new Date().toISOString()).order('closes_at').limit(80),
    from('market_bets').select('market_id,pick,coins,odds,payout,created_at').eq('team_id', me.id).order('id', { ascending: false }).limit(60),
    from('coin_balances').select('balance,escrow').eq('team_id', me.id).maybeSingle(),
    from('book_standings').select('*').eq('team_id', me.id).maybeSingle(),
    asUser.rpc('book_suggestions').then((r) => (r.data ?? []) as Record<string, unknown>[]),
    db.from('games').select('id,date,home,away,start_utc').gt('date', today).lte('date', addDaysIso(today, 7)).eq('game_type', 2).in('state', ['FUT', 'PRE']).order('start_utc'),
    base(),
  ]);
  const ids = (open ?? []).map((m) => m.id);
  const { data: tix } = ids.length ? await from('market_bets').select('market_id,team_id,pick,coins').in('market_id', ids) : { data: [] as any[] };
  const backers = new Map<number, { n: number; coins: number; gms: string[] }>();
  for (const t of tix ?? []) { const b = backers.get(t.market_id) ?? { n: 0, coins: 0, gms: [] }; b.n++; b.coins += t.coins; const g = byId.get(t.team_id)?.gm_name; if (g && !b.gms.includes(g)) b.gms.push(g); backers.set(t.market_id, b); }
  // what this GM likes: kinds, stakes, clubs and players they keep backing, their record
  const settledMine = (mine ?? []).filter((t) => t.payout != null);
  const titles = new Map((open ?? []).map((m) => [m.id, m.title]));
  const { data: pastMk } = (mine ?? []).length ? await from('markets').select('id,kind,title,subject,winner_key').in('id', [...new Set((mine ?? []).map((t) => t.market_id))]) : { data: [] as any[] };
  const kindOf = new Map((pastMk ?? []).map((m) => [m.id, m.kind]));
  const kinds: Record<string, number> = {};
  for (const t of mine ?? []) { const k = kindOf.get(t.market_id) ?? '?'; kinds[k] = (kinds[k] ?? 0) + 1; }
  const profile = {
    gm: me.gm_name, tickets: (mine ?? []).length, wins: settledMine.filter((t) => (t.payout ?? 0) > t.coins).length, settled: settledMine.length,
    avg_stake: (mine ?? []).length ? Math.round((mine ?? []).reduce((s, t) => s + t.coins, 0) / (mine ?? []).length) : null,
    kinds_bet_most: Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ×${n}`),
    recent: (mine ?? []).slice(0, 8).map((t) => `${(pastMk ?? []).find((m) => m.id === t.market_id)?.title ?? titles.get(t.market_id) ?? '?'} · ${t.pick} · ${t.coins} coins @ ${t.odds}${t.payout == null ? '' : (t.payout ?? 0) > t.coins ? ' · won' : t.payout === t.coins ? ' · void' : ' · lost'}`),
    coins_available: bal ? bal.balance - bal.escrow : null, lifetime_net: stand?.net ?? 0,
  };
  const board = (open ?? []).map((m) => ({
    market_id: m.id, kind: m.kind, title: m.title, closes_at: m.closes_at, asked_for_by: m.created_by ? byId.get(m.created_by)?.gm_name ?? null : null,
    options: (m.options as { key: string; label: string; odds: number }[]).map((o) => `${o.key}: ${o.label} @ ${o.odds}`),
    backers: backers.get(m.id)?.n ?? 0, coins_riding: backers.get(m.id)?.coins ?? 0, gms_on_it: backers.get(m.id)?.gms ?? [],
    mine: (mine ?? []).filter((t) => t.market_id === m.id).map((t) => `${t.pick} ${t.coins}`),
  }));
  const facts = {
    today, asker: profile, open_markets: board,
    book_suggestions: sugg.map((x) => ({ request: Object.fromEntries(Object.entries(x).filter(([k]) => !['label', 'why', 'group'].includes(k))), label: x.label, why: x.why })),
    upcoming_games: (games ?? []).slice(0, 40).map((g) => `${g.id}: ${g.away} @ ${g.home} on ${g.date}`),
    conversation: messages.slice(-8),
  };
  const fallback = () => {
    const hot = [...board].filter((m) => !m.mine.length).sort((a, b) => b.backers - a.backers || b.coins_riding - a.coins_riding || a.closes_at.localeCompare(b.closes_at)).slice(0, 3);
    const picks: BookPick[] = hot.map((m) => ({ market_id: m.market_id, pick: m.options[0].split(':')[0], why: m.backers ? `${m.backers} ticket${m.backers > 1 ? 's' : ''} on it already${m.gms_on_it.length ? ` (${m.gms_on_it.slice(0, 3).join(', ')})` : ''}` : 'closes soonest, nobody has touched it' }));
    const requests = sugg.slice(0, 2).map((x) => ({ ...Object.fromEntries(Object.entries(x).filter(([k]) => !['label', 'group'].includes(k))) }));
    return { reply: `@${me.gm_name} ${hot.length ? `Here's where the action is: ${hot.map((m) => m.title).join('; ')}. ` : 'The board is quiet. '}${requests.length ? 'Or ask the Book for one of these and start your own.' : ''} Pick something, you're not here to browse.`, picks, requests };
  };
  let out: { reply: string; picks: BookPick[]; requests: BookRequest[] } | null = null;
  if (apiKey) {
    const st = await state();
    const mem = await recall(byId, [me.id], 20);
    const system = [persona(st?.briefing),
      `\nRight now you are the Book's bet advisor on a GM's private line (not the league chat). Recommend bets. Rules:
- Use only the open_markets given, by market_id, with a pick that is one of that market's option keys. Never invent a market, a player, a game or odds.
- Suggest a new market (a "request") only from book_suggestions or by filling a template exactly (see spec); the Book will price it before the GM sees odds. You are the bet builder: when the GM describes a bet in words (a club to win the Cup, two players racing, a player over a number this month), build the request that matches. If the house already has it on the board (the Stanley Cup, the Presidents' Trophy, the division winners, the Art Ross, the Rocket Richard, most wins, top defenceman), point at that market instead with a pick.
- Read the asker's profile: favour what they ask for, then what fits how they bet, then what's hot (most backers, most coins riding, closing soon). Mention who else is on a market when it's a reason.
- 2 to 4 picks, 0 to 2 requests. One short reason each (${W().game} reasons, odds, who's on it). Reply in 1-4 sentences in your voice, no lists in the reply text (the picks render as cards).
- Return JSON only: {"reply": "...", "picks": [{"market_id": 123, "pick": "home", "why": "..."}], "requests": [{"template": "...", ..., "why": "..."}]}
${TEMPLATES_SPEC}`,
      mem.length ? `\nWhat you remember about this GM and the league:\n${mem.map((m) => '- ' + m).join('\n')}` : ''].join('\n');
    const text = await grok(system, `The GM says: "${asked || 'What should I bet on?'}"\n\nFacts (JSON):\n${JSON.stringify(facts)}`, 1400, 0.7, true);
    try {
      const j = JSON.parse(text ?? '');
      if (j && typeof j.reply === 'string') out = { reply: j.reply, picks: Array.isArray(j.picks) ? j.picks : [], requests: Array.isArray(j.requests) ? j.requests : [] };
    } catch { out = null; }
  }
  const fromModel = !!out;
  if (!out) out = fallback();
  // keep only picks that exist on the board, with a real option
  const byMarket = new Map((open ?? []).map((m) => [m.id, m]));
  const picks = out.picks.filter((p) => p && byMarket.has(Number(p.market_id)) && (byMarket.get(Number(p.market_id))!.options as { key: string }[]).some((o) => o.key === p.pick))
    .slice(0, 4).map((p) => { const m = byMarket.get(Number(p.market_id))!; const o = (m.options as { key: string; label: string; odds: number }[]).find((x) => x.key === p.pick)!;
      return { market_id: m.id, pick: p.pick, why: String(p.why ?? '').slice(0, 200), title: m.title, kind: m.kind, label: o.label, odds: Number(o.odds), closes_at: m.closes_at, backers: backers.get(m.id)?.n ?? 0 }; });
  // into the prediction log (migration 123): each pick against the chance its odds give it, once per market and option,
  // scored when the market settles. A log that can't be written never holds up the answer.
  if (picks.length) {
    await db.from('predictions').upsert(picks.map((p) => ({
      league_id: L.lid, kind: 'garry_pick', subject: { market_id: p.market_id, pick: p.pick }, predicted: Math.round(1000 / p.odds) / 1000,
      basis: fromModel ? 'garry' : 'garry fallback', resolves_on: etDate(new Date(p.closes_at)),
    })), { onConflict: 'league_id,kind,subject', ignoreDuplicates: true }).then(({ error }) => { if (error) console.error('garry_pick log', error.message); }, () => {});
  }
  // price the requests as the GM would see them; drop what the Book won't take
  const requests: { request: Record<string, unknown>; why: string; preview: unknown }[] = [];
  for (const r of out.requests.slice(0, 3)) {
    if (!r || typeof r !== 'object' || !r.template) continue;
    const { why, label: _l, group: _g, ...request } = r as Record<string, unknown>;
    const { data: pv, error } = await asUser.rpc('preview_market', { p: request });
    if (error || !pv) { console.log('book preview', error?.message); continue; }
    requests.push({ request, why: String(why ?? '').slice(0, 200), preview: pv });
    if (requests.length >= 2) break;
  }
  return { reply: out.reply.slice(0, 900), picks, requests, llm: !!apiKey };
}
const addDaysIso = (d: string, n: number) => new Date(new Date(d + 'T12:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);

// ─────────────── moments ───────────────
// Unprompted, straight from the data: an approved trade, a hat trick by someone's starter (or one wasted on a bench),
// a monster night, a new leader. At most two a league day, each called out once. The cron looks every half hour;
// the reads are cheap and the model only runs when there's something to post.
const MOMENTS_PER_DAY = 2;
const BIG_NIGHT = 30;   // fantasy points by one team in one night
type Moment = { key: string; task: string; facts: Record<string, unknown>; fallback: string; focus: number[] };
async function moments() {
  const { league, byId, standings } = await base();
  if (league.phase !== 'season') return { skipped: league.phase };
  const day = ((await db.rpc('today_et')).data as string | null) ?? etDate(new Date());
  const { data: already } = await from('messages').select('id').eq('kind', 'bot').contains('meta', { bot: 'garry', type: 'moment', date: day });
  if ((already ?? []).length >= MOMENTS_PER_DAY) return { skipped: 'enough for today' };
  const posted = async (key: string) => { const { data } = await from('messages').select('id').eq('kind', 'bot').contains('meta', { type: 'moment', key }).limit(1); return !!data?.length; };
  const st = await state();
  const cur = { ...(st?.moments ?? {}) } as { leader?: number; trade_seen?: number };
  const gm = (id: number) => byId.get(id)?.gm_name ?? 'someone';
  let pick: Moment | null = null;

  // an approved trade (the first look only notes where the log is, so nothing old gets called out)
  const { data: trades } = await from('trades').select('id,from_team,to_team').eq('status', 'approved').order('id', { ascending: false }).limit(5);
  if (cur.trade_seen == null) cur.trade_seen = Math.max(0, ...(trades ?? []).map((t) => t.id));
  const fresh = (trades ?? []).filter((t) => t.id > (cur.trade_seen ?? 0)).sort((a, b) => a.id - b.id)[0];
  if (fresh) {
    cur.trade_seen = fresh.id;
    const { data: items } = await db.from('trade_items').select('from_team,player_id,pick_id,pickups,coins').eq('trade_id', fresh.id);
    const pids = (items ?? []).map((i) => i.player_id).filter(Boolean);
    const { data: ps } = pids.length ? await from('players').select('id,name,pos,nhl_team,proj').in('id', pids) : { data: [] as any[] };
    const nm = new Map((ps ?? []).map((p) => [p.id, `${p.name} (${p.pos}, ${p.nhl_team}, projected ${Math.round(Number(p.proj))})`]));
    const sends = (t: number) => (items ?? []).filter((i) => i.from_team === t).map((i) => i.player_id ? nm.get(i.player_id) : i.pick_id ? 'a draft pick' : i.pickups ? `${i.pickups} pickup(s)` : `${i.coins} coins`).join(', ') || 'nothing';
    pick = {
      key: `trade:${fresh.id}`, focus: [fresh.from_team, fresh.to_team],
      task: 'A trade just went through. Give the league your instant take in 2 or 3 sentences: who won it and why, and a jab at whoever got fleeced.',
      facts: { gm_a: gm(fresh.from_team), a_sends: sends(fresh.from_team), gm_b: gm(fresh.to_team), b_sends: sends(fresh.to_team) },
      fallback: `🤝 Trade's through: @${gm(fresh.from_team)} sends ${sends(fresh.from_team)} to @${gm(fresh.to_team)} for ${sends(fresh.to_team)}. Somebody got fleeced. 👉 #/trades`,
    };
  }
  // a hat trick: hype it for a starter, rub it in when it sat on a bench
  if (!pick) {
    const { data: snaps } = await from('lineup_snapshots').select('team_id,player_id,slot,game_id').eq('date', day);
    const ids = [...new Set((snaps ?? []).map((x) => x.player_id))];
    const { data: pgs } = ids.length ? await from('player_games').select('player_id,game_id,fpts,stats').eq('date', day).in('player_id', ids) : { data: [] as any[] };
    for (const h of (pgs ?? []).filter((g) => Number(g.stats?.g ?? 0) >= 3)) {
      const sn = (snaps ?? []).find((x) => x.player_id === h.player_id && x.game_id === h.game_id);
      const key = `hat:${h.player_id}:${h.game_id}`;
      if (!sn || await posted(key)) continue;
      const { data: p } = await from('players').select('name,nhl_team').eq('id', h.player_id).single();
      const benched = ['BN', 'IR'].includes(sn.slot);
      pick = benched
        ? { key, focus: [sn.team_id], task: `${p?.name} just scored a hat trick on ${gm(sn.team_id)}'s bench, where it counts for nothing. Rub it in, 1 or 2 sentences.`,
            facts: { gm: gm(sn.team_id), player: p?.name, club: p?.nhl_team, goals: h.stats.g, points_wasted: Number(h.fpts) },
            fallback: `🎩 ${p?.name} has ${h.stats.g} goals tonight on @${gm(sn.team_id)}'s BENCH. ${f1(Number(h.fpts))} points, none of them counting.` }
        : { key, focus: [sn.team_id], task: `A hat trick for ${gm(sn.team_id)}'s starter ${p?.name}. Hype it in 1 or 2 sentences and say what it does to the race.`,
            facts: { gm: gm(sn.team_id), player: p?.name, club: p?.nhl_team, goals: h.stats.g, fantasy_points: Number(h.fpts) },
            fallback: `🎩 Hats on the ice for ${p?.name}: ${h.stats.g} goals and ${f1(Number(h.fpts))} points for @${gm(sn.team_id)}.` };
      break;
    }
  }
  // a monster night
  if (!pick) {
    const { data: daily } = await from('team_daily').select('team_id,points').eq('date', day);
    const big = (daily ?? []).filter((d) => Number(d.points) >= BIG_NIGHT).sort((a, b) => Number(b.points) - Number(a.points))[0];
    const key = big ? `big:${big.team_id}:${day}` : '';
    if (big && !(await posted(key))) {
      pick = { key, focus: [big.team_id], task: `${gm(big.team_id)} is having a monster night. Call it out in 1 or 2 sentences: who's doing it and who should be worried.`,
        facts: { gm: gm(big.team_id), team: byId.get(big.team_id)?.name, points_tonight: Number(big.points), top_of_the_table: [...standings].sort((a, b) => a.rank - b.rank).slice(0, 4).map((x) => `${gm(x.team_id)} ${f1(Number(x.points))}`) },
        fallback: `🔥 @${gm(big.team_id)} has ${f1(Number(big.points))} tonight and it isn't over. Somebody stop him.` };
    }
  }
  // a new leader, read only when nothing is live, so a lead that flips mid-game doesn't count
  if (!pick) {
    const { data: g } = await from('games').select('state').eq('date', day);
    const table = [...standings].sort((a, b) => a.rank - b.rank);
    const top = table[0];
    const clear = top && table[1] && Number(top.points) > Number(table[1].points);
    if (!(g ?? []).some((x) => ['LIVE', 'CRIT'].includes(x.state)) && clear) {
      if (cur.leader == null) cur.leader = top.team_id;
      else if (cur.leader !== top.team_id) {
        const was = cur.leader;
        cur.leader = top.team_id;
        const days = league.season_start ? (Date.parse(day) - Date.parse(league.season_start)) / 86400000 : 0;
        const key = `lead:${top.team_id}:${day}`;
        if (days >= 3 && !(await posted(key))) {
          pick = { key, focus: [top.team_id, was], task: `There's a new leader. 1 or 2 sentences: crown ${gm(top.team_id)} and needle ${gm(was)}, who just lost it.`,
            facts: { new_leader: gm(top.team_id), points: Number(top.points), lead: f1(Number(top.points) - Number(table[1].points)), dethroned: gm(was) },
            fallback: `👑 New name on top: @${gm(top.team_id)} at ${f1(Number(top.points))}. @${gm(was)}, that didn't last.` };
        }
      }
    }
  }
  await from('garry_state').update({ moments: cur });
  if (!pick) return { skipped: 'nothing worth it' };
  const body = await write(pick.task, pick.facts, pick.fallback, 70, pick.focus);
  await post(body, { type: 'moment', key: pick.key, date: day });
  return { posted: pick.key };
}

// ─────────────── state of the league ───────────────
// A longer column on where the season stands: every GM's start, who's carrying whom, who's under water against
// their projection, the points left on benches, the free agents nobody has noticed, who's betting and who's
// quiet. Posted once a league day at most. The commissioner can hand Garry an announcement to make first: in the
// request (from the commissioner or an admin-key holder), or left on garry_state.moments.assess_note (used once, then
// cleared).
async function assess(asked: string | null, force = false) {
  const { league, teams, byId, standings } = await base();
  if (league.phase !== 'season') return { skipped: league.phase };
  const day = ((await db.rpc('today_et')).data as string | null) ?? etDate(new Date());
  if (!force && await alreadyPosted('assess', day)) return { skipped: 'already posted' };
  const st = await state();
  const queued = typeof st?.moments?.assess_note === 'string' ? String(st.moments.assess_note) : null;
  const note = asked ?? queued;
  const [{ data: daily }, { data: rosters }, { data: book }, { data: chat }, { data: modes }] = await Promise.all([
    from('team_daily').select('team_id,date,points').gte('date', league.season_start ?? day).lt('date', day).order('date'),
    from('rosters').select('team_id,player_id,slot'),
    from('book_standings').select('team_id,bets,wins,net'),
    from('messages').select('team_id').eq('kind', 'user').not('channel', 'like', 'dm:%').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    from('teams').select('id,auto_mode').eq('role', 'gm'),
  ]);
  const nights = [...new Set((daily ?? []).map((d) => d.date))];
  if (!nights.length) return { skipped: 'no nights played yet' };
  const pids = (rosters ?? []).map((r) => r.player_id);
  const [{ data: ps }, { data: ss }, { data: hot }] = await Promise.all([
    from('players').select('id,name,pos,nhl_team,proj,injury_status').in('id', pids),
    from('player_season').select('player_id,gp,fpts').in('player_id', pids),
    from('player_season').select('player_id,gp,fpts').gt('gp', 0).order('fpts', { ascending: false }).limit(150),
  ]);
  const pl = new Map((ps ?? []).map((p) => [p.id, p]));
  const sea = new Map((ss ?? []).map((s) => [s.player_id, s]));
  const owner = new Map((rosters ?? []).map((r) => [r.player_id, r.team_id]));
  // a player's pace against his projection: what an 82-game projection says he should have by now
  const pace = (id: number) => { const s = sea.get(id), p = pl.get(id); return s && p && s.gp ? Number(s.fpts) - (Number(p.proj) / 82) * s.gp : 0; };
  const table = [...standings].sort((a, b) => a.rank - b.rank);
  const nightsOf = (id: number) => nights.map((d) => f1(Number((daily ?? []).find((x) => x.team_id === id && x.date === d)?.points ?? 0)));
  const best = [...(daily ?? [])].sort((a, b) => Number(b.points) - Number(a.points))[0];
  const worst = [...(daily ?? [])].sort((a, b) => Number(a.points) - Number(b.points))[0];
  const talk = new Map<number, number>();
  for (const m of chat ?? []) talk.set(m.team_id, (talk.get(m.team_id) ?? 0) + 1);
  const gms = table.map((s) => {
    const mine = (rosters ?? []).filter((r) => r.team_id === s.team_id);
    const byFp = mine.filter((r) => sea.get(r.player_id)?.gp).sort((a, b) => Number(sea.get(b.player_id)!.fpts) - Number(sea.get(a.player_id)!.fpts));
    const under = mine.filter((r) => (sea.get(r.player_id)?.gp ?? 0) >= 2).sort((a, b) => pace(a.player_id) - pace(b.player_id))[0];
    const bk = (book ?? []).find((b) => b.team_id === s.team_id);
    return {
      rank: s.rank, gm: byId.get(s.team_id)?.gm_name, team: byId.get(s.team_id)?.name, points: Number(s.points), by_night: nightsOf(s.team_id),
      left_on_bench: Number(s.bench ?? 0), pickups_used: s.moves ?? 0, autopilot: (modes ?? []).find((m) => m.id === s.team_id)?.auto_mode ?? 'off',
      carrying_them: byFp.slice(0, 2).map((r) => `${pl.get(r.player_id)?.name} ${f1(Number(sea.get(r.player_id)!.fpts))}`),
      behind_pace: under && pace(under.player_id) < -2 ? `${pl.get(under.player_id)?.name} (${f1(Number(sea.get(under.player_id)!.fpts))} in ${sea.get(under.player_id)!.gp} games, projected ${Math.round(Number(pl.get(under.player_id)?.proj))} for the year)` : null,
      hurt: mine.filter((r) => pl.get(r.player_id)?.injury_status && !['BN', 'IR'].includes(r.slot)).map((r) => `${pl.get(r.player_id)?.name} (${pl.get(r.player_id)?.injury_status})`).slice(0, 3),
      book: bk ? `${bk.bets} tickets, ${bk.wins} won, net ${bk.net} coins` : 'no tickets yet',
      chat_messages_this_week: talk.get(s.team_id) ?? 0,
    };
  });
  // the best unowned producers so far, for the waiver-wire line
  const { data: hp } = await from('players').select('id,name,pos,nhl_team').in('id', (hot ?? []).map((h) => h.player_id));
  const hpn = new Map((hp ?? []).map((p) => [p.id, p]));
  const freeAgents = (hot ?? []).filter((h) => !owner.has(h.player_id)).slice(0, 4).map((h) => `${hpn.get(h.player_id)?.name} (${hpn.get(h.player_id)?.pos}, ${hpn.get(h.player_id)?.nhl_team}) ${f1(Number(h.fpts))} in ${h.gp}`);
  const facts = {
    nights_played: nights.length, first_night: nights[0], standings: gms,
    best_night: best ? { gm: byId.get(best.team_id)?.gm_name, date: best.date, points: Number(best.points) } : null,
    worst_night: worst ? { gm: byId.get(worst.team_id)?.gm_name, date: worst.date, points: Number(worst.points) } : null,
    gap_first_to_last: table.length > 1 ? f1(Number(table[0].points) - Number(table.at(-1)!.points)) : null,
    hot_free_agents: freeAgents,
  };
  // the announcement first, on its own, then the column
  if (note) {
    const said = await write(`The commissioner asked you to tell the league this, in your own words, in 3 to 5 sentences, in character, then say your state-of-the-league column is next. It's all true; don't add features it doesn't mention:\n${note}`, {}, note, 120);
    await post(said, { type: 'notice', date: day });
    if (queued) await from('garry_state').update({ moments: { ...(st?.moments ?? {}), assess_note: null } });
  }
  const task = `Write your state-of-the-league column for the chat after ${nights.length} night${nights.length > 1 ? 's' : ''} of play. Open with one line, then one short, specific paragraph per GM in standings order, separated by blank lines, built on their numbers: how they started, who's carrying them, who's behind pace, bench points, autopilot, the Book. Use a GM's @ only when the line is really about them. Then one paragraph with the waiver wire (name the free agents), the race, and one challenge for the week. It's early: say so where it matters, crown nobody.`;
  const fallback = [
    `${L.brand.bot.emoji} State of the league after ${nights.length} night${nights.length > 1 ? 's' : ''}.`,
    ...gms.map((g) => `${g.rank}. ${g.gm} ${f1(g.points)}${g.carrying_them[0] ? `, carried by ${g.carrying_them[0]}` : ''}${g.left_on_bench ? `, ${f1(g.left_on_bench)} left on the bench` : ''}.`),
    freeAgents.length ? `Free agents nobody has noticed: ${freeAgents.join(', ')}. 👉 #/players` : '',
  ].filter(Boolean).join('\n\n');
  const body = await write(task, facts, fallback, 380, teams.map((t) => t.id));
  const parts = await postLong(body, { type: 'assess', date: day });
  return { posted: 'assess', nights: nights.length, parts, announced: !!note };
}

async function runTask(task: string, req: Request) {
  // a prediction pool has no lineups, no slate and no fantasy table: its one scheduled post is the morning column on
  // days something happened or is about to (poolDaily); the rest of his scheduled runs are for fantasy leagues
  if (L.kind === 'predict' && SCHEDULED.has(task)) return task === 'daily' ? poolDaily() : { skipped: 'a prediction pool' };
  if (task === 'nudge') return nudge();
  if (task === 'moments') return moments();
  if (task === 'assess') {
    if (!(await callerMayRun(req))) return { error: 'Commissioner only' };
    const body = await req.json().catch(() => ({}));
    return assess(typeof body?.note === 'string' ? body.note.slice(0, 1200) : null, body?.force === true);
  }
  if (task === 'keepers' || task === 'learn' || task === 'evolve') {
    if (!(await callerMayRun(req))) return { error: 'Commissioner only' };
    return task === 'keepers' ? keeperReport() : task === 'learn' ? learn(true) : evolve(true);
  }
  if (task === 'draftprep') return draftPrep();
  if (task === 'draft') return draftRecap();
  if (task === 'weekly') return weekly();
  return daily();
}

// the scheduled runs (the morning column, the nudge, the weekly, the moments, draft prep): the cron jobs send the
// platform's admin key; the public key, which ships in the site, can't start them (each is model calls and chat posts)
const SCHEDULED = new Set(['daily', 'nudge', 'weekly', 'moments', 'draftprep']);
async function adminKeyOk(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (!key) return false;
  const { data } = await db.rpc('admin_key_ok', { p_key: key });
  return data === true;
}

Deno.serve((req) => runs.run({ L: { ...HOME }, feature: 'garry.daily' }, () => handle(req)));

async function handle(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const task = url.searchParams.get('task') ?? 'daily';
  runs.getStore()!.feature = `garry.${task}`;
  if (SCHEDULED.has(task) && !(await adminKeyOk(req))) return json({ task, ok: false, error: 'Scheduled runs only' }, 403);
  // a preview of a scheduled post: what it would say, with the facts it was given, posted nowhere (admin key only, above)
  if (SCHEDULED.has(task) && url.searchParams.get('dry') === '1') runs.getStore()!.dry = true;
  try {
    if (task === 'reply') {
      const { message_id } = await req.json();
      const { data: m } = await db.from('messages').select('league_id').eq('id', Number(message_id)).maybeSingle();
      if (!m) return json({ task, ok: false, error: 'no such message' }, 404);
      await enter(m.league_id);
      const result = await reply(Number(message_id));
      return json({ task, ok: true, llm: apiKey ? MODEL : false, league: L.lid, result });
    }
    if (task === 'probe') {
      const id = Number(url.searchParams.get('message_id'));
      const { data: m } = await db.from('messages').select('league_id').eq('id', id).maybeSingle();
      if (!m) return json({ task, ok: false, error: 'no such message' }, 404);
      await enter(m.league_id);
      if (!(await callerMayRun(req))) return json({ task, ok: false, error: 'Commissioner only' }, 403);
      // a few a day at most: it calls the model and posts nothing. The reply is kept on the league's state row (read it
      // from the database), never returned: the anon key is public and the chat is the league's business
      const st = await state();
      const day = etDate(new Date());
      const probes = st?.usage?.day === day ? Number(st.usage.probes ?? 0) : 0;
      if (probes >= 40) return json({ task, ok: false, error: 'probe limit for today' }, 429);
      const result = await reply(id, true);
      const fresh = await state();
      const usage = fresh?.usage?.day === day ? fresh.usage : { day };
      const kept = [...((usage as Record<string, unknown>).probe_results as unknown[] ?? []), { message_id: id, at: new Date().toISOString(), result }].slice(-10);
      await from('garry_state').update({ usage: { ...usage, probes: probes + 1, probe_results: kept } });
      return json({ task, ok: true, llm: apiKey ? MODEL : false, league: L.lid });
    }
    if (task === 'book') {
      const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '');
      const { data: u } = token && !isAnonCaller(token) ? await db.auth.getUser(token) : { data: null };
      if (!u?.user) return json({ task, ok: false, error: 'Sign in first' }, 401);
      const [lid] = await leaguesFor(req, url);
      await enter(lid);
      const { data: t } = await db.from('teams').select('id,gm_name,role').eq('user_id', u.user.id).eq('league_id', lid).maybeSingle();
      if (!t || t.role !== 'gm') return json({ task, ok: false, error: 'GMs only' }, 403);
      const body = await req.json().catch(() => ({}));
      const msgs = (Array.isArray(body?.messages) ? body.messages : []).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-10);
      const result = await bookChat({ id: t.id, gm_name: t.gm_name }, token, msgs);
      return json({ task, ok: true, llm: apiKey ? MODEL : false, league: L.lid, result });
    }
    const leagues = await leaguesFor(req, url);
    const results: Record<number, unknown> = {};
    for (const lid of leagues) {
      await enter(lid);
      runs.getStore()!.drafts = [];
      try {
        results[lid] = await runTask(task, req);
        if (dry()) results[lid] = { result: results[lid], drafts: runs.getStore()!.drafts };
      }
      catch (e) { console.error(task, lid, e); results[lid] = { error: String((e as Error)?.message ?? e) }; }
    }
    const one = leagues.length === 1 ? results[leagues[0]] : null;
    if (one && typeof one === 'object' && 'error' in one) return json({ task, ok: false, league: leagues[0], error: (one as { error: string }).error }, (one as { error: string }).error === 'Commissioner only' ? 403 : 500);
    return json({ task, ok: true, llm: apiKey ? MODEL : false, leagues, result: leagues.length === 1 ? one : results });
  } catch (e) {
    console.error(task, e);
    return json({ task, ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
}
