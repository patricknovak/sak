// Home: the GM's watch list at a glance. Who's free to pick up (first), who plays tonight, who's hurt, and whose roster
// the rest are on, so a starred free agent with a game tonight is one tap from the Players page.
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { useWatchlist } from '../lib/watchlist';
import { PlayerRow, usePlayerSheet } from './PlayerCard';
import { Section, TeamBadge } from './ui';
import { More } from './HomeCards';

const SHOW = 5;

export function WatchCard() {
  const { players, owner, team, gamesByTeam, league } = useLeague();
  const watch = useWatchlist();
  const { open } = usePlayerSheet();
  if (!watch.on || !watch.loaded || !watch.ids.size) return null;
  const rows = [...watch.ids].map((id) => players.get(id)).filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({ p, own: owner.get(p.id), tonight: !!gamesByTeam(p.nhl_team) }))
    // free agents first, then tonight's games, then the best projected
    .sort((a, b) => Number(!!a.own) - Number(!!b.own) || Number(b.tonight) - Number(a.tonight) || b.p.proj - a.p.proj);
  if (!rows.length) return null;
  const free = rows.filter((r) => !r.own).length;
  const season = league?.phase === 'season';
  return (
    <Section title="⭐ Your watch list" right={<More to="/players?who=watch" label={rows.length > SHOW ? `All ${rows.length}` : 'Players'} />}>
      <div className="card divide-y divide-white/[.06] overflow-hidden">
        {free > 0 && season && (
          <Link to="/players?who=watch" className="block px-3 py-2 text-xs font-semibold text-emerald-300" style={{ background: 'linear-gradient(90deg, rgba(16,185,129,.12), transparent)' }}>
            {free === 1 ? '1 player you’re watching is a free agent' : `${free} players you’re watching are free agents`}
          </Link>
        )}
        {rows.slice(0, SHOW).map(({ p, own }) => {
          const t = own ? team(own.team_id) : undefined;
          return (
            <div key={p.id} className="px-3 py-2">
              <PlayerRow p={p} onClick={() => open(p.id)} right={own
                ? <div className="flex shrink-0 flex-col items-center gap-0.5"><TeamBadge team={t} size={22} /><span className="max-w-[64px] truncate text-[10px] text-mute">{t?.gm_name ?? ''}</span></div>
                : <span className="chip shrink-0 bg-emerald-500/15 text-emerald-300">Free</span>} />
            </div>
          );
        })}
      </div>
    </Section>
  );
}
