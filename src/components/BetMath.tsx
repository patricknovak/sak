// The math behind one side bet, laid open: where it stands on the same count that settles it, every box-score line that
// count is made of (and each line's scoring, weight by weight), the rule that decides it, what the coins do, how the live
// odds are worked out, and the bet's road from posted to settled. Nothing here decides anything: the bet is settled by
// the database (settle_due_bets, from bet_progress) and this sheet reads the same rows that function sums, then
// recounts them in the open, so a GM can check the number to the hundredth and see at once if the two ever disagree.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLeague, useNow, useSport } from '../lib/store';
import { rpc, selectAll, supabase } from '../lib/supabase';
import { useBrand } from '../lib/brand';
import { useSeasonGames } from '../lib/projections';
import { etToday, fmtDate, fmtPts } from '../lib/format';
import { calledOff, extraTime, hasStarted, isFinal, isLive, notStarted, periodShort } from '../lib/sport';
import { phi, type WinDetail, type Rest } from '../lib/betodds';
import type { Bet, BetEntry, BetProgress, BetStat, CoinEntry, Game, Player } from '../lib/types';
import { Coin, TeamBadge } from './ui';

type GameRow = Pick<Game, 'id' | 'date' | 'home' | 'away' | 'home_score' | 'away_score' | 'state' | 'period' | 'clock' | 'start_utc'> & { game_type?: number | null };
type PLine = { game_id: number; player_id: number; date: string; nhl_team: string | null; stats: Record<string, number>; fpts: number };
type TLine = { team_id: number; date: string; points: number; games: number };
// one thing a bet counts: a player's stat or a fantasy team's points
type Subj = { key: string; kind: 'player' | 'team'; id: number; label: string; owner?: number };

const shift = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const datesIn = (a: string, b: string) => { const out: string[] = []; for (let d = a; d <= b && out.length < 400; d = shift(d, 1)) out.push(d); return out; };
const near = (x: number, y: number) => Math.abs(x - y) < 0.005;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const sign = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtPts(Math.abs(n), d)}`;
const SHORT: Record<string, string> = { g: 'G', a: 'A', pts: 'PTS', pm: '+/−', pim: 'PIM', ppg: 'PPG', ppa: 'PPA', ppp: 'PPP', shg: 'SHG', sha: 'SHA', shp: 'SHP', gwg: 'GWG', sog: 'SOG', hit: 'HIT', blk: 'BLK', fow: 'FOW', fol: 'FOL', gs: 'GS', w: 'W', l: 'L', otl: 'OTL', ga: 'GA', sv: 'SV', sa: 'SA', sho: 'SO' };

// the league's own scoring, weight by weight, as the database scores a box score (_score: goalie weights when the line
// has saves or a start, skater weights otherwise, rounded to the hundredth)
function scoreParts(stats: Record<string, number>, scoring: { skater: Record<string, number>; goalie: Record<string, number> } | undefined) {
  if (!scoring) return { parts: [] as { k: string; n: number; w: number; pts: number }[], total: null as number | null };
  const w = 'sv' in stats || 'gs' in stats ? scoring.goalie : scoring.skater;
  const parts = Object.entries(w ?? {}).map(([k, wt]) => ({ k, n: Number(stats[k] ?? 0), w: Number(wt), pts: Number(wt) * Number(stats[k] ?? 0) })).filter((p) => p.n !== 0 && p.w !== 0);
  return { parts, total: r2(parts.reduce((s, p) => s + p.pts, 0)) };
}

export function BetMath({ bet: b, entries, detail, statLabel, onClose }: {
  bet: Bet; entries: BetEntry[]; detail: WinDetail | null; statLabel: (s: BetStat) => string; onClose: () => void;
}) {
  const { team, players, league, games: tonight, leagueDay } = useLeague();
  const sport = useSport();
  const brand = useBrand();
  const now = useNow(60_000);
  const season = useSeasonGames();
  const stat: BetStat = b.subject?.stat ?? 'fpts';
  const live = b.status === 'accepted' || b.status === 'open';
  const start = b.kind === 'season' ? league?.season_start ?? null : b.start_date;
  const end = b.kind === 'season' ? league?.season_end ?? null : b.end_date;
  const gm = (id?: number | null) => (id ? team(id)?.gm_name ?? `Team ${id}` : 'the taker');
  const pname = (id?: number | null) => (id ? players.get(id)?.name ?? `#${id}` : '?');
  const pool = b.kind === 'pool_team' || b.kind === 'pool_player';
  const myEntries = useMemo(() => entries.filter((e) => e.bet_id === b.id), [entries, b.id]);

  const subjects = useMemo<Subj[]>(() => {
    const s = b.subject ?? {};
    if (b.kind === 'h2h' || b.kind === 'season') return [{ key: 'a', kind: 'team', id: b.creator_team, label: gm(b.creator_team) }, ...(b.opponent_team ? [{ key: 'b', kind: 'team' as const, id: b.opponent_team, label: gm(b.opponent_team) }] : [])];
    if (b.kind === 'team_ou') return [{ key: 'value', kind: 'team', id: b.creator_team, label: team(b.creator_team)?.name ?? gm(b.creator_team) }];
    if (b.kind === 'player_ou' && s.player_id) return [{ key: 'value', kind: 'player', id: s.player_id, label: pname(s.player_id) }];
    if (b.kind === 'player_vs' && s.player_a && s.player_b) return [{ key: 'a', kind: 'player', id: s.player_a, label: pname(s.player_a) }, { key: 'b', kind: 'player', id: s.player_b, label: pname(s.player_b) }];
    if (b.kind === 'pool_team') return myEntries.map((e) => ({ key: `e${e.team_id}`, kind: 'team' as const, id: e.choice.team_id ?? 0, label: team(e.choice.team_id ?? 0)?.name ?? '?', owner: e.team_id }));
    if (b.kind === 'pool_player') return myEntries.map((e) => ({ key: `e${e.team_id}`, kind: 'player' as const, id: e.choice.player_id ?? 0, label: pname(e.choice.player_id), owner: e.team_id }));
    return [];
  }, [b, myEntries, players]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── the rows: what the settlement sums, read straight from the same views
  const [server, setServer] = useState<BetProgress | null>(null);
  const [plines, setPlines] = useState<PLine[] | null>(null);
  const [tlines, setTlines] = useState<TLine[] | null>(null);
  const [gameMap, setGameMap] = useState<Map<number, GameRow>>(new Map());
  const [coins, setCoins] = useState<CoinEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const tick = live ? Math.floor(now / 60_000) : 0;
  const dp = stat === 'fpts' || ['h2h', 'season', 'team_ou', 'pool_team'].includes(b.kind) ? 2 : 0;   // decimals: points to the hundredth, counts whole
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const pIds = [...new Set(subjects.filter((s) => s.kind === 'player').map((s) => s.id))];
        const tIds = [...new Set(subjects.filter((s) => s.kind === 'team').map((s) => s.id))];
        const [srv, pl, tl, cl] = await Promise.all([
          rpc<BetProgress>('bet_progress', { p_bet: b.id }),
          pIds.length && start && end ? selectAll<PLine>('league_games', 'game_id,player_id,date,nhl_team,stats,fpts', 1000, ['date', 'game_id', 'player_id'], (q) => q.in('player_id', pIds).gte('date', start).lte('date', end)) : Promise.resolve([] as PLine[]),
          tIds.length && start && end ? selectAll<TLine>('team_daily', 'team_id,date,points,games', 1000, ['date', 'team_id'], (q) => q.in('team_id', tIds).gte('date', start).lte('date', end)) : Promise.resolve([] as TLine[]),
          supabase.from('coin_ledger').select('*').eq('bet_id', b.id).order('id').then(({ data }) => (data ?? []) as CoinEntry[]),
        ]);
        const gIds = [...new Set(pl.map((l) => l.game_id))];
        const gmap = new Map<number, GameRow>();
        for (let i = 0; i < gIds.length; i += 150) {
          const { data } = await supabase.from('games').select('id,date,start_utc,home,away,home_score,away_score,state,period,clock,game_type').in('id', gIds.slice(i, i + 150));
          for (const g of (data ?? []) as GameRow[]) gmap.set(g.id, g);
        }
        if (dead) return;
        setServer(srv ?? {}); setPlines(pl.map((l) => ({ ...l, fpts: Number(l.fpts), stats: l.stats ?? {} }))); setTlines(tl.map((t) => ({ ...t, points: Number(t.points), games: Number(t.games) })));
        setGameMap(gmap); setCoins(cl); setErr(null);
      } catch (e) { if (!dead) setErr(e instanceof Error ? e.message : String(e)); }
    })();
    return () => { dead = true; };
  }, [b.id, subjects.map((s) => s.key + s.id).join(), start, end, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // tonight's games carry the live clock in the store; prefer them over the copy read above
  const gameOf = (id: number): GameRow | undefined => (tonight.find((g) => g.id === id) as GameRow | undefined) ?? gameMap.get(id);
  const valueOf = (l: PLine) => (stat === 'fpts' ? l.fpts : Number(l.stats?.[stat] ?? 0));

  // each subject's total, recounted here from the rows
  const recount = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of subjects) {
      const v = s.kind === 'player' ? (plines ?? []).filter((l) => l.player_id === s.id).reduce((t, l) => t + valueOf(l), 0)
        : (tlines ?? []).filter((t) => t.team_id === s.id).reduce((t, l) => t + l.points, 0);
      out.set(s.key, r2(v));
    }
    return out;
  }, [subjects, plines, tlines, stat]); // eslint-disable-line react-hooks/exhaustive-deps
  // the settlement's own number for each subject: live from bet_progress, or as it stood when the bet settled
  const serverOf = (s: Subj, p: BetProgress | Record<string, unknown> | null | undefined): number | null => {
    if (!p) return null;
    if (s.key.startsWith('e')) { const e = (p.entries as BetProgress['entries'])?.find((x) => x.team_id === s.owner); return e ? Number(e.value) : null; }
    const v = (p as Record<string, unknown>)[s.key];
    return v == null ? null : Number(v);
  };
  const settledWith = b.status === 'settled' ? (b.result as Record<string, unknown> | null) : null;
  const loaded = server != null && plines != null && tlines != null;
  const checks = subjects.map((s) => ({ s, mine: recount.get(s.key) ?? 0, srv: serverOf(s, server), then: serverOf(s, settledWith) }));
  const allMatch = loaded && checks.every((c) => c.srv == null || near(c.mine, c.srv));

  // ── where the bet is on its road
  const today = etToday();
  const nightsAll = start && end ? datesIn(start, end) : [];
  const played = nightsAll.filter((d) => d < leagueDay).length;
  const settleDay = end ? shift(end, 1) : null;
  const steps: { done: boolean; now?: boolean; label: string; sub: string }[] = [
    { done: true, label: pool ? 'Pool opened' : 'Posted', sub: `${gm(b.creator_team)} · ${fmtDate(b.created_at.slice(0, 10))}` },
    pool ? { done: b.status !== 'open', now: b.status === 'open', label: 'Entries close', sub: `${myEntries.length} in · ${b.entry_close ? `after ${fmtDate(b.entry_close)}` : ''}` }
      : { done: !!b.accepted_at, label: 'Taken', sub: b.accepted_at ? `${gm(b.opponent_team)} · ${fmtDate(b.accepted_at.slice(0, 10))}` : 'waiting for a taker' },
    { done: !!end && end < leagueDay, now: !!start && !!end && start <= leagueDay && leagueDay <= end, label: 'Games counted', sub: start && end ? `${fmtDate(start)} → ${fmtDate(end)} · ${played >= nightsAll.length ? 'all' : `${played} of`} ${nightsAll.length} day${nightsAll.length === 1 ? '' : 's'} done` : 'whole season' },
    { done: b.status === 'settled' || b.status === 'cancelled', now: !!end && end < leagueDay && b.status === 'accepted', label: b.status === 'cancelled' ? 'Called off' : 'Settled', sub: b.settled_at ? `${b.push ? 'a push' : pool ? `${((b.result?.winners as number[] | undefined) ?? [b.winner_team]).map((w) => gm(w)).join(' & ')} took the pot` : b.winner_team ? `${gm(b.winner_team)} won` : ''} · ${fmtDate(b.settled_at.slice(0, 10))}` : settleDay ? `the morning of ${fmtDate(settleDay)}, 12:45 UTC` : '' },
  ];

  // ── upcoming games (for the night-by-night list): a player's club's games still to play, a team's nights with games
  const upcoming = useMemo(() => {
    const out = new Map<string, GameRow[]>();   // subject key → games
    if (!season || !start || !end) return out;
    const lo = start > today ? start : today;
    for (const s of subjects) {
      const seen = new Set((plines ?? []).filter((l) => l.player_id === s.id).map((l) => l.game_id));
      if (s.kind === 'player') {
        const club = players.get(s.id)?.nhl_team;
        out.set(s.key, season.filter((g) => g.date >= lo && g.date <= end && (g.home === club || g.away === club) && !seen.has(g.id) && !isFinal(sport, g.state) && !calledOff(sport, g.state)) as GameRow[]);
      }
    }
    return out;
  }, [season, subjects, plines, start, end, today, players, sport]);
  // nights in the window with a game still to start (tonight too, while some of its games haven't): the same nights the
  // odds below expect points from
  const teamNightsLeft = useMemo(() => {
    if (!season || !start || !end) return [] as string[];
    const lo = start > today ? start : today;
    const live = new Map(tonight.map((g) => [g.id, g.state]));
    return [...new Set(season.filter((g) => g.date >= lo && g.date <= end && notStarted(sport, live.get(g.id) ?? g.state)).map((g) => g.date))];
  }, [season, start, end, today, tonight, sport]);

  const matchup = (l: PLine | null, g: GameRow | undefined, club?: string | null) => {
    if (!g) return '';
    const mine = l?.nhl_team ?? club;
    const home = g.home === mine;
    const opp = home ? g.away : g.home;
    let st = '';
    if (isFinal(sport, g.state)) st = `${home ? g.home_score : g.away_score}–${home ? g.away_score : g.home_score}${extraTime(g.period) ? ` ${g.period}` : ''} F`;
    else if (isLive(sport, g.state) || (hasStarted(sport, g.state))) st = `${home ? g.home_score ?? 0 : g.away_score ?? 0}–${home ? g.away_score ?? 0 : g.home_score ?? 0} · ${periodShort(sport, g.period)} ${g.clock ?? ''}`.trim();
    else st = new Date(g.start_utc).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${home ? 'vs' : '@'} ${opp} · ${st}`;
  };
  const liveGame = (g?: GameRow) => !!g && isLive(sport, g.state);

  const ruleText = (() => {
    const s = b.subject ?? {}, what = stat === 'fpts' ? statLabel(stat) : statLabel(stat).toLowerCase();
    const win = start && end ? `${fmtDate(start)} to ${fmtDate(end)}` : 'the regular season';
    if (b.kind === 'h2h') return `More ${brand.short} points from ${win} wins, counting only starters (the lineup frozen at each puck drop), the same nightly totals as the standings. Dead even is a push.`;
    if (b.kind === 'season') return `More regular-season ${brand.short} points by the last day of the season wins (the standings' own count). Dead even is a push.`;
    if (b.kind === 'team_ou') return `${team(b.creator_team)?.name}'s starters' ${brand.short} points from ${win} against a line of ${s.line}. ${gm(b.creator_team)} has the ${s.side}, ${gm(b.opponent_team)} the ${s.side === 'over' ? 'under' : 'over'}. Landing exactly on the line is a push.`;
    if (b.kind === 'player_ou') return `${pname(s.player_id)}'s ${what} in every game he plays from ${win}, against a line of ${s.line}. ${gm(b.creator_team)} has the ${s.side}, ${gm(b.opponent_team)} the ${s.side === 'over' ? 'under' : 'over'}. Landing exactly on the line is a push.`;
    if (b.kind === 'player_vs') return `${pname(s.player_a)} (${gm(b.creator_team)}) against ${pname(s.player_b)} (${gm(b.opponent_team)}): more ${what} from ${win} wins, whichever fantasy team they're on. Dead even is a push.`;
    if (b.kind === 'pool_team') return `Each entry picked a team; the pick with the most ${brand.short} points from ${win} takes the pot. Ties split it.`;
    if (b.kind === 'pool_player') return `Each entry picked a player (no repeats); the most ${what} from ${win} takes the pot. Ties split it.`;
    return '';
  })();

  // ── the coins: who risks what, what each outcome moves, and (once settled) what actually moved
  const creatorRisk = Math.round(b.coins * Number(b.odds ?? 1));
  const pot = myEntries.reduce((t, e) => t + e.coins, 0);
  const moved = coins.reduce((t, c) => t + c.amount, 0);

  const [open, setOpen] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const toggle = (k: string) => setOpen(open === k ? null : k);

  // ───── one subject's night-by-night list
  const Ledger = ({ s }: { s: Subj }) => {
    if (s.kind === 'player') {
      const rows = (plines ?? []).filter((l) => l.player_id === s.id).sort((a, c) => a.date.localeCompare(c.date) || a.game_id - c.game_id);
      const up = upcoming.get(s.key) ?? [];
      let run = 0;
      return (
        <div className="divide-y divide-white/[.05]">
          {rows.length === 0 && up.length === 0 && <div className="px-3 py-2 text-xs text-mute">No games in the window yet.</div>}
          {rows.map((l) => {
            const g = gameOf(l.game_id); const v = valueOf(l); run += v;
            const sp = stat === 'fpts' ? scoreParts(l.stats, league?.scoring) : null;
            const k = `${s.key}:${l.game_id}`;
            return (
              <Fragment key={k}>
                <button className="grid w-full grid-cols-[4.6rem_1fr_3.2rem_3.4rem] items-center gap-1 px-3 py-1.5 text-left text-xs" onClick={() => toggle(k)}>
                  <span className="text-mute">{fmtDate(l.date).replace(/,.*$/, '')}<br /><span className="text-[10px]">{fmtDate(l.date).split(', ').slice(1).join(', ')}</span></span>
                  <span className="min-w-0 break-words leading-snug">{liveGame(g) && <span className="mr-1 rounded bg-red-500/80 px-1 text-[9px] font-bold text-white">LIVE</span>}{matchup(l, g)}</span>
                  <span className="num text-right font-semibold text-white">{fmtPts(v, stat === 'fpts' ? 1 : 0)}</span>
                  <span className="num text-right text-mute">{fmtPts(run, stat === 'fpts' ? 1 : 0)}</span>
                </button>
                {open === k && (
                  <div className="bg-black/20 px-3 py-2 text-[11px] text-slate-300">
                    {stat === 'fpts' && sp ? (
                      <>
                        {sp.parts.length === 0 ? <div className="text-mute">Nothing that scores in this league's settings.</div>
                          : <div className="flex flex-wrap gap-x-3 gap-y-0.5">{sp.parts.map((p) => <span key={p.k} className="num">{p.n} {SHORT[p.k] ?? p.k} × {p.w} = <b className="text-white">{fmtPts(p.pts, 2)}</b></span>)}</div>}
                        <div className="mt-1">Sum <b className="num text-white">{fmtPts(sp.total, 2)}</b>{sp.total != null && !near(sp.total, l.fpts) ? <span className="text-amber-300"> · the stored line says {fmtPts(l.fpts, 2)}: a correction is on its way in</span> : <span className="text-emerald-300"> ✓ same as the stored line</span>}</div>
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-x-3">{Object.entries(l.stats).filter(([, n]) => n).map(([k2, n]) => <span key={k2} className={k2 === stat ? 'font-bold text-white' : ''}>{n} {SHORT[k2] ?? k2}</span>)}</div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
          {up.map((g) => (
            <div key={`u${g.id}`} className="grid grid-cols-[4.6rem_1fr_3.2rem_3.4rem] items-center gap-1 px-3 py-1.5 text-xs text-mute">
              <span>{fmtDate(g.date).replace(/,.*$/, '')}<br /><span className="text-[10px]">{fmtDate(g.date).split(', ').slice(1).join(', ')}</span></span>
              <span className="min-w-0 break-words leading-snug">{matchup(null, (tonight.find((x) => x.id === g.id) as GameRow | undefined) ?? g, players.get(s.id)?.nhl_team)}</span>
              <span className="text-right">{hasStarted(sport, tonight.find((x) => x.id === g.id)?.state ?? g.state) ? 'no line yet' : 'to play'}</span><span />
            </div>
          ))}
        </div>
      );
    }
    const rows = (tlines ?? []).filter((t) => t.team_id === s.id).sort((a, c) => a.date.localeCompare(c.date));
    const left = teamNightsLeft;
    // a whole season is long: a week a row, each opening to its nights
    const weekly = rows.length > 21;
    const groups = weekly ? [...rows.reduce((m, r) => { const d = new Date(r.date + 'T12:00:00Z'); const mon = shift(r.date, -((d.getUTCDay() + 6) % 7)); m.set(mon, [...(m.get(mon) ?? []), r]); return m; }, new Map<string, TLine[]>())] : null;
    let run = 0;
    const night = (r: TLine, runAt: number) => {
      const k = `${s.key}:${r.date}`;
      return (
        <Fragment key={k}>
          <button className="grid w-full grid-cols-[1.1rem_4.6rem_1fr_3.2rem_3.4rem] items-center gap-1 px-3 py-1.5 text-left text-xs" onClick={() => toggle(k)}>
            {open === k ? <ChevronDown size={12} className="text-mute" /> : <ChevronRight size={12} className="text-mute" />}
            <span className="text-mute">{fmtDate(r.date).replace(/,.*$/, '')}<br /><span className="text-[10px]">{fmtDate(r.date).split(', ').slice(1).join(', ')}</span></span>
            <span className="text-mute">{r.games} starter game{r.games === 1 ? '' : 's'}{r.date === leagueDay && tonight.some((g) => isLive(sport, g.state)) ? <span className="ml-1 rounded bg-red-500/80 px-1 text-[9px] font-bold text-white">LIVE</span> : null}</span>
            <span className="num text-right font-semibold text-white">{fmtPts(r.points)}</span>
            <span className="num text-right text-mute">{fmtPts(runAt)}</span>
          </button>
          {open === k && <NightDetail teamId={s.id} day={r.date} total={r.points} />}
        </Fragment>
      );
    };
    return (
      <div className="divide-y divide-white/[.05]">
        {rows.length === 0 && left.length === 0 && <div className="px-3 py-2 text-xs text-mute">No nights counted yet.</div>}
        {groups ? groups.map(([mon, rs]) => {
          const wk = rs.reduce((t, r) => t + r.points, 0); const before = run; run += wk; const k = `${s.key}:w${mon}`;
          let inner = before;
          return (
            <Fragment key={k}>
              <button className="grid w-full grid-cols-[1.1rem_1fr_3.2rem_3.4rem] items-center gap-1 px-3 py-1.5 text-left text-xs" onClick={() => setWeek(week === k ? null : k)}>
                {week === k ? <ChevronDown size={12} className="text-mute" /> : <ChevronRight size={12} className="text-mute" />}
                <span className="text-mute">Week of {fmtDate(mon).split(', ').slice(1).join(', ')} · {rs.length} night{rs.length === 1 ? '' : 's'}</span>
                <span className="num text-right font-semibold text-white">{fmtPts(wk)}</span>
                <span className="num text-right text-mute">{fmtPts(run)}</span>
              </button>
              {week === k && <div className="bg-black/15">{rs.map((r) => { inner += r.points; return <Fragment key={r.date}>{night(r, inner)}</Fragment>; })}</div>}
            </Fragment>
          );
        }) : rows.map((r) => { run += r.points; return night(r, run); })}
        {left.length > 0 && <div className="px-3 py-1.5 text-xs text-mute">Still to come: games on {left.length} night{left.length === 1 ? '' : 's'} ({left.slice(0, 4).map((d) => (d === leagueDay ? 'later tonight' : fmtDate(d).replace(/^\w+, /, ''))).join(', ')}{left.length > 4 ? '…' : ''})</div>}
      </div>
    );
  };

  // ───── the check: the count shown above against the settlement's own number
  const Check = ({ c }: { c: typeof checks[number] }) => c.srv == null ? null : near(c.mine, c.srv)
    ? <span className="text-[11px] text-emerald-300">✓ matches the settlement count</span>
    : <span className="text-[11px] text-amber-300">⚠ settlement count says {fmtPts(c.srv, 2)}</span>;

  const d = detail;
  const restLine = (r: Rest, isTeam: boolean) => isTeam
    ? `${fmtPts(r.mean)} expected over ${r.games ?? 0} night${r.games === 1 ? '' : 's'} left (${r.basis})`
    : `${r.games ?? 0} game${r.games === 1 ? '' : 's'} left × ${fmtPts(r.perGame ?? 0, 2)} a game × ${pct(r.dress ?? 1)} chance he plays = ${fmtPts(r.mean, 2)} (${r.basis})`;
  const teamBet = b.kind === 'h2h' || b.kind === 'season' || b.kind === 'team_ou' || b.kind === 'pool_team';

  return (
    <div className="space-y-4 text-sm">
      {/* where it stands */}
      <div className="rounded-2xl border border-white/[.08] bg-black/25 p-3">
        <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-mute"><span>{b.status === 'settled' ? 'The final count' : 'Where it stands'}</span><span>{live ? 'live · refreshed every minute' : b.status}</span></div>
        {!loaded && !err && <div className="text-xs text-mute">Reading the box scores…</div>}
        {err && <div className="text-xs text-red-300">Couldn't read the numbers: {err}</div>}
        {loaded && pool && (
          // a pool can have every GM in it: one tight ranked row each
          <div className="divide-y divide-white/[.06]">
            {[...checks].sort((x, y) => y.mine - x.mine).map((c, i) => (
              <div key={c.s.key} className="flex items-center gap-2 py-1.5">
                <span className="num w-4 text-[11px] text-mute">{i + 1}</span><TeamBadge team={team(c.s.owner)} size={18} />
                <span className="min-w-0 flex-1 truncate text-sm">{c.s.label} <span className="text-xs text-mute">· {gm(c.s.owner)}</span></span>
                <span className="num font-display text-lg font-extrabold text-white">{fmtPts(c.mine, dp)}</span>
                <span className={`w-4 text-center text-xs ${c.srv == null || near(c.mine, c.srv) ? 'text-emerald-300' : 'text-amber-300'}`} title={c.srv == null ? '' : near(c.mine, c.srv) ? 'matches the settlement count' : `settlement count says ${fmtPts(c.srv, 2)}`}>{c.srv == null ? '' : near(c.mine, c.srv) ? '✓' : '⚠'}</span>
              </div>
            ))}
            <div className="pt-1.5 text-[11px]">{allMatch ? <span className="text-emerald-300">✓ Every pick matches the settlement count</span> : <span className="text-amber-300">⚠ A pick doesn't match the settlement count (marked)</span>}</div>
          </div>
        )}
        {loaded && !pool && (
          <div className={`grid gap-2 ${checks.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {checks.map((c) => (
              <div key={c.s.key} className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-xs text-mute">{c.s.owner ? <TeamBadge team={team(c.s.owner)} size={16} /> : null}{c.s.label}{c.s.owner ? <span>· {gm(c.s.owner)}</span> : null}</div>
                <div className="num font-display text-2xl font-extrabold text-white">{fmtPts(c.mine, dp)}{(b.kind === 'player_ou' || b.kind === 'team_ou') && <span className="ml-1 text-xs font-normal text-mute">/ line {String(b.subject?.line)}</span>}</div>
                <Check c={c} />
                {c.then != null && !near(c.then, c.mine) && <div className="text-[11px] text-amber-200">Settled on {fmtPts(c.then, 2)}; a box-score correction since has moved it to {fmtPts(c.mine, 2)}. Settled bets aren't reopened.</div>}
              </div>
            ))}
          </div>
        )}
        {loaded && (b.kind === 'player_ou' || b.kind === 'team_ou') && (() => {
          const v = checks[0]?.mine ?? 0, line = Number(b.subject?.line ?? 0), top = Math.max(line * 1.6, v * 1.1, 1);
          return (
            <div className="relative mt-2 h-2 rounded-full bg-white/[.08]">
              <div className={`h-full rounded-full ${v > line ? 'bg-emerald-400' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (v / top) * 100)}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-gold" style={{ left: `${(line / top) * 100}%` }} title={`line ${line}`} />
            </div>
          );
        })()}
        {loaded && (b.kind === 'h2h' || b.kind === 'player_vs' || b.kind === 'season') && checks.length === 2 && (
          <div className="mt-2 text-xs text-mute">{checks[0].mine === checks[1].mine ? 'Dead even right now.' : `${checks[0].mine > checks[1].mine ? checks[0].s.label : checks[1].s.label} ${b.status === 'settled' ? 'won' : 'leads'} by ${fmtPts(Math.abs(checks[0].mine - checks[1].mine), dp)}.`}</div>
        )}
        {loaded && allMatch && <p className="mt-2 text-[11px] text-mute">Recounted here from the {plines!.length + tlines!.length} box-score rows below; the settlement reads the same rows.</p>}
      </div>

      {/* the road */}
      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-mute">Its road</div>
        <ol className="relative ml-2 border-l border-white/10">
          {steps.map((st) => (
            <li key={st.label} className="relative pb-2.5 pl-4 last:pb-0">
              <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ${st.now ? 'animate-pulse bg-sky-400 ring-4 ring-sky-400/20' : st.done ? 'bg-emerald-400' : 'bg-white/20'}`} />
              <div className={`text-sm font-semibold ${st.done || st.now ? 'text-white' : 'text-mute'}`}>{st.label}</div>
              <div className="text-xs text-mute">{st.sub}</div>
            </li>
          ))}
        </ol>
      </div>

      {/* the rule */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-mute">How it's decided</div>
        <p className="text-sm text-slate-200">{ruleText}</p>
        <p className="mt-1 text-xs text-mute">The league's server settles it on its own at 12:45 UTC the morning after the last day ({b.kind === 'season' ? 'after the last regular-season day' : end ? `the morning of ${fmtDate(shift(end, 1))}` : ''}), once that night's stat corrections are in.</p>
      </div>

      {/* night by night */}
      <div>
        <div className="mb-1 flex items-end justify-between text-[11px] uppercase tracking-wide text-mute"><span>Night by night</span><span className="normal-case">{teamBet ? 'tap a night for its starters' : stat === 'fpts' ? 'tap a game for its scoring' : 'tap a game for its box score'}</span></div>
        <div className="space-y-2">
          {subjects.map((s) => {
            const c = checks.find((x) => x.s.key === s.key);
            return (
              <div key={s.key} className="overflow-hidden rounded-xl border border-white/[.07] bg-white/[.02]">
                <div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-1.5">
                  {s.kind === 'team' ? <TeamBadge team={team(s.id)} size={18} /> : null}
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">{s.label}{s.owner ? <span className="font-normal text-mute"> · {gm(s.owner)}'s pick</span> : null}</span>
                  <span className="text-[10px] text-mute">{teamBet ? `${brand.short} pts` : statLabel(stat)} · total</span>
                </div>
                {loaded ? <Ledger s={s} /> : <div className="px-3 py-2 text-xs text-mute">…</div>}
                {loaded && c && <div className="flex items-center justify-between border-t border-white/[.06] px-3 py-1.5 text-xs"><span className="text-mute">Sum</span><span className="num font-bold text-white">{fmtPts(c.mine, dp)}</span></div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* the coins */}
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wide text-mute">The coins</div>
        <div className="space-y-1 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-xs text-slate-300">
          {pool ? (
            <>
              <div>{myEntries.length} entr{myEntries.length === 1 ? 'y' : 'ies'} × {b.coins} <Coin size={11} /> = <b className="text-white">{pot}</b> pot, held from each bank until it settles.</div>
              <div>Most wins it all. A tie splits it evenly, in whole coins (so {pot} split three ways is {Math.floor(pot / 3)} each).</div>
            </>
          ) : b.coins > 0 ? (
            <>
              <div>{Number(b.odds) === 1 ? <>Even money: each side risks <b className="text-white">{b.coins}</b>.</> : <>{gm(b.creator_team)} gave odds: {b.coins} × {Number(b.odds)} = <b className="text-white">{creatorRisk}</b> at risk against {gm(b.opponent_team)}'s <b className="text-white">{b.coins}</b>.</>} {b.status === 'settled' ? ' Both stakes were held until it settled.' : ' Both stakes are held from the banks until it settles.'}</div>
              <div>If {gm(b.creator_team)} wins: +{b.coins} to them, −{b.coins} from {gm(b.opponent_team)}.</div>
              <div>If {gm(b.opponent_team)} wins: +{creatorRisk} to them, −{creatorRisk} from {gm(b.creator_team)}.</div>
              <div>A push moves nothing.</div>
            </>
          ) : <div>No coins on this one.</div>}
          {!!b.amount && <div>Plus ${b.amount} cash, paid between you and marked paid on the card.</div>}
          {b.stake && <div>Plus: {b.stake}</div>}
          {coins.length > 0 && (
            <div className="mt-2 border-t border-white/[.06] pt-2">
              <div className="mb-1 text-[11px] text-mute">What actually moved</div>
              {coins.map((c) => <div key={c.id} className="flex justify-between"><span>{gm(c.team_id)} · {c.reason}</span><span className={`num font-semibold ${c.amount >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{c.amount >= 0 ? '+' : ''}{c.amount}</span></div>)}
              {!pool && <div className="mt-1 text-[11px]">{moved === 0 ? <span className="text-emerald-300">✓ Nets to zero: every coin won was a coin lost.</span> : <span className="text-amber-300">⚠ Nets to {moved}, not zero.</span>}</div>}
              {pool && <div className="mt-1 text-[11px] text-mute">{pot - (coins.filter((c) => c.amount > 0).reduce((t, c) => t + c.amount, 0)) > 0 ? `${pot - coins.filter((c) => c.amount > 0).reduce((t, c) => t + c.amount, 0)} coin(s) of the pot weren't paid out: a tie that didn't split evenly.` : '✓ The whole pot was paid out.'}</div>}
            </div>
          )}
        </div>
      </div>

      {/* the odds */}
      {live && d && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-mute">The live odds, worked out</div>
          <div className="space-y-1.5 rounded-xl border border-white/[.07] bg-white/[.02] p-3 text-xs text-slate-300">
            {d.kind === 'vs' && (
              <>
                {([['a', d.a], ['b', d.b]] as const).map(([k, sd]) => (
                  <div key={k}><b className="text-white">{subjects.find((s) => s.key === k)?.label}</b>: {fmtPts(sd.banked, 2)} banked + {restLine(sd.rest, teamBet)} = <b className="num text-white">{fmtPts(sd.banked + sd.rest.mean, 1)}</b></div>
                ))}
                <div>Expected margin {sign(d.mean)} ± {fmtPts(d.sd)} (one standard deviation, both sides' swings combined)</div>
                <div>z = {fmtPts(d.mean)} ÷ {fmtPts(d.sd)} = {fmtPts(d.z, 2)} → chance on the bell curve Φ({fmtPts(d.z, 2)}) = <b className="text-white">{pct(d.sd > 1e-6 ? phi(d.z) : d.creator)}</b> for {subjects[0]?.label}{d.creator !== (d.sd > 1e-6 ? phi(d.z) : d.creator) ? ` (capped at ${pct(d.creator)})` : ''}</div>
              </>
            )}
            {d.kind === 'line' && (
              <>
                <div>{fmtPts(d.banked, 2)} banked + {restLine(d.rest, teamBet)} = <b className="num text-white">{fmtPts(d.banked + d.rest.mean, 2)}</b> against the line of {d.line}</div>
                <div>Expected margin over the line {sign(d.mean, 2)} ± {fmtPts(d.sd, 2)}</div>
                <div>z = {fmtPts(d.z, 2)} → chance of the over Φ({fmtPts(d.z, 2)}) = {pct(d.over)} · {gm(b.creator_team)} has the {d.creatorSide}: <b className="text-white">{pct(d.creator)}</b></div>
              </>
            )}
            {d.kind === 'pool' && (
              <>
                {[...d.parts].sort((x, y) => y.chance - x.chance).map((p) => (
                  <div key={p.team} className="flex items-center gap-2"><TeamBadge team={team(p.team)} size={16} /><span className="min-w-0 flex-1 truncate">{b.kind === 'pool_team' ? team(p.pick)?.name : pname(p.pick)}: {fmtPts(p.banked, 1)} + {fmtPts(p.rest.mean, 1)} ± {fmtPts(p.sd, 1)}</span><b className="num text-white">{pct(p.chance)}</b></div>
                ))}
                <div className="text-mute">Each pick's finish drawn {d.runs.toLocaleString()} times from its bell curve; the share of draws it tops (ties split) is its chance.</div>
              </>
            )}
            <p className="pt-1 text-[11px] text-mute">An estimate to follow along with, built from the projections and the schedule. It never decides the bet: only the count above does. A game already under way counts only what's banked so far. Odds are capped between 0.5% and 99.5% until the last game is in.</p>
          </div>
        </div>
      )}
      <button className="btn-ghost w-full" onClick={onClose}>Done</button>
    </div>
  );
}

// one night of a fantasy team: the starters frozen at puck drop and each one's points, summed against the night's total
function NightDetail({ teamId, day, total }: { teamId: number; day: string; total: number }) {
  const { players, league } = useLeague();
  const [rows, setRows] = useState<{ p?: Player; slot: string; fpts: number; stats: Record<string, number>; gameType: number | null; played: boolean }[] | null>(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      const { data: s } = await supabase.from('lineup_snapshots').select('player_id,slot,game_id').eq('team_id', teamId).eq('date', day);
      const snaps = ((s ?? []) as { player_id: number; slot: string; game_id: number }[]).filter((x) => x.slot !== 'BN' && x.slot !== 'IR');
      const [{ data: pg }, { data: g }] = await Promise.all([
        supabase.from('league_games').select('player_id,game_id,fpts,stats').eq('date', day).in('player_id', snaps.map((x) => x.player_id)),
        supabase.from('games').select('id,game_type').eq('date', day),
      ]);
      if (dead) return;
      const types = new Map(((g ?? []) as { id: number; game_type: number | null }[]).map((x) => [x.id, x.game_type]));
      const lines = new Map(((pg ?? []) as { player_id: number; game_id: number; fpts: number; stats: Record<string, number> }[]).map((x) => [`${x.player_id}|${x.game_id}`, x]));
      setRows(snaps.map((x) => { const l = lines.get(`${x.player_id}|${x.game_id}`); return { p: players.get(x.player_id), slot: x.slot, fpts: Number(l?.fpts ?? 0), stats: l?.stats ?? {}, gameType: types.get(x.game_id) ?? null, played: !!l }; })
        .filter((r) => r.played).sort((a, c) => c.fpts - a.fpts));
    })();
    return () => { dead = true; };
  }, [teamId, day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="bg-black/20 px-3 py-2 text-[11px] text-mute">Reading the lineup…</div>;
  // the standings count regular-season games only; a playoff game on the same night is shown but not counted
  const counted = rows.filter((r) => r.gameType == null || r.gameType === 2);
  const sum = r2(counted.reduce((t, r) => t + r.fpts, 0));
  return (
    <div className="bg-black/20 px-3 py-2 text-[11px]">
      {rows.length === 0 && <div className="text-mute">No starter played.</div>}
      {rows.map((r, i) => {
        const sp = scoreParts(r.stats, league?.scoring);
        return (
          <div key={i} className="flex items-baseline gap-2 py-0.5">
            <span className="w-8 shrink-0 text-mute">{r.slot}</span>
            <span className="min-w-0 flex-1"><span className="text-slate-200">{r.p?.name ?? '?'}</span> <span className="text-mute">{sp.parts.map((p) => `${p.n} ${SHORT[p.k] ?? p.k}`).join(' · ')}</span></span>
            <span className="num shrink-0 font-semibold text-white">{fmtPts(r.fpts, 2)}</span>
          </div>
        );
      })}
      <div className="mt-1 flex justify-between border-t border-white/[.06] pt-1">
        <span className="text-mute">Starters' sum</span>
        <span>{near(sum, total) ? <span className="text-emerald-300">✓ </span> : <span className="text-amber-300">⚠ night total {fmtPts(total, 2)} · </span>}<b className="num text-white">{fmtPts(sum, 2)}</b></span>
      </div>
    </div>
  );
}
