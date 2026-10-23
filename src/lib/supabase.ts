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

// The league this tab shows, when the address names one (sak.superpoolsai.com, a league's own domain) or the GM switched
// leagues in this tab. Every database request carries it as x-league; the database honours it only for a member of that
// league (current_league_id), so a stranger's tab simply shows their own league. Only the REST API gets it: the edge
// functions don't list the header for their browsers, and work out the league themselves.
let leagueHeader: string | null = null;
export const setLeagueHeader = (id: number | null) => { leagueHeader = id ? String(id) : null; };
const withLeague: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!leagueHeader || !url.includes('/rest/v1/')) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('x-league', leagueHeader);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost', import.meta.env.VITE_SUPABASE_ANON_KEY || 'x', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sak-auth', storage: authStorage },
  realtime: { params: { eventsPerSecond: 20 } },
  global: { fetch: withLeague },
});

// RPC helper that throws a readable message
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?ERROR:\s*/, ''));
  for (const f of afterRpc) f(fn);
  return data as T;
}
// told the name of every call that went through, once it has: the draft room (lib/draftRoom) hears a pick this way and
// passes it to every phone at once
const afterRpc = new Set<(fn: string) => void>();
export const onRpc = (f: (fn: string) => void) => { afterRpc.add(f); return () => { afterRpc.delete(f); }; };

// fetch every row of a table/view (PostgREST caps responses at 1000 rows). The first page also asks how many rows there
// are; the rest are then read a few at a time side by side instead of one after another, and put back in order. The
// result is what reading them one by one gave: every page in turn up to the first short one, and if the count came up
// short (rows added while reading), on a page at a time until one is.
type Select = ReturnType<ReturnType<typeof supabase.from>['select']>;
const PAGES_AT_ONCE = 4;
export async function selectAll<T>(table: string, columns = '*', page = 1000, order: string[] = [], where?: (q: Select) => Select): Promise<T[]> {
  const read = async (from: number, count = false) => {
    let q = supabase.from(table).select(columns, count ? { count: 'exact' } : undefined);
    if (where) q = where(q as unknown as Select) as unknown as typeof q;
    for (const c of order) q = q.order(c); // a stable order keeps pages from overlapping
    const { data, error, count: total } = await q.range(from, from + page - 1);
    if (error) throw error;
    return { rows: (data ?? []) as T[], total };
  };
  const first = await read(0, true);
  const out: T[] = [...first.rows];
  if (first.rows.length < page) return out;
  // the pages the count says are left, PAGES_AT_ONCE requests in flight at a time
  const starts: number[] = [];
  for (let from = page; from < (first.total ?? 0); from += page) starts.push(from);
  const pages: T[][] = new Array(starts.length);
  let next = 0;
  const worker = async () => {
    while (next < starts.length) { const i = next++; pages[i] = (await read(starts[i])).rows; }
  };
  await Promise.all(Array.from({ length: Math.min(PAGES_AT_ONCE, starts.length) }, worker));
  for (const rows of pages) {
    out.push(...rows);
    if (rows.length < page) return out;
  }
  // every page was full: there may be more than the count said
  for (let from = page * (starts.length + 1); ; from += page) {
    const { rows } = await read(from);
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

// Realtime hands back an existing channel when the topic matches, and adding listeners to an
// already-subscribed channel throws. Give every mount its own topic so two components (or a
// remount racing the old unsubscribe) never share one.
export const realtimeChannel = (name: string) => supabase.channel(`${name}:${Math.random().toString(36).slice(2, 10)}`);
