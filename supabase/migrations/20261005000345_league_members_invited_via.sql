-- Record which invite a membership arrived through (28 October 2026). league_invites.uses is only a counter, so
-- "did people join through an invite" could not be recovered after the fact, and it did not depend on GA4 consent.
-- invited_via stays null for every existing row and for anyone who did not come through _accept_invite (the host who
-- opened the pool never does). The stamp sits after all three seat branches so the teams_sync_member trigger has
-- already written league_members.

alter table public.league_members add column if not exists invited_via text;

create or replace function public._accept_invite(p_user uuid, p_code text, p_name text default null) returns int
language plpgsql security definer set search_path = public as $$
declare inv league_invites; em text; ab text; tid int; nm text; colors text[] := array['#fb7185', '#f472b6', '#c084fc', '#38bdf8', '#34d399', '#fbbf24', '#f97316', '#a78bfa'];
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
  elsif inv.role = 'gm' and (select kind from leagues where id = inv.league_id) = 'predict' then
    -- an open link into a prediction pool: a seat of their own
    nm := coalesce(nm, split_part(em, '@', 1), 'Player');
    ab := coalesce(nullif(upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), ''), 'PLR');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (nm, ab, nm, em, p_user, inv.league_id, colors[1 + floor(random() * array_length(colors, 1))::int], '✨', 'gm',
            (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || _brand_word('{coin,name}', 'coins', inv.league_id));
    perform _pool_pay_drops(inv.league_id, tid);
  else
    -- a spectator place: a team row with no roster, the way commish_add_spectator makes one
    nm := coalesce(nm, split_part(em, '@', 1), 'Spectator');
    ab := coalesce(nullif(upper(left(regexp_replace(nm, '[^A-Za-z]', '', 'g'), 3)), ''), 'SPC');
    insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, joined_season, auto_lineup, perms)
    values (nm, ab, nm, em, p_user, inv.league_id,
            '#64748b', '🍿', 'spectator', (select season from league_rules where league_id = inv.league_id), false, '{}')
    returning id into tid;
  end if;
  update public.league_members set invited_via = inv.code
   where user_id = p_user and league_id = inv.league_id;
  update league_invites set uses = uses + 1 where code = inv.code;
  insert into accounts (user_id, active_league_id) values (p_user, inv.league_id)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return inv.league_id;
end $$;
revoke execute on function public._accept_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public._accept_invite(uuid, text, text) to service_role;
