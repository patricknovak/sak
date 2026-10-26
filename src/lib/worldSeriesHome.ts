// Seasonal World Series CTA on the product sign-in home: when to show it, and the #/new link it opens.
import type { PoolEvent } from './poolGames';

export const WS_COMP = 'mlb-post-2026';
// End of 7 Nov 2026 Eastern (hide from the 8th UTC morning).
export const WS_HOME_CTA_UNTIL = Date.parse('2026-11-08T05:00:00.000Z');
export const WS_HOME_CTA_HREF = `#/new?comp=${encodeURIComponent(WS_COMP)}&kind=series&src=home-ws`;

export function worldSeriesHomeCtaOpen(now = Date.now(), event?: PoolEvent | null): boolean {
  if (now >= WS_HOME_CTA_UNTIL) return false;
  if (!event || event.competition !== WS_COMP) return false;
  if (event.next_lock && Date.parse(event.next_lock) > now) return true;
  if ((event.sheets ?? []).some((g) => Date.parse(g.kickoff) > now)) return true;
  if ((event.grids ?? []).some((g) => g.starts_at && Date.parse(g.starts_at) > now)) return true;
  if ((event.game_grids ?? []).some((g) => Date.parse(g.kickoff) > now)) return true;
  return false;
}
