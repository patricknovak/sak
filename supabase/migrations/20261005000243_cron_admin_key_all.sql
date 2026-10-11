-- Every scheduled call to nhl-sync and Garry carries the platform's admin key (11 October 2026 review).
--
-- Fifteen jobs still sent only the public anon key, pasted into the job's text: nhl-scores, nhl-gameday, the
-- schedules, injuries, news, standings, the fund price, the auto-lineups, and Garry's column, nudge, weekly, moments
-- and draft prep. The anon key ships in the site, so anyone could start those runs (each pulls the NHL's or ESPN's
-- feeds, and Garry's call the model and post to chat). Each job now sends _edge_headers(true): the same anon
-- Authorization plus x-admin-key, read from private.app_keys when it runs, never stored in the job. Only the headers
-- change: every schedule, gate (where _scores_due()) and timeout is kept as it is. nhl-sync and Garry then refuse
-- those tasks without the key (deployed after this is applied, so no run is ever refused).
--
-- Safe to run twice: a job already on _edge_headers is left alone.

do $$
declare j record;
begin
  for j in select jobid, jobname, command from cron.job
           where command ~ 'functions/v1/(nhl-sync|garry)\?' and command ~ 'headers := ''\{[^'']*\}''::jsonb' loop
    perform cron.alter_job(j.jobid, command := regexp_replace(j.command, 'headers := ''\{[^'']*\}''::jsonb', 'headers := public._edge_headers(true)'));
  end loop;
end $$;
