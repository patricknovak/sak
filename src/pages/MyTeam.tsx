import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { Player, Roster, Slot, Transaction } from '../lib/types';
import { ago, etToday, fmtPts, ordinal } from '../lib/format';
import { PlayerRow, PlayerSheet } from '../components/PlayerCard';
import { Pos, Section, TeamBadge, TeamName, Toggle, useAction } from '../components/ui';

const STARTERS: Slot[] = ['C', 'LW', 'RW', 'D', 'Util', 'G'];

const slotOk = (p: Player, s: Slot) =>
  s === 'BN' || s === 'IR' ? true : s === 'Util' ? p.pos !== 'G' : s === 'G' ? p.pos === 'G' : p.pos !== 'G' && p.elig.includes(s);

export default function MyTeam() {
  const { id } = useParams();
  const { me, league, teams, team, rosters, players, standings, season, games, gamesByTeam, refresh } = useLeague();
  const now = useNow(15_000);
  const nav = useNavigate();
  const { busy, run } = useAction();
  const teamId = id ? Number(id) : me?.id;
  const t = team(teamId);
  const mine = teamId === me?.id;
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [today, setToday] = useState<Map<number, { fpts: number; stats: Record<string, number> }>>(new Map());
  const [tx, setTx] = useState<Transaction[]>([]);

  const roster = useMemo(() => rosters.filter((r) => r.team_id === teamId).map((r) => ({ r, p: players.get(r.player_id)! })).filter((x) => x.p), [rosters, players, teamId]);

  useEffect(() => {
    if (!roster.length) return;
    const load = () => supabase.from('player_games').select('player_id,fpts,stats').eq('date', etToday()).in('player_id', roster.map((x) => x.p.id))
      .then(({ data }) => setToday(new Map((data ?? []).map((d) => [d.player_id, { fpts: Number(d.fpts), stats: d.stats }]))));
    load();
    const i = setInterval(load, 60_000);
    return () => clearInterval(i);
  }, [roster.length, teamId]);

  useEffect(() => {
    if (!teamId) return;
    supabase.from('transactions').select('*').eq('team_id', teamId).order('id', { ascending: false }).limit(15).then(({ data }) => setTx((data ?? []) as Transaction[]));
  }, [teamId, rosters.length]);

  // games left this week (through Sunday, Eastern) for position planning
  const weekEnd = (() => { const d = new Date(etToday() + 'T12:00:00'); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return d.toISOString().slice(0, 10); })();
  const weekGames = (nhl: string | null) => games.filter((g) => g.date >= etToday() && g.date <= weekEnd && (g.home === nhl || g.away === nhl)).length;

  const locked = (p: Player) => {
    const g = gamesByTeam(p.nhl_team);
    return !!g && new Date(g.start_utc).getTime() <= now && !['PPD', 'CNCL'].includes(g.state);
  };

  // lay out slot instances
  const cap = (league?.roster ?? {}) as Record<Slot, number>;
  const bySlot = (s: Slot) => roster.filter((x) => x.r.slot === s).sort((a, b) => b.p.proj - a.p.proj);
  const rows: { slot: Slot; x?: { r: Roster; p: Player } }[] = [];
  for (const s of STARTERS) {
    const occ = bySlot(s);
    for (let i = 0; i < Math.max(cap[s] ?? 0, occ.length); i++) rows.push({ slot: s, x: occ[i] });
  }
  const bench = bySlot('BN');
  const ir = bySlot('IR');
  const selected = roster.find((x) => x.p.id === sel);

  const canTarget = (slot: Slot, occupant?: { p: Player; r: Roster }) => {
    if (!selected || !mine) return false;
    if (occupant?.p.id === selected.p.id) return false;
    if (!slotOk(selected.p, slot)) return false;
    if (occupant && locked(occupant.p)) return false;
    if (!occupant && slot === selected.r.slot) return false;
    if (!occupant && slot !== 'BN' && slot !== 'IR' && bySlot(slot).length >= (cap[slot] ?? 0)) return false;
    return true;
  };

  const tap = (slot: Slot, x?: { r: Roster; p: Player }) => {
    if (!mine || league?.phase === 'keepers') { if (x) setDetail(x.p.id); return; }
    if (selected) {
      if (x?.p.id === selected.p.id) { setSel(null); return; }
      if (canTarget(slot, x)) {
        const who = selected.p;
        setSel(null);
        run(async () => { await rpc('move_player', { p_player: who.id, p_slot: slot, p_swap: x?.p.id ?? null }); await refresh(['rosters']); });
        return;
      }
      if (x && !locked(x.p)) { setSel(x.p.id); return; }
      setSel(null);
      return;
    }
    if (x) {
      if (locked(x.p)) { setDetail(x.p.id); return; }
      setSel(x.p.id);
    }
  };

  const st = standings.find((s) => s.team_id === teamId);
  const todayTotal = rows.filter((r) => r.x).reduce((tot, r) => tot + (today.get(r.x!.p.id)?.fpts ?? 0), 0);
  const benchedWithGames = bench.filter((x) => gamesByTeam(x.p.nhl_team) && !locked(x.p));
  const emptyStarters = rows.filter((r) => !r.x).length;

  const Row = ({ slot, x }: { slot: Slot; x?: { r: Roster; p: Player } }) => {
    const isSel = x && x.p.id === sel;
    const target = canTarget(slot, x);
    const g = x ? gamesByTeam(x.p.nhl_team) : undefined;
    const tp = x ? today.get(x.p.id) : undefined;
    const lk = x && locked(x.p);
    return (
      <div onClick={() => tap(slot, x)}
        className={`flex cursor-pointer items-center gap-2 px-2.5 py-2 transition ${isSel ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400' : target ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/60' : ''}`}>
        <Pos p={slot} className="w-10" />
        {x ? (
          <>
            <div className="min-w-0 flex-1"><PlayerRow p={x.p} dim={slot !== 'BN' && slot !== 'IR' && !g} /></div>
            {lk && <span title="Locked: game started" className="text-xs">🔒</span>}
            <div className="w-14 text-right">
              <div className={`text-sm font-semibold ${tp && tp.fpts > 0 ? 'text-emerald-300' : ''}`}>{tp ? fmtPts(tp.fpts, 1) : g ? '–' : ''}</div>
              <div className="text-[10px] text-mute">{fmtPts(season.get(x.p.id)?.fpts ?? 0, 0)} szn · {weekGames(x.p.nhl_team)}g wk</div>
            </div>
          </>
        ) : (
          <div className={`flex-1 text-sm ${target ? 'font-semibold text-emerald-300' : 'text-mute'}`}>{target ? 'Move here' : 'Empty'}</div>
        )}
      </div>
    );
  };

  if (!t) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <TeamBadge team={t} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="h-display truncate text-2xl leading-tight">{t.name}</h1>
          <div className="text-xs text-mute">GM {t.gm_name}{st && league?.phase === 'season' && <> · {ordinal(st.rank)} · {fmtPts(st.points)} pts · {st.moves}/{league?.max_acquisitions} pickups</>}</div>
        </div>
        <select className="rounded-lg border border-line bg-boards px-2 py-1.5 text-sm" value={teamId} onChange={(e) => nav(Number(e.target.value) === me?.id ? '/team' : `/team/${e.target.value}`)}>
          {teams.map((x) => <option key={x.id} value={x.id}>{x.id === me?.id ? 'My team' : x.name}</option>)}
        </select>
      </div>

      {mine && league?.phase === 'season' && (
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <div className="flex-1 text-sm">
            <div><span className="font-semibold">Today: {fmtPts(todayTotal)} pts</span> <span className="text-mute">· tap a player, then tap where he should go</span></div>
            {benchedWithGames.length > 0 && <div className="text-xs text-amber-300">⚠️ {benchedWithGames.length} benched player{benchedWithGames.length > 1 ? 's' : ''} playing today</div>}
            {emptyStarters > 0 && <div className="text-xs text-amber-300">⚠️ {emptyStarters} empty starting slot{emptyStarters > 1 ? 's' : ''}</div>}
          </div>
          <button className="btn-blue" disabled={busy} onClick={() => run(async () => { await rpc('auto_lineup'); await refresh(['rosters']); }, 'Lineup optimized for today ✨')}>✨ Auto-set today</button>
          <Toggle on={!!me?.auto_lineup} label={<span className="text-xs text-mute">Auto-set daily</span>}
            onChange={(v) => run(async () => { await rpc('update_my_team', { p_name: me!.name, p_motto: me!.motto, p_color: me!.color, p_emoji: me!.emoji, p_fav_nhl: me!.fav_nhl, p_auto_lineup: v }); await refresh(['teams']); }, v ? 'We’ll set your lineup every morning' : 'Daily auto-set off')} />
        </div>
      )}
      {league?.phase === 'keepers' && mine && (
        <Link to="/keepers" className="card block bg-amber-500/10 p-3 text-sm text-amber-100">🔒 It’s keeper season: this is your 2025-26 roster. Pick who you keep →</Link>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Starters">
          <div className="card divide-y divide-line overflow-hidden">{rows.map((r, i) => <Row key={i} slot={r.slot} x={r.x} />)}</div>
        </Section>
        <div className="space-y-4">
          <Section title={`Bench (${bench.length}/${cap.BN ?? 12})`}>
            <div className="card divide-y divide-line overflow-hidden">
              {bench.map((x) => <Row key={x.p.id} slot="BN" x={x} />)}
              {selected && selected.r.slot !== 'BN' && <Row slot="BN" />}
              {bench.length === 0 && !selected && <div className="p-3 text-sm text-mute">Empty bench.</div>}
            </div>
          </Section>
          <Section title={`IR (${ir.length}/${cap.IR ?? 2})`}>
            <div className="card divide-y divide-line overflow-hidden">
              {ir.map((x) => <Row key={x.p.id} slot="IR" x={x} />)}
              {selected && selected.r.slot !== 'IR' && ir.length < (cap.IR ?? 2) && <Row slot="IR" />}
              {ir.length === 0 && !selected && <div className="p-3 text-xs text-mute">Injured players only (honour system; the commish is watching).</div>}
            </div>
          </Section>
          <Section title="Transactions">
            <div className="card divide-y divide-line">
              {tx.length === 0 && <div className="p-3 text-sm text-mute">None yet.</div>}
              {tx.map((x) => (
                <div key={x.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span>{{ add: '➕', drop: '➖', trade: '🔄', draft: '📋', keeper: '🔒', release: '↩️', commish: '🛠️' }[x.type] ?? '•'}</span>
                  <span className="flex-1 truncate">{players.get(x.player_id ?? 0)?.name} <span className="text-mute">{x.type}{x.other_team ? ` from ${team(x.other_team)?.abbrev}` : ''}{x.fee ? ` ($${x.fee})` : ''}</span></span>
                  <span className="text-xs text-mute">{ago(x.created_at, now)}</span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
      {!mine && <div className="text-center text-sm"><Link className="text-sky-300" to={`/trades?with=${teamId}`}>🔄 Propose a trade with <TeamName team={t} /></Link></div>}
      <PlayerSheet id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
