import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const configured = !!SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT');

// "Remember me" on the sign-in page: a remembered sign-in is kept in localStorage (it survives closing the browser, as
// every sign-in did before), a one-off one in sessionStorage (gone when the browser closes, for a borrowed phone)
const REMEMBER = 'sak-remember';
export const setRemember = (on: boolean) => { try { localStorage.setItem(REMEMBER, on ? '1' : '0'); } catch { /* private window */ } };
export const remembered = () => { try { return localStorage.getItem(REMEMBER) !== '0'; } catch { return true; } };
const authStorage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => {
    try {
      if (remembered()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch { /* storage blocked: the sign-in lasts as long as the page */ }
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* nothing kept */ } },
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost', import.meta.env.VITE_SUPABASE_ANON_KEY || 'x', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sak-auth', storage: authStorage },
  realtime: { params: { eventsPerSecond: 20 } },
});

// RPC helper that throws a readable message
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
  return data as T;
}

// fetch every row of a table/view (PostgREST caps responses at 1000 rows)
export async function selectAll<T>(table: string, columns = '*', page = 1000, order: string[] = []): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    let q = supabase.from(table).select(columns);
    for (const c of order) q = q.order(c); // a stable order keeps pages from overlapping
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) return out;
  }
}

// Realtime hands back an existing channel when the topic matches, and adding listeners to an
// already-subscribed channel throws. Give every mount its own topic so two components (or a
// remount racing the old unsubscribe) never share one.
export const realtimeChannel = (name: string) => supabase.channel(`${name}:${Math.random().toString(36).slice(2, 10)}`);
