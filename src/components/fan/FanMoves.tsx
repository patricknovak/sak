// The moves (25 October 2026, Patrick: "what happens when a trade or injury happens to update the outlook and
// statistics, particularly the recent Hellebuyck trade to New Jersey?"): trades, claims, call-ups and the injury list as
// the NHL lists the roster today, each priced in goals a game and carried into the outlook (src/lib/fanDeep.ts,
// priceMoves). A goalie who just arrived gets his own card in the crease (CreaseArrival), his seasons against the league
// and the share of the starts the model gives him.
import { Link } from 'react-router-dom';
import { ArrowRight, HeartPulse, LogIn, LogOut, Shield } from 'lucide-react';
import { usePlayerInfo } from '../../lib/playerInfo';
import { pctWord } from '../../lib/share';
import type { MoveGoalie } from '../../lib/fanZone';
import type { MoveItem, MovePrice, Outlook } from '../../lib/fanDeep';
import { Head, pctStr } from './kit';

const signed = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const toneOf = (g: number) => (g >= 0.03 ? 'text-emerald-300' : g <= -0.03 ? 'text-red-300' : 'text-slate-300');
const ICON = { arrival: LogIn, gone: LogOut, hurt: HeartPulse, goalie: Shield } as const;
const KIND = { arrival: 'Arrival', gone: 'Gone', hurt: 'Injury', goalie: 'Crease' } as const;

export function FanMoves({ price, out, base, club, compact }: { price: MovePrice | null; out: Outlook | null; base: Outlook | null; club: string; compact?: boolean }) {
  if (!price) return null;
  const items = compact ? price.items.slice(0, 4) : price.items;
  if (!items.length && compact) return null;
  const more = price.items.length - items.length;
  return (
    <section className="space-y-3">
      <Head id="moves" title="The moves" sub="Trades, claims, call-ups and the injury list as the NHL lists the roster today, and what each does to the chances."
        right={compact ? <Link to={`/fans/${club}/analysis`} className="flex shrink-0 items-center gap-1 text-sm font-semibold" style={{ color: 'var(--club)' }}>All the moves<ArrowRight className="h-3.5 w-3.5" /></Link> : undefined} />
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {([
            ['Goals', signed(price.goals), 'a game, from here', toneOf(price.goals)],
            ['Points', signed(price.pts, 0), `over ${price.left} games left`, toneOf(price.goals)],
            ['Playoffs', out ? (base && Math.abs(base.playoffs - out.playoffs) >= 0.005 ? `${pctWord(base.playoffs)} → ${pctWord(out.playoffs)}` : pctWord(out.playoffs)) : '–', base && out ? 'before → after' : 'as it stands', 'text-white'],
          ] as const).map(([k, v, sub, tone]) => (
            <div key={k} className="min-w-0 rounded-2xl bg-black/25 px-2.5 py-2 ring-1 ring-white/10">
              <div className="label truncate">{k}</div>
              <div className={`num font-display text-[clamp(17px,5.2vw,24px)] font-extrabold leading-tight ${tone}`}>{v}</div>
              <div className="truncate text-[10px] text-mute">{sub}</div>
            </div>
          ))}
        </div>
      )}
      <div className="card divide-y divide-white/[.06] overflow-hidden">
        {items.length === 0 && <p className="p-4 text-sm text-slate-300">No trades, claims or injuries on the roster today. The outlook is the record and the roster as they stand.</p>}
        {items.map((it) => <MoveRow key={`${it.kind}:${it.id}:${it.name}`} it={it} />)}
        {more > 0 && <Link to={`/fans/${club}/analysis`} className="block p-3 text-center text-sm font-semibold" style={{ color: 'var(--club)' }}>{more} more on the analysis page</Link>}
      </div>
      {!compact && price.crease && (
        <p className="px-1 text-[12px] leading-snug text-mute">
          The crease: <b className="text-slate-200">{pctStr(price.crease.before.svp)}</b> expected from the goalies who played the games so far ({price.crease.before.who.map((w) => `${w.name.split(' ').slice(-1)[0]} ${Math.round(w.share * 100)}%`).join(', ')}),
          {' '}<b className="text-slate-200">{pctStr(price.crease.after.svp)}</b> from the roster now ({price.crease.after.who.map((w) => `${w.name.split(' ').slice(-1)[0]} ${Math.round(w.share * 100)}%`).join(', ')}).
          Each goalie is his save percentage over this season and the last three, pulled toward the league&apos;s by 2,000 shots. A skater&apos;s points are about a sixth of a goal a game each, half of it replaced by the next man up; six goals are a win.
        </p>
      )}
    </section>
  );
}

function MoveRow({ it }: { it: MoveItem }) {
  const info = usePlayerInfo();
  const Icon = ICON[it.kind];
  const initials = it.name.split(' ').map((w) => w[0]).slice(0, 2).join('');
  return (
    <div className="flex items-start gap-3 p-3.5">
      <button type="button" onClick={() => it.id && info?.(it.id)} className="relative shrink-0" aria-label={it.name}>
        {it.headshot ? <img src={it.headshot} alt="" loading="lazy" className="h-12 w-12 rounded-full bg-white/[.06] object-cover ring-2" style={{ '--tw-ring-color': 'rgb(var(--club-rgb) / .5)' } as React.CSSProperties} />
          : <span className="grid h-12 w-12 place-items-center rounded-full bg-white/[.06] font-display text-base font-extrabold text-slate-200 ring-2" style={{ '--tw-ring-color': 'rgb(var(--club-rgb) / .5)' } as React.CSSProperties}>{initials}</span>}
        <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full bg-[#0b1020] ring-1 ring-white/15"><Icon className="h-3 w-3" style={{ color: 'var(--club)' }} /></span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <button type="button" onClick={() => it.id && info?.(it.id)} className="font-semibold text-white">{it.name}</button>
          <span className="text-[11px] font-bold uppercase tracking-wide text-mute">{it.pos} · {KIND[it.kind]}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-snug text-slate-300">{it.text}</p>
      </div>
      <div className="shrink-0 text-right">
        <div className={`num font-display text-lg font-extrabold leading-none ${toneOf(it.goals)}`}>{Math.abs(it.goals) < 0.005 ? '·' : signed(it.goals)}</div>
        <div className="text-[10px] text-mute">goals a game</div>
      </div>
    </div>
  );
}

// a goalie who just arrived: no games for the club yet, so his seasons against the league and the model's plan for him
export function CreaseArrival({ g, price, seasons, lgSvp }: { g: MoveGoalie; price: MovePrice; seasons: { season: number; gp: number; svp: number | null; team: string | null }[]; lgSvp: Record<string, number> }) {
  const info = usePlayerInfo();
  const plan = price.crease?.after.who.find((w) => w.id === g.id);
  const rows = seasons.filter((s) => s.svp != null).sort((a, b) => b.season - a.season).slice(0, 5);
  const label = (s: number) => `${String(s).slice(2, 4)}-${String(s).slice(6, 8)}`;
  return (
    <div className="card overflow-hidden" style={{ background: 'linear-gradient(160deg, rgb(var(--club-rgb) / .16), transparent 60%)' }}>
      <button type="button" onClick={() => info?.(g.id)} className="flex w-full items-center gap-3 p-4 pb-2 text-left">
        {g.headshot ? <img src={g.headshot} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-full bg-white/[.06] object-cover ring-2" style={{ '--tw-ring-color': 'rgb(var(--club-rgb) / .5)' } as React.CSSProperties} /> : <span className="h-14 w-14 shrink-0 rounded-full bg-white/[.06]" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><b className="text-white">{g.name}</b><span className="rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset bg-emerald-500/15 text-emerald-200 ring-emerald-400/30">New in the crease</span></div>
          <div className="text-[12px] text-mute">{g.from ? `From ${g.from}` : 'Joins the roster'}{g.hurt ? ` · ${g.hurt.status}${g.hurt.back ? `, back around ${new Date(`${g.hurt.back}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}` : ''}</div>
        </div>
        {plan && <div className="shrink-0 text-right"><div className="num font-display text-2xl font-extrabold leading-none" style={{ color: 'var(--club)' }}>{Math.round(plan.share * 100)}%</div><div className="text-[10px] text-mute">of the starts</div></div>}
      </button>
      <div className="px-4 pb-4">
        {g.prior && g.prior.sa > 0 && <p className="text-sm leading-snug text-slate-300">{pctStr(g.prior.svp ?? 0)} over his last three seasons on {g.prior.sa.toLocaleString()} shots{g.season && g.season.sa ? `, ${pctStr(g.season.svp ?? 0)} on ${g.season.sa} this season` : ', no games yet this season'}. The model&apos;s read of him from here: <b className="text-white">{pctStr(plan?.talent ?? 0)}</b>.</p>}
        {rows.length > 0 && (
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {rows.map((s) => {
              const lg = lgSvp[String(s.season)], delta = lg != null && s.svp != null ? s.svp - lg : null;
              return (
                <div key={s.season} className="rounded-xl bg-black/25 px-1.5 py-1.5 text-center ring-1 ring-white/10">
                  <div className="text-[10px] text-mute">{label(s.season)}{s.team ? ` ${s.team}` : ''}</div>
                  <div className="num text-sm font-bold text-white">{pctStr(s.svp ?? 0)}</div>
                  <div className={`num text-[10px] font-semibold ${delta == null ? 'text-mute' : delta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{delta == null ? `${s.gp} gp` : `${delta >= 0 ? '+' : '−'}${Math.abs(delta * 1000).toFixed(0)}`}</div>
                </div>
              );
            })}
          </div>
        )}
        {price.crease && (
          <p className="mt-3 text-[13px] leading-snug text-slate-300">The crease goes from <b className="text-white">{pctStr(price.crease.before.svp)}</b> expected to <b className="text-white">{pctStr(price.crease.after.svp)}</b>: <b className={toneOf(price.crease.goals)}>{signed(price.crease.goals)}</b> goals a game, about <b className={toneOf(price.crease.goals)}>{signed((price.crease.goals * price.left * 2) / 6, 0)}</b> points over the {price.left} games left. Priced into the outlook.</p>
        )}
      </div>
    </div>
  );
}
