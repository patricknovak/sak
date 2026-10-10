// The pieces of a prediction pool (docs/POOLS.md): a question card whose answers carry live prices, the price chart,
// and the sheet where a member calls an answer or sells it back. Prices read as chances; a share of the right answer
// pays one coin. Everything is in the pool's own coins and colours.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { countdown, ago } from '../lib/format';
import { useBrand } from '../lib/brand';
import { answerColor, isOpen, pct, prices, quoteBuy, quoteSell, type PoolMarket, type PoolPosition, type PoolTrade } from '../lib/pool';
import { Sheet, TeamBadge, useAction } from './ui';
import { trackFirstCall } from '../lib/analytics';

// the pool's coin, with its name ("1,250 Goblets")
export function Coins({ n, className = '' }: { n: number | null | undefined; className?: string }) {
  const brand = useBrand();
  return <span className={`num whitespace-nowrap ${className}`}>{brand.coin.emoji} {Math.round(n ?? 0).toLocaleString()}</span>;
}

// how long until a question closes, in words
export function closesIn(m: PoolMarket, now: number) {
  if (m.status === 'resolved') return 'Settled';
  if (m.status === 'void') return 'Voided';
  const ms = new Date(m.closes_at).getTime() - now;
  if (ms <= 0) return 'Closed · waiting on the host';
  if (ms < 864e5) return `Closes in ${countdown(ms)}`;
  return `Closes ${new Date(m.closes_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
}

// one answer: its colour, its words, its chance as a bar and a number
function AnswerRow({ m, k, p, mine, won }: { m: PoolMarket; k: string; p: number; mine?: boolean; won?: boolean }) {
  const color = answerColor(m, k);
  const label = m.outcomes.find((o) => o.key === k)?.label;
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[.06] bg-white/[.03]">
      <div className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, p * 100)}%`, background: `linear-gradient(90deg, ${color}38, ${color}14)` }} />
      <div className="relative flex items-center gap-2 px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug text-slate-100">{label}</span>
        {mine && <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">yours</span>}
        {won && <span className="shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">✓ it was</span>}
        <span className="num shrink-0 font-display text-lg font-extrabold" style={{ color }}>{pct(p)}</span>
      </div>
    </div>
  );
}

// a question on the board: tap it for the chart and the trade
export function MarketCard({ m, positions, trades, compact }: { m: PoolMarket; positions: PoolPosition[]; trades: PoolTrade[]; compact?: boolean }) {
  const { me } = useLeague();
  const now = useNow(30000);
  const p = prices(m.q, Number(m.b));
  const mine = new Set(positions.filter((x) => x.market_id === m.id && x.team_id === me?.id && x.shares > 0.0001).map((x) => x.outcome));
  const n = trades.filter((t) => t.market_id === m.id).length;
  const order = [...m.outcomes].sort((a, b) => (m.outcomes.length > 3 ? p[b.key] - p[a.key] : 0));
  const shown = compact ? order.slice(0, 3) : order;
  const open = isOpen(m, now);
  return (
    <Link to={`/q/${m.id}`} className="card group block p-4 transition hover:border-gold/30 active:scale-[.99]">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[.14em]">
        {m.category && <span className="text-gold">{m.category}</span>}
        <span className={open ? 'text-mute' : m.status === 'resolved' ? 'text-emerald-300' : 'text-amber-300'}>{closesIn(m, now)}</span>
      </div>
      <h3 className="mb-3 break-words font-display text-xl font-extrabold leading-tight text-white">{m.title}</h3>
      <div className="space-y-1.5">
        {shown.map((o) => <AnswerRow key={o.key} m={m} k={o.key} p={p[o.key]} mine={mine.has(o.key)} won={m.winner_key === o.key} />)}
        {shown.length < m.outcomes.length && <div className="px-1 text-xs text-mute">+{m.outcomes.length - shown.length} more answers</div>}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-mute">
        <span>{n === 0 ? 'No calls yet. Be first.' : `${n} call${n === 1 ? '' : 's'}`}</span>
        <span className="font-semibold text-gold transition group-hover:translate-x-0.5">{open ? 'Call it →' : 'See it →'}</span>
      </div>
    </Link>
  );
}

// the price of every answer over time, from the trades (each trade records every price after it)
export function PriceChart({ m, trades, height = 150 }: { m: PoolMarket; trades: PoolTrade[]; height?: number }) {
  const series = useMemo(() => {
    const ts = trades.filter((t) => t.market_id === m.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const even = Object.fromEntries(m.outcomes.map((o) => [o.key, 1 / m.outcomes.length]));
    const pts = [{ t: new Date(m.created_at).getTime(), p: even as Record<string, number> }, ...ts.map((t) => ({ t: new Date(t.created_at).getTime(), p: t.prices }))];
    const end = m.status === 'open' ? Math.min(Date.now(), new Date(m.closes_at).getTime()) : new Date(m.resolved_at ?? m.closes_at).getTime();
    pts.push({ t: Math.max(end, pts[pts.length - 1].t), p: pts[pts.length - 1].p });
    return pts;
  }, [m, trades]);
  const W = 340, H = height, pad = 6;
  const t0 = series[0].t, t1 = Math.max(series[series.length - 1].t, t0 + 1);
  const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (W - pad * 2);
  const y = (p: number) => pad + (1 - p) * (H - pad * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="How the chances moved">
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={pad} x2={W - pad} y1={y(g)} y2={y(g)} stroke="rgba(255,255,255,.07)" strokeDasharray="3 5" />)}
      <text x={pad + 2} y={y(0.5) - 4} fontSize="9" fill="rgba(148,163,184,.7)">50%</text>
      {m.outcomes.map((o) => {
        const c = answerColor(m, o.key);
        // a step line: the price holds until the next trade moves it
        const d = series.map((s, i) => `${i === 0 ? 'M' : 'H'}${x(s.t).toFixed(1)}${i === 0 ? ` ${y(s.p[o.key] ?? 0).toFixed(1)}` : ` V${y(s.p[o.key] ?? 0).toFixed(1)}`}`).join(' ');
        const last = series[series.length - 1];
        return (
          <g key={o.key}>
            <path d={d} fill="none" stroke={c} strokeWidth="2.2" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 4px ${c}88)` }} />
            <circle cx={x(last.t)} cy={y(last.p[o.key] ?? 0)} r="3.5" fill={c} stroke="#0b1222" strokeWidth="1.5" />
          </g>
        );
      })}
    </svg>
  );
}

// the trade: call an answer (buy) or sell what you hold back to the market
export function TradeSheet({ m, start, onClose, onDone, coins, held }: {
  m: PoolMarket; start: { key: string; side: 'buy' | 'sell' } | null; onClose: () => void; onDone: () => void; coins: number; held: Record<string, PoolPosition>;
}) {
  const brand = useBrand();
  const { busy, run } = useAction();
  const [side, setSide] = useState<'buy' | 'sell'>(start?.side ?? 'buy');
  const [key, setKey] = useState(start?.key ?? m.outcomes[0].key);
  const staked = Object.values(held).reduce((a, h) => a + Math.max(0, h.cost), 0);
  const room = Math.max(0, Math.min(coins, m.max_stake - staked));
  const [amount, setAmount] = useState(Math.min(100, room) || 0);
  const mine = held[key]?.shares ?? 0;
  const [sellShare, setSellShare] = useState(1);
  const p = prices(m.q, Number(m.b));
  const color = answerColor(m, key);
  const label = m.outcomes.find((o) => o.key === key)?.label ?? '';
  const buy = amount > 0 ? quoteBuy(m.q, Number(m.b), key, amount) : null;
  const sellN = Math.round(mine * sellShare * 1e6) / 1e6;
  const sell = sellN > 0 ? quoteSell(m.q, Number(m.b), key, sellN) : null;
  const go = () => run(async () => {
    if (side === 'buy') await rpc('pool_buy', { p_market: m.id, p_outcome: key, p_coins: amount });
    else await rpc('pool_sell', { p_market: m.id, p_outcome: key, p_shares: sellShare >= 0.999 ? null : sellN });
    trackFirstCall(side === 'buy' ? 'call' : 'sell');
    onDone(); onClose();
  }, side === 'buy' ? `Called it: ${label}` : `Sold ${label}`);
  return (
    <Sheet open onClose={onClose} title={m.title}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white/[.05] p-1">
          {(['buy', 'sell'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSide(s)} disabled={s === 'sell' && !Object.values(held).some((h) => h.shares > 0.0001)}
              className={`rounded-xl py-2 text-sm font-bold transition disabled:opacity-40 ${side === s ? 'bg-white/[.12] text-white shadow' : 'text-mute'}`}>
              {s === 'buy' ? 'Call it' : 'Sell back'}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {m.outcomes.filter((o) => side === 'buy' || (held[o.key]?.shares ?? 0) > 0.0001).map((o) => {
            const c = answerColor(m, o.key), on = o.key === key;
            return (
              <button key={o.key} type="button" onClick={() => setKey(o.key)}
                className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${on ? 'bg-white/[.08]' : 'border-white/[.06] bg-white/[.02]'}`}
                style={on ? { borderColor: c, boxShadow: `0 0 0 1px ${c}55, 0 8px 24px -14px ${c}` } : undefined}>
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c }} />
                <span className="min-w-0 flex-1 break-words text-sm font-semibold">{o.label}</span>
                <span className="num font-display text-lg font-extrabold" style={{ color: c }}>{pct(p[o.key])}</span>
              </button>
            );
          })}
        </div>
        {side === 'buy' ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="label">Your stake</span>
              <span className="text-xs text-mute">You have <b className="text-slate-200">{brand.coin.emoji} {coins.toLocaleString()}</b> · up to {room.toLocaleString()} here</span>
            </div>
            <div className="num text-center font-display text-5xl font-extrabold" style={{ color }}>{brand.coin.emoji} {amount}</div>
            <input type="range" min={0} max={room} step={5} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="w-full" style={{ accentColor: color }} aria-label="Stake" />
            <div className="flex flex-wrap gap-1.5">
              {[25, 50, 100, 250].filter((v) => v <= room).map((v) => <button key={v} type="button" className="btn-ghost btn-sm" onClick={() => setAmount(v)}>{v}</button>)}
              {room > 0 && <button type="button" className="btn-ghost btn-sm" onClick={() => setAmount(room)}>All {room}</button>}
            </div>
            {buy && (
              <div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-3 text-sm">
                <div className="flex justify-between"><span className="text-mute">If it&apos;s {label}</span><b className="num text-emerald-300">{brand.coin.emoji} {Math.floor(buy.shares).toLocaleString()}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-mute">The chance moves</span><b className="num">{pct(p[key])} → <span style={{ color }}>{pct(buy.after[key])}</span></b></div>
              </div>
            )}
            {room === 0 && <p className="text-sm text-amber-200">{coins <= 0 ? `No ${brand.coin.name.toLowerCase()} left to spend; the next drop brings more.` : 'You have the most this question takes.'}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between"><span className="label">Sell</span><span className="text-xs text-mute">You hold {Math.floor(mine).toLocaleString()} shares of {label}</span></div>
            <input type="range" min={0.05} max={1} step={0.05} value={sellShare} onChange={(e) => setSellShare(Number(e.target.value))} className="w-full" style={{ accentColor: color }} aria-label="How much to sell" />
            <div className="flex gap-1.5">{[0.25, 0.5, 1].map((v) => <button key={v} type="button" className="btn-ghost btn-sm" onClick={() => setSellShare(v)}>{v === 1 ? 'All' : `${v * 100}%`}</button>)}</div>
            {sell && (
              <div className="rounded-2xl border border-white/[.07] bg-white/[.03] p-3 text-sm">
                <div className="flex justify-between"><span className="text-mute">You get back</span><b className="num text-emerald-300">{brand.coin.emoji} {sell.coins.toLocaleString()}</b></div>
                <div className="mt-1 flex justify-between"><span className="text-mute">The chance moves</span><b className="num">{pct(p[key])} → {pct(sell.after[key])}</b></div>
              </div>
            )}
          </div>
        )}
        <button type="button" className="btn-gold w-full py-3.5 text-base" disabled={busy || (side === 'buy' ? amount < 1 : !sell)} onClick={go}>
          {side === 'buy' ? `Call it: ${label}` : `Sell for ${brand.coin.emoji} ${sell?.coins ?? 0}`}
        </button>
        <p className="text-center text-[11px] leading-relaxed text-mute">A share of the right answer pays {brand.coin.emoji} 1. Prices move with every call, so the earlier and bolder, the bigger the payout. {brand.coin.name} have no cash value, ever.</p>
      </div>
    </Sheet>
  );
}

// the latest calls in the pool, as a feed
export function CallsFeed({ trades, markets, limit = 8 }: { trades: PoolTrade[]; markets: PoolMarket[]; limit?: number }) {
  const { teams } = useLeague();
  const brand = useBrand();
  const byId = new Map(markets.map((m) => [m.id, m]));
  const rows = trades.slice(0, limit);
  if (!rows.length) return <div className="card p-4 text-sm text-mute">No calls yet. The first one sets the price.</div>;
  return (
    <div className="card divide-y divide-white/[.05] p-1">
      {rows.map((t) => {
        const m = byId.get(t.market_id), tm = teams.find((x) => x.id === t.team_id);
        if (!m) return null;
        const lbl = m.outcomes.find((o) => o.key === t.outcome)?.label, c = answerColor(m, t.outcome);
        return (
          <Link key={t.id} to={`/q/${m.id}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-white/[.03]">
            <TeamBadge team={tm} size={30} />
            <div className="min-w-0 flex-1 text-sm leading-snug">
              <b className="text-slate-100">{tm?.gm_name ?? tm?.name ?? 'Someone'}</b>{' '}
              <span className="text-mute">{t.shares > 0 ? 'called' : 'sold'}</span>{' '}
              <b style={{ color: c }}>{lbl}</b>
              <div className="break-words text-xs text-mute">{m.title}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-mute"><div className="num font-semibold text-slate-300">{brand.coin.emoji} {Math.abs(t.coins)}</div>{ago(t.created_at)}</div>
          </Link>
        );
      })}
    </div>
  );
}
