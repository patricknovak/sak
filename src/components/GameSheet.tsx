// One game, everywhere (11 October 2026): the sheet that opens on any NHL game from any page (the scoreboard, NHL
// centre, the home page), so a game reads the same wherever a GM taps it. Four tabs: the game (the score, where to
// watch it and team radio, the league's players in it with their points, the goals with their clips, the three stars,
// the penalties), its thread (the league's chat about it), the box score with every player's fantasy points, and its
// lines and bets. The score and the clock are the league's (lib/nhlGame), the same as every other page; the rest comes
// from the NHL's feed through nhl-hub. Team radio plays from here and keeps playing when the sheet closes.
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { STAT_LABELS } from '../lib/format';
import type { HubGame } from '../lib/nhlGame';

// the sheet itself loads the first time a game is opened, so the app's first page stays light
const GameSheet = lazy(() => import('./GameSheetBody'));
// and team radio the first time a GM turns it on
const RadioPlayer = lazy(() => import('./LiveWatch').then((m) => ({ default: m.RadioPlayer })));

export type GameTab = 'game' | 'thread' | 'box' | 'more';
type Radio = { url: string; label: string };
type Ctx = { open: (id: number, o?: { hint?: HubGame; tab?: GameTab }) => void; radio: Radio | null; setRadio: (r: Radio | null) => void };
const GameCtx = createContext<Ctx>({ open: () => {}, radio: null, setRadio: () => {} });
export const useGameSheet = () => useContext(GameCtx);

export function GameSheetProvider({ children }: { children: ReactNode }) {
  const [at, setAt] = useState<{ id: number; hint?: HubGame; tab?: GameTab } | null>(null);
  const [radio, setRadio] = useState<Radio | null>(null);
  const open = useCallback((id: number, o?: { hint?: HubGame; tab?: GameTab }) => setAt({ id, ...o }), []);
  const value = useMemo(() => ({ open, radio, setRadio }), [open, radio]);
  return (
    <GameCtx.Provider value={value}>
      {children}
      {at && <Suspense fallback={null}><GameSheet id={at.id} hint={at.hint} tab={at.tab} onClose={() => setAt(null)} /></Suspense>}
      {/* team radio, playing on whatever page the GM moves to */}
      {radio && <div className="fixed inset-x-0 bottom-[84px] z-[60] px-4 md:bottom-6"><div className="mx-auto max-w-md shadow-[0_12px_32px_rgba(0,0,0,.5)]"><Suspense fallback={null}><RadioPlayer url={radio.url} label={radio.label} onClose={() => setRadio(null)} /></Suspense></div></div>}
    </GameCtx.Provider>
  );
}

// every stat the league scores that isn't zero: "1 G · 4 HIT · 2 BLK · 2 PIM"
export function scoringLine(stats: Record<string, number>, weights: Record<string, number>, goalie: boolean) {
  const keys = goalie ? ['gs', 'w', 'l', 'otl', 'sv', 'ga', 'sho'] : ['g', 'a', 'pm', 'ppp', 'shp', 'gwg', 'sog', 'hit', 'blk', 'pim', 'fow', 'fol'];
  return keys.filter((k) => (weights[k] || k === 'sv' || k === 'ga') && stats[k])
    .map((k) => (k === 'pm' ? `${stats[k] > 0 ? '+' : ''}${stats[k]}` : `${stats[k]} ${STAT_LABELS[k] ?? k}`)).join(' · ');
}

