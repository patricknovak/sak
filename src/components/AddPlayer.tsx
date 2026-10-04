import { useEffect, useMemo, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import type { Player } from '../lib/types';
import { fmtPts, injuryBack } from '../lib/format';
import { PlayerTag } from './PlayerCard';
import { Headshot, Pos, useAction } from './ui';
import { scoutNums, useScoutCtx } from './TradeScout';

// Adding a free agent: the player coming in at the top with his numbers, then your roster with the same numbers,
// weakest first, so you can see who he'd replace. With room on the roster dropping is optional (a GM may still want
// to swap a weak player out); with a full roster you pick who goes. Each row says how the player's rest of season
// compares with the one coming in.
export function AddPlayerPanel({ p, onCancel, onDone }: { p: Player; onCancel: () => void; onDone?: () => void }) {
  const { me, league, rosters, players, refresh } = useLeague();
  const c = useScoutCtx();
  const { busy, run } = useAction();
  const [drop, setDrop] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!me) return;
    supabase.from('pickup_status').select('remaining').eq('team_id', me.id).maybeSingle()
      .then(({ data }) => setLeft(data ? Number((data as { remaining: number }).remaining) : null));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cap = Object.entries(league?.roster ?? {}).filter(([k]) => k !== 'IR').reduce((t, [, v]) => t + v, 0);
  const mine = rosters.filter((x) => x.team_id === me?.id && x.slot !== 'IR');
  const full = mine.length >= cap;
  const pool = useMemo(() => mine.map((x) => players.get(x.player_id)).filter((x): x is Player => !!x)
    .map((x) => ({ x, n: scoutNums(x, c) })).sort((a, b) => a.n.ros - b.n.ros), [mine, players, c]); // eslint-disable-line react-hooks/exhaustive-deps
  const inN = scoutNums(p, c);
  const slotOf = (id: number) => mine.find((x) => x.player_id === id)?.slot;

  const add = () => run(async () => {
    await rpc('add_player', { p_add: p.id, p_drop: drop });
    await refresh(['rosters', 'standings']);
    onDone?.();
  }, drop ? `${p.name} added, ${players.get(drop)?.name} dropped` : `${p.name} added`);

  // one player's numbers in a row: this season (and per game), the last 14 days, and the rest of the way
  const nums = (n: ReturnType<typeof scoutNums>, proj: number) => (
    <div className="grid grid-cols-3 gap-1 text-center text-[11px]">
      <div><div className="num font-semibold text-slate-100">{n.gp ? fmtPts(n.fp, 1) : n.lastGp ? fmtPts(n.last, 0) : '–'}</div><div className="text-[10px] text-mute">{n.gp ? `FP · ${n.fpg != null ? n.fpg.toFixed(2) : '–'}/G` : n.lastGp ? '’25-26 FP' : 'no games'}</div></div>
      <div><div className="num font-semibold text-slate-100">{n.w['14'] ? fmtPts(n.w['14'].fp, 1) : '–'}</div><div className="text-[10px] text-mute">14d{n.w['14'] ? ` · ${n.w['14'].gp} GP` : ''}</div></div>
      <div><div className="num font-semibold text-slate-100">{fmtPts(n.ros, 0)}</div><div className="text-[10px] text-mute">ROS (proj {fmtPts(proj, 0)})</div></div>
    </div>
  );

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-sky-400/30 bg-sky-500/[.06] p-2.5">
      <div className="flex items-center gap-2">
        <Headshot p={p} size={34} />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1 text-sm">➕ <PlayerTag p={p} /> <Pos p={p.pos} /></div><div className="text-[11px] text-mute">{p.nhl_team}{injuryBack(p.injury_return) ? <span className="text-red-300"> · {injuryBack(p.injury_return)}</span> : ''}</div></div>
      </div>
      {nums(inN, p.proj)}
      <div className="text-xs text-slate-300">
        {full ? <>Your roster is full ({mine.length}/{cap}). Pick who goes to make room.</> : <>You have room ({mine.length}/{cap}). Dropping someone is optional.</>}
        {left != null && <span className="text-mute"> This uses 1 of your {left} pickup{left === 1 ? '' : 's'} left.</span>}
      </div>
      <div className="max-h-80 divide-y divide-white/[.06] overflow-y-auto rounded-xl border border-line bg-black/20">
        {!full && (
          <label className={`flex cursor-pointer items-center gap-2 px-2.5 py-2 text-sm ${drop == null ? 'bg-sky-500/15' : ''}`}>
            <input type="radio" name="drop" className="h-4 w-4 accent-sky-400" checked={drop == null} onChange={() => setDrop(null)} />
            <span className="flex-1">Keep everyone, just add {p.name.split(' ').slice(-1)[0]}</span>
          </label>
        )}
        {pool.map(({ x, n }) => {
          const diff = inN.ros - n.ros;
          return (
            <label key={x.id} className={`flex cursor-pointer items-center gap-2 px-2.5 py-2 ${drop === x.id ? 'bg-amber-500/15' : ''}`}>
              <input type="radio" name="drop" className="h-4 w-4 shrink-0 accent-amber-400" checked={drop === x.id} onChange={() => setDrop(x.id)} />
              <Headshot p={x} size={26} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-1.5 text-[13px]"><PlayerTag p={x} /> <span className="text-[10px] font-normal text-mute">{x.elig.join('/')} · {slotOf(x.id)}{injuryBack(x.injury_return) ? ` · ${injuryBack(x.injury_return)}` : ''}</span></div>
                <div className={`text-[10px] ${diff > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{diff > 0 ? `${p.name.split(' ').slice(-1)[0]} projects ${fmtPts(diff, 0)} more ROS` : `projects ${fmtPts(-diff, 0)} more ROS than ${p.name.split(' ').slice(-1)[0]}`}</div>
                {nums(n, x.proj)}
              </div>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" disabled={busy || (full && drop == null)} onClick={add}>
          {drop ? `Add ${p.name.split(' ').slice(-1)[0]}, drop ${players.get(drop)?.name.split(' ').slice(-1)[0]}` : full ? 'Pick who goes' : `Add ${p.name.split(' ').slice(-1)[0]}`}
        </button>
        <button className="btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-[10px] text-mute">FP: fantasy points this season (per game). 14d: the last 14 days. ROS: what he projects to score the rest of the season, from the projection blended with this season's pace.</p>
    </div>
  );
}
