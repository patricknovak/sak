// The question packs a new pool can start from (pool_pack_list, migration 159): only packs with something still to
// call, the one closing soonest first.
export interface Pack {
  slug: string; name: string; questions: number; color: string | null; icon: string | null; blurb: string | null;
  next_close: string; last_close: string;
}

const DAY = 864e5;
const ET = 'America/New_York';

// Eastern calendar day (YYYY-MM-DD): packs and Netflix drops are timed in ET, same as the league day
function etYmd(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: ET });
}

// calendar days from today to the close in ET, so "tomorrow" means the next Eastern day, not the next 24 hours.
// A premiere at Wed 3am ET looked like "tomorrow" on Monday evening when counted in raw hours.
function calendarDaysUntil(closeIso: string, now = Date.now()): number {
  const close = new Date(closeIso).getTime();
  if (!Number.isFinite(close)) return Number.POSITIVE_INFINITY;
  const [ay, am, ad] = etYmd(now).split('-').map(Number);
  const [by, bm, bd] = etYmd(close).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
}

function etDate(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: ET, ...opts });
}

// when a pack's calls run out, from the pack's real next_close (pool_pack_list): today / tomorrow, else the same
// weekday-date the questions show ("Closes Wed, Oct 14"), else the last month once it is more than a fortnight out
export function packWhen(p: Pack, now = Date.now()): { text: string; soon: boolean } {
  const next = new Date(p.next_close).getTime();
  const days = calendarDaysUntil(p.next_close, now);
  if (days < 14) {
    const when = days <= 0 ? 'today'
      : days === 1 ? 'tomorrow'
      : etDate(p.next_close, { weekday: 'short', month: 'short', day: 'numeric' });
    return { text: `the first call closes ${when}`, soon: days < 3 };
  }
  return { text: `runs to ${etDate(p.last_close, { month: 'long', year: next - now > 300 * DAY ? 'numeric' : undefined })}`, soon: false };
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
