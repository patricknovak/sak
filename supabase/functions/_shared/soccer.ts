// Soccer data, provider-neutral (migration 148, docs/POOLS.md section 7). Each provider's answer is turned into the same
// rows here, and soccer_ingest() in the database writes them; swapping API-Football for Sportmonks is a new parser,
// not new tables. Never the FPL API, FotMob or SofaScore (their terms forbid this use).

export interface NeutralClub { ext_id: string; name: string; short?: string | null; logo?: string | null }
export interface NeutralFixture {
  ext_id: string; season?: string; round: string | null; gameweek: number | null; kickoff: string; status: string; minute: number | null;
  home: string; away: string; home_club: NeutralClub; away_club: NeutralClub;
  home_score: number | null; away_score: number | null; home_ft: number | null; away_ft: number | null;
  home_pens: number | null; away_pens: number | null; venue: string | null;
  // what the market expected before kick-off, when the provider carries it: each side's chance with the bookmaker's
  // margin taken out, the home side's spread (negative: favoured) and the total; never a bookmaker's name or link
  odds?: NeutralOdds | null;
  // the score by period (football's quarters, soccer's halves) once it has started, from the scoreboard's linescores
  periods?: { n: number; home: number | null; away: number | null }[];
}
export interface NeutralOdds { home: number; away: number; draw: number | null; line: number | null; total: number | null }

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
    odds: e.status?.type?.state === 'pre' ? espnOdds(c) : null,
    periods: started ? espnLines(home, away) : [],
  };
}

// each period's score from a scoreboard event's linescores (prop sheets and squares read it)
function espnLines(home: Any, away: Any) {
  const h: Any[] = home.linescores ?? [], a: Any[] = away.linescores ?? [];
  return Array.from({ length: Math.max(h.length, a.length) }, (_, j) => ({ n: j + 1,
    home: h[j] != null ? num(h[j]?.value ?? h[j]?.displayValue) : null, away: a[j] != null ? num(a[j]?.value ?? a[j]?.displayValue) : null }));
}

// an American price ('-125', '+105') as the chance it implies
function implied(price: unknown): number | null {
  const n = Number(String(price ?? '').replace(/^\+/, ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

// the first bookmaker's closing moneylines on an ESPN event, as chances that add up to one
export function espnOdds(c: Any): NeutralOdds | null {
  const o = (c?.odds ?? [])[0];
  if (!o) return null;
  const ml = o.moneyline ?? {};
  const price = (side: 'home' | 'away' | 'draw') => ml[side]?.close?.odds ?? ml[side]?.open?.odds
    ?? (side === 'draw' ? o.drawOdds?.moneyLine : o[`${side}TeamOdds`]?.moneyLine);
  const h = implied(price('home')), a = implied(price('away')), d = implied(price('draw'));
  if (h == null || a == null) return null;
  const sum = h + a + (d ?? 0);
  const r = (x: number) => Math.round((x / sum) * 1000) / 1000;
  const line = num(o.pointSpread?.home?.close?.line ?? o.pointSpread?.home?.open?.line);
  return { home: r(h), away: r(a), draw: d == null ? null : r(d), line: line == null || !Number.isFinite(line) ? null : line, total: num(o.overUnder) };
}

// a playoff played in single games (the NFL's), as best-of-1 series for sport_ingest: rounds in order (the Pro Bowl
// left out by the caller), each round's AFC games before its NFC games so the two conference finals meet in the last;
// a game keeps ESPN's id with a 'P' so the season's competition keeps its own copy for pick'em. All-star sides
// ('AFC', 'NFC') and teams not yet named are skipped.
const PLAYOFF_STATE: Record<string, string> = { FT: 'final', AET: 'final', PEN: 'final', AWD: 'final', NS: 'scheduled', PST: 'postponed', CANC: 'cancelled', ABD: 'cancelled' };
export function espnPlayoffPayload(rounds: { label?: string }[], pages: Any[]) {
  const clubs = new Map<string, NeutralClub>();
  const series: Any[] = [], fixtures: Any[] = [];
  const named = (e: Any) => {
    const cs = e.competitions?.[0]?.competitors ?? [];
    return cs.length === 2 && !cs.some((x: Any) => !x.team?.id || Number(x.team.id) <= 0 || ['TBD', 'AFC', 'NFC'].includes(String(x.team.abbreviation)));
  };
  const head = (e: Any) => String(e.competitions?.[0]?.notes?.[0]?.headline ?? '');
  const conf = (e: Any) => (/^NFC/i.test(head(e)) ? 'NFC' : /^AFC/i.test(head(e)) ? 'AFC' : '');
  pages.forEach((page, i) => {
    const label = String(rounds[i]?.label ?? `Round ${i + 1}`);
    const code = /wild/i.test(label) ? 'WC' : /divisional/i.test(label) ? 'DIV' : /super/i.test(label) ? 'SB' : /conf|champ/i.test(label) ? 'CC' : `R${i + 1}`;
    const evs = (page?.events ?? []).filter(named).sort((a: Any, b: Any) => (conf(a) === 'NFC' ? 1 : 0) - (conf(b) === 'NFC' ? 1 : 0) || String(a.date).localeCompare(String(b.date)));
    evs.forEach((e: Any, k: number) => {
      const fx = espnFixture(e, null, { week: null, label: null, clock: false });
      clubs.set(fx.home, fx.home_club); clubs.set(fx.away, fx.away_club);
      series.push({ ext_id: `P${e.id}`, round: i + 1, label: head(e).replace(/\s*Playoffs$/i, '') || label, short: conf(e) ? `${conf(e)} ${code}` : code,
        best_of: 1, high: fx.home, low: fx.away, starts_at: fx.kickoff, tbd: false, sort: k + 1 });
      // the score by quarter (overtime a fifth), for squares that pay by the quarter
      const lines = (side: string) => (e.competitions?.[0]?.competitors ?? []).find((x: Any) => x.homeAway === side)?.linescores ?? [];
      const h = lines('home'), a = lines('away');
      const periods = h.map((x: Any, j: number) => ({ n: j + 1, home: Number(x?.value ?? x?.displayValue ?? 0), away: a[j] != null ? Number(a[j]?.value ?? a[j]?.displayValue ?? 0) : null }));
      fixtures.push({ ext_id: `P${e.id}`, series: `P${e.id}`, game_no: 1, kickoff: fx.kickoff, state: PLAYOFF_STATE[fx.status] ?? 'live', status: fx.status,
        home: fx.home, away: fx.away, home_score: fx.home_score, away_score: fx.away_score, venue: fx.venue, periods });
    });
  });
  return { clubs: [...clubs.values()], series, fixtures };
}

// March Madness (migration 201, docs/DEVELOPMENT.md §6 item 7): the men's tournament as 63 single-game series, every slot
// there from the start so the bracket can open before the first game. ESPN's scoreboard (by date, `groups=100`) names
// each game's region and round in its note ("... - East Region - 1st Round") and each team's seed in
// `curatedRank.current`. Within a region the first round goes in the bracket's seed order (1-16, 8-9, 5-12, 4-13, 6-11,
// 3-14, 7-10, 2-15), so a team's seed says which slot it plays in every round to the Elite Eight. The regions go in Final
// Four order: as the competition names them (`competitions.detail.regions`, set when the field is announced), else as
// the Final Four games pair them once they're drawn, else alphabetically. The First Four are left out: a first-round
// slot fills its last team once that game is played.
const SEED_PAIRS = [[1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15]];
const TOURNEY_ROUNDS = ['', 'First Round', 'Second Round', 'Sweet 16', 'Elite Eight', 'Final Four', 'National Championship'];
const tourneyRound = (h: string) => (/first four/i.test(h) ? 0 : /1st round/i.test(h) ? 1 : /2nd round/i.test(h) ? 2 : /sweet 16/i.test(h) ? 3
  : /elite 8|elite eight/i.test(h) ? 4 : /final four/i.test(h) ? 5 : /championship/i.test(h) ? 6 : -1);
const seedSlot = (seed: number) => SEED_PAIRS.findIndex((p) => p.includes(seed));
export function espnTournamentPayload(season: string, pages: Any[], order?: string[] | null) {
  const seen = new Map<string, Any>();
  for (const page of pages) for (const e of page?.events ?? []) seen.set(String(e.id), e);
  const games = [...seen.values()].map((e) => {
    const c = e.competitions?.[0] ?? {};
    const h = String(c.notes?.[0]?.headline ?? '');
    return { e, h, round: tourneyRound(h), region: /- (\w+) Region -/.exec(h)?.[1] ?? null,
      teams: (c.competitors ?? []).filter((x: Any) => x.team?.id && Number(x.team.id) > 0 && String(x.team.abbreviation ?? '') !== 'TBD')
        .map((x: Any) => ({ id: String(x.team.id), seed: Number(x.curatedRank?.current) || null })) };
  }).filter((g) => g.round >= 1).sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)) || String(a.e.id).localeCompare(String(b.e.id)));
  // each team's region and seed, from the rounds that name a region
  const teamRegion = new Map<string, string>(), teamSeed = new Map<string, number>();
  for (const g of games) for (const t of g.teams) { if (g.region) teamRegion.set(t.id, g.region); if (t.seed) teamSeed.set(t.id, t.seed); }
  const named = [...new Set(games.map((g) => g.region).filter(Boolean) as string[])];
  // the order the competition gives stands as given (all four slots exist before a region's first game is listed)
  let regions = order && order.length === 4 ? [...order] : [];
  if (regions.length !== 4) {
    // the Final Four pairs them once its games are drawn
    const ff = games.filter((g) => g.round === 5).map((g) => g.teams.map((t: Any) => teamRegion.get(t.id)).filter(Boolean) as string[]);
    const paired = ff.flat();
    regions = paired.length === 4 && new Set(paired).size === 4 ? paired : [...named].sort();
  }
  const ri = (r: string | null | undefined) => (r ? regions.indexOf(r) : -1);
  const clubs = new Map<string, NeutralClub>();
  const series = new Map<string, Any>();
  const key = (round: number, region: number, pos: number) => `${season}:R${round}:${round <= 4 ? regions[region] : 'N'}:${pos}`;
  // every slot, the later rounds still to be decided
  for (let round = 1; round <= 6; round++) {
    const per = round <= 4 ? 8 >> (round - 1) : 1;
    const groups = round <= 4 ? 4 : round === 5 ? 2 : 1;
    for (let r = 0; r < groups; r++) for (let p = 0; p < per; p++) {
      const pos = round <= 4 ? p : r;
      const region = round <= 4 ? regions[r] : null;
      series.set(key(round, r, pos), { ext_id: key(round, r, pos), round, label: TOURNEY_ROUNDS[round],
        short: round === 1 ? `${region} ${SEED_PAIRS[p][0]}v${SEED_PAIRS[p][1]}` : round <= 4 ? region : round === 5 ? 'Final Four' : 'Final',
        best_of: 1, high: null, low: null, starts_at: null, tbd: true, sort: round <= 4 ? r * per + p + 1 : pos + 1 });
    }
  }
  const fixtures: Any[] = [];
  for (const g of games) {
    const t0 = g.teams[0];
    if (!t0) continue;
    const r = ri(teamRegion.get(t0.id) ?? g.region);
    const s0 = teamSeed.get(t0.id) ?? 0;
    const slot = g.round <= 4 ? (seedSlot(s0) >> (g.round - 1)) : g.round === 5 ? r >> 1 : 0;
    if ((g.round <= 5 && r < 0) || slot < 0) continue;
    const k = key(g.round, g.round <= 4 ? r : g.round === 5 ? slot : 0, slot);
    const sr = series.get(k);
    if (!sr) continue;
    const fx = espnFixture(g.e, null, { week: null, label: null, clock: false });
    // the top of the bracket first: the better seed in a region, the earlier region in the Final Four
    const place = (id: string) => (g.round <= 4 ? (teamSeed.get(id) ?? 99) : ri(teamRegion.get(id)) * 100 + seedSlot(teamSeed.get(id) ?? 0));
    const ids = g.teams.map((t: Any) => t.id).sort((a: string, b: string) => place(a) - place(b));
    sr.high = ids[0] ?? null; sr.low = ids[1] ?? null; sr.tbd = ids.length < 2; sr.starts_at = fx.kickoff;
    for (const [id, club] of [[fx.home, fx.home_club], [fx.away, fx.away_club]] as const) if (g.teams.some((t: Any) => t.id === id)) clubs.set(id, club);
    if (ids.length === 2) fixtures.push({ ext_id: `M${g.e.id}`, series: k, game_no: 1, kickoff: fx.kickoff, state: PLAYOFF_STATE[fx.status] ?? 'live', status: fx.status,
      home: fx.home, away: fx.away, home_score: fx.home_score, away_score: fx.away_score, venue: fx.venue });
  }
  return { clubs: [...clubs.values()], series: [...series.values()], fixtures, regions };
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
