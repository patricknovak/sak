// The live room (docs/DEVELOPMENT.md §8.3, E4): one room per league per game night, a Durable Object at Cloudflare's
// edge. Every phone with the league's live scoreboard open joins it over a WebSocket. The room reads the night from
// Postgres once (the slate, the lineups frozen at each puck drop, every starter's box-score line) and hands it to
// everyone, instead of every phone asking the database every minute. On each read it works out what moved since the
// last one, and those are the night's swings: a goal for your starter, a goalie's win, a game going final. The swings
// are kept for the night, so a phone that comes in late sees how the night got here. Who's watching and the reactions
// on a swing are the room's own.
//
// The room reads with a member's own sign-in, the same key the site uses, so it can only ever see what a GM of the
// league sees, and it lets in only a signed-in member of its league. It needs no key of its own.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

type Game = { id: number; date: string; start_utc: string; home: string; away: string; state: string; period: string | null; clock: string | null; home_score: number | null; away_score: number | null };
type Snap = { team_id: number; player_id: number; slot: string; game_id: number };
type PG = { player_id: number; game_id: number; fpts: number; stats: Record<string, number>; nhl_team: string | null; updated_at: string | null };
// a swing: a starter's points moved (kind 'p'), or a game started, changed score or went final (kind 'g').
// `early` marks what the room found already on the board when it opened: the night so far, not a moment it saw.
export type Swing = {
  id: number; at: string; kind: 'p' | 'g'; early?: boolean;
  team?: number; player?: number; game: number; d?: number; pts?: number; what?: Record<string, number>;
  score?: [number | null, number | null]; state?: string; period?: string | null; clock?: string | null;
  rx?: Record<string, string>;
};
type Who = { ok: boolean; team?: number; uid?: string; token?: string; exp?: number; joined: number; said: number[] };
type State = { games: Game[]; snaps: Snap[]; pgs: PG[]; at: number };

const BENCH = new Set(['BN', 'IR']);
const LIVE = new Set(['LIVE', 'CRIT']);
const DONE = new Set(['OFF', 'FINAL', 'PPD', 'CNCL']);
const REACT = ['🔥', '😱', '👏', '😂', '🧊'];
const KEEP = 150; // swings kept for the night
const MAX_SOCKETS = 200;

// a sign-in token's own claims (who and until when); the database checks its signature on the first read with it
function claims(token: string): { sub?: string; exp?: number } {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)));
  } catch { return {}; }
}
const key = (g: number, p: number) => `${g}:${p}`;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export class LiveRoom extends DurableObject<Env> {
  private league = 0;
  private day = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // a room woken from its sleep finds its league and night where it left them
    ctx.blockConcurrencyWhile(async () => {
      const m = await ctx.storage.get<{ league: number; day: string }>('meta');
      if (m) { this.league = m.league; this.day = m.day; }
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
    const m = /^\/api\/live\/(\d{1,6})\/(\d{4}-\d{2}-\d{2})$/.exec(new URL(req.url).pathname);
    if (!m) return new Response('Not found', { status: 404 });
    if (!this.league) { this.league = Number(m[1]); this.day = m[2]; await this.ctx.storage.put('meta', { league: this.league, day: this.day }); }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('The room is full', { status: 503 });
    const pair = new WebSocketPair();
    // hibernating sockets: the room sleeps between reads and costs nothing while it waits
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ ok: false, joined: Date.now(), said: [] } satisfies Who);
    await this.wake(10_000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let msg: { t?: string; token?: string; key?: number; e?: string };
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment() as Who;
    // at most eight messages in ten seconds from one phone; the rest are dropped
    const now = Date.now();
    who.said = [...who.said.filter((t) => now - t < 10_000), now];
    if (who.said.length > 8) { ws.serializeAttachment(who); return; }

    if (msg.t === 'hello' && typeof msg.token === 'string') {
      const team = await this.member(msg.token).catch(() => 'down' as const);
      // the database didn't answer: not a refusal, the phone tries again in a moment
      if (team === 'down') { ws.close(1011, 'Try again'); return; }
      if (team == null) { this.send(ws, { t: 'denied' }); ws.close(4003, 'Not a member of this league'); return; }
      const c = claims(msg.token);
      Object.assign(who, { ok: true, team, uid: c.sub, token: msg.token, exp: c.exp ?? 0 });
      ws.serializeAttachment(who);
      let state = await this.ctx.storage.get<State>('state');
      if (!state || now - state.at > 30_000) { await this.read().catch((e) => console.warn('live read', e)); state = await this.ctx.storage.get<State>('state'); }
      this.send(ws, { t: 'night', day: this.day, me: team, ...(state ?? { games: [], snaps: [], pgs: [], at: 0 }), swings: (await this.ctx.storage.get<Swing[]>('feed')) ?? [] });
      this.who();
      await this.wake(20_000);
      return;
    }
    if (!who.ok) return;
    if (msg.t === 'auth' && typeof msg.token === 'string') {
      // a fresh token for the same person, as the site renews its sign-in
      const c = claims(msg.token);
      if (c.sub && c.sub === who.uid) { who.token = msg.token; who.exp = c.exp ?? 0; ws.serializeAttachment(who); }
      else ws.serializeAttachment(who);
      return;
    }
    if (msg.t === 'react' && typeof msg.key === 'number' && typeof msg.e === 'string' && REACT.includes(msg.e)) {
      ws.serializeAttachment(who);
      const feed = (await this.ctx.storage.get<Swing[]>('feed')) ?? [];
      const s = feed.find((x) => x.id === msg.key);
      if (!s) return;
      const rx = { ...(s.rx ?? {}) };
      // one reaction a team on a swing; the same one again takes it back
      if (rx[who.team!] === msg.e) delete rx[who.team!]; else rx[who.team!] = msg.e;
      s.rx = rx;
      await this.ctx.storage.put('feed', feed);
      this.all({ t: 'rx', key: s.id, rx });
      return;
    }
    ws.serializeAttachment(who);
    if (msg.t === 'ping') this.send(ws, { t: 'pong' });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    this.who();
  }
  async webSocketError() { this.who(); }

  // the room's heartbeat: read the night again while anyone is in the room, quicker while a game is on
  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const w = ws.deserializeAttachment() as Who;
      if (!w.ok && now - w.joined > 15_000) ws.close(4001, 'Say hello first');
    }
    if (!this.members().length) {
      // empty: the room sleeps until someone comes back, and a few days after its night it clears itself away
      const tidy = Date.parse(`${this.day}T12:00:00Z`) + 3 * 86_400_000;
      if (now >= tidy) await this.ctx.storage.deleteAll();
      else await this.wake(tidy - now);
      return;
    }
    await this.read().catch((e) => console.warn('live read', this.league, this.day, e));
    const state = await this.ctx.storage.get<State>('state');
    const games = state?.games ?? [];
    const live = games.some((g) => LIVE.has(g.state) || (!DONE.has(g.state) && Date.parse(g.start_utc) - 15 * 60_000 <= now));
    const over = games.length > 0 && games.every((g) => DONE.has(g.state));
    await this.wake(live ? 20_000 : over ? 300_000 : 60_000);
  }

  // ───────────── reading the night ─────────────

  // the signed-in member's team in this league, or null. The database checks the token: a forged or expired one is
  // refused, and the x-league header is honoured only for a member, so a stranger never matches the league.
  private async member(token: string): Promise<number | null | 'down'> {
    const { sub, exp } = claims(token);
    if (!sub || !exp || exp * 1000 < Date.now()) return null;
    const r = await this.rest(token, `teams?select=id,league_id&user_id=eq.${encodeURIComponent(sub)}&league_id=eq.${this.league}`);
    if (r.status >= 500) return 'down';
    if (!r.ok) return null;
    const rows = (await r.json()) as { id: number; league_id: number }[];
    return rows.find((x) => x.league_id === this.league)?.id ?? null;
  }

  private rest(token: string, path: string) {
    return fetch(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: this.env.SUPABASE_ANON, authorization: `Bearer ${token}`, 'x-league': String(this.league), accept: 'application/json' },
    });
  }

  // a member's token with time left on it, to read with; when every one is about to run out, ask the phones for fresh
  private token(): string | null {
    let best: Who | null = null;
    for (const w of this.members()) if (w.token && (w.exp ?? 0) > (best?.exp ?? 0)) best = w;
    if (!best || (best.exp ?? 0) * 1000 < Date.now() + 120_000) this.all({ t: 'auth?' });
    return best && (best.exp ?? 0) * 1000 > Date.now() + 5_000 ? best.token! : null;
  }

  private async read() {
    const token = this.token();
    if (!token) return;
    const day = this.day;
    const [gr, sr] = await Promise.all([
      this.rest(token, `games?select=id,date,start_utc,home,away,state,period,clock,home_score,away_score&date=eq.${day}&order=start_utc`),
      this.rest(token, `lineup_snapshots?select=team_id,player_id,slot,game_id&date=eq.${day}`),
    ]);
    if (!gr.ok || !sr.ok) { console.warn('live read', this.league, day, gr.status, sr.status); return; }
    const games = (await gr.json()) as Game[];
    const snaps = (await sr.json()) as Snap[];
    // the box-score lines of the players frozen into a lineup tonight: what the scoreboard shows, and all the room keeps
    let pgs: PG[] = [];
    const ids = [...new Set(snaps.map((s) => s.player_id))];
    if (ids.length) {
      const pr = await this.rest(token, `league_games?select=player_id,game_id,fpts,stats,nhl_team,updated_at&date=eq.${day}&player_id=in.(${ids.join(',')})`);
      if (!pr.ok) { console.warn('live read lines', this.league, pr.status); return; }
      pgs = ((await pr.json()) as PG[]).map((p) => ({ ...p, fpts: num(p.fpts) }));
    }
    const before = await this.ctx.storage.get<State>('state');
    const next: State = { games, snaps, pgs, at: Date.now() };
    const swings = this.swings(before ?? null, next);
    await this.ctx.storage.put('state', next);
    if (swings.length) {
      const feed = [...((await this.ctx.storage.get<Swing[]>('feed')) ?? []), ...swings].slice(-KEEP);
      await this.ctx.storage.put('feed', feed);
    }
    // what changed goes out: the games and lines that moved, the lineups whole when a puck drop froze more of them
    const gOld = new Map((before?.games ?? []).map((g) => [g.id, JSON.stringify(g)]));
    const pOld = new Map((before?.pgs ?? []).map((p) => [key(p.game_id, p.player_id), `${p.fpts}|${JSON.stringify(p.stats)}`]));
    const tick = {
      t: 'tick', at: next.at,
      games: games.filter((g) => gOld.get(g.id) !== JSON.stringify(g)),
      pgs: pgs.filter((p) => pOld.get(key(p.game_id, p.player_id)) !== `${p.fpts}|${JSON.stringify(p.stats)}`),
      snaps: before && before.snaps.length === snaps.length ? undefined : snaps,
      swings,
    };
    if (tick.games.length || tick.pgs.length || tick.snaps || swings.length) this.all(tick);
  }

  // what moved between two reads of the night
  private swings(before: State | null, next: State): Swing[] {
    let seq = 0;
    const out: Swing[] = [];
    const id = () => next.at * 100 + seq++;
    const starter = new Map<number, Snap>();
    for (const s of next.snaps) if (!BENCH.has(s.slot)) starter.set(s.player_id, s);
    const iso = new Date(next.at).toISOString();
    if (!before) {
      // the room just opened: the night so far, each starter's line as of its last change
      for (const p of next.pgs) {
        const s = starter.get(p.player_id);
        if (!s || p.fpts === 0) continue;
        out.push({ id: id(), at: p.updated_at ?? iso, kind: 'p', early: true, team: s.team_id, player: p.player_id, game: p.game_id, d: p.fpts, pts: p.fpts, what: nonzero(p.stats) });
      }
      for (const g of next.games) if (DONE.has(g.state) && g.state !== 'PPD' && g.state !== 'CNCL') out.push({ id: id(), at: iso, kind: 'g', early: true, game: g.id, score: [g.away_score, g.home_score], state: g.state, period: g.period, clock: g.clock });
      return out.sort((a, b) => a.at.localeCompare(b.at));
    }
    const old = new Map(before.pgs.map((p) => [key(p.game_id, p.player_id), p]));
    for (const p of next.pgs) {
      const s = starter.get(p.player_id);
      if (!s) continue;
      const o = old.get(key(p.game_id, p.player_id));
      const d = Math.round((p.fpts - (o?.fpts ?? 0)) * 100) / 100;
      if (d === 0) continue;
      out.push({ id: id(), at: iso, kind: 'p', team: s.team_id, player: p.player_id, game: p.game_id, d, pts: p.fpts, what: diff(o?.stats ?? {}, p.stats) });
    }
    const was = new Map(before.games.map((g) => [g.id, g]));
    for (const g of next.games) {
      const o = was.get(g.id);
      if (!o) continue;
      const scored = o.home_score !== g.home_score || o.away_score !== g.away_score;
      const started = !LIVE.has(o.state) && !DONE.has(o.state) && LIVE.has(g.state);
      const ended = !DONE.has(o.state) && DONE.has(g.state);
      if (scored || started || ended) out.push({ id: id(), at: iso, kind: 'g', game: g.id, score: [g.away_score, g.home_score], state: g.state, period: g.period, clock: g.clock });
    }
    return out;
  }

  // ───────────── the people in the room ─────────────

  private members(): Who[] {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Who).filter((w) => w.ok);
  }
  private who() {
    const teams = [...new Set(this.members().map((w) => w.team!))].sort((a, b) => a - b);
    this.all({ t: 'who', teams });
  }
  private all(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (!(ws.deserializeAttachment() as Who).ok) continue;
      try { ws.send(s); } catch { /* a phone that just left */ }
    }
  }
  private send(ws: WebSocket, msg: unknown) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
  // the next read, unless one is already due sooner
  private async wake(ms: number) {
    const at = await this.ctx.storage.getAlarm();
    const want = Date.now() + ms;
    if (at == null || at > want) await this.ctx.storage.setAlarm(want);
  }
}

const nonzero = (s: Record<string, number> = {}) => Object.fromEntries(Object.entries(s).filter(([, v]) => num(v) !== 0).map(([k, v]) => [k, num(v)]));
const diff = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
  const o: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = num(b[k]) - num(a[k]); if (d) o[k] = Math.round(d * 1000) / 1000; }
  return o;
};

// /api/live/<league>/<day>: to the room for that league's night. The day is the league day the phone is on, and only
// a night around today has a room.
export async function live(req: Request, env: Env): Promise<Response> {
  const m = /^\/api\/live\/(\d{1,6})\/(\d{4}-\d{2}-\d{2})$/.exec(new URL(req.url).pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const day = Date.parse(`${m[2]}T12:00:00Z`);
  if (!Number.isFinite(day) || Math.abs(day - Date.now()) > 2 * 86_400_000) return new Response('No room that night', { status: 404 });
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
  return env.LIVE.get(env.LIVE.idFromName(`${m[1]}:${m[2]}`)).fetch(req);
}
