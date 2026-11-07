// The fan zones' last-known copies (7 November 2026, Patrick: the fan zone shows its numbers right away and brings them up
// to date in the background, only for the club a person picks). Each answer from nhl-hub a zone reads is kept on the phone
// (in memory for the visit, in IndexedDB between visits, the dozen most recent): opening a club draws the copy it had at
// once and asks for a fresh one behind it, and nothing is fetched for a club nobody has opened. When the function answers
// with a copy it is still rebuilding (`refreshing`, supabase/functions/nhl-hub `cached`), the page asks the function
// itself again a little later, twice at most.
import { useEffect, useRef, useState } from 'react';
import { hub } from './nhlhub';

interface Kept { key: string; at: number; body: unknown }
const mem = new Map<string, Kept>();
const MAX = 12;
const DB = 'sp-hub-keep', STORE = 'answers';

let dbp: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise((res) => {
      try {
        if (typeof indexedDB === 'undefined') return res(null);
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'key' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch { res(null); }
    });
  }
  return dbp;
}

export async function keptCopy<T>(key: string): Promise<T | null> {
  const m = mem.get(key);
  if (m) return m.body as T;
  const db = await open();
  if (!db) return null;
  return new Promise((res) => {
    try {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      r.onsuccess = () => { const v = r.result as Kept | undefined; if (v) mem.set(key, v); res((v?.body as T) ?? null); };
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

export async function keepCopy(key: string, body: unknown) {
  const row: Kept = { key, at: Date.now(), body };
  mem.set(key, row);
  const db = await open();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite'), st = tx.objectStore(STORE);
    st.put(row);
    // only the most recent dozen are kept: a fan's own club and the few they look in on
    const all = st.getAll();
    all.onsuccess = () => {
      const rows = (all.result as Kept[]).sort((a, b) => b.at - a.at);
      for (const r of rows.slice(MAX)) st.delete(r.key);
    };
  } catch { /* a phone with no room keeps the copy in memory only */ }
}

// one of the hub's answers for a zone: the kept copy at once, the fresh one when it lands. `updating` is true while a fresh
// one is on its way; `failed` only when there is nothing at all to show.
export function useKeptHub<T>(task: string, q: Record<string, string>, key: string, enabled = true) {
  const id = `${task}:${key}`;
  const [state, setState] = useState<{ id: string; data: T | null; fresh: boolean; failed: boolean }>(() => ({ id, data: (mem.get(id)?.body as T) ?? null, fresh: false, failed: false }));
  const [tries, setTries] = useState(0);
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    if (!enabled) return;
    let live = true, fresh = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setState({ id, data: (mem.get(id)?.body as T) ?? null, fresh: false, failed: false });
    keptCopy<T>(id).then((d) => { if (live && !fresh && d) setState((s) => (s.id === id && !s.data ? { ...s, data: d } : s)); });
    const ask = (n: number) => hub<T & { refreshing?: boolean }>(task, qRef.current, { direct: n > 0 }).then((d) => {
      if (!live) return;
      // a copy still being rebuilt: shown, and asked for again in a moment
      if (d.refreshing && n < 2) {
        setState((s) => ({ ...s, data: d, failed: false }));
        timers.push(setTimeout(() => ask(n + 1), n ? 30_000 : 15_000));
        return;
      }
      fresh = true;
      setState({ id, data: d, fresh: true, failed: false });
      keepCopy(id, d);
    }, () => {
      if (!live) return;
      // the feed down: the kept copy stays on screen, and only a page with nothing says so
      setState((s) => ({ ...s, fresh: true, failed: !s.data && !mem.get(id) }));
    });
    ask(0);
    return () => { live = false; timers.forEach(clearTimeout); };
  }, [task, id, tries, enabled]);
  const mine = state.id === id;
  return {
    data: mine ? state.data : null,
    updating: enabled && (!mine || !state.fresh),
    failed: mine && state.failed,
    retry: () => setTries((n) => n + 1),
  };
}
