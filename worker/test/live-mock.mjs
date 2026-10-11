// A stand-in for PostgREST for the live room's test (npm run test:live): u1 (team 1) and u2 (team 2) are members of any
// league but 3, u9 of league 3 only; 'forged' is a token the database refuses, 'down' a database that doesn't answer.
import http from 'node:http';
import fs from 'node:fs';
const day = process.argv[2];
const S = new URL('./.live-state.json', import.meta.url).pathname;
const init = {
  games: [{ id: 1, date: day, start_utc: new Date(Date.now() - 3600e3).toISOString(), home: 'TOR', away: 'MTL', state: 'LIVE', period: '2', clock: '10:00', home_score: 1, away_score: 0 },
          { id: 2, date: day, start_utc: new Date(Date.now() - 7200e3).toISOString(), home: 'EDM', away: 'CGY', state: 'OFF', period: '3', clock: '00:00', home_score: 4, away_score: 2 }],
  snaps: [{ team_id: 1, player_id: 10, slot: 'C', game_id: 1 }, { team_id: 2, player_id: 20, slot: 'LW', game_id: 1 }, { team_id: 2, player_id: 21, slot: 'BN', game_id: 2 }, { team_id: 1, player_id: 11, slot: 'D', game_id: 2 }],
  pgs: [{ player_id: 10, game_id: 1, fpts: 3, stats: { g: 1, sog: 3 }, nhl_team: 'TOR', updated_at: new Date(Date.now() - 600e3).toISOString() },
        { player_id: 11, game_id: 2, fpts: 2.5, stats: { a: 1, blk: 2 }, nhl_team: 'EDM', updated_at: new Date(Date.now() - 1800e3).toISOString() },
        { player_id: 21, game_id: 2, fpts: 4, stats: { g: 1, a: 1 }, nhl_team: 'EDM', updated_at: null }],
};
fs.writeFileSync(S, JSON.stringify(init));
const sub = (auth) => { try { return JSON.parse(Buffer.from(auth.split('.')[1], 'base64url')).sub; } catch { return null; } };
let reads = 0;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const who = sub((req.headers.authorization ?? '').replace('Bearer ', ''));
  const lg = req.headers['x-league'];
  const st = JSON.parse(fs.readFileSync(S, 'utf8'));
  const j = (b, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (u.pathname === '/count') return j({ reads });
  if (!who || who === 'forged') return j({ message: 'JWT invalid' }, 401);
  if (who === 'down') return j({ message: 'unavailable' }, 503);
  const t = u.pathname.replace('/rest/v1/', '');
  reads++;
  if (t === 'teams') {
    const mem = { u1: [1, lg === '3' ? 0 : Number(lg)], u2: [2, lg === '3' ? 0 : Number(lg)], u9: [90, 3] }[who];
    // x-league is honoured only for a member: anyone else reads their own league
    return j(mem && String(mem[1]) === lg ? [{ id: mem[0], league_id: mem[1] }] : []);
  }
  if (t === 'games') return j(st.games);
  if (t === 'lineup_snapshots') return j(st.snaps);
  if (t === 'league_games') { const ids = u.searchParams.get('player_id').slice(4, -1).split(',').map(Number); return j(st.pgs.filter((p) => ids.includes(p.player_id))); }
  j([], 404);
}).listen(8799, () => console.log('mock on 8799'));
