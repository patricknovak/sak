import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { Section, TeamBadge, useAction } from '../components/ui';
import { ScoringEditor } from '../components/ScoringEditor';

// datetime-local <-> ISO in the viewer's zone
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function Commish() {
  const { me, league, teams, team, draft, picks, players, owner, refresh } = useLeague();
  const { busy, run: runRaw } = useAction();
  const run = (fn: () => Promise<unknown>, ok?: string) => runRaw(async () => { await fn(); await refresh(['draft', 'picks', 'league', 'rosters', 'teams']); }, ok);
  const [s, setS] = useState({ keeper_deadline: '', draft_at: '', pick_seconds: 90, draft_rounds: 18, snake: true, trade_deadline: '', max_acquisitions: 10, keepers: 6, top_scorer_rule: true, phase: 'keepers' });
  const [note, setNote] = useState('');
  const [order, setOrder] = useState<number[]>([]);
  const [pw, setPw] = useState({ team: '', pw: '' });
  const [fine, setFine] = useState({ team: '', kind: 'fine', amount: '', desc: '' });
  const [mv, setMv] = useState({ q: '', player: 0, team: '' });
  const [pickEdit, setPickEdit] = useState({ pick: '', team: '' });
  const [coin, setCoin] = useState({ team: '', amount: '', reason: '' });

  useEffect(() => {
    if (!league) return;
    setS({
      keeper_deadline: toLocal(league.keeper_deadline), draft_at: toLocal(league.draft_at), pick_seconds: league.pick_seconds,
      draft_rounds: league.draft_rounds, snake: league.snake, trade_deadline: toLocal(league.trade_deadline),
      max_acquisitions: league.max_acquisitions, keepers: league.keepers, top_scorer_rule: league.top_scorer_rule, phase: league.phase,
    });
    setNote(league.commish_note ?? '');
  }, [league?.updated_at, league?.phase]); // draft reset/undo change the phase without touching updated_at

  const seasonPicks = useMemo(() => picks.filter((p) => p.season === draft?.season), [picks, draft]);
  // key on the actual order so a re-randomize shows up here before anyone taps "Save this order"
  const r1 = seasonPicks.filter((p) => p.round === 1 && p.overall).sort((a, b) => a.overall! - b.overall!).map((p) => p.original_team);
  const r1Key = r1.join(',');
  useEffect(() => {
    setOrder(r1.length ? r1 : teams.map((t) => t.id));
  }, [r1Key, teams.length]);

  if (!me?.is_commish) return <div className="card p-6 text-center text-sm text-mute">Commissioner only. Nice try. 🤡</div>;

  const save = () => run(async () => {
    await rpc('commish_update_league', { p: {
      keeper_deadline: fromLocal(s.keeper_deadline), draft_at: fromLocal(s.draft_at), pick_seconds: s.pick_seconds,
      draft_rounds: s.draft_rounds, snake: s.snake, trade_deadline: fromLocal(s.trade_deadline),
      max_acquisitions: s.max_acquisitions, keepers: s.keepers, top_scorer_rule: s.top_scorer_rule, phase: s.phase,
    } });
    await refresh(['league']);
  }, 'League settings saved');

  const moveOrder = (i: number, d: number) => {
    const n = [...order]; const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]]; setOrder(n);
  };
  const matches = mv.q.length > 1 ? [...players.values()].filter((p) => p.name.toLowerCase().includes(mv.q.toLowerCase())).slice(0, 8) : [];
  const status = draft?.status;

  return (
    <div className="space-y-5">
      <div><h1 className="h-display text-2xl">🛠️ Commissioner</h1><p className="text-sm text-mute">With great power comes great responsibility, {me.gm_name}.</p></div>

      <Section title="📣 Announcement">
        <div className="card space-y-2 p-3">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shows on everyone’s home screen and posts to Trash Talk" />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('commish_update_league', { p: { commish_note: note || null } }); await refresh(['league']); }, 'Announcement posted')}>Post</button>
            <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('commish_update_league', { p: { commish_note: null } }); setNote(''); await refresh(['league']); }, 'Cleared')}>Clear</button>
          </div>
        </div>
      </Section>

      <Section title="🔒 Keepers">
        <div className="card space-y-3 p-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {teams.map((t) => <div key={t.id} className="flex items-center gap-2 rounded-lg bg-boards/60 px-2 py-1.5 text-sm"><TeamBadge team={t} size={20} />{t.gm_name}<span className="ml-auto">{t.keepers_submitted ? '✅' : '⏳'}</span></div>)}
          </div>
          <button className="btn-primary" disabled={busy || league?.phase !== 'keepers'}
            onClick={() => confirm('Finalize keepers? Non-kept players are released to the draft pool and teams that haven’t submitted get their best eligible players. This can’t be undone.') && run(async () => { await rpc('finalize_keepers'); await refresh(); }, 'Keepers finalized 📋')}>
            Finalize keepers & release everyone else
          </button>
          {league?.phase !== 'keepers' && <div className="text-xs text-mute">Keepers are final.</div>}
        </div>
      </Section>

      <Section title="📋 Draft">
        <div className="card space-y-3 p-3">
          <div className="text-sm">Status: <span className="font-semibold">{status}</span>{draft?.order_set ? ' · order set' : ' · order not set'}</div>
          <div className="label">Draft order (round 1{league?.snake ? ', snakes back' : ''})</div>
          <div className="space-y-1">
            {order.map((t, i) => (
              <div key={t} className="flex items-center gap-2 rounded-lg bg-boards/60 px-2 py-1.5 text-sm">
                <span className="w-5 font-display text-lg text-mute">{i + 1}</span><TeamBadge team={team(t)} size={20} /><span className="flex-1">{team(t)?.name}</span>
                <button className="btn-ghost btn-sm" onClick={() => moveOrder(i, -1)}>↑</button><button className="btn-ghost btn-sm" onClick={() => moveOrder(i, 1)}>↓</button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" disabled={busy || status === 'live' || status === 'paused'} onClick={() => run(() => rpc('draft_set_order', { p_order: order }), 'Order saved')}>Save this order</button>
            <button className="btn-ghost" disabled={busy || status === 'live' || status === 'paused'} onClick={() => confirm('Randomize?') && run(() => rpc('draft_randomize_order'), 'Randomized 🎲')}>🎲 Randomize</button>
            <button className="btn-primary" disabled={busy || !draft?.order_set || status === 'live' || league?.phase === 'keepers'} onClick={() => confirm('Start the draft?') && run(() => rpc('draft_start'), 'Draft is live')}>🟢 Start draft</button>
            {status === 'live' && <button className="btn-ghost" onClick={() => run(() => rpc('draft_pause'))}>⏸ Pause</button>}
            {status === 'paused' && <button className="btn-ghost" onClick={() => run(() => rpc('draft_resume'))}>▶️ Resume</button>}
            <button className="btn-ghost" disabled={busy} onClick={() => confirm('Undo the last pick?') && run(() => rpc('draft_undo'), 'Undone')}>↩️ Undo last pick</button>
            <button className="btn-ghost text-red-300" disabled={busy} onClick={() => confirm('RESET the whole draft board? All drafted players go back to the pool (keepers stay). Use for mock drafts.') && run(async () => { await rpc('draft_reset'); await refresh(); }, 'Draft reset')}>🔄 Reset draft (mock)</button>
          </div>
          <div className="label pt-2">Traded pick: reassign owner</div>
          <div className="flex flex-wrap gap-2">
            <select className="input w-auto" value={pickEdit.pick} onChange={(e) => setPickEdit({ ...pickEdit, pick: e.target.value })}>
              <option value="">Pick…</option>
              {seasonPicks.filter((p) => !p.player_id).sort((a, b) => (a.overall ?? 999) - (b.overall ?? 999) || a.round - b.round).map((p) => (
                <option key={p.id} value={p.id}>{p.overall ? `#${p.overall} ` : ''}R{p.round} · orig {team(p.original_team)?.abbrev} · now {team(p.team_id)?.abbrev}</option>
              ))}
            </select>
            <select className="input w-auto" value={pickEdit.team} onChange={(e) => setPickEdit({ ...pickEdit, team: e.target.value })}>
              <option value="">New owner…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button className="btn-ghost" disabled={!pickEdit.pick || !pickEdit.team} onClick={() => run(async () => { await rpc('commish_set_pick_owner', { p_pick: Number(pickEdit.pick), p_team: Number(pickEdit.team) }); await refresh(['picks']); }, 'Pick reassigned')}>Save</button>
          </div>
          {seasonPicks.length === 0 && <p className="text-xs text-mute">Picks are created when you save or randomize the order.</p>}
        </div>
      </Section>

      <Section title="📐 Scoring settings">
        <ScoringEditor />
      </Section>

      <Section title="⚙️ League settings">
        <div className="card grid gap-3 p-3 sm:grid-cols-2">
          <label className="text-xs text-mute">Phase
            <select className="input mt-1" value={s.phase} onChange={(e) => setS({ ...s, phase: e.target.value })}>
              {['keepers', 'predraft', 'draft', 'season', 'offseason'].map((p) => <option key={p}>{p}</option>)}
            </select></label>
          <label className="text-xs text-mute">Keeper deadline<input type="datetime-local" className="input mt-1" value={s.keeper_deadline} onChange={(e) => setS({ ...s, keeper_deadline: e.target.value })} /></label>
          <label className="text-xs text-mute">Draft time<input type="datetime-local" className="input mt-1" value={s.draft_at} onChange={(e) => setS({ ...s, draft_at: e.target.value })} /></label>
          <label className="text-xs text-mute">Trade deadline<input type="datetime-local" className="input mt-1" value={s.trade_deadline} onChange={(e) => setS({ ...s, trade_deadline: e.target.value })} /></label>
          <label className="text-xs text-mute">Seconds per pick<input type="number" className="input mt-1" value={s.pick_seconds} onChange={(e) => setS({ ...s, pick_seconds: Number(e.target.value) })} /></label>
          <label className="text-xs text-mute">Draft rounds<input type="number" className="input mt-1" value={s.draft_rounds} onChange={(e) => setS({ ...s, draft_rounds: Number(e.target.value) })} /></label>
          <label className="text-xs text-mute">Keepers per team<input type="number" className="input mt-1" value={s.keepers} onChange={(e) => setS({ ...s, keepers: Number(e.target.value) })} /></label>
          <label className="text-xs text-mute">Free pickups<input type="number" className="input mt-1" value={s.max_acquisitions} onChange={(e) => setS({ ...s, max_acquisitions: Number(e.target.value) })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.snake} onChange={(e) => setS({ ...s, snake: e.target.checked })} className="h-4 w-4 accent-sky-400" />Snake draft</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={s.top_scorer_rule} onChange={(e) => setS({ ...s, top_scorer_rule: e.target.checked })} className="h-4 w-4 accent-sky-400" />Top scorer can’t be kept</label>
          <div className="sm:col-span-2"><button className="btn-primary" disabled={busy} onClick={save}>Save settings</button>
            <span className="ml-2 text-xs text-mute">Times shown in your time zone. Draft currently {league?.draft_at ? fmtDateTime(league.draft_at) : 'unscheduled'}.</span></div>
        </div>
      </Section>

      <Section title="🔁 Roster moves">
        <div className="card space-y-2 p-3">
          <input className="input" placeholder="Find a player" value={mv.q} onChange={(e) => setMv({ ...mv, q: e.target.value, player: 0 })} />
          {matches.length > 0 && !mv.player && (
            <div className="divide-y divide-line rounded-xl border border-line">
              {matches.map((p) => <button key={p.id} className="flex w-full justify-between px-3 py-1.5 text-left text-sm" onClick={() => setMv({ ...mv, player: p.id, q: p.name })}>
                <span>{p.name} · {p.nhl_team}</span><span className="text-mute">{team(owner.get(p.id)?.team_id)?.abbrev ?? 'FA'}</span></button>)}
            </div>
          )}
          <div className="flex gap-2">
            <select className="input" value={mv.team} onChange={(e) => setMv({ ...mv, team: e.target.value })}>
              <option value="">→ Free agency</option>{teams.map((t) => <option key={t.id} value={t.id}>→ {t.name}</option>)}
            </select>
            <button className="btn-primary shrink-0" disabled={!mv.player || busy} onClick={() => run(async () => { await rpc('commish_move_player', { p_player: mv.player, p_team: mv.team ? Number(mv.team) : null, p_slot: 'BN' }); setMv({ q: '', player: 0, team: '' }); await refresh(['rosters']); }, 'Moved')}>Move</button>
          </div>
        </div>
      </Section>

      <Section title="💸 Fines & fees">
        <div className="card grid gap-2 p-3 sm:grid-cols-[1fr_120px_110px]">
          <select className="input" value={fine.team} onChange={(e) => setFine({ ...fine, team: e.target.value })}>
            <option value="">Team…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input" value={fine.kind} onChange={(e) => setFine({ ...fine, kind: e.target.value })}>
            {['fine', 'entry', 'sak', 'acq_fee', 'prize', 'other'].map((k) => <option key={k}>{k}</option>)}
          </select>
          <input className="input" inputMode="decimal" placeholder="$" value={fine.amount} onChange={(e) => setFine({ ...fine, amount: e.target.value })} />
          <input className="input sm:col-span-3" placeholder="e.g. Marchand 2-game suspension (Get SaK'ed)" value={fine.desc} onChange={(e) => setFine({ ...fine, desc: e.target.value })} />
          <button className="btn-primary sm:col-span-3" disabled={!fine.team || !fine.amount || !fine.desc || busy}
            onClick={() => run(async () => { await rpc('commish_ledger', { p_team: Number(fine.team), p_kind: fine.kind, p_amount: Number(fine.amount), p_desc: fine.desc }); setFine({ team: '', kind: 'fine', amount: '', desc: '' }); }, 'Added to the ledger')}>Add to ledger</button>
          <p className="text-xs text-mute sm:col-span-3">Fines are announced in Trash Talk. Mark items paid on the League → Money page.</p>
        </div>
      </Section>

      <Section title="☘️ St. Patrick coins">
        <div className="card grid gap-2 p-3 sm:grid-cols-[1fr_120px]">
          <select className="input" value={coin.team} onChange={(e) => setCoin({ ...coin, team: e.target.value })}>
            <option value="">Team…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input className="input" inputMode="numeric" placeholder="± coins" value={coin.amount} onChange={(e) => setCoin({ ...coin, amount: e.target.value.replace(/[^\d-]/g, '') })} />
          <input className="input sm:col-span-2" placeholder="Reason (e.g. Best trash talk of the week)" value={coin.reason} onChange={(e) => setCoin({ ...coin, reason: e.target.value })} />
          <button className="btn-primary sm:col-span-2" disabled={!coin.team || !Number(coin.amount) || !coin.reason || busy}
            onClick={() => run(async () => { await rpc('commish_coins', { p_team: Number(coin.team), p_amount: Number(coin.amount), p_reason: coin.reason }); setCoin({ team: '', amount: '', reason: '' }); }, 'Coins sent ☘️')}>Award / dock coins</button>
        </div>
      </Section>

      <Section title="🔑 Reset a GM’s password">
        <div className="card flex flex-wrap gap-2 p-3">
          <select className="input w-auto" value={pw.team} onChange={(e) => setPw({ ...pw, team: e.target.value })}>
            <option value="">GM…</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.gm_name} ({t.name})</option>)}
          </select>
          <input className="input w-auto flex-1" placeholder="New password (6+ chars)" value={pw.pw} onChange={(e) => setPw({ ...pw, pw: e.target.value })} />
          <button className="btn-primary" disabled={!pw.team || pw.pw.length < 6 || busy} onClick={() => run(async () => { await rpc('commish_reset_password', { p_team: Number(pw.team), p_password: pw.pw }); setPw({ team: '', pw: '' }); }, 'Password reset. Send it to them privately.')}>Reset</button>
        </div>
      </Section>
    </div>
  );
}
