// The front door, counted (migration 361, 24 November 2026): the start page opened and Start pressed, as day totals
// by page and source with nothing that names or follows anyone (no cookie, no account, no hash). The marketing site
// counts its own page views the same way (landing/site.js). Fire and forget: a count that fails is a count missed,
// never an error in front of someone starting a pool. Once per step, page and source per tab, so a reload isn't a visit.
import { supabase } from './supabase';

export type FunnelStep = 'start_open' | 'start_go';
const clean = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 32);

export function funnelHit(step: FunnelStep, page: string, src?: string | null) {
  const key = `sp-funnel:${step}:${clean(page)}:${clean(src)}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* count it anyway */ }
  void supabase.rpc('funnel_hit', { p_step: step, p_page: clean(page), p_src: clean(src) }).then(() => undefined, () => undefined);
}
