// The rest of a sport's centre, beside its scores (SportCentre, RoundCentre): the news, the standings, the injury
// report and the league leaders, the way NHL centre has them for hockey. One set of tabs for every sport ESPN's public
// feeds cover (soccer's leagues, the NFL, MLB, the NBA, college basketball), through nhl-hub (?task=sport-*), which trims
// and caches them. A sport ESPN keeps no injury report for (soccer) simply has no Injuries tab.
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, HeartPulse, ListOrdered, Newspaper, TrendingUp } from 'lucide-react';
import { hub } from '../lib/nhlhub';
import { useNow } from '../lib/store';

export interface DeskComp { sport: string; ext_id?: string | null }
// where ESPN keeps a competition: soccer by its league code, the rest by sport and league
export function espnPath(c: DeskComp | null | undefined): string | null {
  if (!c) return null;
  if (c.sport === 'soccer') return c.ext_id ? `soccer/${c.ext_id}` : null;
  if (c.sport === 'mlb') return 'baseball/mlb';
  if (c.ext_id?.includes('/')) return c.ext_id;
  return ({ nfl: 'football/nfl', nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball' } as Record<string, string>)[c.sport] ?? null;
}

export type DeskTab = 'news' | 'standings' | 'injuries' | 'leaders';
// the tabs a sport gets, each with its icon, for the centre's tab bar
export const deskTabs = (path: string | null, opts: { standings?: boolean } = {}) => !path ? [] : ([
  ['news', 'News', Newspaper],
  ...(opts.standings === false ? [] : [['standings', 'Standings', ListOrdered]]),
  ...(path.startsWith('soccer/') ? [] : [['injuries', 'Injuries', HeartPulse]]),
  ['leaders', path.startsWith('soccer/') ? 'Scorers' : 'Leaders', TrendingUp],
] as [DeskTab, string, typeof Newspaper][]);

function useDesk<T>(task: string, sport: string) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setData(null); setErr(null); hub<T>(task, { sport }).then(setData, (e) => setErr(e.message)); }, [task, sport]);
  return { data, err };
}

// whether a club the pool follows is this one, however each feed names it ("Guardians", "Cleveland Guardians")
const isClub = (follow: string[], name: string, short?: string | null) => follow.some((f) => f === name || f === short || name.endsWith(` ${f}`) || (!!short && f.endsWith(` ${short}`)));

const ago = (iso: string | null, now: number) => {
  if (!iso) return '';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const Loading = () => <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[.04]" />)}</div>;
const Failed = ({ what, err }: { what: string; err: string }) => <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-100">The {what} didn’t load: {err}</div>;
// a picture that won't load goes rather than leave a broken frame
const hide = (e: React.SyntheticEvent<HTMLImageElement>) => { e.currentTarget.style.display = 'none'; };
const Nothing = ({ children }: { children: React.ReactNode }) => <div className="card p-6 text-center text-sm text-mute">{children}</div>;

// ── News: the sport's headlines, newest first; a chip narrows them to one club the story names
interface Story { id: string; headline: string; blurb: string | null; image: string | null; link: string | null; at: string | null; premium: boolean; tags: string[] }
export function DeskNews({ sport, follow = [] }: { sport: string; follow?: string[] }) {
  const { data, err } = useDesk<{ items: Story[] }>('sport-news', sport);
  const now = useNow(60_000);
  const [only, setOnly] = useState<string | null>(null);
  // the clubs the pool follows that the news names, to filter by
  const named = useMemo(() => follow.filter((c) => (data?.items ?? []).some((s) => s.tags.includes(c) || s.headline.includes(c))), [data, follow]);
  const list = (data?.items ?? []).filter((s) => !only || s.tags.includes(only) || s.headline.includes(only));
  if (err) return <Failed what="news" err={err} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Nothing>No headlines right now.</Nothing>;
  const chip = (on: boolean) => `shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${on ? 'bg-gold text-[#0b1220]' : 'bg-white/[.05] text-mute'}`;
  return (
    <div className="space-y-3">
      {named.length > 0 && (
        <div className="scroll-x flex items-center gap-1">
          <button type="button" className={chip(!only)} onClick={() => setOnly(null)}>All</button>
          {named.map((c) => <button key={c} type="button" className={chip(only === c)} onClick={() => setOnly(c)}>{c}</button>)}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s, i) => (
          <a key={s.id} href={s.link ?? undefined} target="_blank" rel="noreferrer" className={`card flex flex-col overflow-hidden transition active:scale-[.99] ${i === 0 && !only ? 'sm:col-span-2' : ''}`}>
            {s.image && <img src={s.image} alt="" className="aspect-video w-full object-cover" loading="lazy" onError={hide} />}
            <div className="flex flex-1 flex-col gap-1 p-3">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-mute"><span className="font-bold text-red-300">ESPN</span><span>{ago(s.at, now)}</span>{s.premium && <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-slate-200">ESPN+</span>}</div>
              <div className={`font-semibold leading-snug text-white ${i === 0 && !only ? 'text-lg' : ''}`}>{s.headline}</div>
              {s.blurb && s.blurb !== s.headline && <div className="line-clamp-3 text-xs text-slate-400">{s.blurb}</div>}
              {s.tags.length > 0 && <div className="mt-auto flex flex-wrap gap-1 pt-1">{s.tags.map((t) => <span key={t} className="rounded-full bg-white/[.06] px-2 py-0.5 text-[11px] text-slate-200">{t}</span>)}</div>}
            </div>
          </a>
        ))}
      </div>
      <p className="px-1 text-[11px] text-mute">Headlines from ESPN, refreshed every ten minutes. <ExternalLink size={10} className="inline" /> Each opens the story on ESPN.</p>
    </div>
  );
}

// ── Standings: each group's table in the sport's own columns, the places that mean something marked down the side
interface StRow { abbrev: string | null; name: string; short: string | null; logo: string | null; seed: number | null; cells: string[]; note: { text: string; color: string | null } | null }
export function DeskStandings({ sport, follow = [] }: { sport: string; follow?: string[] }) {
  const { data, err } = useDesk<{ season: string | null; cols: string[]; groups: { name: string; rows: StRow[] }[] }>('sport-standings', sport);
  if (err) return <Failed what="standings" err={err} />;
  if (!data) return <Loading />;
  if (!data.groups.length) return <Nothing>No table yet this season.</Nothing>;
  const marks = new Map<string, string>();
  for (const g of data.groups) for (const r of g.rows) if (r.note) marks.set(r.note.text, r.note.color ?? '#94a3b8');
  return (
    <div className="space-y-4">
      {data.groups.map((g) => (
        <div key={g.name} className="card overflow-hidden">
          <div className="border-b border-white/[.06] px-3 py-2 text-[10px] font-black uppercase tracking-[.16em] text-mute">{g.name}</div>
          <div className="scroll-x">
            <table className="num w-full min-w-[320px] text-[12px]">
              <thead><tr className="text-[10px] uppercase tracking-wider text-mute"><th className="w-7 py-1.5 pl-2 text-left font-semibold">#</th><th className="py-1.5 text-left font-semibold">Team</th>{data.cols.map((c) => <th key={c} className="px-1.5 py-1.5 text-right font-semibold">{c}</th>)}</tr></thead>
              <tbody>
                {g.rows.map((r, i) => {
                  const mine = isClub(follow, r.name, r.short);
                  return (
                    <tr key={r.name} className={`border-t border-white/[.04] ${mine ? 'bg-gold/[.07]' : ''}`}>
                      <td className="py-2 pl-2 text-left font-bold text-slate-300" style={r.note ? { boxShadow: `inset 3px 0 0 ${r.note.color ?? '#94a3b8'}` } : undefined}>{r.seed ?? i + 1}</td>
                      <td className="py-2"><span className="flex items-center gap-2">{r.logo ? <img src={r.logo} alt="" className="h-5 w-5 shrink-0 object-contain" loading="lazy" onError={hide} /> : <span className="h-5 w-5 shrink-0" />}<span className="font-semibold text-white"><span className="sm:hidden">{r.short ?? r.name}</span><span className="hidden sm:inline">{r.name}</span></span></span></td>
                      {r.cells.map((c, k) => <td key={k} className={`px-1.5 py-2 text-right ${k === r.cells.length - 1 && /Pts/.test(data.cols[k]) ? 'font-black text-white' : 'text-slate-300'}`}>{c}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {marks.size > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-mute">{[...marks].map(([t, c]) => <span key={t} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-1 rounded-full" style={{ background: c }} />{t}</span>)}</div>}
      <p className="px-1 text-[11px] text-mute">{data.season ? `${data.season}, from` : 'From'} ESPN, refreshed every half hour.{follow.length ? ' The clubs in your pool are highlighted.' : ''}</p>
    </div>
  );
}

// ── Injuries: club by club, who's out, the injury and when he's expected back
interface Inj { name: string; pos: string | null; headshot: string | null; status: string; part: string | null; back: string | null; note: string | null; at: string | null }
const tone = (s: string) => /out|injured reserve|-il|60-day|suspend/i.test(s) ? 'bg-red-500/15 text-red-300' : /doubtful/i.test(s) ? 'bg-orange-500/15 text-orange-300' : 'bg-amber-400/15 text-amber-200';
export function DeskInjuries({ sport, follow = [] }: { sport: string; follow?: string[] }) {
  const { data, err } = useDesk<{ teams: { team: string; rows: Inj[] }[] }>('sport-injuries', sport);
  const [q, setQ] = useState('');
  if (err) return <Failed what="injury report" err={err} />;
  if (!data) return <Loading />;
  if (!data.teams.length) return <Nothing>Nobody on the injury report right now.</Nothing>;
  // the pool's clubs first, then everyone else alphabetically
  const teams = [...data.teams].sort((a, b) => Number(isClub(follow, b.team)) - Number(isClub(follow, a.team)) || a.team.localeCompare(b.team))
    .filter((t) => !q || t.team.toLowerCase().includes(q.toLowerCase()) || t.rows.some((r) => r.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="space-y-3">
      <input className="input w-full" placeholder="Find a team or player" value={q} onChange={(e) => setQ(e.target.value)} />
      {teams.map((t) => (
        <details key={t.team} className="card group overflow-hidden" open={!!q}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
            <span className="flex items-center gap-2 font-bold text-white">{isClub(follow, t.team) && <span className="h-2 w-2 rounded-full bg-gold" />}{t.team}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-mute">
              {(() => { const out = t.rows.filter((r) => /out|reserve|-il|60-day|suspend/i.test(r.status)).length; return out ? <span className="rounded-full bg-red-500/15 px-2 py-px font-bold text-red-300">{out} out</span> : null; })()}
              {t.rows.length} listed <span className="inline-block transition group-open:rotate-90">›</span></span>
          </summary>
          <div className="divide-y divide-white/[.05] border-t border-white/[.06]">
            {t.rows.map((r) => (
              <div key={r.name} className="flex gap-3 px-3 py-2.5">
                {r.headshot ? <img src={r.headshot} alt="" className="h-10 w-10 shrink-0 rounded-full bg-white/[.06] object-cover" loading="lazy" onError={hide} /> : <span className="h-10 w-10 shrink-0 rounded-full bg-white/[.06]" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><span className="font-semibold text-white">{r.name}</span>{r.pos && <span className="text-[11px] text-mute">{r.pos}</span>}<span className={`rounded-full px-2 py-px text-[10px] font-bold ${tone(r.status)}`}>{r.status}</span></div>
                  <div className="text-[11px] text-mute">{[r.part, r.back ? `back about ${new Date(r.back + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ')}</div>
                  {r.note && <div className="mt-0.5 text-xs text-slate-300">{r.note}</div>}
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
      <p className="px-1 text-[11px] text-mute">The injury report from ESPN, refreshed every hour.{follow.length ? ' The clubs in your pool come first.' : ''}</p>
    </div>
  );
}

// ── Leaders: the top ten in each of the sport's headline stats
interface Lead { name: string; team: string | null; pos: string | null; headshot: string | null; value: string; sub: string | null }
export function DeskLeaders({ sport }: { sport: string }) {
  const { data, err } = useDesk<{ cats: { name: string; rows: Lead[] }[] }>('sport-leaders', sport);
  const [cat, setCat] = useState(0);
  if (err) return <Failed what="leaders" err={err} />;
  if (!data) return <Loading />;
  if (!data.cats.length || !data.cats.some((c) => c.rows.length)) return <Nothing>No leaders yet this season.</Nothing>;
  const c = data.cats[Math.min(cat, data.cats.length - 1)];
  const [top, ...rest] = c.rows;
  return (
    <div className="space-y-3">
      <div className="scroll-x flex gap-1">{data.cats.map((x, i) => <button key={x.name} type="button" onClick={() => setCat(i)} className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${i === cat ? 'bg-gold text-[#0b1220]' : 'bg-white/[.05] text-mute'}`}>{x.name}</button>)}</div>
      {top && (
        <div className="card-hero relative flex items-center gap-4 overflow-hidden p-4">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/10 blur-2xl" />
          {top.headshot ? <img src={top.headshot} alt="" className="h-20 w-20 shrink-0 rounded-full bg-white/[.06] object-cover" onError={hide} /> : <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/[.06] text-3xl">🏅</span>}
          <div className="relative min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[.16em] text-gold">Leads in {c.name.toLowerCase()}</div>
            <div className="break-words text-xl font-black text-white">{top.name}</div>
            <div className="text-xs text-mute">{[top.team, top.pos].filter(Boolean).join(' · ')}{top.sub ? ` · ${top.sub}` : ''}</div>
          </div>
          <div className="num relative shrink-0 text-3xl font-black text-white">{top.value}</div>
        </div>
      )}
      <div className="card divide-y divide-white/[.05]">
        {rest.map((r, i) => (
          <div key={r.name + i} className="flex items-center gap-3 px-3 py-2">
            <span className="num w-5 shrink-0 text-right text-xs font-bold text-mute">{i + 2}</span>
            {r.headshot ? <img src={r.headshot} alt="" className="h-8 w-8 shrink-0 rounded-full bg-white/[.06] object-cover" loading="lazy" onError={hide} /> : <span className="h-8 w-8 shrink-0 rounded-full bg-white/[.06]" />}
            <div className="min-w-0 flex-1"><div className="break-words text-sm font-semibold text-white">{r.name}</div><div className="text-[11px] text-mute">{[r.team, r.pos].filter(Boolean).join(' · ')}{r.sub ? ` · ${r.sub}` : ''}</div></div>
            <span className="num shrink-0 font-black text-white">{r.value}</span>
          </div>
        ))}
      </div>
      <p className="px-1 text-[11px] text-mute">From ESPN, refreshed every hour.</p>
    </div>
  );
}

// a centre's tab bar: its own tabs (scores, the table, the bracket) then the desk's, in one row that scrolls on a phone
export function CentreTabs<T extends string>({ tab, setTab, tabs, live }: { tab: T; setTab: (t: T) => void; tabs: [T, string, typeof Newspaper][]; live?: boolean }) {
  return (
    <div className="scroll-x -mx-1 flex gap-1.5 px-1">
      {tabs.map(([k, l, I]) => (
        <button key={k} type="button" onClick={() => setTab(k)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold ring-1 transition ${tab === k ? 'bg-white text-[#0b1220] ring-white' : 'bg-white/[.04] text-white/75 ring-white/10 hover:text-white'}`}>
          <I className="h-4 w-4" /> {l}{k === 'scores' && live && <span className="relative ml-0.5 flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" /></span>}
        </button>
      ))}
    </div>
  );
}

export function SportDesk({ tab, sport, follow }: { tab: DeskTab; sport: string; follow?: string[] }) {
  return tab === 'news' ? <DeskNews sport={sport} follow={follow} /> : tab === 'standings' ? <DeskStandings sport={sport} follow={follow} />
    : tab === 'injuries' ? <DeskInjuries sport={sport} follow={follow} /> : <DeskLeaders sport={sport} />;
}
