// Lineup New, the read: how well the team's lineups have done against the best they could have been, and what the next
// two weeks hold (light nights, days with more players than places, who plays most, the goalies' back-to-backs, who is
// hot and who is cold). Each one ends in a tap to the day it is about.
import { useEffect, useState } from 'react';
import { CalendarClock, Flame, Gauge, Shield, Snowflake, Users } from 'lucide-react';
import { useLeague } from '../../lib/store';
import { rpc } from '../../lib/supabase';
import { addDays, hurt, isStart, monthDay, weekday, type Kit } from '../../lib/lineupKit';
import { Headshot } from '../ui';
import { GameStatusChip } from '../GameStatus';
import { fmt1 } from './bits';

type Eff = { team_id: number; date: string; game_type: number; points: number; best: number };

function Card({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold/15 text-gold">{icon}</span>
        <div className="min-w-0"><div className="font-semibold text-white">{title}</div>{sub && <div className="text-xs text-mute">{sub}</div>}</div>
      </div>
      {children}
    </div>
  );
}

export function InsightsView({ kit, teamId, onDay, onInfo }: { kit: Kit; teamId: number; onDay: (d: string) => void; onInfo: (id: number) => void }) {
  const { windows, season } = useLeague();
  const [eff, setEff] = useState<Eff[] | null>(null);
  useEffect(() => {
    rpc<Eff[]>('lineup_efficiency', { p_from: addDays(kit.today, -7), p_to: addDays(kit.today, -1) })
      .then((x) => setEff((x ?? []).filter((r) => r.team_id === teamId).sort((a, b) => a.date.localeCompare(b.date))), () => setEff([]));
  }, [teamId, kit.today]);
  const roster = kit.rosterOf(teamId);
  const next7 = Array.from({ length: 7 }, (_, i) => addDays(kit.today, i));
  const next14 = Array.from({ length: 14 }, (_, i) => addDays(kit.today, i));

  // the last week: points against the best lineup the same players allowed, in hindsight
  const scored = (eff ?? []).reduce((t, r) => t + Number(r.points), 0), best = (eff ?? []).reduce((t, r) => t + Number(r.best), 0);
  const pct = best > 0 ? Math.round((scored / best) * 100) : null;
  const maxBest = Math.max(1, ...(eff ?? []).map((r) => Number(r.best)));

  // light nights ahead, with who plays in them
  const lights = next14.filter((d) => kit.light(d)).map((d) => ({ d, n: kit.nightSize(d), who: roster.filter((x) => kit.gameFor(x.p.nhl_team, d) && !hurt(x.p)), slots: kit.lineupOf(teamId, d).slots }));

  // days with more healthy players than places for them
  const skaterSlots = ['C', 'LW', 'RW', 'D', 'Util'].reduce((t, s) => t + (kit.caps[s] ?? 0), 0), gSlots = kit.caps.G ?? 0;
  const crunch = next7.map((d) => {
    const playing = roster.filter((x) => kit.gameFor(x.p.nhl_team, d) && !hurt(x.p) && x.r.slot !== 'IR');
    const sk = playing.filter((x) => x.p.pos !== 'G').length, g = playing.filter((x) => x.p.pos === 'G').length;
    return { d, sk, g, over: Math.max(0, sk - skaterSlots) + Math.max(0, g - gSlots), short: Math.max(0, skaterSlots - sk) + Math.max(0, gSlots - g) };
  });

  // who plays most in the next week
  const games = roster.filter((x) => x.r.slot !== 'IR').map((x) => ({ x, n: next7.filter((d) => kit.gameFor(x.p.nhl_team, d)).length, l: next7.filter((d) => kit.gameFor(x.p.nhl_team, d) && kit.light(d)).length }))
    .sort((a, b) => b.n - a.n || b.l - a.l || kit.expPts(b.x.p) - kit.expPts(a.x.p));

  // goalies: their club's games and the back-to-backs, when one of the pair usually rests
  const goalies = roster.filter((x) => x.p.pos === 'G').map((x) => ({ x, ds: next7.filter((d) => kit.gameFor(x.p.nhl_team, d)) }));

  // form: the last 14 days against the season, per game
  const form = roster.map((x) => {
    const w = windows.get(x.p.id)?.['14'], s = season.get(x.p.id);
    if (!w || w.gp < 3 || !s || s.gp < 5) return null;
    return { x, recent: w.fpts / w.gp, base: s.fpts / s.gp };
  }).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ ...f, delta: f.recent - f.base }));
  const hot = [...form].sort((a, b) => b.delta - a.delta).filter((f) => f.delta > 0.15).slice(0, 3);
  const cold = [...form].sort((a, b) => a.delta - b.delta).filter((f) => f.delta < -0.15).slice(0, 3);

  return (
    <div className="space-y-3">
      <Card icon={<Gauge className="h-5 w-5" />} title="The last seven days" sub="Points scored against the best lineup the same players allowed, in hindsight">
        {eff === null ? <div className="h-20 animate-pulse rounded-xl bg-white/[.04]" /> : !eff.length ? <div className="text-sm text-mute">No scored days in the last week.</div> : (
          <>
            <div className="mb-3 flex items-end gap-4">
              <div><div className="num font-display text-3xl font-extrabold text-white">{pct}%</div><div className="text-[11px] text-mute">of the best possible</div></div>
              <div><div className="num text-xl font-black text-amber-200">{fmt1(best - scored)}</div><div className="text-[11px] text-mute">left on the bench</div></div>
            </div>
            <div className="flex h-24 items-end gap-1.5">
              {eff.map((r) => (
                <button key={r.date + r.game_type} type="button" onClick={() => onDay(r.date)} className="flex flex-1 flex-col items-center gap-1" title={`${monthDay(r.date)}: ${fmt1(Number(r.points))} of ${fmt1(Number(r.best))}`}>
                  <span className="relative w-full flex-1">
                    <span className="absolute inset-x-0 bottom-0 rounded-t bg-white/10" style={{ height: `${(Number(r.best) / maxBest) * 100}%` }} />
                    <span className="absolute inset-x-0 bottom-0 rounded-t bg-gold" style={{ height: `${(Number(r.points) / maxBest) * 100}%` }} />
                  </span>
                  <span className="text-[9px] font-bold uppercase text-mute">{weekday(r.date)}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-mute">Gold is what scored, grey the best the same players could have. A night can look worse in hindsight than it was when the lineup was set.</p>
          </>
        )}
      </Card>

      <Card icon={<CalendarClock className="h-5 w-5" />} title="Light nights ahead" sub="Five NHL games or fewer: a starter of yours is likelier to be one who plays">
        {!lights.length ? <div className="text-sm text-mute">No light nights in the next two weeks.</div> : (
          <div className="space-y-2">
            {lights.map((l) => (
              <button key={l.d} type="button" onClick={() => onDay(l.d)} className="flex w-full items-center gap-3 rounded-xl bg-sky-400/[.06] px-3 py-2 text-left ring-1 ring-sky-400/20">
                <span className="w-12 shrink-0 text-center"><span className="block text-[10px] font-bold uppercase text-sky-200">{weekday(l.d)}</span><span className="block text-sm font-black text-white">{monthDay(l.d)}</span></span>
                <span className="min-w-0 flex-1 text-xs text-slate-300">
                  <b className="text-white">{l.n} games.</b> {l.who.length ? <>{l.who.length} of yours play: {l.who.map((x) => <span key={x.p.id} className={isStart(l.slots.get(x.p.id)) ? 'text-emerald-200' : 'text-amber-200'}>{x.p.last_name ?? x.p.name}{isStart(l.slots.get(x.p.id)) ? '' : ' (bench)'}</span>).reduce<React.ReactNode[]>((t, e, i) => (i ? [...t, ', ', e] : [e]), [])}</> : 'None of yours play.'}
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card icon={<Users className="h-5 w-5" />} title="Places this week" sub="Healthy players with a game against the places to start them">
        <div className="grid grid-cols-7 gap-1.5">
          {crunch.map((c) => (
            <button key={c.d} type="button" onClick={() => onDay(c.d)} className={`rounded-xl px-1 py-2 text-center ring-1 ${c.over ? 'bg-amber-400/10 ring-amber-400/30' : c.short ? 'bg-red-400/[.06] ring-red-400/20' : 'bg-white/[.03] ring-white/10'}`}>
              <span className="block text-[9px] font-bold uppercase text-mute">{c.d === kit.today ? 'Tdy' : weekday(c.d)}</span>
              <span className="num block text-base font-black text-white">{c.sk + c.g}</span>
              <span className={`block text-[9px] font-bold ${c.over ? 'text-amber-200' : c.short ? 'text-red-200' : 'text-emerald-200'}`}>{c.over ? `${c.over} sit` : c.short ? `${c.short} open` : 'fits'}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-mute">{skaterSlots} skater places and {gSlots} in goal. "Sit" means someone healthy with a game has nowhere to go; "open" means a place with nobody to fill it, a day to pick someone up for.</p>
      </Card>

      <Card icon={<CalendarClock className="h-5 w-5" />} title="Games in the next seven days">
        <div className="space-y-1">
          {games.slice(0, 12).map(({ x, n, l }) => (
            <button key={x.p.id} type="button" onClick={() => onInfo(x.p.id)} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-white/[.04]">
              <Headshot p={x.p} size={24} />
              <span className="w-28 shrink-0 break-words text-xs font-semibold text-white">{x.p.last_name ?? x.p.name}</span>
              <span className="flex flex-1 gap-0.5">{Array.from({ length: 7 }, (_, i) => <span key={i} className={`h-2.5 flex-1 rounded-sm ${i < n ? (i < l ? 'bg-sky-400' : 'bg-emerald-400/70') : 'bg-white/[.06]'}`} />)}</span>
              <span className="num w-6 shrink-0 text-right text-xs font-black text-white">{n}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-mute">Blue: light-night games. Games are a chance to score, not points in the bank.</p>
      </Card>

      {goalies.length > 0 && (
        <Card icon={<Shield className="h-5 w-5" />} title="Goalie watch" sub="A club's back-to-back usually means one start each">
          <div className="space-y-2">
            {goalies.map(({ x, ds }) => (
              <div key={x.p.id} className="flex items-center gap-2.5">
                <Headshot p={x.p} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5"><button type="button" className="break-words text-sm font-semibold text-white hover:underline" onClick={() => onInfo(x.p.id)}>{x.p.name}</button><GameStatusChip id={x.p.id} /></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {next7.map((d) => {
                      const has = ds.includes(d), b2b = has && ds.includes(addDays(d, -1));
                      return <span key={d} className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${!has ? 'bg-white/[.03] text-white/25' : b2b ? 'bg-amber-400/15 text-amber-200' : 'bg-emerald-400/15 text-emerald-200'}`}>{weekday(d)}{b2b ? ' B2B' : ''}</span>;
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(hot.length > 0 || cold.length > 0) && (
        <Card icon={<Flame className="h-5 w-5" />} title="Form" sub="Points a game over the last 14 days against the season">
          <div className="grid gap-3 sm:grid-cols-2">
            {[{ list: hot, icon: <Flame className="h-4 w-4 text-orange-300" />, label: 'Hot' }, { list: cold, icon: <Snowflake className="h-4 w-4 text-sky-300" />, label: 'Cold' }].map((c) => c.list.length > 0 && (
              <div key={c.label}>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[.16em] text-mute">{c.icon} {c.label}</div>
                {c.list.map((f) => (
                  <button key={f.x.p.id} type="button" onClick={() => onInfo(f.x.p.id)} className="flex w-full items-center gap-2 py-1 text-left">
                    <Headshot p={f.x.p} size={24} /><span className="min-w-0 flex-1 break-words text-xs font-semibold text-white">{f.x.p.name}</span>
                    <span className="num shrink-0 text-xs"><b className="text-white">{f.recent.toFixed(2)}</b><span className="text-mute"> / {f.base.toFixed(2)}</span></span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
