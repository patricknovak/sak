// The draft room's test (worker/draft.ts), run by worker/test/run.sh under wrangler dev against the stand-in database:
// the clock runs out and the pick lands at once, a phone's pick reaches everyone when it says so, a pause is seen
// without anyone saying so, and a stranger is turned away.
import fs from 'node:fs';
const STATE = new URL('./.live-state.json', import.meta.url).pathname;
const B = 'ws://127.0.0.1:8787', L = 1000 + Math.floor(Math.random() * 90000);
const tok = (sub, exp = Math.floor(Date.now() / 1000) + 3600) => `x.${Buffer.from(JSON.stringify({ sub, exp })).toString('base64url')}.sig`;
const open = (league = L) => new Promise((ok, no) => {
  const ws = new WebSocket(`${B}/api/live/${league}/draft`);
  ws.msgs = []; ws.onmessage = (e) => ws.msgs.push({ ...JSON.parse(e.data), got: Date.now() }); ws.onopen = () => ok(ws); ws.onerror = no;
  ws.closed = new Promise((r) => { ws.onclose = (e) => r(e.code); });
});
const until = async (ws, f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { const m = ws.msgs.find(f); if (m) return m; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timed out waiting'); };
const check = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ', m); };
const write = (f) => { const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); f(st); fs.writeFileSync(STATE, JSON.stringify(st)); };
const count = async () => (await fetch('http://127.0.0.1:8799/count')).json();

// a live draft: six picks, a three-second clock, the first pick's clock running out in two
const deadline = Date.now() + 2000;
write((st) => {
  st.draft = { clock: 3000,
    state: { id: 1, season: '2026-27', status: 'live', current_overall: 1, deadline: new Date(deadline).toISOString(), paused_remaining: null, order_set: true, started_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    picks: [1, 2, 3, 4, 5, 6].map((o) => ({ id: o, overall: o, round: Math.ceil(o / 2), team_id: ((o - 1) % 2) + 1, player_id: null, picked_at: null, auto: false })) };
});
const before = await count();
const a = await open(); a.send(JSON.stringify({ t: 'hello', token: tok('u1') }));
const b = await open(); b.send(JSON.stringify({ t: 'hello', token: tok('u2') }));
const first = await until(a, (m) => m.t === 'draft');
check(first.state.status === 'live' && first.state.current_overall === 1 && first.picks.length === 0, 'a member gets the draft: live, pick 1 on the clock');
await until(a, (m) => m.t === 'who' && m.teams.length === 2);
check(true, 'both GMs are in the draft room');

// the clock runs out: the room asks for the pick, and it reaches everyone
const auto = await until(b, (m) => m.t === 'draft' && m.state.current_overall === 2);
const late = auto.got - deadline;
check(auto.picks[0]?.overall === 1 && auto.picks[0].auto && auto.picks[0].player_id === 101, 'the expired pick is made for the team on the clock');
check(late < 900, `it lands ${late} ms after the clock runs out (the scheduler's job: up to 10 s)`);
await until(a, (m) => m.t === 'draft' && m.state.current_overall === 2);
check(true, 'everyone in the room hears it');

// team 2 picks on its own; its phone says so, and the room passes it on straight away
write((st) => {
  const pk = st.draft.picks.find((p) => p.overall === 2);
  Object.assign(pk, { player_id: 777, picked_at: new Date().toISOString(), auto: false });
  Object.assign(st.draft.state, { current_overall: 3, deadline: new Date(Date.now() + 60_000).toISOString(), updated_at: new Date().toISOString() });
});
const said = Date.now();
b.send(JSON.stringify({ t: 'moved' }));
const mine = await until(a, (m) => m.t === 'draft' && m.state.current_overall === 3);
check(mine.picks[0].player_id === 777 && !mine.picks[0].auto, 'a GM\'s own pick reaches the room');
check(mine.got - said < 500, `within ${mine.got - said} ms of the phone saying so`);

// the commissioner pauses from somewhere the room doesn't hear from: it sees it on its own
write((st) => { Object.assign(st.draft.state, { status: 'paused', deadline: null, paused_remaining: 55, updated_at: new Date().toISOString() }); });
const paused = await until(b, (m) => m.t === 'draft' && m.state.status === 'paused', 5000);
check(paused, 'a pause is seen without anyone saying so');

// a stranger, and a member of league 1 at league 3's draft
const c = await open(); c.send(JSON.stringify({ t: 'hello', token: tok('u9') }));
check(await c.closed === 4003, 'a member of another league is turned away');
const d = await open(3); d.send(JSON.stringify({ t: 'hello', token: tok('u1') }));
check(await d.closed === 4003, 'and a GM can\'t join another league\'s draft');

// a paused clock never ticks
await new Promise((r) => setTimeout(r, 3000));
const after = await count();
check(after.autopicks - before.autopicks === 1, `one autopick in all (${after.ticks - before.ticks} asks), none while paused`);
a.close(); b.close();
process.exit(0);
