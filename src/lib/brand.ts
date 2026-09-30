// How the site looks and talks for the league it is showing. Every name the SaK site hard-codes today
// (the wordmark, the trophy, the Peter, Garry, the coins) comes through here, so a second league on
// Super Pools is a row in `leagues`, not a fork of the code. Missing fields fall back to the SaK defaults.
import { useLeague } from './store';

export interface Brand {
  wordmark: { a: string; b: string };   // "SAK" + "SUPERLEAGUE"
  tagline: string;
  trophy: string;                       // the season-long prize
  booby: string;                        // the last-place "prize"
  bot: { name: string; emoji: string }; // the league's AI voice
  coin: { name: string; emoji: string };
  colors: { gold: string };
}

export const PRODUCT = { name: 'Super Pools', tagline: 'AI-enhanced fantasy leagues', domain: 'superpoolsai.com', url: 'https://www.superpoolsai.com' } as const;

export const SAK_BRAND: Brand = {
  wordmark: { a: 'SAK', b: 'SUPERLEAGUE' }, tagline: 'She’s A Keeper', trophy: 'The SAK Cup', booby: 'The Peter',
  bot: { name: 'Garry', emoji: '🎙️' }, coin: { name: 'St. Patrick coins', emoji: '☘️' }, colors: { gold: '#f7c548' },
};

export function brandOf(raw: Partial<Brand> | null | undefined): Brand {
  if (!raw) return SAK_BRAND;
  return { ...SAK_BRAND, ...raw, wordmark: { ...SAK_BRAND.wordmark, ...raw.wordmark }, bot: { ...SAK_BRAND.bot, ...raw.bot }, coin: { ...SAK_BRAND.coin, ...raw.coin }, colors: { ...SAK_BRAND.colors, ...raw.colors } };
}

export function useBrand(): Brand {
  const { brand } = useLeague();
  return brand;
}
