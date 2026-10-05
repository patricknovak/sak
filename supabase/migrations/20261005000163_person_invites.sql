-- Invitations to a person (docs/POOLS.md section 6): a pool's member invites someone they already play with, or an
-- email address, and the invitation waits for them on My pools, with an alert in every pool or league they are already
-- in. They join or turn it down there. An invitation is a one-use league_invites row addressed to one account; joining
-- goes through accept_invite as any invite does (a seat of their own in a prediction pool).
--
-- Privacy: inviting by email never says whether the address has an account (the answer is the same either way), and
-- the people offered to invite are only those the caller already shares a pool or league with.

alter table public.league_invites add column if not exists invitee uuid references auth.users (id) on delete cascade;
alter table public.league_invites add column if not exists invited_by int references public.teams (id) on delete set null;
create index if not exists league_invites_invitee on public.league_invites (invitee) where invitee is not null;

-- who the caller could invite to the pool they are in: people from their other pools and leagues, not here already
create or replace function public.pool_invite_candidates() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); lid int := current_league_id();
begin
  if me is null or not exists (select 1 from league_members where user_id = me and league_id = lid) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select o.user_id account,
      (select t.gm_name from teams t where t.user_id = o.user_id order by t.id desc limit 1) name,
      string_agg(distinct l.name, ' · ') pools,
      exists (select 1 from league_invites i where i.league_id = lid and i.invitee = o.user_id and not i.revoked
              and i.uses < i.max_uses and i.expires_at > now()) invited
    from league_members mine
    join league_members o on o.league_id = mine.league_id and o.user_id <> me
    join leagues l on l.id = o.league_id
    where mine.user_id = me and mine.league_id <> lid
      and not exists (select 1 from league_members h where h.user_id = o.user_id and h.league_id = lid)
    group by o.user_id
    limit 100) x), '[]'::jsonb);
end $$;
revoke execute on function public.pool_invite_candidates() from public, anon;
grant execute on function public.pool_invite_candidates() to authenticated;

-- invite people to the pool the caller is in: accounts picked from the candidates, and email addresses. Each one with
-- an account (and not here, not already invited) gets a one-use invitation for 14 days and an alert in each of their
-- pools; the answer never says which emails matched. Up to 40 a day from each member.
create or replace function public.pool_invite_people(p_accounts uuid[] default '{}', p_emails text[] default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lid int := current_league_id(); tm int := _team(); who uuid; n int := 0; code text;
  pool text; host text; t record; today int;
begin
  if me is null or tm is null or (select role from teams where id = tm) <> 'gm' then raise exception 'Only members invite people'; end if;
  if (select kind from leagues where id = lid) <> 'predict' then raise exception 'Invitations are for prediction pools'; end if;
  today := (select count(*) from league_invites where invited_by = tm and created_at > now() - interval '1 day');
  if today + coalesce(array_length(p_accounts, 1), 0) + coalesce(array_length(p_emails, 1), 0) > 40 then
    raise exception 'That''s a lot of invitations for one day. Send the link instead.';
  end if;
  select name into pool from leagues where id = lid;
  select gm_name into host from teams where id = tm;
  for who in
    -- accounts the caller shares a pool or league with
    select distinct o.user_id from unnest(coalesce(p_accounts, '{}')) a(id)
    join league_members o on o.user_id = a.id
    join league_members mine on mine.league_id = o.league_id and mine.user_id = me
    union
    -- accounts behind the email addresses given
    select u.id from unnest(coalesce(p_emails, '{}')) e(addr) join auth.users u on lower(u.email) = lower(btrim(e.addr))
  loop
    if who = me or exists (select 1 from league_members where user_id = who and league_id = lid)
       or exists (select 1 from league_invites i where i.league_id = lid and i.invitee = who and not i.revoked and i.uses < i.max_uses and i.expires_at > now()) then
      continue;
    end if;
    code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
    insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses, invitee, invited_by)
    values (code, lid, null, 'gm', me, now() + interval '14 days', 1, who, tm);
    for t in select id, league_id from teams where user_id = who loop
      insert into notifications (league_id, team_id, kind, body, link)
      values (t.league_id, t.id, 'pool_invite', left(format('✉️ %s invited you to %s. Open My pools to join.', host, pool), 300), '/pools');
    end loop;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.pool_invite_people(uuid[], text[]) from public, anon;
grant execute on function public.pool_invite_people(uuid[], text[]) to authenticated;

-- the caller's invitations still waiting: the pool, who invited them, how many are in, when it runs out
create or replace function public.my_invites() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'league_id', l.id, 'name', l.name, 'short', l.short_name,
      'slug', l.slug, 'color', l.brand #>> '{colors,gold}', 'tagline', l.brand ->> 'tagline',
      'host', (select t.gm_name from teams t where t.id = i.invited_by),
      'members', (select count(*) from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
      'expires_at', i.expires_at) order by i.created_at desc), '[]'::jsonb)
  from league_invites i join leagues l on l.id = i.league_id
  where i.invitee = auth.uid() and not i.revoked and i.uses < i.max_uses and i.expires_at > now()
    and not exists (select 1 from league_members m where m.user_id = auth.uid() and m.league_id = i.league_id)
$$;
revoke execute on function public.my_invites() from public, anon;
grant execute on function public.my_invites() to authenticated;

-- turn an invitation down: it is withdrawn, quietly
create or replace function public.decline_invite(p_code text) returns void
language sql security definer set search_path = public as $$
  update league_invites set revoked = true where code = lower(btrim(p_code)) and invitee = auth.uid()
$$;
revoke execute on function public.decline_invite(text) from public, anon;
grant execute on function public.decline_invite(text) to authenticated;
