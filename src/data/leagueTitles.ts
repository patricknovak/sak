// Settled history for the other leagues' fan zones (25 October 2026): the champions before ESPN's tables begin (the
// NFL's from the 2002 season, the NBA's and the Premier League's from 2003), and when each club was founded. Everything
// from those seasons on is read from the feeds by nhl-hub's fan-sport-history task; only what the feeds don't keep lives
// here. Clubs are ESPN's codes (the fan zones' own); a champion that no longer exists is named instead.
// A year is the league's own season label: the NFL's season start (2001 is Super Bowl XXXVI, played in February 2002),
// the NBA's season end (2002 is 2001-02), the Premier League's season start (2002 is 2002-03), as ESPN counts them.

export interface TitleRow { year: number; club: string | null; name?: string; label?: string }
export interface LeagueTitles { what: string; one: string; rows: TitleRow[] }

const nfl = (year: number, club: string | null, name?: string, label?: string): TitleRow => ({ year, club, ...(name ? { name } : {}), ...(label ? { label } : {}) });
export const TITLES: Record<string, LeagueTitles> = {
  nfl: {
    what: 'Super Bowls', one: 'Super Bowl',
    rows: [
      // the NFL's championships before the Super Bowl (1920 to 1965): current franchises by their codes, the others by name
      nfl(1920, null, 'Akron Pros', 'NFL championship'), nfl(1921, 'CHI', 'Chicago Staleys', 'NFL championship'), nfl(1922, null, 'Canton Bulldogs', 'NFL championship'),
      nfl(1923, null, 'Canton Bulldogs', 'NFL championship'), nfl(1924, null, 'Cleveland Bulldogs', 'NFL championship'), nfl(1925, 'ARI', 'Chicago Cardinals', 'NFL championship'),
      nfl(1926, null, 'Frankford Yellow Jackets', 'NFL championship'), nfl(1927, 'NYG', undefined, 'NFL championship'), nfl(1928, null, 'Providence Steam Roller', 'NFL championship'),
      nfl(1929, 'GB', undefined, 'NFL championship'), nfl(1930, 'GB', undefined, 'NFL championship'), nfl(1931, 'GB', undefined, 'NFL championship'),
      nfl(1932, 'CHI', undefined, 'NFL championship'), nfl(1933, 'CHI', undefined, 'NFL championship'), nfl(1934, 'NYG', undefined, 'NFL championship'),
      nfl(1935, 'DET', undefined, 'NFL championship'), nfl(1936, 'GB', undefined, 'NFL championship'), nfl(1937, 'WSH', undefined, 'NFL championship'),
      nfl(1938, 'NYG', undefined, 'NFL championship'), nfl(1939, 'GB', undefined, 'NFL championship'), nfl(1940, 'CHI', undefined, 'NFL championship'),
      nfl(1941, 'CHI', undefined, 'NFL championship'), nfl(1942, 'WSH', undefined, 'NFL championship'), nfl(1943, 'CHI', undefined, 'NFL championship'),
      nfl(1944, 'GB', undefined, 'NFL championship'), nfl(1945, 'LAR', 'Cleveland Rams', 'NFL championship'), nfl(1946, 'CHI', undefined, 'NFL championship'),
      nfl(1947, 'ARI', 'Chicago Cardinals', 'NFL championship'), nfl(1948, 'PHI', undefined, 'NFL championship'), nfl(1949, 'PHI', undefined, 'NFL championship'),
      nfl(1950, 'CLE', undefined, 'NFL championship'), nfl(1951, 'LAR', 'Los Angeles Rams', 'NFL championship'), nfl(1952, 'DET', undefined, 'NFL championship'),
      nfl(1953, 'DET', undefined, 'NFL championship'), nfl(1954, 'CLE', undefined, 'NFL championship'), nfl(1955, 'CLE', undefined, 'NFL championship'),
      nfl(1956, 'NYG', undefined, 'NFL championship'), nfl(1957, 'DET', undefined, 'NFL championship'), nfl(1958, 'IND', 'Baltimore Colts', 'NFL championship'),
      nfl(1959, 'IND', 'Baltimore Colts', 'NFL championship'), nfl(1960, 'PHI', undefined, 'NFL championship'), nfl(1961, 'GB', undefined, 'NFL championship'),
      nfl(1962, 'GB', undefined, 'NFL championship'), nfl(1963, 'CHI', undefined, 'NFL championship'), nfl(1964, 'CLE', undefined, 'NFL championship'),
      nfl(1965, 'GB', undefined, 'NFL championship'),
      // the AFL's (1960 to 1969; from 1966 its champion went on to the Super Bowl, which decides the title from then on)
      nfl(1960, 'TEN', 'Houston Oilers', 'AFL championship'), nfl(1961, 'TEN', 'Houston Oilers', 'AFL championship'), nfl(1962, 'KC', 'Dallas Texans', 'AFL championship'),
      nfl(1963, 'LAC', 'San Diego Chargers', 'AFL championship'), nfl(1964, 'BUF', undefined, 'AFL championship'), nfl(1965, 'BUF', undefined, 'AFL championship'),
      nfl(1966, 'KC', undefined, 'AFL championship'), nfl(1967, 'LV', 'Oakland Raiders', 'AFL championship'), nfl(1968, 'NYJ', undefined, 'AFL championship'), nfl(1969, 'KC', undefined, 'AFL championship'),
      // the Super Bowls, by season
      nfl(1966, 'GB'), nfl(1967, 'GB'), nfl(1968, 'NYJ'), nfl(1969, 'KC'), nfl(1970, 'IND', 'Baltimore Colts'), nfl(1971, 'DAL'), nfl(1972, 'MIA'), nfl(1973, 'MIA'),
      nfl(1974, 'PIT'), nfl(1975, 'PIT'), nfl(1976, 'LV', 'Oakland Raiders'), nfl(1977, 'DAL'), nfl(1978, 'PIT'), nfl(1979, 'PIT'), nfl(1980, 'LV', 'Oakland Raiders'),
      nfl(1981, 'SF'), nfl(1982, 'WSH'), nfl(1983, 'LV', 'Los Angeles Raiders'), nfl(1984, 'SF'), nfl(1985, 'CHI'), nfl(1986, 'NYG'), nfl(1987, 'WSH'), nfl(1988, 'SF'),
      nfl(1989, 'SF'), nfl(1990, 'NYG'), nfl(1991, 'WSH'), nfl(1992, 'DAL'), nfl(1993, 'DAL'), nfl(1994, 'SF'), nfl(1995, 'DAL'), nfl(1996, 'GB'), nfl(1997, 'DEN'),
      nfl(1998, 'DEN'), nfl(1999, 'LAR', 'St. Louis Rams'), nfl(2000, 'BAL'), nfl(2001, 'NE'),
    ],
  },
  nba: {
    what: 'NBA championships', one: 'NBA championship',
    rows: [
      nfl(1947, 'GS', 'Philadelphia Warriors'), nfl(1948, null, 'Baltimore Bullets'), nfl(1949, 'LAL', 'Minneapolis Lakers'), nfl(1950, 'LAL', 'Minneapolis Lakers'),
      nfl(1951, 'SAC', 'Rochester Royals'), nfl(1952, 'LAL', 'Minneapolis Lakers'), nfl(1953, 'LAL', 'Minneapolis Lakers'), nfl(1954, 'LAL', 'Minneapolis Lakers'),
      nfl(1955, 'PHI', 'Syracuse Nationals'), nfl(1956, 'GS', 'Philadelphia Warriors'), nfl(1957, 'BOS'), nfl(1958, 'ATL', 'St. Louis Hawks'),
      nfl(1959, 'BOS'), nfl(1960, 'BOS'), nfl(1961, 'BOS'), nfl(1962, 'BOS'), nfl(1963, 'BOS'), nfl(1964, 'BOS'), nfl(1965, 'BOS'), nfl(1966, 'BOS'),
      nfl(1967, 'PHI'), nfl(1968, 'BOS'), nfl(1969, 'BOS'), nfl(1970, 'NY'), nfl(1971, 'MIL'), nfl(1972, 'LAL'), nfl(1973, 'NY'), nfl(1974, 'BOS'),
      nfl(1975, 'GS'), nfl(1976, 'BOS'), nfl(1977, 'POR'), nfl(1978, 'WSH', 'Washington Bullets'), nfl(1979, 'OKC', 'Seattle SuperSonics'), nfl(1980, 'LAL'),
      nfl(1981, 'BOS'), nfl(1982, 'LAL'), nfl(1983, 'PHI'), nfl(1984, 'BOS'), nfl(1985, 'LAL'), nfl(1986, 'BOS'), nfl(1987, 'LAL'), nfl(1988, 'LAL'),
      nfl(1989, 'DET'), nfl(1990, 'DET'), nfl(1991, 'CHI'), nfl(1992, 'CHI'), nfl(1993, 'CHI'), nfl(1994, 'HOU'), nfl(1995, 'HOU'), nfl(1996, 'CHI'),
      nfl(1997, 'CHI'), nfl(1998, 'CHI'), nfl(1999, 'SA'), nfl(2000, 'LAL'), nfl(2001, 'LAL'), nfl(2002, 'LAL'),
    ],
  },
  epl: {
    what: 'English titles', one: 'English title',
    rows: [
      nfl(1888, null, 'Preston North End'), nfl(1889, null, 'Preston North End'), nfl(1890, 'EVE'), nfl(1891, 'SUN'), nfl(1892, 'SUN'), nfl(1893, 'AVL'), nfl(1894, 'SUN'),
      nfl(1895, 'AVL'), nfl(1896, 'AVL'), nfl(1897, null, 'Sheffield United'), nfl(1898, 'AVL'), nfl(1899, 'AVL'), nfl(1900, 'LIV'), nfl(1901, 'SUN'),
      nfl(1902, null, 'Sheffield Wednesday'), nfl(1903, null, 'Sheffield Wednesday'), nfl(1904, 'NEW'), nfl(1905, 'LIV'), nfl(1906, 'NEW'), nfl(1907, 'MAN'),
      nfl(1908, 'NEW'), nfl(1909, 'AVL'), nfl(1910, 'MAN'), nfl(1911, null, 'Blackburn Rovers'), nfl(1912, 'SUN'), nfl(1913, null, 'Blackburn Rovers'), nfl(1914, 'EVE'),
      nfl(1919, null, 'West Bromwich Albion'), nfl(1920, 'BUR'), nfl(1921, 'LIV'), nfl(1922, 'LIV'), nfl(1923, null, 'Huddersfield Town'), nfl(1924, null, 'Huddersfield Town'),
      nfl(1925, null, 'Huddersfield Town'), nfl(1926, 'NEW'), nfl(1927, 'EVE'), nfl(1928, null, 'Sheffield Wednesday'), nfl(1929, null, 'Sheffield Wednesday'), nfl(1930, 'ARS'),
      nfl(1931, 'EVE'), nfl(1932, 'ARS'), nfl(1933, 'ARS'), nfl(1934, 'ARS'), nfl(1935, 'SUN'), nfl(1936, 'MNC'), nfl(1937, 'ARS'), nfl(1938, 'EVE'),
      nfl(1946, 'LIV'), nfl(1947, 'ARS'), nfl(1948, null, 'Portsmouth'), nfl(1949, null, 'Portsmouth'), nfl(1950, 'TOT'), nfl(1951, 'MAN'), nfl(1952, 'ARS'), nfl(1953, 'WOL'),
      nfl(1954, 'CHE'), nfl(1955, 'MAN'), nfl(1956, 'MAN'), nfl(1957, 'WOL'), nfl(1958, 'WOL'), nfl(1959, 'BUR'), nfl(1960, 'TOT'), nfl(1961, null, 'Ipswich Town'),
      nfl(1962, 'EVE'), nfl(1963, 'LIV'), nfl(1964, 'MAN'), nfl(1965, 'LIV'), nfl(1966, 'MAN'), nfl(1967, 'MNC'), nfl(1968, 'LEE'), nfl(1969, 'EVE'),
      nfl(1970, 'ARS'), nfl(1971, null, 'Derby County'), nfl(1972, 'LIV'), nfl(1973, 'LEE'), nfl(1974, null, 'Derby County'), nfl(1975, 'LIV'), nfl(1976, 'LIV'),
      nfl(1977, 'NFO'), nfl(1978, 'LIV'), nfl(1979, 'LIV'), nfl(1980, 'AVL'), nfl(1981, 'LIV'), nfl(1982, 'LIV'), nfl(1983, 'LIV'), nfl(1984, 'EVE'),
      nfl(1985, 'LIV'), nfl(1986, 'EVE'), nfl(1987, 'LIV'), nfl(1988, 'ARS'), nfl(1989, 'LIV'), nfl(1990, 'ARS'), nfl(1991, 'LEE'), nfl(1992, 'MAN'),
      nfl(1993, 'MAN'), nfl(1994, null, 'Blackburn Rovers'), nfl(1995, 'MAN'), nfl(1996, 'MAN'), nfl(1997, 'ARS'), nfl(1998, 'MAN'), nfl(1999, 'MAN'),
      nfl(2000, 'MAN'), nfl(2001, 'ARS'), nfl(2002, 'MAN'),
    ],
  },
};

// the year each club was founded (a franchise's first season, under any name)
export const FOUNDED: Record<string, Record<string, number>> = {
  nfl: { ARI: 1898, ATL: 1966, BAL: 1996, BUF: 1960, CAR: 1995, CHI: 1920, CIN: 1968, CLE: 1946, DAL: 1960, DEN: 1960, DET: 1930, GB: 1919, HOU: 2002, IND: 1953, JAX: 1995, KC: 1960,
    LV: 1960, LAC: 1960, LAR: 1936, MIA: 1966, MIN: 1961, NE: 1960, NO: 1967, NYG: 1925, NYJ: 1960, PHI: 1933, PIT: 1933, SF: 1946, SEA: 1976, TB: 1976, TEN: 1960, WSH: 1932 },
  nba: { ATL: 1946, BOS: 1946, BKN: 1967, CHA: 1988, CHI: 1966, CLE: 1970, DAL: 1980, DEN: 1967, DET: 1941, GS: 1946, HOU: 1967, IND: 1967, LAC: 1970, LAL: 1947, MEM: 1995,
    MIA: 1988, MIL: 1968, MIN: 1989, NO: 2002, NY: 1946, OKC: 1967, ORL: 1989, PHI: 1946, PHX: 1968, POR: 1970, SAC: 1923, SA: 1967, TOR: 1995, UTAH: 1974, WSH: 1961 },
  epl: { ARS: 1886, AVL: 1874, BOU: 1899, BRE: 1889, BHA: 1901, BUR: 1882, CHE: 1905, CRY: 1905, EVE: 1878, FUL: 1879, LEE: 1919, LIV: 1892, MNC: 1880, MAN: 1878, NEW: 1892,
    NFO: 1865, SUN: 1879, TOT: 1882, WHU: 1895, WOL: 1877, IPS: 1878, LEI: 1884, SOU: 1885 },
};

// a title counts once: the Super Bowl decides the NFL's from 1966, so the AFL's from then on are the road to it
export const countsAsTitle = (league: string, r: TitleRow) => !(league === 'nfl' && r.label === 'AFL championship' && r.year >= 1966);
