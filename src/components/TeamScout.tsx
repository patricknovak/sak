import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpDown, ClipboardList, Repeat2, Scale } from 'lucide-react';
import { useLeague } from '../lib/store';
import type { DraftPick, Player } from '../lib/types';
import { fmtPts, readable } from '../lib/format';
import { PlayerRow } from './PlayerCard';
import { Pos, Section, TeamBadge } from './ui';

// starting slots per position: how many players at each spot actually score for you
const NEED: Record<string, number> = { C: 2, LW: 2, RW: 2, D: 3, G: 2 };
const POS = ['C', 'LW', 'RW', 'D', 'G'];
type Sort = 'value' | 'proj' | 'last' | 'pos';

// value of a team's best starters at one position (a player counts at his primary position)
const posStrength = (ps: Player[], pos: string, val: (p: Player) => number) =>
  ps.filter((p) => p.pos === pos).map(val).sort((a, b) => b - a).slice(0, NEED[pos]).reduce((t, v) => t + v, 0);

export function TeamScout({ teamId, hideRoster }: { teamId: number; hideRoster?: boolean }) {
  const { me, teams, team, rosters, players, picks, season, league, draft } = useLeague();
  const nav = useNavigate();
  const mine = teamId === me?.id;
  const inSeason = league?.phase === 'season';
  const [sort, setSort] = useState<Sort>('value');
  const [want, setWant] = useState<Set<number>>(new Set());
  const [wantPicks, setWantPicks] = useState<Set<number>>(new Set());

  // in season, value = points scored so far plus rest-of-season pace; before it, the projection
  const val = (p: Player) => (inSeason ? (season.get(p.id)?.fpts ?? 0) + p.proj * 0.5 : p.proj);
  const rosterOf = (t: number) => rosters.filter((r) => r.team_id === t).map((r) => players.get(r.player_id)).filter(Boolean) as Player[];
  const theirs = useMemo(() => rosterOf(teamId), [rosters, players, teamId]);

  const strength = useMemo(() => {
    const all = teams.map((t) => ({ t: t.id, ps: rosterOf(t.id) }));
    return POS.map((pos) => {
      const vals = all.map((x) => ({ t: x.t, v: posStrength(x.ps, pos, val) }));
      const avg = vals.reduce((s, x) => s + x.v, 0) / Math.max(1, vals.length);
      const rank = [...vals].sort((a, b) => b.v - a.v).findIndex((x) => x.t === teamId) + 1;
      return { pos, their: vals.find((x) => x.t === teamId)?.v ?? 0, mine: vals.find((x) => x.t === me?.id)?.v ?? 0, avg, max: Math.max(1, ...vals.map((x) => x.v)), rank };
    });
  }, [teams, rosters, players, season, teamId, me?.id, inSeason]);

  // trade fit: where they're deep and you're thin, and the reverse
  const fit = useMemo(() => {
    if (mine) return null;
    const theyHave = strength.filter((s) => s.their > s.avg * 1.08 && s.mine < s.avg * 0.97).map((s) => s.pos);
    const theyNeed = strength.filter((s) => s.their < s.avg * 0.92 && s.mine > s.avg * 1.03).map((s) => s.pos);
    return { theyHave, theyNeed };
  }, [strength, mine]);

  const sorted = useMemo(() => [...theirs].sort((a, b) =>
    sort === 'pos' ? POS.indexOf(a.pos) - POS.indexOf(b.pos) || b.proj - a.proj
      : sort === 'proj' ? b.proj - a.proj : sort === 'last' ? b.last_fp - a.last_fp : val(b) - val(a)), [theirs, sort, season]);

  // picks this team owns for this draft and next year's
  const seasons = [...new Set(picks.map((k) => k.season))].sort();
  const owned = (s: string) => picks.filter((k) => k.season === s && k.team_id === teamId && !k.player_id).sort((a, b) => a.round - b.round);
  const pickLabel = (k: DraftPick) => `R${k.round}${k.overall ? ` #${k.overall}` : ''}${k.original_team !== k.team_id ? ` · via ${team(k.original_team)?.abbrev}` : ''}`;

  const flip = (s: Set<number>, set: (x: Set<number>) => void, id: number) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); set(n); };
  const askValue = [...want].reduce((t, id) => t + (players.get(id) ? val(players.get(id)!) : 0), 0);
  const t = team(teamId);
  const tradeOpen = league?.phase !== 'draft';

  return (
    <div className="space-y-4">
      <Section icon={<Scale size={16} className="text-blue" />} title={mine ? 'Team strength vs. the league' : `${t?.gm_name}'s strength vs. yours`}>
        <div className="card space-y-2.5 p-3">
          {strength.map((s) => (
            <div key={s.pos} className="flex items-center gap-2">
              <Pos p={s.pos} className="w-10" />
              <div className="relative flex-1 space-y-1">
                <div className="h-2.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full" style={{ width: `${(s.their / s.max) * 100}%`, background: readable(t?.color ?? '#4cc3ff') }} /></div>
                {!mine && <div className="h-1.5 overflow-hidden rounded-full bg-white/[.05]"><div className="h-full rounded-full opacity-80" style={{ width: `${(s.mine / s.max) * 100}%`, background: readable(me?.color ?? '#888') }} /></div>}
                <div className="absolute -top-0.5 bottom-[-2px] w-0.5 rounded bg-white/60" style={{ left: `${(s.avg / s.max) * 100}%` }} title="League average" />
              </div>
              <div className="w-16 text-right text-[11px]"><div className="num font-bold">{fmtPts(s.their, 0)}</div><div className="text-mute">#{s.rank} of {teams.length}</div></div>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 border-t border-white/[.07] pt-2 text-[11px] text-mute">
            <span className="flex items-center gap-1"><span className="h-2 w-4 rounded-full" style={{ background: readable(t?.color ?? '#4cc3ff') }} />{mine ? 'You' : t?.gm_name}</span>
            {!mine && <span className="flex items-center gap-1"><span className="h-1.5 w-4 rounded-full" style={{ background: readable(me?.color ?? '#888') }} />You</span>}
            <span className="flex items-center gap-1"><span className="h-3 w-0.5 bg-white/60" />League average</span>
            <span className="ml-auto">{inSeason ? 'Points so far + rest-of-season pace' : 'Projected points'} from each position’s starters</span>
          </div>
          {fit && (fit.theyHave.length > 0 || fit.theyNeed.length > 0) && (
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/[.07] p-2.5 text-sm">
              💡 {fit.theyHave.length > 0 && <>They’re deep at <b>{fit.theyHave.join(', ')}</b>, where you’re thin. </>}
              {fit.theyNeed.length > 0 && <>They need <b>{fit.theyNeed.join(', ')}</b>, and you have depth there. </>}
              That’s your trade.
            </div>
          )}
        </div>
      </Section>

      {!hideRoster && <Section title={`${mine ? 'Your' : `${t?.gm_name}'s`} roster (${theirs.length})`} right={
        <label className="flex items-center gap-1 text-xs text-mute"><ArrowUpDown size={12} />
          <select className="rounded-lg border border-white/10 bg-black/30 px-1.5 py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="value">{inSeason ? 'Value' : 'Projection'}</option><option value="proj">Projection</option><option value="last">2025-26 pts</option><option value="pos">Position</option>
          </select>
        </label>}>
        <div className="card divide-y divide-white/[.06] overflow-hidden">
          <div className="flex items-center gap-2 bg-white/[.03] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">
            {!mine && tradeOpen && <span className="w-6">Ask</span>}<span className="flex-1">Player</span><span className="w-12 text-right">{inSeason ? 'Szn' : '25-26'}</span><span className="w-12 text-right">Proj</span>
          </div>
          {sorted.map((p) => {
            const on = want.has(p.id);
            return (
              <div key={p.id} className={`flex items-center gap-2 px-3 py-2 transition ${on ? 'bg-sky-400/[.12] shadow-[inset_3px_0_0_#4cc3ff]' : ''}`}>
                {!mine && tradeOpen && me?.role !== 'spectator' && (
                  <button aria-label={on ? 'Remove from trade' : 'Ask for in a trade'} onClick={() => flip(want, setWant, p.id)}
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-xs font-bold ${on ? 'border-sky-300 bg-sky-400 text-ice' : 'border-white/20'}`}>{on ? '✓' : ''}</button>
                )}
                <div className="min-w-0 flex-1"><PlayerRow p={p} onClick={() => nav(`/player/${p.id}`)} /></div>
                <span className="num w-12 text-right text-sm">{fmtPts(inSeason ? season.get(p.id)?.fpts ?? 0 : p.last_fp, 0)}</span>
                <span className="num w-12 text-right text-sm font-bold">{fmtPts(p.proj, 0)}</span>
              </div>
            );
          })}
          {theirs.length === 0 && <div className="p-3 text-sm text-mute">No players yet.</div>}
        </div>
      </Section>}

      <Section icon={<ClipboardList size={16} className="text-blue" />} title="Draft picks">
        <div className="grid gap-3 sm:grid-cols-2">
          {seasons.map((s) => {
            const list = owned(s);
            const traded = picks.filter((k) => k.season === s && k.original_team === teamId && k.team_id !== teamId && !k.player_id);
            return (
              <div key={s} className="card p-3">
                <div className="mb-2 flex items-center justify-between"><span className="font-bold">{s} draft{s === draft?.season ? '' : ' (next year)'}</span><span className="text-xs text-mute">{list.length} picks</span></div>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((k) => {
                    const on = wantPicks.has(k.id);
                    const early = k.round <= 3;
                    return !mine && tradeOpen ? (
                      <button key={k.id} onClick={() => flip(wantPicks, setWantPicks, k.id)}
                        className={`chip py-1 ${on ? 'border-sky-300 bg-sky-400 text-ice' : early ? 'border-gold/30 text-gold' : ''}`}>{on ? '✓ ' : ''}{pickLabel(k)}</button>
                    ) : <span key={k.id} className={`chip py-1 ${early ? 'border-gold/30 text-gold' : ''}`}>{pickLabel(k)}</span>;
                  })}
                  {list.length === 0 && <span className="text-sm text-mute">None left.</span>}
                </div>
                {traded.length > 0 && <div className="mt-2 text-[11px] text-mute">Traded away: {traded.map((k) => `R${k.round} → ${team(k.team_id)?.abbrev}`).join(', ')}</div>}
              </div>
            );
          })}
          {seasons.length === 0 && <div className="card p-3 text-sm text-mute">No picks created yet.</div>}
        </div>
      </Section>

      {!mine && tradeOpen && (
        <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] z-20 lg:bottom-3">
          <div className="card flex items-center gap-3 p-2.5 shadow-2xl" style={{ background: 'linear-gradient(135deg, rgba(76,195,255,.18), rgba(11,18,34,.95) 55%)' }}>
            <TeamBadge team={t} size={30} />
            <div className="min-w-0 flex-1 text-sm">
              {want.size + wantPicks.size === 0 ? <span className="text-slate-300">Tick players or picks you want, then build the offer.</span>
                : <><b>Ask for {want.size} player{want.size === 1 ? '' : 's'}{wantPicks.size ? ` + ${wantPicks.size} pick${wantPicks.size === 1 ? '' : 's'}` : ''}</b><div className="text-[11px] text-mute">{fmtPts(askValue, 0)} pts of value</div></>}
            </div>
            <button className="btn-primary shrink-0" onClick={() => {
              const q = new URLSearchParams({ with: String(teamId) });
              if (want.size) q.set('get', [...want].join(','));
              if (wantPicks.size) q.set('getPicks', [...wantPicks].join(','));
              nav(`/trades?${q}`);
            }}><Repeat2 size={16} /> Build trade</button>
          </div>
        </div>
      )}
    </div>
  );
}
