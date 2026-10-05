// The question packs a new pool can start from (pool_pack_list, migration 159): only packs with something still to
// call, the one closing soonest first.
export interface Pack {
  slug: string; name: string; questions: number; color: string | null; icon: string | null; blurb: string | null;
  next_close: string; last_close: string;
}

const DAY = 864e5;

// when a pack's calls run out, in a few words: the first deadline while it is within a fortnight, else the last month
export function packWhen(p: Pack, now = Date.now()): { text: string; soon: boolean } {
  const next = new Date(p.next_close).getTime();
  const days = Math.floor((next - now) / DAY);
  if (days < 14) {
    const text = days <= 0 ? 'the first call closes today' : days === 1 ? 'the first call closes tomorrow' : `the first call closes in ${days}\u00a0days`;
    return { text, soon: days < 3 };
  }
  return { text: `runs to ${new Date(p.last_close).toLocaleDateString(undefined, { month: 'long', year: next - now > 300 * DAY ? 'numeric' : undefined })}`, soon: false };
}

// a pool name to suggest for a pack
export function packPlaceholder(slug: string | null | undefined): string {
  if (!slug) return 'The Group Chat Pool';
  if (slug.startsWith('love-is-blind')) return 'The Pod Squad';
  if (slug.startsWith('premier')) return 'The Sunday League';
  if (slug.startsWith('mls')) return 'The Cup Crew';
  if (slug.startsWith('world-series')) return 'The Bullpen';
  if (slug.startsWith('nhl')) return 'The Barn';
  return 'The Group Chat Pool';
}

// a pack's name with its years kept together (2026‑27 never breaks at the hyphen) and a dot never starting a line
export const packName = (name: string) => name.replace(/(\d)-(\d)/g, '$1\u2011$2').replace(/ · /g, '\u00a0· ');
