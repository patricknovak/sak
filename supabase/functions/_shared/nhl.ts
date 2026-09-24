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

// box = /gamecenter/{id}/boxscore, landing = /gamecenter/{id}/landing
export function gameStats(box: any, landing: any): StatLine[] {
  const out = new Map<number, StatLine>();
  const home = box.homeTeam.abbrev, away = box.awayTeam.abbrev;
  const ppp = new Map<number, number>();
  const bump = (m: Map<number, number>, id: number) => m.set(id, (m.get(id) || 0) + 1);

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
        bump(ppp, goal.playerId);
        for (const a of goal.assists ?? []) bump(ppp, a.playerId);
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
          g: p.goals ?? 0, a: p.assists ?? 0, pm: p.plusMinus ?? 0, pim: p.pim ?? 0,
          ppp: ppp.get(p.playerId) ?? 0, gwg: gwg === p.playerId ? 1 : 0,
          sog: p.sog ?? 0, hit: p.hits ?? 0, blk: p.blockedShots ?? 0,
        },
      });
    }
    const goalies = (t.goalies ?? []).filter((g: any) => g.toi && g.toi !== '00:00');
    for (const g of goalies) {
      const ga = g.goalsAgainst ?? 0;
      out.set(g.playerId, {
        player_id: g.playerId, nhl_team: team,
        stats: {
          gs: g.starter ? 1 : 0, w: g.decision === 'W' ? 1 : 0, l: g.decision === 'L' ? 1 : 0,
          otl: g.decision === 'O' ? 1 : 0, ga, sv: g.saves ?? 0, sa: g.shotsAgainst ?? 0,
          sho: done && ga === 0 && g.decision === 'W' && goalies.length === 1 ? 1 : 0,
        },
      });
    }
  }
  return [...out.values()];
}
