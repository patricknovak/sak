-- A league's past, written in by its commissioner (docs/SUPERPOOLS.md section 7, step 5: a league that played for years
-- somewhere else arrives with its history). SaK's past came in with migration 89; until imports write a league's history
-- for it, the commissioner enters past seasons on the League page: each season's final table (place, team, GM, points,
-- prize, last place) and a line about it. The rafters, titles, last places and season-by-season list fill in from them.
--
-- * commish_set_season(season, note, rows): writes one season whole ("2019-20"; up to 30 rows, places 1.. in order,
--   one last place at most). Writing a season that exists replaces it.
-- * commish_delete_season(season): takes one out.
-- Both renumber the league's seasons in order (for SaK that leaves every number as it is) and are on the commissioner's
-- log. Neither touches the season being played: that one is written when it ends.

set client_min_messages = warning;

create or replace function public._renumber_seasons(p_league int) returns void
language sql security definer set search_path = public as $$
  update league_seasons s set sort = x.n
  from (select season, row_number() over (order by season) as n from league_seasons where league_id = p_league) x
  where s.league_id = p_league and s.season = x.season and s.sort is distinct from x.n
$$;
revoke execute on function public._renumber_seasons(int) from public, anon, authenticated;

create or replace function public.commish_set_season(p_season text, p_note text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); s text := btrim(coalesce(p_season, '')); r jsonb; n int := 0; cur text;
        y int; tid int; nm text; gm text;
begin
  perform _commish();
  if s !~ '^(19|20)\d{2}-\d{2}$' or right(s, 2)::int <> (left(s, 4)::int + 1) % 100 then raise exception 'A season is written like 2019-20'; end if;
  select season into cur from league_rules where league_id = lid;
  if s >= cur then raise exception 'Only past seasons: % is written when it ends', cur; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 2 or jsonb_array_length(p_rows) > 30 then
    raise exception 'A season''s table has 2 to 30 teams';
  end if;
  if (select count(*) filter (where (x->>'last_place')::boolean) from jsonb_array_elements(p_rows) x) > 1 then
    raise exception 'One last place a season';
  end if;
  delete from season_results where league_id = lid and season = s;
  insert into league_seasons (league_id, season, note, sort) values (lid, s, nullif(left(btrim(coalesce(p_note, '')), 400), ''), 0)
  on conflict (league_id, season) do update set note = excluded.note;
  for r in select value from jsonb_array_elements(p_rows) loop
    n := n + 1;
    nm := left(btrim(coalesce(r->>'team_name', '')), 60);
    gm := left(btrim(coalesce(r->>'gm_name', '')), 40);
    if nm = '' or gm = '' then raise exception 'Row %: every place needs a team and a GM', n; end if;
    -- a franchise still in the league is linked to its team, so its banners follow it
    tid := (select id from teams where league_id = lid and id = nullif(r->>'team_id', '')::int);
    insert into season_results (league_id, season, place, team_name, gm_name, team_id, points, prize, last_place)
    values (lid, s, n, nm, gm, tid, nullif(r->>'points', '')::numeric, nullif(r->>'prize', '')::numeric, coalesce((r->>'last_place')::boolean, false));
  end loop;
  perform _renumber_seasons(lid);
  return n;
end $$;
revoke execute on function public.commish_set_season(text, text, jsonb) from public, anon;
grant execute on function public.commish_set_season(text, text, jsonb) to authenticated;

create or replace function public.commish_delete_season(p_season text) returns boolean
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id();
begin
  perform _commish();
  delete from season_results where league_id = lid and season = btrim(coalesce(p_season, ''));
  delete from league_seasons where league_id = lid and season = btrim(coalesce(p_season, ''));
  if not found then return false; end if;
  perform _renumber_seasons(lid);
  return true;
end $$;
revoke execute on function public.commish_delete_season(text) from public, anon;
grant execute on function public.commish_delete_season(text) to authenticated;

-- both go on the commissioner's log
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status',
    'commish_set_rules', 'commish_set_season', 'commish_delete_season'])
$$;
