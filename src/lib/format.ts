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

export const teamLogo = (abbr: string | null | undefined) =>
  abbr ? `https://assets.nhle.com/logos/nhl/svg/${abbr}_light.svg` : '';

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
  g: 'G', a: 'A', pm: '+/-', pim: 'PIM', ppp: 'PPP', gwg: 'GWG', sog: 'SOG', hit: 'HIT', blk: 'BLK',
  gs: 'GS', w: 'W', l: 'L', ga: 'GA', sv: 'SV', sho: 'SO', otl: 'OTL', gp: 'GP',
};
