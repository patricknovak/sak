-- Garry, second edition: what his state row needs for the new chat engine.
--   * persona_phase: the league phase his voice notes were written in. When the phase moves on (keepers, draft,
--     season, playoffs), the notes are rewritten the next morning instead of nagging about keepers in October.
--   * moments: where the unprompted posts got to (the current leader he last saw, and so on), so a big night,
--     a hat trick, a new leader or an accepted trade is called out once.
--   * usage: today's model calls and tokens, so the cost of his talking stays visible.
alter table public.garry_state add column if not exists persona_phase text;
alter table public.garry_state add column if not exists moments jsonb not null default '{}'::jsonb;
alter table public.garry_state add column if not exists usage jsonb not null default '{}'::jsonb;
