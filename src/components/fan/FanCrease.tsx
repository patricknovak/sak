// The fan zone's crease (25 October 2026, Patrick: "improve the goalie analysis significantly"): who's to blame for the
// goals against, each goalie in depth (goals saved against an average goalie and against the danger of his shots, the
// slot, mid-range and long shots against the league, 5-on-5 and close games, every start, rest and workload, five
// seasons against the league, his ranks among the league's goalies), the plan, and the market. src/lib/fanOffice.ts.
import { useState } from 'react';
import { usePlayerInfo } from '../../lib/playerInfo';
import { NhlLogo } from '../ui';
import { fmtDate } from '../../lib/format';
import type { Blame, GoaliePlan, GoalieRead, MarketGoalie } from '../../lib/fanOffice';
import { Head, ShareBar, pctStr } from './kit';
import { CreaseArrival } from './FanMoves';
import type { MoveGoalie } from '../../lib/fanZone';
import type { MovePrice } from '../../lib/fanDeep';

const sv = (v: number | null | undefined) => (v == null ? '–' : pctStr(v));
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const TONE = { good: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30', ok: 'bg-white/[.06] text-slate-200 ring-white/15', bad: 'bg-red-500/15 text-red-200 ring-red-400/30' } as const;

export function FanCrease({ reads, blame, plan, market, owner, moves }: { reads: GoalieRead[]; blame: Blame | null; plan: GoaliePlan | null; market: MarketGoalie[]; owner: (id: number) => React.ReactNode;
  moves?: { price: MovePrice; arrivals: MoveGoalie[]; seasons: { id: number; season: number; gp: number; svp: number | null; team: string | null }[]; lgSvp: Record<string, number> } | null }) {
  if (!reads.length && !moves?.arrivals.length) return null;
  // a goalie who left is still in the record; the card says where he went
  const gone = new Map((moves?.price.items ?? []).filter((it) => it.kind === 'gone' && it.pos === 'G').map((it) => [it.id, it.text]));
  // the plan in goal follows the roster: once a goalie arrives or leaves, the shares are the priced crease's
  const priced = moves?.price.crease && (moves.arrivals.length || gone.size) ? moves.price.crease : null;
  return (
    <section className="space-y-3">
      <Head id="crease" title="The crease" sub="Every shot the goalies faced, placed by the NHL's tracking: how many, how dangerous, and how many an average goalie would have stopped." />
      {blame && <BlameCard b={blame} />}
      {moves?.arrivals.map((g) => <CreaseArrival key={g.id} g={g} price={moves.price} seasons={moves.seasons.filter((s) => s.id === g.id)} lgSvp={moves.lgSvp} />)}
      {reads.map((r) => <GoalieCard key={r.id} r={r} owner={owner} gone={gone.get(r.id) ?? null} />)}
      {priced && (
        <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .14), transparent 60%)' }}>
          <b className="text-white">The plan in goal</b>
          <div className="mt-2 flex h-8 overflow-hidden rounded-xl ring-1 ring-white/10">
            {priced.after.who.map((w, i) => (
              <div key={w.id} className={`grid place-items-center px-2 text-xs font-bold ${i === 0 ? 'text-white' : 'bg-white/[.08] text-slate-200'}`} style={{ width: `${w.share * 100}%`, background: i === 0 ? 'rgb(var(--club-rgb))' : undefined }}>{w.name.split(' ').slice(-1)[0]} {Math.round(w.share * 100)}%</div>
            ))}
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-300">The roster as it stands: {priced.after.who.map((w) => `${w.name} ${Math.round(w.share * 100)}%${w.arrived ? ' (new)' : ''}`).join(', ')}. Expected save percentage {pctStr(priced.after.svp)} from here against {pctStr(priced.before.svp)} from the crease that played the games so far: {signed(priced.goals, 2)} goals a game, priced into the outlook.</p>
        </div>
      )}
      {plan && !priced && (
        <div className="card overflow-hidden p-4" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .14), transparent 60%)' }}>
          <b className="text-white">The plan in goal</b>
          <div className="mt-2 flex h-8 overflow-hidden rounded-xl ring-1 ring-white/10">
            <div className="grid place-items-center px-2 text-xs font-bold text-white" style={{ width: `${plan.split * 100}%`, background: 'rgb(var(--club-rgb))' }}>{plan.starter.name.split(' ').slice(-1)[0]} {Math.round(plan.split * 100)}%</div>
            {plan.backup && <div className="grid flex-1 place-items-center bg-white/[.08] px-2 text-xs font-bold text-slate-200">{plan.backup.name.split(' ').slice(-1)[0]} {Math.round((1 - plan.split) * 100)}%</div>}
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-300">{plan.text}</p>
        </div>
      )}
      {market.length > 0 && <Market list={market} />}
    </section>
  );
}

// the goals against beyond an average night, split three ways
function BlameCard({ b }: { b: Blame }) {
  const parts = [['Shots allowed', b.volume, 'how many'], ['Shot danger', b.quality, 'from where'], ['Goaltending', b.goalie, 'stopped or not']] as const;
  const max = Math.max(2, ...parts.map(([, v]) => Math.abs(v)));
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2"><b className="text-white">Who&apos;s to blame for the goals against</b><span className="num shrink-0 text-xs text-mute">{b.ga} against · ~{b.baseline.toFixed(0)} average</span></div>
      <div className="mt-3 space-y-2.5">
        {parts.map(([k, v, sub]) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="w-24 shrink-0"><span className="block font-semibold text-slate-200">{k}</span><span className="block text-[10px] text-mute">{sub}</span></span>
            <div className="relative h-3 min-w-0 flex-1 rounded-full bg-white/[.05]">
              <span className="absolute left-1/2 top-[-3px] h-[18px] w-px bg-white/30" />
              <div className="absolute top-0 h-3 rounded-full" style={{ left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`, width: `${(Math.abs(v) / max) * 50}%`, background: v > 0.5 ? 'rgb(248 113 113 / .85)' : v < -0.5 ? 'rgb(52 211 153 / .85)' : 'rgb(148 163 184 / .7)' }} />
            </div>
            <span className={`num w-11 shrink-0 text-right font-bold ${v > 0.5 ? 'text-red-300' : v < -0.5 ? 'text-emerald-300' : 'text-slate-300'}`}>{signed(v)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between pl-[6.5rem] pr-12 text-[10px] text-mute"><span>fewer goals</span><span>more goals</span></div>
      <p className="mt-2 text-sm leading-snug text-slate-300">{b.read}</p>
      {b.hdShare != null && b.lgHdShare != null && <p className="mt-1 text-[12px] text-mute">{Math.round(b.hdShare * 100)}% of the shots against come from the slot and crease; {Math.round(b.lgHdShare * 100)}% for a typical goalie. {b.sa60.toFixed(1)} shots against an hour, league {b.lgSa60.toFixed(1)}.</p>}
    </div>
  );
}

function GoalieCard({ r, owner, gone }: { r: GoalieRead; owner: (id: number) => React.ReactNode; gone?: string | null }) {
  const info = usePlayerInfo();
  const [open, setOpen] = useState(false);
  const value = r.gsax ?? r.gsaa;
  const starts = r.starts;
  return (
    <div className="card overflow-hidden">
      <button type="button" onClick={() => info?.(r.id)} className="flex w-full items-center gap-3 p-4 pb-2 text-left">
        {r.headshot ? <img src={r.headshot} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full bg-white/[.06] object-cover ring-2" style={{ '--tw-ring-color': 'rgb(var(--club-rgb) / .5)' } as React.CSSProperties} /> : <span className="h-14 w-14 shrink-0 rounded-full bg-white/[.06]" />}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5"><b className="text-lg text-white">{r.name}</b>{owner(r.id)}{gone && <span className="rounded-full bg-white/[.06] px-2 py-0.5 text-[11px] font-bold text-slate-300 ring-1 ring-inset ring-white/15">{gone.split(':')[0]}</span>}</span>
          <span className="block text-[12px] text-mute">{r.age != null ? `${r.age} · ` : ''}{r.gs} starts · {r.w}-{r.l}-{r.otl} · {sv(r.svp)} · {r.gaa.toFixed(2)} GAA</span>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${TONE[r.verdict.tone]}`}>{r.verdict.label}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className={`num block font-display text-2xl font-extrabold leading-none ${value >= 0.5 ? 'text-emerald-300' : value <= -0.5 ? 'text-red-300' : 'text-white'}`}>{signed(value)}</span>
          <span className="block text-[10px] text-mute">{r.gsax != null ? 'goals vs the danger' : 'goals vs average'}</span>
        </span>
      </button>
      <p className="px-4 text-[13px] leading-snug text-slate-300">{r.verdict.text}</p>

      {/* the three numbers that decide it */}
      <div className="mt-3 grid grid-cols-3 gap-2 px-4">
        {[['vs average', signed(r.gsaa), 'goals saved'], ['vs the danger', r.gsax != null ? signed(r.gsax) : '–', 'goals saved'], ['in the standings', r.winsAdded != null ? signed(r.winsAdded) : '–', 'wins']].map(([k, v, sub]) => (
          <div key={k} className="rounded-2xl bg-white/[.03] p-2 text-center ring-1 ring-white/[.06]"><div className="text-[10px] text-mute">{k}</div><div className="num font-display text-lg font-extrabold text-white">{v}</div><div className="text-[10px] text-mute">{sub}</div></div>
        ))}
      </div>

      {/* by danger */}
      <div className="mt-3 space-y-2 px-4">
        <div className="label">Save percentage by where the shot came from</div>
        {r.danger.map((x) => (
          <div key={x.where} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 text-slate-200">{x.label} <span className="text-[11px] text-mute">· {x.sa} shots ({Math.round(x.share * 100)}%)</span></span>
              <span className={`num font-bold ${x.svp != null && x.lg != null ? (x.svp >= x.lg ? 'text-emerald-300' : 'text-red-300') : 'text-white'}`}>{sv(x.svp)}</span>
              <span className="num w-12 text-right text-[11px] text-mute">lg {sv(x.lg)}</span>
            </div>
            {x.pct != null && <div className="mt-1"><ShareBar value={x.pct} mark={0.5} tone={x.pct >= 0.6 ? 'good' : x.pct < 0.35 ? 'bad' : 'club'} h="h-1.5" /></div>}
          </div>
        ))}
        <p className="text-[10px] text-mute">The bar is his percentile among the league&apos;s goalies; the tick is the middle.</p>
      </div>

      {/* every start */}
      {starts.length > 0 && (
        <div className="mt-3 px-4">
          <div className="flex items-baseline justify-between"><span className="label">Every start</span><span className="text-[10px] text-mute">dashed: .900</span></div>
          <div className="relative mt-1.5 flex h-16 items-end gap-[3px]">
            <span className="absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${((0.9 - 0.75) / 0.25) * 100}%` }} />
            {starts.map((g) => {
              const v = g.svp ?? 0, h = Math.max(4, Math.min(100, ((v - 0.75) / 0.25) * 100));
              return <span key={g.id} title={`${fmtDate(g.date)} ${g.home ? 'vs' : '@'} ${g.opp}: ${g.sa - g.ga}/${g.sa} (${sv(g.svp)})`} className="min-w-0 flex-1 rounded-t-sm" style={{ height: `${h}%`, maxWidth: 18, background: v >= 0.93 ? 'rgb(52 211 153 / .85)' : v >= 0.9 ? 'rgb(var(--club-rgb) / .8)' : v >= 0.85 ? 'rgb(251 191 36 / .8)' : 'rgb(248 113 113 / .85)' }} />;
            })}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
            {[['Quality starts', r.qsPct != null ? `${Math.round(r.qsPct * 100)}%` : '–'], ['Over .900', r.above900?.value != null ? `${Math.round(r.above900.value * 100)}%` : '–'], ['Under .850', String(r.bad)], ['Last five', sv(r.last5)]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/[.03] px-1 py-1.5 ring-1 ring-white/[.06]"><div className="num text-sm font-bold text-white">{v}</div><div className="text-[10px] leading-tight text-mute">{k}</div></div>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={() => setOpen(!open)} className="mt-3 w-full border-t border-white/[.06] py-2 text-sm font-semibold text-sky-300">{open ? 'Less' : 'The full file'}</button>
      {open && (
        <div className="space-y-3 border-t border-white/[.06] p-4 pt-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[
              ['5-on-5', r.sv5?.value != null ? `${sv(r.sv5.value)} · lg ${sv(r.sv5.avg)}` : '–'],
              ['Close games, 5-on-5', r.close5?.value != null ? `${sv(r.close5.value)} · lg ${sv(r.close5.avg)}` : '–'],
              ['Even strength', sv(r.evSvp)], ['On the kill', sv(r.ppSvp)],
              ['Shots against an hour', r.sa60?.value != null ? `${r.sa60.value.toFixed(1)} · lg ${r.sa60.avg?.toFixed(1)}` : '–'],
              ['Goal support', r.support?.value != null ? `${r.support.value.toFixed(2)} a game` : '–'],
              ['Night to night', r.spread != null ? `±${sv(r.spread)} swing` : '–'], ['Steals', `${r.steals} (.930+ on 28+ shots)`],
            ].map(([k, v]) => <div key={k} className="rounded-xl bg-white/[.03] px-2.5 py-1.5 ring-1 ring-white/[.06]"><div className="text-[10px] text-mute">{k}</div><div className="num font-semibold text-white">{v}</div></div>)}
          </div>
          {(r.rest.b2b || r.volume.heavy) && (
            <div className="text-sm">
              <div className="label">Workload</div>
              {[['No rest (back-to-back)', r.rest.b2b], ['Rested', r.rest.rested], ['30 shots or more', r.volume.heavy], ['Under 30 shots', r.volume.light]].map(([k, x]) => x && typeof x === 'object' ? (
                <div key={k as string} className="flex items-baseline gap-2 py-0.5"><span className="min-w-0 flex-1 text-slate-300">{k as string}</span><span className="num text-[11px] text-mute">{x.gs} starts</span><span className="num w-12 text-right font-semibold text-white">{sv(x.svp)}</span></div>
              ) : null)}
            </div>
          )}
          {r.ranks.of > 0 && (
            <div className="text-sm">
              <div className="label">Among the league&apos;s {r.ranks.of} goalies with a real sample</div>
              <div className="mt-1 grid grid-cols-4 gap-1.5 text-center">
                {[['Save %', r.ranks.svp], ['Saved vs avg', r.ranks.gsaa], ['Quality starts', r.ranks.qs], ['Even strength', r.ranks.ev]].map(([k, v]) => <div key={k as string} className="rounded-xl bg-white/[.03] px-1 py-1.5 ring-1 ring-white/[.06]"><div className="num text-sm font-bold text-white">{v ? ord(v as number) : '–'}</div><div className="text-[10px] leading-tight text-mute">{k}</div></div>)}
              </div>
            </div>
          )}
          {r.seasons.length > 1 && <SeasonTrend r={r} />}
          {r.weakAreas.length > 0 && <p className="text-[13px] leading-snug text-slate-300"><b className="text-white">Where shooters are beating him:</b> {r.weakAreas.join(', ')} (bottom quarter of the league&apos;s goalies there).</p>}
        </div>
      )}
    </div>
  );
}

// each season's save percentage against the league's that season
function SeasonTrend({ r }: { r: GoalieRead }) {
  const rows = r.seasons.filter((s) => s.delta != null);
  const max = Math.max(0.01, ...rows.map((s) => Math.abs(s.delta!)));
  return (
    <div className="text-sm">
      <div className="label">Against the league, season by season</div>
      <div className="mt-1 space-y-1">
        {rows.map((s) => (
          <div key={s.season} className="flex items-center gap-2">
            <span className="num w-14 shrink-0 text-[11px] text-slate-300">{String(s.season).slice(0, 4)}-{String(s.season).slice(6)}</span>
            <NhlLogo abbr={s.team} size={14} />
            <div className="relative h-2.5 min-w-0 flex-1 rounded-full bg-white/[.05]">
              <span className="absolute left-1/2 top-[-2px] h-[14px] w-px bg-white/30" />
              <div className="absolute top-0 h-2.5 rounded-full" style={{ left: s.delta! >= 0 ? '50%' : `${50 - (Math.abs(s.delta!) / max) * 50}%`, width: `${(Math.abs(s.delta!) / max) * 50}%`, background: s.delta! >= 0 ? 'rgb(52 211 153 / .85)' : 'rgb(248 113 113 / .85)' }} />
            </div>
            <span className="num w-12 shrink-0 text-right text-[11px] text-white">{sv(s.svp)}</span>
            <span className="num w-8 shrink-0 text-right text-[10px] text-mute">{s.gp}gp</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Market({ list }: { list: MarketGoalie[] }) {
  const info = usePlayerInfo();
  return (
    <div className="card p-4">
      <b className="text-white">If the crease needs help: the market</b>
      <p className="text-xs text-mute">Goalies above this club&apos;s starter over this season and last, sellers first (clubs under a 35% playoff chance). What each would add over the rest of the season, in wins.</p>
      <div className="mt-2 divide-y divide-white/[.05]">
        {list.map((g) => (
          <button key={g.id} type="button" onClick={() => info?.(g.id)} className="flex w-full items-center gap-2.5 py-2 text-left">
            <NhlLogo abbr={g.team} size={24} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5 text-sm"><b className="text-white">{g.name}</b><span className="text-[11px] text-mute">{g.team}{g.age != null ? ` · ${g.age}` : ''}</span>{g.seller && <span className="rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-bold text-amber-200 ring-1 ring-amber-400/30">Seller</span>}</span>
              <span className="block text-[11px] leading-snug text-mute">{g.note}</span>
            </span>
            <span className="shrink-0 text-right"><span className="num block font-display text-lg font-extrabold text-emerald-300">+{g.addWins.toFixed(1)}</span><span className="block text-[10px] text-mute">wins</span></span>
          </button>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-mute">Contracts and the salary cap aren&apos;t in the NHL&apos;s free feeds, so cap fit isn&apos;t judged here.</p>
    </div>
  );
}
