// Where to watch an NHL broadcast. Live streams belong to the rights-holders, so SaK sends each GM to the
// broadcaster's own live page for the game, where signing in with a TV provider (Telus, Rogers, Bell,
// Shaw…) or a subscription unlocks the feed. A GM's profile records what they have, so games they can
// actually watch get flagged.

export interface Service { k: string; name: string; note: string; country: 'CA' | 'US' | 'ANY'; url: string; nets: string[] }

// broadcaster live pages, keyed by the network codes the NHL schedule uses (2026-27 rights, docs/WATCH-LIVE.md: Rogers has
// every national game in Canada and sub-licenses Wednesdays to Prime Video and French to TVA; CBC no longer carries the
// NHL; in the US ESPN and TNT share the national games and local TV moved to team apps, Prime and DAZN)
export const SERVICES: Service[] = [
  { k: 'sn', name: 'Sportsnet+', note: 'Every national game in Canada, Monday Night Hockey included (Standard, or Premium for every out-of-market game too), or sign in with your TV provider', country: 'CA', url: 'https://www.sportsnetplus.ca/', nets: ['SN', 'SNP', 'SNW', 'SNO', 'SNE', 'SN1', 'SN360', 'SNF', 'SNNOW', 'SN+', 'SNPLUS', 'SPORTSNET', 'SPORTSNET+'] },
  { k: 'tsn', name: 'TSN', note: 'Jets, Senators, Canadiens (English) and some Leafs games in their regions; TSN subscription, or sign in with your TV provider', country: 'CA', url: 'https://www.tsn.ca/live/', nets: ['TSN', 'TSN1', 'TSN2', 'TSN3', 'TSN4', 'TSN5', 'TSN+'] },
  { k: 'prime', name: 'Prime Video', note: 'Wednesday night national games in Canada with a Prime membership; in the US, local games for six teams', country: 'ANY', url: 'https://www.primevideo.com/', nets: ['PRIME', 'AMZN', 'AMAZON', 'PRIMEVIDEO'] },
  { k: 'tva', name: 'TVA Sports', note: 'French national games and the Canadiens; sign in with your TV provider', country: 'CA', url: 'https://www.tvasports.ca/en-direct', nets: ['TVAS', 'TVAS2', 'TVASPORTS'] },
  { k: 'rds', name: 'RDS', note: 'Canadiens and Senators regional games in French; sign in with your TV provider', country: 'CA', url: 'https://www.rds.ca/emissions/en-direct/', nets: ['RDS', 'RDS2'] },
  { k: 'espn', name: 'ESPN', note: 'ESPN Select or Unlimited, or sign in with your US TV provider; includes NHL Power Play (out-of-market)', country: 'US', url: 'https://www.espn.com/watch/', nets: ['ESPN', 'ESPN+', 'ESPN2', 'ABC', 'ESPNPLUS', 'HULU', 'DISNEY+'] },
  { k: 'tnt', name: 'TNT / HBO Max', note: 'HBO Max Standard or Premium (Basic with Ads has no live sports), or sign in with your US TV provider', country: 'US', url: 'https://www.hbomax.com/', nets: ['TNT', 'TBS', 'TRUTV', 'MAX', 'HBOMAX'] },
  { k: 'dazn', name: 'DAZN', note: 'Rangers, Islanders, Devils, Sabres (MSG) and Kings local games in the US; NHL.TV outside North America', country: 'ANY', url: 'https://www.dazn.com/', nets: ['MSG', 'MSG-B', 'MSGSN', 'MSG2', 'DAZN'] },
  { k: 'nhltv', name: 'Out-of-market', note: 'Every out-of-market game: Sportsnet+ Premium in Canada, NHL Power Play on ESPN in the US', country: 'ANY', url: 'https://www.sportsnetplus.ca/', nets: ['NHLN', 'NHLTV'] },
];
export const PROVIDERS = ['Telus', 'Rogers', 'Bell', 'Shaw', 'Vidéotron', 'Cogeco', 'Eastlink', 'SaskTel', 'Xfinity', 'Spectrum', 'DirecTV', 'YouTube TV', 'Other'];

// the TV providers' own web players: one sign-in, every channel you subscribe to, no broadcaster hopping.
// The fastest route for a cable/fibre subscriber, so it goes first on the game card.
export interface ProviderPlayer { name: string; url: string; how: string }
export const PROVIDER_PLAYERS: Record<string, ProviderPlayer> = {
  Telus: { name: 'TELUS TV+', url: 'https://telustvplus.com/#/', how: 'Sign in once with your TELUS account (same as My TELUS), open Live TV and pick the channel.' },
  Rogers: { name: 'Rogers Xfinity Stream', url: 'https://rogersxfinitystream.rogers.com/', how: 'Sign in with your Rogers account, open Live TV and pick the channel.' },
  Shaw: { name: 'Rogers Xfinity Stream', url: 'https://rogersxfinitystream.rogers.com/', how: 'Shaw is Rogers now: sign in with your Shaw/Rogers account, open Live TV and pick the channel.' },
  Bell: { name: 'Bell Fibe TV', url: 'https://tv.bell.ca/', how: 'Sign in with your MyBell account, open Live TV and pick the channel.' },
  Vidéotron: { name: 'Helix TV', url: 'https://helix.videotron.com/', how: 'Sign in with your Vidéotron account and pick the channel.' },
  Xfinity: { name: 'Xfinity Stream', url: 'https://www.xfinity.com/stream/', how: 'Sign in with your Xfinity account, open Live TV and pick the channel.' },
  Spectrum: { name: 'Spectrum TV', url: 'https://watch.spectrum.net/', how: 'Sign in with your Spectrum account, open Live TV and pick the channel.' },
  DirecTV: { name: 'DIRECTV', url: 'https://stream.directv.com/', how: 'Sign in with your DIRECTV account and pick the channel.' },
  'YouTube TV': { name: 'YouTube TV', url: 'https://tv.youtube.com/', how: 'Open YouTube TV and pick the channel from Live.' },
};
export const playerFor = (provider?: string | null) => (provider ? PROVIDER_PLAYERS[provider] : undefined);

// all: the GM has every service and channel (Patrick, 7 October 2026: "I already have access to all the content via
// subscriptions"), so every game opens straight in its broadcaster's player, nothing locked
export interface TvPrefs { provider?: string; services?: string[]; all?: boolean }

const REGIONAL = /^(NBCS|NESN|BSN|FDS|SCRIPPS|KHN|KTVD|KCOP|ALT|ROOT|SNLA|CHSN|MNMT|TVAS|SNPLUS|VICTORY|GULF|UTAH|KONG|ESPN\+)/i;
export function serviceFor(network: string): Service | undefined {
  // the schedule writes some networks in words ('Prime Video', 'Disney+'): match them without spaces
  const n = network.toUpperCase().replace(/\s+/g, '');
  return SERVICES.find((s) => s.nets.includes(n)) ?? (REGIONAL.test(n) ? SERVICES.find((s) => s.k === 'nhltv') : undefined);
}

export interface WatchOption { network: string; service: Service; have: boolean; country: string }
// every way to watch a game, the GM's own services first
export function watchOptions(tv: { network: string; country?: string }[], prefs: TvPrefs | null | undefined): WatchOption[] {
  const have = new Set(prefs?.all ? SERVICES.map((s) => s.k) : prefs?.services ?? []);
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

// ───────────── Watch live (#/watch) ─────────────
// The country a GM watches from: their TV provider says it; a GM with streaming only follows their services; Canada by
// default (the league's home).
const US_PROVIDERS = new Set(['Xfinity', 'Spectrum', 'DirecTV', 'YouTube TV']);
export function countryOf(prefs: TvPrefs | null | undefined): 'CA' | 'US' {
  if (prefs?.provider) return US_PROVIDERS.has(prefs.provider) ? 'US' : 'CA';
  const sv = (prefs?.services ?? []).map((k) => SERVICES.find((s) => s.k === k)?.country);
  return sv.includes('US') && !sv.includes('CA') ? 'US' : 'CA';
}

export type Verdict = { state: 'yes' | 'free' | 'maybe' | 'no' | 'none'; line: string; best?: { name: string; url: string } };
// can this GM watch this game, and where: on a service they have, on their TV provider's player (a national channel),
// (or free over the air), on a regional feed that may be blacked out where they live, or only with a service they don't have
export function verdict(tv: { network: string; market?: string; country?: string }[], prefs: TvPrefs | null | undefined): Verdict {
  const home = countryOf(prefs);
  const mine = tv.filter((b) => (b.country ?? '').toUpperCase() === home);
  const feeds = mine.length ? mine : tv;
  if (!feeds.length) return { state: 'none', line: 'No broadcast listed yet' };
  const opts = watchOptions(feeds, prefs);
  if (prefs?.all) {
    // everything is unlocked: go straight to the broadcaster carrying it where they watch (out-of-market when no one is)
    const o = opts.find((x) => x.service.k !== 'nhltv') ?? opts[0];
    const regional = feeds.some((b) => b.market === 'H' || b.market === 'A') && !feeds.some((b) => (b.market ?? 'N') === 'N');
    return o ? { state: 'yes', line: `On ${o.service.name}${regional ? ' (regional feed)' : ''}`, best: { name: o.service.name, url: o.service.url } } : { state: 'none', line: 'No broadcast listed yet' };
  }
  const have = opts.find((o) => o.have && o.service.k !== 'nhltv');
  if (have) return { state: 'yes', line: `On ${have.service.name}, which you have`, best: { name: have.service.name, url: have.service.url } };
  const player = playerFor(prefs?.provider);
  const national = feeds.filter((b) => (b.market ?? 'N') === 'N');
  const cable = national.map((b) => serviceFor(b.network)).find((s) => s && ['sn', 'tsn', 'tva', 'rds', 'espn', 'tnt'].includes(s.k));
  if (player && cable) return { state: 'yes', line: `On ${cable.name}: in your ${prefs!.provider} package`, best: { name: player.name, url: player.url } };
  const regional = feeds.find((b) => b.market === 'H' || b.market === 'A');
  if (regional && player) {
    const s = serviceFor(regional.network);
    return { state: 'maybe', line: `Regional feed${s ? ` on ${s.name}` : ''}: in your package if you're in the team's region`, best: { name: player.name, url: player.url } };
  }
  const first = opts.find((o) => o.service.k !== 'nhltv') ?? opts[0];
  return first ? { state: 'no', line: `Needs ${first.service.name}`, best: { name: first.service.name, url: first.service.url } } : { state: 'none', line: 'No broadcast listed yet' };
}
