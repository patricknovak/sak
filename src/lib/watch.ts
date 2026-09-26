// Where to watch an NHL broadcast. Live streams belong to the rights-holders, so SaK sends each GM to the
// broadcaster's own live page for the game, where signing in with a TV provider (Telus, Rogers, Bell,
// Shaw…) or a subscription unlocks the feed. A GM's profile records what they have, so games they can
// actually watch get flagged.

export interface Service { k: string; name: string; note: string; country: 'CA' | 'US' | 'ANY'; url: string; nets: string[] }

// broadcaster live pages, keyed by the network codes the NHL schedule uses
export const SERVICES: Service[] = [
  { k: 'sn', name: 'Sportsnet', note: 'Sportsnet+ subscription, or sign in with your TV provider (Telus, Rogers, Bell, Shaw, Cogeco…)', country: 'CA', url: 'https://watch.sportsnet.ca/live', nets: ['SN', 'SNP', 'SNW', 'SNO', 'SNE', 'SN1', 'SN360', 'SNF', 'SNNOW', 'SN+', 'SNPLUS'] },
  { k: 'tsn', name: 'TSN', note: 'TSN+ subscription, or sign in with your TV provider', country: 'CA', url: 'https://www.tsn.ca/live', nets: ['TSN', 'TSN1', 'TSN2', 'TSN3', 'TSN4', 'TSN5', 'TSN+'] },
  { k: 'cbc', name: 'CBC Gem', note: 'Free with a CBC account (Hockey Night in Canada)', country: 'CA', url: 'https://gem.cbc.ca/live', nets: ['CBC', 'CITY', 'CITYTV'] },
  { k: 'tva', name: 'TVA Sports', note: 'Sign in with your TV provider (French)', country: 'CA', url: 'https://www.tvasports.ca/direct', nets: ['TVAS', 'TVAS2'] },
  { k: 'rds', name: 'RDS', note: 'Sign in with your TV provider (French)', country: 'CA', url: 'https://www.rds.ca/direct', nets: ['RDS', 'RDS2'] },
  { k: 'espn', name: 'ESPN / ESPN+', note: 'ESPN+ subscription, or sign in with your US TV provider', country: 'US', url: 'https://www.espn.com/watch/', nets: ['ESPN', 'ESPN+', 'ESPN2', 'ABC', 'ESPNPLUS', 'HULU'] },
  { k: 'tnt', name: 'TNT / Max', note: 'Max subscription, or sign in with your US TV provider', country: 'US', url: 'https://www.max.com/', nets: ['TNT', 'TBS', 'TRUTV', 'MAX'] },
  { k: 'prime', name: 'Prime Video', note: 'Monday Night Hockey (Canada) with a Prime membership', country: 'ANY', url: 'https://www.primevideo.com/', nets: ['PRIME', 'AMZN', 'AMAZON'] },
  { k: 'nhltv', name: 'NHL.tv / NHL Network', note: 'Out-of-market games with an NHL.tv (Canada) or ESPN+ (US) subscription', country: 'ANY', url: 'https://www.nhl.com/tv', nets: ['NHLN', 'NHLTV'] },
];
export const PROVIDERS = ['Telus', 'Rogers', 'Bell', 'Shaw', 'Vidéotron', 'Cogeco', 'Eastlink', 'SaskTel', 'Xfinity', 'Spectrum', 'DirecTV', 'YouTube TV', 'Other'];

export interface TvPrefs { provider?: string; services?: string[] }

const REGIONAL = /^(MSG|NBCS|NESN|BSN|FDS|SCRIPPS|KHN|KTVD|KCOP|ALT|ROOT|SNLA|CHSN|MNMT|TVAS|SNPLUS|VICTORY|GULF|UTAH|KONG|ESPN\+)/i;
export function serviceFor(network: string): Service | undefined {
  const n = network.toUpperCase();
  return SERVICES.find((s) => s.nets.includes(n)) ?? (REGIONAL.test(n) ? SERVICES.find((s) => s.k === 'nhltv') : undefined);
}

export interface WatchOption { network: string; service: Service; have: boolean; country: string }
// every way to watch a game, the GM's own services first
export function watchOptions(tv: { network: string; country?: string }[], prefs: TvPrefs | null | undefined): WatchOption[] {
  const have = new Set(prefs?.services ?? []);
  const seen = new Set<string>();
  const out: WatchOption[] = [];
  for (const b of tv) {
    const s = serviceFor(b.network);
    if (!s || seen.has(s.k)) continue;
    seen.add(s.k);
    out.push({ network: b.network, service: s, have: have.has(s.k), country: b.country ?? s.country });
  }
  // NHL.tv covers what the national broadcasters don't (out-of-market); the game page on NHL.com always knows
  if (!seen.has('nhltv') && tv.length) { const s = SERVICES.find((x) => x.k === 'nhltv')!; out.push({ network: 'NHL.TV', service: s, have: have.has('nhltv'), country: 'ANY' }); }
  return out.sort((a, b) => Number(b.have) - Number(a.have));
}
