-- Running costs, once a day after midnight Eastern: record yesterday's footprint, then check yesterday's AI spend for a
-- spike (the owner gets a notification when there is one). SQL only.
select cron.unschedule(jobid) from cron.job where jobname in ('cost-snapshot', 'cost-watch');
select cron.schedule('cost-snapshot', '20 5 * * *', $$ select public.cost_snapshot() $$);
select cron.schedule('cost-watch', '25 5 * * *', $$ select public.cost_watch() $$);
