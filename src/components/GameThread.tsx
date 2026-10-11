// A thread for every game (docs/DEVELOPMENT.md §8.3, E4): the league's chat about one NHL game, beside its score. It is
// an ordinary chat channel, 'game:<game id>', so it keeps its history, takes reactions and mentions, and is read and
// written under the chat rules every other channel follows; the merged chat feed and the chat tab's badge leave it out,
// and the scoreboard's game chips carry its count and its unread dot instead. Above the chat: who in the league has a
// player in the game and what he has tonight, and the live room's swings for this game.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLeague } from '../lib/store';
import { supabase, realtimeChannel } from '../lib/supabase';
import { swingWords, useLiveRoom } from '../lib/liveRoom';
import { fmtPts, fmtTime } from '../lib/format';
import { Sheet, TeamBadge } from './ui';
import { ChatPanel } from './ChatPanel';
import type { Game } from '../lib/types';

export const threadOf = (gameId: number) => `game:${gameId}`;
// a pool's match on the shared fixtures (soccer, the NFL, baseball's postseason...): its own namespace beside the NHL's
// game ids, under the same 'game:' prefix so the chat feed and the badge leave it out the same way
export const fixtureThread = (fixtureId: number) => `game:fx${fixtureId}`;

// how many messages each of these threads holds, kept up to date as people post
export function useChannelCounts(channels: string[]) {
  const { league } = useLeague();
  const lid = league?.league_id ?? null;
  const key = channels.slice().sort().join(',');
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!channels.length) { setCounts(new Map()); return; }
    let alive = true;
    supabase.from('messages').select('channel').in('channel', channels).limit(2000).then(({ data }) => {
      if (!alive) return;
      const m = new Map<string, number>();
      for (const r of data ?? []) m.set(String(r.channel), (m.get(String(r.channel)) ?? 0) + 1);
      setCounts(m);
    });
    const wanted = new Set(channels);
    const ch = realtimeChannel('game-threads').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
      const n = p.new as { channel: string; league_id?: number | null };
      if (!wanted.has(n.channel) || (lid != null && n.league_id != null && n.league_id !== lid)) return;
      setCounts((c) => new Map(c).set(n.channel, (c.get(n.channel) ?? 0) + 1));
    }).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [key, lid]); // eslint-disable-line react-hooks/exhaustive-deps
  return counts;
}

// the same, by NHL game id
export function useThreadCounts(gameIds: number[]) {
  const counts = useChannelCounts(gameIds.map(threadOf));
  return useMemo(() => new Map(gameIds.map((id) => [id, counts.get(threadOf(id)) ?? 0] as [number, number]).filter(([, n]) => n > 0)), [counts, gameIds.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
}

// a game's thread on its own, in a sheet: what a pool opens from its live room and its match centre
export function ThreadSheet({ channel, title, head, onClose }: { channel: string | null; title: ReactNode; head?: ReactNode; onClose: () => void }) {
  return (
    <Sheet open={!!channel} onClose={onClose} title={title}>
      {channel && (
        <div className="flex flex-col gap-3">
          {head}
          <div className="card flex h-[56dvh] min-h-[320px] flex-col overflow-hidden">
            <div className="border-b border-line px-3 py-2 text-sm font-semibold">💬 The pool’s thread for this game</div>
            <ChatPanel channel={channel} compact className="flex-1" />
          </div>
        </div>
      )}
    </Sheet>
  );
}

type Line = { player_id: number; fpts: number };

// the league's starters in this game, each with his GM and what he has tonight, the best night first
export function LeagueInGame({ lines }: { lines: Line[] | null }) {
  const { owner, team, players, me } = useLeague();
  const ours = useMemo(() => (lines ?? [])
    .map((l) => ({ ...l, r: owner.get(l.player_id), p: players.get(l.player_id) }))
    .filter((x) => x.r && x.r.slot !== 'BN' && x.r.slot !== 'IR')
    .sort((a, b) => b.fpts - a.fpts), [lines, owner, players]);
  if (!ours.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-mute">Your league in this game</div>
      <div className="scroll-x flex gap-1.5 pb-0.5">
        {ours.map((x) => {
          const t = team(x.r!.team_id);
          return (
            <span key={x.player_id} className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-xs ${t?.id === me?.id ? 'border-sky-400/40 bg-sky-400/10' : 'border-white/10 bg-white/[.04]'}`}>
              <TeamBadge team={t} size={20} />
              <span className="font-semibold text-slate-100">{x.p?.last_name ?? x.p?.name ?? `#${x.player_id}`}</span>
              <span className={`num font-bold ${x.fpts > 0 ? 'text-emerald-300' : x.fpts < 0 ? 'text-red-300' : 'text-mute'}`}>{fmtPts(x.fpts)}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// the live room's swings in this game: every point a starter scored, newest first
export function GameSwings({ gameId }: { gameId: number }) {
  const { team, players } = useLeague();
  const room = useLiveRoom();
  const swings = useMemo(() => room.swings.filter((s) => s.game === gameId && s.kind === 'p' && !s.early).slice(-4).reverse(), [room.swings, gameId]);
  if (!swings.length) return null;
  return (
    <div className="rounded-2xl border border-goal/25 bg-goal/[.05] px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-goal"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-goal" />Swings in this game</div>
      {swings.map((s) => {
        const w = swingWords(s.what);
        return (
          <div key={s.id} className="flex items-center gap-2 py-0.5 text-xs">
            <TeamBadge team={team(s.team)} size={18} />
            <span className="min-w-0 flex-1 truncate"><span className="font-semibold text-slate-100">{players.get(s.player!)?.last_name ?? 'Player'}</span> <span className="text-mute">{w.head.toLowerCase()} · {fmtTime(s.at)}</span></span>
            <span className={`num font-bold ${(s.d ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{(s.d ?? 0) >= 0 ? '+' : ''}{fmtPts(s.d)}</span>
          </div>
        );
      })}
    </div>
  );
}

// the thread itself; above it (unless the sheet shows them on its Game tab) the league's players in the game and its swings
export function GameThread({ game, lines, chatOnly }: { game: Pick<Game, 'id'>; lines: Line[] | null; chatOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {!chatOnly && <LeagueInGame lines={lines} />}
      {!chatOnly && <GameSwings gameId={game.id} />}
      <div className="card flex h-[52dvh] min-h-[320px] flex-col overflow-hidden">
        <div className="border-b border-line px-3 py-2 text-sm font-semibold">💬 The league’s thread for this game</div>
        <ChatPanel channel={threadOf(game.id)} compact className="flex-1" />
      </div>
    </div>
  );
}
