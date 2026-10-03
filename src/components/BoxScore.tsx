// A game's box score, from the same numbers the league scores: every skater and goalie who dressed, the stats
// the league counts, and each player's SaK points. SaK-rostered players are marked with their GM.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { fmtPts, fmtTime, STAT_LABELS } from '../lib/format';
import { NhlLogo, Sheet } from './ui';
import type { Game } from '../lib/types';

type PG = { player_id: number; nhl_team: string | null; fpts: number; stats: Record<string, number> };
const SKATER = ['g', 'a', 'pm', 'sog', 'hit', 'blk', 'pim', 'ppp'];
const GOALIE = ['sa', 'sv', 'ga', 'w'];

// every stat the league scores that isn't zero: "1 G · 4 HIT · 2 BLK · 2 PIM"
export function scoringLine(stats: Record<string, number>, weights: Record<string, number>, goalie: boolean) {
  const keys = goalie ? ['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'] : ['g', 'a', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow', 'fol'];
  return keys.filter((k) => (weights[k] || k === 'sv' || k === 'ga') && stats[k])
    .map((k) => (k === 'pm' ? `${stats[k] > 0 ? '+' : ''}${stats[k]}` : `${stats[k]} ${STAT_LABELS[k] ?? k}`)).join(' · ');
}

export function BoxScore({ game, onClose }: { game: Game | null; onClose: () => void }) {
  const { players, owner, team, league } = useLeague();
  const [rows, setRows] = useState<PG[] | null>(null);
  useEffect(() => {
    if (!game) return;
    let alive = true;
    const load = () => supabase.from('league_games').select('player_id,nhl_team,fpts,stats').eq('game_id', game.id)
      .then(({ data }) => { if (alive) setRows(((data ?? []) as PG[]).map((r) => ({ ...r, fpts: Number(r.fpts) }))); });
    setRows(null);
    load();
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => { alive = false; window.clearInterval(i); };
  }, [game?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sides = useMemo(() => {
    if (!game || !rows) return [];
    return [game.away, game.home].map((abbr) => {
      const mine = rows.filter((r) => r.nhl_team === abbr).map((r) => ({ ...r, p: players.get(r.player_id) }));
      const goalie = (r: typeof mine[number]) => r.p?.pos === 'G' || r.stats.sv != null;
      return {
        abbr,
        skaters: mine.filter((r) => !goalie(r)).sort((a, b) => b.fpts - a.fpts),
        goalies: mine.filter(goalie).sort((a, b) => (b.stats.sa ?? 0) - (a.stats.sa ?? 0)),
      };
    });
  }, [game, rows, players]);

  if (!game) return null;
  const live = ['LIVE', 'CRIT'].includes(game.state), done = ['OFF', 'FINAL'].includes(game.state);
  const status = done ? 'Final' : live ? `${/^\d+$/.test(game.period ?? '') ? 'P' + game.period : game.period ?? ''} ${game.clock ?? ''}`.trim() || 'Live' : fmtTime(game.start_utc);
  const owned = (id: number) => { const r = owner.get(id); return r ? team(r.team_id) : undefined; };
  const Name = ({ id, name }: { id: number; name?: string }) => {
    const t = owned(id);
    return (
      <Link to={`/player/${id}`} onClick={onClose} className="flex min-w-0 items-center gap-1 hover:underline">
        <span className="truncate">{name ?? `#${id}`}</span>
        {t && <span className="shrink-0 rounded px-1 text-[9px] font-bold" style={{ background: `${t.color}33`, color: '#fff' }} title={`${t.name} (${t.gm_name})`}>{t.gm_name}</span>}
      </Link>
    );
  };
  return (
    <Sheet open={!!game} onClose={onClose} wide title={
      <span className="flex items-center gap-2"><NhlLogo abbr={game.away} size={20} />{game.away} {game.away_score ?? ''} <span className="text-mute">@</span> {game.home} {game.home_score ?? ''}<NhlLogo abbr={game.home} size={20} /><span className={`ml-1 text-xs ${live ? 'text-goal' : 'text-mute'}`}>{status}</span></span>
    }>
      {rows === null ? <div className="py-8 text-center text-sm text-mute">Loading the box score…</div>
        : rows.length === 0 ? <div className="py-8 text-center text-sm text-mute">No box score yet: it fills in once the puck drops (about a minute behind the NHL).</div>
        : (
          <div className="space-y-4">
            {sides.map((s) => (
              <div key={s.abbr}>
                <div className="mb-1 flex items-center gap-1.5 font-semibold"><NhlLogo abbr={s.abbr} size={18} />{s.abbr}</div>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-right text-xs">
                    <thead className="bg-boards/60 text-mute"><tr><th className="px-2 py-1.5 text-left">Skater</th><th className="px-2 text-gold">SaK</th>{SKATER.map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}</tr></thead>
                    <tbody className="divide-y divide-white/[.05]">
                      {s.skaters.map((r) => (
                        <tr key={r.player_id} className={owned(r.player_id) ? 'bg-sky-500/[.06]' : ''}>
                          <td className="max-w-[150px] px-2 py-1 text-left"><Name id={r.player_id} name={r.p?.name} /></td>
                          <td className={`num px-2 font-semibold ${r.fpts < 0 ? 'text-red-300' : 'text-gold'}`}>{fmtPts(r.fpts, 1)}</td>
                          {SKATER.map((k) => <td key={k} className="num px-1.5">{k === 'pm' && (r.stats[k] ?? 0) > 0 ? '+' : ''}{r.stats[k] ?? 0}</td>)}
                        </tr>
                      ))}
                    </tbody>
                    <thead className="bg-boards/60 text-mute"><tr><th className="px-2 py-1.5 text-left">Goalie</th><th className="px-2 text-gold">SaK</th>{GOALIE.map((k) => <th key={k} className="px-1.5">{STAT_LABELS[k]}</th>)}<th colSpan={SKATER.length - GOALIE.length} /></tr></thead>
                    <tbody className="divide-y divide-white/[.05]">
                      {s.goalies.map((r) => (
                        <tr key={r.player_id} className={owned(r.player_id) ? 'bg-sky-500/[.06]' : ''}>
                          <td className="max-w-[150px] px-2 py-1 text-left"><Name id={r.player_id} name={r.p?.name} /></td>
                          <td className={`num px-2 font-semibold ${r.fpts < 0 ? 'text-red-300' : 'text-gold'}`}>{fmtPts(r.fpts, 1)}</td>
                          {GOALIE.map((k) => <td key={k} className="num px-1.5">{r.stats[k] ?? 0}</td>)}
                          <td colSpan={SKATER.length - GOALIE.length} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-mute">SaK = fantasy points under this league’s scoring ({Object.entries(league?.scoring.skater ?? {}).map(([k, v]) => `${STAT_LABELS[k] ?? k} ${v}`).join(', ')}). Highlighted players are on a SaK roster. Refreshes every minute. <a className="text-sky-300 hover:underline" href={`https://www.nhl.com/gamecenter/${game.id}`} target="_blank" rel="noreferrer">Full game centre on NHL.com →</a></p>
          </div>
        )}
    </Sheet>
  );
}
