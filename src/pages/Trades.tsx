import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSticky } from '../lib/sticky';
import { useSearchParams } from 'react-router-dom';
import { useLeague, useNow, useSport } from '../lib/store';
import { positionKeys } from '../lib/sport';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { DraftPick, Player, Trade } from '../lib/types';
import { ago, fmtDateTime, fmtPts } from '../lib/format';
import { PlayerInfoProvider, PlayerRow, PlayerTag } from '../components/PlayerCard';
import { Empty, Section, TeamBadge, TeamName, useAction, PageHeader } from '../components/ui';
import { TradeAnalysis, TradeCompare, TradeFinder, TradeFit, useTradeValuer, usePickupStatus, type BuildSpec } from '../components/TradeTools';
import { PlayerPeek, ScoutBar, StatStrip, sortPlayers, useScout, useScoutCtx } from '../components/TradeScout';
import { TradeBlock } from '../components/TradeBlock';
import { dropOrder, evaluateSide, gradeSide, type Side } from '../lib/trade';
import { gradeColor } from '../lib/grades';
import { Repeat2 } from 'lucide-react';
import { useBrand } from '../lib/brand';

// choosing who goes to make room: the weakest first, tap to swap one for another
function DropPick({ pool, need, value, onChange, worth }: { pool: Player[]; need: number; value: Set<number>; onChange: (v: Set<number>) => void; worth: (p: Player) => number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {pool.slice(0, 10).map((p) => {
        const on = value.has(p.id);
        return (
          <button key={p.id} type="button" onClick={() => { const n = new Set(value); if (on) n.delete(p.id); else { if (n.size >= need) n.delete([...n][0]); n.add(p.id); } onChange(n); }}
            className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-amber-300 bg-amber-400/25 text-amber-50' : 'border-white/10 bg-white/[.04] text-slate-300'}`}>
            {on ? '✂️ ' : ''}{p.name} <span className="text-mute">{p.elig.join('/')} · {Math.round(worth(p))} pts left</span>
          </button>
        );
      })}
    </div>
  );
}


// a multi-team builder line: one asset, where it comes from and where it goes
type MItem = { from: number; to: number; player_id?: number; pick_id?: number };

export default function Trades() {
  const { me, teams, team, rosters, players, picks, league, season } = useLeague();
  const FILTERS = ['all', ...positionKeys(useSport()), 'picks'];
  const brand = useBrand();
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const { busy, run } = useAction();
  const [trades, setTrades] = useState<Trade[]>([]);
  const partner = params.get('with') ? Number(params.get('with')) : null;
  const ids = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean).map(Number);
  const [give, setGive] = useState<Set<number>>(new Set(ids('give')));
  const [get, setGet] = useState<Set<number>>(new Set(ids('get')));
  const [givePicks, setGivePicks] = useState<Set<number>>(new Set(ids('givePicks')));
  const [getPicks, setGetPicks] = useState<Set<number>>(new Set(ids('getPicks')));
  const [note, setNote] = useState('');
  // unused free-agent pickups and the league's coins can go in a deal too
  const [extras, setExtras] = useState({ givePk: 0, getPk: 0, giveCoins: 0, getCoins: 0 });
  const pkStatus = usePickupStatus();
  const [coinFree, setCoinFree] = useState<Map<number, number>>(new Map());
  useEffect(() => {
    supabase.from('coin_balances').select('team_id,balance,escrow').then(({ data }) => setCoinFree(new Map((data ?? []).map((c: { team_id: number; balance: number; escrow: number }) => [c.team_id, Number(c.balance) - Number(c.escrow)]))));
  }, []);
  const pkLeft = (t: number) => pkStatus.find((x) => x.team_id === t)?.remaining ?? 0;
  const { v: valuer, rosterMax, sched, irOf } = useTradeValuer();
  const extrasN = extras.givePk + extras.getPk + extras.giveCoins + extras.getCoins;
  const [mode, setMode] = useState<'two' | 'multi'>(params.get('multi') ? 'multi' : 'two');
  // scouting while you pick: what shows beside each player, a peek under any of them, and a side-by-side tray
  const scout = useScout({}, 'trades');
  const sctx = useScoutCtx();
  const [peek, setPeek] = useState<number | null>(null);
  const [compare, setCompare] = useState<Set<number>>(new Set());
  const compareList = [...compare].map((id) => players.get(id)).filter((p): p is Player => !!p);
  const ownerOf = (id: number) => rosters.find((r) => r.player_id === id)?.team_id ?? 0;
  const [parties, setParties] = useState<number[]>([]);
  const [mitems, setMitems] = useState<MItem[]>([]);
  useEffect(() => {
    setGive(new Set(ids('give'))); setGet(new Set(ids('get'))); setGivePicks(new Set(ids('givePicks'))); setGetPicks(new Set(ids('getPicks')));
    setExtras({ givePk: Number(params.get('givePk') ?? 0) || 0, getPk: Number(params.get('getPk') ?? 0) || 0,
      giveCoins: Number(params.get('giveCoins') ?? 0) || 0, getCoins: Number(params.get('getCoins') ?? 0) || 0 });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  // the builder can show one position (or only picks) at a time
  const [posFilter, setPosFilter] = useSticky<string>('trades:pos', 'all');
  // the players you name to drop when the deal leaves you over the roster limit
  const [myDrops, setMyDrops] = useState<Set<number>>(new Set());

  const load = () => supabase.from('trades').select('*, trade_items(*)').order('id', { ascending: false }).limit(60)
    .then(({ data }) => setTrades((data ?? []) as Trade[]));
  useEffect(() => {
    load();
    const ch = realtimeChannel('trades-page').on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const assets = (tid: number) => ({
    players: rosters.filter((r) => r.team_id === tid).map((r) => players.get(r.player_id)!).filter(Boolean).sort((a, b) => b.proj - a.proj),
    picks: picks.filter((p) => p.team_id === tid && !p.player_id).sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round),
  });
  const mine = me ? assets(me.id) : { players: [], picks: [] };
  const theirs = partner ? assets(partner) : { players: [], picks: [] };
  const flip = (s: Set<number>, set: (x: Set<number>) => void, id: number) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); set(n); };
  const valueOf = (ids: Set<number>) => [...ids].reduce((t, id) => t + (season.get(id)?.fpts ?? players.get(id)?.proj ?? 0), 0);
  const pastDeadline = league?.trade_deadline && now > new Date(league.trade_deadline).getTime();
  const pickLabel = (k: DraftPick, side: number) => `${k.season} R${k.round} pick${k.original_team !== side ? ` (via ${team(k.original_team)?.abbrev})` : ''}${k.overall ? ` · #${k.overall}` : ''}`;

  // the offer being countered, if any: sending the counter closes it as countered and links the two (migration 101)
  const countering = params.get('counter') ? trades.find((t) => t.id === Number(params.get('counter')) && t.status === 'proposed') : undefined;
  const propose = () => run(async () => {
    await rpc('propose_trade', { p_to: partner, p_give: [...give], p_get: [...get], p_give_picks: [...givePicks], p_get_picks: [...getPicks], p_note: note || null,
      p_give_pickups: extras.givePk, p_get_pickups: extras.getPk, p_give_coins: extras.giveCoins, p_get_coins: extras.getCoins, p_drops: needDrops > 0 ? [...myDrops] : [],
      ...(countering && countering.from_team === partner ? { p_counter: countering.id } : {}) });
    setGive(new Set()); setGet(new Set()); setGivePicks(new Set()); setGetPicks(new Set()); setNote(''); setParams({}); setExtras({ givePk: 0, getPk: 0, giveCoins: 0, getCoins: 0 }); setMyDrops(new Set());
    load();
  }, countering ? 'Counter-offer sent 📨' : 'Trade offer sent 📨');
  const proposeMulti = () => run(async () => {
    await rpc('propose_multi_trade', { p_items: mitems, p_note: note || null, p_drops: needDropsM > 0 ? [...myDrops] : [] });
    setMitems([]); setParties([]); setNote(''); setMyDrops(new Set());
    load();
  }, 'Multi-team offer sent 📨');

  // analysis inputs for the two-team builder
  const twoSides: Side[] = useMemo(() => {
    if (!me || !partner) return [];
    const pk = (ids: Set<number>) => picks.filter((k) => ids.has(k.id));
    const myAfter = [...mine.players.filter((p) => !give.has(p.id)), ...theirs.players.filter((p) => get.has(p.id))];
    const theirAfter = [...theirs.players.filter((p) => !get.has(p.id)), ...mine.players.filter((p) => give.has(p.id))];
    return [
      { team: me.id, before: mine.players, after: myAfter, picksOut: pk(givePicks), picksIn: pk(getPicks), ir: irOf(me.id), drops: [...myDrops],
        pickupsOut: extras.givePk, pickupsIn: extras.getPk, pickupsLeft: pkLeft(me.id), coinsOut: extras.giveCoins, coinsIn: extras.getCoins },
      { team: partner, before: theirs.players, after: theirAfter, picksOut: pk(getPicks), picksIn: pk(givePicks), ir: irOf(partner),
        pickupsOut: extras.getPk, pickupsIn: extras.givePk, pickupsLeft: pkLeft(partner), coinsOut: extras.getCoins, coinsIn: extras.giveCoins },
    ];
  }, [me, partner, mine.players, theirs.players, give, get, givePicks, getPicks, picks, extras, myDrops, pkStatus, rosters]); // eslint-disable-line react-hooks/exhaustive-deps

  // multi-team: everyone involved, and each roster after the deal
  const allParties = me ? [me.id, ...parties] : [];
  const multiSides: Side[] = useMemo(() => allParties.map((t) => {
    const before = assets(t).players;
    const out = new Set(mitems.filter((i) => i.from === t && i.player_id).map((i) => i.player_id!));
    const inn = mitems.filter((i) => i.to === t && i.player_id).map((i) => players.get(i.player_id!)).filter((p): p is Player => !!p);
    return { team: t, before, after: [...before.filter((p) => !out.has(p.id)), ...inn], ir: irOf(t), pickupsLeft: pkLeft(t), drops: t === me?.id ? [...myDrops] : [],
      picksOut: picks.filter((k) => mitems.some((i) => i.from === t && i.pick_id === k.id)), picksIn: picks.filter((k) => mitems.some((i) => i.to === t && i.pick_id === k.id)) };
  }), [allParties.join(','), mitems, rosters, players, picks, myDrops, pkStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  // how many players you'd be over the roster limit after the deal you're building (you name who goes)
  const activeOf = (ps: Player[], t: number) => { const ir = irOf(t); return ps.filter((p) => !ir.has(p.id)).length; };
  const needDrops = me && partner && twoSides[0] ? Math.max(0, activeOf(twoSides[0].after, me.id) - rosterMax) : 0;
  const myMulti = me ? multiSides.find((x) => x.team === me.id) : undefined;
  const needDropsM = me && myMulti ? Math.max(0, activeOf(myMulti.after, me.id) - rosterMax) : 0;
  const need = mode === 'two' ? needDrops : needDropsM;
  const myAfterNow = mode === 'two' ? twoSides[0]?.after ?? [] : myMulti?.after ?? [];
  const dropPool = dropOrder(myAfterNow, myAfterNow.filter((p) => me && mine.players.includes(p) && !irOf(me.id).has(p.id)), valuer);
  useEffect(() => {
    // start from the weakest players; the GM can swap in anyone else
    if (need === 0) { if (myDrops.size) setMyDrops(new Set()); return; }
    const keep = [...myDrops].filter((id) => dropPool.some((p) => p.id === id)).slice(0, need);
    for (const p of dropPool) { if (keep.length >= need) break; if (!keep.includes(p.id)) keep.push(p.id); }
    if (keep.length !== myDrops.size || keep.some((id) => !myDrops.has(id))) setMyDrops(new Set(keep));
  }, [need, dropPool.map((p) => p.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const mitem = (from: number, key: 'player_id' | 'pick_id', id: number) => mitems.find((i) => i.from === from && i[key] === id);
  const toggleM = (from: number, key: 'player_id' | 'pick_id', id: number) => {
    const cur = mitem(from, key, id);
    if (cur) setMitems(mitems.filter((i) => i !== cur));
    else setMitems([...mitems, { from, to: allParties.find((t) => t !== from)!, [key]: id }]);
  };
  const setDest = (item: MItem, to: number) => setMitems(mitems.map((i) => (i === item ? { ...i, to } : i)));

  // what a side sends, line by line; a player is a tag that opens his card (injury, tonight, news) right here
  const describe = (t: Trade, side: number, to?: number) => (t.trade_items ?? []).filter((i) => !i.release && i.from_team === side && (to == null || i.to_team === to)).map((i): { k: string; n: React.ReactNode } => {
    const n = itemText(i, side);
    const p = i.player_id ? players.get(i.player_id) : undefined;
    return { k: `${i.id}`, n: p ? <PlayerTag p={p} /> : n };
  });
  const itemText = (i: NonNullable<Trade['trade_items']>[number], side: number) => {
    if (i.player_id) return players.get(i.player_id)?.name ?? 'Player';
    if (i.pickups) return `🎟️ ${i.pickups} free-agent pickup${i.pickups > 1 ? 's' : ''}`;
    if (i.coins) return `${brand.coin.emoji} ${i.coins} ${brand.coin.name}`;
    const pk = picks.find((p) => p.id === i.pick_id);
    return pk ? `${pk.season} R${pk.round} pick${pk.original_team !== side ? ` (via ${team(pk.original_team)?.abbrev})` : ''}` : 'Pick';
  };
  const partiesOf = (t: Trade) => t.parties ?? [t.from_team, t.to_team];
  // a pending trade as sides: each team's roster now, and after the deal
  const sidesOf = (t: Trade): Side[] => {
    const ps = partiesOf(t);
    const items = t.trade_items ?? [];
    const dest = (i: { from_team: number; to_team: number | null }) => i.to_team ?? ps.find((x) => x !== i.from_team)!;
    const moves = items.filter((i) => !i.release);
    const sum = (f: (i: (typeof items)[number]) => boolean, k: 'pickups' | 'coins') => moves.filter(f).reduce((n, i) => n + (i[k] ?? 0), 0);
    return ps.map((tid) => {
      const before = assets(tid).players;
      const out = new Set(moves.filter((i) => i.from_team === tid && i.player_id).map((i) => i.player_id!));
      const inn = moves.filter((i) => dest(i) === tid && i.from_team !== tid && i.player_id).map((i) => players.get(i.player_id!)).filter((p): p is Player => !!p);
      return { team: tid, before, after: [...before.filter((p) => !out.has(p.id)), ...inn], ir: irOf(tid), pickupsLeft: pkLeft(tid),
        drops: items.filter((i) => i.release && i.from_team === tid).map((i) => i.player_id!),
        pickupsOut: sum((i) => i.from_team === tid, 'pickups'), pickupsIn: sum((i) => dest(i) === tid && i.from_team !== tid, 'pickups'),
        coinsOut: sum((i) => i.from_team === tid, 'coins'), coinsIn: sum((i) => dest(i) === tid && i.from_team !== tid, 'coins'),
        picksOut: picks.filter((k) => moves.some((i) => i.from_team === tid && i.pick_id === k.id)),
        picksIn: picks.filter((k) => moves.some((i) => dest(i) === tid && i.from_team !== tid && i.pick_id === k.id)) };
    });
  };
  const [openTrade, setOpenTrade] = useState<number | null>(null);
  // accepting an offer that leaves you over the roster limit: name who goes first
  const [accepting, setAccepting] = useState<{ id: number; need: number; pool: Player[]; drops: Set<number> } | null>(null);
  const accept = (t: Trade, drops: number[] = []) => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: true, p_drops: drops }); setAccepting(null); load(); },
    t.parties ? 'Accepted. Waiting on the others.' : 'Accepted! Off to the commish.');
  const tryAccept = (t: Trade) => {
    if (!me) return;
    const mineSide = sidesOf(t).find((x) => x.team === me.id);
    const n = mineSide ? Math.max(0, activeOf(mineSide.after, me.id) - rosterMax) : 0;
    if (!n) { accept(t); return; }
    const pool = dropOrder(mineSide!.after, mineSide!.after.filter((p) => mine.players.includes(p) && !irOf(me.id).has(p.id)), valuer);
    setAccepting({ id: t.id, need: n, pool, drops: new Set(pool.slice(0, n).map((p) => p.id)) });
  };
  // offers waiting on you open with the full assessment showing
  const isOpen = (t: Trade) => openTrade === t.id || (canRespond(t) && openTrade !== -t.id);
  const gradesOf = (t: Trade) => sidesOf(t).map((sd) => gradeSide(evaluateSide(sd, valuer, rosterMax, sched), { coin: brand.coin.name }));
  const canRespond = (t: Trade) => !!me && t.status === 'proposed' && (t.parties ? partiesOf(t).includes(me.id) && t.from_team !== me.id && !(t.accepted_by ?? []).includes(me.id) : t.to_team === me.id);

  const groups = useMemo(() => ({
    incoming: trades.filter((t) => canRespond(t)),
    outgoing: trades.filter((t) => t.status === 'proposed' && !canRespond(t) && !!me && partiesOf(t).includes(me.id)),
    league: trades.filter((t) => t.status === 'proposed' && !(me && partiesOf(t).includes(me.id))),
    review: trades.filter((t) => t.status === 'accepted'),
    done: trades.filter((t) => !['proposed', 'accepted'].includes(t.status)),
  }), [trades, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // a trade as a card. A render function, not a component made inside this page: a component defined in here would be a
  // new type on every render (the clock ticks, live scores land), so React would rebuild the card and everything in it,
  // and the analysis tabs and filters a GM had open would snap back to their defaults
  const tradeCard = (t: Trade, children?: React.ReactNode) => {
    const ps = partiesOf(t);
    return (
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-mute">
          <span>#{t.id} · {ago(t.created_at, now)}{t.parties && <> · {t.parties.length}-team trade</>}{t.counter_of && <> · ↩️ counter to #{t.counter_of}</>}</span>
          <span className={`chip ${t.status === 'approved' ? 'text-emerald-300' : ['vetoed', 'declined', 'failed'].includes(t.status) ? 'text-red-300' : t.status === 'countered' ? 'text-sky-300' : ''}`}>{t.status}</span>
        </div>
        <div className={`grid gap-3 ${ps.length > 2 ? 'sm:grid-cols-3' : 'grid-cols-2'}`}>
          {ps.map((side) => (
            <div key={side}>
              <div className="mb-1 flex items-center gap-1.5 text-sm"><TeamBadge team={team(side)} size={20} /><TeamName link team={team(side)} className="truncate" />
                {t.parties && t.status === 'proposed' && <span className="ml-auto text-xs" title={(t.accepted_by ?? []).includes(side) ? 'Accepted' : 'Waiting'}>{(t.accepted_by ?? []).includes(side) ? '✅' : '⏳'}</span>}</div>
              <div className="text-xs text-mute">sends</div>
              {t.parties ? (
                <ul className="space-y-0.5 text-sm">{ps.filter((o) => o !== side).flatMap((o) => describe(t, side, o).map((d) => <li key={`${o}-${d.k}`}>• {d.n} <span className="text-mute">→ {team(o)?.abbrev}</span></li>))}{describe(t, side).length === 0 && <li className="text-mute">nothing</li>}</ul>
              ) : (
                <ul className="space-y-0.5 text-sm">{describe(t, side).map((d) => <li key={d.k}>• {d.n}</li>)}{describe(t, side).length === 0 && <li className="text-mute">nothing</li>}</ul>
              )}
              {(t.trade_items ?? []).filter((i) => i.release && i.from_team === side).map((i) => <div key={i.id} className="mt-0.5 text-xs text-amber-200">✂️ drops {players.get(i.player_id!)?.name ?? 'a player'} to make room</div>)}
            </div>
          ))}
        </div>
        {(t.status === 'proposed' || t.status === 'accepted') && (() => {
          const gs = gradesOf(t);
          return (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-white/[.03] px-2 py-1.5 text-xs">
              <span className="text-mute">Grades</span>
              {gs.map((g) => <span key={g.team} className="flex items-center gap-1"><TeamBadge team={team(g.team)} size={16} />{team(g.team)?.gm_name}<b className={`h-display text-base ${gradeColor(g.grade)}`}>{g.grade}</b></span>)}
              <button className="ml-auto text-sky-300 hover:underline" onClick={() => setOpenTrade(isOpen(t) ? -t.id : t.id)}>{isOpen(t) ? 'Hide' : 'Full assessment & stats'}</button>
            </div>
          );
        })()}
        {isOpen(t) && <div className="mt-2"><TradeAnalysis sides={sidesOf(t)} compact /></div>}
        {t.note && <p className="mt-2 rounded-lg bg-boards px-2 py-1 text-xs italic">“{t.note}”</p>}
        {t.review_note && <p className="mt-1 text-xs text-mute">Commish: {t.review_note}</p>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    );
  };

  // the one-line résumé under each player in the builder: this season if it's started, else last season
  const statBlurb = (p: Player) => {
    const s = season.get(p.id);
    const t = (s && s.gp ? s.totals : p.last_stats) as Record<string, number | null> | null;
    const gp = s && s.gp ? s.gp : (p.last_stats?.gp ?? 0);
    if (!t || !gp) return 'no NHL games';
    const tag = s && s.gp ? '' : '’25-26 ';
    const fp = `${fmtPts(s && s.gp ? s.fpts : p.last_fp, 1)} FP, `;
    return p.pos === 'G' ? `${tag}${fp}${gp} GP, ${t.w ?? 0} W, ${t.sa ? ((t.sv ?? 0) / (t.sa as number)).toFixed(3).replace(/^0/, '') : '–'} SV%, ${t.sho ?? 0} SO`
      : `${tag}${fp}${gp} GP, ${t.g ?? 0} G, ${t.a ?? 0} A, ${t.ppp ?? 0} PPP, ${t.sog ?? 0} SOG, ${t.hit ?? 0} H, ${t.blk ?? 0} B`;
  };
  const buildFromFinder = (b: BuildSpec) => {
    setMode('two');
    const q: Record<string, string> = { with: String(b.partner), give: b.give.map((x) => x.id).join(','), get: b.get.map((x) => x.id).join(',') };
    if (b.givePicks?.length) q.givePicks = b.givePicks.map((k) => k.id).join(',');
    if (b.getPicks?.length) q.getPicks = b.getPicks.map((k) => k.id).join(',');
    if (b.givePk) q.givePk = String(b.givePk);
    if (b.getPk) q.getPk = String(b.getPk);
    setParams(q);
    document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // a counter: the offer turned around in the builder (what they asked of you is what you send, what they offered is
  // what you get, picks, pickups and coins included), ready to change and send back
  const counter = (t: Trade) => {
    if (!me) return;
    const items = (t.trade_items ?? []).filter((i) => !i.release);
    const mineOut = items.filter((i) => i.from_team === me.id), theirsOut = items.filter((i) => i.from_team === t.from_team);
    const ids = (xs: typeof items, k: 'player_id' | 'pick_id') => xs.map((i) => i[k]).filter((x): x is number => x != null).join(',');
    const sum = (xs: typeof items, k: 'pickups' | 'coins') => xs.reduce((n, i) => n + (i[k] ?? 0), 0);
    const q: Record<string, string> = { with: String(t.from_team), counter: String(t.id), give: ids(mineOut, 'player_id'), get: ids(theirsOut, 'player_id') };
    if (ids(mineOut, 'pick_id')) q.givePicks = ids(mineOut, 'pick_id');
    if (ids(theirsOut, 'pick_id')) q.getPicks = ids(theirsOut, 'pick_id');
    if (sum(mineOut, 'pickups')) q.givePk = String(sum(mineOut, 'pickups'));
    if (sum(theirsOut, 'pickups')) q.getPk = String(sum(theirsOut, 'pickups'));
    if (sum(mineOut, 'coins')) q.giveCoins = String(sum(mineOut, 'coins'));
    if (sum(theirsOut, 'coins')) q.getCoins = String(sum(theirsOut, 'coins'));
    setMode('two');
    setParams(q);
    // the builder is further down the page: take the GM there once it has the deal in it
    window.setTimeout(() => document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // (a render function too, for the same reason: its scroll position and open peeks survive the page refreshing)
  const assetList = ({ tid, players: ps, picks: ks, isOn, onFlip, dest }: { tid: number; players: Player[]; picks: DraftPick[]; isOn: (k: 'player_id' | 'pick_id', id: number) => boolean; onFlip: (k: 'player_id' | 'pick_id', id: number) => void; dest?: (k: 'player_id' | 'pick_id', id: number) => React.ReactNode }) => (
    <div className="max-h-[32rem] divide-y divide-white/[.06] overflow-y-auto rounded-xl border border-line">
      {sortPlayers(ps, scout.sort, sctx).filter((p) => isOn('player_id', p.id) || posFilter === 'all' || (posFilter !== 'picks' && (p.pos === posFilter || p.elig.includes(posFilter)))).map((p) => {
        const on = isOn('player_id', p.id), cmp = compare.has(p.id);
        return (
          <div key={p.id} className={`px-2 py-1.5 ${on ? 'bg-sky-500/15' : ''}`}>
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={on} onChange={() => onFlip('player_id', p.id)} className="h-4 w-4 shrink-0 accent-sky-400" aria-label={on ? 'Take out of the deal' : 'Put in the deal'} />
              <div className="min-w-0 flex-1"><PlayerRow p={p} wrapName sub={<span className="ml-1">· {statBlurb(p)}</span>} /></div>
              {on && dest?.('player_id', p.id)}
              <button type="button" title={cmp ? 'Take out of the comparison' : 'Compare side by side'} aria-label="Compare" onClick={() => { const n = new Set(compare); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setCompare(n); }}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-sm ${cmp ? 'border-gold/60 bg-gold/20' : 'border-white/10 text-mute'}`}>⚖️</button>
              <button type="button" title="Every number, past and future" aria-label="More numbers" onClick={() => setPeek(peek === p.id ? null : p.id)}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border text-xs ${peek === p.id ? 'border-sky-400/60 bg-sky-500/20' : 'border-white/10 text-mute'}`}>{peek === p.id ? '▴' : '▾'}</button>
            </div>
            <div className="mt-1 flex justify-end pl-6"><StatStrip p={p} s={scout} c={sctx} /></div>
            {peek === p.id && <div className="mt-1.5"><PlayerPeek p={p} c={sctx} /></div>}
          </div>
        );
      })}
      {ks.filter((k) => isOn('pick_id', k.id) || posFilter === 'all' || posFilter === 'picks').map((k) => (
        <label key={`pk${k.id}`} className={`flex cursor-pointer items-center gap-2 px-2 py-2 text-sm ${isOn('pick_id', k.id) ? 'bg-sky-500/15' : ''}`}>
          <input type="checkbox" checked={isOn('pick_id', k.id)} onChange={() => onFlip('pick_id', k.id)} className="h-4 w-4 accent-sky-400" />
          <span className="flex-1">📋 {pickLabel(k, tid)}</span>
          {isOn('pick_id', k.id) && dest?.('pick_id', k.id)}
        </label>
      ))}
    </div>
  );

  // show one position at a time (or only picks) in the asset lists; whatever is already in the deal stays visible
  const posBar = (
    <div className="scroll-x flex items-center gap-1">
      <span className="label mr-1 shrink-0">Show</span>
      {FILTERS.map((f) => <button key={f} onClick={() => setPosFilter(f)} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${posFilter === f ? 'bg-gold text-ice' : 'bg-white/[.05] text-mute'}`}>{f === 'all' ? 'Everyone' : f === 'picks' ? '📋 Picks' : f}</button>)}
    </div>
  );
  // over the limit: name who goes with the deal
  const dropBox = need > 0 && (
    <div className="space-y-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2.5">
      <div className="text-xs text-amber-100">✂️ You'd have {rosterMax + need} active players, {need} over the limit. Pick {need === 1 ? 'who goes' : `the ${need} who go`} with the trade (only if it goes through). The weakest you can spare is picked to start:</div>
      <DropPick pool={dropPool} need={need} value={myDrops} onChange={setMyDrops} worth={valuer.player} />
    </div>
  );

  return (
    <PlayerInfoProvider>
    <div className="space-y-5">
      <PageHeader icon={<Repeat2 size={22} className="text-blue" />} title="Trades" sub={<>Deadline {league?.trade_deadline ? fmtDateTime(league.trade_deadline) : 'TBD'}</>} />

      {groups.incoming.length > 0 && (
        <Section title="Offers for you">
          <div className="space-y-2">{groups.incoming.map((t) => (
            <Fragment key={t.id}>{tradeCard(t, <>
              {accepting?.id === t.id ? (
                <div className="w-full space-y-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-sm">
                  <div className="text-xs text-amber-100">This puts you {accepting.need} over the roster limit. Pick {accepting.need === 1 ? 'who goes' : `the ${accepting.need} who go`} with the trade (only if it goes through). Weakest you can spare first:</div>
                  <DropPick pool={accepting.pool} need={accepting.need} value={accepting.drops} onChange={(d) => setAccepting({ ...accepting, drops: d })} worth={valuer.player} />
                  <div className="flex gap-2">
                    <button className="btn-primary btn-sm" disabled={busy || accepting.drops.size !== accepting.need} onClick={() => accept(t, [...accepting.drops])}>Accept and drop {accepting.drops.size}</button>
                    <button className="btn-ghost btn-sm" onClick={() => setAccepting(null)}>Not yet</button>
                  </div>
                </div>
              ) : <button className="btn-primary" disabled={busy} onClick={() => tryAccept(t)}>Accept</button>}
              <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: false }); load(); }, 'Declined')}>Decline</button>
              {!t.parties && <button className="btn-ghost" disabled={busy} onClick={() => counter(t)}>Counter</button>}
            </>)}</Fragment>
          ))}</div>
        </Section>
      )}

      {groups.review.length > 0 && (
        <Section title="Awaiting commissioner review">
          <div className="space-y-2">{groups.review.map((t) => (
            <Fragment key={t.id}>{tradeCard(t, <>
              {me?.is_commish ? (
                <>
                  <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('review_trade', { p_trade: t.id, p_approve: true, p_note: null }); load(); }, 'Trade approved')}>✅ Approve</button>
                  <button className="btn-ghost text-red-300" disabled={busy} onClick={() => { const n = prompt('Reason for veto?'); if (n !== null) run(async () => { await rpc('review_trade', { p_trade: t.id, p_approve: false, p_note: n }); load(); }, 'Trade vetoed'); }}>🚫 Veto</button>
                </>
              ) : <span className="text-xs text-mute">Auto-approves {league?.trade_review_hours ?? 24}h after acceptance unless the commish steps in.</span>}
            </>)}</Fragment>
          ))}</div>
        </Section>
      )}

      {!pastDeadline && league?.phase !== 'draft' && (
        <Section title="📣 The trade block" right={<span className="text-xs text-mute">who's selling, who's buying</span>}>
          <TradeBlock onBuild={buildFromFinder} />
        </Section>
      )}

      {me?.role !== 'spectator' && !pastDeadline && league?.phase !== 'draft' && (
        <Section title="🧭 Who needs what" right={<span className="text-xs text-mute">position ranks, best partners</span>}>
          <TradeFit onPick={(t) => { setMode('two'); setParams({ with: String(t) }); document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
        </Section>
      )}

      {me?.role !== 'spectator' && !pastDeadline && league?.phase !== 'draft' && (
        <Section title="Find a trade">
          <TradeFinder onBuild={buildFromFinder} />
        </Section>
      )}

      <Section title="Propose a trade">
        <div id="trade-builder" />
        {me?.role === 'spectator' ? <div className="card p-4 text-sm text-mute">🍿 Spectators can watch the trade market, not play it. Join as a GM and this opens up.</div> : pastDeadline ? <div className="card p-4 text-sm text-mute">The trade deadline has passed. See you in the offseason.</div> : (
          <div className="card space-y-3 p-3">
            <div className="flex gap-1">
              <button className={`tab ${mode === 'two' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setMode('two')}>Two teams</button>
              <button className={`tab ${mode === 'multi' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setMode('multi')}>Three or more teams</button>
            </div>

            {mode === 'two' && (
              <>
                <div className="scroll-x flex gap-1.5">
                  {teams.filter((t) => t.id !== me?.id).map((t) => (
                    <button key={t.id} onClick={() => setParams({ with: String(t.id) })}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${partner === t.id ? 'border-white bg-white text-ice' : 'border-line bg-boards'}`}>
                      <TeamBadge team={t} size={20} />{t.gm_name}
                    </button>
                  ))}
                </div>
                {partner && countering && countering.from_team === partner && (
                  <div className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">↩️ Countering {team(partner)?.gm_name}’s offer #{countering.id}: it’s loaded below the other way round. Change anything, then send. Sending it closes their offer as countered.</div>
                )}
                {partner && (
                  <>
                    <ScoutBar s={scout} hasG={[...mine.players, ...theirs.players].some((p) => p.pos === 'G')} />
                    {posBar}
                    {compareList.length > 0 && <TradeCompare moving={compareList.map((p) => ({ p, to: ownerOf(p.id) }))} title="Side by side" showTo={false} onClear={() => setCompare(new Set())} />}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[{ label: 'You send', tid: me!.id, a: mine, sel: give, set: setGive, psel: givePicks, pset: setGivePicks, pk: 'givePk' as const, cn: 'giveCoins' as const },
                        { label: `${team(partner)?.gm_name} sends`, tid: partner, a: theirs, sel: get, set: setGet, psel: getPicks, pset: setGetPicks, pk: 'getPk' as const, cn: 'getCoins' as const }].map((col) => (
                        <div key={col.label} className="min-w-0">
                          <div className="label mb-1 flex justify-between"><span>{col.label}</span><span>{fmtPts(valueOf(col.sel), 0)} pts value</span></div>
                          {assetList({ tid: col.tid, players: col.a.players, picks: col.a.picks,
                            isOn: (k, id) => (k === 'player_id' ? col.sel.has(id) : col.psel.has(id)),
                            onFlip: (k, id) => (k === 'player_id' ? flip(col.sel, col.set, id) : flip(col.psel, col.pset, id)) })}
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="rounded-xl border border-white/[.08] bg-white/[.03] px-2 py-1.5 text-[11px] text-mute">🎟️ Free-agent pickups <span className="text-slate-400">({pkLeft(col.tid)} left)</span>
                              <input className="input mt-1 py-1" type="number" min={0} max={pkLeft(col.tid)} value={extras[col.pk] || ''} placeholder="0"
                                onChange={(e) => setExtras({ ...extras, [col.pk]: Math.max(0, Math.min(pkLeft(col.tid), Math.floor(Number(e.target.value) || 0))) })} /></label>
                            <label className="rounded-xl border border-white/[.08] bg-white/[.03] px-2 py-1.5 text-[11px] text-mute">{brand.coin.emoji} {brand.coin.name} <span className="text-slate-400">({Math.max(0, coinFree.get(col.tid) ?? 0)} free)</span>
                              <input className="input mt-1 py-1" type="number" min={0} max={Math.max(0, coinFree.get(col.tid) ?? 0)} value={extras[col.cn] || ''} placeholder="0"
                                onChange={(e) => setExtras({ ...extras, [col.cn]: Math.max(0, Math.min(Math.max(0, coinFree.get(col.tid) ?? 0), Math.floor(Number(e.target.value) || 0))) })} /></label>
                          </div>
                        </div>
                      ))}
                    </div>
                    {dropBox}
                    <TradeAnalysis sides={twoSides} />
                    <input className="input" placeholder="Sweeten it with a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    {extrasN > 0 && <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-xs text-slate-300">Also in the deal: {[extras.givePk && `you send ${extras.givePk} pickup${extras.givePk > 1 ? 's' : ''}`, extras.giveCoins && `you send ${extras.giveCoins} coins`, extras.getPk && `you get ${extras.getPk} pickup${extras.getPk > 1 ? 's' : ''}`, extras.getCoins && `you get ${extras.getCoins} coins`].filter(Boolean).join(' · ')}. Pickups are this season's free adds; a spare one is worth more to a GM who's out of them than to you.</div>}
                    <button className="btn-primary w-full" disabled={busy || give.size + get.size + givePicks.size + getPicks.size + extrasN === 0 || myDrops.size !== needDrops} onClick={propose}>{countering && countering.from_team === partner ? 'Send counter-offer to' : 'Send offer to'} {team(partner)?.name}</button>
                    {give.size > 0 && get.size === 0 && getPicks.size + extras.getPk + extras.getCoins > 0 && <div className="text-center text-[11px] text-mute">Players for picks, pickups or coins, nothing back: that works. Their roster has to have room, or they'll name a drop when they accept.</div>}
                  </>
                )}
              </>
            )}

            {mode === 'multi' && me && (
              <>
                <div className="text-xs text-mute">Pick two or more GMs. Tick any asset on any team, then choose where it goes. Every GM has to accept before the commish reviews it.</div>
                <div className="scroll-x flex gap-1.5">
                  {teams.filter((t) => t.id !== me.id).map((t) => {
                    const on = parties.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => { const n = on ? parties.filter((x) => x !== t.id) : [...parties, t.id]; setParties(n); setMitems(mitems.filter((i) => [me.id, ...n].includes(i.from) && [me.id, ...n].includes(i.to))); }}
                        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${on ? 'border-white bg-white text-ice' : 'border-line bg-boards'}`}>
                        <TeamBadge team={t} size={20} />{t.gm_name}{on && ' ✓'}
                      </button>
                    );
                  })}
                </div>
                {parties.length >= 2 && (
                  <>
                    <ScoutBar s={scout} />
                    {posBar}
                    {compareList.length > 0 && <TradeCompare moving={compareList.map((p) => ({ p, to: ownerOf(p.id) }))} title="Side by side" showTo={false} onClear={() => setCompare(new Set())} />}
                    <div className={`grid gap-3 ${allParties.length > 2 ? 'lg:grid-cols-3 sm:grid-cols-2' : 'sm:grid-cols-2'}`}>
                      {allParties.map((tid) => {
                        const a = assets(tid);
                        const Dest = (k: 'player_id' | 'pick_id', id: number) => {
                          const it = mitem(tid, k, id)!;
                          return (
                            <select className="shrink-0 rounded-lg border border-white/10 bg-black/40 px-1 py-0.5 text-[11px]" value={it.to} onClick={(e) => e.preventDefault()} onChange={(e) => setDest(it, Number(e.target.value))}>
                              {allParties.filter((o) => o !== tid).map((o) => <option key={o} value={o}>→ {team(o)?.abbrev}</option>)}
                            </select>
                          );
                        };
                        return (
                          <div key={tid} className="min-w-0">
                            <div className="label mb-1 flex items-center gap-1.5"><TeamBadge team={team(tid)} size={16} />{tid === me.id ? 'You send' : `${team(tid)?.gm_name} sends`}</div>
                            {assetList({ tid, players: a.players, picks: a.picks, isOn: (k, id) => !!mitem(tid, k, id), onFlip: (k, id) => toggleM(tid, k, id), dest: Dest })}
                          </div>
                        );
                      })}
                    </div>
                    {mitems.length > 0 && (
                      <div className={`grid gap-2 rounded-xl border border-white/10 bg-black/25 p-2.5 text-xs ${allParties.length > 2 ? 'sm:grid-cols-3' : 'grid-cols-2'}`}>
                        {allParties.map((tid) => (
                          <div key={tid} className="min-w-0">
                            <div className="label mb-1">{tid === me.id ? 'You' : team(tid)?.gm_name} get{tid === me.id ? '' : 's'}</div>
                            {mitems.filter((i) => i.to === tid).map((i, n) => <div key={n} className="truncate">{i.player_id ? <span className="font-semibold">{players.get(i.player_id)?.name}</span> : <span className="text-gold">📋 {(() => { const k = picks.find((x) => x.id === i.pick_id); return k ? `${k.season} R${k.round}` : 'pick'; })()}</span>} <span className="text-mute">from {team(i.from)?.abbrev}</span></div>)}
                            {mitems.filter((i) => i.to === tid).length === 0 && <div className="text-mute">Nothing yet</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {dropBox}
                    <TradeAnalysis sides={multiSides} />
                    <input className="input" placeholder="Sweeten it with a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn-primary w-full" disabled={busy || mitems.length === 0 || !allParties.every((t) => mitems.some((i) => i.from === t || i.to === t)) || myDrops.size !== needDropsM} onClick={proposeMulti}>
                      Send {allParties.length}-team offer to {parties.map((t) => team(t)?.gm_name).join(' and ')}
                    </button>
                    {!allParties.every((t) => mitems.some((i) => i.from === t || i.to === t)) && mitems.length > 0 && <div className="text-center text-[11px] text-amber-200">Every team in the deal has to send or receive something.</div>}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Section>

      {groups.league.length > 0 && (
        <Section title="Around the league" right={<span className="text-xs text-mute">every open offer, graded</span>}>
          <div className="space-y-2">{groups.league.map((t) => <Fragment key={t.id}>{tradeCard(t)}</Fragment>)}</div>
        </Section>
      )}

      {groups.outgoing.length > 0 && (
        <Section title="Your pending offers">
          <div className="space-y-2">{groups.outgoing.map((t) => (
            <Fragment key={t.id}>{tradeCard(t, <>
              {t.from_team === me?.id ? <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('cancel_trade', { p_trade: t.id }); load(); }, 'Offer withdrawn')}>Withdraw</button>
                : <span className="text-xs text-mute">You accepted. Waiting on {partiesOf(t).filter((p) => !(t.accepted_by ?? []).includes(p)).map((p) => team(p)?.gm_name).join(', ')}.</span>}
            </>)}</Fragment>
          ))}</div>
        </Section>
      )}

      <Section title="Trade history">
        {groups.done.length === 0 ? <div className="card"><Empty icon="🤝" title="No trades yet">The league wants trades. Go make one.</Empty></div>
          : <div className="space-y-2">{groups.done.map((t) => <Fragment key={t.id}>{tradeCard(t)}</Fragment>)}</div>}
      </Section>
    </div>
    </PlayerInfoProvider>
  );
}
