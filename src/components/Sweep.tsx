// The sweepstake (migration 236): at the first game of its round, everyone in the pool is dealt clubs from the hat at
// random. No picks: whoever holds the champion wins it, and the table ranks players by how far their best club has
// gone. Before the draw the page shows the field and when the hat is drawn (the host can draw early); after it, your
// clubs first, then the whole field with who holds each club, the ones still in at the top.
import { Crown, Shuffle } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Crest } from './Crest';
import { Section, TeamBadge, useAction } from './ui';
import type { Club } from '../pages/Picks';

export interface SweepClub extends Club { won: number; alive: boolean; holders: number[] }
export interface SweepData {
  drawn: boolean; drawn_at: string | null; locks_at: string | null; round_label: string | null; players: number;
  mine: number[]; unheld: number[]; champion: number | null; field: SweepClub[];
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const roundsWord = (n: number) => (n === 0 ? 'Not through a round yet' : `Through ${n} ${n === 1 ? 'round' : 'rounds'}`);

export function SweepGame({ gameId, data, status, reload }: { gameId: number; data: SweepData; status: 'open' | 'done'; reload: () => void }) {
  const { teams, me } = useLeague();
  const { busy, run } = useAction();
  const mine = data.field.filter((c) => data.mine.includes(c.id));
  const name = (id: number) => teams.find((t) => t.id === id)?.gm_name ?? 'Someone';
  const draw = () => run(async () => { await rpc('pool_sweep_draw', { p_game: gameId }); reload(); }, 'The hat is drawn');

  return (
    <div className="space-y-4">
      {!data.drawn ? (
        <div className="card-hero relative overflow-hidden p-5 text-center">
          <div className="pointer-events-none absolute -left-8 -top-8 h-36 w-36 rounded-full bg-gold/15 blur-2xl" />
          <div className="relative">
            <div className="text-5xl">🎩</div>
            <div className="h-display mt-2 text-2xl text-white">The hat is full</div>
            <p className="mx-auto mt-1 max-w-xs text-sm text-slate-300">
              {data.field.length} clubs from the {data.round_label ?? 'round'} on, dealt at random to the {data.players} {data.players === 1 ? 'player' : 'players'} in the pool
              {data.locks_at ? ` at the first game, ${when(data.locks_at)}` : ''}. Nothing to pick: hold the champion and you win it.
            </p>
            {me?.is_commish && status === 'open' && (
              <button type="button" className="btn-gold mx-auto mt-4 inline-flex items-center gap-2" disabled={busy || data.players < 2} onClick={draw}>
                <Shuffle className="h-4 w-4" /> Draw the hat now
              </button>
            )}
          </div>
        </div>
      ) : mine.length > 0 ? (
        <Section title={mine.length === 1 ? 'You drew' : `You drew ${mine.length} clubs`}>
          <div className="grid gap-2">
            {mine.map((c) => (
              <div key={c.id} className={`card-hero flex items-center gap-3 p-4 ${c.alive ? '' : 'opacity-60'}`}>
                <Crest c={c} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="break-words text-lg font-black text-white">{c.name}</div>
                  <div className="text-xs text-mute">{data.champion === c.id ? 'Champions' : c.alive ? roundsWord(c.won) : `Out after ${c.won} ${c.won === 1 ? 'round' : 'rounds'}`}
                    {c.holders.length > 1 ? ` · shared with ${c.holders.filter((h) => h !== me?.id).map(name).join(', ')}` : ''}</div>
                </div>
                {data.champion === c.id ? <Crown className="h-6 w-6 shrink-0 text-gold" />
                  : <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${c.alive ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/[.06] text-mute'}`}>{c.alive ? 'Still in' : 'Out'}</span>}
              </div>
            ))}
          </div>
        </Section>
      ) : me?.role === 'gm' ? (
        <div className="card p-4 text-sm text-mute">The hat was drawn before you joined, so you hold no club this time. Cheer on someone else's.</div>
      ) : null}

      <Section title={data.drawn ? 'Who holds whom' : 'In the hat'}>
        <div className="card divide-y divide-white/[.05] p-1">
          {data.field.map((c) => (
            <div key={c.id} className={`flex items-center gap-3 px-3 py-2.5 ${c.alive ? '' : 'opacity-55'} ${data.mine.includes(c.id) ? 'rounded-xl bg-gold/[.06]' : ''}`}>
              <Crest c={c} size={30} />
              <div className="min-w-0 flex-1">
                <div className="break-words text-sm font-bold leading-tight text-white">{c.name}</div>
                <div className="text-[11px] text-mute">{data.champion === c.id ? 'Champions' : c.alive ? roundsWord(c.won) : 'Out'}</div>
              </div>
              {data.drawn && (c.holders.length ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="flex -space-x-2">{c.holders.slice(0, 4).map((h) => <TeamBadge key={h} team={teams.find((t) => t.id === h)} size={24} />)}</div>
                  <span className="text-right text-xs font-semibold leading-tight text-slate-200">{c.holders.length === 1 ? name(c.holders[0]) : `${c.holders.length} players`}</span>
                </div>
              ) : <span className="shrink-0 text-[11px] italic text-mute">Nobody</span>)}
            </div>
          ))}
        </div>
      </Section>
      <p className="px-1 text-xs text-mute">
        The clubs are dealt round the pool in turn to every player in it when the hat is drawn, so some may hold one more; where the pool is bigger than the field, players share a club. Whoever holds the champion wins; the table ranks players by how far their best club has gone.
      </p>
    </div>
  );
}
