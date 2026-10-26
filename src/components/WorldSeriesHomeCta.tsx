// Seasonal CTA on the product sign-in home (app.superpoolsai.com): start a World Series prediction pool.
// Uses the same #/new?comp=mlb-post-2026 template as the marketing page; src=home-ws for cta_arrival.
import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import type { PoolEvent } from '../lib/poolGames';
import { WS_COMP, WS_HOME_CTA_HREF, WS_HOME_CTA_UNTIL, worldSeriesHomeCtaOpen } from '../lib/worldSeriesHome';

export { WS_COMP, WS_HOME_CTA_HREF, WS_HOME_CTA_UNTIL, worldSeriesHomeCtaOpen } from '../lib/worldSeriesHome';

export function WorldSeriesHomeCta() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Date.now() >= WS_HOME_CTA_UNTIL) { setOn(false); return; }
    let live = true;
    rpc<PoolEvent[]>('pool_event_list').then((list) => {
      if (!live) return;
      const e = (list ?? []).find((x) => x.competition === WS_COMP) ?? null;
      setOn(worldSeriesHomeCtaOpen(Date.now(), e));
    }, () => { if (live) setOn(false); });
    return () => { live = false; };
  }, []);
  if (!on) return null;
  return (
    <div className="mt-6">
      <a href={WS_HOME_CTA_HREF}
        className="btn-gold flex w-full items-center justify-center gap-2 py-3 text-base">
        Start a World Series pool
      </a>
      <p className="mt-2 text-center text-[11px] text-white/50">Play coins only · free, nothing to install</p>
    </div>
  );
}
