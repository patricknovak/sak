import { useLeague } from '../lib/store';
import { RosterImport, type RosterSource } from './RosterImport';
import type { ImportTeam } from '../lib/rosterMatch';

// ESPN's fantasy API (the one its history comes in through) answers any website for a league its manager made
// viewable to the public: the season's teams with their rosters (mRoster), and the NHL's clubs by ESPN's own ids so a
// player's club reads as its abbreviation. A private league answers 401, and is asked to open up first.
type EEntry = { lineupSlotId?: number; injuryStatus?: string; playerPoolEntry?: { player?: { fullName?: string; proTeamId?: number; injuryStatus?: string; injured?: boolean } } };
type ETeam = { id: number; name?: string; location?: string; nickname?: string; roster?: { entries?: EEntry[] } };
type ELeague = { seasonId?: number; settings?: { name?: string; proTeams?: { id: number; abbrev?: string }[] }; teams?: ETeam[] };

const API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl';
const idOf = (s: string) => (s.match(/leagueId=(\d+)/i)?.[1] ?? s.match(/^\s*(\d{3,12})\s*$/)?.[1] ?? null);

async function espn<T>(path: string): Promise<T | null> {
  const r = await fetch(`${API}/${path}`);
  if (r.status === 401 || r.status === 403) throw new Error('private');
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ESPN answered ${r.status}`);
  const b = await r.json();
  return (Array.isArray(b) ? b[0] : b) ?? null;
}

// ESPN names a season by the year it ends: 2026-27 is 2027
const source = (year: number): RosterSource => ({
  key: 'espn', mark: 'ESPN', title: 'ESPN', blurb: 'Every team’s players from the league’s link, for a league made viewable to the public.',
  sheet: 'Your rosters on ESPN', label: 'The league’s ESPN link or number (leagueId=… in the address)', placeholder: 'fantasy.espn.com/hockey/league?leagueId=…',
  foot: 'ESPN’s lineup slots don’t map onto ours one for one, so the first lineup sorts the starters.',
  read: async (link, match) => {
    const id = idOf(link);
    if (!id) throw new Error('link');
    const [l, pro] = await Promise.all([espn<ELeague>(`seasons/${year}/segments/0/leagues/${id}?view=mRoster&view=mTeam`), espn<ELeague>(`seasons/${year}?view=proTeamSchedules_wl`)]);
    if (!l?.teams) throw new Error('missing');
    const club = new Map((pro?.settings?.proTeams ?? []).map((t) => [t.id, t.abbrev?.toUpperCase() ?? null]));
    const teams: ImportTeam[] = l.teams.map((t) => ({
      id: String(t.id), name: (t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`).trim(),
      picks: (t.roster?.entries ?? []).map((e) => {
        const p = e.playerPoolEntry?.player;
        const name = p?.fullName?.trim() ?? '';
        const c = p?.proTeamId != null ? club.get(p.proTeamId) ?? null : null;
        return { name, club: c, ir: /INJURY_RESERVE|^IR$/i.test(e.injuryStatus ?? p?.injuryStatus ?? ''), player_id: name ? match(name, c) : null };
      }),
    }));
    return { name: l.settings?.name ?? 'ESPN league', note: null, teams };
  },
});

export function EspnRosters() {
  const { league } = useLeague();
  if (!league) return null;
  return <RosterImport source={source(Number(league.season.slice(0, 4)) + 1)} />;
}
