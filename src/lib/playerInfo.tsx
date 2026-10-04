// A player's card, opened where you are. Anything in the app that shows a player's injury, tonight's status or the news
// dot opens his card over the page through this (PlayerRow, PlayerTag), so a GM weighing a trade, a pickup or a lineup
// call reads the injury report and the news without leaving what they were doing. One card for the whole app, drawn
// only once someone opens it.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { PlayerSheet } from '../components/PlayerCard';

export type OpenInfo = (id: number, tab?: 'news') => void;
const Ctx = createContext<OpenInfo | null>(null);
export const usePlayerInfo = () => useContext(Ctx);

export function PlayerInfoProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<{ id: number; tab: 'overview' | 'news' } | null>(null);
  const [used, setUsed] = useState(false);
  const open = useCallback<OpenInfo>((id, tab) => { setUsed(true); setInfo({ id, tab: tab ?? 'overview' }); }, []);
  // going to another page (the card's "Full player page", a link in it) closes it
  const { pathname } = useLocation();
  useEffect(() => setInfo(null), [pathname]);
  return (
    <Ctx.Provider value={open}>
      {children}
      {used && <PlayerSheet id={info?.id ?? null} start={info?.tab} onClose={() => setInfo(null)} />}
    </Ctx.Provider>
  );
}
