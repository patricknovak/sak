// The daily streak (migration 231): one winner a day from that day's games. A right pick adds one to the run, a wrong one
// starts it again, and a day off or a game called off breaks nothing; the longest run wins. A day's pick moves to any of
// its games still to come until the picked one starts, and once a game starts everyone's side on it shows.
import { useState } from 'react';
import { Check, Flame, Lock, X } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { etToday } from '../lib/format';
import { Crest } from './Crest';
import { Section, useAction } from './ui';
import { ShareButton, useCardBrand } from './ShareButton';
import { shareCard } from '../lib/shareCard';
import type { Club } from '../pages/Picks';

type Side = 'H' | 'A' | 'D';
export interface StreakGame {
  id: number; kickoff: string; state: string; minute: number | null; label: string | null; home: Club; away: Club;
  home_score: number | null; away_score: number | null; result: Side | null; void: boolean; locked: boolean;
  calls: { team_id: number; pick: Side }[] | null;
}
export interface StreakData {
  draws: boolean; best: number; current: number; right: number; picked: number; top: number | null;
  days: { day: string; mine: { fixture: number; pick: Side } | null; picked: number; games: StreakGame[] }[];
  history: { day: string; pick: Side; right: boolean | null; void: boolean; home: Club; away: Club; home_score: number | null; away_score: number | null }[];
}

const short = (c: Club) => c.short ?? c.name;
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
// a day as its date reads where it is played (noon keeps it on the same date in any time zone)
const dayName = (d: string, today: string) => {
  if (d === today) return 'Today';
  const x = new Date(`${d}T12:00:00`), t = new Date(`${today}T12:00:00`);
  if (Math.round((x.getTime() - t.getTime()) / 86400000) === 1) return 'Tomorrow';
  return x.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export function StreakGameView({ gameId, data, status, reload, actAs }: {
  gameId: number; data: StreakData; status: 'open' | 'done'; reload: () => void; actAs?: { team: number; name: string };
}) {
  const { teams } = useLeague();
  const { busy, run } = useAction();
  const today = etToday();
  const [dayAt, setDayAt] = useState(() => Math.max(0, data.days.findIndex((d) => d.games.some((g) => !g.locked))));
  const day = data.days[Math.min(dayAt, data.days.length - 1)];
  const nameOf = (id: number) => teams.find((t) => t.id === id)?.gm_name ?? 'Someone';
  // the host picking for someone sees none of their picks, only the games
  const mine = actAs ? null : day?.mine ?? null;
  const dayLocked = !!mine && !!day?.games.find((g) => g.id === mine.fixture)?.locked;
  const pick = (g: StreakGame, side: Side) => run(async () => {
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { thing: 'streak', pick: { fixture: g.id, pick: side } } });
    else await rpc('pool_game_pick', { p_game: gameId, p_thing: 'streak', p_pick: { fixture: g.id, pick: side } });
    reload();
  }, actAs ? `${actAs.name}'s pick is in` : `${side === 'D' ? 'A draw' : short(side === 'H' ? g.home : g.away)} it is`);
  // the run so far, oldest first, as a chain of ticks and crosses
  const chain = [...data.history].reverse().slice(-14);
  const cardBrand = useCardBrand();
  const shareMine = () => {
    const rows = data.history.slice(0, 8).map((h) => ({
      q: data.draws ? `${short(h.home)} v ${short(h.away)}` : `${short(h.away)} at ${short(h.home)}`,
      answer: h.pick === 'D' ? 'Draw' : short(h.pick === 'H' ? h.home : h.away), right: h.void ? null : h.right }));
    return shareCard({ kind: 'sheet', eyebrow: 'My streak', brand: cardBrand, who: '', title: `On ${data.current} in a row`,
      score: `Best run ${data.best}`, rows }, `I'm on ${data.current} in a row, best ${data.best}.`);
  };

  return (
    <div className="space-y-4">
      {/* the run */}
      {!actAs && (
        <div className="card-hero relative overflow-hidden p-4">
          <div className="pointer-events-none absolute -right-6 -top-6 h-32 w-32 rounded-full bg-orange-500/20 blur-2xl" />
          <div className="relative flex items-center gap-4">
            <div className={`grid h-16 w-16 shrink-0 place-items-center rounded-2xl ${data.current > 0 ? 'bg-gradient-to-br from-orange-400 to-rose-500 shadow-lg shadow-orange-500/30' : 'bg-white/[.06]'}`}>
              <Flame className={`h-8 w-8 ${data.current > 0 ? 'text-white' : 'text-mute'}`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[.18em] text-mute">On now</div>
              <div className="flex items-baseline gap-2"><span className="num text-4xl font-black text-white">{data.current}</span><span className="text-sm text-slate-300">in a row</span></div>
              <div className="text-xs text-mute">Best run <b className="text-white">{data.best}</b>{data.top != null && data.top > 0 ? <> · the pool's best <b className="text-gold">{data.top}</b></> : null}</div>
            </div>
          </div>
          {chain.length > 0 && (
            <div className="relative mt-3 flex flex-wrap gap-1">
              {chain.map((h, i) => (
                <span key={i} title={`${short(h.away)} at ${short(h.home)}`} className={`grid h-6 w-6 place-items-center rounded-full ring-1 ${h.void || h.right == null ? 'bg-white/[.05] text-mute ring-white/10' : h.right ? 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30' : 'bg-rose-500/15 text-rose-300 ring-rose-400/30'}`}>
                  {h.void || h.right == null ? <span className="text-[10px]">–</span> : h.right ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* the days ahead */}
      {data.days.length > 0 && (
        <div className="scroll-x flex gap-1.5">
          {data.days.map((d, i) => (
            <button key={d.day} type="button" onClick={() => setDayAt(i)} className={`tab inline-flex shrink-0 items-center gap-1.5 ${d.day === day?.day ? 'tab-on' : 'bg-white/[.05]'}`}>
              {dayName(d.day, today)}
              {!actAs && (d.mine ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : d.games.some((g) => !g.locked) && <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />)}
            </button>
          ))}
        </div>
      )}
      {!day ? (
        <div className="card p-4 text-sm text-mute">No games in the next few days. The streak picks up with the next one.</div>
      ) : (
        <Section title={`${dayName(day.day, today)}: pick one`}>
          <p className="-mt-1 mb-2 px-1 text-xs text-mute">
            {dayLocked ? 'Your pick for the day has started, so it stays.'
              : mine ? 'Your pick for the day is in. Tap another side to change it until that game starts.'
              : status === 'open' ? `One winner from ${day.games.length === 1 ? 'the day’s game' : `the day’s ${day.games.length} games`}. A right pick keeps the run going.` : 'The streak is over.'}
          </p>
          <div className="space-y-2">
            {day.games.map((g) => {
              const live = g.state === 'live', final = g.state === 'final';
              const picked = mine?.fixture === g.id ? mine.pick : null;
              const can = status === 'open' && !g.locked && !dayLocked && !busy;
              const sides: Side[] = data.draws ? ['H', 'D', 'A'] : ['A', 'H'];
              const n = (s: Side) => g.calls?.filter((c) => c.pick === s).length ?? 0;
              return (
                <div key={g.id} className={`card p-3 ${picked ? 'ring-1 ring-gold/40' : ''}`}>
                  <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-mute">
                    <span className="truncate font-semibold uppercase tracking-wider">{g.label}</span>
                    {live ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase text-red-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Live {g.away_score}-{g.home_score}</span>
                      : final ? <span className="shrink-0 font-bold uppercase text-slate-300">Final</span>
                      : g.void ? <span className="shrink-0 font-bold uppercase text-slate-400">Called off</span>
                      : <span className="inline-flex shrink-0 items-center gap-1">{g.locked && <Lock className="h-3 w-3" />}{time(g.kickoff)}</span>}
                  </div>
                  <div className={`grid gap-2 ${sides.length === 3 ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-2'}`}>
                    {sides.map((s) => {
                      const c = s === 'H' ? g.home : s === 'A' ? g.away : null;
                      const on = picked === s;
                      const won = g.result != null && g.result === s;
                      const score = s === 'H' ? g.home_score : s === 'A' ? g.away_score : null;
                      return (
                        <button key={s} type="button" disabled={!can} onClick={() => pick(g, s)}
                          className={`flex min-w-0 items-center gap-2 rounded-2xl px-3 py-2.5 text-left ring-1 transition ${on ? (g.result == null || g.void ? 'bg-gold/15 ring-gold' : won ? 'bg-emerald-400/15 ring-emerald-400/60' : 'bg-rose-500/15 ring-rose-400/50') : won ? 'bg-white/[.06] ring-white/20' : 'bg-white/[.03] ring-white/10'} ${can ? 'hover:ring-gold/60 active:scale-[.98]' : !g.locked ? 'opacity-50' : ''} ${s === 'D' ? 'justify-center' : ''}`}>
                          {c ? <Crest c={c} size={30} /> : null}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-white">{c ? short(c) : 'Draw'}</span>
                            <span className="block text-[10px] text-mute">{s === 'H' ? 'home' : s === 'A' ? 'away' : ''}{g.calls ? `${s === 'D' ? '' : ' · '}${n(s)} rode it` : ''}</span>
                          </span>
                          {score != null && (live || final) && <span className={`num shrink-0 text-lg font-black ${won ? 'text-white' : 'text-mute'}`}>{score}</span>}
                          {on && <Check className="h-4 w-4 shrink-0 text-gold" />}
                        </button>
                      );
                    })}
                  </div>
                  {g.calls && g.calls.length > 0 && (
                    <div className="mt-2 text-[11px] leading-snug text-mute">
                      {sides.filter((s) => n(s) > 0).map((s) => `${s === 'D' ? 'Draw' : short(s === 'H' ? g.home : g.away)}: ${g.calls!.filter((c) => c.pick === s).map((c) => nameOf(c.team_id)).join(', ')}`).join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {day.picked > 0 && <p className="mt-2 px-1 text-[11px] text-mute">{day.picked} {day.picked === 1 ? 'player has' : 'players have'} picked for {dayName(day.day, today).toLowerCase() === 'today' ? 'today' : 'the day'}. Who rode what shows once each game starts.</p>}
        </Section>
      )}

      {/* the picks so far */}
      {!actAs && data.history.length > 0 && (
        <Section title="Your picks so far">
          <div className="card divide-y divide-white/[.05] p-1">
            {data.history.slice(0, 10).map((h, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${h.void || h.right == null ? 'bg-white/[.05] text-mute' : h.right ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {h.void || h.right == null ? <span className="text-xs">–</span> : h.right ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-white">{h.pick === 'D' ? 'Draw' : short(h.pick === 'H' ? h.home : h.away)}</div>
                  <div className="text-[11px] text-mute">{dayName(h.day, today)} · {short(h.away)} {h.away_score ?? ''} at {short(h.home)} {h.home_score ?? ''}{h.void ? ' · called off' : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {!actAs && data.history.some((h) => h.right != null) && <ShareButton className="btn-ghost w-full" label="Share my streak" make={shareMine} />}
      <p className="px-1 text-xs text-mute">
        One pick a day there are games. A right pick adds one to your run; a wrong one starts it again at nothing. Skip a day and the run waits; a game called off counts for nothing{data.draws ? '' : ', and so does a tie'}. The longest run wins, and the run going now breaks a tie.
      </p>
    </div>
  );
}
