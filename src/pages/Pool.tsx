// A prediction pool's pages (docs/POOLS.md): the home (your coins, the next drop, what is closing, the latest calls),
// the board of questions, one question with its chart and its trade, the leaders, and the host's desk. A pool of kind
// 'predict' sees only these; a fantasy league reaches the board from More.
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarClock, Crown, Flame, Link2, Plus, Sparkles, Trophy, Wand2 } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { useBrand } from '../lib/brand';
import { rpc } from '../lib/supabase';
import { ago, countdown } from '../lib/format';
import { answerColor, isOpen, pct, prices, usePool, useCoins, type PoolLeader, type PoolMarket, type PoolPosition } from '../lib/pool';
import { CallsFeed, closesIn, Coins, MarketCard, PriceChart, TradeSheet } from '../components/Pool';
import { Empty, PageHeader, Rank, Section, TeamBadge, useAction } from '../components/ui';
import { useEffect } from 'react';
import { appLink } from '../lib/host';
import { shareCard, type CardBrand } from '../lib/shareCard';
import { SurvivorCard, SurvivorStart, useSurvivor } from './Survivor';
import { AskSheet } from '../components/AskSheet';
import { PoolHowTo } from '../components/PoolHowTo';
import { PredictorCard, PredictorStart, usePredictor } from './Predictor';
import { Share2 } from 'lucide-react';

function useLeaders() {
  const [rows, setRows] = useState<PoolLeader[] | null>(null);
  const load = () => rpc<PoolLeader[]>('pool_leaders').then((r) => setRows(r.map((x) => ({ ...x, holdings: Number(x.holdings), worth: Number(x.worth) }))), () => setRows([]));
  useEffect(() => { load(); }, []);
  return { leaders: rows, reloadLeaders: load };
}

// the host's soccer desk: each competition's next matchweek, added as questions in one tap (migration 148). Hidden
// until the match feed has fixtures to offer.
interface SoccerRound { competition: string; name: string; short: string; gameweek: number; first_kickoff: string; matches: number; added: number }
function SoccerRounds({ onAdded }: { onAdded: () => void }) {
  const [rows, setRows] = useState<SoccerRound[]>([]);
  const { busy, run } = useAction();
  const load = () => rpc<SoccerRound[]>('soccer_rounds').then(setRows, () => setRows([]));
  useEffect(() => { load(); }, []);
  if (!rows.length) return null;
  return (
    <Section title="Soccer matchweeks">
      <div className="space-y-2">
        {rows.map((r) => {
          const left = r.matches - r.added;
          return (
            <div key={r.competition} className="card flex flex-wrap items-center gap-3 p-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-400/15 text-xl" aria-hidden>⚽</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-mute"><span className="mr-1.5 inline-block whitespace-nowrap rounded-full bg-sky-400/15 px-2 py-0.5 text-[11px] font-bold tracking-wide text-sky-300">Matchweek {r.gameweek}</span>{r.matches} {r.matches === 1 ? 'match' : 'matches'} · first kick-off {new Date(r.first_kickoff).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </div>
              {left > 0
                ? <button type="button" className="btn-gold shrink-0" disabled={busy} onClick={() => run(async () => { await rpc('pool_add_fixtures', { p_competition: r.competition, p_gameweek: r.gameweek }); load(); onAdded(); }, `${r.short} matchweek ${r.gameweek} is up`)}>Add {left}</button>
                : <span className="shrink-0 text-sm font-semibold text-emerald-300">All added ✓</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-mute">Each match is home, draw or away after ninety minutes, closes at kick-off and settles itself at the final whistle.</p>
    </Section>
  );
}

// ───────────── home ─────────────
export function PoolHome() {
  const { me, league } = useLeague();
  const brand = useBrand();
  const now = useNow(1000);
  const { markets, positions, trades, drops } = usePool();
  const { coins } = useCoins(me?.id);
  const { leaders } = useLeaders();
  const nextDrop = drops.find((d) => new Date(d.at).getTime() > now);
  const rank = leaders ? leaders.findIndex((l) => l.team_id === me?.id) + 1 : 0;
  const mine = leaders?.find((l) => l.team_id === me?.id);
  const open = (markets ?? []).filter((m) => isOpen(m, now));
  const closing = [...open].sort((a, b) => a.closes_at.localeCompare(b.closes_at)).slice(0, 4);
  const hot = useMemo(() => {
    const day = now - 864e5, n = new Map<number, number>();
    trades.forEach((t) => { if (new Date(t.created_at).getTime() > day) n.set(t.market_id, (n.get(t.market_id) ?? 0) + 1); });
    return open.filter((m) => n.has(m.id)).sort((a, b) => (n.get(b.id) ?? 0) - (n.get(a.id) ?? 0)).slice(0, 2);
  }, [trades, open.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const settle = (markets ?? []).filter((m) => m.status === 'open' && !isOpen(m, now));
  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-[28px] border border-gold/25 p-5" style={{ background: 'radial-gradient(120% 90% at 0% 0%, rgb(var(--gold-rgb)/.30), transparent 55%), radial-gradient(90% 80% at 100% 100%, rgba(167,139,250,.20), transparent 60%), linear-gradient(160deg,#1a1430,#0b1222 70%)' }}>
        <div className="text-[11px] font-bold uppercase tracking-[.22em] text-gold">{brand.tagline || league?.name}</div>
        <h1 className="mt-1 font-display text-[40px] font-extrabold italic leading-[.95] text-white">Hi {me?.gm_name?.split(' ')[0] ?? 'there'}.<br /><span className="text-gold">Call it.</span></h1>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-black/25 px-3 py-2.5 ring-1 ring-white/10"><div className="label">To spend</div><div className="font-display text-2xl font-extrabold text-white"><Coins n={coins} /></div></div>
          <div className="rounded-2xl bg-black/25 px-3 py-2.5 ring-1 ring-white/10"><div className="label">Worth</div><div className="font-display text-2xl font-extrabold text-white"><Coins n={mine?.worth} /></div></div>
          <div className="rounded-2xl bg-black/25 px-3 py-2.5 ring-1 ring-white/10"><div className="label">Rank</div><div className="font-display text-2xl font-extrabold text-white">{rank ? `${rank}` : '–'}<span className="text-sm font-bold text-mute"> of {leaders?.length ?? '–'}</span></div></div>
        </div>
        {nextDrop && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-white/[.06] px-3 py-2.5 ring-1 ring-white/10">
            <CalendarClock className="h-5 w-5 shrink-0 text-gold" />
            <div className="min-w-0 flex-1 text-sm leading-snug"><b className="text-white">{nextDrop.note}</b><div className="text-xs text-mute">+{nextDrop.amount} {brand.coin.name.toLowerCase()} for everyone</div></div>
            <div className="num shrink-0 text-right font-display text-lg font-extrabold text-gold">{countdown(new Date(nextDrop.at).getTime() - now)}</div>
          </div>
        )}
      </div>

      {me?.role === 'gm' && <PoolHowTo league={league?.league_id ?? 0} />}

      {me?.is_commish && settle.length > 0 && (
        <Link to="/host" className="card flex items-center gap-3 border-amber-400/30 bg-amber-400/[.06] p-4">
          <Wand2 className="h-6 w-6 text-amber-300" />
          <div className="flex-1 text-sm"><b>{settle.length} question{settle.length === 1 ? '' : 's'} closed and waiting for you</b><div className="text-xs text-mute">Settle them so the pool gets paid.</div></div>
          <span className="text-amber-300">→</span>
        </Link>
      )}

      {markets === null ? <div className="h-40 animate-pulse rounded-3xl bg-white/[.04]" /> : !markets.length ? (
        <Empty icon="🔮" title="No questions yet">{me?.is_commish ? <Link to="/host" className="btn-gold mt-3 inline-block">Ask the first one</Link> : 'The host is writing them. Check back soon.'}</Empty>
      ) : (
        <>
          {hot.length > 0 && <Section title="Moving now" icon={<Flame className="h-5 w-5 text-gold" />}><div className="grid gap-3 md:grid-cols-2">{hot.map((m) => <MarketCard key={m.id} m={m} positions={positions} trades={trades} compact />)}</div></Section>}
          <Section title="Closing soon" icon={<CalendarClock className="h-5 w-5 text-gold" />} right={<Link to="/questions" className="text-sm font-semibold text-sky-300">All {markets.length} →</Link>}>
            {closing.length ? <div className="grid gap-3 md:grid-cols-2">{closing.map((m) => <MarketCard key={m.id} m={m} positions={positions} trades={trades} compact />)}</div>
              : <div className="card p-4 text-sm text-mute">Nothing open right now. New questions land with each drop.</div>}
          </Section>
        </>
      )}
      <PredictorCard />
      <SurvivorCard />
      <Section title="Latest calls" icon={<Sparkles className="h-5 w-5 text-gold" />}><CallsFeed trades={trades} markets={markets ?? []} /></Section>
      <InviteCard />
    </div>
  );
}

// the host's open link, shared from the phone; members are pointed at the host
function InviteCard() {
  const { me, league } = useLeague();
  const brand = useBrand();
  const { busy, run } = useAction();
  const [link, setLink] = useState<string | null>(null);
  const make = () => run(async () => {
    const code = await rpc<string>('pool_invite_link', { p_days: 30, p_uses: 50 });
    const url = appLink(`/join/${code}`);
    setLink(url);
    const text = `Join my ${brand.tagline || league?.name} on Super Pools. No money, just bragging rights.`;
    if (navigator.share) await navigator.share({ title: league?.name, text, url }).catch(() => {});
    else await navigator.clipboard?.writeText(url).catch(() => {});
  });
  return (
    <div className="card relative overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/20 blur-3xl" />
      <div className="relative">
        <h3 className="font-display text-2xl font-extrabold text-white">Better with the group chat</h3>
        <p className="mt-1 text-sm text-mute">Everyone gets the same {brand.coin.name.toLowerCase()} to start, and every drop. One tap to join, nothing to download.</p>
        {me?.is_commish ? (
          <>
            <button className="btn-gold mt-3 inline-flex items-center gap-2" disabled={busy} onClick={make}><Link2 className="h-4 w-4" /> Share the invite link</button>
            {link && <div className="mt-2 break-all rounded-xl bg-black/30 px-3 py-2 text-xs text-sky-200">{link}</div>}
          </>
        ) : <p className="mt-3 text-sm text-slate-300">Ask the host for the link and send it to your friends.</p>}
      </div>
    </div>
  );
}

// ───────────── the board ─────────────
export function Questions() {
  const { markets, positions, trades } = usePool();
  const now = useNow(30000);
  const [tab, setTab] = useState<'open' | 'mine' | 'settled'>('open');
  const { me } = useLeague();
  const list = (markets ?? []).filter((m) => tab === 'open' ? m.status === 'open'
    : tab === 'settled' ? m.status !== 'open'
    : positions.some((p) => p.market_id === m.id && p.team_id === me?.id && (p.shares > 0.0001 || p.paid > 0)));
  const groups = useMemo(() => {
    const g = new Map<string, PoolMarket[]>();
    list.forEach((m) => { const k = m.category ?? 'Questions'; g.set(k, [...(g.get(k) ?? []), m]); });
    return [...g.entries()];
  }, [list]);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Sparkles className="h-6 w-6 text-gold" />} title="Questions" sub="Every answer has a price. Call it before your friends do." />
      <div className="flex gap-1.5">
        {(['open', 'mine', 'settled'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${tab === t ? 'bg-gold text-[#2a0a14]' : 'bg-white/[.06] text-mute'}`}>
            {t === 'open' ? 'Open' : t === 'mine' ? 'My calls' : 'Settled'}
          </button>
        ))}
      </div>
      {markets === null ? <div className="h-40 animate-pulse rounded-3xl bg-white/[.04]" />
        : !list.length ? <Empty icon="🔮" title={tab === 'mine' ? 'No calls yet' : tab === 'settled' ? 'Nothing settled yet' : 'Nothing open'}>{tab === 'mine' ? 'Pick a question and call it.' : null}</Empty>
        : groups.map(([g, ms]) => (
          <Section key={g} title={g}>
            <div className="grid gap-3 md:grid-cols-2">{ms.map((m) => <MarketCard key={m.id} m={m} positions={positions} trades={trades} />)}</div>
          </Section>
        ))}
      <p className="px-1 text-xs text-mute">{now ? 'Prices are the pool’s chances: they move with every call and add up to 100%.' : null}</p>
    </div>
  );
}

// ───────────── one question ─────────────
export function Question() {
  const { id } = useParams();
  const { me, teams } = useLeague();
  const brand = useBrand();
  const now = useNow(1000);
  const nav = useNavigate();
  const { markets, positions, trades, reload } = usePool();
  const { coins, reloadCoins } = useCoins(me?.id);
  const [trade, setTrade] = useState<{ key: string; side: 'buy' | 'sell' } | null>(null);
  const cardBrand = useCardBrand();
  const m = markets?.find((x) => x.id === Number(id));
  if (markets === null) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!m) return <Empty icon="🔮" title="That question isn’t here"><Link to="/questions" className="text-sky-300">Back to the questions</Link></Empty>;
  const p = prices(m.q, Number(m.b));
  const open = isOpen(m, now);
  const held: Record<string, PoolPosition> = Object.fromEntries(positions.filter((x) => x.market_id === m.id && x.team_id === me?.id).map((x) => [x.outcome, x]));
  const mineList = Object.values(held).filter((h) => h.shares > 0.0001 || h.paid > 0);
  const value = mineList.reduce((a, h) => a + h.shares * (p[h.outcome] ?? 0), 0);
  const ts = trades.filter((t) => t.market_id === m.id);
  const holders = new Map<string, number>();
  positions.filter((x) => x.market_id === m.id && x.shares > 0.0001).forEach((x) => holders.set(x.outcome, (holders.get(x.outcome) ?? 0) + 1));
  return (
    <div className="space-y-5">
      <button type="button" onClick={() => nav(-1)} className="text-sm text-mute">← Back</button>
      <div>
        <div className="mb-1 flex flex-wrap gap-x-2 text-[11px] font-bold uppercase tracking-[.14em]">
          {m.category && <span className="text-gold">{m.category}</span>}
          <span className="text-mute">{closesIn(m, now)}</span>
        </div>
        <h1 className="break-words font-display text-[32px] font-extrabold leading-[1.02] text-white">{m.title}</h1>
      </div>
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {m.outcomes.map((o) => <span key={o.key} className="flex items-center gap-1.5 text-xs font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: answerColor(m, o.key) }} />{o.label} <b className="num" style={{ color: answerColor(m, o.key) }}>{pct(p[o.key])}</b></span>)}
        </div>
        <PriceChart m={m} trades={ts} />
        <div className="mt-1 text-right text-[11px] text-mute">{ts.length} call{ts.length === 1 ? '' : 's'} · opened {ago(m.created_at)}</div>
      </div>

      <div className="space-y-2">
        {m.outcomes.map((o) => {
          const c = answerColor(m, o.key), h = held[o.key];
          return (
            <div key={o.key} className="card flex items-center gap-3 p-3" style={m.winner_key === o.key ? { borderColor: '#34d399aa' } : undefined}>
              <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: c }} />
              <div className="min-w-0 flex-1">
                <div className="break-words font-semibold text-white">{o.label} {m.winner_key === o.key && <span className="text-emerald-300">✓</span>}</div>
                <div className="text-xs text-mute">{holders.get(o.key) ?? 0} holding{h && h.shares > 0.0001 ? ` · you: ${Math.floor(h.shares)} shares` : ''}</div>
              </div>
              <div className="num font-display text-2xl font-extrabold" style={{ color: c }}>{pct(p[o.key])}</div>
              {open && me?.role === 'gm' && <button type="button" className="btn-gold btn-sm" onClick={() => setTrade({ key: o.key, side: 'buy' })}>Call</button>}
            </div>
          );
        })}
      </div>

      {mineList.length > 0 && (
        <div className="card p-4">
          <div className="label mb-2">Your position</div>
          {mineList.map((h) => {
            const lbl = m.outcomes.find((o) => o.key === h.outcome)?.label;
            return (
              <div key={h.outcome} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span><b style={{ color: answerColor(m, h.outcome) }}>{lbl}</b> · {Math.floor(h.shares).toLocaleString()} shares</span>
                <span className="text-mute">{m.status === 'resolved' ? (h.paid ? <b className="text-emerald-300">won <Coins n={h.paid} /></b> : 'no payout') : <>pays <Coins n={Math.floor(h.shares)} /> if right</>}</span>
              </div>
            );
          })}
          {open && <div className="mt-2 flex items-center justify-between text-sm"><span className="text-mute">Worth now</span><b><Coins n={value} /></b></div>}
          {(() => {
            // the card: the call that came in once it settles, else the biggest call still riding
            const won = mineList.filter((h) => h.paid > 0).sort((a, b) => b.paid - a.paid)[0];
            const big = mineList.filter((h) => h.shares > 0.0001).sort((a, b) => b.shares - a.shares)[0];
            const h = m.status === 'resolved' ? won : big;
            if (!h || (m.status !== 'resolved' && m.status !== 'open')) return null;
            const answer = m.outcomes.find((o) => o.key === h.outcome)?.label ?? '';
            const base = { brand: cardBrand, who: me?.gm_name ?? '', question: m.title, answer, answerColor: answerColor(m, h.outcome), staked: Math.max(0, h.cost) };
            return (
              <div className={`mt-3 grid gap-2 ${open ? 'grid-cols-2' : ''}`}>
                {open && <button type="button" className="btn-ghost w-full" onClick={() => setTrade({ key: mineList[0].outcome, side: 'sell' })}>Sell back</button>}
                <ShareButton className={m.status === 'resolved' ? 'btn-gold w-full' : 'btn-ghost w-full'} label={m.status === 'resolved' ? 'Share the win' : 'Share my call'}
                  make={() => (m.status === 'resolved'
                    ? shareCard({ kind: 'won', ...base, won: h.paid }, `Called it in ${cardBrand.pool}: ${answer}.`)
                    : shareCard({ kind: 'call', ...base, chance: h.shares > 0 ? Math.min(0.99, Math.max(0.01, h.cost / h.shares)) : p[h.outcome] ?? 0, pays: h.shares }, `My call in ${cardBrand.pool}: ${answer}.`))} />
              </div>
            );
          })()}
        </div>
      )}

      {m.status === 'resolved' && m.winner_key && (() => {
        // who called it: everyone holding the answer that came in, biggest payout first
        const won = positions.filter((x) => x.market_id === m.id && x.outcome === m.winner_key && Number(x.shares) >= 1)
          .map((x) => ({ team: teams.find((t) => t.id === x.team_id), paid: Number(x.paid) || Math.floor(Number(x.shares)), price: Number(x.shares) > 0 ? Number(x.cost) / Number(x.shares) : 0 }))
          .sort((a, b) => b.paid - a.paid);
        const missed = new Set(positions.filter((x) => x.market_id === m.id && x.outcome !== m.winner_key && Number(x.shares) > 0.0001).map((x) => x.team_id)).size;
        return (
          <Section title="Who called it">
            {won.length ? (
              <div className="card divide-y divide-white/[.05] p-1">
                {won.map((w) => (
                  <div key={w.team?.id} className={`flex items-center gap-3 px-3 py-2.5 ${w.team?.id === me?.id ? 'rounded-xl bg-gold/[.07]' : ''}`}>
                    <TeamBadge team={w.team} size={30} />
                    <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-white">{w.team?.gm_name ?? w.team?.name}</span><span className="block text-[11px] text-mute">called at {pct(w.price)}</span></span>
                    <b className="shrink-0 text-emerald-300">+<Coins n={w.paid} /></b>
                  </div>
                ))}
              </div>
            ) : <div className="card p-4 text-sm text-mute">Nobody called it. The long shot came in.</div>}
            {missed > 0 && <p className="mt-2 px-1 text-xs text-mute">{missed} {missed === 1 ? 'player' : 'players'} called something else.</p>}
          </Section>
        );
      })()}

      <div className="card p-4">
        <div className="label mb-1">How it settles</div>
        <p className="text-sm leading-relaxed text-slate-300">{m.rule || 'The host settles it from what airs.'}</p>
        {m.note && <p className="mt-2 text-sm text-emerald-200">Host’s note: {m.note}</p>}
        <p className="mt-2 text-xs text-mute">Up to {m.max_stake} {brand.coin.name.toLowerCase()} a person on this one. A share of the right answer pays {brand.coin.emoji} 1.</p>
      </div>

      <Section title="Calls on this one">
        {ts.length ? (
          <div className="card divide-y divide-white/[.05] p-1">
            {ts.slice(0, 20).map((t) => {
              const tm = teams.find((x) => x.id === t.team_id);
              return (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <TeamBadge team={tm} size={26} />
                  <span className="min-w-0 flex-1"><b>{tm?.gm_name ?? tm?.name}</b> <span className="text-mute">{t.shares > 0 ? 'called' : 'sold'}</span> <b style={{ color: answerColor(m, t.outcome) }}>{m.outcomes.find((o) => o.key === t.outcome)?.label}</b></span>
                  <span className="text-xs text-mute">{ago(t.created_at)}</span>
                </div>
              );
            })}
          </div>
        ) : <div className="card p-4 text-sm text-mute">Nobody has called it yet. The first call sets the price.</div>}
      </Section>
      {me?.is_commish && <HostSettle m={m} onDone={() => { reload(); reloadCoins(); }} />}
      {trade && coins !== null && <TradeSheet m={m} start={trade} coins={coins} held={held} onClose={() => setTrade(null)} onDone={() => { reload(); reloadCoins(); }} />}
    </div>
  );
}

// the host settles or voids a question, with a reason the pool sees
function HostSettle({ m, onDone }: { m: PoolMarket; onDone: () => void }) {
  const { busy, run } = useAction();
  const [win, setWin] = useState<string>('');
  const [note, setNote] = useState('');
  const [closeAt, setCloseAt] = useState('');
  if (m.status === 'void') return null;
  return (
    <div className="card border-gold/25 p-4">
      <div className="label mb-2">Host · settle this question</div>
      {m.status === 'open' && (
        <>
          <select className="input w-full" value={win} onChange={(e) => setWin(e.target.value)}>
            <option value="">Pick what happened…</option>
            {m.outcomes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          <input className="input mt-2 w-full" placeholder="A note for the pool (optional): which episode, what happened" value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} />
          <button type="button" className="btn-gold mt-2 w-full" disabled={busy || !win}
            onClick={() => confirm(`Settle "${m.title}" as ${m.outcomes.find((o) => o.key === win)?.label}? Everyone holding it gets paid.`) && run(async () => { await rpc('pool_resolve', { p_market: m.id, p_winner: win, p_note: note || null }); onDone(); }, 'Settled')}>
            Settle it
          </button>
          <div className="mt-3 flex gap-2">
            <input className="input flex-1" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} aria-label="New closing time" />
            <button type="button" className="btn-ghost" disabled={busy || !closeAt} onClick={() => run(async () => { await rpc('pool_edit', { p_market: m.id, p: { closes_at: new Date(closeAt).toISOString() } }); onDone(); }, 'Closing time moved')}>Move close</button>
          </div>
        </>
      )}
      <button type="button" className="btn-ghost mt-3 w-full text-rose-300" disabled={busy}
        onClick={() => confirm('Void it? Every stake goes back, and any payouts are taken back first.') && run(async () => { await rpc('pool_resolve', { p_market: m.id, p_winner: null, p_note: note || null }); onDone(); }, 'Voided; stakes refunded')}>
        Void it and refund everyone
      </button>
    </div>
  );
}

// ───────────── leaders ─────────────
// "Called it": the longest shot to come in so far, the winning call bought at the lowest average price, under even
// money (a call worth at least ten coins at the payout, so a stray share doesn't take it; the bigger payout breaks a tie)
function bestCall(markets: PoolMarket[], positions: PoolPosition[]) {
  let best: { team_id: number; price: number; paid: number; title: string; answer: string } | null = null;
  for (const m of markets) {
    if (m.status !== 'resolved' || !m.winner_key) continue;
    for (const p of positions) {
      if (p.market_id !== m.id || p.outcome !== m.winner_key || Number(p.shares) < 10 || Number(p.cost) <= 0) continue;
      const price = Number(p.cost) / Number(p.shares), paid = Number(p.paid) || Math.floor(Number(p.shares));
      if (price >= 0.5) continue;   // a favourite coming in is no long shot
      if (!best || price < best.price - 1e-9 || (Math.abs(price - best.price) < 1e-9 && paid > best.paid)) {
        best = { team_id: p.team_id, price, paid, title: m.title, answer: m.outcomes.find((o) => o.key === m.winner_key)?.label ?? '' };
      }
    }
  }
  return best;
}

export function PoolLeaders() {
  const { teams, me } = useLeague();
  const brand = useBrand();
  const cardBrand = useCardBrand();
  const { leaders } = useLeaders();
  const { markets, positions } = usePool();
  const best = useMemo(() => bestCall(markets ?? [], positions), [markets, positions]);
  const shareBoard = () => shareCard({ kind: 'leaders', brand: cardBrand, title: 'The standings',
    rows: (leaders ?? []).slice(0, 6).map((l) => { const t = teams.find((x) => x.id === l.team_id); return { name: t?.gm_name ?? t?.name ?? '', worth: l.worth, color: t?.color ?? cardBrand.color, me: l.team_id === me?.id }; }) },
    `The standings in ${cardBrand.pool}.`);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Crown className="h-6 w-6 text-gold" />} title="Leaders" sub={`Net worth: your ${brand.coin.name.toLowerCase()} plus your calls at today’s prices. ${brand.trophy ? `Top of the board takes ${brand.trophy}.` : ''}`} />
      {best && (() => {
        const t = teams.find((x) => x.id === best.team_id);
        return (
          <div className="relative overflow-hidden rounded-3xl border border-gold/30 p-4" style={{ background: 'radial-gradient(120% 120% at 0% 0%, rgb(var(--gold-rgb)/.22), transparent 60%), linear-gradient(160deg,#18142c,#0b1222 75%)' }}>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/20 text-2xl">🎯</span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[.2em] text-gold">Called it</div>
                <div className="break-words font-display text-lg font-extrabold leading-tight text-white">{t?.gm_name ?? t?.name}</div>
              </div>
              <div className="shrink-0 text-right"><div className="num font-display text-2xl font-extrabold text-gold">{pct(best.price)}</div><div className="text-[11px] text-mute">when called</div></div>
            </div>
            <p className="mt-3 text-sm leading-snug text-slate-200"><span className="text-white">{best.answer}</span> on “{best.title}”, the longest shot to come in so far. Paid <Coins n={best.paid} />.</p>
          </div>
        );
      })()}
      {leaders === null ? <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" /> : (
        <div className="card divide-y divide-white/[.05] p-1">
          {leaders.map((l, i) => {
            const t = teams.find((x) => x.id === l.team_id);
            return (
              <div key={l.team_id} className={`flex items-center gap-3 rounded-xl px-3 py-3 ${l.team_id === me?.id ? 'bg-gold/[.07]' : ''}`}>
                <Rank n={i + 1} />
                <TeamBadge team={t} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="break-words font-semibold text-white">{t?.gm_name ?? t?.name}</span>{best?.team_id === l.team_id && <span className="rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-gold ring-1 ring-gold/40">🎯 Called it</span>}</div>
                  <div className="text-xs text-mute">{l.calls ? `${l.hits} of ${l.calls} called right` : 'No settled calls yet'} · {l.trades} call{l.trades === 1 ? '' : 's'}</div>
                </div>
                <div className="text-right"><div className="font-display text-xl font-extrabold text-gold"><Coins n={l.worth} /></div><div className="text-[11px] text-mute"><Coins n={l.coins} /> in hand</div></div>
              </div>
            );
          })}
        </div>
      )}
      {!!leaders?.length && <ShareButton className="btn-gold w-full py-3" label="Share the standings" make={shareBoard} />}
    </div>
  );
}

// the host starts last one standing here once the pool has none running
function HostSurvivor() {
  const { board, reload } = useSurvivor();
  if (board === undefined || (board && board.status === 'open')) return null;
  return <SurvivorStart onStarted={reload} />;
}

// and call the score
function HostPredictor() {
  const { board, reload } = usePredictor();
  if (board === undefined || (board && board.status === 'open')) return null;
  return <PredictorStart onStarted={reload} />;
}

// the pool's look for a share card
function useCardBrand(): CardBrand {
  const brand = useBrand();
  const { league } = useLeague();
  return { wordmark: brand.wordmark, color: brand.colors?.gold ?? '#f7c548', coin: brand.coin, pool: league?.name ?? brand.short };
}

// a share button: draws the card on the phone, then the share sheet (or a saved picture where the phone can't share one)
function ShareButton({ label, make, className = 'btn-ghost' }: { label: string; make: () => Promise<unknown>; className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className={`${className} inline-flex items-center justify-center gap-2`} disabled={busy}
      onClick={() => { setBusy(true); make().catch(() => {}).finally(() => setBusy(false)); }}>
      <Share2 className="h-4 w-4" /> {busy ? 'Drawing it…' : label}
    </button>
  );
}

// ───────────── the host's desk ─────────────
export function PoolHost() {
  const { me } = useLeague();
  const brand = useBrand();
  const now = useNow(30000);
  const { markets, drops, reload } = usePool();
  const { busy, run } = useAction();
  const [drop, setDrop] = useState({ amount: '250', note: '', at: '' });
  const [open, setOpen] = useState(false);
  if (!me?.is_commish) return <Empty icon="🔒" title="For the host">Only the pool’s host asks and settles the questions.</Empty>;
  const waiting = (markets ?? []).filter((m) => m.status === 'open' && !isOpen(m, now) && !m.source);
  return (
    <div className="space-y-5">
      <PageHeader icon={<Wand2 className="h-6 w-6 text-gold" />} title="Host" sub="Ask the questions, settle them from what airs, and keep the coins flowing." right={<button type="button" className="btn-gold inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Ask</button>} />
      <Section title={`Waiting on you (${waiting.length})`}>
        {waiting.length ? <div className="space-y-2">{waiting.map((m) => <Link key={m.id} to={`/q/${m.id}`} className="card flex items-center justify-between gap-3 p-3"><span className="min-w-0 break-words font-semibold">{m.title}</span><span className="shrink-0 text-sm text-gold">Settle →</span></Link>)}</div>
          : <div className="card p-4 text-sm text-mute">Nothing to settle. Questions land here when they close.</div>}
      </Section>
      <SoccerRounds onAdded={reload} />
      <HostPredictor />
      <HostSurvivor />
      <Section title="Coin drops">
        <div className="card divide-y divide-white/[.05] p-1">
          {drops.map((d) => <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="min-w-0 break-words">{d.note}<div className="text-xs text-mute">{new Date(d.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div></span><b className={new Date(d.at).getTime() <= now ? 'text-mute' : 'text-gold'}>+{d.amount}</b></div>)}
          {!drops.length && <div className="p-3 text-sm text-mute">No drops scheduled.</div>}
        </div>
        <div className="card mt-2 grid gap-2 p-3 sm:grid-cols-[6rem_1fr_auto]">
          <input className="input" type="number" min={1} value={drop.amount} onChange={(e) => setDrop({ ...drop, amount: e.target.value })} aria-label="Amount" />
          <input className="input" placeholder="What for: bonus night, the reunion" value={drop.note} onChange={(e) => setDrop({ ...drop, note: e.target.value })} maxLength={80} />
          <button type="button" className="btn-ghost" disabled={busy || drop.note.length < 2} onClick={() => run(async () => { await rpc('pool_add_drop', { p_amount: Number(drop.amount), p_note: drop.note, p_at: drop.at ? new Date(drop.at).toISOString() : null }); setDrop({ amount: '250', note: '', at: '' }); reload(); }, `Dropped ${drop.amount} ${brand.coin.name.toLowerCase()}`)}>Drop now</button>
        </div>
      </Section>
      <Section title="All questions">
        <div className="card divide-y divide-white/[.05] p-1">
          {(markets ?? []).map((m) => <Link key={m.id} to={`/q/${m.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"><span className="min-w-0 break-words">{m.title}</span><span className="shrink-0 text-xs text-mute">{closesIn(m, now)}</span></Link>)}
        </div>
      </Section>
      <AskSheet open={open} onClose={() => setOpen(false)} drops={drops} onAsked={reload} />
      <div className="flex items-center gap-2 px-1 text-xs text-mute"><Trophy className="h-4 w-4" /> Questions about a show are about what airs.</div>
    </div>
  );
}
