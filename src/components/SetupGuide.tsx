import { useEffect, useState } from 'react';
import { useLeague } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { useAction } from './ui';
import { useBrand } from '../lib/brand';
import { fmtDateTime } from '../lib/format';

// The commissioner's season setup, in the order it happens: the league's look, the GMs, the rules, draft night, the
// order, the platform switching the league on (or, for a league its commissioner started, migration 242, the
// commissioner taking it live: commish_go_live), the draft. Each step is ticked from what the league already holds and
// jumps to the part of this page that does it. It shows until the draft is done, so it is there for a new league's
// first season and again for every league's next one.
interface Step { key: string; title: string; detail: string; done: boolean; to?: string; optional?: boolean; live?: boolean }

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function SetupGuide() {
  const { league, teams, draft, session } = useLeague();
  const brand = useBrand();
  const { busy, run } = useAction();
  const [status, setStatus] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [weeks, setWeeks] = useState(0);
  const h2h = league?.format === 'h2h';
  useEffect(() => {
    if (!league?.league_id) return;
    supabase.from('leagues').select('status,owner_user').eq('id', league.league_id).maybeSingle().then(({ data }) => {
      setStatus((data?.status as string) ?? null);
      setMine(!!session?.user?.id && data?.owner_user === session.user.id);
    });
  }, [league?.league_id, session?.user?.id]);
  const goLive = () => run(async () => { await rpc('commish_go_live'); setStatus('active'); }, `${league?.name ?? 'The league'} is live`);
  // a head-to-head league plays a schedule (migration 118), made before the season
  useEffect(() => {
    if (!h2h) return;
    supabase.from('matchups').select('week').order('week', { ascending: false }).limit(1).then(({ data }) => setWeeks(Number(data?.[0]?.week ?? 0)));
  }, [h2h, league?.updated_at]);
  if (!league || !draft || draft.status === 'done' || league.phase === 'season' || league.phase === 'offseason') return null;

  const seats = teams.length, filled = teams.filter((t) => t.user_id).length;
  const keepers = league.phase === 'keepers';
  const steps: Step[] = [
    { key: 'look', title: 'Make it yours', detail: `${league.name} · ${brand.short}. Wordmark, colour, prize names and the coins.`, done: true, to: 'identity' },
    { key: 'gms', title: 'Bring in your GMs', detail: filled === seats ? `All ${seats} seats taken.` : `${filled} of ${seats} seats taken. Open seats on draft night are picked for automatically.`, done: filled === seats, to: 'invites' },
    { key: 'rules', title: 'Scoring and roster', detail: 'Worth a look: how points are scored and how many players each team carries.', done: false, to: 'roster', optional: true },
    ...(h2h ? [{ key: 'schedule', title: 'Make the schedule', detail: weeks ? `${weeks} weeks of matchups${(league.h2h_playoffs ?? 0) >= 2 ? `, then playoffs for the top ${league.h2h_playoffs}` : ''}.` : 'Head-to-head plays a weekly schedule: pick the playoff spots and make it.', done: weeks > 0, to: 'scoring' }] : []),
    ...(keepers ? [{ key: 'keepers', title: 'Keepers', detail: `${teams.filter((t) => t.keepers_submitted).length} of ${seats} GMs have saved theirs. Finalize to open the draft pool.`, done: false, to: 'keepers' }] : []),
    { key: 'when', title: 'Set draft night', detail: league.draft_at ? `${fmtDateTime(league.draft_at)} · ${league.pick_seconds}s a pick · ${league.draft_rounds} rounds` : 'Pick the date, the pick clock and the rounds.', done: !!league.draft_at, to: 'settings' },
    { key: 'order', title: 'Draw the order', detail: draft.order_set ? 'The order is set.' : 'Randomize it, or set it by hand.', done: draft.order_set, to: 'draft' },
    ...(status && status !== 'active' ? [mine
      ? { key: 'live', title: 'Take it live', detail: 'Once the steps above are done, switch it on: the nightly jobs start (scores, lineups and the Book).', done: false, live: true }
      : { key: 'live', title: 'Super Pools switches you on', detail: 'Once your commissioner seat is in, the league goes on the nightly jobs: scores, lineups and the Book.', done: false }] : []),
    { key: 'go', title: 'Drop the puck', detail: draft.status === 'live' || draft.status === 'paused' ? 'The draft is on.' : 'Start the draft from the draft room when everyone is in.', done: draft.status === 'live' || draft.status === 'paused', to: 'draft' },
  ];
  const next = steps.find((x) => !x.done && !x.optional);
  // the progress counts the steps that must happen; a step worth a look is shown but never holds anything up
  const must = steps.filter((x) => !x.optional);
  const doneCount = must.filter((x) => x.done).length;

  return (
    <div className="card-hero p-4" style={{ '--tc': 'var(--color-gold)' } as React.CSSProperties}>
      <div className="relative">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="label text-white/60">Season setup · {league.season}</div>
            <h2 className="h-display text-shine mt-0.5 text-2xl leading-none">{next ? `Next: ${next.title.toLowerCase()}` : 'Ready for draft night'}</h2>
          </div>
          <div className="num shrink-0 font-display text-3xl font-extrabold leading-none text-white">{doneCount}<span className="text-base text-white/50">/{must.length}</span></div>
        </div>
        <div className="mt-3 flex gap-1">{must.map((x) => <span key={x.key} className={`h-1.5 flex-1 rounded-full ${x.done ? 'bg-gold' : x === next ? 'bg-white/40' : 'bg-white/10'}`} />)}</div>
        <ol className="mt-3 space-y-1">
          {steps.map((x) => {
            const body = (
              <>
                <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black ${x.done ? 'bg-gold text-ice' : x === next ? 'border-2 border-white/70 text-white' : 'border border-white/20 text-white/50'}`}>{x.done ? '✓' : x.optional ? '•' : must.indexOf(x) + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${x.done ? 'text-white/80' : 'text-white'}`}>{x.title}</span>
                  <span className="block break-words text-xs text-white/55">{x.detail}</span>
                </span>
                {x.to && <span className="mt-1 shrink-0 text-white/40">›</span>}
                {x.live && <button type="button" className="btn-gold shrink-0 px-3 py-1.5 text-xs" disabled={busy} onClick={goLive}>🏒 Go live</button>}
              </>
            );
            return (
              <li key={x.key}>
                {x.to ? <button type="button" onClick={() => jump(x.to!)} className={`flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition hover:bg-white/[.06] ${x === next ? 'bg-white/[.07]' : ''}`}>{body}</button>
                  : <div className="flex items-start gap-2.5 px-2 py-1.5">{body}</div>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
