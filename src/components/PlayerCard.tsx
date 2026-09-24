import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { fmtDate, fmtPts, fmtTime, NHL_TEAMS, STAT_LABELS } from '../lib/format';
import { Headshot, NhlLogo, Pos, Sheet, TeamBadge, TeamName, useAction } from './ui';

// one-line player row used everywhere
export function PlayerRow({ p, right, onClick, sub, dim }: { p: Player; right?: ReactNode; onClick?: () => void; sub?: ReactNode; dim?: boolean }) {
  const { gamesByTeam } = useLeague();
  const g = gamesByTeam(p.nhl_team);
  const opp = g ? (g.home === p.nhl_team ? `vs ${g.away}` : `@ ${g.home}`) : null;
  const live = g && ['LIVE', 'CRIT'].includes(g.state);
  return (
    <div onClick={onClick} className={`flex min-w-0 items-center gap-2.5 ${onClick ? 'cursor-pointer' : ''} ${dim ? 'opacity-45' : ''}`}>
      <Headshot p={p} size={38} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{p.name}</span>
          {p.status === 'inj' && <span className="chip border-red-800 bg-red-900/50 text-red-300">INJ</span>}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-mute">
          <NhlLogo abbr={p.nhl_team} size={14} />
          <span>{p.nhl_team ?? 'FA'}</span>
          <span>·</span>
          <span>{p.elig.join('/')}</span>
          {opp && (
            <span className={`ml-1 truncate ${live ? 'font-semibold text-goal' : 'text-slate-300'}`}>
              {opp} {live ? `· ${g!.period === 'SO' || g!.period === 'OT' ? g!.period : 'P' + g!.period} ${g!.clock ?? ''}`
                : ['OFF', 'FINAL'].includes(g!.state) ? '· Final' : '· ' + fmtTime(g!.start_utc)}
            </span>
          )}
          {sub}
        </div>
      </div>
      {right}
    </div>
  );
}

export function usePlayerSheet() {
  const [id, setId] = useState<number | null>(null);
  return { open: (pid: number) => setId(pid), sheet: <PlayerSheet id={id} onClose={() => setId(null)} /> };
}

interface GameLine { game_id: number; date: string; nhl_team: string; stats: Record<string, number>; fpts: number }

export function PlayerSheet({ id, onClose, actions }: { id: number | null; onClose: () => void; actions?: ReactNode }) {
  const { players, owner, team, me, league, season, rosters, refresh } = useLeague();
  const nav = useNavigate();
  const p = id ? players.get(id) : undefined;
  const r = id ? owner.get(id) : undefined;
  const [log, setLog] = useState<GameLine[]>([]);
  const [dropPick, setDropPick] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => {
    setLog([]); setDropPick(false);
    if (!id) return;
    supabase.from('player_games').select('game_id,date,nhl_team,stats,fpts').eq('player_id', id).order('date', { ascending: false }).limit(15)
      .then(({ data }) => setLog((data ?? []) as GameLine[]));
  }, [id]);

  if (!p) return null;
  const s = season.get(p.id);
  const isGoalie = p.pos === 'G';
  const keys = isGoalie ? ['gp', 'gs', 'w', 'l', 'ga', 'sv', 'sho'] : ['gp', 'g', 'a', 'pm', 'ppp', 'sog', 'hit', 'blk', 'pim'];
  const mine = r && me && r.team_id === me.id;
  const inSeason = league?.phase === 'season';
  const myRoster = rosters.filter((x) => x.team_id === me?.id && x.slot !== 'IR');
  const full = myRoster.length >= Object.entries(league?.roster ?? {}).filter(([k]) => k !== 'IR').reduce((t, [, v]) => t + v, 0);

  const add = (drop?: number, fee = false) => run(async () => {
    try {
      await rpc('add_player', { p_add: p.id, p_drop: drop ?? null, p_accept_fee: fee });
    } catch (e) {
      const m = (e as Error).message;
      if (m.startsWith('ACQ_LIMIT') && confirm(m.replace('ACQ_LIMIT: ', '') + '\n\nPay the fee and make the pickup?')) {
        await rpc('add_player', { p_add: p.id, p_drop: drop ?? null, p_accept_fee: true });
      } else throw e;
    }
    await refresh(['rosters', 'standings']);
    onClose();
  }, `${p.name} added`);

  return (
    <Sheet open={!!id} onClose={onClose} title={<span className="flex items-center gap-2"><NhlLogo abbr={p.nhl_team} />{p.name}</span>}>
      <div className="flex items-center gap-3">
        <Headshot p={p} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1">
            {p.elig.map((e) => <Pos key={e} p={e} />)}
            {p.num != null && <span className="chip">#{p.num}</span>}
            <span className="chip">{NHL_TEAMS[p.nhl_team ?? ''] ?? 'Free agent (NHL)'}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {r ? (<><TeamBadge team={team(r.team_id)} size={22} /><TeamName team={team(r.team_id)} /><Pos p={r.slot} /></>)
              : <span className="text-emerald-300 font-semibold">Available</span>}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">This season</div><div className="font-display text-xl font-bold">{fmtPts(s?.fpts)}</div><div className="text-[11px] text-mute">{s?.gp ?? 0} GP</div></div>
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">Last season</div><div className="font-display text-xl font-bold">{fmtPts(p.last_fp)}</div><div className="text-[11px] text-mute">{p.last_stats?.gp ?? 0} GP</div></div>
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">Projection</div><div className="font-display text-xl font-bold">{fmtPts(p.proj, 0)}</div><div className="text-[11px] text-mute">Rank #{p.rank ?? '—'}</div></div>
      </div>

      {p.last_stats && (
        <div className="mt-3">
          <div className="label mb-1">2025-26 stats</div>
          <div className="scroll-x flex gap-1.5">
            {keys.map((k) => (
              <div key={k} className="min-w-12 rounded-lg bg-ice px-2 py-1 text-center">
                <div className="text-[10px] text-mute">{STAT_LABELS[k]}</div>
                <div className="text-sm font-semibold">{p.last_stats?.[k] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {log.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1">Game log</div>
          <div className="divide-y divide-line rounded-xl border border-line">
            {log.map((g) => (
              <div key={g.game_id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                <span className="w-20 text-mute">{fmtDate(g.date)}</span>
                <span className="flex-1 truncate text-slate-300">
                  {Object.entries(g.stats).filter(([k, v]) => v && k !== 'sa').map(([k, v]) => `${v} ${STAT_LABELS[k] ?? k}`).join(' · ') || '—'}
                </span>
                <span className="font-semibold">{fmtPts(g.fpts, 2)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {actions}
        {!r && inSeason && me && !dropPick && (
          <button className="btn-primary" disabled={busy} onClick={() => (full ? setDropPick(true) : add())}>➕ Add {full ? '(drop someone)' : ''}</button>
        )}
        {mine && ['season', 'predraft'].includes(league?.phase ?? '') && (
          <button className="btn-ghost text-red-300" disabled={busy}
            onClick={() => confirm(`Drop ${p.name}?`) && run(async () => { await rpc('drop_player', { p_player: p.id }); await refresh(['rosters']); onClose(); }, `${p.name} dropped`)}>
            Drop
          </button>
        )}
        {r && me && !mine && (
          <button className="btn-ghost" onClick={() => { onClose(); nav(`/trades?with=${r.team_id}&get=${p.id}`); }}>🔄 Propose trade</button>
        )}
      </div>

      {dropPick && (
        <div className="mt-3">
          <div className="label mb-1">Drop who?</div>
          <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {myRoster.map((x) => players.get(x.player_id)).filter(Boolean).sort((a, b) => a!.proj - b!.proj).map((d) => (
              <div key={d!.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1"><PlayerRow p={d!} /></div>
                <button className="btn-primary btn-sm" disabled={busy} onClick={() => add(d!.id)}>Drop</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
