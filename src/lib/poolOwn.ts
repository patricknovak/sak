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
