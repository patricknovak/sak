// The pool's live room on its home page (lib/poolRoom): today's games on the pool's events with their live scores,
// who's watching, and the day's swings: a game starting, a score, a final, a member climbing the table. Shown only
// once the room is live and the day has something in it.
import { useLeague } from '../lib/store';
import type { PoolClub, PoolFixture, PoolRoom } from '../lib/poolRoom';
import { fmtTime, ordinal } from '../lib/format';
import { TeamBadge } from './ui';

const LIVE = (s: string) => s === 'live';
const DONE = (s: string) => ['final', 'postponed', 'cancelled', 'abandoned'].includes(s);

function Club({ c }: { c?: PoolClub }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: c?.color ?? '#475569' }} />
      {c?.short ?? c?.name ?? '–'}
    </span>
  );
}

function GameChip({ f, clubs }: { f: PoolFixture; clubs: Map<number, PoolClub> }) {
  const live = LIVE(f.state), done = DONE(f.state);
  return (
    <div className={`w-[9.5rem] shrink-0 rounded-2xl border p-2.5 ${live ? 'border-goal/40 bg-goal/[.07]' : 'border-white/[.07] bg-white/[.03]'}`}>
      <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>
        {live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}
        {live ? f.minute || 'Live' : done ? (f.state === 'final' ? 'Final' : f.state) : fmtTime(f.kickoff)}
      </div>
      {([[f.away_club, f.away_score], [f.home_club, f.home_score]] as const).map(([id, sc]) => (
        <div key={id} className="flex items-center justify-between py-0.5 text-sm"><Club c={clubs.get(id)} /><span className="num font-bold">{sc ?? ''}</span></div>
      ))}
    </div>
  );
}

export function PoolRoomCard({ room }: { room: PoolRoom }) {
  const { team, me } = useLeague();
  if (!room.live || (!room.fixtures.length && !room.swings.length)) return null;
  const fx = new Map(room.fixtures.map((f) => [f.id, f]));
  const watching = room.watching.map((id) => team(id)).filter(Boolean);
  const feed = room.swings.slice().reverse().slice(0, 6);
  const anyLive = room.fixtures.some((f) => LIVE(f.state));
  return (
    <section className="card overflow-hidden" aria-label="Live room">
      <div className="flex items-center gap-3 border-b border-white/[.06] bg-gradient-to-r from-goal/[.10] via-transparent to-transparent px-3 py-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {anyLive && <span className="absolute inset-0 animate-ping rounded-full bg-goal/60" />}
          <span className={`relative h-2.5 w-2.5 rounded-full ${anyLive ? 'bg-goal' : 'bg-gold'}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-extrabold uppercase leading-none tracking-wide">Live room</div>
          <div className="mt-1 text-[11px] leading-tight text-mute">{anyLive ? 'Every score and every climb, as it lands' : `${room.fixtures.length} game${room.fixtures.length === 1 ? '' : 's'} today on your pool's events`}</div>
        </div>
        {watching.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5" title={watching.map((t) => t!.gm_name).join(', ')}>
            <div className="flex -space-x-2">{watching.slice(0, 5).map((t) => <span key={t!.id} className="rounded-full ring-2 ring-[#0d1628]"><TeamBadge team={t} size={22} /></span>)}</div>
            <span className="num text-[11px] font-semibold text-slate-200">{watching.length}<span className="font-normal text-mute"> watching</span></span>
          </div>
        )}
      </div>
      {room.fixtures.length > 0 && <div className="scroll-x flex gap-2 px-3 py-3">{room.fixtures.map((f) => <GameChip key={f.id} f={f} clubs={room.clubs} />)}</div>}
      {feed.length > 0 && (
        <ul className="divide-y divide-white/[.05] border-t border-white/[.06]">
          {feed.map((s) => {
            if (s.kind === 't') {
              const t = team(s.team);
              return (
                <li key={s.id} className={`flex items-center gap-2.5 px-3 py-2 text-sm ${s.team === me?.id ? 'bg-sky-400/[.06]' : ''}`}>
                  <TeamBadge team={t} size={26} />
                  <span className="min-w-0 flex-1 leading-tight"><b className="text-slate-100">{t?.gm_name ?? 'A member'}</b> <span className="text-slate-300">climbs to {ordinal(s.to!)}</span><span className="block text-[11px] text-mute">{s.title} · {fmtTime(s.at)}</span></span>
                  <span className="num shrink-0 rounded-lg bg-emerald-400/15 px-1.5 py-0.5 text-xs font-extrabold text-emerald-300">▲ {s.from! - s.to!}</span>
                </li>
              );
            }
            const f = fx.get(s.fixture!);
            if (!f) return null;
            const [a, h] = s.score ?? [null, null];
            const done = DONE(s.state ?? '');
            return (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                <span className="w-12 shrink-0 text-[10px] font-bold uppercase tracking-wider text-mute">{done ? 'Final' : a == null ? 'Start' : 'Score'}</span>
                <span className="min-w-0 flex-1">
                  <span className="inline-flex flex-wrap items-center gap-1.5"><Club c={room.clubs.get(f.away_club)} /><span className="num font-extrabold text-white">{a ?? ''}</span><span className="text-mute">–</span><span className="num font-extrabold text-white">{h ?? ''}</span><Club c={room.clubs.get(f.home_club)} /></span>
                  <span className="block text-[11px] text-mute">{s.minute ? `${s.minute} · ` : ''}{fmtTime(s.at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
