// The fan zones open to everyone (25 October 2026, Patrick: "an open source type project on the homepage for all the
// different NHL teams ... easy to share with others"): signed out, or signed in with no league (a fan's own account), a
// #/fans page opens in this frame: the product's mark, the fan zones, the club picker and a way in, and no league
// around it. A member of a league reads the same pages inside the league's own layout (main.tsx). A player opens on
// NHL.com here, since no league's players are loaded.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, LogOut } from 'lucide-react';
import { ProductMark, Wordmark } from '../components/Brand';
import { PlayerLinkProvider } from '../lib/playerInfo';
import { PublicFrame, fanDir, fanLeagues, zonePath, type FanDir } from '../lib/fanVoice';
import { PRODUCT } from '../lib/brand';
import { NHL_TEAMS } from '../lib/format';
import { useLeague } from '../lib/store';
import { signOut } from '../lib/guest';
import { Spinner } from '../components/ui';
import { ErrorBoundary } from '../components/ErrorBoundary';

const FanZone = lazy(() => import('./FanZone'));
const FansIndex = lazy(() => import('./FansIndex'));
const FanPulse = lazy(() => import('./FanPulse'));
const FansAbout = lazy(() => import('./FansAbout'));
const SportFanZone = lazy(() => import('./SportFanZone'));

const CLUBS = Object.entries(NHL_TEAMS).sort((a, b) => a[1].localeCompare(b[1]));
// every league's clubs for the header's picker, read once
function useAllDirs() {
  const [dirs, setDirs] = useState<FanDir[]>([]);
  useEffect(() => {
    let live = true;
    fanLeagues().then((ls) => Promise.all(ls.map((x) => fanDir(x.key).catch(() => null)))).then((ds) => { if (live) setDirs(ds.filter((d): d is FanDir => !!d)); }, () => {});
    return () => { live = false; };
  }, []);
  return dirs;
}
// where the page is, as the picker's value: an NHL club (nhl/EDM), another league's club (nfl/KC) or its page (nfl)
const placeOf = (path: string) => {
  const m = /^\/fans\/([a-z][a-z0-9-]*)(?:\/([A-Z0-9]{2,5}))?(?:\/|$)/.exec(path);
  if (m && m[1] !== 'about') return m[2] ? `${m[1]}/${m[2]}` : m[1];
  const n = /^\/fans\/([A-Za-z]{3})(?:\/|$)/.exec(path);
  return n && NHL_TEAMS[n[1].toUpperCase()] ? `nhl/${n[1].toUpperCase()}` : '';
};

export default function PublicFans() {
  const { session } = useLeague();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const place = placeOf(pathname);
  const dirs = useAllDirs();
  const go = (v: string) => { const [lg, c] = v.split('/'); nav(!v ? '/fans' : c ? zonePath(lg, c) : zonePath(lg)); };
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <div className="min-h-dvh">
      <header className="no-print sticky top-0 z-30 border-b border-white/[.06] bg-[#070b16]/85 pt-safe backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2 sm:px-5">
          <a href={PRODUCT.url} className="flex shrink-0 items-center gap-1.5" aria-label={PRODUCT.name}><ProductMark size={30} /><span className="hidden sm:block"><Wordmark size="sm" mark={PRODUCT.wordmark} /></span></a>
          <Link to="/fans" className="shrink-0 whitespace-nowrap rounded-full bg-white/[.06] px-2.5 py-1 text-[12px] font-bold text-slate-200 ring-1 ring-white/10 hover:bg-white/[.1]">Fan zones</Link>
          <select aria-label="Pick a club" value={place} onChange={(e) => go(e.target.value)}
            className="ml-auto h-8 w-[9.5rem] min-w-0 shrink rounded-full border border-white/15 bg-black/30 px-2.5 text-xs font-semibold text-white">
            <option value="">Every league</option>
            {(dirs.length ? dirs : [null]).map((d) => (d ? (
              <optgroup key={d.league} label={d.name}>
                {d.league !== 'nhl' && <option value={d.league}>Every {d.name} club</option>}
                {d.clubs.map((c) => <option key={c.code} value={`${d.league}/${c.code}`}>{c.name}</option>)}
              </optgroup>
            ) : (
              <optgroup key="nhl" label="NHL">{CLUBS.map(([k, v]) => <option key={k} value={`nhl/${k}`}>{v}</option>)}</optgroup>
            )))}
          </select>
          {session
            ? <button type="button" onClick={() => void signOut('You joined with just a name, so signing out loses it for good. Add an email under your name in any club’s fan section first to keep it. Sign out anyway?')} className="btn-ghost btn-sm shrink-0" aria-label="Sign out"><LogOut className="h-3.5 w-3.5" /></button>
            : <Link to="/" className="btn-ghost btn-sm shrink-0" aria-label="Sign in to Super Pools"><LogIn className="h-3.5 w-3.5" /><span className="hidden sm:inline">Sign in</span></Link>}
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-3 pb-16 pt-3 sm:px-5">
        <PlayerLinkProvider>
          <PublicFrame.Provider value>
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<div className="grid min-h-[50dvh] place-items-center"><Spinner className="h-8 w-8" /></div>}>
              <Routes>
                <Route path="/fans" element={<FansIndex />} />
                <Route path="/fans/about" element={<FansAbout />} />
                <Route path="/fans/:club/pulse" element={<FanPulse />} />
                <Route path="/fans/:club" element={<FanZone />} />
                <Route path="/fans/:league/:club/pulse" element={<FanPulse />} />
                <Route path="/fans/:league/:club/:tab" element={<SportFanZone />} />
                <Route path="/fans/:league/:club" element={<FanZone />} />
                <Route path="*" element={<Navigate to="/fans" replace />} />
              </Routes>
            </Suspense>
          </ErrorBoundary>
          </PublicFrame.Provider>
        </PlayerLinkProvider>
        <footer className="no-print mt-10 border-t border-white/[.06] pt-5 text-center text-[12px] text-mute">
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            <Link to="/fans" className="hover:text-white">Every league</Link>
            <Link to="/fans/about" className="hover:text-white">How it works</Link>
            <a href="https://github.com/patricknovak/sak" target="_blank" rel="noopener noreferrer" className="hover:text-white">The code</a>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
            <a href={PRODUCT.url} className="hover:text-white">{PRODUCT.name}</a>
          </div>
          <p className="mx-auto mt-3 max-w-md text-[11px] leading-snug">Made by fans from public numbers: the NHL&apos;s own, and ESPN&apos;s for the NFL, the NBA and the Premier League. Not affiliated with any league or club; team names and logos belong to them. Run a pool with your friends at <a href={PRODUCT.url} className="underline">{PRODUCT.domain}</a>.</p>
        </footer>
      </main>
    </div>
  );
}
