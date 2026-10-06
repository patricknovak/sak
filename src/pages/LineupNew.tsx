// Lineup New (#/lineup-new): the lineup reimagined beside the old one, so the league can compare and move over
// (Patrick, 5 October 2026, from the research in docs/DEVELOPMENT.md's knowledge base). One place for any team's lineup
// on any day: Day (two-tap moves, warnings with fixes, the optimizer as a list of changes), Week (the grid of who plays
// when, tap to start or bench), Compare (any two teams, slot by slot or across a week) and Insights (efficiency, light
// nights, places this week, games ahead, goalies, form). Another team's lineups are read only.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Columns2, Lightbulb, ListChecks, Sparkles, Trophy } from 'lucide-react';
import { useLeague } from '../lib/store';
import { usePlayerInfo } from '../lib/playerInfo';
import { addDays, monthDay, weekday, useLineupKit } from '../lib/lineupKit';
import { PageHeader, TeamBadge } from '../components/ui';
import { PastDay } from '../components/PastDay';
import { SaveProvider } from '../components/lineupnew/bits';
import { DayView } from '../components/lineupnew/DayView';
import { WeekView } from '../components/lineupnew/WeekView';
import { CompareView } from '../components/lineupnew/CompareView';
import { InsightsView } from '../components/lineupnew/InsightsView';
import { LeagueView } from '../components/lineupnew/LeagueView';
import { supabase } from '../lib/supabase';
import { useSticky } from '../lib/sticky';
import { LineupTools } from '../components/LineupTools';
import { Settings2 } from 'lucide-react';

type Tab = 'day' | 'week' | 'league' | 'compare' | 'insights';
const TABS: { k: Tab; label: string; icon: typeof ListChecks }[] = [
  { k: 'day', label: 'Day', icon: ListChecks }, { k: 'week', label: 'Week', icon: CalendarDays },
  { k: 'league', label: 'League', icon: Trophy }, { k: 'compare', label: 'Compare', icon: Columns2 }, { k: 'insights', label: 'Insights', icon: Lightbulb },
];

export default function LineupNew() {
  const { me, teams, standings, league } = useLeague();
  const kit = useLineupKit(30);
  const openInfo = usePlayerInfo();
  const onInfo = (id: number) => openInfo?.(id);
  const [tab, setTab] = useSticky<Tab>('lineupnew:tab', 'day');
  const [teamId, setTeamId] = useState<number | null>(me?.id ?? null);
  const [day, setDay] = useState(kit.today);
  const [tools, setTools] = useState(false);
  const gms = teams.filter((t) => t.role !== 'spectator');
  // compare against the team just above in the standings by default (the one to catch), else the next one down
  const [other, setOther] = useState<number | null>(null);
  const tid = teamId ?? me?.id ?? gms[0]?.id ?? null;
  useEffect(() => { if (!teamId && me) setTeamId(me.id); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (other || !tid) return;
    const order = [...standings].sort((a, b) => a.rank - b.rank).map((s) => s.team_id);
    const i = order.indexOf(tid);
    setOther(order[i - 1] ?? order[i + 1] ?? gms.find((t) => t.id !== tid)?.id ?? null);
  }, [tid, standings]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tid) kit.loadPlans([tid]); }, [tid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (gms.length) kit.loadPlans(gms.map((t) => t.id)); }, [gms.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const readOnly = tid !== me?.id;
  const team = gms.find((t) => t.id === tid);

  // the strip: a week back to a month ahead, each day with its NHL slate and how this team stands on it
  const start = league?.season_start && league.season_start > addDays(kit.today, -7) ? league.season_start : addDays(kit.today, -7);
  const days = useMemo(() => { const out: string[] = []; for (let d = start; d <= addDays(kit.today, 30); d = addDays(d, 1)) out.push(d); return out; }, [start, kit.today]);
  const [past, setPast] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!tid) return;
    supabase.from('team_daily').select('date,points').eq('team_id', tid).gte('date', start).lt('date', kit.today)
      .then(({ data }) => setPast(new Map((data ?? []).map((r) => [r.date, Number(r.points)]))));
  }, [tid, start, kit.today]);
  const strip = useRef<HTMLDivElement>(null);
  const todayBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { const el = strip.current, b = todayBtn.current; if (el && b) el.scrollLeft = Math.max(0, b.offsetLeft - el.offsetLeft - 70); }, [days.length, tab]);

  const pastPts = (d: string) => past.get(d) ?? null;
  if (!tid || !team) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  return (
    <SaveProvider kit={kit}>
      <div className="space-y-4 pb-24">
        <PageHeader icon={<Sparkles className="h-6 w-6 text-gold" />} title="Lineup New" sub="Set, plan and compare every lineup, any day" right={<span className="flex items-center gap-2">{me?.role === 'gm' && <button type="button" onClick={() => setTools(true)} className="inline-flex items-center gap-1 rounded-full bg-white/[.06] px-2.5 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10"><Settings2 className="h-3.5 w-3.5" /> Auto-pilot{me.auto_mode && me.auto_mode !== 'off' ? ' on' : ''}</button>}<Link to="/team" className="text-xs font-semibold text-sky-300">Classic →</Link></span>} />
        {me && <LineupTools open={tools} onClose={() => setTools(false)} roster={kit.rosterOf(me.id)} />}

        {/* whose lineup */}
        <div className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
          {[...gms].sort((a, b) => Number(b.id === me?.id) - Number(a.id === me?.id)).map((t) => (
            <button key={t.id} type="button" onClick={() => { setTeamId(t.id); if (t.id === other) setOther(null); }}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs font-semibold ring-1 transition ${t.id === tid ? 'bg-gold/20 text-white ring-gold/60' : 'bg-white/[.04] text-slate-300 ring-white/10'}`}>
              <TeamBadge team={t} size={24} /> {t.id === me?.id ? 'My team' : t.gm_name}
            </button>
          ))}
        </div>
        {readOnly && (
          <div className="flex items-center gap-2 rounded-2xl bg-white/[.04] px-3 py-2 text-xs text-slate-300 ring-1 ring-white/10">
            <TeamBadge team={team} size={22} /> <span className="min-w-0 flex-1">Looking at <b className="text-white">{team.name}</b>. Read only: only {team.gm_name} can change it.</span>
          </div>
        )}

        {/* the days */}
        {tab !== 'insights' && (
          <div ref={strip} className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
            {days.map((d) => {
              const st = d >= kit.today ? kit.dayStats(tid, d) : null;
              const on = d === day, past = d < kit.today;
              const warn = st && !readOnly && (st.empty > 0 || st.benched > 0);
              const n = kit.nightSize(d);
              return (
                <button key={d} ref={d === kit.today ? todayBtn : undefined} type="button" onClick={() => setDay(d)}
                  className={`relative flex w-[54px] shrink-0 flex-col items-center rounded-2xl border px-1 py-1.5 transition ${on ? 'border-gold bg-gold/15 shadow-[0_0_18px_rgb(var(--gold-rgb)/.2)]' : kit.light(d) ? 'border-sky-400/25 bg-sky-400/[.06]' : past ? 'border-white/[.05] bg-black/20' : 'border-white/[.08] bg-white/[.03]'}`}>
                  <span className="text-[9px] font-bold uppercase text-mute">{d === kit.today ? 'Today' : weekday(d)}</span>
                  <span className={`text-base font-black leading-tight ${past ? 'text-slate-400' : 'text-white'}`}>{monthDay(d).replace(/^\w+ /, '')}</span>
                  <span className={`text-[9px] font-bold ${kit.light(d) ? 'text-sky-300' : 'text-mute'}`}>{n ? `${n} gms` : 'none'}</span>
                  {past && <span className={`num mt-0.5 rounded-full px-1.5 text-[10px] font-black ${pastPts(d) != null ? 'bg-gold/15 text-gold' : 'bg-white/[.05] text-mute'}`}>{pastPts(d) != null ? Math.round(pastPts(d)!) : '–'}</span>}
                  {st && <span className={`num mt-0.5 rounded-full px-1.5 text-[10px] font-black ${st.benched > 0 ? 'bg-amber-400/20 text-amber-200' : st.playing ? 'bg-emerald-400/20 text-emerald-200' : 'bg-white/[.05] text-mute'}`}>{st.playing}</span>}
                  {warn && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-300" />}
                </button>
              );
            })}
          </div>
        )}

        {/* the views */}
        <div className="sticky top-[calc(env(safe-area-inset-top)+4rem+var(--banner,0px))] z-20 -mx-1 px-1 lg:top-2">
          <div className="grid grid-cols-5 gap-1 rounded-2xl bg-[#0b1220]/90 p-1 ring-1 ring-white/10 backdrop-blur">
            {TABS.map(({ k, label, icon: I }) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition ${tab === k ? 'bg-gold text-[#0b1220]' : 'text-white/70'}`}>
                <I className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'day' && (day < kit.today ? <PastDay day={day} roster={kit.rosterOf(tid)} teamId={tid} onInfo={onInfo} /> : <DayView kit={kit} teamId={tid} day={day} readOnly={readOnly} onInfo={onInfo} onLeague={() => setTab('league')} />)}
        {tab === 'week' && <WeekView kit={kit} teamId={tid} from={day} readOnly={readOnly} onDay={(d) => { setDay(d); setTab('day'); }} onInfo={onInfo} />}
        {tab === 'league' && <LeagueView kit={kit} day={day} onView={(id) => { setTeamId(id); setTab('day'); }} onCompare={(id) => { setTeamId(me?.id ?? null); setOther(id); setTab('compare'); }} />}
        {tab === 'compare' && <CompareView kit={kit} teamId={tid} other={other} setOther={setOther} day={day} onInfo={onInfo} />}
        {tab === 'insights' && <InsightsView kit={kit} teamId={tid} onDay={(d) => { setDay(d); setTab('day'); }} onInfo={onInfo} />}
      </div>
    </SaveProvider>
  );
}
