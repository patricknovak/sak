// The pool room (docs/DEVELOPMENT.md §8.3, E4): game nights for a prediction pool, one room per pool per day, a
// Durable Object every phone on the pool's home joins. It reads, once for everyone, the pool's table (its main game,
// from pool_scoreboard()) and today's games on the pool's own events (pool_competitions(), then their fixtures), and
// pushes what moved: a game starting, a score changing, a final, and a member climbing the table. It reads with a
// member's own sign-in (room.ts), so it can only see what a member sees.
import type { Env } from './index';
import { Room } from './room';

type Fixture = { id: number; competition: string; kickoff: string; home_club: number; away_club: number; state: string; minute: string | null; home_score: number | null; away_score: number | null };
type Club = { id: number; short: string | null; name: string; color: string | null };
type Row = { team_id: number; rank: number; score: number };
type Table = { key: string; title: string; kind: string; rows: Row[] } | null;
// a game moving (kind 'g'), or a member climbing the table (kind 't')
export type PoolSwing = {
  id: number; at: string; kind: 'g' | 't';
  fixture?: number; score?: [number | null, number | null]; state?: string; minute?: string | null;
  team?: number; from?: number; to?: number; title?: string;
};
type State = { fixtures: Fixture[]; table: Table; at: number };
type Night = { league: number; day: string };

const PATH = /^\/api\/live\/(\d{1,6})\/pool\/(\d{4}-\d{2}-\d{2})$/;
const LIVE = new Set(['live']);
const DONE = new Set(['final', 'postponed', 'cancelled', 'abandoned']);
const KEEP = 120;

export class PoolRoom extends Room<Night> {
  private get day() { return this.meta?.day ?? ''; }

  protected parse(path: string): Night | null {
    const m = PATH.exec(path);
    return m ? { league: Number(m[1]), day: m[2] } : null;
  }

  protected async welcome(ws: WebSocket, team: number) {
    let state = await this.ctx.storage.get<State>('state');
    if (!state || Date.now() - state.at > 30_000) { await this.read().catch((e) => console.warn('pool read', e)); state = await this.ctx.storage.get<State>('state'); }
    this.send(ws, { t: 'pool', day: this.day, me: team, ...(state ?? { fixtures: [], table: null, at: 0 }), clubs: (await this.ctx.storage.get<Club[]>('clubs')) ?? [], swings: (await this.ctx.storage.get<PoolSwing[]>('feed')) ?? [] });
    await this.wake(20_000);
  }

  protected async beat() {
    await this.read();
    const now = Date.now();
    const fx = (await this.ctx.storage.get<State>('state'))?.fixtures ?? [];
    const live = fx.some((f) => LIVE.has(f.state) || (!DONE.has(f.state) && Date.parse(f.kickoff) - 15 * 60_000 <= now));
    const over = fx.length > 0 && fx.every((f) => DONE.has(f.state));
    return live ? 20_000 : over || !fx.length ? 300_000 : 60_000;
  }

  protected async empty() {
    const tidy = Date.parse(`${this.day}T12:00:00Z`) + 3 * 86_400_000;
    if (Date.now() >= tidy) { await this.ctx.storage.deleteAll(); return null; }
    return tidy - Date.now();
  }

  private async read() {
    const token = this.token();
    if (!token) return;
    const post = { method: 'POST', body: '{}' };
    const [br, cr] = await Promise.all([this.rest(token, 'rpc/pool_scoreboard', post), this.rest(token, 'rpc/pool_competitions', post)]);
    if (!br.ok || !cr.ok) { console.warn('pool read', this.league, br.status, cr.status); return; }
    const board = (await br.json()) as { games?: { key: string; title: string; kind: string; rows: Row[] }[] } | null;
    const comps = ((await cr.json()) as { id: string }[]).map((c) => c.id);
    // the pool's main game leads the board; its table is the one the room watches
    const g = board?.games?.[0];
    const table: Table = g ? { key: g.key, title: g.title, kind: g.kind, rows: g.rows.map((r) => ({ team_id: r.team_id, rank: Number(r.rank), score: Number(r.score) })) } : null;
    let fixtures: Fixture[] = [];
    if (comps.length) {
      const fr = await this.rest(token, `fixtures?select=id,competition,kickoff,home_club,away_club,state,minute,home_score,away_score&competition=in.(${comps.map(encodeURIComponent).join(',')})&date=eq.${this.day}&order=kickoff`);
      if (!fr.ok) { console.warn('pool fixtures', this.league, fr.status); return; }
      fixtures = (await fr.json()) as Fixture[];
      // the clubs' names and colours, once
      const known = new Map(((await this.ctx.storage.get<Club[]>('clubs')) ?? []).map((c) => [c.id, c]));
      const want = [...new Set(fixtures.flatMap((f) => [f.home_club, f.away_club]))].filter((id) => id != null && !known.has(id));
      if (want.length) {
        const kr = await this.rest(token, `clubs?select=id,short,name,color&id=in.(${want.join(',')})`);
        if (kr.ok) { for (const c of (await kr.json()) as Club[]) known.set(c.id, c); await this.ctx.storage.put('clubs', [...known.values()]); }
      }
    }
    const before = await this.ctx.storage.get<State>('state');
    const next: State = { fixtures, table, at: Date.now() };
    const swings = before ? this.swings(before, next) : [];
    await this.ctx.storage.put('state', next);
    if (swings.length) await this.ctx.storage.put('feed', [...((await this.ctx.storage.get<PoolSwing[]>('feed')) ?? []), ...swings].slice(-KEEP));
    const was = new Map((before?.fixtures ?? []).map((f) => [f.id, JSON.stringify(f)]));
    const moved = fixtures.filter((f) => was.get(f.id) !== JSON.stringify(f));
    const tableMoved = JSON.stringify(before?.table ?? null) !== JSON.stringify(table);
    if (moved.length || tableMoved || swings.length || (before?.fixtures.length ?? 0) !== fixtures.length) {
      this.all({ t: 'tick', at: next.at, fixtures: moved, all: (before?.fixtures.length ?? 0) !== fixtures.length ? fixtures : undefined, table: tableMoved ? table : undefined, clubs: (await this.ctx.storage.get<Club[]>('clubs')) ?? [], swings });
    }
  }

  // what moved between two reads: games starting, scoring and ending; members climbing the main game's table
  private swings(before: State, next: State): PoolSwing[] {
    let seq = 0;
    const out: PoolSwing[] = [];
    const id = () => next.at * 100 + seq++;
    const iso = new Date(next.at).toISOString();
    const old = new Map(before.fixtures.map((f) => [f.id, f]));
    for (const f of next.fixtures) {
      const o = old.get(f.id);
      if (!o) continue;
      const scored = o.home_score !== f.home_score || o.away_score !== f.away_score;
      const started = !LIVE.has(o.state) && !DONE.has(o.state) && LIVE.has(f.state);
      const ended = !DONE.has(o.state) && DONE.has(f.state);
      if (scored || started || ended) out.push({ id: id(), at: iso, kind: 'g', fixture: f.id, score: [f.away_score, f.home_score], state: f.state, minute: f.minute });
    }
    if (before.table && next.table && before.table.key === next.table.key) {
      const was = new Map(before.table.rows.map((r) => [r.team_id, r.rank]));
      for (const r of next.table.rows) {
        const from = was.get(r.team_id);
        if (from != null && r.rank < from) out.push({ id: id(), at: iso, kind: 't', team: r.team_id, from, to: r.rank, title: next.table.title });
      }
    }
    return out;
  }
}

// /api/live/<league>/pool/<day>: to the pool's room for that day
export async function poolRoom(req: Request, env: Env): Promise<Response> {
  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return new Response('Not found', { status: 404 });
  const day = Date.parse(`${m[2]}T12:00:00Z`);
  if (!Number.isFinite(day) || Math.abs(day - Date.now()) > 2 * 86_400_000) return new Response('No room that day', { status: 404 });
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
  return env.POOL.get(env.POOL.idFromName(`${m[1]}:${m[2]}`)).fetch(req);
}
