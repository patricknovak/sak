-- SaK League: core schema
-- All game-changing writes go through security-definer RPCs (see _functions.sql);
-- clients only get direct write access to chat, reactions, queues and their own preferences.

-- ───────────────────────────── league + teams ─────────────────────────────
create table public.league (
  id int primary key default 1 check (id = 1),
  name text not null default 'She''s A Keeper',
  short_name text not null default 'SaK',
  season text not null default '2026-27',
  phase text not null default 'keepers' check (phase in ('keepers','predraft','draft','season','offseason')),
  keepers int not null default 6,
  top_scorer_rule boolean not null default true,
  keeper_deadline timestamptz,
  draft_at timestamptz,
  pick_seconds int not null default 90,
  draft_rounds int not null default 18,
  snake boolean not null default true,
  season_start date,
  season_end date,
  trade_deadline timestamptz,
  trade_review_hours int not null default 24,
  max_acquisitions int not null default 10,
  extra_acq_fee numeric not null default 30,
  entry_fee numeric not null default 200,
  sak_fee numeric not null default 25,
  prize_split jsonb not null default '[60,30,10]',
  roster jsonb not null default '{"C":2,"LW":2,"RW":2,"D":3,"Util":1,"G":2,"BN":12,"IR":2}',
  scoring jsonb not null default '{
    "skater":{"g":1.5,"a":1,"pm":0.5,"pim":-0.2,"ppp":0.5,"gwg":1,"sog":0.2,"hit":0.1,"blk":0.2},
    "goalie":{"gs":1,"w":3,"l":-1,"ga":-0.5,"sv":0.05,"sho":2}}',
  commish_note text,
  info jsonb not null default '{}',   -- SaK Fund snapshot etc. (members-only)
  updated_at timestamptz not null default now()
);

create table public.teams (
  id int primary key,
  name text not null,
  abbrev text not null,
  gm_name text not null,
  login_email text unique,
  user_id uuid unique,
  color text not null default '#e11d48',
  emoji text not null default '🏒',
  motto text,
  fav_nhl text,
  is_commish boolean not null default false,
  joined_season text,
  auto_lineup boolean not null default true,
  autodraft boolean not null default false,
  keepers_submitted boolean not null default false,
  last_seen timestamptz
);

-- ───────────────────────────── players + rosters ─────────────────────────────
create table public.players (
  id int primary key,               -- NHL player id
  name text not null,
  first text,
  last_name text,
  pos text not null check (pos in ('C','LW','RW','D','G')),
  elig text[] not null,
  nhl_team text,
  num int,
  birth date,
  shoots text,
  headshot text,
  last_fp numeric not null default 0,      -- last season SaK fantasy points
  last_stats jsonb,
  proj numeric not null default 0,
  rank int,
  status text not null default 'active',   -- active | unrostered | inj
  injury_note text,
  updated_at timestamptz not null default now()
);
create index players_name_idx on public.players (lower(name));
create index players_team_idx on public.players (nhl_team);

create table public.rosters (
  player_id int primary key references public.players on delete cascade,
  team_id int not null references public.teams,
  slot text not null default 'BN' check (slot in ('C','LW','RW','D','Util','G','BN','IR')),
  acquired text not null default 'draft',   -- keeper | draft | fa | trade | commish | carryover
  acquired_at timestamptz not null default now(),
  keeper boolean not null default false,
  prev_fp numeric                           -- last season's points for this team (top-scorer rule)
);
create index rosters_team_idx on public.rosters (team_id);

-- ───────────────────────────── draft ─────────────────────────────
create table public.draft_picks (
  id serial primary key,
  season text not null,
  round int not null,
  original_team int not null references public.teams,
  team_id int not null references public.teams,   -- current owner
  overall int,                                    -- set when the draft order is locked in
  player_id int references public.players,
  picked_at timestamptz,
  auto boolean not null default false,
  unique (season, round, original_team),
  unique (season, overall)
);

create table public.draft_state (
  id int primary key default 1 check (id = 1),
  season text not null default '2026-27',
  status text not null default 'scheduled' check (status in ('scheduled','live','paused','done')),
  current_overall int,
  deadline timestamptz,
  paused_remaining int,
  order_set boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.draft_queue (
  team_id int not null references public.teams,
  player_id int not null references public.players,
  pos int not null default 0,
  primary key (team_id, player_id)
);

-- ───────────────────────────── chat ─────────────────────────────
create table public.messages (
  id bigserial primary key,
  channel text not null default 'general',
  team_id int references public.teams,
  kind text not null default 'user' check (kind in ('user','system')),
  body text not null check (length(body) between 1 and 2000),
  meta jsonb,
  reply_to bigint references public.messages on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted boolean not null default false
);
create index messages_channel_idx on public.messages (channel, id desc);

create table public.reactions (
  message_id bigint not null references public.messages on delete cascade,
  team_id int not null references public.teams,
  emoji text not null check (length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, team_id, emoji)
);

create table public.chat_reads (
  team_id int not null references public.teams,
  channel text not null,
  last_read_id bigint not null default 0,
  primary key (team_id, channel)
);

-- ───────────────────────────── NHL games + scoring ─────────────────────────────
create table public.games (
  id bigint primary key,
  date date not null,                 -- NHL game date (Eastern)
  start_utc timestamptz not null,
  home text not null,
  away text not null,
  state text not null default 'FUT',  -- FUT PRE LIVE CRIT OFF FINAL
  home_score int,
  away_score int,
  period text,
  clock text,
  final_synced boolean not null default false,
  updated_at timestamptz not null default now()
);
create index games_date_idx on public.games (date);

create table public.player_games (
  game_id bigint not null references public.games on delete cascade,
  player_id int not null,
  date date not null,
  nhl_team text,
  stats jsonb not null,
  fpts numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_id, player_id)
);
create index player_games_player_idx on public.player_games (player_id, date);
create index player_games_date_idx on public.player_games (date);

-- lineup frozen at puck drop: who was in which slot for each player's game
create table public.lineup_snapshots (
  game_id bigint not null references public.games on delete cascade,
  date date not null,
  team_id int not null references public.teams,
  player_id int not null,
  slot text not null,
  taken_at timestamptz not null default now(),
  primary key (game_id, player_id, team_id)
);
create index lineup_snapshots_team_idx on public.lineup_snapshots (team_id, date);

-- ───────────────────────────── transactions + trades ─────────────────────────────
create table public.transactions (
  id bigserial primary key,
  season text not null,
  type text not null,        -- add | drop | trade | keeper | release | draft | commish
  team_id int references public.teams,
  player_id int references public.players,
  other_team int references public.teams,
  fee numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index transactions_team_idx on public.transactions (team_id, season);

create table public.trades (
  id bigserial primary key,
  season text not null,
  from_team int not null references public.teams,
  to_team int not null references public.teams,
  status text not null default 'proposed'
    check (status in ('proposed','accepted','approved','declined','cancelled','vetoed','failed')),
  note text,
  review_note text,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  decided_at timestamptz
);

create table public.trade_items (
  id bigserial primary key,
  trade_id bigint not null references public.trades on delete cascade,
  from_team int not null references public.teams,
  player_id int references public.players,
  pick_id int references public.draft_picks,
  check ((player_id is null) <> (pick_id is null))
);

-- ───────────────────────────── side bets ─────────────────────────────
create table public.bets (
  id bigserial primary key,
  creator_team int not null references public.teams,
  opponent_team int references public.teams,     -- null = open challenge, anyone can take it
  title text not null check (length(title) between 3 and 140),
  terms text,
  kind text not null default 'custom' check (kind in ('custom','h2h','season')),
  stake text,                                      -- free text: "a 2-4 of Kokanee", "loser wears a Leafs jersey"
  amount numeric,                                  -- cash, if any
  start_date date,
  end_date date,
  status text not null default 'open' check (status in ('open','accepted','declined','cancelled','settled')),
  proposed_winner int references public.teams,
  proposed_by int references public.teams,
  winner_team int references public.teams,
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  settled_at timestamptz
);

-- ───────────────────────────── league governance + money ─────────────────────────────
create table public.proposals (
  id bigserial primary key,
  title text not null,
  body text,
  sponsor_team int references public.teams,
  cosponsor_team int references public.teams,
  status text not null default 'open' check (status in ('open','passed','failed','vetoed','tabled')),
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  decided_at timestamptz
);

create table public.proposal_votes (
  proposal_id bigint not null references public.proposals on delete cascade,
  team_id int not null references public.teams,
  vote text not null check (vote in ('yes','no','abstain')),
  created_at timestamptz not null default now(),
  primary key (proposal_id, team_id)
);

create table public.ledger (
  id bigserial primary key,
  season text not null,
  team_id int references public.teams,
  kind text not null,        -- entry | sak | fine | acq_fee | prize | other
  amount numeric not null,   -- positive = owed to the league / fund
  description text not null,
  paid boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id bigserial primary key,
  team_id int not null references public.teams,
  kind text not null,
  body text not null,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index notifications_team_idx on public.notifications (team_id, id desc);

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function public.my_team() returns int
language sql stable security definer set search_path = public as
$$ select id from teams where user_id = auth.uid() $$;

create or replace function public.is_commish() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select is_commish from teams where user_id = auth.uid()), false) $$;

create or replace function public.today_et() returns date
language sql stable as
$$ select (now() at time zone 'America/New_York')::date $$;

-- ───────────────────────────── row level security ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['league','teams','players','rosters','draft_picks','draft_state','draft_queue',
    'messages','reactions','chat_reads','games','player_games','lineup_snapshots','transactions','trades',
    'trade_items','bets','proposals','proposal_votes','ledger','notifications']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- league members can read everything except other people's DMs and notifications
create policy read_all on public.league for select to authenticated using (true);
create policy read_all on public.teams for select to authenticated using (true);
create policy read_all on public.players for select to authenticated using (true);
create policy read_all on public.rosters for select to authenticated using (true);
create policy read_all on public.draft_picks for select to authenticated using (true);
create policy read_all on public.draft_state for select to authenticated using (true);
create policy read_all on public.draft_queue for select to authenticated using (team_id = public.my_team());
create policy read_all on public.messages for select to authenticated
  using (channel not like 'dm:%' or public.my_team()::text = any (string_to_array(substr(channel, 4), '-')));
create policy read_all on public.reactions for select to authenticated using (true);
create policy read_all on public.chat_reads for select to authenticated using (team_id = public.my_team());
create policy read_all on public.games for select to authenticated using (true);
create policy read_all on public.player_games for select to authenticated using (true);
create policy read_all on public.lineup_snapshots for select to authenticated using (true);
create policy read_all on public.transactions for select to authenticated using (true);
create policy read_all on public.trades for select to authenticated using (true);
create policy read_all on public.trade_items for select to authenticated using (true);
create policy read_all on public.bets for select to authenticated using (true);
create policy read_all on public.proposals for select to authenticated using (true);
create policy read_all on public.proposal_votes for select to authenticated using (true);
create policy read_all on public.ledger for select to authenticated using (true);
create policy read_all on public.notifications for select to authenticated using (team_id = public.my_team());

-- the sign-in screen needs team names/colours before anyone is logged in
create view public.team_directory with (security_barrier) as
  select id, name, abbrev, gm_name, login_email, color, emoji from public.teams;
grant select on public.team_directory to anon, authenticated;

-- direct writes: chat
grant usage on all sequences in schema public to authenticated;
grant insert on public.messages to authenticated;
grant update (body, edited_at, deleted) on public.messages to authenticated;
create policy post_own on public.messages for insert to authenticated
  with check (team_id = public.my_team() and kind = 'user'
    and (channel not like 'dm:%' or public.my_team()::text = any (string_to_array(substr(channel, 4), '-'))));
create policy edit_own on public.messages for update to authenticated
  using (team_id = public.my_team()) with check (team_id = public.my_team());

grant insert, delete on public.reactions to authenticated;
create policy react_own on public.reactions for insert to authenticated with check (team_id = public.my_team());
create policy unreact_own on public.reactions for delete to authenticated using (team_id = public.my_team());

grant insert, update on public.chat_reads to authenticated;
create policy reads_own_i on public.chat_reads for insert to authenticated with check (team_id = public.my_team());
create policy reads_own_u on public.chat_reads for update to authenticated using (team_id = public.my_team());

grant insert, update, delete on public.draft_queue to authenticated;
create policy queue_own_i on public.draft_queue for insert to authenticated with check (team_id = public.my_team());
create policy queue_own_u on public.draft_queue for update to authenticated using (team_id = public.my_team());
create policy queue_own_d on public.draft_queue for delete to authenticated using (team_id = public.my_team());

grant update (read) on public.notifications to authenticated;
create policy notif_own on public.notifications for update to authenticated using (team_id = public.my_team());

-- ───────────────────────────── realtime ─────────────────────────────
alter publication supabase_realtime add table
  public.league, public.teams, public.rosters, public.draft_picks, public.draft_state,
  public.messages, public.reactions, public.games, public.trades, public.bets,
  public.proposals, public.proposal_votes, public.notifications, public.transactions;
