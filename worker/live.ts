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
import type { Env } from './index';
import { Room, type Msg, type Who } from './room';

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
type State = { games: Game[]; snaps: Snap[]; pgs: PG[]; at: number };
type Night = { league: number; day: string };

const BENCH = new Set(['BN', 'IR']);
const LIVE = new Set(['LIVE', 'CRIT']);
const DONE = new Set(['OFF', 'FINAL', 'PPD', 'CNCL']);
const REACT = ['🔥', '😱', '👏', '😂', '🧊'];
const KEEP = 150; // swings kept for the night
const PATH = /^\/api\/live\/(\d{1,6})\/(\d{4}-\d{2}-\d{2})$/;

const key = (g: number, p: number) => `${g}:${p}`;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export class LiveRoom extends Room<Night> {
  private get day() { return this.meta?.day ?? ''; }

  protected parse(path: string): Night | null {
    const m = PATH.exec(path);
    return m ? { league: Number(m[1]), day: m[2] } : null;
  }

  protected async welcome(ws: WebSocket, team: number) {
    let state = await this.ctx.storage.get<State>('state');
    if (!state || Date.now() - state.at > 30_000) { await this.read().catch((e) => console.warn('live read', e)); state = await this.ctx.storage.get<State>('state'); }
    this.send(ws, { t: 'night', day: this.day, me: team, ...(state ?? { games: [], snaps: [], pgs: [], at: 0 }), swings: (await this.ctx.storage.get<Swing[]>('feed')) ?? [] });
    await this.wake(20_000);
  }

  protected async said(_ws: WebSocket, who: Who, msg: Msg) {
    if (msg.t !== 'react' || typeof msg.key !== 'number' || typeof msg.e !== 'string' || !REACT.includes(msg.e)) return;
    const feed = (await this.ctx.storage.get<Swing[]>('feed')) ?? [];
    const s = feed.find((x) => x.id === msg.key);
    if (!s) return;
    const rx = { ...(s.rx ?? {}) };
    // one reaction a team on a swing; the same one again takes it back
    if (rx[who.team!] === msg.e) delete rx[who.team!]; else rx[who.team!] = msg.e;
    s.rx = rx;
    await this.ctx.storage.put('feed', feed);
    this.all({ t: 'rx', key: s.id, rx });
  }

  // the night read again while anyone is in the room, quicker while a game is on
  protected async beat() {
    await this.read();
    const now = Date.now();
    const games = (await this.ctx.storage.get<State>('state'))?.games ?? [];
    const live = games.some((g) => LIVE.has(g.state) || (!DONE.has(g.state) && Date.parse(g.start_utc) - 15 * 60_000 <= now));
    const over = games.length > 0 && games.every((g) => DONE.has(g.state));
    return live ? 20_000 : over ? 300_000 : 60_000;
  }

  // empty: the room sleeps until someone comes back, and a few days after its night it clears itself away
  protected async empty() {
    const tidy = Date.parse(`${this.day}T12:00:00Z`) + 3 * 86_400_000;
    if (Date.now() >= tidy) { await this.ctx.storage.deleteAll(); return null; }
    return tidy - Date.now();
  }

  // ───────────── reading the night ─────────────

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
  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const day = Date.parse(`${m[2]}T12:00:00Z`);
  if (!Number.isFinite(day) || Math.abs(day - Date.now()) > 2 * 86_400_000) return new Response('No room that night', { status: 404 });
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
  return env.LIVE.get(env.LIVE.idFromName(`${m[1]}:${m[2]}`)).fetch(req);
}
