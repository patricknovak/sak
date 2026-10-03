-- The prediction log's two jobs, once per league: tonight's expectations at 10:50 am Eastern (after the morning's
-- projections and lineups, before any puck drop), and the scoring at 8:55 am Eastern the next day (after the
-- morning stat corrections at 8:30).
select cron.schedule('predict', '50 14 * * *', $$ select public.run_league_jobs('predict') $$);
select cron.schedule('score-predictions', '55 12 * * *', $$ select public.run_league_jobs('score-predictions') $$);
