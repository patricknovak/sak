// The fans' voice (migration 337, 25 October 2026, Patrick: "start some form of crowdsourcing from the fans that helps
// their team and that team management could see directly from the fans what they think"): the board (ideas, questions,
// insights, fixes), the knowledge base (facts), the calls (polls) and the pulse (what the fans think, for anyone to read
// and share). Reading is open to everyone; adding needs an account, which a fan makes from just a name (fanJoin).
// Since migration 338 every league with a fan zone has its own (the NHL, the NFL, the NBA, the Premier League; fan_leagues
// in the database): each function takes the league's key, the NHL's when none is given, and a league's own board is its
// key in capitals (NHL, NFL, NBA, EPL).
import { createContext, useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { setRemember, supabase } from './supabase';
import { useLeague } from './store';
import { NHL_TEAMS } from './format';
import { CLUB_NAMES } from '../data/clubColors';
import { CLUB_CALLS_BY_SPORT, LEAGUE_CALLS_BY_SPORT, QUESTION_CALLS, TOPICS_BY_SPORT, VERDICTS, type CallDef, type FanKind, type FanSport } from './fanLists';

export * from './fanLists';

export interface FanPost {
  id: number; league?: string; club: string; kind: FanKind; topic: string; title: string; body: string; source: string | null; author: string;
  season: number; ups: number; downs: number; status: 'open' | 'checked'; note: string | null; at: string;
  mine?: 1 | -1 | null; own?: boolean; reports?: number | null;
}
export interface CallChoice { choice: string; n: number; name: string | null; team: string | null; pos: string | null }
export interface CallSplit { total: number; choices: CallChoice[] }
export interface FanPulse {
  league?: string; club: string; season: number; at: string; people: number; calls: Record<string, CallSplit>; counts: Partial<Record<FanKind, number>>;
  week: number; top: Partial<Record<FanKind, FanPost[]>>; contributors: { author: string; posts: number; score: number }[];
  mine: Record<string, string> | null;
}
export interface FanMe { name: string; given: string | null; club: string | null; league?: string | null; posts: number; score: number; calls: number; admin: boolean }
export type FanIndex = Record<string, { people: number; posts: number; week: number; last: string | null; top: { id: number; kind: FanKind; title: string; score: number } | null }>;
// nhl-hub's fan-league task: the award calls' names and every club's line in the table
export interface FanLeague {
  season: number;
  skaters: { id: number; name: string; team: string | null; pos: string; gp: number; g: number; a: number; pts: number; pm: number }[];
  defence: FanLeague['skaters'];
  goalies: { id: number; name: string; team: string | null; gp: number; w: number; svp: number | null; gaa: number | null; so: number }[];
  table: { abbrev: string; name: string; gp: number; w: number; l: number; otl: number; pts: number; div: string; divRank: number; leagueRank: number; l10: string; streak: string }[];
}

// true inside the fan zones' own frame (PublicFans.tsx), which has its own club picker in the header
export const PublicFrame = createContext(false);

const rpc = async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};

export type Sort = 'hot' | 'top' | 'new';
export const fanBoard = (club: string, kind: FanKind | null, sort: Sort = 'hot', limit = 30, offset = 0, league = 'nhl') =>
  rpc<FanPost[]>('fan_board', { p_club: club, p_kind: kind, p_sort: sort, p_limit: limit, p_offset: offset, p_league: league });
export const fanPulse = (club: string, season?: number, league = 'nhl') => rpc<FanPulse>('fan_pulse', { p_club: club, p_league: league, ...(season ? { p_season: season } : {}) });
export const fanIndex = (league = 'nhl') => rpc<FanIndex>('fan_index', { p_league: league });
export const fanLeaguesIndex = () => rpc<Record<string, { people: number; posts: number; week: number; clubs: number }>>('fan_leagues_index');
export const fanExport = (club: string, league = 'nhl') => rpc<{ club: string; pulse: FanPulse; posts: FanPost[] }>('fan_export', { p_club: club, p_league: league });
export const fanSetMe = (name: string, club?: string | null, league = 'nhl') => rpc<FanMe>('fan_set_me', { p_name: name, p_club: club ?? null, p_league: league });
export const fanPost = (p: { club: string; kind: FanKind; topic: string; title: string; body: string; source: string | null; league?: string }) =>
  rpc<number>('fan_post', { p_club: p.club, p_kind: p.kind, p_topic: p.topic, p_title: p.title, p_body: p.body, p_source: p.source, p_league: p.league ?? 'nhl' });
export const fanVote = (id: number, value: -1 | 0 | 1) => rpc<{ id: number; ups: number; downs: number; mine: 1 | -1 | null }>('fan_vote', { p_post: id, p_value: value });
export const fanCall = (club: string, topic: string, choice: string | null, league = 'nhl') =>
  rpc<CallSplit & { topic: string; mine: string | null }>('fan_call', { p_club: club, p_topic: topic, p_choice: choice, p_league: league });
export const fanReport = (id: number) => rpc<'reported' | 'removed' | 'gone'>('fan_report', { p_post: id });
export const fanRemove = (id: number) => rpc<void>('fan_remove', { p_post: id });
export const fanModerate = (id: number, status: 'open' | 'checked', note: string | null) => rpc<void>('fan_moderate', { p_post: id, p_status: status, p_note: note });

// a fan's account from just a name (the join function's fan mode): made, then signed in on this phone for good
export async function fanJoin(name: string, club: string | null, league = 'nhl') {
  const { data, error } = await supabase.functions.invoke('join', { body: { fan: { name, club, league } } });
  if (error) {
    const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    throw new Error(body?.error ?? 'Couldn’t sign you up just now. Try again in a minute.');
  }
  setRemember(true);
  const { error: se } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password });
  if (se) throw new Error(se.message);
}

// who the caller is to the fan zones, read again whenever the sign-in changes
export function useFanMe() {
  const { session } = useLeague();
  const uid = session?.user?.id ?? null;
  const [me, setMe] = useState<FanMe | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!uid) { setMe(null); return; }
    let live = true;
    rpc<FanMe | null>('fan_me').then((m) => { if (live) setMe(m); }, () => {});
    return () => { live = false; };
  }, [uid, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { me, signedIn: !!uid, refresh };
}

// the fan zones' addresses to share: the app's own, through the Worker's preview pages (worker/fans.ts), so a link
// pasted into a chat shows the club, its pulse or the post
const APP = 'https://app.superpoolsai.com/';
// a zone's path in the app: the NHL's clubs at /fans/EDM (its board on the front page), every other league's at
// /fans/nfl/KC and its board at /fans/nfl; a pulse adds /pulse
export function zonePath(league: string, club?: string | null, page?: 'pulse') {
  const board = !club || club === league.toUpperCase();
  if (league === 'nhl') return board ? (page ? '/fans/NHL/pulse' : '/fans') : `/fans/${club}${page ? `/${page}` : ''}`;
  return `/fans/${league}${board ? '' : `/${club}`}${page ? `/${page}` : ''}`;
}
export const zoneLink = (league: string, club?: string | null, page?: 'pulse', post?: number) => `${APP}${zonePath(league, club, page).slice(1)}${post ? `?post=${post}` : ''}`;
export const fanLink = (club?: string, page?: 'pulse', post?: number) => zoneLink('nhl', club, page, post);
export const ABOUT_LINK = `${APP}fans/about`;
export const clubName = (club: string) => (club === 'NHL' ? 'The NHL' : CLUB_NAMES[club] ?? NHL_TEAMS[club] ?? club);

// ── the leagues and their clubs, as the fan zones draw them
export interface FanLeagueRow { key: string; name: string; sport: FanSport; sort: number }
export interface DirClub { code: string; name: string; short: string; logo: string | null; color: string | null; alt: string | null; conf: string | null; div: string | null }
export interface FanDir { league: string; name: string; sport: FanSport; board: string; clubs: DirClub[]; byCode: Record<string, DirClub> }
// the leagues the zones carry, in order (fan_leagues): read once
let leaguesP: Promise<FanLeagueRow[]> | null = null;
export const fanLeagues = () => (leaguesP ??= Promise.resolve(supabase.from('fan_leagues').select('key,name,sport,sort').eq('active', true).order('sort'))
  .then(({ data, error }) => { if (error) throw error; return (data ?? []) as FanLeagueRow[]; })
  .catch((e) => { leaguesP = null; throw e; }));
export function useFanLeagues() {
  const [rows, setRows] = useState<FanLeagueRow[] | null>(null);
  useEffect(() => { let live = true; fanLeagues().then((r) => { if (live) setRows(r); }, () => { if (live) setRows([]); }); return () => { live = false; }; }, []);
  return rows;
}
const dir = (league: string, name: string, sport: FanSport, clubs: DirClub[]): FanDir => ({ league, name, sport, board: league.toUpperCase(), clubs, byCode: Object.fromEntries(clubs.map((c) => [c.code, c])) });
// the NHL's 32 from the site's own lists (their logos are the site's own); every other league's from fan_clubs
export const NHL_DIR = dir('nhl', 'NHL', 'hockey', Object.entries(NHL_TEAMS).filter(([k]) => k !== 'NHL').map(([code, short]) => ({ code, name: CLUB_NAMES[code] ?? short, short, logo: null, color: null, alt: null, conf: null, div: null }))
  .sort((a, b) => a.name.localeCompare(b.name)));
const dirs = new Map<string, Promise<FanDir>>([['nhl', Promise.resolve(NHL_DIR)]]);
export function fanDir(league: string): Promise<FanDir> {
  let p = dirs.get(league);
  if (!p) {
    p = Promise.all([fanLeagues(), Promise.resolve(supabase.from('fan_clubs').select('code,name,short,logo,color,alt_color,conference,division').eq('league', league).eq('active', true))])
      .then(([ls, { data, error }]) => {
        if (error) throw error;
        const row = ls.find((x) => x.key === league);
        if (!row) throw new Error('No such league');
        return dir(league, row.name, row.sport, ((data ?? []) as { code: string; name: string; short: string | null; logo: string | null; color: string | null; alt_color: string | null; conference: string | null; division: string | null }[])
          .map((c) => ({ code: c.code, name: c.name, short: c.short ?? c.code, logo: c.logo, color: c.color, alt: c.alt_color, conf: c.conference, div: c.division }))
          .sort((a, b) => a.name.localeCompare(b.name)));
      });
    p.catch(() => dirs.delete(league));
    dirs.set(league, p);
  }
  return p;
}
export function useFanDir(league: string) {
  const [d, setD] = useState<FanDir | null>(league === 'nhl' ? NHL_DIR : null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (league === 'nhl') { setD(NHL_DIR); return; }
    setD(null);
    fanDir(league).then((x) => { if (live) setD(x); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [league]);
  return { dir: d, failed };
}
// a club's name in its league, and the league's own board's ("The NFL")
export const dirName = (d: FanDir | null | undefined, code: string) => (!d ? code : code === d.board ? `The ${d.name}` : d.byCode[code]?.name ?? (d.league === 'nhl' ? clubName(code) : code));
// ESPN draws each logo twice: for a light ground (the default) and a dark one
export const darkLogo = (url: string | null | undefined) => (url && /\/teamlogos\/[a-z]+\/500\//.test(url) ? url.replace('/500/', '/500-dark/') : url ?? null);
// a sport's topics and calls
export const topicsFor = (sport: FanSport) => TOPICS_BY_SPORT[sport];
export const callsFor = (sport: FanSport, board: boolean): CallDef[] => (board ? LEAGUE_CALLS_BY_SPORT : CLUB_CALLS_BY_SPORT)[sport];

// a share: the phone's own sheet where there is one, else the link copied
export async function shareLink(url: string, title: string, text?: string): Promise<'shared' | 'copied' | 'none'> {
  try {
    if (navigator.share) { await navigator.share({ url, title, text }); return 'shared'; }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'none';
  }
  try { await navigator.clipboard.writeText(url); return 'copied'; } catch { return 'none'; }
}

// what strangers see of a name: a first name and an initial, as the database writes it (_lounge_name)
export const shownName = (n: string) => {
  const w = n.trim().split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1][0].toUpperCase()}.` : w[0] ?? '';
};

// a grade call's average as a letter (A 4 to F 0), with a plus or a minus a third of the way to the next
export function gradeAvg(s: CallSplit | undefined) {
  if (!s?.total) return null;
  const pts: Record<string, number> = { a: 4, b: 3, c: 2, d: 1, f: 0 };
  const v = s.choices.reduce((t, c) => t + (pts[c.choice] ?? 0) * c.n, 0) / s.total;
  const base = Math.round(v), off = v - base;
  const letter = ['F', 'D', 'C', 'B', 'A'][Math.max(0, Math.min(4, base))];
  return `${letter}${base > 0 && base < 4 ? (off >= 1 / 6 ? '+' : off <= -1 / 6 ? '−' : '') : base === 4 && off <= -1 / 6 ? '−' : ''}`;
}

// the words for a call's answer: a fixed answer's label, a club's name, or the player's name the database sent; a club's
// call and its league's board share keys ('mvp' is a club's player and the league's), so the board's are read on the board
export const QUESTION_AREA = Object.fromEntries(Object.entries(QUESTION_CALLS).map(([area, key]) => [key, area])) as Record<string, string>;
const defOf = (topic: string, sport: FanSport, board: boolean) => callsFor(sport, board).find((d) => d.key === topic) ?? callsFor(sport, !board).find((d) => d.key === topic);
export function callLabel(topic: string, choice: string, name?: string | null, sport: FanSport = 'hockey', board = false, d?: FanDir | null) {
  if (topic.startsWith('q-')) return VERDICTS.find((x) => x[0] === choice)?.[1] ?? choice;
  const def = defOf(topic, sport, board);
  if (def?.choices) return def.choices.find((x) => x[0] === choice)?.[1] ?? choice;
  if (def?.kind === 'club') return sport === 'hockey' ? NHL_TEAMS[choice] ?? choice : d?.byCode[choice]?.name ?? name ?? choice;
  return name ?? `Player ${choice}`;
}
export const callTitle = (topic: string, sport: FanSport = 'hockey', board = false) => (topic.startsWith('q-') ? QUESTION_AREA[topic] ?? topic : defOf(topic, sport, board)?.title ?? topic);

// a call's split as percentages, the biggest first
export const shares = (s: CallSplit | undefined) => (s?.choices ?? []).map((c) => ({ ...c, pct: s!.total ? c.n / s!.total : 0 }));

// the pulse as rows for a spreadsheet: one row per answer of every call, then the top posts
export function pulseCsv(p: FanPulse, label: (topic: string, choice: string) => string) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['section', 'question', 'answer', 'fans', 'share'].map(q).join(',')];
  for (const [topic, s] of Object.entries(p.calls)) {
    for (const c of s.choices) rows.push([q('call'), q(topic), q(label(topic, c.choice)), c.n, (s.total ? c.n / s.total : 0).toFixed(3)].join(','));
  }
  for (const [kind, posts] of Object.entries(p.top)) {
    for (const x of posts ?? []) rows.push([q(kind), q(x.title), q(x.author), x.ups - x.downs, ''].join(','));
  }
  return rows.join('\n');
}

export function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
