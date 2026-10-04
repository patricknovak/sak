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
