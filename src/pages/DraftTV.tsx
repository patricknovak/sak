// Draft night on the big screen: cast this tab to the TV. No site chrome, a huge clock, the full board,
// the last picks on a ticker, and a horn every time a pick lands.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { countdown, fmtPts, readable } from '../lib/format';
import { Headshot, Pos, TeamBadge } from '../components/ui';
import { ClockRing, POS_BG } from '../components/draftkit';
import { SoundToggle, useDraftSounds, useSoundsOn } from '../components/DraftSounds';
import { Maximize2, X } from 'lucide-react';

export default function DraftTV() {
  const { league, teams, team, players, rosters, picks, draft, online } = useLeague();
  const now = useNow(500);
  const on = useSoundsOn(true);
  useDraftSounds(on, { everyone: true });
  const season = draft?.season;
  const board = useMemo(() => picks.filter((p) => p.season === season && p.overall).sort((a, b) => a.overall! - b.overall!), [picks, season]);
  const order = useMemo(() => board.filter((p) => p.round === 1).map((p) => p.original_team), [board]);
  const current = board.find((p) => p.overall === draft?.current_overall);
  const status = draft?.status ?? 'scheduled';
  const remaining = status === 'paused' ? (draft?.paused_remaining ?? 0) * 1000 : draft?.deadline ? new Date(draft.deadline).getTime() - now : 0;
  const made = board.filter((p) => p.player_id);
  const recent = [...made].sort((a, b) => b.overall! - a.overall!).slice(0, 12);
  const upcoming = board.filter((p) => !p.player_id && p.overall! > (draft?.current_overall ?? 0)).slice(0, 5);
  const tc = team(current?.team_id)?.color ?? '#4cc3ff';
  const [full, setFull] = useState(false);
  useEffect(() => {
    const f = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  const goFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); };
  // the board scrolls itself to the round on the clock
  useEffect(() => {
    document.getElementById(`tv-r${current?.round ?? 1}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current?.round]);
  const rounds = league?.draft_rounds ?? 0;
  const last = recent[0];
  const lastP = last?.player_id ? players.get(last.player_id) : undefined;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#050912] text-white" style={{ '--tc': tc } as React.CSSProperties}>
      {/* header: clock + on the clock + up next */}
      <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-6 py-4"
        style={{ background: `linear-gradient(110deg, color-mix(in oklab, ${tc} 45%, #0b1222), #0b1222 65%)` }}>
        <div className="flex items-center gap-6">
          <img src="./icon.svg" className="h-14 w-14 drop-shadow-[0_6px_16px_rgba(239,42,79,.45)]" alt="" />
          <div className="min-w-0">
            <div className="h-display text-shine text-3xl leading-none">SaK League Draft · {season}</div>
            <div className="mt-1 text-sm text-white/60">{league?.pick_seconds}s clock · {rounds} rounds · {league?.snake ? 'snake' : 'straight'} · {[...teams].filter((t) => online.has(t.id)).length} GMs in the room</div>
          </div>
          <div className="flex-1" />
          {status === 'live' || status === 'paused' ? current && (
            <>
              <div className="text-right">
                <div className="text-sm font-semibold uppercase tracking-[.2em] text-white/60">Round {current.round} · Pick {current.overall} of {board.length}</div>
                <div className="h-display truncate text-5xl leading-tight">{team(current.team_id)?.name}</div>
                <div className="text-lg text-white/75">GM {team(current.team_id)?.gm_name}{current.team_id !== current.original_team && ` · via ${team(current.original_team)?.abbrev}`}</div>
              </div>
              <ClockRing frac={status === 'paused' ? 1 : remaining / ((league?.pick_seconds ?? 90) * 1000)} color={readable(tc)} size={96}>
                <TeamBadge team={team(current.team_id)} size={72} />
              </ClockRing>
              <div className={`num font-display text-[7rem] font-extrabold leading-none ${remaining < 10_000 && status !== 'paused' ? 'animate-pulse text-red-400' : remaining < 30_000 ? 'text-amber-300' : 'text-white'}`}>
                {status === 'paused' ? '⏸' : countdown(remaining)}
              </div>
            </>
          ) : status === 'done' ? (
            <div className="h-display text-gold-shine text-5xl">🏁 Draft complete</div>
          ) : (
            <div className="text-right"><div className="text-sm uppercase tracking-[.2em] text-white/60">Puck drops in</div><div className="num font-display text-6xl font-extrabold">{league?.draft_at ? countdown(new Date(league.draft_at).getTime() - now) : 'TBD'}</div></div>
          )}
          <div className="ml-4 flex flex-col gap-1">
            <SoundToggle fallback />
            <button className="btn-ghost btn-sm" onClick={goFull} title="Full screen">{full ? <X size={16} /> : <Maximize2 size={16} />}<span className="hidden sm:inline">{full ? 'Exit' : 'Full screen'}</span></button>
            <Link to="/draft" className="btn-ghost btn-sm">← Draft room</Link>
          </div>
        </div>
        {upcoming.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-sm text-white/70">
            <span className="uppercase tracking-wider">Up next</span>
            {upcoming.map((p) => <span key={p.id} className="flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1"><TeamBadge team={team(p.team_id)} size={18} />{team(p.team_id)?.gm_name}<span className="text-white/40">#{p.overall}</span></span>)}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* the board */}
        <div className="min-w-0 flex-1 overflow-auto p-3">
          {board.length === 0 ? <div className="grid h-full place-items-center text-2xl text-white/50">The draft order hasn’t been set yet.</div> : (
            <table className="w-full border-separate border-spacing-1 text-sm">
              <thead className="sticky top-0 z-10 bg-[#050912]">
                <tr>
                  <th className="w-10" />
                  {order.map((t) => (
                    <th key={t} className="px-1 py-1.5 text-left">
                      <div className="flex items-center gap-1.5"><TeamBadge team={team(t)} size={24} /><span className="truncate font-bold">{team(t)?.gm_name}</span><span className="ml-auto text-xs text-white/40">{rosters.filter((r) => r.team_id === t).length}</span></div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="text-center text-xs font-bold text-white/40">K</td>
                  {order.map((t) => (
                    <td key={t} className="align-top">
                      <div className="rounded-lg border border-gold/20 bg-gold/[.06] p-1 text-xs">
                        {rosters.filter((r) => r.team_id === t && r.acquired === 'keeper').map((r) => players.get(r.player_id)).filter(Boolean).map((p) => (
                          <div key={p!.id} className="flex items-center gap-1 truncate"><Pos p={p!.pos} className="min-w-0 px-1 py-0" /><span className="truncate">{p!.last_name}</span></div>
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
                {Array.from({ length: rounds }).map((_, ri) => {
                  const round = ri + 1;
                  const row = board.filter((p) => p.round === round);
                  return (
                    <tr key={round} id={`tv-r${round}`}>
                      <td className="text-center text-base font-bold text-white/40">{round}</td>
                      {order.map((t) => {
                        const pk = row.find((p) => p.original_team === t);
                        if (!pk) return <td key={t} />;
                        const pl = pk.player_id ? players.get(pk.player_id) : undefined;
                        const isNow = pk.overall === draft?.current_overall && status !== 'done';
                        return (
                          <td key={t}>
                            <div style={pl ? { background: POS_BG[pl.pos], boxShadow: `inset 4px 0 0 ${readable(team(pk.team_id)?.color ?? '#888')}` } : undefined}
                              className={`h-14 rounded-lg border px-2 py-1 ${isNow ? 'pulse-ring border-goal bg-goal/20' : pl ? 'border-white/10' : 'border-dashed border-white/10'}`}>
                              <div className="flex items-center justify-between text-[11px] text-white/50"><span>#{pk.overall}{pk.auto ? ' 🤖' : ''}</span>{pk.team_id !== pk.original_team && <span>→{team(pk.team_id)?.abbrev}</span>}</div>
                              {pl ? <div className="flex items-center gap-1.5"><Pos p={pl.pos} className="min-w-0 px-1 py-0" /><span className="truncate text-base font-bold">{pl.last_name}</span><span className="ml-auto text-[11px] text-white/50">{pl.nhl_team}</span></div>
                                : isNow ? <div className="text-base font-bold text-goal">On the clock</div> : null}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* last pick + ticker */}
        <div className="flex w-80 shrink-0 flex-col border-l border-white/10 bg-[#080e1c]">
          {last && lastP && (
            <div className="shine border-b border-white/10 p-4" style={{ background: `radial-gradient(120% 100% at 0% 0%, ${team(last.team_id)?.color}, #0b1222 70%)` }}>
              <div className="text-[11px] font-bold uppercase tracking-[.2em] text-white/70">🚨 The pick is in · #{last.overall}</div>
              <div className="mt-2 flex items-center gap-3">
                <Headshot p={lastP} size={72} />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-white/80"><TeamBadge team={team(last.team_id)} size={16} />{team(last.team_id)?.name}</div>
                  <div className="h-display text-shine truncate text-2xl leading-tight">{lastP.name}</div>
                  <div className="text-xs text-white/70"><Pos p={lastP.pos} /> {lastP.nhl_team} · {fmtPts(lastP.proj, 0)} proj</div>
                </div>
              </div>
            </div>
          )}
          <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[.2em] text-white/50">Recent picks</div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2">
            {recent.slice(1).map((pk) => {
              const pl = players.get(pk.player_id!);
              return (
                <div key={pk.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                  <span className="num w-8 text-white/40">#{pk.overall}</span>
                  <TeamBadge team={team(pk.team_id)} size={22} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{pl?.name}</span>
                  <Pos p={pl?.pos ?? 'C'} className="min-w-0 px-1 py-0" />
                </div>
              );
            })}
            {made.length === 0 && <div className="p-4 text-sm text-white/40">Picks will roll in here.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
