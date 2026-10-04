// Running costs, for the platform owner: what SaK and Super Pools cost to run, by day and by month, where it comes
// from (the fixed bills, Garry, the X insiders feed), what each feature costs, and what each league costs per GM.
// AI calls are priced by xAI as they happen and booked to the feature and league they served; the fixed bills are
// entered here and spread evenly over the days of each month. A spike notifies the owner the next morning.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Receipt } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { fmtDate } from '../lib/format';
import { PageHeader, Section, Stat, Spinner, useAction } from '../components/ui';

interface Day { day: string; fixed: number; garry: number; x_feed: number; other: number }
interface Month { month: string; fixed: number; garry: number; x_feed: number; other: number; days_in: number }
interface Feature { source: string; feature: string; calls: number; units: number; input_tokens: number; cached_tokens: number; output_tokens: number; usd: number; days: number; leagues: number }
interface LeagueCost { id: number; name: string; short_name: string; gms: number; direct_30: number; shared_30: number; total_30: number }
interface Bill { id: number; source: string; item: string; monthly_usd: number; share: number; starts: string; ends: string | null; note: string | null }
interface Dash {
  today: string; metered_since: string | null; daily: Day[]; months: Month[]; features: Feature[]; leagues: LeagueCost[]; fixed: Bill[];
  summary: { today: number; yesterday: number; mtd: number; metered_avg_7: number; fixed_month: number; projected_month: number; leagues: number };
  usage: { db_bytes: number; db_included_bytes: number; cron_runs_yesterday: number | null; ai_calls_30: number };
  alerts: { day: string; message: string }[];
}

// the four sources, in a fixed order and colour (checked for colour-blind separation on the rink background)
const SOURCES = [
  { key: 'fixed', label: 'Fixed bills', short: 'Fixed', color: '#3987e5' },
  { key: 'garry', label: 'Garry', short: 'Garry', color: '#d95926' },
  { key: 'x_feed', label: 'X feed', short: 'X feed', color: '#199e70' },
  { key: 'other', label: 'Other AI', short: 'Other', color: '#c98500' },
] as const;
type Key = (typeof SOURCES)[number]['key'];
const BOOKS_START = '2026-09-24';
const INK = { primary: '#e7ecf7', secondary: '#b8c2d9', muted: '#8b97b5', grid: '#26324f' };

// what each metered feature is, in plain words
const FEATURES: Record<string, string> = {
  'garry.reply': 'Garry: chat replies', 'garry.daily': 'Garry: morning post', 'garry.weekly': 'Garry: Monday column',
  'garry.nudge': 'Garry: lineup nudge', 'garry.moments': 'Garry: game-night moments', 'garry.assess': 'Garry: state of the league',
  'garry.keepers': 'Garry: keeper report', 'garry.draft': 'Garry: draft recap', 'garry.draftprep': 'Garry: draft preview',
  'garry.book': 'Garry: the Book’s line', 'garry.probe': 'Garry: test replies', 'garry.learn': 'Garry: learning from chat',
  'garry.evolve': 'Garry: voice notes', 'garry.other': 'Garry (before features were tracked)', 'hub.x_feed': 'NHL centre: X insiders feed',
};
const featureName = (f: string) => FEATURES[f] ?? f;
// the spike notice names features by their keys; on the page they read as words
const plainAlert = (m: string) => m.replace(/^Running costs: /, '').replace(/\b(garry|hub)\.[a-z_]+/g, (k) => featureName(k));

// dollars, with cents shown as cents when they're small
const usd = (n: number | null | undefined, digits = 2) => {
  const v = Number(n ?? 0);
  if (v !== 0 && Math.abs(v) < 0.1) return `${(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1)}¢`;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};
const total = (d: Pick<Day, Key>) => d.fixed + d.garry + d.x_feed + d.other;
const monthName = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const mb = (b: number) => (b >= 2 ** 30 ? `${+(b / 2 ** 30).toFixed(2)} GB` : `${Math.round(b / 2 ** 20)} MB`);

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: INK.secondary }}>
      {SOURCES.map((s) => <span key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
    </div>
  );
}

// a stacked bar a day, fixed bills at the base; tap or hover a day for its breakdown
function DailyBars({ days }: { days: Day[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640, H = 220, P = { l: 44, r: 8, t: 12, b: 22 };
  const max = Math.max(...days.map(total), 0.01);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const bw = (W - P.l - P.r) / days.length;
  const gap = Math.min(2, bw * 0.25);
  const y = (v: number) => H - P.b - (v / top) * (H - P.t - P.b);
  const pick = (clientX: number, r: DOMRect) => {
    const px = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(days.length - 1, Math.floor((px - P.l) / bw))));
  };
  const h = hover != null ? days[hover] : null;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Running cost by day, stacked by source"
        onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())} onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}
        onTouchMove={(e) => pick(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth={1} />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={INK.muted}>{usd(t, t < 1 ? 2 : 0)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          let base = 0;
          const x = P.l + i * bw + gap / 2, w = Math.max(1, bw - gap);
          const parts = SOURCES.map((s) => ({ ...s, v: d[s.key] })).filter((p) => p.v > 0);
          return (
            <g key={d.day} opacity={hover == null || hover === i ? 1 : 0.45}>
              {parts.map((p, j) => {
                const y0 = y(base), y1 = y(base + p.v);
                base += p.v;
                // a 2 px surface gap between stacked segments; the top segment gets the rounded end
                const hgt = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
                const last = j === parts.length - 1;
                return <rect key={p.key} x={x} y={y1} width={w} height={hgt} rx={last ? Math.min(3, w / 2) : 0} fill={p.color} />;
              })}
            </g>
          );
        })}
        <text x={P.l} y={H - 6} fontSize={10} fill={INK.muted}>{fmtDate(days[0].day)}</text>
        <text x={W - P.r} y={H - 6} fontSize={10} fill={INK.muted} textAnchor="end">{fmtDate(days[days.length - 1].day)}</text>
      </svg>
      {h && (
        <div className={`pointer-events-none absolute top-1 min-w-[150px] rounded-xl border border-white/10 bg-[#0b1222]/95 p-2 text-xs shadow-xl backdrop-blur ${hover! > days.length / 2 ? 'left-12' : 'right-1'}`}>
          <div className="mb-1 flex justify-between gap-3 font-semibold"><span>{fmtDate(h.day)}</span><span className="num">{usd(total(h))}</span></div>
          {[...SOURCES].reverse().map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3" style={{ color: INK.secondary }}>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
              <span className="num">{usd(h[s.key])}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 0.01)));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

// one fixed bill: its monthly amount and the share of it Super Pools carries, editable in place
function BillRow({ b, onSave, onEnd, busy }: { b: Bill; onSave: (b: Bill) => void; onEnd: (id: number) => void; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ item: b.item, monthly: String(b.monthly_usd), share: String(Math.round(b.share * 100)), note: b.note ?? '' });
  useEffect(() => setF({ item: b.item, monthly: String(b.monthly_usd), share: String(Math.round(b.share * 100)), note: b.note ?? '' }), [b.id, b.monthly_usd, b.share, b.item, b.note]);
  if (!edit) {
    return (
      <li className="py-2">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold">{b.item}</span>
          <span className="num shrink-0">{usd(b.monthly_usd * b.share)}<span className="text-mute"> /mo</span></span>
          <button className="btn-ghost btn-sm shrink-0" onClick={() => setEdit(true)}>Edit</button>
        </div>
        <div className="text-xs text-mute">
          {b.share < 1 && <>{usd(b.monthly_usd)} bill, {Math.round(b.share * 100)}% carried here. </>}
          {b.note}
        </div>
      </li>
    );
  }
  return (
    <li className="space-y-2 py-2">
      <input className="input w-full" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} aria-label="Bill" />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-mute">Monthly bill ($)<input className="input mt-1 w-full" inputMode="decimal" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} /></label>
        <label className="text-xs text-mute">Share carried here (%)<input className="input mt-1 w-full" inputMode="numeric" value={f.share} onChange={(e) => setF({ ...f, share: e.target.value })} /></label>
      </div>
      <input className="input w-full" placeholder="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="Note" />
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => { onSave({ ...b, item: f.item, monthly_usd: Number(f.monthly), share: Number(f.share) / 100, note: f.note }); setEdit(false); }}>Save</button>
        <button className="btn-ghost btn-sm" onClick={() => setEdit(false)}>Cancel</button>
        <button className="btn-ghost btn-sm ml-auto text-red-300" disabled={busy} onClick={() => { if (confirm(`Stop counting “${b.item}” from today?`)) onEnd(b.id); }}>End bill</button>
      </div>
      <p className="text-[11px] text-mute">A new price counts from today; the days before keep the old one.</p>
    </li>
  );
}

export default function Costs() {
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<30 | 90>(30);
  const [showTable, setShowTable] = useState(false);
  const [add, setAdd] = useState({ item: '', monthly: '', share: '100', note: '' });
  const { busy, run } = useAction();
  const load = async () => {
    try { setD(await rpc<Dash>('cost_dashboard', { p_days: 92 })); setErr(null); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { load(); }, []);
  // nothing was billed before the books started, so the chart starts there
  const days = useMemo(() => (d?.daily ?? []).slice(-range).filter((x) => x.day >= BOOKS_START), [d, range]);
  const rangeTotals = useMemo(() => {
    const t = { fixed: 0, garry: 0, x_feed: 0, other: 0 } as Record<Key, number>;
    for (const x of days) for (const s of SOURCES) t[s.key] += x[s.key];
    return t;
  }, [days]);

  if (err) {
    return (
      <div className="card p-6 text-center text-sm text-mute">
        {/admins only/i.test(err) ? 'Running costs are for the platform owner.' : err}
        <div className="mt-2"><Link to="/" className="text-gold underline">Back home</Link></div>
      </div>
    );
  }
  if (!d) return <div className="grid place-items-center p-10"><Spinner /></div>;

  const s = d.summary;
  const rangeSum = Object.values(rangeTotals).reduce((a, b) => a + b, 0);
  const metered = d.features.reduce((a, f) => a + Number(f.usd), 0);
  const recentAlerts = d.alerts.filter((a) => a.day >= days[0]?.day);
  const save = (b: Bill) => run(async () => { await rpc('cost_set_fixed', { p_id: b.id, p_item: b.item, p_monthly: b.monthly_usd, p_share: b.share, p_note: b.note ?? '' }); await load(); }, 'Bill saved');
  const end = (id: number) => run(async () => { await rpc('cost_end_fixed', { p_id: id }); await load(); }, 'Bill ended');
  const addBill = () => run(async () => {
    await rpc('cost_set_fixed', { p_id: null, p_item: add.item, p_monthly: Number(add.monthly), p_share: Number(add.share) / 100, p_note: add.note, p_source: 'other' });
    setAdd({ item: '', monthly: '', share: '100', note: '' });
    await load();
  }, 'Bill added');

  return (
    <div className="space-y-5">
      <PageHeader icon={<Receipt size={22} className="text-gold" />} title="Running costs" sub="What SaK and Super Pools cost to run, and where it goes."
        right={<Link to="/calibration" className="btn-ghost btn-sm shrink-0">🎯 Calibration</Link>} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="This month so far" value={usd(s.mtd)} sub={`${new Date(`${d.today}T12:00:00`).toLocaleDateString(undefined, { month: 'long' })}, through today`} />
        <Stat label="Month, projected" value={usd(s.projected_month)} sub={`${usd(s.fixed_month, 0)} of it fixed bills`} />
        <Stat label="Yesterday" value={usd(s.yesterday)} sub={`today so far ${usd(s.today)}`} />
        <Stat label="AI spend a day" value={usd(s.metered_avg_7)} sub="average, last 7 days" />
      </div>

      {recentAlerts.length > 0 && (
        <div className="space-y-1 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          {recentAlerts.map((a) => <div key={a.day}>⚠️ <span className="font-semibold">{fmtDate(a.day)}</span> {plainAlert(a.message)}</div>)}
        </div>
      )}

      <Section title="📅 By day" right={
        <div className="flex gap-1">
          {([30, 90] as const).map((r) => <button key={r} className={`btn-sm ${range === r ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setRange(r)}>{r} days</button>)}
        </div>}>
        <div className="card space-y-3 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Legend />
            <span className="text-xs text-mute">{range} days: <span className="num font-semibold text-white">{usd(rangeSum)}</span></span>
          </div>
          {days.length > 0 && <DailyBars days={days} />}
          <div className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
            {SOURCES.map((x) => (
              <div key={x.key} className="rounded-lg bg-white/[.04] px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-[10px] text-mute"><span className="h-2 w-2 rounded-sm" style={{ background: x.color }} />{x.label}</div>
                <div className="num font-semibold">{usd(rangeTotals[x.key])} <span className="font-normal text-mute">{rangeSum ? Math.round((rangeTotals[x.key] / rangeSum) * 100) : 0}%</span></div>
              </div>
            ))}
          </div>
          <button className="text-xs text-mute underline" onClick={() => setShowTable(!showTable)}>{showTable ? 'Hide' : 'Show'} the days as a table</button>
          {showTable && (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0e1527] text-mute"><tr><th className="py-1 text-left font-semibold">Day</th>{SOURCES.map((x) => <th key={x.key} className="whitespace-nowrap pl-2 text-right font-semibold">{x.short}</th>)}<th className="whitespace-nowrap pl-2 text-right font-semibold">Total</th></tr></thead>
                <tbody className="divide-y divide-white/[.05]">
                  {[...days].reverse().map((x) => (
                    <tr key={x.day}><td className="py-1">{fmtDate(x.day)}</td>{SOURCES.map((c) => <td key={c.key} className="num whitespace-nowrap pl-2 text-right">{usd(x[c.key])}</td>)}<td className="num whitespace-nowrap pl-2 text-right font-semibold">{usd(total(x))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      <Section title="🗓️ By month">
        <div className="card overflow-x-auto p-3">
          <table className="w-full text-xs">
            <thead className="text-mute"><tr><th className="py-1 text-left font-semibold">Month</th>{SOURCES.map((x) => <th key={x.key} className="whitespace-nowrap pl-2 text-right font-semibold">{x.short}</th>)}<th className="whitespace-nowrap pl-2 text-right font-semibold">Total</th></tr></thead>
            <tbody className="divide-y divide-white/[.05]">
              {d.months.map((m) => {
                const cur = m.month === d.today.slice(0, 7);
                return (
                  <tr key={m.month}>
                    <td className="py-1.5">{monthName(m.month)}{cur && <div className="text-[10px] text-mute">so far · projected {usd(s.projected_month)}</div>}</td>
                    {SOURCES.map((x) => <td key={x.key} className="num whitespace-nowrap pl-2 text-right">{usd(m[x.key])}</td>)}
                    <td className="num whitespace-nowrap pl-2 text-right font-semibold">{usd(total(m))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-mute">The books start {fmtDate(BOOKS_START)}; AI calls are itemised from {d.metered_since ? fmtDate(d.metered_since) : 'the first call'}.</p>
        </div>
      </Section>

      <Section title="🧩 By feature" right={<span className="text-xs text-mute">last 30 days</span>}>
        <div className="card overflow-x-auto p-3">
          {d.features.length === 0 ? <div className="text-sm text-mute">No paid calls in the last 30 days.</div> : (
            <table className="w-full text-xs">
              <thead className="text-mute"><tr><th className="py-1 text-left font-semibold">Feature</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Calls</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Each</th><th className="whitespace-nowrap pl-2 text-right font-semibold">A day</th><th className="whitespace-nowrap pl-2 text-right font-semibold">30 days</th></tr></thead>
              <tbody className="divide-y divide-white/[.05]">
                {d.features.map((f) => (
                  <tr key={`${f.source}.${f.feature}`}>
                    <td className="py-1.5 pr-2">
                      {featureName(f.feature)}
                      <div className="text-[10px] text-mute">
                        {f.leagues > 0 ? `${f.leagues} league${f.leagues > 1 ? 's' : ''}` : 'shared by every league'}
                        {f.units > 0 && ` · ${Number(f.units).toLocaleString()} posts read`}
                        {f.input_tokens > 0 && ` · ${Math.round((f.input_tokens + f.output_tokens) / 1000).toLocaleString()}k tokens`}
                      </div>
                    </td>
                    <td className="num whitespace-nowrap pl-2 text-right">{Number(f.calls).toLocaleString()}</td>
                    <td className="num whitespace-nowrap pl-2 text-right">{usd(f.usd / Math.max(1, f.calls))}</td>
                    <td className="num whitespace-nowrap pl-2 text-right">{usd(f.usd / 30)}</td>
                    <td className="num whitespace-nowrap pl-2 text-right font-semibold">{usd(f.usd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-white/10"><td className="py-1.5 font-semibold">All AI</td><td /><td /><td className="num whitespace-nowrap pl-2 text-right">{usd(metered / 30)}</td><td className="num whitespace-nowrap pl-2 text-right font-semibold">{usd(metered)}</td></tr></tfoot>
            </table>
          )}
          <p className="mt-2 text-[11px] text-mute">xAI prices every call itself; these are its numbers. The X feed is billed per post Grok reads, plus tokens.</p>
        </div>
      </Section>

      <Section title="🏒 By league" right={<span className="text-xs text-mute">last 30 days</span>}>
        <div className="card overflow-x-auto p-3">
          <table className="w-full text-xs">
            <thead className="text-mute"><tr><th className="py-1 text-left font-semibold">League</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Its own</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Shared</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Total</th><th className="whitespace-nowrap pl-2 text-right font-semibold">Per GM</th></tr></thead>
            <tbody className="divide-y divide-white/[.05]">
              {d.leagues.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-2">{l.short_name}<div className="text-[10px] text-mute">{l.gms} GMs</div></td>
                  <td className="num whitespace-nowrap pl-2 text-right">{usd(l.direct_30)}</td>
                  <td className="num whitespace-nowrap pl-2 text-right">{usd(l.shared_30)}</td>
                  <td className="num whitespace-nowrap pl-2 text-right font-semibold">{usd(l.total_30)}</td>
                  <td className="num whitespace-nowrap pl-2 text-right">{usd(l.total_30 / Math.max(1, l.gms))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-mute">
            “Its own” is what the league’s Garry costs. “Shared” is the fixed bills and the X feed, split evenly over the {s.leagues} active
            league{s.leagues > 1 ? 's' : ''}: it falls with every league added, which is where the margin on a paid league comes from.
          </p>
        </div>
      </Section>

      <Section title="🧾 Fixed bills" right={<span className="num text-xs text-mute">{usd(s.fixed_month)} /mo</span>}>
        <div className="card p-3">
          <ul className="divide-y divide-white/[.05] text-sm">
            {d.fixed.map((b) => <BillRow key={b.id} b={b} onSave={save} onEnd={end} busy={busy} />)}
          </ul>
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
            <div className="text-xs font-semibold text-mute">Add a bill</div>
            <input className="input w-full" placeholder="What it is (e.g. Cloudflare, domain renewal)" value={add.item} onChange={(e) => setAdd({ ...add, item: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input w-full" inputMode="decimal" placeholder="$ a month" value={add.monthly} onChange={(e) => setAdd({ ...add, monthly: e.target.value })} />
              <input className="input w-full" inputMode="numeric" placeholder="Share %" value={add.share} onChange={(e) => setAdd({ ...add, share: e.target.value })} />
            </div>
            <input className="input w-full" placeholder="Note (optional)" value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
            <button className="btn-primary btn-sm" disabled={busy || !add.item.trim() || add.monthly === ''} onClick={addBill}>Add bill</button>
          </div>
        </div>
      </Section>

      <Section title="📦 Headroom">
        <div className="card space-y-3 p-3 text-sm">
          <div>
            <div className="flex justify-between text-xs"><span className="text-mute">Database size</span><span className="num">{mb(d.usage.db_bytes)} of {mb(d.usage.db_included_bytes)} included</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-[#3987e5]" style={{ width: `${Math.max(1, (d.usage.db_bytes / d.usage.db_included_bytes) * 100)}%` }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className="rounded-lg bg-white/[.04] px-2 py-1.5"><div className="text-[10px] text-mute">Paid AI calls, 30 days</div><div className="num font-semibold">{Number(d.usage.ai_calls_30).toLocaleString()}</div></div>
            <div className="rounded-lg bg-white/[.04] px-2 py-1.5"><div className="text-[10px] text-mute">Scheduled job runs yesterday</div><div className="num font-semibold">{d.usage.cron_runs_yesterday != null ? Number(d.usage.cron_runs_yesterday).toLocaleString() : 'recorded nightly'}</div></div>
          </div>
          <p className="text-[11px] text-mute">The Supabase plan includes 2 million function calls, 8 GB of database and 250 GB of transfer a month; SaK uses a small fraction of each, so the plan stays flat until well past many leagues.</p>
        </div>
      </Section>
    </div>
  );
}
