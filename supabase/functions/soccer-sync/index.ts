// soccer-sync: soccer fixtures and results for prediction pools (migration 148, docs/POOLS.md section 7).
//   ?task=fixtures  (daily) every active competition's clubs and season fixtures
//   ?task=live      (every 2 minutes while a match is on: _soccer_due) the scores and states of today's matches
// Each competition names its provider. API-Football (API_FOOTBALL_KEY, a function secret) is the paid one: without the
// key its competitions are skipped. ESPN's public scoreboard (provider 'espn', ext_id the league's slug, 'eng.1') is free
// and keyless, for testing (Patrick, 6 October 2026), until a licensed feed replaces it. Both tasks need the platform
// key (x-admin-key), as the scheduler sends it. Every request is metered at no price, per provider, so the dashboard
// shows how much each is used.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { afClub, afFixture, API_FOOTBALL, assignRounds, espnClub, espnFixture, espnNinety, ESPN_SOCCER, type NeutralFixture } from '../_shared/soccer.ts';

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

interface Competition { id: string; ext_id: string; ext_season: string; season: string; provider: string }

// deno-lint-ignore no-explicit-any
async function espn(path: string): Promise<any> {
  // ESPN turns away Deno's own user agent (403)
  const r = await fetch(`${ESPN_SOCCER}${path}`, { headers: { 'user-agent': 'SuperPools/1.0', accept: 'application/json' } });
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
    const ninety = st === 'STATUS_FINAL_AET' || st === 'STATUS_FINAL_PEN' ? espnNinety(await espn(`/${slug}/summary?event=${e.id}`).catch(() => null)) : null;
    out.push(espnFixture(e, ninety));
  }
  return out;
}

const month = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

// an ESPN competition's clubs and its whole season, a month at a time; new matches take their round
async function espnSeason(c: Competition) {
  const teams = (await espn(`/${c.ext_id}/teams`))?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  const clubs = teams.map((t: { team: unknown }) => espnClub(t.team));
  const first = await espn(`/${c.ext_id}/scoreboard?dates=${month(new Date())}`);
  const season = first?.leagues?.[0]?.season ?? {};
  const from = new Date(season.startDate ?? Date.now()), to = new Date(season.endDate ?? Date.now());
  // deno-lint-ignore no-explicit-any
  const events = new Map<string, any>();
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    const page = month(d) === month(new Date()) ? first : await espn(`/${c.ext_id}/scoreboard?dates=${month(d)}`);
    for (const e of page?.events ?? []) events.set(String(e.id), e);
  }
  const fx = (await espnFixtures(c.ext_id, [...events.values()])).map((f) => ({ ...f, season: c.season }));
  const known = new Map((check(await db.from('fixtures').select('ext_id,gameweek').eq('competition', c.id)) as { ext_id: string; gameweek: number | null }[])
    .map((f) => [f.ext_id, f.gameweek]));
  const rounds = assignRounds(fx);
  for (const f of fx) if (f.gameweek == null && known.get(f.ext_id) == null) f.gameweek = rounds.get(f.ext_id) ?? null;
  return check(await db.rpc('soccer_ingest', { p_competition: c.id, p: { clubs, fixtures: fx } }));
}

async function fixtures() {
  const comps = check(await db.from('competitions').select('id,ext_id,ext_season,season,provider').eq('active', true).in('provider', ['api-football', 'espn'])) as Competition[];
  const out: Record<string, unknown> = {};
  for (const c of comps) {
    try {
      if (c.provider === 'espn') { out[c.id] = await espnSeason(c); continue; }
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
  const slugs = new Map((check(await db.from('competitions').select('id,ext_id').eq('provider', 'espn')) as { id: string; ext_id: string }[]).map((c) => [c.id, c.ext_id]));
  const byComp = new Map<string, typeof due>();
  for (const f of due) byComp.set(f.competition, [...(byComp.get(f.competition) ?? []), f]);
  const out: Record<string, unknown> = {};
  for (const [comp, list] of byComp) {
    try {
      if (list[0].provider === 'espn') {
        const slug = slugs.get(comp)!;
        const want = new Set(list.map((f) => f.ext_id));
        // deno-lint-ignore no-explicit-any
        const events = new Map<string, any>();
        for (const day of new Set(list.flatMap((f) => espnDays(f.kickoff)))) {
          for (const e of (await espn(`/${slug}/scoreboard?dates=${day}`))?.events ?? []) if (want.has(String(e.id))) events.set(String(e.id), e);
        }
        out[comp] = check(await db.rpc('soccer_ingest', { p_competition: comp, p: { fixtures: await espnFixtures(slug, [...events.values()]) } }));
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
  const task = new URL(req.url).searchParams.get('task') ?? 'live';
  if (!(await adminCall(req))) return Response.json({ task, ok: false, error: 'This task needs the platform key' }, { status: 403 });
  try {
    const result = task === 'fixtures' ? await fixtures() : await live();
    return Response.json({ task, ok: true, calls, espn: espnCalls, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, calls, error: String((e as Error)?.message ?? e) }, { status: 500 });
  } finally {
    if (calls) await db.rpc('meter_cost', { p_league: 0, p_source: 'api-football', p_feature: `soccer.${task}`, p_calls: calls });
    if (espnCalls) await db.rpc('meter_cost', { p_league: 0, p_source: 'espn', p_feature: `soccer.${task}`, p_calls: espnCalls });
  }
});
