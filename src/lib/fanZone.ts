// A club's fan zone (24 October 2026, Patrick: "the most incredible fan page of the Oilers ... a deep assessment of the
// team, their strengths and weaknesses and what management and coaching should consider based on deep statistical
// analysis"). nhl-hub's `fan` task brings the numbers (the club's season and last season, every club's team numbers, the
// roster, prospects, schedule, playoff runs and news); this file reads them: where the club ranks among the 32 on each
// measure, what is real and what is luck, who is growing and who is fading, and what the numbers say to do about it.
// Pure, so it is tested on its own (supabase/tests/fan-zone.test.mjs).

export type WLO = [number, number, number] | null;   // wins, losses, overtime losses in one situation
export interface FanTeam {
  abbrev: string; name: string; gp: number; w: number; l: number; otl: number; pts: number; ptsPct: number;
  gf: number; ga: number; pp: number; pk: number; sf: number; sa: number; fo: number;
  sat: number | null; satAhead: number | null; satBehind: number | null; sv5: number | null; sh5: number | null; pdo: number | null; gfPct: number | null;
  give60: number | null; take60: number | null; hits60: number | null; blocks60: number | null;
  // from the fuller reports (24 October 2026): absent on an older cached copy
  rw?: number | null; shw?: number | null; satClose?: number | null; satTied?: number | null; usat?: number | null; zoneStart?: number | null;
  p1gf?: number | null; p1ga?: number | null; p2gf?: number | null; p2ga?: number | null; p3gf?: number | null; p3ga?: number | null; otgf?: number | null; otga?: number | null;
  lead1?: WLO; lead2?: WLO; trail1?: WLO; trail2?: WLO; first?: WLO; chase?: WLO; outshoot?: WLO; outshot?: WLO; one?: WLO; blowout?: [number, number] | null;
  drawn60?: number | null; taken60?: number | null; pim?: number | null; majors?: number | null;
  ppOpp?: number | null; ppNet?: number | null; shga?: number | null; shorthanded?: number | null; pkNet?: number | null; shgf?: number | null;
  g5v5f?: number | null; g5v5a?: number | null; enf?: number | null; ena?: number | null; xa?: number | null; g3v3f?: number | null; g3v3a?: number | null;
  foD?: number | null; foO?: number | null; foPp?: number | null; foSh?: number | null;
}
export interface FanSkater { id: number; name: string; pos: string; gp: number; g: number; a: number; pts: number; pm: number; pim: number; ppg: number; sog: number; pct: number; toi: number; fo: number; headshot: string | null }
export interface FanGoalie { id: number; name: string; gp: number; gs: number; w: number; l: number; otl: number; gaa: number; svp: number; so: number; sa?: number | null; headshot: string | null }
// the moves (25 October 2026): every club's roster today against who has played for it, and the injury list, from
// nhl-hub's fan-moves task; priced in fanDeep.ts (priceMoves)
export interface SkLine { gp: number; g: number; a: number; pts: number }
export interface GLine { gp: number; gs: number; sa: number; ga: number; svp: number | null }
export interface Injury { status: string; list: string | null; part: string | null; back: string | null; note: string | null }
export interface MovePerson { id: number; name: string; pos: string; headshot: string | null }
export interface MoveGoalie extends MovePerson { season: GLine | null; us: GLine | null; teams: string[]; from: string | null; prior: GLine | null; hurt: Injury | null }
export interface MoveArrival extends MovePerson { from: string; season: SkLine | null; us: SkLine | null; prev: SkLine | null; hurt: Injury | null }
export interface MoveGone extends MovePerson { to: string | null; us: SkLine | GLine | null; season: SkLine | GLine | null }
export interface MoveHurt extends MovePerson, Injury { season: SkLine | GLine | null; prev: SkLine | GLine | null }
export interface ClubMoves { gp: number; goalies: MoveGoalie[]; arrivals: MoveArrival[]; gone: MoveGone[]; hurt: MoveHurt[] }
export interface FanMoves { season: number; lgSvp: number; clubs: Record<string, ClubMoves>; at: string }
export interface FanPerson { id: number; name: string; num: number | null; pos: string; shoots: string; ht: number; wt: number; born: string; city: string; country: string; headshot: string | null }
export interface FanGame { id: number; date: string; start: string; state: string; type?: number; home: string; away: string; hs: number | null; as: number | null; outcome: string | null }
export interface FanRun { season: number; rounds: { round: number; opp: string; w: number; l: number }[] }
export interface FanNews { id: string; source: string; headline: string; summary: string; date: string; url: string; image: string | null; video?: boolean }
export interface FanStanding { gp: number; w: number; l: number; otl: number; pts: number; ptsPct: number; gd: number; div: string; divRank: number; confRank: number; leagueRank: number; wildRank: number; streak: string | null; l10: string; home: string; road: string }
export interface FanTableRow { abbrev: string; name: string; conf: string; div: string; divName: string; gp: number; w: number; l: number; otl: number; pts: number; ptsPct: number; gd: number; rw: number | null; l10: string; streak: string | null }
export interface FanUsage {
  id: number; ev: number | null; pp: number | null; sh: number | null; shifts: number | null; sat: number | null; satRel: number | null; zs: number | null; pdo: number | null; onSh: number | null; toi5: number | null;
  p60: number | null; g60: number | null; a1_60: number | null; pts5: number | null; hits: number | null; blocks: number | null; take: number | null; give: number | null; firstGoals: number | null; otGoals: number | null;
  career: { gp: number; g: number; a: number; pts: number; sog: number; pct: number | null; gwg: number } | null;
}
export interface FanCrease { id: number; qs: number | null; qsPct: number | null; rw: number | null; gfa: number | null; sa60: number | null; evSvp: number | null; ppSvp: number | null; evSa: number | null; sa: number | null; ga: number | null; career: { gp: number; w: number; so: number; svp: number | null; gaa: number | null } | null }
export interface Tracked { value: number | null; rank: number | null; avg: number | null }
export interface FanTracking {
  speedMax: Tracked | null; bursts22: Tracked | null; bursts20: Tracked | null; fastest: string | null; shotMax: Tracked | null; shots90: Tracked | null; hardest: string | null; distance: Tracked | null;
  zones: { oz: number | null; ozRank: number | null; ozAvg: number | null; nz: number | null; dz: number | null; dzRank: number | null; dzAvg: number | null; ozEv: number | null; ozEvRank: number | null } | null;
  ranges: { where: string; shots: number | null; shotsRank: number | null; shotsAvg: number | null; pct: number | null; pctRank: number | null; pctAvg: number | null; goals: number | null; goalsRank: number | null }[];
  areas: { area: string; shots: number | null; rank: number | null }[];
}
export interface FanData {
  abbrev: string; name: string; season: number; prevSeason: number; standing: FanStanding | null;
  league: FanTeam[]; leaguePrev: FanTeam[]; skaters: FanSkater[]; goalies: FanGoalie[]; skatersPrev: FanSkater[]; goaliesPrev: FanGoalie[];
  roster: FanPerson[]; prospects: FanPerson[]; recent: FanGame[]; upcoming: FanGame[]; playoffs: FanRun[]; news: FanNews[]; moves?: FanMoves | null; at: string; stale?: boolean;
  champion?: string | null; table?: FanTableRow[]; usage?: FanUsage[]; crease?: FanCrease[]; tracking?: FanTracking | null; schedule?: FanGame[];
}

// the measures a club is ranked on, in groups, best first: higher is better unless `low`; a `style` measure describes how
// a club plays (hits, zone starts) rather than how well, so it is ranked but never called a strength or a weakness.
// A measure read from the fuller reports has a `get` (a share or a rate worked out from the counts).
export type MetricKey = 'ptsPct' | 'gf' | 'ga' | 'pp' | 'pk' | 'sf' | 'sa' | 'sat' | 'sv5' | 'sh5' | 'fo' | 'give60' | 'take60' | 'satAhead'
  | 'gd' | 'rwShare' | 'g5share' | 'g5f' | 'g5a' | 'shotDiff' | 'usat' | 'satClose' | 'satTied' | 'satBehind' | 'zoneStart' | 'pdo'
  | 'p1' | 'p2' | 'p3' | 'firstWin' | 'chaseWin' | 'lead2Hold' | 'comeback' | 'oneGoal' | 'outshotWin'
  | 'ppOpp' | 'ppNet' | 'pkNet' | 'shorthanded' | 'penDiff' | 'shgf' | 'foD' | 'foSh' | 'hits60' | 'blocks60' | 'enDiff';
export type MetricGroup = 'Results' | 'Attack' | 'Defence' | 'Possession' | 'Special teams' | 'Situations' | 'Discipline' | 'Style';
export interface Metric { key: MetricKey; label: string; group: MetricGroup; low?: boolean; style?: boolean; fmt: (v: number) => string; what: string; get?: (t: FanTeam) => number | null }
const pct1 = (v: number) => `${(v * 100).toFixed(1)}%`;
const dec2 = (v: number) => v.toFixed(2);
const dec1 = (v: number) => v.toFixed(1);
const svp = (v: number) => v.toFixed(3).replace(/^0/, '');
const signed = (f: (v: number) => string) => (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;
const per = (n: number | null | undefined, gp: number) => (n == null || !gp ? null : n / gp);
// a situation's win share: wins over the games played in it (null when it hasn't come up)
export const winShare = (r: WLO | undefined) => { if (!r) return null; const g = r[0] + r[1] + r[2]; return g ? r[0] / g : null; };
const gamesIn = (r: WLO | undefined) => (r ? r[0] + r[1] + r[2] : 0);
export const METRICS: Metric[] = [
  { key: 'ptsPct', group: 'Results', label: 'Points %', fmt: (v) => v.toFixed(3).replace(/^0/, ''), what: 'share of the points available that they have taken' },
  { key: 'gd', group: 'Results', label: 'Goal difference a game', fmt: signed(dec2), what: 'goals scored less goals allowed, per game', get: (t) => t.gf - t.ga },
  { key: 'rwShare', group: 'Results', label: 'Regulation wins', fmt: pct1, what: 'share of games won inside 60 minutes, the first tiebreaker in the standings', get: (t) => (t.rw == null ? null : t.rw / t.gp) },
  { key: 'g5share', group: 'Results', label: '5-on-5 goal share', fmt: pct1, what: 'share of the 5-on-5 goals that are theirs: the truest single read of who is winning the even-strength game', get: (t) => (t.g5v5f == null || t.g5v5a == null || t.g5v5f + t.g5v5a === 0 ? null : t.g5v5f / (t.g5v5f + t.g5v5a)) },
  { key: 'gf', group: 'Attack', label: 'Goals for a game', fmt: dec2, what: 'goals scored per game, all situations' },
  { key: 'g5f', group: 'Attack', label: '5-on-5 goals a game', fmt: dec2, what: 'even-strength goals per game: scoring that doesn’t depend on the referee', get: (t) => per(t.g5v5f, t.gp) },
  { key: 'sf', group: 'Attack', label: 'Shots for a game', fmt: dec1, what: 'shots on goal per game' },
  { key: 'sh5', group: 'Attack', label: '5-on-5 shooting %', fmt: pct1, what: 'goals per 5-on-5 shot: finishing, and luck' },
  { key: 'ga', group: 'Defence', label: 'Goals against a game', low: true, fmt: dec2, what: 'goals allowed per game, all situations' },
  { key: 'g5a', group: 'Defence', label: '5-on-5 goals against a game', low: true, fmt: dec2, what: 'even-strength goals allowed per game', get: (t) => per(t.g5v5a, t.gp) },
  { key: 'sa', group: 'Defence', label: 'Shots against a game', low: true, fmt: dec1, what: 'shots on goal allowed per game' },
  { key: 'sv5', group: 'Defence', label: '5-on-5 save %', fmt: svp, what: 'saves on 5-on-5 shots: the goaltending' },
  { key: 'sat', group: 'Possession', label: '5-on-5 shot share', fmt: pct1, what: 'share of all 5-on-5 shot attempts that are theirs (Corsi): who has the puck' },
  { key: 'usat', group: 'Possession', label: 'Unblocked shot share', fmt: pct1, what: 'the same with blocked shots left out (Fenwick): closer to the chances that reach the net' },
  { key: 'satClose', group: 'Possession', label: 'Shot share, close games', fmt: pct1, what: 'shot share while the score is close, where neither team is sitting on a lead: the best read of true strength' },
  { key: 'satTied', group: 'Possession', label: 'Shot share, tied', fmt: pct1, what: 'shot share with the score level' },
  { key: 'satAhead', group: 'Possession', label: 'Shot share with the lead', fmt: pct1, what: '5-on-5 shot share while ahead: do they keep pushing or sit back' },
  { key: 'satBehind', group: 'Possession', label: 'Shot share when behind', fmt: pct1, what: '5-on-5 shot share while chasing: how hard they push back' },
  { key: 'shotDiff', group: 'Possession', label: 'Shot difference a game', fmt: signed(dec1), what: 'shots on goal for less against, per game', get: (t) => t.sf - t.sa },
  { key: 'pp', group: 'Special teams', label: 'Power play', fmt: pct1, what: 'power-play goals per opportunity' },
  { key: 'pk', group: 'Special teams', label: 'Penalty kill', fmt: pct1, what: 'opponents’ power plays killed' },
  { key: 'ppNet', group: 'Special teams', label: 'Power play, net', fmt: pct1, what: 'the power play with the shorthanded goals it gives up taken off' },
  { key: 'pkNet', group: 'Special teams', label: 'Penalty kill, net', fmt: pct1, what: 'the kill with the shorthanded goals it scores counted back' },
  { key: 'ppOpp', group: 'Special teams', label: 'Power plays a game', fmt: dec2, what: 'power-play chances per game: how often they make the other team take a penalty', get: (t) => t.ppOpp ?? null },
  { key: 'shgf', group: 'Special teams', label: 'Shorthanded goals', fmt: (v) => String(v), what: 'goals scored while killing a penalty', get: (t) => t.shgf ?? null },
  { key: 'p1', group: 'Situations', label: 'First periods', fmt: signed(dec2), what: 'first-period goal difference per game: how they start', get: (t) => (t.p1gf == null || t.p1ga == null ? null : (t.p1gf - t.p1ga) / t.gp) },
  { key: 'p2', group: 'Situations', label: 'Second periods', fmt: signed(dec2), what: 'second-period goal difference per game: the long change', get: (t) => (t.p2gf == null || t.p2ga == null ? null : (t.p2gf - t.p2ga) / t.gp) },
  { key: 'p3', group: 'Situations', label: 'Third periods', fmt: signed(dec2), what: 'third-period goal difference per game: how they finish', get: (t) => (t.p3gf == null || t.p3ga == null ? null : (t.p3gf - t.p3ga) / t.gp) },
  { key: 'firstWin', group: 'Situations', label: 'Win % scoring first', fmt: pct1, what: 'games won after scoring the first goal', get: (t) => winShare(t.first) },
  { key: 'chaseWin', group: 'Situations', label: 'Win % giving up the first', fmt: pct1, what: 'games won after the other team scored first', get: (t) => winShare(t.chase) },
  { key: 'lead2Hold', group: 'Situations', label: 'Leads after two held', fmt: pct1, what: 'games won when leading after two periods', get: (t) => (gamesIn(t.lead2) >= 2 ? winShare(t.lead2) : null) },
  { key: 'comeback', group: 'Situations', label: 'Comebacks after two', fmt: pct1, what: 'games won when trailing after two periods', get: (t) => (gamesIn(t.trail2) >= 2 ? winShare(t.trail2) : null) },
  { key: 'oneGoal', group: 'Situations', label: 'One-goal games', fmt: pct1, what: 'win share in games decided by one goal (overtime included)', get: (t) => (gamesIn(t.one) >= 2 ? winShare(t.one) : null) },
  { key: 'outshotWin', group: 'Situations', label: 'Wins when outshot', fmt: pct1, what: 'win share in games where the other team had more shots', get: (t) => (gamesIn(t.outshot) >= 2 ? winShare(t.outshot) : null) },
  { key: 'enDiff', group: 'Situations', label: 'Empty-net goals, net', fmt: signed((v) => String(v)), what: 'empty-net goals scored less those allowed: who closes games out', get: (t) => (t.enf == null || t.ena == null ? null : t.enf - t.ena) },
  { key: 'penDiff', group: 'Discipline', label: 'Penalty difference an hour', fmt: signed(dec2), what: 'penalties drawn less penalties taken, per 60 minutes', get: (t) => (t.drawn60 == null || t.taken60 == null ? null : t.drawn60 - t.taken60) },
  { key: 'shorthanded', group: 'Discipline', label: 'Times shorthanded a game', low: true, fmt: dec2, what: 'penalty kills per game: how often they put themselves short', get: (t) => t.shorthanded ?? null },
  { key: 'give60', group: 'Discipline', label: 'Giveaways an hour', low: true, fmt: dec1, what: 'pucks given away per 60 minutes' },
  { key: 'take60', group: 'Discipline', label: 'Takeaways an hour', fmt: dec1, what: 'pucks taken away per 60 minutes' },
  { key: 'fo', group: 'Discipline', label: 'Faceoffs', fmt: pct1, what: 'draws won' },
  { key: 'foD', group: 'Discipline', label: 'Defensive-zone draws', fmt: pct1, what: 'draws won in their own end, where losing one starts the other team’s shift with the puck', get: (t) => t.foD ?? null },
  { key: 'foSh', group: 'Discipline', label: 'Draws on the kill', fmt: pct1, what: 'draws won while shorthanded: each one is a clear and 20 seconds off the clock', get: (t) => t.foSh ?? null },
  { key: 'pdo', group: 'Style', style: true, label: '5-on-5 PDO', fmt: (v) => (v * 1000).toFixed(0), what: 'shooting plus save percentage at 5-on-5, times 1000: above 1000 is running hot, below it cold, and it drifts back', get: (t) => t.pdo ?? null },
  { key: 'zoneStart', group: 'Style', style: true, label: 'Offensive-zone starts', fmt: pct1, what: 'share of 5-on-5 faceoffs taken in the attacking end: how the coaches set the table', get: (t) => t.zoneStart ?? null },
  { key: 'hits60', group: 'Style', style: true, label: 'Hits an hour', fmt: dec1, what: 'hits per 60 minutes: a style, and often a sign of chasing the puck', get: (t) => t.hits60 ?? null },
  { key: 'blocks60', group: 'Style', style: true, label: 'Blocks an hour', fmt: dec1, what: 'shots blocked per 60 minutes: commitment, and a sign of defending a lot', get: (t) => t.blocks60 ?? null },
];
export const GROUPS: MetricGroup[] = ['Results', 'Attack', 'Defence', 'Possession', 'Special teams', 'Situations', 'Discipline', 'Style'];
export const metricValue = (t: FanTeam, m: Metric): number | null => { const v = m.get ? m.get(t) : (t[m.key as keyof FanTeam] as number | null | undefined); return v == null || Number.isNaN(v) ? null : v; };

export interface Ranked { key: MetricKey; label: string; group: MetricGroup; style: boolean; value: number; rank: number; of: number; avg: number; best: number; worst: number; prevRank: number | null; prevValue: number | null; fmt: (v: number) => string; what: string; low: boolean }

// where a club stands among those with a number for it (1 is best)
export function rankIn(league: FanTeam[], abbrev: string, m: Metric) {
  const rows = league.filter((t) => t.gp > 0).map((t) => ({ abbrev: t.abbrev, v: metricValue(t, m) })).filter((x): x is { abbrev: string; v: number } => x.v != null);
  const me = rows.find((t) => t.abbrev === abbrev);
  if (!me || rows.length < 8) return null;
  const v = me.v;
  const vals = rows.map((t) => t.v);
  return { value: v, rank: 1 + rows.filter((t) => (m.low ? t.v < v : t.v > v)).length, of: rows.length, avg: vals.reduce((a, b) => a + b, 0) / vals.length, best: m.low ? Math.min(...vals) : Math.max(...vals), worst: m.low ? Math.max(...vals) : Math.min(...vals) };
}

export function rankAll(d: FanData): Ranked[] {
  const out: Ranked[] = [];
  for (const m of METRICS) {
    const now = rankIn(d.league, d.abbrev, m);
    if (!now) continue;
    const prev = rankIn(d.leaguePrev, d.abbrev, m);
    out.push({ key: m.key, label: m.label, group: m.group, style: !!m.style, ...now, prevRank: prev?.rank ?? null, prevValue: prev?.value ?? null, fmt: m.fmt, what: m.what, low: !!m.low });
  }
  return out;
}

export const ageOn = (born: string | null | undefined, at: Date) => {
  if (!born) return null;
  const b = new Date(`${born}T12:00:00Z`);
  let a = at.getUTCFullYear() - b.getUTCFullYear();
  if (at.getUTCMonth() < b.getUTCMonth() || (at.getUTCMonth() === b.getUTCMonth() && at.getUTCDate() < b.getUTCDate())) a--;
  return a;
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export interface Development {
  id: number; name: string; pos: string; age: number | null; headshot: string | null; gp: number; pts: number; ppg: number;
  prevGp: number | null; prevPpg: number | null; delta: number | null; toi: number; prevToi: number | null; toiDelta: number | null;
  verdict: 'rising' | 'fading' | 'steady' | 'new';
}
export interface Recommendation { area: string; title: string; why: string; priority: 'high' | 'medium' | 'watch' }
export interface Assessment {
  ranks: Ranked[]; strengths: Ranked[]; weaknesses: Ranked[]; grade: string; score: number; early: boolean;
  luck: { pdo: number | null; sh5Rank: number | null; sv5Rank: number | null; read: string; tone: 'hot' | 'cold' | 'fair' } | null;
  stars: { names: string[]; share: number; goalsShare: number } | null; depth: { ppg: number; players: number } | null;
  dShare: number | null; goalies: { id: number; name: string; gp: number; gs: number; svp: number; leagueSvp: number; share: number; headshot: string | null }[];
  development: Development[]; youngCore: Development[]; recs: Recommendation[]; summary: string;
}

const rankWord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
export { rankWord };

export function assess(d: FanData, now = new Date()): Assessment {
  const ranks = rankAll(d);
  const by = (k: MetricKey) => ranks.find((r) => r.key === k) ?? null;
  const gp = d.standing?.gp ?? d.league.find((t) => t.abbrev === d.abbrev)?.gp ?? 0;
  const early = gp < 20;
  // the top and bottom thirds of the league: 1st to 11th, 22nd to 32nd
  const top = (r: Ranked) => r.rank <= Math.round(r.of / 3);
  const bottom = (r: Ranked) => r.rank > r.of - Math.round(r.of / 3);
  // the style numbers (hits, giveaways, takeaways) describe more than they grade: they join the lists only at the ends
  // (the record itself, the near-duplicates of a measure already on the list and the small counts stay off them too)
  const offList: MetricKey[] = ['ptsPct', 'shgf', 'enDiff', 'usat', 'satTied', 'satBehind', 'ppNet', 'pkNet', 'sh5', 'take60'];
  // a win share in a situation (leading after two, one-goal games) needs a season's worth of those games to say anything
  const thin: MetricKey[] = early ? ['firstWin', 'chaseWin', 'lead2Hold', 'comeback', 'oneGoal', 'outshotWin'] : [];
  const graded: MetricKey[] = METRICS.filter((m) => !m.style && !offList.includes(m.key) && !thin.includes(m.key)).map((m) => m.key);
  const strengths = ranks.filter((r) => graded.includes(r.key) && r.key !== 'ptsPct' && top(r)).sort((a, b) => a.rank - b.rank);
  const weaknesses = ranks.filter((r) => graded.includes(r.key) && r.key !== 'ptsPct' && bottom(r)).sort((a, b) => b.rank - a.rank);

  // one grade from the measures that win games, each by where it stands among the 32 (0 last, 1 first)
  const W: Partial<Record<MetricKey, number>> = { ptsPct: 3, sat: 2, gf: 1.5, ga: 1.5, pp: 1, pk: 1, sv5: 1 };
  let sw = 0, st = 0;
  for (const [k, w] of Object.entries(W) as [MetricKey, number][]) { const r = by(k); if (!r) continue; st += w * (1 - (r.rank - 1) / Math.max(1, r.of - 1)); sw += w; }
  const score = sw ? st / sw : 0.5;
  const grade = score >= 0.9 ? 'A+' : score >= 0.8 ? 'A' : score >= 0.72 ? 'A-' : score >= 0.65 ? 'B+' : score >= 0.58 ? 'B' : score >= 0.5 ? 'B-' : score >= 0.43 ? 'C+' : score >= 0.36 ? 'C' : score >= 0.28 ? 'C-' : score >= 0.2 ? 'D' : 'F';

  // luck: shooting plus save percentage at 5-on-5 drifts back toward 1.000 over a season
  const me = d.league.find((t) => t.abbrev === d.abbrev);
  const pdo = me?.pdo ?? null;
  const luck = pdo == null ? null : {
    pdo, sh5Rank: by('sh5')?.rank ?? null, sv5Rank: by('sv5')?.rank ?? null,
    tone: (pdo >= 1.02 ? 'hot' : pdo <= 0.98 ? 'cold' : 'fair') as 'hot' | 'cold' | 'fair',
    read: pdo >= 1.02 ? `At 5-on-5 they shoot ${pct1(me!.sh5 ?? 0)} and stop ${svp(me!.sv5 ?? 0)}: a combined ${(pdo * 1000).toFixed(0)} that almost no team holds over a season. Some of the record is bounces, and it tends to drift back toward 1000.`
      : pdo <= 0.98 ? `At 5-on-5 they shoot ${pct1(me!.sh5 ?? 0)} and stop ${svp(me!.sv5 ?? 0)}: a combined ${(pdo * 1000).toFixed(0)}, well under the 1000 most teams settle near. The results should improve even if nothing else changes.`
      : `Their 5-on-5 shooting and save percentages add to ${(pdo * 1000).toFixed(0)}, close to the 1000 most teams settle near: the record is about what the play has earned.`,
  };

  // stars and depth: how much of the scoring runs through the top two
  const sk = [...d.skaters].filter((p) => p.gp > 0).sort((a, b) => b.pts - a.pts);
  const teamPts = sk.reduce((t, p) => t + p.pts, 0), teamG = sk.reduce((t, p) => t + p.g, 0);
  const stars = sk.length >= 2 && teamPts > 0 ? { names: sk.slice(0, 2).map((p) => p.name), share: (sk[0].pts + sk[1].pts) / teamPts, goalsShare: teamG ? (sk[0].g + sk[1].g) / teamG : 0 } : null;
  const fwd = sk.filter((p) => p.pos !== 'D');
  const depthRows = fwd.slice(6, 12).filter((p) => p.gp >= Math.min(3, gp));
  const depth = depthRows.length ? { ppg: depthRows.reduce((t, p) => t + p.pts, 0) / depthRows.reduce((t, p) => t + p.gp, 0), players: depthRows.length } : null;
  const dPts = sk.filter((p) => p.pos === 'D').reduce((t, p) => t + p.pts, 0);
  const dShare = teamPts ? dPts / teamPts : null;

  // the crease: each goalie's save percentage against the league's
  const lgSa = d.league.reduce((t, x) => t + x.sa * x.gp, 0), lgGa = d.league.reduce((t, x) => t + x.ga * x.gp, 0);
  const leagueSvp = lgSa ? 1 - lgGa / lgSa : 0.9;
  const starts = d.goalies.reduce((t, g) => t + (g.gs ?? 0), 0);
  const goalies = d.goalies.filter((g) => g.gp > 0).sort((a, b) => b.gs - a.gs)
    .map((g) => ({ id: g.id, name: g.name, gp: g.gp, gs: g.gs, svp: g.svp, leagueSvp, share: starts ? g.gs / starts : 0, headshot: g.headshot }));

  // development: this season's points a game against last season's, and the ice time the coaches give him
  const ages = new Map(d.roster.map((p) => [p.id, ageOn(p.born, now)]));
  const prev = new Map(d.skatersPrev.map((p) => [p.id, p]));
  const development: Development[] = sk.filter((p) => p.gp >= Math.min(3, gp)).map((p) => {
    const q = prev.get(p.id);
    const prevPpg = q && q.gp >= 10 ? q.pts / q.gp : null;
    const ppg = p.pts / p.gp;
    const delta = prevPpg == null ? null : ppg - prevPpg;
    const toiDelta = q && q.gp >= 10 ? p.toi - q.toi : null;
    // the early weeks swing: a riser needs both more scoring and more of the coaches' trust, or a big jump in either
    const verdict: Development['verdict'] = prevPpg == null ? 'new'
      : (delta! >= 0.15 && (toiDelta ?? 0) >= -30) || ((toiDelta ?? 0) >= 90 && delta! >= -0.1) ? 'rising'
      : (delta! <= -0.15 && (toiDelta ?? 0) <= 30) || ((toiDelta ?? 0) <= -90 && delta! <= 0.1) ? 'fading' : 'steady';
    return { id: p.id, name: p.name, pos: p.pos, age: ages.get(p.id) ?? null, headshot: p.headshot, gp: p.gp, pts: p.pts, ppg, prevGp: q?.gp ?? null, prevPpg, delta, toi: p.toi, prevToi: q && q.gp >= 10 ? q.toi : null, toiDelta, verdict };
  });
  const youngCore = development.filter((p) => p.age != null && p.age <= 24).sort((a, b) => b.ppg - a.ppg);

  // what the numbers say to do, most pressing first
  const recs: Recommendation[] = [];
  const r = by;
  const pk = r('pk'), pp = r('pp'), ga = r('ga'), sa = r('sa'), sv5 = r('sv5'), sat = r('sat'), fo = r('fo'), ahead = r('satAhead'), give = r('give60'), gf = r('gf');
  const sample = early ? ` Only ${gp} games in, so treat it as a lean, not a verdict.` : '';
  if (pk && bottom(pk)) recs.push({ area: 'Penalty kill', priority: 'high', title: 'Fix the penalty kill', why: `${pk.fmt(pk.value)} killed ranks ${rankWord(pk.rank)} of ${pk.of} (league average ${pk.fmt(pk.avg)}). Every point of PK is worth goals: tighten the box, pressure the flanks, and give the kill to the players winning their draws and blocking shots.${sample}` });
  if (sv5 && bottom(sv5) && ga && ga.rank > ga.of / 2) recs.push({ area: 'Goaltending', priority: 'high', title: 'Shore up the crease', why: `The 5-on-5 save percentage of ${sv5.fmt(sv5.value)} ranks ${rankWord(sv5.rank)}, and they allow ${ga.fmt(ga.value)} goals a game (${rankWord(ga.rank)}). If the shots against are ordinary, the gap is in net: ride the hotter goalie and look at the market for a proven starter.${sample}` });
  if (sa && bottom(sa)) recs.push({ area: 'Defending', priority: 'high', title: 'Give up fewer shots', why: `${sa.fmt(sa.value)} shots against a game ranks ${rankWord(sa.rank)}. That points at structure more than goaltending: quicker breakouts, tighter gaps in the neutral zone, and forwards back on time.` });
  if (sat && sat.value < 0.48) recs.push({ area: '5-on-5 play', priority: sat.value < 0.46 ? 'high' : 'medium', title: 'Win more of the puck at 5-on-5', why: `They take ${sat.fmt(sat.value)} of 5-on-5 shot attempts, ${rankWord(sat.rank)} in the league. Teams that win the Cup almost always control more than half: more possession time for the depth lines and fewer dump-ins against.${luck?.tone === 'hot' ? ' With the luck running hot, this is the number to watch when the bounces even out.' : ''}` });
  const sf = r('sf'), sh5 = r('sh5');
  if (sf && bottom(sf)) recs.push({ area: 'Shot volume', priority: sh5 && top(sh5) ? 'high' : 'medium', title: 'Get more pucks to the net', why: `${sf.fmt(sf.value)} shots a game ranks ${rankWord(sf.rank)}.${sh5 && top(sh5) ? ` They score on ${sh5.fmt(sh5.value)} of their 5-on-5 shots (${rankWord(sh5.rank)}), a finishing rate that rarely lasts: when it cools, the goals go with it unless the shots climb.` : ''} Shoot from the point through traffic, and get a second body to the net for rebounds.` });
  if (stars && stars.share >= 0.38) recs.push({ area: 'Depth scoring', priority: stars.share >= 0.45 ? 'high' : 'medium', title: 'Find scoring beyond the top two', why: `${stars.names.join(' and ')} have ${Math.round(stars.share * 100)}% of the team's points and ${Math.round(stars.goalsShare * 100)}% of its goals.${depth ? ` The forwards after the top six score ${depth.ppg.toFixed(2)} points a game.` : ''} When the stars are checked, as they will be in the playoffs, the depth has to finish: a scoring winger for the third line, or more power-play time for the second unit.` });
  if (ahead && ahead.value < 0.42) recs.push({ area: 'Game management', priority: 'medium', title: 'Keep pushing with the lead', why: `With the lead they take only ${ahead.fmt(ahead.value)} of 5-on-5 shot attempts (${rankWord(ahead.rank)}). Sitting back invites pressure: keep the forecheck on, and use the defencemen who can move the puck out.` });
  if (fo && bottom(fo)) recs.push({ area: 'Faceoffs', priority: 'watch', title: 'Win more draws', why: `${fo.fmt(fo.value)} on faceoffs ranks ${rankWord(fo.rank)}. It matters most on the kill and late in games: a right-shot centre who wins draws is a cheap fix.` });
  if (give && bottom(give)) recs.push({ area: 'Puck management', priority: 'watch', title: 'Cut the giveaways', why: `${give.fmt(give.value)} giveaways an hour ranks ${rankWord(give.rank)}. Simpler exits and fewer stretch passes through the middle.` });
  if (luck?.tone === 'hot' && !recs.some((x) => x.area === '5-on-5 play')) recs.push({ area: 'Luck', priority: 'watch', title: 'Don’t let the hot start hide the work', why: luck.read });
  if (luck?.tone === 'cold') recs.push({ area: 'Patience', priority: 'watch', title: 'Stay the course', why: luck.read });
  const starter = goalies[0];
  if (starter && starter.share >= 0.85 && starter.gs >= 10) recs.push({ area: 'Workload', priority: 'medium', title: 'Manage the starter’s workload', why: `${starter.name} has started ${Math.round(starter.share * 100)}% of the games. A starter is fresher in April with 55 to 60 starts: plan the back-to-backs for the backup.` });
  if (pp && top(pp)) recs.push({ area: 'Power play', priority: 'watch', title: 'Lean on the power play', why: `${pp.fmt(pp.value)} on the power play ranks ${rankWord(pp.rank)}. Drawing penalties is a weapon for this team: speed through the neutral zone and net-front work earn more chances.` });
  if (dShare != null && dShare < 0.15 && teamPts >= 20) recs.push({ area: 'Blue line', priority: 'watch', title: 'More offence from the back end', why: `The defencemen have ${Math.round(dShare * 100)}% of the team's points. A defenceman who joins the rush and moves the puck first would take pressure off the forwards.` });
  if (gf && bottom(gf) && !recs.some((x) => x.area === 'Depth scoring')) recs.push({ area: 'Scoring', priority: 'high', title: 'Find more goals', why: `${gf.fmt(gf.value)} goals a game ranks ${rankWord(gf.rank)}. More shots from the slot and more traffic at the net.` });
  const order = { high: 0, medium: 1, watch: 2 };
  recs.sort((a, b) => order[a.priority] - order[b.priority]);

  const ptsPct = by('ptsPct');
  const summary = !ptsPct ? `${d.name}: the season is about to start.`
    : `${d.name} are ${d.standing ? `${rankWord(d.standing.leagueRank)} in the league (${d.standing.w}-${d.standing.l}-${d.standing.otl})` : `${rankWord(ptsPct.rank)} of ${ptsPct.of} by points percentage`}${strengths.length ? `, built on ${strengths.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}${weaknesses.length ? `, held back by ${weaknesses.slice(0, 2).map((x) => x.label.toLowerCase()).join(' and ')}` : ''}.${luck?.tone === 'hot' ? ' Some of it is bounces.' : luck?.tone === 'cold' ? ' The bounces owe them.' : ''}${early ? ` ${gp} games in: early, and the numbers will move.` : ''}`;
  return { ranks, strengths, weaknesses, grade, score, early, luck, stars, depth, dShare, goalies, development, youngCore, recs, summary };
}

export const fmtToi = (s: number | null) => (s == null ? '–' : mmss(s));
