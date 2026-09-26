// Garry's Book: the league's coin sportsbook. Markets on real NHL games (moneyline, total goals, overtime,
// player props) open every morning and settle themselves from the box scores; the commish can add a market on
// anything verifiable. Stakes leave the bank when the ticket is placed; winners are paid stake × odds.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { BookStanding, Market, MarketBet, MarketKind, MarketOption } from '../lib/types';
import { ago, etToday, fmtDate, fmtTime, NHL_TEAMS } from '../lib/format';
import { Coin, Empty, Section, Sheet, TeamBadge, useAction } from './ui';
import { BookOpen, Plus } from 'lucide-react';

const KIND: Record<MarketKind, { icon: string; label: string }> = { winner: { icon: '🏒', label: 'Moneyline' }, total: { icon: '🥅', label: 'Total goals' }, ot: { icon: '⏱️', label: 'Overtime' }, prop: { icon: '⭐', label: 'Player prop' }, custom: { icon: '🎯', label: 'Commish special' } };
const STAKES = [10, 25, 50, 100, 250];
const club = (a?: string) => (a ? NHL_TEAMS[a] ?? a : '');
// decimal odds as the league reads them: "2.10" and "+110"
const american = (o: number) => (o >= 2 ? `+${Math.round((o - 1) * 100)}` : `${Math.round(-100 / (o - 1))}`);

export function useBook() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [tickets, setTickets] = useState<MarketBet[]>([]);
  const [standings, setStandings] = useState<BookStanding[]>([]);
  const load = () => {
    const since = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
    supabase.from('markets').select('*').or(`status.eq.open,date.gte.${since}`).order('closes_at').then(({ data }) => setMarkets((data ?? []) as Market[]));
    supabase.from('market_bets').select('*').order('id', { ascending: false }).limit(400).then(({ data }) => setTickets((data ?? []) as MarketBet[]));
    supabase.from('book_standings').select('*').then(({ data }) => setStandings((data ?? []) as BookStanding[]));
  };
  useEffect(() => {
    load();
    const ch = realtimeChannel('book')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'markets' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_bets' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return { markets, tickets, standings, reload: load };
}

export function BookTab() {
  const { me, team, players, can } = useLeague();
  const now = useNow(30_000);
  const { busy, run } = useAction();
  const { markets, tickets, standings, reload } = useBook();
  const [filter, setFilter] = useState<'all' | MarketKind>('all');
  const [betting, setBetting] = useState<{ m: Market; o: MarketOption } | null>(null);
  const [stake, setStake] = useState(25);
  const [custom, setCustom] = useState('');
  const [newMarket, setNewMarket] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const mine = standings.find((s) => s.team_id === me?.id);
  const open = markets.filter((m) => m.status === 'open' && new Date(m.closes_at).getTime() > now);
  const closed = markets.filter((m) => m.status !== 'open' || new Date(m.closes_at).getTime() <= now);
  const myTickets = tickets.filter((t) => t.team_id === me?.id);
  const onMarket = (id: number) => tickets.filter((t) => t.market_id === id);
  const pname = (id?: number) => (id ? players.get(id)?.name ?? `#${id}` : '');

  // open markets grouped by game (custom ones in their own group), in start order
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; title: string; when: string; kind: 'game' | 'custom'; ms: Market[] }>();
    for (const m of open.filter((x) => filter === 'all' || x.kind === filter)) {
      const key = m.game_id ? `g${m.game_id}` : 'custom';
      if (!g.has(key)) g.set(key, { key, title: m.game_id ? `${club(m.subject.away)} @ ${club(m.subject.home)}` : 'Commish specials', when: m.closes_at, kind: m.game_id ? 'game' : 'custom', ms: [] });
      g.get(key)!.ms.push(m);
    }
    return [...g.values()].sort((a, b) => a.when.localeCompare(b.when));
  }, [open, filter]);

  const place = () => run(async () => {
    if (!betting) return;
    await rpc('place_market_bet', { p_market: betting.m.id, p_pick: betting.o.key, p_coins: stake });
    setBetting(null); reload();
  }, `Ticket placed: ${stake} ☘️ on ${betting?.o.label} @ ${betting?.o.odds}`);

  const OptionBtn = ({ m, o }: { m: Market; o: MarketOption }) => {
    const yours = onMarket(m.id).filter((t) => t.team_id === me?.id && t.pick === o.key).reduce((s, t) => s + t.coins, 0);
    const backers = onMarket(m.id).filter((t) => t.pick === o.key);
    const won = m.status === 'settled' && m.winner_key === o.key;
    return (
      <button disabled={m.status !== 'open' || new Date(m.closes_at).getTime() <= now || !can('bets') || me?.role === 'spectator'}
        className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-2 text-center transition active:scale-[.98] disabled:active:scale-100 ${won ? 'border-emerald-400/60 bg-emerald-500/15' : yours ? 'border-sky-400/60 bg-sky-500/15' : 'border-white/[.08] bg-white/[.03] hover:bg-white/[.06]'}`}
        onClick={() => { setBetting({ m, o }); setStake(25); setCustom(''); }}>
        <span className="w-full truncate text-sm font-semibold">{o.label}</span>
        <span className="num font-display text-lg font-extrabold text-gold">{Number(o.odds).toFixed(2)} <span className="text-[10px] font-normal text-mute">{american(Number(o.odds))}</span></span>
        {yours > 0 && <span className="text-[10px] text-sky-200">you: {yours} ☘️</span>}
        {backers.length > 0 && <span className="mt-0.5 flex items-center gap-0.5">{backers.slice(0, 5).map((t) => <TeamBadge key={t.id} team={team(t.team_id)} size={12} />)}</span>}
      </button>
    );
  };

  const MarketRow = ({ m }: { m: Market }) => (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-mute">
        <span>{KIND[m.kind].icon} {KIND[m.kind].label}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-white">{m.kind === 'prop' ? <Link to={`/player/${m.subject.player_id}`} className="hover:underline">{pname(m.subject.player_id)}</Link> : m.title}{m.kind === 'prop' && m.subject.owner ? <span className="text-mute"> · {team(m.subject.owner)?.abbrev}</span> : null}</span>
        {m.status === 'open' && <span className="shrink-0">closes {fmtTime(m.closes_at)}</span>}
      </div>
      <div className="flex gap-1.5">{m.options.map((o) => <OptionBtn key={o.key} m={m} o={o} />)}</div>
      {m.subject.terms && <div className="mt-1 text-[11px] text-mute">{m.subject.terms}</div>}
    </div>
  );

  const Result = ({ m }: { m: Market }) => {
    const win = m.options.find((o) => o.key === m.winner_key);
    const my = onMarket(m.id).filter((t) => t.team_id === me?.id);
    const net = my.reduce((s, t) => s + ((t.payout ?? 0) - t.coins), 0);
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        <span className="shrink-0">{KIND[m.kind].icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate">{m.title}</div>
          <div className="text-[11px] text-mute">
            {m.status === 'void' ? 'Void, stakes refunded' : m.status === 'settled' ? <>{win?.label ?? m.winner_key} @ {win?.odds}{m.result?.home != null ? ` · ${m.subject.away} ${m.result.away}, ${m.subject.home} ${m.result.home}${m.result.period && m.result.period !== '3' ? ` (${m.result.period})` : ''}` : ''}{m.result?.value != null ? ` · ${m.result.value} pts` : ''}</> : 'Waiting on the final'}
            {m.created_by && me?.is_commish && m.status === 'open' && <span className="ml-2 inline-flex gap-1">{m.options.map((o) => <button key={o.key} className="chip py-0.5" onClick={() => run(async () => { await rpc('commish_settle_market', { p_market: m.id, p_winner: o.key }); reload(); }, 'Settled')}>{o.label} won</button>)}<button className="chip py-0.5 text-red-300" onClick={() => run(async () => { await rpc('commish_settle_market', { p_market: m.id, p_winner: null }); reload(); }, 'Voided')}>Void</button></span>}
          </div>
        </div>
        {my.length > 0 && <span className={`num shrink-0 font-semibold ${net > 0 ? 'text-emerald-300' : net < 0 ? 'text-red-300' : 'text-mute'}`}>{m.status === 'open' ? `${my.reduce((s, t) => s + t.coins, 0)} riding` : `${net > 0 ? '+' : ''}${net}`}</span>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3" style={{ background: 'linear-gradient(160deg, rgba(76,195,255,.12), rgba(15,23,41,.75) 55%)' }}>
        <BookOpen size={22} className="text-sky-300" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-semibold">Garry’s Book</div>
          <div className="text-xs text-mute">Coins on tonight’s games and stats, paid at the odds shown. The Book opens every morning at 9:35 ET and settles itself from the box scores. 5 to 500 ☘️ a ticket.</div>
        </div>
        {mine && (mine.bets > 0 || mine.open_coins > 0) && (
          <div className="text-right text-xs text-mute">
            <div><span className={`num font-display text-lg font-extrabold ${mine.net > 0 ? 'text-emerald-300' : mine.net < 0 ? 'text-red-300' : 'text-white'}`}>{mine.net > 0 ? '+' : ''}{mine.net}</span> ☘️ lifetime</div>
            <div>{mine.wins}-{mine.bets - mine.wins}{mine.open_coins ? ` · ${mine.open_coins} riding` : ''}</div>
          </div>
        )}
        {me?.is_commish && <button className="btn-blue btn-sm" onClick={() => setNewMarket(true)}><Plus size={14} /> Market</button>}
      </div>

      {open.length > 0 && (
        <div className="scroll-x flex gap-1">
          {([['all', 'Everything'], ['winner', '🏒 Moneylines'], ['total', '🥅 Totals'], ['ot', '⏱️ Overtime'], ['prop', '⭐ Props'], ['custom', '🎯 Specials']] as const).filter(([k]) => k === 'all' || open.some((m) => m.kind === k)).map(([k, l]) => (
            <button key={k} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${filter === k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}

      {open.length === 0 && (
        <div className="card"><Empty icon="📖" title="The Book is closed">{markets.length ? 'Everything has gone to puck drop. Results land as the games go final.' : 'It opens at 9:35 ET on the next game day with moneylines, totals, overtime and player props.'}</Empty></div>
      )}
      {groups.map((g) => (
        <Section key={g.key} title={g.kind === 'custom' ? '🎯 Commish specials' : g.title} right={g.kind === 'game' ? <span className="text-xs text-mute">{fmtDate(g.ms[0].date) === fmtDate(etToday()) ? 'Tonight' : fmtDate(g.ms[0].date)} · {fmtTime(g.when)}</span> : undefined}>
          <div className="card divide-y divide-white/[.06]">{g.ms.map((m) => <MarketRow key={m.id} m={m} />)}</div>
        </Section>
      ))}

      {myTickets.length > 0 && (
        <Section title="🎟️ My tickets">
          <div className="card divide-y divide-white/[.06]">
            {myTickets.slice(0, 12).map((t) => {
              const m = markets.find((x) => x.id === t.market_id);
              const o = m?.options.find((x) => x.key === t.pick);
              const settled = m && m.status !== 'open';
              const net = settled ? (t.payout ?? 0) - t.coins : null;
              return (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="shrink-0">{m ? KIND[m.kind].icon : '🎟️'}</span>
                  <div className="min-w-0 flex-1"><div className="truncate">{m?.title ?? 'Market'}</div><div className="text-[11px] text-mute">{o?.label ?? t.pick} @ {Number(t.odds).toFixed(2)} · {t.coins} ☘️ → {Math.round(t.coins * t.odds)} · {ago(t.created_at, now)}</div></div>
                  <span className={`num shrink-0 font-semibold ${net == null ? 'text-sky-200' : net > 0 ? 'text-emerald-300' : net < 0 ? 'text-red-300' : 'text-mute'}`}>{net == null ? 'open' : m?.status === 'void' ? 'void' : `${net > 0 ? '+' : ''}${net}`}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {closed.length > 0 && (
        <Section title="Results" right={closed.length > 8 ? <button className="text-xs text-sky-300" onClick={() => setShowResults(!showResults)}>{showResults ? 'Fewer' : `All ${closed.length}`}</button> : undefined}>
          <div className="card divide-y divide-white/[.06]">{[...closed].sort((a, b) => (b.settled_at ?? b.closes_at).localeCompare(a.settled_at ?? a.closes_at)).slice(0, showResults ? 200 : 8).map((m) => <Result key={m.id} m={m} />)}</div>
        </Section>
      )}

      <p className="text-center text-xs text-mute">Moneyline odds come from each club’s points percentage this season plus home ice; totals, overtime and props are fixed lines. The house keeps a 5% edge, ties go to the under, postponed games and scratched players are refunded. Coins only, never cash.</p>

      {/* place a ticket */}
      <Sheet open={!!betting} onClose={() => setBetting(null)} title="Place a ticket">
        {betting && (
          <div className="space-y-3">
            <div className="text-sm"><span className="text-mute">{KIND[betting.m.kind].label} · </span>{betting.m.title}</div>
            <div className="rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 text-center">
              <div className="text-lg font-bold">{betting.o.label}</div>
              <div className="num font-display text-3xl font-extrabold text-gold">{Number(betting.o.odds).toFixed(2)} <span className="text-sm font-normal text-mute">{american(Number(betting.o.odds))}</span></div>
            </div>
            <div>
              <div className="label mb-1">Stake (you have <AvailableCoins /> available)</div>
              <div className="flex flex-wrap gap-1.5">
                {STAKES.map((s) => <button key={s} className={`chip py-1 ${stake === s && !custom ? 'bg-emerald-500 text-ice' : ''}`} onClick={() => { setStake(s); setCustom(''); }}>{s}</button>)}
                <input className="input w-24 py-1" inputMode="numeric" placeholder="other" value={custom} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); setCustom(v); if (v) setStake(Number(v)); }} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2 text-sm"><span className="text-mute">Pays if it hits</span><span className="flex items-center gap-1 font-semibold"><Coin size={14} /> {Math.round(stake * Number(betting.o.odds))} <span className="text-xs text-mute">(+{Math.round(stake * Number(betting.o.odds)) - stake})</span></span></div>
            <button className="btn-primary w-full" disabled={busy || stake < 5 || stake > 500} onClick={place}>Place {stake} ☘️ on {betting.o.label}</button>
            <p className="text-center text-xs text-mute">Closes {fmtTime(betting.m.closes_at)}. Stakes leave your bank now; tickets can’t be cancelled. Max 500 a market.</p>
          </div>
        )}
      </Sheet>

      <Sheet open={newMarket} onClose={() => setNewMarket(false)} title="New market (commish)">
        <NewMarket onDone={() => { setNewMarket(false); reload(); }} />
      </Sheet>
    </div>
  );
}

function AvailableCoins() {
  const { me } = useLeague();
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { if (me) supabase.from('coin_balances').select('balance,escrow').eq('team_id', me.id).maybeSingle().then(({ data }) => setN(data ? data.balance - data.escrow : null)); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{n ?? '…'} ☘️</>;
}

function NewMarket({ onDone }: { onDone: () => void }) {
  const { busy, run } = useAction();
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [closes, setCloses] = useState(() => { const d = new Date(Date.now() + 86400000); d.setMinutes(0, 0, 0); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  const [opts, setOpts] = useState<{ label: string; odds: string }[]>([{ label: 'Yes', odds: '1.9' }, { label: 'No', odds: '1.9' }]);
  const IDEAS = ['Any SaK player scores a hat trick this week', 'A goalie posts a shutout tonight', 'Most goals in one game this week: over 8.5', 'Trystan makes a trade before Halloween', 'First GM to use all 10 free pickups'];
  return (
    <div className="space-y-3">
      <input className="input" placeholder="What are we betting on? Something you can verify." value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
      <div className="scroll-x flex gap-1">{IDEAS.map((i) => <button key={i} className="chip shrink-0 py-1" onClick={() => setTitle(i)}>{i}</button>)}</div>
      <textarea className="input" rows={2} placeholder="How it settles (optional)" value={terms} onChange={(e) => setTerms(e.target.value)} />
      <div>
        <div className="label mb-1">Options and decimal odds (2.00 = double your stake)</div>
        {opts.map((o, i) => (
          <div key={i} className="mb-1.5 grid grid-cols-[1fr_90px_36px] gap-1.5">
            <input className="input" placeholder={`Option ${i + 1}`} value={o.label} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className="input" inputMode="decimal" value={o.odds} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? { ...x, odds: e.target.value.replace(/[^\d.]/g, '') } : x)))} />
            <button className="btn-ghost btn-sm" disabled={opts.length <= 2} onClick={() => setOpts(opts.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {opts.length < 8 && <button className="btn btn-sm" onClick={() => setOpts([...opts, { label: '', odds: '3' }])}><Plus size={14} /> Option</button>}
      </div>
      <label className="block text-xs text-mute">Betting closes<input type="datetime-local" className="input mt-1" value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
      <button className="btn-primary w-full" disabled={busy || title.trim().length < 3 || opts.some((o) => !o.label.trim() || !(Number(o.odds) >= 1.05))} onClick={() => run(async () => {
        await rpc('commish_market', { p: { title, terms: terms || null, options: opts.map((o) => ({ label: o.label, odds: Number(o.odds) })), closes_at: new Date(closes).toISOString() } });
        onDone();
      }, 'Market opened 📖')}>Open the market</button>
      <p className="text-xs text-mute">You settle it by hand from the Results list once it’s decided (or void it to refund everyone). Posted to Trash Talk when it opens.</p>
    </div>
  );
}

// the Book's leaderboard, for the Leaders tab
export function BookLeaders() {
  const { team, me } = useLeague();
  const { standings, tickets, markets } = useBook();
  const rows = [...standings].filter((s) => s.bets > 0 || s.open_coins > 0).sort((a, b) => b.net - a.net);
  if (rows.length === 0) return <div className="card p-4 text-sm text-mute">Nobody has placed a ticket at the Book yet. Opening night is the first slate.</div>;
  // streaks from settled tickets, newest first
  const streak = (t: number) => {
    let n = 0, dir: 'W' | 'L' | null = null;
    for (const x of tickets.filter((b) => b.team_id === t)) {
      const m = markets.find((mm) => mm.id === x.market_id);
      if (!m || m.status !== 'settled') continue;
      const w = m.winner_key === x.pick ? 'W' : 'L';
      if (!dir) dir = w;
      if (w !== dir) break;
      n++;
    }
    return dir && n > 1 ? `${dir}${n}` : '';
  };
  const sharp = rows.filter((r) => r.bets >= 3).sort((a, b) => b.returned / Math.max(1, b.staked) - a.returned / Math.max(1, a.staked))[0];
  const whale = [...rows].sort((a, b) => b.staked + b.open_coins - (a.staked + a.open_coins))[0];
  return (
    <div className="space-y-2">
      <div className="card divide-y divide-white/[.06] overflow-hidden">
        {rows.map((r, i) => {
          const roi = r.staked ? Math.round(((r.returned - r.staked) / r.staked) * 100) : 0;
          const badges = [sharp?.team_id === r.team_id ? '🎯 Sharp' : '', whale?.team_id === r.team_id && r.staked + r.open_coins >= 300 ? '🐳 Whale' : '', r.best_win >= 200 ? '💥 Big hit' : ''].filter(Boolean);
          const st = streak(r.team_id);
          return (
            <div key={r.team_id} className={`flex items-center gap-3 px-3 py-2.5 ${r.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
              <span className="num w-5 text-center text-sm text-mute">{i + 1}</span>
              <TeamBadge team={team(r.team_id)} size={28} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{team(r.team_id)?.gm_name} {badges.map((b) => <span key={b} className="ml-1 rounded bg-white/[.08] px-1 text-[10px] font-normal">{b}</span>)}</div>
                <div className="text-[11px] text-mute">{r.wins}-{r.bets - r.wins}{st ? ` · ${st.startsWith('W') ? '🔥' : '🧊'} ${st}` : ''} · staked {r.staked}{r.open_coins ? ` · ${r.open_coins} riding` : ''}{r.staked ? ` · ROI ${roi > 0 ? '+' : ''}${roi}%` : ''}</div></div>
              <span className={`num font-display text-lg font-extrabold ${r.net > 0 ? 'text-emerald-300' : r.net < 0 ? 'text-red-300' : 'text-mute'}`}>{r.net > 0 ? '+' : ''}{r.net}</span>
            </div>
          );
        })}
      </div>
      <p className="px-1 text-xs text-mute">Net coins won or lost at the Book. 🎯 Sharp: best return per coin staked (3+ tickets). 🐳 Whale: most coins put through. 💥 Big hit: a single ticket that cleared 200.</p>
    </div>
  );
}
