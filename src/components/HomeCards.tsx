// The home screen's windows into the rest of the site: tonight around the NHL, the league's coin bank, the latest
// Book tickets and the latest side-bet results. Each shows a handful of rows and leads to its own page.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { hub } from '../lib/nhlhub';
import { fmtDate, fmtMoney, fmtPts, fmtTime } from '../lib/format';
import { betMoves, ticketOutcome } from '../lib/betresults';
import { useBook } from './Book';
import { Coin, Rank, Section, TeamBadge } from './ui';
import type { TopGame } from './NhlTop';
import type { Bet, BetEntry, CoinBalance, MarketKind } from '../lib/types';
import { useBrand } from '../lib/brand';

const LIVE = new Set(['LIVE', 'CRIT']), DONE = new Set(['OFF', 'FINAL']);
const ICON: Record<MarketKind, string> = { winner: '🏒', total: '🥅', ot: '⏱️', prop: '⭐', custom: '🎯', future: '🔮', season_prop: '📅', race: '🏁' };
export const More = ({ to, label }: { to: string; label: string }) => <Link to={to} className="flex items-center gap-1 text-xs font-semibold text-sky-300">{label}<ArrowRight size={13} /></Link>;
const status = (g: TopGame) => DONE.has(g.state) ? `Final${g.outcome && g.outcome !== 'REG' ? ' / ' + g.outcome : ''}` : LIVE.has(g.state) ? (g.clock?.intermission ? `Int ${g.period?.n}` : `${g.period?.type === 'REG' ? 'P' + g.period?.n : g.period?.type} ${g.clock?.time ?? ''}`) : fmtTime(g.start);

// NHL centre, top: live games first, else tonight's slate, else last night's finals
export function NhlTopCard() {
  const { leagueDay, players, owner, team, sport } = useLeague();
  const [games, setGames] = useState<TopGame[] | null>(null);
  const [label, setLabel] = useState('Tonight');
  useEffect(() => {
    let dead = false;
    // a reply without its games (the feed hiccuped) reads as no games, not a card stuck loading
    hub<{ prev: string | null; games?: TopGame[] }>('scores', { date: leagueDay }).then(async (s) => {
      if (dead) return;
      const list = s?.games ?? [];
      if (list.length || !s?.prev) { setGames(list); return; }
      const p = await hub<{ games: TopGame[] }>('scores', { date: s.prev }).catch(() => null);
      if (!dead) { setLabel('Last night'); setGames(p?.games ?? []); }
    }, () => !dead && setGames([]));
    const i = setInterval(() => hub<{ games?: TopGame[] }>('scores', { date: leagueDay }).then((s) => !dead && s?.games?.length && setGames(s.games), () => {}), 120_000);
    return () => { dead = true; clearInterval(i); };
  }, [leagueDay]);
  const byNhl = useMemo(() => { const m = new Map<string, Set<number>>(); for (const [, r] of owner) { const p = players.get(r.player_id); if (!p?.nhl_team) continue; const t = m.get(p.nhl_team) ?? new Set(); t.add(r.team_id); m.set(p.nhl_team, t); } return m; }, [owner, players]);
  const gmsIn = (g: TopGame) => [...new Set([...(byNhl.get(g.home.abbrev) ?? []), ...(byNhl.get(g.away.abbrev) ?? [])])].slice(0, 4);
  const live = games?.filter((g) => LIVE.has(g.state)) ?? [];
  const rows = live.length ? live : (games ?? []);
  const title = live.length ? '🔴 Live right now' : games?.every((g) => DONE.has(g.state)) && games.length ? `🏒 ${label}: finals` : `🏒 ${label} around the NHL`;
  return (
    <Section title={title} right={<More to="/nhl" label={sport.words.centre ?? 'NHL centre'} />}>
      <div className="card divide-y divide-white/[.05]">
        {!games && <div className="p-3 text-sm text-mute">Loading…</div>}
        {games && games.length === 0 && <div className="p-3 text-sm text-mute">No NHL games today.</div>}
        {rows.slice(0, 5).map((g) => {
          const on = LIVE.has(g.state), done = DONE.has(g.state);
          return (
            <Link key={g.id} to="/nhl" className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/[.03]">
              <span className={`num w-14 shrink-0 text-[11px] ${on ? 'font-bold text-red-300' : 'text-mute'}`}>{on && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />}{status(g)}</span>
              {g.away.logo && <img src={g.away.logo} alt="" className="h-5 w-5" />}<span className="font-semibold">{g.away.abbrev}</span>
              {(done || on) ? <span className="num font-bold">{g.away.score}–{g.home.score}</span> : <span className="text-mute">@</span>}
              {g.home.logo && <img src={g.home.logo} alt="" className="h-5 w-5" />}<span className="font-semibold">{g.home.abbrev}</span>
              <span className="ml-auto flex items-center gap-1">{gmsIn(g).map((t) => <TeamBadge key={t} team={team(t)} size={12} />)}</span>
            </Link>
          );
        })}
        {rows.length > 5 && <Link to="/nhl?t=scores" className="block px-3 py-1.5 text-center text-xs text-sky-300">{rows.length - 5} more ›</Link>}
      </div>
    </Section>
  );
}

// Your last night against the best lineup you could have played from the same players (lineup_efficiency): a nudge to
// set lineups (or let the auto-pilot) when points sat on the bench. A points league's GMs only; quiet until a night is in.
export function LastNightCard() {
  const { me, league, leagueDay } = useLeague();
  const [row, setRow] = useState<{ date: string; points: number; best: number } | null>(null);
  const on = !!me && me.role !== 'spectator' && league?.phase === 'season' && !league?.categories?.length;
  useEffect(() => {
    if (!on) { setRow(null); return; }
    const from = new Date(new Date(leagueDay + 'T12:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10);
    const to = new Date(new Date(leagueDay + 'T12:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
    rpc<{ team_id: number; date: string; game_type: number; points: number; best: number }[]>('lineup_efficiency', { p_from: from, p_to: to })
      .then((rs) => {
        const mine = (rs ?? []).filter((r) => r.team_id === me!.id).sort((a, b) => b.date.localeCompare(a.date))[0];
        setRow(mine ? { date: mine.date, points: Number(mine.points), best: Number(mine.best) } : null);
      }, () => setRow(null));
  }, [on, me?.id, leagueDay]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !row || row.best <= 0) return null;
  const left = Math.max(0, row.best - row.points), pct = Math.round((row.points / row.best) * 100);
  const perfect = left < 0.05;
  const autoOn = !!me?.auto_mode && me.auto_mode !== 'off';
  return (
    <Section title="🎯 Lineup check" right={<More to="/performance" label="More" />}>
      <div className="card space-y-2 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm text-slate-200">{fmtDate(row.date)}: <span className="num font-bold text-white">{fmtPts(row.points)}</span> of a possible <span className="num font-bold text-white">{fmtPts(row.best)}</span></div>
          <div className={`num font-display text-2xl font-extrabold leading-none ${perfect ? 'text-emerald-300' : pct >= 85 ? 'text-slate-100' : 'text-amber-200'}`}>{pct}%</div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${perfect ? 'bg-emerald-400' : 'bg-gold'}`} style={{ width: `${Math.max(3, Math.min(100, pct))}%` }} /></div>
        <div className="text-xs text-mute">
          {perfect ? 'Perfect: the best lineup those players could have played.'
            : <>{fmtPts(left)} points sat on the bench that the best lineup would have used. {autoOn
              ? <Link to={`/scoreboard?day=${row.date}`} className="font-semibold text-sky-300">See the night ›</Link>
              : <Link to="/team" className="font-semibold text-sky-300">Let the auto-pilot set it ›</Link>}</>}
        </div>
      </div>
    </Section>
  );
}

// the coin bank: every GM's coins, richest first
export function BankCard() {
  const { teams, team, me } = useLeague();
  const brand = useBrand();
  const [bank, setBank] = useState<CoinBalance[]>([]);
  useEffect(() => { supabase.from('coin_balances').select('*').then(({ data }) => setBank((data ?? []) as CoinBalance[])); }, []);
  const rows = [...bank].filter((c) => teams.some((t) => t.id === c.team_id && t.role !== 'spectator')).sort((a, b) => b.balance - a.balance);
  const tie = rows.length > 1 && rows.every((x) => x.balance === rows[0].balance);
  return (
    <Section title={`${brand.coin.emoji} ${brand.bank}`} right={<More to="/bets?t=leaders" label="Leaders" />}>
      <div className="card divide-y divide-white/[.06] overflow-hidden" style={{ background: 'linear-gradient(160deg, rgb(var(--gold-rgb)/.10), rgba(15,23,41,.75) 45%)' }}>
        {rows.length === 0 && <div className="p-3 text-sm text-mute">No coins in circulation yet.</div>}
        {rows.map((c, i) => (
          <Link to="/bets?t=leaders" key={c.team_id} className={`flex items-center gap-2.5 px-3 py-1.5 ${c.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
            {tie ? <span className="grid h-7 w-7 place-items-center text-mute">–</span> : <Rank n={i + 1} />}
            <TeamBadge team={team(c.team_id)} size={24} />
            <div className="min-w-0 flex-1 truncate text-sm font-semibold">{team(c.team_id)?.gm_name}{c.escrow ? <span className="ml-1 text-[11px] font-normal text-mute">· {c.escrow} in play</span> : null}</div>
            <div className="flex items-center gap-1"><Coin size={14} /><span className="num text-gold-shine font-display font-extrabold">{c.balance.toLocaleString()}</span></div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

// the latest tickets at the Book and what they did
export function TicketsCard() {
  const { team, me } = useLeague();
  const { markets, tickets } = useBook();
  const byId = useMemo(() => new Map(markets.map((m) => [m.id, m])), [markets]);
  return (
    <Section title="📜 Every ticket" right={<More to="/bets?t=book" label="The Book" />}>
      <div className="card divide-y divide-white/[.06]">
        {tickets.length === 0 && <div className="p-3 text-sm text-mute">Nobody has placed a ticket yet. <Link to="/bets?t=book" className="text-sky-300">Open the Book ›</Link></div>}
        {tickets.slice(0, 5).map((t) => {
          const m = byId.get(t.market_id);
          const o = m?.options.find((x) => x.key === t.pick);
          const r = ticketOutcome(m, t);
          return (
            <Link to="/bets?t=book" key={t.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${t.team_id === me?.id ? 'bg-white/[.03]' : ''}`}>
              <TeamBadge team={team(t.team_id)} size={20} />
              <div className="min-w-0 flex-1">
                <div className="truncate"><b>{team(t.team_id)?.gm_name}</b> · {o?.label ?? t.pick} <span className="text-mute">@ {Number(t.odds).toFixed(2)}</span></div>
                <div className="truncate text-[11px] text-mute">{m ? `${ICON[m.kind]} ${m.title}` : 'Market'} · {t.coins} ☘️</div>
              </div>
              <span className={`num shrink-0 font-semibold ${r.label === 'won' ? 'text-emerald-300' : r.label === 'lost' ? 'text-red-300' : 'text-mute'}`}>{r.label === 'open' ? 'open' : r.label === 'void' ? 'void' : `${r.net! > 0 ? '+' : ''}${r.net}`}</span>
            </Link>
          );
        })}
        {tickets.length > 5 && <Link to="/bets?t=book" className="block px-3 py-1.5 text-center text-xs text-sky-300">All {tickets.length} tickets ›</Link>}
      </div>
    </Section>
  );
}

// the latest settled side bets and who collected
export function BetResultsCard() {
  const { team } = useLeague();
  const [bets, setBets] = useState<Bet[] | null>(null);
  const [entries, setEntries] = useState<BetEntry[]>([]);
  useEffect(() => {
    supabase.from('bets').select('*').eq('status', 'settled').order('settled_at', { ascending: false }).limit(5).then(async ({ data }) => {
      const list = (data ?? []) as Bet[];
      const pools = list.filter((b) => b.kind.startsWith('pool')).map((b) => b.id);
      if (pools.length) { const { data: es } = await supabase.from('bet_entries').select('*').in('bet_id', pools); setEntries((es ?? []) as BetEntry[]); }
      setBets(list);
    });
  }, []);
  return (
    <Section title="📜 Bet results" right={<More to="/bets" label="Side bets" />}>
      <div className="card divide-y divide-white/[.06]">
        {bets && bets.length === 0 && <div className="p-3 text-sm text-mute">No side bet has settled yet.</div>}
        {!bets && <div className="p-3 text-sm text-mute">Loading…</div>}
        {(bets ?? []).map((b) => {
          const m = betMoves(b, entries);
          const winners = [...m.entries()].filter(([, x]) => x.won === true).sort((a, c) => c[1].coins - a[1].coins);
          return (
            <Link to="/bets" key={b.id} className="block px-3 py-1.5 text-sm">
              <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-semibold">{b.title}</span><span className="shrink-0 text-[11px] text-mute">{b.settled_at ? fmtDate(b.settled_at.slice(0, 10)) : ''}</span></div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs">
                {b.push ? <span className="text-mute">🤝 Push</span> : winners.length === 0 ? <span className="text-mute">No winner</span> : winners.map(([t, x]) => (
                  <span key={t} className="flex items-center gap-1"><TeamBadge team={team(t)} size={13} />{team(t)?.gm_name} <b className="text-emerald-300">won{x.coins ? ` +${x.coins} ☘️` : ''}{x.cash ? ` +${fmtMoney(x.cash)}` : ''}</b></span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </Section>
  );
}
