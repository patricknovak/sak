-- deterministic tie-break so the keepers screen and the server always ban the same player
create or replace function public.top_scorer(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select player_id from rosters where team_id = p_team and prev_fp is not null order by prev_fp desc, player_id limit 1
$$;
