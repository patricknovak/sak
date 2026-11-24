// The events a prediction pool plays on (migration 242: pool_competitions): its games, its automatic prop sheets, the
// event its question pack rides with. A pool's pages keep to them: the centres' switcher, the host's desk, the sport
// centre a link opens. A pool that follows nothing yet sees every event, to choose from; outside a pool, nothing to
// keep to (null); undefined while the list loads.
import { useEffect, useState } from 'react';
import { rpc } from './supabase';
import { useLeague } from './store';

export interface OwnComp { id: string; name: string; short: string | null; sport: string; format: string; ext_id: string | null }

export function usePoolCompetitions(): OwnComp[] | null | undefined {
  const { kind, league } = useLeague();
  const [rows, setRows] = useState<OwnComp[] | null | undefined>(kind === 'predict' ? undefined : null);
  useEffect(() => {
    if (kind !== 'predict') { setRows(null); return; }
    setRows(undefined);
    rpc<OwnComp[]>('pool_competitions').then((r) => setRows(r ?? []), () => setRows([]));
  }, [kind, league?.league_id]);
  return rows;
}
// whether a pool's page shows this event: always outside a pool, and in a pool following nothing yet; not while the
// pool's list is still loading, so another sport's event never flashes up first
export const follows = (own: OwnComp[] | null | undefined, id: string) => own === null || (own !== undefined && (!own.length || own.some((c) => c.id === id)));

// A sport's postseason belongs to a pool that follows the sport (24 November 2026): a pool started on the NFL's weeks
// follows 'nfl', and the playoffs are another event ('nfl-post-2026') that joins the list the night the field is set.
// The host's desk used to keep it behind "A game on another event"; it is the pool's own next thing, so Add a game
// leads with it and the pool's home tells the host the night it opens (PlayoffsOpen). An event played in series has
// no word for its rounds ("Week", "Matchweek"), which is how the start page tells a postseason too.
export const playoffOf = (own: OwnComp[] | null | undefined, e: { competition: string; sport: string; word?: string | null }) =>
  Array.isArray(own) && own.length > 0 && !e.word && !own.some((c) => c.id === e.competition) && own.some((c) => c.sport === e.sport);
