// A day that's already been played: the lineup as it was frozen at each puck drop, every player's box-score
// line and SaK points, and the team's total for the day. Read-only; the same numbers the standings count.
import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fmtPts } from '../lib/format';
import { scoringLine } from './BoxScore';
import { Headshot, Pos } from './ui';
import type { Game, Player, Roster } from '../lib/types';

type Snap = { player_id: number; slot: string; game_id: number };
type PG = { player_id: number; nhl_team: string | null; fpts: number; stats: Record<string, number> };
const START = ['C', 'LW', 'RW', 'D', 'Util', 'G'];
const ORDER: Record<string, number> = { C: 0, LW: 1, RW: 2, D: 3, Util: 4, G: 5, BN: 6, IR: 7 };

export function PastDay({ day, roster, teamId, onInfo }: { day: string; roster: { r: Roster; p: Player }[]; teamId: number; onInfo: (id: number) => void }) {
  const { players, league } = useLeague();
  const [snaps, setSnaps] = useState<Snap[] | null>(null);
  const [pgs, setPgs] = useState<Map<number, PG>>(new Map());
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    let alive = true;
    setSnaps(null);
    (async () => {
      const [{ data: s }, { data: g }] = await Promise.all([
        supabase.from('lineup_snapshots').select('player_id,slot,game_id').eq('team_id', teamId).eq('date', day),
        supabase.from('games').select('*').eq('date', day),
      ]);
      const snapRows = (s ?? []) as Snap[];
      const ids = [...new Set([...snapRows.map((x) => x.player_id), ...roster.map((x) => x.p.id)])];
      const { data: p } = await supabase.from('league_games').select('player_id,nhl_team,fpts,stats').eq('date', day).in('player_id', ids);
      if (!alive) return;
      setSnaps(snapRows);
      setGames((g ?? []) as Game[]);
      setPgs(new Map(((p ?? []) as PG[]).map((r) => [r.player_id, { ...r, fpts: Number(r.fpts) }])));
    })();
    return () => { alive = false; };
  }, [day, teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!snaps) return [];
    const bySnap = new Map(snaps.map((s) => [s.player_id, s]));
    const ids = [...new Set([...snaps.map((s) => s.player_id), ...roster.map((x) => x.p.id)])];
    return ids.map((id) => {
      const p = players.get(id);
      const s = bySnap.get(id);
      const pg = pgs.get(id);
      const g = s ? games.find((x) => x.id === s.game_id) : undefined;
      // no freeze-frame: he had no game that day (or wasn't on the roster yet); show him on the bench
      const slot = s?.slot ?? roster.find((x) => x.p.id === id)?.r.slot ?? 'BN';
      return { id, p, slot, played: !!s, g, pg, starter: START.includes(slot) && !!s };
    }).filter((r) => r.p).sort((a, b) => (ORDER[a.slot] ?? 9) - (ORDER[b.slot] ?? 9) || (b.pg?.fpts ?? 0) - (a.pg?.fpts ?? 0));
  }, [snaps, pgs, games, roster, players]);

  const total = rows.filter((r) => r.starter).reduce((t, r) => t + (r.pg?.fpts ?? 0), 0);
  const benched = rows.filter((r) => !r.starter && r.played).reduce((t, r) => t + (r.pg?.fpts ?? 0), 0);
  const starters = rows.filter((r) => r.starter);
  const scored = starters.filter((r) => r.pg).length;
  const best = [...starters].sort((a, b) => (b.pg?.fpts ?? 0) - (a.pg?.fpts ?? 0))[0];
  const weights = (p: Player | undefined) => (p?.pos === 'G' ? league?.scoring.goalie : league?.scoring.skater) ?? {};
  const oppOf = (r: typeof rows[number]) => {
    if (!r.g) return null;
    const home = r.g.home === (r.pg?.nhl_team ?? r.p?.nhl_team);
    const opp = home ? r.g.away : r.g.home;
    const score = r.g.home_score != null ? `${home ? r.g.home_score : r.g.away_score}–${home ? r.g.away_score : r.g.home_score}` : '';
    return `${home ? 'vs' : '@'} ${opp}${score ? ` · ${score}` : ''}${r.g.period === 'OT' || r.g.period === 'SO' ? ` ${r.g.period}` : ''}`;
  };
  const dayName = new Date(day + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });

  if (snaps === null) return <div className="card p-4 text-sm text-mute">Loading {dayName}…</div>;
  return (
    <div className="space-y-3">
      <div className="card space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">{dayName}</div>
            <div className="text-xs text-mute">{snaps.length === 0 ? 'None of your players had a game that day.' : `The lineup as it was locked at each puck drop. ${scored} of ${starters.length} starters scored.`}</div>
          </div>
          <div className="text-right text-xs"><div className="num text-base font-bold text-emerald-300">{fmtPts(total, 2)}</div><div className="text-mute">points that day</div></div>
        </div>
        {snaps.length > 0 && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="chip">{starters.length} starters with a game</span>
            {benched > 0 && <span className="chip bg-amber-500/15 text-amber-200">{fmtPts(benched, 1)} left on the bench</span>}
            {best?.pg && <span className="chip bg-emerald-500/15 text-emerald-200">⭐ {best.p?.name} {fmtPts(best.pg.fpts, 1)}</span>}
          </div>
        )}
      </div>

      {snaps.length > 0 && (
        <div className="card overflow-hidden">
          <div className="scroll-x">
            <table className="w-full text-xs">
              <thead className="bg-white/[.03] text-[10px] uppercase tracking-wider text-mute">
                <tr>
                  <th className="sticky left-0 z-10 bg-rink px-2 py-1.5 text-left">Slot</th>
                  <th className="sticky left-[62px] z-10 bg-rink px-2 text-left">Player</th>
                  <th className="px-2 text-left">Game</th>
                  <th className="px-2 text-left">Box score</th>
                  <th className="px-2 text-right text-gold">SaK</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.05]">
                {rows.map((r) => {
                  const p = r.p!;
                  return (
                    <tr key={r.id} className={`${r.starter ? '' : 'text-slate-400'} ${r.starter && r.pg ? '' : 'opacity-80'}`}>
                      <td className="sticky left-0 z-10 bg-rink px-2 py-1"><Pos p={r.slot} className="w-10" /></td>
                      <td className="sticky left-[62px] z-10 max-w-[170px] bg-rink px-2">
                        <div className="flex items-center gap-1.5">
                          <Headshot p={p} size={22} />
                          <div className="min-w-0">
                            <button className="block truncate font-semibold text-slate-100 hover:underline" onClick={() => onInfo(p.id)}>{p.name}</button>
                            <div className="truncate text-[10px] text-mute">{p.elig.join('/')} · {r.pg?.nhl_team ?? p.nhl_team}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-2">{r.played ? <span className={r.starter ? 'text-emerald-300' : 'text-amber-200'}>{oppOf(r) ?? 'played'}</span> : <span className="text-white/20">no game</span>}</td>
                      <td className="whitespace-nowrap px-2 text-slate-300">{r.pg ? scoringLine(r.pg.stats, weights(p), p.pos === 'G') || <span className="text-mute">dressed, no scoring</span> : r.played ? <span className="text-mute">did not dress</span> : ''}</td>
                      <td className={`num whitespace-nowrap px-2 text-right font-semibold ${!r.pg ? 'text-white/20' : r.starter ? (r.pg.fpts < 0 ? 'text-red-300' : 'text-gold') : 'text-slate-400'}`}>{r.pg ? fmtPts(r.pg.fpts, 2) : '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/[.06] px-3 py-2 text-[11px] text-mute">Only players in a starting slot at puck drop count. Bench and IR points are shown but never added. Stat corrections from the NHL flow in for up to a month and can move a day's total slightly.</div>
        </div>
      )}
    </div>
  );
}
