-- The pre-launch security review (28 October 2026): two holes a stranger could reach.
--
-- 1. A fan account needs only a name, and one connection makes five a day, so three throwaway accounts could take any
--    fan post down with three reports. A report still goes on the record and still bells the editors, but only a report
--    from an established account counts toward taking a post down: one with a real email (not a name-only placeholder)
--    or one at least three days old.
-- 2. A chat photo was readable by anyone who could see a message carrying its path, even a message in another league
--    pointing at this league's file. The photo's folder is its league (<league>/<team>/<file>), so the message must be in
--    the same league as the photo.

create or replace function public._fan_established(p_user uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users u where u.id = p_user
    and ((u.email is not null and u.email not like '%@guest.superpoolsai.com') or coalesce(u.created_at, now()) < now() - interval '3 days'))
$$;
revoke execute on function public._fan_established(uuid) from public, anon, authenticated;

create or replace function public.fan_report(p_post bigint) returns text
language plpgsql security definer set search_path = public, private as $$
declare m record; n int; a record; t record;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into m from fan_posts where id = p_post;
  if m.id is null then return 'gone'; end if;
  if exists (select 1 from fan_authors where id = p_post and user_id = auth.uid()) then raise exception 'That''s your own post'; end if;
  insert into fan_reports (post_id, user_id) values (p_post, auth.uid()) on conflict do nothing;
  -- only established accounts count toward a take-down (migration 339); every report is kept for the editors
  select count(*) into n from fan_reports r where r.post_id = p_post and _fan_established(r.user_id);
  if n >= greatest(3, (m.ups - m.downs) / 2) then perform _fan_take_down(p_post, 'reports'); return 'removed'; end if;
  if (select count(*) from fan_reports where post_id = p_post) = 1 then
    for a in select user_id from ops.platform_admins loop
      select tm.id, tm.league_id into t from teams tm join leagues l on l.id = tm.league_id
        where tm.user_id = a.user_id and l.status = 'active' order by l.id limit 1;
      continue when t.id is null;
      insert into notifications (league_id, team_id, kind, body, link)
      values (t.league_id, t.id, 'fan_report', format('🚩 A post on the %s fan board was reported: "%s" (%s)',
        case when m.club = upper(m.league) then m.club else upper(m.league) || ' ' || m.club end, left(m.title, 120), m.author), '/fans/' || case when m.league = 'nhl' then '' else m.league || '/' end || m.club || '?post=' || m.id);
    end loop;
  end if;
  return 'reported';
end $$;
revoke execute on function public.fan_report(bigint) from public, anon;
grant execute on function public.fan_report(bigint) to authenticated;

create or replace function public._chat_photo_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages m
    join league_members lm on lm.league_id = m.league_id and lm.user_id = auth.uid()
    where m.meta ? 'image' and m.meta -> 'image' ->> 'path' = p_name and not m.deleted
      -- the photo's folder is its league: a message elsewhere naming this file opens nothing (migration 339)
      and split_part(p_name, '/', 1) = m.league_id::text
      and ((m.channel not like 'dm:%' and m.channel not like 'garry:%')
        or (m.channel like 'dm:%' and lm.team_id::text = any (string_to_array(substr(m.channel, 4), '-')))
        or (m.channel like 'garry:%' and lm.team_id::text = substr(m.channel, 7))))
$$;
revoke execute on function public._chat_photo_visible(text) from public, anon;
grant execute on function public._chat_photo_visible(text) to authenticated;
