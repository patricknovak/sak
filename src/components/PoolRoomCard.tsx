// The pool's live room on its home page (lib/poolRoom): today's games on the pool's events with their live scores,
// who's watching, and the day's swings: a game starting, a score, a final, a member climbing the table. Shown only
// once the room is live and the day has something in it. A box pool's games are the NHL's own, shown by their logos.
import { useEffect, useMemo, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { useLeague } from '../lib/store';
import type { Cheer, PoolClub, PoolFixture, PoolRoom } from '../lib/poolRoom';
import { fmtTime, ordinal } from '../lib/format';
import { NhlLogo, TeamBadge } from './ui';
import { fixtureThread, threadOf, ThreadSheet, useChannelCounts } from './GameThread';

const LIVE = (s: string) => s === 'live';
const DONE = (s: string) => ['final', 'postponed', 'cancelled', 'abandoned'].includes(s);

// a club: its colour and short name from the pool's events, or an NHL club (the box pool) by its abbreviation and logo
function Club({ c, abbr }: { c?: PoolClub; abbr?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-slate-100">
      {abbr ? <NhlLogo abbr={abbr} size={14} /> : <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: c?.color ?? '#475569' }} />}
      {abbr ?? c?.short ?? c?.name ?? '–'}
    </span>
  );
}
const side = (f: PoolFixture, clubs: Map<number, PoolClub>, home: boolean) => {
  const id = home ? f.home_club : f.away_club;
  return { c: id != null ? clubs.get(id) : undefined, abbr: home ? f.home_abbr : f.away_abbr };
};

// a game's thread: an NHL game (the box pool's) by its NHL id, a match on the shared fixtures in its own namespace
export const poolThread = (f: Pick<PoolFixture, 'id' | 'home_abbr'>) => (f.home_abbr ? threadOf(f.id) : fixtureThread(f.id));

function GameChip({ f, clubs, talk, onOpen }: { f: PoolFixture; clubs: Map<number, PoolClub>; talk: number; onOpen: () => void }) {
  const live = LIVE(f.state), done = DONE(f.state);
  return (
    <button type="button" onClick={onOpen} title="Open this game's thread" className={`w-[9.5rem] shrink-0 rounded-2xl border p-2.5 text-left transition active:scale-[.98] ${live ? 'border-goal/40 bg-goal/[.07]' : 'border-white/[.07] bg-white/[.03] hover:bg-white/[.05]'}`}>
      <div className={`mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>
        {live && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal" />}
        <span className="min-w-0 flex-1 truncate">{live ? f.minute || 'Live' : done ? (f.state === 'final' ? 'Final' : f.state) : fmtTime(f.kickoff)}</span>
        <span className={`inline-flex shrink-0 items-center gap-0.5 normal-case tracking-normal ${talk ? 'text-sky-300' : 'text-mute/70'}`}><MessageCircle size={10} />{talk || ''}</span>
      </div>
      {([[false, f.away_score], [true, f.home_score]] as const).map(([home, sc]) => (
        <div key={String(home)} className="flex items-center justify-between py-0.5 text-sm"><Club {...side(f, clubs, home)} /><span className="num font-bold">{sc ?? ''}</span></div>
      ))}
    </button>
  );
}

// the score above a game's thread
function ThreadHead({ f, clubs }: { f: PoolFixture; clubs: Map<number, PoolClub> }) {
  const live = LIVE(f.state), done = DONE(f.state);
  return (
    <div className={`flex items-center gap-3 rounded-2xl p-3 ring-1 ${live ? 'bg-goal/[.08] ring-goal/30' : 'bg-white/[.04] ring-white/[.06]'}`}>
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        {([[false, f.away_score], [true, f.home_score]] as const).map(([home, sc]) => (
          <div key={String(home)} className="flex items-center justify-between gap-2"><Club {...side(f, clubs, home)} /><span className="num text-lg font-black">{sc ?? ''}</span></div>
        ))}
      </div>
      <span className={`shrink-0 text-[11px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live ? f.minute || 'Live' : done ? (f.state === 'final' ? 'Final' : f.state) : fmtTime(f.kickoff)}</span>
    </div>
  );
}

// your pick just scored: the side you're on in a game (your pick'em pick, your last-one-standing club) scores, and the
// pool says so over the page like the league's goal horn; a tap opens the game's thread, seven seconds and it goes
function CheerAlert({ cheer, f, clubs, onOpen, onDone }: { cheer: Cheer; f: PoolFixture; clubs: Map<number, PoolClub>; onOpen: () => void; onDone: () => void }) {
  useEffect(() => { const t = window.setTimeout(onDone, 7000); return () => window.clearTimeout(t); }, [cheer.id, onDone]);
  const mine = side(f, clubs, cheer.side === 'H'), them = side(f, clubs, cheer.side !== 'H');
  const [a, h] = [f.away_score ?? 0, f.home_score ?? 0];
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[61] flex justify-center p-3 pt-safe">
      <button type="button" onClick={() => { onDone(); onOpen(); }}
        className="animate-slideup pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-goal/40 bg-[#0b1426]/90 px-3.5 py-2.5 text-left shadow-2xl shadow-black/50 backdrop-blur-xl">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-goal/25" />
          {mine.abbr ? <NhlLogo abbr={mine.abbr} size={34} /> : <span className="h-8 w-8 rounded-full ring-2 ring-white/20" style={{ background: mine.c?.color ?? '#475569' }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold uppercase tracking-[.14em] text-goal">🚨 Your pick just scored</span>
          <span className="block break-words text-sm font-bold leading-tight text-white">{mine.c?.name ?? mine.abbr ?? 'Your side'}</span>
          <span className="block text-[11px] text-mute">against {them.c?.short ?? them.c?.name ?? them.abbr ?? 'them'} · tap for the thread</span>
        </span>
        <span className="num shrink-0 rounded-xl bg-goal/15 px-2 py-1 font-display text-lg font-extrabold text-goal">{cheer.side === 'H' ? `${h}–${a}` : `${a}–${h}`}</span>
      </button>
    </div>
  );
}

export function PoolRoomCard({ room }: { room: PoolRoom }) {
  const { team, me } = useLeague();
  const [open, setOpen] = useState<number | null>(null);
  const counts = useChannelCounts(useMemo(() => room.fixtures.map(poolThread), [room.fixtures]));
  if (!room.live || (!room.fixtures.length && !room.swings.length)) return null;
  const at = room.fixtures.find((f) => f.id === open);
  const fx = new Map(room.fixtures.map((f) => [f.id, f]));
  const watching = room.watching.map((id) => team(id)).filter(Boolean);
  const feed = room.swings.slice().reverse().slice(0, 6);
  const anyLive = room.fixtures.some((f) => LIVE(f.state));
  const cheered = room.cheer ? fx.get(room.cheer.fixture) : undefined;
  return (
    <section className="card overflow-hidden" aria-label="Live room">
      {room.cheer && cheered && room.clearCheer && <CheerAlert cheer={room.cheer} f={cheered} clubs={room.clubs} onOpen={() => setOpen(cheered.id)} onDone={room.clearCheer} />}
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
      {room.fixtures.length > 0 && <div className="scroll-x flex gap-2 px-3 py-3">{room.fixtures.map((f) => <GameChip key={f.id} f={f} clubs={room.clubs} talk={counts.get(poolThread(f)) ?? 0} onOpen={() => setOpen(f.id)} />)}</div>}
      <ThreadSheet channel={at ? poolThread(at) : null} onClose={() => setOpen(null)} title={at ? `${side(at, room.clubs, false).abbr ?? side(at, room.clubs, false).c?.short ?? ''} v ${side(at, room.clubs, true).abbr ?? side(at, room.clubs, true).c?.short ?? ''}` : ''} head={at && <ThreadHead f={at} clubs={room.clubs} />} />
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
              <li key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-white/[.03]" onClick={() => setOpen(f.id)} title="Open this game's thread">
                <span className="w-12 shrink-0 text-[10px] font-bold uppercase tracking-wider text-mute">{done ? 'Final' : a == null ? 'Start' : 'Score'}</span>
                <span className="min-w-0 flex-1">
                  <span className="inline-flex flex-wrap items-center gap-1.5"><Club {...side(f, room.clubs, false)} /><span className="num font-extrabold text-white">{a ?? ''}</span><span className="text-mute">–</span><span className="num font-extrabold text-white">{h ?? ''}</span><Club {...side(f, room.clubs, true)} /></span>
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
