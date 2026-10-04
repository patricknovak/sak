-- Garry's voice in the sport's own words (docs/EXPANSION.md, Phase 3: "his persona says hockey; it reads the sport's
-- vocabulary instead"). The NHL row gains the words his prompts used to write in: the game's name, the rec-league
-- adjective, the room the chirps come from, and his one-line character. With them, a league in another sport gets a
-- voice of its own and the NHL's prompts read exactly as before.

set client_min_messages = warning;

update public.sports
set config = jsonb_set(config, '{words}', coalesce(config->'words', '{}'::jsonb) || $words${
  "game": "hockey",
  "rec": "beer-league",
  "room": "dressing room",
  "voice": "a loud, lovable Canadian beer-league dressing-room guy"
}$words$::jsonb)
where id = 'nhl';
