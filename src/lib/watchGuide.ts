// How to see every NHL game, by country, for the Watch live page's guide (the research is in docs/WATCH-LIVE.md;
// prices as of October 2026, and they change, so each option links to the seller's own page).
export interface WatchOption { icon: string; name: string; tag?: string; price: string; covers: string; url?: string }
export interface CountryGuide { intro: string; options: WatchOption[]; together: string[]; note: string }

export const WATCH_GUIDE: Record<'CA' | 'US', CountryGuide> = {
  CA: { intro: '', options: [], together: [], note: '' },
  US: { intro: '', options: [], together: [], note: '' },
};
