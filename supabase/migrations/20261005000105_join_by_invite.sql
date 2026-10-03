-- Phase 2, people can join (docs/EXPANSION.md B5): an invite link the commissioner shares, a page that shows what it
-- offers before anyone signs in, and a way in for someone who has no account yet.
--
-- * invite_preview(code): what an invite is for (the league, the seat or a spectator place) and whether it is still
--   good, readable with the public key so the join page can show it to someone signed out. It says nothing else.
-- * _accept_invite(user, code, name): the seat-taking that accept_invite did, for a given account, so the `join` edge
--   function can make a newcomer's account and seat them in one go (open sign-up is off; the invite is the way in).
--   A newcomer's name goes on the seat ("Open seat" until then) or on their spectator place.
-- * accept_invite(code) keeps its signature and does the same for the signed-in caller.

set client_min_messages = warning;

create or replace function public._accept_invite(p_user uuid, p_code text, p_name text default null) returns int
language plpgsql security definer set search_path = public as $$
declare inv league_invites; em text; ab text; tid int; nm text;
begin
  if p_user is null then raise exception 'Sign in first'; end if;
  select * into inv from league_invites where code = lower(trim(p_code)) for update;
  if inv.code is null or inv.revoked or inv.expires_at < now() or inv.uses >= inv.max_uses then
    raise exception 'That invite is no longer good';
  end if;
  if exists (select 1 from league_members where user_id = p_user and league_id = inv.league_id) then
    raise exception 'You are already in this league';
  end if;
  select email into em from auth.users where id = p_user;
  nm := nullif(left(btrim(coalesce(p_name, '')), 40), '');
  if inv.team_id is not null then
    if exists (select 1 from teams where id = inv.team_id and user_id is not null) then
      raise exception 'That seat has been taken';
    end if;
    update teams set user_id = p_user, login_email = coalesce(login_email, em),
      gm_name = case when lower(gm_name) = 'open seat' then coalesce(nm, split_part(em, '@', 1), gm_name) else gm_name end
    where id = inv.team_id;
    tid := inv.team_id;
  else
    -- a spectator place: a team row with no roster, the way commish_add_spectator makes one
    nm := coalesce(nm, split_part(em, '@', 1), 'Spectator');
    ab := coalesce(nullif(upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), ''), 'SPC');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (nm, ab, nm, em, p_user, inv.league_id,
            '#64748b', '🍿', 'spectator', (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
  end if;
  update league_invites set uses = uses + 1 where code = inv.code;
  insert into accounts (user_id, active_league_id) values (p_user, inv.league_id)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return inv.league_id;
end $$;
revoke execute on function public._accept_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public._accept_invite(uuid, text, text) to service_role;

-- a signed-in person takes the seat; their account's active league becomes the one they just joined
create or replace function public.accept_invite(p_code text) returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return _accept_invite(auth.uid(), p_code, null);
end $$;

-- what an invite offers, for whoever holds the link (the code is the secret); nothing about anyone in the league
create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'ok', not i.revoked and i.expires_at >= now() and i.uses < i.max_uses
            and (i.team_id is null or not exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null)),
      'reason', case when i.revoked then 'revoked' when i.expires_at < now() then 'expired' when i.uses >= i.max_uses then 'used'
                     when i.team_id is not null and exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null) then 'taken'
                     else null end,
      'league', l.name, 'short', l.short_name, 'brand', l.brand, 'role', i.role,
      'team', (select t.name from teams t where t.id = i.team_id),
      'expires_at', i.expires_at)
    from league_invites i join leagues l on l.id = i.league_id
    where i.code = lower(trim(p_code))), jsonb_build_object('ok', false, 'reason', 'unknown'))
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
