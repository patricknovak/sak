-- A league that played elsewhere brings its rosters with it (docs/SUPERPOOLS.md item 9, imports: rosters next). The
-- site reads them from the other site's own API (Fantrax's public one first, the way its history and scoring come in)
-- and matches each player to ours by name and club; this writes what matched. Each team named is replaced whole, so
-- the import can be run again after a fix, and a team not named keeps what it has. Everyone lands on the bench (an IR
-- flag keeps a player on IR): the other site's lineup slots don't map onto ours, and the GM's first lineup, or the
-- auto-lineup, sorts the starters. The roster here has to hold them: a team with more players than the league's roster
-- is refused by name, so the commissioner raises the roster or leaves some out before anything is written.
create or replace function public.commish_import_rosters(p_teams jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); st draft_state; t jsonb; p jsonb; tid int; pid int; slot text; mx int;
        n int; teams_done int := 0; players_done int := 0; tname text; dup text;
begin
  perform _commish();
  if (select kind from leagues where id = lid) = 'predict' then raise exception 'A prediction pool has no rosters'; end if;
  select * into st from draft_state where league_id = lid;
  if st.status in ('live', 'paused') then raise exception 'Not while the draft is on'; end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) = 0 then raise exception 'Nothing to bring in'; end if;
  mx := _roster_max();
  -- every team named is one of ours, and no player is named for two of them
  for t in select * from jsonb_array_elements(p_teams) loop
    tid := (t->>'team_id')::int;
    if not exists (select 1 from teams where id = tid and league_id = lid and role = 'gm') then raise exception 'Team % is not in this league', tid; end if;
    if jsonb_typeof(t->'players') <> 'array' then raise exception 'Each team is a list of players'; end if;
    n := (select count(*) from jsonb_array_elements(t->'players') x where coalesce(x->>'slot', 'BN') <> 'IR');
    if n > mx then
      select name into tname from teams where id = tid;
      raise exception '% has % players and the roster here holds %: raise the roster or leave some out', tname, n, mx;
    end if;
  end loop;
  select string_agg(distinct pl.name, ', ') into dup from (
    select (xx->>'player_id')::int as pid from jsonb_array_elements(p_teams) tt, jsonb_array_elements(tt->'players') xx
    group by 1 having count(*) > 1) d join players pl on pl.id = d.pid;
  if dup is not null then raise exception '% named for two teams', dup; end if;
  -- a player on a team not named here stays theirs
  select string_agg(distinct pl.name || ' (' || tm.name || ')', ', ') into dup
    from jsonb_array_elements(p_teams) tt, jsonb_array_elements(tt->'players') xx
    join rosters r on r.player_id = (xx->>'player_id')::int and r.league_id = lid
    join teams tm on tm.id = r.team_id join players pl on pl.id = r.player_id
    where r.team_id not in (select (yy->>'team_id')::int from jsonb_array_elements(p_teams) yy);
  if dup is not null then raise exception 'Already on a team not in this import: %', dup; end if;
  for t in select * from jsonb_array_elements(p_teams) loop
    tid := (t->>'team_id')::int;
    delete from rosters where league_id = lid and team_id = tid;
    for p in select * from jsonb_array_elements(t->'players') loop
      pid := (p->>'player_id')::int;
      if not exists (select 1 from players where id = pid) then raise exception 'Unknown player %', pid; end if;
      slot := case when p->>'slot' = 'IR' then 'IR' else 'BN' end;
      insert into rosters (league_id, player_id, team_id, slot, acquired, acquired_at) values (lid, pid, tid, slot, 'import', now());
      players_done := players_done + 1;
    end loop;
    teams_done := teams_done + 1;
  end loop;
  return jsonb_build_object('teams', teams_done, 'players', players_done);
end $$;
revoke execute on function public.commish_import_rosters(jsonb) from public, anon;
grant execute on function public.commish_import_rosters(jsonb) to authenticated;

-- on the commissioner's log with the rest
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable set search_path = public as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status',
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster', 'commish_set_categories', 'commish_set_format', 'commish_make_schedule',
    'pool_game_start', 'pool_set_crown', 'pool_game_set_rules', 'pool_host_pick', 'pool_result_set', 'survivor_start', 'survivor_host_pick',
    'pool_fixture_result_set', 'commish_import_rosters'])
$$;
