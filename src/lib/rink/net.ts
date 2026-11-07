// Rink Duel online (7 November 2026). Nothing is stored: a challenge and a match are realtime broadcasts, like
// "is typing" (lib/typing.ts).
//
// The lobby is one topic per league, 'rink:<league>', that every member of a hockey league or pool listens on while
// the app is open: a challenge, its answer, a cancel. A match is its own topic, 'rink:<league>:<match id>', with
// presence (who's at the table) and the play itself.
//
// The play: each phone runs the whole table and sends its own paddle about fifteen times a second. The puck belongs to
// the phone whose half it's in: that phone moves it, hits it with both paddles and calls goals, and sends where it is
// with its paddle. Your own paddle only ever meets the puck in your own half, so every hit you make is felt at once on
// your phone, with no waiting on the other one. When the puck crosses the red line its owner hands it over.
import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { useLeague } from '../store';

export type LobbyMsg =
  | { type: 'invite'; id: string; from: number; to: number }
  | { type: 'reply'; id: string; from: number; to: number; ok: boolean }
  | { type: 'cancel'; id: string; from: number; to: number };

let lobby: RealtimeChannel | null = null;
let lobbyLeague: number | null = null;
const lobbyListeners = new Set<(m: LobbyMsg) => void>();

export function joinLobby(league: number) {
  if (lobby && lobbyLeague === league) return;
  if (lobby) { supabase.removeChannel(lobby); lobby = null; }
  lobbyLeague = league;
  lobby = supabase.channel(`rink:${league}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'lobby' }, ({ payload }) => lobbyListeners.forEach((f) => f(payload as LobbyMsg)));
  lobby.subscribe();
}
export function leaveLobby() {
  if (lobby) supabase.removeChannel(lobby);
  lobby = null; lobbyLeague = null;
}
export const sendLobby = (m: LobbyMsg) => { lobby?.send({ type: 'broadcast', event: 'lobby', payload: m }).catch(() => {}); };
export function onLobby(f: (m: LobbyMsg) => void) { lobbyListeners.add(f); return () => { lobbyListeners.delete(f); }; }

export const newMatchId = () => Math.random().toString(36).slice(2, 10);

// the match's messages
export interface StateMsg {
  s: 0 | 1;                         // who sent it
  p: [number, number, number, number];   // their paddle: x, y, vx, vy
  b?: [number, number, number, number];  // the puck, when they hold it or are handing it over
  o: -1 | 0 | 1;                    // who the sender says holds the puck
  sc: [number, number];
  h: number;                        // the rally's heat
}
export type MatchMsg =
  | { type: 'take'; guest: number }
  | { type: 'goal'; by: 0 | 1; pts: number; sc: [number, number]; kmh: number }
  | { type: 'again'; from: number }
  | { type: 'bye'; from: number };

// a hockey league (fantasy, on the NHL) or a pool with a game on the NHL: where the game shows
export function useRinkOn(): boolean {
  const { me, league, kind, sport } = useLeague();
  const fantasyHockey = kind !== 'predict' && /hockey/i.test(sport.name);
  const [poolHockey, setPoolHockey] = useState(false);
  useEffect(() => {
    if (!me || kind !== 'predict') { setPoolHockey(false); return; }
    let live = true;
    supabase.from('pool_games').select('id', { count: 'exact', head: true }).like('competition', 'nhl%')
      .then(({ count }) => { if (live) setPoolHockey((count ?? 0) > 0); }, () => {});
    return () => { live = false; };
  }, [me?.id, league?.league_id, kind]);
  return !!me && (fantasyHockey || poolHockey);
}
