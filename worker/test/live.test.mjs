// The live room's test (worker/live.ts), run by worker/test/run.sh under wrangler dev against a stand-in database: members join, a non-member and a forged token are turned away, a goal becomes a
// swing for everyone, a reaction reaches everyone, and leaving updates who's watching
import fs from 'node:fs';
const STATE = new URL('./.live-state.json', import.meta.url).pathname;
const day = process.argv[2], B = 'ws://127.0.0.1:8787', L = 1000 + Math.floor(Math.random() * 90000);
const tok = (sub, exp = Math.floor(Date.now() / 1000) + 3600) => `x.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.sig`;
const open = (league = L) => new Promise((ok, no) => {
  const ws = new WebSocket(`${B}/api/live/${league}/${day}`);
  ws.msgs = []; ws.onmessage = (e) => ws.msgs.push(JSON.parse(e.data)); ws.onopen = () => ok(ws); ws.onerror = no;
  ws.closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
});
const until = async (ws, f, ms = 40000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = ws.msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 200)); } throw new Error('timed out waiting'); };
const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ', m); };

const a = await open(); a.send(JSON.stringify({ t: 'hello', token: tok('u1') }));
const n = await until(a, (m) => m.t === 'night');
check(n.me === 1 && n.games.length === 2 && n.snaps.length === 4 && n.pgs.length === 3, 'a member gets the night: 2 games, 4 frozen lines, 3 box lines');
check(n.swings.filter((s) => s.early).length === 3, `the night so far: 2 starters' lines and 1 final (${n.swings.map((s) => s.kind + (s.player ?? s.game)).join(' ')})`);
check(!n.swings.some((s) => s.player === 21), 'a benched player is never a swing');
const b = await open(); b.send(JSON.stringify({ t: 'hello', token: tok('u2') }));
await until(b, (m) => m.t === 'night');
const w = await until(a, (m) => m.t === 'who' && m.teams.length === 2);
check(w.teams.join() === '1,2', 'both members are watching');

const c = await open(); c.send(JSON.stringify({ t: 'hello', token: tok('u9') }));
check(await c.closed === 4003, 'a member of another league is turned away');
const d = await open(); d.send(JSON.stringify({ t: 'hello', token: tok('forged') }));
check(await d.closed === 4003, 'a token the database refuses is turned away');
const e = await open(); e.send(JSON.stringify({ t: 'hello', token: tok('u1', 100) }));
check(await e.closed === 4003, 'an expired token is turned away');
const f = await open(3); f.send(JSON.stringify({ t: 'hello', token: tok('u1') }));
check(await f.closed === 4003, "a member of league 1 can't join league 3's room");
const h = await open(); h.send(JSON.stringify({ t: 'hello', token: tok('down') }));
check(await h.closed === 1011 && !h.msgs.length, 'a database hiccup at the door is a retry, not a refusal');
check([...c.msgs, ...d.msgs].every((m) => m.t === 'denied'), 'nothing but "denied" reaches anyone turned away');

// a goal for team 2's starter, and the game's score moves
const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
st.pgs.push({ player_id: 20, game_id: 1, fpts: 3.5, stats: { g: 1, sog: 1 }, nhl_team: 'MTL', updated_at: new Date().toISOString() });
st.games[0].away_score = 1; st.games[0].clock = '08:12';
fs.writeFileSync(STATE, JSON.stringify(st));
const tk = await until(b, (m) => m.t === 'tick' && m.swings.length);
const sw = tk.swings.find((s) => s.kind === 'p');
check(sw && sw.team === 2 && sw.player === 20 && sw.d === 3.5 && sw.what.g === 1 && !sw.early, 'the goal is a swing: team 2, +3.5, one goal');
check(tk.swings.some((s) => s.kind === 'g' && s.score.join() === '1,1'), 'the game moving to 1–1 is a swing');
check(tk.pgs.length === 1 && tk.games.length === 1 && !tk.snaps, 'only what moved goes out');
await until(a, (m) => m.t === 'tick' && m.swings.length);
check(true, 'everyone in the room hears it');

a.send(JSON.stringify({ t: 'react', key: sw.id, e: '🔥' }));
const rx = await until(b, (m) => m.t === 'rx');
check(rx.key === sw.id && rx.rx['1'] === '🔥', 'a reaction reaches everyone');
a.send(JSON.stringify({ t: 'react', key: sw.id, e: '🔥' }));
const rx2 = await until(b, (m) => m.t === 'rx' && !m.rx['1']);
check(rx2, 'the same reaction again takes it back');
a.send(JSON.stringify({ t: 'react', key: sw.id, e: '<script>' }));

// someone late gets the night with the goal in it
const g = await open(); g.send(JSON.stringify({ t: 'hello', token: tok('u2') }));
const n2 = await until(g, (m) => m.t === 'night');
check(n2.swings.some((s) => s.id === sw.id) && n2.pgs.length === 4, 'a late phone sees the night so far, the goal included');
g.close(); b.close();
const w2 = await until(a, (m) => m.t === 'who' && m.teams.join() === '1', 10000);
check(w2, 'leaving updates who is watching');
const r = await (await fetch('http://127.0.0.1:8799/count')).json();
console.log('database reads for the whole test:', r.reads);
a.close();
process.exit(0);
