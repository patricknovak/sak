-- Chat photos follow their message (17 October 2026, review of migration 310): the bucket's read rule let any member of a
-- league list and open every photo in its folder, the ones sent in a DM or on the voice's private line included. A photo
-- is now readable by the one who sent it, and by a member who can see a message carrying it (the main room, the draft
-- room and the game threads for any member; a DM for its two; the voice's line for its owner), the way the messages
-- table's own rule reads. Safe to run twice.

create index if not exists messages_image_path on public.messages ((meta -> 'image' ->> 'path')) where meta ? 'image';

create or replace function public._chat_photo_visible(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from messages m
    join league_members lm on lm.league_id = m.league_id and lm.user_id = auth.uid()
    where m.meta ? 'image' and m.meta -> 'image' ->> 'path' = p_name and not m.deleted
      and ((m.channel not like 'dm:%' and m.channel not like 'garry:%')
        or (m.channel like 'dm:%' and lm.team_id::text = any (string_to_array(substr(m.channel, 4), '-')))
        or (m.channel like 'garry:%' and lm.team_id::text = substr(m.channel, 7))))
$$;
revoke execute on function public._chat_photo_visible(text) from public, anon;
grant execute on function public._chat_photo_visible(text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no storage schema here: chat photo rule skipped';
    return;
  end if;
  execute 'drop policy if exists chat_photos_read on storage.objects';
  execute $p$create policy chat_photos_read on storage.objects for select to authenticated using (
    bucket_id = 'chat' and (owner_id = auth.uid()::text or public._chat_photo_visible(name)))$p$;
end $$;
