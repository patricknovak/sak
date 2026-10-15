-- Every season with a pack of questions carries it (as the World Series and, since migration 299, the NBA do), so a
-- pool started on the NHL's games, the Premier League or MLS opens with its questions ticked beside its games; the
-- start page stops listing those packs on their own, and a host who wants only the questions picks the event and leaves
-- the games unticked. Pools already running a pack keep it. Safe to run twice.
update public.competitions set pack = 'nhl-2026-27' where id = 'nhl-2026-27' and pack is null and exists (select 1 from public.pool_packs where slug = 'nhl-2026-27');
update public.competitions set pack = 'premier-league-2026-27' where id = 'epl' and pack is null and exists (select 1 from public.pool_packs where slug = 'premier-league-2026-27');
update public.competitions set pack = 'mls-cup-2026' where id = 'mls' and pack is null and exists (select 1 from public.pool_packs where slug = 'mls-cup-2026');
