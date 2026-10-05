import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Minus, Plus, Star, Target } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { Empty, PageHeader, Section, TeamBadge, useAction } from '../components/ui';
import { Crest } from '../components/Crest';

// Call the score (migration 158): every player calls the score of every match in a matchweek, each call open until its
// kick-off. The exact score is 3 points, the right result 1, and one banker a week counts double. Points land at the
// final whistle; everyone else's calls show once their match kicks off.
interface Club { id: number; name: string; short: string | null; logo: string | null }
interface Call { home: number; away: number; banker: boolean; points: number | null; void?: boolean }
interface Fixture {
  id: number; kickoff: string; state: string; minute: number | null; home: Club; away: Club;
  home_score: number | null; away_score: number | null; mine: Call | null; calls: (Call & { team_id: number })[] | null;
}
interface Row { team_id: number; points: number; week: number; exact: number; right: number; called: number }
export interface Board {
  id: number; competition: string; competition_name: string; start_gw: number; status: 'open' | 'done'; winners: number[] | null;
  current_gw: number | null; gameweek: number; last_gw: number | null; fixtures: Fixture[]; table: Row[];
}
interface Round { competition: string; name: string; short: string; gameweek: number; first_kickoff: string; matches: number }

export function usePredictor(gw?: number) {
  const [board, setBoard] = useState<Board | null | undefined>(undefined);
  const load = useCallback(async () => {
    const id = await rpc<number | null>('predictor_current').catch(() => null);
    setBoard(id ? await rpc<Board>('predictor_board', { p_predictor: id, p_gameweek: gw ?? null }).catch(() => null) : null);
  }, [gw]);
  useEffect(() => { load(); }, [load]);
  return { board, reload: load };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]); };
const isLocked = (f: Fixture, now: number) => new Date(f.kickoff).getTime() <= now || !['scheduled', 'postponed'].includes(f.state);

// a call's points as a chip: spot on, the result, or nothing
function PointsChip({ c }: { c: Call }) {
  if (c.void) return <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-mute ring-1 ring-white/15">Void</span>;
  if (c.points == null) return null;
  const cls = c.points >= 3 ? 'bg-gold/20 text-gold ring-gold/40' : c.points > 0 ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30' : 'bg-white/[.06] text-mute ring-white/10';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ring-1 ${cls}`}>+{c.points}</span>;
}

// a goal count with a tap above to add and below to take one off
function Goals({ value, onChange, disabled, label }: { value: number | null; onChange: (n: number) => void; disabled: boolean; label: string }) {
  const v = value ?? 0;
  return (
    <div className="flex flex-col items-center">
      <button type="button" aria-label={`${label}: one more`} disabled={disabled || v >= 20} onClick={() => onChange(value == null ? 0 : v + 1)}
        className="grid h-7 w-10 place-items-center rounded-t-xl bg-white/[.05] text-slate-300 transition enabled:hover:bg-white/10 enabled:active:bg-gold/20 disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
      <div className={`num grid h-11 w-10 place-items-center text-2xl font-black ${value == null ? 'text-white/25' : 'text-white'} bg-black/30`}>{value ?? '–'}</div>
      <button type="button" aria-label={`${label}: one fewer`} disabled={disabled || v <= 0} onClick={() => onChange(Math.max(0, v - 1))}
        className="grid h-7 w-10 place-items-center rounded-b-xl bg-white/[.05] text-slate-300 transition enabled:hover:bg-white/10 enabled:active:bg-gold/20 disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
    </div>
  );
}

// the host starts it from the next matchweek of a competition the feed carries
export function PredictorStart({ onStarted }: { onStarted: () => void }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const { busy, run } = useAction();
  useEffect(() => { rpc<Round[]>('soccer_rounds').then(setRounds, () => setRounds([])); }, []);
  if (!rounds.length) return null;
  return (
    <Section title="Call the score">
      <div className="card space-y-3 p-4">
        <p className="text-sm text-slate-300">Everyone calls the score of every match. The exact score is 3 points, the right result 1, and a banker each week counts double. No coins, just bragging rights.</p>
        {rounds.map((r) => (
          <div key={r.competition} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[.04] p-3">
            <Target className="h-6 w-6 shrink-0 text-gold" />
            <div className="min-w-0 flex-1"><div className="font-semibold text-white">{r.name}</div><div className="text-xs text-mute">From matchweek {r.gameweek} · first kick-off {when(r.first_kickoff)}</div></div>
            <button type="button" className="btn-gold shrink-0" disabled={busy} onClick={() => run(async () => { await rpc('predictor_start', { p_competition: r.competition, p_start_gw: r.gameweek }); onStarted(); }, 'Call the score is on')}>Start it</button>
          </div>
        ))}
      </div>
    </Section>
  );
}

// the card on the pool's home page
export function PredictorCard() {
  const { me } = useLeague();
  const { board } = usePredictor();
  if (!board) return null;
  const rank = board.table.findIndex((r) => r.team_id === me?.id);
  const mine = board.table[rank];
  const open = board.fixtures.filter((f) => f.state === 'scheduled' && new Date(f.kickoff).getTime() > Date.now());
  const todo = open.filter((f) => !f.mine).length;
  const won = board.status === 'done' && board.winners?.includes(me?.id ?? -1);
  return (
    <Link to="/predictor" className="card flex items-center gap-3 p-4 transition hover:border-gold/30">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/15"><Target className="h-6 w-6 text-gold" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">Call the score</span>
        <span className="block text-xs text-mute">{board.status === 'done' ? (won ? 'You won it 🏆' : 'The season is done')
          : `${board.competition_name} · matchweek ${board.gameweek}${mine ? ` · ${ordinal(rank + 1)}, ${pts(mine.points)}` : ''}`}</span>
      </span>
      {board.status === 'open' && me?.role === 'gm' && (todo > 0
        ? <span className="chip shrink-0 border-amber-400/40 text-amber-200">{todo} to call</span>
        : open.length > 0 ? <span className="chip shrink-0 border-emerald-400/40 text-emerald-200">All called</span> : null)}
    </Link>
  );
}

export default function Predictor() {
  const { me, teams } = useLeague();
  const now = useNow(30000);
  const [gw, setGw] = useState<number | undefined>(undefined);
  const { board, reload } = usePredictor(gw);
  const { busy, run } = useAction();
  // calls being typed, by fixture, until saved
  const [draft, setDraft] = useState<Record<number, { home: number | null; away: number | null }>>({});
  const [banker, setBanker] = useState<number | null>(null);
  const [showCalls, setShowCalls] = useState<number | null>(null);
  useEffect(() => { setDraft({}); setBanker(null); }, [board?.gameweek, board?.id]);
  const name = (id: number) => { const t = teams.find((x) => x.id === id); return t?.gm_name ?? t?.name ?? '?'; };

  const savedBanker = board?.fixtures.find((f) => f.mine?.banker)?.id ?? null;
  const val = (f: Fixture) => draft[f.id] ?? { home: f.mine?.home ?? null, away: f.mine?.away ?? null };
  const dirty = useMemo(() => !!board && (Object.entries(draft).some(([id, d]) => {
    const f = board.fixtures.find((x) => x.id === Number(id));
    return d.home != null && d.away != null && (d.home !== f?.mine?.home || d.away !== f?.mine?.away);
  }) || (banker != null && banker !== savedBanker)), [board, draft, banker, savedBanker]);

  if (board === undefined) return <div className="h-60 animate-pulse rounded-3xl bg-white/[.04]" />;
  if (!board) return (
    <div className="space-y-5">
      <PageHeader icon={<Target className="h-6 w-6 text-gold" />} title="Call the score" sub="Call every match. The exact score is worth the most." />
      {me?.is_commish ? <PredictorStart onStarted={reload} /> : <Empty icon="🎯" title="Not started yet">The host starts it from a soccer matchweek.</Empty>}
    </div>
  );

  const canCall = board.status === 'open' && me?.role === 'gm';
  const rank = board.table.findIndex((r) => r.team_id === me?.id);
  const mine = board.table[rank];
  const open = board.fixtures.filter((f) => !isLocked(f, now));
  const called = board.fixtures.filter((f) => { const v = val(f); return v.home != null && v.away != null; }).length;
  const bankerNow = banker ?? savedBanker;
  const bankerLocked = savedBanker != null && isLocked(board.fixtures.find((f) => f.id === savedBanker)!, now);
  const winners = (board.winners ?? []).map(name);
  const last = board.last_gw ?? board.gameweek;
  const set = (f: Fixture, side: 'home' | 'away', n: number) => {
    const v = val(f);
    // the first tap on an empty call makes it 0-0, so a score is never half there
    setDraft((d) => ({ ...d, [f.id]: { home: side === 'home' ? n : v.home ?? 0, away: side === 'away' ? n : v.away ?? 0 } }));
  };
  const save = () => run(async () => {
    const picks = board.fixtures.filter((f) => !isLocked(f, now)).map((f) => ({ fixture: f.id, ...val(f) })).filter((p) => p.home != null && p.away != null);
    await rpc('predictor_save', { p_predictor: board.id, p_gameweek: board.gameweek, p_picks: picks, p_banker: banker != null && banker !== savedBanker ? banker : null });
    await reload();
  }, 'Calls saved');

  return (
    <div className="space-y-5 pb-20">
      <PageHeader icon={<Target className="h-6 w-6 text-gold" />} title="Call the score"
        sub={board.status === 'done' ? `${board.competition_name} · the season is done` : `${board.competition_name} · exact score 3, result 1, banker ×2`} />

      {board.status === 'done' ? (
        <div className="card-hero p-5 text-center"><div className="relative"><div className="text-5xl">🏆</div><div className="h-display text-shine mt-2 text-3xl">{winners.join(' and ') || 'Nobody'}</div><div className="mt-1 text-sm text-white/70">Called it best all season</div></div></div>
      ) : mine && (
        <div className="grid grid-cols-3 gap-2">
          {[['Rank', `${ordinal(rank + 1)}`, `of ${board.table.length}`], ['Season', String(mine.points), mine.points === 1 ? 'point' : 'points'], [`MW${board.gameweek}`, String(mine.week), `${mine.exact} spot on`]].map(([k, v, s]) => (
            <div key={k} className="rounded-2xl border border-white/10 bg-white/[.04] p-3">
              <div className="text-[10px] font-bold uppercase tracking-[.18em] text-mute">{k}</div>
              <div className="num mt-0.5 text-2xl font-black text-white">{v}</div>
              <div className="text-[11px] text-mute">{s}</div>
            </div>
          ))}
        </div>
      )}

      <Section title={`Matchweek ${board.gameweek}`} right={
        <span className="flex items-center gap-1.5">
          {board.current_gw && board.current_gw !== board.gameweek && <button type="button" className="mr-1 text-xs font-semibold text-sky-300" onClick={() => setGw(board.current_gw!)}>This week</button>}
          <button type="button" aria-label="Previous matchweek" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.06] text-slate-200 ring-1 ring-white/10 disabled:opacity-30" disabled={board.gameweek <= board.start_gw} onClick={() => setGw(board.gameweek - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" aria-label="Next matchweek" className="grid h-9 w-9 place-items-center rounded-full bg-white/[.06] text-slate-200 ring-1 ring-white/10 disabled:opacity-30" disabled={board.gameweek >= last} onClick={() => setGw(board.gameweek + 1)}><ChevronRight className="h-4 w-4" /></button>
        </span>}>
        {canCall && open.length > 0 && (
          <div className="mb-2 flex items-center gap-2 px-1 text-xs text-mute">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(called / Math.max(1, board.fixtures.length)) * 100}%` }} /></div>
            <span className="shrink-0 font-semibold">{called} of {board.fixtures.length} called</span>
          </div>
        )}
        {!board.fixtures.length && <div className="card p-4 text-sm text-mute">No matches in this matchweek yet.</div>}
        <div className="space-y-2">
          {board.fixtures.map((f) => {
            const locked = isLocked(f, now) || !canCall;
            const v = val(f);
            const done = f.state === 'final';
            const live = !done && isLocked(f, now) && f.state !== 'postponed' && f.state !== 'cancelled';
            const isBank = bankerNow === f.id;
            const club = (c: Club, where: string) => (
              <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <Crest c={c} size={36} />
                <span className="text-balance text-[13px] font-semibold leading-tight text-white">{c.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-mute">{where}</span>
              </div>
            );
            return (
              <div key={f.id} className={`card p-3 ${isBank ? 'border-gold/40 shadow-[0_0_22px_rgb(var(--gold-rgb)/.15)]' : ''}`}>
                <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-mute">
                  <span className={live ? 'font-bold text-red-300' : ''}>{done ? 'Full time' : f.state === 'postponed' ? 'Postponed' : f.state === 'cancelled' ? 'Called off' : live ? `● Live${f.minute ? ` ${f.minute}′` : ''}` : when(f.kickoff)}</span>
                  {(done || live) && f.home_score != null && <b className="num text-sm text-white">{f.home_score} - {f.away_score}</b>}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  {club(f.home, 'Home')}
                  {locked ? (
                    <div className="flex flex-col items-center gap-1">
                      <div className={`num rounded-xl px-3 py-2 text-xl font-black ${f.mine ? 'bg-white/[.06] text-white' : 'text-white/25'}`}>{f.mine ? `${f.mine.home} - ${f.mine.away}` : '– -  –'}</div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-mute">{f.mine ? 'Your call' : canCall ? 'Not called' : 'Calls'}</span>
                      {f.mine && <PointsChip c={f.mine} />}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Goals value={v.home} label={f.home.name} disabled={busy} onChange={(n) => set(f, 'home', n)} />
                      <span className="text-lg font-black text-white/30">:</span>
                      <Goals value={v.away} label={f.away.name} disabled={busy} onChange={(n) => set(f, 'away', n)} />
                    </div>
                  )}
                  {club(f.away, 'Away')}
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  {canCall && !isLocked(f, now) && !bankerLocked ? (
                    <button type="button" disabled={busy || bankerLocked || v.home == null}
                      onClick={() => setBanker(f.id)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 transition disabled:opacity-40 ${isBank ? 'bg-gold/20 text-gold ring-gold/50' : 'bg-white/[.04] text-slate-300 ring-white/10 enabled:hover:bg-white/10'}`}>
                      <Star className={`h-3.5 w-3.5 ${isBank ? 'fill-current' : ''}`} /> {isBank ? 'Banker ×2' : 'Make it my banker'}
                    </button>
                  ) : f.mine?.banker ? <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-1 text-[11px] font-bold text-gold ring-1 ring-gold/40"><Star className="h-3.5 w-3.5 fill-current" /> Banker ×2</span> : <span />}
                  {f.calls && f.calls.length > 0 && (
                    <button type="button" className="text-[11px] font-semibold text-sky-300" onClick={() => setShowCalls(showCalls === f.id ? null : f.id)}>
                      {showCalls === f.id ? 'Hide calls' : `Everyone's calls (${f.calls.length})`}
                    </button>
                  )}
                </div>
                {showCalls === f.id && f.calls && (
                  <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/[.06] pt-2">
                    {f.calls.map((c) => (
                      <span key={c.team_id} className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-2 pr-1 text-[11px] ring-1 ${c.team_id === me?.id ? 'bg-gold/10 ring-gold/30' : 'bg-white/[.04] ring-white/10'}`}>
                        <span className="font-semibold text-white">{name(c.team_id)}</span>
                        <b className="num text-slate-200">{c.home}-{c.away}</b>{c.banker && <Star className="h-3 w-3 fill-current text-gold" />}
                        <PointsChip c={c} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">The score after ninety minutes counts. Each call can change until its match kicks off; a called-off match scores nothing until it is played.</p>
      </Section>

      <Section title="The table">
        <div className="card divide-y divide-white/[.05] p-1">
          {board.table.map((r, i) => {
            const t = teams.find((x) => x.id === r.team_id);
            return (
              <div key={r.team_id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${r.team_id === me?.id ? 'bg-gold/[.06]' : ''}`}>
                <span className={`num w-5 shrink-0 text-center text-sm font-black ${i === 0 && r.points > 0 ? 'text-gold' : 'text-mute'}`}>{i + 1}</span>
                <TeamBadge team={t} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="break-words font-semibold text-white">{t?.gm_name ?? t?.name}</div>
                  <div className="text-[11px] text-mute">{r.exact} spot on · {r.right} right · MW{board.gameweek} {pts(r.week)}</div>
                </div>
                <span className="num shrink-0 text-xl font-black text-white">{r.points}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-mute">Everyone else&apos;s calls show once their match kicks off.</p>
      </Section>

      {canCall && dirty && (
        <div className="fixed inset-x-0 bottom-[76px] z-30 px-4 md:bottom-6">
          <div className="mx-auto max-w-md">
            <button type="button" className="btn-gold w-full py-3 text-base shadow-[0_10px_30px_rgba(0,0,0,.45)]" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save my calls'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
