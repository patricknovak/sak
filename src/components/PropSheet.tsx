// The prop sheet (migration 208): eight calls on one game of a postseason, a point each, settled from the score and the
// score by period, with the game's total for the tiebreak. Until the first pitch the sheet is yours to change; once it
// starts, each call shows how the pool split and everyone's sheet, and each answer as soon as the game decides it
// (migration 218: the 1st inning once the 2nd begins, the over once it's passed), so the sheet scores as it goes.
import { useState } from 'react';
import { Check, Lock, X } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Crest } from './Crest';
import { Section, useAction } from './ui';
import type { Club } from '../pages/Picks';

export interface PropQuestion { key: string; q: string; line?: number; options: { v: string; label: string }[] }
export interface PropsData {
  game: { id: number; kickoff: string; state: string; home: Club; away: Club; home_score: number | null; away_score: number | null; game_no: number | null; label: string | null;
    periods: { n: number; home: number | null; away: number | null }[] };
  locked: boolean; questions: PropQuestion[]; answers: Record<string, string | null> | null;
  mine: { answers: Record<string, string>; total: number } | null; picked: number;
  split: Record<string, Record<string, number>> | null;
  sheets: { team_id: number; answers: Record<string, string>; total: number; right: number }[] | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PropSheetGame({ gameId, data, status, reload, actAs, scoreWord = 'runs', cap = 60 }: {
  gameId: number; data: PropsData; status: 'open' | 'done'; reload: () => void; actAs?: { team: number; name: string }; scoreWord?: string; cap?: number;
}) {
  const { teams, me } = useLeague();
  const { busy, run } = useAction();
  const saved = actAs ? null : data.mine;
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [total, setTotal] = useState<string | null>(null);
  const answers = draft ?? saved?.answers ?? {};
  const tot = total ?? (saved ? String(saved.total) : '');
  const open = status === 'open' && !data.locked;
  const made = data.questions.filter((q) => answers[q.key]).length;
  const dirty = draft != null || total != null;
  const g = data.game;
  const final = g.state === 'final';
  const live = g.state === 'live';
  const right = data.answers ? data.questions.filter((q) => data.answers![q.key] != null && data.answers![q.key] === (saved?.answers ?? {})[q.key]).length : 0;
  const decided = data.answers ? data.questions.filter((q) => data.answers![q.key] != null).length : 0;
  const save = () => run(async () => {
    const pick = { answers, total: Number(tot) };
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { thing: 'props', pick } });
    else await rpc('pool_game_pick', { p_game: gameId, p_thing: 'props', p_pick: pick });
    setDraft(null); setTotal(null); reload();
  }, actAs ? `${actAs.name}'s sheet is in` : 'Your sheet is in');
  const nameOf = (id: number) => teams.find((t) => t.id === id)?.gm_name ?? 'Someone';

  return (
    <div className="space-y-4">
      {/* the game */}
      <div className="card-hero p-4">
        <div className="flex items-center justify-between gap-2 text-[11px] text-mute">
          <span className="font-semibold uppercase tracking-wider text-slate-200">{g.label}{g.game_no ? ` · Game ${g.game_no}` : ''}</span>
          {live ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-black uppercase text-red-200"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />Live</span>
            : final ? <span className="font-bold uppercase text-slate-300">Final</span>
            : <span className="inline-flex items-center gap-1">{data.locked && <Lock className="h-3 w-3" />}{when(g.kickoff)}</span>}
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          {[g.away, null, g.home].map((c, i) => c ? (
            <div key={i} className={`flex min-w-0 flex-col items-center gap-1.5 ${i === 0 ? '' : ''}`}>
              <Crest c={c} size={44} />
              <span className="max-w-full truncate text-sm font-bold text-white">{c.short ?? c.name}</span>
            </div>
          ) : (
            <div key={i} className="text-center">
              {g.home_score != null && g.away_score != null
                ? <span className="num font-display text-3xl font-black text-white">{g.away_score}<span className="mx-1.5 text-mute">–</span>{g.home_score}</span>
                : <span className="text-xs font-bold uppercase tracking-widest text-mute">at</span>}
            </div>
          ))}
        </div>
        {g.periods.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-center text-[11px]">
              <thead><tr className="text-mute"><th className="w-12 text-left font-semibold" />{g.periods.map((p) => <th key={p.n} className="num font-semibold">{p.n}</th>)}</tr></thead>
              <tbody>
                {(['away', 'home'] as const).map((side) => (
                  <tr key={side} className="text-slate-200"><td className="text-left font-bold">{g[side].short}</td>{g.periods.map((p) => <td key={p.n} className="num">{p[side] ?? '–'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-white/[.06] px-2.5 py-1 font-semibold text-white ring-1 ring-white/10">{open ? `${made} of ${data.questions.length} called` : final ? `${right} of ${data.questions.length} right`
            : live && saved ? `${right} right so far · ${data.questions.length - decided} to play` : `${data.picked} ${data.picked === 1 ? 'sheet' : 'sheets'} in`}</span>
          <span className="rounded-full bg-white/[.06] px-2.5 py-1 text-slate-200 ring-1 ring-white/10">A point a call · closest total breaks a tie</span>
        </div>
      </div>

      {/* the calls */}
      <Section title={actAs ? `${actAs.name}'s sheet` : 'The sheet'} right={<span className="text-xs text-mute">{open ? 'Locks at the start' : 'Locked'}</span>}>
        <div className="space-y-2">
          {data.questions.map((q, qi) => {
            const mine = answers[q.key];
            const ans = data.answers?.[q.key] ?? null;
            const split = data.split?.[q.key];
            const n = split ? Object.values(split).reduce((s, x) => s + x, 0) : 0;
            return (
              <div key={q.key} className="card p-3">
                <div className="mb-2 flex items-start gap-2">
                  <span className="num mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/[.07] text-[10px] font-black text-mute">{qi + 1}</span>
                  <span className="flex-1 text-[14px] font-semibold leading-snug text-white">{q.q}</span>
                  {mine && (ans != null ? (ans === mine ? <Check className="h-5 w-5 shrink-0 text-emerald-300" strokeWidth={3} /> : <X className="h-5 w-5 shrink-0 text-red-300" strokeWidth={3} />)
                    : final ? <span className="text-[10px] font-bold uppercase text-mute">Void</span>
                    : live ? <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-mute">To play</span> : null)}
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${q.options.length}, minmax(0, 1fr))` }}>
                  {q.options.map((o) => {
                    const on = mine === o.v;
                    const isAns = ans === o.v;
                    const pct = n ? Math.round(((split?.[o.v] ?? 0) / n) * 100) : null;
                    return (
                      <button key={o.v} type="button" disabled={!open || busy} onClick={() => setDraft({ ...answers, [q.key]: o.v })}
                        className={`relative overflow-hidden rounded-xl px-2 py-2.5 text-center text-[13px] font-bold ring-1 transition disabled:cursor-default
                          ${isAns ? 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/60' : on ? 'bg-gold/[.16] text-white ring-gold/70' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>
                        {pct != null && <span className="absolute inset-y-0 left-0 bg-white/[.06]" style={{ width: `${pct}%` }} />}
                        <span className="relative block truncate">{o.label}</span>
                        {pct != null && <span className="relative block text-[10px] font-semibold text-mute">{pct}%</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="card flex items-center gap-3 p-3">
            <span className="flex-1 text-[14px] font-semibold leading-snug text-white">Tiebreak: total {scoreWord} in the game</span>
            <input className="input num w-20 text-center text-lg font-black" inputMode="numeric" disabled={!open || busy} value={tot}
              onChange={(e) => setTotal(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="0" />
          </div>
        </div>
      </Section>

      {open && (dirty || actAs || !data.mine) && (
        <div className="sticky bottom-20 z-10">
          <button type="button" className="btn-gold w-full py-3 shadow-xl shadow-black/40"
            disabled={busy || made < data.questions.length || tot === '' || Number(tot) > cap || (!dirty && !actAs && !!data.mine)} onClick={save}>
            {made < data.questions.length ? `${data.questions.length - made} ${data.questions.length - made === 1 ? 'call' : 'calls'} still to make`
              : tot === '' ? 'Add your total for the tiebreak' : actAs ? `Save ${actAs.name}'s sheet` : data.mine ? 'Save my changes' : 'Lock in my sheet'}
          </button>
        </div>
      )}
      {open && !dirty && !actAs && data.mine && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-mute"><Check className="h-3.5 w-3.5 text-emerald-300" /> Your sheet is in. Change any call until the start.</p>
      )}

      {/* everyone's sheets, once it starts */}
      {data.sheets && data.sheets.length > 0 && (
        <Section title="Everyone's sheets">
          <div className="card divide-y divide-white/[.05] p-1">
            {[...data.sheets].sort((a, b) => b.right - a.right || a.team_id - b.team_id).map((s) => (
              <div key={s.team_id} className={`flex items-center gap-2.5 rounded-xl px-2 py-2 ${s.team_id === me?.id ? 'bg-gold/[.08]' : ''}`}>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white">{nameOf(s.team_id)}</span>
                <span className="flex shrink-0 gap-0.5">
                  {data.questions.map((q) => {
                    const a = data.answers?.[q.key];
                    const cls = a == null ? 'bg-white/15' : a === s.answers[q.key] ? 'bg-emerald-400' : 'bg-red-400/70';
                    return <span key={q.key} className={`h-2.5 w-2.5 rounded-sm ${cls}`} title={q.q} />;
                  })}
                </span>
                <span className="num w-14 shrink-0 text-right text-xs text-mute">total {s.total}</span>
                {(final || decided > 0) && <span className="num w-6 shrink-0 text-right text-base font-black text-white">{s.right}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
