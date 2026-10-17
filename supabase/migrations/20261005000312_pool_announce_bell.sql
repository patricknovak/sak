-- A pool posted in a league's chat (migration 311) rings each of the others there too: a chat card only reaches the ones
-- who open the chat, and a bell (with its push) reaches all of them, opening the chat at the card. Once a day per pool per
-- chat, as the post is. Safe to run twice.

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
  -- and a bell (with its push) to each of the others there, straight to the card
  perform _notify(o.id, 'pool_invite', left(format('🏆 %s started a pool: %s. Join from the chat.', t.gm_name, l.name), 300), '/chat?m=' || mid)
  from teams o where o.league_id = p_to and o.id <> t.id and o.user_id is not null and o.user_id <> me;
  return jsonb_build_object('ok', true, 'message', mid);
end $$;
revoke execute on function public.pool_announce(int) from public, anon;
grant execute on function public.pool_announce(int) to authenticated;
