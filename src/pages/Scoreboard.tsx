// Game night, live: every NHL game on the slate, and every SaK team's points as they come in, starter by starter.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import { etToday, fmtPts, fmtTime, readable } from '../lib/format';
import { NhlLogo, PageHeader, Pos, Section, TeamBadge } from '../components/ui';
import type { Game } from '../lib/types';
import { Radio } from 'lucide-react';

type Snap = { team_id: number; player_id: number; slot: string; game_id: number };
type PG = { player_id: number; game_id: number; fpts: number; stats: Record<string, number> };
const LIVE = new Set(['LIVE', 'CRIT']);
const DONE = new Set(['OFF', 'FINAL']);

function gameLabel(g: Game) {
  if (g.state === 'PPD') return 'Postponed';
  if (g.state === 'CNCL') return 'Cancelled';
  if (DONE.has(g.state)) return 'Final';
  if (LIVE.has(g.state)) return `${g.period ?? ''} ${g.clock ?? ''}`.trim() || 'Live';
  return fmtTime(g.start_utc);
}

export default function Scoreboard() {
  const { me, teams, players, rosters, games, league, standings } = useLeague();
  const now = useNow(30_000);
  const today = etToday();
  const slate = useMemo(() => games.filter((g) => g.date === today).sort((a, b) => a.start_utc.localeCompare(b.start_utc)), [games, today]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [pgs, setPgs] = useState<PG[]>([]);
  const [open, setOpen] = useState<number | null>(me?.id ?? null);

  // freeze-frames are taken at puck drop, box scores every minute: poll both while the page is open
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from('lineup_snapshots').select('team_id,player_id,slot,game_id').eq('date', today),
        supabase.from('player_games').select('player_id,game_id,fpts,stats').eq('date', today),
      ]);
      if (!alive) return;
      setSnaps((s ?? []) as Snap[]);
      setPgs(((p ?? []) as PG[]).map((x) => ({ ...x, fpts: Number(x.fpts) })));
    };
    load();
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; window.clearInterval(i); };
  }, [today, slate.length]);

  const gameOf = (nhl: string | null) => slate.find((g) => g.home === nhl || g.away === nhl);
  const pgBy = useMemo(() => new Map(pgs.map((p) => [`${p.game_id}:${p.player_id}`, p])), [pgs]);
  // starters tonight: the frozen lineup once a game has started, the current lineup before that
  const rows = useMemo(() => teams.map((t) => {
    const live = snaps.filter((s) => s.team_id === t.id && !['BN', 'IR'].includes(s.slot));
    const frozen = new Set(live.map((s) => s.player_id));
    const pending = rosters.filter((r) => r.team_id === t.id && !['BN', 'IR'].includes(r.slot) && !frozen.has(r.player_id))
      .map((r) => ({ team_id: t.id, player_id: r.player_id, slot: r.slot, game: gameOf(players.get(r.player_id)?.nhl_team ?? null) }))
      .filter((r) => r.game && !DONE.has(r.game.state) && !LIVE.has(r.game.state));
    const lines = [
      ...live.map((s) => { const g = slate.find((x) => x.id === s.game_id); const pg = pgBy.get(`${s.game_id}:${s.player_id}`); return { ...s, game: g, pg, pts: pg?.fpts ?? 0 }; }),
      ...pending.map((s) => ({ ...s, game_id: s.game!.id, pg: undefined as PG | undefined, pts: 0 })),
    ].sort((a, b) => b.pts - a.pts || (a.game?.start_utc ?? '').localeCompare(b.game?.start_utc ?? ''));
    const pts = lines.reduce((n, l) => n + l.pts, 0);
    const done = lines.filter((l) => l.game && DONE.has(l.game.state)).length;
    const playing = lines.filter((l) => l.game && LIVE.has(l.game.state)).length;
    return { t, lines, pts, done, playing, left: lines.length - done - playing };
  }).sort((a, b) => b.pts - a.pts || a.t.id - b.t.id), [teams, snaps, rosters, players, slate, pgBy]);
  const scored = standings.some((s) => Number(s.points) !== 0);
  const rankOf = (id: number) => (scored ? standings.find((s) => s.team_id === id)?.rank : undefined);
  const anyLive = slate.some((g) => LIVE.has(g.state));

  return (
    <div className="space-y-4">
      <PageHeader icon={<Radio size={22} className={anyLive ? 'animate-pulse text-goal' : 'text-goal'} />} title="Live scoreboard"
        sub={slate.length ? `${slate.length} NHL game${slate.length > 1 ? 's' : ''} tonight · updates every minute` : 'No NHL games today.'} />
      {league?.phase !== 'season' && <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">The season hasn’t started. Once it does, this page follows every game night live: NHL scores up top, your starters’ points below.</div>}

      {slate.length > 0 && (
        <div className="scroll-x flex gap-2">
          {slate.map((g) => {
            const live = LIVE.has(g.state);
            return (
              <div key={g.id} className={`w-40 shrink-0 rounded-2xl border p-2.5 ${live ? 'border-goal/40 bg-goal/[.07]' : 'border-white/[.07] bg-white/[.03]'}`}>
                <div className={`mb-1.5 text-[10px] font-bold uppercase tracking-wider ${live ? 'text-goal' : 'text-mute'}`}>{live && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-goal align-middle" />}{gameLabel(g)}</div>
                {[[g.away, g.away_score], [g.home, g.home_score]].map(([abbr, score]) => (
                  <div key={String(abbr)} className="flex items-center gap-1.5 py-0.5 text-sm"><NhlLogo abbr={String(abbr)} size={18} /><span className="flex-1 font-semibold">{abbr}</span><span className="num font-bold">{score ?? ''}</span></div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <Section title="Tonight’s points" right={<span className="text-xs text-mute">tap a team for every starter</span>}>
        <div className="space-y-2">
          {rows.map(({ t, lines, pts, done, playing, left }, i) => {
            const isOpen = open === t.id;
            const top = lines.filter((l) => l.pg).slice(0, 3);
            return (
              <div key={t.id} className={`card overflow-hidden ${t.id === me?.id ? 'ring-1 ring-sky-400/40' : ''}`}>
                <button className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(isOpen ? null : t.id)}>
                  <span className="num w-5 text-center text-sm font-bold text-mute">{i + 1}</span>
                  <TeamBadge team={t} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{t.name} <span className="text-xs font-normal text-mute">· {t.gm_name}{rankOf(t.id) ? ` · ${rankOf(t.id)}${['st', 'nd', 'rd'][(rankOf(t.id)! - 1)] ?? 'th'} overall` : ''}</span></div>
                    <div className="truncate text-xs text-mute">
                      {lines.length === 0 ? 'No starters with a game tonight' : `${playing ? `${playing} playing · ` : ''}${done} done · ${left} to come`}
                      {top.length > 0 && <> · {top.map((l) => `${players.get(l.player_id)?.last_name} ${fmtPts(l.pts)}`).join(', ')}</>}
                    </div>
                  </div>
                  <div className="text-right"><div className="num font-display text-2xl font-extrabold" style={{ color: readable(t.color) }}>{fmtPts(pts)}</div><div className="text-[10px] text-mute">tonight</div></div>
                </button>
                {isOpen && (
                  <div className="divide-y divide-white/[.05] border-t border-white/[.06]">
                    {lines.map((l) => {
                      const p = players.get(l.player_id);
                      const st = l.pg?.stats ?? {};
                      const g = l.game;
                      const line = p?.pos === 'G' ? `${st.sv ?? 0} SV · ${st.ga ?? 0} GA${st.w ? ' · W' : ''}` : `${st.g ?? 0} G · ${st.a ?? 0} A · ${st.sog ?? 0} SOG${st.pm ? ` · ${st.pm > 0 ? '+' : ''}${st.pm}` : ''}`;
                      return (
                        <Link key={l.player_id} to={`/player/${l.player_id}`} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-white/[.03]">
                          <Pos p={l.slot} className="min-w-0 px-1 py-0" />
                          <span className="min-w-0 flex-1 truncate font-semibold">{p?.name}</span>
                          <span className="hidden text-xs text-mute sm:block">{l.pg ? line : g ? `${p?.nhl_team} vs ${g.home === p?.nhl_team ? g.away : g.home} · ${gameLabel(g)}` : ''}</span>
                          {g && <span className={`w-14 text-right text-[10px] uppercase ${LIVE.has(g.state) ? 'text-goal' : 'text-mute'}`}>{DONE.has(g.state) ? 'Final' : LIVE.has(g.state) ? 'Live' : fmtTime(g.start_utc)}</span>}
                          <span className={`num w-12 text-right font-bold ${l.pts < 0 ? 'text-red-300' : ''}`}>{l.pg ? fmtPts(l.pts) : '–'}</span>
                        </Link>
                      );
                    })}
                    {lines.length === 0 && <div className="p-3 text-xs text-mute">Nobody in {t.gm_name}’s starting lineup plays tonight.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
      <p className="px-1 text-center text-[11px] text-mute">Points follow the NHL box scores, which update about once a minute. Last check {new Date(now).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}.</p>
    </div>
  );
}
