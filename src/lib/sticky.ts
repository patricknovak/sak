import { useCallback, useState } from 'react';

// A view setting (a tab, a filter, a column choice) that survives the screen being rebuilt or the GM stepping away to
// a player's page and back: kept in this browser tab's session storage under a key per screen. A private window or
// blocked storage just falls back to the default.
// (no key: an ordinary piece of state, for the hooks that are only sometimes sticky)
export function useSticky<T>(key: string | null, init: T): [T, (v: T | ((x: T) => T)) => void] {
  const k = key ? `sticky:${key}` : null;
  const [v, setV] = useState<T>(() => {
    if (!k) return init;
    try { const s = sessionStorage.getItem(k); return s == null ? init : (JSON.parse(s) as T); } catch { return init; }
  });
  const set = useCallback((x: T | ((y: T) => T)) => {
    setV((cur) => {
      const next = typeof x === 'function' ? (x as (y: T) => T)(cur) : x;
      if (k) try { sessionStorage.setItem(k, JSON.stringify(next)); } catch { /* storage off: keep it in memory */ }
      return next;
    });
  }, [k]);
  return [v, set];
}
