import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import { LeagueProvider, useLeague } from './lib/store';
import { configured } from './lib/supabase';
import { Layout } from './components/Layout';
import { Spinner, ToastHost } from './components/ui';
import { ErrorBoundary, reloadForNewVersion } from './components/ErrorBoundary';

// Vite fires this when a lazily-loaded page can't be fetched (stale tab after a deploy)
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewVersion()) e.preventDefault(); });
import Login from './pages/Login';
import Home from './pages/Home';

const Draft = lazy(() => import('./pages/Draft'));
const Keepers = lazy(() => import('./pages/Keepers'));
const MyTeam = lazy(() => import('./pages/MyTeam'));
const Players = lazy(() => import('./pages/Players'));
const Chat = lazy(() => import('./pages/Chat'));
const Standings = lazy(() => import('./pages/Standings'));
const Trades = lazy(() => import('./pages/Trades'));
const Bets = lazy(() => import('./pages/Bets'));
const LeaguePage = lazy(() => import('./pages/League'));
const Commish = lazy(() => import('./pages/Commish'));
const Profile = lazy(() => import('./pages/Profile'));
const News = lazy(() => import('./pages/News'));
const Mock = lazy(() => import('./pages/Mock'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const Features = lazy(() => import('./pages/Features'));
const DraftTV = lazy(() => import('./pages/DraftTV'));
const DraftList = lazy(() => import('./pages/DraftList'));
const Scoreboard = lazy(() => import('./pages/Scoreboard'));
const NHL = lazy(() => import('./pages/NHL'));
const Yahoo = lazy(() => import('./pages/Yahoo'));
const YahooLeague = lazy(() => import('./pages/YahooLeague'));
import { YahooReturnHandler } from './components/YahooConnect';

function Loading() {
  return <div className="grid min-h-[50dvh] place-items-center"><Spinner className="h-8 w-8" /></div>;
}

function App() {
  const { ready, session, me } = useLeague();
  const { pathname } = useLocation();
  if (!configured) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-md p-6">
          <div className="text-4xl">🏒</div>
          <h1 className="h-display mt-2 text-2xl">SaK League</h1>
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
  if (!session) return <Login />;
  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="card max-w-md p-6"><p className="text-sm text-mute">This login isn’t linked to a SaK team yet. Ask the commish.</p></div>
      </div>
    );
  }
  return (
    <Layout>
      <YahooReturnHandler />
      <ErrorBoundary key={pathname}>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/draft/tv" element={<DraftTV />} />
          <Route path="/draft/list" element={<DraftList />} />
          <Route path="/scoreboard" element={<Scoreboard />} />
          <Route path="/nhl" element={<NHL />} />
          <Route path="/yahoo" element={<Yahoo />} />
          <Route path="/yahoo/:key" element={<YahooLeague />} />
          <Route path="/keepers" element={<Keepers />} />
          <Route path="/team" element={<MyTeam />} />
          <Route path="/team/:id" element={<MyTeam />} />
          <Route path="/players" element={<Players />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/standings" element={<Standings />} />
          <Route path="/trades" element={<Trades />} />
          <Route path="/bets" element={<Bets />} />
          <Route path="/league" element={<LeaguePage />} />
          <Route path="/commish" element={<Commish />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/news" element={<News />} />
          <Route path="/mock" element={<Mock />} />
          <Route path="/player/:id" element={<PlayerPage />} />
          <Route path="/features" element={<Features />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
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
