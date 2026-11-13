-- Garry answers a reply to his own message (13 November 2026): a GM who hits Reply on one of his posts is talking to
-- him, named or not, so the chat wakes him the same as saying his name. Only a user's reply in the league's own chat
-- (never a DM) to a message he wrote; everything else is as migration 314 left it. Safe to run twice.

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
  if new.channel like 'garry:%'
     or (new.channel not like 'dm:%' and new.body ~* ('\m' || coalesce(bot, 'garry') || '\M'))
     -- a reply to one of his own posts
     or (new.channel not like 'dm:%' and new.reply_to is not null and exists (
           select 1 from messages p where p.id = new.reply_to and p.league_id = new.league_id and p.kind = 'bot' and p.meta ->> 'bot' = 'garry')) then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=reply',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
