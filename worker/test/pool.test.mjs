// The pool room's test (worker/pool.ts), run by worker/test/run.sh under wrangler dev against the stand-in database: a
// member gets the day's games and the table, a goal and a member climbing the table reach everyone, and a stranger is
// turned away.
import fs from 'node:fs';
const STATE = new URL('./.live-state.json', import.meta.url).pathname;
const day = process.argv[2], B = 'ws://127.0.0.1:8787', L = 1000 + Math.floor(Math.random() * 90000);
const tok = (sub) => `x.${Buffer.from(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;
const open = (league = L) => new Promise((ok, no) => {
  const ws = new WebSocket(`${B}/api/live/${league}/pool/${day}`);
  ws.msgs = []; ws.onmessage = (e) => ws.msgs.push(JSON.parse(e.data)); ws.onopen = () => ok(ws); ws.onerror = no;
  ws.closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
});
const until = async (ws, f, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = ws.msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 200)); } throw new Error('timed out waiting'); };
const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ', m); };
const write = (f) => { const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); f(st); fs.writeFileSync(STATE, JSON.stringify(st)); };

// a pick'em pool on two events: one game live, one to come, one final
write((st) => {
  st.pool = { comps: ['nfl', 'epl'],
    table: { key: 'pickem:1', title: 'NFL pick\'em', kind: 'pickem', rows: [{ team_id: 1, rank: 1, score: 12 }, { team_id: 2, rank: 2, score: 11 }, { team_id: 3, rank: 3, score: 9 }] },
    clubs: [{ id: 11, short: 'GB', name: 'Green Bay', color: '#203731' }, { id: 12, short: 'CHI', name: 'Chicago', color: '#0b162a' }, { id: 13, short: 'ARS', name: 'Arsenal', color: '#ef0107' }, { id: 14, short: 'CHE', name: 'Chelsea', color: '#034694' }],
    fixtures: [
      { id: 501, competition: 'nfl', kickoff: new Date(Date.now() - 3600e3).toISOString(), home_club: 11, away_club: 12, state: 'live', minute: 'Q2 4:12', home_score: 7, away_score: 3 },
      { id: 502, competition: 'epl', kickoff: new Date(Date.now() + 7200e3).toISOString(), home_club: 13, away_club: 14, state: 'scheduled', minute: null, home_score: null, away_score: null },
    ] };
});
const a = await open(); a.send(JSON.stringify({ t: 'hello', token: tok('u1') }));
const n = await until(a, (m) => m.t === 'pool');
check(n.fixtures.length === 2 && n.table.title === "NFL pick'em" && n.table.rows.length === 3 && n.clubs.length === 4, 'a member gets the day: 2 games, the table, the clubs');
const b = await open(); b.send(JSON.stringify({ t: 'hello', token: tok('u2') }));
await until(b, (m) => m.t === 'pool');
await until(a, (m) => m.t === 'who' && m.teams.length === 2);
check(true, 'both members are in the room');
const c = await open(); c.send(JSON.stringify({ t: 'hello', token: tok('u9') }));
check(await c.closed === 4003, "a member of another pool is turned away");

// Chicago scores, and team 3 climbs to second
write((st) => { st.pool.fixtures[0].away_score = 10; st.pool.fixtures[0].minute = 'Q2 1:03'; st.pool.table.rows = [{ team_id: 1, rank: 1, score: 12 }, { team_id: 3, rank: 2, score: 12 }, { team_id: 2, rank: 3, score: 11 }]; });
const tk = await until(b, (m) => m.t === 'tick' && m.swings.length);
const g = tk.swings.find((s) => s.kind === 'g'), t = tk.swings.find((s) => s.kind === 't');
check(g && g.fixture === 501 && g.score.join() === '10,7', 'the score moving is a swing for everyone');
check(t && t.team === 3 && t.from === 3 && t.to === 2 && t.title === "NFL pick'em", 'a member climbing the table is a swing');
check(!tk.swings.some((s) => s.kind === 't' && s.team === 2), 'dropping a place is not a swing');
check(tk.fixtures.length === 1 && tk.table && tk.table.rows[1].team_id === 3, 'only what moved goes out, the new table with it');
await until(a, (m) => m.t === 'tick' && m.swings.length);
check(true, 'everyone in the room hears it');
const late = await open(); late.send(JSON.stringify({ t: 'hello', token: tok('u2') }));
const n2 = await until(late, (m) => m.t === 'pool');
check(n2.swings.length === 2 && n2.fixtures[0].away_score === 10, 'a late phone sees the day so far');
a.close(); b.close(); late.close();
process.exit(0);
