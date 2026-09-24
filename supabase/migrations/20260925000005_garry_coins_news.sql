-- Garry the chat bot, St. Patrick coins for side bets, injuries/news, career stats cache,
-- and rescoring when the commissioner changes scoring settings.

-- ───────────────────────────── Garry ─────────────────────────────
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('user', 'system', 'bot'));

-- ───────────────────────────── St. Patrick coins ─────────────────────────────
alter table public.bets add column if not exists coins int not null default 0 check (coins >= 0);

create table public.coin_ledger (
  id bigserial primary key,
  team_id int not null references public.teams,
  amount int not null,
  reason text not null,
  bet_id bigint references public.bets,
  created_at timestamptz not null default now()
);
create index coin_ledger_team_idx on public.coin_ledger (team_id);
alter table public.coin_ledger enable row level security;
revoke all on public.coin_ledger from anon, authenticated;
grant select on public.coin_ledger to authenticated;
grant all on public.coin_ledger to service_role;
create policy read_all on public.coin_ledger for select to authenticated using (true);
alter publication supabase_realtime add table public.coin_ledger;

insert into public.coin_ledger (team_id, amount, reason)
  select id, 1000, 'Opening balance: 1,000 St. Patrick coins' from public.teams;

create or replace view public.coin_balances as
  select t.id as team_id,
    coalesce((select sum(amount) from coin_ledger c where c.team_id = t.id), 0)::int as balance,
    coalesce((select sum(coins) from bets b where (b.status = 'open' and b.creator_team = t.id)
      or (b.status = 'accepted' and t.id in (b.creator_team, b.opponent_team))), 0)::int as escrow
  from teams t;
revoke all on public.coin_balances from anon, authenticated;
grant select on public.coin_balances to authenticated;

create or replace function public._coins_available(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select balance - escrow from coin_balances where team_id = p_team
$$;

create or replace function public._settle_coins(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare b bets; loser int;
begin
  select * into b from bets where id = p_bet;
  if b.coins <= 0 or b.winner_team is null then return; end if;
  loser := case when b.winner_team = b.creator_team then b.opponent_team else b.creator_team end;
  insert into coin_ledger (team_id, amount, reason, bet_id) values
    (b.winner_team, b.coins, 'Won bet: ' || b.title, b.id),
    (loser, -b.coins, 'Lost bet: ' || b.title, b.id);
end $$;

drop function if exists public.create_bet(int, text, text, text, text, numeric, date, date);
create or replace function public.create_bet(p_opponent int, p_title text, p_terms text, p_kind text,
  p_stake text, p_amount numeric, p_start date default null, p_end date default null, p_coins int default 0) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); bid bigint;
begin
  if p_opponent = me then raise exception 'You can''t bet yourself'; end if;
  if coalesce(p_coins, 0) < 0 then raise exception 'Coins must be positive'; end if;
  if coalesce(p_coins, 0) > _coins_available(me) then
    raise exception 'You only have % St. Patrick coins available', _coins_available(me);
  end if;
  insert into bets (creator_team, opponent_team, title, terms, kind, stake, amount, start_date, end_date, coins)
    values (me, p_opponent, p_title, p_terms, coalesce(p_kind, 'custom'), p_stake, p_amount, p_start, p_end, coalesce(p_coins, 0))
    returning id into bid;
  perform _sys('general', format('🎲 %s %s: "%s"%s', _tname(me),
    case when p_opponent is null then 'posted an open challenge' else 'challenged ' || _tname(p_opponent) end,
    p_title, coalesce(' · stakes: ' || nullif(concat_ws(' + ',
      case when p_coins > 0 then p_coins || ' ☘️ coins' end,
      case when p_amount > 0 then '$' || p_amount end, p_stake), ''), '')),
    jsonb_build_object('bet', bid));
  if p_opponent is not null then
    perform _notify(p_opponent, 'bet', format('%s challenged you: %s', _tname(me), p_title), '/bets');
  end if;
  return bid;
end $$;

create or replace function public.respond_bet(p_bet bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'open' or b.creator_team = me or (b.opponent_team is not null and b.opponent_team <> me) then
    raise exception 'You can''t respond to that bet';
  end if;
  if p_accept then
    if b.coins > _coins_available(me) then
      raise exception 'You need % coins to take this bet; you have % available', b.coins, _coins_available(me);
    end if;
    update bets set status = 'accepted', opponent_team = me, accepted_at = now() where id = p_bet;
    perform _sys('general', format('✅ Bet on! %s vs %s: "%s"', _tname(b.creator_team), _tname(me), b.title), jsonb_build_object('bet', p_bet));
    perform _notify(b.creator_team, 'bet', _tname(me) || ' accepted your bet: ' || b.title, '/bets');
  else
    if b.opponent_team is null then raise exception 'Just ignore open challenges you don''t want'; end if;
    update bets set status = 'declined' where id = p_bet;
    perform _sys('general', format('🐔 %s declined %s''s bet: "%s"', _tname(me), _tname(b.creator_team), b.title));
    perform _notify(b.creator_team, 'bet', _tname(me) || ' declined your bet', '/bets');
  end if;
end $$;

create or replace function public.claim_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets; other int;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'accepted' or me not in (b.creator_team, b.opponent_team) then raise exception 'Not your bet'; end if;
  if p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  other := case when me = b.creator_team then b.opponent_team else b.creator_team end;
  if p_winner = other then
    update bets set status = 'settled', winner_team = p_winner, settled_at = now(), proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _settle_coins(p_bet);
    perform _sys('general', format('🏆 %s concedes: %s wins "%s"', _tname(me), _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
  else
    update bets set proposed_winner = p_winner, proposed_by = me where id = p_bet;
    perform _notify(other, 'bet', format('%s says they won "%s". Confirm or dispute.', _tname(me), b.title), '/bets');
  end if;
end $$;

create or replace function public.confirm_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); b bets;
begin
  select * into b from bets where id = p_bet for update;
  if b.status <> 'accepted' or b.proposed_winner is null or b.proposed_by = me or me not in (b.creator_team, b.opponent_team) then
    raise exception 'Nothing to confirm';
  end if;
  update bets set status = 'settled', winner_team = b.proposed_winner, settled_at = now() where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('🏆 %s wins the bet "%s"%s', _tname(b.proposed_winner), b.title,
    coalesce(' · collect: ' || nullif(concat_ws(' + ', case when b.coins > 0 then b.coins || ' ☘️ coins' end,
      case when b.amount > 0 then '$' || b.amount end, b.stake), ''), '')), jsonb_build_object('bet', p_bet));
end $$;

create or replace function public.commish_settle_bet(p_bet bigint, p_winner int) returns void
language plpgsql security definer set search_path = public as $$
declare b bets;
begin
  perform _commish();
  select * into b from bets where id = p_bet for update;
  if b.status <> 'accepted' then raise exception 'Only live bets can be settled'; end if;
  if p_winner not in (b.creator_team, b.opponent_team) then raise exception 'Winner must be one of the two teams'; end if;
  update bets set status = 'settled', winner_team = p_winner, settled_at = now() where id = p_bet;
  perform _settle_coins(p_bet);
  perform _sys('general', format('⚖️ Commissioner ruling: %s wins "%s"', _tname(p_winner), b.title), jsonb_build_object('bet', p_bet));
end $$;

create or replace function public.commish_coins(p_team int, p_amount int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  insert into coin_ledger (team_id, amount, reason) values (p_team, p_amount, p_reason);
  perform _sys('general', format('☘️ Commissioner %s %s St. Patrick coins %s %s: %s',
    case when p_amount >= 0 then 'awarded' else 'docked' end, abs(p_amount),
    case when p_amount >= 0 then 'to' else 'from' end, _tname(p_team), p_reason));
end $$;

-- ───────────────────────────── injuries, news, career stats ─────────────────────────────
alter table public.players add column if not exists injury_status text;   -- Out, Day-To-Day, Injured Reserve, Suspension …
alter table public.players add column if not exists injury_date timestamptz;

create table public.news (
  id text primary key,
  headline text not null,
  description text,
  published timestamptz,
  url text,
  image text,
  player_ids int[] not null default '{}',
  created_at timestamptz not null default now()
);
create index news_published_idx on public.news (published desc);
create index news_players_idx on public.news using gin (player_ids);
alter table public.news enable row level security;
revoke all on public.news from anon, authenticated;
grant select on public.news to authenticated;
grant all on public.news to service_role;
create policy read_all on public.news for select to authenticated using (true);

create table public.player_history (
  player_id int primary key,
  seasons jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.player_history enable row level security;
revoke all on public.player_history from anon, authenticated;
grant select on public.player_history to authenticated;
grant all on public.player_history to service_role;
create policy read_all on public.player_history for select to authenticated using (true);

-- ───────────────────────────── rescoring ─────────────────────────────
-- last season's points, projections and draft ranks all follow the league's current scoring
create or replace function public.recompute_player_values() returns void
language plpgsql security definer set search_path = public as $$
begin
  update players p set
    last_fp = calc_fpts(p.last_stats),
    proj = round(
      case when coalesce((p.last_stats->>'gp')::numeric, 0) = 0 then 0
      else calc_fpts(p.last_stats)
             / greatest(1, case when p.pos = 'G' then coalesce(nullif((p.last_stats->>'gs')::numeric, 0), (p.last_stats->>'gp')::numeric)
                                else (p.last_stats->>'gp')::numeric end)
             * (case when p.pos = 'G' then 58 else 78 end) * least((p.last_stats->>'gp')::numeric, 40) / 40
           + calc_fpts(p.last_stats) * (1 - least((p.last_stats->>'gp')::numeric, 40) / 40)
      end, 2)
  where p.last_stats is not null;
  with r as (select id, row_number() over (order by proj desc, last_fp desc, id) rn from players)
  update players p set rank = r.rn from r where r.id = p.id;
end $$;

create or replace function public.rescore_all() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  update player_games set fpts = calc_fpts(stats) where true;
  perform recompute_player_values();
end $$;

create or replace function public.commish_update_scoring(p_scoring jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  perform _commish();
  if jsonb_typeof(p_scoring -> 'skater') <> 'object' or jsonb_typeof(p_scoring -> 'goalie') <> 'object' then
    raise exception 'Scoring needs skater and goalie sections';
  end if;
  for k in select key from jsonb_each(p_scoring -> 'skater') union all select key from jsonb_each(p_scoring -> 'goalie') loop
    if k !~ '^[a-z]+$' then raise exception 'Bad stat key %', k; end if;
  end loop;
  update league set scoring = p_scoring, updated_at = now() where id = 1;
  update player_games set fpts = calc_fpts(stats) where true;
  perform recompute_player_values();
  perform _sys('general', '📐 The commissioner updated the scoring settings. Every game this season has been re-scored and the rankings recalculated.');
end $$;

-- ───────────────────────────── @Garry mentions ─────────────────────────────
do $$ begin create extension if not exists pg_net; exception when others then null; end $$;
create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.kind <> 'user' then return new; end if;
  for t in select id, gm_name from teams where id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), '/chat?c=' || new.channel);
  end loop;
  if new.body ~* '@garry\M' and new.channel not like 'dm:%' then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=reply',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public._coins_available(int), public._settle_coins(bigint), public.recompute_player_values(),
  public._mention_notify() from authenticated;
grant execute on function
  public.create_bet(int, text, text, text, text, numeric, date, date, int), public.respond_bet(bigint, boolean),
  public.claim_bet(bigint, int), public.confirm_bet(bigint), public.commish_settle_bet(bigint, int),
  public.commish_coins(int, int, text), public.rescore_all(), public.commish_update_scoring(jsonb)
to authenticated;
grant execute on all functions in schema public to service_role;
