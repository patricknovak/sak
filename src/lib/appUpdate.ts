import { useEffect, useState } from 'react';

// A new build reaches a phone that keeps the app open (14 October 2026: a GM's installed app ran the morning's build
// all afternoon, so the day's changes never reached it). When the app comes back to the screen, at most every ten
// minutes, it reads the live page (never cached, public/_headers) and compares its main script with the one running;
// a different one means a new build is out, and the layout offers a one-tap reload. Nothing reloads by itself, so a
// half-typed message or a lineup move is never lost.
const running = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]')?.src.split('/').pop() ?? null;

export function useAppUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const mine = running();
    if (!mine) return;   // the dev server has no built script to compare
    let last = Date.now();
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10 * 60e3) return;
      last = Date.now();
      fetch('./', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((html) => {
        const live = html.match(/assets\/(index-[\w-]+\.js)/)?.[1];
        if (live && live !== mine) setReady(true);
      }).catch(() => {});
    };
    document.addEventListener('visibilitychange', check);
    const t = window.setInterval(check, 30 * 60e3);
    return () => { document.removeEventListener('visibilitychange', check); window.clearInterval(t); };
  }, []);
  return ready;
}
