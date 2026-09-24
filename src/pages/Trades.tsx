import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { Trade } from '../lib/types';
import { ago, fmtDateTime, fmtPts } from '../lib/format';
import { PlayerRow } from '../components/PlayerCard';
import { Empty, Section, TeamBadge, TeamName, useAction, PageHeader } from '../components/ui';
import { Repeat2 } from 'lucide-react';

export default function Trades() {
  const { me, teams, team, rosters, players, picks, league, season } = useLeague();
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const { busy, run } = useAction();
  const [trades, setTrades] = useState<Trade[]>([]);
  const partner = params.get('with') ? Number(params.get('with')) : null;
  const [give, setGive] = useState<Set<number>>(new Set());
  const ids = (k: string) => (params.get(k) ?? '').split(',').filter(Boolean).map(Number);
  const [get, setGet] = useState<Set<number>>(new Set(ids('get')));
  const [givePicks, setGivePicks] = useState<Set<number>>(new Set());
  const [getPicks, setGetPicks] = useState<Set<number>>(new Set(ids('getPicks')));
  const [note, setNote] = useState('');

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

  const propose = () => run(async () => {
    await rpc('propose_trade', { p_to: partner, p_give: [...give], p_get: [...get], p_give_picks: [...givePicks], p_get_picks: [...getPicks], p_note: note || null });
    setGive(new Set()); setGet(new Set()); setGivePicks(new Set()); setGetPicks(new Set()); setNote(''); setParams({});
    load();
  }, 'Trade offer sent 📨');

  const describe = (t: Trade, side: number) => (t.trade_items ?? []).filter((i) => i.from_team === side).map((i) => {
    if (i.player_id) return players.get(i.player_id)?.name ?? 'Player';
    const pk = picks.find((p) => p.id === i.pick_id);
    return pk ? `${pk.season} R${pk.round} pick${pk.original_team !== side ? ` (via ${team(pk.original_team)?.abbrev})` : ''}` : 'Pick';
  });

  const groups = useMemo(() => ({
    incoming: trades.filter((t) => t.status === 'proposed' && t.to_team === me?.id),
    outgoing: trades.filter((t) => t.status === 'proposed' && t.from_team === me?.id),
    review: trades.filter((t) => t.status === 'accepted'),
    done: trades.filter((t) => !['proposed', 'accepted'].includes(t.status)),
  }), [trades, me]);

  const TradeCard = ({ t, children }: { t: Trade; children?: React.ReactNode }) => (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-mute">
        <span>#{t.id} · {ago(t.created_at, now)}</span>
        <span className={`chip ${t.status === 'approved' ? 'text-emerald-300' : ['vetoed', 'declined', 'failed'].includes(t.status) ? 'text-red-300' : ''}`}>{t.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[t.from_team, t.to_team].map((side) => (
          <div key={side}>
            <div className="mb-1 flex items-center gap-1.5 text-sm"><TeamBadge team={team(side)} size={20} /><TeamName link team={team(side)} className="truncate" /></div>
            <div className="text-xs text-mute">sends</div>
            <ul className="text-sm">{describe(t, side).map((d) => <li key={d}>• {d}</li>)}{describe(t, side).length === 0 && <li className="text-mute">nothing</li>}</ul>
          </div>
        ))}
      </div>
      {t.note && <p className="mt-2 rounded-lg bg-boards px-2 py-1 text-xs italic">“{t.note}”</p>}
      {t.review_note && <p className="mt-1 text-xs text-mute">Commish: {t.review_note}</p>}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader icon={<Repeat2 size={22} className="text-blue" />} title="Trades" sub={<>Deadline {league?.trade_deadline ? fmtDateTime(league.trade_deadline) : 'TBD'}</>} />

      {groups.incoming.length > 0 && (
        <Section title="Offers for you">
          <div className="space-y-2">{groups.incoming.map((t) => (
            <TradeCard key={t.id} t={t}>
              <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: true }); load(); }, 'Accepted! Off to the commish.')}>Accept</button>
              <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('respond_trade', { p_trade: t.id, p_accept: false }); load(); }, 'Declined')}>Decline</button>
              <button className="btn-ghost" onClick={() => { setParams({ with: String(t.from_team) }); setGet(new Set()); setGetPicks(new Set()); }}>Counter</button>
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

      <Section title="Propose a trade">
        {pastDeadline ? <div className="card p-4 text-sm text-mute">The trade deadline has passed. See you in the offseason.</div> : (
          <div className="card space-y-3 p-3">
            <div className="scroll-x flex gap-1.5">
              {teams.filter((t) => t.id !== me?.id).map((t) => (
                <button key={t.id} onClick={() => { setParams({ with: String(t.id) }); setGet(new Set()); setGetPicks(new Set()); }}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${partner === t.id ? 'border-white bg-white text-ice' : 'border-line bg-boards'}`}>
                  <TeamBadge team={t} size={20} />{t.gm_name}
                </button>
              ))}
            </div>
            {partner && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[{ label: 'You send', a: mine, sel: give, set: setGive, psel: givePicks, pset: setGivePicks },
                    { label: `${team(partner)?.gm_name} sends`, a: theirs, sel: get, set: setGet, psel: getPicks, pset: setGetPicks }].map((col) => (
                    <div key={col.label}>
                      <div className="label mb-1 flex justify-between"><span>{col.label}</span><span>{fmtPts(valueOf(col.sel), 0)} pts value</span></div>
                      <div className="max-h-80 divide-y divide-white/[.06] overflow-y-auto rounded-xl border border-line">
                        {col.a.players.map((p) => (
                          <label key={p.id} className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 ${col.sel.has(p.id) ? 'bg-sky-500/15' : ''}`}>
                            <input type="checkbox" checked={col.sel.has(p.id)} onChange={() => flip(col.sel, col.set, p.id)} className="h-4 w-4 accent-sky-400" />
                            <div className="min-w-0 flex-1"><PlayerRow p={p} /></div>
                          </label>
                        ))}
                        {col.a.picks.map((pk) => (
                          <label key={`pk${pk.id}`} className={`flex cursor-pointer items-center gap-2 px-2 py-2 text-sm ${col.psel.has(pk.id) ? 'bg-sky-500/15' : ''}`}>
                            <input type="checkbox" checked={col.psel.has(pk.id)} onChange={() => flip(col.psel, col.pset, pk.id)} className="h-4 w-4 accent-sky-400" />
                            📋 {pk.season} round {pk.round} pick{pk.original_team !== pk.team_id ? ` (via ${team(pk.original_team)?.abbrev})` : ''}{pk.overall ? ` · #${pk.overall}` : ''}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {give.size + get.size + givePicks.size + getPicks.size > 0 && (
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-black/25 p-2.5 text-xs">
                    {[{ who: 'You send', ps: give, ks: givePicks }, { who: `${team(partner)?.gm_name} sends`, ps: get, ks: getPicks }].map((side) => (
                      <div key={side.who}>
                        <div className="label mb-1">{side.who}</div>
                        {[...side.ps].map((id) => <div key={id} className="truncate font-semibold">{players.get(id)?.name}</div>)}
                        {[...side.ks].map((id) => { const k = picks.find((x) => x.id === id); return k ? <div key={`k${id}`} className="truncate text-gold">📋 {k.season} R{k.round}{k.original_team !== k.team_id ? ` (via ${team(k.original_team)?.abbrev})` : ''}</div> : null; })}
                        {side.ps.size + side.ks.size === 0 && <div className="text-mute">Nothing yet</div>}
                      </div>
                    ))}
                  </div>
                )}
                <input className="input" placeholder="Sweeten it with a message (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn-primary w-full" disabled={busy || give.size + get.size + givePicks.size + getPicks.size === 0} onClick={propose}>Send offer to {team(partner)?.name}</button>
              </>
            )}
          </div>
        )}
      </Section>

      {groups.outgoing.length > 0 && (
        <Section title="Your pending offers">
          <div className="space-y-2">{groups.outgoing.map((t) => (
            <TradeCard key={t.id} t={t}>
              <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('cancel_trade', { p_trade: t.id }); load(); }, 'Offer withdrawn')}>Withdraw</button>
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
