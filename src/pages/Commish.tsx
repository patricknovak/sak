import { useEffect, useMemo, useState } from 'react';
import { HealthPanel } from '../components/HealthPanel';
import { XFeedSettings } from '../components/XFeedSettings';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { fmtDateTime } from '../lib/format';
import { Section, TeamBadge, Toggle, useAction, PageHeader } from '../components/ui';
import { bannedTopScorers } from '../lib/keepers';
import { fmtPts } from '../lib/format';
import { Wrench } from 'lucide-react';
import { MoneySettings } from '../components/MoneySettings';
import { LeagueFeatures } from '../components/LeagueFeatures';
import { hasFeature } from '../lib/features';
import { ScoringEditor } from '../components/ScoringEditor';
import { GarryShaper } from '../components/GarryShaper';
import { useBrand } from '../lib/brand';
import { Link } from 'react-router-dom';
import { LeagueIdentity } from '../components/LeagueIdentity';
import { SetupGuide } from '../components/SetupGuide';
import { SeatManager } from '../components/SeatManager';

// datetime-local <-> ISO in the viewer's zone
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

export default function Commish() {
  const { me, league, teams, spectators, team, draft, picks, players, owner, refresh } = useLeague();
  const brand = useBrand();
  const { busy, run: runRaw } = useAction();
  const run = (fn: () => Promise<unknown>, ok?: string) => runRaw(async () => { await fn(); await refresh(['draft', 'picks', 'league', 'rosters', 'teams']); }, ok);
  const [s, setS] = useState({ keeper_deadline: '', draft_at: '', pick_seconds: 90, draft_rounds: 18, snake: true, trade_deadline: '', max_acquisitions: 10, keepers: 6, top_scorer_rule: true, phase: 'keepers' });
  const [callUrl, setCallUrl] = useState<string>(() => (typeof league?.info?.call_url === 'string' ? league.info.call_url : ''));
  const [note, setNote] = useState('');
  const [order, setOrder] = useState<number[]>([]);
  const [pw, setPw] = useState({ team: '', pw: '' });
  const [fine, setFine] = useState({ team: '', kind: 'fine', amount: '', desc: '' });
  const [mv, setMv] = useState({ q: '', player: 0, team: '' });
  const [pickEdit, setPickEdit] = useState({ pick: '', team: '' });
  const [coin, setCoin] = useState({ team: '', amount: '', reason: '' });
  const [spec, setSpec] = useState({ name: '', email: '', pw: '', color: '#64748b', emoji: '🍿' });
  // the platform owner also gets the running-costs dashboard
  const [platformAdmin, setPlatformAdmin] = useState(false);
  useEffect(() => { rpc<boolean>('is_platform_admin').then(setPlatformAdmin, () => {}); }, []);

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
      <PageHeader icon={<Wrench size={22} className="text-gold" />} title="Commissioner" sub={`With great power comes great responsibility, ${me.gm_name}.`} />

      <HealthPanel />

      {platformAdmin && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Link to="/platform" className="card flex items-center gap-3 p-3 text-sm hover:bg-white/[.06]">
            <span className="text-xl">🌐</span>
            <span className="flex-1"><span className="font-semibold">Platform</span><span className="block text-xs text-mute">Every league on Super Pools, and opening the next one</span></span>
            <span className="text-mute">›</span>
          </Link>
          <Link to="/costs" className="card flex items-center gap-3 p-3 text-sm hover:bg-white/[.06]">
            <span className="text-xl">🧾</span>
            <span className="flex-1"><span className="font-semibold">Running costs</span><span className="block text-xs text-mute">What SaK and Super Pools cost to run, by day, month, feature and league</span></span>
            <span className="text-mute">›</span>
          </Link>
        </div>
      )}

      <SetupGuide />

      <Section id="identity" title="🎨 League identity">
        <LeagueIdentity />
      </Section>

      <Section title="🎙️ Draft night call">
        <div className="card space-y-2 p-3 text-sm">
          <p className="text-xs text-mute">GMs get a voice & video room inside the draft page (built-in, no app needed). If the group would rather use its own call, paste the link here and the Join button goes there instead: Google Meet, FaceTime link, Discord, Zoom, anything.</p>
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="https://meet.google.com/… (leave empty for the built-in room)" value={callUrl} onChange={(e) => setCallUrl(e.target.value)} />
            <button className="btn-primary shrink-0" disabled={busy} onClick={() => run(async () => { const v = callUrl.trim(); await rpc('commish_update_league', { p: { info: { ...(league?.info ?? {}), call_url: v || null } } }); await refresh(['league']); }, callUrl.trim() ? 'Call link saved' : 'Using the built-in room')}>Save</button>
          </div>
        </div>
      </Section>

      <Section title="𝕏 Insiders feed">
        <XFeedSettings />
      </Section>

      <Section title="📣 Announcement">
        <div className="card space-y-2 p-3">
          <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Shows on everyone’s home screen and posts to Trash Talk" />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await rpc('commish_update_league', { p: { commish_note: note || null } }); await refresh(['league']); }, 'Announcement posted')}>Post</button>
            <button className="btn-ghost" disabled={busy} onClick={() => run(async () => { await rpc('commish_update_league', { p: { commish_note: null } }); setNote(''); await refresh(['league']); }, 'Cleared')}>Clear</button>
          </div>
        </div>
      </Section>

      <Section id="keepers" title="🔒 Keepers">
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
        {league?.phase === 'keepers' && <KeepersForTeam />}
      </Section>

      <Section id="draft" title="📋 Draft">
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

      <Section id="scoring" title="📐 Scoring settings">
        <ScoringEditor />
      </Section>

      <Section id="settings" title="⚙️ League settings">
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

      <Section title="💰 Money & the fund">
        <div className="space-y-3">
          <LeagueFeatures />
          {hasFeature(league, 'money') && <MoneySettings />}
        </div>
      </Section>

      <Section title="🔁 Roster moves">
        <div className="card space-y-2 p-3">
          <input className="input" placeholder="Find a player" value={mv.q} onChange={(e) => setMv({ ...mv, q: e.target.value, player: 0 })} />
          {matches.length > 0 && !mv.player && (
            <div className="divide-y divide-white/[.06] rounded-xl border border-line">
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
            {['fine', 'entry', 'sak', 'prize', 'other'].map((k) => <option key={k}>{k}</option>)}
          </select>
          <input className="input" inputMode="decimal" placeholder="$" value={fine.amount} onChange={(e) => setFine({ ...fine, amount: e.target.value })} />
          <input className="input sm:col-span-3" placeholder="e.g. Marchand 2-game suspension" value={fine.desc} onChange={(e) => setFine({ ...fine, desc: e.target.value })} />
          <button className="btn-primary sm:col-span-3" disabled={!fine.team || !fine.amount || !fine.desc || busy}
            onClick={() => run(async () => { await rpc('commish_ledger', { p_team: Number(fine.team), p_kind: fine.kind, p_amount: Number(fine.amount), p_desc: fine.desc }); setFine({ team: '', kind: 'fine', amount: '', desc: '' }); }, 'Added to the ledger')}>Add to ledger</button>
          <p className="text-xs text-mute sm:col-span-3">Fines are announced in Trash Talk. Mark items paid on the League → Money page.</p>
        </div>
      </Section>

      <Section title={`${brand.coin.emoji} ${brand.coin.name}`}>
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

      <Section title={`${brand.bot.emoji} Shape ${brand.bot.name}`}>
        <GarryShaper />
      </Section>

      <Section title="🛡️ Seats and commissioners">
        <SeatManager />
      </Section>

      <Section id="invites" title="📨 Invite links">
        <Invites />
      </Section>

      <Section title="✉️ Sign-in emails">
        <SignInEmails />
      </Section>

      <Section title="🔑 Reset a GM’s password">
        <div className="card flex flex-wrap gap-2 p-3">
          <select className="input w-auto" value={pw.team} onChange={(e) => setPw({ ...pw, team: e.target.value })}>
            <option value="">GM…</option>{[...teams, ...spectators].map((t) => <option key={t.id} value={t.id}>{t.gm_name} ({t.role === 'spectator' ? 'spectator' : t.name})</option>)}
          </select>
          <input className="input w-auto flex-1" placeholder="New password (6+ chars)" value={pw.pw} onChange={(e) => setPw({ ...pw, pw: e.target.value })} />
          <button className="btn-primary" disabled={!pw.team || pw.pw.length < 6 || busy} onClick={() => run(async () => { await rpc('commish_reset_password', { p_team: Number(pw.team), p_password: pw.pw }); setPw({ team: '', pw: '' }); }, 'Password reset. Send it to them privately.')}>Reset</button>
        </div>
      </Section>

      <Section title="🍿 Spectator passes">
        <p className="mb-2 px-1 text-xs text-mute">A spectator can see the whole league, chat, DM and bet St. Patrick coins, but has no team. Switch any of that off per person, or pause the pass entirely.</p>
        <div className="space-y-2">
          {spectators.map((t) => {
            const on = (k: string) => t.perms?.[k] !== false;
            const flip = (k: string, v: boolean) => run(async () => { await rpc('commish_set_spectator', { p_team: t.id, p_perms: { [k]: v } }); await refresh(['teams']); }, `${t.gm_name}: ${k} ${v ? 'on' : 'off'}`);
            return (
              <div key={t.id} className={`card p-3 ${on('active') ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-2"><TeamBadge team={t} size={28} /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{t.gm_name}</div><div className="truncate text-xs text-mute">{t.login_email}</div></div>
                  <Toggle on={on('active')} onChange={(v) => flip('active', v)} label={<span className="text-xs">{on('active') ? 'Active' : 'Paused'}</span>} /></div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {([['chat', '💬 Chat'], ['dm', '✉️ DMs'], ['bets', '🎲 Bets'], ['ideas', '💡 Ideas']] as const).map(([k, l]) => (
                    <Toggle key={k} on={on(k)} onChange={(v) => flip(k, v)} label={<span className="text-xs">{l}</span>} />
                  ))}
                </div>
              </div>
            );
          })}
          {spectators.length === 0 && <div className="card p-3 text-sm text-mute">No spectators yet.</div>}
          <div className="card grid gap-2 p-3 sm:grid-cols-2">
            <div className="text-sm font-semibold sm:col-span-2">Add a spectator</div>
            <input className="input" placeholder="Name (e.g. Dan Perra)" value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })} />
            <input className="input" type="email" placeholder="Login email" value={spec.email} onChange={(e) => setSpec({ ...spec, email: e.target.value })} />
            <input className="input" placeholder="Password (6+ characters)" value={spec.pw} onChange={(e) => setSpec({ ...spec, pw: e.target.value })} />
            <div className="flex gap-2"><input className="input w-20" placeholder="🍿" value={spec.emoji} onChange={(e) => setSpec({ ...spec, emoji: e.target.value })} /><input className="h-10 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent" type="color" value={spec.color} onChange={(e) => setSpec({ ...spec, color: e.target.value })} /></div>
            <button className="btn-primary sm:col-span-2" disabled={busy || spec.name.trim().length < 2 || !spec.email.includes('@') || spec.pw.length < 6}
              onClick={() => run(async () => { await rpc('commish_add_spectator', { p_name: spec.name.trim(), p_email: spec.email.trim(), p_password: spec.pw, p_color: spec.color, p_emoji: spec.emoji || '🍿' }); setSpec({ name: '', email: '', pw: '', color: '#64748b', emoji: '🍿' }); await refresh(['teams']); }, 'Spectator added. Send them the login privately.')}>Create spectator pass</button>
          </div>
        </div>
      </Section>
    </div>
  );
}

// Enter a GM's keepers for him: a GM whose phone or browser won't cooperate tells the commish his six
function KeepersForTeam() {
  const { league, teams, rosters, players, refresh } = useLeague();
  const { busy, run } = useAction();
  const [teamId, setTeamId] = useState(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const max = league?.keepers ?? 6;
  const banned = useMemo(() => bannedTopScorers(rosters, league?.top_scorer_rule), [rosters, league?.top_scorer_rule]);
  const roster = useMemo(() => rosters.filter((r) => r.team_id === teamId).map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p).sort((a, b) => (b.r.prev_fp ?? 0) - (a.r.prev_fp ?? 0)), [rosters, players, teamId]);
  useEffect(() => { setSel(new Set(roster.filter((x) => x.r.keeper).map((x) => x.p.id))); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: number) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else if (n.size < max) n.add(id); setSel(n); };
  return (
    <div className="card mt-3 space-y-2 p-3">
      <div className="text-sm font-semibold">Enter keepers for a GM</div>
      <p className="text-xs text-mute">For a GM who can’t get the Keepers page to work: pick his team, tick up to {max} (never his top scorer), save. He’s notified and can still change them himself until you finalize.</p>
      <select className="input" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
        <option value={0}>Choose a team…</option>
        {teams.filter((t) => t.role !== 'spectator').map((t) => <option key={t.id} value={t.id}>{t.name} · {t.gm_name}{t.keepers_submitted ? ' ✅' : ' ⏳'}</option>)}
      </select>
      {teamId > 0 && (
        <>
          <div className="max-h-80 divide-y divide-white/[.06] overflow-y-auto rounded-xl border border-white/[.08]">
            {roster.map(({ r, p }) => {
              const top = banned.has(p.id), on = sel.has(p.id);
              return (
                <label key={p.id} className={`flex items-center gap-2 px-2 py-1.5 text-sm ${top ? 'opacity-50' : ''} ${on ? 'bg-emerald-500/10' : ''}`}>
                  <input type="checkbox" className="h-4 w-4 accent-emerald-400" disabled={top} checked={on} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 flex-1 truncate">{p.name} <span className="text-mute">{p.nhl_team} {p.pos}{top ? ' · top scorer, can’t keep' : ''}</span></span>
                  <span className="num text-xs text-mute">{fmtPts(r.prev_fp)}</span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <span className="num text-sm font-bold">{sel.size}/{max}</span>
            <button className="btn-primary btn-sm ml-auto" disabled={busy || sel.size === 0} onClick={() => confirm(`Save these ${sel.size} keepers for ${teams.find((t) => t.id === teamId)?.gm_name}?`) && run(async () => { await rpc('commish_set_keepers', { p_team: teamId, p_players: [...sel] }); await refresh(['rosters', 'teams']); }, 'Keepers saved for that GM')}>Save for this GM</button>
          </div>
        </>
      )}
    </div>
  );
}

// Email sign-in, step 1: each GM's real email goes on their account here. The account, its password and any phone
// already signed in stay as they are; from then on the GM signs in with that email and the same password. A stand-in
// address (name@sakleague.app) is one no GM ever typed: those are the ones still to do.
interface Account { team_id: number; gm_name: string; team_name: string; role: string; login_email: string | null; stand_in: boolean; last_sign_in: string | null }
function SignInEmails() {
  const { teams } = useLeague();
  const { busy, run } = useAction();
  const [rows, setRows] = useState<Account[] | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const load = () => rpc<Account[]>('commish_accounts').then(setRows, () => setRows([]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows) return <div className="card p-3 text-sm text-mute">Loading…</div>;
  const todo = rows.filter((r) => r.stand_in).length;
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-mute">
        Put each GM&apos;s own email on their account. Nothing changes for anyone already signed in, and their password stays the same; next time
        they sign in, it&apos;s their email and that password. {todo ? <b className="text-slate-200">{todo} still on a stand-in address.</b> : <b className="text-emerald-300">Everyone has a real email.</b>}
      </p>
      {rows.map((r) => {
        const t = teams.find((x) => x.id === r.team_id);
        const v = draft[r.team_id] ?? '';
        return (
          <div key={r.team_id} className="card p-3">
            <div className="flex items-center gap-2">
              {t && <TeamBadge team={t} size={26} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.gm_name} <span className="text-xs font-normal text-mute">{r.role === 'spectator' ? 'spectator' : r.team_name}</span></div>
                <div className={`truncate text-xs ${r.stand_in ? 'text-amber-300' : 'text-emerald-300'}`}>{r.stand_in ? '⚠️ ' : '✓ '}{r.login_email}</div>
              </div>
              <div className="shrink-0 text-right text-[10px] text-mute">{r.last_sign_in ? `signed in ${fmtDateTime(r.last_sign_in)}` : 'never signed in'}</div>
            </div>
            <div className="mt-2 flex gap-2">
              <input className="input flex-1" type="email" inputMode="email" placeholder={r.stand_in ? 'Their email' : 'Change to…'} value={v}
                onChange={(e) => setDraft({ ...draft, [r.team_id]: e.target.value })} />
              <button className="btn-primary" disabled={busy || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())}
                onClick={() => run(async () => { await rpc('commish_set_login_email', { p_team: r.team_id, p_email: v.trim() }); setDraft({ ...draft, [r.team_id]: '' }); await load(); },
                  `${r.gm_name} signs in with ${v.trim().toLowerCase()} from now on`)}>Save</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Invite links: an open seat (a GM team with nobody signed in to it) or a spectator place. The link opens the join
// page, where someone new makes their account and someone with one signs in; either way they land in this league.
interface Invite { code: string; team_id: number | null; role: 'gm' | 'spectator'; created_at: string; expires_at: string; max_uses: number; uses: number; revoked: boolean }
function Invites() {
  const { teams } = useLeague();
  const { busy, run } = useAction();
  const [rows, setRows] = useState<Invite[]>([]);
  const [made, setMade] = useState<string | null>(null);
  const load = () => supabase.from('league_invites').select('code,team_id,role,created_at,expires_at,max_uses,uses,revoked').order('created_at', { ascending: false }).limit(20)
    .then(({ data }) => setRows((data ?? []) as Invite[]));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = teams.filter((t) => t.role === 'gm' && !t.user_id);
  const link = (code: string) => `${location.origin}${location.pathname}#/join/${code}`;
  const share = async (code: string) => {
    const url = link(code);
    try { if (navigator.share) { await navigator.share({ title: 'Join the league', url }); return; } } catch { /* fall back to copying */ }
    try { await navigator.clipboard.writeText(url); } catch { /* shown below to copy by hand */ }
  };
  const make = (team: number | null) => run(async () => {
    const code = await rpc<string>('create_invite', { p_team: team, p_role: team ? 'gm' : 'spectator', p_days: 14, p_uses: team ? 1 : 5 });
    setMade(code); await load(); await share(code);
  }, 'Invite link made and copied');
  const live = (i: Invite) => !i.revoked && i.uses < i.max_uses && new Date(i.expires_at).getTime() > Date.now();
  return (
    <div className="space-y-2">
      <p className="px-1 text-xs text-mute">Send someone a link and they join from their phone: new people make their account on the spot, people with one sign in. A seat link works once; a spectator link up to five times. Links last 14 days.</p>
      <div className="card space-y-2 p-3">
        {open.length ? open.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <TeamBadge team={t} size={26} /><div className="min-w-0 flex-1 truncate text-sm font-semibold">{t.name} <span className="text-xs font-normal text-mute">open seat</span></div>
            <button className="btn-primary btn-sm" disabled={busy} onClick={() => make(t.id)}>Invite a GM</button>
          </div>
        )) : <div className="text-sm text-mute">Every seat has a GM.</div>}
        <button className="btn-ghost w-full" disabled={busy} onClick={() => make(null)}>🍿 Make a spectator link</button>
        {made && <div className="break-all rounded-lg bg-black/30 px-2 py-1.5 text-xs text-sky-200">{link(made)}</div>}
      </div>
      {rows.length > 0 && (
        <div className="card divide-y divide-white/[.06]">
          {rows.map((i) => (
            <div key={i.code} className={`flex items-center gap-2 px-3 py-2 text-xs ${live(i) ? '' : 'opacity-50'}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-slate-200">{i.role === 'spectator' ? '🍿 Spectator' : teams.find((t) => t.id === i.team_id)?.name ?? 'Seat'}</div>
                <div className="text-mute">{i.revoked ? 'cancelled' : i.uses >= i.max_uses ? 'used' : new Date(i.expires_at).getTime() < Date.now() ? 'expired' : `${i.uses}/${i.max_uses} used · until ${fmtDateTime(i.expires_at)}`}</div>
              </div>
              {live(i) && <>
                <button className="btn-ghost btn-sm" onClick={() => share(i.code)}>Copy</button>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('revoke_invite', { p_code: i.code }); await load(); }, 'Invite cancelled')}>Cancel</button>
              </>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
