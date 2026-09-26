-- My pools: each GM keeps links to the other pools they play in (Yahoo, ESPN, Sleeper, Fantrax, anything),
-- opened from SaK in the side window. Private to the GM. Plus a small shared cache for the NHL hub
-- (the X insiders feed comes from Grok's X search, one call every few minutes for the whole league).
create table if not exists public.pool_links (
  id bigserial primary key,
  team_id int not null references public.teams(id) on delete cascade,
  label text not null check (length(label) between 1 and 60),
  url text not null check (url ~* '^https?://' and length(url) <= 500),
  provider text,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists pool_links_team on public.pool_links(team_id, sort, id);
alter table public.pool_links enable row level security;
create policy own_links_read on public.pool_links for select to authenticated using (team_id = public.my_team());
create policy own_links_write on public.pool_links for insert to authenticated with check (team_id = public.my_team());
create policy own_links_update on public.pool_links for update to authenticated using (team_id = public.my_team()) with check (team_id = public.my_team());
create policy own_links_delete on public.pool_links for delete to authenticated using (team_id = public.my_team());

create table if not exists public.hub_cache (
  key text primary key,
  body jsonb not null,
  at timestamptz not null default now()
);
alter table public.hub_cache enable row level security;
revoke all on public.hub_cache from public, anon, authenticated;
