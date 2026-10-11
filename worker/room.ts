// What every room at the edge shares (docs/DEVELOPMENT.md §8.3, E4): the game-night room (live.ts) and the draft room
// (draft.ts) are Durable Objects that phones join over a WebSocket. A phone says hello with its sign-in; the room asks
// the database whether that sign-in belongs to a member of the room's league, and lets in only those. The room then
// reads the league with a member's own sign-in, so it can only ever see what a GM sees and needs no key of its own.
// The sockets hibernate: the room sleeps between its reads and costs nothing while it waits.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

export type Who = { ok: boolean; team?: number; uid?: string; token?: string; exp?: number; joined: number; said: number[] };
export type Msg = { t?: string; token?: string; key?: number; e?: string };
const MAX_SOCKETS = 200;

// a sign-in token's own claims (who and until when); the database checks its signature on the first read with it
export function claims(token: string): { sub?: string; exp?: number } {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)));
  } catch { return {}; }
}

export abstract class Room<Meta extends { league: number }> extends DurableObject<Env> {
  protected meta: Meta | null = null;
  get league() { return this.meta?.league ?? 0; }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // a room woken from its sleep finds which league (and night) it is
    ctx.blockConcurrencyWhile(async () => { this.meta = (await ctx.storage.get<Meta>('meta')) ?? null; });
  }

  // the room's address names what it is; a room keeps the first address it was opened on
  protected abstract parse(path: string): Meta | null;
  // a member just came in: hand them the room as it stands
  protected abstract welcome(ws: WebSocket, team: number): Promise<void>;
  // the room's heartbeat while anyone is in it; returns how long until the next one
  protected abstract beat(): Promise<number>;
  // the room is empty: how long until it next looks in on itself, or null to sleep until someone comes
  protected abstract empty(): Promise<number | null>;
  // anything a member says beyond hello, a fresh sign-in and ping
  protected async said(_ws: WebSocket, _who: Who, _msg: Msg): Promise<void> {}

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('A live room speaks WebSocket', { status: 426 });
    const m = this.parse(new URL(req.url).pathname);
    if (!m) return new Response('Not found', { status: 404 });
    if (!this.meta) { this.meta = m; await this.ctx.storage.put('meta', m); }
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response('The room is full', { status: 503 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ ok: false, joined: Date.now(), said: [] } satisfies Who);
    await this.wake(10_000);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > 4096) return;
    let msg: Msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const who = ws.deserializeAttachment() as Who;
    // at most eight messages in ten seconds from one phone; the rest are dropped
    const now = Date.now();
    who.said = [...who.said.filter((t) => now - t < 10_000), now];
    ws.serializeAttachment(who);
    if (who.said.length > 8) return;

    if (msg.t === 'hello' && typeof msg.token === 'string') {
      const team = await this.member(msg.token).catch(() => 'down' as const);
      // the database didn't answer: not a refusal, the phone tries again in a moment
      if (team === 'down') { ws.close(1011, 'Try again'); return; }
      if (team == null) { this.send(ws, { t: 'denied' }); ws.close(4003, 'Not a member of this league'); return; }
      const c = claims(msg.token);
      Object.assign(who, { ok: true, team, uid: c.sub, token: msg.token, exp: c.exp ?? 0 });
      ws.serializeAttachment(who);
      await this.welcome(ws, team);
      this.who();
      return;
    }
    if (!who.ok) return;
    if (msg.t === 'auth' && typeof msg.token === 'string') {
      // a fresh token for the same person, as the site renews its sign-in
      const c = claims(msg.token);
      if (c.sub && c.sub === who.uid) { who.token = msg.token; who.exp = c.exp ?? 0; ws.serializeAttachment(who); }
      return;
    }
    if (msg.t === 'ping') { this.send(ws, { t: 'pong' }); return; }
    await this.said(ws, who, msg);
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
    this.who();
  }
  async webSocketError() { this.who(); }

  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const w = ws.deserializeAttachment() as Who;
      if (!w.ok && now - w.joined > 15_000) ws.close(4001, 'Say hello first');
    }
    if (!this.members().length) {
      const next = await this.empty();
      if (next != null) await this.wake(next);
      return;
    }
    let next = 20_000;
    try { next = await this.beat(); } catch (e) { console.warn('room beat', this.league, e); }
    await this.wake(next);
  }

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

  protected rest(token: string, path: string, init?: { method?: string; body?: string }) {
    return fetch(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      headers: {
        apikey: this.env.SUPABASE_ANON, authorization: `Bearer ${token}`, 'x-league': String(this.league), accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  }

  // a member's token with time left on it, to read with; when every one is about to run out, ask the phones for fresh
  protected token(): string | null {
    let best: Who | null = null;
    for (const w of this.members()) if (w.token && (w.exp ?? 0) > (best?.exp ?? 0)) best = w;
    if (!best || (best.exp ?? 0) * 1000 < Date.now() + 120_000) this.all({ t: 'auth?' });
    return best && (best.exp ?? 0) * 1000 > Date.now() + 5_000 ? best.token! : null;
  }

  protected members(): Who[] {
    return this.ctx.getWebSockets().map((ws) => ws.deserializeAttachment() as Who).filter((w) => w.ok);
  }
  protected who() {
    const teams = [...new Set(this.members().map((w) => w.team!))].sort((a, b) => a - b);
    this.all({ t: 'who', teams });
  }
  protected all(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (!(ws.deserializeAttachment() as Who).ok) continue;
      try { ws.send(s); } catch { /* a phone that just left */ }
    }
  }
  protected send(ws: WebSocket, msg: unknown) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
  // the next heartbeat, unless one is already due sooner
  protected async wake(ms: number) {
    const at = await this.ctx.storage.getAlarm();
    const want = Date.now() + Math.max(0, ms);
    if (at == null || at > want) await this.ctx.storage.setAlarm(want);
  }
}
