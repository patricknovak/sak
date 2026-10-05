import { StrictMode, lazy, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import { LeagueProvider, useLeague } from './lib/store';
import { configured } from './lib/supabase';
import { Layout } from './components/Layout';
import { PlayerInfoProvider } from './lib/playerInfo';
import { Spinner, ToastHost } from './components/ui';
import { ErrorBoundary, reloadForNewVersion } from './components/ErrorBoundary';

// Vite fires this when a lazily-loaded page can't be fetched (stale tab after a deploy)
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault(); });
import Login from './pages/Login';
import Join from './pages/Join';
import Home from './pages/Home';

const MyTeam = lazy(() => import('./pages/MyTeam'));
const Players = lazy(() => import('./pages/Players'));
const Chat = lazy(() => import('./pages/Chat'));
const Standings = lazy(() => import('./pages/Standings'));
const Trades = lazy(() => import('./pages/Trades'));
const Money = lazy(() => import('./pages/Money'));
const Bets = lazy(() => import('./pages/Bets'));
const LeaguePage = lazy(() => import('./pages/League'));
const Commish = lazy(() => import('./pages/Commish'));
const Profile = lazy(() => import('./pages/Profile'));
const News = lazy(() => import('./pages/News'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const Features = lazy(() => import('./pages/Features'));
const Costs = lazy(() => import('./pages/Costs'));
const Platform = lazy(() => import('./pages/Platform'));
const Start = lazy(() => import('./pages/Start'));
const NewPool = lazy(() => import('./pages/NewPool'));
const Survivor = lazy(() => import('./pages/Survivor'));
const Predictor = lazy(() => import('./pages/Predictor'));
const Calibration = lazy(() => import('./pages/Calibration'));
const DraftTV = lazy(() => import('./pages/DraftTV'));
const DraftCentre = lazy(() => import('./pages/DraftCentre'));
const Scoreboard = lazy(() => import('./pages/Scoreboard'));
const Performance = lazy(() => import('./pages/Performance'));
const NHL = lazy(() => import('./pages/NHL'));
const Yahoo = lazy(() => import('./pages/Yahoo'));
const YahooLeague = lazy(() => import('./pages/YahooLeague'));
const Pools = lazy(() => import('./pages/Pools'));
// a prediction pool's pages (migration 145)
const PoolHome = lazy(() => import('./pages/Pool').then((m) => ({ default: m.PoolHome })));
const Questions = lazy(() => import('./pages/Pool').then((m) => ({ default: m.Questions })));
const Question = lazy(() => import('./pages/Pool').then((m) => ({ default: m.Question })));
const PoolLeaders = lazy(() => import('./pages/Pool').then((m) => ({ default: m.PoolLeaders })));
const PoolHost = lazy(() => import('./pages/Pool').then((m) => ({ default: m.PoolHost })));
import { YahooReturnHandler } from './components/YahooConnect';

// a #/p/<pool> link followed without a reload: reload, so the pool in the link opens
function Reopen() {
  useEffect(() => { location.reload(); }, []);
  return <Loading />;
}

function Loading() {
  return <div className="grid min-h-[50dvh] place-items-center"><Spinner className="h-8 w-8" /></div>;
}

function App() {
  const { ready, session, me, kind } = useLeague();
  const { pathname } = useLocation();
  if (!configured) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-md p-6">
          <div className="text-4xl">🏒</div>
          <h1 className="h-display mt-2 text-2xl">SAK Superleague</h1>
          <p className="mt-2 text-sm text-mute">This build has no database configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in <code>.env</code>.</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-20 w-20">
            <div className="absolute inset-0 animate-glow rounded-[24px] bg-goal/40 blur-2xl" />
            <img src="./icon.svg" alt="" className="relative h-20 w-20 animate-pulse" />
          </div>
          <div className="h-display text-shine text-xl tracking-[.2em]">Loading the barn…</div>
        </div>
      </div>
    );
  }
  // an invite link opens its own page, signed in or not
  const join = pathname.match(/^\/join\/([a-z0-9-]+)/i);
  if (join) return <Join code={join[1]} />;
  // asking for a league is open to anyone
  if (pathname === '/start') return <Suspense fallback={null}><Start /></Suspense>;
  // so is starting a prediction pool (migration 153)
  if (pathname === '/new') return <Suspense fallback={null}><NewPool /></Suspense>;
  if (!session) return <Login />;
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-md p-6"><p className="text-sm text-mute">This login isn’t linked to a team yet. Ask your commissioner for an invite link, or <a className="text-sky-300 underline" href="#/start">start a league of your own</a>.</p></div>
      </div>
    );
  }
  return (
    <Layout>
      <PlayerInfoProvider>
      <YahooReturnHandler />
      <ErrorBoundary key={pathname}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={kind === 'predict' ? <PoolHome /> : <Home />} />
          <Route path="/questions" element={<Questions />} />
          <Route path="/q/:id" element={<Question />} />
          <Route path="/leaders" element={<PoolLeaders />} />
          <Route path="/survivor" element={<Survivor />} />
          <Route path="/predictor" element={<Predictor />} />
          <Route path="/host" element={<PoolHost />} />
          <Route path="/draft" element={<DraftCentre />} />
          <Route path="/draft/tv" element={<DraftTV />} />
          <Route path="/draft/list" element={<Navigate to="/draft?t=order" replace />} />
          <Route path="/scoreboard" element={<Scoreboard />} />
          <Route path="/performance" element={<Performance />} />
          <Route path="/nhl" element={<NHL />} />
          <Route path="/pools" element={<Pools />} />
          {/* a pool's link followed inside the app: load the page again so the pool in it opens (host.ts reads it at start) */}
          <Route path="/p/*" element={<Reopen />} />
          <Route path="/yahoo" element={<Yahoo />} />
          <Route path="/yahoo/:key" element={<YahooLeague />} />
          <Route path="/keepers" element={<Navigate to="/draft?t=keepers" replace />} />
          <Route path="/team" element={<MyTeam />} />
          <Route path="/team/:id" element={<MyTeam />} />
          <Route path="/players" element={<Players />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/money" element={<Money />} />
          <Route path="/bets" element={<Bets />} />
          <Route path="/league" element={<LeaguePage />} />
          <Route path="/commish" element={<Commish />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/news" element={<News />} />
          <Route path="/mock" element={<Navigate to="/draft?t=mock" replace />} />
          <Route path="/draft/sheet" element={<Navigate to="/draft?t=sheet" replace />} />
          <Route path="/draft/analysis" element={<Navigate to="/draft?t=analysis" replace />} />
          <Route path="/player/:id" element={<PlayerPage />} />
          <Route path="/features" element={<Features />} />
          <Route path="/costs" element={<Costs />} />
          <Route path="/platform" element={<Platform />} />
          <Route path="/calibration" element={<Calibration />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      </PlayerInfoProvider>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastHost>
        <LeagueProvider>
          <App />
        </LeagueProvider>
      </ToastHost>
    </HashRouter>
  </StrictMode>,
);
