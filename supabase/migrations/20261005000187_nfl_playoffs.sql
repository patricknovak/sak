-- The NFL's playoffs as a postseason in series (docs/DEVELOPMENT.md §6 item 7): the bracket (migration 185) runs on
-- series, and the NFL plays single games, so soccer-sync files each playoff game as a best-of-1 series in a competition
-- of its own (the season's competition keeps its weeks for pick'em and last one standing). Each round's AFC games come
-- before its NFC games, so from the Divisional round the rounds halve to the Super Bowl and the bracket can start there;
-- the Wild Card round can't be in it, since the NFL reseeds after it.
--
-- * `competitions.format`: 'rounds' (a season played in rounds: soccer, the NFL's weeks) or 'series' (a postseason:
--   MLB's from mlb-sync, the NFL's from soccer-sync). The centres for rounds list only the first kind.
-- * The NFL's 2026 playoffs (January and February 2027), active now, filled once ESPN names the teams.

alter table public.competitions add column if not exists format text not null default 'rounds';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'competitions_format_check') then
    alter table public.competitions add constraint competitions_format_check check (format in ('rounds', 'series'));
  end if;
end $$;
update public.competitions c set format = 'series' where format = 'rounds' and exists (select 1 from series s where s.competition = c.id);

insert into public.competitions (id, sport, name, short, country, tz, season, provider, ext_id, ext_season, active, sort, format)
values ('nfl-post-2026', 'nfl', 'NFL Playoffs', 'NFL', 'USA', 'America/New_York', '2026', 'espn', 'football/nfl', '2026', true, 6, 'series')
on conflict (id) do nothing;
