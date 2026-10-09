// The Stanley Cup playoffs as series for pool games (docs/POOL-TYPES.md §9): the NHL's own bracket and each series'
// games, shaped for sport_ingest(), so Pick the series, the bracket and Rank the teams run on them as on baseball's
// postseason. The NHL letters its series in bracket order (A and B meet in I, I and J in M, M and N in O), so sorting
// each round by letter is the tree `_bracket_tree` reads. A series whose clubs aren't set yet comes in with its slots
// open, and its games once the NHL schedules them.

// deno-lint-ignore no-explicit-any
type J = any;

// the NHL's game states: OFF and FINAL are over, LIVE and CRIT under way; a postponed game waits
export const nhlState = (g: J) =>
  g.gameScheduleState === 'PPD' ? 'postponed' : g.gameScheduleState === 'CNCL' ? 'cancelled'
    : ['OFF', 'FINAL'].includes(g.gameState) ? 'final' : ['LIVE', 'CRIT'].includes(g.gameState) ? 'live' : 'scheduled';

// a game's date in Eastern time, the league's day
const etDay = (iso: string) => new Date(new Date(iso).getTime() - 4 * 3600e3).toISOString().slice(0, 10);

const clubOf = (t: J) => ({
  ext_id: String(t.id),
  name: t.name?.default ?? [t.placeName?.default, t.commonName?.default].filter(Boolean).join(' '),
  short: t.abbrev ?? null, color: null,
  logo: t.darkLogo ?? (t.abbrev ? `https://assets.nhle.com/logos/nhl/svg/${t.abbrev}_dark.svg` : null),
});

// `bracket` is /v1/playoff-bracket/<year>; `games` each series' /v1/schedule/playoff-series/<season>/<letter>, by letter
export function nhlPlayoffPayload(season: string, bracket: J, games: Record<string, J>) {
  const clubs = new Map<string, J>();
  const series: J[] = [];
  const fixtures: J[] = [];
  for (const s of bracket?.series ?? []) {
    const letter = String(s.seriesLetter ?? '').toUpperCase();
    if (!letter) continue;
    const key = `${season}:${letter}`;
    const top = s.topSeedTeam?.id ? s.topSeedTeam : null, bottom = s.bottomSeedTeam?.id ? s.bottomSeedTeam : null;
    if (top) clubs.set(String(top.id), clubOf(top));
    if (bottom) clubs.set(String(bottom.id), clubOf(bottom));
    const sched = games[letter];
    const list: J[] = [...(sched?.games ?? [])].sort((a, b) => (a.gameNumber ?? 0) - (b.gameNumber ?? 0));
    series.push({
      ext_id: key, round: s.playoffRound, label: s.seriesTitle, short: s.seriesAbbrev ?? null, best_of: sched?.length ?? 7,
      high: top ? String(top.id) : null, low: bottom ? String(bottom.id) : null,
      starts_at: list[0]?.startTimeUTC ?? null, tbd: !(top && bottom) || !list.length, sort: letter.charCodeAt(0) - 64,
    });
    for (const g of list) {
      if (!g.homeTeam?.id || !g.awayTeam?.id) continue;
      fixtures.push({
        ext_id: String(g.id), series: key, game_no: g.gameNumber, kickoff: g.startTimeUTC, date: etDay(g.startTimeUTC),
        round: s.seriesTitle, state: nhlState(g), status: g.gameState,
        home: String(g.homeTeam.id), away: String(g.awayTeam.id), home_score: g.homeTeam.score ?? null, away_score: g.awayTeam.score ?? null,
        venue: g.venue?.default ?? null,
        detail: { period: g.periodDescriptor?.number ?? null, period_type: g.periodDescriptor?.periodType ?? null, if_necessary: !!g.ifNecessary },
      });
    }
  }
  return { clubs: [...clubs.values()], series, fixtures };
}
