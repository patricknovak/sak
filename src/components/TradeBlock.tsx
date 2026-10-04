// The trade block: every GM can post who they'd move, the positions they want and what they'll give. Posts are
// announced in the league chat and visible to everyone, and each one has a win-win search built in: deals with
// that GM that use only the players they listed and give them the positions they asked for.
import { useEffect, useMemo, useState } from 'react';
import { useLeague, useSport } from '../lib/store';
import { positionKeys } from '../lib/sport';
import { rpc, realtimeChannel, supabase } from '../lib/supabase';
import type { Player, TradeBlock as TB } from '../lib/types';
import { ago, fmtPts } from '../lib/format';
import { evaluateSide, findTrades, type Suggestion } from '../lib/trade';
import { SuggestionRow, useTradeValuer, type BuildSpec } from './TradeTools';
import { Headshot, Pos, TeamBadge, useAction } from './ui';
import { Megaphone } from 'lucide-react';

const fits = (p: Player, wants: string[]) => wants.includes(p.pos) || p.elig.some((e) => wants.includes(e));

export function TradeBlock({ onBuild }: { onBuild: (b: BuildSpec) => void }) {
  const { me, teams, players, rosters } = useLeague();
  const POS = positionKeys(useSport());
  const { v, rosterMax, rosterOf, sched } = useTradeValuer();
  const { busy, run } = useAction();
  const [rows, setRows] = useState<TB[]>([]);
  const load = () => supabase.from('trade_block').select('*').order('updated_at', { ascending: false }).then(({ data }) => setRows((data ?? []) as TB[]));
  useEffect(() => {
    load();
    const ch = realtimeChannel('trade-block').on('postgres_changes', { event: '*', schema: 'public', table: 'trade_block' }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  const mineRow = rows.find((r) => r.team_id === me?.id);
  const others = rows.filter((r) => r.team_id !== me?.id && teams.some((t) => t.id === r.team_id));
  const my = me ? rosterOf(me.id).sort((a, b) => v.player(b) - v.player(a)) : [];

  // editor state starts from what's posted
  const [offer, setOffer] = useState<Set<number>>(new Set());
  const [wants, setWants] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [picksOk, setPicksOk] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setOffer(new Set(mineRow?.offering ?? [])); setWants(new Set(mineRow?.wants ?? []));
    setNote(mineRow?.offer_note ?? ''); setPicksOk(!!mineRow?.picks);
  }, [mineRow?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  // where you rank at each position: a hint for what to ask for
  const weak = useMemo(() => {
    if (!me || !my.length) return [];
    const all = teams.map((t) => evaluateSide({ team: t.id, before: rosterOf(t.id), after: rosterOf(t.id), picksIn: [], picksOut: [] }, v, rosterMax));
    const e = all.find((a) => a.team === me.id);
    if (!e) return [];
    return e.pos.map((p) => ({ pos: p.pos, rank: all.filter((a) => (a.pos.find((x) => x.pos === p.pos)?.before ?? 0) > p.before).length + 1 })).sort((a, b) => b.rank - a.rank);
  }, [me?.id, rosters, teams.length, v]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (announce: boolean) => run(async () => {
    await rpc('set_trade_block', { p_offering: [...offer], p_wants: [...wants], p_note: note || null, p_picks: picksOk, p_announce: announce });
    setEditing(false); load();
  }, announce ? 'Posted to the block and announced in chat 📣' : 'Trade block saved');
  const clear = () => run(async () => { await rpc('set_trade_block', { p_offering: [], p_wants: [], p_note: null }); setEditing(false); load(); }, 'Off the block');

  const flip = <T,>(s: Set<T>, set: (x: Set<T>) => void, x: T) => { const n = new Set(s); n.has(x) ? n.delete(x) : n.add(x); set(n); };

  return (
    <div className="space-y-2">
      {/* your post */}
      {me && me.role !== 'spectator' && (
        <div className="card space-y-2 p-3">
          <div className="flex items-center gap-2">
            <Megaphone size={16} className="text-gold" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Your trade block</div>
              <div className="text-xs text-mute">{mineRow ? `Posted ${ago(mineRow.updated_at)}. Everyone can see it.` : 'Tell the league who you would move and what you need. It goes out in chat, and the trade finder uses it to match you with GMs who fit.'}</div>
            </div>
            {!editing && <button className="btn-ghost btn-sm" onClick={() => setEditing(true)}>{mineRow ? 'Edit' : 'Post'}</button>}
          </div>
          {!editing && mineRow && <BlockSummary row={mineRow} />}
          {editing && (
            <div className="space-y-2">
              <div>
                <div className="label mb-1">Players available</div>
                <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto">
                  {my.map((p) => (
                    <button key={p.id} onClick={() => flip(offer, setOffer, p.id)} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${offer.has(p.id) ? 'border-gold bg-gold/15 text-gold' : 'border-white/10 bg-white/[.03] text-slate-300'}`}>
                      {p.name} <span className="text-mute">{p.elig.join('/')} · {fmtPts(v.player(p), 0)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1">Looking for {weak[0] && <span className="font-normal normal-case text-mute">· your thinnest spots: {weak.slice(0, 2).map((w) => `${w.pos} (#${w.rank} of ${teams.length})`).join(', ')}</span>}</div>
                <div className="flex flex-wrap gap-1">
                  {POS.map((p) => <button key={p} onClick={() => flip(wants, setWants, p)} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${wants.has(p) ? 'border-sky-300 bg-sky-500/20 text-sky-100' : 'border-white/10 bg-white/[.03] text-mute'}`}>{p}</button>)}
                  <label className="ml-2 flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4 accent-emerald-400" checked={picksOk} onChange={(e) => setPicksOk(e.target.checked)} />Will move draft picks</label>
                </div>
              </div>
              <textarea className="input min-h-[60px]" maxLength={280} placeholder="What you're willing to give, in your words (e.g. two forwards for a top-four D, or a pick to move up)" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button className="btn-gold btn-sm" disabled={busy || (!offer.size && !wants.size && !note.trim())} onClick={() => save(true)}>Post and announce</button>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => save(false)}>Save quietly</button>
                {mineRow && <button className="btn-ghost btn-sm text-red-300" disabled={busy} onClick={clear}>Take me off the block</button>}
                <button className="btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* everyone else's */}
      {others.length === 0
        ? <div className="rounded-xl border border-dashed border-white/10 p-3 text-center text-xs text-mute">Nobody else is on the block yet. Be the first: posts go out in chat.</div>
        : others.map((r) => <BlockCard key={r.team_id} row={r} myRow={mineRow} onBuild={onBuild} sched={sched} />)}
      {players.size === 0 && <div className="text-xs text-mute">Loading players…</div>}
      <p className="px-1 text-[11px] text-mute">Posts drop players who get traded or dropped. "Find a win-win" searches deals with that GM using only the players they listed, and giving them the positions they asked for, re-checked on the real schedule so both lineups get better.</p>
    </div>
  );
}

function BlockSummary({ row }: { row: TB }) {
  const { players } = useLeague();
  const offered = row.offering.map((id) => players.get(id)).filter((p): p is Player => !!p);
  return (
    <div className="space-y-1 text-sm">
      {offered.length > 0 && <div className="flex flex-wrap items-center gap-1"><span className="text-xs text-mute">Available:</span>{offered.map((p) => <span key={p.id} className="flex items-center gap-1 rounded-full bg-white/[.06] px-2 py-0.5 text-xs"><Headshot p={p} size={16} />{p.name}<span className="text-mute">{p.elig.join('/')}</span></span>)}</div>}
      {(row.wants.length > 0 || row.picks) && <div className="flex flex-wrap items-center gap-1"><span className="text-xs text-mute">Looking for:</span>{row.wants.map((w) => <Pos key={w} p={w} />)}{row.picks && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-200">will move picks</span>}</div>}
      {row.offer_note && <div className="text-xs italic text-slate-300">“{row.offer_note}”</div>}
    </div>
  );
}

function BlockCard({ row, myRow, onBuild, sched }: { row: TB; myRow?: TB; onBuild: (b: BuildSpec) => void; sched: ReturnType<typeof useTradeValuer>['sched'] }) {
  const { me, team, players } = useLeague();
  const { v, rosterMax, rosterOf, ctxOf } = useTradeValuer();
  const [res, setRes] = useState<Suggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const t = team(row.team_id);
  const my = me ? rosterOf(me.id) : [];
  const offered = new Set(row.offering);
  // quick matches: what you have that they want, and what they have that you want
  const iHave = row.wants.length ? my.filter((p) => fits(p, row.wants)).sort((a, b) => v.player(b) - v.player(a)).slice(0, 3) : [];
  const theyHave = myRow?.wants.length ? row.offering.map((id) => players.get(id)).filter((p): p is Player => !!p && fits(p, myRow.wants)) : [];
  const search = () => {
    if (!me) return;
    setBusy(true);
    setTimeout(() => {
      const only = (s: { give: Player[]; get: Player[] }) =>
        (!offered.size || s.get.every((p) => offered.has(p.id))) && (!row.wants.length || s.give.some((p) => fits(p, row.wants)));
      setRes(findTrades(ctxOf(me.id), [ctxOf(row.team_id)], v, rosterMax, { limit: 6, winWin: true, sched, only, top: 18 }));
      setBusy(false);
    }, 30);
  };
  return (
    <div className="card space-y-2 p-3">
      <div className="flex items-center gap-2">
        <TeamBadge team={t} size={26} />
        <div className="min-w-0 flex-1"><div className="font-semibold">{t?.gm_name} <span className="font-normal text-mute">· {t?.name}</span></div><div className="text-[11px] text-mute">on the block {ago(row.updated_at)}</div></div>
        {me && me.role !== 'spectator' && <button className="btn-gold btn-sm" disabled={busy} onClick={search}>{busy ? 'Thinking…' : 'Find a win-win'}</button>}
      </div>
      <BlockSummary row={row} />
      {(iHave.length > 0 || theyHave.length > 0) && (
        <div className="rounded-lg bg-sky-500/[.07] px-2 py-1.5 text-xs text-sky-100">
          {iHave.length > 0 && <div>You have what they want: {iHave.map((p) => `${p.name} (${p.elig.join('/')})`).join(', ')}.</div>}
          {theyHave.length > 0 && <div>They're offering what you want: {theyHave.map((p) => `${p.name} (${p.elig.join('/')})`).join(', ')}.</div>}
        </div>
      )}
      {res && res.length === 0 && <div className="rounded-lg bg-white/[.04] p-2 text-xs text-mute">No deal makes both lineups better within what {t?.gm_name} listed. Build one by hand and read the grades, or message them.</div>}
      {res && res.length > 0 && (
        <div className="divide-y divide-white/[.06] overflow-hidden rounded-xl border border-white/[.08]">
          {res.map((s, i) => <SuggestionRow key={i} s={s} onBuild={onBuild} />)}
        </div>
      )}
    </div>
  );
}
