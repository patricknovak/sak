import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { LeagueProvider, useLeague } from './lib/store';
import { configured } from './lib/supabase';
import { Layout } from './components/Layout';
import { Spinner, ToastHost } from './components/ui';
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

function Loading() {
  return <div className="grid min-h-[50dvh] place-items-center"><Spinner className="h-8 w-8" /></div>;
}

function App() {
  const { ready, session, me } = useLeague();
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
  if (!ready) return <div className="grid min-h-dvh place-items-center"><Spinner className="h-8 w-8" /></div>;
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
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/draft" element={<Draft />} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
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
