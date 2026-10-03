-- Email sign-in, step 2: every SaK account signs in with its own email (all nine set on 3 October 2026), so the
-- sign-in page no longer lists teams and the public list stops handing out sign-in addresses. team_directory keeps the
-- names and colours (the site checks the server is up through it) and drops login_email; a view can't lose a column
-- in place, so it is made again, with the same rights as before.

set client_min_messages = warning;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_directory' and column_name = 'login_email') then
    drop view public.team_directory;
  end if;
end $$;

create or replace view public.team_directory as
  select id, name, abbrev, gm_name, color, emoji, role, league_id
  from teams where league_id = current_league_id();
grant select on public.team_directory to anon, authenticated;
