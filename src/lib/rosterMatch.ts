import type { Player } from './types';

// Matching another site's players to ours by name (docs/SUPERPOOLS.md item 9, imports: rosters). A name as it is
// matched has no accents, no punctuation and one space between words; a name that isn't ours whole is tried as last
// name, first initial and club (a site that writes "Alex" where we write "Alexander"), and a name two of ours share
// (father and son, two Sebastian Ahos) goes to the one on the club named.
export const normName = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface ImportPick { name: string; club: string | null; ir: boolean; player_id: number | null }
export interface ImportTeam { id: string; name: string; picks: ImportPick[] }

export function playerMatcher(players: Map<number, Player>) {
  const byName = new Map<string, number[]>(), byShort = new Map<string, number[]>();
  const short = (n: string, club: string | null) => { const parts = n.split(' '); return `${parts[0]?.[0] ?? ''} ${parts[parts.length - 1]} ${club ?? ''}`; };
  for (const p of players.values()) {
    const n = normName(p.name);
    byName.set(n, [...(byName.get(n) ?? []), p.id]);
    const s = short(n, p.nhl_team);
    byShort.set(s, [...(byShort.get(s) ?? []), p.id]);
  }
  return (name: string, club: string | null): number | null => {
    const n = normName(name);
    const c = byName.get(n) ?? [];
    if (c.length === 1) return c[0];
    if (c.length > 1) return c.find((id) => players.get(id)?.nhl_team === club) ?? c[0];
    const s = byShort.get(short(n, club)) ?? [];
    return s.length === 1 ? s[0] : null;
  };
}
