import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { DraftPick, Player, Trade } from '../lib/types';
import { ago, fmtDateTime, fmtPts } from '../lib/format';
import { PlayerRow } from '../components/PlayerCard';
import { Empty, Section, TeamBadge, TeamName, useAction, PageHeader } from '../components/ui';
import { TradeAnalysis, TradeFinder } from '../components/TradeTools';
import type { Side } from '../lib/trade';
import { Repeat2 } from 'lucide-react';

// a multi-team builder line: one asset, where it comes from and where it goes
type MItem = { from: number; to: number; player_id?: number; pick_id?: number };

export default function Trades() {
  const { me, teams, team, rosters, players, picks, league, season } = useLeague();
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
  const [mode, setMode] = useState<'two' | 'multi'>(params.get('multi') ? 'multi' : 'two');
  const [parties, setParties] = useState<number[]>([]);
  const [mitems, setMitems] = useState<MItem[]>([]);
  useEffect(() => { setGive(new Set(ids('give'))); setGet(new Set(ids('get'))); setGivePicks(new Set(ids('givePicks'))); setGetPicks(new Set(ids('getPicks'))); }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const propose = () => run(async () => {
    await rpc('propose_trade', { p_to: partner, p_give: [...give], p_get: [...get], p_give_picks: [...givePicks], p_get_picks: [...getPicks], p_note: note || null });
    setGive(new Set()); setGet(new Set()); setGivePicks(new Set()); setGetPicks(new Set()); setNote(''); setParams({});
    load();
  }, 'Trade offer sent 📨');
  const proposeMulti = () => run(async () => {
    await rpc('propose_multi_trade', { p_items: mitems, p_note: note || null });
    setMitems([]); setParties([]); setNote('');
    load();
  }, 'Multi-team offer sent 📨');

  // analysis inputs for the two-team builder
  const twoSides: Side[] = useMemo(() => {
    if (!me || !partner) return [];
    const pk = (ids: Set<number>) => picks.filter((k) => ids.has(k.id));
    const myAfter = [...mine.players.filter((p) => !give.has(p.id)), ...theirs.players.filter((p) => get.has(p.id))];
    const theirAfter = [...theirs.players.filter((p) => !get.has(p.id)), ...mine.players.filter((p) => give.has(p.id))];
    return [
      { team: me.id, before: mine.players, after: myAfter, picksOut: pk(givePicks), picksIn: pk(getPicks) },
      { team: partner, before: theirs.players, after: theirAfter, picksOut: pk(getPicks), picksIn: pk(givePicks) },
    ];
  }, [me, partner, mine.players, theirs.players, give, get, givePicks, getPicks, picks]);

  // multi-team: everyone involved, and each roster after the deal
  const allParties = me ? [me.id, ...parties] : [];
  const multiSides: Side[] = useMemo(() => allParties.map((t) => {
    const before = assets(t).players;
    const out = new Set(mitems.filter((i) => i.from === t && i.player_id).map((i) => i.player_id!));
    const inn = mitems.filter((i) => i.to === t && i.player_id).map((i) => players.get(i.player_id!)).filter((p): p is Player => !!p);
    return { team: t, before, after: [...before.filter((p) => !out.has(p.id)), ...inn],
      picksOut: picks.filter((k) => mitems.some((i) => i.from === t && i.pick_id === k.id)), picksIn: picks.filter((k) => mitems.some((i) => i.to === t && i.pick_id === k.id)) };
  }), [allParties.join(','), mitems, rosters, players, picks]); // eslint-disable-line react-hooks/exhaustive-deps
  const mitem = (from: number, key: 'player_id' | 'pick_id', id: number) => mitems.find((i) => i.from === from && i[key] === id);
  const toggleM = (from: number, key: 'player_id' | 'pick_id', id: number) => {
    const cur = mitem(from, key, id);
    if (cur) setMitems(mitems.filter((i) => i !== cur));
    else setMitems([...mitems, { from, to: allParties.find((t) => t !== from)!, [key]: id }]);
  };
  const setDest = (item: MItem, to: number) => setMitems(mitems.map((i) => (i === item ? { ...i, to } : i)));

  const describe = (t: Trade, side: number, to?: number) => (t.trade_items ?? []).filter((i) => i.from_team === side && (to == null || i.to_team === to)).map((i) => {
    if (i.player_id) return players.get(i.player_id)?.name ?? 'Player';
    const pk = picks.find((p) => p.id === i.pick_id);
    return pk ? `${pk.season} R${pk.round} pick${pk.original_team !== side ? ` (via ${team(pk.original_team)?.abbrev})` : ''}` : 'Pick';
  });
  const partiesOf = (t: Trade) => t.parties ?? [t.from_team, t.to_team];
  const canRespond = (t: Trade) => !!me && t.status === 'proposed' && (t.parties ? partiesOf(t).includes(me.id) && t.from_team !== me.id && !(t.accepted_by ?? []).includes(me.id) : t.to_team === me.id);

  const groups = useMemo(() => ({
    incoming: trades.filter((t) => canRespond(t)),
    outgoing: trades.filter((t) => t.status === 'proposed' && !canRespond(t) && !!me && partiesOf(t).includes(me.id)),
    review: trades.filter((t) => t.status === 'accepted'),
    done: trades.filter((t) => !['proposed', 'accepted'].includes(t.status)),
  }), [trades, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const TradeCard = ({ t, children }: { t: Trade; children?: React.ReactNode }) => {
    const ps = partiesOf(t);
    return (
      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between text-xs text-mute">
          <span>#{t.id} · {ago(t.created_at, now)}{t.parties && <> · {t.parties.length}-team trade</>}</span>
          <span className={`chip ${t.status === 'approved' ? 'text-emerald-300' : ['vetoed', 'declined', 'failed'].includes(t.status) ? 'text-red-300' : ''}`}>{t.status}</span>
        </div>
        <div className={`grid gap-3 ${ps.length > 2 ? 'sm:grid-cols-3' : 'grid-cols-2'}`}>
          {ps.map((side) => (
            <div key={side}>
              <div className="mb-1 flex items-center gap-1.5 text-sm"><TeamBadge team={team(side)} size={20} /><TeamName link team={team(side)} className="truncate" />
                {t.parties && t.status === 'proposed' && <span className="ml-auto text-xs" title={(t.accepted_by ?? []).includes(side) ? 'Accepted' : 'Waiting'}>{(t.accepted_by ?? []).includes(side) ? '✅' : '⏳'}</span>}</div>
              <div className="text-xs text-mute">sends</div>
              {t.parties ? (
                <ul className="text-sm">{ps.filter((o) => o !== side).flatMap((o) => describe(t, side, o).map((d) => <li key={o + d}>• {d} <span className="text-mute">→ {team(o)?.abbrev}</span></li>))}{describe(t, side).length === 0 && <li className="text-mute">nothing</li>}</ul>
              ) : (
                <ul className="text-sm">{describe(t, side).map((d) => <li key={d}>• {d}</li>)}{describe(t, side).length === 0 && <li className="text-mute">nothing</li>}</ul>
              )}
            </div>
          ))}
        </div>
        {t.note && <p className="mt-2 rounded-lg bg-boards px-2 py-1 text-xs italic">“{t.note}”</p>}
        {t.review_note && <p className="mt-1 text-xs text-mute">Commish: {t.review_note}</p>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    );
  };

  const buildFromFinder = (p: number, g: Player[], r: Player[]) => {
    setMode('two');
    setParams({ with: String(p), give: g.map((x) => x.id).join(','), get: r.map((x) => x.id).join(',') });
    document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const AssetList = ({ tid, players: ps, picks: ks, isOn, onFlip, dest }: { tid: number; players: Player[]; picks: DraftPick[]; isOn: (k: 'player_id' | 'pick_id', id: number) => boolean; onFlip: (k: 'player_id' | 'pick_id', id: number) => void; dest?: (k: 'player_id' | 'pick_id', id: number) => React.ReactNode }) => (
    <div className="max-h-80 divide-y divide-white/[.06] overflow-y-auto rounded-xl border border-line">
      {ps.map((p) => (
        <label key={p.id} className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${isOn('player_id', p.id) ? 'bg-sky-500/15' : ''}`}>
          <input type="checkbox" checked={isOn('player_id', p.id)} onChange={() => onFlip('player_id', p.id)} className="h-4 w-4 accent-sky-400" />
          <div className="min-w-0 flex-1"><PlayerRow p={p} /></div>
          <span className="num shrink-0 text-xs text-mute">{fmtPts(p.proj, 0)}</span>
          {isOn('player_id', p.id) && dest?.('player_id', p.id)}
        </label>
      ))}
      {ks.map((k) => (
        <label key={`pk${k.id}`} className={`flex cursor-pointer items-center gap-2 px-2 py-2 text-sm ${isOn('pick_id', k.id) ? 'bg-sky-500/15' : ''}`}>
          <input type="checkbox" checked={isOn('pick_id', k.id)} onChange={() => onFlip('pick_id', k.id)} className="h-4 w-4 accent-sky-400" />
          <span className="flex-1">📋 {pickLabel(k, tid)}</span>
          {isOn('pick_id', k.id) && dest?.('pick_id', k.id)}
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={<Repeat2 size={22} className="text-blue" />} title="Trades" sub={<>Deadline {league?.trade_deadline ? fmtDateTime(league.trade_deadline) : 'TBD'}</>} />

      {groups.incoming.length > 0 && (
        <Section title="Offers for you">
          <div className="space-y-2">{groups.incoming.map((t) => (
            <TradeCard key={t.id} t={t}>
              <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: true }); load(); }, t.parties ? 'Accepted. Waiting on the others.' : 'Accepted! Off to the commish.')}>Accept</button>
              <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: false }); load(); }, 'Declined')}>Decline</button>
              {!t.parties && <button className="btn-ghost" onClick={() => { setMode('two'); setParams({ with: String(t.from_team) }); }}>Counter</button>}
            </TradeCard>
          ))}</div>
        </Section>
      )}

      {groups.review.length > 0 && (
        <Section title="Awaiting commissioner review">
          <div className="space-y-2">{groups.review.map((t) => (
            <TradeCard key={t.id} t={t}>
              {me?.is_commish ? (
                <>
                  <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('review_trade', { p_trade: t.id, p_approve: true, p_note: null }); load(); }, 'Trade approved')}>✅ Approve</button>
                  <button className="btn-ghost text-red-300" disabled={busy} onClick={() => { const n = prompt('Reason for veto?'); if (n !== null) run(async () => { await rpc('review_trade', { p_trade: t.id, p_approve: false, p_note: n }); load(); }, 'Trade vetoed'); }}>🚫 Veto</button>
                </>
              ) : <span className="text-xs text-mute">Auto-approves {league?.trade_review_hours ?? 24}h after acceptance unless the commish steps in.</span>}
            </TradeCard>
          ))}</div>
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
                {partner && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[{ label: 'You send', tid: me!.id, a: mine, sel: give, set: setGive, psel: givePicks, pset: setGivePicks },
                        { label: `${team(partner)?.gm_name} sends`, tid: partner, a: theirs, sel: get, set: setGet, psel: getPicks, pset: setGetPicks }].map((col) => (
                        <div key={col.label}>
                          <div className="label mb-1 flex justify-between"><span>{col.label}</span><span>{fmtPts(valueOf(col.sel), 0)} pts value</span></div>
                          <AssetList tid={col.tid} players={col.a.players} picks={col.a.picks}
                            isOn={(k, id) => (k === 'player_id' ? col.sel.has(id) : col.psel.has(id))}
                            onFlip={(k, id) => (k === 'player_id' ? flip(col.sel, col.set, id) : flip(col.psel, col.pset, id))} />
                        </div>
                      ))}
                    </div>
                    <TradeAnalysis sides={twoSides} />
                    <input className="input" placeholder="Sweeten it with a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn-primary w-full" disabled={busy || give.size + get.size + givePicks.size + getPicks.size === 0} onClick={propose}>Send offer to {team(partner)?.name}</button>
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
                          <div key={tid}>
                            <div className="label mb-1 flex items-center gap-1.5"><TeamBadge team={team(tid)} size={16} />{tid === me.id ? 'You send' : `${team(tid)?.gm_name} sends`}</div>
                            <AssetList tid={tid} players={a.players} picks={a.picks} isOn={(k, id) => !!mitem(tid, k, id)} onFlip={(k, id) => toggleM(tid, k, id)} dest={Dest} />
                          </div>
                        );
                      })}
                    </div>
                    {mitems.length > 0 && (
                      <div className={`grid gap-2 rounded-xl border border-white/10 bg-black/25 p-2.5 text-xs ${allParties.length > 2 ? 'sm:grid-cols-3' : 'grid-cols-2'}`}>
                        {allParties.map((tid) => (
                          <div key={tid}>
                            <div className="label mb-1">{tid === me.id ? 'You' : team(tid)?.gm_name} get{tid === me.id ? '' : 's'}</div>
                            {mitems.filter((i) => i.to === tid).map((i, n) => <div key={n} className="truncate">{i.player_id ? <span className="font-semibold">{players.get(i.player_id)?.name}</span> : <span className="text-gold">📋 {(() => { const k = picks.find((x) => x.id === i.pick_id); return k ? `${k.season} R${k.round}` : 'pick'; })()}</span>} <span className="text-mute">from {team(i.from)?.abbrev}</span></div>)}
                            {mitems.filter((i) => i.to === tid).length === 0 && <div className="text-mute">Nothing yet</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    <TradeAnalysis sides={multiSides} />
                    <input className="input" placeholder="Sweeten it with a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn-primary w-full" disabled={busy || mitems.length === 0 || !allParties.every((t) => mitems.some((i) => i.from === t || i.to === t))} onClick={proposeMulti}>
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

      {groups.outgoing.length > 0 && (
        <Section title="Your pending offers">
          <div className="space-y-2">{groups.outgoing.map((t) => (
            <TradeCard key={t.id} t={t}>
              {t.from_team === me?.id ? <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('cancel_trade', { p_trade: t.id }); load(); }, 'Offer withdrawn')}>Withdraw</button>
                : <span className="text-xs text-mute">You accepted. Waiting on {partiesOf(t).filter((p) => !(t.accepted_by ?? []).includes(p)).map((p) => team(p)?.gm_name).join(', ')}.</span>}
            </TradeCard>
          ))}</div>
        </Section>
      )}

      <Section title="Trade history">
        {groups.done.length === 0 ? <div className="card"><Empty icon="🤝" title="No trades yet">The league wants trades. Go make one.</Empty></div>
          : <div className="space-y-2">{groups.done.map((t) => <TradeCard key={t.id} t={t} />)}</div>}
      </Section>
    </div>
  );
}
