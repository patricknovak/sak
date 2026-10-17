-- Review fixes to the pools posted in a league's chat (migrations 311 and 312) and the mention bell (313), 17 October 2026:
-- a card's text (a pool named "@everyone picks", or with the voice's name in it) no longer rings mentions or wakes the
-- voice; a mention in a game thread keeps its old link (the chat's feed leaves game threads out, so ?m= can't find it);
-- a deleted card no longer counts toward the once a day; two posts at once make one card; the card carries an open link
-- with two weeks left in it (it stays up on the home page for a month); and the bell says the member shared the pool
-- (any member can) and goes only to those not in it yet. Safe to run twice.

create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; bot text;
begin
  -- a pool's card (pool_announce) is an invitation, not talk: its name never rings a mention or wakes the voice
  if new.kind <> 'user' or coalesce(new.meta ? 'pool_card', false) then return new; end if;
  for t in select id, gm_name from teams where league_id = new.league_id and id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), case when new.channel like 'game:%' then '/chat?c=' || new.channel else '/chat?m=' || new.id end);
  end loop;
  select regexp_replace(coalesce(nullif(brand -> 'bot' ->> 'name', ''), 'Garry'), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
    into bot from leagues where id = new.league_id;
  if new.channel like 'garry:%' or (new.channel not like 'dm:%' and new.body ~* ('\m' || coalesce(bot, 'garry') || '\M')) then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=reply',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;

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
  -- one at a time per pool and chat, so a double tap or two members at once post one card
  perform pg_advisory_xact_lock(hashtext(format('pool_announce:%s:%s', lid, p_to)));
  if exists (select 1 from messages where league_id = p_to and not deleted and meta -> 'pool_card' ->> 'league_id' = lid::text and created_at > now() - interval '20 hours') then
    raise exception 'It''s already up in that chat today';
  end if;
  -- the pool's open link, with two weeks left in it at least, since the card stays up in the chat and on the home page
  select i.code into code from league_invites i
  where i.league_id = lid and i.team_id is null and i.invitee is null and i.role = 'gm' and not i.revoked
    and i.expires_at > now() + interval '14 days' and i.uses < i.max_uses - 5
  order by i.expires_at desc limit 1;
  if code is null then
    code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
    insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
    values (code, lid, null, 'gm', me, now() + interval '30 days', 50);
  end if;
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
  -- and a bell (with its push) to each of the others there who aren't in the pool yet, straight to the card
  perform _notify(o.id, 'pool_invite', left(format('🏆 %s shared a pool: %s. Join from the chat.', t.gm_name, l.name), 300), '/chat?m=' || mid)
  from teams o where o.league_id = p_to and o.id <> t.id and o.user_id is not null and o.user_id <> me
    and not exists (select 1 from league_members x where x.user_id = o.user_id and x.league_id = lid);
  return jsonb_build_object('ok', true, 'message', mid);
end $$;
revoke execute on function public.pool_announce(int) from public, anon;
grant execute on function public.pool_announce(int) to authenticated;
