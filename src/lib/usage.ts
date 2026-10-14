import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { rpc } from './supabase';

// Which pages members open (migration 270, docs/SUPERPOOLS.md item 14): one count per page per day for the league, no
// names; each page is sent once a session per day, and nothing is counted where the commissioner switched it off (the
// database checks). The page is the route's first word: "team", "players", "chat"; a pool's link (#/p/<web name>/<page>)
// counts as its page; the home page is "home".
const pageOf = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  const p = parts[0] === 'p' ? parts[2] : parts[0];
  return (p ?? 'home').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'home';
};

export function useUsage(signedIn: boolean, leagueId: number | null | undefined) {
  const loc = useLocation();
  useEffect(() => {
    if (!signedIn || !leagueId) return;
    const page = pageOf(loc.pathname);
    const key = `usage:${leagueId}:${new Date().toISOString().slice(0, 10)}:${page}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* counted anyway */ }
    rpc('usage_hit', { p_page: page }).catch(() => {});
  }, [loc.pathname, signedIn, leagueId]);
}
