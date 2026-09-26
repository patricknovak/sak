-- settle tracked bets and pools every morning after the previous night's stat corrections have landed
select cron.schedule('settle-bets', '45 12 * * *', $$ select public.settle_due_bets() $$);
