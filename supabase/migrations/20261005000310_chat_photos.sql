-- Photos in the chat (16 October 2026, Patrick: "in chat improve it such that images can be uploaded"). A private storage
-- bucket, 'chat', one folder per league (<league id>/<team id>/<file>): a member of a league reads and adds photos in
-- that league's folder and nobody else sees them (the site shows them through short-lived signed links), and a
-- member removes only their own. A photo rides its message as meta.image = {path, w, h}; the message's own rules
-- (who may post where) stay with the messages table. Images only, up to 8 MB (the site shrinks them first).
-- The local test database has no storage schema, so everything here waits on it. Safe to run twice.

-- is the signed-in account a member of this league (and, given a team, that team)? The teams table only shows the
-- account's active league, so the photo rules ask the membership list directly.
create or replace function public._chat_member(p_league text, p_team text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_members m where m.user_id = auth.uid() and m.league_id::text = p_league
    and (p_team is null or m.team_id::text = p_team))
$$;
revoke execute on function public._chat_member(text, text) from public, anon;
grant execute on function public._chat_member(text, text) to authenticated;

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'no storage schema here: chat photos skipped';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('chat', 'chat', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  -- a member of the league whose folder it is (a GM or a spectator pass); a photo goes in under your own team
  execute 'drop policy if exists chat_photos_read on storage.objects';
  execute $p$create policy chat_photos_read on storage.objects for select to authenticated using (
    bucket_id = 'chat' and public._chat_member((storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists chat_photos_add on storage.objects';
  execute $p$create policy chat_photos_add on storage.objects for insert to authenticated with check (
    bucket_id = 'chat' and public._chat_member((storage.foldername(name))[1], (storage.foldername(name))[2]))$p$;
  execute 'drop policy if exists chat_photos_remove on storage.objects';
  execute $p$create policy chat_photos_remove on storage.objects for delete to authenticated using (
    bucket_id = 'chat' and owner_id = auth.uid()::text)$p$;
end $$;
