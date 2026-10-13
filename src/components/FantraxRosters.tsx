import { RosterImport, type RosterSource } from './RosterImport';
import type { ImportTeam } from '../lib/rosterMatch';

// Fantrax's public API (the one its history and scoring come in through) answers any website with each team's players
// for the current period and a map of its player ids to names and clubs; a player Fantrax no longer lists (retired,
// long out of the league) has an id and no name.
type FItem = { id: string; position?: string; status?: string };
type FRosters = { period?: number; rosters?: Record<string, { teamName?: string; rosterItems?: FItem[] }> };
type FPlayer = { name?: string; team?: string; position?: string };

const API = 'https://www.fantrax.com/fxea/general';
// a Fantrax league is a 16-character id, in its links as /league/<id>/ or leagueId=<id>
const idOf = (s: string) => (s.match(/(?:league\/|leagueId=)([a-z0-9]{16})\b/i) ?? s.match(/^\s*([a-z0-9]{16})\s*$/i))?.[1]?.toLowerCase() ?? null;
// Fantrax writes "Last, First"; ours is "First Last"
const firstLast = (n: string) => { const [last, first] = n.split(',').map((x) => x.trim()); return first ? `${first} ${last}` : n.trim(); };

async function fx<T>(call: string, q: string): Promise<T> {
  const r = await fetch(`${API}/${call}?${q}`);
  if (!r.ok) throw new Error(`Fantrax answered ${r.status}`);
  const b = await r.json();
  if (b?.error) throw new Error('missing');
  return b as T;
}

const fantrax: RosterSource = {
  key: 'fantrax', mark: 'FTX', title: 'Fantrax', blurb: 'Every team’s players from the league’s link, matched by name and club.',
  sheet: 'Your rosters on Fantrax', label: 'The league’s Fantrax link (it has /league/ and the league’s code in it)', placeholder: 'fantrax.com/fantasy/league/…/team/roster',
  foot: 'Fantrax counts forwards where we have centres and wings, so the first lineup sorts the starters.',
  read: async (link, match) => {
    const id = idOf(link);
    if (!id) throw new Error('link');
    const [info, ro, ids] = await Promise.all([
      fx<{ leagueName?: string }>('getLeagueInfo', `leagueId=${id}`), fx<FRosters>('getTeamRosters', `leagueId=${id}`), fx<Record<string, FPlayer>>('getPlayerIds', 'sport=NHL'),
    ]);
    if (!ro.rosters) throw new Error('missing');
    const teams: ImportTeam[] = Object.entries(ro.rosters).map(([tid, t]) => ({
      id: tid, name: (t.teamName ?? 'Team').trim(),
      picks: (t.rosterItems ?? []).map((it) => {
        const p = ids[it.id];
        const name = p?.name ? firstLast(p.name) : '';
        const club = p?.team ?? null;
        return { name, club, ir: /INJ/i.test(it.status ?? ''), player_id: name ? match(name, club) : null };
      }),
    }));
    return { name: info.leagueName ?? 'Fantrax league', note: ro.period ? `period ${ro.period}` : null, teams };
  },
};

export const FantraxRosters = () => <RosterImport source={fantrax} />;
