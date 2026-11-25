-- Deleting your own account, from the app (25 November 2026; the privacy page has promised it by email since
-- 28 October, Quebec's Law 25 and PIPEDA want it to be easy).
--
-- The rule, in plain words:
-- * Your sign-in goes: the email, the password, your alerts, your Yahoo link, your fan zone voice, the waitlist entry
--   on that email, and what Garry remembers about you.
-- * What you wrote goes: your chat posts and photos in every league and pool, your lounge and fan zone posts, your
--   comments on ideas, your fan zone calls, votes and reports.
-- * A fantasy league seat stays in the league, empty: the team keeps its roster, its points, its trades and its
--   history, so nobody else's standings move, and the commissioner can invite a new GM to it. Your name comes off
--   the team (and off its past seasons); a team that was named after you becomes "Team <its seat number>".
-- * A pool seat stays in the pool as "Former member": its calls, picks and coins still count, so the table and every
--   market add up for everyone else, but nobody can tell it was you.
-- * A pool or league you host passes to another member: a co-host if there is one, otherwise the member who joined
--   first. One with nobody else in it is deleted, everything in it, as if you had deleted it yourself. The SaK
--   Superleague is never deleted.
-- * The league's own records stay with the team, not with you: trades, roster moves, bets, polls and proposals.
-- * A platform admin's account can't be deleted from the app (take the admin role off first).
--
-- account_delete_preview() says all this for one account, league by league, for the Profile page's sheet.
-- account_delete('delete') does the database part as the signed-in person and answers the chat photo folders to
-- clear; the join function's `delete_account` door calls it with the person's own session, clears the photos through
-- the Storage API (SQL can't) and removes the sign-in with Auth's admin API last, so a failure part way can be tried
-- again and finishes the job.
--
-- Safe to run twice.

set client_min_messages = warning;

-- ───────────── what happens to each seat ─────────────
-- one row per seat the account holds: what becomes of the seat, and of the league when they host it
create or replace function public._account_delete_plan(p_user uuid)
returns table (league_id int, league_name text, kind text, team_id int, team_name text, role text, hosts boolean,
               outcome text, successor_team int, successor_name text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select t.id, t.league_id, t.name, t.role, l.name as league_name, coalesce(l.kind, 'fantasy') as kind,
           (t.is_commish or l.owner_user = p_user) as hosts
    from teams t join leagues l on l.id = t.league_id
    where t.user_id = p_user
  ), heir as (
    -- who takes the league over: a co-host first, then whoever joined first
    select distinct on (m.league_id) m.league_id, o.id, o.gm_name, o.is_commish
    from mine m join teams o on o.league_id = m.league_id and o.user_id is not null and o.user_id <> p_user and o.role = 'gm'
    left join league_members lm on lm.team_id = o.id
    order by m.league_id, o.is_commish desc, lm.joined_at nulls last, o.id
  )
  select m.league_id, m.league_name, m.kind, m.id, m.name, m.role, m.hosts,
    case
      when m.league_id <> 1 and h.id is null and m.hosts then 'league_deleted'
      when m.hosts and h.id is not null and not h.is_commish then 'host_passes'
      when m.role = 'spectator' then 'spectator_leaves'
      when m.kind = 'predict' then 'former_member'
      else 'seat_open'
    end,
    case when m.hosts then h.id end, case when m.hosts then h.gm_name end
  from mine m left join heir h on h.league_id = m.league_id
  order by m.league_id
$$;
revoke execute on function public._account_delete_plan(uuid) from public, anon, authenticated;

create or replace function public.account_delete_preview() returns jsonb
language plpgsql stable security definer set search_path = public, ops as $$
declare me uuid := auth.uid(); em text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select email into em from auth.users where id = me;
  return jsonb_build_object(
    'email', case when em ilike '%@guest.superpoolsai.com' then null else em end,
    'admin', exists (select 1 from ops.platform_admins where user_id = me),
    'seats', coalesce((select jsonb_agg(jsonb_build_object('league_id', p.league_id, 'league', p.league_name, 'kind', p.kind,
               'team', p.team_name, 'role', p.role, 'hosts', p.hosts, 'outcome', p.outcome, 'successor', p.successor_name)
             order by p.league_id) from _account_delete_plan(me) p), '[]'::jsonb),
    'posts', (select count(*) from messages where team_id in (select id from teams where user_id = me) and kind = 'user'));
end $$;
revoke execute on function public.account_delete_preview() from public, anon;
grant execute on function public.account_delete_preview() to authenticated;

-- ───────────── a league with nobody left in it ─────────────
-- the same clearing pool_delete does (every table with a league_id, children first), without its host and name checks:
-- only account_delete calls it, for a league whose only member is leaving
create or replace function public._league_wipe(p_league int) returns int
language plpgsql security definer set search_path = public, ops as $$
declare t record; n int; total int := 0; stuck text[] := '{}';
begin
  if p_league = 1 then raise exception 'The SaK Superleague stays as it is'; end if;
  update ops.league_requests set league_id = null where league_id = p_league;
  update accounts a set active_league_id = (select m.league_id from league_members m
    where m.user_id = a.user_id and m.league_id <> p_league order by m.joined_at desc nulls last limit 1), updated_at = now()
  where a.active_league_id = p_league;
  for i in 1..15 loop
    stuck := '{}';
    for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
             join pg_attribute a on a.attrelid = c.oid and a.attname = 'league_id' and not a.attisdropped
             where s.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'leagues' order by c.relname loop
      begin
        execute format('delete from public.%I where league_id = $1', t.relname) using p_league;
        get diagnostics n = row_count;
        total := total + n;
      exception when foreign_key_violation then stuck := stuck || t.relname::text;
      end;
    end loop;
    exit when cardinality(stuck) = 0;
  end loop;
  if cardinality(stuck) > 0 then raise exception 'Could not clear %', array_to_string(stuck, ', '); end if;
  delete from leagues where id = p_league;
  return total;
end $$;
revoke execute on function public._league_wipe(int) from public, anon, authenticated;

-- ───────────── the deletion ─────────────
create or replace function public.account_delete(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, ops, private as $$
declare
  me uuid := auth.uid(); em text; p record; t teams; folders text[] := '{}'; heir teams; nm text; ab text; seat int;
  seats int := 0; wiped int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'delete' then raise exception 'Type DELETE to confirm'; end if;
  if exists (select 1 from ops.platform_admins where user_id = me) then
    raise exception 'A platform admin''s account can''t be deleted here. Take the admin role off first';
  end if;
  select lower(email) into em from auth.users where id = me;

  for p in select * from _account_delete_plan(me) loop
    seats := seats + 1;
    select * into t from teams where id = p.team_id;
    -- the chat photos live under <league>/<team>/ in storage; the join function clears them
    folders := folders || (p.league_id || '/' || p.team_id);

    if p.outcome = 'league_deleted' then
      folders := folders || p.league_id::text;
      perform _league_wipe(p.league_id);
      wiped := wiped + 1;
      continue;
    end if;

    -- what they wrote
    delete from messages where team_id = t.id and kind = 'user';
    delete from feature_comments where team_id = t.id;
    -- what is only theirs: alerts, the bell, what Garry remembers, Yahoo, their lists
    delete from push_subscriptions where team_id = t.id;
    delete from notifications where team_id = t.id;
    delete from chat_reads where team_id = t.id;
    delete from garry_memory where team_id = t.id;
    delete from yahoo_accounts where team_id = t.id;
    delete from watchlist where team_id = t.id;
    delete from draft_queue where team_id = t.id;
    update trade_block set offer_note = null where team_id = t.id and offer_note is not null;

    -- the league passes on before the seat empties
    if p.hosts then
      if p.successor_team is not null then
        select * into heir from teams where id = p.successor_team;
        update teams set is_commish = true where id = heir.id and not is_commish;
        update leagues set owner_user = heir.user_id where id = p.league_id and owner_user = me;
        if p.outcome = 'host_passes' then
          insert into notifications (league_id, team_id, kind, body, link)
          values (p.league_id, heir.id, 'commish', format('👑 %s is yours to run now: %s closed their account.', p.league_name, coalesce(t.gm_name, 'the host')),
                  case when p.kind = 'predict' then '#/' else '#/commish' end);
          insert into messages (channel, kind, body, league_id)
          values ('general', 'system', format('👑 %s runs %s from here.', coalesce(heir.gm_name, heir.name), p.league_name), p.league_id);
        end if;
      else
        -- the SaK Superleague with nobody else in it: it stays, its owner cleared
        update leagues set owner_user = null where id = p.league_id and owner_user = me;
      end if;
    end if;

    if p.outcome = 'spectator_leaves' then
      update teams set user_id = null, login_email = null, gm_name = 'Former spectator', name = 'Former spectator', is_commish = false where id = t.id;
      begin
        delete from teams where id = t.id;
      exception when foreign_key_violation then null;  -- reacted or voted: the row stays, nameless
      end;
    elsif p.kind = 'predict' then
      -- the seat stays in the table so every market and the pool's table still add up
      update teams set user_id = null, login_email = null, name = 'Former member', gm_name = 'Former member', abbrev = 'FMR',
        emoji = '👤', motto = null, is_commish = false where id = t.id;
    else
      -- a fantasy seat waits for its next GM; a team named after them loses the name
      seat := (select count(*) from teams s where s.league_id = t.league_id and s.role = 'gm' and s.id <= t.id);
      if t.gm_name is not null and length(btrim(t.gm_name)) >= 2 and position(lower(btrim(t.gm_name)) in lower(t.name)) > 0 then
        nm := 'Team ' || seat; ab := 'T' || lpad(seat::text, 2, '0');
      else
        nm := t.name; ab := t.abbrev;
      end if;
      update season_results set gm_name = 'Former GM' where team_id = t.id and lower(gm_name) = lower(t.gm_name);
      update season_results set team_name = nm where team_id = t.id and team_name = t.name and nm <> t.name;
      update teams set user_id = null, login_email = null, gm_name = 'Open seat', name = nm, abbrev = ab, motto = null, is_commish = false where id = t.id;
      update league_invites set revoked = true where team_id = t.id and not revoked;
      insert into messages (channel, kind, body, league_id)
      values ('general', 'system', format('🪑 %s is looking for a new GM. Its last GM closed their account.', nm), p.league_id);
      insert into notifications (league_id, team_id, kind, body, link)
      select p.league_id, c.id, 'commish', format('🪑 %s has an open seat: its GM closed their account. Invite a new GM from the Commish page.', nm), '#/commish'
      from teams c where c.league_id = p.league_id and c.is_commish and c.user_id is not null and c.id <> t.id;
    end if;
  end loop;

  -- whatever membership is left (a league with no team row), and the account itself
  delete from league_members where user_id = me;
  delete from accounts where user_id = me;
  delete from league_invites where invitee = me;

  -- the fan zones and the lounges: their posts, calls, votes and reports
  delete from fan_posts where id in (select a.id from private.fan_authors a where a.user_id = me);
  delete from private.fan_votes where user_id = me;
  delete from private.fan_reports where user_id = me;
  delete from private.fan_calls where user_id = me;
  delete from private.fan_people where user_id = me;
  delete from private.fan_removed where user_id = me;
  delete from lounge_messages where id in (select l.id from private.lounge_posts l where l.user_id = me);
  delete from private.lounge_reports where user_id = me;
  delete from private.lounge_removed where user_id = me;

  -- the sign-up counts keep their day, not the person; the waitlist and league requests on that email go
  update private.pool_signups set user_id = null where user_id = me;
  if em is not null then
    delete from waitlist where lower(email) = em;
    delete from ops.league_requests where lower(email) = em and league_id is null;
    update ops.league_requests set email = '', name = 'Former member' where lower(email) = em;
  end if;

  return jsonb_build_object('ok', true, 'seats', seats, 'deleted_leagues', wiped, 'folders', to_jsonb(folders));
end $$;
revoke execute on function public.account_delete(text) from public, anon;
grant execute on function public.account_delete(text) to authenticated;
