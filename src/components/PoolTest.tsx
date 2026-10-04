import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { ago, countdown } from '../lib/format';
import { poolLink } from '../lib/host';
import { Section } from './ui';

// The Love Is Blind test's scoreboard (docs/POOLS.md section 6), on the Platform page: the four marks the test has to
// hit by the finale on 4 November, each against its target, the four drop weeks as they fill in, and every pool with
// how busy it is (platform_pool_test, migration 155).
interface Week { week: number; label: string; from: string; to: string; started: boolean; done: boolean; callers: number; calls: number; median: number }
interface Pool { league_id: number; name: string; slug: string; color: string | null; players: number; calls: number; calls_7d: number; callers_7d: number; open: number; settled: number; last_call: string | null; self_started: boolean }
interface Test { players: number; running: number; pools_live: number; steady: number; self_started: number; current_week: number | null; finale: string; weeks: Week[]; pools: Pool[] }

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Mark({ label, value, target, note, pct }: { label: string; value: string; target: string; note: string; pct: number }) {
  const met = pct >= 1;
  return (
    <div className={`rounded-2xl border p-3 ${met ? 'border-emerald-400/40 bg-emerald-500/[.08]' : 'border-white/[.08] bg-white/[.04]'}`}>
      <div className="flex flex-wrap items-start justify-between gap-1">
        <div className="label">{label}</div>
        <span className={`chip shrink-0 text-[10px] ${met ? 'border-emerald-400/40 text-emerald-200' : 'text-mute'}`}>{met ? '✓ Met' : `Target ${target}`}</span>
      </div>
      <div className="num mt-1 font-display text-3xl font-extrabold leading-none text-white">{value}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.08]">
        <div className={`h-full rounded-full ${met ? 'bg-emerald-400' : 'bg-gold'}`} style={{ width: `${Math.max(3, Math.min(100, pct * 100))}%` }} />
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-mute">{note}</div>
    </div>
  );
}

export function PoolTest() {
  const [t, setT] = useState<Test | null>(null);
  useEffect(() => { rpc<Test>('platform_pool_test').then(setT, () => setT(null)); }, []);
  if (!t) return null;
  const now = Date.now();
  const premiere = new Date(t.weeks[0].from).getTime();
  // the median that counts: this week's once it is under way, else the last finished week's
  const shown = t.weeks.filter((w) => w.started).at(-1);
  const steadyPct = t.players ? t.steady / t.players : 0;
  const sub = now < premiere ? `Premiere in ${countdown(premiere - now)} · the gate closes at the finale, ${day(t.finale)}`
    : t.current_week ? `Week ${t.current_week} of 4 · the gate closes at the finale, ${day(t.finale)}` : 'The four drop weeks are done';
  return (
    <Section title="The Love Is Blind test">
      <div className="card space-y-4 p-4">
        <p className="text-xs text-mute">{sub}</p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Mark label="Pools running" value={String(t.running)} target="3" pct={t.running / 3}
            note={`${t.pools_live} live; a pool counts with 3 players or more${t.self_started ? ` · ${t.self_started} started on their own` : ''}`} />
          <Mark label="Players" value={String(t.players)} target="30" pct={t.players / 30} note="People with a seat in a live pool, counted once" />
          <Mark label="Steady callers" value={t.players ? `${Math.round(steadyPct * 100)}%` : '–'} target="67%" pct={steadyPct / (2 / 3)}
            note={`${t.steady} of ${t.players} called in 3 of the 4 drop weeks`} />
          <Mark label="Median calls a week" value={shown ? String(+shown.median.toFixed(1)) : '–'} target="5" pct={shown ? shown.median / 5 : 0}
            note={shown ? `${shown.label}, every player counted` : 'Counts from the premiere'} />
        </div>

        <div>
          <div className="label mb-1.5">The drop weeks</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {t.weeks.map((w) => {
              const live = w.started && !w.done;
              const share = t.players ? w.callers / t.players : 0;
              return (
                <div key={w.week} className={`rounded-xl border p-2.5 ${live ? 'border-gold/50 bg-gold/[.08]' : 'border-white/[.06] bg-white/[.03]'}`}>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
                    <span className={live ? 'text-gold' : 'text-mute'}>Week {w.week}</span>
                    <span className="text-mute">{live ? 'Now' : w.done ? 'Done' : day(w.from)}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold leading-tight text-slate-100">{w.label}</div>
                  {w.started ? (
                    <div className="mt-1.5 text-[11px] text-slate-300">
                      <b className="num text-white">{Math.round(share * 100)}%</b> called · <b className="num text-white">{w.calls}</b> calls · median <b className="num text-white">{+w.median.toFixed(1)}</b>
                    </div>
                  ) : <div className="mt-1.5 text-[11px] text-mute">Opens {day(w.from)}</div>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="label mb-1.5">The pools</div>
          {t.pools.length === 0 ? <div className="text-sm text-mute">No prediction pools are live yet.</div> : (
            <div className="divide-y divide-white/[.06] rounded-xl border border-white/[.06]">
              {t.pools.map((p) => (
                <a key={p.league_id} href={poolLink(p.slug)} className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[.03]">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color ?? '#f7c548', boxShadow: `0 0 10px ${p.color ?? '#f7c548'}` }} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-white">{p.name} {p.self_started && <span className="chip ml-1 text-[10px] text-sky-200">self-started</span>}</span>
                    <span className="block text-[11px] text-mute">{p.players} player{p.players === 1 ? '' : 's'} · {p.open} open · {p.settled} settled{p.last_call ? ` · last call ${ago(p.last_call)} ago` : ''}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="num block font-display text-xl font-extrabold leading-none text-white">{p.calls_7d}</span>
                    <span className="block text-[10px] text-mute">calls, 7 days</span>
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
