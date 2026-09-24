// player-info?id=NHL_ID: season-by-season NHL regular-season stats for one player plus an NHL bio
// (birthplace, size, draft, awards, playoffs, junior history), cached for a day. Seasons carry every
// stat the SaK scoring editor can weight, so the site can price each season under current scoring.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const report = async (kind: string, name: string, id: number) => {
  const r = await fetch(`https://api.nhle.com/stats/rest/en/${kind}/${name}?limit=-1&cayenneExp=playerId=${id}%20and%20gameTypeId=2`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return ((await r.json()).data ?? []) as any[];
};

async function fetchSeasons(id: number, goalie: boolean) {
  if (goalie) {
    const rows = await report('goalie', 'summary', id);
    return rows.map((s) => ({
      season: s.seasonId, team: s.teamAbbrevs, gp: s.gamesPlayed, gs: s.gamesStarted, w: s.wins, l: s.losses,
      otl: s.otLosses, ga: s.goalsAgainst, sa: s.shotsAgainst, sv: s.saves, sho: s.shutouts, svp: s.savePct,
    }));
  }
  const [sum, rt, fo] = await Promise.all([report('skater', 'summary', id), report('skater', 'realtime', id), report('skater', 'faceoffwins', id)]);
  const rtBy = new Map(rt.map((r) => [r.seasonId, r]));
  const foBy = new Map(fo.map((r) => [r.seasonId, r]));
  return sum.map((s) => {
    const r = rtBy.get(s.seasonId) ?? {}, f = foBy.get(s.seasonId) ?? {};
    return {
      season: s.seasonId, team: s.teamAbbrevs, gp: s.gamesPlayed, g: s.goals, a: s.assists, pts: s.points,
      pm: s.plusMinus, pim: s.penaltyMinutes, ppg: s.ppGoals, ppa: s.ppPoints - s.ppGoals, ppp: s.ppPoints,
      shg: s.shGoals, sha: s.shPoints - s.shGoals, shp: s.shPoints, gwg: s.gameWinningGoals, sog: s.shots,
      fow: f.totalFaceoffWins ?? 0, fol: f.totalFaceoffLosses ?? 0, hit: r.hits ?? 0, blk: r.blockedShots ?? 0,
    };
  });
}

// bio, awards, playoff totals and pre-NHL history from the NHL's player landing page
async function fetchBio(id: number) {
  const r = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`);
  if (!r.ok) return null;
  const d = await r.json();
  const txt = (x: any) => (x && typeof x === 'object' ? x.default : x) ?? null;
  return {
    number: d.sweaterNumber ?? null, position: d.position ?? null, team: d.fullTeamName ? txt(d.fullTeamName) : null,
    birthDate: d.birthDate ?? null, birthCity: txt(d.birthCity), birthState: txt(d.birthStateProvince), birthCountry: d.birthCountry ?? null,
    heightIn: d.heightInInches ?? null, heightCm: d.heightInCentimeters ?? null, weightLb: d.weightInPounds ?? null, weightKg: d.weightInKilograms ?? null,
    shoots: d.shootsCatches ?? null, draft: d.draftDetails ?? null, hero: d.heroImage ?? null, slug: d.playerSlug ?? null,
    hhof: !!d.inHHOF, top100: !!d.inTop100AllTime,
    awards: (d.awards ?? []).map((a: any) => ({ trophy: txt(a.trophy), seasons: (a.seasons ?? []).map((x: any) => x.seasonId) })),
    playoffs: d.careerTotals?.playoffs ?? null, career: d.careerTotals?.regularSeason ?? null,
    // junior, college, European and minor-league seasons before (or alongside) the NHL
    other: (d.seasonTotals ?? []).filter((s: any) => s.leagueAbbrev !== 'NHL' && s.gameTypeId === 2).map((s: any) => ({
      season: s.season, league: s.leagueAbbrev, team: txt(s.teamName), gp: s.gamesPlayed ?? 0, g: s.goals ?? null, a: s.assists ?? null,
      pts: s.points ?? null, w: s.wins ?? null, gaa: s.goalsAgainstAvg ?? null, svp: s.savePctg ?? null,
    })),
    playoffSeasons: (d.seasonTotals ?? []).filter((s: any) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 3).map((s: any) => ({
      season: s.season, team: txt(s.teamName), gp: s.gamesPlayed ?? 0, g: s.goals ?? null, a: s.assists ?? null, pts: s.points ?? null,
      w: s.wins ?? null, gaa: s.goalsAgainstAvg ?? null, svp: s.savePctg ?? null,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: cors });
    const { data: cached } = await db.from('player_history').select('seasons,bio,fetched_at').eq('player_id', id).maybeSingle();
    if (cached?.bio && Date.now() - new Date(cached.fetched_at).getTime() < 86400000) {
      return Response.json({ seasons: cached.seasons, bio: cached.bio, cached: true }, { headers: cors });
    }
    const { data: p } = await db.from('players').select('pos').eq('id', id).maybeSingle();
    const [raw, bio] = await Promise.all([fetchSeasons(id, p?.pos === 'G'), fetchBio(id).catch(() => null)]);
    const seasons = raw.sort((a, b) => b.season - a.season);
    await db.from('player_history').upsert({ player_id: id, seasons, bio, fetched_at: new Date().toISOString() });
    return Response.json({ seasons, bio, cached: false }, { headers: cors });
  } catch (e) {
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 500, headers: cors });
  }
});
