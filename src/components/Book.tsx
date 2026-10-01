// Garry's Book: the league's coin sportsbook. Markets on real NHL games (moneyline, total goals, overtime,
// player props) open every morning and settle themselves from the box scores; season futures (the champion,
// last place, the playoffs, the full-year trophy) and season-long props on every team and the biggest names
// stay open until the trade deadline, re-priced every morning from the standings; any GM can ask the Book for
// a long NHL market (a game later in the week, a race between players or clubs, a line on one of them) and open
// it by taking the first ticket; the commish can add a market on anything verifiable. Stakes leave the bank when
// the ticket is placed; winners are paid stake × odds. Odds move: tonight's markets stay open in play and re-price
// from the score and the clock, the long ones from the standings and the box scores; a ticket keeps the price it
// was bought at. The live prices come from one call (book_live) that the board refreshes as scores change.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { BookRequest, BookStanding, Game, Market, MarketBet, MarketKind, MarketOption } from '../lib/types';
import { ago, etToday, fmtDate, fmtTime, NHL_TEAMS } from '../lib/format';
import { Coin, Empty, Section, Sheet, TeamBadge, useAction } from './ui';
import { BookOpen, Plus, Sparkles } from 'lucide-react';
import { AskBook } from './AskBook';
import { BookChat } from './BookChat';
import { marketChances } from '../lib/betodds';
import { ticketOutcome } from '../lib/betresults';

const KIND: Record<MarketKind, { icon: string; label: string }> = { winner: { icon: '🏒', label: 'Moneyline' }, total: { icon: '🥅', label: 'Total goals' }, ot: { icon: '⏱️', label: 'Overtime' }, prop: { icon: '⭐', label: 'Player prop' }, custom: { icon: '🎯', label: 'Commish special' }, future: { icon: '🔮', label: 'Season future' }, season_prop: { icon: '📅', label: 'Season prop' }, race: { icon: '🏁', label: 'Race' } };
const SEASON = new Set<MarketKind>(['future', 'season_prop']);
const LONG = new Set<MarketKind>(['future', 'season_prop', 'race']);   // open for days or months, not until puck drop
// what the Book's odds say each option's chance is, with the house edge taken back out
const implied = (opts: MarketOption[]): Record<string, number> => {
  const inv = opts.map((o) => 1 / Math.max(1.01, Number(o.odds)));
  const sum = inv.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(opts.map((o, i) => [o.key, inv[i] / sum]));
};
const GAME_KINDS = new Set<MarketKind>(['winner', 'total', 'ot', 'prop']);
// regulation minutes left, as the Book counts them (0 in overtime or a shootout)
const minutesLeft = (g: Game) => {
  const per = String(g.period ?? '').toUpperCase();
  if (per.includes('OT') || per.includes('SO')) return 0;
  const n = Number(per.replace(/\D/g, '')) || 1;
  const [mm, ss] = String(g.clock ?? '20:00').split(':').map(Number);
  return Math.max(0, (3 - n) * 20 + (mm || 0) + (ss || 0) / 60);
};
// can a ticket still be bought in play? the server has the final say (same rules, plus a fresh score feed)
const inPlayOpen = (m: Market, g: Game | undefined) => !!g && GAME_KINDS.has(m.kind) && ['LIVE', 'CRIT'].includes(g.state) && minutesLeft(g) >= 2 && !/OT|SO/i.test(String(g.period ?? ''));

// the board's live prices: one call, refreshed when a score changes and once a minute while a game is on
function useLiveOdds(markets: Market[], games: Game[]) {
  const [live, setLive] = useState<Record<string, MarketOption[]>>({});
  const anyLive = games.some((g) => ['LIVE', 'CRIT'].includes(g.state));
  const scoreKey = games.map((g) => `${g.id}:${g.state}:${g.home_score}:${g.away_score}:${g.period}`).join('|');
  useEffect(() => {
    if (!markets.some((m) => m.status === 'open')) return;
    let alive = true;
    const load = () => rpc<Record<string, MarketOption[]>>('book_live').then((d) => { if (alive && d) setLive(d); }).catch(() => {});
    const t = window.setTimeout(load, 400);
    const i = anyLive ? window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000) : 0;
    return () => { alive = false; window.clearTimeout(t); if (i) window.clearInterval(i); };
  }, [scoreKey, anyLive, markets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return live;
}
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
    Promise.all([
      supabase.from('markets').select('*').or(`status.eq.open,date.gte.${since}`).order('closes_at'),
      supabase.from('market_bets').select('*').order('id', { ascending: false }).limit(1000),
    ]).then(async ([{ data: ms }, { data: ts }]) => {
      const list = (ms ?? []) as Market[];
      const tix = (ts ?? []) as MarketBet[];
      // older markets that tickets were placed on, so every ticket's result can be shown
      const have = new Set(list.map((m) => m.id));
      const missing = [...new Set(tix.map((t) => t.market_id).filter((id) => !have.has(id)))];
      for (let i = 0; i < missing.length; i += 200) {
        const { data } = await supabase.from('markets').select('*').in('id', missing.slice(i, i + 200));
        list.push(...((data ?? []) as Market[]));
      }
      setMarkets(list.sort((a, b) => a.closes_at.localeCompare(b.closes_at)));
      setTickets(tix);
    });
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
  const { me, team, players, can, games } = useLeague();
  const now = useNow(30_000);
  const { busy, run } = useAction();
  const { markets, tickets, standings, reload } = useBook();
  const liveOdds = useLiveOdds(markets, games);
  // the options as priced right now (the stored ones are the opening odds)
  const liveOpts = (m: Market): MarketOption[] => (m.status === 'open' && liveOdds[String(m.id)]) || m.options;
  const priceOf = (m: Market, o: MarketOption) => Number(liveOpts(m).find((x) => x.key === o.key)?.odds ?? o.odds);
  const [filter, setFilter] = useState<'all' | MarketKind>('all');
  const [betting, setBetting] = useState<{ m: Market; o: MarketOption } | null>(null);
  const [stake, setStake] = useState(25);
  const [custom, setCustom] = useState('');
  const [newMarket, setNewMarket] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askStart, setAskStart] = useState<BookRequest | null>(null);
  const [showResults, setShowResults] = useState(false);
  const mine = standings.find((s) => s.team_id === me?.id);
  const open = markets.filter((m) => m.status === 'open' && new Date(m.closes_at).getTime() > now);
  const liveMs = markets.filter((m) => m.status === 'open' && new Date(m.closes_at).getTime() <= now);   // puck's dropped, not settled yet
  const closed = markets.filter((m) => m.status !== 'open');
  // SaK points so far tonight for every player with a prop on the board (live props need them)
  const propIds = [...new Set(markets.filter((m) => m.kind === 'prop' && m.status === 'open' && m.subject.player_id).map((m) => m.subject.player_id!))];
  const [propPts, setPropPts] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!propIds.length) return;
    let alive = true;
    const load = () => supabase.from('player_games').select('player_id,date,fpts').in('player_id', propIds).gte('date', etToday())
      .then(({ data }) => { if (alive) setPropPts(new Map((data ?? []).map((r) => [`${r.player_id}|${r.date}`, Number(r.fpts)]))); });
    load();
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; window.clearInterval(i); };
  }, [propIds.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const gameOf = (m: Market) => (m.game_id ? games.find((g) => g.id === m.game_id) : undefined);
  const chanceOf = (m: Market) => LONG.has(m.kind) ? implied(liveOpts(m)) : marketChances(m, gameOf(m), m.subject.player_id ? propPts.get(`${m.subject.player_id}|${m.date}`) ?? 0 : 0, players);
  const bettable = (m: Market) => m.status === 'open' && (new Date(m.closes_at).getTime() > now || inPlayOpen(m, gameOf(m)));
  const myTickets = tickets.filter((t) => t.team_id === me?.id);
  const onMarket = (id: number) => tickets.filter((t) => t.market_id === id);
  const pname = (id?: number) => (id ? players.get(id)?.name ?? `#${id}` : '');

  // open markets grouped by game (the season markets and the custom ones in groups of their own), in start order
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; title: string; when: string; kind: 'game' | 'custom' | 'season' | 'asked' | 'nhl'; ms: Market[] }>();
    for (const m of open.filter((x) => filter === 'all' || x.kind === filter || (filter === 'future' && x.kind === 'season_prop') || (filter === 'race' && x.kind === 'race'))) {
      const key = m.game_id ? `g${m.game_id}` : m.kind === 'race' ? (m.subject.house === 'nhl' ? 'nhl' : 'asked') : SEASON.has(m.kind) ? 'season' : 'custom';
      if (key === 'season' || key === 'asked' || key === 'nhl') {
        if (!g.has(key)) g.set(key, { key, title: key === 'asked' ? '🏁 Races & requests' : key === 'nhl' ? '🏆 NHL futures' : '🔮 Season futures & props', when: key === 'asked' ? '9998' : key === 'nhl' ? '9997' : '9999', kind: key, ms: [] });
        g.get(key)!.ms.push(m);
        continue;
      }
      // props don't carry the clubs: name the game from the schedule, or from any market on it that does
      const gm = m.game_id ? games.find((x) => x.id === m.game_id) : undefined;
      const withClubs = open.find((x) => x.game_id === m.game_id && x.subject.home);
      const away = gm?.away ?? withClubs?.subject.away, home = gm?.home ?? withClubs?.subject.home;
      if (!g.has(key)) g.set(key, { key, title: m.game_id ? `${club(away)} @ ${club(home)}` : 'Commish specials', when: m.closes_at, kind: m.game_id ? 'game' : 'custom', ms: [] });
      g.get(key)!.ms.push(m);
    }
    return [...g.values()].sort((a, b) => a.when.localeCompare(b.when));
  }, [open, filter, games]);

  const place = () => run(async () => {
    if (!betting) return;
    await rpc('place_market_bet', { p_market: betting.m.id, p_pick: betting.o.key, p_coins: stake });
    setBetting(null); reload();
  }, `Ticket placed: ${stake} ☘️ on ${betting?.o.label} @ ${betting ? priceOf(betting.m, betting.o).toFixed(2) : ''}`);

  const OptionBtn = ({ m, o }: { m: Market; o: MarketOption }) => {
    const yours = onMarket(m.id).filter((t) => t.team_id === me?.id && t.pick === o.key).reduce((s, t) => s + t.coins, 0);
    const backers = onMarket(m.id).filter((t) => t.pick === o.key);
    const won = m.status === 'settled' && m.winner_key === o.key;
    const price = m.status === 'open' ? priceOf(m, o) : Number(o.odds);
    const moved = m.status === 'open' && Math.abs(price - Number(o.odds)) >= 0.05;
    return (
      <button disabled={!bettable(m) || !can('bets') || me?.role === 'spectator'}
        className={`flex min-w-0 flex-1 flex-col items-center rounded-xl border px-2 py-2 text-center transition active:scale-[.98] disabled:active:scale-100 ${won ? 'border-emerald-400/60 bg-emerald-500/15' : yours ? 'border-sky-400/60 bg-sky-500/15' : 'border-white/[.08] bg-white/[.03] hover:bg-white/[.06]'}`}
        onClick={() => { setBetting({ m, o }); setStake(25); setCustom(''); }}>
        <span className="w-full truncate text-sm font-semibold">{o.label}</span>
        <span className="num font-display text-lg font-extrabold text-gold">{price.toFixed(2)} <span className="text-[10px] font-normal text-mute">{american(price)}</span></span>
        {moved && <span className="text-[10px] text-mute">opened {Number(o.odds).toFixed(2)} {price < Number(o.odds) ? '▼' : '▲'}</span>}
        {(() => { const c = chanceOf(m)?.[o.key]; return c != null && m.status === 'open' ? <span className="text-[10px] text-slate-300">{Math.round(c * 100)}% to hit{new Date(m.closes_at).getTime() <= now ? ' · live' : ''}</span> : null; })()}
        {yours > 0 && <span className="text-[10px] text-sky-200">you: {yours} ☘️</span>}
        {backers.length > 0 && <span className="mt-0.5 flex items-center gap-0.5">{backers.slice(0, 5).map((t) => <TeamBadge key={t.id} team={team(t.team_id)} size={12} />)}</span>}
      </button>
    );
  };

  const MarketRow = ({ m }: { m: Market }) => (
    <div className="px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-xs text-mute">
        <span>{KIND[m.kind].icon} {KIND[m.kind].label}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-white">{m.kind === 'prop' || ((m.kind === 'season_prop' || m.subject.template === 'player_line') && m.subject.player_id) ? <Link to={`/player/${m.subject.player_id}`} className="hover:underline">{m.kind === 'prop' ? pname(m.subject.player_id) : m.title}</Link> : m.title}{m.kind === 'prop' && m.subject.owner ? <span className="text-mute"> · {team(m.subject.owner)?.abbrev}</span> : null}</span>
        {m.status === 'open' && <span className="shrink-0">{LONG.has(m.kind) ? `until ${fmtDate(m.closes_at.slice(0, 10))}` : new Date(m.closes_at).getTime() <= now ? (inPlayOpen(m, gameOf(m)) ? '🔴 in play' : 'no more bets') : m.date > etToday() ? `${fmtDate(m.date)} ${fmtTime(m.closes_at)}` : `puck drop ${fmtTime(m.closes_at)}`}</span>}
      </div>
      <div className={m.options.length > 3 ? 'grid grid-cols-2 gap-1.5 sm:grid-cols-4' : 'flex gap-1.5'}>{m.options.map((o) => <OptionBtn key={o.key} m={m} o={o} />)}</div>
      {m.kind === 'future' && <div className="mt-1 text-[11px] text-mute">Odds move with the standings; a ticket keeps the odds it was placed at.</div>}
      {GAME_KINDS.has(m.kind) && m.status === 'open' && new Date(m.closes_at).getTime() <= now && <div className="mt-1 text-[11px] text-mute">{inPlayOpen(m, gameOf(m)) ? 'In play: the price follows the score and the clock, the house keeps 10%. No bets in the last two minutes or in overtime.' : 'Betting is over for this one; it settles at the final.'}</div>}
      {m.kind === 'season_prop' && <div className="mt-1 text-[11px] text-mute">{m.subject.scope === 'team' ? 'Regular-season points, settled the day after the season ends.' : m.subject.stat === 'g' ? 'NHL goals this regular season, settled the day after it ends.' : 'Fantasy points this regular season, settled the day after it ends.'}</div>}
      {(m.subject.terms || (m.created_by && m.kind !== 'custom')) && (
        <div className="mt-1 text-[11px] text-mute">
          {m.created_by && m.kind !== 'custom' && <span className="mr-1 inline-flex items-center gap-1 text-slate-300"><TeamBadge team={team(m.created_by)} size={12} />Asked for by {team(m.created_by)?.gm_name} ·</span>}
          {m.subject.terms}
        </div>
      )}
      <Tickets m={m} />
      {(m.created_by || m.subject.house) && me?.is_commish && m.status === 'open' && new Date(m.closes_at).getTime() <= now && !m.game_id && (
        <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]"><span className="text-mute">Settle:</span>{m.options.map((o) => <button key={o.key} className="chip py-0.5" onClick={() => run(async () => { await rpc('commish_settle_market', { p_market: m.id, p_winner: o.key }); reload(); }, 'Settled')}>{o.label} won</button>)}<button className="chip py-0.5 text-red-300" onClick={() => run(async () => { await rpc('commish_settle_market', { p_market: m.id, p_winner: null }); reload(); }, 'Voided')}>Void</button></div>
      )}
    </div>
  );

  // every ticket on a market: who, what, how much, what it pays, and its live chance of cashing
  const Tickets = ({ m }: { m: Market }) => {
    const ts = onMarket(m.id);
    if (!ts.length) return null;
    const c = m.status === 'open' ? chanceOf(m) : null;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {ts.map((t) => {
          const o = m.options.find((x) => x.key === t.pick);
          const pct = c?.[t.pick];
          const won = m.status === 'settled' ? m.winner_key === t.pick : null;
          return (
            <span key={t.id} className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${t.team_id === me?.id ? 'border-sky-400/50 bg-sky-500/10' : 'border-white/[.08] bg-white/[.03]'}`}>
              <TeamBadge team={team(t.team_id)} size={12} />{team(t.team_id)?.gm_name}: {t.coins} ☘️ on {o?.label ?? t.pick} @ {Number(t.odds).toFixed(2)}{t.placed_live ? ' live' : ''} → {Math.round(t.coins * t.odds)}
              {pct != null && <b className={pct >= 0.5 ? 'text-emerald-300' : 'text-amber-200'}>{Math.round(pct * 100)}%</b>}
              {won != null && <b className={won ? 'text-emerald-300' : 'text-red-300'}>{won ? 'won' : 'lost'}</b>}
            </span>
          );
        })}
      </div>
    );
  };

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
          <div className="text-xs text-mute">Coins on tonight’s games and stats, on the season (the champion, last place, the playoffs, every team’s points, the biggest names) and on anything you ask for: a game later in the week, a race between players or NHL clubs, a line on one of them. Paid at the odds shown; the Book opens every morning at 9:35 ET and settles itself. 5 to 500 ☘️ a ticket.</div>
        </div>
        {mine && (mine.bets > 0 || mine.open_coins > 0) && (
          <div className="text-right text-xs text-mute">
            <div><span className={`num font-display text-lg font-extrabold ${mine.net > 0 ? 'text-emerald-300' : mine.net < 0 ? 'text-red-300' : 'text-white'}`}>{mine.net > 0 ? '+' : ''}{mine.net}</span> ☘️ lifetime</div>
            <div>{mine.wins}-{mine.bets - mine.wins}{mine.open_coins ? ` · ${mine.open_coins} riding` : ''}</div>
          </div>
        )}
        <div className="flex w-full gap-1.5 sm:w-auto">
          {can('bets') && me?.role !== 'spectator' && <button className="btn-blue btn-sm" onClick={() => setAsking(true)}><Sparkles size={14} /> Ask the Book</button>}
          {me?.is_commish && <button className="btn-ghost btn-sm" onClick={() => setNewMarket(true)}><Plus size={14} /> Market</button>}
        </div>
      </div>

      <BookChat markets={markets} onPick={(m, o) => { setBetting({ m, o }); setStake(25); setCustom(''); }} onRequest={(r) => { setAskStart(r); setAsking(true); }} />

      {open.length > 0 && (
        <div className="scroll-x flex gap-1">
          {([['all', 'Everything'], ['race', '🏆 NHL & races'], ['future', '🔮 Season'], ['winner', '🏒 Moneylines'], ['total', '🥅 Totals'], ['ot', '⏱️ Overtime'], ['prop', '⭐ Props'], ['custom', '🎯 Specials']] as const).filter(([k]) => k === 'all' || open.some((m) => m.kind === k || (k === 'future' && m.kind === 'season_prop'))).map(([k, l]) => (
            <button key={k} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${filter === k ? 'bg-sky-500 text-ice' : 'bg-white/[.05] text-mute'}`} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}

      {open.length === 0 && (
        <div className="card"><Empty icon="📖" title="The Book is closed">{markets.length ? 'Everything has gone to puck drop. Results land as the games go final.' : 'It opens at 9:35 ET on the next game day with moneylines, totals, overtime and player props.'}{can('bets') && me?.role !== 'spectator' ? ' Or ask it for a market on a game later in the week, a player race or an NHL race.' : ''}</Empty></div>
      )}
      {groups.map((g) => (
        <Section key={g.key} title={g.kind === 'custom' ? '🎯 Commish specials' : g.title} right={g.kind === 'game' ? <span className="text-xs text-mute">{fmtDate(g.ms[0].date) === fmtDate(etToday()) ? 'Tonight' : fmtDate(g.ms[0].date)} · {fmtTime(g.when)}</span> : g.kind === 'season' || g.kind === 'nhl' ? <span className="text-xs text-mute">open until {fmtDate(g.ms[0].closes_at.slice(0, 10))}</span> : g.kind === 'asked' ? <button className="text-xs text-sky-300" onClick={() => setAsking(true)}>Ask for one</button> : undefined}>
          <div className="card divide-y divide-white/[.06]">{g.ms.map((m) => <MarketRow key={m.id} m={m} />)}</div>
        </Section>
      ))}

      {liveMs.length > 0 && (
        <Section title="📡 In play" right={<span className="text-xs text-mute">prices move with the score</span>}>
          <div className="space-y-2">
            {[...new Set(liveMs.map((m) => m.game_id ?? 0))].map((gid) => {
              const ms = liveMs.filter((m) => (m.game_id ?? 0) === gid);
              const g = gid ? games.find((x) => x.id === gid) : undefined;
              const state = !g ? '' : ['OFF', 'FINAL'].includes(g.state) ? 'Final · settling' : ['LIVE', 'CRIT'].includes(g.state) ? `${g.period ?? ''} ${g.clock ?? ''}`.trim() : fmtTime(g.start_utc);
              return (
                <div key={gid} className="card divide-y divide-white/[.06]">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold">
                    {g ? <>{g.away} {g.away_score ?? 0} <span className="text-mute">@</span> {g.home} {g.home_score ?? 0}<span className={`ml-auto text-xs ${g && ['LIVE', 'CRIT'].includes(g.state) ? 'text-goal' : 'text-mute'}`}>{state}</span></> : 'Commish specials'}
                  </div>
                  {ms.map((m) => <MarketRow key={m.id} m={m} />)}
                </div>
              );
            })}
          </div>
        </Section>
      )}

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

      {tickets.length > 0 && <EveryTicket markets={markets} tickets={tickets} />}

      {closed.length > 0 && (
        <Section title="Results" right={closed.length > 8 ? <button className="text-xs text-sky-300" onClick={() => setShowResults(!showResults)}>{showResults ? 'Fewer' : `All ${closed.length}`}</button> : undefined}>
          <div className="card divide-y divide-white/[.06]">{[...closed].sort((a, b) => (b.settled_at ?? b.closes_at).localeCompare(a.settled_at ?? a.closes_at)).slice(0, showResults ? 200 : 8).map((m) => <Result key={m.id} m={m} />)}</div>
        </Section>
      )}

      <p className="text-center text-xs text-mute">Moneyline odds come from each club’s points percentage this season plus home ice; totals, overtime and props are fixed lines. Futures are priced from points banked plus what each roster projects to score, tightening as the season runs down. Requested races are priced from each player’s rate (or his projection) and his club’s games left, or from the NHL standings model, and freeze when they open; they settle from the box scores and the standings, a tie refunds everyone, and the Cup waits for the commish. Prices move: tonight’s markets stay open in play and re-price from the score and the clock (10% edge in play, no bets in the last two minutes or overtime, none while the score feed is behind); futures and races re-price from the standings and the box scores. Every ticket keeps the price it was bought at. The house keeps a 5% edge before puck drop (8% on futures and races), ties go to the under, postponed games and scratched players are refunded. Coins only, never cash.</p>

      {/* place a ticket */}
      <Sheet open={!!betting} onClose={() => setBetting(null)} title="Place a ticket">
        {betting && (
          <div className="space-y-3">
            <div className="text-sm"><span className="text-mute">{KIND[betting.m.kind].label} · </span>{betting.m.title}</div>
            <div className="rounded-xl border border-sky-400/40 bg-sky-500/10 p-3 text-center">
              <div className="text-lg font-bold">{betting.o.label}</div>
              <div className="num font-display text-3xl font-extrabold text-gold">{priceOf(betting.m, betting.o).toFixed(2)} <span className="text-sm font-normal text-mute">{american(priceOf(betting.m, betting.o))}</span></div>
              {Math.abs(priceOf(betting.m, betting.o) - Number(betting.o.odds)) >= 0.05 && <div className="text-xs text-mute">opened at {Number(betting.o.odds).toFixed(2)}</div>}
              {new Date(betting.m.closes_at).getTime() <= now && <div className="mt-1 text-xs text-goal">🔴 In play: you get the Book’s price at the moment you tap</div>}
            </div>
            <div>
              <div className="label mb-1">Stake (you have <AvailableCoins /> available)</div>
              <div className="flex flex-wrap gap-1.5">
                {STAKES.map((s) => <button key={s} className={`chip py-1 ${stake === s && !custom ? 'bg-emerald-500 text-ice' : ''}`} onClick={() => { setStake(s); setCustom(''); }}>{s}</button>)}
                <input className="input w-24 py-1" inputMode="numeric" placeholder="other" value={custom} onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); setCustom(v); if (v) setStake(Number(v)); }} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-white/[.04] px-3 py-2 text-sm"><span className="text-mute">Pays if it hits</span><span className="flex items-center gap-1 font-semibold"><Coin size={14} /> {Math.round(stake * priceOf(betting.m, betting.o))} <span className="text-xs text-mute">(+{Math.round(stake * priceOf(betting.m, betting.o)) - stake})</span></span></div>
            <button className="btn-primary w-full" disabled={busy || stake < 5 || stake > 500} onClick={place}>Place {stake} ☘️ on {betting.o.label}</button>
            <p className="text-center text-xs text-mute">{LONG.has(betting.m.kind) ? `Open until ${fmtDate(betting.m.closes_at.slice(0, 10))}; settles when the ${betting.m.kind === 'race' ? 'race' : 'season'} has the answer.` : new Date(betting.m.closes_at).getTime() <= now ? 'Open in play until the last two minutes of regulation.' : `Puck drop ${fmtTime(betting.m.closes_at)}, then in play until the last two minutes.`} Stakes leave your bank now; tickets can’t be cancelled. Max 500 a market.</p>
          </div>
        )}
      </Sheet>

      <Sheet open={newMarket} onClose={() => setNewMarket(false)} title="New market (commish)">
        <NewMarket onDone={() => { setNewMarket(false); reload(); }} />
      </Sheet>
      <Sheet open={asking} onClose={() => { setAsking(false); setAskStart(null); }} title="Ask the Book">
        {asking && <AskBook start={askStart ?? undefined} onDone={() => { setAsking(false); setAskStart(null); reload(); }} />}
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

// every ticket anyone has placed at the Book: who, on what, for how much, and how it went
export function EveryTicket({ markets, tickets }: { markets: Market[]; tickets: MarketBet[] }) {
  const { team, teams, me } = useLeague();
  const [who, setWho] = useState<number | 'all'>('all');
  const [all, setAll] = useState(false);
  const byId = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets]);
  const outcome = (t: MarketBet) => ticketOutcome(byId.get(t.market_id), t);
  const gms = teams.filter((t) => tickets.some((x) => x.team_id === t.id));
  const totals = gms.map((t) => {
    const mine = tickets.filter((x) => x.team_id === t.id).map(outcome);
    return { t, net: mine.reduce((s, o) => s + (o.net ?? 0), 0), w: mine.filter((o) => o.label === 'won').length, l: mine.filter((o) => o.label === 'lost').length, open: mine.filter((o) => o.label === 'open').length };
  }).sort((a, b) => b.net - a.net);
  const rows = tickets.filter((t) => who === 'all' || t.team_id === who);
  return (
    <Section title="📜 Every ticket" right={<span className="text-xs text-mute">{tickets.length} placed</span>}>
      <div className="scroll-x mb-2 flex gap-1">
        <button className={`chip shrink-0 py-1 ${who === 'all' ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setWho('all')}>Everyone</button>
        {totals.map(({ t, net, w, l, open }) => (
          <button key={t.id} className={`chip shrink-0 items-center gap-1 py-1 ${who === t.id ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setWho(t.id)}>
            <TeamBadge team={t} size={14} />{t.gm_name} <b className={net > 0 ? 'text-emerald-300' : net < 0 ? 'text-red-300' : ''}>{net > 0 ? '+' : ''}{net}</b>
            <span className="text-[10px] text-mute">{w}-{l}{open ? ` · ${open} open` : ''}</span>
          </button>
        ))}
      </div>
      <div className="card divide-y divide-white/[.06]">
        {(all ? rows : rows.slice(0, 15)).map((t) => {
          const m = byId.get(t.market_id);
          const o = m?.options.find((x) => x.key === t.pick);
          const r = outcome(t);
          return (
            <div key={t.id} className={`flex items-center gap-2 px-3 py-2 text-sm ${t.team_id === me?.id ? 'bg-white/[.03]' : ''}`}>
              <TeamBadge team={team(t.team_id)} size={22} />
              <div className="min-w-0 flex-1">
                <div className="truncate"><b>{team(t.team_id)?.gm_name}</b> · {o?.label ?? t.pick} <span className="text-mute">@ {Number(t.odds).toFixed(2)}</span></div>
                <div className="truncate text-[11px] text-mute">{m ? `${KIND[m.kind].icon} ${m.title}` : 'Market'} · {t.coins} ☘️ to win {Math.round(t.coins * t.odds) - t.coins} · {fmtDate(m?.date ?? t.created_at.slice(0, 10))}</div>
              </div>
              <span className={`num shrink-0 text-right font-semibold ${r.label === 'won' ? 'text-emerald-300' : r.label === 'lost' ? 'text-red-300' : 'text-mute'}`}>
                {r.label === 'open' ? 'open' : r.label === 'void' ? 'void' : `${r.net! > 0 ? '+' : ''}${r.net}`}
              </span>
            </div>
          );
        })}
      </div>
      {rows.length > 15 && <button className="mt-1 w-full text-center text-xs text-sky-300" onClick={() => setAll(!all)}>{all ? 'Fewer' : `All ${rows.length} tickets`}</button>}
      <p className="mt-1 px-1 text-[11px] text-mute">Net = what a ticket paid minus its stake. Void tickets were refunded.</p>
    </Section>
  );
}
