// The sport a league plays, as the engine reads it: positions and their groups, lineup slots and who each accepts, the
// stat vocabulary, game states, period labels, the season's shape, the day boundary and the words that differ by sport
// (docs/EXPANSION.md section 6, Phase 3). The database keeps one row per sport (`sports`, migration 135) and the store
// loads the league's; the NHL's is compiled in here too, so a page never waits on it and a league that plays hockey
// reads exactly this. supabase/tests/sport.test.mjs fails if this copy and the migration's row drift apart.
// Code moves onto it one place at a time; until a place has moved, it still says hockey itself.

export interface SportPosition { key: string; label: string; group: string }
export interface SportGroup { key: string; label: string; one: string }
export interface SportSlot { key: string; label: string; accepts: string[]; group?: string }
export interface SportStat { key: string; label: string; short: string; group: string; low?: boolean }
export interface SportConfig {
  name: string;
  positions: SportPosition[];
  groups: SportGroup[];
  slots: SportSlot[];
  bench: string;
  injured: string;
  stats: SportStat[];
  states: Record<'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled', string[]>;
  periods: Record<string, string>;
  season: { games: number; starterGames: number; playoffs: boolean };
  day: { tz: string; rollover: string };
  lock: 'game' | 'day' | 'week';
  words: Record<string, string>;
}

export const NHL: SportConfig = {
  "name": "NHL hockey",
  "positions": [
    {
      "key": "C",
      "label": "Centre",
      "group": "S"
    },
    {
      "key": "LW",
      "label": "Left wing",
      "group": "S"
    },
    {
      "key": "RW",
      "label": "Right wing",
      "group": "S"
    },
    {
      "key": "D",
      "label": "Defence",
      "group": "S"
    },
    {
      "key": "G",
      "label": "Goalie",
      "group": "G"
    }
  ],
  "groups": [
    {
      "key": "S",
      "label": "Skaters",
      "one": "skater"
    },
    {
      "key": "G",
      "label": "Goalies",
      "one": "goalie"
    }
  ],
  "slots": [
    {
      "key": "C",
      "label": "C",
      "accepts": [
        "C"
      ]
    },
    {
      "key": "LW",
      "label": "LW",
      "accepts": [
        "LW"
      ]
    },
    {
      "key": "RW",
      "label": "RW",
      "accepts": [
        "RW"
      ]
    },
    {
      "key": "D",
      "label": "D",
      "accepts": [
        "D"
      ]
    },
    {
      "key": "Util",
      "label": "Util",
      "accepts": [
        "C",
        "LW",
        "RW",
        "D"
      ],
      "group": "S"
    },
    {
      "key": "G",
      "label": "G",
      "accepts": [
        "G"
      ]
    }
  ],
  "bench": "BN",
  "injured": "IR",
  "stats": [
    {
      "key": "g",
      "label": "Goals",
      "short": "G",
      "group": "S"
    },
    {
      "key": "a",
      "label": "Assists",
      "short": "A",
      "group": "S"
    },
    {
      "key": "pts",
      "label": "Points",
      "short": "P",
      "group": "S"
    },
    {
      "key": "pm",
      "label": "Plus / minus",
      "short": "+/-",
      "group": "S"
    },
    {
      "key": "ppp",
      "label": "Powerplay points",
      "short": "PPP",
      "group": "S"
    },
    {
      "key": "ppg",
      "label": "Powerplay goals",
      "short": "PPG",
      "group": "S"
    },
    {
      "key": "shp",
      "label": "Shorthanded points",
      "short": "SHP",
      "group": "S"
    },
    {
      "key": "gwg",
      "label": "Game-winning goals",
      "short": "GWG",
      "group": "S"
    },
    {
      "key": "sog",
      "label": "Shots on goal",
      "short": "SOG",
      "group": "S"
    },
    {
      "key": "hit",
      "label": "Hits",
      "short": "HIT",
      "group": "S"
    },
    {
      "key": "blk",
      "label": "Blocks",
      "short": "BLK",
      "group": "S"
    },
    {
      "key": "pim",
      "label": "Penalty minutes",
      "short": "PIM",
      "group": "S"
    },
    {
      "key": "fow",
      "label": "Faceoffs won",
      "short": "FW",
      "group": "S"
    },
    {
      "key": "gs",
      "label": "Games started",
      "short": "GS",
      "group": "G"
    },
    {
      "key": "w",
      "label": "Wins",
      "short": "W",
      "group": "G"
    },
    {
      "key": "l",
      "label": "Losses",
      "short": "L",
      "group": "G",
      "low": true
    },
    {
      "key": "otl",
      "label": "OT losses",
      "short": "OTL",
      "group": "G",
      "low": true
    },
    {
      "key": "sv",
      "label": "Saves",
      "short": "SV",
      "group": "G"
    },
    {
      "key": "sa",
      "label": "Shots against",
      "short": "SA",
      "group": "G"
    },
    {
      "key": "ga",
      "label": "Goals against",
      "short": "GA",
      "group": "G",
      "low": true
    },
    {
      "key": "sho",
      "label": "Shutouts",
      "short": "SO",
      "group": "G"
    }
  ],
  "states": {
    "scheduled": [
      "FUT",
      "PRE"
    ],
    "live": [
      "LIVE",
      "CRIT"
    ],
    "final": [
      "FINAL",
      "OFF"
    ],
    "postponed": [
      "PPD"
    ],
    "cancelled": [
      "CNCL"
    ]
  },
  "periods": {
    "1": "1st",
    "2": "2nd",
    "3": "3rd",
    "OT": "OT",
    "SO": "Shootout"
  },
  "season": {
    "games": 82,
    "starterGames": 58,
    "playoffs": true
  },
  "day": {
    "tz": "America/New_York",
    "rollover": "06:00"
  },
  "lock": "game",
  "words": {
    "centre": "NHL centre",
    "start": "puck drop",
    "club": "club",
    "starter": "starting goalie",
    "game": "hockey",
    "rec": "beer-league",
    "room": "dressing room",
    "voice": "a loud, lovable Canadian beer-league dressing-room guy"
  }
};

// a game's state as one of the engine's five
export const stateOf = (sport: SportConfig, state: string) =>
  (Object.keys(sport.states) as (keyof SportConfig['states'])[]).find((k) => sport.states[k].includes(state)) ?? 'scheduled';
// a position's group (skater or goalie in hockey)
export const groupOf = (sport: SportConfig, pos: string) => sport.positions.find((p) => p.key === pos)?.group ?? sport.groups[0]?.key;
// a player plays a position: his own, or one he's eligible for within his group (a skater at a skater's spot)
export const plays = (sport: SportConfig, p: { pos: string; elig: string[] }, pos: string) =>
  p.pos === pos || (groupOf(sport, p.pos) === groupOf(sport, pos) && p.elig.includes(pos));
// the position keys, in the sport's order
export const positionKeys = (sport: SportConfig) => sport.positions.map((p) => p.key);

// Where a game stands, from its feed state: not started, under way, over, or called off (postponed or cancelled). A
// state the sport doesn't list counts as under way, as the pages always treated an unknown one.
export const isLive = (sport: SportConfig, state: string) => sport.states.live.includes(state);
export const isFinal = (sport: SportConfig, state: string) => sport.states.final.includes(state);
export const hasStarted = (sport: SportConfig, state: string) => isLive(sport, state) || isFinal(sport, state);
export const calledOff = (sport: SportConfig, state: string) => sport.states.postponed.includes(state) || sport.states.cancelled.includes(state);
export const notStarted = (sport: SportConfig, state: string) => sport.states.scheduled.includes(state);
// a numbered period is regulation; anything else (overtime, a shootout) is extra time
export const extraTime = (period: string | null | undefined) => !!period && !/^\d+$/.test(String(period));
// a period for a live clock: regulation in the sport's words ("2nd"), extra time as the feed names it ("OT", "SO")
export const periodShort = (sport: SportConfig, period: string | null | undefined) =>
  !period ? '' : extraTime(period) ? String(period) : sport.periods[String(period)] ?? String(period);
