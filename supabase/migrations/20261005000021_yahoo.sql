-- Yahoo Fantasy connections: a GM signs in with Yahoo once and the yahoo edge function manages their other
-- Yahoo hockey leagues for them. Tokens are only ever read by the edge function (service role); no GM,
-- spectator or anon key can see this table.
create table if not exists public.yahoo_accounts (
  team_id int primary key references public.teams(id) on delete cascade,
  guid text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  state text,                      -- the OAuth state we are waiting for, until the sign-in completes
  state_at timestamptz,
  connected_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.yahoo_accounts enable row level security;
revoke all on public.yahoo_accounts from public, anon, authenticated;
