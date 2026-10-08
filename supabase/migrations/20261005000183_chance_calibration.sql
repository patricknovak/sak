-- Every chance the product gives, against what happened (docs/DEVELOPMENT.md §4 and §6 item 5): head-to-head win chances
-- (migration 137), a pool's split (174) and a member's chance to win (175) are all probabilities, scored 1 or 0 (a
-- share on a tie). This reads them the way the Book is read: in tenths, how often what was given 60% came in. Row-level
-- security keeps each league to its own predictions.
create or replace view public.chance_calibration with (security_invoker = true) as
  select kind, least(floor(predicted * 10) / 10, 0.9) as bucket, count(*)::int as n,
    round(avg(predicted), 3) as expected, round(avg(outcome), 3) as happened,
    round(avg((outcome - predicted) ^ 2), 4) as brier
  from predictions
  where status = 'scored' and kind in ('h2h_win', 'pool_split', 'pool_win') and predicted between 0 and 1
  group by 1, 2;
revoke all on public.chance_calibration from anon;
grant select on public.chance_calibration to authenticated;
