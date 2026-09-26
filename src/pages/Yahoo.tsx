// Yahoo leagues: sign in with Yahoo once, then run every other Yahoo Fantasy Hockey league you're in
// (or commission) from here, through Yahoo's official API.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { yahoo, SCORING, type YLeague } from '../lib/yahoo';
import { Empty, PageHeader, Section, Spinner } from '../components/ui';
import { ConnectYahoo, YahooMark, useYahooStatus } from '../components/YahooConnect';

export default function Yahoo() {
  const { st, reload } = useYahooStatus();
  const [leagues, setLeagues] = useState<YLeague[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setErr(null);
    yahoo<{ leagues: YLeague[] }>('leagues').then((r) => setLeagues(r.leagues), (e: Error) => setErr(e.message)).finally(() => setBusy(false));
  }, []);
  useEffect(() => { if (st?.connected) load(); }, [st?.connected, load]);

  return (
    <div className="space-y-4">
      <PageHeader icon={<YahooMark size={28} />} title="Yahoo leagues" sub="Your other Yahoo Fantasy Hockey leagues, run from SaK"
        right={st?.connected ? <button className="btn btn-sm" onClick={load} disabled={busy} aria-label="Refresh"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button> : undefined} />

      {st === undefined && <div className="grid place-items-center py-10"><Spinner /></div>}
      {st !== undefined && !st?.connected && <div className="card p-4"><ConnectYahoo st={st} onChange={reload} /></div>}

      {st?.connected && (
        <>
          {err && <div className="card border-red-400/30 bg-red-500/10 p-3 text-sm">{err}</div>}
          {!leagues && !err && <div className="grid place-items-center py-10"><Spinner /></div>}
          {leagues && leagues.length === 0 && <Empty icon="🏒" title="No Yahoo hockey leagues this season">Join or create one on Yahoo and it shows up here.</Empty>}
          {leagues && leagues.length > 0 && (
            <Section title={`${leagues.length} league${leagues.length === 1 ? '' : 's'}`}>
              <div className="grid gap-2 sm:grid-cols-2">
                {leagues.map((l) => <LeagueCard key={l.key} l={l} />)}
              </div>
            </Section>
          )}
          <div className="card p-3"><ConnectYahoo st={st} onChange={() => { reload(); setLeagues(null); }} compact /></div>
        </>
      )}
    </div>
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
      {l.url && <a href={l.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="btn btn-sm shrink-0" aria-label="Open on Yahoo"><ExternalLink size={14} /></a>}
    </Link>
  );
}
