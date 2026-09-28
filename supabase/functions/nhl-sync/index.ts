// nhl-sync: keeps SaK in step with the NHL.
//   ?task=scores       (every minute) games for yesterday+today, freeze lineups at puck drop, box scores -> fantasy points
//   ?task=corrections  (daily) re-pull the last 3 days of finished games so NHL stat corrections flow into points;
//                      &days=21 (weekly) reaches further back for late corrections. GMs whose starters moved are told.
//   ?task=schedule     (hourly) the next six weeks of games, so lineups can be set a month ahead
//   ?task=season-schedule (daily) every remaining game of the season, for rest-of-season forecasts
//   ?task=projections  (weekly) the SAK projection model: three seasons of NHL stats -> a projected line per player
//   ?task=players      (daily) current NHL rosters: trades, call-ups, sweater numbers, headshots
//   ?task=injuries     (hourly) injury / suspension status from ESPN's public injury report
//   ?task=news         (every 2 hours) NHL headlines, tagged with the players they mention
//   ?task=daily        (late morning ET) lineup auto-pilot for teams that turned it on: today's best lineup
//   ?task=lineups-late (before puck drop) the auto-pilot again, for late scratches and injuries; skips any team
//                      whose GM moved players by hand today
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { etDate, gameRow, gameStats, NHL, STARTED } from '../_shared/nhl.ts';
import { optimize, weekEndOf, type Basis, type LPlayer, type LSeason, type Mode } from '../_shared/lineup.ts';
import { projectAll, type GoalieSeason, type ProjPlayer, type SkaterSeason } from '../_shared/projections.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
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
const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// faceoffs need the (large) play-by-play feed, so only fetch it when the league scores them
async function needsPbp() {
  const { data } = await db.from('league').select('scoring').single();
  const sk = (data?.scoring?.skater ?? {}) as Record<string, number>;
  return !!(sk.fow || sk.fol);
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
  return { games: games.length, snapshots: snaps, synced: todo.length, lines };
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
  const have = new Map<number, string[]>();
  for (let i = 0; i < seen.length; i += 300) {
    const chunk = check(await db.from('players').select('id,elig').in('id', seen.slice(i, i + 300).map((p) => p.id))) as { id: number; elig: string[] }[];
    for (const p of chunk) have.set(p.id, p.elig);
  }
  const rows = seen.map((p) => ({ ...p, elig: have.get(p.id) ?? [p.pos], updated_at: new Date().toISOString() }));
  for (let i = 0; i < rows.length; i += 300) check(await db.from('players').upsert(rows.slice(i, i + 300)));
  return { players: rows.length, added: rows.filter((r) => !have.has(r.id)).length };
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
  const { data: listed } = await db.from('players').select('id').not('injury_status', 'is', null);
  const cleared = (listed ?? []).map((p) => p.id).filter((id) => !found.has(id));
  if (cleared.length) check(await db.from('players').update({ injury_status: null, injury_note: null, injury_date: null }).in('id', cleared));
  for (const [id, v] of found) check(await db.from('players').update(v).eq('id', id));
  return { injured: found.size, cleared: cleared.length };
}

async function news() {
  const j = await getJson(`${ESPN}/news?limit=50`);
  const { all } = await nameIndex();
  const names = all.filter((p) => p.name.length > 6).map((p) => ({ id: p.id, n: p.name.toLowerCase() }));
  const rows = (j.articles ?? []).map((a: any) => {
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

// the lineup auto-pilot: the same exact optimizer the site's "Optimize" button uses
async function autoLineups() {
  const { data: league } = await db.from('league').select('phase,roster').single();
  if (league?.phase !== 'season') return { skipped: league?.phase };
  const today = etDate(new Date());
  const teams = check(await db.from('teams').select('id,auto_mode,auto_basis,lineup_touched').neq('auto_mode', 'off')) as
    { id: number; auto_mode: Mode; auto_basis: Basis; lineup_touched: string | null }[];
  const todo = teams.filter((t) => t.lineup_touched !== today);
  if (!todo.length) return { teams: 0, skipped_manual: teams.length };
  const rows = check(await db.from('rosters').select('team_id,player_id,slot,pin').in('team_id', todo.map((t) => t.id))) as
    { team_id: number; player_id: number; slot: string; pin: string | null }[];
  const ids = rows.map((r) => r.player_id);
  const players = new Map<number, LPlayer>(), season = new Map<number, LSeason>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [ps, ss] = await Promise.all([
      db.from('players').select('id,pos,elig,proj,proj_gp,nhl_team,injury_status').in('id', chunk),
      db.from('player_season').select('player_id,gp,fpts,gp14,fpts14').in('player_id', chunk),
    ]);
    for (const p of check(ps) ?? []) players.set(p.id, { ...p, proj: Number(p.proj), proj_gp: p.proj_gp == null ? null : Number(p.proj_gp) });
    for (const x of check(ss) ?? []) season.set(x.player_id, { gp: Number(x.gp), fpts: Number(x.fpts), gp14: Number(x.gp14 ?? 0), fpts14: x.fpts14 == null ? null : Number(x.fpts14) });
  }
  // every goalie in the league, so a hurt starter's starts can go to his healthy partner
  for (const g of check(await db.from('players').select('id,pos,elig,proj,proj_gp,nhl_team,injury_status').eq('pos', 'G')) ?? []) {
    if (!players.has(g.id)) players.set(g.id, { ...g, proj: Number(g.proj), proj_gp: g.proj_gp == null ? null : Number(g.proj_gp) });
  }
  const weekEnd = weekEndOf(today);
  const games = check(await db.from('games').select('home,away,date,start_utc,state').gte('date', today).lte('date', weekEnd));
  const ctx = { today, weekEnd, now: Date.now(), games: games ?? [], season, caps: league.roster as Record<string, number> };
  const out: Record<number, number | string> = {};
  for (const t of todo) {
    // lineups are daily, so the best lineup is always today's best; optimize() already breaks ties toward
    // the better player for the season, which is what keeps the right guys in idle slots
    const plan = optimize(rows.filter((r) => r.team_id === t.id), players, 'day', t.auto_basis, ctx);
    if (!plan.moves.length) { out[t.id] = 0; continue; }
    const { error } = await db.rpc('apply_auto_lineup', { p_team: t.id, p_slots: Object.fromEntries(plan.moves.map((m) => [m.player_id, m.to])) });
    out[t.id] = error ? `error: ${error.message}` : plan.moves.length;
    if (error) console.error('auto lineup', t.id, error);
  }
  return { teams: todo.length, skipped_manual: teams.length - todo.length, moves: out };
}

Deno.serve(async (req) => {
  const task = new URL(req.url).searchParams.get('task') ?? 'scores';
  try {
    const result =
      task === 'schedule' ? await schedule()
      : task === 'season-schedule' ? await seasonSchedule()
      : task === 'projections' ? await projections()
      : task === 'players' ? await players()
      : task === 'corrections' ? await corrections(Math.min(35, Math.max(1, Number(new URL(req.url).searchParams.get('days') ?? 3))))
      : task === 'injuries' ? await injuries()
      : task === 'news' ? await news()
      : task === 'daily' || task === 'lineups-late' ? { lineups: await autoLineups() }
      : await scores();
    return Response.json({ task, ok: true, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
