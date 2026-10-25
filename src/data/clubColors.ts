// Every NHL club's colours for its fan zone (25 October 2026: the fan zones opened to all 32 clubs). `accent` is the
// club's own colour that reads best on the site's dark ground (a navy club's lighter blue is drawn lighter still by
// clubTheme), `deep` its darkest colour, which the hero's gradient starts from; a club with no dark colour of its own
// gets its accent darkened. A club with lore (src/data/clubHistory.ts) keeps the colours written there.
import type { CSSProperties } from 'react';

export const CLUB_COLORS: Record<string, { accent: string; deep?: string }> = {
  ANA: { accent: '#F47A38', deep: '#111111' },
  BOS: { accent: '#FFB81C', deep: '#111111' },
  BUF: { accent: '#FFB81C', deep: '#003087' },
  CAR: { accent: '#CE1126', deep: '#111111' },
  CBJ: { accent: '#CE1126', deep: '#002654' },
  CGY: { accent: '#C8102E', deep: '#111111' },
  CHI: { accent: '#CF0A2C', deep: '#111111' },
  COL: { accent: '#236192', deep: '#6F263D' },
  DAL: { accent: '#006847', deep: '#111111' },
  DET: { accent: '#CE1126' },
  EDM: { accent: '#FF4C00', deep: '#041E42' },
  FLA: { accent: '#C8102E', deep: '#041E42' },
  LAK: { accent: '#A2AAAD', deep: '#111111' },
  MIN: { accent: '#EAAA00', deep: '#154734' },
  MTL: { accent: '#AF1E2D', deep: '#192168' },
  NJD: { accent: '#CE1126', deep: '#111111' },
  NSH: { accent: '#FFB81C', deep: '#041E42' },
  NYI: { accent: '#F47D30', deep: '#00539B' },
  NYR: { accent: '#0038A8' },
  OTT: { accent: '#C52032', deep: '#111111' },
  PHI: { accent: '#F74902', deep: '#111111' },
  PIT: { accent: '#FCB514', deep: '#111111' },
  SEA: { accent: '#99D9D9', deep: '#001628' },
  SJS: { accent: '#006D75', deep: '#111111' },
  STL: { accent: '#002F87', deep: '#041E42' },
  TBL: { accent: '#002868' },
  TOR: { accent: '#00205B' },
  UTA: { accent: '#6CACE4', deep: '#010101' },
  VAN: { accent: '#00843D', deep: '#00205B' },
  VGK: { accent: '#B4975A', deep: '#333F42' },
  WPG: { accent: '#004C97', deep: '#041E42' },
  WSH: { accent: '#C8102E', deep: '#041E42' },
  // the league as a whole: ice blue on the night sky, the fan zones' own colours
  NHL: { accent: '#4CC3FF', deep: '#0F1830' },
};

// every club's full name, as the NHL writes it (the fan zones' titles, the link previews in worker/fans.ts)
export const CLUB_NAMES: Record<string, string> = {
  ANA: 'Anaheim Ducks', BOS: 'Boston Bruins', BUF: 'Buffalo Sabres', CAR: 'Carolina Hurricanes', CBJ: 'Columbus Blue Jackets',
  CGY: 'Calgary Flames', CHI: 'Chicago Blackhawks', COL: 'Colorado Avalanche', DAL: 'Dallas Stars', DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers', FLA: 'Florida Panthers', LAK: 'Los Angeles Kings', MIN: 'Minnesota Wild', MTL: 'Montréal Canadiens',
  NJD: 'New Jersey Devils', NSH: 'Nashville Predators', NYI: 'New York Islanders', NYR: 'New York Rangers', OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers', PIT: 'Pittsburgh Penguins', SEA: 'Seattle Kraken', SJS: 'San Jose Sharks', STL: 'St. Louis Blues',
  TBL: 'Tampa Bay Lightning', TOR: 'Toronto Maple Leafs', UTA: 'Utah Mammoth', VAN: 'Vancouver Canucks', VGK: 'Vegas Golden Knights',
  WPG: 'Winnipeg Jets', WSH: 'Washington Capitals',
};

// the clubs by division, the way the NHL lists them (the fan zones' index)
export const DIVISIONS: [string, string[]][] = [
  ['Atlantic', ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR']],
  ['Metropolitan', ['CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH']],
  ['Central', ['CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'UTA', 'WPG']],
  ['Pacific', ['ANA', 'CGY', 'EDM', 'LAK', 'SEA', 'SJS', 'VAN', 'VGK']],
];

const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hexOf = (c: number[]) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);

const lumOf = (c: number[]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const toHsl = ([r, g, b]: number[]) => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
};
const fromHsl = ([h, s, l]: number[]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

// a club's colours as the fan zone draws them: a dark accent lifted until it reads on the dark ground, keeping its hue
// (a navy club's blue stays blue rather than going grey), the deep colour, the accent as "r g b" for
// rgb(var(--club-rgb) / alpha), and the ink that reads on a button filled with it
export function clubTheme(abbr: string): { primary: string; secondary: string; rgb: string; ink: string } {
  const c = CLUB_COLORS[abbr] ?? { accent: '#f7c548', deep: '#0b1222' };
  let rgb = rgbOf(c.accent);
  if (lumOf(rgb) < 0.45) {
    const [h, sat, l] = toHsl(rgb);
    rgb = fromHsl([h, Math.min(sat, 0.8), Math.max(l, 0.6)]);
  }
  const secondary = c.deep ?? hexOf(mix(rgbOf(c.accent), [7, 11, 22], 0.72));
  return { primary: hexOf(rgb), secondary, rgb: rgb.map((x) => Math.round(x)).join(' '), ink: inkOn(rgb) };
}

// dark ink on a light fill (gold, silver, ice), white on the rest
const inkOn = (rgb: number[]) => (lumOf(rgb) > 0.55 ? '#0b1222' : '#ffffff');

// the CSS variables a fan zone page draws with (--club, --club-rgb, --club2, --club-ink), from the club's lore when it
// has its own colours
export function clubVars(abbr: string, lore?: { primary: string; secondary: string; rgb: string } | null): CSSProperties {
  const t = clubTheme(abbr);
  const c = lore ?? t;
  return { '--club': c.primary, '--club-rgb': c.rgb, '--club2': c.secondary, '--club-ink': inkOn(c.rgb.split(' ').map(Number)) } as CSSProperties;
}
