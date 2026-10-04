-- The commissioner's log (docs/SUPERPOOLS.md section 7, item 12: an audit trail of every override). Every
-- commissioner power goes through _commish(), so that is where the log is written: when a commissioner function that
-- changes the league (moves a player, gives coins, rules a bet, settles a market, edits the rules, runs the draft...)
-- passes the check, a line goes into commish_log with who and when. One line per action: a function that calls
-- another commissioner function inside it (randomizing the order sets it) logs once, under the one the commissioner
-- pressed. Read-only commissioner pages (the account list, the health panel) log nothing.
--
-- Every member of the league reads its own league's log; nothing writes to it but _commish(). The site words each
-- action (src/lib/commishLog.ts).

set client_min_messages = warning;

create table if not exists public.commish_log (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  team_id int references public.teams (id) on delete set null,   -- the commissioner who acted
  action text not null,                                          -- the function, e.g. commish_move_player
  tx bigint not null default txid_current(),
  at timestamptz not null default now()
);
create index if not exists commish_log_league_at on public.commish_log (league_id, at desc);
create unique index if not exists commish_log_once_per_tx on public.commish_log (tx, team_id);
alter table public.commish_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.commish_log'::regclass and polname = 'read_league') then
    create policy read_league on public.commish_log for select to authenticated using (league_id = (select current_league_id()));
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.commish_log'::regclass and tgname = 'commish_log_stamp_league') then
    create trigger commish_log_stamp_league before insert on public.commish_log for each row execute function public._stamp_league();
  end if;
end $$;
revoke all on public.commish_log from anon, authenticated;
grant select on public.commish_log to authenticated;

-- the actions worth a line: the ones that change something GMs see
create or replace function public._commish_logged(p_fn text) returns boolean
language sql immutable as $$
  select p_fn = any (array[
    'commish_add_spectator', 'commish_bill_entries', 'commish_coins', 'commish_delete_line', 'commish_fund_entry',
    'commish_fund_price', 'commish_fund_settings', 'commish_market', 'commish_money_line', 'commish_move_player',
    'commish_post_payouts', 'commish_reset_password', 'commish_rule_bet', 'commish_set_brand', 'commish_set_cocommish',
    'commish_set_keeper', 'commish_set_keepers', 'commish_set_login_email', 'commish_set_pick_owner', 'commish_set_spectator',
    'commish_settle_bet', 'commish_settle_market', 'commish_settle_team', 'commish_update_league', 'commish_update_scoring',
    'commish_vacate_seat', 'draft_pause', 'draft_randomize_order', 'draft_reset', 'draft_resume', 'draft_set_order',
    'draft_start', 'draft_undo', 'finalize_keepers', 'rescore_all', 'review_trade', 'close_proposal', 'set_idea_status'])
$$;

-- the check every commissioner power starts with; it now also writes the log line for an action that changes the league
create or replace function public._commish() returns integer
language plpgsql security definer set search_path = public as $$
declare t int; ctx text; fn text;
begin
  select id into t from teams where id = my_team() and is_commish;
  if t is null then raise exception 'Commissioner only'; end if;
  -- the function that asked: the second PL/pgSQL frame on the call stack (the first is this one; a PERFORM puts a
  -- "SQL statement" line between them)
  get diagnostics ctx = pg_context;
  fn := (select m[1] from regexp_matches(ctx, 'PL/pgSQL function (?:public\.)?([a-z_0-9]+)\(', 'g') with ordinality x(m, n) where n = 2);
  if fn is not null and _commish_logged(fn) then
    insert into commish_log (league_id, team_id, action) values ((select league_id from teams where id = t), t, fn)
    on conflict (tx, team_id) do nothing;
  end if;
  return t;
end $$;
