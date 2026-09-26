// The draft list: the full order of every pick for the coming draft (who owns it, where it came from), each
// team's keepers at the end, a place for GMs to flag anything wrong before draft night, and the commissioner's
// tools to fix it: reorder the teams, move a pick to another team, switch snake on or off.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ClipboardList, Pencil } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { ago, fmtDateTime, ordinal } from '../lib/format';
import { SEASONS, FRANCHISE_OF, type GM } from '../data/history';
import { PlayerRow } from '../components/PlayerCard';
import { PageHeader, Section, TeamBadge, TeamName, Toggle, useAction } from '../components/ui';
import type { DraftPick } from '../lib/types';

type Comment = { id: number; feature_key: string; team_id: number; body: string; created_at: string };
const KEY = 'draft-list';

export default function DraftList() {
  const { me, league, teams, team, players, rosters, picks, draft, refresh } = useLeague();
  const { busy, run } = useAction();
  const season = draft?.season ?? league?.season ?? '';
  const gms = useMemo(() => teams.filter((t) => t.role !== 'spectator'), [teams]);
  const mine = useMemo(() => picks.filter((p) => p.season === season).sort((a, b) => (a.overall ?? 9999) - (b.overall ?? 9999) || a.round - b.round), [picks, season]);
  const rounds = league?.draft_rounds ?? 18;
  const n = Math.max(1, gms.length);
  const orderSet = !!draft?.order_set && mine.some((p) => p.overall);
  // the order the commissioner set, read back from round 1 (overall is per original team)
  const order = useMemo(() => orderSet ? mine.filter((p) => p.round === 1).sort((a, b) => a.overall! - b.overall!).map((p) => p.original_team) : [], [mine, orderSet]);
  // last season's finish, for the "why this order" line
  const last = SEASONS[0];
  const finish = useMemo(() => { const m = new Map<number, number>(); last?.rows.forEach((r, i) => { const t = FRANCHISE_OF[r.gm as GM]; if (t && !m.has(t)) m.set(t, i + 1); }); return m; }, [last]);
  const byRound = useMemo(() => { const m = new Map<number, DraftPick[]>(); for (const p of mine) m.set(p.round, [...(m.get(p.round) ?? []), p]); return m; }, [mine]);
  const traded = mine.filter((p) => p.team_id !== p.original_team);
  const keepersFinal = league?.phase !== 'keepers';

  // ───── review comments
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const loadComments = useCallback(async () => { const { data } = await supabase.from('feature_comments').select('*').eq('feature_key', KEY).order('id'); setComments((data ?? []) as Comment[]); }, []);
  useEffect(() => { loadComments(); }, [loadComments]);
  const post = () => run(async () => {
    const body = text.trim(); if (!body || !me) return;
    const { error } = await supabase.from('feature_comments').insert({ feature_key: KEY, team_id: me.id, body });
    if (error) throw error;
    setText(''); await loadComments();
  }, 'Posted. The commish will see it.');
  const remove = (c: Comment) => run(async () => { if (!confirm('Delete this comment?')) return; const { error } = await supabase.from('feature_comments').delete().eq('id', c.id); if (error) throw error; await loadComments(); });

  // ───── commissioner tools
  const [edit, setEdit] = useState(false);
  const [newOrder, setNewOrder] = useState<number[]>([]);
  useEffect(() => { setNewOrder(order.length ? order : gms.map((t) => t.id)); }, [order.join(), gms.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (i: number, d: -1 | 1) => { const o = [...newOrder]; const j = i + d; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; setNewOrder(o); };
  const saveOrder = () => confirm('Set this draft order? Every pick’s number is recalculated.') && run(async () => { await rpc('draft_set_order', { p_order: newOrder }); await refresh(['picks', 'draft']); }, 'Draft order set');
  const setOwner = (p: DraftPick, teamId: number) => {
    const note = prompt(`Why is the ${season} round ${p.round} pick (originally ${team(p.original_team)?.name}) moving to ${team(teamId)?.name}? (shown on the list)`, p.note ?? '');
    if (note === null) return;
    run(async () => { await rpc('commish_set_pick_owner', { p_pick: p.id, p_team: teamId, p_note: note }); await refresh(['picks']); }, 'Pick moved');
  };
  const setSnake = (v: boolean) => run(async () => { await rpc('commish_update_league', { p: { snake: v } }); await refresh(['league']); if (orderSet) { await rpc('draft_set_order', { p_order: order }); await refresh(['picks', 'draft']); } }, v ? 'Snake draft on' : 'Straight order, every round');
  const live = draft?.status === 'live' || draft?.status === 'paused';

  return (
    <div className="space-y-5">
      <PageHeader icon={<ClipboardList size={22} className="text-gold" />} title="Draft list"
        sub={<span>{season} · {rounds} rounds, {n} teams, {league?.snake ? 'snake: the order flips every other round' : 'no snake: the same order every round'}{league?.draft_at ? ` · ${fmtDateTime(league.draft_at)}` : ''}</span>}
        right={<Link to="/draft" className="btn btn-sm">Draft room →</Link>} />

      <div className="card space-y-2 p-3 text-sm">
        <p><b>How the order works.</b> Pick 1 goes to last place in {last?.season}, pick 2 to second-last, and so on up to the champion at pick {n}. {league?.snake ? 'Even rounds run in reverse.' : 'Every round runs in that same order.'} Picks traded last season are shown with who they came from. Look it over and post a comment below if anything is off; the commish can fix it before the draft.</p>
        {!orderSet && <p className="text-amber-200">The commissioner hasn’t set the order yet.</p>}
        {orderSet && (
          <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {order.map((t, i) => (
              <li key={t} className="flex items-center gap-2 rounded-xl bg-white/[.04] px-2.5 py-2">
                <span className="num w-5 text-center font-display text-lg font-extrabold text-gold">{i + 1}</span>
                <TeamBadge team={team(t)} size={26} />
                <span className="min-w-0 flex-1"><TeamName team={team(t)} className="block truncate text-sm font-semibold" /><span className="block text-[11px] text-mute">{team(t)?.gm_name}{finish.get(t) ? ` · ${ordinal(finish.get(t)!)} in ${last?.season}` : ''}</span></span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {me?.is_commish && (
        <Section title="👑 Commissioner tools">
          <div className="card space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Toggle on={!!league?.snake} onChange={setSnake} label={<span>Snake draft <span className="text-xs text-mute">(off = the same order every round)</span></span>} />
              <Toggle on={edit} onChange={setEdit} label={<span>Fix pick owners <span className="text-xs text-mute">(shows a team picker on every pick below)</span></span>} />
            </div>
            <div>
              <div className="label mb-1">Draft order</div>
              <div className="grid gap-1 sm:grid-cols-2">
                {newOrder.map((t, i) => (
                  <div key={t} className="flex items-center gap-2 rounded-lg bg-white/[.04] px-2 py-1 text-sm">
                    <span className="num w-5 text-center text-mute">{i + 1}</span><TeamBadge team={team(t)} size={20} /><span className="min-w-0 flex-1 truncate">{team(t)?.name}</span>
                    <button className="btn btn-sm px-1.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp size={14} /></button>
                    <button className="btn btn-sm px-1.5" onClick={() => move(i, 1)} disabled={i === newOrder.length - 1} aria-label="Move down"><ArrowDown size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className="btn-primary btn-sm" disabled={busy || live || newOrder.join() === order.join()} onClick={saveOrder}>Set this order</button>
                <button className="btn btn-sm" disabled={busy} onClick={() => setNewOrder([...gms].sort((a, b) => (finish.get(b.id) ?? 0) - (finish.get(a.id) ?? 0)).map((t) => t.id))}>Reverse of {last?.season} standings</button>
                {live && <span className="text-xs text-amber-200">The draft is in progress, so the order is locked.</span>}
              </div>
            </div>
          </div>
        </Section>
      )}

      {traded.length > 0 && (
        <Section title={`Picks that changed hands (${traded.length})`}>
          <div className="card divide-y divide-white/[.06] text-sm">
            {[...traded].sort((a, b) => a.round - b.round || (a.overall ?? 0) - (b.overall ?? 0)).map((p) => (
              <div key={p.id} className="flex items-start gap-2 px-3 py-2">
                <span className="num w-14 shrink-0 text-mute">R{p.round}{p.overall ? ` · #${p.overall}` : ''}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5"><TeamBadge team={team(p.original_team)} size={18} /><span className="text-mute">{team(p.original_team)?.abbrev}</span><span className="text-mute">→</span><TeamBadge team={team(p.team_id)} size={18} /><b className="truncate">{team(p.team_id)?.name}</b></span>
                  {p.note && <span className="block text-[11px] text-mute">{p.note}</span>}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Every pick, in order">
        <div className="space-y-3">
          {Array.from({ length: rounds }, (_, i) => i + 1).map((r) => {
            const ps = (byRound.get(r) ?? []).slice().sort((a, b) => (a.overall ?? 9999) - (b.overall ?? 9999) || a.original_team - b.original_team);
            return (
              <div key={r} className="card overflow-hidden">
                <div className="flex items-center justify-between bg-white/[.04] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-mute"><span>Round {r}</span><span>{orderSet && ps[0]?.overall ? `#${ps[0].overall}–${ps[ps.length - 1].overall}` : ''}</span></div>
                <div className="divide-y divide-white/[.06]">
                  {ps.map((p, i) => {
                    const pl = p.player_id ? players.get(p.player_id) : null;
                    const via = p.team_id !== p.original_team;
                    return (
                      <div key={p.id} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${p.team_id === me?.id ? 'bg-sky-500/[.07]' : ''}`}>
                        <span className="num w-12 shrink-0 text-mute">{r}.{orderSet ? ((p.overall ?? 0) - 1) % n + 1 : i + 1}{p.overall ? <span className="block text-[10px]">#{p.overall}</span> : null}</span>
                        <TeamBadge team={team(p.team_id)} size={22} />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-semibold">{team(p.team_id)?.name}</span>
                          {via && <span className="ml-1 rounded bg-amber-400/15 px-1 text-[10px] font-semibold text-amber-200" title={p.note ?? ''}>via {team(p.original_team)?.abbrev}</span>}
                          {pl && <span className="block truncate text-xs text-emerald-200">✓ {pl.name} · {pl.nhl_team} {pl.pos}</span>}
                        </span>
                        {me?.is_commish && edit && !p.player_id && (
                          <select className="input w-auto py-1 text-xs" value={p.team_id} onChange={(e) => setOwner(p, Number(e.target.value))} aria-label={`Owner of round ${r} pick from ${team(p.original_team)?.abbrev}`}>
                            {gms.map((t) => <option key={t.id} value={t.id}>{t.abbrev}{t.id === p.original_team ? ' (original)' : ''}</option>)}
                          </select>
                        )}
                        {me?.is_commish && !edit && via && <Pencil size={12} className="shrink-0 text-mute" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Keepers (rounds 19–24)">
        <p className="mb-2 px-1 text-xs text-mute">Each team keeps up to {league?.keepers ?? 6} from last season; they fill the roster after the {rounds} drafted rounds.{keepersFinal ? '' : ' Picks are secret until the commish finalizes them, so for now this only shows who has submitted.'}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {gms.map((t) => {
            const ks = rosters.filter((r) => r.team_id === t.id && (keepersFinal ? r.acquired === 'keeper' : false)).map((r) => players.get(r.player_id)!).filter(Boolean).sort((a, b) => b.proj - a.proj);
            return (
              <div key={t.id} className="card p-3">
                <div className="mb-1.5 flex items-center gap-2"><TeamBadge team={t} size={24} /><TeamName team={t} link className="font-semibold" /><span className="ml-auto text-xs text-mute">{t.gm_name}</span></div>
                {keepersFinal
                  ? (ks.length ? <div className="space-y-1.5">{ks.map((p) => <PlayerRow key={p.id} p={p} />)}</div> : <div className="text-xs text-mute">No keepers</div>)
                  : <div className="text-sm">{t.keepers_submitted ? '✅ Keepers submitted' : '⏳ Not submitted yet'}</div>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`Does this look right? (${comments.length})`}>
        <div className="card p-3">
          <div className="space-y-2">
            {comments.length === 0 && <div className="text-sm text-mute">No comments yet. If a pick or the order looks wrong, say so here.</div>}
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 text-sm">
                <TeamBadge team={team(c.team_id)} size={24} />
                <div className="min-w-0 flex-1"><span className="font-semibold">{team(c.team_id)?.gm_name}</span> <span className="text-[11px] text-mute">{ago(c.created_at)}</span><div className="whitespace-pre-wrap">{c.body}</div></div>
                {(c.team_id === me?.id || me?.is_commish) && <button className="text-xs text-mute" onClick={() => remove(c)}>Delete</button>}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input className="input flex-1" placeholder="Something wrong? A pick, a trade, the order…" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') post(); }} />
            <button className="btn-primary" disabled={busy || !text.trim()} onClick={post}>Post</button>
          </div>
        </div>
      </Section>
    </div>
  );
}
