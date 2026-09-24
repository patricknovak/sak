// nhl-sync: keeps SaK in step with the NHL.
//   ?task=scores    (every minute via pg_cron) games for yesterday+today, freeze lineups at puck drop, box scores -> fantasy points
//   ?task=schedule  (hourly) the next two weeks of games, so lineups know who plays when
//   ?task=players   (daily) current NHL rosters: trades, call-ups, sweater numbers, headshots
//   ?task=daily     (daily, late morning ET) auto-set lineups for teams that opted in
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { etDate, gameRow, gameStats, NHL, STARTED } from '../_shared/nhl.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const TEAMS = ['ANA','BOS','BUF','CAR','CBJ','CGY','CHI','COL','DAL','DET','EDM','FLA','LAK','MIN','MTL','NJD','NSH','NYI','NYR','OTT','PHI','PIT','SEA','SJS','STL','TBL','TOR','UTA','VAN','VGK','WPG','WSH'];
const POS: Record<string, string> = { C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G' };

const get = async (path: string) => {
  const r = await fetch(`${NHL}${path}`, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};
const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};

async function scores() {
  const now = new Date();
  const days = [etDate(new Date(now.getTime() - 86400000)), etDate(now)];
  const games = (await Promise.all(days.map((d) => get(`/score/${d}`)))).flatMap((j) => j.games ?? []).filter((g: any) => g.gameType === 2); // regular season only
  if (games.length) check(await db.from('games').upsert(games.map(gameRow)));
  const snaps = check(await db.rpc('take_snapshots'));

  const { data: open } = await db.from('games').select('id,state').in('date', days).eq('final_synced', false);
  const todo = (open ?? []).filter((g) => STARTED.has(g.state));
  let lines = 0;
  for (const g of todo) {
    const [box, landing] = await Promise.all([get(`/gamecenter/${g.id}/boxscore`), get(`/gamecenter/${g.id}/landing`)]);
    const date = box.gameDate;
    const rows = gameStats(box, landing).map((l) => ({ game_id: g.id, date, ...l }));
    // only score players we know about (the pool is every NHL player, so this is nearly everyone)
    const ids = check(await db.from('players').select('id').in('id', rows.map((r) => r.player_id))) as { id: number }[];
    const known = new Set(ids.map((p) => p.id));
    const keep = rows.filter((r) => known.has(r.player_id));
    if (keep.length) check(await db.from('player_games').upsert(keep));
    lines += keep.length;
    if (box.gameState === 'OFF') check(await db.from('games').update({ final_synced: true }).eq('id', g.id));
  }
  return { games: games.length, snapshots: snaps, synced: todo.length, lines };
}

async function schedule() {
  const now = new Date();
  const weeks = [etDate(now), etDate(new Date(now.getTime() + 7 * 86400000))];
  const rows = (await Promise.all(weeks.map((d) => get(`/schedule/${d}`))))
    .flatMap((j) => j.gameWeek ?? [])
    .flatMap((w: any) => (w.games ?? []).filter((g: any) => g.gameType === 2).map((g: any) => ({ ...g, gameDate: w.date })))
    .map(gameRow);
  // don't clobber live scores with schedule placeholders
  const { data: started } = await db.from('games').select('id').in('id', rows.map((r) => r.id)).neq('state', 'FUT');
  const skip = new Set((started ?? []).map((g) => g.id));
  const fresh = rows.filter((r) => !skip.has(r.id));
  if (fresh.length) check(await db.from('games').upsert(fresh));
  return { scheduled: fresh.length };
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

Deno.serve(async (req) => {
  const task = new URL(req.url).searchParams.get('task') ?? 'scores';
  try {
    const result =
      task === 'schedule' ? await schedule()
      : task === 'players' ? await players()
      : task === 'daily' ? { lineups: check(await db.rpc('run_auto_lineups')) }
      : await scores();
    return Response.json({ task, ok: true, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
