// nhl-hub: a small proxy in front of the NHL's public API for the site's NHL page (the API sends no CORS
// headers, so browsers can't call it directly). Trims each payload to what the page shows and caches
// briefly so a room full of GMs on game night doesn't hammer the NHL.
//   ?task=scores&date=YYYY-MM-DD   every game that day: score, period, clock, goals with highlight clips, broadcasts, radio
//   ?task=standings                 the current standings (last season's final table in the off-season)
//   ?task=schedule&date=YYYY-MM-DD  the week from that date
//   ?task=game&id=<gameId>          landing (scoring, three stars, penalties) + box score for one game
import { NHL } from '../_shared/nhl.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const cache = new Map<string, { at: number; ttl: number; body: unknown }>();
const TTL = { scores: 20_000, standings: 300_000, schedule: 600_000, game: 20_000 };

async function get(path: string) {
  const r = await fetch(`${NHL}${path}`, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`NHL ${path}: ${r.status}`);
  return r.json();
}
const txt = (v: any) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const clipId = (path?: string | null) => { const m = /-(\d{10,})$/.exec(path ?? ''); return m ? m[1] : null; };

function team(t: any) {
  return { id: t.id, abbrev: t.abbrev, name: txt(t.commonName) || txt(t.name) || t.abbrev, place: txt(t.placeName), score: t.score ?? null, sog: t.sog ?? null, logo: t.logo ?? t.darkLogo ?? null, radio: t.radioLink ?? null, record: t.record ?? null };
}
function game(g: any) {
  return {
    id: g.id, date: g.gameDate, type: g.gameType, state: g.gameState, scheduleState: g.gameScheduleState, start: g.startTimeUTC, venue: txt(g.venue),
    period: g.periodDescriptor ? { n: g.periodDescriptor.number, type: g.periodDescriptor.periodType } : null,
    clock: g.clock ? { time: g.clock.timeRemaining, running: g.clock.running, intermission: g.clock.inIntermission } : null,
    home: team(g.homeTeam), away: team(g.awayTeam),
    outcome: g.gameOutcome?.lastPeriodType ?? null,
    tv: (g.tvBroadcasts ?? []).map((b: any) => ({ network: b.network, market: b.market, country: b.countryCode })),
    goals: (g.goals ?? []).map((x: any) => ({
      period: x.period, type: x.periodDescriptor?.periodType, time: x.timeInPeriod, playerId: x.playerId, name: `${txt(x.firstName)} ${txt(x.lastName)}`.trim() || txt(x.name),
      team: x.teamAbbrev, strength: x.strength, modifier: x.goalModifier, goalsToDate: x.goalsToDate, away: x.awayScore, home: x.homeScore, mugshot: x.mugshot ?? null,
      assists: (x.assists ?? []).map((a: any) => ({ playerId: a.playerId, name: txt(a.name), n: a.assistsToDate })),
      clip: x.highlightClip ?? clipId(x.highlightClipSharingUrl) ?? null,
    })),
    recap: clipId(g.threeMinRecap), condensed: clipId(g.condensedGame), link: g.gameCenterLink ? `https://www.nhl.com${g.gameCenterLink}` : null,
  };
}

async function scores(date: string) {
  const j = await get(`/score/${date}`);
  return { date: j.currentDate ?? date, prev: j.prevDate ?? null, next: j.nextDate ?? null, games: (j.games ?? []).map(game) };
}
async function schedule(date: string) {
  const j = await get(`/schedule/${date}`);
  return {
    prev: j.previousStartDate ?? null, next: j.nextStartDate ?? null, regularSeasonStart: j.regularSeasonStartDate ?? null,
    days: (j.gameWeek ?? []).map((d: any) => ({ date: d.date, games: (d.games ?? []).map(game) })),
  };
}
async function standings() {
  let j = await get('/standings/now');
  let asOf = 'now';
  if (!j.standings?.length) {
    // off-season: the last finished season's final table
    const s = await get('/standings-season');
    const done = (s.seasons ?? []).filter((x: any) => x.standingsEnd && x.standingsEnd < new Date().toISOString().slice(0, 10)).pop();
    if (done) { j = await get(`/standings/${done.standingsEnd}`); asOf = done.standingsEnd; }
  }
  return {
    asOf, rows: (j.standings ?? []).map((r: any) => ({
      abbrev: r.teamAbbrev?.default ?? r.teamAbbrev, name: txt(r.teamName), common: txt(r.teamCommonName), logo: r.teamLogo ?? null,
      conf: r.conferenceName, confAbbrev: r.conferenceAbbrev, div: r.divisionName, divAbbrev: r.divisionAbbrev,
      gp: r.gamesPlayed, w: r.wins, l: r.losses, otl: r.otLosses, pts: r.points, pct: r.pointPctg, row: r.regulationPlusOtWins, rw: r.regulationWins,
      gf: r.goalFor, ga: r.goalAgainst, diff: r.goalDifferential, home: `${r.homeWins}-${r.homeLosses}-${r.homeOtLosses}`, away: `${r.roadWins}-${r.roadLosses}-${r.roadOtLosses}`,
      l10: `${r.l10Wins}-${r.l10Losses}-${r.l10OtLosses}`, streak: `${r.streakCode ?? ''}${r.streakCount ?? ''}`, clinch: r.clinchIndicator ?? null,
      divRank: r.divisionSequence, confRank: r.conferenceSequence, leagueRank: r.leagueSequence, wildcard: r.wildcardSequence,
    })),
  };
}
async function gameDetail(id: string) {
  const [l, b] = await Promise.all([get(`/gamecenter/${id}/landing`), get(`/gamecenter/${id}/boxscore`).catch(() => null)]);
  const skater = (p: any) => ({ id: p.playerId, num: p.sweaterNumber, name: txt(p.name), pos: p.position, g: p.goals, a: p.assists, pts: p.points, pm: p.plusMinus, pim: p.pim, sog: p.sog, hit: p.hits, blk: p.blockedShots, toi: p.toi, fo: p.faceoffWinningPctg });
  const goalie = (p: any) => ({ id: p.playerId, num: p.sweaterNumber, name: txt(p.name), pos: 'G', sa: p.saveShotsAgainst, svp: p.savePctg, ga: p.goalsAgainst, toi: p.toi, decision: p.decision ?? null, starter: p.starter ?? false });
  const side = (t: any) => (t ? { forwards: (t.forwards ?? []).map(skater), defense: (t.defense ?? []).map(skater), goalies: (t.goalies ?? []).map(goalie) } : null);
  return {
    ...game({ ...l, goals: [] }),
    scoring: (l.summary?.scoring ?? []).map((p: any) => ({
      period: p.periodDescriptor?.number, type: p.periodDescriptor?.periodType,
      goals: (p.goals ?? []).map((x: any) => ({
        time: x.timeInPeriod, playerId: x.playerId, name: `${txt(x.firstName)} ${txt(x.lastName)}`.trim() || txt(x.name), team: x.teamAbbrev?.default ?? x.teamAbbrev, strength: x.strength, modifier: x.goalModifier,
        goalsToDate: x.goalsToDate, away: x.awayScore, home: x.homeScore, mugshot: x.headshot ?? null, assists: (x.assists ?? []).map((a: any) => ({ playerId: a.playerId, name: txt(a.name), n: a.assistsToDate })),
        clip: x.highlightClip ?? clipId(x.highlightClipSharingUrl) ?? null,
      })),
    })),
    stars: (l.summary?.threeStars ?? []).map((s: any) => ({ star: s.star, playerId: s.playerId, team: s.teamAbbrev, name: txt(s.name), pos: s.position, g: s.goals, a: s.assists, pts: s.points, svp: s.savePctg, ga: s.goalsAgainst, headshot: s.headshot ?? null })),
    penalties: (l.summary?.penalties ?? []).map((p: any) => ({ period: p.periodDescriptor?.number, items: (p.penalties ?? []).map((x: any) => ({ time: x.timeInPeriod, team: x.teamAbbrev?.default ?? x.teamAbbrev, who: txt(x.committedByPlayer) || txt(x.teamAbbrev), desc: x.descKey, min: x.duration })) })),
    box: b ? { home: side(b.playerByGameStats?.homeTeam), away: side(b.playerByGameStats?.awayTeam) } : null,
    recap: clipId(l.summary?.gameVideo?.threeMinRecap ? `-${l.summary.gameVideo.threeMinRecap}` : null) ?? clipId(l.threeMinRecap), condensed: clipId(l.summary?.gameVideo?.condensedGame ? `-${l.summary.gameVideo.condensedGame}` : null) ?? clipId(l.condensedGame),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const task = url.searchParams.get('task') ?? 'scores';
  const date = url.searchParams.get('date') ?? 'now';
  const id = url.searchParams.get('id') ?? '';
  if (!/^(now|\d{4}-\d{2}-\d{2})$/.test(date) || !/^\d{0,12}$/.test(id)) return Response.json({ error: 'bad request' }, { status: 400, headers: cors });
  const key = `${task}:${date}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Response.json(hit.body, { headers: { ...cors, 'x-cache': 'hit' } });
  try {
    const body = task === 'standings' ? await standings() : task === 'schedule' ? await schedule(date) : task === 'game' ? await gameDetail(id) : await scores(date);
    cache.set(key, { at: Date.now(), ttl: TTL[task as keyof typeof TTL] ?? 20_000, body });
    if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > v.ttl) cache.delete(k);
    return Response.json(body, { headers: { ...cors, 'x-cache': 'miss' } });
  } catch (e) {
    console.error(task, e);
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502, headers: cors });
  }
});
