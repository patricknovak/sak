-- Tenancy guards: the first fixes from the expansion review (docs/EXPANSION.md, "Fixed now").
-- Today SaK is the only league, so none of this changes what anyone sees. Each fix closes a door that would open
-- the day a second league (or a stranger's account) exists.

-- 1. A signed-in person with no membership belongs to no league. Until now they fell through to league 1 and
--    could read SaK under every league-bound policy. Requests with no user at all (the scheduler, the service
--    role) still land on league 1 until the scheduler names a league.
create or replace function public.current_league_id() returns int
language sql stable security definer set search_path = public as $$
  with hdr as (
    select nullif(current_setting('request.headers', true), '')::json ->> 'x-league' as v
  )
  select coalesce(
    nullif(current_setting('app.league_id', true), '')::int,
    (select m.league_id from hdr, league_members m
      where hdr.v ~ '^\d+$' and m.user_id = auth.uid() and m.league_id = hdr.v::int),
    (select a.active_league_id from accounts a join league_members m on m.user_id = a.user_id and m.league_id = a.active_league_id
      where a.user_id = auth.uid()),
    (select min(league_id) from league_members where user_id = auth.uid()),
    case when auth.uid() is null then 1 end)
$$;

-- 2. One check for every function that takes an id from the caller: the row it names must be in the caller's
--    league. Security-definer functions skip row-level security, so without this a commissioner in one league
--    could hand out coins, settle bets or reset a password in another.
create or replace function public._in_league(p_table text, p_id bigint, p_col text default 'id') returns void
language plpgsql stable security definer set search_path = public as $$
declare lid int;
begin
  execute format('select league_id from public.%I where %I = $1 limit 1', p_table, p_col) into lid using p_id;
  if lid is not null and lid is distinct from current_league_id() then
    raise exception 'That belongs to another league';
  end if;
end $$;
revoke execute on function public._in_league(text, bigint, text) from public, anon, authenticated;

-- the guard goes in as the first statement of each function, after its own "begin"; a function that already has
-- one is left alone, so this can run twice
do $$
declare
  r record; f oid; def text; tail text; i int; k int;
begin
  for r in select * from (values
    ('commish_coins',          'perform public._in_league(''teams'', p_team);'),
    ('commish_ledger',         'perform public._in_league(''teams'', p_team);'),
    ('commish_money_line',     'perform public._in_league(''teams'', p_team);'),
    ('commish_reset_password', 'perform public._in_league(''teams'', p_team);'),
    ('commish_set_keepers',    'perform public._in_league(''teams'', p_team);'),
    ('commish_set_spectator',  'perform public._in_league(''teams'', p_team);'),
    ('commish_settle_team',    'perform public._in_league(''teams'', p_team);'),
    ('commish_move_player',    'perform public._in_league(''teams'', p_team); perform public._in_league(''rosters'', p_player, ''player_id'');'),
    ('commish_set_keeper',     'perform public._in_league(''rosters'', p_player, ''player_id'');'),
    ('commish_set_pick_owner', 'perform public._in_league(''draft_picks'', p_pick); perform public._in_league(''teams'', p_team);'),
    ('commish_settle_bet',     'perform public._in_league(''bets'', p_bet);'),
    ('commish_rule_bet',       'perform public._in_league(''bets'', p_bet);'),
    ('respond_bet',            'perform public._in_league(''bets'', p_bet);'),
    ('join_pool',              'perform public._in_league(''bets'', p_bet);'),
    ('commish_settle_market',  'perform public._in_league(''markets'', p_market);'),
    ('place_market_bet',       'perform public._in_league(''markets'', p_market);'),
    ('review_trade',           'perform public._in_league(''trades'', p_trade);'),
    ('commish_delete_line',    'perform public._in_league(''ledger'', p_id);'),
    ('commish_mark_paid',      'perform public._in_league(''ledger'', p_id);'),
    ('close_proposal',         'perform public._in_league(''proposals'', p_id);'),
    ('set_idea_status',        'perform public._in_league(''feature_ideas'', p_id);'),
    ('garry_forget',           'perform public._in_league(''garry_memory'', p_id);'),
    ('propose_trade',          'perform public._in_league(''teams'', p_to);')
  ) v(fn, guard) loop
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = r.fn loop
      def := pg_get_functiondef(f);
      continue when position('_in_league(' in def) > 0;
      i := strpos(def, '$function$');
      tail := substr(def, i);
      k := regexp_instr(tail, '\mbegin\M', 1, 1, 1, 'i');
      if i = 0 or k = 0 then raise exception 'no body to guard in %', r.fn; end if;
      execute left(def, i - 1) || left(tail, k - 1) || E'\n  ' || r.guard || substr(tail, k);
    end loop;
  end loop;
end $$;

-- 3. Notices the site posts itself (a pick, a trade, a settled bet) go to the league the request came from,
--    not to SaK by default.
create or replace function public._sys(p_channel text, p_body text, p_meta jsonb default null) returns void
language sql security definer set search_path = public as $$
  insert into messages (channel, kind, body, meta, league_id) values (p_channel, 'system', p_body, p_meta, coalesce(current_league_id(), 1));
$$;

-- 4. An @mention pings only the GMs of the league it was written in, and the bot answers to the name its league
--    gave it (Garry in SaK).
create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; bot text;
begin
  if new.kind <> 'user' then return new; end if;
  for t in select id, gm_name from teams where league_id = new.league_id and id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), '/chat?c=' || new.channel);
  end loop;
  select regexp_replace(coalesce(nullif(brand -> 'bot' ->> 'name', ''), 'Garry'), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
    into bot from leagues where id = new.league_id;
  if new.channel like 'garry:%' or (new.channel not like 'dm:%' and new.body ~* ('\m' || coalesce(bot, 'garry') || '\M')) then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=reply',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
revoke execute on function public._mention_notify() from public, anon, authenticated;

-- 5. The platform's admin key. The public (anon) key is in the site's bundle, so it can't be what lets someone
--    run Garry's commissioner tasks (the keeper report, memory passes, the league column, probes). The key lives
--    in a schema the API doesn't serve; the edge functions check a caller's key through admin_key_ok, which only
--    the service role may call.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.app_keys (name text primary key, value text not null, created_at timestamptz not null default now());
revoke all on private.app_keys from public, anon, authenticated;
insert into private.app_keys (name, value) values ('admin', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;
create or replace function public.admin_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(length(p_key) >= 32, false) and exists (select 1 from private.app_keys where name = 'admin' and value = p_key)
$$;
revoke execute on function public.admin_key_ok(text) from public, anon, authenticated;
grant execute on function public.admin_key_ok(text) to service_role;

-- 6. Paying out a Book market is the settlement job's work, never a caller's: the function was left open to the
--    public key, so anyone could have settled any market their way (the payout log shows nobody did).
revoke execute on function public._payout_market(bigint, text) from public, anon, authenticated;
