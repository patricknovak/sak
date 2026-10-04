-- A league's own roster (docs/EXPANSION.md, Phase 2's gate: a friend's league set up without SQL). A new league took
-- SaK's slots (C 2, LW 2, RW 2, D 3, G 2, Util 1, bench 12, IR 2) with no way to change them; the commissioner now sets
-- them on the Commish page before the draft.
--
-- * commish_set_roster(roster, set_rounds): every slot at once, each within reason (a goalie at least, 5 to 25
--   starters, a bench of up to 20, up to 6 IR). Only before the draft order is drawn and while the league is in its
--   keepers, pre-draft or off-season phase: the draft's picks come from the rounds, and the lineups already set are
--   checked against the slots. With set_rounds (the default) the draft gets one round per roster spot left after the
--   keepers. On the commissioner's log.

set client_min_messages = warning;

create or replace function public.commish_set_roster(p_roster jsonb, p_set_rounds boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); r league_rules; st draft_state; k text; v int; total int; starters int; out jsonb := '{}';
        lim jsonb := '{"C": [0, 6], "LW": [0, 6], "RW": [0, 6], "D": [0, 8], "G": [1, 4], "Util": [0, 6], "BN": [0, 20], "IR": [0, 6]}';
begin
  perform _commish();
  select * into r from league_rules where league_id = lid;
  select * into st from draft_state where league_id = lid;
  if r.phase not in ('keepers', 'predraft', 'offseason') then raise exception 'The roster is set before the draft: it changes in the off-season'; end if;
  if st.status in ('live', 'paused') or st.order_set then raise exception 'Set the roster before the draft order is drawn'; end if;
  if jsonb_typeof(p_roster) <> 'object' then raise exception 'The roster is a count for every slot'; end if;
  for k in select jsonb_object_keys(lim) loop
    if not (p_roster ? k) or jsonb_typeof(p_roster->k) <> 'number' then raise exception 'The roster needs a count for %', k; end if;
    v := (p_roster->>k)::numeric;
    if v <> (p_roster->>k)::numeric or v < (lim->k->>0)::int or v > (lim->k->>1)::int then
      raise exception '% takes % to %', k, lim->k->>0, lim->k->>1;
    end if;
    out := out || jsonb_build_object(k, v);
  end loop;
  starters := (select sum(value::int) from jsonb_each_text(out) where key not in ('BN', 'IR'));
  total := starters + (out->>'BN')::int;
  if starters not between 5 and 25 then raise exception 'A lineup takes 5 to 25 starters'; end if;
  if total <= r.keepers then raise exception 'The roster has to be bigger than the % keepers', r.keepers; end if;
  update league_rules set roster = out,
    draft_rounds = case when p_set_rounds then total - keepers else draft_rounds end, updated_at = now()
  where league_id = lid;
  return out || jsonb_build_object('rounds', case when p_set_rounds then total - r.keepers else r.draft_rounds end);
end $$;
revoke execute on function public.commish_set_roster(jsonb, boolean) from public, anon;
grant execute on function public.commish_set_roster(jsonb, boolean) to authenticated;

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
    'commish_set_rules', 'commish_set_season', 'commish_delete_season', 'commish_set_roster'])
$$;
