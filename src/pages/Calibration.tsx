// How good the product's calls are (docs/DEVELOPMENT.md section 4, the prediction log), for the platform, next to the
// running costs. Every projection, price and grade the product makes is written down and scored when the result is in;
// this page shows how far off they ran and which way, so the models get tuned from what actually happened.
//   * Player nights: each morning's expected points for every rostered player playing that night (predict_tonight),
//     scored the next morning on the league's own points (prediction_accuracy, by week).
//   * The Book: every settled market's priced chance against how often it came in (book_calibration), in buckets of ten
//     points. A well-priced book sits on the line: things priced at 60% happen about 60% of the time.
//   * Trades: each approved trade's forecast value per team, scored at the end of the regular season.
//   * The auto-pilot: each lineup it sets, what it expected the starters to score against what they did (migration 132).
//   * Head-to-head win chances: the chance each morning gave the home side, against how often it won (migration 137).
//   * Pickup advice: the lineup points the advisor promised for a pickup, against what the swap brought (migration 138).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { useBrand } from '../lib/brand';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { PageHeader, Section, Spinner } from '../components/ui';

interface Acc { kind: string; week: string; basis: string | null; n: number; avg_predicted: number; avg_outcome: number; bias: number; avg_miss: number }
interface Cal { kind: string; bucket: number; n: number; expected: number; happened: number; brier: number }
interface Open { kind: string; status: string; n: number }
// a pool's pick split as a forecast (migration 174): by sport and by how many agreed, how often the favourite was right
interface Crowd { sport: string; bucket: number; n: number; said: number; right_share: number; pools: number; market?: number | null; priced?: number }
// every chance the product gives (migration 183), bucketed in tenths
interface Chance { kind: string; bucket: number; n: number; expected: number; happened: number; brier: number }
const CHANCES: Record<string, string> = { pool_win: 'Chance to win a pool game', pool_split: 'A pool’s favourite', h2h_win: 'Head-to-head win chances' };
const SPORT: Record<string, string> = { soccer: 'Soccer', nfl: 'NFL football', mlb: 'Baseball', nhl: 'Hockey' };

const KINDS: Record<string, string> = { winner: 'Who wins', ot: 'Goes to overtime', total: 'Over / under', prop: 'Player props', race: 'Races', season: 'Season markets' };
const WAIT: Record<string, string> = {
  player_night: 'Player nights', trade_value: 'Trade forecasts (scored at the regular season’s end)',
  draft_value: 'Draft classes (scored at the regular season’s end)', keeper_value: 'Keepers (scored at the regular season’s end)',
  auto_lineup: 'Auto-pilot lineups (scored when the night is final)',
  box_points: 'Box pool teams’ expected points (scored when the pool is done)',
  h2h_win: 'Head-to-head win chances (scored when the week ends)',
  pool_split: 'Pools’ pick splits (scored at the final whistle)',
  pool_win: 'Pool members’ chances to win (scored when the game ends)',
  pickup: 'Pickups the advisor suggested (scored when the stretch is over)',
};
const pct = (x: number) => `${Math.round(Number(x) * 100)}%`;
const f1 = (x: number) => (Math.round(Number(x) * 10) / 10).toFixed(1);
const signed = (x: number) => `${Number(x) > 0 ? '+' : ''}${f1(x)}`;

export default function Calibration() {
  const brand = useBrand();
  const [acc, setAcc] = useState<Acc[] | null>(null);
  const [cal, setCal] = useState<Cal[]>([]);
  const [open, setOpen] = useState<Open[]>([]);
  const [crowd, setCrowd] = useState<Crowd[]>([]);
  const [chances, setChances] = useState<Chance[]>([]);
  useEffect(() => {
    Promise.all([
      // every week (a few rows a week per kind): the summaries cover the season, the tables show the latest weeks
      supabase.from('prediction_accuracy').select('*').order('week', { ascending: false }).limit(1000),
      supabase.from('book_calibration').select('*').order('kind').order('bucket'),
      // counted in the database (migration 136): the rows themselves run to thousands
      supabase.from('prediction_status').select('kind,status,n'),
      // every pool's for a platform admin, the pool's own for anyone else
      supabase.rpc('crowd_calibration'),
      supabase.from('chance_calibration').select('*').order('kind').order('bucket'),
    ]).then(([a, c, p, cr, ch]) => {
      setChances(((ch.data ?? []) as Chance[]).map((r) => ({ ...r, bucket: Number(r.bucket), n: Number(r.n), expected: Number(r.expected), happened: Number(r.happened), brier: Number(r.brier) })));
      setCrowd(((cr.data ?? []) as Crowd[]).map((r) => ({ ...r, bucket: Number(r.bucket), n: Number(r.n), said: Number(r.said), right_share: Number(r.right_share),
        market: r.market == null ? null : Number(r.market), priced: Number(r.priced ?? 0) })));
      setAcc((a.data ?? []) as Acc[]);
      setCal((c.data ?? []) as Cal[]);
      setOpen(((p.data ?? []) as Open[]).map((r) => ({ ...r, n: Number(r.n) })));
    });
  }, []);
  if (!acc) return <div className="flex justify-center py-16"><Spinner /></div>;

  const nights = acc.filter((r) => r.kind === 'player_night');
  const total = nights.reduce((s, r) => s + Number(r.n), 0);
  const miss = total ? nights.reduce((s, r) => s + Number(r.avg_miss) * Number(r.n), 0) / total : 0;
  const bias = total ? nights.reduce((s, r) => s + Number(r.bias) * Number(r.n), 0) / total : 0;
  const waiting = open.filter((o) => o.status === 'open').reduce((s, o) => s + o.n, 0);
  const kinds = [...new Set(cal.map((c) => c.kind))];
  // Garry's picks (migration 123): how often they came in against the chance their odds gave them
  const gp = acc.filter((r) => r.kind === 'garry_pick');
  const gpN = gp.reduce((s, r) => s + Number(r.n), 0);
  const gpSaid = gpN ? gp.reduce((s, r) => s + Number(r.avg_predicted) * Number(r.n), 0) / gpN : 0;
  const gpCame = gpN ? gp.reduce((s, r) => s + Number(r.avg_outcome) * Number(r.n), 0) / gpN : 0;
  const gpWaiting = open.find((o) => o.kind === 'garry_pick' && o.status === 'open')?.n ?? 0;
  // the auto-pilot's lineups (migration 132): expected starter points against what the starters scored
  const ap = acc.filter((r) => r.kind === 'auto_lineup');
  const apWeeks = [...new Set(ap.map((r) => r.week))].map((week) => {
    const rs = ap.filter((r) => r.week === week), n = rs.reduce((t, r) => t + Number(r.n), 0);
    const avg = (k: 'avg_predicted' | 'avg_outcome' | 'bias' | 'avg_miss') => rs.reduce((t, r) => t + Number(r[k]) * Number(r.n), 0) / n;
    return { week, n, called: avg('avg_predicted'), scored: avg('avg_outcome'), bias: avg('bias'), miss: avg('avg_miss') };
  });
  const apWaiting = open.find((o) => o.kind === 'auto_lineup' && o.status === 'open')?.n ?? 0;
  // head-to-head win chances (migration 137): what the mornings said for the home side, against how often it won
  const hw = acc.filter((r) => r.kind === 'h2h_win');
  const hwN = hw.reduce((t, r) => t + Number(r.n), 0);
  const hwSaid = hwN ? hw.reduce((t, r) => t + Number(r.avg_predicted) * Number(r.n), 0) / hwN : 0;
  const hwCame = hwN ? hw.reduce((t, r) => t + Number(r.avg_outcome) * Number(r.n), 0) / hwN : 0;
  const hwMiss = hwN ? hw.reduce((t, r) => t + Number(r.avg_miss) * Number(r.n), 0) / hwN : 0;
  const hwWaiting = open.find((o) => o.kind === 'h2h_win' && o.status === 'open')?.n ?? 0;
  // pickup advice (migration 138): what the advisor promised a pickup would add, against what the swap brought
  const pk = acc.filter((r) => r.kind === 'pickup');
  const pkN = pk.reduce((t, r) => t + Number(r.n), 0);
  const pkSaid = pkN ? pk.reduce((t, r) => t + Number(r.avg_predicted) * Number(r.n), 0) / pkN : 0;
  const pkCame = pkN ? pk.reduce((t, r) => t + Number(r.avg_outcome) * Number(r.n), 0) / pkN : 0;
  const pkWaiting = open.find((o) => o.kind === 'pickup' && o.status === 'open')?.n ?? 0;
  // the box pool (migration 197): each team's expected points for the window at the lock, against the points it made
  const bx = acc.filter((r) => r.kind === 'box_points');
  const bxN = bx.reduce((t, r) => t + Number(r.n), 0);
  const bxSaid = bxN ? bx.reduce((t, r) => t + Number(r.avg_predicted) * Number(r.n), 0) / bxN : 0;
  const bxCame = bxN ? bx.reduce((t, r) => t + Number(r.avg_outcome) * Number(r.n), 0) / bxN : 0;
  const bxMiss = bxN ? bx.reduce((t, r) => t + Number(r.avg_miss) * Number(r.n), 0) / bxN : 0;
  const bxWaiting = open.find((o) => o.kind === 'box_points' && o.status === 'open')?.n ?? 0;
  const brier = cal.length ? cal.reduce((s, c) => s + Number(c.brier) * Number(c.n), 0) / cal.reduce((s, c) => s + Number(c.n), 0) : null;

  return (
    <div className="space-y-5">
      <PageHeader icon={<Target size={22} className="text-gold" />} title="Calibration" sub="How good the product’s calls are, scored against what happened" />
      <div className="flex gap-2"><Link to="/platform" className="btn-ghost btn-sm">🌐 Platform</Link><Link to="/costs" className="btn-ghost btn-sm">🧾 Costs</Link></div>

      <div className="grid grid-cols-3 gap-2">
        {[{ v: total ? f1(miss) : '–', l: 'Avg miss, pts', s: total ? `${total} player nights` : 'none scored yet' },
          { v: total ? signed(bias) : '–', l: 'Lean', s: total ? (bias > 0 ? 'calls run high' : bias < 0 ? 'calls run low' : 'dead on') : '' },
          { v: brier == null ? '–' : brier.toFixed(3), l: 'Book Brier', s: 'lower is better; 0.25 is a coin flip' }].map((x) => (
          <div key={x.l} className="rounded-2xl border border-white/[.07] bg-white/[.04] px-3 py-2.5">
            <div className="num font-display text-2xl font-extrabold leading-none text-white min-[400px]:text-3xl">{x.v}</div>
            <div className="label mt-1">{x.l}</div>
            {x.s && <div className="mt-0.5 text-[11px] leading-tight text-mute">{x.s}</div>}
          </div>
        ))}
      </div>

      <Section title="Player nights">
        {nights.length ? (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 border-b border-white/[.06] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
              <span>Week of</span><span className="text-right">Nights</span><span className="text-right">Called</span><span className="text-right">Scored</span><span className="text-right">Miss</span>
            </div>
            {nights.slice(0, 24).map((r) => (
              <div key={r.week + (r.basis ?? '')} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 text-sm">
                <span className="text-slate-200">{fmtDate(r.week)}{r.basis && <span className="block text-[11px] text-mute">{r.basis}</span>}</span>
                <span className="num text-right text-slate-300">{r.n}</span>
                <span className="num text-right text-slate-300">{f1(r.avg_predicted)}</span>
                <span className="num text-right text-slate-300">{f1(r.avg_outcome)}</span>
                <span className="num text-right font-semibold text-white">{f1(r.avg_miss)}<span className="block text-[11px] font-normal text-mute">{signed(r.bias)}</span></span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-4 text-sm text-mute">{waiting ? `${waiting} calls are in, waiting on their games. Each morning scores the night before.` : 'Nothing called yet. Calls start the first morning with games.'}</div>
        )}
      </Section>

      <Section title="The Book">
        {kinds.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {kinds.map((k) => (
              <div key={k} className="card p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-slate-100">{KINDS[k] ?? k}</span>
                  <span className="text-[11px] text-mute">{cal.filter((c) => c.kind === k).reduce((s, c) => s + Number(c.n), 0)} prices</span>
                </div>
                <div className="space-y-2.5">
                  {cal.filter((c) => c.kind === k).map((c) => (
                    <div key={c.bucket}>
                      <div className="flex items-baseline justify-between text-[11px] text-mute"><span>Priced {c.bucket * 10}–{c.bucket * 10 + 10}%</span><span>{c.n}</span></div>
                      {/* two bars, each labelled: what the Book priced and how often it came in */}
                      <div className="mt-1 grid grid-cols-[3.75rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
                        <span className="text-mute">priced</span>
                        <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-sky-400" style={{ width: pct(c.expected) }} /></span>
                        <span className="num text-right text-slate-300">{pct(c.expected)}</span>
                        <span className="text-mute">came in</span>
                        <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-gold" style={{ width: pct(c.happened) }} /></span>
                        <span className="num text-right font-semibold text-white">{pct(c.happened)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="card p-4 text-sm text-mute">No settled markets yet.</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">A well-priced book has the two bars level in every row: what it priced at 60% happens about 60% of the time.</p>
      </Section>

      <Section title="Every chance">
        {chances.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...new Set(chances.map((c) => c.kind))].map((k) => {
              const rows = chances.filter((c) => c.kind === k);
              const n = rows.reduce((t, c) => t + c.n, 0);
              const brierAll = rows.reduce((t, c) => t + c.brier * c.n, 0) / n;
              return (
                <div key={k} className="card p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-100">{CHANCES[k] ?? k}</span>
                    <span className="text-[11px] text-mute">{n} scored · Brier {brierAll.toFixed(3)}</span>
                  </div>
                  <div className="space-y-2.5">
                    {rows.map((c) => (
                      <div key={c.bucket}>
                        <div className="flex items-baseline justify-between text-[11px] text-mute"><span>Given {Math.round(c.bucket * 100)}–{Math.round(c.bucket * 100) + 10}%</span><span>{c.n}</span></div>
                        <div className="mt-1 grid grid-cols-[3.75rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-mute">given</span>
                          <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-sky-400" style={{ width: pct(c.expected) }} /></span>
                          <span className="num text-right text-slate-300">{pct(c.expected)}</span>
                          <span className="text-mute">came in</span>
                          <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-gold" style={{ width: pct(c.happened) }} /></span>
                          <span className="num text-right font-semibold text-white">{pct(c.happened)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="card p-4 text-sm text-mute">No chances scored yet. They are scored as games end: head-to-head weeks, pool matches, pool games.</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Every probability the product shows, scored against what happened: a well-made chance comes in as often as it says.</p>
      </Section>

      <Section title="The crowd">
        {crowd.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[...new Set(crowd.map((c) => c.sport))].map((sp) => {
              const rows = crowd.filter((c) => c.sport === sp);
              const n = rows.reduce((t, c) => t + c.n, 0);
              const right = rows.reduce((t, c) => t + c.right_share * c.n, 0) / n;
              return (
                <div key={sp} className="card p-3">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-slate-100">{SPORT[sp] ?? sp}</span>
                    <span className="text-[11px] text-mute">{n} matches · favourite right {pct(right)}</span>
                  </div>
                  <div className="space-y-2.5">
                    {rows.map((c) => (
                      <div key={c.bucket}>
                        <div className="flex items-baseline justify-between text-[11px] text-mute"><span>{c.bucket >= 0.9 ? '90% or more agreed' : `${Math.round(c.bucket * 100)}–${Math.round(c.bucket * 100) + 10}% agreed`}</span><span>{c.n} · {c.pools} {c.pools === 1 ? 'pool' : 'pools'}</span></div>
                        <div className="mt-1 grid grid-cols-[3.75rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className="text-mute">agreed</span>
                          <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-sky-400" style={{ width: pct(c.said) }} /></span>
                          <span className="num text-right text-slate-300">{pct(c.said)}</span>
                          {c.market != null && <>
                            <span className="text-mute">market</span>
                            <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-violet-400" style={{ width: pct(c.market) }} /></span>
                            <span className="num text-right text-slate-300">{pct(c.market)}</span>
                          </>}
                          <span className="text-mute">right</span>
                          <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-gold" style={{ width: pct(c.right_share) }} /></span>
                          <span className="num text-right font-semibold text-white">{pct(c.right_share)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="card p-4 text-sm text-mute">No pool’s picks scored yet. Each pick’em match with three picks or more counts once it’s final.</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Each pick’em match is a forecast from its pool: the side most of them picked, and how many agreed. A wise crowd is right about as often as it agrees; the market bar is what the bookmakers gave the same side at kick-off, where the feed carried a line.</p>
      </Section>

      <Section title={`${brand.bot.name}’s picks`}>
        {gpN ? (
          <div className="card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-100">{gpCame >= gpSaid ? 'Beating the Book' : 'Behind the Book'} by {Math.abs(Math.round((gpCame - gpSaid) * 100))} points</span>
              <span className="text-[11px] text-mute">{gpN} picks settled</span>
            </div>
            <div className="grid grid-cols-[3.75rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="text-mute">odds said</span>
              <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-sky-400" style={{ width: pct(gpSaid) }} /></span>
              <span className="num text-right text-slate-300">{pct(gpSaid)}</span>
              <span className="text-mute">came in</span>
              <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-gold" style={{ width: pct(gpCame) }} /></span>
              <span className="num text-right font-semibold text-white">{pct(gpCame)}</span>
            </div>
          </div>
        ) : <div className="card p-4 text-sm text-mute">{gpWaiting ? `${gpWaiting} picks are out, waiting on their markets to settle.` : `No picks yet. Every pick ${brand.bot.name} gives at the Book is logged here and scored when its market settles.`}</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Each pick against the chance its odds gave it when he made it; above the Book’s line means his picks come in more often than the prices say.</p>
      </Section>

      <Section title="The auto-pilot">
        {apWeeks.length ? (
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 border-b border-white/[.06] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-mute">
              <span>Week of</span><span className="text-right">Lineups</span><span className="text-right">Called</span><span className="text-right">Scored</span><span className="text-right">Miss</span>
            </div>
            {apWeeks.slice(0, 12).map((r) => (
              <div key={r.week} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 text-sm">
                <span className="text-slate-200">{fmtDate(r.week)}</span>
                <span className="num text-right text-slate-300">{r.n}</span>
                <span className="num text-right text-slate-300">{f1(r.called)}</span>
                <span className="num text-right text-slate-300">{f1(r.scored)}</span>
                <span className="num text-right font-semibold text-white">{f1(r.miss)}<span className="block text-[11px] font-normal text-mute">{signed(r.bias)}</span></span>
              </div>
            ))}
          </div>
        ) : <div className="card p-4 text-sm text-mute">{apWaiting ? `${apWaiting} lineups are in, waiting on their nights to finish.` : 'No auto-pilot lineups yet. Each one it sets is logged here and scored once the night is final.'}</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Each lineup the auto-pilot sets: the points it expected from its starters, against what they scored. A night the GM changed afterwards is theirs, so it’s left out.</p>
      </Section>
      <Section title="Matchup odds">
        {hwN ? (
          <div className="card p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-semibold text-slate-100">Home sides {hwCame >= hwSaid ? 'beat' : 'fell short of'} their chances by {Math.abs(Math.round((hwCame - hwSaid) * 100))} points</span>
              <span className="text-[11px] text-mute">{hwN} calls · miss {pct(hwMiss)}</span>
            </div>
            <div className="grid grid-cols-[3.75rem_1fr_2.5rem] items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="text-mute">said</span>
              <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-sky-400" style={{ width: pct(hwSaid) }} /></span>
              <span className="num text-right text-slate-300">{pct(hwSaid)}</span>
              <span className="text-mute">won</span>
              <span className="h-2 overflow-hidden rounded-full bg-white/[.06]"><span className="block h-full rounded-full bg-gold" style={{ width: pct(hwCame) }} /></span>
              <span className="num text-right font-semibold text-white">{pct(hwCame)}</span>
            </div>
          </div>
        ) : <div className="card p-4 text-sm text-mute">{hwWaiting ? `${hwWaiting} chances are out, waiting on their weeks to end.` : 'No head-to-head chances yet. Each morning of a head-to-head week logs every matchup\'s chance here, scored when the week ends.'}</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">The chance the site showed each morning for the home side, against how often it won (a tie counts half). Level bars mean the chances say what they mean.</p>
      </Section>
      <Section title="Pickup advice">
        {pkN ? (
          <div className="grid grid-cols-2 gap-2">
            {[{ v: signed(pkSaid), l: 'Promised a pickup', s: `${pkN} pickups scored` }, { v: signed(pkCame), l: 'Came in', s: pkCame >= pkSaid ? 'at or above the promise' : 'below the promise' }].map((x) => (
              <div key={x.l} className="rounded-2xl border border-white/[.07] bg-white/[.04] px-3 py-2.5">
                <div className="num font-display text-2xl font-extrabold leading-none text-white">{x.v}</div>
                <div className="label mt-1">{x.l}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-mute">{x.s}</div>
              </div>
            ))}
          </div>
        ) : <div className="card p-4 text-sm text-mute">{pkWaiting ? `${pkWaiting} pickups are out, waiting on their stretches to finish.` : 'No pickups from the advisor yet. Each one a GM makes from it is logged here and scored when its stretch is over.'}</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Lineup points the advisor said a pickup would add over the stretch the GM looked at, against what the new player scored in that lineup less what the dropped player scored. A rough check, not like for like: the promise nets out whoever the new player pushed from the lineup, while the result counts all his starts and every point the dropped player scored, started or not.</p>
      </Section>
      <Section title="Box pool forecasts">
        {bxN ? (
          <div className="grid grid-cols-3 gap-2">
            {[{ v: bxSaid.toFixed(1), l: 'Expected', s: `${bxN} teams scored` }, { v: bxCame.toFixed(1), l: 'Made', s: bxCame >= bxSaid ? 'at or above' : 'below' }, { v: bxMiss.toFixed(1), l: 'Off by', s: 'on average' }].map((x) => (
              <div key={x.l} className="rounded-2xl border border-white/[.07] bg-white/[.04] px-3 py-2.5">
                <div className="num font-display text-2xl font-extrabold leading-none text-white">{x.v}</div>
                <div className="label mt-1">{x.l}</div>
                <div className="mt-0.5 text-[11px] leading-tight text-mute">{x.s}</div>
              </div>
            ))}
          </div>
        ) : <div className="card p-4 text-sm text-mute">{bxWaiting ? `${bxWaiting} box pool teams are out, waiting on their pools to finish.` : 'No box pools finished yet. Each team’s expected points are logged when its pool locks and scored when it ends.'}</div>}
        <p className="mt-2 px-1 text-[11px] text-mute">Each team’s points as the boxes expected them at the lock (every player’s projection a game, times his club’s games), against what the team made. Close numbers mean the boxes were dealt fairly.</p>
      </Section>
      <Section title="Waiting on results">
        <div className="card divide-y divide-white/[.06]">
          {open.length ? open.sort((a, b) => a.kind.localeCompare(b.kind)).map((o) => (
            <div key={o.kind + o.status} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-200">{o.kind === 'garry_pick' ? `${brand.bot.name}’s picks at the Book (scored when the market settles)` : WAIT[o.kind] ?? o.kind}</span>
              <span className="num text-mute">{o.n} {o.status}</span>
            </div>
          )) : <div className="px-3 py-3 text-sm text-mute">Nothing logged yet.</div>}
        </div>
      </Section>
    </div>
  );
}
