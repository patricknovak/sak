// yahoo: lets a GM run their *other* Yahoo Fantasy Hockey leagues from inside SaK, through Yahoo's official
// Fantasy Sports API. Each GM signs in with Yahoo once (OAuth 2.0); their tokens live in yahoo_accounts, a
// table only this function (service role) can read. Every call is made as that GM, so Yahoo's own rules about
// who may set a lineup, make a move or approve a trade still apply.
//
//   POST {task: 'status'}                                    configured? connected? (never returns tokens)
//   POST {task: 'auth_url'}                                  where to send the GM to sign in with Yahoo
//   POST {task: 'exchange', code, state}                     finish the sign-in (the site posts Yahoo's code back)
//   POST {task: 'disconnect'}                                forget the tokens
//   POST {task: 'leagues'}                                   the GM's NHL leagues this season, with their team and rank in each
//   POST {task: 'league', league_key}                        settings, standings and this week's matchups
//   POST {task: 'scoreboard', league_key, week}              another week's matchups
//   POST {task: 'roster', team_key, date?}                   a team's roster for a date (any team in the league)
//   POST {task: 'set_lineup', team_key, coverage, date|week, players: [{player_key, position}]}
//   POST {task: 'players', league_key, status?, position?, search?, sort?, start?}
//   POST {task: 'add_drop', league_key, team_key, add?, drop?, faab?}
//   POST {task: 'transactions', league_key, team_key}         recent moves, pending trades and waiver claims
//   POST {task: 'trade_respond', transaction_key, action, note?}   accept | reject | allow | disallow | vote_against
//   POST {task: 'cancel', transaction_key}                    withdraw a pending trade or waiver claim
//   POST {task: 'propose_trade', league_key, trader_team_key, tradee_team_key, note?, players: [{player_key, from, to}]}
//
// Secrets: YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET from a Yahoo developer app (Fantasy Sports), as edge function
// secrets or as Vault secrets yahoo_client_id / yahoo_client_secret; optional YAHOO_REDIRECT_URI (default: the
// site root, which must match the app's registered redirect URI); optional YAHOO_SCOPE (default fspt-r).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { XMLParser } from 'npm:fast-xml-parser@4.5.0';

const URL_ = Deno.env.get('SUPABASE_URL')!;
const db = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
// the Yahoo app keys: env secrets first, otherwise Vault (secrets yahoo_client_id / yahoo_client_secret)
let CLIENT_ID = Deno.env.get('YAHOO_CLIENT_ID') ?? '';
let CLIENT_SECRET = Deno.env.get('YAHOO_CLIENT_SECRET') ?? '';
let credsChecked = !!(CLIENT_ID && CLIENT_SECRET);
async function loadCreds() {
  if (credsChecked) return;
  const { data } = await db.rpc('_yahoo_creds');
  const v = (data ?? {}) as Record<string, string>;
  if (!CLIENT_ID && v.yahoo_client_id) CLIENT_ID = v.yahoo_client_id.trim();
  if (!CLIENT_SECRET && v.yahoo_client_secret) CLIENT_SECRET = v.yahoo_client_secret.trim();
  // keep looking until both exist, so a key added to Vault later is picked up without a redeploy
  credsChecked = !!(CLIENT_ID && CLIENT_SECRET);
}
const REDIRECT = Deno.env.get('YAHOO_REDIRECT_URI') ?? 'https://patricknovak.github.io/sak/';
// the OAuth scope to ask for: fspt-r (Fantasy Sports read) or fspt-w (read/write, only if the Yahoo app has it).
// Without an explicit scope Yahoo issues a token that can't call the Fantasy API at all ("not authorized").
const SCOPE = Deno.env.get('YAHOO_SCOPE') ?? 'fspt-r';
const API = 'https://fantasysports.yahooapis.com/fantasy/v2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class Fail extends Error { constructor(msg: string, public status = 400) { super(msg); } }

// ───────────── the GM calling ─────────────
interface Acct { team_id: number; guid: string | null; access_token: string | null; refresh_token: string | null; expires_at: string | null; state: string | null; state_at: string | null; connected_at: string | null; write_ok: boolean | null }

async function caller(req: Request) {
  const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) throw new Fail('Sign in first', 401);
  const { data: t } = await db.from('teams').select('id,gm_name').eq('user_id', u.user.id).single();
  if (!t) throw new Fail('No team', 404);
  const { data: a } = await db.from('yahoo_accounts').select('*').eq('team_id', t.id).maybeSingle();
  return { team: t as { id: number; gm_name: string }, acct: (a ?? null) as Acct | null };
}

// ───────────── OAuth ─────────────
const configured = () => !!(CLIENT_ID && CLIENT_SECRET);

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Fail(`Yahoo sign-in failed: ${j.error_description ?? j.error ?? r.status}`, 502);
  return j as { access_token: string; refresh_token: string; expires_in: number; xoauth_yahoo_guid?: string };
}

async function saveTokens(teamId: number, t: { access_token: string; refresh_token: string; expires_in: number; xoauth_yahoo_guid?: string }, extra: Record<string, unknown> = {}) {
  const row = { team_id: teamId, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(), updated_at: new Date().toISOString(), ...(t.xoauth_yahoo_guid ? { guid: t.xoauth_yahoo_guid } : {}), ...extra };
  const { error } = await db.from('yahoo_accounts').upsert(row);
  if (error) throw new Fail(error.message, 500);
  return row.access_token;
}

async function accessToken(acct: Acct | null) {
  if (!acct?.refresh_token) throw new Fail('Connect your Yahoo account first', 412);
  if (acct.access_token && acct.expires_at && new Date(acct.expires_at) > new Date()) return acct.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', redirect_uri: REDIRECT, refresh_token: acct.refresh_token });
  return saveTokens(acct.team_id, t);
}

// ───────────── Yahoo API ─────────────
const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, removeNSPrefix: true });
// deno-lint-ignore no-explicit-any
type Any = any;
const arr = (x: Any): Any[] => (x == null || x === '' ? [] : Array.isArray(x) ? x : [x]);
const num = (x: Any) => { const n = Number(x); return Number.isFinite(n) && x !== '' && x != null ? n : null; };
const yes = (x: Any) => x === '1' || x === 1 || x === true;
const str = (x: Any) => (x == null ? '' : String(x));

// small per-GM read cache so tab switches don't re-hit Yahoo
const cache = new Map<string, { at: number; body: Any }>();
const TTL = 30_000;
const bust = (teamId: number) => { for (const k of cache.keys()) if (k.startsWith(`${teamId}:`)) cache.delete(k); };

async function yget(acct: Acct, path: string, ttl = TTL): Promise<Any> {
  const key = `${acct.team_id}:${path}`;
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.body;
  const body = await ycall(acct, 'GET', path);
  cache.set(key, { at: Date.now(), body });
  return body;
}

async function ycall(acct: Acct, method: string, path: string, body?: string, retried = false): Promise<Any> {
  const token = await accessToken(acct);
  const r = await fetch(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/xml', ...(body ? { 'Content-Type': 'application/xml' } : {}) }, body });
  const text = await r.text();
  if (r.status === 401 && !retried) {
    // token revoked or expired early: refresh once and try again
    const fresh = await db.from('yahoo_accounts').select('*').eq('team_id', acct.team_id).single();
    if (fresh.data) { fresh.data.access_token = null; return ycall(fresh.data as Acct, method, path, body, true); }
  }
  const doc = text ? xml.parse(text) : {};
  if (!r.ok) {
    const desc = String(doc?.error?.description ?? doc?.yahoo_error?.description ?? text.slice(0, 200) ?? r.statusText).replace(/<[^>]+>/g, '').trim();
    if (method !== 'GET' && (r.status === 401 || r.status === 403 || /scope|permission|not allowed|read.only/i.test(desc))) {
      // the Yahoo app only has read access (Yahoo no longer offers Read/Write to every app): remember it so the site
      // sends this GM to Yahoo's own pages for changes instead
      await db.from('yahoo_accounts').update({ write_ok: false, updated_at: new Date().toISOString() }).eq('team_id', acct.team_id);
      throw new Fail(`Yahoo only lets SaK read your leagues, so this change has to be made on Yahoo itself. Use “Manage on Yahoo”. (${desc || r.status})`, 403);
    }
    throw new Fail(`Yahoo: ${desc || r.status}`, r.status === 401 ? 401 : 502);
  }
  if (method !== 'GET' && acct.write_ok !== true) db.from('yahoo_accounts').update({ write_ok: true }).eq('team_id', acct.team_id).then(() => {}, () => {});
  return doc?.fantasy_content ?? doc;
}

// ───────────── shapes the site shows ─────────────
function manager(t: Any) {
  const ms = arr(t?.managers?.manager);
  const mine = ms.find((m: Any) => yes(m.is_current_login));
  return { managers: ms.map((m: Any) => m.nickname).filter(Boolean), mine: !!mine, commissioner: ms.some((m: Any) => yes(m.is_commissioner) && yes(m.is_current_login)), anyCommish: ms.filter((m: Any) => yes(m.is_commissioner)).map((m: Any) => m.nickname) };
}
function team(t: Any) {
  const m = manager(t);
  const s = t.team_standings ?? {};
  const o = s.outcome_totals ?? {};
  return {
    key: str(t.team_key), id: num(t.team_id), name: str(t.name), url: str(t.url) || null, logo: arr(t.team_logos?.team_logo)[0]?.url ?? null,
    managers: m.managers, mine: m.mine, commissioner: m.commissioner, commishNames: m.anyCommish,
    waiver: num(t.waiver_priority), faab: num(t.faab_balance), moves: num(t.number_of_moves), trades: num(t.number_of_trades), clinched: yes(t.clinched_playoffs),
    rank: num(s.rank), seed: num(s.playoff_seed), w: num(o.wins), l: num(o.losses), t: num(o.ties), pct: num(o.percentage), pf: num(s.points_for), pa: num(s.points_against),
    points: num(t.team_points?.total), projected: num(t.team_projected_points?.total),
  };
}
function league(l: Any) {
  return {
    key: str(l.league_key), id: str(l.league_id), name: str(l.name), url: str(l.url) || null, logo: str(l.logo_url) || null, season: str(l.season),
    teams: num(l.num_teams), week: num(l.current_week), startWeek: num(l.start_week), endWeek: num(l.end_week), scoring: str(l.scoring_type), draft: str(l.draft_status),
    finished: yes(l.is_finished), type: str(l.league_type), updated: str(l.league_update_timestamp) || null, felo: str(l.felo_tier) || null,
  };
}
function player(p: Any) {
  const sp = p.selected_position ?? {};
  const own = p.ownership ?? {};
  return {
    key: str(p.player_key), id: num(p.player_id), name: str(p.name?.full), first: str(p.name?.first), last: str(p.name?.last),
    team: str(p.editorial_team_abbr).toUpperCase(), teamName: str(p.editorial_team_full_name), num: str(p.uniform_number) || null,
    pos: str(p.display_position), type: str(p.position_type), elig: arr(p.eligible_positions?.position).map(str),
    headshot: p.headshot?.url ?? p.image_url ?? null, status: str(p.status) || null, statusFull: str(p.status_full) || null, injury: str(p.injury_note) || null,
    undroppable: yes(p.is_undroppable), slot: str(sp.position) || null, editable: p.is_editable == null ? null : yes(p.is_editable),
    owner: own.ownership_type ? { type: str(own.ownership_type), teamKey: str(own.owner_team_key) || null, teamName: str(own.owner_team_name) || null, waiverDate: str(own.waiver_date) || null } : null,
    owned: num(p.percent_owned?.value), ownedDelta: num(p.percent_owned?.delta),
  };
}
function settings(s: Any) {
  return {
    draftType: str(s.draft_type), scoring: str(s.scoring_type), faab: yes(s.uses_faab), playoffs: yes(s.uses_playoff), playoffStart: num(s.playoff_start_week), playoffTeams: num(s.num_playoff_teams),
    tradeEnd: str(s.trade_end_date) || null, tradeRatify: str(s.trade_ratify_type) || null, tradeRejectTime: num(s.trade_reject_time), waiverType: str(s.waiver_type) || null, waiverRule: str(s.waiver_rule) || null, waiverTime: num(s.waiver_time),
    weeklyDeadline: str(s.weekly_deadline) || null, maxAdds: num(s.max_adds), maxTrades: num(s.max_trades),
    positions: arr(s.roster_positions?.roster_position).map((r: Any) => ({ pos: str(r.position), type: str(r.position_type) || null, count: num(r.count) ?? 0, starting: r.is_starting_position == null ? !['BN', 'IR', 'IR+', 'NA'].includes(str(r.position)) : yes(r.is_starting_position) })),
    stats: arr(s.stat_categories?.stats?.stat).map((c: Any) => ({ id: num(c.stat_id), name: str(c.display_name || c.name), full: str(c.name), type: str(c.position_type), displayOnly: yes(c.is_only_display_stat) })),
  };
}
function matchup(m: Any) {
  return {
    week: num(m.week), start: str(m.week_start) || null, end: str(m.week_end) || null, status: str(m.status), playoffs: yes(m.is_playoffs), consolation: yes(m.is_consolation),
    tied: yes(m.is_tied), winner: str(m.winner_team_key) || null, teams: arr(m.teams?.team).map(team),
    // category leagues: who leads each stat
    cats: arr(m.stat_winners?.stat_winner).map((w: Any) => ({ stat: num(w.stat_id), winner: str(w.winner_team_key) || null, tied: yes(w.is_tied) })),
  };
}
function transaction(t: Any) {
  return {
    key: str(t.transaction_key), id: str(t.transaction_id), type: str(t.type), status: str(t.status), at: num(t.timestamp) ? new Date(Number(t.timestamp) * 1000).toISOString() : null,
    trader: t.trader_team_key ? { key: str(t.trader_team_key), name: str(t.trader_team_name) } : null,
    tradee: t.tradee_team_key ? { key: str(t.tradee_team_key), name: str(t.tradee_team_name) } : null,
    note: str(t.trade_note) || null, faab: num(t.faab_bid),
    players: arr(t.players?.player).map((p: Any) => {
      const d = p.transaction_data ?? {};
      return { ...player(p), move: str(d.type), fromType: str(d.source_type) || null, from: str(d.source_team_name) || null, fromKey: str(d.source_team_key) || null, toType: str(d.destination_type) || null, to: str(d.destination_team_name) || null, toKey: str(d.destination_team_key) || null };
    }),
  };
}
const leagueOf = (teamKey: string) => teamKey.replace(/\.t\.\d+$/, '');
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const clean = (s: unknown, max = 200) => String(s ?? '').replace(/[^\w .,'’!?:;()/-]/g, '').slice(0, max);
const keyOk = (k: unknown, kind: 'l' | 't' | 'p') => typeof k === 'string' && new RegExp(kind === 'l' ? '^\\d+\\.l\\.\\d+$' : kind === 't' ? '^\\d+\\.l\\.\\d+\\.t\\.\\d+$' : '^\\d+\\.p\\.\\d+$').test(k);
const need = (ok: boolean, what: string) => { if (!ok) throw new Fail(`Bad ${what}`); };

// ───────────── tasks ─────────────
async function leagues(acct: Acct) {
  const [L, T] = await Promise.all([
    yget(acct, 'users;use_login=1/games;game_keys=nhl/leagues', 120_000),
    yget(acct, 'users;use_login=1/games;game_keys=nhl/teams', 120_000),
  ]);
  const games = arr(arr(L.users?.user)[0]?.games?.game);
  const ls = games.flatMap((g: Any) => arr(g.leagues?.league)).map(league);
  const myTeams = arr(arr(T.users?.user)[0]?.games?.game).flatMap((g: Any) => arr(g.teams?.team)).map(team);
  // rank and record come from each league's standings
  const standings = await Promise.all(ls.map((l) => yget(acct, `league/${l.key}/standings`, 120_000).catch(() => null)));
  return ls.map((l, i) => {
    const rows = arr(standings[i]?.league?.standings?.teams?.team).map(team);
    const mine = myTeams.find((t) => leagueOf(t.key) === l.key) ?? null;
    const me = mine ? rows.find((r) => r.key === mine.key) ?? mine : null;
    return { ...l, me, teams: rows.length || l.teams };
  }).sort((a, b) => Number(a.finished) - Number(b.finished) || a.name.localeCompare(b.name));
}

async function leagueDetail(acct: Acct, key: string) {
  need(keyOk(key, 'l'), 'league key');
  const [S, St] = await Promise.all([yget(acct, `league/${key}/settings`, 300_000), yget(acct, `league/${key}/standings`)]);
  const l = { ...league(St.league), settings: settings(S.league?.settings) };
  const teams = arr(St.league?.standings?.teams?.team).map(team);
  const me = teams.find((t) => t.mine) ?? null;
  const week = l.week;
  const sb = l.scoring === 'roto' || !week ? null : await yget(acct, `league/${key}/scoreboard;week=${week}`).catch(() => null);
  return { ...l, teams, me, matchups: sb ? arr(sb.league?.scoreboard?.matchups?.matchup).map(matchup) : null };
}

async function scoreboard(acct: Acct, key: string, week: number) {
  need(keyOk(key, 'l') && Number.isInteger(week) && week > 0 && week < 60, 'week');
  const sb = await yget(acct, `league/${key}/scoreboard;week=${week}`);
  return { week, matchups: arr(sb.league?.scoreboard?.matchups?.matchup).map(matchup) };
}

async function roster(acct: Acct, teamKey: string, date?: string) {
  need(keyOk(teamKey, 't'), 'team key');
  need(!date || /^\d{4}-\d{2}-\d{2}$/.test(date), 'date');
  const R = await yget(acct, `team/${teamKey}/roster${date ? `;date=${date}` : ''}`, 15_000);
  const t = R.team ?? {};
  const r = t.roster ?? {};
  return {
    team: team(t), coverage: str(r.coverage_type) || 'date', date: str(r.date) || null, week: num(r.week), editable: r.is_editable == null ? null : yes(r.is_editable),
    players: arr(r.players?.player).map(player),
  };
}

async function setLineup(acct: Acct, b: Any) {
  need(keyOk(b.team_key, 't'), 'team key');
  const moves = arr(b.players).filter((p: Any) => keyOk(p.player_key, 'p') && /^[A-Z+]{1,4}$/.test(str(p.position)));
  need(moves.length > 0, 'lineup: nothing to change');
  const cov = b.coverage === 'week' ? 'week' : 'date';
  const when = cov === 'week' ? `<week>${Number(b.week) || 1}</week>` : `<date>${/^\d{4}-\d{2}-\d{2}$/.test(str(b.date)) ? b.date : new Date().toISOString().slice(0, 10)}</date>`;
  const body = `<?xml version="1.0"?><fantasy_content><roster><coverage_type>${cov}</coverage_type>${when}<players>${moves.map((p: Any) => `<player><player_key>${p.player_key}</player_key><position>${p.position}</position></player>`).join('')}</players></roster></fantasy_content>`;
  await ycall(acct, 'PUT', `team/${b.team_key}/roster`, body);
  bust(acct.team_id);
  return { ok: true, moved: moves.length };
}

async function players(acct: Acct, b: Any) {
  need(keyOk(b.league_key, 'l'), 'league key');
  const f: string[] = [];
  const status = ['A', 'FA', 'W', 'T', 'K'].includes(str(b.status)) ? str(b.status) : 'FA';
  f.push(`status=${status}`);
  if (/^[A-Z+]{1,4}$/.test(str(b.position))) f.push(`position=${b.position}`);
  const search = clean(b.search, 40).trim();
  if (search) f.push(`search=${encodeURIComponent(search)}`);
  f.push(`sort=${['AR', 'OR', 'PTS', 'NAME'].includes(str(b.sort)) ? b.sort : 'AR'}`);
  const start = Math.max(0, Math.min(500, Number(b.start) || 0));
  f.push(`start=${start}`, 'count=25');
  const path = `league/${b.league_key}/players;${f.join(';')}`;
  let P: Any;
  try { P = await yget(acct, `${path};out=ownership,percent_owned`); }
  catch { P = await yget(acct, path); }
  const list = arr(P.league?.players?.player).map(player);
  return { start, players: list, more: list.length === 25 };
}

async function addDrop(acct: Acct, b: Any) {
  need(keyOk(b.league_key, 'l') && keyOk(b.team_key, 't'), 'keys');
  const add = keyOk(b.add, 'p') ? b.add : null;
  const drop = keyOk(b.drop, 'p') ? b.drop : null;
  need(!!(add || drop), 'move: nothing to do');
  const type = add && drop ? 'add/drop' : add ? 'add' : 'drop';
  const faab = b.faab != null && Number.isInteger(Number(b.faab)) && Number(b.faab) >= 0 ? `<faab_bid>${Number(b.faab)}</faab_bid>` : '';
  const addX = add ? `<player><player_key>${add}</player_key><transaction_data><type>add</type><destination_team_key>${b.team_key}</destination_team_key></transaction_data></player>` : '';
  const dropX = drop ? `<player><player_key>${drop}</player_key><transaction_data><type>drop</type><source_team_key>${b.team_key}</source_team_key></transaction_data></player>` : '';
  const inner = add && drop ? `<players>${addX}${dropX}</players>` : addX || dropX;
  const body = `<?xml version="1.0"?><fantasy_content><transaction><type>${type}</type>${faab}${inner}</transaction></fantasy_content>`;
  const r = await ycall(acct, 'POST', `league/${b.league_key}/transactions`, body);
  bust(acct.team_id);
  const t = r.transaction ?? r.league?.transactions?.transaction;
  return { ok: true, transaction: t ? transaction(arr(t)[0]) : null };
}

async function transactions(acct: Acct, leagueKey: string, teamKey: string) {
  need(keyOk(leagueKey, 'l') && keyOk(teamKey, 't'), 'keys');
  const [R, P, W] = await Promise.all([
    yget(acct, `league/${leagueKey}/transactions;types=add,drop,trade,commish;count=40`, 15_000),
    yget(acct, `league/${leagueKey}/transactions;types=pending_trade;team_key=${teamKey}`, 15_000).catch(() => null),
    yget(acct, `league/${leagueKey}/transactions;types=waiver;team_key=${teamKey}`, 15_000).catch(() => null),
  ]);
  const tx = (x: Any) => arr(x?.league?.transactions?.transaction).map(transaction);
  return { recent: tx(R), pending: tx(P), waivers: tx(W) };
}

async function tradeRespond(acct: Acct, b: Any) {
  need(/^\d+\.l\.\d+\.\w+\.\d+$/.test(str(b.transaction_key)), 'transaction key');
  const action = str(b.action);
  need(['accept', 'reject', 'allow', 'disallow', 'vote_against'].includes(action), 'action');
  const note = clean(b.note);
  const body = `<?xml version="1.0"?><fantasy_content><transaction><transaction_key>${b.transaction_key}</transaction_key><type>pending_trade</type><action>${action}</action>${note ? `<trade_note>${esc(note)}</trade_note>` : ''}</transaction></fantasy_content>`;
  await ycall(acct, 'PUT', `transaction/${b.transaction_key}`, body);
  bust(acct.team_id);
  return { ok: true };
}

async function cancel(acct: Acct, key: string) {
  need(/^\d+\.l\.\d+\.\w+\.\d+$/.test(str(key)), 'transaction key');
  await ycall(acct, 'DELETE', `transaction/${key}`);
  bust(acct.team_id);
  return { ok: true };
}

async function proposeTrade(acct: Acct, b: Any) {
  need(keyOk(b.league_key, 'l') && keyOk(b.trader_team_key, 't') && keyOk(b.tradee_team_key, 't') && b.trader_team_key !== b.tradee_team_key, 'keys');
  const ps = arr(b.players).filter((p: Any) => keyOk(p.player_key, 'p') && keyOk(p.from, 't') && keyOk(p.to, 't') && p.from !== p.to);
  need(ps.length > 0, 'trade: pick at least one player');
  const note = clean(b.note);
  const body = `<?xml version="1.0"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>${b.trader_team_key}</trader_team_key><tradee_team_key>${b.tradee_team_key}</tradee_team_key>${note ? `<trade_note>${esc(note)}</trade_note>` : ''}<players>${ps.map((p: Any) => `<player><player_key>${p.player_key}</player_key><transaction_data><type>pending_trade</type><source_team_key>${p.from}</source_team_key><destination_team_key>${p.to}</destination_team_key></transaction_data></player>`).join('')}</players></transaction></fantasy_content>`;
  await ycall(acct, 'POST', `league/${b.league_key}/transactions`, body);
  bust(acct.team_id);
  return { ok: true };
}

// ───────────── server ─────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const task = str(b.task);
    const { team, acct } = await caller(req);
    await loadCreds();
    const connected = !!acct?.refresh_token;

    if (task === 'status') return json({ configured: configured(), connected, guid: connected ? acct?.guid ?? null : null, since: connected ? acct?.connected_at : null, writeOk: connected ? acct?.write_ok ?? null : null, redirect: REDIRECT });
    if (!configured()) throw new Fail('Yahoo sign-in is not set up yet: the commissioner needs to add YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET to the Supabase secrets.', 503);

    if (task === 'auth_url') {
      const state = crypto.randomUUID().replace(/-/g, '');
      const { error } = await db.from('yahoo_accounts').upsert({ team_id: team.id, state, state_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw new Fail(error.message, 500);
      const q = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code', scope: SCOPE, state, language: 'en-us' });
      return json({ url: `https://api.login.yahoo.com/oauth2/request_auth?${q}` });
    }
    if (task === 'exchange') {
      need(typeof b.code === 'string' && b.code.length < 400, 'code');
      if (!acct?.state || acct.state !== b.state || !acct.state_at || Date.now() - new Date(acct.state_at).getTime() > 15 * 60_000) throw new Fail('That Yahoo sign-in has expired. Try again.');
      const t = await tokenRequest({ grant_type: 'authorization_code', redirect_uri: REDIRECT, code: b.code });
      await saveTokens(team.id, t, { state: null, state_at: null, connected_at: new Date().toISOString() });
      bust(team.id);
      return json({ ok: true });
    }
    if (task === 'disconnect') {
      await db.from('yahoo_accounts').delete().eq('team_id', team.id);
      bust(team.id);
      return json({ ok: true });
    }
    if (!acct) throw new Fail('Connect your Yahoo account first', 412);

    switch (task) {
      case 'leagues': return json({ leagues: await leagues(acct) });
      case 'league': return json(await leagueDetail(acct, str(b.league_key)));
      case 'scoreboard': return json(await scoreboard(acct, str(b.league_key), Number(b.week)));
      case 'roster': return json(await roster(acct, str(b.team_key), b.date ? str(b.date) : undefined));
      case 'set_lineup': return json(await setLineup(acct, b));
      case 'players': return json(await players(acct, b));
      case 'add_drop': return json(await addDrop(acct, b));
      case 'transactions': return json(await transactions(acct, str(b.league_key), str(b.team_key)));
      case 'trade_respond': return json(await tradeRespond(acct, b));
      case 'cancel': return json(await cancel(acct, str(b.transaction_key)));
      case 'propose_trade': return json(await proposeTrade(acct, b));
      default: throw new Fail(`Unknown task ${task || '(none)'}`, 404);
    }
  } catch (e) {
    const f = e as Fail;
    if (!(e instanceof Fail)) console.error(e);
    return json({ error: f.message || 'Something went wrong' }, f.status && f.status >= 400 ? f.status : 500);
  }
});
