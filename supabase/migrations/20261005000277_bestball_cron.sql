-- best ball's hour (migration 276): the finished nights of every league that plays it, re-slotted to their best lineups
do $$ begin
  if exists (select 1 from cron.job where jobname = 'bestball') then perform cron.unschedule('bestball'); end if;
  perform cron.schedule('bestball', '41 * * * *', $c$select public.run_league_jobs('bestball')$c$);
end $$;
