-- Garry's Book: open the day's markets every morning (9:35 ET) and settle every half hour.
select cron.schedule('open-book', '35 13 * * *', $$ select public.open_markets() $$);
select cron.schedule('settle-book', '*/30 * * * *', $$ select public.settle_markets() $$);
