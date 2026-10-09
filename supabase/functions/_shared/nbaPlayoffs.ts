// The NBA playoffs (migration 220) from ESPN's public scoreboard, as best-of-7 series in bracket order, so Pick the
// series, the bracket and Rank the teams run on the NBA as they do on the Stanley Cup. ESPN names each game's round,
// conference and number in its note ("East 1st Round - Game 3") but carries no seeds, so they come from its standings
// (`playoffSeed`). The top four seeds of a conference are never play-in teams, so the better seed in a game fixes its
// place in the bracket: 1v8, 4v5, 3v6, 2v7 top to bottom, East before West, each later round from the two above it.
// Every series exists from the first day (later rounds to be decided), so a bracket opens on the first round. Since
// each game finds its own series, a run can send any days: the daily run sends the whole postseason, a live run only
// the days around now (`full` false sends only the series those days touch, so it never unsets one already known).
import { espnFixture, PLAYOFF_STATE, type NeutralClub } from './soccer.ts';

// deno-lint-ignore no-explicit-any
type J = any;
type Conf = 'E' | 'W';

// each team's conference, seed and record, from /apis/v2/sports/basketball/nba/standings
export function nbaSeeds(standings: J) {
  const m = new Map<string, { conf: Conf; seed: number; pct: number }>();
  for (const ch of standings?.children ?? []) {
    const conf: Conf = /east/i.test(String(ch.name ?? ch.abbreviation ?? '')) ? 'E' : 'W';
    for (const en of ch.standings?.entries ?? []) {
      const st = Object.fromEntries((en.stats ?? []).map((s: J) => [s.name, Number(s.value)]));
      m.set(String(en.team?.id), { conf, seed: st.playoffSeed || 99, pct: st.winPercent || 0 });
    }
  }
  return m;
}

// a game's round from its note; the play-in has none
export function nbaRound(note: string): number | null {
  if (/play-in/i.test(note)) return null;
  if (/NBA Finals/i.test(note)) return 4;
  if (/Semifinals/i.test(note)) return 2;
  if (/1st Round|First Round/i.test(note)) return 1;
  if (/Finals/i.test(note)) return 3;
  return null;
}

// a first-round slot by the better seed: 1v8, 4v5, 3v6, 2v7
const SLOT: Record<number, number> = { 1: 0, 8: 0, 4: 1, 5: 1, 3: 2, 6: 2, 2: 3, 7: 3 };
const PER = [0, 4, 2, 1, 1];
const CONF: Record<Conf, string> = { E: 'East', W: 'West' };
const label = (round: number, c: Conf) => (round === 1 ? `${CONF[c]} 1st Round` : round === 2 ? `${CONF[c]} Semifinals` : round === 3 ? `${CONF[c]} Finals` : 'NBA Finals');
const short = (round: number, c: Conf) => (round === 1 ? `${c} R1` : round === 2 ? `${c} Semis` : round === 3 ? `${c}CF` : 'Finals');

export function nbaPlayoffPayload(season: string, pages: J[], standings: J, full = true) {
  const seeds = nbaSeeds(standings);
  // standings without the league's teams (a bad response) would leave every game unplaced: send nothing this run
  if (seeds.size < 16) return { clubs: [], series: [], fixtures: [] };
  const series = new Map<string, J>();
  const key = (round: number, c: Conf, slot: number) => `nba:${season}:R${round}:${round < 4 ? c : 'F'}:${slot}`;
  // East's series before West's in every round, so each pair of a round feeds the series below it
  const sortOf = (round: number, c: Conf, slot: number) => [0, 0, 8, 12, 14][round] + (round < 4 && c === 'W' ? PER[round] : 0) + slot + 1;
  const make = (round: number, c: Conf, slot: number) => {
    const k = key(round, c, slot);
    if (!series.has(k)) series.set(k, { ext_id: k, round, label: label(round, c), short: short(round, c), best_of: 7, high: null, low: null,
      starts_at: null, tbd: true, sort: sortOf(round, c, slot) });
    return series.get(k);
  };
  if (full) {
    for (const round of [1, 2, 3]) for (const c of ['E', 'W'] as Conf[]) for (let s = 0; s < PER[round]; s++) make(round, c, s);
    make(4, 'E', 0);
  }
  const seen = new Map<string, J>();
  for (const page of pages) for (const e of page?.events ?? []) seen.set(String(e.id), e);
  const clubs = new Map<string, NeutralClub>();
  const fixtures: J[] = [];
  for (const e of [...seen.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const c0 = e.competitions?.[0] ?? {};
    const note = String((c0.notes ?? [])[0]?.headline ?? '');
    const round = nbaRound(note);
    if (!round) continue;
    const ids: string[] = (c0.competitors ?? []).map((x: J) => String(x.team?.id ?? '')).filter((id: string) => seeds.has(id));
    if (ids.length !== 2) continue;
    // the better seed on top; the Finals by the better record, then the better seed, then the team's id, so the two
    // never swap places from one run to the next
    const s = (id: string) => seeds.get(id)!;
    ids.sort((a, b) => (round === 4 ? s(b).pct - s(a).pct : 0) || s(a).seed - s(b).seed || a.localeCompare(b));
    const top = seeds.get(ids[0])!;
    const conf: Conf = /^West/i.test(note) ? 'W' : /^East/i.test(note) ? 'E' : top.conf;
    const first = SLOT[Math.min(seeds.get(ids[0])!.seed, seeds.get(ids[1])!.seed)];
    const slot = round === 1 ? first : round === 2 ? (first ?? -1) >> 1 : 0;
    if (slot == null || slot < 0) continue;
    const sr = make(round, conf, slot);
    const fx = espnFixture(e, null, { week: null, label: null, clock: false });
    sr.high = ids[0]; sr.low = ids[1]; sr.tbd = false;
    if (!sr.starts_at || fx.kickoff < sr.starts_at) sr.starts_at = fx.kickoff;
    clubs.set(fx.home, fx.home_club); clubs.set(fx.away, fx.away_club);
    fixtures.push({ ext_id: `B${e.id}`, series: sr.ext_id, game_no: Number(/Game (\d+)/i.exec(note)?.[1]) || null, kickoff: fx.kickoff,
      state: PLAYOFF_STATE[fx.status] ?? 'live', status: fx.status, home: fx.home, away: fx.away, home_score: fx.home_score, away_score: fx.away_score,
      venue: fx.venue, periods: fx.periods });
  }
  return { clubs: [...clubs.values()], series: [...series.values()], fixtures };
}
