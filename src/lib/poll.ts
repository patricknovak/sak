// A refresh that loads once, then every `ms` while the page is on screen and `on` holds (a game is live, say), and
// again the moment the page comes back to the front: a phone with the app in the background, or a page with nothing
// left to change, asks the server for nothing. The 11 October 2026 review found Home, My Team and the pool table
// polling every minute around the clock, whatever was on.
import { useEffect, useRef } from 'react';

export function usePoll(load: () => unknown, ms: number, on: boolean, deps: unknown[] = []) {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    fn.current();
    const seen = () => document.visibilityState === 'visible';
    const i = on ? window.setInterval(() => { if (seen()) fn.current(); }, ms) : undefined;
    const back = () => { if (seen()) fn.current(); };
    document.addEventListener('visibilitychange', back);
    return () => { if (i) window.clearInterval(i); document.removeEventListener('visibilitychange', back); };
  }, [ms, on, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
