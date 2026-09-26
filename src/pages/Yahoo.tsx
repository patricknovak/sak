// My pools: every other pool a GM plays in, one tap from SaK. Yahoo, ESPN, Sleeper, Fantrax, NHL.com, anything
// with a URL: it opens in the SaK side window (a popup beside the site on a computer; on a phone, a browser
// tab, or the in-app browser when SaK is installed on the Home Screen). Yahoo and the others refuse to load
// inside another site's page, so the side window is as close as it gets. The Yahoo API connection stays
// here as an optional extra for read-only views inside SaK.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GripVertical, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { yahoo, openYahoo, SCORING, type YLeague } from '../lib/yahoo';
import { Empty, PageHeader, Section, Sheet, Spinner, useAction } from '../components/ui';
import { ConnectYahoo, YahooMark, useYahooStatus } from '../components/YahooConnect';

interface PoolLink { id: number; team_id: number; label: string; url: string; provider: string | null; sort: number }

// the big fantasy hockey hosts, for the quick-open buttons and to badge saved links
const PROVIDERS: { key: string; name: string; home: string; color: string; mark: string; match: RegExp }[] = [
  { key: 'yahoo', name: 'Yahoo Fantasy Hockey', home: 'https://hockey.fantasysports.yahoo.com/', color: '#6001d2', mark: 'Y!', match: /yahoo\.com/ },
  { key: 'espn', name: 'ESPN Fantasy Hockey', home: 'https://fantasy.espn.com/hockey/', color: '#d00', mark: 'E', match: /espn\.com/ },
  { key: 'sleeper', name: 'Sleeper', home: 'https://sleeper.com/', color: '#1c4fd6', mark: 'S', match: /sleeper\.(com|app)/ },
  { key: 'fantrax', name: 'Fantrax', home: 'https://www.fantrax.com/', color: '#0b7a3b', mark: 'F', match: /fantrax\.com/ },
  { key: 'nhl', name: 'NHL.com Fantasy', home: 'https://www.nhl.com/fantasy/', color: '#000', mark: 'NHL', match: /nhl\.com/ },
  { key: 'cbs', name: 'CBS Fantasy', home: 'https://www.cbssports.com/fantasy/hockey/', color: '#0a3d91', mark: 'CBS', match: /cbssports\.com/ },
];
const providerOf = (url: string) => PROVIDERS.find((p) => p.match.test(url))?.key ?? null;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

function ProviderMark({ p, size = 28 }: { p?: typeof PROVIDERS[number]; size?: number }) {
  if (!p) return <span className="grid shrink-0 place-items-center rounded-lg bg-white/[.08] text-base" style={{ width: size, height: size }}>🔗</span>;
  return <span className="grid shrink-0 place-items-center rounded-lg font-display font-black text-white" style={{ width: size, height: size, background: p.color, fontSize: p.mark.length > 2 ? size * .34 : size * .55 }}>{p.mark}</span>;
}

export default function Yahoo() {
  const { me } = useLeague();
  const { busy, run } = useAction();
  const [links, setLinks] = useState<PoolLink[] | null>(null);
  const [editing, setEditing] = useState<Partial<PoolLink> | null>(null);
  const standalone = typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
  const desktop = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

  const load = useCallback(() => { supabase.from('pool_links').select('*').order('sort').order('id').then(({ data }) => setLinks((data ?? []) as PoolLink[])); }, []);
  useEffect(() => { load(); }, [load]);

  const save = () => run(async () => {
    const url = (editing?.url ?? '').trim().replace(/^(?!https?:\/\/)/, 'https://');
    const label = (editing?.label ?? '').trim() || hostOf(url);
    if (editing?.id) await supabase.from('pool_links').update({ label, url, provider: providerOf(url) }).eq('id', editing.id).throwOnError();
    else await supabase.from('pool_links').insert({ team_id: me!.id, label, url, provider: providerOf(url), sort: (links?.length ?? 0) + 1 }).throwOnError();
    setEditing(null); load();
  }, 'Saved');
  const remove = (l: PoolLink) => confirm(`Remove “${l.label}”?`) && run(async () => { await supabase.from('pool_links').delete().eq('id', l.id).throwOnError(); load(); }, 'Removed');
  const move = (l: PoolLink, dir: -1 | 1) => run(async () => {
    const list = [...(links ?? [])]; const i = list.findIndex((x) => x.id === l.id); const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((x, k) => supabase.from('pool_links').update({ sort: k + 1 }).eq('id', x.id)));
    load();
  });
  const grouped = useMemo(() => (links ?? []), [links]);

  return (
    <div className="space-y-5">
      <PageHeader icon={<span className="text-2xl">🏒</span>} title="My pools" sub="Every other pool you play in, one tap from SaK"
        right={<button className="btn-primary btn-sm" onClick={() => setEditing({ label: '', url: '' })}><Plus size={14} /> Add a pool</button>} />

      <Section title="Quick open">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => (
            <button key={p.key} className="card flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition active:scale-[.98]" onClick={() => openYahoo(p.home)}>
              <ProviderMark p={p} /><span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span><ExternalLink size={14} className="shrink-0 text-mute" />
            </button>
          ))}
        </div>
        <p className="mt-1.5 px-1 text-xs text-mute">
          {desktop ? 'Opens in the SaK side window, beside the site, and stays signed in between visits. ' : standalone ? 'Opens in SaK’s in-app browser; swipe it away to come back. ' : 'Opens in a new tab. Add SaK to your Home Screen and it opens inside the app instead. '}
          Yahoo, ESPN and the rest won’t load inside another site’s page (their own security rule), so the window is as close as it gets. You sign in on their page; SaK never sees those passwords.
        </p>
      </Section>

      <Section title="Saved pools" right={<span className="text-xs text-mute">Only you see these</span>}>
        {links === null && <div className="grid place-items-center py-6"><Spinner /></div>}
        {links && links.length === 0 && <div className="card"><Empty icon="📌" title="No saved pools yet">Add the link to any league you’re in (the page you land on after signing in) and it’s one tap from here, every time.<div className="mt-3"><button className="btn-primary btn-sm" onClick={() => setEditing({ label: '', url: '' })}><Plus size={14} /> Add a pool</button></div></Empty></div>}
        {links && links.length > 0 && (
          <div className="card divide-y divide-white/[.06]">
            {grouped.map((l, i) => {
              const p = PROVIDERS.find((x) => x.key === l.provider);
              return (
                <div key={l.id} className="flex items-center gap-2 px-2 py-2">
                  <div className="hidden flex-col text-mute sm:flex"><button className="rounded px-1 leading-none hover:text-white disabled:opacity-30" disabled={i === 0 || busy} onClick={() => move(l, -1)} aria-label="Move up">▲</button><button className="rounded px-1 leading-none hover:text-white disabled:opacity-30" disabled={i === grouped.length - 1 || busy} onClick={() => move(l, 1)} aria-label="Move down">▼</button></div>
                  <GripVertical size={14} className="text-mute sm:hidden" />
                  <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => openYahoo(l.url)}>
                    <ProviderMark p={p} size={32} />
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold">{l.label}</span><span className="block truncate text-[11px] text-mute">{p?.name ?? hostOf(l.url)}</span></span>
                  </button>
                  <button className="btn btn-sm" onClick={() => openYahoo(l.url)} aria-label="Open"><ExternalLink size={14} /></button>
                  <button className="btn-ghost btn-sm" onClick={() => setEditing(l)} aria-label="Edit"><Pencil size={14} /></button>
                  <button className="btn-ghost btn-sm text-red-300" onClick={() => remove(l)} aria-label="Remove"><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <YahooApi />

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit pool' : 'Add a pool'}>
        {editing && (
          <div className="space-y-3">
            <label className="block text-xs text-mute">Link<input className="input mt-1" placeholder="https://hockey.fantasysports.yahoo.com/hockey/12345" inputMode="url" autoFocus value={editing.url ?? ''} onChange={(e) => setEditing({ ...editing, url: e.target.value })} /></label>
            <label className="block text-xs text-mute">Name<input className="input mt-1" placeholder={editing.url ? (PROVIDERS.find((p) => p.match.test(editing.url!))?.name ?? hostOf(editing.url)) : 'e.g. Work league'} maxLength={60} value={editing.label ?? ''} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></label>
            <p className="text-xs text-mute">Tip: open the pool, sign in, copy the address of your league’s home page (or your team page) and paste it here.</p>
            <button className="btn-primary w-full" disabled={busy || !/^(https?:\/\/)?\S+\.\S+/.test((editing.url ?? '').trim())} onClick={save}>{editing.id ? 'Save' : 'Add'}</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

// the Yahoo API connection: optional, read-only views inside SaK for the Yahoo leagues you're in
function YahooApi() {
  const { st, reload } = useYahooStatus();
  const [open, setOpen] = useState(false);
  const [leagues, setLeagues] = useState<YLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setErr(null);
    yahoo<{ leagues: YLeague[] }>('leagues').then((r) => setLeagues(r.leagues), (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  }, []);
  useEffect(() => { if (st?.connected && (open || true)) load(); }, [st?.connected, open, load]);
  useEffect(() => { if (st?.connected) setOpen(true); }, [st?.connected]);
  return (
    <Section icon={<YahooMark size={18} />} title="Yahoo inside SaK (optional)" right={st?.connected ? <button className="btn btn-sm" onClick={load} disabled={busy} aria-label="Refresh"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button> : <button className="text-xs text-sky-300" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>}>
      {!open && !st?.connected && <p className="px-1 text-xs text-mute">Sign in with Yahoo and your Yahoo leagues show up here with standings, matchups and rosters read straight from Yahoo. Managing (lineups, pickups, trades) still happens in the Yahoo window above.</p>}
      {open && (
        <div className="space-y-2">
          {st === undefined && <div className="grid place-items-center py-6"><Spinner /></div>}
          {st !== undefined && !st?.connected && <div className="card p-4"><ConnectYahoo st={st} onChange={reload} /></div>}
          {st?.connected && (
            <>
              {err && <div className="card border-amber-400/30 bg-amber-500/10 p-3 text-sm">Yahoo wouldn’t share your leagues ({err}). The Yahoo window above still works; this part depends on Yahoo granting the app Fantasy Sports access.</div>}
              {!leagues && !err && <div className="grid place-items-center py-6"><Spinner /></div>}
              {leagues && leagues.length === 0 && <Empty icon="🏒" title="No Yahoo hockey leagues this season">Join or create one on Yahoo and it shows up here.</Empty>}
              {leagues && leagues.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{leagues.map((l) => <LeagueCard key={l.key} l={l} />)}</div>}
              <div className="card p-3"><ConnectYahoo st={st} onChange={() => { reload(); setLeagues(null); }} compact /></div>
            </>
          )}
        </div>
      )}
    </Section>
  );
}

function LeagueCard({ l }: { l: YLeague }) {
  const me = l.me;
  const rec = me && me.w != null ? `${me.w}-${me.l ?? 0}${me.t ? `-${me.t}` : ''}` : null;
  return (
    <Link to={`/yahoo/${l.key}`} className={`card flex items-center gap-3 p-3 transition active:scale-[.98] ${l.finished ? 'opacity-70' : ''}`}>
      {l.logo ? <img src={l.logo} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[.06] text-2xl">🏒</div>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5"><span className="truncate font-semibold">{l.name}</span>{me?.commissioner && <span className="chip shrink-0 bg-amber-400/15 text-amber-200">Commish</span>}{l.finished && <span className="chip shrink-0">Finished</span>}</div>
        <div className="truncate text-xs text-mute">{l.season}-{String(Number(l.season) + 1).slice(2)} · {l.teams ?? '?'} teams · {SCORING[l.scoring] ?? l.scoring}{l.week && !l.finished ? ` · Week ${l.week}` : ''}{l.draft && l.draft !== 'postdraft' ? ` · ${l.draft === 'predraft' ? 'Draft pending' : l.draft}` : ''}</div>
        {me && <div className="mt-0.5 truncate text-xs">{me.logo && <img src={me.logo} alt="" className="mr-1 inline h-4 w-4 rounded" />}<span className="font-medium">{me.name}</span>{me.rank ? <span className="text-mute"> · {me.rank}{me.rank === 1 ? 'st' : me.rank === 2 ? 'nd' : me.rank === 3 ? 'rd' : 'th'}</span> : null}{rec ? <span className="text-mute"> · {rec}</span> : me.pf != null ? <span className="text-mute"> · {me.pf} pts</span> : null}</div>}
      </div>
      {l.url && <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openYahoo(l.url!); }} className="btn btn-sm shrink-0" aria-label="Open on Yahoo"><ExternalLink size={14} /></button>}
    </Link>
  );
}
