-- The realtime channels, step one of three (docs/DEVELOPMENT.md 9.48). Nothing changes for anyone until steps two and
-- three: these rules are read only when a phone opens a channel as private, and the site doesn't yet.
--
-- Today typing:<league>, online:<league>, rink:<league>, rink:<league>:<match> and rod:<league>:<match> are plain
-- broadcast and presence channels: anyone holding the site's public key can listen to who is online and typing in any
-- league and send broadcasts of their own (a typing line under any name, a Rink Duel challenge on a GM's phone, moves
-- into a live match). Supabase's Realtime Authorization asks the database, when a private channel is joined, whether
-- the caller may read (listen) or insert (send) on realtime.messages for that topic. The answer here:
--   a league's own topics   its members, and nobody else
--   every other topic       any signed-in account (the site's table listeners, whose rows row-level security already
--                           keeps to the reader's league), and the signed-out site to listen only
-- Step two: the site opens every channel with private: true (after this is live). Step three: "Allow public access"
-- goes off in the project's Realtime settings, and the public channels are gone.

create or replace function public._rt_topic_ok(p_topic text, p_send boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- a league's presence, typing line, games lobby and matches: the league's members
    when p_topic ~ '^(typing|online|rink|rod):' then
      p_topic ~ '^(typing|online|rink|rod):[0-9]{1,9}(:[A-Za-z0-9_-]{1,64})?$'
      and exists (select 1 from league_members m where m.user_id = auth.uid() and m.league_id = split_part(p_topic, ':', 2)::int)
    -- the rest carry no league's talk: signed in, listen and send; signed out, listen
    else auth.uid() is not null or not p_send
  end
$$;
revoke execute on function public._rt_topic_ok(text, boolean) from public;
grant execute on function public._rt_topic_ok(text, boolean) to anon, authenticated;

-- the rules themselves, where Realtime is installed (the test database has none)
do $$ begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then return; end if;
  if not exists (select 1 from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'topic_listen') then
    create policy topic_listen on realtime.messages for select to anon, authenticated
      using (public._rt_topic_ok((select realtime.topic()), false));
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'realtime.messages'::regclass and polname = 'topic_send') then
    create policy topic_send on realtime.messages for insert to authenticated
      with check (public._rt_topic_ok((select realtime.topic()), true));
  end if;
end $$;
