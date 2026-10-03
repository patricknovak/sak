// How the site looks and talks for the league it is showing. Every name the SaK site hard-codes today
// (the wordmark, the trophy, the Peter, Garry, the coins) comes through here, so a second league on
// Super Pools is a row in `leagues`, not a fork of the code. Missing fields fall back to the SaK defaults.
import { useLeague } from './store';

export interface Brand {
  wordmark: { a: string; b: string };   // "SAK" + "SUPERLEAGUE"
  tagline: string;
  short: string;                        // the league's short name ("SaK"): "SaK points", "SaK pick #12"
  trophy: string;                       // the season-long prize (the whole year)
  regular: string;                      // the regular-season prize
  playoff: string;                      // the playoff prize
  booby: string;                        // the last-place "prize"
  fund: string;                         // where the fund share of the entry goes
  bot: { name: string; emoji: string }; // the league's AI voice
  coin: { name: string; emoji: string };
  bank: string;                         // where the coins are kept ("St. Patrick’s Bank")
  colors: { gold: string };
}

// the product behind the league (docs/BRAND.md): the name, the line under it, and where it lives
export const PRODUCT = { name: 'Super Pools', tagline: 'The AI-enhanced pool that runs itself', domain: 'superpoolsai.com', url: 'https://superpoolsai.com' } as const;

export const SAK_BRAND: Brand = {
  wordmark: { a: 'SAK', b: 'SUPERLEAGUE' }, tagline: 'She’s A Keeper', short: 'SaK', trophy: 'The SAK Cup', regular: 'The Johnson',
  playoff: 'The Playoff Cup', booby: 'The Peter', fund: 'SaK Fund', bot: { name: 'Garry', emoji: '🎙️' }, coin: { name: 'St. Patrick coins', emoji: '☘️' },
  bank: 'St. Patrick’s Bank', colors: { gold: '#f7c548' },
};

// the league's brand over the SaK defaults; the short name comes from the league row, and the fund is named after it
// unless the brand names it (the database does the same in _fund_name)
export function brandOf(raw: Partial<Brand> | null | undefined, short?: string | null): Brand {
  const s = short || raw?.short || SAK_BRAND.short;
  if (!raw) return { ...SAK_BRAND, short: s, fund: `${s} Fund` };
  const coin = { ...SAK_BRAND.coin, ...raw.coin };
  return {
    ...SAK_BRAND, ...raw, short: s, fund: raw.fund || `${s} Fund`, coin, bank: raw.bank || (/ coins$/i.test(coin.name) ? `${coin.name.replace(/ coins$/i, '')}’s Bank` : 'The Bank'),
    wordmark: { ...SAK_BRAND.wordmark, ...raw.wordmark }, bot: { ...SAK_BRAND.bot, ...raw.bot }, colors: { ...SAK_BRAND.colors, ...raw.colors },
  };
}

// a prize's name without its article, for "Peter Punishment" and "SAK Cup race"
export const bare = (name: string) => name.replace(/^The /, '');

export function useBrand(): Brand {
  const { brand } = useLeague();
  return brand;
}
