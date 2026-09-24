#!/usr/bin/env node
// Builds data/players.json: every current NHL player with last season's
// SaK fantasy points, plus Yahoo multi-position eligibility where we know it.
//
//   node scripts/build-players.mjs [lastSeasonId]   (default 20252026)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEASON = process.argv[2] || '20252026';
const TEAMS = ['ANA','BOS','BUF','CAR','CBJ','CGY','CHI','COL','DAL','DET','EDM','FLA','LAK','MIN','MTL','NJD','NSH','NYI','NYR','OTT','PHI','PIT','SEA','SJS','STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH'];

// SaK scoring (mirrors league_settings.scoring in the database)
export const SCORING = {
  skater: { g: 1.5, a: 1, pm: 0.5, pim: -0.2, ppp: 0.5, gwg: 1, sog: 0.2, hit: 0.1, blk: 0.2 },
  goalie: { gs: 1, w: 3, l: -1, ga: -0.5, sv: 0.05, sho: 2 },
};

const get = async (url) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 1000 * 2 ** i));
  }
  throw new Error(`fetch failed ${url}`);
};
const stats = (kind, report) =>
  get(`https://api.nhle.com/stats/rest/en/${kind}/${report}?limit=-1&cayenneExp=seasonId=${SEASON}%20and%20gameTypeId=2`).then((j) => j.data);

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const POS = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };
const round1 = (n) => Math.round(n * 100) / 100;

const main = async () => {
  const players = new Map();
  for (const t of TEAMS) {
    const r = await get(`https://api-web.nhle.com/v1/roster/${t}/current`);
    for (const p of [...r.forwards, ...r.defensemen, ...r.goalies]) {
      players.set(p.id, {
        id: p.id,
        first: p.firstName.default,
        lastName: p.lastName.default,
        name: `${p.firstName.default} ${p.lastName.default}`,
        pos: POS[p.positionCode],
        elig: [POS[p.positionCode]],
        team: t,
        num: p.sweaterNumber ?? null,
        birth: p.birthDate,
        shoots: p.shootsCatches,
        headshot: p.headshot,
      });
    }
  }

  const [sum, rt, gsum] = await Promise.all([
    stats('skater', 'summary'),
    stats('skater', 'realtime'),
    stats('goalie', 'summary'),
  ]);
  const rtById = new Map(rt.map((r) => [r.playerId, r]));
  const S = SCORING.skater, G = SCORING.goalie;
  const last = new Map();
  for (const s of sum) {
    const r = rtById.get(s.playerId) || {};
    const st = {
      gp: s.gamesPlayed, g: s.goals, a: s.assists, pm: s.plusMinus, pim: s.penaltyMinutes,
      ppp: s.ppPoints, gwg: s.gameWinningGoals, sog: s.shots, hit: r.hits ?? 0, blk: r.blockedShots ?? 0,
    };
    const fp = Object.keys(S).reduce((t, k) => t + S[k] * (st[k] || 0), 0);
    last.set(s.playerId, { st, fp: round1(fp), name: s.skaterFullName, team: s.teamAbbrevs });
  }
  for (const s of gsum) {
    const st = {
      gp: s.gamesPlayed, gs: s.gamesStarted, w: s.wins, l: s.losses, otl: s.otLosses,
      ga: s.goalsAgainst, sv: s.saves, sho: s.shutouts, svp: s.savePct,
    };
    const fp = Object.keys(G).reduce((t, k) => t + G[k] * (st[k] || 0), 0);
    last.set(s.playerId, { st, fp: round1(fp), name: s.goalieFullName, team: s.teamAbbrevs });
  }

  // players who skated last season but aren't on a current NHL roster (unsigned, AHL, injured list)
  const posOf = new Map([...sum.map((s) => [s.playerId, s.positionCode]), ...gsum.map((s) => [s.playerId, 'G'])]);
  for (const [id, l] of last) {
    if (players.has(id)) continue;
    const [first, ...rest] = l.name.split(' ');
    players.set(id, {
      id, first, lastName: rest.join(' '), name: l.name, pos: POS[posOf.get(id)], elig: [POS[posOf.get(id)]],
      team: l.team.split(',').pop(), num: null, birth: null, shoots: null,
      headshot: `https://assets.nhle.com/mugs/nhl/latest/${id}.png`, unrostered: true,
    });
  }

  for (const p of players.values()) {
    const l = last.get(p.id);
    p.last = l ? { fp: l.fp, ...l.st } : null;
    const gp = l?.st.gp || 0;
    // simple projection: per-game pace over a full season (62 starts for goalies), regressed for small samples
    const pace = gp ? l.fp / (p.pos === 'G' ? l.st.gs || gp : gp) : 0;
    const weight = Math.min(gp, 40) / 40;
    p.proj = round1(pace * (p.pos === 'G' ? 58 : 78) * weight + (l?.fp || 0) * (1 - weight));
  }

  // Yahoo eligibility + 2025/26 SaK rosters
  const yahoo = JSON.parse(readFileSync(join(root, 'data/yahoo-rosters-2025-26.json'), 'utf8'));
  const byName = new Map();
  for (const p of players.values()) {
    const k = norm(p.name);
    byName.set(k, [...(byName.get(k) || []), p]);
  }
  const alias = { jjpeterka: 'johnjasonpeterka', tjmiller: 'jtmiller' };
  const rosters = {};
  const missing = [];
  for (const [teamId, list] of Object.entries(yahoo.teams)) {
    rosters[teamId] = [];
    for (const y of list) {
      let k = norm(y.name);
      let c = byName.get(k) || byName.get(alias[k]);
      if (!c) {
        // fall back to last-name + position match among all players
        const lastN = norm(y.name.split(' ').slice(-1)[0]);
        c = [...players.values()].filter((p) => norm(p.lastName) === lastN && y.elig.includes(p.pos === 'G' ? 'G' : p.pos) );
        if (c.length !== 1) c = null;
      }
      if (!c) { missing.push(`${teamId}: ${y.name}`); continue; }
      const p = c.length > 1 ? c.find((x) => x.pos === y.elig[0]) || c[0] : c[0];
      p.elig = y.elig;
      rosters[teamId].push({ id: p.id, yahooFp: y.fpts });
    }
  }

  const out = [...players.values()].sort((a, b) => b.proj - a.proj);
  out.forEach((p, i) => (p.rank = i + 1));
  writeFileSync(join(root, 'data/players.json'), JSON.stringify({ season: SEASON, built: new Date().toISOString(), players: out }));
  writeFileSync(join(root, 'data/rosters-2025-26.json'), JSON.stringify(rosters, null, 1));
  console.log(`players: ${out.length}, with last-season stats: ${out.filter((p) => p.last).length}`);
  console.log('top 10:', out.slice(0, 10).map((p) => `${p.name} ${p.proj}`).join(', '));
  if (missing.length) console.log('UNMATCHED yahoo players:', missing);
};

main().catch((e) => { console.error(e); process.exit(1); });
