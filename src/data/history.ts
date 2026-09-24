// SaK League history, transcribed from the league spreadsheet ("She's a Keeper (SaK) League")
// and the Yahoo league for 2025/26. Edit here and push to update the site.

export type GM = 'Patrick' | 'Jason' | 'Todd' | 'Craig' | 'Panagiotis' | 'Dan' | 'Trystan' | 'Sean' | 'Terry' | 'Jason G' | 'Darin';

export interface SeasonRow { team: string; gm: GM; points: number; prize?: number; peter?: boolean; note?: string }
export interface Season { season: string; note?: string; peterPenalty?: number; rows: SeasonRow[] }

// current franchise each GM runs (team ids match the database)
export const FRANCHISE_OF: Partial<Record<GM, number>> = {
  Patrick: 1, Terry: 2, Jason: 3, Craig: 4, Trystan: 5, Dan: 5, Panagiotis: 6, Todd: 7, Darin: 8,
};

export const SEASONS: Season[] = [
  { season: '2025-26', peterPenalty: 270.7, note: 'Rookie GM Darin wins it all in his first season.', rows: [
    { team: 'Hatrick Swayze', gm: 'Darin', points: 2774.75, prize: 840 },
    { team: 'Ravens', gm: 'Craig', points: 2768.3, prize: 420 },
    { team: 'Connor McPanos', gm: 'Panagiotis', points: 2690.6, prize: 140 },
    { team: 'Hughes Your Daddy', gm: 'Todd', points: 2570.2 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 2361.45 },
    { team: 'Jays', gm: 'Jason', points: 2355.9 },
    { team: '#What No Way', gm: 'Terry', points: 2312.3 },
    { team: 'Eagle Palace', gm: 'Trystan', points: 2041.6, peter: true },
  ] },
  { season: '2024-25', rows: [
    { team: 'Connor McPanos', gm: 'Panagiotis', points: 2133.1, prize: 816 },
    { team: 'Jays', gm: 'Jason', points: 2113.6, prize: 408 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 2108.1, prize: 136 },
    { team: 'North Island Ravens', gm: 'Craig', points: 2035.4 },
    { team: 'Rust-in-Peace', gm: 'Todd', points: 1984.6 },
    { team: 'Plaidsters', gm: 'Dan', points: 1821 },
    { team: '#What No Way', gm: 'Terry', points: 1693.8 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1065.4, peter: true },
  ] },
  { season: '2023-24', peterPenalty: 4.1, rows: [
    { team: '#What No Way', gm: 'Terry', points: 2245.3, prize: 720 },
    { team: 'The Black Sheep', gm: 'Sean', points: 2166.7, prize: 360 },
    { team: 'Jays', gm: 'Jason', points: 2164.8, prize: 120 },
    { team: 'Smokin Ze-gras', gm: 'Todd', points: 2096.5 },
    { team: 'Plaidsters', gm: 'Dan', points: 2040.9 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 2026.1 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1920.6 },
    { team: 'Yo Mama’s Aho', gm: 'Panagiotis', points: 1916.5, peter: true },
  ] },
  { season: '2022-23', peterPenalty: 60.4, rows: [
    { team: '#What No Way', gm: 'Terry', points: 2124.2, prize: 720 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 2059.4, prize: 360 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 2003.2, prize: 120 },
    { team: 'Jays', gm: 'Jason', points: 1976.9 },
    { team: 'Smokin Ze-gras', gm: 'Todd', points: 1915.6 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1893.4 },
    { team: 'Yo Mama’s Aho', gm: 'Panagiotis', points: 1828.5 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1768.1, peter: true },
  ] },
  { season: '2021-22', peterPenalty: 39.6, note: 'First season of the "top scorer can’t be kept" rule. Patrick added a $500 bonus to the winner’s pot.', rows: [
    { team: 'Jays', gm: 'Jason', points: 2153.7, prize: 1220 },
    { team: 'The Black Sheep', gm: 'Sean', points: 2128.8, prize: 360 },
    { team: 'Smokin Ze-gras', gm: 'Todd', points: 2081.5, prize: 120 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 2074.4 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 1982.3 },
    { team: 'Pano’s Bros Before Ahos!', gm: 'Panagiotis', points: 1935.5 },
    { team: 'Basement Dwellers', gm: 'Terry', points: 1922.5 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1882.9, peter: true },
  ] },
  { season: '2020-21', peterPenalty: 50.8, note: 'COVID-shortened season.', rows: [
    { team: 'Jays', gm: 'Jason', points: 1359.8, prize: 691.2 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 1324.4, prize: 345.6 },
    { team: 'THE NUGE', gm: 'Todd', points: 1320.3, prize: 115.2 },
    { team: 'Pano’s Hughes Boys!', gm: 'Panagiotis', points: 1301.5 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1281.8 },
    { team: 'JAGR HAS REGRETZKYS', gm: 'Terry', points: 1189.1 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1186.5 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1135.7, peter: true },
  ] },
  { season: '2019-20', peterPenalty: 90.2, note: 'COVID year: season cut short.', rows: [
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1729.6, prize: 624 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1580.9, prize: 312 },
    { team: 'Jays', gm: 'Jason', points: 1577.3, prize: 104 },
    { team: 'THE NUGE', gm: 'Todd', points: 1553.3 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1534.4 },
    { team: 'Pano’s Hughes Boys!', gm: 'Panagiotis', points: 1531.7 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 1421.4 },
    { team: 'NO REGRETZKYS', gm: 'Terry', points: 1331.2, peter: true },
  ] },
  { season: '2018-19', rows: [
    { team: 'Jays', gm: 'Jason', points: 1960.8, prize: 648 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1926, prize: 324 },
    { team: 'THE NUGE', gm: 'Todd', points: 1900.4, prize: 108 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1757.1 },
    { team: 'Mr Pano’s Webbers', gm: 'Panagiotis', points: 1756.7 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 1753.7 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1742.5 },
    { team: 'No Regretzkys', gm: 'Terry', points: 1698.3 },
    { team: 'The FMB Broncos', gm: 'Jason G', points: 1518.3, peter: true },
  ] },
  { season: '2017-18', peterPenalty: 35.2, rows: [
    { team: 'THE NUGE', gm: 'Todd', points: 1937.2, prize: 600.6 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1910.9, prize: 300.3 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1900.4, prize: 100.1 },
    { team: 'Mr Pano’s NorthStars', gm: 'Panagiotis', points: 1881.2 },
    { team: 'Jays', gm: 'Jason', points: 1816.2 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1728.8 },
    { team: 'THE JOEY MOSS’s', gm: 'Terry', points: 1717.1 },
    { team: 'Mid Island Ravens', gm: 'Craig', points: 1676.9 },
    { team: 'The Webers', gm: 'Jason G', points: 1641.7, peter: true },
  ] },
  { season: '2016-17', peterPenalty: 12.2, rows: [
    { team: 'The Black Sheep', gm: 'Sean', points: 1770.5, prize: 540.6 },
    { team: 'Jays', gm: 'Jason', points: 1757.1, prize: 270.3 },
    { team: 'THE NUGE', gm: 'Todd', points: 1737.6, prize: 90.1 },
    { team: 'Rowdy Ravens', gm: 'Craig', points: 1675 },
    { team: 'Pano’s North Stars', gm: 'Panagiotis', points: 1634 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1614.2 },
    { team: 'THE JOEY MOSS’s', gm: 'Terry', points: 1607.9 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1569.7 },
    { team: 'The Webers', gm: 'Jason G', points: 1557.5, peter: true },
  ] },
  { season: '2015-16', peterPenalty: 66.9, rows: [
    { team: 'The Black Sheep', gm: 'Sean', points: 1942.5, prize: 500 },
    { team: 'Jays', gm: 'Jason', points: 1903.4, prize: 250 },
    { team: 'THE NUGE', gm: 'Todd', points: 1873.2, prize: 75 },
    { team: 'The Rowdy Ravens', gm: 'Craig', points: 1845.4 },
    { team: 'Ontario Flames', gm: 'Dan', points: 1839.4 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1838.2 },
    { team: 'Pano’s North Stars', gm: 'Panagiotis', points: 1808.6 },
    { team: 'THE JOEY MOSS’s', gm: 'Terry', points: 1741.7, peter: true },
  ] },
  { season: '2014-15', rows: [
    { team: 'THE NUGE', gm: 'Todd', points: 2418.5, prize: 450 },
    { team: 'The Rowdy Ravens', gm: 'Craig', points: 2380.5, prize: 200 },
    { team: 'Vancouver Flames', gm: 'Dan', points: 2366.9, prize: 60 },
    { team: 'Jays', gm: 'Jason', points: 2323.7 },
    { team: 'Pano’s North Stars', gm: 'Panagiotis', points: 2257.1 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 2255.5 },
    { team: 'The Black Sheep', gm: 'Sean', points: 1808.2, peter: true },
  ] },
  { season: '2013-14', note: 'Inaugural season.', rows: [
    { team: 'Jays', gm: 'Jason', points: 1938.7, prize: 400 },
    { team: 'Vancouver Flames', gm: 'Dan', points: 1904.4, prize: 175 },
    { team: 'The Hip Czechs', gm: 'Patrick', points: 1874.4, prize: 50 },
    { team: 'The Rowdy Ravens', gm: 'Craig', points: 1811.8 },
    { team: 'THE NUGE', gm: 'Todd', points: 1762 },
    { team: 'The Big Pavelski', gm: 'Panagiotis', points: 1744.6, peter: true, note: 'Inaugural Peter winner' },
  ] },
];

// Official all-time standings from the spreadsheet through 2024-25 (expansion teams were credited the
// league average for seasons before they joined). 2025-26 is added on top below.
export const ALL_TIME_2425: { franchise: string; teamId: number; points: number }[] = [
  { franchise: 'Jays', teamId: 3, points: 23046.0 },
  { franchise: 'THE NUGE', teamId: 7, points: 22580.7 },
  { franchise: 'The Hip Czechs', teamId: 1, points: 22318.4 },
  { franchise: 'Mid Island Ravens', teamId: 4, points: 21936.1 },
  { franchise: 'Mr. Pano’s Webbers', teamId: 6, points: 21729.0 },
  { franchise: 'Ontario Flames', teamId: 5, points: 21460.0 },
  { franchise: 'No Regretzkys', teamId: 2, points: 21369.0 },
  { franchise: 'The Black Sheep', teamId: 0, points: 21189.1 },
];

export function allTime() {
  const s = SEASONS[0]; // 2025-26
  const byTeam = new Map<number, number>();
  for (const r of s.rows) byTeam.set(FRANCHISE_OF[r.gm]!, r.points);
  const avg = ALL_TIME_2425.reduce((t, r) => t + r.points, 0) / ALL_TIME_2425.length;
  const rows = ALL_TIME_2425.filter((r) => r.teamId).map((r) => ({
    teamId: r.teamId, franchise: r.franchise, points: r.points + (byTeam.get(r.teamId) ?? 0), credit: false,
  }));
  // Hatrick Swayze joined in 2025-26: expansion credit = league average of prior seasons
  rows.push({ teamId: 8, franchise: 'Hatrick Swayze', points: avg + (byTeam.get(8) ?? 0), credit: true });
  return rows.sort((a, b) => b.points - a.points);
}

export const TROPHIES = [
  { name: 'The Johnson', since: '2013', emoji: '🏆', desc: 'SaK’s championship hardware, awarded with the lion’s share of the prize pool.' },
  { name: 'The Peter', since: '2013', emoji: '🪣', desc: 'Last place. Comes with the Peter Punishment: $1 per point behind second-last, paid into the SaK Fund.' },
  { name: 'The Korogon-Ass Trophy', since: '2015-16', emoji: '🤡', desc: 'Unsportsmanlike conduct: whinging, sore losing, excuse making.' },
];

export const TIMELINE = [
  { when: 'Sep 2013', what: 'SaK League founded by Patrick with Jason, Todd, Craig, Panagiotis and Dan. Dues $100.' },
  { when: 'Sep 2013', what: 'The Johnson and The Peter trophies introduced.' },
  { when: 'Sep 2014', what: 'Sean joins (The Black Sheep).' },
  { when: 'Sep 2015', what: 'Terry joins. SaK Fund established.' },
  { when: '2015-16', what: 'Korogon-Ass Trophy added for unsportsmanlike conduct. Vancouver Flames move to Ontario.' },
  { when: 'Sep 2016', what: 'Jason Griffiths joins.' },
  { when: 'Sep 2019', what: 'Jason Griffiths leaves; keeper count changes by text vote.' },
  { when: 'Sep 2021', what: 'League moves to Ethereum (cancelled 2023-24). Top scorer on each team can no longer be kept.' },
  { when: 'Sep 2023', what: 'Trystan starts co-managing with Dan.' },
  { when: 'Sep 2025', what: 'Dan and Sean leave; Trystan takes over Dan’s franchise; Darin joins and wins it all.' },
  { when: 'Sep 2026', what: 'SaK moves off Yahoo to its own home: this site.' },
];

export const RULES: { title: string; items: string[] }[] = [
  { title: 'Code of Ethics', items: [
    'All SaK rules are set up so every GM competes through to the end of the season and is actively trying to win.',
    'This is a league of winners who are always looking to win; whiners, sore losers, complainers and excuse makers are not welcome or rewarded.',
    'Play fair, play hard and play to win. Those are SaK GM qualities.',
  ] },
  { title: 'Format', items: [
    'Season-long points league: most fantasy points at the end of the NHL regular season wins the regular-season pot. From 2026-27 the season carries on through the NHL playoffs as a second, separate race for the playoff pot.',
    'Rosters: C, C, LW, LW, RW, RW, D, D, D, Util, G, G plus 12 bench and 2 IR spots.',
    'Daily lineups. A player locks when his NHL game starts; only starters (not BN/IR) score.',
    'Live standard (snake) draft with a pick clock. Draft picks can be traded.',
  ] },
  { title: 'Keepers', items: [
    '6 keepers in a non-expansion year, 5 in an expansion year.',
    'Your top-scoring player from last season cannot be kept and goes back into the draft pool (since 2021-22).',
    'Expansion GMs draft in the middle position and get first pick of everyone’s non-keepers before draft day (no rookies).',
  ] },
  { title: 'Transactions', items: [
    '10 free pickups per season. Extra pickups cost $30 each ($15 to the prize pool, $15 to the SaK Fund), allowed until 7 days before the season ends.',
    'No maximum on trades: the league wants as many trades as possible.',
    'Trades are reviewed by the commissioner for fairness; generally all trades are approved. Accepted trades auto-approve after 24 hours.',
    'Trade deadline matches the NHL trade deadline.',
  ] },
  { title: 'Money', items: [
    'Entry $200 per team, of which $25 goes to the SaK Fund; the other $175 per team is the prize pool.',
    'From 2026-27 the prize pool is split 60% regular season and 40% playoffs. Each pot pays 1st / 2nd / 3rd 60 / 30 / 10.',
    'The playoffs use the same rosters: only fantasy points from NHL playoff games count toward the separate playoff table.',
    'The Peter Punishment: last place pays $1 per point behind second-last into the SaK Fund.',
    'Get SaK’ed: $5 per game your player is suspended (max $50 per player, $100 per team per season), all to the SaK Fund.',
    'The SaK Fund is shared equally and is for future GM fun (a GM trip to the draft, etc.). A GM who leaves forfeits their share; if the league disbands, remaining GMs split it.',
  ] },
  { title: 'Expansion', items: [
    'Expansion fee $150. No more than 2 new GMs per season, and new GMs must be known by at least 2 existing GMs.',
    'Sponsor GMs pay $25 each if the new GM doesn’t meaningfully contribute (trash talk, trades, helping the league) in their first year, decided by anonymous majority vote.',
    'A GM who refers a new GM who pulls out within 2 seasons pays $50 to the fund; if the new GM sticks, the referrer gets a $50 bonus.',
    'Expansion GMs don’t vote on league changes in their first season.',
  ] },
  { title: 'Governance', items: [
    'Any GM can propose a rule change anytime. Without 100% consensus, a proposal with 2+ sponsors goes to a vote; simple majority decides; the commissioner has veto.',
    'Commissioners can be replaced by election: any GM can run, and the new commissioner needs 50% + 1 of the votes.',
  ] },
];
