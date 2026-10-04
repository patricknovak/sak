import { useEffect, useState, type ReactNode } from 'react';
import { Sparkline } from './charts';
import { useNavigate } from 'react-router-dom';
import { useLeague, useSport } from '../lib/store';
import { isFinal, isLive, periodShort } from '../lib/sport';
import { rpc, supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { ago, calcFpts, fmtDate, fmtPts, fmtTime, injuryBadge, NHL_COLORS, NHL_TEAMS, STAT_LABELS, teamLogo } from '../lib/format';
import { Headshot, NhlLogo, Pos, Sheet, TeamBadge, TeamName, useAction } from './ui';
import { ProjOutlook } from './ProjOutlook';
import { LatestNews, PlayerNewsList, usePlayerNews } from './PlayerNews';
import { GameStatusBox, GameStatusChip, NewsDot } from './GameStatus';
import { useBrand } from '../lib/brand';
import { AddPlayerPanel } from './AddPlayer';

// one-line player row used everywhere
// `wrap`: on a narrow phone the name and the matchup wrap onto more lines instead of being cut off (the lineup uses it,
// where the opponent and the puck drop matter most)
export function PlayerRow({ p, right, onClick, sub, dim, onInfo, wrap }: { p: Player; right?: ReactNode; onClick?: () => void; sub?: ReactNode; dim?: boolean; onInfo?: () => void; wrap?: boolean }) {
  const { gamesByTeam } = useLeague();
  const sport = useSport();
  const g = gamesByTeam(p.nhl_team);
  const opp = g ? (g.home === p.nhl_team ? `vs ${g.away}` : `@ ${g.home}`) : null;
  const live = g && isLive(sport, g.state);
  return (
    <div onClick={onClick} className={`flex min-w-0 items-center gap-2.5 ${onClick ? 'cursor-pointer' : ''} ${dim ? 'opacity-45' : ''}`}>
      <Headshot p={p} size={wrap ? 34 : 38} />
      <div className="min-w-0 flex-1">
        <div className={wrap ? 'flex flex-wrap items-center gap-x-1.5 gap-y-0.5' : 'flex items-center gap-1.5'}>
          <span className={wrap ? 'break-words font-semibold leading-tight' : 'truncate font-semibold'}>{p.name}</span>
          {(() => { const b = injuryBadge(p.injury_status); return b && <span className={`chip shrink-0 ${b.cls}`} title={p.injury_note ?? ''}>{b.label}</span>; })()}
          <GameStatusChip id={p.id} />
          <NewsDot id={p.id} onClick={onInfo} />
        </div>
        <div className={wrap ? 'mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-mute' : 'flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs text-mute'}>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><NhlLogo abbr={p.nhl_team} size={14} />
          <span>{p.nhl_team ?? 'FA'}</span>
          <span>·</span>
          <span>{p.elig.join('/')}</span></span>
          {opp && (
            <span className={`${wrap ? 'whitespace-nowrap rounded-md bg-white/[.06] px-1.5 py-px' : 'ml-1 truncate'} ${live ? 'font-semibold text-goal' : 'text-slate-300'}`}>
              {opp} {live ? `· ${periodShort(sport, g!.period)} ${g!.clock ?? ''}`
                : isFinal(sport, g!.state) ? '· Final' : '· ' + fmtTime(g!.start_utc)}
            </span>
          )}
          {sub}
        </div>
      </div>
      {right}
    </div>
  );
}

// tapping a player opens his full page
export function usePlayerSheet() {
  const nav = useNavigate();
  return { open: (pid: number) => nav(`/player/${pid}`), sheet: null };
}

interface GameLine { game_id: number; date: string; nhl_team: string; stats: Record<string, number>; fpts: number }

export function PlayerSheet({ id, onClose, actions }: { id: number | null; onClose: () => void; actions?: ReactNode }) {
  const { players, owner, team, league, season } = useLeague();
  const brand = useBrand();
  const nav = useNavigate();
  const p = id ? players.get(id) : undefined;
  const r = id ? owner.get(id) : undefined;
  const [log, setLog] = useState<GameLine[]>([]);
  const [career, setCareer] = useState<Record<string, number | string>[] | null>(null);
  const news = usePlayerNews(id, 10);
  const [tab, setTab] = useState<'overview' | 'career' | 'news'>('overview');

  useEffect(() => {
    setLog([]); setCareer(null); setTab('overview');
    if (!id) return;
    supabase.from('league_games').select('game_id,date,nhl_team,stats,fpts').eq('player_id', id).order('date', { ascending: false }).limit(15)
      .then(({ data }) => setLog((data ?? []) as GameLine[]));
  }, [id]);
  useEffect(() => {
    if (tab !== 'career' || !id || career) return;
    supabase.functions.invoke(`player-info?id=${id}`, { method: 'GET' })
      .then(({ data }) => setCareer((data?.seasons ?? []) as Record<string, number | string>[]))
      .catch(() => setCareer([]));
  }, [tab, id, career]);

  if (!p) return null;
  const s = season.get(p.id);
  const isGoalie = p.pos === 'G';
  const keys = isGoalie ? ['gp', 'gs', 'w', 'l', 'otl', 'ga', 'sa', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'pim', 'ppg', 'ppp', 'shp', 'gwg', 'sog', 'fow', 'hit', 'blk'];
  return (
    <Sheet open={!!id} onClose={onClose} title={<span className="flex items-center gap-2"><NhlLogo abbr={p.nhl_team} size={22} />{NHL_TEAMS[p.nhl_team ?? ''] ?? 'Player'}</span>}>
      <div className="card-hero -mx-1 flex items-center gap-4 p-4" style={{ '--tc': NHL_COLORS[p.nhl_team ?? ''] ?? '#4cc3ff' } as React.CSSProperties}>
        {p.nhl_team && <img src={teamLogo(p.nhl_team)} alt="" className="pointer-events-none absolute -right-6 -top-4 h-36 w-36 opacity-[.12]" />}
        <Headshot p={p} size={84} />
        <div className="relative min-w-0 flex-1">
          <div className="h-display text-shine truncate text-2xl leading-tight">{p.name}</div>
          <div className="flex flex-wrap items-center gap-1">
            {p.elig.map((e) => <Pos key={e} p={e} />)}
            {p.num != null && <span className="chip">#{p.num}</span>}
            <span className="chip">{NHL_TEAMS[p.nhl_team ?? ''] ?? 'Free agent (NHL)'}</span>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            {r ? (<><TeamBadge team={team(r.team_id)} size={22} /><TeamName link team={team(r.team_id)} /><Pos p={r.slot} /></>)
              : <span className="text-emerald-300 font-semibold">Available</span>}
          </div>
        </div>
      </div>

      <GameStatusBox id={p.id} />
      {p.injury_status && (
        <div className="mt-3 rounded-xl border border-red-900/60 bg-red-950/40 p-3 text-sm">
          <div className="font-semibold text-red-300">🩹 {p.injury_status}{p.injury_date && <span className="ml-2 text-xs font-normal text-mute">updated {ago(p.injury_date)}</span>}</div>
          {p.injury_note && <p className="mt-1 text-slate-300">{p.injury_note}</p>}
        </div>
      )}

      <div className="mt-3 flex gap-1">
        {([['overview', 'Overview'], ['career', 'Career'], ['news', `News${news?.length ? ` (${news.length})` : ''}`]] as const).map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'career' && (
        <div className="mt-3">
          {career === null ? <div className="py-6 text-center text-sm text-mute">Loading career stats…</div>
            : career.length === 0 ? <div className="py-6 text-center text-sm text-mute">No NHL regular-season stats yet.</div> : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-right text-xs">
                <thead className="bg-boards/60 text-mute">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Season</th><th className="px-2 text-gold">{brand.short}</th><th className="px-1">Team</th>
                    {(isGoalie ? ['gp', 'gs', 'w', 'l', 'ga', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk']).map((k) => <th key={k} className="px-1">{STAT_LABELS[k]}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[.06]">
                  {career.map((c) => {
                    const fp = calcFpts(c as Record<string, number>, league?.scoring[isGoalie ? 'goalie' : 'skater'] ?? {});
                    const sz = String(c.season);
                    return (
                      <tr key={sz}>
                        <td className="px-2 py-1.5 text-left">{sz.slice(0, 4)}-{sz.slice(6)}</td><td className="px-2 font-semibold text-gold">{fmtPts(fp)}</td><td className="px-1 text-mute">{String(c.team ?? '')}</td>
                        {(isGoalie ? ['gp', 'gs', 'w', 'l', 'ga', 'sv', 'sho'] : ['gp', 'g', 'a', 'pts', 'pm', 'ppp', 'sog', 'hit', 'blk']).map((k) => <td key={k} className="px-1">{String(c[k] ?? 0)}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-1 text-[11px] text-mute">{brand.short} column = fantasy points under this league’s current scoring. Hits and blocks are tracked from 2005-06 on.</p>
        </div>
      )}

      {tab === 'news' && <div className="mt-3"><PlayerNewsList items={news} name={p.name} /></div>}

      {tab === 'overview' && <>
      <LatestNews items={news} onMore={() => setTab('news')} />
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">This season</div><div className="flex items-end gap-1.5"><span className="font-display text-xl font-bold">{fmtPts(s?.fpts)}</span>{log.length > 1 && <Sparkline values={[...log].reverse().map((g) => g.fpts)} color={NHL_COLORS[p.nhl_team ?? ''] ?? '#4cc3ff'} width={56} height={20} />}</div><div className="text-[11px] text-mute">{s?.gp ?? 0} GP</div></div>
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">Last season</div><div className="font-display text-xl font-bold">{fmtPts(p.last_fp)}</div><div className="text-[11px] text-mute">{p.last_stats?.gp ?? 0} GP</div></div>
        <div className="rounded-xl bg-boards/60 p-2"><div className="label">Projection</div><div className="font-display text-xl font-bold">{fmtPts(p.proj, 0)}</div><div className="text-[11px] text-mute">Rank #{p.rank ?? '—'}</div></div>
      </div>
      <ProjOutlook p={p} />

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
          <div className="divide-y divide-white/[.06] rounded-xl border border-line">
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

      </>}

      <div className="mt-4 flex flex-wrap gap-2">
        {actions}
        <button className="btn-blue" onClick={() => { onClose(); nav(`/player/${p.id}`); }}>📇 Full player page</button>
      </div>
      <PlayerActions p={p} onDone={onClose} />
    </Sheet>
  );
}

// add / drop / trade buttons for a player, used by the quick-view sheet and the player page
export function PlayerActions({ p, onDone }: { p: Player; onDone?: () => void }) {
  const { owner, me, league, refresh } = useLeague();
  const nav = useNavigate();
  const { busy, run } = useAction();
  // adding opens the chooser: his numbers beside your roster's, with an optional (or, when full, required) drop
  const [adding, setAdding] = useState(false);
  const r = owner.get(p.id);
  const mine = r && me && r.team_id === me.id;
  const inSeason = league?.phase === 'season';

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        {!r && inSeason && me && me.role !== 'spectator' && !adding && (
          <button className="btn-primary" disabled={busy} onClick={() => setAdding(true)}>➕ Add</button>
        )}
        {mine && ['season', 'predraft'].includes(league?.phase ?? '') && (
          <button className="btn-ghost text-red-300" disabled={busy}
            onClick={() => confirm(`Drop ${p.name}?`) && run(async () => { await rpc('drop_player', { p_player: p.id }); await refresh(['rosters']); onDone?.(); }, `${p.name} dropped`)}>
            Drop
          </button>
        )}
        {r && me && !mine && (
          <button className="btn-ghost" onClick={() => { onDone?.(); nav(`/trades?with=${r.team_id}&get=${p.id}`); }}>🔄 Propose trade</button>
        )}
      </div>

      {adding && <AddPlayerPanel p={p} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); onDone?.(); }} />}
    </>
  );
}
