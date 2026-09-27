// The insiders the X feed follows by default. The commissioner can change the list and add topics on the
// Commissioner page; the edge function reads league.info.x_feed and falls back to these.
export interface XAccount { handle: string; name: string }
export interface XFeedConfig { accounts: XAccount[]; topics: string[] }
export const X_DEFAULT_ACCOUNTS: XAccount[] = [
  { handle: 'NHL', name: 'NHL' }, { handle: 'PR_NHL', name: 'NHL Public Relations' }, { handle: 'FriedgeHNIC', name: 'Elliotte Friedman' },
  { handle: 'TSNBobMcKenzie', name: 'Bob McKenzie' }, { handle: 'PierreVLeBrun', name: 'Pierre LeBrun' }, { handle: 'DarrenDreger', name: 'Darren Dreger' },
  { handle: 'frank_seravalli', name: 'Frank Seravalli' }, { handle: 'emilymkaplan', name: 'Emily Kaplan' }, { handle: 'reporterchris', name: 'Chris Johnston' },
  { handle: 'NHLInjuryNews', name: 'NHL Injury News' }, { handle: 'PuckPedia', name: 'PuckPedia' }, { handle: 'DailyFaceoff', name: 'Daily Faceoff' },
];
export const X_SUGGESTED: XAccount[] = [
  { handle: 'JeffMarek', name: 'Jeff Marek' }, { handle: 'DavidPagnotta', name: 'David Pagnotta' }, { handle: 'JohnShannonNHL', name: 'John Shannon' },
  { handle: 'EricEngels', name: 'Eric Engels' }, { handle: 'ByScottWheeler', name: 'Scott Wheeler' }, { handle: 'JFreshHockey', name: 'JFresh' },
  { handle: 'CapFriendly', name: 'CapFriendly' }, { handle: 'TheAthleticNHL', name: 'The Athletic NHL' }, { handle: 'Sportsnet', name: 'Sportsnet' }, { handle: 'TSNHockey', name: 'TSN Hockey' },
];
export const X_MAX_ACCOUNTS = 20;
export const xConfigOf = (info: Record<string, unknown> | undefined): XFeedConfig => {
  const cfg = info?.x_feed as Partial<XFeedConfig> | undefined;
  return { accounts: Array.isArray(cfg?.accounts) && cfg!.accounts.length ? cfg!.accounts : X_DEFAULT_ACCOUNTS, topics: Array.isArray(cfg?.topics) ? cfg!.topics : [] };
};
