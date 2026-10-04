-- A request for a league reaches the platform right away: request_league (migration 112) now notifies each platform
-- admin, on their first team, so the bell lights up and the phone buzzes when they have alerts on. Otherwise as before.

set client_min_messages = warning;

create or replace function public.request_league(p_name text, p_email text, p_league_name text, p_team_count int, p_plays_on text default null, p_note text default null)
returns boolean language plpgsql security definer set search_path = public, ops as $$
declare t int; nm text := left(btrim(coalesce(p_name, '')), 60); em text := lower(btrim(coalesce(p_email, '')));
        lg text := left(btrim(coalesce(p_league_name, '')), 60); po text := nullif(lower(btrim(coalesce(p_plays_on, ''))), '');
begin
  if length(nm) < 2 then raise exception 'Tell us your name'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(em) > 120 then raise exception 'That doesn''t look like an email address'; end if;
  if length(lg) < 2 then raise exception 'Give the league a name (you can change it later)'; end if;
  if p_team_count is null or p_team_count not between 2 and 20 then raise exception 'Between 2 and 20 teams'; end if;
  if po is not null and po not in ('yahoo', 'espn', 'fantrax', 'cbs', 'sheet', 'new', 'other') then po := 'other'; end if;
  if (select count(*) from ops.league_requests where email = em and created_at > now() - interval '1 day') >= 3 then
    raise exception 'We have your request already. We''ll be in touch soon.';
  end if;
  if (select count(*) from ops.league_requests where created_at > now() - interval '1 day') >= 100 then
    raise exception 'Lots of leagues asked for today. Try again tomorrow.';
  end if;
  insert into ops.league_requests (name, email, league_name, teams, plays_on, note)
  values (nm, em, lg, p_team_count, po, nullif(left(btrim(coalesce(p_note, '')), 1000), ''));
  -- each platform admin hears about it on their phone (through their first team's alerts) and in the bell
  for t in select distinct on (tm.user_id) tm.id from teams tm join ops.platform_admins a on a.user_id = tm.user_id order by tm.user_id, tm.id loop
    perform _notify(t, 'platform', format('📮 %s asked for a league: %s, %s teams', nm, lg, p_team_count), '/platform');
  end loop;
  return true;
end $$;
