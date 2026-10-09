// mlb-sync: baseball's postseason for pool games (migration 165, docs/POOL-TYPES.md §5 and §7), and the Stanley Cup
// playoffs beside it (migration 191).
//   one task: every series of each active MLB competition, with its games, their line scores, probable pitchers and the
//   series state, in one request to MLB's public Stats API, written through sport_ingest(); then each active NHL
//   playoffs competition from the NHL's bracket and each series' schedule (`_shared/nhlPlayoffs.ts`).
// The scheduler calls it every two minutes while a game is on or about to start (_mlb_due) and every half hour
// otherwise, so a later round's clubs and first-pitch times land as soon as MLB sets them.
// The feed: statsapi.mlb.com, free and keyless. Its notice allows individual, non-commercial use; we read it while the
// pools are a private test, and a licensed feed replaces it before anything is sold (§8). It asks for no more than a
// request every ten seconds; we make one every two minutes at most.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { nhlPeriods, nhlPlayoffPayload } from '../_shared/nhlPlayoffs.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const API = 'https://statsapi.mlb.com/api/v1';

const check = <T>({ data, error }: { data: T; error: unknown }) => {
  if (error) throw error;
  return data;
};

// each club's colour, bright enough to read on the app's dark ground
const COLOR: Record<number, string> = {
  108: '#e11d48', 109: '#c2410c', 110: '#f97316', 111: '#ef4444', 112: '#3b82f6', 113: '#ef4444', 114: '#f43f5e', 115: '#a78bfa',
  116: '#fb923c', 117: '#f97316', 118: '#60a5fa', 119: '#3b82f6', 120: '#ef4444', 121: '#f97316', 133: '#22c55e', 134: '#facc15',
  135: '#eab308', 136: '#14b8a6', 137: '#fb923c', 138: '#ef4444', 139: '#38bdf8', 140: '#3b82f6', 141: '#3b82f6', 142: '#ef4444',
  143: '#ef4444', 144: '#f43f5e', 145: '#cbd5e1', 146: '#06b6d4', 147: '#93c5fd', 158: '#facc15',
};
const ROUND: Record<string, number> = { F: 1, D: 2, L: 3, W: 4 };

// deno-lint-ignore no-explicit-any
type J = any;
// a real club (one of the thirty), not MLB's "NL Lower Seed" placeholder for a round still to be set
const real = (t: J) => !!t?.id && t.id in COLOR;
// MLB's stand-in time for a game whose first pitch isn't set: count it as noon Eastern on its date, so nothing locks
// before the earliest a postseason game could start
const firstPitch = (g: J) => (g.status?.startTimeTBD ? `${g.officialDate}T12:00:00-04:00` : g.gameDate);
const shortOf = (label: string) => {
  if (/^World Series/i.test(label)) return 'WS';
  const lg = /^(AL|NL)\b/.exec(label)?.[1] ?? '';
  if (/Wild Card/i.test(label)) return `${lg} WC`.trim();
  if (/Division/i.test(label)) return `${lg}DS`;
  if (/Championship/i.test(label)) return `${lg}CS`;
  return label.slice(0, 12);
};
const stateOf = (g: J) => {
  const d = String(g.status?.detailedState ?? '');
  if (/postponed|suspended/i.test(d)) return 'postponed';
  if (/cancel/i.test(d)) return 'cancelled';
  const a = g.status?.abstractGameState;
  return a === 'Final' ? 'final' : a === 'Live' ? 'live' : 'scheduled';
};

async function season(c: { id: string; ext_season: string }) {
  const r = await fetch(`${API}/schedule/postseason/series?sportId=1&season=${c.ext_season}&hydrate=team,linescore,probablePitcher,seriesStatus`);
  if (!r.ok) throw new Error(`MLB ${r.status}`);
  const j = await r.json();
  const clubs = new Map<string, J>();
  const series: J[] = [];
  const fixtures: J[] = [];
  for (const s of j.series ?? []) {
    const games: J[] = [...(s.games ?? [])].sort((a: J, b: J) => (a.seriesGameNumber ?? 0) - (b.seriesGameNumber ?? 0));
    const g1 = games.find((g) => g.seriesGameNumber === 1) ?? games[0];
    if (!g1) continue;
    const key = `${c.ext_season}:${s.series.id}`;
    for (const g of games) for (const side of ['home', 'away']) {
      const t = g.teams?.[side]?.team;
      if (real(t)) clubs.set(String(t.id), { ext_id: String(t.id), name: t.name, short: t.abbreviation, color: COLOR[t.id] ?? null,
        logo: `https://www.mlbstatic.com/team-logos/team-cap-on-dark/${t.id}.svg` });
    }
    const hi = g1.teams?.home?.team, lo = g1.teams?.away?.team;
    series.push({
      ext_id: key, round: ROUND[s.series.gameType ?? g1.gameType] ?? 1, label: g1.seriesDescription, short: shortOf(g1.seriesDescription ?? ''),
      best_of: g1.gamesInSeries ?? games.length, high: real(hi) ? String(hi.id) : null, low: real(lo) ? String(lo.id) : null,
      starts_at: firstPitch(g1), tbd: !!g1.status?.startTimeTBD || !(real(hi) && real(lo)), sort: s.series.sortNumber ?? 0,
    });
    for (const g of games) {
      const h = g.teams?.home, a = g.teams?.away;
      if (!real(h?.team) || !real(a?.team)) continue;
      const ls = g.linescore ?? {};
      fixtures.push({
        ext_id: String(g.gamePk), series: key, game_no: g.seriesGameNumber, kickoff: firstPitch(g), date: g.officialDate,
        round: g.seriesDescription, gameweek: ROUND[g.gameType] ?? null, state: stateOf(g), status: g.status?.detailedState,
        home: String(h.team.id), away: String(a.team.id), home_score: h.score ?? null, away_score: a.score ?? null, venue: g.venue?.name ?? null,
        detail: {
          hits: { home: ls.teams?.home?.hits ?? null, away: ls.teams?.away?.hits ?? null },
          errors: { home: ls.teams?.home?.errors ?? null, away: ls.teams?.away?.errors ?? null },
          inning: ls.currentInning ?? null, half: ls.inningHalf ?? null, outs: ls.outs ?? null,
          probables: { home: h.probablePitcher?.fullName ?? null, away: a.probablePitcher?.fullName ?? null },
          tbd: !!g.status?.startTimeTBD, if_necessary: g.ifNecessary === 'Y', series_status: g.seriesStatus?.result ?? null,
        },
        periods: (ls.innings ?? []).map((i: J) => ({ n: i.num, home: i.home?.runs ?? null, away: i.away?.runs ?? null })),
      });
    }
  }
  return check(await db.rpc('sport_ingest', { p_competition: c.id, p: { clubs: [...clubs.values()], series, fixtures } }));
}

// the Stanley Cup playoffs: the bracket for the season's spring (ext_season '20262027' is the 2027 bracket), then the
// games of every series whose clubs are set. Before the NHL draws the bracket there is nothing to write.
async function nhlPlayoffs(c: { id: string; ext_season: string }) {
  const NHL = 'https://api-web.nhle.com/v1';
  const r = await fetch(`${NHL}/playoff-bracket/${c.ext_season.slice(4)}`);
  if (r.status === 404) return { series: 0 };
  if (!r.ok) throw new Error(`NHL ${r.status}`);
  const bracket = await r.json();
  if (!bracket?.series?.length) return { series: 0 };
  const games: Record<string, J> = {};
  for (const s of bracket.series) {
    if (!s.topSeedTeam?.id || !s.bottomSeedTeam?.id) continue;
    const g = await fetch(`${NHL}/schedule/playoff-series/${c.ext_season}/${String(s.seriesLetter).toLowerCase()}`);
    if (g.ok) games[String(s.seriesLetter).toUpperCase()] = await g.json();
  }
  // each game's score by period (squares and prop sheets pay from it), for the games on now or over in the last day
  // and a half: a handful of calls a playoff night
  const recent = Object.values(games).flatMap((x: J) => x.games ?? []).filter((g: J) =>
    ['LIVE', 'CRIT'].includes(g.gameState) || (['OFF', 'FINAL'].includes(g.gameState) && Date.now() - Date.parse(g.startTimeUTC) < 36 * 3600e3));
  const periods: Record<string, { n: number; home: number; away: number }[]> = {};
  await Promise.all(recent.map(async (g: J) => {
    const l = await fetch(`${NHL}/gamecenter/${g.id}/landing`).catch(() => null);
    // one bad landing leaves its game without periods this run, never the whole bracket unsynced
    const body = l?.ok ? await l.json().catch(() => null) : null;
    if (body) periods[String(g.id)] = nhlPeriods(body);
  }));
  return check(await db.rpc('sport_ingest', { p_competition: c.id, p: nhlPlayoffPayload(c.ext_season, bracket, games, periods) }));
}

async function adminCall(req: Request) {
  const key = req.headers.get('x-admin-key');
  if (!key) return false;
  const { data } = await db.rpc('admin_key_ok', { p_key: key });
  return data === true;
}

Deno.serve(async (req) => {
  if (!(await adminCall(req))) return Response.json({ ok: false, error: 'This task needs the platform key' }, { status: 403 });
  try {
    const comps = check(await db.from('competitions').select('id,ext_season').eq('active', true).eq('provider', 'mlb-statsapi')) as { id: string; ext_season: string }[];
    const out: Record<string, unknown> = {};
    for (const c of comps) out[c.id] = await season(c);
    const nhl = check(await db.from('competitions').select('id,ext_season').eq('active', true).eq('provider', 'nhl-api')) as { id: string; ext_season: string }[];
    for (const c of nhl) out[c.id] = await nhlPlayoffs(c);
    return Response.json({ ok: true, competitions: out });
  } catch (e) {
    console.error('mlb-sync', e);
    return Response.json({ ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
