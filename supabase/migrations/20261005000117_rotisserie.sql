-- Rotisserie (docs/SUPERPOOLS.md section 7, item 8: category and rotisserie scoring). A league can play for categories
-- instead of points: each team's season totals in the categories its commissioner picks, counted from the players it
-- started (the same rule as points: never the bench or IR, from the season's start), ranked team against team in
-- every category; first in a category earns as many points as there are teams, last earns one, ties share. The most
-- points wins. A points league (SaK) is untouched: league_rules.categories stays null.
--
-- * _category_catalogue(): the categories on offer, with which way is good. Goalies have no minutes in the box
--   scores, so the goals-against rate is per start (GA/GS), named so.
-- * category_standings(): the table for the caller's league: every team, every category's value and points.
-- * commish_set_categories(keys): 3 to 12 categories, or none to go back to points. On the commissioner's log.
-- The points each player scores still come from the league's scoring profile: projections, rankings and the
-- draft board keep working in a rotisserie league.

set client_min_messages = warning;

alter table public.league_rules add column if not exists categories text[];

-- the caller's league, now with its categories (columns as before, categories added at the end)
create or replace view public.league with (security_invoker = true) as
  select id, name, short_name, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds, draft_rounds,
    snake, season_start, season_end, trade_deadline, trade_review_hours, max_acquisitions, extra_acq_fee, entry_fee, sak_fee,
    prize_split, roster, scoring, commish_note, info, updated_at, playoff_share, playoffs_end, cup_share, playoff_bonus_acq,
    league_id, features, categories
  from league_rules where league_id = current_league_id();

create or replace function public._category_catalogue() returns jsonb
language sql immutable as $$
  select '[
    {"key": "g", "label": "Goals"}, {"key": "a", "label": "Assists"}, {"key": "pts", "label": "Points"},
    {"key": "pm", "label": "Plus/minus"}, {"key": "pim", "label": "Penalty minutes"}, {"key": "ppp", "label": "Power-play points"},
    {"key": "ppg", "label": "Power-play goals"}, {"key": "shp", "label": "Shorthanded points"}, {"key": "gwg", "label": "Game-winning goals"},
    {"key": "sog", "label": "Shots on goal"}, {"key": "hit", "label": "Hits"}, {"key": "blk", "label": "Blocks"},
    {"key": "w", "label": "Wins"}, {"key": "sho", "label": "Shutouts"}, {"key": "sv", "label": "Saves"},
    {"key": "gaa", "label": "Goals against per start", "low": true, "num": "ga", "den": "gs"},
    {"key": "svp", "label": "Save percentage", "num": "sv", "den": "sa"}
  ]'::jsonb
$$;

create or replace function public.category_standings()
returns table (team_id int, total numeric, rank int, cats jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select r.categories, r.season_start, r.phase from league_rules r where r.league_id = current_league_id()
  ), cat as (
    select c.value as def, c.value->>'key' as key, coalesce((c.value->>'low')::boolean, false) as low
    from cfg, jsonb_array_elements(_category_catalogue()) c where c.value->>'key' = any (cfg.categories)
  ), tm as (
    select t.id from teams t where t.league_id = current_league_id() and t.role = 'gm'
  ), started as (
    select s.team_id, pg.stats
    from lineup_snapshots s
    join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id
    join games g on g.id = s.game_id
    cross join cfg
    where s.league_id = current_league_id() and s.slot not in ('BN', 'IR') and g.game_type = 2
      and s.date >= coalesce(cfg.season_start, s.date) and cfg.phase in ('season', 'offseason')
  ), sums as (
    select st.team_id, e.key, sum(e.value::numeric) as v from started st, jsonb_each_text(st.stats) e group by 1, 2
  ), val as (
    select tm.id as team_id, cat.key, cat.low,
      case when cat.def ? 'num'
        then round((select v from sums where sums.team_id = tm.id and sums.key = cat.def->>'num')
                   / nullif((select v from sums where sums.team_id = tm.id and sums.key = cat.def->>'den'), 0), 3)
        else coalesce((select v from sums where sums.team_id = tm.id and sums.key = cat.key), 0) end as value
    from tm cross join cat
  ), ranked as (
    -- first earns as many points as there are teams, last earns one, ties share the places they cover; a rate with no
    -- games behind it (no starts yet) is last
    select v.*, (select count(*) from tm) + 1
      - (rank() over (partition by v.key order by case when v.low then v.value end asc nulls last, case when not v.low then v.value end desc nulls last)
         + (count(*) over (partition by v.key, v.value) - 1) / 2.0) as pts
    from val v
  ), per as (
    select team_id, sum(pts) as total, jsonb_object_agg(key, jsonb_build_object('value', value, 'pts', pts)) as cats
    from ranked group by team_id
  )
  select per.team_id, per.total, (rank() over (order by per.total desc))::int, per.cats from per
$$;
revoke execute on function public.category_standings() from public, anon;
grant execute on function public.category_standings() to authenticated, service_role;

create or replace function public.commish_set_categories(p_keys text[]) returns text[]
language plpgsql security definer set search_path = public as $$
declare keys text[] := (select array_agg(distinct k) from unnest(coalesce(p_keys, '{}')) k where btrim(k) <> '');
begin
  perform _commish();
  if keys is null then
    update league_rules set categories = null, updated_at = now() where league_id = current_league_id();
    return null;
  end if;
  if exists (select 1 from unnest(keys) k where not exists (select 1 from jsonb_array_elements(_category_catalogue()) c where c->>'key' = k)) then
    raise exception 'Pick categories from the list';
  end if;
  if cardinality(keys) not between 3 and 12 then raise exception 'A rotisserie league plays 3 to 12 categories'; end if;
  -- kept in the catalogue's order, so every page lists them the same way
  keys := (select array_agg(c->>'key' order by o) from jsonb_array_elements(_category_catalogue()) with ordinality x(c, o) where c->>'key' = any (keys));
  update league_rules set categories = keys, updated_at = now() where league_id = current_league_id();
  return keys;
end $$;
revoke execute on function public.commish_set_categories(text[]) from public, anon;
grant execute on function public.commish_set_categories(text[]) to authenticated;

-- on the commissioner's log with the rest
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
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster', 'commish_set_categories'])
$$;
