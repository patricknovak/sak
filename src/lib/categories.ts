// The categories a rotisserie league can play (the database's _category_catalogue, migration 117), with the short
// label a chip shows and how a value reads. Goalies have no minutes in the box scores, so the goals-against rate is
// per start.
export interface Category { key: string; label: string; short: string; low?: boolean; rate?: 'avg' | 'pct' }
export const CATEGORIES: Category[] = [
  { key: 'g', label: 'Goals', short: 'G' }, { key: 'a', label: 'Assists', short: 'A' }, { key: 'pts', label: 'Points', short: 'P' },
  { key: 'pm', label: 'Plus/minus', short: '+/-' }, { key: 'pim', label: 'Penalty minutes', short: 'PIM' }, { key: 'ppp', label: 'Power-play points', short: 'PPP' },
  { key: 'ppg', label: 'Power-play goals', short: 'PPG' }, { key: 'shp', label: 'Shorthanded points', short: 'SHP' }, { key: 'gwg', label: 'Game-winning goals', short: 'GWG' },
  { key: 'sog', label: 'Shots on goal', short: 'SOG' }, { key: 'hit', label: 'Hits', short: 'HIT' }, { key: 'blk', label: 'Blocks', short: 'BLK' },
  { key: 'w', label: 'Wins', short: 'W' }, { key: 'sho', label: 'Shutouts', short: 'SO' }, { key: 'sv', label: 'Saves', short: 'SV' },
  { key: 'gaa', label: 'Goals against per start', short: 'GA/GS', low: true, rate: 'avg' }, { key: 'svp', label: 'Save percentage', short: 'SV%', rate: 'pct' },
];
export const categoryOf = (k: string) => CATEGORIES.find((c) => c.key === k);
export const fmtCat = (k: string, v: number | null | undefined) => {
  if (v == null) return '–';
  const c = categoryOf(k);
  if (c?.rate === 'pct') return Number(v).toFixed(3).replace(/^0/, '');
  if (c?.rate === 'avg') return Number(v).toFixed(2);
  return String(Math.round(Number(v) * 10) / 10);
};
// the typical rotisserie set, to start from
export const STANDARD_CATEGORIES = ['g', 'a', 'pm', 'pim', 'ppp', 'sog', 'w', 'gaa', 'svp', 'sho'];
