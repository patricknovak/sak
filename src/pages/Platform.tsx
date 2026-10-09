// The platform's page (#/platform, platform admins only): every league on Super Pools at a glance, the checklist each
// new league works through, the commissioner's invite, the switch that puts a league live, and the form that opens a
// new one. A league is built whole by create_league (rules from SaK's, its draft, its voice, open seats with their
// opening coins); its commissioner gets in by the invite made here and runs the league from then on.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe2 } from 'lucide-react';
import { rpc, supabase } from '../lib/supabase';
import { brandOf, PRODUCT, type Brand } from '../lib/brand';
import { PageHeader, Section, Spinner, useAction } from '../components/ui';
import { ago } from '../lib/format';
import { BrandPreview, ColourPicker, LEAGUE_COLOURS, starterBrand, themed, type BrandRow } from '../components/LeagueIdentity';
import { Wordmark } from '../components/Brand';
import { Checklist, type Check } from '../components/Readiness';
import { appLink, leagueUrl } from '../lib/host';
import { PoolIdeas, PoolTest } from '../components/PoolTest';
import { PoolGamesPlatform } from '../components/PoolGamesPlatform';
import { GameFix } from '../components/GameFix';

interface Row {
  league_id: number; slug: string; name: string; short_name: string; status: 'setup' | 'active' | 'archived'; created_at: string;
  seats: number; filled: number; spectators: number; commish_team: number | null; commish_name: string | null; commish_seated: boolean; brand: BrandRow | null; domain: string | null;
  active_7d?: number; last_seen?: string | null;
  format?: 'season' | 'h2h' | null; categories?: number;   // how the league plays (migration 130)
}

const STATUS = {
  setup: { label: 'Setting up', cls: 'border-amber-300/30 bg-amber-400/15 text-amber-200' },
  active: { label: 'Live', cls: 'border-emerald-300/30 bg-emerald-400/15 text-emerald-200' },
  archived: { label: 'Archived', cls: 'border-white/10 bg-white/[.06] text-mute' },
} as const;

const link = (code: string) => appLink(`/join/${code}`);
const opened = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export default function Platform() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => rpc<Row[]>('platform_leagues').then((r) => { setRows(r ?? []); setErr(''); }, (e: Error) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="card p-6 text-center text-sm text-mute">{/platform/i.test(err) ? 'This page is for the people who run Super Pools.' : err}</div>;
  if (!rows) return <div className="flex justify-center py-16"><Spinner /></div>;
  const live = rows.filter((r) => r.status === 'active').length;
  const gms = rows.reduce((n, r) => n + r.filled, 0);

  return (
    <div className="space-y-5">
      <PageHeader icon={<Globe2 size={22} className="text-gold" />} title="Platform" sub={`${PRODUCT.name}: every league, and opening the next one`}
        right={<div className="flex shrink-0 flex-col gap-1.5"><Link to="/costs" className="btn-ghost btn-sm">🧾 Costs</Link><Link to="/calibration" className="btn-ghost btn-sm">🎯 Calibration</Link></div>} />

      <div className="grid grid-cols-3 gap-2">
        {[{ v: rows.length, l: rows.length === 1 ? 'League' : 'Leagues' }, { v: live, l: 'Live' }, { v: gms, l: 'GMs signed in' }].map((x) => (
          <div key={x.l} className="rounded-2xl border border-white/[.07] bg-white/[.04] px-3 py-2.5 text-center">
            <div className="num font-display text-3xl font-extrabold leading-none text-white">{x.v}</div>
            <div className="label mt-1">{x.l}</div>
          </div>
        ))}
      </div>

      <Requests leagues={rows} reload={load} />

      <PoolTest />

      <PoolGamesPlatform />

      <PoolIdeas />

      <GameFix />
      <Tournaments />

      <Section title="Leagues">
        <div className="space-y-3">{rows.map((r) => <LeagueCard key={r.league_id} r={r} reload={load} />)}</div>
      </Section>

      <Section title="Open a new league">
        <NewLeague taken={rows.map((r) => r.slug)} onMade={load} />
      </Section>
    </div>
  );
}

// March Madness (migration 201): the Final Four's pairing of regions, set when the field is announced, so the bracket's
// tree is right from the first round. The first two regions meet in one Final Four game, the last two in the other.
const REGIONS = ['East', 'South', 'West', 'Midwest'];
function Tournaments() {
  const { busy, run } = useAction();
  const [rows, setRows] = useState<{ id: string; name: string; detail: { regions?: string[] } | null }[] | null>(null);
  const [order, setOrder] = useState<Record<string, string[]>>({});
  const load = () => supabase.from('competitions').select('id,name,detail').eq('sport', 'ncaab').eq('active', true).order('id')
    .then(({ data }) => setRows((data ?? []) as { id: string; name: string; detail: { regions?: string[] } | null }[]));
  useEffect(() => { load(); }, []);
  if (!rows?.length) return null;
  return (
    <Section title="Tournaments">
      <div className="space-y-2">
        {rows.map((t) => {
          const cur = order[t.id] ?? t.detail?.regions ?? REGIONS;
          const set = (i: number, v: string) => { const n = [...cur]; const j = n.indexOf(v); if (j >= 0) n[j] = n[i]; n[i] = v; setOrder({ ...order, [t.id]: n }); };
          return (
            <div key={t.id} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{t.name}</span>
                <span className="text-[11px] text-mute">{t.detail?.regions ? 'Final Four pairing set' : 'Pairing not set: the Final Four games will pair them once drawn'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((g) => (
                  <div key={g} className="rounded-2xl bg-white/[.04] p-2.5 ring-1 ring-white/10">
                    <div className="label mb-1.5">Final Four game {g + 1}</div>
                    <div className="flex flex-col gap-1.5">
                      {[g * 2, g * 2 + 1].map((i) => (
                        <select key={i} className="input py-1.5 text-sm" value={cur[i]} onChange={(e) => set(i, e.target.value)}>
                          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="btn-gold w-full" disabled={busy}
                onClick={() => run(async () => { await rpc('platform_set_regions', { p_competition: t.id, p_regions: cur }); await load(); }, 'Pairing saved')}>
                Save the pairing
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function LeagueCard({ r, reload }: { r: Row; reload: () => Promise<unknown> }) {
  const { busy, run } = useAction();
  const [open, setOpen] = useState(r.status === 'setup');
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [domain, setDomain] = useState(r.domain ?? '');
  const brand: Brand = useMemo(() => brandOf(r.brand as Partial<Brand> | null, r.short_name), [r.brand, r.short_name]);
  const model = r.league_id === 1;
  useEffect(() => { if (open && !checks) rpc<Check[]>('league_readiness', { p_league: r.league_id }).then(setChecks, () => setChecks([])); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const ready = !!checks && checks.every((c) => !c.required || c.ok);
  const st = STATUS[r.status];
  const pct = r.seats ? Math.round((r.filled / r.seats) * 100) : 0;

  const refresh = async () => { setChecks(await rpc<Check[]>('league_readiness', { p_league: r.league_id })); await reload(); };
  const setStatus = (s: Row['status'], ok: string) => run(async () => { await rpc('platform_set_league_status', { p_league: r.league_id, p_status: s }); await refresh(); }, ok);
  const makeInvite = () => run(async () => {
    const code = await rpc<string>('platform_invite', { p_league: r.league_id, p_team: r.commish_team, p_days: 14 });
    setInvite(code);
    try { if (navigator.share) { await navigator.share({ title: `Run ${r.name} on ${PRODUCT.name}`, url: link(code) }); return; } } catch { /* fall back to copying */ }
    try { await navigator.clipboard.writeText(link(code)); } catch { /* shown below to copy by hand */ }
  }, 'Commissioner invite made and copied');

  return (
    <div className="card-hero overflow-hidden" style={themed(brand.colors.gold)}>
      <button type="button" onClick={() => setOpen(!open)} className="relative block w-full p-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{r.status === 'active' && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300 align-middle" />}{st.label}</span>
          <span className="truncate text-[11px] text-white/45">{model ? 'The model league · ' : ''}since {opened(r.created_at)}</span>
        </div>
        <Wordmark size="md" mark={brand.wordmark} className="mt-2.5 max-w-full" />
        <div className="mt-1.5 text-sm font-semibold text-slate-100">{r.name} <span className="font-normal text-white/45">· {r.slug}</span></div>
        <div className="mt-3 flex items-center gap-3 text-xs">
          <div className="min-w-0 flex-1">
            <div className="flex justify-between text-white/60"><span>GMs</span><span className="num font-semibold text-white">{r.filled} of {r.seats}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40"><div className="h-full rounded-full bg-gradient-to-r from-gold to-[var(--gold-hi)]" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-white/60">Commissioner</div>
            <div className={`font-semibold ${r.commish_seated ? 'text-white' : 'text-amber-200'}`}>{r.commish_seated ? r.commish_name : 'Not in yet'}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/60">
          {r.format && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/[.07] px-2 py-0.5 font-semibold text-white/80">
              {r.format === 'h2h' ? `⚔️ Head-to-head${r.categories ? ` · ${r.categories} categories` : ' · points'}` : r.categories ? `📊 Rotisserie · ${r.categories} categories` : '🏒 Season points'}
            </span>
          )}
          {r.filled > 0 && (<>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${(r.active_7d ?? 0) > 0 ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/[.06] text-white/50'}`}>
              {(r.active_7d ?? 0) > 0 && <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />}{r.active_7d ?? 0} of {r.filled} active this week
            </span>
            {r.last_seen && <span>last seen {ago(r.last_seen) === 'now' ? 'just now' : /^\d/.test(ago(r.last_seen)) ? `${ago(r.last_seen)} ago` : `on ${ago(r.last_seen)}`}</span>}
          </>)}
        </div>
      </button>

      {open && (
        <div className="relative border-t border-white/10 bg-black/20 p-4">
          {!checks ? <div className="flex justify-center py-3"><Spinner /></div> : (
            <Checklist checks={checks} />
          )}
          <div className="mt-4 rounded-xl border border-white/10 bg-black/25 p-3">
            <div className="label text-white/50">Its address</div>
            <a href={leagueUrl(r.slug)} target="_blank" rel="noreferrer" className="mt-1 block break-all font-mono text-sm text-sky-200 underline decoration-sky-200/30 underline-offset-2">app.superpoolsai.com/#/p/{r.slug}</a>
            {r.domain && <a href={`https://${r.domain}/`} target="_blank" rel="noreferrer" className="mt-0.5 block break-all font-mono text-sm text-sky-200 underline decoration-sky-200/30 underline-offset-2">{r.domain}</a>}
            <div className="mt-2 flex gap-2">
              <input className="input min-w-0 flex-1 font-mono text-sm" value={domain} placeholder="Its own domain (optional)" inputMode="url" autoCapitalize="none"
                onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} />
              <button className="btn-ghost btn-sm shrink-0" disabled={busy || domain === (r.domain ?? '')}
                onClick={() => run(async () => { await rpc('platform_set_league_domain', { p_league: r.league_id, p_domain: domain || null }); await reload(); }, domain ? 'Domain saved. Point its DNS at the site.' : 'Domain removed')}>Save</button>
            </div>
          </div>
          {!model && (
            <div className="mt-4 space-y-2">
              {!r.commish_seated && r.commish_team && (
                <>
                  <button className="btn-ghost w-full" disabled={busy} onClick={makeInvite}>✉️ Invite the commissioner</button>
                  {invite && <div className="break-all rounded-lg bg-black/40 px-2.5 py-2 text-xs text-sky-200">{link(invite)}<span className="mt-1 block text-white/50">Good for 14 days. They make their account from it and land in the league as its commissioner.</span></div>}
                </>
              )}
              {r.status === 'setup' && (
                <button className="btn-gold w-full py-3 text-base" disabled={busy || !ready}
                  onClick={() => confirm(`Put ${r.name} live? Its nightly jobs (scores, lineups, ${brand.bot.name}) start tonight.`) && setStatus('active', `${r.name} is live 🏒`)}>
                  {ready ? '🏒 Go live' : 'Go live once every ! is ticked'}
                </button>
              )}
              {r.status === 'active' && <button className="btn-ghost btn-sm w-full" disabled={busy} onClick={() => confirm(`Archive ${r.name}? Its nightly jobs stop; nothing is deleted.`) && setStatus('archived', 'Archived')}>Archive this league</button>}
              {r.status === 'archived' && <button className="btn-ghost btn-sm w-full" disabled={busy} onClick={() => setStatus('setup', 'Back in setup')}>Bring it back to setup</button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NewLeague({ taken, onMade }: { taken: string[]; onMade: () => Promise<unknown> }) {
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [seats, setSeats] = useState(8);
  const [gold, setGold] = useState(LEAGUE_COLOURS[1].hex);
  const [mark, setMark] = useState<{ a: string; b: string } | null>(null);
  const web = slugTouched ? slug : slugOf(name);
  const start = starterBrand(name || 'New Pool', short || 'NP', gold);
  const wm = mark ?? (start.wordmark as { a: string; b: string });
  const brand = brandOf({ ...start, wordmark: wm } as Partial<Brand>, short || 'NP');
  const slugOk = /^[a-z0-9][a-z0-9-]{1,30}$/.test(web) && !taken.includes(web);
  const ok = name.trim().length >= 2 && short.trim().length >= 1 && slugOk;

  const make = () => run(async () => {
    await rpc<number>('create_league', { p_slug: web, p_name: name.trim(), p_short: short.trim(), p_brand: { ...start, wordmark: wm }, p_seats: seats, p_template: 1 });
    setName(''); setShort(''); setSlug(''); setSlugTouched(false); setMark(null);
    await onMade();
  }, 'League opened. Invite its commissioner from its card.');

  return (
    <div className="space-y-3">
      <BrandPreview name={name || 'Your new league'} brand={brand} compact />
      <div className="card space-y-3 p-3">
        <label className="block"><span className="label">League name</span>
          <input className="input mt-1" maxLength={60} value={name} placeholder="Pond Hockey Pool" onChange={(e) => { setName(e.target.value); setMark(null); }} /></label>
        <div className="grid grid-cols-[6.5rem_1fr] gap-2">
          <label className="block"><span className="label">Short name</span>
            <input className="input mt-1" maxLength={12} value={short} placeholder="PHP" onChange={(e) => setShort(e.target.value)} /></label>
          <label className="block min-w-0"><span className="label">Web name</span>
            <input className={`input mt-1 font-mono text-sm ${web && !slugOk ? 'border-red-400/60' : ''}`} maxLength={31} value={web} placeholder="pond-hockey-pool"
              onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} />
            {web && !slugOk && <span className="mt-1 block text-[11px] text-red-300">{taken.includes(web) ? 'Taken' : 'Lowercase letters, numbers and dashes'}</span>}
          </label>
        </div>
        <div>
          <span className="label">Wordmark</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <input className="input font-display text-lg font-extrabold uppercase italic text-gold" style={themed(gold)} maxLength={16} value={wm.a} onChange={(e) => setMark({ ...wm, a: e.target.value.toUpperCase() })} />
            <input className="input font-display text-lg font-black uppercase" maxLength={16} value={wm.b} onChange={(e) => setMark({ ...wm, b: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <div><span className="label mb-1.5 block">Colour</span><ColourPicker value={gold} onChange={setGold} /></div>
        <div className="flex items-center justify-between gap-3">
          <div><div className="label">GM seats</div><div className="text-xs text-mute">Seat 1 is the commissioner’s. Each starts with 1,000 coins.</div></div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 p-1">
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold disabled:opacity-30" disabled={seats <= 2} onClick={() => setSeats(seats - 1)} aria-label="One seat fewer">−</button>
            <span className="num w-8 text-center font-display text-2xl font-extrabold">{seats}</span>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold disabled:opacity-30" disabled={seats >= 20} onClick={() => setSeats(seats + 1)} aria-label="One seat more">+</button>
          </div>
        </div>
        <p className="text-xs text-mute">It starts with SaK’s rules, roster and scoring, which its commissioner can change, and stays in setup, off the nightly jobs, until you put it live.</p>
        <button className="btn-gold w-full py-3 text-base" style={themed(gold)} disabled={busy || !ok} onClick={make}>{busy ? <Spinner /> : '✨ Open the league'}</button>
      </div>
    </div>
  );
}

// The inbox from the Start your league page (request_league): who asked, for what. "Open it" builds the league in one
// go (its name, a short name from its initials, a web name, the seats asked for, SaK's rules) and makes the
// commissioner's invite; "Email the invite" opens a ready-written email to the person who asked.
interface Req { id: number; name: string; email: string; league_name: string; teams: number; plays_on: string | null; note: string | null; status: 'new' | 'opened' | 'declined'; league_id: number | null; created_at: string }
const PLAYS_ON: Record<string, string> = { yahoo: 'on Yahoo', espn: 'on ESPN', fantrax: 'on Fantrax', cbs: 'on CBS', sheet: 'on a spreadsheet', new: 'starting fresh', other: 'somewhere else' };
const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 4) || 'NEW';

function Requests({ leagues, reload }: { leagues: Row[]; reload: () => Promise<unknown> }) {
  const { busy, run } = useAction();
  const [reqs, setReqs] = useState<Req[] | null>(null);
  const [made, setMade] = useState<Record<number, string>>({});   // request id -> invite link
  const load = () => rpc<Req[]>('platform_league_requests').then(setReqs, () => setReqs([]));
  useEffect(() => { load(); }, []);
  if (!reqs || !reqs.length) return null;
  const fresh = reqs.filter((r) => r.status === 'new');

  const open = (q: Req) => run(async () => {
    const taken = new Set(leagues.map((l) => l.slug));
    const base = (slugOf(q.league_name) || 'league').slice(0, 27); let slug = base; for (let k = 2; taken.has(slug); k++) slug = `${base}-${k}`;
    const short = initials(q.league_name);
    const lid = await rpc<number>('create_league', { p_slug: slug, p_name: q.league_name, p_short: short, p_brand: starterBrand(q.league_name, short, LEAGUE_COLOURS[1].hex), p_seats: q.teams, p_template: 1 });
    await rpc('platform_close_request', { p_id: q.id, p_status: 'opened', p_league: lid });
    const row = (await rpc<Row[]>('platform_leagues')).find((l) => l.league_id === lid);
    if (row?.commish_team) {
      const code = await rpc<string>('platform_invite', { p_league: lid, p_team: row.commish_team, p_days: 14 });
      setMade((m) => ({ ...m, [q.id]: link(code) }));
    }
    await Promise.all([load(), reload()]);
  }, 'League opened, invite ready');

  const mail = (q: Req, url: string) => {
    const first = q.name.split(/\s+/)[0];
    const body = `Hi ${first},\n\n${q.league_name} is ready on ${PRODUCT.name}. This link takes your commissioner's seat (it works once, for 14 days):\n\n${url}\n\nFrom there you can name it, pick its colours, invite your GMs and set your draft. Let me know if you need anything else.\n\nSincerely,\n\nPatrick`;
    return `mailto:${encodeURIComponent(q.email)}?subject=${encodeURIComponent(`${q.league_name} is ready`)}&body=${encodeURIComponent(body)}`;
  };

  return (
    <Section title={<>Requests {fresh.length > 0 && <span className="ml-1 rounded-full bg-gold px-2 py-0.5 align-middle text-xs text-ice">{fresh.length} new</span>}</>}>
      <div className="space-y-2">
        {reqs.slice(0, 12).map((q) => (
          <div key={q.id} className={`card p-3 ${q.status !== 'new' ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.06] text-lg">{q.status === 'opened' ? '✅' : q.status === 'declined' ? '✖️' : '📮'}</span>
              <div className="min-w-0 flex-1">
                <div className="break-words font-semibold text-slate-100">{q.league_name}</div>
                <div className="break-words text-xs text-mute">{q.name} · {q.email}</div>
                <div className="mt-1 text-xs text-slate-300">{q.teams} teams{q.plays_on ? `, ${PLAYS_ON[q.plays_on] ?? q.plays_on}` : ''} · {opened(q.created_at)}</div>
                {q.note && <p className="mt-1.5 break-words rounded-lg bg-black/25 px-2.5 py-1.5 text-xs text-slate-300">{q.note}</p>}
              </div>
            </div>
            {q.status === 'new' && (
              <div className="mt-3 flex gap-2">
                <button className="btn-gold btn-sm flex-1" disabled={busy} onClick={() => confirm(`Open ${q.league_name} with ${q.teams} seats?`) && open(q)}>✨ Open it</button>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await rpc('platform_close_request', { p_id: q.id, p_status: 'declined' }); await load(); }, 'Declined')}>Decline</button>
              </div>
            )}
            {made[q.id] && (
              <div className="mt-3 space-y-2">
                <div className="break-all rounded-lg bg-black/40 px-2.5 py-2 text-xs text-sky-200">{made[q.id]}</div>
                <a className="btn-primary btn-sm w-full" href={mail(q, made[q.id])}>✉️ Email the invite to {q.name.split(/\s+/)[0]}</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}
