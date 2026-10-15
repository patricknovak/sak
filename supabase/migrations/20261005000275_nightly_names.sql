-- The start page listed the NHL twice as "NHL 2026-27": the box pool on nhl-sync's games and the season's games in
-- weeks (migration 274). The games are named for what they are, so a host tells the two apart.
update public.competitions set name = 'NHL 2026-27 games' where id = 'nhl-2026-27' and name = 'NHL 2026-27';
