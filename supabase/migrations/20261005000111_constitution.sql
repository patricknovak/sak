-- The league's constitution (docs/SUPERPOOLS.md section 7, item 12): the rules in the league's own words, written and
-- kept by its commissioner. SaK's sections came over with its history (migration 89, league_rule_text); a new league
-- starts with none and writes its own on the League page. The rules that are settings (roster, keepers, the draft,
-- trades, pickups, money) are shown from the settings themselves, so the words never have to repeat them.
--
-- * commish_set_rules(sections): the whole set at once, [{title, items: [..]}] in order. Up to 20 sections of up to
--   30 rules, each trimmed; empty lines and sections are dropped. It replaces the league's sections and is on the
--   commissioner's log.

set client_min_messages = warning;

create or replace function public.commish_set_rules(p_sections jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); s jsonb; n int := 0; t text; items text[];
begin
  perform _commish();
  if jsonb_typeof(coalesce(p_sections, '[]'::jsonb)) <> 'array' then raise exception 'The rules are a list of sections'; end if;
  if jsonb_array_length(coalesce(p_sections, '[]'::jsonb)) > 20 then raise exception 'Up to 20 sections'; end if;
  delete from league_rule_text where league_id = lid;
  for s in select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
    t := left(btrim(coalesce(s->>'title', '')), 60);
    select coalesce(array_agg(left(btrim(x), 400) order by o), '{}') into items
    from jsonb_array_elements_text(case when jsonb_typeof(s->'items') = 'array' then s->'items' else '[]'::jsonb end) with ordinality e(x, o)
    where btrim(x) <> '';
    if t = '' and cardinality(items) = 0 then continue; end if;
    if t = '' then raise exception 'Every section needs a title'; end if;
    if cardinality(items) > 30 then raise exception 'Up to 30 rules in a section'; end if;
    if exists (select 1 from league_rule_text where league_id = lid and title = t) then raise exception 'Two sections are called %', t; end if;
    n := n + 1;
    insert into league_rule_text (league_id, title, items, sort) values (lid, t, items, n);
  end loop;
  return n;
end $$;
revoke execute on function public.commish_set_rules(jsonb) from public, anon;
grant execute on function public.commish_set_rules(jsonb) to authenticated;

-- the rules change goes on the commissioner's log with the rest
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
    'commish_set_rules'])
$$;
