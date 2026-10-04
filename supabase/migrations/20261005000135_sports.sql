-- The sport pulled out of the engine, step 1 (docs/EXPANSION.md section 6, Phase 3): a `sports` table whose row
-- carries what the engine now hard-codes for hockey, so the code can read it instead, one place at a time (expand,
-- then contract). The NHL is its one row and nothing about SaK changes.
--
-- * sports: one row per sport, readable by anyone (it's the game's description, nothing private). config holds the
--   positions and their groups, the lineup slots and who each accepts, the bench and injured codes, the stat
--   vocabulary (labels, groups, the ones where fewer is better), game states as the engine's five (scheduled, live,
--   final, postponed, cancelled), period labels, the season's shape, the day boundary (Eastern, the league day rolling
--   at 6 am) and the lock rule (each player at his own game's start).
-- * leagues.sport now names a row of it.
-- The site carries the same NHL description compiled in (src/lib/sport.ts); supabase/tests/sport.test.mjs fails if
-- the two drift apart.

set client_min_messages = warning;

create table if not exists public.sports (
  id text primary key,
  name text not null,
  config jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.sports enable row level security;
drop policy if exists sports_read on public.sports;
create policy sports_read on public.sports for select using (true);
grant select on public.sports to anon, authenticated, service_role;

insert into public.sports (id, name, config) values ('nhl', 'NHL hockey', $sport${
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
    "starter": "starting goalie"
  }
}$sport$::jsonb)
on conflict (id) do update set name = excluded.name, config = excluded.config;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leagues_sport_fkey') then
    alter table public.leagues add constraint leagues_sport_fkey foreign key (sport) references public.sports (id);
  end if;
end $$;
