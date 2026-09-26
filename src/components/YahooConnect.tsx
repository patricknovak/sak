// The Yahoo sign-in pieces shared by the Yahoo leagues page, the profile and the app shell.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useLeague } from '../lib/store';
import { yahoo, yahooReturn, clearYahooReturn, type YStatus } from '../lib/yahoo';
import { useAction, useToast } from './ui';

export function YahooMark({ size = 18 }: { size?: number }) {
  return <span className="inline-grid place-items-center rounded-md bg-[#6001d2] font-display font-black text-white" style={{ width: size, height: size, fontSize: size * .62 }}>Y!</span>;
}

// Yahoo sends the GM back to the site root with ?code&state; this finishes the sign-in wherever they land.
export function YahooReturnHandler() {
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    const r = yahooReturn();
    if (!r) return;
    clearYahooReturn();
    yahoo('exchange', r).then(() => { toast('Yahoo connected'); nav('/yahoo', { replace: true }); }, (e: Error) => { toast(e.message, 'err'); nav('/yahoo', { replace: true }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function useYahooStatus() {
  const [st, setSt] = useState<YStatus | null | undefined>(undefined);
  const load = useCallback(() => yahoo<YStatus>('status').then(setSt, () => setSt(null)), []);
  useEffect(() => { load(); }, [load]);
  return { st, reload: load };
}

export function ConnectYahoo({ st, onChange, compact }: { st: YStatus | null; onChange: () => void; compact?: boolean }) {
  const { me } = useLeague();
  const { busy, run } = useAction();
  if (!st) return <p className="text-sm text-mute">Couldn’t reach the Yahoo connector right now.</p>;
  if (!st.configured) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-mute">Yahoo sign-in isn’t switched on yet.{me?.is_commish ? ' To turn it on:' : ' Ask the commish to set it up.'}</p>
        {me?.is_commish && (
          <ol className="list-decimal space-y-1 pl-5 text-mute">
            <li>Create an app at <a className="text-sky-300 underline" href="https://developer.yahoo.com/apps/create/" target="_blank" rel="noreferrer">developer.yahoo.com/apps/create</a>: Web Application, redirect URI <code className="rounded bg-white/10 px-1">{st.redirect}</code>, API permission <b>Fantasy Sports → Read/Write</b>.</li>
            <li>In Supabase, <b>Edge Functions → Secrets</b>: add <code className="rounded bg-white/10 px-1">YAHOO_CLIENT_ID</code> and <code className="rounded bg-white/10 px-1">YAHOO_CLIENT_SECRET</code>.</li>
            <li>Come back here and sign in.</li>
          </ol>
        )}
      </div>
    );
  }
  if (st.connected) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <YahooMark /> <span>Yahoo connected{st.since ? ` since ${new Date(st.since).toLocaleDateString()}` : ''}</span>
        {!compact && <Link to="/yahoo" className="btn btn-sm">Open my leagues</Link>}
        <button className="btn btn-sm ml-auto" disabled={busy} onClick={() => { if (confirm('Disconnect Yahoo? SaK forgets your Yahoo sign-in; nothing changes on Yahoo.')) run(async () => { await yahoo('disconnect'); onChange(); }, 'Yahoo disconnected'); }}><LogOut size={14} /> Disconnect</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {!compact && <p className="text-sm text-mute">Sign in with Yahoo and every other Yahoo hockey league you play in or commission shows up here: standings, matchups, your lineup, pickups, trades and commissioner approvals, all from SaK. You sign in on Yahoo’s own page; SaK never sees your Yahoo password.</p>}
      <button className="btn inline-flex items-center gap-2 bg-[#6001d2] text-white hover:bg-[#7a2df0]" disabled={busy} onClick={() => run(async () => { const { url } = await yahoo<{ url: string }>('auth_url'); window.location.href = url; })}>
        <YahooMark size={20} /> Sign in with Yahoo
      </button>
    </div>
  );
}

