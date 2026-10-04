-- Asking for a league (docs/SUPERPOOLS.md section 7, step 5: onboarding). Until sign-up and billing are self-serve,
-- anyone can ask for a league from the site's "Start your league" page (#/start, no account needed), and the platform
-- opens it from the Platform page.
--
-- * ops.league_requests: who asked, for what league, how many teams, what they play on now. In schema ops, which the
--   API doesn't serve: only the functions below read or write it.
-- * request_league(...): the public form. Readable with the public key; it checks the fields and keeps the inbox clean
--   (one email asks at most 3 times a day; the whole site takes at most 100 asks a day).
-- * platform_league_requests(): the inbox, for platform admins, newest first.
-- * platform_close_request(id, status, league): marks a request opened (with the league it became) or declined.

set client_min_messages = warning;

create table if not exists ops.league_requests (
  id bigserial primary key,
  name text not null,
  email text not null,
  league_name text not null,
  teams int not null check (teams between 2 and 20),
  plays_on text,                 -- yahoo, espn, fantrax, cbs, sheet, new, other
  note text,
  status text not null default 'new' check (status in ('new', 'opened', 'declined')),
  league_id int references public.leagues (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index if not exists league_requests_new on ops.league_requests (created_at desc) where status = 'new';

create or replace function public.request_league(p_name text, p_email text, p_league_name text, p_team_count int, p_plays_on text default null, p_note text default null)
returns boolean language plpgsql security definer set search_path = public, ops as $$
declare nm text := left(btrim(coalesce(p_name, '')), 60); em text := lower(btrim(coalesce(p_email, '')));
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
  return true;
end $$;
revoke execute on function public.request_league(text, text, text, int, text, text) from public;
grant execute on function public.request_league(text, text, text, int, text, text) to anon, authenticated;

create or replace function public.platform_league_requests()
returns table (id bigint, name text, email text, league_name text, teams int, plays_on text, note text, status text, league_id int, created_at timestamptz)
language plpgsql stable security definer set search_path = public, ops as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  return query select r.id, r.name, r.email, r.league_name, r.teams, r.plays_on, r.note, r.status, r.league_id, r.created_at
    from ops.league_requests r order by (r.status = 'new') desc, r.created_at desc limit 200;
end $$;
revoke execute on function public.platform_league_requests() from public, anon;
grant execute on function public.platform_league_requests() to authenticated;

create or replace function public.platform_close_request(p_id bigint, p_status text, p_league int default null) returns text
language plpgsql security definer set search_path = public, ops as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  if p_status not in ('opened', 'declined', 'new') then raise exception 'A request is opened, declined or new'; end if;
  if p_league is not null and not exists (select 1 from leagues where id = p_league) then raise exception 'No such league'; end if;
  update ops.league_requests set status = p_status, league_id = coalesce(p_league, league_id),
    closed_at = case when p_status = 'new' then null else now() end where id = p_id;
  if not found then raise exception 'No such request'; end if;
  return p_status;
end $$;
revoke execute on function public.platform_close_request(bigint, text, int) from public, anon;
grant execute on function public.platform_close_request(bigint, text, int) to authenticated;
