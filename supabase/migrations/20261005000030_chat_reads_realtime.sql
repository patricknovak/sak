-- The unread chat badge listens for chat_reads changes over realtime, but the table was never published,
-- so the badge only cleared on a full reload. Publish it (each GM only receives their own rows: RLS applies).
do $$ begin alter publication supabase_realtime add table public.chat_reads; exception when duplicate_object then null; end $$;
alter table public.chat_reads replica identity full;
