-- A mention's bell opens the chat at the message itself (17 October 2026): the chat opens at any message by its id
-- (`?m=`, the search and the shared links), so "Terry: @Patrick ..." lands on Terry's line, private ones included,
-- instead of the top of the main room. The rest of the function as migration 76 has it. Safe to run twice.

create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record; bot text;
begin
  if new.kind <> 'user' then return new; end if;
  for t in select id, gm_name from teams where league_id = new.league_id and id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), '/chat?m=' || new.id);
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
