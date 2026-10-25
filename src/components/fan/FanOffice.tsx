// The fan zone's front office (25 October 2026, Patrick: "the moves and decisions the GM and coaching should make, and
// what fundamental changes should be considered"): the bigger questions with a verdict each, the moves for the GM (for
// each need the numbers name, the league's players who fill it, sellers first), and the decisions for the coaches (the
// lines from the last game read against each player's 5-on-5 numbers, the power play, the kill, the draws, the pairs and
// the crease). src/lib/fanOffice.ts. Each bigger question carries the fans' own verdict beside the numbers' (FanVoice.tsx).
import { useState } from 'react';
import { usePlayerInfo } from '../../lib/playerInfo';
import { NhlLogo } from '../ui';
import { fmtDate } from '../../lib/format';
import type { Decision, Need, Question, coaching as coachingFn } from '../../lib/fanOffice';
import { Chips, Head } from './kit';
import { QUESTION_CALLS } from '../../lib/fanLists';
import { VerdictCall } from './FanVoice';

const VERDICT = { Rethink: 'bg-red-500/15 text-red-200 ring-red-400/30', Adjust: 'bg-amber-500/15 text-amber-200 ring-amber-400/30', Keep: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30' } as const;

export function FanOffice({ qs, needs, coach, loading }: { qs: Question[]; needs: Need[]; coach: ReturnType<typeof coachingFn> | null; loading: boolean }) {
  const [tab, setTab] = useState<'big' | 'gm' | 'coach'>('big');
  if (!qs.length && !needs.length && !coach && !loading) return null;
  return (
    <section className="space-y-3">
      <Head id="office" title="The front office" sub="What the numbers say the general manager and the coaches should do, from the next game to the next few seasons." />
      <Chips label="Front office" items={[['big', 'The bigger questions'], ['gm', 'Moves for the GM'], ['coach', 'For the coaches']] as const} value={tab} onChange={setTab} />
      {loading && !qs.length ? <div className="card p-4 text-sm text-mute">Reading the league&apos;s numbers…</div>
        : tab === 'big' ? <Questions qs={qs} /> : tab === 'gm' ? <Moves needs={needs} /> : <Coaches coach={coach} />}
    </section>
  );
}

function Questions({ qs }: { qs: Question[] }) {
  const counts = (['Rethink', 'Adjust', 'Keep'] as const).map((v) => [v, qs.filter((q) => q.verdict === v).length] as const);
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {counts.map(([v, n]) => <div key={v} className={`rounded-2xl px-2 py-2 text-center ring-1 ${VERDICT[v]}`}><div className="num font-display text-xl font-extrabold">{n}</div><div className="text-[10px] font-semibold">{v}</div></div>)}
      </div>
      <div className="space-y-2">
        {qs.map((q) => (
          <div key={q.area} className="card p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1"><div className="text-[11px] font-bold uppercase tracking-wider text-mute">{q.area}</div><b className="block text-white">{q.title}</b></div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${VERDICT[q.verdict]}`}>{q.verdict}</span>
            </div>
            <ul className="mt-2 space-y-1">{q.evidence.map((e) => <li key={e} className="flex gap-2 text-[13px] leading-snug text-slate-300"><span className="shrink-0 text-mute">·</span>{e}</li>)}</ul>
            <p className="mt-2 rounded-xl bg-white/[.04] px-3 py-2 text-sm leading-snug text-slate-100 ring-1 ring-white/[.06]"><b style={{ color: 'var(--club)' }}>What to do. </b>{q.action}</p>
            <VerdictCall topic={QUESTION_CALLS[q.area]} verdict={q.verdict} />
          </div>
        ))}
      </div>
    </>
  );
}

function Moves({ needs }: { needs: Need[] }) {
  const info = usePlayerInfo();
  if (!needs.length) return <div className="card p-4 text-sm text-mute">The numbers don&apos;t name a hole that a trade would fill right now.</div>;
  return (
    <div className="space-y-2">
      {needs.map((n) => (
        <div key={n.key} className="card overflow-hidden">
          <div className="border-b border-white/[.06] p-3"><b className="text-white">{n.title}</b><p className="mt-0.5 text-[12px] leading-snug text-mute">{n.why}</p></div>
          <div className="divide-y divide-white/[.05]">
            {n.players.map((p) => (
              <button key={p.id} type="button" onClick={() => info?.(p.id)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[.03]">
                <NhlLogo abbr={p.team} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm"><b className="text-white">{p.name}</b><span className="text-[11px] text-mute">{p.pos}{p.age != null ? ` · ${p.age}` : ''} · {p.team}</span>{p.seller && <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-200 ring-1 ring-amber-400/30">Seller</span>}</span>
                  <span className="block text-[11px] leading-snug text-slate-300">{n.stat(p)}</span>
                </span>
                {p.odds != null && <span className="shrink-0 text-right"><span className="num block text-sm font-bold text-white">{Math.round(p.odds * 100)}%</span><span className="block text-[9px] text-mute">their odds</span></span>}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="px-1 text-[11px] text-mute">Sellers are clubs under a 35% playoff chance in the simulation; their young core and every club&apos;s stars are left off. Contracts and the cap aren&apos;t in the NHL&apos;s free feeds, so fit under the cap isn&apos;t judged.</p>
    </div>
  );
}

function Coaches({ coach }: { coach: ReturnType<typeof coachingFn> | null }) {
  const info = usePlayerInfo();
  if (!coach) return null;
  const tone = (v: number | null) => (v == null ? 'text-mute' : v >= 2 ? 'text-emerald-300' : v < 1.2 ? 'text-red-300' : 'text-slate-200');
  return (
    <div className="space-y-2">
      {coach.lines.length > 0 && (
        <div className="card p-3">
          <div className="flex items-baseline justify-between gap-2 px-1"><b className="text-white">The lines last game{coach.game ? <span className="text-[12px] font-normal text-mute"> · {fmtDate(coach.game.date)} vs {coach.game.opp}</span> : null}</b><span className="text-[10px] text-mute">5-on-5 points /60 · shot share rel</span></div>
          <div className="mt-2 space-y-1.5">
            {coach.lines.map((l) => (
              <div key={l.label} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-2 py-1.5 ring-1 ring-white/[.06]">
                <span className="w-6 shrink-0 text-center text-[11px] font-bold text-mute">{l.label.replace('Line ', 'L')}</span>
                <span className="grid min-w-0 flex-1 grid-cols-3 gap-1">
                  {l.players.map((p) => (
                    <button key={p.id} type="button" onClick={() => info?.(p.id)} className="min-w-0 rounded-lg bg-white/[.04] px-1 py-1 text-center">
                      <span className="block truncate text-[12px] font-semibold text-white">{p.name}</span>
                      <span className={`num block text-[10px] ${tone(p.p60)}`}>{p.p60 != null ? p.p60.toFixed(2) : '–'}{p.rel != null ? ` · ${p.rel >= 0 ? '+' : '−'}${Math.abs(p.rel * 100).toFixed(0)}` : ''}</span>
                    </button>
                  ))}
                </span>
              </div>
            ))}
            {coach.pairs.map((pr, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-white/[.03] px-2 py-1.5 ring-1 ring-white/[.06]">
                <span className="w-6 shrink-0 text-center text-[11px] font-bold text-mute">D{i + 1}</span>
                <span className="grid min-w-0 flex-1 grid-cols-2 gap-1">
                  {pr.players.map((p) => (
                    <button key={p.id} type="button" onClick={() => info?.(p.id)} className="min-w-0 rounded-lg bg-white/[.04] px-1 py-1 text-center">
                      <span className="block truncate text-[12px] font-semibold text-white">{p.name}</span>
                      <span className="num block text-[10px] text-mute">shoots {p.shoots ?? '–'}{p.rel != null ? ` · ${p.rel >= 0 ? '+' : '−'}${Math.abs(p.rel * 100).toFixed(0)}` : ''}</span>
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {coach.decisions.length ? coach.decisions.map((x: Decision, i) => (
        <div key={i} className="card flex gap-3 p-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-black text-white" style={{ background: 'rgb(var(--club-rgb) / .3)' }}>{i + 1}</span>
          <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wider text-mute">{x.area}</div><b className="block text-white">{x.title}</b><p className="mt-0.5 text-[13px] leading-snug text-slate-300">{x.why}</p></div>
        </div>
      )) : <div className="card p-4 text-sm text-mute">Nothing in the deployment stands out against the numbers.</div>}
    </div>
  );
}
