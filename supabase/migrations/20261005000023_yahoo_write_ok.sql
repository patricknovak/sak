-- whether Yahoo lets this GM's connection write (lineups, moves, trades): unknown until the first write
alter table public.yahoo_accounts add column if not exists write_ok boolean;
