// The draft room (docs/DEVELOPMENT.md §8.3, E4): one room per league for its draft, a Durable Object at Cloudflare's
// edge that every phone on the draft joins while the draft is on. It does two things the database alone does slowly:
//
//  - The clock. The room's alarm is set to the second the pick on the clock runs out. When it fires, the room asks the
//    database to make the pick (draft_tick: the same autopick the scheduler makes, for every pick past its deadline,
//    safe to ask any number of times), so an expired clock is a pick within a fraction of a second, not the up to ten
//    seconds the scheduler's job takes, and a team on autodraft picks the moment its four seconds are up.
//  - The fan-out. A pick goes to every phone the moment the room sees it: a phone that picks says so, and the room
//    looks at the draft every two seconds besides, once for the whole league, so no phone has to keep asking.
//
// The room reads and ticks with a member's own sign-in (room.ts), so it can do nothing a GM couldn't.
import type { Env } from './index';
import { Room, type Msg, type Who } from './room';

type Draft = {
  id: number; season: string; status: 'scheduled' | 'live' | 'paused' | 'done'; current_overall: number | null;
  deadline: string | null; paused_remaining: number | null; order_set: boolean; started_at: string | null; updated_at: string | null;
};
type Pick = { id: number; overall: number; round: number; team_id: number; player_id: number; picked_at: string | null; auto: boolean };
type Board = { league: number };

const PATH = /^\/api\/live\/(\d{1,6})\/draft$/;
// how long past the deadline the room asks for the pick: the database decides by its own clock, so a hair late
const GRACE = 150;

export class DraftRoom extends Room<Board> {
  protected parse(path: string): Board | null {
    const m = PATH.exec(path);
    return m ? { league: Number(m[1]) } : null;
  }

  protected async welcome(ws: WebSocket) {
    let state = await this.ctx.storage.get<Draft>('state');
    if (!state || (await this.ctx.storage.get<number>('at') ?? 0) < Date.now() - 2_000) state = await this.read().catch(() => state) ?? state;
    this.send(ws, { t: 'draft', state: state ?? null, picks: (await this.ctx.storage.get<Pick[]>('picks')) ?? [] });
    await this.wake(this.next(state ?? null));
  }

  // a phone just picked (or the commissioner paused, resumed or undid): look now, and everyone sees it at once
  protected async said(_ws: WebSocket, _who: Who, msg: Msg) {
    if (msg.t !== 'moved') return;
    const state = await this.read().catch(() => null);
    await this.wake(this.next(state));
  }

  protected async beat() {
    let state = await this.read();
    if (state?.status === 'live' && state.deadline && Date.parse(state.deadline) <= Date.now()) {
      await this.tick();
      state = await this.read();
    }
    return this.next(state);
  }

  // nobody on the draft: the room sleeps until someone comes; a finished draft's room clears itself away
  protected async empty() {
    if ((await this.ctx.storage.get<Draft>('state'))?.status === 'done') await this.ctx.storage.deleteAll();
    return null;
  }

  // when to look next: at the clock's deadline, or in two seconds, whichever is sooner, while the draft is live; less
  // often while it waits to start or is paused; once a minute once it's done
  private next(state: Draft | null) {
    if (state?.status === 'live') {
      const left = state.deadline ? Date.parse(state.deadline) - Date.now() + GRACE : Infinity;
      return left <= 0 ? 250 : Math.min(left, 2_000);
    }
    return state?.status === 'paused' || state?.status === 'scheduled' ? 4_000 : 60_000;
  }

  // the draft as the league sees it; when it has moved, the latest picks with it, and out to everyone
  private async read(): Promise<Draft | null> {
    const token = this.token();
    if (!token) return (await this.ctx.storage.get<Draft>('state')) ?? null;
    const r = await this.rest(token, `draft_state?select=id,season,status,current_overall,deadline,paused_remaining,order_set,started_at,updated_at&league_id=eq.${this.league}`);
    if (!r.ok) { console.warn('draft read', this.league, r.status); return (await this.ctx.storage.get<Draft>('state')) ?? null; }
    const state = ((await r.json()) as Draft[])[0] ?? null;
    await this.ctx.storage.put('at', Date.now());
    const before = await this.ctx.storage.get<Draft>('state');
    if (!state || JSON.stringify(state) === JSON.stringify(before)) return state;
    let picks = (await this.ctx.storage.get<Pick[]>('picks')) ?? [];
    const pr = await this.rest(token, `draft_picks?select=id,overall,round,team_id,player_id,picked_at,auto&league_id=eq.${this.league}&season=eq.${encodeURIComponent(state.season)}&player_id=not.is.null&order=overall.desc&limit=12`);
    if (pr.ok) picks = (await pr.json()) as Pick[];
    await this.ctx.storage.put({ state, picks });
    this.all({ t: 'draft', state, picks });
    return state;
  }

  // the pick on the clock is past its deadline: the database makes it, exactly as the scheduler's job would
  private async tick() {
    const token = this.token();
    if (!token) return;
    const r = await this.rest(token, 'rpc/draft_tick', { method: 'POST', body: '{}' });
    if (!r.ok) console.warn('draft tick', this.league, r.status);
  }
}

// /api/live/<league>/draft: to the league's draft room
export async function draftRoom(req: Request, env: Env): Promise<Response> {
  const m = PATH.exec(new URL(req.url).pathname);
  if (!m) return new Response('Not found', { status: 404 });
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
  return env.DRAFT.get(env.DRAFT.idFromName(m[1])).fetch(req);
}
