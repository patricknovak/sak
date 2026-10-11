// The live room on the scoreboard: who's watching tonight, and the night's swings as they happen (every point a starter
// scores, every goal and final in a game with a starter in it), newest first, each with the room's reactions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useLeague } from '../lib/store';
import { REACTIONS, swingWords, useLiveRoom, type Swing } from '../lib/liveRoom';
import { fmtPts, fmtTime, ordinal } from '../lib/format';
import { Move, NhlLogo, TeamBadge } from './ui';
import { PlayerTag } from './PlayerCard';
import type { Game } from '../lib/types';

const SHOW = 8;

export function LiveRoomCard({ slate, onGame }: { slate: Game[]; onGame?: (gameId: number) => void }) {
  const { me, team } = useLeague();
  const room = useLiveRoom();
  const [all, setAll] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const games = useMemo(() => new Map(slate.map((g) => [g.id, g])), [slate]);
  // a game's swings only where a starter is in it: the room is about the league's night, not every NHL goal
  const ours = useMemo(() => new Set(room.night?.snaps.filter((s) => s.slot !== 'BN' && s.slot !== 'IR').map((s) => s.game_id) ?? []), [room.night]);
  const climbs = useClimbs(room.status === 'live');
  // the room's swings, with the league's own climbs up the standings (as the pools' rooms show them) in among them
  const list = useMemo(() => [...room.swings.filter((s) => s.kind === 'p' || ours.has(s.game)), ...climbs].sort((a, b) => a.at.localeCompare(b.at)).reverse(), [room.swings, ours, climbs]);
  if (room.status === 'off') return null;
  const shown = all ? list : list.slice(0, SHOW);
  const firstEarly = shown.findIndex((s) => s.early);
  const watching = room.watching.map((id) => team(id)).filter(Boolean);

  return (
    <section className="card overflow-hidden" aria-label="Live room">
      <div className="flex items-center gap-3 border-b border-white/[.06] bg-gradient-to-r from-goal/[.10] via-transparent to-transparent px-3 py-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          {room.status === 'live' && <span className="absolute inset-0 animate-ping rounded-full bg-goal/60" />}
          <span className={`relative h-2.5 w-2.5 rounded-full ${room.status === 'live' ? 'bg-goal' : 'bg-slate-500'}`} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-extrabold uppercase leading-none tracking-wide">Live room</div>
          <div className="mt-1 text-[11px] leading-tight text-mute">{room.status === 'live' ? 'Every swing, as it lands' : 'Joining the room…'}</div>
        </div>
        {watching.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5" title={watching.map((t) => t!.gm_name).join(', ')}>
            <div className="flex -space-x-2">
              {watching.slice(0, 5).map((t) => <span key={t!.id} className="rounded-full ring-2 ring-[#0d1628]"><TeamBadge team={t} size={24} /></span>)}
            </div>
            <span className="num text-[11px] font-semibold text-slate-200">{watching.length}<span className="font-normal text-mute"> watching</span></span>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs leading-relaxed text-mute">
          Swings land here as they happen: every point a starter scores, every goal and final in a game with a starter in it.
        </div>
      ) : (
        <ul className="divide-y divide-white/[.05]">
          {shown.map((s, i) => (
            <li key={s.id}>
              {i === firstEarly && <div className="bg-white/[.02] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-mute">Earlier tonight</div>}
              {s.kind === 'climb'
                ? <ClimbSwing s={s as Climb} mine={(s as Climb).team === me?.id} />
                : s.kind === 'p'
                ? <PlayerSwing s={s as Swing} mine={s.team === me?.id} game={games.get(s.game)} picking={picking === s.id} onPick={() => setPicking(picking === s.id ? null : s.id)}
                    onReact={(e) => { room.react(s.id, e); setPicking(null); }} myTeam={me?.id} />
                : <GameSwing s={s as Swing} game={games.get((s as Swing).game)} onOpen={onGame} />}
            </li>
          ))}
        </ul>
      )}
      {list.length > SHOW && (
        <button type="button" className="w-full border-t border-white/[.06] px-3 py-2 text-center text-xs font-semibold text-sky-300 transition hover:bg-white/[.03]" onClick={() => setAll(!all)}>
          {all ? 'Show the latest' : `The whole night · ${list.length} swings`}
        </button>
      )}
    </section>
  );


}

// one starter's swing: who scored for whom, what he did, the points, and the room's reactions
function PlayerSwing({ s, mine, game, picking, onPick, onReact, myTeam }: { s: Swing; mine: boolean; game?: Game; picking: boolean; onPick: () => void; onReact: (e: string) => void; myTeam?: number }) {
  const { players, team } = useLeague();
  const p = players.get(s.player!);
  const t = team(s.team);
  const w = swingWords(s.what);
  const up = (s.d ?? 0) >= 0;
  const big = !!(s.what?.g || s.what?.w || s.what?.sho);
  // the reactions, counted, with the teams behind each
  const counts = REACTIONS.map((e) => ({ e, teams: Object.entries(s.rx ?? {}).filter(([, v]) => v === e).map(([k]) => Number(k)) })).filter((x) => x.teams.length);
  const club = p?.nhl_team;
  const opp = game && club ? (game.home === club ? `vs ${game.away}` : `@ ${game.home}`) : null;
  return (
    <div className={`px-3 py-2.5 ${mine ? 'bg-sky-400/[.05]' : ''} ${s.early ? 'opacity-80' : ''}`}>
      <div className="flex items-start gap-2.5">
        <TeamBadge team={t} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm leading-tight">
            <span className={`text-[11px] font-extrabold uppercase tracking-wide ${big ? 'text-goal' : up ? 'text-emerald-300' : 'text-red-300'}`}>{big && !s.early ? '🚨 ' : ''}{w.head}</span>
            {p ? <PlayerTag p={p} /> : <span className="font-semibold">Player {s.player}</span>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-tight text-mute">
            <span className="font-semibold text-slate-300">{t?.gm_name ?? 'A team'}</span>
            {opp && <><span className="text-white/20">·</span><span className="inline-flex items-center gap-1">{club && <NhlLogo abbr={club} size={12} />}{opp}</span></>}
            {w.rest && <><span className="text-white/20">·</span><span>{w.rest}</span></>}
            <span className="text-white/20">·</span><span>{fmtTime(s.at)}</span>
          </div>
          {(counts.length > 0 || picking) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {counts.map(({ e, teams }) => (
                <button key={e} type="button" onClick={() => onReact(e)} title={teams.map((id) => team(id)?.gm_name).join(', ')}
                  className={`num inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition ${myTeam && teams.includes(myTeam) ? 'border-sky-400/50 bg-sky-400/15' : 'border-white/10 bg-white/[.04] hover:bg-white/[.08]'}`}>
                  <span>{e}</span><span className="text-[10px] font-semibold text-slate-200">{teams.length}</span>
                </button>
              ))}
              {picking && REACTIONS.filter((e) => !counts.some((c) => c.e === e)).map((e) => (
                <button key={e} type="button" onClick={() => onReact(e)} className="animate-slideup rounded-full border border-white/10 bg-white/[.06] px-1.5 py-0.5 text-sm transition hover:scale-110" aria-label={`React ${e}`}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`num rounded-lg px-1.5 py-0.5 text-sm font-extrabold ${up ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>{up ? '+' : ''}{fmtPts(s.d)}</span>
          <button type="button" onClick={onPick} aria-label="React" aria-expanded={picking}
            className={`grid h-7 w-7 place-items-center rounded-full transition ${picking ? 'bg-white/10 text-slate-100' : 'text-mute hover:bg-white/[.06] hover:text-slate-200'}`}>
            <SmilePlus size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

// a game in the night: puck drop, the score moving, the final; a tap opens the game's thread
function GameSwing({ s, game, onOpen }: { s: Swing; game?: Game; onOpen?: (gameId: number) => void }) {
  if (!game) return null;
  const [a, h] = s.score ?? [null, null];
  const final = ['OFF', 'FINAL'].includes(s.state ?? '');
  const label = final ? `Final${s.period && !['3', 'REG'].includes(String(s.period)) ? `/${s.period}` : ''}` : a == null ? 'Puck drop' : `${/^\d$/.test(String(s.period)) ? ordinal(Number(s.period)) : s.period ?? ''} ${s.clock ?? ''}`.trim();
  return (
    <button type="button" onClick={() => onOpen?.(game.id)} disabled={!onOpen} title="Open this game's thread"
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition enabled:hover:bg-white/[.03] ${s.early ? 'opacity-80' : ''}`}>
      <span className="w-12 shrink-0 text-[10px] font-bold uppercase tracking-wider text-mute">{final ? 'Final' : a == null ? 'Start' : 'Goal'}</span>
      <span className="min-w-0 flex-1">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-slate-200">
          <NhlLogo abbr={game.away} size={16} />{game.away}<span className="num font-extrabold text-white">{a ?? ''}</span>
          <span className="text-mute">–</span>
          <span className="num font-extrabold text-white">{h ?? ''}</span>{game.home}<NhlLogo abbr={game.home} size={16} />
        </span>
        <span className="block text-[11px] text-mute">{label} · {fmtTime(s.at)}</span>
      </span>
      {onOpen && <span className="shrink-0 text-[11px] font-semibold text-sky-300">💬 Thread ›</span>}
    </button>
  );
}

// a team climbing the standings tonight, worked out on the phone from the standings the store reads as points move
type Climb = { id: number; at: string; kind: 'climb'; early?: boolean; team: number; from: number; to: number };
function useClimbs(on: boolean) {
  const { standings } = useLeague();
  const last = useRef<Map<number, number> | null>(null);
  const [climbs, setClimbs] = useState<Climb[]>([]);
  useEffect(() => {
    const now = new Map(standings.map((s) => [s.team_id, s.rank]));
    const was = last.current;
    last.current = now;
    if (!on || !was || !standings.some((s) => Number(s.points) !== 0)) return;
    const at = new Date().toISOString();
    const up = standings.filter((s) => (was.get(s.team_id) ?? s.rank) > s.rank).map((s, i) => ({ id: -(Date.now() * 10 + i), at, kind: 'climb' as const, team: s.team_id, from: was.get(s.team_id)!, to: s.rank }));
    if (up.length) setClimbs((c) => [...c, ...up].slice(-20));
  }, [standings, on]);
  return climbs;
}

function ClimbSwing({ s, mine }: { s: Climb; mine: boolean }) {
  const { team } = useLeague();
  const t = team(s.team);
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 text-sm ${mine ? 'bg-sky-400/[.06]' : ''}`}>
      <TeamBadge team={t} size={26} />
      <span className="min-w-0 flex-1 leading-tight"><b className="text-slate-100">{t?.gm_name ?? 'A team'}</b> <span className="text-slate-300">climbs to {ordinal(s.to)} in the standings</span><span className="block text-[11px] text-mute">{fmtTime(s.at)}</span></span>
      <span className="num shrink-0 rounded-lg bg-emerald-400/15 px-1.5 py-0.5 text-xs font-extrabold"><Move n={s.from - s.to} /></span>
    </div>
  );
}
