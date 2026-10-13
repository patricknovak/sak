import { useLeague } from '../lib/store';
import { yahoo, nhlAbbr, type YLeagueFull, type YRoster } from '../lib/yahoo';
import { RosterImport, type RosterSource } from './RosterImport';
import type { ImportTeam } from '../lib/rosterMatch';

// A league that played on Yahoo brings its rosters from the Yahoo league page (docs/SUPERPOOLS.md item 9, imports:
// rosters next): the GM is signed into Yahoo already, so there is no link to paste; the sheet reads every team's roster
// through the Yahoo function (one call a team) and matches each player to ours by name and club. Shown to the
// commissioner of the league they are in here, on a Yahoo league they are in there.
const source = (L: YLeagueFull): RosterSource => ({
  key: 'yahoo', mark: 'Y!', title: 'Yahoo', blurb: 'Every team’s players from this Yahoo league, matched by name and club.',
  sheet: `Rosters from ${L.name}`, label: `Every team in ${L.name} on Yahoo, with its players as Yahoo has them today.`, placeholder: '', noLink: true,
  foot: 'Yahoo’s lineup slots don’t map onto ours one for one, so the first lineup sorts the starters.',
  read: async (_link, match) => {
    const rosters = await Promise.all(L.teams.map((t) => yahoo<YRoster>('roster', { team_key: t.key }).catch(() => null)));
    const teams: ImportTeam[] = L.teams.map((t, i) => ({
      id: t.key, name: t.name.trim(),
      picks: (rosters[i]?.players ?? []).map((p) => {
        const club = p.team ? nhlAbbr(p.team) : null;
        return { name: p.name, club, ir: /^IR/i.test(p.slot ?? '') || /^IR/i.test(p.status ?? ''), player_id: p.name ? match(p.name, club) : null };
      }),
    }));
    if (rosters.every((r) => !r)) throw new Error('Yahoo gave no rosters back. Try again in a moment.');
    return { name: L.name, note: rosters[0]?.date ? `as of ${rosters[0].date}` : null, teams };
  },
});

export function YahooRosters({ L }: { L: YLeagueFull }) {
  const { me } = useLeague();
  if (!me?.is_commish || !L.teams?.length) return null;
  return <RosterImport source={source(L)} />;
}
