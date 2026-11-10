-- Garry's yearly draft-day nag (garry-draftprep, every 27 September, migration 35) is switched off: Patrick's call
-- on 10 November 2026. Garry posts to league chat only when Patrick asks, so the draft-day post is fired by hand
-- from now on (garry?task=draftprep with the admin key). Safe to run twice.
select cron.unschedule('garry-draftprep') where exists (select 1 from cron.job where jobname = 'garry-draftprep');
