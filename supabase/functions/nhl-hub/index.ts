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
//   ?task=lines&id=<gameId>         each club's lines for a game: four forward lines, three defence pairs and the goalies,
//                                   worked out from the NHL's shift charts (a game that has started: its own 5-on-5; one
//                                   that hasn't: each club's last game)
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

async function scores(date: string) {
  // the day's scores carry no radio links; the schedule for the same day does, so they are joined by game
  const [j, w] = await Promise.all([get(`/score/${date}`), get(`/schedule/${date}`).catch(() => null)]);
  const radio = new Map<number, { home?: string; away?: string }>();
  for (const d of w?.gameWeek ?? []) for (const g of d.games ?? []) radio.set(g.id, { home: g.homeTeam?.radioLink, away: g.awayTeam?.radioLink });
  const games = (j.games ?? []).map((g: any) => {
    const r = radio.get(g.id);
    return game(r ? { ...g, homeTeam: { radioLink: r.home, ...g.homeTeam }, awayTeam: { radioLink: r.away, ...g.awayTeam } } : g);
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
  if (!/^(now|\d{4}-\d{2}-\d{2})$/.test(date) || !/^\d{0,12}$/.test(id) || !/^[A-Z]{0,3}$/.test(abbrev)) return Response.json({ error: 'bad request' }, { status: 400, headers: cors });
  const key = `${task}:${date}:${id}:${abbrev}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return Response.json(hit.body, { headers: { ...cors, 'x-cache': 'hit' } });
  try {
    const body = task === 'standings' ? await standings() : task === 'schedule' ? await schedule(date) : task === 'game' ? await gameDetail(id)
      : task === 'news' ? await news() : task === 'x' ? await xfeed() : task === 'leaders' ? await leaders() : task === 'team' ? await club(abbrev)
      : task === 'lines' ? await gameLines(id) : await scores(date);
    const ttl = (body as { ttl?: number })?.ttl ?? TTL[task as keyof typeof TTL] ?? 20_000;
    cache.set(key, { at: Date.now(), ttl, body });
    if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > v.ttl) cache.delete(k);
    return Response.json(body, { headers: { ...cors, 'x-cache': 'miss' } });
  } catch (e) {
    console.error(task, e);
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502, headers: cors });
  }
});
