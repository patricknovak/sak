// soccer-sync: soccer fixtures and results for prediction pools (migration 148, docs/POOLS.md section 7).
//   ?task=fixtures  (daily) every active competition's clubs and season fixtures
//   ?task=live      (every 2 minutes while a match is on: _soccer_due) the scores and states of today's matches
// The provider is API-Football (API_FOOTBALL_KEY, a function secret). Without the key every task says so and stops.
// The requests are the provider's daily allowance, so both tasks need the platform key (x-admin-key), as the scheduler
// sends it. The plan is a fixed monthly bill (entered on the Costs page); each request is metered at no price so the
// dashboard shows how much of the allowance is used.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { afClub, afFixture, API_FOOTBALL } from '../_shared/soccer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const KEY = Deno.env.get('API_FOOTBALL_KEY') ?? '';

const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};

let calls = 0;
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

async function fixtures() {
  const comps = check(await db.from('competitions').select('id,ext_id,ext_season,season,provider').eq('active', true).eq('provider', 'api-football')) as Competition[];
  const out: Record<string, unknown> = {};
  for (const c of comps) {
    try {
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

async function live() {
  const now = Date.now();
  const due = check(await db.from('fixtures').select('ext_id,competition')
    .eq('provider', 'api-football').in('state', ['scheduled', 'live'])
    .gte('kickoff', new Date(now - 4 * 3600e3).toISOString()).lte('kickoff', new Date(now + 5 * 60e3).toISOString())) as
    { ext_id: string; competition: string }[];
  const byComp = new Map<string, string[]>();
  for (const f of due) byComp.set(f.competition, [...(byComp.get(f.competition) ?? []), f.ext_id]);
  const out: Record<string, unknown> = {};
  for (const [comp, ids] of byComp) {
    // up to twenty matches a request
    for (let i = 0; i < ids.length; i += 20) {
      const fx = (await af(`/fixtures?ids=${ids.slice(i, i + 20).join('-')}`)).map(afFixture);
      out[comp] = check(await db.rpc('soccer_ingest', { p_competition: comp, p: { fixtures: fx } }));
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
  if (!KEY) return Response.json({ task, ok: true, skipped: 'No API_FOOTBALL_KEY secret yet' });
  try {
    const result = task === 'fixtures' ? await fixtures() : await live();
    return Response.json({ task, ok: true, calls, ...result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, calls, error: String((e as Error)?.message ?? e) }, { status: 500 });
  } finally {
    if (calls) await db.rpc('meter_cost', { p_league: 0, p_source: 'api-football', p_feature: `soccer.${task}`, p_calls: calls });
  }
});
