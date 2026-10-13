-- The pool's questions on the Calibration page (migration 260 wrote them): the chance calibration counts 'pool_question'
-- with the other chances, so the page can say how well a group's prices read a show. The view is as migration 183
-- left it but for the kind.
create or replace view public.chance_calibration with (security_invoker = true) as
  select kind, least(floor(predicted * 10) / 10, 0.9) as bucket, count(*)::int as n,
    round(avg(predicted), 3) as expected, round(avg(outcome), 3) as happened,
    round(avg((outcome - predicted) ^ 2), 4) as brier
  from predictions
  where status = 'scored' and kind in ('h2h_win', 'pool_split', 'pool_win', 'pool_question') and predicted between 0 and 1
  group by 1, 2;
