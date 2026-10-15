-- the guillotine's hour (migration 278): a week's cut comes once its Sunday's games are final
do $$ begin
  if exists (select 1 from cron.job where jobname = 'guillotine') then perform cron.unschedule('guillotine'); end if;
  perform cron.schedule('guillotine', '47 * * * *', $c$select public.run_league_jobs('guillotine')$c$);
end $$;
