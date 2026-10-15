// soccer-sync: soccer fixtures and results for prediction pools (migration 148, docs/POOLS.md section 7).
//   ?task=fixtures  (daily) every active competition's clubs and season fixtures
//   ?task=live      (every 2 minutes while a match is on: _soccer_due) the scores and states of today's matches
// Each competition names its provider. API-Football (API_FOOTBALL_KEY, a function secret) is the paid one: without the
// key its competitions are skipped. ESPN's public scoreboard (provider 'espn', ext_id the league's slug, 'eng.1') is free
// and keyless, for testing (Patrick, 6 October 2026), until a licensed feed replaces it. Both tasks need the platform
// key (x-admin-key), as the scheduler sends it. Every request is metered at no price, per provider, so the dashboard
// shows how much each is used. ESPN serves other sports the same way: the NFL (migration 171) comes in by week, regular
// season and playoffs, through the same ingest and the same live task, so pick'em has its weeks. A postseason competition
// (`format` 'series', migration 187: the NFL's playoffs) files each playoff game as a best-of-1 series through
// sport_ingest, so the bracket runs on it. The NHL and NBA regular seasons (migration 274) come in night by night, each
// game in its week (?task=fixtures&competition=<id>&full=1 files one whole season).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { nbaPlayoffPayload } from '../_shared/nbaPlayoffs.ts';
import { afClub, afFixture, API_FOOTBALL, assignRounds, espnClub, espnFixture, espnNinety, espnPath, espnPlayoffPayload, espnTournamentPayload, ESPN, type NeutralFixture } from '../_shared/soccer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const KEY = Deno.env.get('API_FOOTBALL_KEY') ?? '';

const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};

let calls = 0, espnCalls = 0;
// deno-lint-ignore no-explicit-any
async function af(path: string): Promise<any[]> {
  const r = await fetch(`${API_FOOTBALL}${path}`, { headers: { 'x-apisports-key': KEY } });
  calls++;
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  const j = await r.json();
  // the provider answers 200 with its complaints in `errors` (a bad key, the day's allowance spent)
  const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
  if (errs?.length) throw new Error(`${path}: ${JSON.stringify(j.errors)}`);
  return j.response ?? [];
}

interface Competition { id: string; sport: string; ext_id: string; ext_season: string; season: string; provider: string; format?: string; detail?: { regions?: string[]; week1?: string } | null }

// deno-lint-ignore no-explicit-any
async function espn(path: string): Promise<any> {
  // ESPN turns away Deno's own user agent (403); the path starts with the sport ('/soccer/eng.1/...', '/football/nfl/...')
  // a path is under the site API; a whole address (the NBA's standings) is fetched as it is
  const r = await fetch(path.startsWith('https://') ? path : `${ESPN}${path}`, { headers: { 'user-agent': 'SuperPools/1.0', accept: 'application/json' } });
  espnCalls++;
  if (!r.ok) throw new Error(`espn ${path}: ${r.status}`);
  return r.json();
}

// a finished match that went past ninety minutes: its summary has the score by period
// deno-lint-ignore no-explicit-any
async function espnFixtures(slug: string, events: any[]): Promise<NeutralFixture[]> {
  const out: NeutralFixture[] = [];
  for (const e of events) {
    const st = e.status?.type?.name;
    const ninety = st === 'STATUS_FINAL_AET' || st === 'STATUS_FINAL_PEN' ? espnNinety(await espn(`/soccer/${slug}/summary?event=${e.id}`).catch(() => null)) : null;
    out.push(espnFixture(e, ninety));
  }
  return out;
}

// a sport that plays in weeks (the NFL): the regular season week by week, then the playoffs as the weeks after it, each
// game keeping ESPN's name for its round ('Wild Card'); its clubs from /teams
async function espnWeeks(c: Competition) {
  const base = `/${espnPath(c.sport, c.ext_id)}`;
  const teams = (await espn(`${base}/teams`))?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const clubs = teams.map((t: { team: unknown }) => espnClub(t.team));
  const first = await espn(`${base}/scoreboard?seasontype=2&week=1`);
  // deno-lint-ignore no-explicit-any
  const cal: any[] = first?.leagues?.[0]?.calendar ?? [];
  // deno-lint-ignore no-explicit-any
  const regular: any[] = cal.find((x) => String(x.value) === '2')?.entries ?? [];
  // the Pro Bowl is an exhibition between all-star sides, not a playoff round
  // deno-lint-ignore no-explicit-any
  const playoffs: any[] = (cal.find((x) => String(x.value) === '3')?.entries ?? []).filter((w: any) => !/pro bowl/i.test(String(w.label ?? '')));
  const weeks = [
    ...regular.map((w, i) => ({ type: 2, value: String(w.value ?? i + 1), week: Number(w.value ?? i + 1), label: `Week ${w.value ?? i + 1}` })),
    ...playoffs.map((w, i) => ({ type: 3, value: String(w.value ?? i + 1), week: regular.length + i + 1, label: String(w.label ?? `Playoffs ${i + 1}`) })),
  ];
  const fx: NeutralFixture[] = [];
  for (const w of weeks) {
    const page = w.type === 2 && w.value === '1' ? first : await espn(`${base}/scoreboard?seasontype=${w.type}&week=${w.value}`);
    for (const e of page?.events ?? []) {
      // the playoff slots are filed before their teams are known; they come in once ESPN names both
      const c0 = e.competitions?.[0]?.competitors ?? [];
      if (c0.length < 2 || c0.some((x: { team?: { id?: unknown; abbreviation?: string } }) => !x.team?.id || Number(x.team.id) <= 0 || ['TBD', 'AFC', 'NFC'].includes(String(x.team.abbreviation)))) continue;
      fx.push({ ...espnFixture(e, null, { week: w.week, label: w.label, clock: false }), season: c.season } as NeutralFixture);
    }
  }
  return check(await db.rpc('soccer_ingest', { p_competition: c.id, p: { clubs, fixtures: fx } }));
}

// a sport that plays every night (the NHL and NBA regular seasons, migration 274): the days ESPN's calendar lists, each
// game filed in its week, Monday to Sunday from the Monday of opening week (`detail.week1`), regular season only and
// between the league's own clubs (no all-star game). The first pull, or one asked for in full, files the whole season;
// after that the next two weeks every day and the later days a seventh at a time, so a game ESPN moves is caught within
// a week. ESPN turns away a range of dates for these leagues, so it is a day a call, eight at a time
async function espnDaily(c: Competition, full: boolean) {
  const base = `/${espnPath(c.sport, c.ext_id)}`;
  const teams = (await espn(`${base}/teams`))?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const clubs = teams.map((t: { team: unknown }) => espnClub(t.team));
  const ours = new Set(teams.map((t: { team?: { id?: unknown } }) => String(t.team?.id)));
  const week1 = Date.parse(`${c.detail?.week1}T00:00:00Z`);
  const day = 864e5, today = Date.parse(`${etDay(new Date())}T00:00:00Z`);
  const first = await espn(`${base}/scoreboard?dates=${etDay(new Date()).replaceAll('-', '')}`);
  const { count } = await db.from('fixtures').select('id', { count: 'exact', head: true }).eq('competition', c.id);
  const all = full || !count;
  const days = ((first?.leagues?.[0]?.calendar ?? []) as string[]).map((d) => String(d).slice(0, 10))
    .filter((d) => Date.parse(`${d}T00:00:00Z`) >= week1)
    .filter((d) => {
      const t = Date.parse(`${d}T00:00:00Z`);
      return all || (t >= today - 2 * day && t <= today + 13 * day) || (t > today && Math.round((t - today) / day) % 7 === Math.round(today / day) % 7);
    });
  const fx: NeutralFixture[] = [];
  for (let i = 0; i < days.length; i += 8) {
    const pages = await Promise.all(days.slice(i, i + 8).map((d) => espn(`${base}/scoreboard?dates=${d.replaceAll('-', '')}&limit=100`).then((pg) => ({ d, pg }))));
    for (const { d, pg } of pages) {
      const week = Math.floor((Date.parse(`${d}T00:00:00Z`) - week1) / (7 * day)) + 1;
      for (const e of pg?.events ?? []) {
        const teamIds = (e.competitions?.[0]?.competitors ?? []).map((x: { team?: { id?: unknown } }) => String(x.team?.id));
        if (Number(e.season?.type) !== 2 || teamIds.length !== 2 || !teamIds.every((id: string) => ours.has(id))) continue;
        // the NBA Cup final is filed as a regular-season game but doesn't count in the standings, so it stays out
        if (e.competitions?.[0]?.type?.abbreviation === 'CC') continue;
        fx.push({ ...espnFixture(e, null, { week, label: `Week ${week}`, clock: false }), season: c.season } as NeutralFixture);
      }
    }
  }
  return { days: days.length, ...check(await db.rpc('soccer_ingest', { p_competition: c.id, p: { clubs, fixtures: fx } })) };
}

// a postseason played in single games, filed as best-of-1 series (the bracket's shape): each playoff round's page, then
// espnPlayoffPayload turns them into series and their games
async function espnPlayoffSeries(c: Competition) {
  const base = `/${espnPath(c.sport, c.ext_id)}`;
  const season = c.ext_season ? `dates=${c.ext_season}&` : '';
  const first = await espn(`${base}/scoreboard?${season}seasontype=2&week=1`);
  // deno-lint-ignore no-explicit-any
  const cal: any[] = first?.leagues?.[0]?.calendar ?? [];
  // deno-lint-ignore no-explicit-any
  const rounds: any[] = (cal.find((x) => String(x.value) === '3')?.entries ?? []).filter((w: any) => !/pro bowl/i.test(String(w.label ?? '')));
  const pages = [];
  for (const w of rounds) pages.push(await espn(`${base}/scoreboard?${season}seasontype=3&week=${w.value}`));
  return check(await db.rpc('sport_ingest', { p_competition: c.id, p: espnPlayoffPayload(rounds, pages) }));
}

// March Madness (migration 201): the tournament day by day, from the week before the First Four to the final; outside
// March and early April there is nothing to fetch, so the rest of the year costs no requests
async function espnTournament(c: Competition) {
  const y = Number(c.ext_season), now = Date.now();
  const from = Date.UTC(y, 2, 12), to = Date.UTC(y, 3, 10);
  if (now < from - 7 * 864e5 || now > to + 7 * 864e5) return { series: 0 };
  const pages = [];
  for (let t = from; t <= to; t += 864e5) {
    const day = new Date(t).toISOString().slice(0, 10).replaceAll('-', '');
    pages.push(await espn(`/${espnPath(c.sport, c.ext_id)}/scoreboard?dates=${day}&groups=100&limit=100`));
  }
  const p = espnTournamentPayload(c.ext_season, pages, c.detail?.regions ?? null);
  return check(await db.rpc('sport_ingest', { p_competition: c.id, p: { clubs: p.clubs, series: p.series, fixtures: p.fixtures } }));
}
// the NBA playoffs (migration 220): the seeds from the standings, then the postseason day by day from mid-April to
// late June, or on a live run only yesterday, today and tomorrow (each game finds its own series); outside those months
// there is nothing to fetch, so the rest of the year costs no requests
async function espnNba(c: Competition, full: boolean) {
  const y = Number(c.ext_season), now = Date.now();
  const from = Date.UTC(y, 3, 12), to = Date.UTC(y, 5, 25);
  if (now < from - 7 * 864e5 || now > to + 7 * 864e5) return { series: 0 };
  const standings = await espn(`https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${y}`);
  const days: string[] = [];
  const ny = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t)).replaceAll('-', '');
  if (full) for (let t = from; t <= Math.min(to, now + 7 * 864e5); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10).replaceAll('-', ''));
  else for (const d of [-1, 0, 1]) days.push(ny(now + d * 864e5));
  const pages = [];
  for (const day of days) pages.push(await espn(`/${espnPath(c.sport, c.ext_id)}/scoreboard?dates=${day}&limit=100`));
  return check(await db.rpc('sport_ingest', { p_competition: c.id, p: nbaPlayoffPayload(c.ext_season, pages, standings, full) }));
}
// a postseason in series: the NFL's playoff weeks, a tournament by the day, or the NBA's series; a live run of the
// NBA's sends only the days around now
const espnPostseason = (c: Competition, full = true) =>
  (c.sport === 'ncaab' ? espnTournament(c) : c.sport === 'nba' ? espnNba(c, full) : espnPlayoffSeries(c));

// a date in New York, as 'YYYY-MM-DD' (ESPN files a night's games under it)
const etDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const month = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// an ESPN competition's clubs and its whole season, a month at a time; new matches take their round
async function espnSeason(c: Competition, full = false) {
  if (c.format === 'series') return espnPostseason(c);
  if (c.detail?.week1) return espnDaily(c, full);
  if (c.sport !== 'soccer') return espnWeeks(c);
  const teams = (await espn(`/soccer/${c.ext_id}/teams`))?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const clubs = teams.map((t: { team: unknown }) => espnClub(t.team));
  const first = await espn(`/soccer/${c.ext_id}/scoreboard?dates=${month(new Date())}`);
  const season = first?.leagues?.[0]?.season ?? {};
  const from = new Date(season.startDate ?? Date.now()), to = new Date(season.endDate ?? Date.now());
  // deno-lint-ignore no-explicit-any
  const events = new Map<string, any>();
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const page = month(d) === month(new Date()) ? first : await espn(`/soccer/${c.ext_id}/scoreboard?dates=${month(d)}`);
    for (const e of page?.events ?? []) events.set(String(e.id), e);
  }
  const fx = (await espnFixtures(c.ext_id, [...events.values()])).map((f) => ({ ...f, season: c.season }));
  const known = new Map((check(await db.from('fixtures').select('ext_id,gameweek').eq('competition', c.id)) as { ext_id: string; gameweek: number | null }[])
    .map((f) => [f.ext_id, f.gameweek]));
  const rounds = assignRounds(fx);
  for (const f of fx) if (f.gameweek == null && known.get(f.ext_id) == null) f.gameweek = rounds.get(f.ext_id) ?? null;
  return check(await db.rpc('soccer_ingest', { p_competition: c.id, p: { clubs, fixtures: fx } }));
}

// every active competition, or the one asked for (`competition`); `full` files a nightly season whole
async function fixtures(only: string | null, full: boolean) {
  let q = db.from('competitions').select('id,sport,ext_id,ext_season,season,provider,format,detail').eq('active', true).in('provider', ['api-football', 'espn']);
  if (only) q = q.eq('id', only);
  const comps = check(await q) as Competition[];
  const out: Record<string, unknown> = {};
  for (const c of comps) {
    try {
      if (c.provider === 'espn') { out[c.id] = await espnSeason(c, full); continue; }
      if (!KEY) { out[c.id] = { skipped: 'No API_FOOTBALL_KEY secret yet' }; continue; }
      const clubs = (await af(`/teams?league=${c.ext_id}&season=${c.ext_season}`)).map(afClub);
      const fx = (await af(`/fixtures?league=${c.ext_id}&season=${c.ext_season}`)).map((x) => ({ ...afFixture(x), season: c.season }));
      out[c.id] = check(await db.rpc('soccer_ingest', { p_competition: c.id, p: { clubs, fixtures: fx } }));
    } catch (e) {
      console.error('fixtures', c.id, e);
      out[c.id] = { error: String((e as Error)?.message ?? e) };
    }
  }
  return { competitions: out };
}

// the dates ESPN files a match under: its day in New York and in UTC
const espnDays = (kickoff: string) => {
  const t = new Date(kickoff);
  const ny = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t).replaceAll('-', '');
  return [ny, t.toISOString().slice(0, 10).replaceAll('-', '')];
};

async function live() {
  const now = Date.now();
  const due = check(await db.from('fixtures').select('ext_id,competition,provider,kickoff')
    .in('provider', ['api-football', 'espn']).in('state', ['scheduled', 'live'])
    .gte('kickoff', new Date(now - 4 * 3600e3).toISOString()).lte('kickoff', new Date(now + 5 * 60e3).toISOString())) as
    { ext_id: string; competition: string; provider: string; kickoff: string }[];
  const comps = new Map((check(await db.from('competitions').select('id,sport,ext_id,ext_season,season,provider,format,detail').eq('provider', 'espn')) as Competition[]).map((c) => [c.id, c]));
  const byComp = new Map<string, typeof due>();
  for (const f of due) byComp.set(f.competition, [...(byComp.get(f.competition) ?? []), f]);
  const out: Record<string, unknown> = {};
  for (const [comp, list] of byComp) {
    try {
      if (list[0].provider === 'espn') {
        const c = comps.get(comp)!;
        // a postseason in series: its few playoff weeks again, whole
        if (c.format === 'series') { out[comp] = await espnPostseason(c, false); continue; }
        const want = new Set(list.map((f) => f.ext_id));
        // deno-lint-ignore no-explicit-any
        const events = new Map<string, any>();
        for (const day of new Set(list.flatMap((f) => espnDays(f.kickoff)))) {
          for (const e of (await espn(`/${espnPath(c.sport, c.ext_id)}/scoreboard?dates=${day}`))?.events ?? []) if (want.has(String(e.id))) events.set(String(e.id), e);
        }
        // a game's week was set by the season pull; a live update keeps it (the ingest keeps a round it isn't sent)
        const fx = c.sport === 'soccer' ? await espnFixtures(c.ext_id, [...events.values()])
          : [...events.values()].map((e) => espnFixture(e, null, { week: null, label: null, clock: false }));
        out[comp] = check(await db.rpc('soccer_ingest', { p_competition: comp, p: { fixtures: fx } }));
        continue;
      }
      if (!KEY) continue;
      const ids = list.map((f) => f.ext_id);
      // up to twenty matches a request
      for (let i = 0; i < ids.length; i += 20) {
        const fx = (await af(`/fixtures?ids=${ids.slice(i, i + 20).join('-')}`)).map(afFixture);
        out[comp] = check(await db.rpc('soccer_ingest', { p_competition: comp, p: { fixtures: fx } }));
      }
    } catch (e) {
      console.error('live', comp, e);
      out[comp] = { error: String((e as Error)?.message ?? e) };
    }
  }
  return { matches: due.length, competitions: out };
}

async function adminCall(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (!key) return false;
  const { data } = await db.rpc('admin_key_ok', { p_key: key });
  return data === true;
}

Deno.serve(async (req) => {
  const url = new URL(req.url), task = url.searchParams.get('task') ?? 'live';
  if (!(await adminCall(req))) return Response.json({ task, ok: false, error: 'This task needs the platform key' }, { status: 403 });
  try {
    const result = task === 'fixtures' ? await fixtures(url.searchParams.get('competition'), url.searchParams.get('full') === '1') : await live();
    return Response.json({ task, ok: true, calls, espn: espnCalls, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, calls, error: String((e as Error)?.message ?? e) }, { status: 500 });
  } finally {
    if (calls) await db.rpc('meter_cost', { p_league: 0, p_source: 'api-football', p_feature: `soccer.${task}`, p_calls: calls });
    if (espnCalls) await db.rpc('meter_cost', { p_league: 0, p_source: 'espn', p_feature: `soccer.${task}`, p_calls: espnCalls });
  }
});
