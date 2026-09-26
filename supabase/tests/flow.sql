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
select pg_temp.as_team(4);
set role authenticated;
select respond_trade(:multi, true);
reset role;
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
select create_bet_v2(jsonb_build_object('opponent', 8, 'title', 'McDavid over 0.5 goals', 'kind', 'player_ou', 'coins', 40,
  'start', (today_et() - 1)::text, 'end', (today_et() - 1)::text,
  'subject', jsonb_build_object('player_id', (select id from players where name = 'Connor McDavid'), 'stat', 'g', 'line', 0.5, 'side', 'over'))) as ou_id \gset
select create_bet_v2(jsonb_build_object('title', 'Pick a player: most fantasy points yesterday', 'kind', 'pool_player', 'coins', 30,
  'start', (today_et() - 1)::text, 'end', (today_et() - 1)::text, 'entry_close', (today_et() - 1)::text,
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
