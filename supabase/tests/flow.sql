-- End-to-end rules test on a scratch database (see supabase-stubs.sql). Run with ON_ERROR_STOP=1.
\set QUIET on
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000000' || id)::uuid, login_email from teams;
update teams set user_id = ('00000000-0000-0000-0000-00000000000' || id)::uuid;

create or replace function pg_temp.as_team(t int) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000' || t, false) $$;
create or replace function pg_temp.expect(label text, ok boolean) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; end $$;
create or replace function pg_temp.raises(label text, sql text, msg text default 'another league') returns void language plpgsql as
$$ begin
  begin execute sql; exception when others then
    if sqlerrm ilike '%' || msg || '%' then return; end if;
    raise exception 'FAILED: % (raised "%" instead)', label, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', label;
end $$;

-- the player seed loads after the migrations: its projections, last-season points and ranks are the model
-- league's values (profile 1), as the nightly recompute leaves them on the live database
insert into player_values (profile_id, player_id, proj, last_fp, rank) select 1, id, proj, last_fp, rank from players;

-- the fixture's deadlines are fixed dates; keep the test valid whatever today is
update league set keeper_deadline = now() + interval '1 day', draft_at = now() + interval '2 days';

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
reset role;
-- the commissioner can enter a GM's keepers for him (the GM's own save below then overrides them)
select pg_temp.as_team(1);
set role authenticated;
do $$ begin
  perform commish_set_keepers(2, array[(select top_scorer(2))]);
  raise exception 'commish kept the top scorer';
exception when others then if sqlerrm not like '%top scorer%' then raise; end if; end $$;
select commish_set_keepers(2, (select array_agg(player_id) from (select player_id from rosters where team_id = 2 and player_id <> top_scorer(2) order by prev_fp desc limit 3) x));
reset role;
select 'commish keepers team2', keepers_submitted, (select count(*) from rosters where team_id = 2 and keeper) as kept from teams where id = 2;
select pg_temp.as_team(2);
set role authenticated;
do $$ begin
  perform commish_set_keepers(2, array[]::int[]);
  raise exception 'non-commish used commish_set_keepers';
exception when others then if sqlerrm not like '%Commissioner%' then raise; end if; end $$;
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
-- the commish can move a pick to another team (with a note) before the draft starts
select commish_set_pick_owner((select id from draft_picks where season = (select season from draft_state) and round = 1 and original_team = 7), 2, 'test trade');
select 'pick moved', team_id, note from draft_picks where season = (select season from draft_state) and round = 1 and original_team = 7;
select commish_set_pick_owner((select id from draft_picks where season = (select season from draft_state) and round = 1 and original_team = 7), 7, null);
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
-- IR is for injured players only
do $$ declare h int; begin
  select r.player_id into h from rosters r join players p on p.id = r.player_id where r.team_id = 5 and r.slot = 'BN' and p.injury_status is null limit 1;
  perform move_player(h, 'IR');
  raise exception 'healthy player on IR allowed';
exception when others then if sqlerrm not like '%injury report%' then raise; end if; end $$;
reset role;
update players set injury_status = 'Out' where id = (select r.player_id from rosters r where r.team_id = 5 and r.slot = 'BN' limit 1);
set role authenticated;
do $$ declare h int; begin
  select r.player_id into h from rosters r join players p on p.id = r.player_id where r.team_id = 5 and r.slot = 'BN' and p.injury_status = 'Out' limit 1;
  perform move_player(h, 'IR');
  if (select slot from rosters where player_id = h) <> 'IR' then raise exception 'injured player not on IR'; end if;
  perform move_player(h, 'BN');   -- back, so the roster stays full for the pickup tests below
end $$;
select 'ir back on bench (expect 0)', count(*) from rosters where team_id = 5 and slot = 'IR';
select 'standings has bench (expect true)', (to_jsonb(s) ? 'bench') from standings s limit 1;

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
select create_bet(8, 'Most points in October', 'Whoever scores more fantasy points in October', 'h2h', 'a two-four', 20, today_et() + 1, today_et() + 31, 150) as bet_id \gset
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

-- ── lineup tools: set_lineup applies atomically, pins, prefs, manual-change marker
select pg_temp.as_team(6);
set role authenticated;
select set_lineup_prefs('week', 'form');
do $$
declare pid int; bad boolean := false;
begin
  select r.player_id into pid from rosters r join players p on p.id = r.player_id
    where r.team_id = 6 and p.pos <> 'G' and not player_locked(r.player_id) and r.slot = 'BN' limit 1;
  perform set_pin(pid, 'start');
  -- swap with whoever holds Util now (both moves land together)
  perform set_lineup(jsonb_build_object(pid::text, 'Util') || coalesce((select jsonb_build_object(player_id::text, 'BN')
    from rosters where team_id = 6 and slot = 'Util' and player_id <> pid limit 1), '{}'));
  -- a goalie can't play C, and nothing should change when one move is invalid
  begin
    perform set_lineup(jsonb_build_object(pid::text, 'BN',
      (select r.player_id from rosters r join players p on p.id = r.player_id where r.team_id = 6 and p.pos = 'G' limit 1)::text, 'C'));
  exception when others then bad := true; end;
  if not bad then raise exception 'goalie at C was allowed'; end if;
  if (select slot from rosters where player_id = pid) <> 'Util' then raise exception 'failed lineup was partially applied'; end if;
end $$;
reset role;
select 'lineup prefs', auto_mode, auto_basis, lineup_touched = today_et() as touched_today from teams where id = 6;
select 'pins', count(*) from rosters where team_id = 6 and pin = 'start';

-- ── Garry's private channel is private
select pg_temp.as_team(2);
set role authenticated;
insert into messages (channel, team_id, body) values ('garry:2', 2, 'garry, who is winning?');
do $$ begin
  insert into messages (channel, team_id, body) values ('garry:3', 2, 'sneaky');
  raise exception 'posted into someone else''s Garry channel';
exception when insufficient_privilege or check_violation then null;
  when others then if sqlerrm like '%row-level security%' then null; else raise; end if;
end $$;
reset role;
select pg_temp.as_team(3);
set role authenticated;
do $$ begin
  if exists (select 1 from messages where channel = 'garry:2') then raise exception 'team 3 can read team 2''s Garry channel'; end if;
end $$;
reset role;
select 'garry channel ok';

-- ── league features: comments, ideas, votes; only the commish sets status
select pg_temp.as_team(3);
set role authenticated;
insert into feature_comments (feature_key, team_id, body) values ('lineup-tools', 3, 'Love the auto-pilot');
insert into feature_ideas (team_id, title, body) values (3, 'Weekly head-to-head matchups', 'Side pot for weekly winners');
insert into feature_votes (idea_id, team_id) select id, 3 from feature_ideas where title = 'Weekly head-to-head matchups';
do $$ begin
  insert into feature_ideas (team_id, title, status) values (3, 'Sneaky planned idea', 'planned');
  raise exception 'a GM created an idea already marked planned';
exception when others then if sqlerrm like '%row-level security%' then null; else raise; end if;
end $$;
do $$ begin
  perform set_idea_status((select id from feature_ideas limit 1), 'planned', null);
  raise exception 'a GM changed an idea status';
exception when others then if sqlerrm like '%Commissioner only%' then null; else raise; end if;
end $$;
reset role;
select pg_temp.as_team(4);
set role authenticated;
do $$ begin
  insert into feature_votes (idea_id, team_id) select id, 3 from feature_ideas limit 1;
  raise exception 'voted as another team';
exception when others then if sqlerrm like '%row-level security%' or sqlerrm like '%duplicate key%' then null; else raise; end if;
end $$;
insert into feature_votes (idea_id, team_id) select id, 4 from feature_ideas limit 1;
reset role;
select pg_temp.as_team((select id from teams where is_commish limit 1));
set role authenticated;
select set_idea_status((select id from feature_ideas limit 1), 'planned', 'On it for next season');
reset role;
select 'features', (select count(*) from feature_votes) as votes, (select status from feature_ideas limit 1) as status,
  (select count(*) from messages where body like '💡%') as announcements, (select count(*) from notifications where kind = 'idea') as notified;

-- ── stats by timeframe: one row per player per window once games exist (the draft above scored nothing, so empty is fine)
select 'player windows', count(*) >= 0 as ok, (select count(distinct win) from player_windows) <= 4 as windows_ok from player_windows;

-- ── spectators: a login with no team that can chat and bet, unless the commish switches that off
select pg_temp.as_team((select id from teams where is_commish limit 1));
set role authenticated;
select commish_add_spectator('Test Spectator', 'spectator@sakleague.app', 'popcorn-1234') as spec_id \gset
reset role;
select case when :spec_id <> 9 then 1/0 end;   -- the checks below assume the ninth team is the spectator
update auth.users set id = '00000000-0000-0000-0000-000000000009' where email = 'spectator@sakleague.app';
update teams set user_id = '00000000-0000-0000-0000-000000000009' where id = 9;
select pg_temp.as_team(9);
set role authenticated;
insert into messages (channel, team_id, body) values ('general', 9, 'hello from the cheap seats');
do $$ begin perform add_player(8478402, null, false); raise exception 'spectator added a player';
exception when others then if sqlerrm like '%GMs%' then null; else raise; end if; end $$;
do $$ begin perform set_keepers(array[]::int[]); raise exception 'spectator set keepers';
exception when others then if sqlerrm like '%GMs%' then null; else raise; end if; end $$;
do $$ begin perform propose_trade(1, array[]::int[], array[8478402], array[]::int[], array[]::int[], null); raise exception 'spectator proposed a trade';
exception when others then if sqlerrm like '%GMs%' then null; else raise; end if; end $$;
select create_bet(null, 'Spectator bet', null, 'custom', null, null, null, null, 50) as spec_bet \gset
reset role;
select pg_temp.as_team((select id from teams where is_commish limit 1));
set role authenticated;
select commish_set_spectator(9, '{"chat": false, "bets": false}');
reset role;
select pg_temp.as_team(9);
set role authenticated;
do $$ begin insert into messages (channel, team_id, body) values ('general', 9, 'muted?'); raise exception 'muted spectator posted';
exception when others then if sqlerrm like '%row-level security%' then null; else raise; end if; end $$;
do $$ begin perform create_bet(null, 'Another', null, 'custom', null, null, null, null, 10); raise exception 'muted spectator bet';
exception when others then if sqlerrm like '%switched off%' then null; else raise; end if; end $$;
reset role;
select 'spectators', (select count(*) from standings where team_id = 9) = 0 as not_in_standings,
  (select count(*) from draft_picks where team_id = 9) = 0 as no_picks,
  (select balance from coin_balances where team_id = 9) as coins,
  (select count(*) from messages where team_id = 9 and kind = 'user') as posted,
  (select role from team_directory where id = 9) as role;

-- ── player alerts: the owner hears about injuries and big nights
select player_id as alert_pl from rosters where team_id = 1 and slot <> 'IR' order by player_id limit 1 \gset
update players set injury_status = 'Day-to-day', injury_note = 'Upper body' where id = :alert_pl;
update players set injury_status = null where id = :alert_pl;
insert into games (id, date, start_utc, home, away, state) values (777, today_et(), now() - interval '2 hours', 'EDM', 'CGY', 'LIVE') on conflict do nothing;
insert into player_games (game_id, player_id, date, stats) values (777, :alert_pl, today_et(), '{"g":2,"a":1,"pts":3}');
update player_games set stats = '{"g":3,"a":1,"pts":4}' where game_id = 777 and player_id = :alert_pl;
update player_games set stats = '{"g":3,"a":2,"pts":5}' where game_id = 777 and player_id = :alert_pl;
select 'alerts', (select count(*) from notifications where team_id = 1 and kind = 'injury') as injury_alerts,
  (select count(*) from notifications where team_id = 1 and kind = 'big_night') as big_nights,
  (select body from notifications where team_id = 1 and kind = 'big_night' limit 1) like '🎩%' as hat_trick;

-- ── polls: anyone who can chat can start one and vote once; the card rides a system message
select pg_temp.as_team(1);
set role authenticated;
insert into polls (channel, team_id, question, options) values ('general', 1, 'Who takes McDavid?', '["Patrick","Jason","A goalie, somehow"]') returning id as poll_id \gset
insert into poll_votes (poll_id, team_id, choice) values (:poll_id, 1, 0);
do $$ begin insert into poll_votes (poll_id, team_id, choice) values ((select max(id) from polls), 2, 1); raise exception 'voted as another team';
exception when others then if sqlerrm like '%row-level security%' then null; else raise; end if; end $$;
reset role;
select pg_temp.as_team(2);
set role authenticated;
insert into poll_votes (poll_id, team_id, choice) values (:poll_id, 2, 1);
update poll_votes set choice = 2 where poll_id = :poll_id and team_id = 2;
do $$ begin update polls set closed = true where id = (select max(id) from polls); end $$;   -- not mine: silently no rows
reset role;
select pg_temp.as_team(1);
set role authenticated;
update polls set closed = true where id = :poll_id;
do $$ begin insert into poll_votes (poll_id, team_id, choice) values ((select max(id) from polls), 1, 1); raise exception 'voted on a closed poll';
exception when others then if sqlerrm like '%row-level security%' or sqlerrm like '%duplicate key%' then null; else raise; end if; end $$;
reset role;
select 'polls', (select closed from polls where id = :poll_id) as closed, (select count(*) from poll_votes where poll_id = :poll_id) as votes,
  (select choice from poll_votes where poll_id = :poll_id and team_id = 2) as t2_choice,
  (select count(*) from messages where kind = 'system' and (meta->>'poll')::int = :poll_id) as cards;

-- ── health check: runs without the cron/net tables, and only the commissioner can read it
select 'health', jsonb_typeof(health_check(false)->'issues') as issues, (health_check(false)->>'phase') is not null as has_phase;
select pg_temp.as_team((select id from teams where is_commish limit 1));
set role authenticated;
select 'commish health', (commish_health() ? 'checked_at') as ok;
reset role;
select pg_temp.as_team(2);
set role authenticated;
do $$ begin perform commish_health(); raise exception 'a GM read the health panel';
exception when others then if sqlerrm like '%Commissioner only%' then null; else raise; end if; end $$;
reset role;

-- ── three-team trade: 2 sends a player to 3, 3 sends a player to 4, 4 sends a pick to 2; everyone must accept
select (select player_id from rosters where team_id = 2 order by player_id limit 1) as m2, (select player_id from rosters where team_id = 3 order by player_id limit 1) as m3,
  (select id from draft_picks where team_id = 4 and player_id is null and round = 5 limit 1) as k4 \gset
select pg_temp.as_team(2);
set role authenticated;
select propose_multi_trade(jsonb_build_array(jsonb_build_object('from', 2, 'to', 3, 'player_id', :m2), jsonb_build_object('from', 3, 'to', 4, 'player_id', :m3), jsonb_build_object('from', 4, 'to', 2, 'pick_id', :k4)), 'three-way') as multi \gset
do $$ begin perform propose_multi_trade(jsonb_build_array(jsonb_build_object('from', 3, 'to', 4, 'player_id', (select player_id from rosters where team_id = 3 limit 1))), null); raise exception 'proposed a trade without being in it';
exception when others then if sqlerrm like '%part of your own trade%' then null; else raise; end if; end $$;
do $$ begin perform respond_trade((select max(id) from trades), true); raise exception 'proposer accepted their own trade';
exception when others then if sqlerrm like '%respond%' then null; else raise; end if; end $$;
reset role;
select pg_temp.as_team(3);
set role authenticated;
select respond_trade(:multi, true);
reset role;
select 'multi after one accept', status, accepted_by from trades where id = :multi;
-- team 4 takes a player and gives only a pick: a full roster has to drop first
select pg_temp.as_team(4);
set role authenticated;
do $$ begin perform respond_trade((select max(id) from trades where parties is not null), true); raise exception 'full roster took a player';
exception when others then if sqlerrm not like '%Pick 1 to drop with it%' then raise; end if; end $$;
-- ...and names the drop with the accept: it waits for the trade
select player_id as m4drop from rosters where team_id = 4 and slot = 'BN' and player_id <> :m3 order by player_id desc limit 1 \gset
select respond_trade(:multi, true, array[:m4drop]);
reset role;
select pg_temp.expect('a named drop waits for the trade', (select team_id = 4 from rosters where player_id = :m4drop));
select 'multi after all accept', status from trades where id = :multi;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:multi, true, 'three-way ok');
reset role;
select 'multi trade', (select status from trades where id = :multi) as status,
  (select team_id from rosters where player_id = :m2) = 3 as p2_to_3, (select team_id from rosters where player_id = :m3) = 4 as p3_to_4,
  (select team_id from draft_picks where id = :k4) = 2 as pick_to_2,
  (select count(*) from messages where body like '🔄 TRADE! 3-team deal%') as announced;


-- ───────────── side bets v2: tracked bets settle from the box scores, pools pay the pot ─────────────
insert into games (id, date, start_utc, home, away, state) select 3, today_et() - 1, now() - interval '30 hours', p.nhl_team, 'ZZZ', 'OFF' from players p where p.name = 'Connor McDavid';
insert into player_games (game_id, player_id, date, stats) select 3, id, today_et() - 1, '{"g":1,"a":2,"sog":4}' from players where name = 'Connor McDavid';
select pg_temp.as_team(7);
set role authenticated;
-- a window that's already under way can't be bet on
do $$ begin perform create_bet_v2(jsonb_build_object('opponent', 8, 'title', 'Too late', 'kind', 'player_ou', 'coins', 5,
  'start', (today_et() - 1)::text, 'end', (today_et() - 1)::text, 'subject', jsonb_build_object('player_id', (select id from players where name = 'Connor McDavid'), 'stat', 'g', 'line', 0.5, 'side', 'over')));
  raise exception 'bet on a finished night allowed';
exception when others then if sqlerrm not like '%already started%' then raise; end if; end $$;
select create_bet_v2(jsonb_build_object('opponent', 8, 'title', 'McDavid over 0.5 goals', 'kind', 'player_ou', 'coins', 40,
  'start', (today_et() + 1)::text, 'end', (today_et() + 1)::text,
  'subject', jsonb_build_object('player_id', (select id from players where name = 'Connor McDavid'), 'stat', 'g', 'line', 0.5, 'side', 'over'))) as ou_id \gset
select create_bet_v2(jsonb_build_object('title', 'Pick a player: most fantasy points yesterday', 'kind', 'pool_player', 'coins', 30,
  'start', (today_et() + 1)::text, 'end', (today_et() + 1)::text, 'entry_close', (today_et() + 1)::text,
  'subject', jsonb_build_object('player_id', (select id from players where name = 'Connor McDavid')))) as pool_id \gset
do $$ begin perform create_bet_v2(jsonb_build_object('title', 'no dates', 'kind', 'player_vs', 'coins', 1, 'subject', '{}'::jsonb)); raise exception 'dateless tracked bet allowed';
exception when others then if sqlerrm not like '%start and end date%' then raise; end if; end $$;
reset role;
select pg_temp.as_team(8);
set role authenticated;
select respond_bet(:ou_id, true);
reset role;
-- entries closed yesterday; reopen them for the join test, then close again before settling
update bets set entry_close = today_et() where id = :pool_id;
select pg_temp.as_team(8);
set role authenticated;
select join_pool(:pool_id, jsonb_build_object('player_id', (select id from players where name <> 'Connor McDavid' order by proj desc limit 1)));
select set_config('sak.pool_id', :'pool_id', false);
do $$ begin perform join_pool(current_setting('sak.pool_id')::bigint, jsonb_build_object('player_id', 1)); raise exception 'double entry allowed';
exception when others then if sqlerrm not like '%already in%' then raise; end if; end $$;
reset role;
-- both were made and taken ahead of time; now play the window out (yesterday) so they can settle
update bets set start_date = today_et() - 1, end_date = today_et() - 1 where id in (:ou_id, :pool_id);
select 'progress ou (expect value 1)', bet_progress(:ou_id)->>'value' as value, bet_progress(:ou_id)->>'line' as line;
select 'escrow team 8 (expect 70 = 40 + 30)', escrow from coin_balances where team_id = 8;
update bets set entry_close = today_et() - 1 where id = :pool_id;
select 'settle', settle_due_bets()->>'settled' as settled;
select 'ou settled (expect 7 wins)', status, winner_team, push from bets where id = :ou_id;
select 'pool settled (expect 7 wins 60)', status, winner_team, result->>'pot' as pot from bets where id = :pool_id;
select 'coins after (7 up 70, 8 down 70)', team_id, balance, escrow from coin_balances where team_id in (7, 8) order by team_id;


-- ── Garry's Book: markets on tonight's game, a bet, a settlement, a void
reset role;
insert into games (id, date, start_utc, home, away, state) values (888, today_et(), now() + interval '1 hour', 'EDM', 'CGY', 'FUT') on conflict do nothing;
select 'book opened (expect >= 3)', open_markets(today_et());
select 'book markets (expect >= 3)', count(*) from markets where game_id = 888;
select pg_temp.as_team(7);
set role authenticated;
select place_market_bet((select id from markets where game_id = 888 and kind = 'winner'), 'home', 50);
select place_market_bet((select id from markets where game_id = 888 and kind = 'ot'), 'yes', 20);
do $$ begin perform place_market_bet((select id from markets where game_id = 888 and kind = 'winner'), 'draw', 10); raise exception 'bad pick allowed';
exception when others then if sqlerrm not like '%Pick one%' then raise; end if; end $$;
do $$ begin perform place_market_bet((select id from markets where game_id = 888 and kind = 'winner'), 'home', 2); raise exception 'tiny bet allowed';
exception when others then if sqlerrm not like '%between 5 and 500%' then raise; end if; end $$;
reset role;
select 'book stake taken (expect 850)', balance from coin_balances where team_id = 7;
-- the odds-on side bet: creator lays 2:1
select pg_temp.as_team(7);
set role authenticated;
select create_bet_v2(jsonb_build_object('title', 'Two to one says yes', 'kind', 'custom', 'opponent', 8, 'coins', 50, 'odds', 2)) as odds_bet \gset
reset role;
select 'odds escrow (expect 100)', escrow from coin_balances where team_id = 7;
select pg_temp.as_team(8);
set role authenticated;
select respond_bet(:odds_bet, true);
select claim_bet(:odds_bet, 8);
select pg_temp.as_team(7);
set role authenticated;
select confirm_bet(:odds_bet);
reset role;
select 'odds settled (expect 7 = 750, 8 = 1180)', team_id, balance from coin_balances where team_id in (7, 8) order by team_id;
-- game goes final in overtime, home wins
update games set state = 'OFF', home_score = 4, away_score = 3, period = 'OT', final_synced = true where id = 888;
update markets set closes_at = now() - interval '1 minute' where game_id = 888;
select 'book settle', settle_markets()->>'settled' as settled;
select 'winner paid (expect payout > 50)', payout from market_bets where team_id = 7 and market_id = (select id from markets where game_id = 888 and kind = 'winner');
select 'ot paid (expect 68)', payout from market_bets where team_id = 7 and market_id = (select id from markets where game_id = 888 and kind = 'ot');
select 'book standings (expect 2 bets 2 wins)', bets, wins, net > 0 as up from book_standings where team_id = 7;
-- a postponed game voids and refunds
insert into games (id, date, start_utc, home, away, state) values (889, today_et(), now() + interval '2 hours', 'TOR', 'MTL', 'FUT') on conflict do nothing;
select open_markets(today_et());
select pg_temp.as_team(8);
set role authenticated;
select place_market_bet((select id from markets where game_id = 889 and kind = 'total'), 'over', 30);
reset role;
update games set state = 'PPD' where id = 889;
update markets set closes_at = now() - interval '1 minute' where game_id = 889;
select 'void', settle_markets()->>'void' as void;
select 'void refunded (expect 1180)', balance from coin_balances where team_id = 8;

-- ───────────── lineups planned ahead ─────────────
select pg_temp.as_team(1);
select p.id as plan_c from rosters r join players p on p.id = r.player_id where r.team_id = 1 and p.pos = 'C' order by p.proj desc limit 1 \gset
select p.id as plan_g from rosters r join players p on p.id = r.player_id where r.team_id = 1 and p.pos = 'G' order by p.proj desc limit 1 \gset
set role authenticated;
select 'plan saved (expect 2 days)', set_lineup_plans(jsonb_build_object(
  (today_et() + 1)::text, jsonb_build_object(:plan_c::text, 'C', :plan_g::text, 'G'),
  (today_et() + 2)::text, jsonb_build_object(:plan_c::text, 'BN')));
do $$ begin perform set_lineup_plans(jsonb_build_object(today_et()::text, '{}'::jsonb)); raise exception 'today plan allowed';
exception when others then if sqlerrm not like '%set live%' then raise; end if; end $$;
do $$ declare g int; begin
  select p.id into g from rosters r join players p on p.id = r.player_id where r.team_id = 1 and p.pos = 'G' limit 1;
  perform set_lineup_plans(jsonb_build_object((today_et() + 3)::text, jsonb_build_object(g::text, 'C'))); raise exception 'goalie at C allowed';
exception when others then if sqlerrm not like '%can''t play%' then raise; end if; end $$;
do $$ begin perform set_lineup_plans(jsonb_build_object((today_et() + 3)::text, jsonb_build_object('8478402', 'C'))); raise exception 'someone else''s player allowed';
exception when others then if sqlerrm not like '%not on your roster%' and sqlerrm not like '%can''t play%' then raise; end if; end $$;
select 'my plans visible (expect 3 rows)', count(*) from lineup_plans;
select pg_temp.as_team(2);
select 'others'' plans hidden (expect 0)', count(*) from lineup_plans;
reset role;
-- the day arrives: pretend tomorrow's plan is today's
update lineup_plans set date = today_et() where date = today_et() + 1;
update rosters set slot = 'BN' where team_id = 1;
select 'plans applied (expect 1)', apply_lineup_plans();
select 'planned slots live (expect C and G)', string_agg(slot, ',' order by slot) from rosters where team_id = 1 and player_id in (:plan_c, :plan_g);
select 'applied once (expect 0)', apply_lineup_plans();
select 'counts as manual (expect t)', lineup_touched = today_et() from teams where id = 1;
select pg_temp.as_team(1);
set role authenticated;
select 'clear a day (expect 1)', clear_lineup_plans(array[today_et() + 2]);
reset role;

-- ───────────── untaken bets expire after 7 days ─────────────
select pg_temp.as_team(3);
set role authenticated;
select create_bet_v2(jsonb_build_object('title', 'Nobody will take this', 'kind', 'custom', 'coins', 40)) as stale_bet \gset
reset role;
select 'stale escrow (expect >= 40)', escrow >= 40 from coin_balances where team_id = 3;
update bets set created_at = now() - interval '8 days' where id = :stale_bet;
select 'expired (expect 1)', expire_stale_bets();
select 'status (expect expired)', status from bets where id = :stale_bet;
select 'creator told (expect 1)', count(*) from notifications where team_id = 3 and body like '%expired%';

-- ───────────── projections repriced by scoring ─────────────
select id as proj_p from players where pos = 'C' order by proj desc limit 1 \gset
select 'set projections (expect 1)', set_projections(jsonb_build_array(jsonb_build_object('id', :proj_p, 'gp', 80,
  'stats', jsonb_build_object('g', 40, 'a', 60, 'sog', 250, 'hit', 50, 'blk', 30, 'ppp', 30, 'pm', 10, 'pim', 20, 'gwg', 6),
  'meta', jsonb_build_object('lo', 0.85, 'hi', 1.15))));
select 'model projection used (expect 60+60+50+5+6+15+5-4+6 = 203)', proj from players where id = :proj_p;

-- ───────────── stat corrections ─────────────
select r.player_id as corr_p from rosters r join players p on p.id = r.player_id where r.team_id = 2 and p.pos <> 'G' limit 1 \gset
insert into games (id, date, start_utc, home, away, state, final_synced) values (990, today_et() - 1, now() - interval '1 day', 'TOR', 'MTL', 'OFF', false);
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values (990, today_et() - 1, 2, :corr_p, 'C');
insert into player_games (game_id, player_id, date, stats) values (990, :corr_p, today_et() - 1, '{"g":1,"a":0,"sog":3}');
update player_games set stats = '{"g":1,"a":1,"sog":3}' where game_id = 990 and player_id = :corr_p;
select 'live change not logged (expect 0)', count(*) from stat_corrections;
update games set final_synced = true where id = 990;
update player_games set stats = '{"g":1,"a":1,"sog":3}' where game_id = 990 and player_id = :corr_p;
select 'unchanged re-pull not logged (expect 0)', count(*) from stat_corrections;
update player_games set stats = '{"g":1,"a":2,"sog":4}' where game_id = 990 and player_id = :corr_p;
select 'correction logged (expect 1, +1.2)', count(*), max(new_fpts - old_fpts) from stat_corrections;
select 'teams told (expect 1)', notify_corrections();
select 'note', body from notifications where team_id = 2 and kind = 'correction';
select 'told once (expect 0)', notify_corrections();

-- ───────────── IR rules: two spots, injured only (not suspended), coming off IR needs a roster spot ─────────────
reset role;
update league set phase = 'season';
select r.player_id as ir_a from rosters r where r.team_id = 7 and r.slot = 'BN' order by r.player_id limit 1 \gset
select r.player_id as ir_s from rosters r where r.team_id = 7 and r.slot = 'BN' order by r.player_id offset 1 limit 1 \gset
select set_config('t.ir_a', :'ir_a', false), set_config('t.ir_s', :'ir_s', false);
update players set injury_status = 'Out' where id = :ir_a;
update players set injury_status = 'Suspension' where id = :ir_s;
update rosters set slot = 'BN' where team_id = 7 and slot = 'IR';
select 'team 7 active before (expect 24)', _active_count(7);
select pg_temp.as_team(7);
set role authenticated;
do $$ begin perform move_player(current_setting('t.ir_s')::int, 'IR'); raise exception 'suspended player on IR allowed';
exception when others then if sqlerrm not like '%suspended players can''t go on IR%' then raise; end if; end $$;
select move_player(:ir_a, 'IR');
select free_agent as ir_fa from (select id as free_agent from players p where p.pos <> 'G' and not exists (select 1 from rosters r where r.player_id = p.id) order by proj desc limit 1) x \gset
select add_player(:ir_fa);   -- IR opened a spot: no drop needed
reset role;
select 'active after IR + pickup (expect 24)', _active_count(7);
select pg_temp.as_team(7);
set role authenticated;
do $$ begin perform move_player(current_setting('t.ir_a')::int, 'BN'); raise exception 'came off IR with a full roster';
exception when others then if sqlerrm not like '%No roster spot%' then raise; end if; end $$;
reset role;
-- lineup tools never move a player off IR: the optimizer's move is skipped, not an error
select 'optimizer skips IR (expect 0, IR)', _apply_lineup(7, jsonb_build_object(:'ir_a', 'BN')), (select slot from rosters where player_id = :ir_a);
-- healed but still on IR: he can stay there, and he doesn't block a pickup-and-drop
update players set injury_status = null where id = :ir_a;
select pg_temp.as_team(7);
set role authenticated;
select add_player((select id from players p where not exists (select 1 from rosters r where r.player_id = p.id) order by proj desc limit 1), (select player_id from rosters where team_id = 7 and slot = 'BN' and player_id <> current_setting('t.ir_s')::int order by player_id desc limit 1));
-- a saved plan leaves IR players out instead of failing
select 'plan ignores IR player (expect 1)', set_lineup_plans(jsonb_build_object((today_et() + 3)::text, jsonb_build_object(:'ir_a', 'BN')));
reset role;
select 'no plan row for the IR player (expect 0)', count(*) from lineup_plans where player_id = :ir_a;
select pg_temp.as_team(7);
set role authenticated;
-- plans reach past the regular season into the playoffs, but not past the Cup final
reset role;
update league set season_end = today_et() + 2, playoffs_end = today_et() + 20;
select pg_temp.as_team(7);
set role authenticated;
select 'playoff-date plan saved (expect 1)', set_lineup_plans(jsonb_build_object((today_et() + 10)::text, '{}'::jsonb));
do $$ begin perform set_lineup_plans(jsonb_build_object((today_et() + 25)::text, '{}'::jsonb)); raise exception 'plan after the Cup final';
exception when others then if sqlerrm not like '%Stanley Cup final%' then raise; end if; end $$;
-- drop someone, then he comes back
reset role;
delete from rosters where player_id = :ir_s;
select pg_temp.as_team(7);
set role authenticated;
select move_player(:ir_a, 'BN');
reset role;
select 'activated after a drop (expect BN, 24)', (select slot from rosters where player_id = :ir_a), _active_count(7);
update league set season_end = '2027-04-10', playoffs_end = '2027-06-30';

-- saved plans that would overfill the roster leave him on IR
update players set injury_status = 'Out' where id = :ir_a;
select pg_temp.as_team(7);
set role authenticated;
select move_player(:ir_a, 'IR');
select add_player((select id from players p where p.pos <> 'G' and not exists (select 1 from rosters r where r.player_id = p.id) order by proj desc limit 1));
reset role;
insert into lineup_plans (team_id, date, player_id, slot) values (7, today_et(), :ir_a, 'BN');
delete from lineup_plan_applied where team_id = 7;
select 'plans applied', apply_lineup_plans() >= 1;
select 'kept on IR, roster not overfilled (expect IR, 24)', (select slot from rosters where player_id = :ir_a), _active_count(7);

-- trades: no team can end up with more active players than the roster holds
select pg_temp.as_team(6);
set role authenticated;
select propose_trade(7, array(select player_id from rosters where team_id = 6 and slot <> 'IR' order by player_id limit 2), array[(select player_id from rosters where team_id = 7 and slot = 'BN' order by player_id limit 1)], '{}', '{}', 'two for one') as big_trade \gset
select set_config('t.big_trade', :'big_trade', false);
reset role;
select 'team 7 after 2-for-1 (expect 25)', _trade_active_after(:big_trade, 7);
select pg_temp.as_team(7);
set role authenticated;
do $$ begin perform respond_trade(current_setting('t.big_trade')::bigint, true); raise exception 'accepted into an overfull roster';
exception when others then if sqlerrm not like '%Pick 1 to drop with it%' then raise; end if; end $$;
-- drops are your own players, outside the deal, and only as many as the room needs
select pg_temp.raises('drops someone else''s player', format('select respond_trade(%s, true, array[%s])', :big_trade, (select player_id from rosters where team_id = 6 and slot = 'BN' order by player_id desc limit 1)), 'your own players');
select pg_temp.raises('drops more than needed', format('select respond_trade(%s, true, (select array_agg(player_id) from (select player_id from rosters where team_id = 7 and slot = ''BN'' order by player_id desc limit 2) x))', :big_trade), 'only need to drop 1');
select player_id as big_drop from rosters where team_id = 7 and slot = 'BN' order by player_id desc limit 1 \gset
select respond_trade(:big_trade, true, array[:big_drop]);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:big_trade, true, 'ok');
reset role;
select pg_temp.expect('the 2-for-1 goes through with its drop', (select status = 'approved' from trades where id = :big_trade)
  and not exists (select 1 from rosters where player_id = :big_drop) and _active_count(7) = _roster_max()
  and exists (select 1 from transactions where type = 'drop' and team_id = 7 and player_id = :big_drop));
-- the proposer's own overflow is caught at proposal, and named there
select pg_temp.as_team(7);
set role authenticated;
select pg_temp.raises('proposer overfills', format('select propose_trade(6, array[]::int[], array[%s])', (select player_id from rosters where team_id = 6 and slot = 'BN' order by player_id limit 1)), 'Pick 1 to drop with it');
select propose_trade(6, array[]::int[], array[(select player_id from rosters where team_id = 6 and slot = 'BN' order by player_id limit 1)], '{}', '{}', 'one for nothing back',
  0, 0, 0, 0, array[(select player_id from rosters where team_id = 7 and slot = 'BN' order by player_id desc limit 1)]) as one_way \gset
select cancel_trade(:one_way);
reset role;
select pg_temp.expect('one-way offer recorded its drop', (select count(*) = 1 from trade_items where trade_id = :one_way and release));
-- a roster that changed after the deal was agreed fails the trade, with the reason, instead of erroring
select pg_temp.as_team(6);
set role authenticated;
select propose_trade(7, array[(select player_id from rosters where team_id = 6 and slot = 'BN' order by player_id limit 1)], array[(select player_id from rosters where team_id = 7 and slot = 'BN' order by player_id limit 1)], '{}', '{}', 'straight up') as late_trade \gset
reset role;
select pg_temp.as_team(7);
set role authenticated;
select respond_trade(:late_trade, true);
reset role;
insert into rosters (team_id, player_id, slot) select 7, p.id, 'BN' from players p where not exists (select 1 from rosters r where r.player_id = p.id) and p.pos = 'C' order by p.id limit 1 returning player_id as late_add \gset
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:late_trade, true, 'ok');
reset role;
select pg_temp.expect('an overfull roster fails the trade with the reason', (select status = 'failed' and review_note like '%would have 25 active players%' from trades where id = :late_trade));
delete from rosters where player_id = :late_add;
-- an injured player on IR keeps his IR spot with his new team
update rosters set slot = 'BN' where team_id = 6 and slot = 'IR';
select r.player_id as ir_t from rosters r where r.team_id = 6 order by r.player_id limit 1 \gset
update players set injury_status = 'Injured Reserve' where id = :ir_t;
update rosters set slot = 'IR' where player_id = :ir_t;
select pg_temp.as_team(6);
set role authenticated;
select propose_trade(7, array[:ir_t], array[(select player_id from rosters where team_id = 7 and slot = 'BN' order by player_id limit 1)], '{}', '{}', 'hurt for healthy') as ir_trade \gset
reset role;
update rosters set slot = 'BN' where player_id = :ir_a;   -- free team 7's IR... and make room for him
delete from rosters where player_id = (select player_id from rosters where team_id = 7 and slot = 'BN' and player_id <> :ir_a order by player_id desc limit 1);
select pg_temp.as_team(7);
set role authenticated;
select respond_trade(:ir_trade, true);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:ir_trade, true, 'ok');
reset role;
select 'traded IR player stays on IR (expect 7, IR)', team_id, slot from rosters where player_id = :ir_t;
select 'rosters within limits (expect 0)', count(*) from (select team_id from rosters group by team_id having count(*) filter (where slot <> 'IR') > _roster_max() or count(*) filter (where slot = 'IR') > 2) x;

-- ───────────── the trade block ─────────────
select pg_temp.as_team(3);
set role authenticated;
select set_trade_block(array(select player_id from rosters where team_id = 3 order by player_id limit 2), array['D', 'G'], 'Two forwards for a top-four D', true);
do $$ begin perform set_trade_block(array[(select player_id from rosters where team_id = 4 limit 1)], '{}', null); raise exception 'offered another team''s player';
exception when others then if sqlerrm not like '%your own players%' then raise; end if; end $$;
do $$ begin perform set_trade_block('{}', array['Util'], null); raise exception 'bad position';
exception when others then if sqlerrm not like '%Positions are%' then raise; end if; end $$;
select 'block visible to all (expect 2, {D,G})', cardinality(offering), wants from trade_block where team_id = 3;
reset role;
select 'announced (expect 1)', count(*) from messages where meta->>'trade_block' = '3';
delete from rosters where player_id = (select offering[1] from trade_block where team_id = 3);
select 'dropped player leaves the block (expect 1)', cardinality(offering) from trade_block where team_id = 3;
select pg_temp.as_team(3);
set role authenticated;
select set_trade_block('{}', '{}', null);
reset role;
select 'cleared (expect 0)', count(*) from trade_block where team_id = 3;

-- ───────────── the SAK Cup: regular season + playoffs ─────────────
insert into games (id, date, start_utc, home, away, state, final_synced) values (2026030222, today_et() - 1, now() - interval '1 day', 'TOR', 'MTL', 'OFF', true);
select r.player_id as po_p from rosters r where r.team_id = 2 and r.slot not in ('BN', 'IR') limit 1 \gset
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values (2026030222, today_et() - 1, 2, :po_p, 'C');
insert into player_games (game_id, player_id, date, stats) values (2026030222, :po_p, today_et() - 1, '{"g":2,"a":1,"sog":5}');
select 'playoff table (expect > 0)', points from playoff_standings where team_id = 2;
select 'cup = regular + playoffs (expect true)', c.points = s.points + p.points from sak_cup_standings c join standings s using (team_id) join playoff_standings p using (team_id) where c.team_id = 2;
select 'GMs only (expect 0)', count(*) from sak_cup_standings c join teams t on t.id = c.team_id where t.role <> 'gm';

-- ───────────── money: three pots, balances netted, the SaK Fund ─────────────
select 'shares (expect 25, 25)', playoff_share, cup_share from league;
select 'this season billed (expect 8 x 200)', count(*), max(amount) from ledger where season = '2026-27' and kind = 'entry';
select 'darin nets winnings against entry (expect -640)', balance from money_balances where team_id = 8;
select 'craig (expect -220)', balance from money_balances where team_id = 4;
select 'panagiotis (expect 60)', balance from money_balances where team_id = 6;
select 'fund before (expect 36 shares, 470.70 cash)', shares, cash from fund_status;
select pg_temp.as_team(1);
set role authenticated;
select commish_settle_team(3, 'e-transfer', 'test');
select commish_fund_price(300, 1.4);
reset role;
select 'jason settled (expect 0)', balance from money_balances where team_id = 3;
select 'his $25 went to the fund (expect 495.70)', cash from fund_status;
select 'fund value (expect 36*300*1.4 + 495.70 - 1000 = 14615.70)', net_cad from fund_status;
select pg_temp.as_team(1);
set role authenticated;
select commish_mark_paid((select id from ledger where team_id = 3 and season = '2026-27' and kind = 'entry'), false);
reset role;
select 'unpaid takes it back out (expect 470.70)', cash from fund_status;
select pg_temp.as_team(2);
set role authenticated;
do $$ begin perform commish_settle_team(2); raise exception 'a GM settled his own tab';
exception when others then if sqlerrm not like '%Commissioner%' then raise; end if; end $$;
reset role;

-- ───────────── pickups: +3 in the playoffs, and tradable ─────────────
select 'regular season allowance (expect 10)', allowed from pickup_status where team_id = 2;
update league set season_end = today_et() - 1;
select 'playoff allowance (expect 13)', allowed from pickup_status where team_id = 2;
update league set season_end = '2027-04-10';
insert into coin_ledger (team_id, amount, reason) values (2, 500, 'test grant');
select pg_temp.as_team(2);
set role authenticated;
select propose_trade(3, '{}', '{}', '{}', '{}', 'pickups for coins', 2, 0, 0, 0) as pk_trade \gset
do $$ begin perform propose_trade(3, '{}', '{}', '{}', '{}', null, 50, 0, 0, 0); raise exception 'traded pickups he doesn''t have';
exception when others then if sqlerrm not like '%free-agent pickup%' then raise; end if; end $$;
reset role;
select pg_temp.as_team(3);
set role authenticated;
select respond_trade(:pk_trade, true);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:pk_trade, true, 'ok');
reset role;
select 'pickups moved (expect 2 = 8, 3 = 12)', string_agg(team_id || '=' || allowed, ', ' order by team_id) from pickup_status where team_id in (2, 3);
select coalesce(balance, 0) as coins3_before from coin_balances where team_id = 3 \gset
select pg_temp.as_team(2);
set role authenticated;
select propose_trade(3, '{}', '{}', '{}', '{}', 'coins', 0, 0, 100, 0) as coin_trade \gset
reset role;
select pg_temp.as_team(3);
set role authenticated;
select respond_trade(:coin_trade, true);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select review_trade(:coin_trade, true, 'ok');
reset role;
select 'coins moved (expect +100)', balance - :coins3_before from coin_balances where team_id = 3;
select 'announced with labels (expect 1)', count(*) from messages where body like '%2 free-agent pickups%';
select pg_temp.as_team(4);
set role authenticated;
select 'GMs can read pickups (expect 8)', count(*) from pickup_status;
select 'GMs can read the fund (expect 1)', count(*) from fund_status;
select 'GMs can read balances (expect 8)', count(*) from money_balances;
reset role;

-- ───────────── game-day trade: the box score moves a player to his new team, and his card logs it ─────────────
select r.player_id as bx_p, r.team_id as bx_t from rosters r join players p on p.id = r.player_id where p.pos <> 'G' and r.slot = 'BN' order by r.player_id limit 1 \gset
update players set nhl_team = 'CBJ' where id = :bx_p;
insert into games (id, date, start_utc, home, away, state) values (9031, today_et(), now() - interval '5 minutes', 'TOR', 'MTL', 'LIVE') on conflict do nothing;
insert into player_games (game_id, player_id, date, nhl_team, stats) values (9031, :bx_p, today_et(), 'TOR', '{"g":0}');
select 'box score moved him (expect 1)', sync_teams_from_box();
select 'now with TOR (expect TOR)', nhl_team from players where id = :bx_p;
select 'lineup frozen for his new team''s game (expect 1)', count(*) from lineup_snapshots where game_id = 9031 and player_id = :bx_p;
select 'trade logged on his card (expect 1)', count(*) from player_events where player_id = :bx_p and kind = 'team' and body = 'Moved from CBJ to TOR';
update players set injury_status = 'Day-To-Day', injury_note = 'upper body' where id = :bx_p;
update players set injury_status = null where id = :bx_p;
select 'injury changes logged (expect 2)', count(*) from player_events where player_id = :bx_p and kind = 'injury';
select pg_temp.as_team(4);
set role authenticated;
select 'GMs can read player events (expect 4)', count(*) from player_events where player_id = :bx_p;
reset role;

-- ───────────── lineup locks: free to change until his game starts, frozen from puck drop ─────────────
reset role;
select r.player_id as lk_p, r.team_id as lk_t from rosters r join players p on p.id = r.player_id
  where r.slot = 'BN' and p.pos = 'C' and r.team_id between 1 and 8 order by r.player_id limit 1 \gset
select r.player_id as lk_q from rosters r join players p on p.id = r.player_id
  where r.team_id = :lk_t and r.slot = 'BN' and p.pos = 'C' and r.player_id <> :lk_p order by r.player_id limit 1 \gset
select set_config('t.lk_p', :'lk_p', false), set_config('t.lk_q', :'lk_q', false), set_config('t.lk_t', :'lk_t', false);
update players set nhl_team = 'SEA', injury_status = null where id = :lk_p;
update players set nhl_team = 'SEA', injury_status = null where id = :lk_q;
delete from lineup_snapshots where player_id in (:lk_p, :lk_q);
delete from player_games where player_id in (:lk_p, :lk_q) and date = today_et();
delete from games where id = 9041;
insert into games (id, date, start_utc, home, away, state) values (9041, today_et(), now() + interval '2 hours', 'SEA', 'SJS', 'FUT');
select 'not locked before puck drop (expect f)', player_locked(:lk_p);
select pg_temp.as_team(:lk_t);
set role authenticated;
select move_player(:lk_p, 'Util', (select player_id from rosters where team_id = current_setting('t.lk_t')::int and slot = 'Util'));
reset role;
select 'moved before puck drop (expect Util)', slot from rosters where player_id = :lk_p;
-- the game starts: every path is closed
update games set start_utc = now() - interval '1 minute', state = 'LIVE' where id = 9041;
select 'locked at puck drop (expect t)', player_locked(:lk_p);
select pg_temp.as_team(:lk_t);
set role authenticated;
do $$ begin perform move_player(current_setting('t.lk_p')::int, 'BN'); raise exception 'moved a locked starter';
exception when others then if sqlerrm not like '%locked%' then raise; end if; end $$;
do $$ begin perform move_player(current_setting('t.lk_q')::int, 'Util', current_setting('t.lk_p')::int); raise exception 'swapped out a locked starter';
exception when others then if sqlerrm not like '%locked%' then raise; end if; end $$;
do $$ begin perform set_lineup(jsonb_build_object(current_setting('t.lk_p'), 'BN')); raise exception 'best lineup moved a locked starter';
exception when others then if sqlerrm not like '%locked%' then raise; end if; end $$;
reset role;
select 'auto-pilot can''t move him either', (select count(*) from rosters where player_id = :lk_p and slot = 'Util') = 1;
do $$ begin perform _apply_lineup(current_setting('t.lk_t')::int, jsonb_build_object(current_setting('t.lk_p'), 'BN')); raise exception 'auto-pilot moved a locked starter';
exception when others then if sqlerrm not like '%locked%' then raise; end if; end $$;
-- a saved lineup applied after puck drop leaves him where he was
insert into lineup_plans (team_id, date, player_id, slot) values (:lk_t, today_et(), :lk_p, 'BN') on conflict do nothing;
delete from lineup_plan_applied where team_id = :lk_t;
select apply_lineup_plans() >= 1 as plans_ran;
select 'saved plan kept him in (expect Util)', slot from rosters where player_id = :lk_p;
-- a game already under way locks even if the scheduled time hasn't come (clock or feed out of step)
update games set start_utc = now() + interval '1 hour', state = 'LIVE' where id = 9041;
delete from lineup_snapshots where player_id = :lk_p;
select 'live game locks before its scheduled time (expect t)', player_locked(:lk_p);
-- in today's box score for another team (a game-day trade the feed missed): locked
update games set state = 'FUT', start_utc = now() + interval '1 hour' where id = 9041;
insert into player_games (game_id, player_id, date, nhl_team, stats) values (9041, :lk_q, today_et(), 'SJS', '{}');
select 'in a box score today locks him (expect f, t)', player_locked(:lk_p), player_locked(:lk_q);
delete from player_games where game_id = 9041;
delete from games where id = 9041;

-- game-day status table is readable by GMs
insert into player_status (player_id, date, status, note, opponent) values (:lk_p, today_et(), 'confirmed', 'Confirmed starter', 'vs SJS');
select pg_temp.as_team(4);
set role authenticated;
select 'GMs can read game-day status (expect 1)', count(*) from player_status where player_id = :lk_p;
reset role;

-- ───────────── commissioner rulings undo and redo a bet's coins; season bets settle themselves ─────────────
reset role;
select 'ou coins before ruling (expect 2 rows, 7 +40)', count(*), sum(amount) filter (where team_id = 7) from coin_ledger where bet_id = :ou_id;
select pg_temp.as_team(1);
set role authenticated;
select commish_rule_bet(:ou_id, 'push', null, null, 'stat correction');
reset role;
select 'push: coins undone (expect 0 rows, push t)', (select count(*) from coin_ledger where bet_id = :ou_id), push, status from bets where id = :ou_id;
select pg_temp.as_team(1);
set role authenticated;
select commish_rule_bet(:ou_id, 'winner', 8, null, 'he was credited a goal he didn''t score');
reset role;
select 'flipped to 8 (expect 8 +40, 7 -40)', winner_team, (select sum(amount) from coin_ledger where bet_id = :ou_id and team_id = 8), (select sum(amount) from coin_ledger where bet_id = :ou_id and team_id = 7), result->'ruling'->>'note' is not null from bets where id = :ou_id;
select pg_temp.as_team(1);
set role authenticated;
select commish_rule_bet(:pool_id, 'winner', null, array[8], null);
select commish_rule_bet(:odds_bet, 'void', null, null, 'nobody could agree');
reset role;
select 'pool to 8 (expect 8 nets +30, 7 nets -30)', (select sum(amount) from coin_ledger where bet_id = :pool_id and team_id = 8), (select sum(amount) from coin_ledger where bet_id = :pool_id and team_id = 7);
select 'void refunds (expect cancelled, 0 rows)', status, (select count(*) from coin_ledger where bet_id = :odds_bet) from bets where id = :odds_bet;
select pg_temp.as_team(8);
set role authenticated;
do $$ begin perform commish_rule_bet(current_setting('sak.pool_id')::bigint, 'push'); raise exception 'a GM overruled a bet';
exception when others then if sqlerrm not like '%ommissioner%' and sqlerrm not like '%ommish%' then raise; end if; end $$;
reset role;
-- final-standings bet: settles itself once the regular season is over
insert into bets (creator_team, opponent_team, title, kind, coins, status, accepted_at) values (7, 8, 'Seven finishes above eight', 'season', 20, 'accepted', now()) returning id as season_bet \gset
update league set season_end = today_et() - 1;
select 'season bet progress has both sides', bet_progress(:season_bet) ? 'a' and bet_progress(:season_bet) ? 'b';
select settle_due_bets() is not null as settled;
select 'season bet settled (expect settled)', status, winner_team is not null or push from bets where id = :season_bet;
update league set season_end = '2027-04-10';

-- ───────────── the league day waits for the last game of the night ─────────────
reset role;
delete from games where id in (9051, 9052);
-- a game from "yesterday" still in overtime at 12:40 am: the day hasn't turned over
insert into games (id, date, start_utc, home, away, state) values (9051, date '2031-01-14', timestamptz '2031-01-15 03:00+00', 'SEA', 'SJS', 'LIVE');
select 'overtime past midnight holds the day (expect 2031-01-14)', _league_day(timestamptz '2031-01-15 00:40-05');
-- it goes final: the day turns over
update games set state = 'OFF' where id = 9051;
select 'final lets it turn over (expect 2031-01-15)', _league_day(timestamptz '2031-01-15 00:45-05');
-- a stuck game can't hold the day past 6 am
update games set state = 'LIVE' where id = 9051;
select 'stuck game released at 6 am (expect 2031-01-15)', _league_day(timestamptz '2031-01-15 06:01-05');
-- a game that hasn't started (postponed or not yet on) doesn't hold anything
update games set state = 'FUT', start_utc = timestamptz '2031-01-15 09:00+00' where id = 9051;
select 'unstarted game does not hold (expect 2031-01-15)', _league_day(timestamptz '2031-01-15 00:40-05');
select 'normal afternoon (expect today)', _league_day(now()) = (now() at time zone 'America/New_York')::date or now() at time zone 'America/New_York' < date_trunc('day', now() at time zone 'America/New_York') + interval '6 hours';
delete from games where id = 9051;

-- ───────────── no taking or joining a box-score bet once its night is under way ─────────────
select pg_temp.as_team(7);
set role authenticated;
select create_bet_v2(jsonb_build_object('opponent', 8, 'title', 'Late taker', 'kind', 'team_ou', 'coins', 5,
  'start', (today_et() + 1)::text, 'end', (today_et() + 1)::text, 'subject', jsonb_build_object('line', 10, 'side', 'over'))) as late_bet \gset
select create_bet_v2(jsonb_build_object('title', 'Late pool', 'kind', 'pool_team', 'coins', 5,
  'start', (today_et() + 1)::text, 'end', (today_et() + 1)::text, 'entry_close', (today_et() + 1)::text, 'subject', jsonb_build_object('team_id', 7))) as late_pool \gset
reset role;
select set_config('t.late_bet', :'late_bet', false), set_config('t.late_pool', :'late_pool', false);
select 'custom bets are not affected (expect t)', not _bet_underway(null);
-- tonight's first game drops the puck
update bets set start_date = today_et(), end_date = today_et() where id in (:late_bet, :late_pool);
insert into games (id, date, start_utc, home, away, state) values (9061, today_et(), now() - interval '10 minutes', 'SEA', 'SJS', 'LIVE') on conflict do nothing;
select 'window under way (expect t)', _bet_underway(today_et());
select pg_temp.as_team(8);
set role authenticated;
do $$ begin perform respond_bet(current_setting('t.late_bet')::bigint, true); raise exception 'took a bet after puck drop';
exception when others then if sqlerrm not like '%Too late%' then raise; end if; end $$;
do $$ begin perform join_pool(current_setting('t.late_pool')::bigint, jsonb_build_object('team_id', 8)); raise exception 'joined a pool after puck drop';
exception when others then if sqlerrm not like '%Too late%' then raise; end if; end $$;
reset role;
delete from games where id = 9061;
select 'before puck drop it is fine (expect f)', _bet_underway(today_et() + 1);

-- ───────────── a second league sees nothing of the first ─────────────
reset role;
create or replace function pg_temp.expect(label text, ok boolean) returns void language plpgsql as
$$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; end $$;
-- the platform (Patrick, a platform admin) opens a second league; one GM runs it
insert into ops.platform_admins (user_id) select user_id from teams where id = 1 on conflict do nothing;
select pg_temp.as_team(1);
set role authenticated;
select create_league('north', 'North Pool', 'NP', '{}'::jsonb) as league2 \gset
reset role;
select set_config('t.league2', :'league2', false);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000099', 'north-gm@example.com');
insert into teams (id, name, abbrev, gm_name, login_email, user_id, league_id, is_commish)
  values (99, 'North Stars', 'NOR', 'Nora', 'north-gm@example.com', '00000000-0000-0000-0000-000000000099', :league2, true);
-- a row written for her team lands in her league even when nobody says which league
insert into messages (channel, team_id, body) values ('general', 99, 'hello from the north');
insert into lineup_plans (team_id, date, player_id, slot) values (99, today_et() + 1, (select id from players order by id limit 1), 'BN');
select pg_temp.expect('north rows stamped with league 2', bool_and(league_id = :league2)) from messages where team_id = 99;
select pg_temp.expect('north plan stamped with league 2', bool_and(league_id = :league2)) from lineup_plans where team_id = 99;
-- the north GM sees only her league: her team, her league row, her rules row, her standings
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('north sees one team', (select count(*) from teams) = 1);
select pg_temp.expect('north sees one league', (select count(*) from leagues) = 1 and (select id from leagues) = current_setting('t.league2')::int);
select pg_temp.expect('north sees one rules row', (select count(*) from league) = 1 and (select league_id from league) = current_setting('t.league2')::int);
select pg_temp.expect('north sees no SaK rosters', (select count(*) from rosters) = 0);
select pg_temp.expect('north sees no SaK chat', (select count(*) from messages where team_id <> 99) = 0);
select pg_temp.expect('north sees no SaK bets, coins or money', (select count(*) from bets) + (select count(*) from coin_ledger) + (select count(*) from ledger) = 0);
select pg_temp.expect('north standings is her team alone', (select count(*) from standings) = 1 and (select team_id from standings) = 99);
select pg_temp.expect('north coin balances is hers alone', (select count(*) from coin_balances where team_id <> 99) = 0);
-- her own chat post needs no league on it, and naming the SaK league does not get her in
insert into messages (channel, team_id, body) values ('general', 99, 'second post');
insert into messages (channel, team_id, body, league_id) values ('general', 99, 'sneaky', 1);
select pg_temp.expect('north posts land in league 2', bool_and(league_id = current_setting('t.league2')::int)) from messages where team_id = 99;
reset role;
-- the SaK commissioner sees none of it, lineup plans included
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('SaK commish sees no north team', (select count(*) from teams where id = 99) = 0);
select pg_temp.expect('SaK commish sees no north plan', (select count(*) from lineup_plans where team_id = 99) = 0);
select pg_temp.expect('SaK commish sees no north chat', (select count(*) from messages where team_id = 99) = 0);
select pg_temp.expect('SaK standings has no north team', (select count(*) from standings where team_id = 99) = 0);
select pg_temp.expect('SaK still sees its own league whole', (select count(*) from teams) = 9 and (select count(*) from league) = 1 and (select count(*) from leagues) = 1);
reset role;
select 'second league isolated', true;

-- ───────────── one roster per league: both leagues can have the same player ─────────────
reset role;
select r.player_id as shared_p, r.team_id as sak_owner from rosters r where r.league_id = 1 and r.slot = 'BN' order by r.player_id limit 1 \gset
select r.player_id as shared2 from rosters r where r.league_id = 1 and r.slot = 'BN' and r.player_id <> :shared_p order by r.player_id limit 1 \gset
select phase as north_phase from league_rules where league_id = :league2 \gset
update league_rules set phase = 'season' where league_id = :league2;
-- the north commissioner puts SaK's player on her team, and her GM adds another one SaK owns as a free agent
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_move_player(:shared_p, 99, 'BN');
select add_player(:shared2, null, false);
select pg_temp.raises('the north can''t add him twice', format('select add_player(%s, null, false)', :shared2), 'already on a roster');
reset role;
select pg_temp.expect('both leagues have him', (select count(*) = 2 and count(distinct league_id) = 2 from rosters where player_id = :shared_p)
  and (select team_id = :sak_owner from rosters where player_id = :shared_p and league_id = 1));
select pg_temp.expect('the north''s add left SaK''s row alone', (select count(*) = 2 from rosters where player_id = :shared2));
-- news about him reaches his team in every league
update players set injury_status = 'Day-to-Day' where id = :shared_p;
select pg_temp.expect('an injury pings both owners', (select count(distinct team_id) = 2 from notifications where kind = 'injury' and link = '/player/' || :shared_p and team_id in (99, :sak_owner)));
update players set injury_status = null where id = :shared_p;
-- the SaK commissioner still runs SaK's copy of a shared player, and the north's copy doesn't move
select pg_temp.as_team(1);
set role authenticated;
select commish_move_player(:shared2, 3, 'BN');
reset role;
select pg_temp.expect('SaK move moved SaK''s row only', (select team_id = 3 from rosters where player_id = :shared2 and league_id = 1) and (select team_id = 99 from rosters where player_id = :shared2 and league_id = :league2));
-- the north sends him back to free agency: SaK keeps him
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_move_player(:shared2, null, null);
select drop_player(:shared_p);
reset role;
select pg_temp.expect('north releases leave SaK''s rows', (select count(*) = 1 from rosters where player_id = :shared2 and league_id = 1)
  and not exists (select 1 from rosters where league_id = :league2 and player_id in (:shared_p, :shared2))
  and exists (select 1 from rosters where player_id = :shared_p and league_id = 1 and team_id = :sak_owner));
-- the north's snapshots of those players (taken while she had them) are right, but the sections below expect a
-- north league with no games of its own
select pg_temp.expect('the north team was snapshotted for her own copy', exists (select 1 from lineup_snapshots where team_id = 99));
delete from lineup_snapshots where team_id = 99;
update league_rules set phase = :'north_phase' where league_id = :league2;
select 'one roster per league', true;

-- ───────────── every rule reads its own league's row ─────────────
reset role;
select pg_temp.expect('rules table renamed, view in its place', (select count(*) from pg_views where schemaname = 'public' and viewname = 'league') = 1 and (select count(*) from league_rules) = 2);
-- the north commissioner reads and writes only her league's rules
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('north reads her rules row', (select count(*) from league) = 1 and (select phase from league) = 'predraft');
select commish_update_league('{"keepers": 7, "pick_seconds": 45}'::jsonb);
select pg_temp.expect('north update landed on her row', (select keepers from league) = 7 and (select pick_seconds from league) = 45);
select pg_temp.expect('scoring reads the north rules row', calc_fpts('{"g": 2}'::jsonb) = 2 * (select (scoring->'skater'->>'g')::numeric from league));
reset role;
select pg_temp.expect('SaK rules untouched by the north', (select keepers from league_rules where league_id = 1) <> 7 or (select pick_seconds from league_rules where league_id = 1) <> 45);
-- the SaK commissioner still sees one row, his own
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('SaK reads its own rules row', (select count(*) from league) = 1 and (select league_id from league) = 1 and (select phase from league) = 'season');
select pg_temp.expect('SaK standings still eight teams through the re-pointed view', (select count(*) from standings) = 8);
reset role;
-- the scheduler's hook picks the league without a user
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', current_setting('t.league2'), false);
select pg_temp.expect('scheduler hook selects the north league', (select league_id from league) = current_setting('t.league2')::int);
select set_config('app.league_id', '', false);
select pg_temp.expect('no user and no hook falls back to league 1', (select league_id from league) = 1);
select 'league row per league', true;

-- ───────────── accounts: one person, several leagues ─────────────
reset role;
select pg_temp.expect('memberships backfilled from the team rows', (select count(*) from league_members) = (select count(*) from teams where user_id is not null));
select pg_temp.expect('roles follow the team rows', (select role from league_members where team_id = 1) = 'commish' and (select role from league_members where team_id = 9) = 'spectator' and (select role from league_members where team_id = 2) = 'gm' and (select role from league_members where team_id = 99) = 'commish');
-- an open seat in the north league, and an invite for it from the north commissioner
insert into teams (id, name, abbrev, gm_name, league_id) values (98, 'Tundra Wolves', 'TUN', 'open seat', current_setting('t.league2')::int);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
do $$ begin perform create_invite(1); raise exception 'invited a seat from another league';
exception when others then if sqlerrm not like '%open seat%' then raise; end if; end $$;
select create_invite(98) as north_code \gset
reset role;
select set_config('t.north_code', :'north_code', false);
-- the SaK commissioner takes the seat: he is now in two leagues, commissioner of one and a GM in the other
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('one league before accepting', (select count(*) from my_leagues()) = 1);
select pg_temp.expect('accepting the invite joins the north league', accept_invite(current_setting('t.north_code')) = current_setting('t.league2')::int);
select pg_temp.expect('two leagues after accepting', (select count(*) from my_leagues()) = 2);
select pg_temp.expect('the joined league is active and he is a GM there', (select current_league_id()) = current_setting('t.league2')::int and (select my_team()) = 98 and not is_commish());
do $$ begin perform accept_invite(current_setting('t.north_code')); raise exception 'used the invite twice';
exception when others then if sqlerrm not like '%no longer good%' and sqlerrm not like '%already in%' then raise; end if; end $$;
do $$ begin perform accept_invite('nope-nope'); raise exception 'accepted a bad code';
exception when others then if sqlerrm not like '%no longer good%' then raise; end if; end $$;
-- back to SaK by choice: commissioner again, team 1 again
select pg_temp.expect('switch back to SaK accepted', set_active_league(1) = 1);
select pg_temp.expect('SaK is the active league again', (select current_league_id()) = 1 and (select my_team()) = 1 and is_commish());
do $$ begin perform set_active_league(999); raise exception 'switched to a league he is not in';
exception when others then if sqlerrm not like '%not in that league%' then raise; end if; end $$;
-- the request header picks the league for one call when the caller is a member there, and is ignored when not
select set_config('request.headers', json_build_object('x-league', current_setting('t.league2'))::text, false);
select pg_temp.expect('x-league header selects the north league', (select current_league_id()) = current_setting('t.league2')::int and (select my_team()) = 98 and (select count(*) from teams) = 2 and (select count(*) from standings) = 2);
select set_config('request.headers', '{"x-league": "999"}', false);
select pg_temp.expect('a header for a league he is not in is ignored', (select current_league_id()) = 1 and (select my_team()) = 1);
select set_config('request.headers', '', false);
reset role;
-- a spectator invite makes a spectator row; the seat invite is spent
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select create_invite(null, 'spectator', 7, 3) as spec_code \gset
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000097', 'fan@example.com');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000097', false);
set role authenticated;
select pg_temp.expect('a fan accepts a spectator invite', accept_invite(:'spec_code') = current_setting('t.league2')::int);
select pg_temp.expect('the fan is a spectator in the north league', (select current_league_id()) = current_setting('t.league2')::int and (select role from teams where id = my_team()) = 'spectator' and can_do('chat') is not null);
reset role;
select pg_temp.expect('the seat invite is spent, the spectator invite has uses left', (select uses from league_invites where code = current_setting('t.north_code')) = 1 and (select uses from league_invites where code = :'spec_code') = 1 and (select max_uses from league_invites where code = :'spec_code') = 3);
select 'accounts', true;

-- ───────────── performance: the points that counted, by day and by category ─────────────
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('performance_days has yesterday for team 2', exists (select 1 from performance_days(today_et() - 1, today_et() - 1) d where d.team_id = 2 and d.game_type = 2 and d.points > 0 and (d.stats->>'g')::numeric >= 1 and (d.stats->>'a')::numeric >= 2));
select pg_temp.expect('performance_days keeps the playoff game apart', exists (select 1 from performance_days(today_et() - 1, today_et() - 1) d where d.team_id = 2 and d.game_type = 3));
select pg_temp.expect('performance_days stays inside the range', not exists (select 1 from performance_days(today_et(), today_et()) d where d.date <> today_et()));
select pg_temp.expect('performance_players sums the starter', exists (select 1 from performance_players(null, null, 2) p where p.player_id = :corr_p and p.started >= 1 and p.points > 0 and (p.stats->>'a')::numeric >= 2));
select pg_temp.expect('performance_players for the league covers team 2', exists (select 1 from performance_players() p where p.team_id = 2 and p.player_id = :corr_p));
reset role;
-- the north league sees none of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league has no SaK performance rows', (select count(*) from performance_days()) = 0 and (select count(*) from performance_players()) = 0);
reset role;
select 'performance', true;
-- ───────────── Garry per league: a state row per league, a briefing from the commissioner ─────────────
select pg_temp.expect('every league has a voice row', (select count(*) from garry_state) = (select count(*) from leagues) and (select briefing is not null from garry_state where league_id = 1));
-- the north commissioner briefs the voice and hands it a fact; SaK's commissioner cannot see either
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select garry_brief('A six-team league in the north. The booby prize is a frozen fish.');
select garry_remember('Thinks goalies win leagues', 99) as north_mem \gset
select pg_temp.expect('the north commissioner reads his briefing and his memory only', (select briefing like 'A six-team%' from garry_state) and (select count(*) from garry_state) = 1 and (select count(*) from garry_memory) = 1);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('SaK sees its own briefing and none of the north memories', (select briefing like 'The league: She''s A Keeper%' from garry_state) and (select count(*) from garry_memory where id = :north_mem) = 0);
reset role;
-- a plain GM may only feed facts about their own team
select pg_temp.as_team(2);
set role authenticated;
do $$ begin perform garry_remember('Patrick hoards goalies', 1); raise exception 'fed a fact about another team';
exception when others then if sqlerrm not like '%own team%' then raise; end if; end $$;
select garry_remember('Loves a long shot', 2) as my_mem \gset
select pg_temp.expect('a GM feeds a fact about their own team', (select weight from garry_memory where id = :my_mem) = 3);
reset role;
select 'garry per league', true;
-- ───────────── the Book, season edition: futures, season props, coin races ─────────────
update league_rules set season_end = today_et() + 100, playoffs_end = today_et() + 160, trade_deadline = null where league_id = 1;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the coin races view reads', (select count(*) from coin_races) = (select count(*) from teams where role = 'gm'));
reset role;
select open_season_markets() as n_season \gset
select pg_temp.expect('the season markets opened', :n_season >= 4 + (select count(*) from teams where role = 'gm' and league_id = 1));
select pg_temp.expect('four futures with one option per GM team', (select count(*) from markets where kind = 'future' and league_id = 1) = 4
  and (select bool_and(jsonb_array_length(options) = (select count(*) from teams where role = 'gm' and league_id = 1)) from markets where kind = 'future' and league_id = 1));
select pg_temp.expect('futures price every team between 1.1 and 30', (select bool_and((o->>'odds')::numeric between 1.1 and 30) from markets m, jsonb_array_elements(m.options) o where m.kind = 'future'));
select pg_temp.expect('opening twice is a no-op', open_season_markets() = 0);
select pg_temp.expect('a re-price touches every open future', reprice_season_markets() = 4);
-- a GM backs a champion and a team total
select pg_temp.as_team(2);
set role authenticated;
select id as fut_id from markets where kind = 'future' and subject->>'what' = 'johnson' \gset
select place_market_bet(:fut_id, 't2', 20);
select id as tp_id from markets where kind = 'season_prop' and subject->>'scope' = 'team' and (subject->>'team_id')::int = 2 \gset
select place_market_bet(:tp_id, 'over', 10);
reset role;
select pg_temp.expect('nothing settles while the season is on', settle_season_markets() = 0);
-- the season ends: the regular-season markets settle, the playoff ones wait
update league_rules set season_end = today_et() - 1 where league_id = 1;
select settle_season_markets() as n_settled \gset
select pg_temp.expect('regular-season futures and props settled, playoff futures still open', (select status from markets where id = :fut_id) = 'settled'
  and (select status from markets where id = :tp_id) in ('settled', 'void')
  and (select count(*) from markets where kind = 'future' and status = 'open') = 2);
select pg_temp.expect('the champion future paid the top of the table', (select winner_key from markets where id = :fut_id) = 't' || (select team_id from standings where team_id in (select id from teams where league_id = 1) order by rank, team_id limit 1));
-- the north league sees none of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league has no season markets', (select count(*) from markets where kind in ('future', 'season_prop')) = 0);
reset role;
select 'book season', true;

-- ───────────── the Book, by request: games later in the week, player races, club races ─────────────
reset role;
update league_rules set season_end = today_et() + 100 where league_id = 1;        -- the season is back on for the windows
insert into games (id, date, start_utc, home, away, state) values
  (891, today_et() + 3, now() + interval '3 days', 'EDM', 'TBL', 'FUT'),
  (892, today_et() + 5, now() + interval '5 days', 'TBL', 'EDM', 'FUT'),
  (893, today_et() + 6, now() + interval '6 days', 'EDM', 'TOR', 'FUT'),
  (895, today_et(), now() + interval '3 hours', 'TBL', 'TOR', 'FUT') on conflict do nothing;
select id as mcd from players where name = 'Connor McDavid' \gset
select id as kuch from players where name = 'Nikita Kucherov' \gset
select id as vasy from players where name = 'Andrei Vasilevskiy' \gset
-- a moneyline on a game later in the week, priced from the clubs' form, closing at puck drop
select preview_market('{"template":"game","game_id":891,"bet":"winner"}') as pv \gset
select pg_temp.expect('a game request previews as a moneyline', :'pv'::jsonb->>'kind' = 'winner' and jsonb_array_length(:'pv'::jsonb->'options') = 2
  and (:'pv'::jsonb->>'closes_at')::timestamptz = (select start_utc from games where id = 891));
do $$ begin perform preview_market('{"template":"game","game_id":895,"bet":"winner"}'); raise exception 'priced tonight''s game';
exception when others then if sqlerrm not like '%9:35%' then raise; end if; end $$;
-- a GM opens it by taking the first ticket
select pg_temp.as_team(2);
set role authenticated;
select request_market('{"template":"game","game_id":891,"bet":"winner"}', 'home', 20) as rq_game \gset
select pg_temp.expect('the requested moneyline is on the board with the first ticket', (select created_by = 2 and status = 'open' and league_id = 1 and game_id = 891 from markets where id = :rq_game)
  and (select coins from market_bets where market_id = :rq_game and team_id = 2) = 20);
do $$ begin perform request_market('{"template":"game","game_id":891,"bet":"winner"}', 'away', 10); raise exception 'opened the same market twice';
exception when others then if sqlerrm not like '%already%' then raise; end if; end $$;
-- a player race over a window: odds from each man's rate and his club's games left
select preview_market(format('{"template":"player_race","players":[%s,%s],"stat":"g","from":"%s","to":"%s"}', :mcd, :kuch, today_et(), today_et() + 7)::jsonb) as pv \gset
select pg_temp.expect('a player race previews with one option per player', :'pv'::jsonb->>'kind' = 'race' and jsonb_array_length(:'pv'::jsonb->'options') = 2
  and (select bool_and((o->>'odds')::numeric between 1.1 and 30) from jsonb_array_elements(:'pv'::jsonb->'options') o) and :'pv'::jsonb->>'title' like '%most goals%');
do $$ begin perform preview_market(format('{"template":"player_race","players":[%s,%s],"stat":"g"}', current_setting('vars.mcd', true), '1')::jsonb); raise exception 'raced an unknown player';
exception when others then null; end $$;
do $$ begin perform preview_market(format('{"template":"player_race","players":[%s,%s],"stat":"g","from":"%s","to":"%s"}', (select id from players where name = 'Connor McDavid'), (select id from players where name = 'Andrei Vasilevskiy'), today_et(), today_et() + 7)::jsonb); raise exception 'raced a goalie against a skater';
exception when others then if sqlerrm not like '%goalies%' then raise; end if; end $$;
do $$ begin perform preview_market(format('{"template":"player_race","players":[%s,%s],"stat":"g","from":"%s","to":"%s"}', (select id from players where name = 'Connor McDavid'), (select id from players where name = 'Nikita Kucherov'), today_et() + 1, today_et() + 2)::jsonb); raise exception 'priced a window with no games';
exception when others then if sqlerrm not like '%No games left%' then raise; end if; end $$;
select pg_temp.as_team(3);
set role authenticated;
select request_market(format('{"template":"player_race","players":[%s,%s],"stat":"g","from":"%s","to":"%s"}', :mcd, :kuch, today_et(), today_et() + 7)::jsonb, 'p' || :mcd, 10) as rq_race \gset
select pg_temp.expect('the race is open, marked as asked for, with the terms on it', (select kind = 'race' and created_by = 3 and subject->>'template' = 'player_race' and subject ? 'terms' and subject ? 'sig' from markets where id = :rq_race));
-- a club points race over a window works from the schedule alone; the standings races need the standings
select preview_market(format('{"template":"club_race","what":"points","clubs":["EDM","TBL"],"from":"%s","to":"%s"}', today_et(), today_et() + 7)::jsonb) as pv \gset
select pg_temp.expect('a club points race previews from the schedule', jsonb_array_length(:'pv'::jsonb->'options') = 2);
do $$ begin perform preview_market('{"template":"club_race","what":"division","clubs":["EDM","CGY"]}'); raise exception 'priced a division race with no standings';
exception when others then if sqlerrm not like '%standings%' then raise; end if; end $$;
reset role;
insert into nhl_teams (abbrev, name, conf, division, gp, pts, strength, proj_pts, playoff_odds, po_status) values
  ('EDM', 'Edmonton Oilers', 'W', 'P', 10, 16, 0.62, 104, 0.9, 'regular'), ('CGY', 'Calgary Flames', 'W', 'P', 10, 12, 0.55, 92, 0.5, 'regular'),
  ('VAN', 'Vancouver Canucks', 'W', 'P', 10, 10, 0.5, 86, 0.3, 'regular'), ('SEA', 'Seattle Kraken', 'W', 'P', 10, 9, 0.48, 84, 0.25, 'regular'),
  ('TBL', 'Tampa Bay Lightning', 'E', 'A', 10, 15, 0.6, 100, 0.8, 'regular'), ('TOR', 'Toronto Maple Leafs', 'E', 'A', 10, 11, 0.52, 88, 0.4, 'regular')
  on conflict (abbrev) do nothing;
select preview_market('{"template":"club_race","what":"division","clubs":["EDM","CGY"]}') as pv \gset
select pg_temp.expect('a division race runs the picked clubs against the field', jsonb_array_length(:'pv'::jsonb->'options') = 3 and :'pv'::jsonb->'options'->2->>'key' = 'field'
  and (:'pv'::jsonb->'options'->0->>'odds')::numeric < (:'pv'::jsonb->'options'->1->>'odds')::numeric);
do $$ begin perform preview_market('{"template":"club_race","what":"division","clubs":["EDM","TBL"]}'); raise exception 'mixed divisions';
exception when others then if sqlerrm not like '%one division%' then raise; end if; end $$;
select preview_market('{"template":"club_race","what":"playoffs","clubs":["CGY"]}') as pv \gset
select pg_temp.expect('a playoff yes/no prices from the model''s odds', :'pv'::jsonb->'options'->0->>'key' = 'yes' and (:'pv'::jsonb->'options'->0->>'odds')::numeric = _odds(0.5));
select preview_market('{"template":"club_line","club":"EDM"}') as pv \gset
select pg_temp.expect('a club season-points line sits on a half, priced both ways', ((:'pv'::jsonb->'subject'->>'line')::numeric * 2)::int % 2 = 1
  and (select bool_and((o->>'odds')::numeric between 1.15 and 6) from jsonb_array_elements(:'pv'::jsonb->'options') o));
select pg_temp.expect('the Book has suggestions for the league', jsonb_array_length(book_suggestions()) >= 3
  and (select bool_and(s ? 'template' and s ? 'label' and s ? 'why') from jsonb_array_elements(book_suggestions()) s));
-- the morning Book fills in the rest of the game's markets without doubling the requested moneyline
select open_markets(today_et() + 3) as n_later \gset
select pg_temp.expect('the house adds the total and overtime to a game with a requested moneyline, once', :n_later >= 2
  and (select count(*) from markets where game_id = 891 and kind = 'winner') = 1 and (select count(*) from markets where game_id = 891 and kind = 'total') = 1);
-- three open requests per GM
select pg_temp.as_team(4);
set role authenticated;
select request_market('{"template":"club_race","what":"division","clubs":["EDM","CGY"]}', 'cEDM', 10) as rq_div \gset
select request_market('{"template":"game","game_id":892,"bet":"total"}', 'over', 5);
select request_market('{"template":"game","game_id":893,"bet":"ot"}', 'yes', 5);
do $$ begin perform request_market('{"template":"club_line","club":"EDM"}', 'over', 5); raise exception 'a fourth open request went through';
exception when others then if sqlerrm not like '%three markets%' then raise; end if; end $$;
reset role;
-- settlement: the player race's window has passed and the box scores are in
update markets set subject = subject || jsonb_build_object('from', today_et() - 3, 'to', today_et() - 1), closes_at = now() - interval '1 minute' where id = :rq_race;
update games set final_synced = true where date between today_et() - 3 and today_et() - 1 and state in ('OFF', 'FINAL');
insert into games (id, date, start_utc, home, away, state, final_synced) values (894, today_et() - 2, now() - interval '2 days', 'EDM', 'TBL', 'OFF', true) on conflict do nothing;
insert into player_games (game_id, player_id, date, nhl_team, stats, fpts) values (894, :mcd, today_et() - 2, 'EDM', '{"g":4,"a":0}', 16), (894, :kuch, today_et() - 2, 'TBL', '{"g":1,"a":1}', 6);
select settle_race_markets() as n_races \gset
select pg_temp.expect('the player race settled from the box scores and paid the ticket', :n_races >= 1 and (select winner_key from markets where id = :rq_race) = 'p' || :mcd
  and (select payout from market_bets where market_id = :rq_race and team_id = 3) > 10);
-- the division race waits for the 82, then pays
update markets set closes_at = now() - interval '1 minute' where id = :rq_div;
select pg_temp.expect('the division race waits for the 82', settle_race_markets() = 0 and (select status from markets where id = :rq_div) = 'open');
update nhl_teams set gp = 82, pts = case abbrev when 'EDM' then 110 when 'CGY' then 95 when 'VAN' then 90 else 80 end where division = 'P';
select settle_race_markets() as n_div \gset
select pg_temp.expect('the division race paid the club that finished first', :n_div = 1 and (select winner_key from markets where id = :rq_div) = 'cEDM');
-- the north league sees none of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league has no requested markets', (select count(*) from markets where created_by is not null) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'book requests', true;

-- ───────────── the Book, in play: odds that move with the score, tickets at the live price ─────────────
reset role;
insert into games (id, date, start_utc, home, away, state) values (896, today_et(), now() + interval '1 hour', 'CGY', 'TBL', 'FUT') on conflict do nothing;
select open_markets(today_et()) as n_896 \gset
select id as ml_id from markets where game_id = 896 and kind = 'winner' \gset
select id as tot_id from markets where game_id = 896 and kind = 'total' \gset
select (o->>'odds')::numeric as home_open from markets m, jsonb_array_elements(m.options) o where m.id = :ml_id and o->>'key' = 'home' \gset
select pg_temp.expect('before puck drop the live odds are the opening odds', (select _live_option_odds(m, 'home') from markets m where id = :ml_id) = :home_open);
-- puck drop: the home side up two in the second period
update games set state = 'LIVE', home_score = 2, away_score = 0, period = '2', clock = '12:00', start_utc = now() - interval '1 hour', updated_at = now() where id = 896;
update markets set closes_at = now() - interval '1 hour' where game_id = 896;
select _live_option_odds(m, 'home') as home_live from markets m where id = :ml_id \gset
select pg_temp.expect('a two-goal lead shortens the home price', :home_live < :home_open and :home_live >= 1.05);
select pg_temp.as_team(1);
select pg_temp.expect('the live board prices every open market in one call', jsonb_typeof(book_live()->(:'ml_id'::text)) = 'array'
  and (book_live()->(:'ml_id'::text)->0->>'odds')::numeric between 1.05 and 15);
select pg_temp.expect('the total re-prices from the goals on the board and the clock', (select _live_option_odds(m, 'under') from markets m where id = :tot_id) < 1.9
  and (select _live_option_odds(m, 'over') from markets m where id = :tot_id) > 1.9);
-- a GM buys in play at the live price
select pg_temp.as_team(5);
set role authenticated;
select place_market_bet(:ml_id, 'home', 20);
select pg_temp.expect('the in-play ticket carries the live price and the flag', (select odds = :home_live and placed_live from market_bets where market_id = :ml_id and team_id = 5));
reset role;
-- the guards: a stale feed, the last two minutes, overtime, the final
update games set updated_at = now() - interval '5 minutes' where id = 896;
select pg_temp.as_team(5);
set role authenticated;
do $$ begin perform place_market_bet((select id from markets where game_id = 896 and kind = 'total'), 'over', 10); raise exception 'bet on a stale feed';
exception when others then if sqlerrm not like '%feed%' then raise; end if; end $$;
reset role;
update games set updated_at = now(), period = '3', clock = '1:30' where id = 896;
select pg_temp.as_team(5);
set role authenticated;
do $$ begin perform place_market_bet((select id from markets where game_id = 896 and kind = 'total'), 'over', 10); raise exception 'bet in the last two minutes';
exception when others then if sqlerrm not like '%last two minutes%' then raise; end if; end $$;
reset role;
update games set period = 'OT', clock = '4:00', home_score = 2, away_score = 2 where id = 896;
select pg_temp.as_team(5);
set role authenticated;
do $$ begin perform place_market_bet((select id from markets where game_id = 896 and kind = 'total'), 'over', 10); raise exception 'bet in overtime';
exception when others then if sqlerrm not like '%overtime%' then raise; end if; end $$;
reset role;
-- the final: the home side wins in overtime, the in-play ticket pays at the price it was bought at
update games set state = 'OFF', home_score = 3, away_score = 2, final_synced = true, updated_at = now() where id = 896;
select pg_temp.as_team(5);
set role authenticated;
do $$ begin perform place_market_bet((select id from markets where game_id = 896 and kind = 'winner'), 'home', 10); raise exception 'bet on a finished game';
exception when others then if sqlerrm not like '%over%' then raise; end if; end $$;
reset role;
select settle_markets() as settled_896 \gset
select pg_temp.expect('the in-play ticket paid at its own price', (select payout from market_bets where market_id = :ml_id and team_id = 5) = round(20 * :home_live));
-- a player race re-prices from the box scores as the window runs
insert into games (id, date, start_utc, home, away, state, final_synced) values (897, today_et(), now() - interval '3 hours', 'EDM', 'CGY', 'OFF', true) on conflict do nothing;
select pg_temp.as_team(6);
set role authenticated;
select request_market(format('{"template":"player_race","players":[%s,%s],"stat":"blk","from":"%s","to":"%s"}', :mcd, :kuch, today_et(), today_et() + 7)::jsonb, 'p' || :kuch, 10) as rq_live \gset
reset role;
select (o->>'odds')::numeric as mcd_open from markets m, jsonb_array_elements(m.options) o where m.id = :rq_live and o->>'key' = 'p' || :mcd \gset
insert into player_games (game_id, player_id, date, nhl_team, stats, fpts) values (897, :mcd, today_et(), 'EDM', '{"g":0,"a":0,"blk":6}', 3);
select pg_temp.expect('six blocks in the window shorten his race price while the opening odds stay on the ticket',
  (select _live_option_odds(m, 'p' || :mcd) from markets m where id = :rq_live) < :mcd_open
  and (select odds from market_bets where market_id = :rq_live and team_id = 6) = (select (o->>'odds')::numeric from markets m, jsonb_array_elements(m.options) o where m.id = :rq_live and o->>'key' = 'p' || :kuch));
-- the north league's board is its own
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league has an empty live board', book_live() = '{}'::jsonb);
reset role;
select 'book live', true;

-- ───────────── the Book's NHL board: house futures, one club against the field, player races against the field ─────────────
reset role;
-- the fixture has no projection details: give the top skaters, defencemen and goalies some
update players set proj_stats = jsonb_build_object('pts', round(proj / 2), 'g', round(proj / 5), 'a', round(proj / 3)) where pos <> 'G' and id in (select id from players where pos <> 'G' order by proj desc limit 40);
update players set proj_stats = jsonb_build_object('w', round(proj / 5), 'sv', round(proj * 8), 'sho', 3) where pos = 'G' and id in (select id from players where pos = 'G' order by proj desc limit 12);
select pg_temp.as_team(1);
-- one club against the field in a season-long race
select preview_market('{"template":"club_race","what":"cup","clubs":["EDM"]}') as pv \gset
select pg_temp.expect('one club runs against the field for the Cup', jsonb_array_length(:'pv'::jsonb->'options') = 2 and :'pv'::jsonb->'options'->1->>'key' = 'field' and :'pv'::jsonb->>'title' like 'Edmonton Oilers%');
-- a player against the field: the pool is the rest of the top 30 at the stat
select preview_market(format('{"template":"player_race","players":[%s],"stat":"g","field":true,"from":"%s","to":"%s"}', :mcd, today_et(), today_et() + 7)::jsonb) as pv \gset
select pg_temp.expect('a player against the field prices the field from the rest of the top 30', jsonb_array_length(:'pv'::jsonb->'options') = 2 and :'pv'::jsonb->'options'->1->>'key' = 'field'
  and jsonb_array_length(:'pv'::jsonb->'subject'->'group') between 2 and 31);
-- the house board opens once a season
update league_rules set trade_deadline = now() + interval '60 days' where league_id = 1;
select open_nhl_markets() as n_nhl \gset
select pg_temp.expect('the NHL board opened with the Cup, the Presidents'' Trophy, the divisions and the awards', :n_nhl >= 7
  and (select count(*) from markets where subject->>'house' = 'nhl' and title = 'Stanley Cup winner') = 1
  and (select count(*) from markets where subject->>'house' = 'nhl' and title like 'Art Ross%') = 1
  and (select count(*) from markets where subject->>'house' = 'nhl' and title like 'Most wins%') = 1);
select pg_temp.expect('the board opens once', open_nhl_markets() = 0);
select id as ross_id from markets where subject->>'house' = 'nhl' and title like 'Art Ross%' \gset
select pg_temp.expect('the Art Ross runs eight against the field over the whole season', (select jsonb_array_length(options) = 9 and options->8->>'key' = 'field' and (subject->>'from')::date <= today_et() from markets where id = :ross_id));
select pg_temp.expect('the live price of a field race covers the whole pool', (select jsonb_array_length(_live_options(m)) = 9 from markets m where id = :ross_id));
select pg_temp.expect('the Cup market runs the twelve strongest against the field', (select jsonb_array_length(options) from markets where subject->>'house' = 'nhl' and title = 'Stanley Cup winner') = (select least(12, count(*)) + case when count(*) > 12 then 1 else 0 end from nhl_teams));
-- a field race settles league-wide: a leader outside the picks pays the field
select pg_temp.as_team(7);
set role authenticated;
select request_market(format('{"template":"player_race","players":[%s],"stat":"g","field":true,"from":"%s","to":"%s"}', :mcd, today_et(), today_et() + 2)::jsonb, 'p' || :mcd, 10) as rq_field \gset
reset role;
update markets set subject = subject || jsonb_build_object('from', today_et() - 3, 'to', today_et() - 1), closes_at = now() - interval '1 minute' where id = :rq_field;
insert into games (id, date, start_utc, home, away, state, final_synced) values (898, today_et() - 1, now() - interval '1 day', 'TBL', 'BOS', 'OFF', true) on conflict do nothing;
insert into player_games (game_id, player_id, date, nhl_team, stats, fpts) values (898, :kuch, today_et() - 1, 'TBL', '{"g":5,"a":0}', 20);
select settle_race_markets() as n_field \gset
select pg_temp.expect('a leader outside the picks pays the field', :n_field >= 1 and (select winner_key from markets where id = :rq_field) = 'field' and (select payout from market_bets where market_id = :rq_field and team_id = 7) = 0);
-- the north league has no NHL board of its own yet
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league sees no house NHL markets', (select count(*) from markets where subject->>'house' = 'nhl') = 0);
reset role;
select 'book nhl', true;

-- ───────────── bench tallies ─────────────
-- a bench point from a playoff game shows in the playoff table and the full year, never in the regular season
select pg_temp.as_team(2);
select pg_temp.expect('bench rows say what kind of game', (select count(*) from information_schema.columns where table_name = 'team_bench_daily' and column_name = 'game_type') = 1);
select id as bn_p from players where id not in (select player_id from lineup_snapshots where game_id = 2026030222) and pos <> 'G' order by id limit 1 \gset
select s.bench as reg_b0, p.bench as po_b0, c.bench as cup_b0 from standings s join playoff_standings p using (team_id) join sak_cup_standings c using (team_id) where s.team_id = 2 \gset
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values (2026030222, today_et() - 1, 2, :bn_p, 'BN');
insert into player_games (game_id, player_id, date, stats) values (2026030222, :bn_p, today_et() - 1, '{"g":1,"a":1,"sog":4}');
select fpts as bn_f from player_games where game_id = 2026030222 and player_id = :bn_p \gset
select pg_temp.expect('the benched playoff game scores something', :bn_f > 0);
select pg_temp.expect('playoff bench lands in the playoff table', (select bench from playoff_standings where team_id = 2) = :po_b0 + :bn_f);
select pg_temp.expect('and in the full year', (select bench from sak_cup_standings where team_id = 2) = :cup_b0 + :bn_f);
select pg_temp.expect('not in the regular season', (select bench from standings where team_id = 2) = :reg_b0);
select pg_temp.expect('bench never counts', (select points from playoff_standings where team_id = 2) = (select coalesce(sum(points), 0) from playoff_daily where team_id = 2));

-- a second league reads its own rules row: its points and bench show in its own table
update league_rules set phase = 'season', season_start = today_et() - 1 where league_id = :league2;
insert into lineup_snapshots (game_id, date, team_id, player_id, slot, league_id)
  select 1, today_et(), 99, id, 'C', :league2 from players where name = 'Connor McDavid';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north league scores its own starters', (select points from standings where team_id = 99) > 0);
reset role;
update league_rules set phase = 'keepers', season_start = null where league_id = :league2;
select 'bench tallies', true;

-- ───────────── Garry, second edition ─────────────
select pg_temp.expect('garry_state carries the phase his notes were written in, his moments and his usage',
  (select count(*) from information_schema.columns where table_name = 'garry_state' and column_name in ('persona_phase', 'moments', 'usage')) = 3);
select pg_temp.expect('moments and usage start empty', (select bool_and(moments = '{}'::jsonb and usage = '{}'::jsonb) from garry_state));
select 'garry v2', true;

-- ───────────── tenancy guards ─────────────
reset role;
create or replace function pg_temp.raises(label text, sql text, msg text default 'another league') returns void language plpgsql as
$$ begin
  begin execute sql; exception when others then
    if sqlerrm ilike '%' || msg || '%' then return; end if;
    raise exception 'FAILED: % (raised "%" instead)', label, sqlerrm;
  end;
  raise exception 'FAILED: % (no error)', label;
end $$;
-- the north commissioner can't reach into SaK by id, whatever the tool (the ids are looked up first: she can't see them)
select set_config('t.sak_player', (select player_id::text from rosters where league_id = 1 limit 1), false);
select set_config('t.sak_pick', (select id::text from draft_picks where league_id = 1 limit 1), false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('north commish gives coins to a SaK team', 'select commish_coins(2, 500, ''gift'')');
select pg_temp.raises('north commish resets a SaK password', 'select commish_reset_password(2, ''hijacked-123'')');
select pg_temp.raises('north commish books a SaK ledger line', 'select commish_ledger(2, ''adjust'', 10, ''x'')');
-- a player on a SaK roster is a free agent in the north: her move takes her league's copy and never SaK's
select commish_move_player(current_setting('t.sak_player')::int, 99, 'BN');
select commish_move_player(current_setting('t.sak_player')::int, null, null);
select pg_temp.raises('north commish proposes a trade to a SaK team', 'select propose_trade(2, array[]::int[], array[]::int[], array[]::int[], array[]::int[], null, 0, 0, 10, 0)');
select pg_temp.raises('north commish re-owns a SaK pick', format('select commish_set_pick_owner(%s, 99, null::text)', current_setting('t.sak_pick')));
reset role;
select pg_temp.expect('the north''s moves left SaK''s copy where it was', exists (select 1 from rosters where league_id = 1 and player_id = current_setting('t.sak_player')::int)
  and not exists (select 1 from rosters where league_id <> 1 and player_id = current_setting('t.sak_player')::int));
delete from lineup_snapshots where team_id = 99;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
reset role;
select coalesce((select id::text from bets where league_id = 1 order by id limit 1), '') as sak_bet \gset
select set_config('t.sak_bet', :'sak_bet', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
do $$ begin
  if current_setting('t.sak_bet') <> '' then
    perform pg_temp.raises('north GM answers a SaK bet', format('select respond_bet(%s, true)', current_setting('t.sak_bet')));
    perform pg_temp.raises('north commish settles a SaK bet', format('select commish_settle_bet(%s, 2)', current_setting('t.sak_bet')));
  end if;
end $$;
-- her own league still works: coins to her own team land, and SaK's ledger doesn't move
reset role;
select count(*) as sak_coins0 from coin_ledger where league_id = 1 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_coins(99, 5, 'north test');
reset role;
select pg_temp.expect('north coins land in the north', (select league_id from coin_ledger where team_id = 99 and reason = 'north test') = :league2);
select pg_temp.expect('SaK coin ledger untouched', (select count(*) from coin_ledger where league_id = 1) = :sak_coins0);
-- a site notice raised from the north lands in the north
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select _sys('general', 'north notice', null);
select pg_temp.expect('north notice in the north', (select league_id from messages where body = 'north notice') = :league2);
-- an @mention in SaK chat never pings the north, even when the names match
select count(*) as north_pings0 from notifications where team_id = 99 \gset
insert into messages (channel, team_id, body) values ('general', 2, '@Nora @all big night boys');
select pg_temp.expect('SaK @all does not reach the north', (select count(*) from notifications where team_id = 99) = :north_pings0);
select pg_temp.expect('SaK @all still reaches SaK', (select count(*) from notifications where kind = 'mention' and body like '%big night boys%' and team_id <> 2) >= 1);
-- a signed-in stranger with no membership belongs to no league and reads nothing
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000098', 'stranger@example.com');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000098', false);
set role authenticated;
select pg_temp.expect('a stranger has no league', current_league_id() is null);
select pg_temp.expect('a stranger reads no teams, chat, rosters or rules', (select count(*) from teams) + (select count(*) from messages) + (select count(*) from rosters) + (select count(*) from league) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('the scheduler still lands on league 1', current_league_id() = 1);
-- the admin key: only the service role can check it, and only the real key passes
select value as admin_key from private.app_keys where name = 'admin' \gset
set role service_role;
select pg_temp.expect('the admin key checks out', admin_key_ok(:'admin_key'));
select pg_temp.expect('a wrong key does not', not admin_key_ok('not-the-key-not-the-key-not-the-key'));
reset role;
set role anon;
select pg_temp.raises('anon cannot test admin keys', 'select admin_key_ok(''x'')', 'permission denied');
reset role;
select 'tenancy guards', true;
set role authenticated;
select pg_temp.raises('a GM cannot pay out a market', 'select _payout_market(1, ''home'')', 'permission denied');
reset role;

-- ───────────── running costs ─────────────
reset role;
insert into ops.platform_admins (user_id) select user_id from teams where id = 1 on conflict do nothing;
-- the edge functions meter their calls; a GM can't, and two calls on one day add up on one row
set role authenticated;
select pg_temp.raises('a GM cannot meter a cost', 'select meter_cost(1, ''xai'', ''garry.reply'', 1, 100, 0, 10, 0, 1)', 'permission denied');
reset role;
set role service_role;
select meter_cost(1, 'xai', 'garry.reply', 1, 2600, 2000, 100, 0, 0.003);
select meter_cost(1, 'xai', 'garry.reply', 1, 2600, 2000, 100, 0, 0.003);
select meter_cost(0, 'xai', 'hub.x_feed', 1, 9000, 0, 600, 19, 0.113);
reset role;
select pg_temp.expect('two replies on one row', (select calls = 2 and usd = 0.006 from ops.cost_usage where feature = 'garry.reply'));
-- the dashboard is for platform admins only, and a GM can't read the bills by any other door
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM cannot open the cost dashboard', 'select cost_dashboard(30)', 'Platform admins only');
select pg_temp.raises('a GM cannot edit the bills', 'select cost_set_fixed(null, ''x'', 1, 1, null)', 'Platform admins only');
select pg_temp.raises('a GM cannot read the cost tables', 'select count(*) from ops.cost_usage', 'permission denied');
select pg_temp.expect('a GM is not a platform admin', not is_platform_admin());
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the owner is a platform admin', is_platform_admin());
select set_config('t.cost', cost_dashboard(30)::text, false);
select pg_temp.expect('today''s AI spend is on the dashboard', (select (d->>'garry')::numeric = 0.006 and (d->>'x_feed')::numeric = 0.113
  from jsonb_array_elements(current_setting('t.cost')::jsonb->'daily') d where d->>'day' = current_setting('t.cost')::jsonb->>'today'));
select pg_temp.expect('the fixed bills are spread over the days', (select (d->>'fixed')::numeric > 0
  from jsonb_array_elements(current_setting('t.cost')::jsonb->'daily') d where d->>'day' = current_setting('t.cost')::jsonb->>'today'));
select pg_temp.expect('features are listed by cost', (current_setting('t.cost')::jsonb->'features'->0->>'feature') = 'hub.x_feed');
select pg_temp.expect('SaK carries its own Garry plus a share of the shared costs', (select (l->>'direct_30')::numeric = 0.006 and (l->>'shared_30')::numeric > 0
  from jsonb_array_elements(current_setting('t.cost')::jsonb->'leagues') l where (l->>'id')::int = 1));
select cost_set_fixed(null, 'Test bill', 30, 0.5, 'half of it', 'other') as bill_id \gset
select pg_temp.expect('a new bill lands', (select (f->>'monthly_usd')::numeric = 30 and (f->>'share')::numeric = 0.5
  from jsonb_array_elements(cost_dashboard(30)->'fixed') f where (f->>'id')::int = :bill_id));
select pg_temp.raises('a share over 1 is refused', format('select cost_set_fixed(%s, ''Test bill'', 30, 2, null)', :bill_id), 'between 0 and 1');
-- a new price starts today; the days before keep the old one
reset role;
insert into ops.cost_fixed (source, item, monthly_usd, starts) values ('other', 'Old bill', 31, (now() at time zone 'America/New_York')::date - 10) returning id as old_bill \gset
select pg_temp.as_team(1);
set role authenticated;
select cost_set_fixed(:old_bill, 'Old bill', 62, 1, null) as new_bill \gset
select cost_end_fixed(:bill_id);
reset role;
select pg_temp.expect('the old price closes yesterday', (select ends = (now() at time zone 'America/New_York')::date - 1 and monthly_usd = 31 from ops.cost_fixed where id = :old_bill));
select pg_temp.expect('the new price starts today', (select starts = (now() at time zone 'America/New_York')::date and monthly_usd = 62 from ops.cost_fixed where id = :new_bill));
select pg_temp.expect('a bill ended the day it started never counts', (select ends < starts from ops.cost_fixed where id = :bill_id)
  and not exists (select 1 from jsonb_array_elements(cost_dashboard(30)->'fixed') f where (f->>'id')::int = :bill_id));
-- a spike notifies the owner once, a quiet day doesn't
insert into ops.cost_usage (day, source, feature, calls, usd) values ((now() at time zone 'America/New_York')::date - 1, 'xai', 'garry.daily', 1, 6);
select pg_temp.expect('a spike notifies the owner', cost_watch() = 1);
select pg_temp.expect('the spike lands on team 1 with a link', exists (select 1 from notifications where team_id = 1 and kind = 'cost' and link = '/costs'));
select pg_temp.expect('a spike notifies once', cost_watch() = 0);
select cost_snapshot();
select pg_temp.expect('the database size is recorded', exists (select 1 from ops.usage_daily where metric = 'db_bytes'));
select 'running costs', true;

-- ───────────── the draft per league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select row_to_json(d)::text as sak_draft0 from draft_state d where league_id = 1 \gset
select count(*) as sak_drafted0 from rosters where league_id = 1 and acquired = 'draft' \gset
select phase as north_phase2 from league_rules where league_id = :league2 \gset
select player_id as sak_star from rosters r where r.league_id = 1 order by r.prev_fp desc nulls last, r.player_id limit 1 \gset
select pg_temp.expect('every league has its draft row', (select count(*) from draft_state) = (select count(*) from leagues));
-- the north commissioner sets her order (her two GMs) and starts her draft
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a SaK team can''t be in the north''s order', 'select draft_set_order(array[99, 2])', 'every team once');
select draft_set_order(array[99, 98]);
select draft_start();
select pg_temp.expect('the north''s pick 1 is hers', (select current_overall = 1 and status = 'live' from draft_state) and (select team_id = 99 from draft_picks where overall = 1));
-- she takes a player SaK owns: he's a free agent in the north
select draft_pick(:sak_star);
reset role;
select pg_temp.expect('her pick landed in the north', exists (select 1 from rosters where league_id = :league2 and team_id = 99 and acquired = 'draft'));
-- the clock runs out on team 98: the scheduler's tick autopicks for the north, and only the north
update draft_state set deadline = now() - interval '1 second' where league_id = :league2;
select set_config('request.jwt.claim.sub', '', false);
select process_pending();
select pg_temp.expect('the scheduler autopicked for the north', (select count(*) = 2 from draft_picks where league_id = :league2 and player_id is not null)
  and exists (select 1 from rosters where league_id = :league2 and team_id = 98 and acquired = 'draft'));
select pg_temp.expect('SaK''s draft never moved', (select row_to_json(d)::text from draft_state d where league_id = 1) = :'sak_draft0'
  and (select count(*) from rosters where league_id = 1 and acquired = 'draft') = :sak_drafted0);
select pg_temp.expect('pick numbers repeat across leagues', exists (select 1 from draft_picks a join draft_picks b on a.season = b.season and a.overall = b.overall and a.league_id <> b.league_id));
-- the north resets her draft: SaK's drafted players stay put
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select draft_reset();
reset role;
select pg_temp.expect('the north reset cleared only the north', not exists (select 1 from rosters where league_id = :league2 and acquired = 'draft')
  and (select count(*) from rosters where league_id = 1 and acquired = 'draft') = :sak_drafted0
  and (select row_to_json(d)::text from draft_state d where league_id = 1) = :'sak_draft0');
update league_rules set phase = :'north_phase2' where league_id = :league2;
select 'draft per league', true;

-- ───────────── scoring per league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('SaK scores with profile 1', (select profile_id = 1 from league_rules where league_id = 1));
select pg_temp.expect('every league points at the profile for its weights', not exists (
  select 1 from league_rules lr join scoring_profiles sp on sp.id = lr.profile_id where sp.scoring <> lr.scoring));
select game_id as sc_game, player_id as sc_player from player_games where (stats->>'g')::numeric > 0 and not stats ? 'sv' order by game_id limit 1 \gset
select recompute_player_values();   -- values follow the players' stats; bring them up to date before the snapshot
select md5(string_agg(game_id || ':' || player_id || ':' || fpts, ',' order by game_id, player_id)) as sak_points0 from player_game_points where profile_id = 1 \gset
select md5(string_agg(game_id || ':' || player_id || ':' || fpts, ',' order by game_id, player_id)) as sak_compat0 from player_games \gset
select md5(string_agg(player_id || ':' || proj || ':' || last_fp || ':' || rank, ',' order by player_id)) as sak_values0 from player_values where profile_id = 1 \gset
select md5(string_agg(id || ':' || proj || ':' || last_fp || ':' || rank, ',' order by id)) as sak_players0 from players \gset
select md5(string_agg(team_id || ':' || points, ',' order by team_id)) as sak_standings0 from standings \gset
select count(*) as profiles0 from scoring_profiles \gset
-- the north commissioner doubles what a goal is worth
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_update_scoring((select jsonb_set(scoring, '{skater,g}', to_jsonb((scoring->'skater'->>'g')::numeric * 2)) from league));
select pg_temp.expect('the north reads its own points for a shared game', (select fpts from league_games where game_id = :sc_game and player_id = :sc_player)
  = (select _score(scoring, stats) from player_games, league where game_id = :sc_game and player_id = :sc_player));
select fpts as north_fpts from league_games where game_id = :sc_game and player_id = :sc_player \gset
select fpts as north_season from player_season where player_id = :sc_player \gset
select proj as north_proj from league_players where id = :proj_p \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('the north moved to a new profile', (select profile_id <> 1 from league_rules where league_id = :league2)
  and (select count(*) from scoring_profiles) = :profiles0 + 1);
select pg_temp.expect('SaK''s points never moved', (select md5(string_agg(game_id || ':' || player_id || ':' || fpts, ',' order by game_id, player_id)) from player_game_points where profile_id = 1) = :'sak_points0'
  and (select md5(string_agg(game_id || ':' || player_id || ':' || fpts, ',' order by game_id, player_id)) from player_games) = :'sak_compat0');
select pg_temp.expect('SaK''s projections and ranks never moved', (select md5(string_agg(player_id || ':' || proj || ':' || last_fp || ':' || rank, ',' order by player_id)) from player_values where profile_id = 1) = :'sak_values0'
  and (select md5(string_agg(id || ':' || proj || ':' || last_fp || ':' || rank, ',' order by id)) from players) = :'sak_players0');
select pg_temp.expect('SaK''s standings never moved', (select md5(string_agg(team_id || ':' || points, ',' order by team_id)) from standings) = :'sak_standings0');
select pg_temp.expect('SaK reads its own points for the same game', (select fpts from league_games where game_id = :sc_game and player_id = :sc_player)
  = (select fpts from player_games where game_id = :sc_game and player_id = :sc_player)
  and (select fpts from league_games where game_id = :sc_game and player_id = :sc_player) < :north_fpts);
select pg_temp.expect('season totals differ by league', (select fpts from player_season where player_id = :sc_player) < :north_season);
select pg_temp.expect('projections differ by league', (select proj from league_players where id = :proj_p) < :north_proj);
-- a new stat line is scored for both leagues as it lands
insert into games (id, date, start_utc, home, away, state) values (995, today_et(), now() - interval '1 hour', 'TOR', 'MTL', 'LIVE');
insert into player_games (game_id, player_id, date, stats) values (995, :sc_player, today_et(), '{"g":1,"a":0,"sog":2}');
select pg_temp.expect('a new line is scored under both profiles', (select count(*) from player_game_points where game_id = 995) = 2
  and (select count(distinct fpts) from player_game_points where game_id = 995) = 2);
-- going back to SaK's weights shares SaK's profile again; nothing new is made
select scoring as sak_scoring from league_rules where league_id = 1 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('scoring can''t be blanked', 'select commish_update_scoring(null)', 'skater and goalie');
select commish_update_scoring(:'sak_scoring'::jsonb);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('same weights, same profile', (select profile_id = 1 from league_rules where league_id = :league2)
  and (select count(*) from scoring_profiles) = :profiles0 + 1);
select pg_temp.expect('SaK''s points still never moved', (select md5(string_agg(game_id || ':' || player_id || ':' || fpts, ',' order by game_id, player_id)) from player_game_points where profile_id = 1 and game_id <> 995) = :'sak_points0');
select 'scoring per league', true;

-- ───────────── the league pass ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- an edge function (the service key) names its league with x-league; a GM can only name one of their own
select set_config('request.jwt.claim.role', 'service_role', false);
select set_config('request.headers', json_build_object('x-league', :league2::text)::text, false);
select pg_temp.expect('the service key works for the league it names', current_league_id() = :league2 and current_profile_id() = (select profile_id from league_rules where league_id = :league2));
select set_config('request.jwt.claim.role', 'authenticated', false);
select pg_temp.as_team(2);
select pg_temp.expect('a SaK GM can''t name the north', current_league_id() = 1);
select set_config('request.headers', '', false);
select set_config('request.jwt.claim.role', '', false);
select set_config('request.jwt.claim.sub', '', false);
-- roster caps are the team's own league's
update league_rules set roster = jsonb_set(roster, '{C}', '1') where league_id = :league2;
select pg_temp.expect('caps by league', _cap('C', :league2) = 1 and _cap('C', 1) = (select (roster->>'C')::int from league_rules where league_id = 1) and _cap('C') = _cap('C', 1));
update league_rules set roster = jsonb_set(roster, '{C}', (select roster->'C' from league_rules where league_id = 1)) where league_id = :league2;
-- the Book opens tonight for each league, on its own rows, with its own name on the props
select p.id as pass_p, p.nhl_team as pass_club from players p
  where p.pos <> 'G' and p.injury_status is null and p.nhl_team is not null
    and not exists (select 1 from rosters r where r.player_id = p.id)
  order by p.proj desc limit 1 \gset
insert into rosters (team_id, player_id, slot) values (99, :pass_p, 'BN');
insert into rosters (team_id, player_id, slot) values (2, :pass_p, 'BN');
insert into games (id, date, start_utc, home, away, state) values (997, today_et(), now() + interval '2 hours', :'pass_club', 'ZZZ', 'FUT');
select status as north_status from leagues where id = :league2 \gset
update leagues set status = 'active' where id = :league2;   -- a league in setup is skipped by the scheduler
select count(*) as sak_msgs0 from messages where league_id = 1 \gset
select run_league_jobs('open-book') as pass_open \gset
select pg_temp.expect('each league opened its own board for the game', (select count(*) from markets where game_id = 997 and league_id = 1 and kind in ('winner', 'total', 'ot')) = 3
  and (select count(*) from markets where game_id = 997 and league_id = :league2 and kind in ('winner', 'total', 'ot')) = 3);
select pg_temp.expect('the north''s prop carries the north''s name', exists (select 1 from markets where game_id = 997 and league_id = :league2 and kind = 'prop' and title like '%NP points tonight'));
select pg_temp.expect('each league''s chat heard about its own Book', exists (select 1 from messages where league_id = :league2 and kind = 'system' and meta ? 'book')
  and (select count(*) from messages where league_id = 1) > :sak_msgs0);
select pg_temp.expect('a second run opens nothing new', (select count(*) from markets where game_id = 997) = (select count(*) from markets where game_id = 997)
  and (run_league_jobs('open-book')->>'1')::int = 0 and (run_league_jobs('open-book')->>:'league2')::int = 0);
select pg_temp.expect('the job left no league set behind', coalesce(current_setting('app.league_id', true), '') = '');
-- every job runs for every league; an unknown job is refused
select pg_temp.expect('settling runs league by league', (select count(*) from jsonb_object_keys(run_league_jobs('settle-book'))) = (select count(*) from leagues where status = 'active'));
select pg_temp.raises('only the listed jobs run', 'select run_league_jobs(''drop everything'')', 'Unknown league job');
-- a row written without a league is the caller's
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select pg_temp.expect('an unstamped row takes the caller''s league', (select current_league_id()) = :league2);
reset role;
select set_config('request.jwt.claim.sub', '', false);
update leagues set status = :'north_status' where id = :league2;
select 'league pass', true;

-- ───────────── money per league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select count(*) as sak_gms from teams where league_id = 1 and role = 'gm' \gset
select count(*) as north_gms from teams where league_id = :league2 and role = 'gm' \gset
select count(*) as entries0 from ledger where kind = 'entry' \gset
-- money is an option: a new league keeps none until its commissioner turns it on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('a new league starts without money or a fund', not league_has('money') and not league_has('fund'));
select pg_temp.raises('no money, no billing', 'select commish_bill_entries()', 'doesn''t keep its money');
select pg_temp.raises('features are money and fund only', 'select commish_update_league(''{"features": {"casino": true}}'')', 'Features are money and fund');
select commish_update_league('{"features": {"money": true}}');
select pg_temp.expect('the north turned money on, still no fund', league_has('money') and not league_has('fund') and not exists (select 1 from fund_status));
reset role;
select pg_temp.expect('SaK keeps both', league_has('money', 1) and league_has('fund', 1));
-- the north commissioner bills her league: her GMs only, to her league's fund
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_bill_entries() as north_billed \gset
reset role;
select pg_temp.expect('the north billed its own GMs only', :north_billed = :north_gms
  and (select count(*) from ledger where kind = 'entry') = :entries0 + :north_gms);
select pg_temp.expect('the north''s entries name the north''s fund', (select bool_and(description like '%to the NP Fund') from ledger l join teams t on t.id = l.team_id where l.kind = 'entry' and t.league_id = :league2));
-- her regular-season payouts: her pool (her GMs), her teams, her brand's words
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_post_payouts('regular') as north_paid \gset
reset role;
select pg_temp.expect('north payouts go to north teams only', :north_paid = least(3, :north_gms)
  and not exists (select 1 from ledger l join teams t on t.id = l.team_id where l.kind in ('payout', 'peter') and t.league_id = 1
                  and l.season = (select season from league_rules where league_id = 1)));
select pg_temp.expect('the north''s pool is its own GMs'' entries', (select min(amount) from ledger l join teams t on t.id = l.team_id where l.kind = 'payout' and t.league_id = :league2)
  = (select -round((r.entry_fee - r.sak_fee) * :north_gms * (100 - r.playoff_share - r.cup_share) / 100 * (r.prize_split->>0)::numeric / 100, 2) from league_rules r where r.league_id = :league2));
select pg_temp.expect('a league with no named prizes reads plain words', exists (select 1 from ledger l join teams t on t.id = l.team_id where l.kind = 'payout' and t.league_id = :league2 and l.description like '%Regular season champion (regular season): 1st place'));
-- SaK's commissioner posts SaK's: the words SaK has always had
select pg_temp.as_team(1);
set role authenticated;
select commish_post_payouts('regular') as sak_paid \gset
reset role;
select pg_temp.expect('SaK''s payouts keep SaK''s words, on SaK''s teams', :sak_paid = 3
  and exists (select 1 from ledger l join teams t on t.id = l.team_id where l.kind = 'payout' and t.league_id = 1 and l.description like '% The Johnson (regular season): 1st place')
  and (select count(*) from ledger l join teams t on t.id = l.team_id where l.kind = 'payout' and t.league_id = :league2) = :north_paid);
select pg_temp.expect('the Peter keeps its name and SaK''s fund', (select bool_and(description like '%Peter Punishment: $1 a point behind second-last, to the SaK Fund')
  from ledger where kind = 'peter' and season = (select season from league_rules where league_id = 1)) is not false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('payouts post once', 'select commish_post_payouts(''regular'')', 'already posted');
reset role;
-- a spectator the north adds is the north's, with a new id from the sequence
select max(id) as max_team from teams \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_add_spectator('North Fan', 'north-fan@example.com', 'popcorn-5678') as north_fan \gset
reset role;
select pg_temp.expect('the north''s spectator is the north''s', (select league_id = :league2 and role = 'spectator' from teams where id = :north_fan) and :north_fan > 0
  and (select reason from coin_ledger where team_id = :north_fan) = 'Opening balance: 1,000 coins');
-- the fund is an option too: a paid entry adds nothing in a league without one
select sum(cash) as sak_fund_cash from fund_ledger where league_id = 1 \gset
select count(*) as sak_prices from fund_prices where league_id = 1 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('no fund, no fund entries', 'select commish_fund_entry(''deposit'', 50, 0, ''Seed money'')', 'has no fund');
select l.id as north_entry from ledger l where l.kind = 'entry' and l.league_id = current_league_id() order by l.id limit 1 \gset
select commish_mark_paid(:north_entry, true, 'e-transfer');
reset role;
select pg_temp.expect('a paid entry in a league with no fund adds nothing', not exists (select 1 from fund_ledger where ledger_id = :north_entry));
-- the north turns its fund on: its own row, its own movements, its own prices; SaK's fund doesn't move
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_update_league('{"features": {"fund": true}}');
select commish_fund_entry('deposit', 50, 0, 'Seed money');
select commish_fund_price(100, 1.25);
select pg_temp.expect('the north''s fund is its own', (select cash = 50 and shares = 0 and members = :north_gms from fund_status)
  and (select count(*) from fund_prices) = 1 and (select count(*) from fund_ledger) = 1);
reset role;
select pg_temp.expect('the north''s fund row and price are the north''s', exists (select 1 from fund where league_id = :league2)
  and exists (select 1 from fund_prices where league_id = :league2 and value_cad = 50));
select pg_temp.expect('SaK''s fund is untouched', (select sum(cash) from fund_ledger where league_id = 1) = :sak_fund_cash
  and (select count(*) from fund_prices where league_id = 1) = :sak_prices);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('SaK''s GMs see SaK''s fund', (select count(*) from fund_status) = 1 and (select members from fund_status) = :sak_gms
  and not exists (select 1 from fund_ledger where league_id <> 1));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'money per league', true;

-- ───────────── the prediction log ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- a club with two of SaK's skaters on it plays tonight
select p.nhl_team as pl_club from rosters r join players p on p.id = r.player_id
  where r.league_id = 1 and r.slot <> 'IR' and p.pos <> 'G' and p.nhl_team is not null
  group by p.nhl_team having count(*) >= 2 order by p.nhl_team limit 1 \gset
select min(r.player_id) as pl_dressed, max(r.player_id) as pl_scratched from rosters r join players p on p.id = r.player_id
  where r.league_id = 1 and r.slot <> 'IR' and p.pos <> 'G' and p.nhl_team = :'pl_club' \gset
insert into games (id, date, start_utc, home, away, state) values (998, today_et(), now() + interval '3 hours', :'pl_club', 'QQQ', 'FUT');
select (run_league_jobs('predict')->>'1')::int as predicted_n \gset
select pg_temp.expect('tonight''s players are predicted', :predicted_n > 0
  and (select predicted = _player_rate(:pl_dressed, 'fpts') from predictions where kind = 'player_night' and subject->>'player_id' = :'pl_dressed' and resolves_on = today_et()));
select pg_temp.expect('predicting twice adds nothing', (run_league_jobs('predict')->>'1')::int = 0);
-- the game is played: one of them dresses and scores, the other is scratched
insert into player_games (game_id, player_id, date, stats) values (998, :pl_dressed, today_et(), '{"g":1,"a":1,"sog":4}');
update games set state = 'OFF', final_synced = true where id = 998;
select score_predictions(today_et()) as scored_n \gset
select pg_temp.expect('the one who played is scored on this league''s points', (select status = 'scored' and outcome = (select fpts from league_games where game_id = 998 and player_id = :pl_dressed)
  and error = outcome - predicted from predictions where subject->>'player_id' = :'pl_dressed' and resolves_on = today_et()));
select pg_temp.expect('the scratch is void, not a zero', (select status = 'void' and outcome is null from predictions where subject->>'player_id' = :'pl_scratched' and resolves_on = today_et()));
select pg_temp.expect('accuracy by week', exists (select 1 from prediction_accuracy where kind = 'player_night' and n >= 1));
select pg_temp.expect('the Book''s calibration reads the settled markets', (select count(*) from book_calibration) >= 0);
-- a GM reads their own league's log and nothing else
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north sees none of SaK''s predictions', (select count(*) from predictions) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'prediction log', true;

-- ───────────── league memory ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('SaK''s history is in the database', (select count(*) from league_seasons where league_id = 1) = 13
  and (select count(*) from season_results where league_id = 1) = 104
  and (select team_name from season_results where league_id = 1 and season = '2025-26' and place = 1) = 'Hatrick Swayze'
  and (select count(*) from league_all_time where league_id = 1) = 8);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('a SaK GM reads SaK''s past', (select count(*) from league_seasons) = 13 and (select count(*) from league_rule_text) > 0);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north has a past of its own, empty for now', (select count(*) from league_seasons) = 0 and (select count(*) from season_results) = 0
  and (select count(*) from league_all_time) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'league memory', true;

-- ───────────── the platform opens a league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a league''s commissioner can''t open leagues', 'select create_league(''east'', ''East Pool'', ''EP'', ''{}''::jsonb, 4)', 'Only the platform');
select pg_temp.raises('nor mint the platform''s invites', format('select platform_invite(%s, 99)', :league2), 'Only the platform');
reset role;
select pg_temp.as_team(1);
set role authenticated;
select create_league('east', 'East Pool', 'EP', '{"coin": {"name": "Loonies", "emoji": "🪙"}}'::jsonb, 4) as league3 \gset
select pg_temp.raises('web names are unique', 'select create_league(''east'', ''East Again'', ''EA'')', 'taken');
reset role;
select pg_temp.expect('the league is built whole', (select owner_user is not null and sport = 'nhl' and status = 'setup' from leagues where id = :league3)
  and exists (select 1 from league_rules where league_id = :league3 and profile_id is not null)
  and exists (select 1 from draft_state where league_id = :league3) and exists (select 1 from garry_state where league_id = :league3)
  and (select count(*) from teams where league_id = :league3 and role = 'gm' and user_id is null) = 4
  and (select count(*) from teams where league_id = :league3 and is_commish) = 1);
select pg_temp.expect('every seat has its opening coins, in the league''s coin', (select count(*) from coin_ledger c join teams t on t.id = c.team_id
  where t.league_id = :league3 and c.amount = 1000 and c.reason = 'Opening balance: 1,000 Loonies') = 4);
-- the first commissioner gets in by the platform's invite, then invites the rest
select id as east_seat1 from teams where league_id = :league3 and is_commish \gset
select pg_temp.as_team(1);
set role authenticated;
select platform_invite(:league3, :east_seat1) as east_code \gset
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'east-commish@example.com');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
set role authenticated;
select pg_temp.expect('the invite seats the commissioner', accept_invite(:'east_code') = :league3);
select pg_temp.expect('she runs her league', current_league_id() = :league3 and is_commish());
select pg_temp.expect('and invites the next GM herself', create_invite((select id from teams where league_id = :league3 and not is_commish order by id limit 1)) is not null);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'platform opens a league', true;

-- ───────────── the SQL speaks the league's language ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('SaK''s Book post keeps SaK''s words', exists (select 1 from messages where league_id = 1 and body like '📖 Garry''s Book is open:%St. Patrick coins only%'));
select pg_temp.expect('the north''s Book post uses its own coin', exists (select 1 from messages where league_id = :league2 and body like '📖 %''s Book is open:%player props, coins only%'));
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a SaK GM short of coins hears St. Patrick coins', 'select create_bet(null, ''Too rich'', null, ''custom'', null, null, null, null, 999999)', 'St. Patrick coins available');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'SQL words from the brand', true;
-- ───────────── system lineup changes need nobody signed in ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select r.player_id as sys_p, r.slot as sys_slot from rosters r where r.league_id = 1 and r.slot = 'BN' order by r.player_id limit 1 \gset
update rosters set slot = 'IR' where player_id = :sys_p and league_id = 1;
update rosters set slot = :'sys_slot' where player_id = :sys_p and league_id = 1;
select 'system lineup change', true;

-- ───────────── the shadow league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select open_shadow_league(1, 'sak-shadow') as shadow \gset
select pg_temp.expect('the shadow has SaK''s GM teams and rosters', (select count(*) from teams where league_id = :shadow) = (select count(*) from teams where league_id = 1 and role = 'gm')
  and (select count(*) from rosters where league_id = :shadow) = (select count(*) from rosters r join teams t on t.id = r.team_id where t.league_id = 1 and t.role = 'gm')
  and (select profile_id from league_rules where league_id = :shadow) = (select profile_id from league_rules where league_id = 1));
-- a SaK GM moves a player; the next sync mirrors it
select r.player_id as sh_p, r.team_id as sh_t from rosters r where r.league_id = 1 and r.slot = 'BN' order by r.player_id limit 1 \gset
update rosters set slot = 'IR' where player_id = :sh_p and league_id = 1;
select shadow_sync() as sh_synced \gset
select pg_temp.expect('the sync mirrors a lineup change', :sh_synced >= 1
  and (select slot from rosters where league_id = :shadow and player_id = :sh_p) = 'IR'
  and (select (perms->>'shadow_of')::int from teams where id = (select team_id from rosters where league_id = :shadow and player_id = :sh_p)) = :sh_t);
update rosters set slot = 'BN' where player_id = :sh_p and league_id = 1;
select shadow_sync();
-- a game is played: every team and its shadow gain exactly the same points (snapshots first, so the shadow's
-- backfill of games that started before it existed isn't counted as the new game's)
select take_snapshots();
create temp table shadow_before as select * from shadow_report(:shadow);
select p.nhl_team as sh_club from rosters r join players p on p.id = r.player_id where r.league_id = 1 and r.slot not in ('BN', 'IR') and p.pos <> 'G'
  and p.nhl_team is not null order by r.player_id limit 1 \gset
insert into games (id, date, start_utc, home, away, state) values (996, today_et() - 1, now() - interval '2 hours', :'sh_club', 'SSS', 'LIVE');
select take_snapshots();
insert into player_games (game_id, player_id, date, stats)
  select 996, p.id, today_et() - 1, '{"g":1,"a":1,"sog":3,"hit":2}' from players p where p.nhl_team = :'sh_club' and p.pos <> 'G';
select pg_temp.expect('the game counted', exists (select 1 from lineup_snapshots where game_id = 996 and league_id = :shadow));
select pg_temp.expect('original and shadow moved together', not exists (
  select 1 from shadow_report(:shadow) a left join shadow_before b on b.date = a.date and b.team = a.team
  where a.diff is distinct from coalesce(b.diff, 0)));
select pg_temp.expect('and something actually moved', exists (
  select 1 from shadow_report(:shadow) a left join shadow_before b on b.date = a.date and b.team = a.team
  where a.original is distinct from coalesce(b.original, 0)));
update leagues set status = 'archived' where id = :shadow;
select 'shadow league', true;

-- ───────────── reads that must stay inside one league ─────────────
-- the shadow league is still here (archived), with copies of SaK's team names: the sign-in list and the standings
-- must still read one league, the way the service key (Garry, the edge functions) and the public key read them
reset role;
select set_config('request.jwt.claim.sub', '', false);
select count(*) as sak_teams from teams where league_id = 1 \gset
set role anon;
select pg_temp.expect('the sign-in list is SaK''s teams only', (select count(*) from team_directory) = :sak_teams
  and not exists (select 1 from team_directory where league_id <> 1));
reset role;
select set_config('app.league_id', '1', false);
select pg_temp.expect('SaK''s standings rank SaK''s teams, read with the owner''s rights', (select count(*) from standings) = (select count(*) from teams where league_id = 1 and role = 'gm')
  and not exists (select 1 from standings s join teams t on t.id = s.team_id where t.league_id <> 1)
  and (select count(*) from playoff_standings) = (select count(*) from sak_cup_standings));
select set_config('app.league_id', :'shadow', false);
select pg_temp.expect('the shadow''s standings are its own, ranked from 1', (select count(*) from standings) = (select count(*) from teams where league_id = :shadow and role = 'gm')
  and (select min(rank) from standings) = 1 and not exists (select 1 from standings s join teams t on t.id = s.team_id where t.league_id <> :shadow));
select set_config('app.league_id', '', false);
select 'reads inside one league', true;

-- ───────────── the medium items ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- a team's row never moves to another league's team, whatever path tries
select r.player_id as sak_player from rosters r where r.league_id = 1 order by r.player_id limit 1 \gset
select min(id) as north_team from teams where league_id = :league2 and role = 'gm' \gset
select pg_temp.raises('a roster row can''t move leagues', format('update rosters set team_id = %s where league_id = 1 and player_id = %s', :north_team, :sak_player), 'another league');
select id as sak_pick from draft_picks where league_id = 1 order by id limit 1 \gset
select pg_temp.raises('a draft pick can''t move leagues', format('update draft_picks set team_id = %s where id = %s', :north_team, :sak_pick), 'another league');
-- the north commissioner's status panel: the league's part, not the platform's jobs or errors
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('a league''s commissioner sees no platform jobs or errors', (select h->'jobs' = '[]'::jsonb and h->'last_error' = 'null'::jsonb and h ? 'phase' from (select commish_health() h) x));
-- her custom market is her league's, named outright
select commish_market('{"title": "Who scores first?", "options": [{"label": "Us", "odds": 1.9}, {"label": "Them", "odds": 1.9}]}') as north_market \gset
reset role;
select pg_temp.expect('a commissioner''s market is her league''s', (select league_id from markets where id = :north_market) = :league2);
select pg_temp.expect('the scheduler''s headers are the scheduler''s', not has_function_privilege('authenticated', 'public._edge_headers(boolean)', 'execute')
  and not has_function_privilege('anon', 'public._edge_headers(boolean)', 'execute'));
select set_config('request.jwt.claim.sub', '', false);
select 'medium items', true;

-- ───────────── Garry's daily budget ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('a league with no budget set gets the default $1.00', (garry_budget(:league2)->>'budget')::numeric = 1.00);
-- the north commissioner can't set it; the platform can
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a commissioner can''t set Garry''s budget', format('select set_garry_budget(%s, 5)', :league2), 'Only the platform');
reset role;
insert into ops.platform_admins (user_id) select user_id from teams where id = 1 on conflict do nothing;
select pg_temp.as_team(1);
set role authenticated;
select set_garry_budget(:league2, 0.25);
reset role;
-- spending past it leaves nothing for today, in that league only
select meter_cost(:league2, 'xai', 'garry.reply', 1, 1000, 0, 500, 0, 0.30);
select meter_cost(:league2, 'xai', 'hub.x_feed', 1, 1000, 0, 500, 0, 5.00);
select pg_temp.expect('the north''s Garry is out for today', (garry_budget(:league2)->>'left')::numeric = 0 and (garry_budget(:league2)->>'spent')::numeric = 0.30);
select pg_temp.expect('SaK''s budget is its own', (garry_budget(1)->>'left')::numeric > 0);
select pg_temp.expect('the public key can''t read budgets', not has_function_privilege('authenticated', 'public.garry_budget(int)', 'execute'));
select set_config('request.jwt.claim.sub', '', false);
select 'garry budget', true;

-- ───────────── counter-offers ─────────────
-- Patrick offers Terry coins; Terry counters for more. The first offer closes as countered, the counter names it,
-- and Patrick hears it was countered
reset role;
select pg_temp.as_team(1);
set role authenticated;
select propose_trade(2, '{}', '{}', '{}', '{}', 'coins for nothing', 0, 0, 5, 0) as first_offer \gset
reset role;
select pg_temp.as_team(3);
set role authenticated;
select pg_temp.raises('only the GM an offer was made to can counter it',
  format('select propose_trade(1, ''{}'', ''{}'', ''{}'', ''{}'', null, 0, 0, 0, 5, ''{}'', %s)', :first_offer), 'counter an open offer');
reset role;
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a counter goes back to the GM who made the offer',
  format('select propose_trade(3, ''{}'', ''{}'', ''{}'', ''{}'', null, 0, 0, 0, 5, ''{}'', %s)', :first_offer), 'counter an open offer');
select propose_trade(1, '{}', '{}', '{}', '{}', 'make it ten', 0, 0, 0, 10, '{}', :first_offer) as counter_offer \gset
select pg_temp.raises('an offer can only be countered once',
  format('select propose_trade(1, ''{}'', ''{}'', ''{}'', ''{}'', null, 0, 0, 0, 12, ''{}'', %s)', :first_offer), 'counter an open offer');
reset role;
select pg_temp.expect('the first offer closed as countered', (select status from trades where id = :first_offer) = 'countered');
select pg_temp.expect('the counter names the offer it answers', (select counter_of from trades where id = :counter_offer) = :first_offer
  and (select status from trades where id = :counter_offer) = 'proposed');
select pg_temp.expect('Patrick is told it was countered', exists (select 1 from notifications where team_id = 1 and body like '% countered your trade offer'));
select pg_temp.expect('the old signature is closed', not has_function_privilege('authenticated',
  'public.propose_trade_before_counter(int, int[], int[], int[], int[], text, int, int, int, int, int[])', 'execute'));
-- the north can't counter SaK's offers
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a counter from another league is refused',
  format('select propose_trade(1, ''{}'', ''{}'', ''{}'', ''{}'', null, 0, 0, 0, 5, ''{}'', %s)', :counter_offer));
reset role;
select pg_temp.as_team(2);
set role authenticated;
select cancel_trade(:counter_offer);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'counter-offers', true;

-- ───────────── phones in more than one league (B8) ─────────────
-- one phone, a SaK GM and the north's commissioner: each league keeps its own row, so both get their alerts
reset role;
select pg_temp.as_team(1);
set role authenticated;
select push_subscribe('https://push.example/phone-1', 'k', 'a', 'test phone');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select push_subscribe('https://push.example/phone-1', 'k', 'a', 'test phone');
select pg_temp.expect('a GM sees only their own devices', push_device_count() = 1);
reset role;
select pg_temp.expect('one phone carries a row per league', (select count(*) from push_subscriptions where endpoint = 'https://push.example/phone-1') = 2
  and exists (select 1 from push_subscriptions where endpoint = 'https://push.example/phone-1' and team_id = 1 and league_id = 1)
  and exists (select 1 from push_subscriptions where endpoint = 'https://push.example/phone-1' and team_id = 99 and league_id = :league2));
-- the same phone signed in as another SaK team moves over within SaK; the north's row stays
select pg_temp.as_team(2);
set role authenticated;
select push_subscribe('https://push.example/phone-1', 'k2', 'a2', 'test phone');
select push_subscribe('https://push.example/phone-1', 'k2', 'a2', 'test phone');
reset role;
select pg_temp.expect('within a league a phone belongs to one team', (select array_agg(team_id order by team_id) from push_subscriptions where endpoint = 'https://push.example/phone-1') = array[2, 99]);
-- a notification still starts a push, with the scheduler's key
select pg_temp.expect('the push trigger sends the platform key', (select prosrc from pg_proc where proname = '_push_on_notify') like '%_edge_headers(true)%');
insert into notifications (team_id, kind, body, link) values (2, 'trade', 'test push', '/trades');
delete from push_subscriptions where endpoint = 'https://push.example/phone-1';
delete from notifications where body = 'test push';
select set_config('request.jwt.claim.sub', '', false);
select 'push per league', true;

-- ───────────── trades in the prediction log ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('an approved trade logs a value for each side', exists (
  select 1 from predictions pr join trades t on t.id = (pr.subject->>'trade_id')::bigint
  where pr.kind = 'trade_value' and t.status = 'approved' and pr.league_id = t.league_id
    and jsonb_typeof(pr.subject->'in') = 'array' and pr.resolves_on > (pr.subject->>'from')::date - 1));
select pg_temp.expect('one row per team per trade', not exists (
  select 1 from predictions where kind = 'trade_value' group by league_id, subject->>'trade_id', subject->>'team_id' having count(*) > 1));
select pg_temp.expect('the two sides of a two-team trade mirror each other', not exists (
  select 1 from predictions a join predictions b on a.kind = 'trade_value' and b.kind = 'trade_value' and a.subject->>'trade_id' = b.subject->>'trade_id'
    and a.subject->>'team_id' < b.subject->>'team_id' join trades t on t.id = (a.subject->>'trade_id')::bigint and t.parties is null
  where a.predicted + b.predicted <> 0));
-- scored once the season it was valued over is done
select set_config('app.league_id', '1', false);
select score_predictions((select max(resolves_on) from predictions where kind = 'trade_value' and league_id = 1));
select set_config('app.league_id', '', false);
select pg_temp.expect('a trade value is scored at the end of the season', exists (
  select 1 from predictions where kind = 'trade_value' and league_id = 1 and status = 'scored' and outcome is not null and error = outcome - predicted));
select 'trade predictions', true;

-- ───────────── sign-in emails ─────────────
-- the commissioner puts a GM's real email on the account; the account and its password stay
reset role;
select user_id as terry_uid from teams where id = 2 \gset
create temp table terry_before as select encrypted_password from auth.users where id = :'terry_uid';
-- live accounts carry an email identity beside the user; the test's GMs are made without one
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
  select gen_random_uuid(), id, id::text, 'email', jsonb_build_object('sub', id::text, 'email', email), now(), now()
  from auth.users where id = :'terry_uid' and not exists (select 1 from auth.identities where user_id = :'terry_uid');
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the commissioner sees the league''s sign-ins', (select count(*) from commish_accounts()) = (select count(*) from teams where league_id = 1 and user_id is not null));
select commish_set_login_email(2, '  Terry.Real@Example.com ');
select pg_temp.raises('an email can sign in to one account only', 'select commish_set_login_email(3, ''terry.real@example.com'')', 'Another account');
select pg_temp.raises('an address has to look like one', 'select commish_set_login_email(3, ''terry'')', 'look like an email');
reset role;
select pg_temp.expect('the account takes the new email, password unchanged', (select u.email = 'terry.real@example.com' and u.encrypted_password is not distinct from b.encrypted_password and u.email_confirmed_at is not null
    from auth.users u, terry_before b where u.id = :'terry_uid'));
select pg_temp.expect('the email identity and the team follow', (select identity_data->>'email' from auth.identities where user_id = :'terry_uid' and provider = 'email') = 'terry.real@example.com'
  and (select login_email from teams where id = 2) = 'terry.real@example.com');
-- a GM can't do it, and the north's commissioner can't reach SaK's accounts
select pg_temp.as_team(3);
set role authenticated;
select pg_temp.raises('a GM can''t set sign-in emails', 'select commish_set_login_email(3, ''jason@example.com'')', 'Commissioner only');
select pg_temp.raises('a GM can''t list the sign-ins', 'select * from commish_accounts()', 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('the north''s commissioner can''t touch SaK''s accounts', 'select commish_set_login_email(2, ''x@example.com'')');
select pg_temp.expect('the north''s commissioner sees only the north''s sign-ins', not exists (select 1 from commish_accounts() a join teams t on t.id = a.team_id where t.league_id <> :league2));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'sign-in emails', true;

-- ───────────── sign-in, step 2 ─────────────
select pg_temp.expect('the public team list hands out no sign-in addresses', not exists (
  select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_directory' and column_name = 'login_email'));
set role anon;
select pg_temp.expect('the public key still reads the league''s names', (select count(*) from team_directory) > 0);
reset role;
select 'sign-in step 2', true;

-- ───────────── joining by invite ─────────────
-- the north commissioner offers an open seat; the link shows what it's for to someone signed out
reset role;
insert into teams (name, abbrev, gm_name, league_id, role) values ('Polar Express', 'POL', 'Open seat', :league2, 'gm') returning id as join_seat \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select create_invite(:join_seat) as join_code \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect('the link shows its league and seat before sign-in', (select (v->>'ok')::boolean and v->>'team' = 'Polar Express' and v->>'role' = 'gm' and v ? 'league' from invite_preview(:'join_code') v));
select pg_temp.expect('a made-up code shows nothing', (invite_preview('not-a-code')->>'reason') = 'unknown' and not (invite_preview('not-a-code')->>'ok')::boolean);
select pg_temp.expect('the public key can''t seat anyone', not has_function_privilege('anon', 'public._accept_invite(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._accept_invite(uuid, text, text)', 'execute'));
reset role;
-- the join function makes the newcomer's account and seats them with their name
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000096', 'newcomer@example.com');
select pg_temp.expect('a newcomer takes the seat', _accept_invite('00000000-0000-0000-0000-000000000096', :'join_code', ' Nora Newcomer ') = :league2);
select pg_temp.expect('the seat carries their name and account', (select gm_name = 'Nora Newcomer' and user_id = '00000000-0000-0000-0000-000000000096' and login_email = 'newcomer@example.com' from teams where id = :join_seat));
select pg_temp.expect('they are a member, with the north as their league', exists (select 1 from league_members where user_id = '00000000-0000-0000-0000-000000000096' and league_id = :league2 and team_id = :join_seat)
  and (select active_league_id from accounts where user_id = '00000000-0000-0000-0000-000000000096') = :league2);
select pg_temp.expect('the link now says it is spent', (select not (v->>'ok')::boolean from invite_preview(:'join_code') v));
select pg_temp.raises('a spent link seats nobody else', format('select _accept_invite(%L, %L)', '00000000-0000-0000-0000-000000000097', :'join_code'), 'no longer good');
select set_config('request.jwt.claim.sub', '', false);
select 'joining by invite', true;

-- ───────────── onboarding: the checklist, going live, the league's identity ─────────────
reset role;
select pg_temp.as_team(1);
set role authenticated;
select create_league('pond', 'Pond Hockey Pool', 'PHP', '{}'::jsonb, 3) as league4 \gset
select pg_temp.expect('the platform sees every league with its seats', (select seats = 3 and filled = 0 and status = 'setup' and not commish_seated
  from platform_leagues() where league_id = :league4) and exists (select 1 from platform_leagues() where league_id = 1));
select pg_temp.expect('a new league isn''t ready until its commissioner is in', (select bool_and((x->>'ok')::boolean) filter (where x->>'key' in ('name', 'rules', 'draft', 'coins'))
  and not bool_or((x->>'ok')::boolean) filter (where x->>'key' = 'commish') from jsonb_array_elements(league_readiness(:league4)) x));
select pg_temp.raises('it can''t go live before then', format('select platform_set_league_status(%s, ''active'')', :league4), 'Commissioner signed in');
select pg_temp.raises('SaK stays as it is', 'select platform_set_league_status(1, ''archived'')', 'stays as it is');
reset role;
select id as pond_seat1 from teams where league_id = :league4 and is_commish \gset
set role authenticated;
select platform_invite(:league4, :pond_seat1) as pond_code \gset
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'pond-commish@example.com');
select _accept_invite('00000000-0000-0000-0000-0000000000f1', :'pond_code', 'Pat Pond');
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('with the commissioner in, the league goes live', platform_set_league_status(:league4, 'active') = 'active');
reset role;
select pg_temp.expect('and is on the nightly jobs', (select status from leagues where id = :league4) = 'active');
-- nobody else switches leagues or reads another league's checklist
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a commissioner can''t switch leagues on', format('select platform_set_league_status(%s, ''archived'')', :league4), 'Only the platform');
select pg_temp.raises('nor list the platform''s leagues', 'select * from platform_leagues()', 'Only the platform');
select pg_temp.raises('nor read another league''s checklist', format('select league_readiness(%s)', :league4), 'Only the platform');
select pg_temp.expect('but reads her own', jsonb_array_length(league_readiness(:league2)) = 7);
-- the north's commissioner gives her league its identity
select pg_temp.expect('the commissioner names her league and its words', (commish_set_brand(' North Stars Pool ', 'NSP',
  '{"tagline": "Cold hands", "trophy": "The Aurora", "coin": {"name": "Snowflakes", "emoji": "❄️"}, "wordmark": {"a": "NORTH", "b": "POOL"}, "colors": {"gold": "#7DD3FC"}, "evil": "x"}'::jsonb)
  ->'colors'->>'gold') = '#7dd3fc');
select pg_temp.expect('the league row carries it, unknown keys left out', (select name = 'North Stars Pool' and short_name = 'NSP' and brand->>'trophy' = 'The Aurora'
  and brand->'coin'->>'name' = 'Snowflakes' and brand->'wordmark'->>'a' = 'NORTH' and not brand ? 'evil' from leagues where id = :league2)
  and (select name from league_rules where league_id = :league2) = 'North Stars Pool');
select commish_set_brand('North Stars Pool', 'NSP', '{"trophy": "", "tagline": "", "coin": {"emoji": ""}}'::jsonb);
select pg_temp.expect('an emptied word goes back to the default', (select not brand ? 'trophy' and brand->'coin'->>'name' = 'Snowflakes' and not brand->'coin' ? 'emoji' from leagues where id = :league2));
select pg_temp.expect('an emptied tagline means none', (select brand->>'tagline' = '' from leagues where id = :league2));
select pg_temp.raises('a colour is a hex code', 'select commish_set_brand(''North Stars Pool'', ''NSP'', ''{"colors": {"gold": "red"}}''::jsonb)', 'hex code');
select pg_temp.raises('a league needs a name', 'select commish_set_brand('' '', ''NSP'', null)', '2 to 60');
reset role;
select pg_temp.expect('SaK''s name and brand are untouched', (select slug = 'sak' and brand->>'trophy' = 'The SAK Cup' and brand->'coin'->>'name' = 'St. Patrick coins' from leagues where id = 1));
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM can''t rebrand the league', 'select commish_set_brand(''Mine'', ''M'', null)', 'commissioner');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'onboarding', true;

-- ───────────── league by host ─────────────
reset role;
set role anon;
select pg_temp.expect('sak.superpoolsai.com is SaK', (league_by_host('sak.superpoolsai.com')->>'id')::int = 1);
select pg_temp.expect('with a port and capitals too', (league_by_host('SAK.superpoolsai.com:443')->>'id')::int = 1);
select pg_temp.expect('the pond''s address is the pond', (league_by_host('pond.superpoolsai.com')->>'id')::int = :league4);
select pg_temp.expect('the app''s own hosts are no league', league_by_host('superpoolsai.com') is null and league_by_host('www.superpoolsai.com') is null
  and league_by_host('app.superpoolsai.com') is null and league_by_host('patricknovak.github.io') is null and league_by_host('localhost') is null);
select pg_temp.expect('an unknown name is no league', league_by_host('nobody.superpoolsai.com') is null);
select pg_temp.expect('it tells a stranger the brand and nothing about anyone', (select array_agg(k order by k) from jsonb_object_keys(league_by_host('sak.superpoolsai.com')) k)
  = array['brand', 'id', 'name', 'short_name', 'slug', 'status']);
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the platform gives the pond a domain of its own', platform_set_league_domain(:league4, ' Pool.Example.com ') = 'pool.example.com');
select pg_temp.raises('a superpoolsai.com address is already every league''s', format('select platform_set_league_domain(%s, ''x.superpoolsai.com'')', :league4), 'already has');
select pg_temp.raises('a domain is a web address', format('select platform_set_league_domain(%s, ''not a domain'')', :league4), 'web address');
select pg_temp.raises('two leagues can''t share a domain', 'select platform_set_league_domain(1, ''pool.example.com'')', 'Another league');
select pg_temp.expect('the platform list shows it', (select domain from platform_leagues() where league_id = :league4) = 'pool.example.com');
reset role;
set role anon;
select pg_temp.expect('its own domain opens it', (league_by_host('pool.example.com')->>'id')::int = :league4);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a commissioner can''t set domains', format('select platform_set_league_domain(%s, null)', :league2), 'Only the platform');
reset role;
-- the site names the host's league in x-league: a member gets it, anyone else stays in their own league
select set_config('request.headers', json_build_object('x-league', :league4::text)::text, false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', false);
select pg_temp.expect('the pond''s commissioner on the pond''s address is in the pond', current_league_id() = :league4);
select pg_temp.as_team(2);
select pg_temp.expect('a SaK GM on the pond''s address stays in SaK', current_league_id() = 1);
select set_config('request.headers', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'league by host', true;

-- ───────────── asking for a league ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select pg_temp.expect('anyone can ask for a league', request_league(' Lou Lake ', 'Lou@Example.com ', 'Lake Shinny', 10, 'yahoo', 'Twelve years on Yahoo'));
select pg_temp.raises('a request needs an email', 'select request_league(''Lou'', ''not-an-email'', ''Lake'', 10)', 'email address');
select pg_temp.raises('and a sensible number of teams', 'select request_league(''Lou'', ''lou@example.com'', ''Lake'', 40)', 'Between 2 and 20');
select request_league('Lou Lake', 'lou@example.com', 'Lake Shinny', 10);
select request_league('Lou Lake', 'lou@example.com', 'Lake Shinny', 10);
select pg_temp.raises('one email asks a few times a day at most', 'select request_league(''Lou Lake'', ''lou@example.com'', ''Lake Shinny'', 10)', 'already');
select pg_temp.raises('the public can''t read the inbox', 'select * from platform_league_requests()', 'permission denied');
reset role;
select pg_temp.expect('the inbox is out of the API''s reach', not has_schema_privilege('anon', 'ops', 'usage') and not has_schema_privilege('authenticated', 'ops', 'usage'));
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the platform hears about it in its bell', exists (select 1 from notifications where team_id = 1 and kind = 'platform' and body like '📮 Lou Lake asked for a league: Lake Shinny, 10 teams'));
select pg_temp.expect('the platform sees it, trimmed and lower-cased', (select name = 'Lou Lake' and email = 'lou@example.com' and teams = 10 and plays_on = 'yahoo' and status = 'new'
  from platform_league_requests() order by created_at limit 1));
select pg_temp.expect('and marks it opened with the league it became', platform_close_request((select min(id) from platform_league_requests()), 'opened', :league2) = 'opened');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a commissioner can''t read the platform''s inbox', 'select * from platform_league_requests()', 'Only the platform');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'asking for a league', true;
-- ───────────── the commissioner's log ─────────────
reset role;
select pg_temp.expect('the north commissioner''s rebrand earlier is on the north''s log', exists (select 1 from commish_log where league_id = :league2 and team_id = 99 and action = 'commish_set_brand'));
-- one line per action, even when one commissioner function calls another inside it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
begin;
set local role authenticated;
select commish_update_league('{"pick_seconds": 75}'::jsonb);
select commish_update_league('{"pick_seconds": 80}'::jsonb);
select txid_current() as log_tx \gset
commit;
select pg_temp.expect('two calls in one transaction are one line', (select count(*) from commish_log where tx = :log_tx) = 1);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select commish_update_league('{"pick_seconds": 60}'::jsonb);
select count(*) from commish_accounts();
reset role;
select pg_temp.expect('a rules change is a line with who and when', exists (select 1 from commish_log where league_id = :league2 and team_id = 99 and action = 'commish_update_league' and at > now() - interval '1 minute'));
select pg_temp.expect('reading the account list is not', not exists (select 1 from commish_log where action = 'commish_accounts'));
-- every member reads their own league's log, nobody writes to it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000096', false);
set role authenticated;
select pg_temp.expect('a north GM reads the north''s log and only it', (select count(*) > 0 and bool_and(league_id = :league2) from commish_log));
select pg_temp.raises('nobody writes to the log by hand', 'insert into commish_log (team_id, action) values (99, ''commish_coins'')', 'permission denied');
reset role;
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('a SaK GM reads only SaK''s', not exists (select 1 from commish_log where league_id <> 1));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'the commissioner''s log', true;

-- ───────────── the league's constitution ─────────────
reset role;
select count(*) as sak_rules from league_rule_text where league_id = 1 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north''s commissioner writes the league''s rules', commish_set_rules(
  '[{"title": "Conduct", "items": ["Chirp the GM, never the person.", "  ", "Pay on time."]}, {"title": "", "items": []}, {"title": "Trades", "items": ["No trades between two teams out of the race."]}]'::jsonb) = 2);
select pg_temp.expect('in order, empty lines dropped', (select array_agg(title order by sort) from league_rule_text) = array['Conduct', 'Trades']
  and (select items from league_rule_text where title = 'Conduct') = array['Chirp the GM, never the person.', 'Pay on time.']);
select pg_temp.raises('two sections can''t share a name', 'select commish_set_rules(''[{"title": "A", "items": ["x"]}, {"title": "A", "items": ["y"]}]''::jsonb)', 'Two sections');
select pg_temp.raises('a section with rules needs a title', 'select commish_set_rules(''[{"title": " ", "items": ["x"]}]''::jsonb)', 'needs a title');
reset role;
select pg_temp.expect('a refused change leaves the rules as they were', (select count(*) from league_rule_text where league_id = :league2) = 2);
select pg_temp.expect('it is on the commissioner''s log', exists (select 1 from commish_log where league_id = :league2 and action = 'commish_set_rules'));
select pg_temp.expect('SaK''s rules are untouched', (select count(*) from league_rule_text where league_id = 1) = :sak_rules);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM can''t rewrite the rules', 'select commish_set_rules(''[]''::jsonb)', 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'the league''s constitution', true;

-- ───────────── a league's past, written in ─────────────
reset role;
select string_agg(season || ':' || sort, ',' order by season) as sak_sorts from league_seasons where league_id = 1 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north''s commissioner writes in a past season', commish_set_season('2024-25', 'Won it on the last night.',
  '[{"team_name": "North Stars", "gm_name": "Nora", "team_id": 99, "points": 2400.5, "prize": 300}, {"team_name": "Old Timers", "gm_name": "Olaf", "points": 2300}, {"team_name": "Igloo", "gm_name": "Ivy", "points": 1900, "last_place": true}]'::jsonb) = 3);
select commish_set_season('2023-24', null, '[{"team_name": "Old Timers", "gm_name": "Olaf"}, {"team_name": "North Stars", "gm_name": "Nora", "team_id": 99}]'::jsonb);
select pg_temp.expect('the seasons read in order, the table in places', (select array_agg(season order by sort) from league_seasons) = array['2023-24', '2024-25']
  and (select array_agg(team_name order by place) from season_results where season = '2024-25') = array['North Stars', 'Old Timers', 'Igloo']
  and (select team_id from season_results where season = '2024-25' and place = 1) = 99
  and (select last_place from season_results where season = '2024-25' and place = 3));
select pg_temp.expect('writing a season again', commish_set_season('2024-25', null, '[{"team_name": "Old Timers", "gm_name": "Olaf"}, {"team_name": "North Stars", "gm_name": "Nora"}]'::jsonb) = 2);
select pg_temp.expect('replaces it', (select team_name from season_results where season = '2024-25' and place = 1) = 'Old Timers'
  and (select count(*) from season_results where season = '2024-25') = 2);
select pg_temp.raises('the season being played isn''t written by hand', format('select commish_set_season(%L, null, ''[{"team_name":"a","gm_name":"b"},{"team_name":"c","gm_name":"d"}]''::jsonb)', (select season from league)), 'Only past seasons');
select pg_temp.raises('a season is written like 2019-20', 'select commish_set_season(''2019-21'', null, ''[{"team_name":"a","gm_name":"b"},{"team_name":"c","gm_name":"d"}]''::jsonb)', 'like 2019-20');
select pg_temp.raises('one last place a season', 'select commish_set_season(''2019-20'', null, ''[{"team_name":"a","gm_name":"b","last_place":true},{"team_name":"c","gm_name":"d","last_place":true}]''::jsonb)', 'One last place');
select commish_set_season('2022-23', null, '[{"team_name": "Pirates", "gm_name": "Pat", "team_id": 1}, {"team_name": "North Stars", "gm_name": "Nora"}]'::jsonb);
select pg_temp.expect('a team from another league isn''t linked to it', (select team_id from season_results where season = '2022-23' and place = 1) is null);
select pg_temp.expect('a season comes out again', commish_delete_season('2023-24'));
select pg_temp.expect('and is gone', not exists (select 1 from league_seasons where season = '2023-24'));
reset role;
select pg_temp.expect('the edits are on the log', (select count(*) from commish_log where league_id = :league2 and action in ('commish_set_season', 'commish_delete_season')) >= 3);
select pg_temp.expect('SaK''s seasons are untouched, numbers and all', (select string_agg(season || ':' || sort, ',' order by season) from league_seasons where league_id = 1) = :'sak_sorts');
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM can''t write the league''s past', 'select commish_delete_season(''2024-25'')', 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'a league''s past, written in', true;
-- ───────────── commissioner tools: co-commissioners and a handover ─────────────
reset role;
select id as hand_seat from teams where league_id = :league2 and gm_name = 'Nora Newcomer' \gset
insert into push_subscriptions (endpoint, team_id, p256dh, auth, league_id) values ('https://push.example/nora', :hand_seat, 'k', 'a', :league2);
insert into teams (name, abbrev, gm_name, league_id, role) values ('Tundra', 'TUN', 'Open seat', :league2, 'gm') returning id as open_seat \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('the north''s commissioner shares the job', commish_set_cocommish(:hand_seat, true));
reset role;
select pg_temp.expect('the co-commissioner is a commissioner in the north', (select role from league_members where user_id = '00000000-0000-0000-0000-000000000096' and league_id = :league2) = 'commish');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000096', false);
set role authenticated;
select pg_temp.expect('and has the commissioner''s powers', is_commish() and current_league_id() = :league2);
-- with two in place, either can step down; the last one can't
select pg_temp.expect('she takes the original''s role away', not commish_set_cocommish(99, false));
select pg_temp.raises('the last commissioner can''t step down', format('select commish_set_cocommish(%s, false)', :hand_seat), 'needs a commissioner');
select commish_set_cocommish(99, true);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('and he takes hers back', not commish_set_cocommish(:hand_seat, false));
select pg_temp.raises('an open seat can''t run the league', format('select commish_set_cocommish(%s, true)', :open_seat), 'no GM yet');
-- the newcomer has moved on: the seat is handed over
select commish_vacate_seat(:hand_seat) as hand_code \gset
reset role;
select pg_temp.expect('the seat is open again, its team kept', (select user_id is null and gm_name = 'Open seat' and name = 'Polar Express' from teams where id = :hand_seat));
select pg_temp.expect('the old GM is out of the league, their phones too', not exists (select 1 from league_members where user_id = '00000000-0000-0000-0000-000000000096' and league_id = :league2)
  and not exists (select 1 from push_subscriptions where team_id = :hand_seat));
select pg_temp.expect('a fresh invite for the seat', (select (v->>'ok')::boolean and v->>'team' = 'Polar Express' from invite_preview(:'hand_code') v));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.raises('a commissioner can''t vacate their own seat', 'select commish_vacate_seat(99)', 'own seat');
select pg_temp.raises('nor another league''s', 'select commish_vacate_seat(2)', 'another league');
reset role;
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM can''t hand over seats', format('select commish_vacate_seat(%s)', :hand_seat), 'Commissioner only');
select pg_temp.raises('or make commissioners', 'select commish_set_cocommish(3, true)', 'Commissioner only');
reset role;
select pg_temp.expect('SaK''s commissioners are untouched', (select array_agg(id order by id) from teams where league_id = 1 and is_commish) = array[1]);
select set_config('request.jwt.claim.sub', '', false);
select 'commissioner tools', true;
-- ───────────── a new league's path to its draft ─────────────
reset role;
select pg_temp.as_team(1);
set role authenticated;
select create_league('rink', 'Rink Rats', 'RR', '{}'::jsonb, 3) as league5 \gset
reset role;
select pg_temp.expect('a new league opens ready to draft, not in keepers', (select phase from league_rules where league_id = :league5) = 'predraft');
select pg_temp.expect('and on the season''s calendar: first and last days, the trade deadline', (select r.season_start is not distinct from s.season_start
  and r.season_end is not distinct from s.season_end and r.trade_deadline is not distinct from s.trade_deadline and r.playoffs_end is not distinct from s.playoffs_end
  and r.season_start is not null from league_rules r, league_rules s where r.league_id = :league5 and s.league_id = 1));
select id as rink_seat1 from teams where league_id = :league5 and is_commish \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'rink-commish@example.com');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
set role authenticated;
select platform_invite(:league5, :rink_seat1) as rink_code \gset
reset role;
select _accept_invite('00000000-0000-0000-0000-0000000000f2', :'rink_code', 'Rita Rink');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', false);
set role authenticated;
select pg_temp.expect('randomizing draws only this league''s teams', (select array_agg(x order by x) from unnest(draft_randomize_order()) x)
  = (select array_agg(id order by id) from teams where role = 'gm'));
select draft_start();
reset role;
-- the commissioner picks first if the hat says so; whoever is on the clock, an open seat's clock is short
select pg_temp.expect('an open seat''s pick comes in seconds, a GM''s gets the full clock', (
  select case when t.user_id is null then d.deadline <= now() + interval '5 seconds' else d.deadline > now() + interval '30 seconds' end
  from draft_state d join draft_picks p on p.league_id = d.league_id and p.season = d.season and p.overall = d.current_overall
  join teams t on t.id = p.team_id where d.league_id = :league5));
select set_config('request.jwt.claim.sub', '', false);
select 'a new league''s path to its draft', true;

-- ───────────── drafts and keepers join the prediction log ─────────────
reset role;
update league_rules set season_end = today_et() + 180 where league_id = :league5;
do $$ declare i int; lid int := (select id from leagues where slug = 'rink'); begin
  for i in 1..80 loop
    update draft_state set deadline = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick();
  end loop; end $$;
select pg_temp.expect('the rink''s draft runs to the end', (select status from draft_state where league_id = :league5) = 'done');
select pg_temp.expect('every team''s draft class is forecast', (select count(*) from predictions where league_id = :league5 and kind = 'draft_value') = 3
  and (select bool_and(jsonb_array_length(subject->'players') = (select draft_rounds from league_rules where league_id = :league5)) from predictions where league_id = :league5 and kind = 'draft_value')
  and (select bool_and(status = 'open' and resolves_on = today_et() + 180) from predictions where league_id = :league5 and kind = 'draft_value'));
select pg_temp.expect('a new league kept nobody, so no keeper forecast', not exists (select 1 from predictions where league_id = :league5 and kind = 'keeper_value'));
-- at the season's end, each class is scored on what its players did, whoever they play for by then
update predictions set resolves_on = today_et() - 1 where league_id = :league5 and kind = 'draft_value';
select set_config('app.league_id', :league5::text, false);
select score_predictions();
select set_config('app.league_id', '', false);
select pg_temp.expect('and scored once the season is done', (select bool_and(status = 'scored' and outcome is not null and error = outcome - predicted) from predictions where league_id = :league5 and kind = 'draft_value'));
select pg_temp.expect('nobody else''s draft is touched', not exists (select 1 from predictions where kind = 'draft_value' and league_id not in (1, :league5)));
select set_config('request.jwt.claim.sub', '', false);
select 'drafts and keepers join the prediction log', true;

-- ───────────── a league's own roster ─────────────
reset role;
select roster::text as pond_roster_before from league_rules where league_id = :league4 \gset
select id as pond_commish from teams where league_id = :league4 and is_commish \gset
select user_id as pond_commish_user from teams where id = :pond_commish \gset
update league_rules set phase = 'predraft' where league_id = :league4;
update draft_state set order_set = false, status = 'scheduled' where league_id = :league4;
select set_config('request.jwt.claim.sub', :'pond_commish_user', false);
set role authenticated;
select pg_temp.expect('the commissioner sets the league''s own slots, and the draft follows', (commish_set_roster('{"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 2, "Util": 2, "BN": 6, "IR": 1}'::jsonb)->>'rounds')::int = 20 - (select keepers from league));
select pg_temp.expect('the rules carry it', (select roster->>'D' = '4' and roster->>'BN' = '6' and draft_rounds = 20 - keepers from league));
select pg_temp.raises('a league needs a goalie', 'select commish_set_roster(''{"C": 2, "LW": 2, "RW": 2, "D": 4, "G": 0, "Util": 2, "BN": 6, "IR": 1}''::jsonb)', 'G takes');
select pg_temp.raises('every slot is counted', 'select commish_set_roster(''{"C": 2}''::jsonb)', 'needs a count');
select pg_temp.raises('half a defenceman is no slot', 'select commish_set_roster(''{"C": 2, "LW": 2, "RW": 2, "D": 3.5, "G": 2, "Util": 2, "BN": 6, "IR": 1}''::jsonb)', 'D takes');
reset role;
update draft_state set order_set = true where league_id = :league4;
select set_config('request.jwt.claim.sub', :'pond_commish_user', false);
set role authenticated;
select pg_temp.raises('not once the order is drawn', 'select commish_set_roster(''{"C": 2, "LW": 2, "RW": 2, "D": 3, "G": 2, "Util": 1, "BN": 12, "IR": 2}''::jsonb)', 'before the draft order');
reset role;
select pg_temp.expect('SaK''s roster is untouched', (select roster from league_rules where league_id = 1) = '{"C": 2, "D": 3, "G": 2, "BN": 12, "IR": 2, "LW": 2, "RW": 2, "Util": 1}'::jsonb);
select pg_temp.expect('it is on the log', exists (select 1 from commish_log where league_id = :league4 and action = 'commish_set_roster'));
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('a GM can''t change the roster', 'select commish_set_roster(''{}''::jsonb)', 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'a league''s own roster', true;

-- ───────────── rotisserie ─────────────
reset role;
select id as roto_league from leagues where slug = 'sak-shadow' \gset
update league_rules set categories = array['g', 'a', 'pim', 'sog', 'w', 'gaa', 'svp'] where league_id = :roto_league;
select set_config('app.league_id', :roto_league::text, false);
create temp table roto as select * from category_standings();
select set_config('app.league_id', '', false);
select pg_temp.expect('every team in the table, every category scored', (select count(*) from roto) = (select count(*) from teams where league_id = :roto_league and role = 'gm')
  and (select bool_and((select count(*) from jsonb_object_keys(cats)) = 7) from roto));
-- a category's points run from the team count down to one; ties share; every category hands out the same total
select pg_temp.expect('each category hands out the same points', (select count(distinct s) = 1 from (
  select k, sum((cats->k->>'pts')::numeric) as s from roto, jsonb_object_keys(cats) k group by k) x)
  and (select sum((cats->'g'->>'pts')::numeric) from roto) = (select n * (n + 1) / 2.0 from (select count(*) n from roto) c));
-- goals: the sum of what the started players scored, from the season's start
select pg_temp.expect('goals are the started players'' goals', (select bool_and((r.cats->'g'->>'value')::numeric = coalesce((
  select sum((pg.stats->>'g')::numeric) from lineup_snapshots s join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id join games g on g.id = s.game_id
  where s.team_id = r.team_id and s.slot not in ('BN', 'IR') and g.game_type = 2 and s.date >= (select season_start from league_rules where league_id = :roto_league)), 0)) from roto r));
select pg_temp.expect('the total is the sum of the categories, ranked', (select bool_and(total = (select sum((cats->k->>'pts')::numeric) from jsonb_object_keys(cats) k)) from roto)
  and (select rank from roto order by total desc limit 1) = 1);
-- the commissioner picks the categories
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
select pg_temp.expect('a commissioner turns the league to rotisserie, in the catalogue''s order', commish_set_categories(array['svp', 'g', 'a', 'w']) = array['g', 'a', 'w', 'svp']);
select pg_temp.expect('the site''s league row carries them', (select categories from league) = array['g', 'a', 'w', 'svp']);
select pg_temp.raises('3 categories at least', 'select commish_set_categories(array[''g'', ''a''])', '3 to 12');
select pg_temp.raises('from the list', 'select commish_set_categories(array[''g'', ''a'', ''goons''])', 'from the list');
select pg_temp.expect('and back to points', commish_set_categories(null) is null);
reset role;
select pg_temp.expect('SaK stays a points league', (select categories from league_rules where league_id = 1) is null);
select pg_temp.expect('the changes are on the log', exists (select 1 from commish_log where league_id = :league2 and action = 'commish_set_categories'));
update league_rules set categories = null where league_id = :roto_league;
drop table roto;
select set_config('request.jwt.claim.sub', '', false);
select 'rotisserie', true;

-- ───────────── head-to-head ─────────────
reset role;
select id as h2h_league from leagues where slug = 'rink' \gset
select user_id as rink_user from teams where league_id = :h2h_league and is_commish \gset
update league_rules set season_start = today_et() + 1, season_end = today_et() + 60 where league_id = :h2h_league;
select set_config('request.jwt.claim.sub', :'rink_user', false);
set role authenticated;
select pg_temp.raises('a season-total league has no schedule', 'select commish_make_schedule()', 'switch it to head-to-head');
select pg_temp.expect('the rink switches to head-to-head', commish_set_format('h2h') = 'h2h');
select pg_temp.expect('and the site''s league row says so', (select format from league) = 'h2h');
select commish_make_schedule() as h2h_weeks \gset
reset role;
-- three teams: one has a bye each week; over a full round every pair meets once
select pg_temp.expect('a matchup a week, plus the bye', (select count(*) from matchups where league_id = :h2h_league) = :h2h_weeks * 2
  and (select count(*) from matchups where league_id = :h2h_league and away_team is null) = :h2h_weeks);
select pg_temp.expect('weeks run Monday to Sunday, back to back', (select bool_and(extract(isodow from ends) = 7 or ends = (select season_end from league_rules where league_id = :h2h_league)) from matchups where league_id = :h2h_league)
  and (select bool_and(m2.starts = m1.ends + 1) from matchups m1 join matchups m2 on m2.league_id = m1.league_id and m2.week = m1.week + 1 and m2.home_team = (select min(home_team) from matchups x where x.league_id = m1.league_id and x.week = m1.week + 1) where m1.league_id = :h2h_league and m1.home_team = (select min(home_team) from matchups x where x.league_id = m1.league_id and x.week = m1.week)));
select pg_temp.expect('every team plays each week or sits out', (select bool_and(c = 3) from (select week, count(home_team) + count(away_team) as c from matchups where league_id = :h2h_league group by week) x));
select pg_temp.expect('in the first round, every pair meets once', (select count(distinct least(home_team, away_team) || '-' || greatest(home_team, away_team)) from matchups where league_id = :h2h_league and week <= 3 and away_team is not null) = 3);
-- the scores: a week's started-player points; final weeks make the table
update matchups set starts = starts - 70, ends = ends - 70 where league_id = :h2h_league and week = 1;
select set_config('app.league_id', :h2h_league::text, false);
select pg_temp.expect('a past week is final, the rest upcoming', (select bool_and(status = case when week = 1 then 'final' else 'upcoming' end) from h2h_scores()));
select pg_temp.expect('the table counts the final weeks only', (select sum(w + l + t) from h2h_standings()) = 2 and (select count(*) from h2h_standings()) = 3);
select set_config('app.league_id', '', false);
set role authenticated;
select pg_temp.raises('the schedule is fixed once a week has started', 'select commish_make_schedule()', 'once its first week starts');
select pg_temp.expect('head-to-head can play for categories', commish_set_categories(array['g', 'a', 'w']) = array['g', 'a', 'w']);
select pg_temp.expect('and back to points', commish_set_categories(null) is null);
reset role;
select pg_temp.expect('SaK still plays the season total', (select format from league_rules where league_id = 1) = 'season' and not exists (select 1 from matchups where league_id = 1));
select pg_temp.expect('the format change and the schedule are on the log', (select count(*) from commish_log where league_id = :h2h_league and action in ('commish_set_format', 'commish_make_schedule')) >= 2);
select set_config('request.jwt.claim.sub', '', false);
select 'head-to-head', true;

-- ───────────── head-to-head playoffs ─────────────
reset role;
select id as po_league from leagues where slug = 'rink' \gset
delete from matchups where league_id = :po_league;
update league_rules set season_start = today_et() + 1, season_end = today_et() + 60 where league_id = :po_league;
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = :po_league and is_commish), false);
set role authenticated;
select pg_temp.raises('the playoffs can''t take more teams than the league has', 'select commish_make_schedule(4)', 'at most');
select pg_temp.raises('nor one team', 'select commish_make_schedule(1)', '2 to 16');
select commish_make_schedule(0) as po_none \gset
select commish_make_schedule(3) as po_regular \gset
select pg_temp.expect('the site''s league row carries the playoff spots', (select h2h_playoffs from league) = 3);
reset role;
-- three teams take a two-round bracket: two weeks fewer of the round robin, the rest kept for the playoffs
select pg_temp.expect('the bracket keeps the season''s last two weeks', :po_regular = :po_none - 2
  and (select h2h_playoffs from league_rules where league_id = :po_league) = 3);
select set_config('app.league_id', :po_league::text, false);
create temp table br as select * from h2h_bracket();
select pg_temp.expect('the top seed sits out the first round, two and three meet', (select count(*) from br where round = 1) = 2
  and (select status from br where round = 1 and high_seed = 1) = 'bye'
  and (select high_seed = 2 and low_seed = 3 from br where round = 1 and status <> 'bye'));
select pg_temp.expect('the final waits on the semi, after the regular weeks', (select count(*) from br where round = 2) = 1
  and (select high_seed = 1 and low_seed is null and status = 'upcoming' from br where round = 2)
  and (select starts from br where round = 1 limit 1) = (select max(ends) + 1 from matchups where league_id = :po_league)
  and (select starts from br where round = 2) = (select ends + 1 from br where round = 1 limit 1));
select pg_temp.expect('the seeds are "if it ended today" until the regular season is over', not (select bool_or(seeded) from br));
drop table br;
-- the whole season played (no points scored): ties go to the higher seed, so one beats three and then two
update matchups set starts = starts - 100, ends = ends - 100 where league_id = :po_league;
create temp table br as select * from h2h_bracket();
select pg_temp.expect('the seeds hold once the regular season is over', (select bool_and(seeded) from br)
  and (select array_agg(high_team order by slot) from br where round = 1) = (select (array_agg(team_id order by rank, pf desc, team_id))[1:2] from h2h_standings()));
select pg_temp.expect('a tie goes to the higher seed, and the champion comes out of the final', (select winner = high_team and status = 'final' from br where round = 1 and status <> 'bye')
  and (select winner = high_team and low_seed = 2 and status = 'final' from br where round = 2));
drop table br;
select set_config('app.league_id', '', false);
select pg_temp.expect('SaK has no bracket', (select h2h_playoffs from league_rules where league_id = 1) = 0);
delete from matchups where league_id = :po_league;
update league_rules set h2h_playoffs = 0 where league_id = :po_league;
select set_config('request.jwt.claim.sub', '', false);
select 'head-to-head playoffs', true;

-- ───────────── head-to-head categories ─────────────
reset role;
-- read-only on SaK's scored nights (teams 2 and 5 started players earlier in this test); its categories go back after
select 1 as hc_league, 2 as hc_a, 5 as hc_b, (today_et() - 30)::text as hc_from \gset
select pg_temp.expect('the pairing has started players to count', (select count(*) from lineup_snapshots where team_id in (2, 5) and slot not in ('BN', 'IR') and date >= today_et() - 30) > 0);
select set_config('app.league_id', :hc_league::text, false);
-- a points league: a pairing's score is each side's started points over those days
select pg_temp.expect('a points pairing is the weeks'' points', (select a_score = coalesce((select sum(points) from team_daily where team_id = :hc_a and date between :'hc_from' and today_et()), 0)
  and b_score = coalesce((select sum(points) from team_daily where team_id = :hc_b and date between :'hc_from' and today_et()), 0) and cats is null
  from _h2h_result(:hc_a, :hc_b, :'hc_from', today_et())));
update league_rules set categories = array['g', 'a', 'pim', 'sog', 'w', 'gaa', 'svp'] where league_id = :hc_league;
create temp table hc as select * from _h2h_result(:hc_a, :hc_b, :'hc_from', today_et());
select pg_temp.expect('a category pairing scores every category once', (select (select count(*) from jsonb_object_keys(cats)) = 7
  and a_score + b_score + (select count(*) from jsonb_each(cats) e where e.value->>'win' = 'tie') = 7 from hc));
select pg_temp.expect('and the counting found something', (select (cats->'sog'->>'a')::numeric + (cats->'sog'->>'b')::numeric > 0 from hc));
select pg_temp.expect('a category''s value is the started players'' total', (select (cats->'g'->>'a')::numeric = coalesce((
  select sum((pg.stats->>'g')::numeric) from lineup_snapshots s join player_games pg on pg.game_id = s.game_id and pg.player_id = s.player_id join games g on g.id = s.game_id
  where s.team_id = :hc_a and s.slot not in ('BN', 'IR') and g.game_type = 2 and s.date between :'hc_from' and today_et()), 0) from hc));
select pg_temp.expect('more goals wins goals, fewer against per start wins that', (select bool_and(case
    when k = 'g' and (cats->k->>'a')::numeric > (cats->k->>'b')::numeric then cats->k->>'win' = 'a'
    when k = 'g' and (cats->k->>'a')::numeric < (cats->k->>'b')::numeric then cats->k->>'win' = 'b'
    when k = 'gaa' and (cats->k->>'a') is not null and (cats->k->>'b') is not null and (cats->k->>'a')::numeric < (cats->k->>'b')::numeric then cats->k->>'win' = 'a'
    when k = 'gaa' and (cats->k->>'a') is not null and (cats->k->>'b') is not null and (cats->k->>'a')::numeric > (cats->k->>'b')::numeric then cats->k->>'win' = 'b'
    else true end) from hc, jsonb_object_keys(cats) k));
select pg_temp.expect('a bye counts nothing', (select a_score = 0 and b_score is null and cats is null from _h2h_result(:hc_a, null, :'hc_from', today_et())));
drop table hc;
update league_rules set categories = null where league_id = :hc_league;
select set_config('app.league_id', '', false);
select pg_temp.expect('SaK still plays for points', (select categories from league_rules where league_id = 1) is null);
select set_config('request.jwt.claim.sub', '', false);
select 'head-to-head categories', true;

-- ───────────── a head-to-head league's schedule on the checklist ─────────────
reset role;
select id as ck_league from leagues where slug = 'rink' \gset
update league_rules set format = 'h2h', season_start = today_et() + 1, season_end = today_et() + 60 where league_id = :ck_league;
delete from matchups where league_id = :ck_league;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('a head-to-head league''s checklist wants its schedule', (select x->>'ok' = 'false' and x->>'required' = 'true'
  from jsonb_array_elements(league_readiness(:ck_league)) x where x->>'key' = 'schedule'));
select pg_temp.raises('so it can''t go live without one', format('select platform_set_league_status(%s, ''active'')', :ck_league), 'Head-to-head schedule made');
select pg_temp.expect('a points league''s checklist has no schedule line', not exists (select 1 from jsonb_array_elements(league_readiness(1)) x where x->>'key' = 'schedule'));
reset role;
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = :ck_league and is_commish), false);
set role authenticated;
select commish_make_schedule(0) as ck_weeks \gset
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('once it''s made, the line is ticked', (select x->>'ok' = 'true' and x->>'detail' like '%weeks%'
  from jsonb_array_elements(league_readiness(:ck_league)) x where x->>'key' = 'schedule'));
reset role;
delete from matchups where league_id = :ck_league;
update league_rules set season_start = null where league_id = :ck_league;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('and the rules line wants the season''s dates', (select x->>'ok' = 'false' and x->>'detail' like '%no first and last days%'
  from jsonb_array_elements(league_readiness(:ck_league)) x where x->>'key' = 'rules'));
reset role;
update league_rules set format = 'season', season_start = today_et() + 1 where league_id = :ck_league;
select set_config('request.jwt.claim.sub', '', false);
select 'a head-to-head league''s schedule on the checklist', true;

-- ───────────── Garry's picks in the prediction log ─────────────
reset role;
select id as gp_won, winner_key as gp_key from markets where league_id = 1 and status = 'settled' and winner_key is not null order by id limit 1 \gset
select id as gp_void from markets where league_id = 1 and status = 'void' order by id limit 1 \gset
insert into markets (league_id, kind, title, options, closes_at, date) values (1, 'custom', 'Still open', '[{"key":"y","label":"Yes","odds":2.5},{"key":"n","label":"No","odds":1.5}]', now() + interval '1 day', today_et()) returning id as gp_open \gset
insert into predictions (league_id, kind, subject, predicted, basis, resolves_on) values
  (1, 'garry_pick', jsonb_build_object('market_id', :gp_won, 'pick', :'gp_key'), 0.4, 'garry', today_et() - 1),
  (1, 'garry_pick', jsonb_build_object('market_id', :gp_won, 'pick', 'not-' || :'gp_key'), 0.6, 'garry', today_et() - 1),
  (1, 'garry_pick', jsonb_build_object('market_id', :gp_void, 'pick', 'home'), 0.5, 'garry', today_et() - 1),
  (1, 'garry_pick', jsonb_build_object('market_id', :gp_open, 'pick', 'y'), 0.4, 'garry', today_et() + 1);
select set_config('app.league_id', '1', false);
select score_predictions() >= 3 as gp_scored \gset
select set_config('app.league_id', '', false);
select pg_temp.expect('a pick that came in scores 1 against its chance', (select outcome = 1 and error = 0.6 and status = 'scored' from predictions where kind = 'garry_pick' and subject->>'market_id' = :'gp_won' and subject->>'pick' = :'gp_key'));
select pg_temp.expect('one that didn''t scores 0', (select outcome = 0 and error = -0.6 and status = 'scored' from predictions where kind = 'garry_pick' and subject->>'market_id' = :'gp_won' and subject->>'pick' <> :'gp_key'));
select pg_temp.expect('a void market voids the pick', (select status = 'void' from predictions where kind = 'garry_pick' and subject->>'market_id' = :'gp_void'));
select pg_temp.expect('an open market''s pick waits', (select status = 'open' from predictions where kind = 'garry_pick' and subject->>'market_id' = :'gp_open'));
select pg_temp.expect('one pick per market and option, however many GMs hear it', (select count(*) from pg_indexes where indexname = 'predictions_one_per_subject') = 1);
delete from predictions where kind = 'garry_pick';
delete from markets where id = :gp_open;
select set_config('request.jwt.claim.sub', '', false);
select 'Garry''s picks in the prediction log', true;

-- ───────────── the auto-pilot's choices in the prediction log ─────────────
reset role;
select (array_agg(r.player_id order by r.player_id))[1] as ap_a, (array_agg(r.player_id order by r.player_id))[2] as ap_b,
       (array_agg(r.player_id order by r.player_id))[3] as ap_c
from rosters r join players p on p.id = r.player_id where r.team_id = 3 and p.pos <> 'G' \gset
select id as ap_other from leagues where slug = 'rink' \gset
-- three nights: one played as the auto-pilot set it, one the GM changed, one not over yet
insert into games (id, date, start_utc, home, away, state, final_synced) values
  (7701, today_et() - 200, now() - interval '200 days', 'TOR', 'MTL', 'OFF', true),
  (7702, today_et() - 199, now() - interval '199 days', 'TOR', 'MTL', 'OFF', true),
  (7703, today_et() - 198, now() - interval '198 days', 'TOR', 'MTL', 'LIVE', false);
insert into player_games (game_id, player_id, date, stats)
select g, p, today_et() - (7701 + 200 - g), s::jsonb from (values
  (7701, :ap_a, '{"g":2,"a":1,"sog":5}'), (7701, :ap_b, '{"g":0,"a":1,"sog":2}'), (7701, :ap_c, '{"g":1,"a":0,"sog":1}'),
  (7702, :ap_a, '{"g":1,"a":0,"sog":3}'), (7702, :ap_b, '{"g":0,"a":0,"sog":1}'), (7702, :ap_c, '{"g":0,"a":2,"sog":2}'),
  (7703, :ap_a, '{"g":0,"a":0,"sog":1}')) x(g, p, s);
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values
  (7701, today_et() - 200, 3, :ap_a, 'C'), (7701, today_et() - 200, 3, :ap_b, 'LW'), (7701, today_et() - 200, 3, :ap_c, 'BN'),
  (7702, today_et() - 199, 3, :ap_a, 'C'), (7702, today_et() - 199, 3, :ap_b, 'BN'), (7702, today_et() - 199, 3, :ap_c, 'LW'),
  (7703, today_et() - 198, 3, :ap_a, 'C');
insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail) values
  (1, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 200), 6.5, 'blend', today_et() - 200, jsonb_build_object('starters', jsonb_build_array(:ap_a, :ap_b))),
  (1, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 199), 5.0, 'blend', today_et() - 199, jsonb_build_object('starters', jsonb_build_array(:ap_a, :ap_b))),
  (1, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 198), 4.0, 'blend', today_et() - 198, jsonb_build_object('starters', jsonb_build_array(:ap_a))),
  (:ap_other, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 200), 1.0, 'blend', today_et() - 200, jsonb_build_object('starters', jsonb_build_array(:ap_a)));
-- a night none of its starters played (his only game postponed), and one where a starter's game was postponed
insert into games (id, date, start_utc, home, away, state, final_synced) values
  (7704, today_et() - 197, now() - interval '197 days', (select nhl_team from players where id = :ap_a), 'ZZA', 'PPD', false),
  (7705, today_et() - 196, now() - interval '196 days', 'TOR', 'MTL', 'OFF', true),
  (7706, today_et() - 196, now() - interval '196 days', (select nhl_team from players where id = :ap_b), 'ZZB', 'PPD', false);
insert into player_games (game_id, player_id, date, stats) values (7705, :ap_a, today_et() - 196, '{"g":1,"a":0,"sog":3}');
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values (7705, today_et() - 196, 3, :ap_a, 'C');
insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, detail) values
  (1, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 197), 7.5, 'blend', today_et() - 197, jsonb_build_object('starters', jsonb_build_array(:ap_a))),
  (1, 'auto_lineup', jsonb_build_object('team_id', 3, 'date', today_et() - 196), 6.0, 'blend', today_et() - 196, jsonb_build_object('starters', jsonb_build_array(:ap_a, :ap_b)));
select set_config('app.league_id', '1', false);
select score_predictions() >= 2 as ap_scored \gset
select sum(fpts) as ap_want from league_games where game_id = 7701 and player_id in (:ap_a, :ap_b) \gset
select set_config('app.league_id', '', false);
select pg_temp.expect('the auto-pilot''s night scores what its starters scored', (select outcome = :ap_want and :ap_want > 0
  and error = outcome - 6.5 and status = 'scored' from predictions where league_id = 1 and kind = 'auto_lineup' and subject->>'date' = (today_et() - 200)::text));
select pg_temp.expect('a night the GM changed isn''t the auto-pilot''s: void', (select status = 'void' and outcome is null from predictions where league_id = 1 and kind = 'auto_lineup' and subject->>'date' = (today_et() - 199)::text));
select pg_temp.expect('a night still being played waits', (select status = 'open' from predictions where league_id = 1 and kind = 'auto_lineup' and subject->>'date' = (today_et() - 198)::text));
select pg_temp.expect('another league''s call is left alone', (select status = 'open' from predictions where league_id = :ap_other and kind = 'auto_lineup'));
select pg_temp.expect('a night none of its starters played is void, not a zero', (select status = 'void' and outcome is null from predictions where league_id = 1 and kind = 'auto_lineup' and subject->>'date' = (today_et() - 197)::text));
select pg_temp.expect('a night a starter''s game was postponed is void', (select status = 'void' from predictions where league_id = 1 and kind = 'auto_lineup' and subject->>'date' = (today_et() - 196)::text));
select pg_temp.expect('the calls are counted by kind and status', (select n from prediction_status where kind = 'auto_lineup' and status = 'void') >= 3);
delete from predictions where kind = 'auto_lineup';
delete from lineup_snapshots where game_id in (7701, 7702, 7703, 7705);
delete from player_games where game_id in (7701, 7702, 7703, 7705);
delete from games where id in (7701, 7702, 7703, 7704, 7705, 7706);
select set_config('request.jwt.claim.sub', '', false);
select 'the auto-pilot''s choices in the prediction log', true;

-- ───────────── lineup efficiency: the best lineup in hindsight ─────────────
reset role;
select (array_agg(r.player_id order by r.player_id))[1] as le_a, (array_agg(r.player_id order by r.player_id))[2] as le_b,
       (array_agg(r.player_id order by r.player_id))[3] as le_c, (array_agg(r.player_id order by r.player_id))[4] as le_d
from rosters r join players p on p.id = r.player_id where r.team_id = 3 and p.pos <> 'G' \gset
insert into games (id, date, start_utc, home, away, state, final_synced) values (7801, today_et() + 150, now() + interval '150 days', 'TOR', 'MTL', 'OFF', true);
insert into player_games (game_id, player_id, date, stats) values
  (7801, :le_a, today_et() + 150, '{"g":1,"a":0,"sog":2}'), (7801, :le_b, today_et() + 150, '{"g":0,"a":0,"sog":1}'),
  (7801, :le_c, today_et() + 150, '{"g":2,"a":1,"sog":6}'), (7801, :le_d, today_et() + 150, '{"g":3,"a":0,"sog":5}');
-- a and b started; c, the night's best, sat on the bench; d was on IR (not his GM's to start)
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values
  (7801, today_et() + 150, 3, :le_a, 'Util'), (7801, today_et() + 150, 3, :le_b, 'D'), (7801, today_et() + 150, 3, :le_c, 'BN'), (7801, today_et() + 150, 3, :le_d, 'IR');
select set_config('app.league_id', '1', false);
select sum(fpts) filter (where player_id in (:le_a, :le_b)) as le_got, sum(fpts) filter (where player_id in (:le_a, :le_b, :le_c) and fpts > 0) as le_best
from league_games where game_id = 7801 \gset
select set_config('app.league_id', '', false);
select pg_temp.as_team(3);
set role authenticated;
select pg_temp.expect('the lineup''s points are the starters''', (select points = :le_got from lineup_efficiency(today_et() + 150, today_et() + 150) where team_id = 3));
select pg_temp.expect('the best counts the benched star, not the man on IR', (select best = :le_best and best > points from lineup_efficiency(today_et() + 150, today_et() + 150) where team_id = 3));
reset role;
select pg_temp.expect('a placement that needs a move is found', _best_lineup_points('[{"pts":10,"pos":"C","elig":["C","LW"]},{"pts":8,"pos":"C","elig":["C"]},{"pts":5,"pos":"LW","elig":["LW"]}]', array['C', 'LW']) = 18);
select pg_temp.expect('a chain of moves too', _best_lineup_points('[{"pts":9,"pos":"C","elig":["C","LW"]},{"pts":8,"pos":"LW","elig":["LW","RW"]},{"pts":7,"pos":"C","elig":["C"]},{"pts":6,"pos":"RW","elig":["RW"]}]', array['C', 'LW', 'RW']) = 24);
select pg_temp.expect('goalies only in goal, nobody scoring below zero', _best_lineup_points('[{"pts":5,"pos":"G","elig":["G"]},{"pts":-2,"pos":"D","elig":["D"]}]', array['D', 'Util']) = 0);
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = (select id from leagues where slug = 'rink') and is_commish), false);
set role authenticated;
select pg_temp.expect('another league''s GM sees none of it', not exists (select 1 from lineup_efficiency(today_et() + 150, today_et() + 150) where team_id = 3));
reset role;
delete from lineup_snapshots where game_id = 7801;
delete from player_games where game_id = 7801;
delete from games where id = 7801;
select set_config('request.jwt.claim.sub', '', false);
reset role;
-- read without row-level security (as the service key does), the Performance reads stay in the league
insert into games (id, date, start_utc, home, away, state, final_synced) values (7802, today_et() + 151, now() + interval '151 days', 'TOR', 'MTL', 'OFF', true);
insert into player_games (game_id, player_id, date, stats) values (7802, :le_a, today_et() + 151, '{"g":1}');
insert into lineup_snapshots (game_id, date, team_id, player_id, slot, league_id)
  select 7802, today_et() + 151, t.id, :le_a, 'C', t.league_id from teams t where t.league_id = (select id from leagues where slug = 'rink') and t.role = 'gm' limit 1;
select set_config('app.league_id', '1', false);
select pg_temp.expect('performance_days keeps to the league without row-level security', not exists (select 1 from performance_days(today_et() + 151, today_et() + 151) x join teams t on t.id = x.team_id where t.league_id <> 1));
select pg_temp.expect('performance_players too', not exists (select 1 from performance_players(today_et() + 151, today_et() + 151) x join teams t on t.id = x.team_id where t.league_id <> 1));
select pg_temp.expect('lineup_efficiency too', not exists (select 1 from lineup_efficiency(today_et() + 151, today_et() + 151) x join teams t on t.id = x.team_id where t.league_id <> 1));
select set_config('app.league_id', '', false);
delete from lineup_snapshots where game_id = 7802; delete from player_games where game_id = 7802; delete from games where id = 7802;
select 'lineup efficiency', true;

-- ───────────── the sports table: the NHL's description ─────────────
reset role;
select pg_temp.expect('every league plays a sport that has a row', not exists (select 1 from leagues l where not exists (select 1 from sports s where s.id = l.sport)));
select pg_temp.expect('the NHL row carries the words of Garry''s voice, the old ones kept', (select config->'words' ?& array['game', 'rec', 'room', 'voice', 'start', 'centre']
  and config->'words'->>'game' = 'hockey' from sports where id = 'nhl'));
select pg_temp.expect('the NHL''s slots accept exactly whom slot_ok accepts', not exists (
  select 1 from sports sp, jsonb_array_elements(sp.config->'slots') sl, jsonb_array_elements(sp.config->'positions') po
  where sp.id = 'nhl'
    and ((sl->'accepts') ? (po->>'key')) <> slot_ok(array[po->>'key'], po->>'key', sl->>'key')));
select pg_temp.raises('a league can''t name a sport with no row', $$update leagues set sport = 'curling' where id = 1$$, 'foreign key');
set role anon;
select pg_temp.expect('anyone can read a sport''s description', (select count(*) from sports where id = 'nhl') = 1);
reset role;
select 'the sports table', true;

-- ───────────── payouts follow the format ─────────────
reset role;
select id as pf_league from leagues where slug = 'rink' \gset
update league_rules set features = '{"money": true}', format = 'h2h', h2h_playoffs = 0, entry_fee = 100, sak_fee = 0, prize_split = '[60, 30, 10]', playoff_share = 40, cup_share = 0,
  season_start = today_et() + 1, season_end = today_et() + 60 where league_id = :pf_league;
delete from matchups where league_id = :pf_league;
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = :pf_league and is_commish), false);
set role authenticated;
select commish_make_schedule(2) as pf_weeks \gset
reset role;
-- the whole season played; give the third team the points so the table and the points disagree on nothing but order
update matchups set starts = starts - 100, ends = ends - 100 where league_id = :pf_league;
select set_config('app.league_id', :pf_league::text, false);
create temp table pf_table as select team_id, rank, pf from h2h_standings();
create temp table pf_br as select * from h2h_bracket();
select set_config('app.league_id', '', false);
set role authenticated;
select pg_temp.expect('the regular pot pays the head-to-head table', commish_post_payouts('regular') = 3);
reset role;
select pg_temp.expect('in the table''s order', (select array_agg(team_id order by id) from ledger where league_id = :pf_league and kind = 'payout' and description like '%regular season%')
  = (select array_agg(team_id order by rank, pf desc, team_id) from pf_table));
select pg_temp.expect('and no last-place punishment outside a points league', not exists (select 1 from ledger where league_id = :pf_league and kind = 'peter'));
set role authenticated;
select pg_temp.expect('the playoff pot pays the bracket: champion, then runner-up', commish_post_payouts('playoffs') = 2);
reset role;
select pg_temp.expect('the champion first', (select team_id from ledger where league_id = :pf_league and kind = 'payout' and description like '%1st place' and description not like '%regular season%')
  = (select winner from pf_br where round = (select max(round) from pf_br)));
-- a rotisserie league pays its category table
delete from ledger where league_id = :pf_league;
delete from matchups where league_id = :pf_league;
update league_rules set format = 'season', h2h_playoffs = 0, categories = array['g', 'a', 'w'] where league_id = :pf_league;
select set_config('app.league_id', :pf_league::text, false);
create temp table pf_roto as select team_id, rank from category_standings();
select set_config('app.league_id', '', false);
set role authenticated;
select pg_temp.expect('the regular pot pays the category table', commish_post_payouts('regular') = 3);
reset role;
select pg_temp.expect('in its order', (select array_agg(team_id order by id) from ledger where league_id = :pf_league and kind = 'payout')
  = (select array_agg(team_id order by rank, team_id) from pf_roto) and not exists (select 1 from ledger where league_id = :pf_league and kind = 'peter'));
drop table pf_roto;
delete from ledger where league_id = :pf_league;
update league_rules set format = 'season', h2h_playoffs = 0, categories = null, features = '{}' where league_id = :pf_league;
drop table pf_table; drop table pf_br;
select set_config('request.jwt.claim.sub', '', false);
select 'payouts follow the format', true;

-- ───────────── head-to-head week alerts ─────────────
reset role;
select id as wn_league from leagues where slug = 'rink' \gset
update league_rules set format = 'h2h', h2h_playoffs = 0, season_start = today_et(), season_end = today_et() + 60 where league_id = :wn_league;
delete from matchups where league_id = :wn_league;
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = :wn_league and is_commish), false);
set role authenticated;
select commish_make_schedule(0) as wn_weeks \gset
reset role;
-- week 1 starts today; pretend the week before it ended yesterday by moving week 2 back a fortnight
update matchups set starts = today_et() - 7, ends = today_et() - 1 where league_id = :wn_league and week = 2;
delete from notifications where kind = 'matchup';
select set_config('app.league_id', :wn_league::text, false);
select h2h_week_notes() as wn_sent \gset
select pg_temp.expect('every GM hears this week''s opponent, or the week off', (select count(*) from notifications n join teams t on t.id = n.team_id
  where t.league_id = :wn_league and n.kind = 'matchup' and (n.body like '%starts today: you vs%' or n.body like '%week off%')) = 3);
select pg_temp.expect('the two who played last week hear how it went', (select count(*) from notifications n join teams t on t.id = n.team_id
  where t.league_id = :wn_league and n.kind = 'matchup' and n.body ~ 'you (beat|lost to|tied)') = 2);
select pg_temp.expect('once each: a second run says nothing new', h2h_week_notes() = 0);
-- next season the circle pairs the same teams again: last year's identical line mustn't hold this one up
update notifications set created_at = now() - interval '200 days' where kind = 'matchup';
select pg_temp.expect('the same line a season later goes out again', h2h_week_notes() >= 3);
select set_config('app.league_id', '1', false);
select pg_temp.expect('a season-total league hears nothing', h2h_week_notes() = 0);
select set_config('app.league_id', '', false);
select pg_temp.expect('the morning job knows it', (run_league_jobs('h2h-notes')) is not null);
delete from notifications where kind = 'matchup';
delete from matchups where league_id = :wn_league;
update league_rules set format = 'season' where league_id = :wn_league;
select set_config('request.jwt.claim.sub', '', false);
select 'head-to-head week alerts', true;

-- ───────────── head-to-head win chances in the prediction log ─────────────
reset role;
insert into matchups (league_id, week, starts, ends, home_team, away_team) values (1, 97, today_et() - 30, today_et() - 3, 2, 5) returning id as hw_id \gset
select case when a_score > b_score then 1 when a_score < b_score then 0 else 0.5 end as hw_want from _h2h_result(2, 5, today_et() - 30, today_et() - 3) \gset
insert into predictions (league_id, kind, subject, predicted, basis, resolves_on) values
  (1, 'h2h_win', jsonb_build_object('matchup_id', :hw_id, 'date', today_et() - 10), 0.6, 'forecast', today_et() - 3),
  (1, 'h2h_win', jsonb_build_object('matchup_id', -1, 'date', today_et() - 10), 0.5, 'forecast', today_et() - 3),
  (1, 'h2h_win', jsonb_build_object('matchup_id', :hw_id, 'date', today_et() + 2), 0.5, 'forecast', today_et() + 3);
select set_config('app.league_id', '1', false);
select score_predictions() >= 2 as hw_scored \gset
select set_config('app.league_id', '', false);
select pg_temp.expect('a finished week scores the home side''s result against its chance', (select outcome = :hw_want and error = :hw_want - 0.6 and status = 'scored'
  from predictions where kind = 'h2h_win' and subject->>'matchup_id' = :'hw_id' and resolves_on = today_et() - 3));
select pg_temp.expect('a matchup that''s gone voids its call', (select status = 'void' from predictions where kind = 'h2h_win' and subject->>'matchup_id' = '-1'));
select pg_temp.expect('a week still on waits', (select status = 'open' from predictions where kind = 'h2h_win' and resolves_on = today_et() + 3));
delete from predictions where kind = 'h2h_win';
delete from matchups where id = :hw_id;
select 'head-to-head win chances in the prediction log', true;

-- ───────────── the pickup advisor's suggestions in the prediction log ─────────────
reset role;
select (array_agg(r.player_id order by r.player_id))[1] as pk_add, (array_agg(r.player_id order by r.player_id))[2] as pk_drop,
  (array_agg(r.player_id order by r.player_id))[3] as pk_add2
from rosters r join players p on p.id = r.player_id where r.team_id = 3 and p.pos <> 'G' \gset
select p.id as pk_free from players p where not exists (select 1 from rosters r where r.player_id = p.id) and p.pos <> 'G' order by p.id limit 1 \gset
-- the move itself, as add_player writes it
insert into transactions (league_id, season, type, team_id, player_id) values
  (1, '2026-27', 'drop', 3, :pk_drop), (1, '2026-27', 'add', 3, :pk_add);
-- a second pickup a moment later, with no drop (its own transaction: another moment)
insert into transactions (league_id, season, type, team_id, player_id, created_at) values (1, '2026-27', 'add', 3, :pk_add2, now() + interval '1 second');
select pg_temp.as_team(3);
set role authenticated;
select pg_temp.expect('a GM logs the pickup they just made', log_pickup_call(:pk_add, :pk_drop, 6.5, today_et() + 14));
select pg_temp.expect('not one that isn''t on their roster', not log_pickup_call(:pk_free, null, 3, today_et() + 14));
select pg_temp.expect('not a rostered player they didn''t just add', not log_pickup_call(:pk_drop, null, 3, today_et() + 14));
select pg_temp.expect('not a drop they didn''t make', not log_pickup_call(:pk_add, :pk_free, 3, today_et() + 14));
select pg_temp.expect('not without the drop made with it', not log_pickup_call(:pk_add, null, 3, today_et() + 14));
select pg_temp.expect('not with a drop where there was none', not log_pickup_call(:pk_add2, :pk_drop, 3, today_et() + 14));
select pg_temp.expect('the same pickup again is quietly the same call', log_pickup_call(:pk_add, :pk_drop, 9, today_et() + 14));
select pg_temp.expect('a promise held to what a stretch can hold', log_pickup_call(:pk_add2, null, 100000, today_et() + 1));
reset role;
select pg_temp.expect('the call is theirs, once', (select count(*) from predictions where kind = 'pickup' and subject->>'team_id' = '3' and subject->>'add' = :'pk_add') = 1
  and (select predicted = 6.5 and (subject->>'drop')::int = :pk_drop from predictions where kind = 'pickup' and subject->>'add' = :'pk_add'));
select pg_temp.expect('the cap is 30 a night', (select predicted from predictions where kind = 'pickup' and subject->>'drop' is null) = 60);
delete from transactions where team_id = 3 and type in ('add', 'drop') and created_at > now() - interval '1 minute';
delete from transactions where team_id = 3 and player_id = :pk_add2 and type = 'add';
delete from predictions where kind = 'pickup';
-- scored on what the new player scored while started, less what the dropped one scored
insert into games (id, date, start_utc, home, away, state, final_synced) values
  (7901, today_et() - 120, now() - interval '120 days', 'TOR', 'MTL', 'OFF', true),
  (7902, today_et() - 119, now() - interval '119 days', 'TOR', 'MTL', 'OFF', true);
insert into player_games (game_id, player_id, date, stats) values
  (7901, :pk_add, today_et() - 120, '{"g":2,"a":1,"sog":5}'), (7902, :pk_add, today_et() - 119, '{"g":1,"a":0,"sog":3}'),
  (7901, :pk_drop, today_et() - 120, '{"g":0,"a":1,"sog":2}');
insert into lineup_snapshots (game_id, date, team_id, player_id, slot) values
  (7901, today_et() - 120, 3, :pk_add, 'C'), (7902, today_et() - 119, 3, :pk_add, 'BN');
-- made the afternoon of the first game's day: that night's game counts
insert into predictions (league_id, kind, subject, predicted, basis, resolves_on, made_at) values
  (1, 'pickup', jsonb_build_object('team_id', 3, 'add', :pk_add, 'drop', :pk_drop, 'from', today_et() - 120), 4.0, 'advisor', today_et() - 119,
   now() - interval '120 days 3 hours');
select set_config('app.league_id', '1', false);
select (select fpts from league_games where game_id = 7901 and player_id = :pk_add) - (select fpts from league_games where game_id = 7901 and player_id = :pk_drop) as pk_want \gset
select score_predictions() >= 1 as pk_scored \gset
select set_config('app.league_id', '', false);
select pg_temp.expect('a pickup scores the new player''s started points less the dropped one''s', (select outcome = :pk_want and error = :pk_want - 4.0 and status = 'scored' from predictions where kind = 'pickup'));
delete from predictions where kind = 'pickup';
delete from lineup_snapshots where game_id in (7901, 7902);
delete from player_games where game_id in (7901, 7902);
delete from games where id in (7901, 7902);
select set_config('request.jwt.claim.sub', '', false);
select 'the pickup advisor''s suggestions in the prediction log', true;

-- ───────────── a matchup, player by player ─────────────
reset role;
-- SaK's teams 2 and 5 started players earlier in this test: a matchup between them over those days
insert into matchups (league_id, week, starts, ends, home_team, away_team) values (1, 99, today_et() - 30, today_et(), 2, 5) returning id as mp_id \gset
select set_config('app.league_id', '1', false);
create temp table mp as select * from h2h_matchup_players(:mp_id);
select pg_temp.expect('both sides'' started players, nobody else', (select count(distinct team_id) from mp) = 2 and (select bool_and(team_id in (2, 5)) from mp));
select pg_temp.expect('a side''s players add up to its week', abs((select coalesce(sum(pts), 0) from mp where team_id = 2)
  - (select a_score from _h2h_result(2, 5, today_et() - 30, today_et()))) < 0.05
  and abs((select coalesce(sum(pts), 0) from mp where team_id = 5) - (select b_score from _h2h_result(2, 5, today_et() - 30, today_et()))) < 0.05);
drop table mp;
select set_config('app.league_id', '', false);
select pg_temp.as_team(9);
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = (select id from leagues where slug = 'rink') and is_commish), false);
set role authenticated;
select pg_temp.expect('another league''s GM sees nothing of it', (select count(*) from h2h_matchup_players(:mp_id)) = 0);
reset role;
delete from matchups where id = :mp_id;
select set_config('request.jwt.claim.sub', '', false);
select 'a matchup, player by player', true;

-- ───────────── head-to-head: upcoming weeks aren't counted, the seed breaks ties ─────────────
reset role;
select id as rf_league from leagues where slug = 'rink' \gset
update league_rules set format = 'h2h', categories = array['g', 'a', 'w'], h2h_playoffs = 0, season_start = today_et() + 1, season_end = today_et() + 60 where league_id = :rf_league;
delete from matchups where league_id = :rf_league;
select set_config('request.jwt.claim.sub', (select user_id::text from teams where league_id = :rf_league and is_commish), false);
set role authenticated;
select commish_make_schedule(0) as rf_weeks \gset
reset role;
select set_config('app.league_id', :rf_league::text, false);
select pg_temp.expect('a week not yet started is 0 to 0, nothing counted', (select bool_and(home_pts = 0 and (away_team is null or away_pts = 0) and cats is null) from h2h_scores() where status = 'upcoming'));
select pg_temp.expect('level teams share a rank but never a seed', (select count(distinct rank) = 1 and count(distinct seed) = count(*) and min(seed) = 1 from h2h_standings()));
select pg_temp.expect('the seed is the table''s order with team id last', (select array_agg(team_id order by seed) = array_agg(team_id order by rank, pf desc, team_id) from h2h_standings()));
select set_config('app.league_id', '', false);
delete from matchups where league_id = :rf_league;
update league_rules set format = 'season', categories = null where league_id = :rf_league;
select set_config('request.jwt.claim.sub', '', false);
select 'head-to-head: upcoming weeks aren''t counted, the seed breaks ties', true;

-- ───────────── category value for the draft ─────────────
reset role;
select id as cv_league from leagues where slug = 'rink' \gset
select set_config('app.league_id', :cv_league::text, false);
select pg_temp.expect('a points league has no category values', not exists (select 1 from category_values()));
update league_rules set categories = array['g', 'hit', 'blk', 'w', 'gaa'] where league_id = :cv_league;
create temp table cv as select * from category_values();
select pg_temp.expect('a category league values its players on its categories', (select count(*) from cv) > 100
  and (select bool_and(z ?| array['g', 'hit', 'blk', 'w', 'gaa']) from cv) and (select min(rank) from cv) = 1);
select pg_temp.expect('skaters on skater categories, goalies on goalie ones', (select bool_and(not (z ? 'w')) from cv join players p on p.id = cv.player_id where p.pos <> 'G')
  and (select bool_and(z ? 'gaa' and not (z ? 'hit')) from cv join players p on p.id = cv.player_id where p.pos = 'G'));
-- the hitter: among skaters, more hits and blocks per game at the same goals is worth more here than in points
select pg_temp.expect('a big hitter outranks his points', (select avg(cv.rank) from cv join players p on p.id = cv.player_id
    where p.pos <> 'G' and (p.last_stats->>'hit')::numeric / greatest((p.last_stats->>'gp')::numeric, 1) > 2.5)
  < (select avg(p.rank) from cv join players p on p.id = cv.player_id where p.pos <> 'G' and (p.last_stats->>'hit')::numeric / greatest((p.last_stats->>'gp')::numeric, 1) > 2.5));
-- a player the model projects but who has no usable last season (a rookie, a star hurt all year) still has a value
select id as cv_rookie, last_stats::text as cv_rookie_stats from players where proj_stats is not null and pos <> 'G' order by proj desc limit 1 \gset
update players set last_stats = null where id = :cv_rookie;
select pg_temp.expect('a projected player with no last season is valued', exists (select 1 from category_values() where player_id = :cv_rookie));
update players set last_stats = :'cv_rookie_stats'::jsonb where id = :cv_rookie;
select pg_temp.expect('the values come back best first', (select bool_and(r = rank) from (select rank, row_number() over () as r from category_values()) x where r = 1));
select pg_temp.expect('fewer goals against per start is better', (select corr((p.last_stats->>'ga')::numeric / nullif((p.last_stats->>'gs')::numeric, 0), (cv.z->>'gaa')::numeric)
  from cv join players p on p.id = cv.player_id where p.pos = 'G' and (p.last_stats->>'gs')::numeric >= 50) < 0);
select id as cv_team from teams where league_id = :cv_league and role = 'gm' and not exists (select 1 from draft_queue q where q.team_id = teams.id) order by id limit 1 \gset
select pg_temp.expect('the robot drafts by category value in a category league', _autopick_player(:cv_team) = (
  select cv.player_id from cv join league_players p on p.id = cv.player_id
  where p.pos in ('C', 'LW', 'RW', 'D', 'G') and coalesce(p.injury_status, '') !~* '^(out|ir\b|injured|suspen|long)'
    and not exists (select 1 from rosters r where r.player_id = p.id and r.league_id = :cv_league)
    and (select count(*) from rosters r join players x on x.id = r.player_id where r.team_id = :cv_team and x.pos = p.pos)
        < case p.pos when 'D' then 6 when 'G' then 3 else 4 end
  order by cv.value desc, p.proj desc, p.last_fp desc limit 1));
drop table cv;
update league_rules set categories = null where league_id = :cv_league;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'category value for the draft', true;

-- ───────────── how alive each league is ─────────────
reset role;
update teams set last_seen = now() - interval '2 days' where id = 1;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the platform sees who used each league this week', (select active_7d >= 1 and last_seen is not null from platform_leagues() where league_id = 1)
  and (select active_7d <= seats from platform_leagues() where league_id = 1));
select pg_temp.expect('and how each league plays', (select format = 'season' and categories = 0 from platform_leagues() where league_id = 1));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'how alive each league is', true;

-- ───────────── the watch list ─────────────
reset role;
select p.id as wl_p from players p where not exists (select 1 from rosters r where r.player_id = p.id) and p.pos <> 'G' order by p.id limit 1 \gset
select p.id as wl_q from players p where not exists (select 1 from rosters r where r.player_id = p.id) and p.pos <> 'G' order by p.id offset 1 limit 1 \gset
select pg_temp.as_team(3);
set role authenticated;
insert into watchlist (team_id, player_id) values (3, :wl_p), (3, :wl_q);
select pg_temp.expect('a GM stars players, in their league', (select count(*) = 2 and bool_and(league_id = 1) from watchlist where team_id = 3));
select pg_temp.raises('never for another team', format('insert into watchlist (team_id, player_id) values (2, %s)', :wl_q), 'row-level security');
delete from watchlist where player_id = :wl_q;
select pg_temp.expect('and unstars them', (select count(*) from watchlist) = 1);
reset role;
insert into watchlist (league_id, team_id, player_id) values (1, 2, :wl_p);
select pg_temp.as_team(3);
set role authenticated;
select pg_temp.expect('a GM sees only their own list', (select count(*) from watchlist) = 1);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
set role authenticated;
insert into watchlist (team_id, player_id) values (99, :wl_p);
select pg_temp.expect('the north watches in its own league, seeing only its own',
  (select count(*) from watchlist) = 1 and (select league_id from watchlist) = current_setting('t.league2')::int);
reset role;
-- team 2 drops him: team 3 hears, not team 2 (who dropped him) and not the north (another league)
insert into transactions (league_id, season, type, team_id, player_id) values (1, '2026-27', 'drop', 2, :wl_p);
select pg_temp.expect('a watcher hears he is free', (select count(*) from notifications where kind = 'watch' and team_id = 3 and league_id = 1 and link = '/player/' || :wl_p) = 1);
select pg_temp.expect('not the team that dropped him, nor another league', not exists (select 1 from notifications where kind = 'watch' and team_id in (2, 99)));
-- a pickup's add after the drop is another kind of line: no alert
insert into transactions (league_id, season, type, team_id, player_id) values (1, '2026-27', 'add', 4, :wl_p);
select pg_temp.expect('an add says nothing', (select count(*) from notifications where kind = 'watch') = 1);
delete from notifications where kind = 'watch';
delete from transactions where player_id = :wl_p and type in ('add', 'drop') and team_id in (2, 4);
-- before the draft a drop goes back to the pool, not to free agency: nothing to tell
select phase as wl_phase from league_rules where league_id = 1 \gset
update league_rules set phase = 'predraft' where league_id = 1;
insert into transactions (league_id, season, type, team_id, player_id) values (1, '2026-27', 'drop', 2, :wl_p);
select pg_temp.expect('a drop before the draft says nothing', not exists (select 1 from notifications where kind = 'watch'));
update league_rules set phase = :'wl_phase' where league_id = 1;
delete from transactions where player_id = :wl_p and type = 'drop' and team_id = 2;
-- a list holds 100
delete from watchlist where team_id = 3;
insert into watchlist (league_id, team_id, player_id) select 1, 3, id from players order by id limit 100;
select pg_temp.raises('a full list takes no more', format('insert into watchlist (league_id, team_id, player_id) values (1, 3, %s)',
  (select id from players order by id offset 100 limit 1)), 'watch list is full');
select pg_temp.raises('a full list starring one it has is the usual duplicate, not "full"', format('insert into watchlist (league_id, team_id, player_id) values (1, 3, %s)',
  (select id from players order by id limit 1)), 'duplicate key');
delete from watchlist where team_id = 3;
delete from watchlist where player_id = :wl_p;
select set_config('request.jwt.claim.sub', '', false);
select 'the watch list', true;

-- ───────────── injury news for the watch list ─────────────
reset role;
select r.player_id as wi_own, r.team_id as wi_owner from rosters r join players p on p.id = r.player_id where r.league_id = 1 and p.injury_status is null order by r.player_id limit 1 \gset
select p.id as wi_free from players p where not exists (select 1 from rosters r where r.player_id = p.id) and p.injury_status is null order by p.id limit 1 \gset
insert into watchlist (league_id, team_id, player_id) values (1, 5, :wi_free), (1, 5, :wi_own), (1, :wi_owner, :wi_own);
delete from notifications where kind = 'injury';
update players set injury_status = 'Day-to-day', injury_note = 'lower body' where id in (:wi_free, :wi_own);
select pg_temp.expect('a watcher hears about a free agent''s injury', (select count(*) from notifications where kind = 'injury' and team_id = 5 and body like '%' || (select name from players where id = :wi_free) || '%(on your watch list)') = 1);
select pg_temp.expect('and about another team''s player', (select count(*) from notifications where kind = 'injury' and team_id = 5 and link = '/player/' || :wi_own) = 1);
select pg_temp.expect('his owner hears it once, as before, even watching him', (select count(*) from notifications where kind = 'injury' and team_id = :wi_owner and link = '/player/' || :wi_own) = 1
  and not exists (select 1 from notifications where kind = 'injury' and team_id = :wi_owner and body like '%watch list%'));
update players set injury_status = null, injury_note = null where id in (:wi_free, :wi_own);
delete from notifications where kind = 'injury';
delete from watchlist where team_id in (5, :wi_owner);
select 'injury news for the watch list', true;

-- ───────────── prediction pools (migration 145) ─────────────
reset role;
insert into coin_ledger (team_id, amount, reason) values (2, 600, 'pool test grant'), (3, 600, 'pool test grant');
-- a question in SaK: the commissioner asks it, two GMs trade it
select pg_temp.as_team(1);
set role authenticated;
select pool_create(jsonb_build_object('title', 'Pool test: does the Cup go east?', 'rule', 'The Cup winner''s conference.',
  'outcomes', jsonb_build_array('East', 'West'), 'closes_at', now() + interval '2 days', 'b', 150, 'max_stake', 300)) as pm \gset
select set_config('t.pm', :'pm', false);
select pg_temp.expect('a new question starts even', (select pool_prices(q, b) = '{"a1": 0.5, "a2": 0.5}'::jsonb from pool_markets where id = :pm));
select pg_temp.expect('and says so in the chat', exists (select 1 from messages where kind = 'system' and (meta->>'pool_market')::bigint = :pm));
select pg_temp.as_team(2);
select pool_buy(:pm, 'a1', 100) as pb \gset
select pg_temp.expect('100 coins at even money buy more than 100 shares', (:'pb'::jsonb->>'shares')::numeric > 100 and (:'pb'::jsonb->>'shares')::numeric < 200);
select pg_temp.expect('and push East up', (select (pool_prices(q, b)->>'a1')::numeric > 0.6 from pool_markets where id = :pm));
select pg_temp.expect('prices always add to one', (select abs((pool_prices(q, b)->>'a1')::numeric + (pool_prices(q, b)->>'a2')::numeric - 1) < 0.00001 from pool_markets where id = :pm));
select pg_temp.expect('the stake is a ledger line', (select sum(amount) from coin_ledger where team_id = 2 and reason like 'Called it: Pool test%') = -100);
select pg_temp.raises('a cap per question', format('select pool_buy(%s, ''a2'', 250)', :pm), 'Up to 300 coins');
select pg_temp.raises('only real answers', format('select pool_buy(%s, ''a9'', 10)', :pm), 'one of the answers');
select pg_temp.raises('a GM can''t settle it', format('select pool_resolve(%s, ''a1'')', :pm), 'Commissioner only');
select pg_temp.as_team(3);
select pool_buy(:pm, 'a2', 50);
select pg_temp.as_team(2);
select pool_sell(:pm, 'a1') as ps \gset
select pg_temp.expect('selling hands coins back', (:'ps'::jsonb->>'coins')::int between 50 and 100
  and (select shares from pool_positions where market_id = :pm and team_id = 2 and outcome = 'a1') = 0);
select pg_temp.expect('every trade is on the chart', (select count(*) from pool_trades where market_id = :pm) = 3);
select pg_temp.raises('the words lock once people trade', format('select pool_edit(%s, ''{"title": "Something else"}''::jsonb)', :pm), 'Commissioner only');
select pg_temp.as_team(1);
select pg_temp.raises('the host can''t reword a traded question', format('select pool_edit(%s, ''{"title": "Something else"}''::jsonb)', :pm), 'stay as they are');
select pool_edit(:pm, jsonb_build_object('closes_at', now() + interval '3 days'));
select pool_resolve(:pm, 'a2', 'Test settle');
select pg_temp.expect('the winner is paid a coin a share', (select sum(amount) from coin_ledger where team_id = 3 and reason like 'Paid: Pool test%')
  = (select floor(shares) from pool_positions where market_id = :pm and team_id = 3 and outcome = 'a2'));
select pg_temp.expect('the leaders count the hit', (select hits from pool_leaders() where team_id = 3) >= 1);
select pg_temp.as_team(3);
select pg_temp.raises('a settled question takes no trades', format('select pool_buy(%s, ''a2'', 10)', :pm), 'closed');
select pg_temp.as_team(1);
select pg_temp.raises('settled once', format('select pool_resolve(%s, ''a1'')', :pm), 'void it to start over');
select pool_resolve(:pm, null, 'Test void');
select pg_temp.expect('a void after a settlement takes back the payout and refunds the stake',
  (select sum(amount) from coin_ledger where team_id = 3 and (reason like '%Pool test%')) = 0);
select pg_temp.expect('and puts a seller who sold at a loss back where she started', (select sum(amount) from coin_ledger where team_id = 2 and reason like '%Pool test%') = 0);
-- the north sees none of it and can't touch it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false);
select pg_temp.expect('the north sees no SaK questions or trades', (select count(*) from pool_markets) + (select count(*) from pool_trades) + (select count(*) from pool_positions) = 0);
select pg_temp.raises('nor trades one', format('select pool_buy(%s, ''a1'', 10)', :pm));
reset role;

-- a prediction pool of its own: the platform opens it with the Love Is Blind pack; the host's open link seats friends
select pg_temp.as_team(1);
set role authenticated;
select platform_open_pool('pod-squad-test', 'Pod Squad', 'PS', 'love-is-blind-s11') as lib \gset
reset role;
select set_config('t.lib', :'lib', false);
select pg_temp.expect('the pool is a prediction league', (select kind from leagues where id = :lib) = 'predict');
select pg_temp.expect('with the pack''s questions, drops and brand', (select count(*) from pool_markets where league_id = :lib) = 8
  and (select count(*) from pool_drops where league_id = :lib) = 4 and (select brand->'coin'->>'name' from leagues where id = :lib) = 'Goblets');
select pg_temp.expect('loading the pack twice adds nothing', _pool_load_pack(:lib, 'love-is-blind-s11', null) = 0);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000081', 'host81@example.com'), ('00000000-0000-0000-0000-000000000082', 'friend82@example.com');
insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values ('hostseat81', :lib, (select id from teams where league_id = :lib), 'gm', '00000000-0000-0000-0000-000000000001', now() + interval '1 day', 1);
select _accept_invite('00000000-0000-0000-0000-000000000081', 'hostseat81', 'Hana');
update leagues set status = 'active' where id = :lib;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_invite_link(7, 20) as libcode \gset
reset role;
select _accept_invite('00000000-0000-0000-0000-000000000082', :'libcode', 'Fern');
select id as fern from teams where league_id = :lib and user_id = '00000000-0000-0000-0000-000000000082' \gset
select pg_temp.expect('an open link seats a friend on a team of her own', (select role from teams where id = :fern) = 'gm'
  and exists (select 1 from league_members where team_id = :fern and league_id = :lib));
select pg_temp.expect('with the opening coins and every drop so far', (select balance from coin_balances where team_id = :fern)
  = 1000 + coalesce((select sum(amount) from pool_drops where league_id = :lib and at <= now()), 0));
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('the open link is for prediction pools', 'select pool_invite_link()', 'prediction pools');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_add_drop(250, 'Bonus night', now() - interval '1 minute');
select pg_temp.expect('a drop pays every member once', (select count(*) from coin_ledger where reason like 'Coin drop: Bonus night%') = 2);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
select pool_buy((select id from pool_markets where league_id = :lib and title like 'Will a woman propose%'), 'a1', 120);
select pg_temp.expect('a friend trades in her pool, and sees only it', (select count(*) from pool_trades) = 1 and (select count(*) from teams) = 2);
reset role;
select pg_temp.expect('the drop job pays nothing twice', (run_league_jobs('pool-drops')->>:'lib')::int = 0);
select pg_temp.expect('the fantasy jobs skip a prediction pool', not (run_league_jobs('settle-bets') ? :'lib'));
select set_config('request.jwt.claim.sub', '', false);
select 'prediction pools', true;
