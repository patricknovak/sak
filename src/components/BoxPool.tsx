// The box pool (migration 188): the hockey pool without a draft night. The best players are dealt into evenly matched
// boxes, forwards first, then defence, then the goalies, and each member takes one player from every box. Goals and
// assists count, a goalie's wins and shutouts too, from the pool's first night to its last. Until the first puck drop
// the team can change; after it, each player shows what he has scored and how many took him, and everyone's team shows.
// The host can fill one in for a member who asked.
import { useMemo, useState } from 'react';
import { Check, Info, Lock, Users } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { usePlayerInfo } from '../lib/playerInfo';
import type { Player } from '../lib/types';
import { Headshot, NhlLogo, Pos, Section, TeamBadge, useAction } from './ui';

export interface BoxPlayer {
  id: number; name: string; pos: string; team: string; headshot: string | null; injury: string | null;
  pts: number; g: number; a: number; gp: number; left: number; games: number; taken: number | null;
  // what he's expected to add in his club's games still to come (migration 193; older servers don't send it)
  to_come?: number;
  season: Record<string, number> | null;
}
export interface BoxData {
  locks_at: string | null; locked: boolean; from: string; to: string; scoring: { g: number; a: number; w: number; sho: number };
  nights: number; nights_left: number; boxes: { label: string; pos: 'F' | 'D' | 'G'; players: BoxPlayer[] }[];
  mine: number[] | null; picked: number; teams: { team_id: number; players: number[] }[] | null;
}

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const lockText = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'at the first puck drop');
// a player for the shared headshot: initials from his name when there's no photo
const face = (p: BoxPlayer) => ({ headshot: p.headshot, nhl_team: p.team, first: p.name.split(' ')[0], last_name: p.name.split(' ').slice(1).join(' ') }) as unknown as Player;
// what he's expected to do this season, in a few words
const outlook = (p: BoxPlayer) => {
  const s = p.season ?? {};
  return p.pos === 'G' ? `${Math.round(s.w ?? 0)} W · ${Math.round(s.sho ?? 0)} SO a season` : `${Math.round(s.g ?? 0)} G · ${Math.round(s.a ?? 0)} A a season`;
};
const last = (name: string) => name.split(' ').slice(1).join(' ') || name;

export function BoxPoolGame({ gameId, data, status, reload, actAs }: {
  gameId: number; data: BoxData; status: 'open' | 'done'; reload: () => void; actAs?: { team: number; name: string };
}) {
  const { teams } = useLeague();
  const { busy, run } = useAction();
  const info = usePlayerInfo();
  const saved = actAs ? [] : data.mine ?? [];
  const [draft, setDraft] = useState<(number | null)[] | null>(null);
  const picks = draft ?? data.boxes.map((_, i) => saved[i] ?? null);
  const open = status === 'open' && !data.locked;
  const byId = useMemo(() => new Map(data.boxes.flatMap((b) => b.players).map((p) => [p.id, p])), [data.boxes]);
  const done = picks.filter((x) => x != null).length;
  const total = data.boxes.length;
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(data.boxes.map((_, i) => saved[i] ?? null));
  const myPts = picks.reduce<number>((s, id) => s + (id != null ? byId.get(id)?.pts ?? 0 : 0), 0);
  const comeOf = (ids: (number | null)[]) => ids.reduce<number>((s, id) => s + (id != null ? Number(byId.get(id)?.to_come ?? 0) : 0), 0);
  const myCome = comeOf(picks);
  const choose = (box: number, id: number) => setDraft(picks.map((x, i) => (i === box ? id : x)));
  const save = () => run(async () => {
    const pick = { players: picks };
    if (actAs) await rpc('pool_host_pick', { p_game: gameId, p_team: actAs.team, p_pick: { thing: 'box', pick } });
    else await rpc('pool_game_pick', { p_game: gameId, p_thing: 'box', p_pick: pick });
    setDraft(null); reload();
  }, actAs ? `${actAs.name}'s team is in` : 'Your team is in');
  const sc = data.scoring;
  const scoring = [`Goal ${sc.g}`, `Assist ${sc.a}`, `Goalie win ${sc.w}`, sc.sho ? `Shutout +${sc.sho}` : null].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      {/* the team so far, and the window */}
      <div className="card-hero p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/20 text-2xl">🏒</span>
          <div className="min-w-0 flex-1">
            <div className="label">{actAs ? `${actAs.name}'s team` : 'Your team'}</div>
            <div className="font-display text-xl font-extrabold text-white">
              {open ? `${done} of ${total} picked` : `${myPts} ${myPts === 1 ? 'point' : 'points'}`}
            </div>
            <div className="text-[11px] text-mute">{open ? `Locks ${lockText(data.locks_at)}${done && myCome ? ` · about ${Math.round(myCome)} points expected` : ''}` : data.locked && status === 'open' ? `${data.nights_left} of ${data.nights} nights left${myCome ? ` · about ${Math.round(myCome)} more to come` : ''}` : 'Over'}</div>
          </div>
          {!open && <Lock className="h-4 w-4 shrink-0 text-mute" />}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-full bg-white/[.06] px-2.5 py-1 font-semibold text-white ring-1 ring-white/10">{day(data.from)} to {day(data.to)}</span>
          <span className="rounded-full bg-white/[.06] px-2.5 py-1 text-slate-200 ring-1 ring-white/10">{scoring}</span>
        </div>
      </div>

      {data.boxes.map((b, bi) => (
        <Section key={b.label} title={b.label} right={<span className="text-xs text-mute">{open ? (picks[bi] != null ? last(byId.get(picks[bi]!)?.name ?? '') : 'Take one') : `Box ${bi + 1}`}</span>}>
          <div className="card divide-y divide-white/[.05] p-1">
            {b.players.map((p) => {
              const on = picks[bi] === p.id;
              const hurt = p.injury && p.injury !== 'Day-To-Day';
              return (
                <div key={p.id} className={`flex items-center gap-2.5 rounded-xl px-2 py-2 ${on ? 'bg-gold/[.12] ring-1 ring-gold/60' : ''}`}>
                  <button type="button" disabled={!open || busy} onClick={() => choose(bi, p.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:cursor-default">
                    <Headshot p={face(p)} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="text-[14px] font-semibold leading-tight text-white">{p.name}</span>
                        {p.injury && <span className={`rounded px-1 py-px text-[9px] font-black uppercase ${hurt ? 'bg-red-500/20 text-red-200' : 'bg-amber-400/15 text-amber-200'}`}>{p.injury === 'Day-To-Day' ? 'DTD' : p.injury}</span>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-mute">
                        <NhlLogo abbr={p.team} size={14} /><Pos p={p.pos} />
                        <span>{open ? outlook(p) : p.pos === 'G' ? `${p.gp} GP` : `${p.g} G · ${p.a} A`}</span>
                        {!open && <span>· {p.left} left{p.to_come ? ` · ≈${Math.round(Number(p.to_come))} more` : ''}</span>}
                      </span>
                    </span>
                  </button>
                  {/* picking: what he's expected to score in the pool's nights */}
                  {open && (
                    <span className="shrink-0 text-right">
                      <span className="num block text-base font-black leading-none text-white">{p.to_come != null ? `≈${Number(p.to_come).toFixed(1)}` : p.games}</span>
                      <span className="block text-[10px] text-mute">{p.to_come != null ? `in ${p.games} GP` : 'games'}</span>
                    </span>
                  )}
                  {!open && (
                    <span className="shrink-0 text-right">
                      <span className="num block text-lg font-black leading-none text-white">{p.pts}</span>
                      {p.taken != null && <span className="block text-[10px] text-mute">{p.taken} took</span>}
                    </span>
                  )}
                  {open && on && <Check className="h-5 w-5 shrink-0 text-gold" strokeWidth={3} />}
                  {info && <button type="button" aria-label={`${p.name}'s card`} onClick={() => info(p.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mute hover:bg-white/[.06]"><Info className="h-4 w-4" /></button>}
                </div>
              );
            })}
          </div>
        </Section>
      ))}

      {open && !dirty && !actAs && data.mine && (
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-mute"><Check className="h-3.5 w-3.5 text-emerald-300" /> Your team is in. Change any box until the first puck drop.</p>
      )}
      {open && (dirty || actAs || !data.mine) && (
        <div className="sticky bottom-20 z-10">
          <button type="button" className="btn-gold w-full py-3 shadow-xl shadow-black/40" disabled={busy || done < total || (!dirty && !actAs && !!data.mine)} onClick={save}>
            {done < total ? `${total - done} ${total - done === 1 ? 'box' : 'boxes'} still to pick` : actAs ? `Save ${actAs.name}'s team` : data.mine ? (dirty ? 'Save my changes' : 'Your team is in') : 'Lock in my team'}
          </button>
        </div>
      )}

      {data.teams && data.teams.length > 0 && (
        <Section title="Everyone's team" icon={<Users className="h-4 w-4" />}>
          <div className="card divide-y divide-white/[.05] p-1">
            {[...data.teams].map((t) => ({ ...t, pts: t.players.reduce((s, id) => s + (byId.get(id)?.pts ?? 0), 0), come: comeOf(t.players) })).sort((a, b) => b.pts - a.pts).map((t) => {
              const tm = teams.find((x) => x.id === t.team_id);
              return (
                <div key={t.team_id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <TeamBadge team={tm} size={28} />
                    <span className="min-w-0 flex-1 break-words text-sm font-semibold text-white">{tm?.gm_name ?? tm?.name}</span>
                    <span className="shrink-0 text-right"><span className="num block text-lg font-black leading-none text-white">{t.pts}</span>{status === 'open' && t.come > 0 && <span className="block text-[10px] text-mute">≈{Math.round(t.come)} to come</span>}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.players.map((id) => { const p = byId.get(id); return p && (
                      <span key={id} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${p.pts > 0 ? 'bg-gold/10 text-white ring-gold/30' : 'bg-white/[.04] text-slate-300 ring-white/10'}`}>
                        {last(p.name)} <b className="num">{p.pts}</b>
                      </span>); })}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
