// nhl-hub: a small proxy in front of the NHL's public API for the site's NHL page (the API sends no CORS
// headers, so browsers can't call it directly). Trims each payload to what the page shows and caches
// briefly so a room full of GMs on game night doesn't hammer the NHL.
//   ?task=scores&date=YYYY-MM-DD   every game that day: score, period, clock, goals with highlight clips, broadcasts, radio
//   ?task=standings                 the current standings (last season's final table in the off-season)
//   ?task=schedule&date=YYYY-MM-DD  the week from that date
//   ?task=game&id=<gameId>          landing (scoring, three stars, penalties) + box score for one game
//   ?task=news                      NHL.com stories + Sportsnet and ESPN headlines, newest first
//   ?task=leaders                   league leaders: skaters (points, goals, assists, +/-, PIM, PP/SH goals, faceoffs) and goalies
//   ?task=team&abbrev=EDM           one club: roster, this week's games, season stats for every player
//   ?task=fan&abbrev=EDM            a club's fan zone: its season against every club's, tracking, usage, schedule, news
//   ?task=fan-history&abbrev=EDM    a franchise's history from the NHL's record books: seasons, leaders, trophies, draft
//   ?task=fan-office&abbrev=EDM     a club's front office: its goalies in depth, the league's goalies and skaters worth a call, lines
//   ?task=lines&id=<gameId>         each club's lines for a game: four forward lines, three defence pairs and the goalies,
//                                   worked out from the NHL's shift charts (a game that has started: its own 5-on-5; one
//                                   that hasn't: each club's last game)
//   ?task=espn&sport=football/nfl&id=<event>  one game's box score from ESPN's public summary (NFL centre): each team's
//                                   stats, its leaders, and the scoring plays (cached for the game's state)
//   ?task=sport-news|sport-standings|sport-injuries|sport-leaders&sport=soccer/eng.1  every other sport's centre: ESPN's
//                                   headlines, table, injury report and leaders (top scorers for soccer), cached in hub_cache
//   ?task=fan-sport-league&league=nfl   another league's fan zones (fan_leagues: the NFL, the NBA, the Premier League):
//                                   every club, the table, every club's season numbers, the season's games, the leaders
//   ?task=fan-sport&league=nfl&club=KC  one of its clubs: roster, leaders, injuries, coach, next game, news
//   ?task=fan-sport-history&league=nfl  every club's seasons since 2002/2003 from ESPN's tables and postseasons, and the champions
//   ?task=x                         NHL insiders on X: through the X API when X_BEARER_TOKEN is set, otherwise through
//                                   Grok's X search with the XAI_API_KEY the league already uses for Garry (shared cache
//                                   in hub_cache so the whole league costs one search every few minutes)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { NHL } from '../_shared/nhl.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const cache = new Map<string, { at: number; ttl: number; body: unknown }>();
const TTL = { lines: 3_600_000, scores: 20_000, standings: 300_000, schedule: 600_000, game: 20_000, news: 600_000, leaders: 600_000, team: 300_000, x: 120_000 };
// How old the league-wide X feed may get before the next request refreshes it. Each refresh is a paid X search
// (xAI bills per post it reads), so it's ten minutes from late morning to 1 am Eastern, when the news breaks and
// people are looking, and an hour overnight.
const xSharedTtl = () => {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  return h >= 11 || h < 1 ? 600_000 : 3_600_000;
};

// team radio streams live under lowercase team codes this season ('/tor/20262027/tor-radio.m3u8'); the schedule still
// hands out uppercase ones, which the stream host refuses (403)
const radioUrl = (url: string | null | undefined) => {
  if (!url) return null;
  try { const u = new URL(url); if (/cloudfront\.net$/.test(u.hostname)) u.pathname = u.pathname.toLowerCase(); return u.toString(); } catch { return url; }
};

async function get(path: string) {
  const r = await fetch(`${NHL}${path}`, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`NHL ${path}: ${r.status}`);
  return r.json();
}
const txt = (v: any) => (v && typeof v === 'object' ? v.default ?? '' : v ?? '');
const clipId = (path?: string | null) => { const m = /-(\d{10,})$/.exec(path ?? ''); return m ? m[1] : null; };

function team(t: any) {
  return { id: t.id, abbrev: t.abbrev, name: txt(t.commonName) || txt(t.name) || t.abbrev, place: txt(t.placeName), score: t.score ?? null, sog: t.sog ?? null, logo: t.logo ?? t.darkLogo ?? null, radio: radioUrl(t.radioLink), record: t.record ?? null };
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

// ───────────── straight to the game on Sportsnet+ ─────────────
// Sportsnet+'s player (watch.sportsnet.ca) lists every live and upcoming event in its public catalogue, each NHL game
// with its own page in the player: the national broadcast, each team's feed, the French one. Joining them to the NHL's
// games lets Watch live and NHL centre open the game itself instead of a home page (Patrick, 7 October 2026: "Fastest
// route possible to games"). It's the broadcaster's own player behind the viewer's own sign-in; nothing is restreamed.
const SN_PLAYER = 'https://watch.sportsnet.ca';
const SN_LIST = 'https://production-cdn.d3-rgr-diva.com/api/lists/22268?page=1&page_size=100';
type SnFeed = { start: number; home: string; away: string; url: string; label: string; lang: string; master: boolean; live: boolean };
let snCache: { at: number; feeds: SnFeed[] } | null = null;
async function snFeeds(): Promise<SnFeed[]> {
  if (snCache && Date.now() - snCache.at < 120_000) return snCache.feeds;
  try {
    const r = await fetch(SN_LIST, { headers: { accept: 'application/json', 'user-agent': 'sak-league' } });
    if (!r.ok) throw new Error(`sportsnet ${r.status}`);
    const j = await r.json();
    const feeds = (j.items ?? []).filter((x: any) => x.customFields?.League === 'nhl' && x.watchPath && x.eventStartDate).map((x: any) => {
      const cf = x.customFields;
      const fr = cf.BroadcastLanguage === 'fr';
      // 'Canadiens Broadcast: Carolina @ Montreal' is that team's own feed; no name is the national broadcast
      const team = String(cf.BroadcastName ?? '').split(':')[0].replace(/\s*Broadcast$/i, '').trim();
      return {
        start: Date.parse(x.eventStartDate), home: String(cf.HomeTeamToggle ?? ''), away: String(cf.AwayTeamToggle ?? ''),
        url: SN_PLAYER + x.watchPath, lang: fr ? 'fr' : 'en', master: cf.IsMaster === true || cf.IsMaster === 'true',
        live: cf.VideoStatus === 'Live', label: fr ? 'En français' : team ? `${team} feed` : 'National broadcast',
      };
    });
    snCache = { at: Date.now(), feeds };
    return feeds;
  } catch (e) {
    console.error('sportsnet feeds', e);
    return snCache?.feeds ?? [];
  }
}
const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
// Sportsnet+ names a club by its city ('Montreal', 'Utah', 'New York Rangers'); the NHL's scores give the club's name
const CITY: Record<string, string> = {
  ANA: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CGY: 'Calgary', CAR: 'Carolina', CHI: 'Chicago', COL: 'Colorado', CBJ: 'Columbus',
  DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Florida', LAK: 'Los Angeles', MIN: 'Minnesota', MTL: 'Montreal', NSH: 'Nashville',
  NJD: 'New Jersey', NYI: 'New York Islanders', NYR: 'New York Rangers', OTT: 'Ottawa', PHI: 'Philadelphia', PIT: 'Pittsburgh',
  SJS: 'San Jose', SEA: 'Seattle', STL: 'St Louis', TBL: 'Tampa Bay', TOR: 'Toronto', UTA: 'Utah', VAN: 'Vancouver', VGK: 'Vegas',
  WSH: 'Washington', WPG: 'Winnipeg',
};
type SnTeam = { abbrev: string; place: string; name: string };
const sameTeam = (s: string, t: SnTeam) => {
  const n = plain(s), city = plain(CITY[t.abbrev] ?? t.place), name = plain(t.name);
  return !!n && (n === city || (!!name && n.includes(name)) || (!!city && n === `${city} ${name}`));
};
// the Sportsnet+ pages for one game: the English main broadcast first, then the other feeds, French last
function snFor(feeds: SnFeed[], g: { start: string; home: SnTeam; away: SnTeam }) {
  const t = Date.parse(g.start);
  return feeds.filter((f) => Math.abs(f.start - t) <= 90 * 60_000 && sameTeam(f.home, g.home) && sameTeam(f.away, g.away))
    .sort((a, b) => Number(a.lang === 'fr') - Number(b.lang === 'fr') || Number(b.master) - Number(a.master))
    .map(({ url, label, lang, master, live }) => ({ url, label, lang, master, live }));
}

async function scores(date: string) {
  // the day's scores carry no radio links; the schedule for the same day does, so they are joined by game
  const [j, w] = await Promise.all([get(`/score/${date}`), get(`/schedule/${date}`).catch(() => null)]);
  const radio = new Map<number, { home?: string; away?: string }>();
  for (const d of w?.gameWeek ?? []) for (const g of d.games ?? []) radio.set(g.id, { home: g.homeTeam?.radioLink, away: g.awayTeam?.radioLink });
  const sn = await snFeeds();
  const games = (j.games ?? []).map((g: any) => {
    const r = radio.get(g.id);
    const x = game(r ? { ...g, homeTeam: { radioLink: r.home, ...g.homeTeam }, awayTeam: { radioLink: r.away, ...g.awayTeam } } : g);
    return { ...x, sn: snFor(sn, x) };
  });
  return { date: j.currentDate ?? date, prev: j.prevDate ?? null, next: j.nextDate ?? null, games };
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
  const base = game({ ...l, goals: [] });
  return {
    ...base, sn: snFor(await snFeeds(), base),
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

// ── news: NHL.com (official, via its content API) plus Sportsnet and ESPN RSS
const FORGE = 'https://forge-dapi.d3.nhle.com/v2/content/en-us/stories?%24limit=40&%24sort=contentDate:desc';
const strip = (h: string) => h.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘').replace(/&#8220;|&ldquo;/g, '“').replace(/&#8221;|&rdquo;/g, '”').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function rss(xml: string, source: string) {
  const items = xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/g) ?? [];
  const tag = (it: string, t: string) => { const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`).exec(it); return m ? strip(m[1]) : ''; };
  return items.map((it) => {
    const link = tag(it, 'link') || (/<link[^>]*href="([^"]+)"/.exec(it)?.[1] ?? '');
    const img = /<(?:media:content|media:thumbnail|enclosure)[^>]*url="([^"]+)"/.exec(it)?.[1] ?? null;
    return { id: `${source}:${link}`, source, headline: tag(it, 'title'), summary: tag(it, 'description').slice(0, 280), date: new Date(tag(it, 'pubDate') || 0).toISOString(), url: link, image: img, tags: [] as string[] };
  }).filter((x) => x.headline && x.url && !/sn-collection/.test(x.url));
}
async function news() {
  const ua = { headers: { 'user-agent': 'Mozilla/5.0 (compatible; sak-league)' } };
  const [forge, sn, espn] = await Promise.all([
    fetch(FORGE, ua).then((r) => r.json()).catch(() => ({ items: [] })),
    fetch('https://www.sportsnet.ca/hockey/nhl/feed/', ua).then((r) => r.text()).catch(() => ''),
    fetch('https://www.espn.com/espn/rss/nhl/news', ua).then((r) => r.text()).catch(() => ''),
  ]);
  const official = (forge.items ?? []).map((i: any) => ({
    id: `nhl:${i._entityId}`, source: 'NHL.com', headline: i.headline || i.title, summary: (i.summary ?? '').slice(0, 280), date: i.contentDate,
    url: `https://www.nhl.com/news/${i.slug}`, image: i.thumbnail?.templateUrl ? i.thumbnail.templateUrl.replace('{formatInstructions}', 't_ratio16_9-size40') : null,
    tags: (i.tags ?? []).map((t: any) => t.slug).filter(Boolean),
  }));
  const all = [...official, ...rss(sn, 'Sportsnet'), ...rss(espn, 'ESPN')].filter((x) => x.date && x.date !== '1970-01-01T00:00:00.000Z');
  all.sort((a, b) => b.date.localeCompare(a.date));
  return { items: all.slice(0, 80) };
}

// ── X (Twitter): the NHL insiders' feed. Through the X API v2 when the X_BEARER_TOKEN secret is set (a paid
// X developer plan); otherwise through Grok's X search (xAI Responses API, x_search tool) with the league's
// XAI_API_KEY. Grok's answer is cached in hub_cache for everyone, so it's one search per refresh window (xSharedTtl).
// The default insiders. The commissioner can change the list (and add topics) on the Commissioner page; that
// lives in league.info.x_feed = { accounts: [{handle, name}], topics: [string] } and wins over these defaults.
const X_DEFAULT: [string, string][] = [['NHL', 'NHL'], ['PR_NHL', 'NHL Public Relations'], ['FriedgeHNIC', 'Elliotte Friedman'], ['TSNBobMcKenzie', 'Bob McKenzie'],
  ['PierreVLeBrun', 'Pierre LeBrun'], ['DarrenDreger', 'Darren Dreger'], ['frank_seravalli', 'Frank Seravalli'], ['emilymkaplan', 'Emily Kaplan'],
  ['reporterchris', 'Chris Johnston'], ['NHLInjuryNews', 'NHL Injury News'], ['PuckPedia', 'PuckPedia'], ['DailyFaceoff', 'Daily Faceoff']];
type XPost = { id: string; text: string; at: string; url: string; author: { name: string; handle: string; avatar: string | null }; likes: number; reposts: number; link: { url: string; title: string | null } | null; image: string | null };
type XConfig = { accounts: [string, string][]; topics: string[]; key: string };
async function xConfig(): Promise<XConfig> {
  const { data } = await db.from('league').select('info').eq('id', 1).maybeSingle();
  const cfg = (data?.info as any)?.x_feed;
  const list: [string, string][] = Array.isArray(cfg?.accounts) && cfg.accounts.length
    ? cfg.accounts.map((a: any) => [String(a.handle ?? '').replace(/^@/, '').trim(), String(a.name ?? a.handle ?? '').trim()] as [string, string]).filter(([h]: [string, string]) => /^[A-Za-z0-9_]{1,15}$/.test(h)).slice(0, 20)
    : X_DEFAULT;
  const topics: string[] = Array.isArray(cfg?.topics) ? cfg.topics.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 12) : [];
  return { accounts: list, topics, key: JSON.stringify([list.map(([h]) => h.toLowerCase()), topics.map((t) => t.toLowerCase())]) };
}
const accountsOf = (c: XConfig) => c.accounts.map(([handle, name]) => ({ handle, name, url: `https://x.com/${handle}` }));

async function xApi(token: string, cfg: XConfig): Promise<XPost[]> {
  const topic = cfg.topics.length ? ` (${cfg.topics.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ')})` : '';
  const query = `(${cfg.accounts.map(([h]) => `from:${h}`).join(' OR ')})${topic} -is:retweet -is:reply`;
  const u = new URL('https://api.x.com/2/tweets/search/recent');
  u.searchParams.set('query', query);
  u.searchParams.set('max_results', '50');
  u.searchParams.set('tweet.fields', 'created_at,public_metrics,entities,attachments');
  u.searchParams.set('expansions', 'author_id,attachments.media_keys');
  u.searchParams.set('user.fields', 'name,username,profile_image_url,verified');
  u.searchParams.set('media.fields', 'url,preview_image_url,type');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`X API ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const users = new Map<string, any>((j.includes?.users ?? []).map((x: any) => [x.id, x]));
  const media = new Map<string, any>((j.includes?.media ?? []).map((m: any) => [m.media_key, m]));
  return (j.data ?? []).map((t: any) => {
    const a = users.get(t.author_id) ?? {};
    const link = (t.entities?.urls ?? []).find((x: any) => x.expanded_url && !/x\.com|twitter\.com/.test(x.expanded_url));
    const pic = (t.attachments?.media_keys ?? []).map((k: string) => media.get(k)).find((m: any) => m && (m.url || m.preview_image_url));
    return {
      id: t.id, text: t.text, at: t.created_at, url: `https://x.com/${a.username ?? 'i'}/status/${t.id}`,
      author: { name: a.name ?? '', handle: a.username ?? '', avatar: a.profile_image_url ?? null },
      likes: t.public_metrics?.like_count ?? 0, reposts: t.public_metrics?.retweet_count ?? 0,
      link: link ? { url: link.expanded_url, title: link.title ?? null } : null, image: pic ? pic.url ?? pic.preview_image_url : null,
    };
  });
}

// Grok reads X for us: the x_search tool restricted to the insiders (the tool takes up to 10 handles), and the
// model writes the posts back as JSON. Post ids come from the status URLs it cites.
// (more than 10 accounts means two groups)
// A refresh asks only for what's new since the newest post already on the feed from those accounts (the search
// reads, and xAI bills, every post it looks at: half a cent a post, which is most of the cost), then merges it into
// the cached feed, which keeps the last 48 hours. Once the feed exists, each refresh searches one group in turn, so
// a refresh is one paid search and every account is still looked at every other refresh.
async function xGrok(apiKey: string, cfg: XConfig, prev: XPost[] = []): Promise<XPost[]> {
  const all = cfg.accounts.map(([h]) => h);
  const chunks = [all.slice(0, 10), ...(all.length > 10 ? [all.slice(10, 20)] : [])];
  const turn = prev.length ? [chunks[Math.floor(Date.now() / xSharedTtl()) % chunks.length]] : chunks;
  const newest = (handles: string[]) => {
    const hs = new Set(handles.map((h) => h.toLowerCase()));
    const mine = prev.filter((p) => hs.has(p.author.handle.toLowerCase()));
    return mine.length ? mine.reduce((m, p) => (p.at > m ? p.at : m), mine[0].at) : prev.length ? new Date(Date.now() - 86400000).toISOString() : null;
  };
  const results = await Promise.all(turn.map((handles) => xGrokOnce(apiKey, handles, cfg, newest(handles))));
  const cutoff = new Date(Date.now() - 2 * 86400000).toISOString();
  const seen = new Set<string>();
  return [...results.flat(), ...prev].filter((p) => p.at >= cutoff && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
}
// what the X searches cost, by Eastern day, on hub_cache 'x_usage': searches, tokens, posts read and dollars
async function xMeter(u: Record<string, unknown> | undefined) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const { data } = await db.from('hub_cache').select('body').eq('key', 'x_usage').maybeSingle();
  const cur = (data?.body as Record<string, unknown> | undefined)?.day === day ? data!.body as Record<string, number> : { day } as unknown as Record<string, number>;
  const n = (k: string) => Number(cur[k] ?? 0);
  const body = { ...cur, day, searches: n('searches') + 1, input: n('input') + Number(u?.input_tokens ?? 0), output: n('output') + Number(u?.output_tokens ?? 0),
    tool_calls: n('tool_calls') + Number(u?.num_server_side_tools_used ?? 0),
    posts_read: n('posts_read') + Number((u?.server_side_tool_usage_details as Record<string, unknown> | undefined)?.x_posts_fetched ?? 0),
    // xAI prices every call itself, in ticks of a ten-billionth of a dollar
    usd: Math.round((n('usd') + Number(u?.cost_in_usd_ticks ?? 0) / 1e10) * 10000) / 10000, last: u ?? null };
  await db.from('hub_cache').upsert({ key: 'x_usage', body, at: new Date().toISOString() });
  // and on the running-costs ledger, as a cost every league shares (league 0)
  await db.rpc('meter_cost', { p_league: 0, p_source: 'xai', p_feature: 'hub.x_feed', p_calls: 1, p_input: Number(u?.input_tokens ?? 0),
    p_cached: Number((u?.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens ?? 0), p_output: Number(u?.output_tokens ?? 0),
    p_units: Number((u?.server_side_tool_usage_details as Record<string, unknown> | undefined)?.x_posts_fetched ?? 0),
    p_usd: Number(u?.cost_in_usd_ticks ?? 0) / 1e10 });
}
async function xGrokOnce(apiKey: string, handles: string[], cfg: XConfig, since: string | null = null): Promise<XPost[]> {
  const today = new Date(), from = since ? new Date(since) : new Date(Date.now() - 2 * 86400000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  const r = await fetch('https://api.x.ai/v1/responses', {
    method: 'POST', signal: ctl.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: Deno.env.get('GROK_SEARCH_MODEL') || 'grok-4.3',   // grok-4-1-fast was retired in May 2026 and redirects here anyway
      tools: [{ type: 'x_search', allowed_x_handles: handles, from_date: day(from), to_date: day(today) }],
      input: [
        { role: 'system', content: 'You are a data extractor. You search X and return only JSON, never prose.' },
        { role: 'user', content: `Find the most recent posts (${since ? `posted after ${since}, newest first, up to 15` : 'last 48 hours, newest first, up to 40'}) from these X accounts about the NHL: ${handles.map((h) => '@' + h).join(', ')}. Include injuries, lineups, trades, signings, call-ups, waivers, scores and news${cfg.topics.length ? `, and give priority to posts about: ${cfg.topics.join(', ')}` : ''}. Skip replies and retweets.
Return exactly this JSON and nothing else:
{"posts":[{"handle":"<account handle without @>","name":"<account display name>","text":"<the post text, verbatim>","url":"<https://x.com/<handle>/status/<id>>","at":"<ISO 8601 timestamp, UTC>","link":"<first non-X URL in the post or null>"}]}` },
      ],
    }),
  }).finally(() => clearTimeout(timer));
  if (!r.ok) throw new Error(`Grok ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  await xMeter(j?.usage).catch(() => {});
  const text: string = (j.output ?? []).filter((o: any) => o.type === 'message').flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === 'output_text').map((c: any) => c.text).join('\n')
    || j.output_text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Grok returned no JSON: ' + text.slice(0, 120));
  let items: any[] = [];
  try { items = JSON.parse(m[0]).posts ?? []; } catch { throw new Error('Grok JSON did not parse'); }
  const names = new Map(cfg.accounts.map(([h, n]) => [h.toLowerCase(), n]));
  const seen = new Set<string>();
  return items.map((p: any) => {
    const handle = String(p.handle ?? '').replace(/^@/, '');
    const idm = String(p.url ?? '').match(/status\/(\d+)/);
    const id = idm ? idm[1] : `${handle}-${String(p.at ?? '').slice(0, 16)}`;
    const at = p.at && !isNaN(Date.parse(p.at)) ? new Date(p.at).toISOString() : new Date().toISOString();
    return { id, text: String(p.text ?? '').trim(), at, url: idm ? `https://x.com/${handle}/status/${idm[1]}` : `https://x.com/${handle}`,
      author: { name: p.name || names.get(handle.toLowerCase()) || handle, handle, avatar: null }, likes: 0, reposts: 0,
      link: p.link && /^https?:\/\//.test(p.link) && !/x\.com|twitter\.com/.test(p.link) ? { url: p.link, title: null } : null, image: null } as XPost;
  }).filter((p) => p.text && p.author.handle && !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
}

async function xfeed() {
  // off across Super Pools for now (23 October 2026, Patrick): no X search and nothing paid until X_FEED=on is set again;
  // an older copy of the site that still asks gets an empty, switched-off feed
  if (Deno.env.get('X_FEED') !== 'on') return { configured: false, off: true, source: null, accounts: [], topics: [], posts: [] };
  const token = Deno.env.get('X_BEARER_TOKEN');
  const xai = Deno.env.get('XAI_API_KEY');
  const cfg = await xConfig();
  const accounts = accountsOf(cfg);
  if (!token && !xai) return { configured: false, source: null, accounts, topics: cfg.topics, posts: [] };
  // the league shares one feed: serve the cached one while it's fresh and built from the same account list.
  // When it's gone stale (or the commish changed the list) the old feed goes out right away and the refresh
  // runs in the background, so nobody waits on a Grok search.
  const { data: hit } = await db.from('hub_cache').select('body,at').eq('key', 'x').maybeSingle();
  const same = !!hit && (hit.body as any)?.config_key === cfg.key;
  const fresh = same && Date.now() - new Date(hit!.at).getTime() < xSharedTtl();
  if (fresh) return hit!.body;
  const refresh = async () => {
    // a changed account list starts the feed over; otherwise only what's new is fetched and merged in
    const posts = token ? await xApi(token, cfg) : await xGrok(xai!, cfg, same ? ((hit!.body as any)?.posts ?? []) as XPost[] : []);
    const body = { configured: true, source: token ? 'x' : 'grok', accounts, topics: cfg.topics, posts, fetched_at: new Date().toISOString(), config_key: cfg.key };
    await db.from('hub_cache').upsert({ key: 'x', body, at: new Date().toISOString() });
    return body;
  };
  if (hit && !xRefreshing) {
    xRefreshing = refresh().catch((e) => console.error('xfeed refresh', e)).finally(() => { xRefreshing = null; });
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(xRefreshing);
    // the list changed: say so, and keep the old posts on screen until the new search lands
    return { ...(hit.body as object), accounts, topics: cfg.topics, refreshing: true };
  }
  if (hit) return { ...(hit.body as object), accounts, topics: cfg.topics, refreshing: true };
  try { return await refresh(); } catch (e) { console.error('xfeed', e); throw e; }
}
let xRefreshing: Promise<unknown> | null = null;

// ── league leaders
async function leaders() {
  const [s, g] = await Promise.all([
    get('/skater-stats-leaders/current?categories=points,goals,assists,plusMinus,penaltyMins,goalsPp,goalsSh,faceoffLeaders&limit=10'),
    get('/goalie-stats-leaders/current?categories=wins,savePctg,goalsAgainstAverage,shutouts&limit=10'),
  ]);
  const row = (p: any) => ({ id: p.id, name: `${txt(p.firstName)} ${txt(p.lastName)}`, num: p.sweaterNumber, pos: p.position, team: p.teamAbbrev, logo: p.teamLogo ?? null, headshot: p.headshot ?? null, value: p.value });
  const cats = (j: any) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k, (v as any[]).map(row)]));
  return { skaters: cats(s), goalies: cats(g) };
}

// ── one club
async function club(abbrev: string) {
  const [r, st, sc] = await Promise.all([get(`/roster/${abbrev}/current`), get(`/club-stats/${abbrev}/now`).catch(() => null), get(`/club-schedule/${abbrev}/week/now`).catch(() => null)]);
  const person = (p: any) => ({ id: p.id, name: `${txt(p.firstName)} ${txt(p.lastName)}`, num: p.sweaterNumber, pos: p.positionCode, shoots: p.shootsCatches, ht: p.heightInInches, wt: p.weightInPounds, born: p.birthDate, country: p.birthCountry, headshot: p.headshot ?? null });
  const sk = (p: any) => ({ id: p.playerId, name: `${txt(p.firstName)} ${txt(p.lastName)}`, pos: p.positionCode, gp: p.gamesPlayed, g: p.goals, a: p.assists, pts: p.points, pm: p.plusMinus, pim: p.penaltyMinutes, ppg: p.powerPlayGoals, sog: p.shots, pct: p.shootingPctg, toi: p.avgTimeOnIcePerGame });
  const go = (p: any) => ({ id: p.playerId, name: `${txt(p.firstName)} ${txt(p.lastName)}`, gp: p.gamesPlayed, gs: p.gamesStarted, w: p.wins, l: p.losses, otl: p.overtimeLosses, gaa: p.goalsAgainstAverage, svp: p.savePercentage, so: p.shutouts });
  return {
    abbrev, roster: { forwards: (r.forwards ?? []).map(person), defense: (r.defensemen ?? []).map(person), goalies: (r.goalies ?? []).map(person) },
    stats: st ? { season: st.season, type: st.gameType, skaters: (st.skaters ?? []).map(sk).sort((a: any, b: any) => b.pts - a.pts), goalies: (st.goalies ?? []).map(go).sort((a: any, b: any) => b.gp - a.gp) } : null,
    week: sc ? { prev: sc.previousStartDate ?? null, next: sc.nextStartDate ?? null, games: (sc.games ?? []).map(game) } : null,
  };
}

// ── a club's fan zone (24 October 2026, Patrick: "the most incredible fan page of the Oilers"): everything the page
// draws for one club in one call, kept in hub_cache for a quarter of an hour. The club's season and last season, every
// club's team numbers (so the page ranks this one against the league: results, situations, special teams, discipline,
// possession), the NHL's tracking numbers for the club (skating, shot speed, where it shoots from, zone time), the full
// table and the club's whole schedule (for the playoff odds and the splits), its players' usage, 5-on-5 rates and
// careers, its goalies' quality starts, its prospects, its last three playoff runs and its news. The analysis is the
// site's, from these numbers (src/lib/fanZone.ts). The franchise's history, which barely moves, is `fan-history` below.
const STATS_API = 'https://api.nhle.com/stats/rest/en';
const RECORDS_API = 'https://records.nhl.com/site/api';
// ESPN's own id for a club's news feed; a club without one reads the league's news for its name
const ESPN_TEAM: Record<string, number> = { EDM: 6 };
const statsGet = async (path: string) => {
  const r = await fetch(`${STATS_API}/${path}`, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`stats ${path.split('?')[0]}: ${r.status}`);
  return ((await r.json()).data ?? []) as any[];
};
const exp = (s: string) => encodeURIComponent(s);
const statsReport = (name: string, season: number, kind = 'team', extra = '') =>
  statsGet(`${kind}/${name}?limit=-1&cayenneExp=${exp(`seasonId=${season} and gameTypeId=2${extra}`)}`);
const recordsGet = async (path: string) => {
  const r = await fetch(`${RECORDS_API}/${path}`, { headers: { 'user-agent': 'sak-league' } });
  if (!r.ok) throw new Error(`records ${path.split('?')[0]}: ${r.status}`);
  return ((await r.json()).data ?? []) as any[];
};
// the stats API's own ids for a club: its team id (the tracking numbers) and its franchise (players, history)
let clubIds: Map<string, { id: number; franchise: number }> | null = null;
async function clubId(abbrev: string) {
  if (!clubIds) clubIds = new Map((await statsGet('team')).filter((t) => t.franchiseId).map((t) => [t.triCode, { id: t.id, franchise: t.franchiseId }]));
  const c = clubIds.get(abbrev);
  if (!c) throw new Error('bad request');
  return c;
}
const num = (v: any) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
async function fanBuild(abbrev: string) {
  const ids = await clubId(abbrev);
  const [cs, roster, prospects, sched, stand] = await Promise.all([
    get(`/club-stats/${abbrev}/now`), get(`/roster/${abbrev}/current`), get(`/prospects/${abbrev}`).catch(() => null),
    get(`/club-schedule-season/${abbrev}/now`).catch(() => null), get('/standings/now'),
  ]);
  const cur = Number(cs.season), prev = cur - 10001;
  const nameToAbbrev = new Map<string, string>((stand.standings ?? []).map((t: any) => [txt(t.teamName), t.teamAbbrev.default]));
  const opt = (p: Promise<any[]>) => p.catch(() => [] as any[]);
  const fr = ` and franchiseId=${ids.franchise}`;
  const [
    [sumC, pctC, rtC, ltC, perC, firstC, shotC, penC, gfsC, gasC, ppC, pkC, ggC, foC],
    [sumP, pctP, rtP],
    [skToi, skPct, skRate, skRt, gAdv, gStr],
    [csPrev, edge],
    runs,
  ] = await Promise.all([
    Promise.all([statsReport('summary', cur), statsReport('percentages', cur), ...['realtime', 'leadingtrailing', 'goalsbyperiod', 'scoretrailfirst', 'outshootoutshotby', 'penalties',
      'goalsforbystrength', 'goalsagainstbystrength', 'powerplay', 'penaltykill', 'goalgames', 'faceoffpercentages'].map((n) => opt(statsReport(n, cur)))]),
    Promise.all([opt(statsReport('summary', prev)), opt(statsReport('percentages', prev)), opt(statsReport('realtime', prev))]),
    Promise.all([...['timeonice', 'percentages', 'scoringRates', 'realtime'].map((n) => opt(statsReport(n, cur, 'skater', fr))), opt(statsReport('advanced', cur, 'goalie', fr)), opt(statsReport('savesByStrength', cur, 'goalie', fr))]),
    Promise.all([get(`/club-stats/${abbrev}/${prev}/2`).catch(() => null), get(`/edge/team-detail/${ids.id}/${cur}/2`).catch(() => null)]),
    Promise.all([prev, prev - 10001, prev - 20002].map((s) => get(`/playoff-series/carousel/${s}/`).catch(() => null))),
  ]);
  // every club's team numbers for a season, one row each
  const byId = (rows: any[]) => new Map(rows.map((x) => [x.teamId, x]));
  const league = (sum: any[], pct: any[], rt: any[], more: any[][] = []) => {
    const p = byId(pct), r = byId(rt), [lt, per, first, shot, pen, gfs, gas, pp, pk, gg, fo] = more.map(byId);
    return sum.map((t) => {
      const P = p.get(t.teamId) ?? {}, R = r.get(t.teamId) ?? {}, L = lt?.get(t.teamId) ?? {}, Pe = per?.get(t.teamId) ?? {}, F = first?.get(t.teamId) ?? {}, S = shot?.get(t.teamId) ?? {};
      const N = pen?.get(t.teamId) ?? {}, Gf = gfs?.get(t.teamId) ?? {}, Ga = gas?.get(t.teamId) ?? {}, Pp = pp?.get(t.teamId) ?? {}, Pk = pk?.get(t.teamId) ?? {}, G = gg?.get(t.teamId) ?? {}, Fo = fo?.get(t.teamId) ?? {};
      return {
        abbrev: nameToAbbrev.get(t.teamFullName) ?? null, name: t.teamFullName, gp: t.gamesPlayed, w: t.wins, l: t.losses, otl: t.otLosses, pts: t.points, ptsPct: t.pointPct,
        gf: t.goalsForPerGame, ga: t.goalsAgainstPerGame, pp: t.powerPlayPct, pk: t.penaltyKillPct, sf: t.shotsForPerGame, sa: t.shotsAgainstPerGame, fo: t.faceoffWinPct,
        rw: num(t.winsInRegulation), shw: num(t.winsInShootout),
        sat: num(P.satPct), satAhead: num(P.satPctAhead), satBehind: num(P.satPctBehind), satClose: num(P.satPctClose), satTied: num(P.satPctTied), usat: num(P.usatPct), zoneStart: num(P.zoneStartPct5v5),
        sv5: num(P.savePct5v5), sh5: num(P.shootingPct5v5), pdo: num(P.shootingPlusSavePct5v5), gfPct: num(P.goalsForPct),
        give60: num(R.giveawaysPer60), take60: num(R.takeawaysPer60), hits60: num(R.hitsPer60), blocks60: num(R.blockedShotsPer60),
        // situations: by period, with the lead or chasing it, scoring first, the shot count, the margin
        p1gf: num(Pe.period1GoalsFor), p1ga: num(Pe.period1GoalsAgainst), p2gf: num(Pe.period2GoalsFor), p2ga: num(Pe.period2GoalsAgainst), p3gf: num(Pe.period3GoalsFor), p3ga: num(Pe.period3GoalsAgainst), otgf: num(Pe.periodOtGoalsFor), otga: num(Pe.periodOtGoalsAgainst),
        lead1: L.gamesPlayed != null ? [L.winsLeadPeriod1, L.lossLeadPeriod1, L.otLossLeadPeriod1] : null, lead2: L.gamesPlayed != null ? [L.winsLeadPeriod2, L.lossLeadPeriod2, L.otLossLeadPeriod2] : null,
        trail1: L.gamesPlayed != null ? [L.winsTrailPeriod1, L.lossTrailPeriod1, L.otLossTrailPeriod1] : null, trail2: L.gamesPlayed != null ? [L.winsTrailPeriod2, L.lossTrailPeriod2, L.otLossTrailPeriod2] : null,
        first: F.gamesPlayed != null ? [F.winsScoringFirst, F.lossesScoringFirst, F.otLossesScoringFirst] : null, chase: F.gamesPlayed != null ? [F.winsTrailingFirst, F.lossesTrailingFirst, F.otLossesTrailingFirst] : null,
        outshoot: S.gamesPlayed != null ? [S.winsOutshootOpponent, S.lossesOutshootOpponent, S.otLossesOutshootOpponent] : null, outshot: S.gamesPlayed != null ? [S.winsOutshotByOpponent, S.lossesOutshotByOpponent, S.otLossesOutshotByOpponent] : null,
        one: G.gamesPlayed != null ? [G.winsOneGoalGames, G.lossesOneGoalGames, G.otLossesOneGoalGames] : null, blowout: G.gamesPlayed != null ? [G.winsThreeGoalGames, G.lossesThreeGoalGames] : null,
        // special teams and discipline
        drawn60: num(N.penaltiesDrawnPer60), taken60: num(N.penaltiesTakenPer60), pim: num(N.penaltySecondsPerGame), majors: num(N.majors),
        ppOpp: num(Pp.ppOpportunitiesPerGame), ppNet: num(Pp.powerPlayNetPct), shga: num(Pp.shGoalsAgainst), shorthanded: num(Pk.timesShorthandedPerGame), pkNet: num(Pk.penaltyKillNetPct), shgf: num(Pk.shGoalsFor),
        g5v5f: num(Gf.goalsFor5On5), g5v5a: num(Ga.goalsAgainst5On5), enf: num(Gf.goalsForEmptyNet), ena: num(Ga.goalsAgainstEmptyNet), xa: num(Ga.goalsAgainstExtraAttacker), g3v3f: num(Gf.goalsFor3On3), g3v3a: num(Ga.goalsAgainst3On3),
        foD: num(Fo.defensiveZoneFaceoffPct), foO: num(Fo.offensiveZoneFaceoffPct), foPp: num(Fo.ppFaceoffPct), foSh: num(Fo.shFaceoffPct),
      };
    }).filter((t) => t.abbrev);
  };
  const career = async (rows: any[], kind: 'skater' | 'goalie') => {
    const list = rows.map((p) => p.playerId ?? p.id).filter(Boolean);
    if (!list.length) return [] as any[];
    return opt(statsGet(`${kind}/summary?isAggregate=true&isGame=false&limit=-1&cayenneExp=${exp(`playerId in (${list.join(',')}) and gameTypeId=2`)}`));
  };
  const [careerSk, careerG] = await Promise.all([career(cs.skaters ?? [], 'skater'), career(cs.goalies ?? [], 'goalie')]);
  const sk = (p: any) => ({ id: p.playerId, name: `${txt(p.firstName)} ${txt(p.lastName)}`, pos: p.positionCode, gp: p.gamesPlayed, g: p.goals, a: p.assists, pts: p.points, pm: p.plusMinus, pim: p.penaltyMinutes, ppg: p.powerPlayGoals, sog: p.shots, pct: p.shootingPctg, toi: p.avgTimeOnIcePerGame, fo: p.faceoffWinPctg, headshot: p.headshot ?? null });
  const go = (p: any) => ({ id: p.playerId, name: `${txt(p.firstName)} ${txt(p.lastName)}`, gp: p.gamesPlayed, gs: p.gamesStarted, w: p.wins, l: p.losses, otl: p.overtimeLosses, gaa: p.goalsAgainstAverage, svp: p.savePercentage, so: p.shutouts, sa: p.shotsAgainst ?? null, headshot: p.headshot ?? null });
  const person = (p: any) => ({ id: p.id, name: `${txt(p.firstName)} ${txt(p.lastName)}`, num: p.sweaterNumber ?? null, pos: p.positionCode, shoots: p.shootsCatches, ht: p.heightInCentimeters, wt: p.weightInKilograms, born: p.birthDate, city: txt(p.birthCity), country: p.birthCountry, headshot: p.headshot ?? null });
  const run = (c: any, season: number) => ({ season, rounds: (c?.rounds ?? []).flatMap((r: any) => (r.series ?? []).filter((x: any) => x.topSeed?.abbrev === abbrev || x.bottomSeed?.abbrev === abbrev).map((x: any) => {
    const us = x.topSeed.abbrev === abbrev ? x.topSeed : x.bottomSeed, them = x.topSeed.abbrev === abbrev ? x.bottomSeed : x.topSeed;
    return { round: r.roundNumber, opp: them.abbrev, w: Number(us.wins ?? 0), l: Number(them.wins ?? 0) };
  })) });
  // last spring's champion: the winner of the last round of the last season's carousel
  const final = (runs[0]?.rounds ?? []).find((r: any) => r.roundNumber === 4)?.series?.[0];
  const champion = final ? (Number(final.topSeed?.wins) >= 4 ? final.topSeed?.abbrev : Number(final.bottomSeed?.wins) >= 4 ? final.bottomSeed?.abbrev : null) : null;
  const games = (sched?.games ?? []).filter((g: any) => g.gameType === 2 || g.gameType === 3).map((g: any) => ({
    id: g.id, date: g.gameDate, start: g.startTimeUTC, state: g.gameState, type: g.gameType, home: g.homeTeam?.abbrev, away: g.awayTeam?.abbrev,
    hs: g.homeTeam?.score ?? null, as: g.awayTeam?.score ?? null, outcome: g.gameOutcome?.lastPeriodType ?? null,
  }));
  const played = games.filter((g: any) => ['OFF', 'FINAL'].includes(g.state));
  const me = (stand.standings ?? []).find((t: any) => t.teamAbbrev.default === abbrev);
  // the club's own news: ESPN's feed for it where there is one, and the league's headlines that name it
  const name = me ? txt(me.teamCommonName) : abbrev, place = me ? txt(me.placeName) : '';
  const [espn, lg] = await Promise.all([
    ESPN_TEAM[abbrev] ? fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/news?team=${ESPN_TEAM[abbrev]}&limit=40`).then((r) => r.json()).catch(() => null) : null,
    news().catch(() => ({ items: [] })),
  ]);
  const about = new RegExp(`\\b(${[`${place} ${name}`, name, ...((cs.skaters ?? []).filter((p: any) => p.gamesPlayed > 0).map((p: any) => `${txt(p.firstName)} ${txt(p.lastName)}`))].filter((x) => x && x.length > 3).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  const espnItems = ((espn?.articles ?? []) as any[]).filter((a) => about.test(`${a.headline} ${a.description ?? ''}`)).map((a) => ({
    id: `espn:${a.id ?? a.headline}`, source: 'ESPN', headline: a.headline, summary: a.description ?? '', date: a.published, url: a.links?.web?.href ?? '', image: a.images?.[0]?.url ?? null, video: a.type === 'Media',
  }));
  const lgItems = (((lg as any).items ?? []) as any[]).filter((s) => about.test(`${s.headline} ${s.summary}`)).map((s) => ({ ...s, video: false }));
  const seen = new Set<string>();
  const items = [...espnItems, ...lgItems].filter((s) => s.url && !seen.has(s.headline) && seen.add(s.headline)).sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 24);
  // each skater's usage, 5-on-5 rates and career line, by id
  const toiOf = byId(skToi.map((x) => ({ ...x, teamId: x.playerId }))), pctOf = byId(skPct.map((x) => ({ ...x, teamId: x.playerId }))), rateOf = byId(skRate.map((x) => ({ ...x, teamId: x.playerId }))), rtOf = byId(skRt.map((x) => ({ ...x, teamId: x.playerId })));
  const carOf = byId(careerSk.map((x) => ({ ...x, teamId: x.playerId }))), gCarOf = byId(careerG.map((x) => ({ ...x, teamId: x.playerId })));
  const advOf = byId(gAdv.map((x) => ({ ...x, teamId: x.playerId }))), strOf = byId(gStr.map((x) => ({ ...x, teamId: x.playerId })));
  const usage = (cs.skaters ?? []).map((p: any) => {
    const T = toiOf.get(p.playerId) ?? {}, P = pctOf.get(p.playerId) ?? {}, R = rateOf.get(p.playerId) ?? {}, Rt = rtOf.get(p.playerId) ?? {}, C = carOf.get(p.playerId);
    return {
      id: p.playerId, ev: num(T.evTimeOnIcePerGame), pp: num(T.ppTimeOnIcePerGame), sh: num(T.shTimeOnIcePerGame), shifts: num(T.shiftsPerGame),
      sat: num(P.satPercentage), satRel: num(P.satRelative), zs: num(P.zoneStartPct5v5), pdo: num(P.skaterShootingPlusSavePct5v5), onSh: num(R.onIceShootingPct5v5), toi5: num(P.timeOnIcePerGame5v5),
      p60: num(R.pointsPer605v5), g60: num(R.goalsPer605v5), a1_60: num(R.primaryAssistsPer605v5), pts5: num(R.points5v5),
      hits: num(Rt.hits), blocks: num(Rt.blockedShots), take: num(Rt.takeaways), give: num(Rt.giveaways), firstGoals: num(Rt.firstGoals), otGoals: num(Rt.otGoals),
      career: C ? { gp: C.gamesPlayed, g: C.goals, a: C.assists, pts: C.points, sog: C.shots, pct: num(C.shootingPct), gwg: C.gameWinningGoals } : null,
    };
  });
  const crease = (cs.goalies ?? []).map((p: any) => {
    const A = advOf.get(p.playerId) ?? {}, S = strOf.get(p.playerId) ?? {}, C = gCarOf.get(p.playerId);
    return {
      id: p.playerId, qs: num(A.qualityStart), qsPct: num(A.qualityStartsPct), rw: num(A.regulationWins), gfa: num(A.goalsForAverage), sa60: num(A.shotsAgainstPer60),
      evSvp: num(S.evSavePct), ppSvp: num(S.ppSavePct), evSa: num(S.evShotsAgainst), sa: num(S.shotsAgainst), ga: num(S.goalsAgainst),
      career: C ? { gp: C.gamesPlayed, w: C.wins, so: C.shutouts, svp: num(C.savePct), gaa: num(C.goalsAgainstAverage) } : null,
    };
  });
  // the NHL's tracking: skating, shot speed, where the shots come from, zone time (ranks among the 32)
  const val = (x: any) => (x == null ? null : { value: num(x.value ?? x.imperial), rank: num(x.rank), avg: num(x.leagueAvg?.value ?? x.leagueAvg?.imperial) });
  const tracking = edge ? {
    speedMax: val(edge.skatingSpeed?.speedMax), bursts22: val(edge.skatingSpeed?.burstsOver22), bursts20: val(edge.skatingSpeed?.burstsOver20),
    fastest: edge.skatingSpeed?.speedMax?.overlay?.player ? `${txt(edge.skatingSpeed.speedMax.overlay.player.firstName)} ${txt(edge.skatingSpeed.speedMax.overlay.player.lastName)}` : null,
    shotMax: val(edge.shotSpeed?.topShotSpeed), shots90: val(edge.shotSpeed?.shotAttemptsOver90),
    hardest: edge.shotSpeed?.topShotSpeed?.overlay?.player ? `${txt(edge.shotSpeed.topShotSpeed.overlay.player.firstName)} ${txt(edge.shotSpeed.topShotSpeed.overlay.player.lastName)}` : null,
    distance: val(edge.distanceSkated?.total),
    zones: edge.zoneTimeDetails ? { oz: num(edge.zoneTimeDetails.offensiveZonePctg), ozRank: num(edge.zoneTimeDetails.offensiveZoneRank), ozAvg: num(edge.zoneTimeDetails.offensiveZoneLeagueAvg),
      nz: num(edge.zoneTimeDetails.neutralZonePctg), dz: num(edge.zoneTimeDetails.defensiveZonePctg), dzRank: num(edge.zoneTimeDetails.defensiveZoneRank), dzAvg: num(edge.zoneTimeDetails.defensiveZoneLeagueAvg),
      ozEv: num(edge.zoneTimeDetails.offensiveZoneEvPctg), ozEvRank: num(edge.zoneTimeDetails.offensiveZoneEvRank) } : null,
    ranges: (edge.sogSummary ?? []).map((s: any) => ({ where: s.locationCode, shots: num(s.shots), shotsRank: num(s.shotsRank), shotsAvg: num(s.shotsLeagueAvg), pct: num(s.shootingPctg), pctRank: num(s.shootingPctgRank), pctAvg: num(s.shootingPctgLeagueAvg), goals: num(s.goals), goalsRank: num(s.goalsRank) })),
    areas: (edge.sogDetails ?? []).map((s: any) => ({ area: s.area, shots: num(s.shots), rank: num(s.shotsRank) })),
  } : null;
  return {
    abbrev, name: me ? `${place} ${name}`.trim() : abbrev, season: cur, prevSeason: prev, champion,
    standing: me ? { gp: me.gamesPlayed, w: me.wins, l: me.losses, otl: me.otLosses, pts: me.points, ptsPct: me.pointPctg, gd: me.goalDifferential,
      div: txt(me.divisionName), divRank: me.divisionSequence, confRank: me.conferenceSequence, leagueRank: me.leagueSequence, wildRank: me.wildcardSequence,
      streak: me.streakCode ? `${me.streakCode}${me.streakCount}` : null, l10: `${me.l10Wins}-${me.l10Losses}-${me.l10OtLosses}`, home: `${me.homeWins}-${me.homeLosses}-${me.homeOtLosses}`, road: `${me.roadWins}-${me.roadLosses}-${me.roadOtLosses}` } : null,
    // the whole table, for the playoff odds and the division
    table: (stand.standings ?? []).map((t: any) => ({ abbrev: t.teamAbbrev.default, name: txt(t.teamName), conf: t.conferenceAbbrev, div: t.divisionAbbrev, divName: txt(t.divisionName), gp: t.gamesPlayed, w: t.wins, l: t.losses, otl: t.otLosses, pts: t.points, ptsPct: t.pointPctg, gd: t.goalDifferential, rw: t.regulationWins ?? null, l10: `${t.l10Wins}-${t.l10Losses}-${t.l10OtLosses}`, streak: t.streakCode ? `${t.streakCode}${t.streakCount}` : null })),
    league: league(sumC, pctC, rtC, [ltC, perC, firstC, shotC, penC, gfsC, gasC, ppC, pkC, ggC, foC]), leaguePrev: league(sumP, pctP, rtP),
    skaters: (cs.skaters ?? []).map(sk), goalies: (cs.goalies ?? []).map(go),
    skatersPrev: (csPrev?.skaters ?? []).map(sk), goaliesPrev: (csPrev?.goalies ?? []).map(go),
    usage, crease, tracking,
    roster: [...(roster.forwards ?? []), ...(roster.defensemen ?? []), ...(roster.goalies ?? [])].map(person),
    prospects: prospects ? [...(prospects.forwards ?? []), ...(prospects.defensemen ?? []), ...(prospects.goalies ?? [])].map(person) : [],
    schedule: games.filter((g: any) => g.type === 2),
    recent: played.slice(-10).reverse(), upcoming: games.filter((g: any) => !['OFF', 'FINAL'].includes(g.state)).slice(0, 6),
    playoffs: runs.map((c, i) => run(c, prev - i * 10001)),
    news: items, at: new Date().toISOString(),
  };
}
async function cached(key: string, ttl: number, build: () => Promise<object>) {
  const { data: hit } = await db.from('hub_cache').select('body,at').eq('key', key).maybeSingle();
  if (hit && Date.now() - new Date(hit.at).getTime() < ttl) return { ...(hit.body as object), ttl };
  try {
    const body = await build();
    await db.from('hub_cache').upsert({ key, body, at: new Date().toISOString() });
    return { ...body, ttl };
  } catch (e) {
    // the NHL's feeds down: the last copy beats an error
    if (hit) return { ...(hit.body as object), stale: true, ttl: 120_000 };
    throw e;
  }
}
async function fanZone(abbrev: string) {
  if (!/^[A-Z]{3}$/.test(abbrev)) throw new Error('bad request');
  return cached(`fan:${abbrev}`, 900_000, () => fanBuild(abbrev));
}

// ── the league's own fan zone (25 October 2026, the fan zones opened to every club and everyone): the names the fans'
// award calls offer (the season's top scorers for the Hart, its defencemen on their own for the Norris, its goalies for
// the Vezina, each with the numbers that make the case) and every club's line in the table for the index. An hour in
// hub_cache.
async function fanLeagueBuild() {
  const st = await get('/standings/now');
  const rows = (st.standings ?? []) as any[];
  const now = new Date();
  const cur = Number(rows[0]?.seasonId) || (now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1) * 10001 + 1;
  const top = (kind: string, sort: string, n: number, extra = '') => statsGet(`${kind}/summary?isAggregate=false&isGame=false&limit=${n}&sort=${exp(JSON.stringify([{ property: sort, direction: 'DESC' }]))}&cayenneExp=${exp(`seasonId=${cur} and gameTypeId=2${extra}`)}`).catch(() => [] as any[]);
  const [sk, d, g] = await Promise.all([top('skater', 'points', 20), top('skater', 'points', 15, ' and positionCode="D"'), top('goalie', 'wins', 20)]);
  // the last club a player was traded to is listed last
  const club = (t: any) => String(t ?? '').split(',').pop() || null;
  const skater = (x: any) => ({ id: x.playerId, name: x.skaterFullName, team: club(x.teamAbbrevs), pos: x.positionCode, gp: x.gamesPlayed, g: x.goals, a: x.assists, pts: x.points, pm: x.plusMinus });
  return {
    season: cur, skaters: sk.map(skater), defence: d.map(skater),
    goalies: g.map((x: any) => ({ id: x.playerId, name: x.goalieFullName, team: club(x.teamAbbrevs), gp: x.gamesPlayed, w: x.wins, svp: num(x.savePct), gaa: num(x.goalsAgainstAverage), so: x.shutouts })),
    table: rows.map((r: any) => ({ abbrev: r.teamAbbrev?.default ?? r.teamAbbrev, name: txt(r.teamName), gp: r.gamesPlayed, w: r.wins, l: r.losses, otl: r.otLosses, pts: r.points,
      div: r.divisionName, divRank: r.divisionSequence, leagueRank: r.leagueSequence, l10: `${r.l10Wins}-${r.l10Losses}-${r.l10OtLosses}`, streak: `${r.streakCode ?? ''}${r.streakCount ?? ''}` })),
    at: new Date().toISOString(),
  };
}
async function fanLeague() {
  return cached('fan-league', 3_600_000, fanLeagueBuild);
}

// ── a franchise's history from the NHL's own record books (24 October 2026, Patrick: "improve the fan zone's analytics,
// history and facts"): every season it has played and how its spring ended, its all-time totals, its leaders (career,
// playoffs, the best single seasons), its record against every club, its captains, coaches and general managers, the
// numbers in its rafters, every trophy its players won or were up for, and every pick it made in the first round with
// how each career turned out. Kept in hub_cache for six hours: history changes once a night at most.
const unhtml = (html: string) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&ndash;|&mdash;/g, '–').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const items = (html: string) => [...String(html ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => unhtml(m[1])).filter((s) => s && !s.startsWith('*'));
async function historyBuild(abbrev: string) {
  const ids = await clubId(abbrev);
  const F = ids.franchise;
  const top = (kind: string, sort: string, game: 2 | 3, n: number, aggregate = true, extra = '') => statsGet(`${kind}/summary?isAggregate=${aggregate}&isGame=false&limit=${n}&sort=${exp(JSON.stringify([{ property: sort, direction: 'DESC' }]))}&cayenneExp=${exp(`franchiseId=${F} and gameTypeId=${game}${extra}`)}`).catch(() => [] as any[]);
  const [seasons, totals, detail, vs, vsPlayoffs, draft, awards, trophies, teams,
    pts, goals, assists, games, poPts, poGoals, gWins, gSo, gPoWins, bestPts, bestGoals, bestA, bestW, bestSvp] = await Promise.all([
    recordsGet(`franchise-season-results?cayenneExp=${exp(`franchiseId=${F}`)}`),
    recordsGet(`franchise-team-totals?cayenneExp=${exp(`franchiseId=${F}`)}`).catch(() => []),
    recordsGet(`franchise-detail?cayenneExp=${exp(`mostRecentTeamId=${ids.id}`)}`).catch(() => []),
    recordsGet(`all-time-record-vs-franchise?cayenneExp=${exp(`teamFranchiseId=${F} and gameTypeId=2`)}`).catch(() => []),
    recordsGet(`all-time-record-vs-franchise?cayenneExp=${exp(`teamFranchiseId=${F} and gameTypeId=3`)}`).catch(() => []),
    recordsGet(`draft?cayenneExp=${exp(`draftedByTeamId=${ids.id}`)}&limit=-1`).catch(() => []),
    recordsGet(`award-details?cayenneExp=${exp(`teamId=${ids.id} and trophyId!=1`)}&limit=-1`).catch(() => []),
    recordsGet('trophy').catch(() => []),
    statsGet('team').catch(() => []),
    top('skater', 'points', 2, 15), top('skater', 'goals', 2, 10), top('skater', 'assists', 2, 10), top('skater', 'gamesPlayed', 2, 10),
    top('skater', 'points', 3, 10), top('skater', 'goals', 3, 10),
    top('goalie', 'wins', 2, 10), top('goalie', 'shutouts', 2, 8), top('goalie', 'wins', 3, 6),
    top('skater', 'points', 2, 15, false), top('skater', 'goals', 2, 10, false), top('skater', 'assists', 2, 10, false),
    top('goalie', 'wins', 2, 8, false), top('goalie', 'savePct', 2, 8, false, ' and gamesPlayed>=30'),
  ]);
  // the opponent as it was when they met (the Minnesota North Stars, the first Winnipeg Jets), not its franchise's name today
  const tri = new Map<number, string>(teams.map((t: any) => [t.id, t.triCode])), teamName = new Map<number, string>(teams.map((t: any) => [t.id, t.fullName]));
  // a season's line and how its spring ended
  const bySeason = new Map<number, any>();
  for (const r of seasons) {
    const s = bySeason.get(r.seasonId) ?? { season: r.seasonId };
    if (r.gameTypeId === 2) Object.assign(s, { gp: r.gamesPlayed, w: r.wins, l: r.losses, t: r.ties ?? 0, otl: r.overtimeLosses ?? 0, pts: r.points, gf: r.goals, ga: r.goalsAgainst,
      div: r.divisionName, divRank: r.divisionSequence, confRank: r.conferenceSequence, leagueRank: r.leagueSequence, team: r.triCode ?? abbrev });
    if (r.gameTypeId === 3) Object.assign(s, { po: { round: r.playoffRound, of: r.finalPlayoffRound, title: r.seriesTitle, won: r.decision === 'W' } });
    bySeason.set(r.seasonId, s);
  }
  const total = (g: number) => { const t = totals.find((x: any) => x.gameTypeId === g && x.activeTeam !== false) ?? totals.find((x: any) => x.gameTypeId === g); return t ? {
    gp: t.gamesPlayed, w: t.wins, l: t.losses, t: t.ties ?? 0, otl: t.overtimeLosses ?? 0, pts: t.points, gf: t.goalsFor, ga: t.goalsAgainst, ptsPct: num(t.pointPctg),
    cups: t.cups ?? null, playoffSeasons: t.playoffSeasons ?? null, seriesW: t.seriesWins ?? null, seriesL: t.seriesLosses ?? null, so: t.shutouts ?? null, first: t.firstSeasonId } : null; };
  const d = detail[0] ?? {};
  const h2h = (rows: any[]) => rows.filter((r) => r.activeOpponentFranchise).map((r) => ({ opp: tri.get(r.opponentTeamId) ?? null, name: teamName.get(r.opponentTeamId) ?? r.opponentFranchiseName, franchise: r.opponentFranchiseId, gp: r.totalGamesPlayed, w: r.totalWins, l: r.totalLosses, t: r.totalTies ?? 0, otl: r.totalOtLosses ?? 0, gf: r.totalGoalsFor, ga: r.totalGoalsAgainst, last: r.totalLastMeetingSeasonId }));
  const skater = (p: any) => ({ id: p.playerId, name: p.skaterFullName, pos: p.positionCode, gp: p.gamesPlayed, g: p.goals, a: p.assists, pts: p.points, season: p.seasonId ?? null });
  const goalie = (p: any) => ({ id: p.playerId, name: p.goalieFullName, gp: p.gamesPlayed, w: p.wins, so: p.shutouts, svp: num(p.savePct), gaa: num(p.goalsAgainstAverage), season: p.seasonId ?? null });
  // every first-round pick, and each one's career wherever he played it
  const firsts = draft.filter((p: any) => p.roundNumber === 1 && p.draftedByTeamId === ids.id);
  const allIds = draft.map((p: any) => p.playerId).filter(Boolean);
  const careers = new Map<number, any>();
  for (let i = 0; i < allIds.length; i += 120) {
    const chunk = allIds.slice(i, i + 120);
    const [s, g] = await Promise.all([
      statsGet(`skater/summary?isAggregate=true&isGame=false&limit=-1&cayenneExp=${exp(`playerId in (${chunk.join(',')}) and gameTypeId=2`)}`).catch(() => []),
      statsGet(`goalie/summary?isAggregate=true&isGame=false&limit=-1&cayenneExp=${exp(`playerId in (${chunk.join(',')}) and gameTypeId=2`)}`).catch(() => []),
    ]);
    for (const x of s) careers.set(x.playerId, { gp: x.gamesPlayed, pts: x.points, g: x.goals });
    for (const x of g) careers.set(x.playerId, { gp: x.gamesPlayed, w: x.wins, goalie: true });
  }
  const pick = (p: any) => ({ id: p.playerId ?? null, name: p.playerName, year: p.draftYear, round: p.roundNumber, overall: p.overallPickNumber, pos: p.position, from: p.amateurClubName, league: p.amateurLeague, career: (p.playerId && careers.get(p.playerId)) ?? null });
  // the best picks after the first round: the longest careers by points (skaters) or wins (goalies)
  const steals = draft.filter((p: any) => p.roundNumber > 1 && p.playerId && careers.get(p.playerId)).map(pick)
    .sort((a: any, b: any) => (b.career.pts ?? b.career.w * 2) - (a.career.pts ?? a.career.w * 2)).slice(0, 12);
  const trophyName = new Map<number, string>(trophies.map((t: any) => [t.id, t.name]));
  return {
    abbrev, franchise: F, first: d.firstSeasonId ?? null,
    seasons: [...bySeason.values()].filter((s) => s.gp != null).sort((a, b) => a.season - b.season),
    totals: { regular: total(2), playoffs: total(3) },
    captains: items(d.captainHistory), coaches: items(d.coachingHistory), gms: items(d.generalManagerHistory), retired: items(d.retiredNumbersSummary),
    vs: h2h(vs), vsPlayoffs: h2h(vsPlayoffs),
    leaders: { points: pts.map(skater), goals: goals.map(skater), assists: assists.map(skater), games: games.map(skater), poPoints: poPts.map(skater), poGoals: poGoals.map(skater), wins: gWins.map(goalie), shutouts: gSo.map(goalie), poWins: gPoWins.map(goalie) },
    best: { points: bestPts.map(skater), goals: bestGoals.map(skater), assists: bestA.map(skater), wins: bestW.map(goalie), svp: bestSvp.map(goalie) },
    firsts: firsts.map(pick).sort((a: any, b: any) => b.year - a.year), steals,
    awards: awards.filter((a: any) => a.trophyId !== 1).map((a: any) => ({ season: a.seasonId, trophy: trophyName.get(a.trophyId) ?? `Trophy ${a.trophyId}`, trophyId: a.trophyId, name: a.fullName, id: a.playerId ?? null, status: a.status }))
      .sort((a: any, b: any) => b.season - a.season),
    at: new Date().toISOString(),
  };
}
async function fanHistory(abbrev: string) {
  if (!/^[A-Z]{3}$/.test(abbrev)) throw new Error('bad request');
  return cached(`fan-history:${abbrev}`, 6 * 3_600_000, () => historyBuild(abbrev));
}

// ── a club's front office (25 October 2026, Patrick: "improve the goalie analysis significantly, and the moves and
// decisions the GM and coaching should make, and what fundamental changes should be considered"). Three hours in
// hub_cache: the club's goalies in depth (the NHL's tracking of every shot they faced by danger and area, their 5-on-5
// numbers, every start, five seasons against the league's save percentage), every goalie in the league for ranks and the
// market, the club's own skaters on the power play and the kill, the league's skaters worth a call for each kind of need
// (this season and last blended, each with his club so the site can tell a seller), and the lines from the last game.
// The reading is the site's (src/lib/fanOffice.ts).
const gp0 = (n: any) => Number(n ?? 0);
async function officeBuild(abbrev: string) {
  const ids = await clubId(abbrev);
  const [cs, sched] = await Promise.all([get(`/club-stats/${abbrev}/now`), get(`/club-schedule-season/${abbrev}/now`).catch(() => null)]);
  const cur = Number(cs.season), prev = cur - 10001, since = cur - 40004;
  const goalieIds: number[] = (cs.goalies ?? []).filter((g: any) => g.gamesPlayed > 0).map((g: any) => g.playerId);
  const opt = (p: Promise<any>) => p.catch(() => null);
  const optA = (p: Promise<any[]>) => p.catch(() => [] as any[]);
  const lastGame = ((sched?.games ?? []) as any[]).filter((g) => g.gameType === 2 && ['OFF', 'FINAL'].includes(g.gameState)).pop();
  const [perGoalie, [gSumC, gAdvC, gStrC, gBio, gAdvP, gSeasons], [skSum, skRate, skToi, skPk, skPp, skFo, skBio, skSumP, skRateP, skPkP, skPpP], lines] = await Promise.all([
    Promise.all(goalieIds.map(async (id) => {
      const [detail, five, loc, log] = await Promise.all([
        opt(get(`/edge/goalie-detail/${id}/${cur}/2`)), opt(get(`/edge/goalie-5v5-detail/${id}/${cur}/2`)), opt(get(`/edge/goalie-shot-location-detail/${id}/${cur}/2`)), opt(get(`/player/${id}/game-log/${cur}/2`)),
      ]);
      return { id, detail, five, loc, log };
    })),
    Promise.all([
      optA(statsReport('summary', cur, 'goalie')), optA(statsReport('advanced', cur, 'goalie')), optA(statsReport('savesByStrength', cur, 'goalie')), optA(statsReport('bios', cur, 'goalie')),
      optA(statsReport('advanced', prev, 'goalie')),
      optA(statsGet(`goalie/summary?isAggregate=false&isGame=false&limit=-1&cayenneExp=${exp(`seasonId>=${since} and gameTypeId=2`)}`)),
    ]),
    Promise.all([
      ...['summary', 'scoringRates', 'timeonice', 'penaltykill', 'powerplay', 'faceoffwins', 'bios'].map((n) => optA(statsReport(n, cur, 'skater'))),
      optA(statsReport('summary', prev, 'skater')), optA(statsReport('scoringRates', prev, 'skater')), optA(statsReport('penaltykill', prev, 'skater')), optA(statsReport('powerplay', prev, 'skater')),
    ]),
    lastGame ? clubLines(lastGame.id, abbrev).then((l) => ({ game: { id: lastGame.id, date: lastGame.gameDate, opp: lastGame.homeTeam?.abbrev === abbrev ? lastGame.awayTeam?.abbrev : lastGame.homeTeam?.abbrev }, ...l })).catch(() => null) : null,
  ]);
  const by = (rows: any[]) => new Map<number, any>(rows.map((x) => [x.playerId, x]));
  // the last team a player was traded to is listed last
  const team = (t: string | null | undefined) => String(t ?? '').split(',').pop() || null;

  // ── the club's goalies
  const loc = (rows: any[] | undefined) => (rows ?? []).map((s: any) => ({
    where: s.locationCode, sa: num(s.shotsAgainst), ga: num(s.goalsAgainst), svp: num(s.savePctg), pct: num(s.savePctgPercentile), saPct: num(s.shotsAgainstPercentile),
    lgSvp: num(s.savePctgLeagueAvg), lgSa: num(s.shotsAgainstLeagueAvg), lgGa: num(s.goalsAgainstLeagueAvg),
  }));
  const goalies = perGoalie.map(({ id, detail, five, loc: L, log }) => ({
    id,
    edge: detail?.stats ? Object.fromEntries(Object.entries(detail.stats).map(([k, v]: [string, any]) => [k, { value: num(v?.value), pct: num(v?.percentile), avg: num(v?.leagueAvg) }])) : null,
    five: five?.savePctg5v5Details ? Object.fromEntries(Object.entries(five.savePctg5v5Details).map(([k, v]: [string, any]) => [k, { value: num(v?.value), pct: num(v?.percentile), avg: num(v?.leagueAvg) }])) : null,
    ranges: loc(L?.shotLocationTotals ?? detail?.shotLocationSummary),
    areas: (L?.shotLocationDetails ?? []).map((s: any) => ({ area: s.area, sa: num(s.shotsAgainst), ga: num(s.goalsAgainst), svp: num(s.savePctg), pct: num(s.savePctgPercentile) })),
    games: ((log?.gameLog ?? []) as any[]).map((g) => ({ id: g.gameId, date: g.gameDate, opp: g.opponentAbbrev, home: g.homeRoadFlag === 'H', start: gp0(g.gamesStarted) > 0, dec: g.decision ?? null, sa: gp0(g.shotsAgainst), ga: gp0(g.goalsAgainst), svp: num(g.savePctg), toi: g.toi })).reverse(),
  }));

  // ── every goalie in the league: this season, last season's quality starts, five seasons of save percentage
  const advC = by(gAdvC), strC = by(gStrC), bio = by(gBio), advP = by(gAdvP);
  const leagueGoalies = gSumC.map((g) => ({
    id: g.playerId, name: g.goalieFullName, team: team(g.teamAbbrevs), gp: g.gamesPlayed, gs: g.gamesStarted, w: g.wins, sa: g.shotsAgainst, ga: g.goalsAgainst, svp: num(g.savePct), toi: g.timeOnIce,
    qs: num(advC.get(g.playerId)?.qualityStart), qsPct: num(advC.get(g.playerId)?.qualityStartsPct), evSvp: num(strC.get(g.playerId)?.evSavePct), ppSvp: num(strC.get(g.playerId)?.ppSavePct),
    born: bio.get(g.playerId)?.birthDate ?? null, catches: bio.get(g.playerId)?.shootsCatches ?? null,
  }));
  const seasons = gSeasons.map((g) => ({ id: g.playerId, name: g.goalieFullName, season: g.seasonId, team: team(g.teamAbbrevs), gp: g.gamesPlayed, gs: g.gamesStarted, sa: g.shotsAgainst, ga: g.goalsAgainst, svp: num(g.savePct), qsPct: g.seasonId === prev ? num(advP.get(g.playerId)?.qualityStartsPct) : null }));
  const lgSvp: Record<string, number> = {};
  for (const s of [...new Set(seasons.map((x) => x.season))]) {
    const rows = seasons.filter((x) => x.season === s), sa = rows.reduce((t, x) => t + x.sa, 0), ga = rows.reduce((t, x) => t + x.ga, 0);
    if (sa) lgSvp[s] = 1 - ga / sa;
  }

  // ── skaters: the club's own (power play, kill, faceoffs) and the league's worth a call
  const rate = by(skRate), toi = by(skToi), pk = by(skPk), pp = by(skPp), fo = by(skFo), sbio = by(skBio), sumP = by(skSumP), rateP = by(skRateP), pkP = by(skPkP), ppP = by(skPpP);
  // the kill and the power play over both seasons, each player's rate pulled toward the league's by an hour of average
  // play, so a few clean shifts don't make a penalty killer
  const hours = (rows: any[], t: string) => rows.reduce((h, x) => h + gp0(x[t]) / 3600, 0);
  const lgPk = (skPk.reduce((g, x) => g + gp0(x.ppGoalsAgainstPer60) * gp0(x.shTimeOnIce) / 3600, 0) + skPkP.reduce((g, x) => g + gp0(x.ppGoalsAgainstPer60) * gp0(x.shTimeOnIce) / 3600, 0)) / Math.max(1, hours(skPk, 'shTimeOnIce') + hours(skPkP, 'shTimeOnIce'));
  const lgPp = (skPp.reduce((g, x) => g + gp0(x.ppPoints), 0) + skPpP.reduce((g, x) => g + gp0(x.ppPoints), 0)) / Math.max(1, hours(skPp, 'ppTimeOnIce') + hours(skPpP, 'ppTimeOnIce'));
  const steady = (id: number) => {
    const K = pk.get(id), KP = pkP.get(id), P = pp.get(id), PP = ppP.get(id);
    const kh = (gp0(K?.shTimeOnIce) + gp0(KP?.shTimeOnIce)) / 3600, kg = gp0(K?.ppGoalsAgainstPer60) * gp0(K?.shTimeOnIce) / 3600 + gp0(KP?.ppGoalsAgainstPer60) * gp0(KP?.shTimeOnIce) / 3600;
    const ph = (gp0(P?.ppTimeOnIce) + gp0(PP?.ppTimeOnIce)) / 3600, pts = gp0(P?.ppPoints) + gp0(PP?.ppPoints);
    return { pkHours: kh, pkAdj: (kg + lgPk) / (kh + 1), ppHours: ph, ppAdj: (pts + lgPp) / (ph + 1) };
  };
  const skater = (s: any) => {
    const id = s.playerId, R = rate.get(id) ?? {}, T = toi.get(id) ?? {}, K = pk.get(id) ?? {}, P = pp.get(id) ?? {}, F = fo.get(id) ?? {}, B = sbio.get(id) ?? {}, SP = sumP.get(id), RP = rateP.get(id);
    return {
      id, name: s.skaterFullName, team: team(s.teamAbbrevs), pos: s.positionCode, shoots: s.shootsCatches, born: B.birthDate ?? null, gp: s.gamesPlayed, g: s.goals, a: s.assists, pts: s.points, toi: num(s.timeOnIcePerGame),
      p60: num(R.pointsPer605v5), toi5: num(R.timeOnIcePerGame5v5), sat: num(R.satPct), satRel: num(R.satRelative5v5), zs: num(R.offensiveZoneStartPct5v5),
      ppToi: num(T.ppTimeOnIcePerGame), shToi: num(T.shTimeOnIcePerGame), ppP60: num(P.ppPointsPer60), ppPts: num(P.ppPoints), pkGa60: num(K.ppGoalsAgainstPer60), shPts: num(K.shPoints),
      ...steady(id), fo: num(F.faceoffWinPct ?? s.faceoffWinPct), foN: num(F.totalFaceoffs), foD: F.defensiveZoneFaceoffs ? num(F.defensiveZoneFaceoffWins / F.defensiveZoneFaceoffs) : null,
      prev: SP ? { gp: SP.gamesPlayed, pts: SP.points, g: SP.goals, toi: num(SP.timeOnIcePerGame), p60: num(RP?.pointsPer605v5), toi5: num(RP?.timeOnIcePerGame5v5), satRel: num(RP?.satRelative5v5) } : null,
    };
  };
  const all = skSum.map(skater);
  const club = all.filter((s) => s.team === abbrev);
  // a rate blended over this season and last, weighted by ice time, so ten games don't decide a call
  const blend = (now: number | null, then: number | null | undefined, w: number, wp: number) => (now == null ? then ?? null : then == null || !wp ? now : (now * w + then * wp) / (w + wp));
  const pool = all.filter((s) => s.team !== abbrev && (s.gp >= 5 || (s.prev?.gp ?? 0) >= 30)).map((s) => {
    const w = (s.toi5 ?? 0) * s.gp, wp = (s.prev?.toi5 ?? 0) * (s.prev?.gp ?? 0);
    return { ...s, p60b: blend(s.p60, s.prev?.p60, w, wp), satRelB: blend(s.satRel, s.prev?.satRel, w, wp) };
  });
  const top = (rows: any[], score: (s: any) => number | null, n = 40) => rows.map((s) => ({ s, v: score(s) })).filter((x) => x.v != null && Number.isFinite(x.v)).sort((a, b) => b.v! - a.v!).slice(0, n).map((x) => x.s);
  const targets = {
    // 5-on-5 scoring from the forwards, on enough ice time to mean it
    scorers: top(pool.filter((s) => s.pos !== 'D' && ((s.toi5 ?? 0) * s.gp + (s.prev?.toi5 ?? 0) * (s.prev?.gp ?? 0)) >= 20 * 60 * 10), (s) => s.p60b),
    // defencemen who move the puck: scoring rate and the shot share with them on the ice
    puckD: top(pool.filter((s) => s.pos === 'D' && s.gp + (s.prev?.gp ?? 0) >= 20), (s) => (s.p60b ?? 0) + 4 * (s.satRelB ?? 0)),
    // the kill: real shorthanded minutes, few power-play goals against with them on the ice
    killers: top(pool.filter((s) => s.pkHours >= 0.75 && (s.shToi ?? 0) >= 60), (s) => -s.pkAdj),
    // the power play: points per hour on it, with enough of it to count
    pp: top(pool.filter((s) => s.ppHours >= 0.75 && (s.ppToi ?? 0) >= 60), (s) => s.ppAdj),
    // centres who win draws, on volume
    faceoffs: top(pool.filter((s) => (s.foN ?? 0) >= 80 && s.fo != null), (s) => s.fo),
    // shot share drivers: the club is better with them on the ice
    drivers: top(pool.filter((s) => s.gp + (s.prev?.gp ?? 0) >= 25 && (s.toi5 ?? 0) >= 600), (s) => s.satRelB),
  };
  // only what the page reads: the club's goalies' seasons, and every goalie's last season with enough starts to judge
  const keep = new Set(goalieIds);
  const seasonsKept = seasons.filter((x) => keep.has(x.id) || (x.season === prev && x.gs >= 10));
  const slim = (x: any) => { const { toi5: _t, zs: _z, shPts: _s, ...rest } = x; return rest; };
  for (const k of Object.keys(targets) as (keyof typeof targets)[]) targets[k] = targets[k].map(slim);
  return { abbrev, season: cur, prevSeason: prev, goalies, leagueGoalies, seasons: seasonsKept, lgSvp, club, targets, lines, at: new Date().toISOString() };
}
async function fanOffice(abbrev: string) {
  if (!/^[A-Z]{3}$/.test(abbrev)) throw new Error('bad request');
  return cached(`fan-office:${abbrev}`, 3 * 3_600_000, () => officeBuild(abbrev));
}


// ── a game's lines
// The NHL publishes no line combinations, but its shift charts say who was on the ice every second. Two players who
// spent the most 5-on-5 time together are on the same line: forwards group into trios by shared time (seeded by the
// forward who played most), defencemen into pairs. The box score says who plays centre and the wings; the club roster
// says which way a defenceman shoots (left D, right D). A game that has started shows its own lines; one that hasn't
// shows each club's lines from its last game, which is what the club usually dresses.
interface LinePlayer { id: number; name: string; num: number; pos: string; toi: number }
const secs = (t: string) => { const [m, s] = String(t ?? '0:0').split(':').map(Number); return (m || 0) * 60 + (s || 0); };
async function clubLines(gameId: number, abbr: string) {
  const [shiftJ, box, roster, pbp] = await Promise.all([
    fetch(`https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${gameId}`, { headers: { 'user-agent': 'sak-league' } }).then((r) => (r.ok ? r.json() : { data: [] })),
    get(`/gamecenter/${gameId}/boxscore`),
    get(`/roster/${abbr}/current`).catch(() => null),
    get(`/gamecenter/${gameId}/play-by-play`).catch(() => null),
  ]);
  // every faceoff: when it happened and who took it (a line with two natural centres is centred by whoever takes the
  // draws while that line is on the ice)
  const faceoffs = ((pbp?.plays ?? []) as any[]).filter((pl) => pl.typeDescKey === 'faceoff')
    .map((pl) => ({ t: (Number(pl.periodDescriptor?.number ?? 1) - 1) * 1200 + secs(pl.timeInPeriod), ids: [pl.details?.winningPlayerId, pl.details?.losingPlayerId] as number[] }));
  const sideKey = box.awayTeam?.abbrev === abbr ? 'awayTeam' : 'homeTeam';
  const mine = box.playerByGameStats?.[sideKey] ?? {};
  const other = box.playerByGameStats?.[sideKey === 'awayTeam' ? 'homeTeam' : 'awayTeam'] ?? {};
  const goalieIds = new Set([...(mine.goalies ?? []), ...(other.goalies ?? [])].map((g: any) => g.playerId));
  const lastName = (n: string) => n.replace(/^[A-Z]\.\s*/, '');
  const person = (p: any): LinePlayer => ({ id: p.playerId, name: lastName(txt(p.name)), num: p.sweaterNumber, pos: p.position, toi: 0 });
  const fwd = new Map<number, LinePlayer>((mine.forwards ?? []).map((p: any) => [p.playerId, person(p)]));
  const dee = new Map<number, LinePlayer>((mine.defense ?? []).map((p: any) => [p.playerId, person(p)]));
  const shoots = new Map<number, string>([...(roster?.defensemen ?? [])].map((p: any) => [p.id, p.shootsCatches]));
  // who was on the ice each second, skaters only, per club
  const on: Record<string, Map<number, number[]>> = {};
  for (const sh of (shiftJ.data ?? []) as any[]) {
    if (sh.typeCode !== 517 || goalieIds.has(sh.playerId)) continue;
    const base = (sh.period - 1) * 1200, a = base + secs(sh.startTime), b = base + secs(sh.endTime);
    const m = (on[sh.teamAbbrev] ??= new Map());
    for (let t = a; t < b; t++) { const l = m.get(t); if (l) l.push(sh.playerId); else m.set(t, [sh.playerId]); }
  }
  const us = on[abbr] ?? new Map(), them = Object.entries(on).find(([k]) => k !== abbr)?.[1] ?? new Map();
  const pair = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const tally = (even: boolean) => {
    pair.clear();
    for (const p of [...fwd.values(), ...dee.values()]) p.toi = 0;
    for (const [t, ids] of us) {
      if (even && (ids.length !== 5 || (them.get(t)?.length ?? 0) !== 5)) continue;
      for (const id of ids) { const p = fwd.get(id) ?? dee.get(id); if (p) p.toi++; }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = key(ids[i], ids[j]); pair.set(k, (pair.get(k) ?? 0) + 1); }
    }
  };
  tally(true);
  // early in a game there's little 5-on-5 yet: use every second instead
  if ([...fwd.values()].reduce((t, p) => t + p.toi, 0) < 600) tally(false);
  const ov = (a: number, b: number) => pair.get(key(a, b)) ?? 0;
  const left = [...fwd.values()].filter((p) => p.toi > 0).sort((a, b) => b.toi - a.toi);
  const forwards: (LinePlayer | null)[][] = [];
  while (left.length >= 3 && forwards.length < 4) {
    const seed = left.shift()!;
    let best: [number, number, number] = [-1, 0, 1];
    for (let i = 0; i < left.length; i++) for (let j = i + 1; j < left.length; j++) {
      const v = ov(seed.id, left[i].id) + ov(seed.id, left[j].id) + ov(left[i].id, left[j].id);
      if (v > best[0]) best = [v, i, j];
    }
    const trio = [seed, left[best[1]], left[best[2]]];
    left.splice(best[2], 1); left.splice(best[1], 1);
    // centre from the box score's C, wings from L and R, anyone else where there's room
    const slot: (LinePlayer | null)[] = [null, null, null];
    // the draws this trio took together on the ice; with none, a natural centre
    const together = faceoffs.filter((f) => { const ids = us.get(f.t) ?? us.get(f.t + 1) ?? []; return trio.every((p) => ids.includes(p.id)); });
    const took = (p: LinePlayer) => together.filter((f) => f.ids.includes(p.id)).length;
    const centre = trio.reduce((b, p, k) => (took(p) > took(trio[b]) || (took(p) === took(trio[b]) && p.pos === 'C' && trio[b].pos !== 'C') ? k : b), 0);
    slot[1] = trio.splice(centre, 1)[0];
    for (const [i, pos] of [[0, 'L'], [2, 'R']] as const) { const k = trio.findIndex((p) => p.pos === pos); if (k >= 0) slot[i] = trio.splice(k, 1)[0]; }
    for (let i = 0; i < 3; i++) if (!slot[i] && trio.length) slot[i] = trio.shift()!;
    forwards.push(slot);
  }
  const dl = [...dee.values()].filter((p) => p.toi > 0).sort((a, b) => b.toi - a.toi);
  const defense: (LinePlayer | null)[][] = [];
  while (dl.length >= 2 && defense.length < 3) {
    const seed = dl.shift()!;
    let bi = 0; for (let i = 1; i < dl.length; i++) if (ov(seed.id, dl[i].id) > ov(seed.id, dl[bi].id)) bi = i;
    const mate = dl.splice(bi, 1)[0];
    const lefty = shoots.get(seed.id) === 'L' || (shoots.get(mate.id) !== 'L' && shoots.get(seed.id) !== 'R') ? seed : mate;
    defense.push(lefty === seed ? [seed, mate] : [mate, seed]);
  }
  const goalies = (mine.goalies ?? []).map((g: any) => ({ ...person(g), toi: secs(g.toi), starter: !!g.starter }))
    .sort((a: any, b: any) => Number(b.starter) - Number(a.starter) || b.toi - a.toi);
  return { forwards, defense, goalies, extras: [...left, ...dl] };
}

// a game's box score from ESPN's public summary, trimmed for NFL centre: the team stats a fan reads first, each side's
// passing, rushing and receiving leaders, and every scoring play with the score after it
const ESPN_SPORTS = new Set(['football/nfl']);
const NFL_STATS: [string, string][] = [['totalYards', 'Total yards'], ['netPassingYards', 'Passing'], ['rushingYards', 'Rushing'], ['firstDowns', '1st downs'],
  ['thirdDownEff', '3rd downs'], ['redZoneAttempts', 'Red zone'], ['turnovers', 'Turnovers'], ['sacksYardsLost', 'Sacked'], ['totalPenaltiesYards', 'Penalties'], ['possessionTime', 'Possession']];
async function espnBox(sport: string, id: string) {
  if (!ESPN_SPORTS.has(sport) || !id) throw new Error('bad request');
  // ESPN refuses a request with no user agent (soccer-sync sends the same one)
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${sport}/summary?event=${id}`, { headers: { 'user-agent': 'SuperPools/1.0', accept: 'application/json' } });
  if (!r.ok) throw new Error(`espn ${r.status}`);
  const d = await r.json();
  const state = d.header?.competitions?.[0]?.status?.type?.state ?? 'pre';
  const teams = (d.boxscore?.teams ?? []).map((t: any) => {
    const by = new Map((t.statistics ?? []).map((x: any) => [x.name, x.displayValue]));
    return { abbrev: t.team?.abbreviation, name: t.team?.displayName, logo: t.team?.logo ?? null, color: t.team?.color ? `#${t.team.color}` : null,
      home: t.homeAway === 'home', stats: NFL_STATS.filter(([k]) => by.has(k)).map(([k, label]) => ({ key: k, label, value: by.get(k) })) };
  });
  const leaders = (d.leaders ?? []).map((t: any) => ({ abbrev: t.team?.abbreviation,
    rows: (t.leaders ?? []).slice(0, 3).filter((c: any) => c.leaders?.length).map((c: any) => {
      const l = c.leaders[0];
      return { cat: String(c.displayName ?? '').replace(/ Yards$/, ''), name: l.athlete?.shortName ?? l.athlete?.displayName, headshot: l.athlete?.headshot?.href ?? null, line: l.displayValue };
    }) }));
  const scoring = (d.scoringPlays ?? []).map((p: any) => ({ q: p.period?.number, clock: p.clock?.displayValue, abbrev: p.team?.abbreviation,
    type: p.scoringType?.abbreviation ?? null, text: p.text, away: p.awayScore, home: p.homeScore }));
  // a game on now changes every play; a finished one doesn't
  return { state, teams, leaders, scoring, ttl: state === 'in' ? 30_000 : state === 'post' ? 21_600_000 : 600_000 };
}

// ── Every other sport's centre (#/sport, #/centre): the news, the table, the injury report and the leaders from ESPN's
// public feeds, trimmed to what the page draws. Each is kept in hub_cache as well as in memory, so a cold start
// doesn't pull ESPN's whole injury report (megabytes) again for the next person to open the tab.
const SPORT_TASKS = { 'sport-news': 600_000, 'sport-standings': 1_800_000, 'sport-injuries': 3_600_000, 'sport-leaders': 3_600_000 } as const;
type SportTask = keyof typeof SPORT_TASKS;
const sportOk = (s: string) => /^(football\/nfl|baseball\/mlb|basketball\/(nba|wnba|mens-college-basketball)|soccer\/[a-z0-9.]{3,20})$/.test(s);
const espn = async (url: string) => {
  const r = await fetch(url, { headers: { 'user-agent': 'SuperPools/1.0', accept: 'application/json' } });
  if (!r.ok) throw new Error(`espn ${r.status}`);
  return r.json();
};
const stat = (e: any, name: string) => (e.stats ?? []).find((x: any) => x.name === name);
// the table's columns, each sport's usual ones, in its own words
const COLS: Record<string, [string, string][]> = {
  soccer: [['gamesPlayed', 'P'], ['wins', 'W'], ['ties', 'D'], ['losses', 'L'], ['pointDifferential', 'GD'], ['points', 'Pts']],
  football: [['wins', 'W'], ['losses', 'L'], ['ties', 'T'], ['winPercent', 'Pct'], ['pointsFor', 'PF'], ['pointsAgainst', 'PA'], ['streak', 'Strk']],
  baseball: [['wins', 'W'], ['losses', 'L'], ['winPercent', 'Pct'], ['gamesBehind', 'GB'], ['streak', 'Strk']],
  basketball: [['wins', 'W'], ['losses', 'L'], ['winPercent', 'Pct'], ['gamesBehind', 'GB'], ['streak', 'Strk']],
};

async function sportNews(sport: string) {
  const d = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/news?limit=30`);
  return { items: (d.articles ?? []).filter((a: any) => a.headline).map((a: any) => ({
    id: String(a.id), headline: a.headline, blurb: a.description ?? null, image: a.images?.[0]?.url ?? null, link: a.links?.web?.href ?? null,
    at: a.published ?? a.lastModified ?? null, premium: !!a.premium,
    tags: (a.categories ?? []).filter((c: any) => c.type === 'team' || c.type === 'athlete').map((c: any) => c.description ?? c.athlete?.displayName).filter(Boolean).slice(0, 3),
  })) };
}

async function sportStandings(sport: string) {
  const d = await espn(`https://site.api.espn.com/apis/v2/sports/${sport}/standings`);
  const cols = COLS[sport.split('/')[0]] ?? COLS.basketball;
  const soccer = sport.startsWith('soccer/');
  // a league with groups (conferences, leagues) comes as children; a single table as the standings themselves
  const groups = (d.children?.length ? d.children : [d]).filter((g: any) => g.standings?.entries?.length).map((g: any) => {
    const rows = (g.standings.entries as any[]).map((e) => ({
      abbrev: e.team?.abbreviation ?? null, name: e.team?.displayName ?? e.team?.name ?? '', short: e.team?.shortDisplayName ?? null,
      logo: e.team?.logos?.[0]?.href ?? null, seed: Number(stat(e, soccer ? 'rank' : 'playoffSeed')?.value ?? 0) || null,
      pct: Number(stat(e, 'winPercent')?.value ?? 0), pts: Number(stat(e, 'points')?.value ?? 0), gd: Number(stat(e, 'pointDifferential')?.value ?? 0),
      cells: cols.map(([k]) => stat(e, k)?.displayValue ?? '–'),
      note: e.note?.description ? { text: e.note.description, color: e.note.color ?? null } : null,
    }));
    // ESPN's order isn't always the table's: soccer by points then goal difference, the rest by seed or win rate
    rows.sort((a, b) => soccer ? (b.pts - a.pts) || (b.gd - a.gd) : (a.seed && b.seed ? a.seed - b.seed : b.pct - a.pct));
    return { name: g.name ?? g.abbreviation ?? '', rows: rows.map(({ pct: _p, pts: _q, gd: _g, ...r }) => r) };
  });
  return { season: d.season?.displayName ?? d.seasons?.[0]?.displayName ?? null, cols: cols.map(([, l]) => l), groups };
}

async function sportInjuries(sport: string) {
  const d = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/injuries`);
  const teams = (d.injuries ?? []).map((t: any) => ({
    team: t.displayName ?? '', logo: null as string | null,
    rows: (t.injuries ?? []).filter((j: any) => j.status && j.status !== 'Active').slice(0, 20).map((j: any) => ({
      name: j.athlete?.displayName ?? '', pos: j.athlete?.position?.abbreviation ?? null, headshot: j.athlete?.headshot?.href ?? null,
      status: j.status, part: j.details?.type && j.details.type !== 'Not Specified' ? j.details.type : null,
      back: j.details?.returnDate ?? null, note: j.shortComment ?? null, at: j.date ?? null,
    })),
  })).filter((t: any) => t.rows.length);
  return { teams };
}

async function sportLeaders(sport: string) {
  if (sport.startsWith('soccer/')) {
    // soccer's leaders are the scoring charts: goals and assists
    const d = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sport}/statistics`);
    return { cats: (d.stats ?? []).map((c: any) => ({ name: c.displayName ?? (c.name === 'goalsLeaders' ? 'Goals' : 'Assists'),
      rows: (c.leaders ?? []).slice(0, 10).map((l: any) => ({ name: l.athlete?.displayName ?? '', team: l.athlete?.team?.abbreviation ?? null, pos: null, headshot: null,
        value: String(l.value ?? (l.displayValue ?? '').split(': ').pop() ?? ''),
        sub: ((m) => (m ? `${m[1]} matches` : null))(/Matches: (\d+)/.exec(l.displayValue ?? '')) })) })) };
  }
  const d = await espn(`https://site.web.api.espn.com/apis/site/v3/sports/${sport}/leaders`);
  return { cats: ((d.leaders?.categories ?? []) as any[]).slice(0, 10).map((c) => ({ name: c.displayName ?? c.name,
    rows: (c.leaders ?? []).slice(0, 10).map((l: any) => ({ name: l.athlete?.displayName ?? '', team: l.team?.abbreviation ?? l.athlete?.team?.abbreviation ?? null,
      pos: l.athlete?.position?.abbreviation ?? null, headshot: l.athlete?.headshot?.href ?? null, value: leaderValue(Number(l.value), c.displayName ?? c.name, l.displayValue),
      // baseball's display is the player's line ("8-19, 4 HR, 9 RBI"): worth keeping under the number
      sub: /[a-z,]/i.test(String(l.displayValue ?? '')) ? l.displayValue : null })) })) };
}
// a leader's number the way the sport writes it: .312 batting, 2.85 ERA, 33.5 a game, 1381 yards
function leaderValue(v: number, cat: string, display: unknown) {
  if (!Number.isFinite(v)) return String(display ?? '');
  if (/earned run|whip/i.test(cat)) return v.toFixed(2);
  if (/average|percentage|on-base|slugging/i.test(cat) && v < 10) return v < 1 ? v.toFixed(3).replace(/^0/, '') : v.toFixed(3);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

async function sportTask(task: SportTask, sport: string) {
  if (!sportOk(sport)) throw new Error('bad request');
  const key = `${task}:${sport}`, ttl = SPORT_TASKS[task];
  const { data: hit } = await db.from('hub_cache').select('body,at').eq('key', key).maybeSingle();
  if (hit && Date.now() - new Date(hit.at).getTime() < ttl) return { ...(hit.body as object), ttl };
  try {
    const body = task === 'sport-news' ? await sportNews(sport) : task === 'sport-standings' ? await sportStandings(sport)
      : task === 'sport-injuries' ? await sportInjuries(sport) : await sportLeaders(sport);
    await db.from('hub_cache').upsert({ key, body, at: new Date().toISOString() });
    return { ...body, ttl };
  } catch (e) {
    // ESPN down: the last copy beats an error
    if (hit) return { ...(hit.body as object), stale: true, ttl: 120_000 };
    throw e;
  }
}

// ── The fan zones of the other leagues (25 October 2026, Patrick: "I would like to include Premier League, NFL and NBA
// with the possibility of adding other leagues"): a league is a fan_leagues row (a new league of a sport already here is
// one more row) and everything else comes from ESPN's public feeds and the pools engine's own fixtures, for the analysis
// in src/lib/fanSport.ts to read.
//   fan-sport-league: every club with its colours, conference and division, the table, every club's season numbers (its
//     own and what it allowed, from ESPN's numbers by team; a soccer club's from ESPN's season feed, expected goals
//     included), the season's games with their pre-game chances, and the league's leaders. An hour in hub_cache.
//   fan-sport: one club's roster (ages, positions, injuries; a soccer player's own season), its leaders in every
//     category, its coach, its next game and its news. Half an hour in hub_cache.
// The players either one names are written to fan_athletes as they come (and the clubs to fan_clubs), so the fans' calls
// can only name a real player of the club.
interface FanSportRow { key: string; name: string; sport: 'football' | 'basketball' | 'soccer'; espn: string }
async function fanSportRow(key: string): Promise<FanSportRow> {
  const { data } = await db.from('fan_leagues').select('key,name,sport,espn').eq('key', key).eq('active', true).maybeSingle();
  if (!data?.espn || !['football', 'basketball', 'soccer'].includes(data.sport)) throw new Error('bad request');
  return data as FanSportRow;
}
const SITE = (p: string) => `https://site.api.espn.com/apis/site/v2/sports/${p}`;
const CORE = (p: string) => { const [s, l] = p.split('/'); return `https://sports.core.api.espn.com/v2/sports/${s}/leagues/${l}`; };
const hex = (c: unknown) => (typeof c === 'string' && /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : null);
const r3 = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1000) / 1000);
const refId = (ref: unknown) => /\/athletes\/(\d+)/.exec(String(ref ?? ''))?.[1] ?? null;
// the season the core feed keys its numbers by: soccer's league season is type 1 there, the others' regular season 2
async function coreSeason(row: FanSportRow) {
  const s = await espn(`${CORE(row.espn)}/season`).catch(() => null);
  const now = new Date();
  return { year: Number(s?.year) || now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0), type: row.sport === 'soccer' ? 1 : 2,
    label: String(s?.displayName ?? s?.year ?? '').replace(/ English Premier League$/, '') };
}
// a feed's logo for a dark page: the dark version where the league has one
const darkLogo = (logos: any[] | undefined) => (logos ?? []).find((l) => (l.rel ?? []).includes('dark') && !(l.rel ?? []).includes('scoreboard'))?.href ?? null;
// ten at a time, so twenty clubs' numbers don't land on ESPN in one burst
async function inBatches<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

async function fanSportLeagueBuild(row: FanSportRow) {
  const soccer = row.sport === 'soccer';
  const [teamsD, stD, season] = await Promise.all([
    espn(`${SITE(row.espn)}/teams?limit=60`), espn(`https://site.api.espn.com/apis/v2/sports/${row.espn}/standings?level=3`), coreSeason(row),
  ]);
  const teams = new Map<string, any>(((teamsD.sports?.[0]?.leagues?.[0]?.teams ?? []) as any[]).map((x) => [String(x.team?.id), x.team]));
  // the table, each club with its conference and division (soccer's is one table)
  const groups: { conf: string | null; div: string | null; entries: any[] }[] = [];
  for (const c of (stD.children?.length ? stD.children : [stD]) as any[]) {
    if (c.children?.length) for (const v of c.children) groups.push({ conf: c.abbreviation ?? c.name ?? null, div: v.name ?? null, entries: v.standings?.entries ?? [] });
    else groups.push({ conf: c.isConference ? c.abbreviation ?? c.name ?? null : null, div: null, entries: c.standings?.entries ?? [] });
  }
  const val = (e: any, name: string) => { const x = (e.stats ?? []).find((s: any) => s.name === name); return x ? Number(x.value ?? 0) : null; };
  const sum = (e: any, type: string) => (e.stats ?? []).find((s: any) => s.type === type)?.summary ?? null;
  const clubs = groups.flatMap((g) => g.entries.map((e: any) => {
    const t = teams.get(String(e.team?.id)) ?? e.team ?? {};
    const w = val(e, 'wins') ?? 0, l = val(e, 'losses') ?? 0, d = val(e, 'ties') ?? 0;
    return {
      code: String(e.team?.abbreviation ?? t.abbreviation ?? ''), id: String(e.team?.id ?? ''), name: t.displayName ?? e.team?.displayName ?? '',
      short: t.shortDisplayName ?? e.team?.shortDisplayName ?? null, nick: t.name ?? null,
      logo: t.logos?.[0]?.href ?? e.team?.logos?.[0]?.href ?? null, logoDark: darkLogo(t.logos), color: hex(t.color), alt: hex(t.alternateColor),
      conf: g.conf, div: g.div, gp: soccer ? val(e, 'gamesPlayed') ?? w + l + d : w + l + d, w, l, d,
      pf: val(e, 'pointsFor') ?? 0, pa: val(e, 'pointsAgainst') ?? 0, pts: soccer ? val(e, 'points') : null, deducted: soccer ? val(e, 'deductions') || null : null,
      seed: (soccer ? val(e, 'rank') : val(e, 'playoffSeed')) || null, streak: (e.stats ?? []).find((s: any) => s.name === 'streak')?.displayValue ?? null,
      home: sum(e, 'home'), road: sum(e, 'road'), vsDiv: sum(e, 'vsdiv'), vsConf: sum(e, 'vsconf'), last10: sum(e, 'lasttengames'),
      note: e.note?.description ?? null,
    };
  })).filter((c) => /^[A-Z0-9]{2,5}$/.test(c.code));

  // every club's season numbers, its own and what it allowed, named within each category ('passing.interceptions' are
  // thrown, 'defensiveinterceptions.interceptions' caught) and sent as one list of names with each club's values in that
  // order, a fifth of the size of a name on every number
  const own: Record<string, Record<string, number | null>> = {}, opp: Record<string, Record<string, number | null>> = {};
  if (!soccer) {
    const bt = await espn(`https://site.web.api.espn.com/apis/common/v3/sports/${row.espn}/statistics/byteam?region=us&lang=en&contentorigin=espn&limit=60`);
    const names = new Map<string, string[]>();
    for (const c of (bt.categories ?? []) as any[]) if (c.names?.length && !names.has(c.name)) names.set(c.name, c.names);
    for (const t of (bt.teams ?? []) as any[]) {
      const code = String(t.team?.abbreviation ?? '');
      own[code] ??= {}; opp[code] ??= {};
      for (const c of (t.categories ?? []) as any[]) {
        const n = names.get(c.name) ?? [];
        const side = c.splitId === '900' ? opp[code] : own[code];
        (c.values ?? []).forEach((v: unknown, i: number) => { if (n[i]) side[`${c.name}.${n[i]}`] = r3(v); });
      }
    }
  } else {
    // soccer's come club by club from the season feed, expected goals included; it keeps no opponents' side
    await inBatches(clubs, 10, async (c) => {
      const d = await espn(`${CORE(row.espn)}/seasons/${season.year}/types/${season.type}/teams/${c.id}/statistics`).catch(() => null);
      own[c.code] = {};
      for (const cat of (d?.splits?.categories ?? []) as any[]) for (const x of cat.stats ?? []) own[c.code][`${cat.name}.${x.name}`] = r3(x.value);
    });
  }
  const keys = [...new Set(Object.values(own).concat(Object.values(opp)).flatMap((x) => Object.keys(x)))].sort();
  const pack = (m: Record<string, Record<string, number | null>>) => Object.fromEntries(Object.entries(m).map(([c, x]) => [c, keys.map((k) => x[k] ?? null)]));
  const stats = { keys, own: pack(own), opp: soccer ? {} : pack(opp) };

  // the season's games from the pools engine's own fixtures (the same feed the pools settle on), with ESPN's chances
  // before each one: [kick-off, home, away, home score, away score, round, home chance, away chance, draw chance, line]
  const { data: cid } = await db.rpc('_fan_competition', { p_league: row.key });
  const games: unknown[][] = [];
  if (cid) {
    const rowsF: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('fixtures').select('kickoff,home_club,away_club,home_score,away_score,status,gameweek,round,detail')
        .eq('competition', cid).order('kickoff').order('id').range(from, from + 999);
      if (error) throw error;
      rowsF.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const ids = [...new Set(rowsF.flatMap((f) => [f.home_club, f.away_club]).filter(Boolean))];
    const { data: cl } = ids.length ? await db.from('clubs').select('id,short').in('id', ids) : { data: [] as any[] };
    const code = new Map((cl ?? []).map((c: any) => [c.id, c.short]));
    for (const f of rowsF) {
      const done = ['FT', 'AET', 'PEN'].includes(f.status);
      const o = f.detail?.odds ?? null;
      games.push([f.kickoff, code.get(f.home_club) ?? null, code.get(f.away_club) ?? null, done ? f.home_score : null, done ? f.away_score : null,
        f.gameweek ?? null, r3(o?.home), r3(o?.away), r3(o?.draw), r3(o?.line)]);
    }
  }

  // the league's leaders: the names its award calls offer
  const leaders = await fanSportLeaders(row).catch(() => [] as FanLeaderCat[]);

  // what the zones need to know of each club and player, kept for the calls and the pages (service key; no fan writes these)
  const now = new Date().toISOString();
  const clubRows = clubs.map((c) => ({ league: row.key, code: c.code, name: c.name, short: c.short, logo: c.logo && /^https:\/\//i.test(c.logo) ? c.logo : null,
    color: c.color, alt_color: c.alt, espn_id: c.id, conference: c.conf, division: c.div, active: true, updated_at: now }));
  if (clubRows.length) { const { error } = await db.from('fan_clubs').upsert(clubRows, { onConflict: 'league,code' }); if (error) console.error('fan_clubs', error.message); }
  const people = new Map<string, { league: string; id: string; name: string; club: string | null; pos: string | null; updated_at: string }>();
  for (const c of leaders) for (const r of c.rows) if (r.id && /^\d{1,12}$/.test(r.id)) people.set(r.id, { league: row.key, id: r.id, name: r.name, club: r.team, pos: r.pos, updated_at: now });
  if (people.size) { const { error } = await db.from('fan_athletes').upsert([...people.values()], { onConflict: 'league,id' }); if (error) console.error('fan_athletes', error.message); }

  return { league: row.key, name: row.name, sport: row.sport, season: season.label || null, year: season.year, clubs, stats, games, leaders, at: now };
}

interface FanLeaderCat { cat: string; name: string; rows: { id: string | null; name: string; team: string | null; pos: string | null; headshot: string | null; value: number; display: string }[] }
async function fanSportLeaders(row: FanSportRow): Promise<FanLeaderCat[]> {
  if (row.sport === 'soccer') {
    // soccer's leaders are the scoring charts: goals and assists
    const d = await espn(`${SITE(row.espn)}/statistics`);
    return ((d.stats ?? []) as any[]).map((c) => ({ cat: c.name === 'assistsLeaders' ? 'assists' : 'goals', name: c.name === 'assistsLeaders' ? 'Assists' : 'Goals',
      rows: ((c.leaders ?? []) as any[]).slice(0, 25).map((l) => ({ id: l.athlete?.id ? String(l.athlete.id) : null, name: l.athlete?.displayName ?? '',
        team: l.athlete?.team?.abbreviation ?? null, pos: l.athlete?.position?.abbreviation ?? null, headshot: null, value: Number(l.value ?? 0),
        display: String(l.displayValue ?? '') })) }));
  }
  // ten a category (the feed refuses a bigger page)
  const d = await espn(`https://site.web.api.espn.com/apis/site/v3/sports/${row.espn}/leaders`);
  return ((d.leaders?.categories ?? []) as any[]).map((c) => ({ cat: String(c.name ?? ''), name: String(c.displayName ?? c.name ?? ''),
    rows: ((c.leaders ?? []) as any[]).slice(0, 25).map((l) => ({ id: l.athlete?.id ? String(l.athlete.id) : null, name: l.athlete?.displayName ?? '',
      team: l.team?.abbreviation ?? l.athlete?.team?.abbreviation ?? null, pos: l.athlete?.position?.abbreviation ?? null,
      headshot: l.athlete?.headshot?.href ?? null, value: Number(l.value ?? 0), display: String(l.displayValue ?? '') })) }));
}

async function fanSportClubBuild(row: FanSportRow, code: string) {
  const { data: fc } = await db.from('fan_clubs').select('code,name,espn_id').eq('league', row.key).eq('code', code).eq('active', true).maybeSingle();
  if (!fc?.espn_id) throw new Error('bad request');
  const id = String(fc.espn_id), soccer = row.sport === 'soccer';
  const season = await coreSeason(row);
  const [team, roster, leadersD, newsD] = await Promise.all([
    espn(`${SITE(row.espn)}/teams/${id}`).then((d) => d.team ?? {}),
    espn(`${SITE(row.espn)}/teams/${id}/roster`),
    espn(`${CORE(row.espn)}/seasons/${season.year}/types/${season.type}/teams/${id}/leaders`).catch(() => null),
    espn(`${SITE(row.espn)}/news?team=${id}&limit=30`).catch(() => null),
  ]);
  const st = (x: any) => Object.fromEntries(((x.statistics?.splits?.categories ?? []) as any[]).flatMap((c) => (c.stats ?? []).map((s: any) => [s.name, Number(s.value ?? 0)])));
  // the roster comes in position groups (the NFL's offence, defence and special teams) or as one list
  const list = ((roster.athletes ?? []) as any[]).flatMap((a) => (Array.isArray(a.items) ? a.items.map((x: any) => ({ ...x, group: a.position ?? null })) : [a]));
  const players = list.map((a: any) => {
    const inj = (a.injuries ?? [])[0] ?? null;
    const s = soccer ? st(a) : null;
    return {
      id: String(a.id), name: a.displayName ?? a.fullName ?? '', short: a.shortName ?? null, pos: a.position?.abbreviation ?? null,
      posName: a.position?.displayName ?? a.position?.name ?? null, group: a.group ?? a.position?.parent?.abbreviation ?? null,
      jersey: a.jersey ?? null, age: a.age ?? null, exp: a.experience?.years ?? null, ht: a.displayHeight ?? null, wt: a.displayWeight ?? null,
      headshot: a.headshot?.href ?? null, from: a.college?.name ?? a.citizenship ?? a.birthPlace?.country ?? null,
      injury: inj ? { status: inj.status ?? inj.type?.description ?? 'Injured', date: inj.date ?? null, type: inj.details?.type ?? null,
        detail: inj.details?.detail ?? inj.shortComment ?? null, back: inj.details?.returnDate ?? null } : null,
      // a soccer player's season comes with the roster
      season: s ? { apps: s.appearances ?? 0, subs: s.subIns ?? 0, g: s.totalGoals ?? 0, a: s.goalAssists ?? 0, sh: s.totalShots ?? 0,
        sot: s.shotsOnTarget ?? 0, sv: s.saves ?? 0, ga: s.goalsConceded ?? 0, faced: s.shotsFaced ?? 0, yc: s.yellowCards ?? 0, rc: s.redCards ?? 0,
        fc: s.foulsCommitted ?? 0, fs: s.foulsSuffered ?? 0, off: s.offsides ?? 0 } : null,
    };
  }).filter((p: any) => /^\d{1,12}$/.test(p.id));
  // the club's leaders in every category the feed keeps (the NBA's lists every player who has played)
  const leaders = ((leadersD?.categories ?? []) as any[]).map((c) => ({ cat: String(c.name ?? ''), name: String(c.displayName ?? c.name ?? ''),
    rows: ((c.leaders ?? []) as any[]).map((l) => ({ id: refId(l.athlete?.$ref), value: r3(l.value) ?? 0, display: String(l.displayValue ?? '') })).filter((r) => r.id) }));
  const ev = team.nextEvent?.[0];
  const comp = ev?.competitions?.[0];
  const them = (comp?.competitors ?? []).find((c: any) => String(c.team?.id ?? c.id) !== id);
  const next = ev ? { at: ev.date ?? null, name: ev.shortName ?? ev.name ?? null, home: (comp?.competitors ?? []).find((c: any) => String(c.team?.id ?? c.id) === id)?.homeAway === 'home',
    opp: them?.team?.abbreviation ?? null, oppName: them?.team?.displayName ?? null, venue: comp?.venue?.fullName ?? null, week: ev.week?.text ?? null,
    tv: comp?.broadcasts?.[0]?.media?.shortName ?? null } : null;
  const coach = !soccer && roster.coach?.[0] ? { name: `${roster.coach[0].firstName ?? ''} ${roster.coach[0].lastName ?? ''}`.trim(), years: roster.coach[0].experience ?? null } : null;
  // the club's own stories: tagged with the club and about it (a league-wide roundup tags half the league), and none
  // about betting lines
  const nameRe = new RegExp(`\\b(${[team.shortDisplayName, team.name, fc.name].filter(Boolean).map((x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  const tags = (a: any) => ((a.categories ?? []) as any[]).filter((c) => c.type === 'team').map((c) => String(c.teamId ?? c.team?.id ?? ''));
  const news = ((newsD?.articles ?? []) as any[])
    .filter((a) => a.headline && !/\b(bets?|betting|odds|wagers?|parlays?|props?|sportsbooks?)\b/i.test(a.headline) && tags(a).includes(id)
      && (tags(a).length <= 3 || nameRe.test(`${a.headline} ${a.description ?? ''}`)))
    .slice(0, 10).map((a) => ({ headline: a.headline, blurb: a.description ?? null,
      link: a.links?.web?.href ?? null, image: a.images?.[0]?.url ?? null, at: a.published ?? a.lastModified ?? null }));

  // the club's players, kept for the fans' calls
  const now = new Date().toISOString();
  if (players.length) {
    const { error } = await db.from('fan_athletes').upsert(players.map((p: any) => ({ league: row.key, id: p.id, name: p.name, club: code, pos: p.pos, updated_at: now })), { onConflict: 'league,id' });
    if (error) console.error('fan_athletes', error.message);
  }
  return {
    league: row.key, club: code, id, name: team.displayName ?? fc.name, short: team.shortDisplayName ?? null, logo: team.logos?.[0]?.href ?? null,
    logoDark: darkLogo(team.logos), color: hex(team.color), alt: hex(team.alternateColor), venue: team.franchise?.venue?.fullName ?? null,
    city: team.franchise?.venue?.address?.city ?? null, standing: team.standingSummary ?? null, record: team.record?.items?.[0]?.summary ?? null,
    coach, next, players, leaders, news, season: season.label || null, at: now,
  };
}
async function fanSport(league: string, club: string) {
  const row = await fanSportRow(league);
  if (!/^[A-Z0-9]{2,5}$/.test(club)) throw new Error('bad request');
  return cached(`fan-sport:${row.key}:${club}`, 1_800_000, () => fanSportClubBuild(row, club));
}
async function fanSportLeague(league: string) {
  const row = await fanSportRow(league);
  return cached(`fan-sport-league:${row.key}`, 3_600_000, () => fanSportLeagueBuild(row));
}

// ── the other leagues' history (25 October 2026, Patrick: "amazing deep analysis, outlook and history pages"): ESPN keeps
// each season's final table from 2002 (the NFL) and 2003 (the NBA, the Premier League), and each postseason's records, so
// every club's seasons since then are read from them: the record, the points, the division or the place in the table,
// the seed, and how the spring went (the round reached, from the postseason wins and losses: the NFL's champion is the one
// club without a loss, the NBA's the one with sixteen wins, soccer's the top of the table). A season that is over never
// changes, so each is kept in hub_cache for good once read; the whole history is put together every twelve hours. The
// titles before the data are settled history in the site (src/data/leagueTitles.ts).
//   fan-sport-history&league=nfl: { league, sport, from, to, clubs: { KC: [season...] }, champions: [{ year, champ, runner }], at }
interface HistRow { year: number; team: string; name: string; w: number; l: number; d: number; pf: number; pa: number; pts: number | null; rank: number | null; seed: number | null; div: string | null; divRank: number | null; conf: string | null; po: { w: number; l: number; round: number; won: boolean } | null; note: string | null }
const FIRST_SEASON: Record<string, number> = { football: 2002, basketball: 2003, soccer: 2003 };
const stdGroups = (d: any): { conf: string | null; div: string | null; entries: any[] }[] => {
  const out: { conf: string | null; div: string | null; entries: any[] }[] = [];
  for (const c of (d.children?.length ? d.children : [d]) as any[]) {
    if (c.children?.length) for (const v of c.children) out.push({ conf: c.abbreviation ?? c.name ?? null, div: v.name ?? null, entries: v.standings?.entries ?? [] });
    else out.push({ conf: c.isConference ? c.abbreviation ?? c.name ?? null : null, div: null, entries: c.standings?.entries ?? [] });
  }
  return out;
};
async function fanSportSeasonBuild(row: FanSportRow, year: number): Promise<{ year: number; rows: HistRow[]; champ: string | null; runner: string | null } | null> {
  const soccer = row.sport === 'soccer', football = row.sport === 'football';
  const std = await espn(`https://site.api.espn.com/apis/v2/sports/${row.espn}/standings?season=${year}&level=3`);
  if (Number(std.season?.year) !== year) return null;   // nothing kept for that season
  const val = (e: any, name: string) => { const x = (e.stats ?? []).find((s: any) => s.name === name); return x ? Number(x.value ?? 0) : null; };
  const rows: HistRow[] = [];
  for (const g of stdGroups(std)) {
    g.entries.forEach((e: any, i: number) => {
      const w = val(e, 'wins') ?? 0, l = val(e, 'losses') ?? 0, d = val(e, 'ties') ?? 0;
      rows.push({ year, team: String(e.team?.id ?? ''), name: e.team?.displayName ?? '', w, l, d, pf: val(e, 'pointsFor') ?? 0, pa: val(e, 'pointsAgainst') ?? 0,
        pts: soccer ? val(e, 'points') : null, rank: soccer ? val(e, 'rank') : null, seed: soccer ? null : val(e, 'playoffSeed') || null,
        div: g.div, divRank: g.div ? i + 1 : null, conf: g.conf, po: null, note: e.note?.description ?? null });
    });
  }
  if (!rows.length) return null;
  let champ: string | null = null, runner: string | null = null;
  if (soccer) {
    const order = [...rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    champ = order[0]?.team ?? null; runner = order[1]?.team ?? null;
  } else {
    // the postseason: each club's wins and losses in it
    const po = await espn(`https://site.api.espn.com/apis/v2/sports/${row.espn}/standings?season=${year}&seasontype=3`).catch(() => null);
    const games = new Map<string, { w: number; l: number }>();
    if (po) for (const g of stdGroups(po)) for (const e of g.entries) { const w = val(e, 'wins') ?? 0, l = val(e, 'losses') ?? 0; if (w + l > 0) games.set(String(e.team?.id ?? ''), { w, l }); }
    if (football) {
      // the Super Bowl, from the last week of the postseason that holds it, names both finalists; the byes (one a
      // conference since 2020, two before) went to the division winners with the best records
      const weeks = await espn(`${CORE(row.espn)}/seasons/${year}/types/3/weeks`).catch(() => null);
      const n = Number(weeks?.count ?? 0);
      let final: { winner: string | null; loser: string | null } | null = null;
      for (const wk of [n, n - 1].filter((x) => x >= 3)) {
        const ev = await espn(`${CORE(row.espn)}/seasons/${year}/types/3/weeks/${wk}/events`).catch(() => null);
        for (const it of (ev?.items ?? []) as any[]) {
          const e = await espn(String(it.$ref).replace(/^http:/, 'https:')).catch(() => null);
          const comp = e?.competitions?.[0];
          if (!comp || !/super bowl/i.test(comp.notes?.[0]?.headline ?? e?.name ?? '')) continue;
          const team = (c: any) => /teams\/(\d+)/.exec(String(c.team?.$ref ?? ''))?.[1] ?? null;
          final = { winner: team(comp.competitors.find((c: any) => c.winner)) , loser: team(comp.competitors.find((c: any) => !c.winner)) };
          break;
        }
        if (final) break;
      }
      const byes = new Set<string>();
      for (const conf of new Set(rows.map((r) => r.conf))) {
        const winners = rows.filter((r) => r.conf === conf && r.divRank === 1).sort((a, b) => (b.w + b.d / 2) / Math.max(1, b.w + b.l + b.d) - (a.w + a.d / 2) / Math.max(1, a.w + a.l + a.d) || (b.pf - b.pa) - (a.pf - a.pa));
        winners.slice(0, year >= 2020 ? 1 : 2).forEach((r) => byes.add(r.team));
      }
      for (const r of rows) {
        const g = games.get(r.team);
        if (!g) continue;
        const won = final?.winner === r.team;
        const round = won ? 5 : final?.loser === r.team ? 4 : (byes.has(r.team) ? 2 : 1) + g.w;
        r.po = { w: g.w, l: g.l, round, won };
      }
      champ = final?.winner ?? rows.find((r) => r.po && r.po.l === 0 && r.po.w > 0)?.team ?? null;
      runner = final?.loser ?? null;
    } else {
      // a round is four wins; sixteen is the title
      for (const r of rows) {
        const g = games.get(r.team);
        if (!g) continue;
        const won = g.w >= 16;
        r.po = { w: g.w, l: g.l, round: won ? 5 : 1 + Math.floor(g.w / 4), won };
      }
      champ = rows.find((r) => r.po?.won)?.team ?? null;
      runner = rows.filter((r) => r.po && !r.po.won && r.po.w >= 12).sort((a, b) => b.po!.w - a.po!.w)[0]?.team ?? null;
    }
  }
  return { year, rows, champ, runner };
}
async function fanSportHistoryBuild(row: FanSportRow) {
  const season = await coreSeason(row);
  const from = FIRST_SEASON[row.sport] ?? 2003, to = season.year - 1;
  const { data: fc } = await db.from('fan_clubs').select('code,espn_id,name').eq('league', row.key).eq('active', true);
  const codeOf = new Map(((fc ?? []) as any[]).map((c) => [String(c.espn_id), String(c.code)]));
  const clubs: Record<string, HistRow[]> = Object.fromEntries(((fc ?? []) as any[]).map((c) => [String(c.code), []]));
  const champions: { year: number; champ: string | null; runner: string | null; champName: string | null }[] = [];
  const years: number[] = []; for (let y = from; y <= to; y++) years.push(y);
  // a season that is over is read once and kept; the latest two are re-read now and then in case a record was amended
  const seasons = await inBatches(years, 4, (y) => cached(`fan-sport-season:${row.key}:${y}`, y >= to - 1 ? 7 * 86_400_000 : 400 * 86_400_000, async () => (await fanSportSeasonBuild(row, y)) ?? { year: y, rows: [], champ: null, runner: null, none: true }) as unknown as Promise<{ year: number; rows: HistRow[]; champ: string | null; runner: string | null; none?: boolean }>);
  for (const s of seasons) {
    if (!s || s.none || !s.rows?.length) continue;
    for (const r of s.rows) { const code = codeOf.get(r.team); if (code) clubs[code].push(r); }
    const name = s.rows.find((r) => r.team === s.champ)?.name ?? null;
    champions.push({ year: s.year, champ: s.champ ? codeOf.get(s.champ) ?? null : null, runner: s.runner ? codeOf.get(s.runner) ?? null : null, champName: name });
  }
  for (const code of Object.keys(clubs)) clubs[code].sort((a, b) => a.year - b.year);
  return { league: row.key, sport: row.sport, from, to, clubs, champions, at: new Date().toISOString() };
}
async function fanSportHistory(league: string) {
  const row = await fanSportRow(league);
  return cached(`fan-sport-history:${row.key}`, 12 * 3_600_000, () => fanSportHistoryBuild(row));
}

async function gameLines(id: string) {
  const land = await get(`/gamecenter/${id}/landing`);
  const started = ['LIVE', 'CRIT', 'OFF', 'FINAL'].includes(land.gameState);
  const side = async (abbr: string) => {
    if (started) return { from: 'this' as const, ref: { id: Number(id), date: land.gameDate, opp: null as string | null }, ...(await clubLines(Number(id), abbr)) };
    const sched = await get(`/club-schedule-season/${abbr}/now`).catch(() => null);
    const prev = (sched?.games ?? []).filter((g: any) => ['OFF', 'FINAL'].includes(g.gameState) && g.startTimeUTC < land.startTimeUTC).pop();
    if (!prev) return null;
    const opp = prev.awayTeam?.abbrev === abbr ? `@ ${prev.homeTeam?.abbrev}` : `vs ${prev.awayTeam?.abbrev}`;
    return { from: 'last' as const, ref: { id: prev.id, date: prev.gameDate, opp }, ...(await clubLines(prev.id, abbr)) };
  };
  const [away, home] = await Promise.all([side(land.awayTeam.abbrev), side(land.homeTeam.abbrev)]);
  const live = ['LIVE', 'CRIT'].includes(land.gameState);
  // a live game's lines move every shift change; a finished or upcoming game's don't
  return { away, home, ttl: live ? 60_000 : started ? 21_600_000 : 3_600_000 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const task = url.searchParams.get('task') ?? 'scores';
  const date = url.searchParams.get('date') ?? 'now';
  const id = url.searchParams.get('id') ?? '';
  const abbrev = (url.searchParams.get('abbrev') ?? '').toUpperCase();
  const sport = url.searchParams.get('sport') ?? '';
  // the fan zones of the other leagues: a fan_leagues key and one of its clubs (ESPN's codes run two to four letters)
  const league = url.searchParams.get('league') ?? '';
  const clubCode = (url.searchParams.get('club') ?? '').toUpperCase();
  if (!/^(now|\d{4}-\d{2}-\d{2})$/.test(date) || !/^\d{0,12}$/.test(id) || !/^[A-Z]{0,3}$/.test(abbrev) || !/^[a-z0-9./-]{0,40}$/.test(sport)
    || !/^[a-z0-9-]{0,12}$/.test(league) || !/^[A-Z0-9]{0,5}$/.test(clubCode)) return Response.json({ error: 'bad request' }, { status: 400, headers: cors });
  const key = `${task}:${date}:${id}:${abbrev}:${sport}:${league}:${clubCode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Response.json(hit.body, { headers: { ...cors, 'x-cache': 'hit' } });
  try {
    const body = task === 'standings' ? await standings() : task === 'schedule' ? await schedule(date) : task === 'game' ? await gameDetail(id)
      : task === 'news' ? await news() : task === 'x' ? await xfeed() : task === 'leaders' ? await leaders() : task === 'team' ? await club(abbrev) : task === 'fan' ? await fanZone(abbrev) : task === 'fan-history' ? await fanHistory(abbrev) : task === 'fan-office' ? await fanOffice(abbrev) : task === 'fan-league' ? await fanLeague()
      : task === 'lines' ? await gameLines(id) : task === 'espn' ? await espnBox(sport, id)
      : task === 'fan-sport' ? await fanSport(league, clubCode) : task === 'fan-sport-league' ? await fanSportLeague(league) : task === 'fan-sport-history' ? await fanSportHistory(league)
      : task in SPORT_TASKS ? await sportTask(task as SportTask, sport) : await scores(date);
    const ttl = (body as { ttl?: number })?.ttl ?? TTL[task as keyof typeof TTL] ?? 20_000;
    cache.set(key, { at: Date.now(), ttl, body });
    if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > v.ttl) cache.delete(k);
    return Response.json(body, { headers: { ...cors, 'x-cache': 'miss' } });
  } catch (e) {
    console.error(task, e);
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502, headers: cors });
  }
});
