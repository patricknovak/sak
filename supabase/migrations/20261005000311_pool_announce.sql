-- A pool, posted in your league's chat (17 October 2026). The first measured week showed the league's GMs are the
-- warm network: they open the app every day, they already have accounts, and none of them had seen anyone's pool. A
-- member of a prediction pool posts it, with one tap from the pool, into the chat of another league or pool they are in:
-- a message from their own team there, carrying a card (the pool's name, what it plays, how many are in, its open
-- invite) that the others join from with one tap. Once a day per pool per chat, so it stays an invitation, not spam.
-- Only this function writes a card: a member writes their own message's meta, so a guard keeps pool_card to it.
-- Safe to run twice.

create or replace function public._messages_guard_card() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.pool_announce', true), '') = '1' then return new; end if;
  if tg_op = 'INSERT' then
    if new.meta ? 'pool_card' then new.meta := new.meta - 'pool_card'; end if;
  elsif (new.meta -> 'pool_card') is distinct from (old.meta -> 'pool_card') then
    new.meta := case when old.meta ? 'pool_card' then coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('pool_card', old.meta -> 'pool_card')
                     else new.meta - 'pool_card' end;
  end if;
  return new;
end $$;
drop trigger if exists messages_guard_card on public.messages;
create trigger messages_guard_card before insert or update of meta on public.messages
  for each row execute function public._messages_guard_card();

-- the pool's open link (migration 162) skips the one-use invitations addressed to a person (migration 163): they are
-- the same kind of row with no seat, and once a member had invited someone by name the "open" link could be that
-- person's own code, which no one else can use
create or replace function public.pool_share_link() returns text
language plpgsql security definer set search_path = public as $$
declare me int := _team(); lid int := current_league_id(); code text;
begin
  if me is null or (select role from teams where id = me) <> 'gm' then raise exception 'Only members share the pool'; end if;
  if (select kind from leagues where id = lid) <> 'predict' then raise exception 'Open links are for prediction pools'; end if;
  select i.code into code from league_invites i
  where i.league_id = lid and i.team_id is null and i.invitee is null and i.role = 'gm' and not i.revoked
    and i.expires_at > now() + interval '1 day' and i.uses < i.max_uses
  order by i.expires_at desc limit 1;
  if code is null then
    code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
    insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
    values (code, lid, null, 'gm', auth.uid(), now() + interval '30 days', 50);
  end if;
  return code;
end $$;
revoke execute on function public.pool_share_link() from public, anon;
grant execute on function public.pool_share_link() to authenticated;

create or replace function public.pool_announce(p_to int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lid int := current_league_id(); l leagues; t teams; code text; what text; n int; mid bigint;
begin
  if me is null or _team() is null then raise exception 'Sign in first'; end if;
  select * into l from leagues where id = lid;
  if l.kind <> 'predict' then raise exception 'Only a pool can be posted to another chat'; end if;
  if p_to = lid then raise exception 'That is this pool''s own chat'; end if;
  -- your own seat in the chat it goes to, and the right to talk there
  select tt.* into t from league_members m join teams tt on tt.id = m.team_id where m.user_id = me and m.league_id = p_to limit 1;
  if t.id is null then raise exception 'You''re not in that league'; end if;
  if not (t.role = 'gm' or (coalesce((t.perms->>'active')::boolean, true) and coalesce((t.perms->>'chat')::boolean, true))) then
    raise exception 'Chat is switched off for your pass there';
  end if;
  if exists (select 1 from messages where league_id = p_to and meta -> 'pool_card' ->> 'league_id' = lid::text and created_at > now() - interval '20 hours') then
    raise exception 'It''s already up in that chat today';
  end if;
  code := pool_share_link();   -- the pool's one open link, the same one its members pass around
  -- what it plays: its games by name, else its questions
  select string_agg(title, ' · ' order by id) into what from (select title, id from pool_games where league_id = lid order by id limit 3) g;
  if what is null then
    select case when count(*) > 0 then format('%s questions', count(*)) end into what from pool_markets where league_id = lid;
  end if;
  select count(*) into n from league_members where league_id = lid;
  perform set_config('app.pool_announce', '1', true);
  insert into messages (channel, team_id, kind, body, meta, league_id)
  values ('general', t.id, 'user', left(format('🏆 Come play in my pool, %s%s', l.name, coalesce(': ' || what, '')), 2000),
    jsonb_build_object('pool_card', jsonb_build_object('league_id', lid, 'code', code, 'name', l.name, 'what', what, 'members', n,
      'color', l.brand -> 'colors' ->> 'gold', 'slug', l.slug)), p_to)
  returning id into mid;
  perform set_config('app.pool_announce', '', true);
  return jsonb_build_object('ok', true, 'message', mid);
end $$;
revoke execute on function public.pool_announce(int) from public, anon;
grant execute on function public.pool_announce(int) to authenticated;
