-- usage_daily (migration 270) kept the project's default grants beyond the revokes it made (TRUNCATE, REFERENCES,
-- TRIGGER for members); like every other table, members get exactly what they use: reading their league's rows. The
-- counts are written only by usage_hit. Safe to run twice.
revoke all on public.usage_daily from public, anon, authenticated;
grant select on public.usage_daily to authenticated;
