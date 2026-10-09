// The bracket (migration 185): every series from a round through to the final, picked before the round's first game.
// Round by round on a phone: a first-round series offers its two clubs; a later one, the two winners picked in the
// series below it, so changing an early pick clears the later ones it broke. Once it locks, each pick shows right,
// wrong or still alive, and everyone's champion shows. The host can fill one in for a member who asked.
import { useMemo, useState } from 'react';
import { Check, Crown, Lock, Minus, Plus, Trophy } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Section, TeamBadge, useAction } from './ui';
import { Crest } from './Crest';
import { lastGameOf, type Club, type Words } from '../pages/Picks';

export interface BSeries {
  id: number; round: number; label: string; short: string | null; best_of: number; pos: number; next: number | null;
  high: Club | null; low: Club | null; high_wins: number; low_wins: number; winner: number | null; state: 'scheduled' | 'live' | 'final';
  starts_at: string | null; points: number;
}
export interface BracketData {
  locks_at: string | null; locked: boolean; series: BSeries[]; mine: Record<string, number> | null; picked: number;
  champions: { team_id: number; club: number }[] | null;
  tiebreak: { locks_at: string | null; locked: boolean; mine: number | null; label: string | null };
}

const lockText = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'when the first game is set');

export function BracketGame({ gameId, data, status, reload, actAs, words }: {
  gameId: number; data: BracketData; status: 'open' | 'done'; reload: () => void; actAs?: { team: number; name: string };
  words: Words & { guess: number };
}) {
  const { teams } = useLeague();
  const { busy, run } = useAction();
  // the bracket being filled in: the saved one (or a blank slate for a member the host picks for)
  const saved = actAs ? {} : data.mine ?? {};
  const [draft, setDraft] = useState<Record<string, number> | null>(null);
  const picks = draft ?? saved;
  const [runs, setRuns] = useState<number | null>(null);
  const open = status === 'open' && !data.locked;
  const byId = useMemo(() => new Map(data.series.map((s) => [s.id, s])), [data.series]);
  const rounds = useMemo(() => [...new Set(data.series.map((s) => s.round))].sort((a, b) => a - b), [data.series]);
  const feeders = (s: BSeries) => data.series.filter((x) => x.next === s.id).sort((a, b) => a.pos - b.pos);
  const clubs = new Map<number, Club>();
  data.series.forEach((s) => { if (s.high) clubs.set(s.high.id, s.high); if (s.low) clubs.set(s.low.id, s.low); });
  // who a series offers: its two clubs in the first round, else the two winners picked below it
  const options = (s: BSeries): (Club | null)[] => {
    const f = feeders(s);
    if (!f.length) return [s.high, s.low];
    return f.map((x) => (picks[String(x.id)] ? clubs.get(picks[String(x.id)]) ?? null : null));
  };
  // a pick changed: later picks that relied on the old winner go
  const choose = (s: BSeries, club: number) => {
    const next = { ...picks, [String(s.id)]: club };
    let cur: BSeries | undefined = s;
    const old = picks[String(s.id)];
    while (cur?.next) {
      const up: BSeries = byId.get(cur.next)!;
      if (old && next[String(up.id)] === old) delete next[String(up.id)];
      cur = up;
    }
    setDraft(next);
  };
  const total = data.series.length;
  const done = data.series.filter((s) => picks[String(s.id)]).length;
  const final = data.series.find((s) => s.next == null);
  const champ = final ? clubs.get(picks[String(final.id)] ?? -1) : undefined;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(saved);
  const out = new Set<number>();
  data.series.forEach((s) => { if (s.state === 'final' && s.winner) { const l = s.winner === s.high?.id ? s.low?.id : s.high?.id; if (l) out.add(l); } });
  const save = () => run(async () => {
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { thing: 'bracket', pick: { winners: picks } } });
    else await rpc('pool_game_pick', { p_game: gameId, p_thing: 'bracket', p_pick: { winners: picks } });
    setDraft(null); reload();
  }, actAs ? `${actAs.name}'s bracket is in` : 'Your bracket is in');
  const tbv = runs ?? data.tiebreak.mine ?? words.guess;

  return (
    <div className="space-y-4">
      {/* the champion and how far along the bracket is */}
      <div className="card-hero flex items-center gap-3 p-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/20"><Trophy className="h-6 w-6 text-gold" /></span>
        <div className="min-w-0 flex-1">
          <div className="label">{actAs ? `${actAs.name}'s champion` : 'Your champion'}</div>
          <div className="flex items-center gap-2 font-display text-xl font-extrabold text-white">{champ ? <><Crest c={champ} size={24} />{champ.name}</> : <span className="text-white/50">Not picked yet</span>}</div>
          <div className="text-[11px] text-mute">{open ? `${done} of ${total} picked · locks ${lockText(data.locks_at)}` : data.locked ? 'Locked' : 'Over'}</div>
        </div>
        {!open && <Lock className="h-4 w-4 shrink-0 text-mute" />}
      </div>

      {rounds.map((r) => {
        const list = data.series.filter((s) => s.round === r).sort((a, b) => a.pos - b.pos);
        return (
          <Section key={r} title={list[0]?.label ?? `Round ${r}`} right={<span className="text-xs text-mute">{list[0]?.points} {list[0]?.points === 1 ? 'pt' : 'pts'} each</span>}>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((s) => {
                const opts = options(s);
                const mine = picks[String(s.id)];
                const decided = s.state === 'final' && s.winner != null;
                return (
                  <div key={s.id} className="card p-2.5">
                    <div className="mb-1.5 flex items-center justify-between px-1 text-[10px] font-black uppercase tracking-[.14em]">
                      <span className="text-white">{s.short ?? s.label}</span>
                      <span className="text-mute">{decided ? (s.best_of === 1 ? 'Final' : `Final ${Math.max(s.high_wins, s.low_wins)}-${Math.min(s.high_wins, s.low_wins)}`) : s.state === 'live' ? (s.best_of === 1 ? 'Live' : `${s.high_wins}-${s.low_wins}`) : s.best_of === 1 ? (s.starts_at ? new Date(s.starts_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '') : `Best of ${s.best_of}`}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {opts.map((c, i) => {
                        if (!c) return <div key={i} className="grid min-h-12 place-items-center rounded-xl border border-dashed border-white/10 px-2 text-center text-[11px] text-mute">{s.best_of === 1 ? 'Pick the game before' : 'Pick the series before'}</div>;
                        const on = mine === c.id;
                        const right = decided && on && s.winner === c.id, wrong = on && (decided ? s.winner !== c.id : out.has(c.id));
                        return (
                          <button key={c.id} type="button" disabled={!open || busy} onClick={() => choose(s, c.id)}
                            className={`flex min-h-12 min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold ring-1 transition disabled:cursor-default
                              ${right ? 'bg-emerald-400/20 text-emerald-100 ring-emerald-400/50' : wrong ? 'bg-red-500/10 text-red-200/80 ring-red-400/30 line-through' : on ? 'bg-gold/15 text-white ring-gold' : 'bg-white/[.03] text-slate-200 ring-white/10 enabled:hover:bg-white/[.07]'}`}>
                            <Crest c={c} size={22} />
                            <span className="min-w-0 flex-1 text-balance leading-tight">{c.name}</span>
                            {on && !wrong && <Check className="h-4 w-4 shrink-0" strokeWidth={3} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}

      {open && (
        <div className="space-y-3">
          {!actAs && data.tiebreak.label && (
            <div className="card flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-white">Tiebreaker: total {words.score} in {lastGameOf(data.tiebreak.label, data.series.every((x) => x.best_of === 1))}</div>
                <div className="text-xs text-mute">Closest breaks a tie on points. Locks with the bracket.</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label="One fewer" disabled={busy || tbv <= 0} onClick={() => setRuns(Math.max(0, tbv - 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-30"><Minus className="h-4 w-4" /></button>
                <div className="num grid h-10 w-12 place-items-center rounded-xl bg-black/30 text-xl font-black text-white">{tbv}</div>
                <button type="button" aria-label="One more" disabled={busy || tbv >= words.cap} onClick={() => setRuns(Math.min(words.cap, tbv + 1))} className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.06] ring-1 ring-white/10 disabled:opacity-30"><Plus className="h-4 w-4" /></button>
              </div>
              {runs != null && runs !== data.tiebreak.mine && (
                <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => run(async () => { await rpc('pool_game_pick', { p_game: gameId, p_thing: 'tiebreak', p_pick: { runs: tbv } }); setRuns(null); reload(); }, 'Tiebreaker saved')}>Save {tbv} {words.score}</button>
              )}
            </div>
          )}
          <button type="button" className="btn-gold w-full py-3" disabled={busy || done < total || (!dirty && !actAs && !!data.mine)} onClick={save}>
            {done < total ? `${total - done} still to pick` : actAs ? `Save ${actAs.name}'s bracket` : data.mine ? (dirty ? 'Save my changes' : 'Your bracket is in') : 'Lock in my bracket'}
          </button>
        </div>
      )}

      {data.champions && data.champions.length > 0 && (
        <Section title="Everyone's champion">
          <div className="card divide-y divide-white/[.05] p-1">
            {data.champions.map((c) => {
              const t = teams.find((x) => x.id === c.team_id), club = clubs.get(c.club);
              return (
                <div key={c.team_id} className={`flex items-center gap-3 px-3 py-2 ${out.has(c.club) ? 'opacity-55' : ''}`}>
                  <TeamBadge team={t} size={28} />
                  <span className="min-w-0 flex-1 break-words text-sm font-semibold text-white">{t?.gm_name ?? t?.name}</span>
                  {club && <span className="flex shrink-0 items-center gap-1.5 text-sm text-slate-200"><Crest c={club} size={20} />{club.short ?? club.name}{!out.has(c.club) && <Crown className="h-3.5 w-3.5 text-gold" />}</span>}
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
