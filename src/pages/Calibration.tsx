// How good the product's calls are (docs/DEVELOPMENT.md section 4, the prediction log), for the platform, next to the
// running costs. Every projection, price and grade the product makes is written down and scored when the result is in;
// this page shows how far off they ran and which way, so the models get tuned from what actually happened.
//   * Player nights: each morning's expected points for every rostered player playing that night (predict_tonight),
//     scored the next morning on the league's own points (prediction_accuracy, by week).
//   * The Book: every settled market's priced chance against how often it came in (book_calibration), in buckets of ten
//     points. A well-priced book sits on the line: things priced at 60% happen about 60% of the time.
//   * Trades: each approved trade's forecast value per team, scored at the end of the regular season.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { PageHeader, Section, Spinner } from '../components/ui';

interface Acc { kind: string; week: string; basis: string | null; n: number; avg_predicted: number; avg_outcome: number; bias: number; avg_miss: number }
interface Cal { kind: string; bucket: number; n: number; expected: number; happened: number; brier: number }
interface Open { kind: string; status: string; n: number }

const KINDS: Record<string, string> = { winner: 'Who wins', ot: 'Goes to overtime', total: 'Over / under', prop: 'Player props', race: 'Races', season: 'Season markets' };
const WAIT: Record<string, string> = {
  player_night: 'Player nights', trade_value: 'Trade forecasts (scored at the regular season’s end)',
  draft_value: 'Draft classes (scored at the regular season’s end)', keeper_value: 'Keepers (scored at the regular season’s end)',
};
const pct = (x: number) => `${Math.round(Number(x) * 100)}%`;
const f1 = (x: number) => (Math.round(Number(x) * 10) / 10).toFixed(1);
const signed = (x: number) => `${Number(x) > 0 ? '+' : ''}${f1(x)}`;

export default function Calibration() {
  const [acc, setAcc] = useState<Acc[] | null>(null);
  const [cal, setCal] = useState<Cal[]>([]);
  const [open, setOpen] = useState<Open[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from('prediction_accuracy').select('*').order('week', { ascending: false }).limit(40),
      supabase.from('book_calibration').select('*').order('kind').order('bucket'),
      supabase.from('predictions').select('kind,status'),
    ]).then(([a, c, p]) => {
      setAcc((a.data ?? []) as Acc[]);
      setCal((c.data ?? []) as Cal[]);
      const m = new Map<string, number>();
      for (const r of (p.data ?? []) as { kind: string; status: string }[]) m.set(`${r.kind}|${r.status}`, (m.get(`${r.kind}|${r.status}`) ?? 0) + 1);
      setOpen([...m].map(([k, n]) => { const [kind, status] = k.split('|'); return { kind, status, n }; }));
    });
  }, []);
  if (!acc) return <div className="flex justify-center py-16"><Spinner /></div>;

  const nights = acc.filter((r) => r.kind === 'player_night');
  const total = nights.reduce((s, r) => s + Number(r.n), 0);
  const miss = total ? nights.reduce((s, r) => s + Number(r.avg_miss) * Number(r.n), 0) / total : 0;
  const bias = total ? nights.reduce((s, r) => s + Number(r.bias) * Number(r.n), 0) / total : 0;
  const waiting = open.filter((o) => o.status === 'open').reduce((s, o) => s + o.n, 0);
  const kinds = [...new Set(cal.map((c) => c.kind))];
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
            {nights.map((r) => (
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

      <Section title="Waiting on results">
        <div className="card divide-y divide-white/[.06]">
          {open.length ? open.sort((a, b) => a.kind.localeCompare(b.kind)).map((o) => (
            <div key={o.kind + o.status} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-slate-200">{WAIT[o.kind] ?? o.kind}</span>
              <span className="num text-mute">{o.n} {o.status}</span>
            </div>
          )) : <div className="px-3 py-3 text-sm text-mute">Nothing logged yet.</div>}
        </div>
      </Section>
    </div>
  );
}
