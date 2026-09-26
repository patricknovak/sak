// Client for the yahoo edge function: a GM's other Yahoo Fantasy Hockey leagues, run from inside SaK.
import { supabase } from './supabase';

export async function yahoo<T>(task: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('yahoo', { body: { task, ...body } });
  if (error) {
    // the function answers non-2xx with {error}; surface that message instead of "non-2xx status code"
    const ctx = (error as { context?: Response }).context;
    let msg = error.message;
    try { const j = await ctx?.clone().json(); if (j?.error) msg = j.error; } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export interface YStatus { configured: boolean; connected: boolean; guid: string | null; since: string | null; redirect: string }
export interface YTeam {
  key: string; id: number | null; name: string; url: string | null; logo: string | null; managers: string[]; mine: boolean; commissioner: boolean; commishNames: string[];
  waiver: number | null; faab: number | null; moves: number | null; trades: number | null; clinched: boolean;
  rank: number | null; seed: number | null; w: number | null; l: number | null; t: number | null; pct: number | null; pf: number | null; pa: number | null;
  points: number | null; projected: number | null;
}
export interface YLeague {
  key: string; id: string; name: string; url: string | null; logo: string | null; season: string; teams: number | null; week: number | null; startWeek: number | null; endWeek: number | null;
  scoring: string; draft: string; finished: boolean; type: string; updated: string | null; felo: string | null; me: YTeam | null;
}
export interface YPosition { pos: string; type: string | null; count: number; starting: boolean }
export interface YSettings {
  draftType: string; scoring: string; faab: boolean; playoffs: boolean; playoffStart: number | null; playoffTeams: number | null; tradeEnd: string | null; tradeRatify: string | null; tradeRejectTime: number | null;
  waiverType: string | null; waiverRule: string | null; waiverTime: number | null; weeklyDeadline: string | null; maxAdds: number | null; maxTrades: number | null;
  positions: YPosition[]; stats: { id: number | null; name: string; full: string; type: string; displayOnly: boolean }[];
}
export interface YMatchup { week: number | null; start: string | null; end: string | null; status: string; playoffs: boolean; consolation: boolean; tied: boolean; winner: string | null; teams: YTeam[]; cats: { stat: number | null; winner: string | null; tied: boolean }[] }
export interface YLeagueDetail extends YLeague { settings: YSettings; teams: number | null; me: YTeam | null; matchups: YMatchup[] | null }
export type YLeagueFull = Omit<YLeagueDetail, 'teams'> & { teams: YTeam[] };
export interface YPlayer {
  key: string; id: number | null; name: string; first: string; last: string; team: string; teamName: string; num: string | null; pos: string; type: string; elig: string[];
  headshot: string | null; status: string | null; statusFull: string | null; injury: string | null; undroppable: boolean; slot: string | null; editable: boolean | null;
  owner: { type: string; teamKey: string | null; teamName: string | null; waiverDate: string | null } | null; owned: number | null; ownedDelta: number | null;
}
export interface YRoster { team: YTeam; coverage: string; date: string | null; week: number | null; editable: boolean | null; players: YPlayer[] }
export interface YTxPlayer extends YPlayer { move: string; fromType: string | null; from: string | null; fromKey: string | null; toType: string | null; to: string | null; toKey: string | null }
export interface YTransaction { key: string; id: string; type: string; status: string; at: string | null; trader: { key: string; name: string } | null; tradee: { key: string; name: string } | null; note: string | null; faab: number | null; players: YTxPlayer[] }
export interface YTransactions { recent: YTransaction[]; pending: YTransaction[]; waivers: YTransaction[] }

export const leagueOf = (teamKey: string) => teamKey.replace(/\.t\.\d+$/, '');
export const SCORING: Record<string, string> = { head: 'Head-to-head', headone: 'H2H one win', headpoint: 'H2H points', point: 'Points', roto: 'Rotisserie' };
export const BENCH = ['BN', 'IR', 'IR+', 'NA'];

// Yahoo's team abbreviations where they differ from the NHL's
const ABBR: Record<string, string> = { TB: 'TBL', NJ: 'NJD', LA: 'LAK', SJ: 'SJS', WAS: 'WSH', MON: 'MTL', CLS: 'CBJ', NAS: 'NSH', ANA: 'ANA', ARI: 'ARI', UTA: 'UTA', WPG: 'WPG', VGK: 'VGK', SEA: 'SEA' };
export const nhlAbbr = (y: string) => ABBR[y.toUpperCase()] ?? y.toUpperCase();

// ───────────── finishing a Yahoo sign-in ─────────────
// Yahoo sends the GM back to the site root with ?code=…&state=…; we post those to the function, then clean the URL.
export function yahooReturn() {
  const q = new URLSearchParams(window.location.search);
  const code = q.get('code'), state = q.get('state');
  if (!code || !state) return null;
  return { code, state };
}
export function clearYahooReturn() {
  window.history.replaceState(null, '', window.location.pathname + window.location.hash);
}
