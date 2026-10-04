-- Prediction pools (migration 145) update live: a trade anywhere in the pool moves every member's prices.
do $$ begin alter publication supabase_realtime add table public.pool_markets; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.pool_trades; exception when others then null; end $$;
