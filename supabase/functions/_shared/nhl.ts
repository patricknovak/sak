// Pure helpers for turning NHL API game data into SaK stat lines (no Deno/Node APIs, so it's testable anywhere).

export const NHL = 'https://api-web.nhle.com/v1';

export type StatLine = { player_id: number; nhl_team: string; stats: Record<string, number> };

// Eastern-time calendar date, which is how the NHL (and SaK) define a "day"
export const etDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export const gameRow = (g: any) => ({
  id: g.id,
  date: g.gameDate,
  start_utc: g.startTimeUTC,
  home: g.homeTeam.abbrev,
  away: g.awayTeam.abbrev,
  state: g.gameScheduleState && g.gameScheduleState !== 'OK' ? (g.gameScheduleState === 'PPD' ? 'PPD' : 'CNCL') : g.gameState,
  home_score: g.homeTeam.score ?? null,
  away_score: g.awayTeam.score ?? null,
  period: g.periodDescriptor
    ? g.periodDescriptor.periodType === 'REG' ? String(g.periodDescriptor.number) : g.periodDescriptor.periodType
    : null,
  clock: g.clock ? (g.clock.inIntermission ? 'INT' : g.clock.timeRemaining) : null,
  updated_at: new Date().toISOString(),
});

export const STARTED = new Set(['LIVE', 'CRIT', 'OFF', 'FINAL']);

const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) || 0) + 1);

// box = /gamecenter/{id}/boxscore, landing = /gamecenter/{id}/landing,
// pbp = /gamecenter/{id}/play-by-play (optional: only needed when faceoffs are scored)
const toiSec = (s: string) => { const [m, x] = String(s ?? '0:0').split(':').map(Number); return (m || 0) * 60 + (x || 0); };

export function gameStats(box: any, landing: any, pbp?: any): StatLine[] {
  const out = new Map<number, StatLine>();
  const home = box.homeTeam.abbrev, away = box.awayTeam.abbrev;
  const ppp = new Map<number, number>(), ppg = new Map<number, number>();
  const shp = new Map<number, number>(), shg = new Map<number, number>();
  const fow = new Map<number, number>(), fol = new Map<number, number>();
  for (const play of pbp?.plays ?? []) {
    if (play.typeDescKey !== 'faceoff' || !play.details) continue;
    if (play.details.winningPlayerId) bump(fow, play.details.winningPlayerId);
    if (play.details.losingPlayerId) bump(fol, play.details.losingPlayerId);
  }

  // power-play points and the game-winning goal come from the scoring summary
  let gwg: number | null = null;
  const homeFinal = box.homeTeam.score ?? 0, awayFinal = box.awayTeam.score ?? 0;
  const winnerIsHome = homeFinal > awayFinal;
  const loserFinal = Math.min(homeFinal, awayFinal);
  const done = box.gameState === 'OFF' || box.gameState === 'FINAL';
  for (const period of landing?.summary?.scoring ?? []) {
    if (period.periodDescriptor?.periodType === 'SO') continue;
    for (const goal of period.goals ?? []) {
      if (goal.strength === 'pp') {
        bump(ppp, goal.playerId); bump(ppg, goal.playerId);
        for (const a of goal.assists ?? []) bump(ppp, a.playerId);
      } else if (goal.strength === 'sh') {
        bump(shp, goal.playerId); bump(shg, goal.playerId);
        for (const a of goal.assists ?? []) bump(shp, a.playerId);
      }
      const winnerScore = winnerIsHome ? goal.homeScore : goal.awayScore;
      const scoredByWinner = (goal.isHome ?? goal.teamAbbrev?.default === home) === winnerIsHome;
      if (done && gwg === null && homeFinal !== awayFinal && scoredByWinner && winnerScore === loserFinal + 1) gwg = goal.playerId;
    }
  }

  for (const [side, team] of [['homeTeam', home], ['awayTeam', away]] as const) {
    const t = box.playerByGameStats?.[side];
    if (!t) continue;
    for (const p of [...(t.forwards ?? []), ...(t.defense ?? [])]) {
      out.set(p.playerId, {
        player_id: p.playerId, nhl_team: team,
        stats: {
          g: p.goals ?? 0, a: p.assists ?? 0, pts: (p.goals ?? 0) + (p.assists ?? 0), pm: p.plusMinus ?? 0, pim: p.pim ?? 0,
          ppg: ppg.get(p.playerId) ?? 0, ppa: (ppp.get(p.playerId) ?? 0) - (ppg.get(p.playerId) ?? 0), ppp: ppp.get(p.playerId) ?? 0,
          shg: shg.get(p.playerId) ?? 0, sha: (shp.get(p.playerId) ?? 0) - (shg.get(p.playerId) ?? 0), shp: shp.get(p.playerId) ?? 0,
          gwg: gwg === p.playerId ? 1 : 0, sog: p.sog ?? 0, hit: p.hits ?? 0, blk: p.blockedShots ?? 0,
          ...(pbp ? { fow: fow.get(p.playerId) ?? 0, fol: fol.get(p.playerId) ?? 0 } : {}),
        },
      });
    }
    const goalies = (t.goalies ?? []).filter((g: any) => g.toi && g.toi !== '00:00');
    // the box score only flags the starter once the game is final; while it's live, the goalie who's played the
    // most is the starter (a pulled starter is corrected at the final whistle)
    const liveStarter = goalies.some((g: any) => g.starter != null) ? null
      : [...goalies].sort((a: any, b: any) => toiSec(b.toi) - toiSec(a.toi))[0]?.playerId ?? null;
    for (const g of goalies) {
      const ga = g.goalsAgainst ?? 0;
      out.set(g.playerId, {
        player_id: g.playerId, nhl_team: team,
        stats: {
          gs: (g.starter ?? g.playerId === liveStarter) ? 1 : 0, w: g.decision === 'W' ? 1 : 0, l: g.decision === 'L' ? 1 : 0,
          otl: g.decision === 'O' ? 1 : 0, ga, sv: g.saves ?? 0, sa: g.shotsAgainst ?? 0,
          sho: done && ga === 0 && g.decision === 'W' && goalies.length === 1 ? 1 : 0,
        },
      });
    }
  }
  return [...out.values()];
}

// what the report says about one injury: the status, a readable note, and how long he is out (the expected return,
// the body part and side, surgery, which list he is on, and the full write-up). The note is the short comment unless
// that is only a code ("ir", "out", "day-to-day"), when the write-up's first sentence stands in for it.
// deno-lint-ignore no-explicit-any
export function readInjury(i: any) {
  const d = i.details ?? {};
  const said = (x: unknown) => (typeof x === 'string' && x.trim() && !/^(not specified|undisclosed|other)$/i.test(x.trim()) ? x.trim() : null);
  const code = (x: unknown) => typeof x !== 'string' || !x.trim() || /^[a-z-]{1,14}$/i.test(x.trim());
  const short = code(i.shortComment) ? null : String(i.shortComment).trim();
  const long = code(i.longComment) ? null : String(i.longComment).trim();
  const part = [said(d.type), said(d.side)?.toLowerCase(), said(d.detail)?.toLowerCase()].filter(Boolean).join(', ') || null;
  const ret = typeof d.returnDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d.returnDate) ? d.returnDate.slice(0, 10) : null;
  return {
    injury_status: i.status ?? i.type?.description ?? 'Injured',
    injury_note: short ?? (long ? long.split(/(?<=\.)\s/)[0] : null),
    injury_date: i.date ?? null,
    injury_return: ret,
    injury_part: d.type === 'Suspension' ? null : part,
    injury_list: said(d.fantasyStatus?.abbreviation) ?? said(i.type?.abbreviation),
    injury_detail: long && long !== short ? long : null,
  };
}
