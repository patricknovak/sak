-- The commissioner can enter a GM's keepers for them (a GM whose phone or browser won't cooperate before the
-- deadline tells the commish his six). Same rules as set_keepers: only that team's players, at most the league
-- limit, never the team's top scorer; the GM can still change them himself until keepers are finalized.
create or replace function public.commish_set_keepers(p_team int, p_players int[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  l league;
  n int := coalesce(array_length(p_players, 1), 0);
begin
  perform _commish();
  select * into l from league;
  if l.phase <> 'keepers' then raise exception 'Keeper selection is closed'; end if;
  if not exists (select 1 from teams where id = p_team and role = 'gm') then raise exception 'Not a GM team'; end if;
  if n > l.keepers then raise exception 'You can keep at most % players', l.keepers; end if;
  if exists (select 1 from unnest(p_players) x where not exists (select 1 from rosters where player_id = x and team_id = p_team)) then
    raise exception 'Only players on that team''s roster can be kept';
  end if;
  if l.top_scorer_rule and top_scorer(p_team) = any (p_players) then
    raise exception '% was that team''s top scorer last season and goes back in the draft pool', _pname(top_scorer(p_team));
  end if;
  update rosters set keeper = (player_id = any (p_players)) where team_id = p_team;
  update teams set keepers_submitted = n > 0 where id = p_team;
  if n > 0 then
    perform _sys('general', format('🔒 %s locked in %s keeper%s (entered by the commish).', _tname(p_team), n, case when n = 1 then '' else 's' end));
    perform _notify(p_team, 'draft', format('🔒 The commish entered your %s keepers for you. Check them on the Keepers page.', n), '/keepers');
  end if;
end $$;
revoke execute on function public.commish_set_keepers(int, int[]) from public, anon;
grant execute on function public.commish_set_keepers(int, int[]) to authenticated;
