// nhl-sync: keeps SaK in step with the NHL.
//   ?task=scores       (every minute) games for yesterday+today, freeze lineups at puck drop, box scores -> fantasy points
//   ?task=corrections  (daily) re-pull the last 3 days of finished games so NHL stat corrections flow into points;
//                      &days=21 (weekly) reaches further back for late corrections. GMs whose starters moved are told.
//   ?task=schedule     (hourly) the next six weeks of games, so lineups can be set a month ahead
//   ?task=season-schedule (daily) every remaining game of the season, for rest-of-season forecasts
//   ?task=projections  (weekly) the SAK projection model: three seasons of NHL stats -> a projected line per player
//   ?task=standings    (daily) NHL standings and playoff odds: how many playoff games each NHL team should play
//   ?task=fund         (weekdays) each league fund's share price and the US/Canadian dollar rate
//   ?task=players      (every few hours, and before puck drop) current NHL rosters: trades, call-ups, sweater numbers,
//                      headshots. On game day the box score's team wins (see sync_teams_from_box)
//   ?task=injuries     (hourly) injury / suspension status from ESPN's public injury report
//   ?task=gameday      (every 15 min, afternoon and evening) injuries again, starting goalies, scratches: who plays
//   ?task=news         (every 2 hours) NHL headlines, tagged with the players they mention
//   ?task=daily        (late morning ET) lineup auto-pilot for teams that turned it on: today's best lineup
//   ?task=lineups-late (before puck drop) the auto-pilot again, for late scratches and injuries; skips any team
//                      whose GM moved players by hand today
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { etDate, gameRow, gameStats, NHL, STARTED } from '../_shared/nhl.ts';
import { optimize, weekEndOf, STARTING, gamesOf, rosPerGame, type Basis, type LPlayer, type LSeason, type Mode } from '../_shared/lineup.ts';
import { forecastTeam, winChance, type FPlayer } from '../_shared/forecast.ts';
import { projectAll, type GoalieSeason, type ProjPlayer, type SkaterSeason } from '../_shared/projections.ts';
import { playoffOdds, type NhlTeamIn, type SeriesIn } from '../_shared/playoffs.ts';
import { mergeStatus, type GameStatus } from '../_shared/gameday.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
// the same key working for one league: x-league makes the league views, rules and points that league's
const dbFor = (league: number) => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false }, global: { headers: { 'x-league': String(league) } },
});

const TEAMS = ['ANA','BOS','BUF','CAR','CBJ','CGY','CHI','COL','DAL','DET','EDM','FLA','LAK','MIN','MTL','NJD','NSH','NYI','NYR','OTT','PHI','PIT','SEA','SJS','STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH'];
const POS: Record<string, string> = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/hockey/nhl';

const getJson = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};
const get = (path: string) => getJson(`${NHL}${path}`);
// the league day (today_et() in the database): last night's date until its final game is over
const leagueToday = async () => { const { data } = await db.rpc('today_et'); return (data as string | null) ?? etDate(new Date()); };
const nextDay = (d: string) => new Date(new Date(d + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};
// every row of a read: the API hands back at most a thousand a request, and a read across leagues can pass that
// (with five leagues, tonight's rostered players alone). The read is ordered, so the pages don't overlap.
async function every<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const chunk = (check(await page(from, from + 999)) ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < 1000) return out;
  }
}
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// faceoffs need the (large) play-by-play feed, so only fetch it when some league scores them
async function needsPbp() {
  const { data } = await db.from('league_rules').select('scoring');
  return (data ?? []).some((r) => { const sk = (r.scoring?.skater ?? {}) as Record<string, number>; return !!(sk.fow || sk.fol); });
}

async function syncGames(ids: number[], parallel = 1) {
  const pbpWanted = await needsPbp();
  let lines = 0;
  const one = async (id: number) => {
    const [box, landing, pbp] = await Promise.all([
      get(`/gamecenter/${id}/boxscore`), get(`/gamecenter/${id}/landing`),
      pbpWanted ? get(`/gamecenter/${id}/play-by-play`) : Promise.resolve(undefined),
    ]);
    const rows = gameStats(box, landing, pbp).map((l) => ({ game_id: id, date: box.gameDate, ...l }));
    // only score players we know about (the pool is every NHL player, so this is nearly everyone)
    const known = new Set((check(await db.from('players').select('id').in('id', rows.map((r) => r.player_id))) as { id: number }[]).map((p) => p.id));
    const keep = rows.filter((r) => known.has(r.player_id));
    if (keep.length) check(await db.from('player_games').upsert(keep));
    lines += keep.length;
    if (box.gameState === 'OFF') check(await db.from('games').update({ final_synced: true, updated_at: new Date().toISOString() }).eq('id', id));
  };
  for (let i = 0; i < ids.length; i += parallel) await Promise.all(ids.slice(i, i + parallel).map(one));
  return lines;
}

async function scores() {
  const now = new Date();
  const days = [etDate(new Date(now.getTime() - 86400000)), etDate(now)];
  const games = (await Promise.all(days.map((d) => get(`/score/${d}`)))).flatMap((j) => j.games ?? []).filter((g: any) => g.gameType === 2 || g.gameType === 3); // regular season and playoffs (no preseason)
  if (games.length) check(await db.from('games').upsert(games.map(gameRow)));
  const snaps = check(await db.rpc('take_snapshots'));
  const { data: open } = await db.from('games').select('id,state').in('date', days).eq('final_synced', false);
  const todo = (open ?? []).filter((g) => STARTED.has(g.state)).map((g) => g.id);
  const lines = await syncGames(todo);
  // a player in today's box score plays for that team, even if the roster feed hasn't caught up with a trade
  const moved = lines ? check(await db.rpc('sync_teams_from_box')) : 0;
  return { games: games.length, snapshots: snaps, synced: todo.length, lines, moved };
}

// the NHL revises stats (assists, hits, blocks, goalie decisions) after review; re-pull recent finals
async function corrections(days: number) {
  const since = etDate(new Date(Date.now() - days * 86400000));
  const { data } = await db.from('games').select('id').gte('date', since).in('state', ['OFF', 'FINAL']);
  const ids = (data ?? []).map((g) => g.id);
  const lines = await syncGames(ids, 4);
  const told = check(await db.rpc('notify_corrections'));
  return { rechecked: ids.length, days, lines, teams_told: told };
}

async function upsertSchedule(starts: string[]) {
  const rows = (await Promise.all(starts.map((d) => get(`/schedule/${d}`))))
    .flatMap((j) => j.gameWeek ?? [])
    .flatMap((w: any) => (w.games ?? []).filter((g: any) => g.gameType === 2 || g.gameType === 3).map((g: any) => ({ ...g, gameDate: w.date })))
    .map(gameRow);
  const uniq = [...new Map(rows.map((r) => [r.id, r])).values()];
  // don't clobber live scores with schedule placeholders
  const skip = new Set<number>();
  for (let i = 0; i < uniq.length; i += 300) {
    const { data: started } = await db.from('games').select('id').in('id', uniq.slice(i, i + 300).map((r) => r.id)).neq('state', 'FUT');
    for (const g of started ?? []) skip.add(g.id);
  }
  const fresh = uniq.filter((r) => !skip.has(r.id));
  for (let i = 0; i < fresh.length; i += 300) check(await db.from('games').upsert(fresh.slice(i, i + 300)));
  return fresh.length;
}
const weekStarts = (from: Date, weeks: number) => Array.from({ length: weeks }, (_, i) => etDate(new Date(from.getTime() + i * 7 * 86400000)));

async function schedule() {
  return { scheduled: await upsertSchedule(weekStarts(new Date(), 6)) };
}

// the rest of the regular season, a week at a time
async function seasonSchedule() {
  const { data: lg } = await db.from('league').select('season_end').single();
  const end = lg?.season_end ? new Date(lg.season_end + 'T12:00:00Z') : new Date(Date.now() + 200 * 86400000);
  const weeks = Math.min(32, Math.max(1, Math.ceil((end.getTime() - Date.now()) / (7 * 86400000)) + 1));
  let n = 0;
  const starts = weekStarts(new Date(), weeks);
  for (let i = 0; i < starts.length; i += 6) n += await upsertSchedule(starts.slice(i, i + 6));
  return { scheduled: n, weeks };
}

// the projection model: pull three seasons of every player's NHL stats in a handful of requests, project, store
const STATS = 'https://api.nhle.com/stats/rest/en';
const report = async (kind: string, name: string, from: number) =>
  ((await getJson(`${STATS}/${kind}/${name}?limit=-1&cayenneExp=${encodeURIComponent(`seasonId>=${from} and gameTypeId=2`)}`)).data ?? []) as any[];
async function projections() {
  const { data: lg } = await db.from('league').select('scoring,season').single();
  const startYear = Number(String(lg?.season ?? '2026-27').slice(0, 4));
  const latest = (startYear - 1) * 10000 + startYear;      // 2026-27 is projected from 2025-26 and the two before
  const from = latest - 20002;
  const [sum, rt, toi, fo, gsum] = await Promise.all([
    report('skater', 'summary', from), report('skater', 'realtime', from), report('skater', 'timeonice', from),
    report('skater', 'faceoffwins', from), report('goalie', 'summary', from),
  ]);
  const key = (r: any) => `${r.playerId}:${r.seasonId}`;
  const rtBy = new Map(rt.map((r) => [key(r), r])), toiBy = new Map(toi.map((r) => [key(r), r])), foBy = new Map(fo.map((r) => [key(r), r]));
  const skaters = new Map<number, SkaterSeason[]>();
  for (const s of sum) {
    const r = rtBy.get(key(s)) ?? {}, t = toiBy.get(key(s)) ?? {}, f = foBy.get(key(s)) ?? {};
    const row: SkaterSeason = {
      season: s.seasonId, gp: s.gamesPlayed ?? 0, g: s.goals ?? 0, a: s.assists ?? 0, pm: s.plusMinus ?? 0, pim: s.penaltyMinutes ?? 0,
      ppg: s.ppGoals ?? 0, ppp: s.ppPoints ?? 0, shp: s.shPoints ?? 0, gwg: s.gameWinningGoals ?? 0, sog: s.shots ?? 0,
      hit: r.hits ?? 0, blk: r.blockedShots ?? 0, fow: f.totalFaceoffWins ?? 0, fol: f.totalFaceoffLosses ?? 0,
      toi: s.timeOnIcePerGame ?? 0, pptoi: t.ppTimeOnIcePerGame ?? 0, team: s.teamAbbrevs ?? '',
    };
    skaters.set(s.playerId, [...(skaters.get(s.playerId) ?? []), row]);
  }
  const goalies = new Map<number, GoalieSeason[]>();
  for (const g of gsum) {
    const row: GoalieSeason = { season: g.seasonId, gp: g.gamesPlayed ?? 0, gs: g.gamesStarted ?? 0, w: g.wins ?? 0, l: g.losses ?? 0, otl: g.otLosses ?? 0, ga: g.goalsAgainst ?? 0, sa: g.shotsAgainst ?? 0, sv: g.saves ?? 0, sho: g.shutouts ?? 0, team: g.teamAbbrevs ?? '' };
    goalies.set(g.playerId, [...(goalies.get(g.playerId) ?? []), row]);
  }
  const players: ProjPlayer[] = [];
  for (let from = 0; from < 20000;) {
    const chunk = check(await db.from('players').select('id,pos,birth,nhl_team,injury_status').order('id').range(from, from + 999)) as ProjPlayer[];
    if (!chunk.length) break;
    players.push(...chunk);
    from += chunk.length;
  }
  const out = projectAll(players, skaters, goalies, lg!.scoring, latest);
  let n = 0;
  for (let i = 0; i < out.length; i += 400) n += check(await db.rpc('set_projections', { p: out.slice(i, i + 400) })) as number;
  return { projected: n, players: players.length, seasons: sum.length + gsum.length };
}

// NHL standings, last season's as the prior, and the playoff bracket once it exists
async function standings() {
  const { data: lg } = await db.from('league').select('season').single();
  const startYear = Number(String(lg?.season ?? '2026-27').slice(0, 4));
  const seasonId = startYear * 10000 + startYear + 1;
  const [now, prev] = await Promise.all([get('/standings/now'), get(`/standings/${startYear}-04-15`)]);
  const priorOf = new Map<string, number>((prev.standings ?? []).map((s: any) => [s.teamAbbrev.default, Number(s.pointPctg)]));
  // before opening night /standings/now still shows last season: count it as zero games played
  const current = (now.standings ?? []).filter((s: any) => Number(s.seasonId) === seasonId);
  const rows = (current.length ? current : prev.standings ?? []) as any[];
  const teams: NhlTeamIn[] = rows.map((s) => ({
    abbrev: s.teamAbbrev.default, name: `${s.placeName?.default ?? ''} ${s.teamCommonName?.default ?? s.teamName?.default ?? ''}`.trim(),
    conf: s.conferenceAbbrev, division: s.divisionAbbrev,
    gp: current.length ? Number(s.gamesPlayed) : 0, pts: current.length ? Number(s.points) : 0,
    prior: priorOf.get(s.teamAbbrev.default) ?? null,
  }));
  let series: SeriesIn[] | null = null;
  try {
    const c = await get(`/playoff-series/carousel/${seasonId}/`);
    const all = (c.rounds ?? []).flatMap((r: any) => (r.series ?? []).map((x: any) => ({ r: r.roundNumber, x })));
    const abbr = new Map<number, string>();
    for (const { x } of all) { if (x.topSeed?.id) abbr.set(x.topSeed.id, x.topSeed.abbrev); if (x.bottomSeed?.id) abbr.set(x.bottomSeed.id, x.bottomSeed.abbrev); }
    const s: SeriesIn[] = all.filter(({ x }: any) => x.topSeed?.abbrev && x.bottomSeed?.abbrev).map(({ r, x }: any) => ({
      round: r, a: x.topSeed.abbrev, b: x.bottomSeed.abbrev, aw: Number(x.topSeed.wins ?? 0), bw: Number(x.bottomSeed.wins ?? 0),
      winner: x.winningTeamId ? abbr.get(x.winningTeamId) ?? null : null, loser: x.losingTeamId ? abbr.get(x.losingTeamId) ?? null : null,
    }));
    if (s.length) series = s;
  } catch { /* no bracket yet */ }
  const out = playoffOdds(teams, series);
  check(await db.from('nhl_teams').upsert(out.map((o) => ({ ...o, updated_at: new Date().toISOString() }))));
  return { teams: out.length, playoffs: !!series, alive: out.filter((o) => o.po_status === 'alive').length };
}

// each league's fund is priced in Canadian dollars: its stock's last price times the USD/CAD rate. Only leagues that
// keep a fund (league_rules.features.fund) have one; each is priced for its own league, one failing doesn't stop the rest
async function fundPrice() {
  const rules = check(await db.from('league_rules').select('league_id,features')) as { league_id: number; features: Record<string, boolean> | null }[];
  const on = new Set(rules.filter((r) => r.features?.fund === true).map((r) => r.league_id));
  const funds = (check(await db.from('fund').select('league_id,symbol')) as { league_id: number; symbol: string | null }[]).filter((f) => on.has(f.league_id));
  if (!funds.length) return { leagues: 0 };
  const quotes = new Map<string, Promise<number>>();
  const quote = (sym: string) => {
    if (!quotes.has(sym)) quotes.set(sym, getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`).then((j) => {
      const p = Number(j?.chart?.result?.[0]?.meta?.regularMarketPrice);
      if (!(p > 0)) throw new Error(`no price for ${sym}`);
      return p;
    }));
    return quotes.get(sym)!;
  };
  const fx = await quote('CAD=X');
  const out: Record<number, unknown> = {};
  for (const f of funds) {
    const symbol = f.symbol || 'TSLA';
    try {
      const price = await quote(symbol);
      check(await dbFor(f.league_id).rpc('set_fund_price', { p_price: price, p_fx: fx }));
      out[f.league_id] = { symbol, price, fx };
    } catch (e) { console.error('fund price, league', f.league_id, e); out[f.league_id] = { error: String(e) }; }
  }
  return out;
}

async function players() {
  const seen: any[] = [];
  for (const t of TEAMS) {
    const r = await get(`/roster/${t}/current`);
    for (const p of [...r.forwards, ...r.defensemen, ...r.goalies]) {
      seen.push({
        id: p.id, name: `${p.firstName.default} ${p.lastName.default}`, first: p.firstName.default,
        last_name: p.lastName.default, pos: POS[p.positionCode], nhl_team: t, num: p.sweaterNumber ?? null,
        birth: p.birthDate ?? null, shoots: p.shootsCatches ?? null, headshot: p.headshot, status: 'active',
      });
    }
  }
  // on game day the box score is the truth: don't let a roster feed that's behind on a trade undo it
  const { data: dressed } = await db.from('player_games').select('player_id,nhl_team').eq('date', await leagueToday());
  const boxTeam = new Map((dressed ?? []).filter((x) => x.nhl_team).map((x) => [x.player_id as number, x.nhl_team as string]));
  const FIELDS = ['name', 'first', 'last_name', 'pos', 'nhl_team', 'num', 'birth', 'shoots', 'headshot', 'status'] as const;
  const have = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < seen.length; i += 300) {
    const chunk = check(await db.from('players').select('id,elig,name,first,last_name,pos,nhl_team,num,birth,shoots,headshot,status').in('id', seen.slice(i, i + 300).map((p) => p.id))) as unknown as Record<string, unknown>[];
    for (const p of chunk) have.set(p.id as number, p);
  }
  // write only the players whose roster line changed: rewriting all ~800 every run bloated the table and stamped
  // everyone as updated, so nobody downstream could tell what actually moved
  const rows = seen.map((p) => ({ ...p, nhl_team: boxTeam.get(p.id) ?? p.nhl_team, elig: (have.get(p.id)?.elig as string[] | undefined) ?? [p.pos] }))
    .filter((r) => { const o = have.get(r.id); return !o || FIELDS.some((f) => (o[f] ?? null) !== ((r as Record<string, unknown>)[f] ?? null)); })
    .map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 300) check(await db.from('players').upsert(rows.slice(i, i + 300)));
  return { players: seen.length, changed: rows.length, added: rows.filter((r) => !have.has(r.id)).length };
}

async function nameIndex() {
  const all: { id: number; name: string }[] = [];
  // stable order, or pages can overlap and a player looks like two
  for (let from = 0; from < 20000;) {
    const chunk = check(await db.from('players').select('id,name').order('id').range(from, from + 999)) as typeof all;
    if (!chunk.length) break;
    all.push(...chunk);
    from += chunk.length;
  }
  const byName = new Map<string, number[]>();
  for (const p of all) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p.id]);
  return { all, byName };
}

async function injuries() {
  const j = await getJson(`${ESPN}/injuries`);
  const { byName } = await nameIndex();
  const found = new Map<number, { injury_status: string; injury_note: string | null; injury_date: string | null }>();
  for (const team of j.injuries ?? []) {
    for (const i of team.injuries ?? []) {
      const ids = byName.get(norm(i.athlete?.displayName ?? ''));
      if (!ids || ids.length !== 1) continue;
      found.set(ids[0], {
        injury_status: i.status ?? i.type?.description ?? 'Injured',
        injury_note: i.shortComment ?? i.longComment ?? null,
        injury_date: i.date ?? null,
      });
    }
  }
  // clear players who are no longer listed
  const { data: listed } = await db.from('players').select('id,injury_status,injury_note,injury_date').not('injury_status', 'is', null);
  const cleared = (listed ?? []).map((p) => p.id).filter((id) => !found.has(id));
  if (cleared.length) check(await db.from('players').update({ injury_status: null, injury_note: null, injury_date: null }).in('id', cleared));
  // and write only the injuries that are new or changed (the same hundred-odd rows were rewritten every 15 minutes)
  const was = new Map((listed ?? []).map((p) => [p.id as number, p]));
  const day = (d: unknown) => (d ? String(d).slice(0, 10) : null);
  let changed = 0;
  for (const [id, v] of found) {
    const o = was.get(id);
    if (o && o.injury_status === v.injury_status && (o.injury_note ?? null) === v.injury_note && day(o.injury_date) === day(v.injury_date)) continue;
    check(await db.from('players').update(v).eq('id', id));
    changed++;
  }
  return { injured: found.size, changed, cleared: cleared.length };
}

async function news() {
  // the league-wide feed plus each team's own feed, which carries the smaller player notes
  const j = await getJson(`${ESPN}/news?limit=100`);
  const articles: any[] = [...(j.articles ?? [])];
  try {
    const tj = await getJson(`${ESPN}/teams`);
    const ids: string[] = (tj.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => String(t.team?.id)).filter(Boolean);
    for (let i = 0; i < ids.length; i += 8) {
      const got = await Promise.all(ids.slice(i, i + 8).map((id) => getJson(`${ESPN}/news?team=${id}&limit=15`).catch(() => ({}))));
      for (const g of got) articles.push(...((g as any).articles ?? []));
    }
  } catch (e) { console.error('team news', e); }
  const { all } = await nameIndex();
  const names = all.filter((p) => p.name.length > 6).map((p) => ({ id: p.id, n: p.name.toLowerCase() }));
  const uniq = [...new Map(articles.filter((a) => a?.headline).map((a) => [String(a.id ?? a.links?.web?.href ?? a.headline), a])).values()];
  const rows = uniq.map((a: any) => {
    const text = `${a.headline ?? ''} ${a.description ?? ''}`.toLowerCase();
    return {
      id: String(a.id ?? a.links?.web?.href ?? a.headline),
      headline: a.headline, description: a.description ?? null, published: a.published ?? null,
      url: a.links?.web?.href ?? null, image: a.images?.[0]?.url ?? null,
      player_ids: names.filter((p) => text.includes(p.n)).map((p) => p.id),
    };
  }).filter((r: any) => r.headline);
  if (rows.length) check(await db.from('news').upsert(rows));
  return { articles: rows.length, tagged: rows.filter((r: any) => r.player_ids.length).length };
}

// game day: who starts in goal (ESPN's probable goalies), who's out or a game-time call, and once a game is under
// way, which rostered players were scratched. Today and tomorrow, every 15 minutes through the afternoon and evening
const ymd = (d: string) => d.replaceAll('-', '');
async function gameday() {
  const inj = await injuries();
  const today = await leagueToday();
  const dates = [today, nextDay(today)];
  const { byName } = await nameIndex();
  let rows = 0, events = 0;
  for (const date of dates) {
    const games = check(await db.from('games').select('id,home,away,state').eq('date', date).not('state', 'in', '(PPD,CNCL)')) as
      { id: number; home: string; away: string; state: string }[];
    if (!games.length) { await db.from('player_status').delete().eq('date', date); continue; }
    const teams = [...new Set(games.flatMap((g) => [g.home, g.away]))];
    const goalies = check(await db.from('players').select('id,nhl_team').eq('pos', 'G').in('nhl_team', teams)) as { id: number; nhl_team: string }[];
    const gTeam = new Map(goalies.map((g) => [g.id, g.nhl_team]));
    // ESPN's probable goalies, matched to our goalies by name
    const probables: { team: string; playerId: number; status: 'confirmed' | 'expected'; name: string }[] = [];
    try {
      const sb = await getJson(`${ESPN}/scoreboard?dates=${ymd(date)}`);
      for (const e of sb.events ?? []) for (const c of e.competitions?.[0]?.competitors ?? []) for (const pr of c.probables ?? []) {
        const name = pr.athlete?.displayName ?? '';
        const id = (byName.get(norm(name)) ?? []).find((x) => gTeam.has(x));
        const st = String(pr.status?.name ?? pr.status ?? '').toLowerCase();
        if (id) probables.push({ team: gTeam.get(id)!, playerId: id, status: st.startsWith('confirm') ? 'confirmed' : 'expected', name });
      }
    } catch (e) { console.error('probables', date, e); }
    const injured = (check(await db.from('players').select('id,nhl_team,injury_status,injury_note').in('nhl_team', teams).not('injury_status', 'is', null)) as any[])
      .map((p) => ({ id: p.id, team: p.nhl_team, status: p.injury_status, note: p.injury_note }));
    // scratches: a game under way with a full box score, and a rostered player of those teams isn't in it
    const scratched: { id: number; team: string }[] = [];
    const started = games.filter((g) => STARTED.has(g.state));
    if (started.length) {
      // one entry per player: with several leagues the same player is on several rosters
      const rostered = [...new Map((await every<any>((a, b) => db.from('rosters').select('player_id,league_id,players!inner(nhl_team,pos)')
        .in('players.nhl_team', started.flatMap((g) => [g.home, g.away])).order('league_id').order('player_id').range(a, b)))
        .map((r) => [r.player_id, r])).values()];
      for (const g of started) {
        const { data: box } = await db.from('player_games').select('player_id').eq('game_id', g.id);
        const inBox = new Set((box ?? []).map((b) => b.player_id));
        if (inBox.size < 30) continue;
        for (const r of rostered) if ([g.home, g.away].includes(r.players.nhl_team) && !inBox.has(r.player_id)) scratched.push({ id: r.player_id, team: r.players.nhl_team });
      }
    }
    const next = mergeStatus({ date, games, probables, goalies: goalies.map((g) => ({ id: g.id, team: g.nhl_team })), injured, scratched });
    const { data: prevRows } = await db.from('player_status').select('player_id,status').eq('date', date);
    const prev = new Map((prevRows ?? []).map((r) => [r.player_id as number, r.status as GameStatus]));
    const stamp = new Date().toISOString();
    for (let i = 0; i < next.length; i += 300) check(await db.from('player_status').upsert(next.slice(i, i + 300).map((r) => ({ ...r, updated_at: stamp }))));
    const gone = [...prev.keys()].filter((id) => !next.some((r) => r.player_id === id));
    if (gone.length) check(await db.from('player_status').delete().eq('date', date).in('player_id', gone));
    // the big ones go on the player's news timeline
    const ev = next.filter((r) => (r.status === 'confirmed' || r.status === 'scratched') && prev.get(r.player_id) !== r.status)
      .map((r) => ({ player_id: r.player_id, kind: 'lineup', body: r.status === 'confirmed' ? `Confirmed to start in goal ${r.opponent} (${date})` : `Scratched ${r.opponent}` }));
    if (ev.length) check(await db.from('player_events').insert(ev));
    rows += next.length; events += ev.length;
  }
  return { ...inj, status_rows: rows, events };
}

// (prediction pools, leagues of kind 'predict', have no rosters: every league pass below is for fantasy leagues)
// the lineup auto-pilot: the same exact optimizer the site's "Optimize" button uses, league by league (each on its
// own phase, roster caps and points); one league failing doesn't stop the others
async function autoLineups() {
  const leagues = check(await db.from('leagues').select('id').eq('status', 'active').eq('kind', 'fantasy').order('id')) as { id: number }[];
  const out: Record<number, unknown> = {};
  for (const { id } of leagues) {
    try { out[id] = await autoLineupsFor(id); } catch (e) { console.error('auto lineups, league', id, e); out[id] = { error: String(e) }; }
  }
  return out;
}

async function autoLineupsFor(lid: number) {
  const ldb = dbFor(lid);
  const { data: league } = await ldb.from('league').select('phase,roster').single();
  if (league?.phase !== 'season') return { skipped: league?.phase };
  const today = await leagueToday();
  const teams = check(await db.from('teams').select('id,auto_mode,auto_basis,lineup_touched').eq('league_id', lid).neq('auto_mode', 'off')) as
    { id: number; auto_mode: Mode; auto_basis: Basis; lineup_touched: string | null }[];
  const todo = teams.filter((t) => t.lineup_touched !== today);
  if (!todo.length) return { teams: 0, skipped_manual: teams.length };
  const rows = await every<{ team_id: number; player_id: number; slot: string; pin: string | null }>((a, b) =>
    db.from('rosters').select('team_id,player_id,slot,pin').in('team_id', todo.map((t) => t.id)).order('team_id').order('player_id').range(a, b));
  const ids = rows.map((r) => r.player_id);
  const players = new Map<number, LPlayer>(), season = new Map<number, LSeason>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [ps, ss] = await Promise.all([
      ldb.from('league_players').select('id,pos,elig,proj,proj_gp,nhl_team,injury_status').in('id', chunk),
      ldb.from('player_season').select('player_id,gp,fpts,gp14,fpts14').in('player_id', chunk),
    ]);
    for (const p of check(ps) ?? []) players.set(p.id, { ...p, proj: Number(p.proj), proj_gp: p.proj_gp == null ? null : Number(p.proj_gp) });
    for (const x of check(ss) ?? []) season.set(x.player_id, { gp: Number(x.gp), fpts: Number(x.fpts), gp14: Number(x.gp14 ?? 0), fpts14: x.fpts14 == null ? null : Number(x.fpts14) });
  }
  // every goalie in the league, so a hurt starter's starts can go to his healthy partner
  for (const g of check(await ldb.from('league_players').select('id,pos,elig,proj,proj_gp,nhl_team,injury_status').eq('pos', 'G')) ?? []) {
    if (!players.has(g.id)) players.set(g.id, { ...g, proj: Number(g.proj), proj_gp: g.proj_gp == null ? null : Number(g.proj_gp) });
  }
  // tonight's starting goalies, scratches and injury calls
  for (const s of check(await db.from('player_status').select('player_id,status').eq('date', today)) ?? []) {
    const p = players.get(s.player_id);
    if (p) p.gs = s.status as GameStatus;
  }
  const weekEnd = weekEndOf(today);
  const games = check(await db.from('games').select('home,away,date,start_utc,state').gte('date', today).lte('date', weekEnd));
  const ctx = { today, weekEnd, now: Date.now(), games: games ?? [], season, caps: league.roster as Record<string, number> };
  const out: Record<number, number | string> = {};
  const calls: Record<string, unknown>[] = [];
  for (const t of todo) {
    // lineups are daily, so the best lineup is always today's best; optimize() already breaks ties toward
    // the better player for the season, which is what keeps the right guys in idle slots
    const plan = optimize(rows.filter((r) => r.team_id === t.id), players, 'day', t.auto_basis, ctx);
    if (plan.moves.length) {
      const { error } = await ldb.rpc('apply_auto_lineup', { p_team: t.id, p_slots: Object.fromEntries(plan.moves.map((m) => [m.player_id, m.to])) });
      out[t.id] = error ? `error: ${error.message}` : plan.moves.length;
      if (error) { console.error('auto lineup', t.id, error); continue; }
    } else out[t.id] = 0;
    // the prediction log: what the auto-pilot expects tonight's lineup to score and whom it started, scored once the
    // night is final (score_predictions); the late run's call replaces the morning's
    if (plan.value > 0) calls.push({ league_id: lid, kind: 'auto_lineup', subject: { team_id: t.id, date: today }, predicted: Math.round(plan.value * 100) / 100,
      basis: t.auto_basis, resolves_on: today, detail: { starters: [...plan.slots].filter(([, s]) => STARTING.includes(s)).map(([id]) => id) } });
  }
  if (calls.length) {
    const { error } = await db.from('predictions').upsert(calls, { onConflict: 'league_id,kind,subject' });
    if (error) console.error('auto lineup calls', error.message);
  }
  return { teams: todo.length, skipped_manual: teams.length - todo.length, moves: out, calls: calls.length };
}

// the prediction log's head-to-head win chances: each morning, every points matchup on this week gets the chance the
// site shows for its home side (the points on the board plus the rest of the week played out with each roster), one call
// per matchup and day, scored by score_predictions when the week is over (1 a win, 0 a loss, a half a tie)
async function h2hCalls() {
  const leagues = check(await db.from('leagues').select('id').eq('status', 'active').eq('kind', 'fantasy').order('id')) as { id: number }[];
  const out: Record<number, unknown> = {};
  for (const { id } of leagues) {
    try { out[id] = await h2hCallsFor(id); } catch (e) { console.error('h2h calls, league', id, e); out[id] = { error: String(e) }; }
  }
  return out;
}

async function h2hCallsFor(lid: number) {
  const ldb = dbFor(lid);
  const { data: league } = await ldb.from('league').select('phase,roster,format,categories').single();
  if (league?.phase !== 'season' || league.format !== 'h2h' || (league.categories ?? []).length) return { skipped: 'not a head-to-head points league in season' };
  const today = await leagueToday();
  const ms = ((check(await ldb.rpc('h2h_scores')) ?? []) as { id: number; starts: string; ends: string; home_team: number; away_team: number | null; home_pts: number; away_pts: number | null; status: string }[])
    .filter((m) => m.away_team != null && m.starts <= today && m.ends >= today);
  if (!ms.length) return { calls: 0 };
  const teamIds = [...new Set(ms.flatMap((m) => [m.home_team, m.away_team!]))];
  const rows = check(await ldb.from('rosters').select('team_id,player_id,slot').in('team_id', teamIds).neq('slot', 'IR')) as { team_id: number; player_id: number }[];
  const ids = [...new Set(rows.map((r) => r.player_id))];
  const players = new Map<number, FPlayer>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [ps, ss] = await Promise.all([
      ldb.from('league_players').select('id,pos,elig,proj,proj_gp,nhl_team,injury_status').in('id', chunk),
      ldb.from('player_season').select('player_id,gp,fpts').in('player_id', chunk),
    ]);
    const season = new Map(((check(ss) ?? []) as { player_id: number; gp: number; fpts: number }[]).map((x) => [x.player_id, x]));
    for (const p of (check(ps) ?? []) as FPlayer[]) {
      const s = season.get(p.id), pg = p.proj_gp == null ? null : Number(p.proj_gp);
      players.set(p.id, { ...p, proj_gp: pg, proj: rosPerGame(Number(p.proj), p.pos, Number(s?.gp ?? 0), Number(s?.fpts ?? 0), pg) * gamesOf({ pos: p.pos, proj_gp: pg }) });
    }
  }
  const last = ms.reduce((d, m) => (m.ends > d ? m.ends : d), today);
  const games = check(await db.from('games').select('id,date,home,away,state').gte('date', today).lte('date', last)) ?? [];
  const caps = league.roster as Record<string, number>;
  const rest = (t: number, ends: string) => forecastTeam(t, rows.filter((r) => r.team_id === t).map((r) => players.get(r.player_id)).filter((p): p is FPlayer => !!p), games, caps, today, 0, ends).ros;
  const calls = ms.map((m) => {
    const hr = rest(m.home_team, m.ends), ar = rest(m.away_team!, m.ends);
    const hn = Number(m.home_pts ?? 0), an = Number(m.away_pts ?? 0);
    return { league_id: lid, kind: 'h2h_win', subject: { matchup_id: m.id, date: today }, predicted: Math.round(winChance(hn, hr, an, ar) * 1000) / 1000,
      basis: 'forecast', resolves_on: m.ends, detail: { home_now: hn, home_rest: Math.round(hr * 10) / 10, away_now: an, away_rest: Math.round(ar * 10) / 10 } };
  });
  const { error } = await db.from('predictions').upsert(calls, { onConflict: 'league_id,kind,subject' });
  if (error) console.error('h2h calls', lid, error.message);
  return { calls: error ? 0 : calls.length };
}

// the heavy tasks (every NHL roster, the projection model, weeks of box-score corrections) run for the scheduler,
// which sends the platform's admin key; the public key alone can't start them
const HEAVY = new Set(['players', 'projections', 'corrections']);
async function adminCall(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (!key) return false;
  const { data } = await db.rpc('admin_key_ok', { p_key: key });
  return data === true;
}

Deno.serve(async (req) => {
  const task = new URL(req.url).searchParams.get('task') ?? 'scores';
  if (HEAVY.has(task) && !(await adminCall(req))) return Response.json({ task, ok: false, error: 'This task needs the platform key' }, { status: 403 });
  try {
    const result =
      task === 'schedule' ? await schedule()
      : task === 'season-schedule' ? await seasonSchedule()
      : task === 'projections' ? await projections()
      : task === 'standings' ? await standings()
      : task === 'fund' ? await fundPrice()
      : task === 'players' ? await players()
      : task === 'corrections' ? await corrections(Math.min(35, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 3))))
      : task === 'injuries' ? await injuries()
      : task === 'news' ? await news()
      : task === 'gameday' ? await gameday()
      : task === 'daily' ? { lineups: await autoLineups(), h2h_calls: await h2hCalls() }
      : task === 'lineups-late' ? { lineups: await autoLineups() }
      : await scores();
    return Response.json({ task, ok: true, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
