-- End-to-end rules test on a scratch database (see supabase-stubs.sql). Run with ON_ERROR_STOP=1.
\set QUIET on
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000000' || id)::uuid, login_email from teams;
update teams set user_id = ('00000000-0000-0000-0000-00000000000' || id)::uuid;

create or replace function pg_temp.as_team(t int) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || t, false) $$;

-- ── keepers
select pg_temp.as_team(2);
set role authenticated;
do $$ begin
  perform set_keepers(array[(select top_scorer(2))]);
  raise exception 'top scorer rule not enforced';
exception when others then
  if sqlerrm not like '%top scorer%' then raise; end if;
end $$;
do $$ begin
  perform set_keepers(array[(select player_id from rosters where team_id = 1 limit 1)]);
  raise exception 'kept other team player';
exception when others then if sqlerrm not like '%own roster%' then raise; end if; end $$;
select set_keepers((select array_agg(player_id) from (select player_id from rosters where team_id = 2 and player_id <> top_scorer(2) order by prev_fp desc limit 6) x));
reset role;
select 'keepers team2', count(*) from rosters where team_id = 2 and keeper;

select pg_temp.as_team(1);
set role authenticated;
select finalize_keepers();
reset role;
select 'after finalize', team_id, count(*) from rosters group by team_id order by 1;
select 'top scorers back in pool', count(*) from players p where p.name in ('Connor McDavid','Nathan MacKinnon','Nikita Kucherov') and not exists (select 1 from rosters r where r.player_id = p.id);

-- ── chat RLS
select pg_temp.as_team(3);
set role authenticated;
insert into messages (channel, team_id, body) values ('general', 3, 'Jays are winning it all @Patrick');
do $$ begin
  insert into messages (channel, team_id, body) values ('general', 4, 'spoof');
  raise exception 'spoof allowed';
exception when insufficient_privilege then null; end $$;
insert into messages (channel, team_id, body) values ('dm:3-5', 3, 'psst Trystan, trade?');
reset role;
select pg_temp.as_team(4);
set role authenticated;
select 'craig sees DMs (expect 0)', count(*) from messages where channel like 'dm:%';
reset role;
select pg_temp.as_team(1);
set role authenticated;
select 'patrick mention notif', count(*) from notifications;
-- ── draft
select draft_set_order(array[5,7,2,1,4,3,6,8]);
select draft_start();
reset role;
select 'on clock', current_overall, (select team_id from draft_picks where overall = 1) from draft_state;
select pg_temp.as_team(3);
set role authenticated;
do $$ begin perform draft_pick((select id from players where name = 'Connor McDavid')); raise exception 'out of turn pick allowed';
exception when others then if sqlerrm not like '%not your pick%' then raise; end if; end $$;
reset role;
select pg_temp.as_team(5);
set role authenticated;
select draft_pick((select id from players where name = 'Connor McDavid'));
reset role;
-- autodraft everyone else via expired clocks
update teams set autodraft = true;
do $$ declare i int; begin
  for i in 1..200 loop
    update draft_state set deadline = now() - interval '1 second' where status = 'live';
    perform draft_tick();
    exit when (select status from draft_state) = 'done';
  end loop;
end $$;
select 'draft status', status, (select phase from league) from draft_state;
select 'roster sizes', team_id, count(*), count(*) filter (where slot <> 'BN') starters from rosters group by 2 order by 2;
select 'goalies per team', team_id, count(*) from rosters r join players p on p.id = r.player_id and p.pos = 'G' group by 2 order by 2;

-- ── lineups
select pg_temp.as_team(5);
set role authenticated;
select 'eagle lineup', r.slot, count(*) from rosters r where team_id = 5 group by 2 order by 2;
do $$ declare c int; d int; sl text; begin
  select r.player_id, p.elig[1] into c, sl from rosters r join players p on p.id = r.player_id
    where r.team_id = 5 and r.slot = 'BN' and p.pos <> 'G' limit 1;
  select player_id into d from rosters where team_id = 5 and slot = sl limit 1;
  perform move_player(c, sl, d);
  if (select slot from rosters where player_id = c) <> sl then raise exception 'swap failed'; end if;
  if (select slot from rosters where player_id = d) <> 'BN' then raise exception 'swap target not benched'; end if;
end $$;
do $$ begin
  perform move_player((select r.player_id from rosters r join players p on p.id = r.player_id where r.team_id = 5 and p.pos = 'G' limit 1), 'C');
  raise exception 'goalie at C allowed';
exception when others then if sqlerrm not like '%can''t play%' then raise; end if; end $$;

-- ── free agents
do $$ begin
  perform add_player((select id from players p where not exists (select 1 from rosters r where r.player_id = p.id) order by proj desc limit 1));
  raise exception 'overfull roster add allowed';
exception when others then if sqlerrm not like '%Roster is full%' then raise; end if; end $$;
select add_player(
  (select id from players p where not exists (select 1 from rosters r where r.player_id = p.id) order by proj desc limit 1),
  (select player_id from rosters where team_id = 5 and slot = 'BN' limit 1));
reset role;

-- ── trades
select pg_temp.as_team(5);
set role authenticated;
select propose_trade(6, array[(select player_id from rosters where team_id = 5 limit 1)], array[(select player_id from rosters where team_id = 6 limit 1)], '{}', '{}', 'fair and square') as trade_id \gset
reset role;
select pg_temp.as_team(6);
set role authenticated;
select respond_trade(:trade_id, true);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:trade_id, true, 'lgtm');
reset role;
select 'trade', status from trades where id = :trade_id;

-- next season's picks exist and can be traded: team 5 sends its 2027-28 R1 for team 6's 2027-28 R2
select 'future picks', count(*) from draft_picks where season = _next_season((select season from league));
select pg_temp.as_team(5);
set role authenticated;
select propose_trade(6, '{}', '{}',
  array[(select id from draft_picks where season = _next_season((select season from league)) and original_team = 5 and round = 1)],
  array[(select id from draft_picks where season = _next_season((select season from league)) and original_team = 6 and round = 2)], 'future considerations') as pick_trade \gset
reset role;
select pg_temp.as_team(6);
set role authenticated;
select respond_trade(:pick_trade, true);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:pick_trade, true, 'ok');
reset role;
do $$ begin
  if (select team_id from draft_picks where season = _next_season((select season from league)) and original_team = 5 and round = 1) <> 6
     or (select team_id from draft_picks where season = _next_season((select season from league)) and original_team = 6 and round = 2) <> 5 then
    raise exception 'future pick trade did not move the picks';
  end if;
end $$;
select 'future pick trade', status from trades where id = :pick_trade;

-- ── bets
select pg_temp.as_team(7);
set role authenticated;
select create_bet(8, 'Most points in October', 'Whoever scores more fantasy points in October', 'h2h', 'a two-four', 20, '2026-10-01', '2026-10-31', 150) as bet_id \gset
reset role;
select pg_temp.as_team(8);
set role authenticated;
select respond_bet(:bet_id, true);
select claim_bet(:bet_id, 8);
reset role;
select pg_temp.as_team(7);
set role authenticated;
select confirm_bet(:bet_id);
reset role;
select 'bet', status, winner_team from bets where id = :bet_id;
select 'coins (expect 7=850, 8=1150)', team_id, balance, escrow from coin_balances where team_id in (7, 8) order by 1;
select pg_temp.as_team(7);
set role authenticated;
do $$ begin perform create_bet(null, 'Too rich', null, 'custom', null, null, null, null, 5000); raise exception 'overbet allowed';
exception when others then if sqlerrm not like '%coins available%' then raise; end if; end $$;
reset role;

-- ── scoring
insert into games (id, date, start_utc, home, away, state)
  select 1, today_et(), now() - interval '1 hour', p.nhl_team, 'XXX', 'LIVE' from players p where p.name = 'Connor McDavid';
select 'snapshots', take_snapshots();
insert into player_games (game_id, player_id, date, stats)
  select 1, id, today_et(), '{"g":2,"a":1,"pm":2,"sog":5,"ppp":1,"hit":1,"blk":0,"pim":2,"gwg":1}' from players where name = 'Connor McDavid';
select 'mcdavid fpts (expect 7.2)', fpts from player_games where game_id = 1;
update league set season_start = today_et() - 1 where id = 1;
select 'standings', s.team_id, s.points, s.today, s.rank from standings s order by rank limit 3;

-- playoffs: a playoff game (type 03 in the NHL id) scores into the playoff table, not the regular one
insert into games (id, date, start_utc, home, away, state)
  select 2026030111, today_et(), now() - interval '1 hour', p.nhl_team, 'YYY', 'LIVE' from players p where p.name = 'Connor McDavid';
select 'playoff snapshots', take_snapshots();
insert into player_games (game_id, player_id, date, stats)
  select 2026030111, id, today_et(), '{"g":1,"a":1,"sog":3}' from players where name = 'Connor McDavid';
do $$
declare tm int := (select team_id from rosters where player_id = (select id from players where name = 'Connor McDavid'));
begin
  if (select game_type from games where id = 2026030111) <> 3 then raise exception 'playoff game not tagged'; end if;
  if (select points from playoff_standings where team_id = tm) <> 3.1 then
    raise exception 'playoff points wrong: %', (select points from playoff_standings where team_id = tm);
  end if;
  if (select points from standings where team_id = tm) <> 7.2 then
    raise exception 'regular standings picked up playoff points: %', (select points from standings where team_id = tm);
  end if;
end $$;
select 'playoff standings', team_id, points, rank from playoff_standings order by rank limit 2;
select pg_temp.as_team(5);
set role authenticated;
do $$ begin
  perform move_player((select id from players where name = 'Connor McDavid'), 'BN');
  raise exception 'locked player moved';
exception when others then if sqlerrm not like '%locked%' then raise; end if; end $$;
reset role;
select 'messages', count(*) from messages;
select body from messages where kind = 'system' order by id desc limit 6;
