// Side bets: St. Patrick coins, real money and dignity. Two-sided bets (anything, fantasy points head-to-head,
// final standings, a player over/under, player vs player, your team over/under) and pools everyone buys into
// (the league's top team of the week, pick a player). Tracked bets show live numbers and settle themselves from the box
// scores every morning; cash bets keep a tab of who owes whom.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookTab, BookLeaders } from '../components/Book';
import { useLeague, useNow, useSport } from '../lib/store';
import { calledOff, notStarted } from '../lib/sport';
import { rpc, realtimeChannel, supabase, selectAll } from '../lib/supabase';
import type { Bet, BetEntry, BetKind, BetProgress, BetStat, CoinBalance, CoinEntry, CoinRace, Player, Team } from '../lib/types';
import { useBrand } from '../lib/brand';
import { ago, etToday, fmtDate, fmtMoney, fmtPts } from '../lib/format';
import { Empty, Section, Sheet, TeamBadge, TeamName, useAction, PageHeader, Coin, Rank } from '../components/ui';
import { BookOpen, Dices, Lightbulb, Sparkles, Trophy } from 'lucide-react';
import { useSeasonGames } from '../lib/projections';
import { betWinChance, type OddsCtx } from '../lib/betodds';
import { betMoves } from '../lib/betresults';

interface Daily { team_id: number; date: string; points: number }
type Form = { kind: BetKind; opponent: string; title: string; terms: string; stake: string; amount: string; coins: string; odds: number; start: string; end: string; entryClose: string;
  playerId: number | null; playerB: number | null; stat: BetStat; line: string; side: 'over' | 'under'; teamPick: number | null };

const KINDS: { k: BetKind; icon: string; label: string; blurb: string; pool?: boolean; tracked?: boolean }[] = [
  { k: 'custom', icon: '🤝', label: 'Anything', blurb: 'Your terms. You two settle it.' },
  { k: 'h2h', icon: '⚔️', label: 'Points head-to-head', blurb: 'More fantasy points over the window wins. Settles itself.', tracked: true },
  { k: 'player_ou', icon: '📈', label: 'Player over / under', blurb: 'Pick a player, a stat and a line. Settles itself.', tracked: true },
  { k: 'player_vs', icon: '🥊', label: 'Player vs player', blurb: 'Your guy against theirs. Settles itself.', tracked: true },
  { k: 'team_ou', icon: '🎯', label: 'My team over / under', blurb: 'Your team beats a points line. They take the other side.', tracked: true },
  { k: 'season', icon: '🏆', label: 'Final standings', blurb: 'Who finishes higher. Settle it in April.' },
  { k: 'pool_team', icon: '🎰', label: 'Pool: top team', blurb: 'Everyone buys in and picks the {L} team that scores most. Pot to the winner.', pool: true, tracked: true },
  { k: 'pool_player', icon: '🎰', label: 'Pool: pick a player', blurb: 'Everyone buys in and names a player (no repeats). Most points takes the pot.', pool: true, tracked: true },
];
// {L} is the league's short name ("SaK points"), filled in where the words are shown
const STATS: [BetStat, string][] = [['fpts', '{L} points'], ['g', 'Goals'], ['a', 'Assists'], ['pts', 'Points'], ['ppp', 'PP points'], ['sog', 'Shots'], ['hit', 'Hits'], ['blk', 'Blocks'], ['pim', 'PIM'], ['w', 'Wins'], ['sv', 'Saves'], ['sho', 'Shutouts']];
const STAT_LABEL = Object.fromEntries(STATS) as Record<BetStat, string>;
const statWord = (k: BetStat) => (k === 'fpts' ? '{L} points' : STAT_LABEL[k].toLowerCase());
const TRACKED = new Set<BetKind>(['h2h', 'player_ou', 'player_vs', 'team_ou', 'pool_team', 'pool_player']);
const isPool = (k: BetKind) => k.startsWith('pool');

// date windows in ET: tonight, this week (Mon–Sun), next 7 days, this month, the whole season
const shift = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// once tonight's first game has started, box-score bets start tomorrow (no betting on a night already under way)
function windows(seasonStart: string | null, seasonEnd: string | null, tonightStarted: boolean) {
  const t = tonightStarted ? shift(etToday(), 1) : etToday();
  const dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7;   // Monday = 0
  const mon = shift(t, -dow);
  const mEnd = new Date(t.slice(0, 7) + '-01T12:00:00Z'); mEnd.setUTCMonth(mEnd.getUTCMonth() + 1); mEnd.setUTCDate(0);
  return [
    { label: tonightStarted ? 'Tomorrow night' : 'Tonight', start: t, end: t }, { label: tonightStarted ? 'Rest of the week' : 'This week', start: tonightStarted ? t : mon, end: shift(mon, 6) }, { label: 'Next 7 days', start: t, end: shift(t, 6) },
    { label: 'This month', start: t, end: mEnd.toISOString().slice(0, 10) }, { label: 'Rest of season', start: t, end: seasonEnd ?? shift(t, 180) },
    ...(seasonStart ? [{ label: 'Whole season', start: seasonStart, end: seasonEnd ?? shift(seasonStart, 190) }] : []),
  ];
}
const days = (a: string, b: string) => Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);
// a fair-ish line: the player's per-game rate × the games he'd play in the window (about 3.5 a week), to the half
function suggestLine(p: Player | undefined, stat: BetStat, start: string, end: string) {
  if (!p) return '';
  const games = Math.max(1, Math.round(days(start, end) * 0.5));
  const perGame = stat === 'fpts' ? p.proj / 82 : (p.last_stats?.[stat] ?? 0) / Math.max(1, p.last_stats?.gp ?? 82);
  const raw = perGame * games;
  return String(Math.max(0.5, Math.round(raw * 2) / 2 - (Number.isInteger(raw) ? 0.5 : 0)));
}

export default function Bets() {
  const { me, teams, team, players, rosters, standings, spectators, can, league, games, leagueDay } = useLeague();
  const sport = useSport();
  const brand = useBrand();
  const L = (s: string) => s.replaceAll('{L}', brand.short);
  const seasonGames = useSeasonGames();
  const [ruling, setRuling] = useState<Bet | null>(null);
  const now = useNow(30_000);
  const { busy, run } = useAction();
  const [bets, setBets] = useState<Bet[]>([]);
  const [entries, setEntries] = useState<BetEntry[]>([]);
  const [progress, setProgress] = useState<Record<number, BetProgress>>({});
  const [daily, setDaily] = useState<Daily[]>([]);
  const [bank, setBank] = useState<CoinBalance[]>([]);
  const [races, setRaces] = useState<CoinRace[]>([]);
  const [race, setRace] = useState<'week' | 'month' | 'season'>('week');
  const [myCoins, setMyCoins] = useState<CoinEntry[]>([]);
  const [showLedger, setShowLedger] = useState(false);
  const [showAllSettled, setShowAllSettled] = useState(false);
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState<Bet | null>(null);
  const tonightStarted = games.some((g) => g.date === leagueDay && !calledOff(sport, g.state) && new Date(g.start_utc).getTime() <= now);
  // a box-score bet whose first night has started can't be taken or joined (the server enforces it too)
  const underway = (b: Bet) => !!b.start_date && (b.start_date < leagueDay || (b.start_date === leagueDay && tonightStarted));
  const firstDay = tonightStarted ? shift(etToday(), 1) : etToday();
  const blank: Form = { kind: 'custom', opponent: '', title: '', terms: '', stake: '', amount: '', coins: '100', odds: 1, start: firstDay, end: firstDay, entryClose: firstDay, playerId: null, playerB: null, stat: 'fpts', line: '', side: 'over', teamPick: null };
  const [f, setF] = useState<Form>(blank);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('t') as 'side' | 'book' | 'leaders') || 'side';
  const setTab = (t: string) => setParams(t === 'side' ? {} : { t }, { replace: true });
  const gms = useMemo(() => teams.filter((t) => t.role !== 'spectator'), [teams]);
  const wins = useMemo(() => windows(league?.season_start ?? null, league?.season_end ?? null, tonightStarted), [league?.season_start, league?.season_end, tonightStarted]);

  const load = () => {
    supabase.from('bets').select('*').order('id', { ascending: false }).then(({ data }) => setBets((data ?? []) as Bet[]));
    supabase.from('bet_entries').select('*').then(({ data }) => setEntries((data ?? []) as BetEntry[]));
    supabase.from('coin_balances').select('*').then(({ data }) => setBank((data ?? []) as CoinBalance[]));
    supabase.from('coin_races').select('*').then(({ data }) => setRaces((data ?? []) as CoinRace[]));
    if (me) supabase.from('coin_ledger').select('*').eq('team_id', me.id).order('id', { ascending: false }).limit(30).then(({ data }) => setMyCoins((data ?? []) as CoinEntry[]));
  };
  useEffect(() => {
    load();
    selectAll<Daily>('team_daily', 'team_id,date,points', 1000, ['date', 'team_id']).then(setDaily, () => {});
    const ch = realtimeChannel('bets-page')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_entries' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coin_ledger' }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // live numbers for every tracked bet that's on (refreshed with the page's clock)
  const liveTracked = useMemo(() => bets.filter((b) => (TRACKED.has(b.kind) || (b.kind === 'season' && !!b.opponent_team)) && (b.status === 'accepted' || (isPool(b.kind) && b.status === 'open'))), [bets]);
  useEffect(() => {
    let dead = false;
    Promise.all(liveTracked.map((b) => rpc<BetProgress>('bet_progress', { p_bet: b.id }).then((p) => [b.id, p] as const, () => [b.id, {}] as const))).then((rows) => { if (!dead) setProgress(Object.fromEntries(rows)); });
    return () => { dead = true; };
  }, [liveTracked.map((b) => b.id).join(), Math.floor(now / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps

  // live odds of winning for every tracked bet: what's banked so far plus what's still to come
  const oddsCtx = useMemo<OddsCtx | null>(() => {
    if (!seasonGames) return null;
    const today = etToday();
    const started = new Set<string>();
    for (const g of games) if (g.date === today && !notStarted(sport, g.state)) { started.add(`${today}|${g.home}`); started.add(`${today}|${g.away}`); }
    const byTeam = new Map<number, Player[]>();
    for (const r of rosters) if (r.slot !== 'IR') { const p = players.get(r.player_id); if (p) byTeam.set(r.team_id, [...(byTeam.get(r.team_id) ?? []), p]); }
    return { today, games: seasonGames, started, players, rosterOf: (t) => byTeam.get(t) ?? [], caps: (league?.roster ?? {}) as Record<string, number>, seasonStart: league?.season_start, seasonEnd: league?.season_end };
  }, [seasonGames, games, rosters, players, league]);
  const chances = useMemo(() => {
    const out: Record<number, ReturnType<typeof betWinChance>> = {};
    if (!oddsCtx) return out;
    for (const b of liveTracked) { try { out[b.id] = betWinChance(b, progress[b.id], oddsCtx); } catch { out[b.id] = null; } }
    return out;
  }, [liveTracked, progress, oddsCtx]);
  const h2h = (b: Bet, t: number | null) => daily.filter((d) => d.team_id === t && (!b.start_date || d.date >= b.start_date) && (!b.end_date || d.date <= b.end_date)).reduce((s, d) => s + Number(d.points), 0);
  const rank = (t: number | null) => standings.find((s) => s.team_id === t)?.rank;
  const myBank = bank.find((b) => b.team_id === me?.id);
  const available = (myBank?.balance ?? 0) - (myBank?.escrow ?? 0);
  const pname = (id?: number | null) => (id ? players.get(id)?.name ?? `#${id}` : '?');

  const groups = useMemo(() => ({
    open: bets.filter((b) => b.status === 'open' && !isPool(b.kind)),
    pools: bets.filter((b) => isPool(b.kind) && (b.status === 'open' || b.status === 'accepted')),
    live: bets.filter((b) => b.status === 'accepted' && !isPool(b.kind)),
    settled: bets.filter((b) => b.status === 'settled'),
    expired: bets.filter((b) => b.status === 'expired' && Date.now() - new Date(b.created_at).getTime() < 21 * 86400000),
  }), [bets]);
  // nobody took it in 7 days: it expires (pools only if nobody else has joined)
  const expiresIn = (b: Bet) => {
    if (b.status !== 'open') return null;
    if (isPool(b.kind) && entries.some((e) => e.bet_id === b.id && e.team_id !== b.creator_team)) return null;
    const at = new Date(b.created_at).getTime() + 7 * 86400000;
    // a pool whose entries close sooner just closes: the entries line already says when
    if (isPool(b.kind) && b.entry_close && new Date(b.entry_close + 'T23:59:00').getTime() < at) return null;
    return at - now;
  };

  // cash: settled money bets that haven't been marked paid, netted per pair, plus each GM's net
  const cash = useMemo(() => {
    const pairs = new Map<string, { from: number; to: number; amount: number; bets: Bet[] }>();
    const net = new Map<number, number>();
    for (const b of groups.settled) {
      if (!b.amount || !b.winner_team || b.push) continue;
      const loser = b.winner_team === b.creator_team ? b.opponent_team : b.creator_team;
      if (!loser) continue;
      net.set(b.winner_team, (net.get(b.winner_team) ?? 0) + Number(b.amount)); net.set(loser, (net.get(loser) ?? 0) - Number(b.amount));
      if (b.paid) continue;
      const key = [Math.min(loser, b.winner_team), Math.max(loser, b.winner_team)].join(':');
      const cur = pairs.get(key) ?? { from: loser, to: b.winner_team, amount: 0, bets: [] };
      cur.amount += loser === cur.from ? Number(b.amount) : -Number(b.amount);
      cur.bets.push(b); pairs.set(key, cur);
    }
    return { owed: [...pairs.values()].map((p) => (p.amount < 0 ? { ...p, from: p.to, to: p.from, amount: -p.amount } : p)).filter((p) => p.amount > 0), net };
  }, [groups.settled]);
  const record = (t: number) => ({
    w: groups.settled.filter((b) => (b.winner_team === t && !b.push) || (isPool(b.kind) && ((b.result?.winners as number[] | undefined) ?? []).includes(t))).length,
    l: groups.settled.filter((b) => !b.push && ((b.winner_team && b.winner_team !== t && (b.creator_team === t || b.opponent_team === t)) || (isPool(b.kind) && entries.some((e) => e.bet_id === b.id && e.team_id === t) && !((b.result?.winners as number[] | undefined) ?? []).includes(t)))).length,
    p: groups.settled.filter((b) => b.push && (b.creator_team === t || b.opponent_team === t)).length,
  });

  // ideas: built from your roster, the standings and whoever's nearby
  const ideas = useMemo(() => {
    if (!me) return [];
    const mine = rosters.filter((r) => r.team_id === me.id).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p && p.pos !== 'G').sort((a, b) => b.proj - a.proj);
    const others = gms.filter((t) => t.id !== me.id);
    const pickOther = others[Math.floor((now / 3_600_000) % Math.max(1, others.length))] ?? others[0];
    const theirs = pickOther ? rosters.filter((r) => r.team_id === pickOther.id).map((r) => players.get(r.player_id)).filter((p): p is Player => !!p && p.pos !== 'G').sort((a, b) => b.proj - a.proj) : [];
    const week = wins[1];
    const myRank = rank(me.id);
    const neighbour = myRank ? gms.find((t) => rank(t.id) === (myRank > 1 ? myRank - 1 : 2)) : null;
    const out: { icon: string; title: string; why: string; form: Partial<Form> }[] = [];
    if (pickOther) out.push({ icon: '⚔️', title: `Who wins the week: you vs ${pickOther.gm_name}`, why: 'Most fantasy points Monday to Sunday. Settles itself Monday morning.', form: { kind: 'h2h', opponent: String(pickOther.id), title: `Most points this week: ${me.gm_name} vs ${pickOther.gm_name}`, start: week.start, end: week.end, coins: '100' } });
    if (mine[0] && theirs[0] && pickOther) out.push({ icon: '🥊', title: `${mine[0].name} vs ${theirs[0].name}`, why: `Your best against ${pickOther.gm_name}’s best this week, ${brand.short} points.`, form: { kind: 'player_vs', opponent: String(pickOther.id), title: `${mine[0].name} vs ${theirs[0].name} this week`, playerId: mine[0].id, playerB: theirs[0].id, stat: 'fpts', start: week.start, end: week.end, coins: '75' } });
    if (mine[0]) out.push({ icon: '📈', title: `${mine[0].name} over ${suggestLine(mine[0], 'fpts', week.start, week.end)} ${brand.short} points this week`, why: 'You take the over, whoever bites takes the under.', form: { kind: 'player_ou', opponent: '', title: `${mine[0].name} over ${suggestLine(mine[0], 'fpts', week.start, week.end)} ${brand.short} pts this week`, playerId: mine[0].id, stat: 'fpts', line: suggestLine(mine[0], 'fpts', week.start, week.end), side: 'over', start: week.start, end: week.end, coins: '50' } });
    if (mine[1]) out.push({ icon: '🚨', title: `${mine[1].name} scores tonight`, why: `Over 0.5 goals tonight. Quick, loud, settles tomorrow morning.`, form: { kind: 'player_ou', opponent: '', title: `${mine[1].name} scores tonight`, playerId: mine[1].id, stat: 'g', line: '0.5', side: 'over', start: wins[0].start, end: wins[0].end, coins: '25' } });
    out.push({ icon: '🎰', title: `Pool: top ${brand.short} team this week`, why: `Everyone in for 50 coins, pick the team that scores most. Pot to the winner.`, form: { kind: 'pool_team', title: `Top ${brand.short} team this week`, teamPick: me.id, start: week.start, end: week.end, entryClose: week.start, coins: '50' } });
    if (neighbour) out.push({ icon: '🏆', title: `Finish above ${neighbour.gm_name}`, why: 'Final standings. Bragging rights until next September.', form: { kind: 'season', opponent: String(neighbour.id), title: `${me.gm_name} finishes above ${neighbour.gm_name}`, coins: '200', amount: '20' } });
    return out;
  }, [me, rosters, players, gms, wins, standings, Math.floor(now / 3_600_000)]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => run(async () => {
    const subject = f.kind === 'player_ou' ? { player_id: f.playerId, stat: f.stat, line: Number(f.line), side: f.side }
      : f.kind === 'player_vs' ? { player_a: f.playerId, player_b: f.playerB, stat: f.stat }
      : f.kind === 'team_ou' ? { line: Number(f.line), side: f.side }
      : f.kind === 'pool_team' ? { team_id: f.teamPick ?? me?.id } : f.kind === 'pool_player' ? { player_id: f.playerId, stat: 'fpts' } : {};
    const dated = TRACKED.has(f.kind);
    await rpc('create_bet_v2', { p: { opponent: f.opponent || null, title: f.title, terms: f.terms || null, kind: f.kind, stake: f.stake || null, amount: f.amount || null,
      start: dated ? f.start : null, end: dated ? f.end : null, entry_close: isPool(f.kind) ? f.entryClose : null, coins: Number(f.coins) || 0, odds: isPool(f.kind) ? 1 : f.odds, subject } });
    setOpen(false); setF(blank); load();
  }, isPool(f.kind) ? 'Pool is open 🎰' : 'Bet posted 🎲');
  const useIdea = (form: Partial<Form>) => { setF({ ...blank, ...form }); setOpen(true); };
  const pickerPlayer = (id: number | null) => (id ? players.get(id) : undefined);

  // ───── one bet
  const Progress = ({ b }: { b: Bet }) => {
    const p = progress[b.id];
    if (!TRACKED.has(b.kind)) return null;
    const bar = (v: number, line: number) => <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/[.08]"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400" style={{ width: `${Math.min(100, (v / Math.max(line * 1.5, 1)) * 100)}%` }} /></div>;
    if (b.kind === 'h2h' || b.kind === 'player_vs') {
      const a = p?.a ?? (b.kind === 'h2h' ? h2h(b, b.creator_team) : 0), bb = p?.b ?? (b.kind === 'h2h' ? h2h(b, b.opponent_team) : 0);
      const la = b.kind === 'h2h' ? team(b.creator_team)?.gm_name : pname(b.subject?.player_a), lb = b.kind === 'h2h' ? team(b.opponent_team)?.gm_name : pname(b.subject?.player_b);
      return (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-white/[.07] bg-black/25 p-2 text-center">
          <div><div className="truncate text-xs text-mute">{la}</div><div className={`num font-display text-2xl font-extrabold ${a > bb ? 'text-emerald-300' : ''}`}>{fmtPts(a)}</div></div>
          <div><div className="truncate text-xs text-mute">{lb ?? 'open'}</div><div className={`num font-display text-2xl font-extrabold ${bb > a ? 'text-emerald-300' : ''}`}>{fmtPts(bb)}</div></div>
          <div className="col-span-2 text-[11px] text-mute">{b.kind === 'h2h' ? 'Fantasy points' : L(STAT_LABEL[b.subject?.stat ?? 'fpts'])} {fmtDate(b.start_date!)} → {fmtDate(b.end_date!)}</div>
        </div>
      );
    }
    if (b.kind === 'player_ou' || b.kind === 'team_ou') {
      const v = p?.value ?? 0, line = Number(b.subject?.line ?? 0);
      const who = b.kind === 'player_ou' ? `${pname(b.subject?.player_id)} · ${L(STAT_LABEL[b.subject?.stat ?? 'fpts'])}` : `${team(b.creator_team)?.name} · fantasy points`;
      return (
        <div className="mt-2 rounded-xl border border-white/[.07] bg-black/25 p-2 text-sm">
          <div className="flex items-baseline justify-between"><span className="truncate text-xs text-mute">{who}</span><span className="num font-display text-xl font-extrabold">{fmtPts(v)} <span className="text-xs font-normal text-mute">/ line {line}</span></span></div>
          {bar(v, line)}
          <div className="mt-1 text-[11px] text-mute">{team(b.creator_team)?.gm_name} has the {b.subject?.side}{b.opponent_team ? `, ${team(b.opponent_team)?.gm_name} the ${b.subject?.side === 'over' ? 'under' : 'over'}` : ''} · {fmtDate(b.start_date!)} → {fmtDate(b.end_date!)}</div>
        </div>
      );
    }
    // pools
    const es = entries.filter((e) => e.bet_id === b.id);
    const rows = (p?.entries ?? es.map((e) => ({ team_id: e.team_id, pick: e.choice.team_id ?? e.choice.player_id ?? 0, value: 0, coins: e.coins })));
    const pot = es.reduce((s, e) => s + e.coins, 0);
    return (
      <div className="mt-2 rounded-xl border border-white/[.07] bg-black/25 p-2 text-sm">
        <div className="mb-1 flex items-center justify-between text-[11px] text-mute"><span>{es.length} in · entries {b.status === 'open' ? `close ${fmtDate(b.entry_close!)}` : 'closed'} · {fmtDate(b.start_date!)} → {fmtDate(b.end_date!)}</span><span className="flex items-center gap-1 text-gold"><Coin size={12} /> {pot} pot</span></div>
        {rows.map((r, i) => (
          <div key={r.team_id} className={`flex items-center gap-2 py-0.5 ${r.team_id === me?.id ? 'text-white' : 'text-slate-300'}`}>
            <span className="num w-4 text-[11px] text-mute">{i + 1}</span><TeamBadge team={team(r.team_id)} size={18} />
            <span className="min-w-0 flex-1 truncate">{b.kind === 'pool_team' ? team(r.pick)?.name : pname(r.pick)}</span>
            <span className={`num font-semibold ${i === 0 && r.value > 0 ? 'text-emerald-300' : ''}`}>{fmtPts(r.value)}</span>
            {(() => { const c = chances[b.id]; const w = c && 'pool' in c ? c.pool.get(r.team_id) : undefined; return w != null ? <span className="num w-10 text-right text-[11px] text-sky-200" title="Live odds to win the pool">{Math.round(w * 100)}%</span> : null; })()}
          </div>
        ))}
      </div>
    );
  };

  const BetCard = ({ b }: { b: Bet }) => {
    const pool = isPool(b.kind);
    const mine = b.creator_team === me?.id || b.opponent_team === me?.id || (pool && entries.some((e) => e.bet_id === b.id && e.team_id === me?.id));
    const other = b.creator_team === me?.id ? b.opponent_team : b.creator_team;
    const kind = KINDS.find((k) => k.k === b.kind);
    const inPool = pool && entries.some((e) => e.bet_id === b.id && e.team_id === me?.id);
    const late = TRACKED.has(b.kind) && underway(b);
    const canJoin = pool && b.status === 'open' && !inPool && can('bets') && me?.role !== 'spectator' && (b.entry_close ?? '') >= etToday() && !late;
    return (
      <div className={`card p-3 ${mine ? 'border-sky-400/30 shadow-[0_0_0_1px_rgba(76,195,255,.15),0_12px_32px_-18px_rgba(76,195,255,.6)]' : ''}`}>
        <div className="flex items-start gap-2">
          {pool ? <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-gold/15 text-lg">🎰</div>
            : <div className="flex items-center"><TeamBadge team={team(b.creator_team)} size={32} /><span className="z-10 -mx-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#0b1222] text-[8px] font-black text-white/70 ring-1 ring-white/15">VS</span><TeamBadge team={team(b.opponent_team)} size={32} /></div>}
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-snug">{b.title}</div>
            <div className="text-xs text-mute">
              <span className="mr-1 rounded bg-white/[.06] px-1 text-[10px]">{kind?.icon} {kind?.label}</span>
              {pool ? <><TeamName link team={team(b.creator_team)} /> opened it</> : <><TeamName link team={team(b.creator_team)} /> vs {b.opponent_team ? <TeamName link team={team(b.opponent_team)} /> : <span className="text-amber-300">anyone</span>}</>} · {ago(b.created_at, now)}
            </div>
          </div>
          {(b.amount || b.stake || b.coins > 0) && (
            <div className="text-right text-sm">
              {b.coins > 0 && <div className="flex items-center justify-end gap-1"><Coin size={16} /><span className="num text-gold-shine font-display text-lg font-extrabold">{Number(b.odds) !== 1 ? `${Math.round(b.coins * Number(b.odds))} v ${b.coins}` : b.coins}</span>{pool && <span className="text-[10px] text-mute">each</span>}</div>}
              {Number(b.odds) !== 1 && <div className="text-[10px] text-mute">{team(b.creator_team)?.gm_name} risks {Math.round(b.coins * Number(b.odds))}, {b.opponent_team ? team(b.opponent_team)?.gm_name : 'taker'} risks {b.coins}</div>}
              {!!b.amount && <div className="font-display text-lg font-bold text-gold">{fmtMoney(b.amount)}</div>}
              <div className="max-w-28 text-[11px] text-mute">{b.stake}</div>
            </div>
          )}
        </div>
        {(() => { const ms = expiresIn(b); if (ms == null) return null; const h = Math.max(0, Math.floor(ms / 3600000));
          return <div className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${h < 24 ? 'bg-amber-500/15 text-amber-200' : 'bg-white/[.05] text-mute'}`}>⌛ {h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`} left for someone to take it</div>; })()}
        {b.status === 'expired' && <div className="mt-1.5 inline-flex rounded-full bg-white/[.05] px-2 py-0.5 text-[11px] text-mute">⌛ Expired: nobody took it within 7 days</div>}
        {b.terms && <p className="mt-2 text-sm text-slate-300">{b.terms}</p>}
        {(b.status === 'accepted' || pool) && b.status !== 'settled' && <Progress b={b} />}
        {b.status === 'accepted' && !pool && (() => { const c = chances[b.id]; if (!c || !('creator' in c)) return null; const pa = Math.round(c.creator * 100);
          return (
            <div className="mt-2 rounded-xl border border-white/[.07] bg-black/20 p-2 text-xs">
              <div className="mb-1 flex justify-between"><span>📈 {team(b.creator_team)?.gm_name} <b className="num text-white">{pa}%</b></span><span className="text-mute">odds to win, live</span><span><b className="num text-white">{100 - pa}%</b> {team(b.opponent_team)?.gm_name}</span></div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[.08]"><div className="bg-sky-400" style={{ width: `${pa}%` }} /><div className="flex-1 bg-amber-400/80" /></div>
            </div>
          ); })()}
        {b.kind === 'season' && b.opponent_team && b.status !== 'settled' && (
          <div className="mt-2 text-xs text-mute">Currently: {team(b.creator_team)?.gm_name} #{rank(b.creator_team) ?? '–'} · {team(b.opponent_team)?.gm_name} #{rank(b.opponent_team) ?? '–'}</div>
        )}
        {b.status === 'settled' && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {b.push ? <span>🤝 Push, coins returned</span> : pool ? <span>🏆 {((b.result?.winners as number[] | undefined) ?? [b.winner_team!]).map((w) => team(w)?.gm_name).join(' & ')} took the {String(b.result?.pot ?? '')} ☘️ pot</span>
              : <>🏆 <TeamName link team={team(b.winner_team!)} /> won{b.result && (b.kind === 'h2h' || b.kind === 'player_vs') ? <span className="text-xs text-mute">{fmtPts(Number(b.result.a))} to {fmtPts(Number(b.result.b))}</span> : b.result && b.result.value != null ? <span className="text-xs text-mute">{fmtPts(Number(b.result.value))} vs line {String(b.result.line)}</span> : null}</>}
            {!b.push && !pool && (b.paid ? <span className="chip text-emerald-300">paid</span> : b.amount ? <span className="chip text-amber-300">unpaid {fmtMoney(b.amount)}</span> : null)}
            {!b.paid && !b.push && (b.winner_team === me?.id || me?.is_commish) && (!!b.amount || !!b.stake) && <button className="btn-ghost btn-sm ml-auto" onClick={() => run(async () => { await rpc('mark_bet_paid', { p_bet: b.id }); load(); }, 'Marked paid')}>Mark paid</button>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {canJoin && <button className="btn-primary btn-sm" disabled={busy} onClick={() => setJoining(b)}>Buy in ({b.coins} ☘️)</button>}
          {inPool && b.status === 'open' && b.creator_team !== me?.id && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('leave_pool', { p_bet: b.id }); load(); }, 'You’re out')}>Back out</button>}
          {b.status === 'open' && late && <span className="self-center text-xs text-amber-200">⏰ Its games have started: too late to {pool ? 'join' : 'take'}.</span>}
          {can('bets') && !pool && b.status === 'open' && !late && b.creator_team !== me?.id && (!b.opponent_team || b.opponent_team === me?.id) && (
            <>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('respond_bet', { p_bet: b.id, p_accept: true }); load(); }, 'You’re on! 🤝')}>Take the bet{TRACKED.has(b.kind) && b.subject?.side ? ` (the ${b.subject.side === 'over' ? 'under' : 'over'})` : ''}</button>
              {b.opponent_team === me?.id && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('respond_bet', { p_bet: b.id, p_accept: false }); load(); }, 'Declined 🐔')}>Decline</button>}
            </>
          )}
          {b.status === 'open' && b.creator_team === me?.id && <button className="btn-ghost btn-sm" onClick={() => run(async () => { await rpc('cancel_bet', { p_bet: b.id }); load(); })}>Cancel</button>}
          {b.status === 'accepted' && TRACKED.has(b.kind) && <span className="self-center text-xs text-mute">Settles itself the morning after {fmtDate(b.end_date!)}.</span>}
          {b.status === 'accepted' && b.kind === 'season' && b.opponent_team && <span className="self-center text-xs text-mute">Settles itself when the regular season ends{league?.season_end ? ` (${fmtDate(league.season_end)})` : ''}.</span>}
          {b.result && (b.result as { ruling?: { note?: string } }).ruling && <span className="self-center text-xs text-amber-200">⚖️ Commish ruling{(b.result as { ruling?: { note?: string } }).ruling?.note ? `: ${(b.result as { ruling?: { note?: string } }).ruling?.note}` : ''}</span>}
          {b.status === 'accepted' && !TRACKED.has(b.kind) && mine && !b.proposed_winner && !pool && (
            <>
              <button className="btn-blue btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('claim_bet', { p_bet: b.id, p_winner: me!.id }); load(); }, 'Claim sent. They need to confirm.')}>I won</button>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => confirm('Concede this bet?') && run(async () => { await rpc('claim_bet', { p_bet: b.id, p_winner: other }); load(); }, 'Conceded. Pay up. 💸')}>I lost</button>
            </>
          )}
          {b.status === 'accepted' && b.proposed_winner && (
            b.proposed_by !== me?.id && mine && can('bets') ? (
              <><span className="self-center text-xs text-amber-200">{team(b.proposed_by)?.gm_name} claims the win.</span>
                <button className="btn-primary btn-sm" onClick={() => run(async () => { await rpc('confirm_bet', { p_bet: b.id }); load(); }, 'Settled')}>Confirm</button></>
            ) : <span className="text-xs text-mute">Waiting for {team(b.proposed_by === b.creator_team ? b.opponent_team : b.creator_team)?.gm_name} to confirm {team(b.proposed_winner)?.gm_name} won.</span>
          )}
          {(b.status === 'accepted' || b.status === 'settled') && me?.is_commish && (
            <button className="btn-ghost btn-sm ml-auto" onClick={() => setRuling(b)}>⚖️ Commish ruling</button>
          )}
        </div>
      </div>
    );
  };

  // ───── player picker for the sheet
  const quick = (opp: number) => {
    const w = wins[1] ?? wins[0];
    setF({ ...blank, kind: 'h2h', opponent: String(opp), coins: '50', start: w.start, end: w.end, entryClose: w.start, title: `Most points ${w.label.toLowerCase()}` });
    setOpen(true);
  };
  const kindDef = KINDS.find((k) => k.k === f.kind)!;
  const setWindow = (w: { start: string; end: string }) => setF({ ...f, start: w.start, end: w.end, entryClose: w.start });
  const autoTitle = () => {
    const p = pickerPlayer(f.playerId), b = pickerPlayer(f.playerB), w = wins.find((x) => x.start === f.start && x.end === f.end)?.label.toLowerCase() ?? `${fmtDate(f.start)} to ${fmtDate(f.end)}`;
    if (f.kind === 'player_ou' && p) return `${p.name} ${f.side} ${f.line || '?'} ${L(statWord(f.stat))} ${w}`;
    if (f.kind === 'player_vs' && p && b) return `${p.name} vs ${b.name}, ${L(statWord(f.stat))} ${w}`;
    if (f.kind === 'team_ou') return `${me?.name} ${f.side} ${f.line || '?'} points ${w}`;
    if (f.kind === 'h2h') return `Most points ${w}`;
    if (f.kind === 'pool_team') return `Pool: top ${brand.short} team ${w}`;
    if (f.kind === 'pool_player') return `Pool: pick a player, most ${brand.short} points ${w}`;
    return f.title;
  };
  const ready = f.title.trim().length >= 3 && (f.kind !== 'player_ou' || (f.playerId && f.line)) && (f.kind !== 'player_vs' || (f.playerId && f.playerB)) && (f.kind !== 'team_ou' || f.line) && (f.kind !== 'pool_player' || f.playerId) && (!isPool(f.kind) || Number(f.coins) > 0);

  const Leader = () => (
    <div className="card divide-y divide-white/[.06] overflow-hidden" style={{ background: 'linear-gradient(160deg, rgb(var(--gold-rgb)/.10), rgba(15,23,41,.75) 45%)' }}>
      {[...bank].filter((c) => gms.some((t) => t.id === c.team_id)).sort((a, b) => b.balance - a.balance).map((c, i, all) => {
        const t = team(c.team_id); const r = record(c.team_id); const n = cash.net.get(c.team_id) ?? 0;
        const tie = all.every((x) => x.balance === all[0].balance);
        return (
          <div key={c.team_id} className={`flex items-center gap-3 px-3 py-2.5 ${c.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
            {tie ? <span className="grid h-7 w-7 place-items-center text-mute">–</span> : <Rank n={i + 1} />}
            <TeamBadge team={t} size={30} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{t?.gm_name}</div><div className="text-[11px] text-mute">bets {r.w}-{r.l}{r.p ? `-${r.p}` : ''}{c.escrow ? ` · ${c.escrow} in play` : ''}{n ? <span className={n > 0 ? ' text-emerald-300' : ' text-red-300'}> · cash {n > 0 ? '+' : ''}{fmtMoney(n)}</span> : ''}</div></div>
            <div className="flex items-center gap-1.5"><Coin size={18} /><span className="num text-gold-shine font-display text-xl font-extrabold">{c.balance.toLocaleString()}</span></div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1"><PageHeader icon={<Dices size={22} className="text-clover" />} title="Side Bets" sub="Coins, cash, or your dignity. Tracked bets settle themselves." /></div>
        {tab === 'side' && (can('bets') ? <button className="btn-primary" onClick={() => { setF(blank); setOpen(true); }}>🎲 New bet</button> : <span className="text-xs text-mute">🔇 Betting is off for your pass</span>)}
      </div>
      <div className="scroll-x flex gap-1">
        {([['side', <><Dices size={14} /> Side bets{groups.live.length + groups.open.length > 0 ? <span className="num ml-0.5 rounded-full bg-white/15 px-1.5 text-[10px]">{groups.live.length + groups.open.length}</span> : null}</>], ['book', <><BookOpen size={14} /> {brand.bot.name}’s Book</>], ['leaders', <><Trophy size={14} /> Leaders & races</>]] as const).map(([k, l]) => (
          <button key={k} className={`tab flex shrink-0 items-center gap-1 ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'book' && <BookTab />}
      {tab === 'leaders' && (
        <>
          <Section icon={<Coin size={20} />} title={brand.bank} right={<button className="text-xs text-sky-300" onClick={() => setShowLedger(!showLedger)}>{showLedger ? 'Hide' : 'My coin history'}</button>}>
            <Leader />
            {showLedger && (
              <div className="card mt-2 divide-y divide-white/[.06]">
                {myCoins.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1 truncate">{c.reason}</span><span className="text-xs text-mute">{ago(c.created_at, now)}</span>
                    <span className={`w-16 text-right font-semibold ${c.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{c.amount >= 0 ? '+' : ''}{c.amount}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-1 px-1 text-xs text-mute">Everyone started with 1,000 coins. Coins on open bets, live bets and pool buy-ins are held until they settle; Book tickets leave the bank when placed. {brand.bot.name} pays 5 coins to the top team each day and 5 to the Team of the Week.</p>
          </Section>
          <Section icon={<span className="text-lg">🏁</span>} title="Coin races" right={<div className="flex gap-1">{(['week', 'month', 'season'] as const).map((k) => <button key={k} className={`chip py-0.5 ${race === k ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setRace(k)}>{k === 'week' ? 'This week' : k === 'month' ? 'This month' : 'Season'}</button>)}</div>}>
            <div className="card divide-y divide-white/[.06] overflow-hidden">
              {(() => {
                const rows = races.filter((r) => gms.some((t) => t.id === r.team_id)).sort((a, b) => b[race] - a[race] || a.team_id - b.team_id);
                const top = Math.max(1, ...rows.map((r) => Math.abs(r[race])));
                if (!rows.some((r) => r[race] !== 0)) return <div className="px-3 py-3 text-sm text-mute">Nobody has moved a coin {race === 'week' ? 'this week' : race === 'month' ? 'this month' : 'yet'}. Place a bet and take the lead.</div>;
                return rows.map((r, i) => {
                  const v = r[race];
                  return (
                    <div key={r.team_id} className={`flex items-center gap-3 px-3 py-2 ${r.team_id === me?.id ? 'bg-white/[.05]' : ''}`}>
                      <span className="w-6 text-center">{i === 0 && v > 0 ? '👑' : <span className="num text-sm text-mute">{i + 1}</span>}</span>
                      <TeamBadge team={team(r.team_id)} size={26} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold">{team(r.team_id)?.gm_name}</div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[.06]"><div className={`h-full rounded-full ${v >= 0 ? 'bg-emerald-400' : 'bg-red-400'}`} style={{ width: `${Math.round((Math.abs(v) / top) * 100)}%` }} /></div>
                      </div>
                      <span className={`num font-display text-lg font-extrabold ${v > 0 ? 'text-emerald-300' : v < 0 ? 'text-red-300' : 'text-mute'}`}>{v > 0 ? '+' : ''}{v}</span>
                    </div>
                  );
                });
              })()}
            </div>
            <p className="mt-1 px-1 text-xs text-mute">Net coins won and lost in the window: side bets, pools, the Book and {brand.bot.name}’s bonuses. The weekly race restarts every Monday. Races are for bragging rights, and on Super Pools for prizes in coins, never money.</p>
          </Section>
          <Section icon={<BookOpen size={18} className="text-sky-300" />} title="At the Book"><BookLeaders /></Section>
          {(cash.owed.length > 0 || [...cash.net.values()].some((n) => n)) && (
            <Section title="💸 The cash tab">
              <div className="card divide-y divide-white/[.06]">
                {cash.owed.length === 0 && <div className="px-3 py-2 text-sm text-mute">All square. Nobody owes anybody.</div>}
                {cash.owed.map((o) => (
                  <div key={`${o.from}:${o.to}`} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <TeamBadge team={team(o.from)} size={22} /><TeamName link team={team(o.from)} /> owes <TeamName link team={team(o.to)} /><TeamBadge team={team(o.to)} size={22} />
                    <span className="ml-auto font-semibold text-gold">{fmtMoney(o.amount)}</span>
                    <span className="text-[11px] text-mute">{o.bets.length} bet{o.bets.length === 1 ? '' : 's'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 px-1 text-xs text-mute">Real money settles between you (e-transfer, a beer, whatever). The winner or the commish marks a bet paid on its card.</p>
            </Section>
          )}
        </>
      )}
      {tab === 'side' && <>

      <div className="card flex items-center gap-3 px-3 py-2 text-sm">
        <Coin size={18} /><span className="num text-gold-shine font-display text-lg font-extrabold">{(myBank?.balance ?? 0).toLocaleString()}</span>
        <span className="text-xs text-mute">{available} available{myBank?.escrow ? ` · ${myBank.escrow} in play` : ''}</span>
        <button className="ml-auto text-xs text-sky-300" onClick={() => setTab('leaders')}>Bank & leaders</button>
      </div>

      {can('bets') && me?.role !== 'spectator' && gms.length > 1 && (
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">⚔️ Call someone out <span className="font-normal text-mute">· most points this week, 50 ☘️, even money</span></div>
          <div className="scroll-x flex gap-2">
            {gms.filter((t) => t.id !== me?.id).map((t) => (
              <button key={t.id} className="flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-xl border border-white/[.08] bg-white/[.03] px-1 py-2 text-[11px] transition hover:border-sky-400/50 active:scale-95" onClick={() => quick(t.id)}>
                <TeamBadge team={t} size={36} /><span className="w-full truncate text-center">{t.gm_name}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-mute">Tap a GM and the challenge is written for you; change anything before you post it.</div>
        </div>
      )}

      {ideas.length > 0 && can('bets') && (
        <Section icon={<Lightbulb size={18} className="text-gold" />} title="Bet ideas for you">
          <div className="scroll-x flex gap-2 pb-1">
            {ideas.map((i) => (
              <div key={i.title} className="card flex w-64 shrink-0 flex-col p-3">
                <div className="text-lg">{i.icon}</div>
                <div className="mt-1 text-sm font-semibold leading-snug">{i.title}</div>
                <div className="mt-1 flex-1 text-xs text-mute">{i.why}</div>
                <button className="btn-blue btn-sm mt-2 w-full" onClick={() => useIdea(i.form)}><Sparkles size={14} /> Use this</button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {groups.pools.length > 0 && <Section title="🎰 Pools"><div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{groups.pools.map((b) => <Fragment key={b.id}>{BetCard({ b })}</Fragment>)}</div></Section>}
      {groups.open.length > 0 && <Section title="Open challenges" right={<span className="text-xs text-mute">untaken bets expire after 7 days</span>}><div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{groups.open.map((b) => <Fragment key={b.id}>{BetCard({ b })}</Fragment>)}</div></Section>}
      <Section title="Live bets">
        {groups.live.length === 0 ? <div className="card"><Empty icon="🎲" title="No live bets">Challenge someone. You know who. Or open a pool.</Empty></div>
          : <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{groups.live.map((b) => <Fragment key={b.id}>{BetCard({ b })}</Fragment>)}</div>}
      </Section>
      {groups.expired.length > 0 && <Section title="⌛ Expired"><div className="grid gap-2 opacity-70 sm:grid-cols-2 2xl:grid-cols-3">{groups.expired.map((b) => <Fragment key={b.id}>{BetCard({ b })}</Fragment>)}</div></Section>}
      {groups.settled.length > 0 && (
        <Section title="Settled" right={groups.settled.length > 6 ? <button className="text-xs text-sky-300" onClick={() => setShowAllSettled(!showAllSettled)}>{showAllSettled ? 'Fewer' : `All ${groups.settled.length}`}</button> : undefined}>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">{(showAllSettled ? groups.settled : groups.settled.slice(0, 6)).map((b) => <Fragment key={b.id}>{BetCard({ b })}</Fragment>)}</div>
        </Section>
      )}
      {groups.settled.length > 0 && <BetResults bets={groups.settled} entries={entries} />}
      <p className="text-center text-xs text-mute">How the numbers work: fantasy points come from the NHL box scores, the same ones as the standings. Tracked bets settle at 8:45 a.m. ET the morning after they end, once stat corrections are in. Ties push. <Link to="/league?t=rules" className="text-sky-300">Rulebook</Link></p>
      </>}

      {/* ───── new bet */}
      <Sheet open={open} onClose={() => setOpen(false)} title="New side bet" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {KINDS.map((k) => <button key={k.k} className={`rounded-xl border p-2 text-left ${f.kind === k.k ? 'border-sky-400/60 bg-sky-500/15' : 'border-white/[.08] bg-white/[.03]'}`} onClick={() => setF({ ...f, kind: k.k, opponent: k.pool ? '' : f.opponent, title: '' })}>
              <div className="text-lg">{k.icon}</div><div className="text-xs font-semibold leading-tight">{k.label}</div>
            </button>)}
          </div>
          <p className="text-xs text-mute">{L(kindDef.blurb)}</p>

          {!kindDef.pool && (
            <div>
              <div className="label mb-1">Who are you calling out?</div>
              <div className="flex flex-wrap gap-1.5">
                <button className={`chip py-1 ${f.opponent === '' ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, opponent: '' })}>Anyone (open)</button>
                {[...gms, ...(f.kind === 'custom' ? spectators : [])].filter((t) => t.id !== me?.id).map((t: Team) => (
                  <button key={t.id} className={`chip py-1 ${f.opponent === String(t.id) ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, opponent: String(t.id) })}>{t.emoji} {t.gm_name}</button>
                ))}
              </div>
            </div>
          )}

          {TRACKED.has(f.kind) && (
            <div>
              <div className="label mb-1">Window</div>
              <div className="scroll-x flex gap-1">{wins.map((w) => <button key={w.label} className={`chip shrink-0 py-1 ${f.start === w.start && f.end === w.end ? 'bg-white text-ice' : ''}`} onClick={() => setWindow(w)}>{w.label}</button>)}</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <label className="text-xs text-mute">From<input type="date" className="input mt-1" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value, entryClose: e.target.value })} /></label>
                <label className="text-xs text-mute">To<input type="date" className="input mt-1" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
              </div>
            </div>
          )}

          {(f.kind === 'player_ou' || f.kind === 'player_vs' || f.kind === 'pool_player') && <PlayerPick label={f.kind === 'player_vs' ? 'Your player' : f.kind === 'pool_player' ? 'Your pick' : 'Player'} value={f.playerId} exclude={f.playerB} onPick={(id) => setF({ ...f, playerId: id, line: f.kind === 'player_ou' ? suggestLine(players.get(id), f.stat, f.start, f.end) : f.line })} />}
          {f.kind === 'player_vs' && <PlayerPick label="Their player" value={f.playerB} exclude={f.playerId} onPick={(id) => setF({ ...f, playerB: id })} />}
          {(f.kind === 'player_ou' || f.kind === 'player_vs') && (
            <div>
              <div className="label mb-1">Stat</div>
              <div className="scroll-x flex gap-1">{STATS.map(([k, l]) => <button key={k} className={`chip shrink-0 py-1 ${f.stat === k ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, stat: k, line: f.kind === 'player_ou' ? suggestLine(pickerPlayer(f.playerId), k, f.start, f.end) : f.line })}>{L(l)}</button>)}</div>
            </div>
          )}
          {(f.kind === 'player_ou' || f.kind === 'team_ou') && (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="text-xs text-mute">The line{f.kind === 'player_ou' && f.playerId ? <span className="ml-1 text-sky-300">(suggested from his pace)</span> : ''}<input className="input mt-1" inputMode="decimal" value={f.line} onChange={(e) => setF({ ...f, line: e.target.value.replace(/[^\d.]/g, '') })} placeholder={f.kind === 'team_ou' ? 'e.g. 85.5' : 'e.g. 4.5'} /></label>
              <div><div className="text-xs text-mute">You take the</div><div className="mt-1 flex gap-1">{(['over', 'under'] as const).map((s) => <button key={s} className={`chip py-2 ${f.side === s ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, side: s })}>{s}</button>)}</div></div>
            </div>
          )}
          {f.kind === 'pool_team' && (
            <div>
              <div className="label mb-1">Your pick to score the most</div>
              <div className="flex flex-wrap gap-1.5">{gms.map((t) => <button key={t.id} className={`chip py-1 ${(f.teamPick ?? me?.id) === t.id ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, teamPick: t.id })}>{t.emoji} {t.gm_name}</button>)}</div>
            </div>
          )}
          {isPool(f.kind) && <label className="block text-xs text-mute">Entries close<input type="date" className="input mt-1" value={f.entryClose} max={f.end} onChange={(e) => setF({ ...f, entryClose: e.target.value })} /></label>}

          <div className="flex gap-2">
            <input className="input flex-1" placeholder="The bet, in a line" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={140} />
            {f.kind !== 'custom' && f.kind !== 'season' && <button className="btn btn-sm shrink-0" onClick={() => setF({ ...f, title: autoTitle() })}>Write it for me</button>}
          </div>
          <textarea className="input" rows={2} placeholder="Terms / fine print (optional)" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
          <div>
            <div className="label mb-1">{brand.coin.emoji} {brand.coin.name}{isPool(f.kind) ? ' to buy in' : ''} (you have {available} available)</div>
            <div className="flex flex-wrap gap-1.5">
              {['0', '25', '50', '100', '250', '500'].filter((c) => !(isPool(f.kind) && c === '0')).map((c) => (
                <button key={c} className={`chip py-1 ${f.coins === c ? 'bg-emerald-500 text-ice' : ''}`} onClick={() => setF({ ...f, coins: c })}>{c === '0' ? 'No coins' : c}</button>
              ))}
              <input className="input w-24 py-1" inputMode="numeric" value={f.coins} onChange={(e) => setF({ ...f, coins: e.target.value.replace(/[^\d]/g, '') })} />
            </div>
          </div>
          {!isPool(f.kind) && Number(f.coins) > 0 && (
            <div>
              <div className="label mb-1">Odds: what you risk against their {f.coins || 0}</div>
              <div className="flex flex-wrap gap-1.5">
                {([[1, 'Even'], [1.5, '3:2'], [2, '2:1'], [3, '3:1'], [5, '5:1'], [0.5, '1:2'], [0.333, '1:3']] as const).map(([o, l]) => (
                  <button key={o} className={`chip py-1 ${f.odds === o ? 'bg-white text-ice' : ''}`} onClick={() => setF({ ...f, odds: o })}>{l}</button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-mute">{f.odds === 1 ? 'Even money: both sides put up the same.' : `You risk ${Math.round(Number(f.coins) * f.odds)} ☘️ to win their ${f.coins} ☘️${f.odds > 1 ? '. Generous. Or confident.' : '. They\u2019re the favourite, you get paid more if you\u2019re right.'}`}</p>
            </div>
          )}
          {!isPool(f.kind) && (
            <>
              <div className="label -mb-1">Real money / stakes (optional, tracked on the cash tab)</div>
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <input className="input" inputMode="decimal" placeholder="$ amount" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} />
                <input className="input" placeholder="…and/or stakes: a two-four, dinner, bragging rights" value={f.stake} onChange={(e) => setF({ ...f, stake: e.target.value })} />
              </div>
            </>
          )}
          <button className="btn-primary w-full" disabled={busy || !ready} onClick={create}>{isPool(f.kind) ? 'Open the pool' : 'Post it to the league'}</button>
          <p className="text-center text-[11px] text-mute">{isPool(f.kind) ? 'If nobody else buys in within 7 days, the pool expires.' : 'If nobody takes it within 7 days it expires and any coins you put up are freed.'}</p>
          <p className="text-center text-xs text-mute">{TRACKED.has(f.kind) ? 'Tracked from the box scores and settled automatically. Ties push.' : 'Bets are announced in Trash Talk. Settle up between yourselves; the commish is the final ruling.'}</p>
        </div>
      </Sheet>

      {/* ───── join a pool */}
      <Sheet open={!!ruling} onClose={() => setRuling(null)} title={ruling ? `⚖️ Ruling: ${ruling.title}` : ''}>
        {ruling && <Ruling b={ruling} entries={entries.filter((e) => e.bet_id === ruling.id)} onDone={() => { setRuling(null); load(); }} />}
      </Sheet>
      <Sheet open={!!joining} onClose={() => setJoining(null)} title={joining ? `Buy in: ${joining.title}` : ''}>
        {joining && <JoinPool b={joining} gms={gms} entries={entries.filter((e) => e.bet_id === joining.id)} onDone={() => { setJoining(null); load(); }} />}
      </Sheet>
    </div>
  );
}

// searching for a player in the bet forms. Its own component at the top of the file (not one made inside the page),
// so the search box keeps what the GM typed while the page refreshes around it
function PlayerPick({ value, onPick, label, exclude }: { value: number | null; onPick: (id: number) => void; label: string; exclude?: number | null }) {
  const { players, owner, team } = useLeague();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = [...players.values()].filter((p) => p.id !== exclude && (!s || p.name.toLowerCase().includes(s)));
    return (s ? all : all.filter((p) => owner.has(p.id))).sort((a, b) => b.proj - a.proj).slice(0, 8);
  }, [q, exclude, players, owner]);
  const chosen = value ? players.get(value) : undefined;
  return (
    <div>
      <div className="label mb-1">{label}{chosen ? <span className="ml-2 text-white">{chosen.name} <span className="text-mute">{chosen.nhl_team} {chosen.pos}{owner.get(chosen.id) ? ` · ${team(owner.get(chosen.id)!.team_id)?.abbrev}` : ' · FA'}</span></span> : null}</div>
      <input className="input" placeholder="Search a player…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="scroll-x mt-1 flex gap-1">{list.map((p) => <button key={p.id} className={`chip shrink-0 py-1 ${value === p.id ? 'bg-white text-ice' : ''}`} onClick={() => { onPick(p.id); setQ(''); }}>{p.name} <span className="opacity-60">{owner.get(p.id) ? team(owner.get(p.id)!.team_id)?.abbrev : 'FA'}</span></button>)}</div>
    </div>
  );
}

function JoinPool({ b, gms, entries, onDone }: { b: Bet; gms: Team[]; entries: BetEntry[]; onDone: () => void }) {
  const { team, players } = useLeague();
  const { busy, run } = useAction();
  const [teamPick, setTeamPick] = useState<number | null>(null);
  const [playerPick, setPlayerPick] = useState<number | null>(null);
  const taken = new Set(entries.map((e) => e.choice.player_id));
  return (
    <div className="space-y-3">
      <div className="text-sm text-mute">{b.coins} ☘️ coins to enter · {entries.length} in so far · pot {entries.reduce((s, e) => s + e.coins, 0) + b.coins} with you</div>
      <div className="text-xs text-mute">Already picked: {entries.map((e) => (b.kind === 'pool_team' ? `${team(e.team_id)?.gm_name} → ${team(e.choice.team_id!)?.name}` : `${team(e.team_id)?.gm_name} → ${players.get(e.choice.player_id!)?.name ?? '?'}`)).join(' · ')}</div>
      {b.kind === 'pool_team'
        ? <div className="flex flex-wrap gap-1.5">{gms.map((t) => <button key={t.id} className={`chip py-1 ${teamPick === t.id ? 'bg-white text-ice' : ''}`} onClick={() => setTeamPick(t.id)}>{t.emoji} {t.gm_name}</button>)}</div>
        : <PlayerPick label="Your player (no repeats)" value={playerPick} onPick={(id) => { if (taken.has(id)) return; setPlayerPick(id); }} />}
      <button className="btn-primary w-full" disabled={busy || (b.kind === 'pool_team' ? !teamPick : !playerPick)} onClick={() => run(async () => { await rpc('join_pool', { p_bet: b.id, p_choice: b.kind === 'pool_team' ? { team_id: teamPick } : { player_id: playerPick } }); onDone(); }, 'You’re in 🎰')}>Buy in</button>
    </div>
  );
}

// the commissioner's override: pick the right outcome and the site undoes whatever coins the bet moved and redoes it
function Ruling({ b, entries, onDone }: { b: Bet; entries: BetEntry[]; onDone: () => void }) {
  const { team } = useLeague();
  const { busy, run } = useAction();
  const pool = isPool(b.kind);
  const [outcome, setOutcome] = useState<'winner' | 'push' | 'void'>('winner');
  const [winner, setWinner] = useState<number | null>(pool ? null : b.winner_team);
  const [winners, setWinners] = useState<number[]>(pool ? ((b.result?.winners as number[] | undefined) ?? []) : []);
  const [note, setNote] = useState('');
  const sides = pool ? entries.map((e) => e.team_id) : [b.creator_team, b.opponent_team].filter((x): x is number => !!x);
  const ok = outcome !== 'winner' || (pool ? winners.length > 0 : !!winner);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-mute">{b.status === 'settled' ? 'Already settled. A ruling undoes every coin this bet moved, then applies the outcome you pick.' : 'Settle it now, whatever the system would have done.'} Everyone sees the ruling in Trash Talk.</p>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-white/[.04] p-1">
        {(['winner', 'push', 'void'] as const).map((o) => <button key={o} className={`rounded-lg px-2 py-1.5 text-xs font-semibold ${outcome === o ? 'bg-sky-500 text-ice' : 'text-mute'}`} onClick={() => setOutcome(o)}>{o === 'winner' ? 'Winner' : o === 'push' ? 'Push (tie)' : 'Void'}</button>)}
      </div>
      {outcome === 'winner' && (
        <div className="space-y-1">
          {sides.map((t) => {
            const on = pool ? winners.includes(t) : winner === t;
            return (
              <button key={t} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left ${on ? 'border-emerald-400/60 bg-emerald-500/15' : 'border-white/[.08]'}`}
                onClick={() => (pool ? setWinners(on ? winners.filter((x) => x !== t) : [...winners, t]) : setWinner(t))}>
                <TeamBadge team={team(t)} size={22} /><span className="flex-1">{team(t)?.name}</span>{on && <span>🏆</span>}
              </button>
            );
          })}
          {pool && <p className="text-[11px] text-mute">Pick more than one to split the pot.</p>}
        </div>
      )}
      {outcome === 'void' && <p className="text-xs text-amber-200">Void cancels the bet and hands every stake back.</p>}
      <input className="input" placeholder="Why (shown to everyone), e.g. stat correction" value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} />
      <button className="btn-primary w-full" disabled={busy || !ok} onClick={() => run(async () => {
        await rpc('commish_rule_bet', { p_bet: b.id, p_outcome: outcome, p_winner: pool ? null : winner, p_winners: pool ? winners : null, p_note: note || null });
        onDone();
      }, 'Ruling made ⚖️')}>Make the ruling</button>
    </div>
  );
}

// every settled side bet: who won, who lost, and what changed hands (coins and cash), with each GM's totals
function BetResults({ bets, entries }: { bets: Bet[]; entries: BetEntry[] }) {
  const { team, teams, me } = useLeague();
  const [who, setWho] = useState<number | 'all'>('all');
  const [all, setAll] = useState(false);
  const per = bets.map((b) => ({ b, m: betMoves(b, entries) }));
  const totals = teams.filter((t) => per.some((x) => x.m.has(t.id))).map((t) => {
    const mine = per.map((x) => x.m.get(t.id)).filter((x): x is NonNullable<typeof x> => !!x);
    return { t, coins: mine.reduce((s, x) => s + x.coins, 0), cash: mine.reduce((s, x) => s + x.cash, 0), w: mine.filter((x) => x.won === true).length, l: mine.filter((x) => x.won === false).length, p: mine.filter((x) => x.won === null).length };
  }).sort((a, b) => b.coins + b.cash * 10 - (a.coins + a.cash * 10));
  const rows = per.filter((x) => who === 'all' || x.m.has(who)).sort((a, b) => (b.b.settled_at ?? '').localeCompare(a.b.settled_at ?? ''));
  return (
    <Section title="📜 Bet results" right={<span className="text-xs text-mute">{bets.length} settled</span>}>
      <div className="scroll-x mb-2 flex gap-1">
        <button className={`chip shrink-0 py-1 ${who === 'all' ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setWho('all')}>Everyone</button>
        {totals.map(({ t, coins, cash, w, l, p }) => (
          <button key={t.id} className={`chip shrink-0 items-center gap-1 py-1 ${who === t.id ? 'bg-sky-500 text-ice' : ''}`} onClick={() => setWho(t.id)}>
            <TeamBadge team={t} size={14} />{t.gm_name}
            <b className={coins > 0 ? 'text-emerald-300' : coins < 0 ? 'text-red-300' : ''}>{coins > 0 ? '+' : ''}{coins} ☘️</b>
            {cash !== 0 && <b className={cash > 0 ? 'text-emerald-300' : 'text-red-300'}>{cash > 0 ? '+' : '−'}{fmtMoney(Math.abs(cash))}</b>}
            <span className="text-[10px] text-mute">{w}-{l}{p ? `-${p}` : ''}</span>
          </button>
        ))}
      </div>
      <div className="card divide-y divide-white/[.06]">
        {(all ? rows : rows.slice(0, 12)).map(({ b, m }) => {
          const winners = [...m.entries()].filter(([, x]) => x.won === true);
          const mineMove = me ? m.get(me.id) : undefined;
          return (
            <div key={b.id} className={`px-3 py-2 text-sm ${mineMove ? 'bg-white/[.03]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{b.title}</span>
                <span className="shrink-0 text-[11px] text-mute">{b.settled_at ? fmtDate(b.settled_at.slice(0, 10)) : ''}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                {b.push ? <span className="text-mute">🤝 Push: stakes returned</span> : winners.length === 0 ? <span className="text-mute">No winner</span> : null}
                {[...m.entries()].filter(([, x]) => x.won !== null).sort((a, b2) => b2[1].coins - a[1].coins).map(([t, x]) => (
                  <span key={t} className="flex items-center gap-1">
                    <TeamBadge team={team(t)} size={14} />{team(t)?.gm_name}
                    <b className={x.won ? 'text-emerald-300' : 'text-red-300'}>{x.won ? 'won' : 'lost'} {x.coins !== 0 ? `${x.coins > 0 ? '+' : ''}${x.coins} ☘️` : ''}{x.cash ? ` ${x.cash > 0 ? '+' : '−'}${fmtMoney(Math.abs(x.cash))}` : ''}</b>
                  </span>
                ))}
                {(b.result as { ruling?: unknown } | null)?.ruling ? <span className="text-amber-200">⚖️ commish ruling</span> : null}
              </div>
            </div>
          );
        })}
      </div>
      {rows.length > 12 && <button className="mt-1 w-full text-center text-xs text-sky-300" onClick={() => setAll(!all)}>{all ? 'Fewer' : `All ${rows.length} bets`}</button>}
      <p className="mt-1 px-1 text-[11px] text-mute">Coins and cash each GM won or lost on settled side bets. Pools show each entrant's share of the pot minus their buy-in. Pushes return every stake.</p>
    </Section>
  );
}
