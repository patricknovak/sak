// Soccer data, provider-neutral (migration 148, docs/POOLS.md section 7). Each provider's answer is turned into the same
// rows here, and soccer_ingest() in the database writes them; swapping API-Football for Sportmonks is a new parser,
// not new tables. Never the FPL API, FotMob or SofaScore (their terms forbid this use).

export interface NeutralClub { ext_id: string; name: string; short?: string | null; logo?: string | null }
export interface NeutralFixture {
  ext_id: string; season?: string; round: string | null; gameweek: number | null; kickoff: string; status: string; minute: number | null;
  home: string; away: string; home_club: NeutralClub; away_club: NeutralClub;
  home_score: number | null; away_score: number | null; home_ft: number | null; away_ft: number | null;
  home_pens: number | null; away_pens: number | null; venue: string | null;
}

// ───────────── API-Football (v3.football.api-sports.io) ─────────────
export const API_FOOTBALL = 'https://v3.football.api-sports.io';

// the matchweek in a round's name: 'Regular Season - 8' is 8; a cup round ('Round of 16') has none
export function gameweekOf(round: string | null | undefined): number | null {
  const m = /(?:Regular Season|Matchday|Matchweek|Week)\s*-?\s*(\d+)/i.exec(round ?? '');
  return m ? Number(m[1]) : null;
}

const num = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x));

// deno-lint-ignore no-explicit-any
type Any = any;

// one item of /fixtures' response
export function afFixture(x: Any): NeutralFixture {
  const f = x.fixture ?? {}, t = x.teams ?? {}, g = x.goals ?? {}, s = x.score ?? {};
  const status = String(f.status?.short ?? 'NS');
  const club = (c: Any): NeutralClub => ({ ext_id: String(c?.id), name: String(c?.name ?? ''), logo: c?.logo ?? null });
  // the ninety-minute score: the provider's fulltime once the match is past it, the running score while it's on
  const ninety = ['FT', 'AET', 'PEN', 'AWD', 'WO', 'ET', 'BT', 'P'].includes(status);
  return {
    ext_id: String(f.id),
    round: x.league?.round ?? null,
    gameweek: gameweekOf(x.league?.round),
    kickoff: new Date(f.date ?? (f.timestamp ? f.timestamp * 1000 : 0)).toISOString(),
    status,
    minute: num(f.status?.elapsed),
    home: String(t.home?.id), away: String(t.away?.id),
    home_club: club(t.home), away_club: club(t.away),
    home_score: num(g.home), away_score: num(g.away),
    home_ft: ninety ? num(s.fulltime?.home) : null, away_ft: ninety ? num(s.fulltime?.away) : null,
    home_pens: num(s.penalty?.home), away_pens: num(s.penalty?.away),
    venue: f.venue?.name ? [f.venue.name, f.venue.city].filter(Boolean).join(', ') : null,
  };
}

// one item of /teams' response
export function afClub(x: Any): NeutralClub {
  return { ext_id: String(x.team?.id), name: String(x.team?.name ?? ''), short: x.team?.code ?? null, logo: x.team?.logo ?? null };
}

// ───────────── ESPN's public scoreboard (for testing; docs/POOL-TYPES.md §8) ─────────────
// Free and keyless, so pools have real matches while we test; a licensed feed replaces it before anyone pays. The
// statuses are turned into API-Football's short codes, which each sport's config maps to our states (the NFL's row reads
// the same codes, migration 171). A competition's `ext_id` is a soccer league's slug ('eng.1') or, for another sport,
// its path under ESPN's sports ('football/nfl').
export const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
export const ESPN_SOCCER = `${ESPN}/soccer`;
export const espnPath = (sport: string, extId: string) => (sport === 'soccer' ? `soccer/${extId}` : extId);

const ESPN_STATUS: Record<string, string> = {
  STATUS_SCHEDULED: 'NS', STATUS_DELAYED: 'NS', STATUS_FIRST_HALF: '1H', STATUS_HALFTIME: 'HT', STATUS_SECOND_HALF: '2H',
  STATUS_IN_PROGRESS: 'LIVE', STATUS_END_OF_REGULATION: 'BT', STATUS_OVERTIME: 'ET', STATUS_EXTRA_TIME: 'ET',
  STATUS_HALFTIME_ET: 'BT', STATUS_END_OF_EXTRATIME: 'BT', STATUS_SHOOTOUT: 'P', STATUS_FULL_TIME: 'FT', STATUS_FINAL: 'FT',
  STATUS_FINAL_AET: 'AET', STATUS_FINAL_PEN: 'PEN', STATUS_POSTPONED: 'PST', STATUS_CANCELED: 'CANC', STATUS_ABANDONED: 'ABD',
  STATUS_SUSPENDED: 'SUSP', STATUS_FORFEIT: 'AWD',
};
export function espnStatus(t: Any): string {
  return ESPN_STATUS[String(t?.name ?? '')] ?? (t?.state === 'pre' ? 'NS' : t?.state === 'in' ? 'LIVE' : t?.completed ? 'FT' : 'NS');
}

// a club from /teams, or from a fixture's competitor
export function espnClub(t: Any): NeutralClub {
  return { ext_id: String(t?.id), name: String(t?.displayName ?? t?.name ?? ''), short: t?.abbreviation ?? null,
    logo: t?.logo ?? t?.logos?.[0]?.href ?? null };
}

// one event of /scoreboard; ninety is the score after the two halves when it differs from the final (extra time),
// read from the match's summary by the caller. A sport with its own rounds (the NFL's weeks) passes the round's number
// and name, and its clock counts down a quarter, so it has no match minute.
export function espnFixture(e: Any, ninety?: { home: number; away: number } | null, round?: { week: number | null; label: string | null; clock?: boolean }): NeutralFixture {
  const c = e.competitions?.[0] ?? {};
  const home = (c.competitors ?? []).find((x: Any) => x.homeAway === 'home') ?? {};
  const away = (c.competitors ?? []).find((x: Any) => x.homeAway === 'away') ?? {};
  const status = espnStatus(e.status?.type);
  const started = e.status?.type?.state !== 'pre' && !['PST', 'CANC'].includes(status);
  const final = ['FT', 'AET', 'PEN', 'AWD'].includes(status);
  const hs = started ? num(home.score) : null, as = started ? num(away.score) : null;
  const note = (c.notes ?? []).map((n: Any) => n?.headline).find((h: Any) => /matchday|matchweek|round|final|leg/i.test(String(h ?? ''))) ?? null;
  const v = c.venue ?? e.venue ?? {};
  return {
    ext_id: String(e.id),
    round: round ? round.label : note,
    gameweek: round ? round.week : gameweekOf(note),
    kickoff: new Date(e.date).toISOString(),
    status,
    minute: e.status?.type?.state === 'in' && round?.clock !== false ? num(String(e.status?.displayClock ?? '').match(/^\d+/)?.[0]) : null,
    home: String(home.team?.id), away: String(away.team?.id),
    home_club: espnClub(home.team), away_club: espnClub(away.team),
    home_score: hs, away_score: as,
    home_ft: final ? (ninety ? ninety.home : hs) : null, away_ft: final ? (ninety ? ninety.away : as) : null,
    home_pens: num(home.shootoutScore), away_pens: num(away.shootoutScore),
    venue: v.fullName ? [v.fullName, v.address?.city].filter(Boolean).join(', ') : null,
  };
}

// the score after ninety minutes from a match summary's periods (the first two)
export function espnNinety(summary: Any): { home: number; away: number } | null {
  const cs = summary?.header?.competitions?.[0]?.competitors ?? [];
  const side = (h: string) => cs.find((x: Any) => x.homeAway === h)?.linescores;
  const h = side('home'), a = side('away');
  if (!h || !a || h.length < 2 || a.length < 2) return null;
  const sum = (l: Any[]) => Number(l[0]?.displayValue ?? l[0]?.value ?? 0) + Number(l[1]?.displayValue ?? l[1]?.value ?? 0);
  return { home: sum(h), away: sum(a) };
}

// ESPN has no matchweek for a league, so the season is cut into rounds: in kickoff order, a match joins the current
// round unless one of its clubs already plays in it or it starts more than four days after the round's first match.
// Only matches that don't have a round yet take one, so a postponement never renumbers a round pools already use.
export function assignRounds(fx: NeutralFixture[]): Map<string, number> {
  const out = new Map<string, number>();
  const live = fx.filter((f) => !['CANC', 'ABD'].includes(f.status)).sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  let n = 0, start = 0, clubs = new Set<string>();
  for (const f of live) {
    const t = Date.parse(f.kickoff);
    if (!n || clubs.has(f.home) || clubs.has(f.away) || t - start > 4 * 864e5) { n++; start = t; clubs = new Set(); }
    clubs.add(f.home); clubs.add(f.away);
    out.set(f.ext_id, n);
  }
  return out;
}
