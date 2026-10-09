// A centre for a competition played in rounds (#/centre/<competition>, docs/POOL-TYPES.md §5): soccer's matchweeks and
// the NFL's weeks, beside baseball's bracket centre. Round by round: every match with its score, the minute or the
// quarter while it is on, and, in a pool that runs a pick'em on it, your pick and the pool's split once it kicks off.
// The table is worked out from the results the feed keeps (points for soccer, the record for the NFL). It reads the
// shared tables soccer-sync fills (fixtures, clubs), every minute while a match is on.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, ListOrdered, Radio, Tv } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { Empty, PageHeader } from '../components/ui';
import { Crest } from '../components/Crest';
import { usePoolGames, type Club } from './Picks';
import type { PickemData, PkFixture } from '../components/Pickem';
import { useSticky } from '../lib/sticky';

interface Fixture {
  id: number; kickoff: string; date: string; state: 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled'; status: string | null; minute: number | null;
  gameweek: number | null; round: string | null; home_club: number; away_club: number; home_score: number | null; away_score: number | null; venue: string | null;
  // the market's view at kick-off (migration 178): each side's chance, the home side's spread, the total
  detail: { odds?: { home: number; away: number; draw: number | null; line: number | null; total: number | null } } | null;
}
interface Competition {
  id: string; name: string; short: string | null; sport: string; tz: string;
  // its divisions or conferences (migration 207): each a name, its parent and its clubs by short name
  detail?: { groups?: Group[]; group_word?: string; parent_word?: string } | null;
}
interface Group { name: string; parent?: string; clubs: string[] }
type Side = 'H' | 'D' | 'A';

// what each sport calls things here; soccer's are the default
const SPORTS: Record<string, { centre: string; round: string; game: string; draws: boolean; awayFirst: boolean }> = {
  soccer: { centre: 'Match centre', round: 'Matchweek', game: 'match', draws: true, awayFirst: false },
  nfl: { centre: 'NFL centre', round: 'Week', game: 'game', draws: false, awayFirst: true },
};
const QUARTER: Record<string, string> = { '1Q': 'Q1', '2Q': 'Q2', '3Q': 'Q3', '4Q': 'Q4', HT: 'Half', OT: 'OT', '1H': 'Q1', '2H': 'Q3' };
const dayLabel = (iso: string, tz: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz });
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const done = (f: Fixture) => f.state === 'final' || f.state === 'postponed' || f.state === 'cancelled';

function useCompetition(id: string) {
  const [comp, setComp] = useState<Competition | null | undefined>(undefined);
  const [clubs, setClubs] = useState<Map<number, Club>>(new Map());
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const load = useCallback(async () => {
    const { data: cs } = await supabase.from('competitions').select('id,name,short,sport,tz,detail').eq('id', id).limit(1);
    const c = (cs?.[0] as Competition | undefined) ?? null;
    setComp(c);
    if (!c) return;
    const [{ data: cl }, { data: fx }] = await Promise.all([
      supabase.from('clubs').select('id,name,short,logo,color').eq('sport', c.sport),
      supabase.from('fixtures').select('id,kickoff,date,state,status,minute,gameweek,round,home_club,away_club,home_score,away_score,venue,detail')
        .eq('competition', id).not('gameweek', 'is', null).order('kickoff').limit(2000),
    ]);
    setClubs(new Map(((cl ?? []) as Club[]).map((x) => [x.id, x])));
    setFixtures((fx ?? []) as Fixture[]);
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const live = fixtures.some((f) => f.state === 'live');
  const now = useNow(live ? 60000 : 600000);
  useEffect(() => { load(); }, [now]); // eslint-disable-line react-hooks/exhaustive-deps
  return { comp, clubs, fixtures, live };
}

// the pool's pick'em on this competition, for the round shown: your pick and the split on each match
function usePoolRound(competition: string, round: number | null) {
  const { kind } = useLeague();
  const { games } = usePoolGames();
  const g = games?.find((x) => x.kind === 'pickem' && x.competition === competition);
  const [board, setBoard] = useState<PickemData | null>(null);
  useEffect(() => {
    if (kind !== 'predict' || !g || round == null) { setBoard(null); return; }
    rpc<PickemData>('pool_pickem_board', { p_game: g.id, p_round: round }).then(setBoard, () => setBoard(null));
  }, [g?.id, round, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const byFixture = new Map((board?.round === round ? board.fixtures : []).map((f) => [f.id, f]));
  return { gameId: g?.id, byFixture, inGame: board != null && round != null && round >= board.from_round && round <= board.to_round };
}

function MatchCard({ f, clubs, sp, pk }: { f: Fixture; clubs: Map<number, Club>; sp: (typeof SPORTS)[string]; pk?: PkFixture }) {
  const home = clubs.get(f.home_club), away = clubs.get(f.away_club);
  const live = f.state === 'live', over = f.state === 'final';
  const clock = live ? (sp.awayFirst ? (QUARTER[f.status ?? ''] ?? f.status ?? 'Live') : f.minute != null ? `${f.minute}'` : (f.status === 'HT' ? 'Half-time' : 'Live')) : null;
  const row = (c: Club | undefined, side: 'home' | 'away') => {
    const s = side === 'home' ? f.home_score : f.away_score, o = side === 'home' ? f.away_score : f.home_score;
    const won = over && s != null && o != null && s > o;
    const mine = pk?.mine?.pick === (side === 'home' ? 'H' : 'A');
    return (
      <div className={`flex items-center gap-3 ${over && !won ? 'opacity-60' : ''}`}>
        {c && <Crest c={c} size={30} />}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <span className="break-words font-bold text-white">{c?.name ?? 'To be decided'}</span>
          {mine && <span className="rounded-full bg-gold/20 px-1.5 text-[9px] font-black uppercase tracking-wider text-gold">Your pick</span>}
        </div>
        <span className={`num shrink-0 text-2xl font-black ${won ? 'text-white' : 'text-slate-300'}`}>{f.state === 'scheduled' ? '' : s ?? ''}</span>
      </div>
    );
  };
  const order: [Club | undefined, 'home' | 'away'][] = sp.awayFirst ? [[away, 'away'], [home, 'home']] : [[home, 'home'], [away, 'away']];
  const split = pk?.split;
  const total = split ? (split.H ?? 0) + (split.D ?? 0) + (split.A ?? 0) : 0;
  // what the market expected: the favourite and its chance, by how much, and the total
  const o = f.detail?.odds;
  const market = o ? (() => {
    const homeFav = o.home >= o.away;
    const fav = homeFav ? home : away, p = homeFav ? o.home : o.away;
    const by = o.line != null && o.line !== 0 ? Math.abs(o.line) : null;
    return `${fav?.short ?? fav?.name ?? ''} ${Math.round(p * 100)}%${sp.draws && o.draw != null ? ` · draw ${Math.round(o.draw * 100)}%` : ''}${by && !sp.draws ? ` · by ${by}` : ''}${o.total != null ? ` · ${sp.draws ? 'goals' : 'total'} ${o.total}` : ''}`;
  })() : null;
  return (
    <div className={`card overflow-hidden ${live ? 'border-red-400/40 shadow-[0_0_24px_rgba(248,113,113,.12)]' : ''}`}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[.06] px-3.5 py-2 text-[11px]">
        <span className="font-black uppercase tracking-[.14em] text-white">{sp.awayFirst ? `${away?.short ?? ''} @ ${home?.short ?? ''}` : `${home?.short ?? ''} v ${away?.short ?? ''}`}</span>
        {live ? <span className="inline-flex items-center gap-1.5 font-bold text-red-300"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" /></span>{clock}</span>
          : <span className="text-mute">{over ? (sp.awayFirst ? 'Final' : 'Full time') : f.state === 'postponed' ? 'Postponed' : f.state === 'cancelled' ? 'Called off' : time(f.kickoff)}</span>}
      </div>
      <div className="space-y-2.5 px-3.5 py-3">{order.map(([c, side]) => <div key={side}>{row(c, side)}</div>)}</div>
      {(pk?.mine?.pick === 'D' || (split && total > 0) || f.venue || market) && (
        <div className="space-y-1.5 border-t border-white/[.06] px-3.5 py-2 text-[11px] text-mute">
          {market && <div className="flex justify-between gap-2"><span>{f.state === 'scheduled' ? 'The market expects' : 'The market expected'}</span><b className="text-right font-semibold text-slate-200">{market}</b></div>}
          {pk?.mine?.pick === 'D' && <div><span className="rounded-full bg-gold/20 px-1.5 text-[9px] font-black uppercase tracking-wider text-gold">Your pick · a draw</span></div>}
          {split && total > 0 && (
            <div>
              <div className="mb-1 flex justify-between"><span>The pool picked</span><span>{pk?.picked ?? ''} {pk?.picked === 1 ? 'pick' : 'picks'}</span></div>
              {/* one bar split three ways (two without draws), each part labelled with its side */}
              <div className="flex h-2 overflow-hidden rounded-full bg-white/[.06]">
                {(sp.awayFirst ? ['A', 'D', 'H'] as Side[] : ['H', 'D', 'A'] as Side[]).filter((k) => (split[k] ?? 0) > 0).map((k, i) => (
                  <span key={k} className={`${k === 'H' ? 'bg-sky-400' : k === 'A' ? 'bg-gold' : 'bg-slate-400'} ${i ? 'ml-0.5' : ''}`} style={{ width: `${((split[k] ?? 0) / total) * 100}%` }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between gap-2">
                {(() => {
                  const part = (k: Side) => Math.round(((split[k] ?? 0) / total) * 100);
                  const h = <span key="h"><b className="text-sky-300">{home?.short}</b> {part('H')}%</span>;
                  const a = <span key="a"><b className="text-gold">{away?.short}</b> {part('A')}%</span>;
                  const d = sp.draws ? <span key="d">Draw {part('D')}%</span> : null;
                  return sp.awayFirst ? [a, d, h] : [h, d, a];
                })()}
              </div>
            </div>
          )}
          {f.venue && <div className="truncate">{f.venue}</div>}
        </div>
      )}
    </div>
  );
}

// the table, from the results: soccer's points (3 a win, 1 a draw), the NFL's record (ties count half)
function Table({ fixtures, clubs, sp, comp }: { fixtures: Fixture[]; clubs: Map<number, Club>; sp: (typeof SPORTS)[string]; comp: Competition }) {
  const groups = comp.detail?.groups ?? [];
  const parents = [...new Set(groups.map((g) => g.parent).filter((x): x is string => !!x))];
  // the whole league, its conferences (when its groups have them) or its groups
  const views = [['all', 'League'], ...(parents.length ? [['parent', comp.detail?.parent_word ?? 'Conference']] : []),
    ...(groups.length ? [['group', comp.detail?.group_word ?? 'Group']] : [])] as [string, string][];
  const [view, setView] = useSticky<string>(`centre:${comp.id}:table`, groups.length ? 'group' : 'all');
  const rows = useMemo(() => {
    const t = new Map<number, { id: number; p: number; w: number; d: number; l: number; f: number; a: number }>();
    const get = (id: number) => t.get(id) ?? (t.set(id, { id, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0 }), t.get(id)!);
    for (const x of fixtures) {
      if (x.state !== 'final' || x.home_score == null || x.away_score == null) continue;
      const h = get(x.home_club), a = get(x.away_club);
      h.p++; a.p++; h.f += x.home_score; h.a += x.away_score; a.f += x.away_score; a.a += x.home_score;
      if (x.home_score > x.away_score) { h.w++; a.l++; } else if (x.home_score < x.away_score) { a.w++; h.l++; } else { h.d++; a.d++; }
    }
    const pts = (r: { w: number; d: number }) => r.w * 3 + r.d;
    const pct = (r: { p: number; w: number; d: number }) => (r.p ? (r.w + r.d / 2) / r.p : 0);
    return [...t.values()].sort((x, y) => sp.draws
      ? pts(y) - pts(x) || (y.f - y.a) - (x.f - x.a) || y.f - x.f
      : pct(y) - pct(x) || y.w - x.w || (y.f - y.a) - (x.f - x.a));
  }, [fixtures, sp.draws]);
  if (!rows.length) return <div className="card p-4 text-sm text-mute">No results yet.</div>;
  const cols = sp.draws ? 'grid-cols-[1.5rem_1fr_repeat(5,2rem)]' : 'grid-cols-[1.5rem_1fr_repeat(4,2.25rem)]';
  const shortOf = (id: number) => clubs.get(id)?.short ?? '';
  const v = views.some(([k]) => k === view) ? view : 'all';
  // the tables to draw: one, or one a group in the groups' order (a club in none goes last, under Others)
  const tables: { name: string | null; rows: typeof rows }[] = v === 'all' ? [{ name: null, rows }]
    : (v === 'group' ? groups.map((g) => ({ name: g.name, set: new Set(g.clubs) }))
      : parents.map((p) => ({ name: p, set: new Set(groups.filter((g) => g.parent === p).flatMap((g) => g.clubs)) })))
      .map((g) => ({ name: g.name, rows: rows.filter((r) => g.set.has(shortOf(r.id))) }))
      .concat([{ name: 'Others', rows: rows.filter((r) => !groups.some((g) => g.clubs.includes(shortOf(r.id)))) }])
      .filter((t) => t.rows.length);
  return (
    <div className="space-y-3">
      {views.length > 1 && (
        <div className={`grid gap-1.5 rounded-2xl bg-black/25 p-1`} style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }}>
          {views.map(([k, l]) => <button key={k} type="button" onClick={() => setView(k)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${v === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
        </div>
      )}
      <div className={v === 'group' && !sp.draws ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>
      {tables.map((t) => <StandingsCard key={t.name ?? 'all'} name={t.name} rows={t.rows} clubs={clubs} sp={sp} cols={cols} lead={v !== 'all'} />)}
      </div>
    </div>
  );
}

function StandingsCard({ name, rows, clubs, sp, cols, lead }: { name: string | null; rows: { id: number; p: number; w: number; d: number; l: number; f: number; a: number }[];
  clubs: Map<number, Club>; sp: (typeof SPORTS)[string]; cols: string; lead: boolean }) {
  return (
    <div className="card overflow-hidden">
      {name && <div className="flex items-center gap-2 border-b border-white/[.06] px-3 pb-1.5 pt-2.5"><span className="h-3.5 w-1 rounded-full bg-gold" /><span className="font-display text-sm font-extrabold uppercase tracking-wide text-white">{name}</span></div>}
      <div className={`grid ${cols} items-center gap-x-1 border-b border-white/[.06] px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wider text-mute`}>
        <span>#</span><span className="text-left">{sp.draws ? 'Club' : 'Team'}</span>
        {sp.draws ? <><span>P</span><span>W</span><span>D</span><span>GD</span><span className="text-white">Pts</span></> : <><span>W</span><span>L</span><span>T</span><span className="text-white">Pct</span></>}
      </div>
      {rows.map((r, i) => {
        const c = clubs.get(r.id);
        return (
          <div key={r.id} className={`grid ${cols} items-center gap-x-1 px-3 py-2 text-center text-sm ${i % 2 ? 'bg-white/[.015]' : ''} ${lead && i === 0 ? 'shadow-[inset_3px_0_0_rgb(var(--gold-rgb))]' : ''}`}>
            <span className={`num text-xs ${lead && i === 0 ? 'font-black text-gold' : 'text-mute'}`}>{i + 1}</span>
            <span className="flex min-w-0 items-center gap-2 text-left">{c && <Crest c={c} size={22} />}<span className="truncate font-semibold text-white">{c?.short ?? c?.name}</span></span>
            {sp.draws ? <>
              <span className="num text-slate-300">{r.p}</span><span className="num text-slate-300">{r.w}</span><span className="num text-slate-300">{r.d}</span>
              <span className="num text-slate-300">{r.f - r.a > 0 ? '+' : ''}{r.f - r.a}</span><span className="num font-black text-white">{r.w * 3 + r.d}</span>
            </> : <>
              <span className="num text-slate-300">{r.w}</span><span className="num text-slate-300">{r.l}</span><span className="num text-slate-300">{r.d}</span>
              <span className="num font-black text-white">{(r.p ? (r.w + r.d / 2) / r.p : 0).toFixed(3).replace(/^0/, '')}</span>
            </>}
          </div>
        );
      })}
    </div>
  );
}

export default function RoundCentre() {
  const { competition = 'nfl' } = useParams();
  const nav = useNavigate();
  const { comp, clubs, fixtures, live } = useCompetition(competition);
  const sp = SPORTS[comp?.sport ?? ''] ?? SPORTS.soccer;
  const [tab, setTab] = useSticky<'scores' | 'table'>(`centre:${competition}:tab`, 'scores');
  const rounds = useMemo(() => [...new Set(fixtures.map((f) => f.gameweek!))].sort((a, b) => a - b), [fixtures]);
  // open on the round being played: the first with a match not yet done
  const current = rounds.find((r) => fixtures.some((f) => f.gameweek === r && !done(f))) ?? rounds[rounds.length - 1] ?? null;
  const [picked, setPicked] = useState<number | null>(null);
  const round = picked ?? current;
  const { gameId, byFixture } = usePoolRound(competition, round);
  const [others, setOthers] = useState<Competition[]>([]);
  useEffect(() => { supabase.from('competitions').select('id,name,short,sport,tz').eq('active', true).eq('format', 'rounds').in('sport', Object.keys(SPORTS)).order('sort').then(({ data }) => setOthers((data ?? []) as Competition[])); }, []);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = strip.current?.querySelector<HTMLElement>('[data-on="1"]'); if (el && strip.current) strip.current.scrollLeft = Math.max(0, el.offsetLeft - strip.current.offsetLeft - 100); }, [round, tab, rounds.length]);
  const tz = comp?.tz ?? 'America/New_York';
  const matches = fixtures.filter((f) => f.gameweek === round);
  const days = [...new Set(matches.map((f) => dayLabel(f.kickoff, tz)))];

  if (comp === undefined) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!comp) return <Empty icon="📺" title="No such competition">It may have finished, or the link is old.</Empty>;
  return (
    <div className="space-y-4 pb-10">
      <PageHeader icon={<Tv className="h-6 w-6 text-gold" />} title={sp.centre} sub={comp.name}
        right={gameId ? <Link to={`/picks?g=${gameId}`} className="text-xs font-semibold text-sky-300">Your picks →</Link> : undefined} />
      {others.length > 1 && (
        <div className="scroll-x -mx-1 flex gap-1.5 px-1">
          {others.map((c) => (
            <button key={c.id} type="button" onClick={() => { setPicked(null); nav(`/centre/${c.id}`); }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ${c.id === competition ? 'bg-gold text-ice ring-gold' : 'bg-white/[.04] text-slate-200 ring-white/10'}`}>{c.short ?? c.name}</button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
        {([['scores', 'Scores', CalendarDays], ['table', 'Table', ListOrdered]] as const).map(([k, l, I]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold ${tab === k ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}><I className="h-4 w-4" /> {l}{k === 'scores' && live && <Radio className="h-3.5 w-3.5 animate-pulse text-red-400" />}</button>
        ))}
      </div>

      {tab === 'scores' && (
        <>
          <div ref={strip} className="scroll-x -mx-1 flex gap-1.5 px-1 pb-1">
            {rounds.map((r) => {
              const on = r === round, list = fixtures.filter((f) => f.gameweek === r);
              const anyLive = list.some((f) => f.state === 'live'), over = list.every(done);
              return (
                <button key={r} data-on={on ? '1' : '0'} type="button" onClick={() => setPicked(r)}
                  className={`flex w-[64px] shrink-0 flex-col items-center rounded-2xl border px-1 py-1.5 ${on ? 'border-gold bg-gold/15' : over ? 'border-white/[.05] bg-black/20' : 'border-white/[.08] bg-white/[.03]'}`}>
                  <span className="text-[9px] font-bold uppercase text-mute">{sp.round === 'Week' ? 'Week' : 'MW'}</span>
                  <span className="text-sm font-black text-white">{r}</span>
                  <span className={`text-[9px] font-bold ${anyLive ? 'text-red-300' : 'text-mute'}`}>{anyLive ? 'Live' : over ? 'Done' : r === current ? 'Now' : `${list.length}`}</span>
                </button>
              );
            })}
          </div>
          {!matches.length ? <div className="card p-4 text-sm text-mute">No {sp.game}s this {sp.round.toLowerCase()}.</div> : days.map((d) => (
            <div key={d}>
              <div className="mb-2 flex items-center gap-2 px-1"><span className="text-[10px] font-black uppercase tracking-[.2em] text-mute">{d}</span><span className="h-px flex-1 bg-white/[.06]" /></div>
              <div className="grid gap-3 md:grid-cols-2">
                {matches.filter((f) => dayLabel(f.kickoff, tz) === d).map((f) => <MatchCard key={f.id} f={f} clubs={clubs} sp={sp} pk={byFixture.get(f.id)} />)}
              </div>
            </div>
          ))}
          {gameId && <p className="px-1 text-[11px] text-mute">Your pick shows on each {sp.game}; the pool&apos;s split shows once it kicks off.</p>}
        </>
      )}

      {tab === 'table' && comp && <Table fixtures={fixtures} clubs={clubs} sp={sp} comp={comp} />}
      <p className="px-1 text-[11px] text-mute">From the {sp.round === 'Week' ? 'NFL' : 'league'}&apos;s public scoreboard, every minute while {sp.game}s are on.{tab === 'table' ? ` Worked out from the results here${sp.draws ? '' : '; the NFL breaks ties by more than the record'}.` : ''}</p>
    </div>
  );
}
