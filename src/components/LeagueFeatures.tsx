import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useBrand } from '../lib/brand';
import { hasFeature, liveRoomOn, type Feature } from '../lib/features';
import { useAction } from './ui';

// commissioner: what the league keeps on the site beyond the game. Each is optional; turning one off hides it and
// keeps everything already recorded, so turning it back on picks up where it left off. The live room starts on.
// `only` shows some of them (a pool's Host page has no money, fund or live room: only the page counts)
export function LeagueFeatures({ only }: { only?: string[] } = {}) {
  const { league, refresh } = useLeague();
  const brand = useBrand();
  const { busy, run } = useAction();
  const rows: { k: Feature | 'live_room' | 'usage'; title: string; blurb: string }[] = [
    { k: 'money', title: 'League money', blurb: 'Entry fees, the prize pots, payouts and who owes what, for everyone to see.' },
    { k: 'fund', title: `The ${brand.fund}`, blurb: 'Money held for the league (cash, or shares priced each weekday), shared equally by the GMs.' },
    { k: 'live_room', title: 'The live room', blurb: 'On game nights, the home page and the scoreboard show who\'s watching, the night\'s swings and the league\'s reactions.' },
    { k: 'usage', title: 'Count which pages get opened', blurb: 'A daily count of opens per page, with no names, so the busiest pages get the work. Off, nothing is counted.' },
  ];
  return (
    <div className="card divide-y divide-white/[.06]">
      {rows.filter((r) => !only || only.includes(r.k)).map((r) => {
        const on = r.k === 'live_room' ? liveRoomOn(league) : r.k === 'usage' ? league?.features?.usage !== false : hasFeature(league, r.k);
        return (
          <label key={r.k} className="flex items-start gap-3 px-3 py-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-sky-400" checked={on} disabled={busy}
              onChange={(e) => run(async () => {
                await rpc('commish_update_league', { p: { features: { [r.k]: e.target.checked } } });
                await refresh(['league']);
              }, e.target.checked ? `${r.title} is on` : `${r.title} is off`)} />
            <span className="min-w-0"><span className="block font-semibold">{r.title}</span><span className="block text-xs text-mute">{r.blurb}</span></span>
          </label>
        );
      })}
      {!only && <p className="px-3 py-2 text-[11px] text-mute">Turning one off hides it from the league and keeps what's already recorded.</p>}
    </div>
  );
}
