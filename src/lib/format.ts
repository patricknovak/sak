export const etToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const fmtPts = (n: number | null | undefined, d = 1) =>
  n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const fmtDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function countdown(ms: number) {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export const posLabel = (elig: string[]) => elig.join(', ');

export const NHL_TEAMS: Record<string, string> = {
  ANA: 'Anaheim', BOS: 'Boston', BUF: 'Buffalo', CAR: 'Carolina', CBJ: 'Columbus', CGY: 'Calgary', CHI: 'Chicago',
  COL: 'Colorado', DAL: 'Dallas', DET: 'Detroit', EDM: 'Edmonton', FLA: 'Florida', LAK: 'Los Angeles', MIN: 'Minnesota',
  MTL: 'Montréal', NJD: 'New Jersey', NSH: 'Nashville', NYI: 'NY Islanders', NYR: 'NY Rangers', OTT: 'Ottawa',
  PHI: 'Philadelphia', PIT: 'Pittsburgh', SEA: 'Seattle', SJS: 'San Jose', STL: 'St. Louis', TBL: 'Tampa Bay',
  TOR: 'Toronto', UTA: 'Utah', VAN: 'Vancouver', VGK: 'Vegas', WPG: 'Winnipeg', WSH: 'Washington',
};

// primary colours for NHL clubs, used behind player headshots
export const NHL_COLORS: Record<string, string> = {
  ANA: '#F47A38', BOS: '#FFB81C', BUF: '#003087', CAR: '#CE1126', CBJ: '#002654', CGY: '#C8102E', CHI: '#CF0A2C',
  COL: '#6F263D', DAL: '#006847', DET: '#CE1126', EDM: '#FF4C00', FLA: '#C8102E', LAK: '#A2AAAD', MIN: '#154734',
  MTL: '#AF1E2D', NJD: '#CE1126', NSH: '#FFB81C', NYI: '#00539B', NYR: '#0038A8', OTT: '#C52032', PHI: '#F74902',
  PIT: '#FCB514', SEA: '#99D9D9', SJS: '#006D75', STL: '#002F87', TBL: '#002868', TOR: '#00205B', UTA: '#71AFE5',
  VAN: '#00843D', VGK: '#B4975A', WPG: '#041E42', WSH: '#C8102E',
};

export const teamLogo = (abbr: string | null | undefined) =>
  abbr ? `https://assets.nhle.com/logos/nhl/svg/${abbr}_dark.svg` : '';

// "lighten" a hex colour for text on dark backgrounds
export function readable(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum > 0.45) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * (0.45 - lum) * 1.4);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

export const STAT_LABELS: Record<string, string> = {
  g: 'G', a: 'A', pts: 'P', pm: '+/-', pim: 'PIM', ppg: 'PPG', ppa: 'PPA', ppp: 'PPP', shg: 'SHG', sha: 'SHA', shp: 'SHP',
  gwg: 'GWG', sog: 'SOG', fow: 'FW', fol: 'FL', hit: 'HIT', blk: 'BLK',
  gs: 'GS', w: 'W', l: 'L', ga: 'GA', sa: 'SA', sv: 'SV', sho: 'SO', otl: 'OTL', gp: 'GP',
};

// every stat the scoring editor offers, in Yahoo's order
export const SCORING_STATS: { skater: [string, string][]; goalie: [string, string][] } = {
  skater: [
    ['g', 'Goals'], ['a', 'Assists'], ['pts', 'Points'], ['pm', 'Plus/Minus'], ['pim', 'Penalty Minutes'],
    ['ppg', 'Powerplay Goals'], ['ppa', 'Powerplay Assists'], ['ppp', 'Powerplay Points'],
    ['shg', 'Shorthanded Goals'], ['sha', 'Shorthanded Assists'], ['shp', 'Shorthanded Points'],
    ['gwg', 'Game-Winning Goals'], ['sog', 'Shots on Goal'], ['fow', 'Faceoffs Won'], ['fol', 'Faceoffs Lost'],
    ['hit', 'Hits'], ['blk', 'Blocks'],
  ],
  goalie: [
    ['gs', 'Games Started'], ['w', 'Wins'], ['l', 'Losses'], ['otl', 'Overtime Losses'], ['ga', 'Goals Against'],
    ['sa', 'Shots Against'], ['sv', 'Saves'], ['sho', 'Shutouts'],
  ],
};

// fantasy points for one stat line under the league's scoring
export function calcFpts(stats: Record<string, number | null | undefined>, weights: Record<string, number>) {
  let t = 0;
  for (const [k, w] of Object.entries(weights)) t += w * Number(stats[k] ?? 0);
  return Math.round(t * 100) / 100;
}

// short label + colour for injury/suspension status
export function injuryBadge(status: string | null | undefined) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes('susp')) return { label: 'SUSP', cls: 'border-orange-700 bg-orange-900/50 text-orange-300' };
  if (s.includes('day')) return { label: 'DTD', cls: 'border-amber-700 bg-amber-900/40 text-amber-300' };
  if (s.includes('reserve') || s === 'ir') return { label: 'IR', cls: 'border-red-800 bg-red-900/50 text-red-300' };
  return { label: 'OUT', cls: 'border-red-800 bg-red-900/50 text-red-300' };
}
