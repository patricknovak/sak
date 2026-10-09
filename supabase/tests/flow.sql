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
-- another GM sees team 1's plans (migration 164) but can't change them: no direct writes, and the plan functions
-- only ever touch the caller's own team
select pg_temp.expect('another GM sees team 1''s plans', (select count(*) = 3 from lineup_plans where team_id = 1));
do $$ begin update lineup_plans set slot = 'BN' where team_id = 1; raise exception 'another GM changed a plan';
exception when insufficient_privilege then null; end $$;
do $$ begin delete from lineup_plans where team_id = 1; raise exception 'another GM deleted a plan';
exception when insufficient_privilege then null; end $$;
select clear_lineup_plans(array[today_et() + 1, today_et() + 2]);
select pg_temp.expect('another GM''s clear leaves team 1''s plans', (select count(*) = 3 from lineup_plans where team_id = 1));
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
  = array['brand', 'id', 'kind', 'name', 'short_name', 'slug', 'status']);
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

-- the packs' questions carry real dates and a pool skips the ones already closed (migration 159); the test runs on any
-- day, so each pack whose first question closes within a week moves later until it closes a week from now
update pool_packs p set markets = (select jsonb_agg(m || jsonb_build_object('closes_at', (m->>'closes_at')::timestamptz + s.shift) order by i)
                                   from jsonb_array_elements(p.markets) with ordinality t(m, i))
from (select slug, greatest(interval '0', now() + interval '7 days' - min((m->>'closes_at')::timestamptz)) shift
      from pool_packs, jsonb_array_elements(markets) m group by slug) s
where s.slug = p.slug;
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
set role anon;
select pg_temp.expect('a pool''s invite names its host and how many are in (migration 160)', (select v->>'host' = 'Hana' and (v->>'members')::int = 1
  from invite_preview(:'libcode') v) and not (invite_preview(:'join_code') ? 'host'));
reset role;
select _accept_invite('00000000-0000-0000-0000-000000000082', :'libcode', 'Fern');
select id as fern from teams where league_id = :lib and user_id = '00000000-0000-0000-0000-000000000082' \gset
-- any member shares the pool's open link (migration 162): the same link the host made, not a new one
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('a member shares the pool''s open link', pool_share_link() = :'libcode');
reset role;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('a league has no open link to share', 'select pool_share_link()', 'prediction pools');
reset role;
select set_config('request.jwt.claim.sub', '', false);
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

-- ───────────── soccer (migration 148) ─────────────
-- fixtures come in through the adapter's one write; a pool's host adds a matchweek; the results settle the questions
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('soccer states read from the sport', _sport_state('soccer', 'HT') = 'live' and _sport_state('soccer', 'AET') = 'final'
  and _sport_state('soccer', 'PST') = 'postponed' and _sport_state('soccer', 'NS') = 'scheduled' and _sport_state('soccer', 'ABD') = 'cancelled');
select set_config('t.fx', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', '42', 'name', 'Arsenal', 'short', 'ARS'),
    jsonb_build_object('ext_id', '49', 'name', 'Chelsea', 'short', 'CHE'), jsonb_build_object('ext_id', '40', 'name', 'Liverpool', 'short', 'LIV')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', '9001', 'round', 'Regular Season - 8', 'gameweek', 8, 'kickoff', now() + interval '2 days', 'status', 'NS', 'home', '42', 'away', '49'),
    jsonb_build_object('ext_id', '9002', 'round', 'Regular Season - 8', 'gameweek', 8, 'kickoff', now() + interval '3 days', 'status', 'NS', 'home', '40', 'away', '42'),
    jsonb_build_object('ext_id', '9003', 'round', 'Regular Season - 9', 'gameweek', 9, 'kickoff', now() + interval '9 days', 'status', 'NS', 'home', '49', 'away', '40')))::text, false);
select soccer_ingest('epl', current_setting('t.fx')::jsonb);
select pg_temp.expect('an ingest twice changes nothing', (soccer_ingest('epl', current_setting('t.fx')::jsonb)->>'fixtures')::int = 3
  and (select count(*) from fixtures) = 3 and (select count(*) from clubs) = 3);
select pg_temp.expect('a fixture''s date is its date in the competition''s time zone', (select date = (kickoff at time zone 'Europe/London')::date from fixtures where ext_id = '9001'));
select pg_temp.expect('nothing to pull until a match is near', not _soccer_due());
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a member can''t add matches', 'select pool_add_fixtures(''epl'')', 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the next matchweek is on offer', (select gameweek = 8 and matches = 2 and added = 0 from soccer_rounds() where competition = 'epl'));
select pg_temp.expect('the host adds the next matchweek', pool_add_fixtures('epl') = 2);
select pg_temp.expect('and adding it again adds nothing', pool_add_fixtures('epl') = 0);
select pg_temp.expect('each question closes at kick-off with home, draw, away',
  (select m.closes_at = f.kickoff and m.outcomes->1->>'label' = 'Draw' and m.outcomes->0->>'label' = 'Arsenal'
   from pool_markets m join fixtures f on f.id = (m.source->>'fixture')::bigint where f.ext_id = '9001'));
select pg_temp.expect('and the chat hears about it', exists (select 1 from messages where meta ? 'pool_fixtures'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
select pool_buy((select id from pool_markets where title = 'Arsenal v Chelsea'), 'a1', 100);
select pool_buy((select id from pool_markets where title = 'Liverpool v Arsenal'), 'a3', 60);
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the whistle: Arsenal win 2-1; the other match is postponed
select soccer_ingest('epl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '9001', 'gameweek', 8, 'kickoff', now() + interval '2 days', 'status', 'FT', 'home', '42', 'away', '49',
    'home_score', 2, 'away_score', 1, 'home_ft', 2, 'away_ft', 1),
  jsonb_build_object('ext_id', '9002', 'gameweek', 8, 'kickoff', now() + interval '3 days', 'status', 'PST', 'home', '40', 'away', '42'))));
select pg_temp.expect('results make the settle job due', _pool_settle_due());
select pg_temp.expect('the job settles both', (run_league_jobs('pool-settle')->>:'lib')::int = 2);
select pg_temp.expect('and has nothing left to do', not _pool_settle_due());
select pg_temp.expect('the win pays a coin a share', (select status = 'resolved' and winner_key = 'a1' and note = 'Full time: Arsenal 2-1 Chelsea'
  from pool_markets where title = 'Arsenal v Chelsea')
  and (select sum(amount) from coin_ledger where team_id = :fern and reason like 'Paid: Arsenal v Chelsea%') > 100);
select pg_temp.expect('the postponed match is voided and refunded', (select status from pool_markets where title = 'Liverpool v Arsenal') = 'void'
  and (select sum(amount) from coin_ledger where team_id = :fern and reason like '%Liverpool v Arsenal%') = 0);
select pg_temp.expect('settled in the pool''s own chat', (select league_id from messages where body like '✅ Settled: "Arsenal v Chelsea"%') = :lib);
select pg_temp.expect('a host can still settle by hand', (select count(*) from pool_markets where league_id = :lib and status = 'open' and source is null) > 0);
select set_config('request.jwt.claim.sub', '', false);
select 'soccer', true;

-- ───────────── a pool's address and invite say what kind of league it is (migration 150) ─────────────
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('a pool''s address says it is a pool', league_by_host('pod-squad-test.superpoolsai.com')->>'kind' = 'predict'
  and league_by_host('sak.superpoolsai.com')->>'kind' = 'fantasy');
insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values ('kindcheck150', :lib, null, 'gm', '00000000-0000-0000-0000-000000000001', now() + interval '1 day', 5);
select pg_temp.expect('and so does its invite', invite_preview('kindcheck150')->>'kind' = 'predict');
select 'host kind', true;

-- ───────────── one account, every pool (migration 151) ─────────────
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select set_config('t.mp', my_pools()::text, false);
select pg_temp.expect('my pools lists the pool she is in, with where she stands', (select count(*) from jsonb_array_elements(current_setting('t.mp')::jsonb)) = 1
  and (select (e->'summary'->>'rank')::int >= 1 and e->>'kind' = 'predict' and (e->'summary') ? 'closing'
       from jsonb_array_elements(current_setting('t.mp')::jsonb) e));
select set_config('t.op', pool_start('Office Pool', '#f7c548')::text, false);
select pg_temp.expect('she starts a pool of her own in one step', current_setting('t.op')::jsonb->>'slug' = 'office-pool');
select pg_temp.expect('and hosts it with the opening coins', (select t.is_commish and cb.balance = 1000 from teams t join coin_balances cb on cb.team_id = t.id
  where t.league_id = (current_setting('t.op')::jsonb->>'id')::int and t.user_id = '00000000-0000-0000-0000-000000000082'));
select pg_temp.expect('it is a live prediction pool with no money in it', (select l.kind = 'predict' and l.status = 'active' and not (r.features ? 'money')
  and l.brand->'wordmark'->>'a' = 'OFFICE' and l.brand->'colors'->>'gold' = '#f7c548'
  from leagues l join league_rules r on r.league_id = l.id where l.id = (current_setting('t.op')::jsonb->>'id')::int));
select pg_temp.expect('the new pool is the one she lands in', current_league_id() = (current_setting('t.op')::jsonb->>'id')::int);
select pg_temp.expect('and both are in her pools', jsonb_array_length(my_pools()) = 2);
select pg_temp.expect('a name taken gets a number', pool_start('Office Pool')->>'slug' = 'office-pool-2');
select pg_temp.expect('the app''s own names are never a pool''s', pool_start('App')->>'slug' = 'app-pool');
select set_config('t.bw', pool_start('Bachelorette Watch', '#fb7185', 'love-is-blind-s11')->>'slug', false);
select pg_temp.expect('a pack brings its questions and its coins', (select count(*) = 8 and min(l.brand->'coin'->>'name') = 'Goblets'
  and min(l.brand->'wordmark'->>'a') = 'BACHELORETTE' from pool_markets m join leagues l on l.id = m.league_id where l.slug = current_setting('t.bw')));
select pool_start('Fifth Pool');
select pg_temp.raises('five a day', 'select pool_start(''Sixth Pool'')', 'five pools today');
-- invitations to a person (migration 163): Fern, now in the pool she just started, invites Hana, whom she knows from the
-- Pod Squad; the invitation waits on Hana's My pools with an alert in her other pool, and she joins from there
select current_league_id() as fifth \gset
select pg_temp.expect('Fern can invite the people she plays with', exists (select 1 from jsonb_array_elements(pool_invite_candidates()) c
  where c->>'account' = '00000000-0000-0000-0000-000000000081' and not (c->>'invited')::boolean and c->>'pools' like '%Pod Squad%'));
select pg_temp.expect('an email with no account looks the same as one with', pool_invite_people(array['00000000-0000-0000-0000-000000000081']::uuid[], array['nobody-here@example.com']) = '{"ok": true}'::jsonb);
select pool_invite_people(array['00000000-0000-0000-0000-000000000081']::uuid[]);
reset role;
select pg_temp.expect('one invitation, however often she asks', (select count(*) from league_invites where invitee = '00000000-0000-0000-0000-000000000081' and league_id = :fifth) = 1
  and exists (select 1 from notifications n join teams t on t.id = n.team_id where t.user_id = '00000000-0000-0000-0000-000000000081' and n.kind = 'pool_invite'
              and n.link = '/pools' and n.body like '✉️ % invited you to Fifth Pool. Open My pools to join.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('it waits on her My pools', jsonb_array_length(my_invites()) = 1 and my_invites()->0->>'name' = 'Fifth Pool'
  and my_invites()->0->>'host' is not null);
select my_invites()->0->>'code' as icode \gset
select accept_invite(:'icode');
select pg_temp.expect('she joins from there, and it is gone from the list', exists (select 1 from league_members where user_id = '00000000-0000-0000-0000-000000000081' and league_id = :fifth)
  and my_invites() = '[]'::jsonb);
select decline_invite('not-a-code');
select set_active_league(:lib);   -- back to the Pod Squad for the sections below
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000083', false);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000083', 'nobody83@example.com') on conflict do nothing;
set role authenticated;
select pg_temp.expect('someone in no pool has nothing to list', my_pools() = '[]'::jsonb);
select pg_temp.raises('and joins one before starting one', 'select pool_start(''Lonely Pool'')', 'Join a pool first');
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('a GM''s fantasy league shows rank, points and what needs him', (select (e->'summary'->>'rank')::int >= 1 and (e->'summary'->>'of')::int >= 8
  and (e->'summary') ? 'trade_offers' and (e->'summary') ? 'unread_chat' from jsonb_array_elements(my_pools()) e where (e->>'league_id')::int = 1));
select pg_temp.expect('and Fern''s pools are not his', not exists (select 1 from jsonb_array_elements(my_pools()) e where e->>'slug' like 'office-pool%'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'my pools', true;

-- ───────────── pool alerts (migration 154) ─────────────
-- the earlier pool sections already rang: the matchweek's questions, the settled match, the voided one
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('a burst of new questions is one alert that counts them', (select count(*) from notifications where team_id = :fern and kind = 'pool_new') = 1
  and (select body like '🔮 2 new questions to call%' and link = '/questions' from notifications where team_id = :fern and kind = 'pool_new'));
select pg_temp.expect('the host is not told about her own questions', not exists (select 1 from notifications n join teams t on t.id = n.team_id
  where t.league_id = :lib and t.is_commish and n.kind = 'pool_new'));
select pg_temp.expect('a call that came in says what it won', (select body like '✅ Called it: Arsenal v Chelsea → Arsenal. You won %' from notifications
  where team_id = :fern and kind = 'pool_settled' and body like '%Arsenal v Chelsea%'));
select pg_temp.expect('a voided one says the stake came back', exists (select 1 from notifications where team_id = :fern and kind = 'pool_settled' and body like '↩️ Voided: Liverpool v Arsenal. Your 60 came back.'));
select pg_temp.expect('alerts stay in their pool', not exists (select 1 from notifications n join teams t on t.id = n.team_id where n.kind like 'pool_%' and n.league_id <> t.league_id));
-- a drop paid now rings every member; one joining later doesn't hear about the drops before them
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_add_drop(300, 'Episode night');
reset role;
select pg_temp.expect('coins dropped, with the questions open', (select body like '🪙 300 Goblets dropped: Episode night.%open to call.' and link = '/questions'
  from notifications where team_id = :fern and kind = 'pool_drop' order by id desc limit 1));
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000086', 'late86@example.com') on conflict do nothing;
select _accept_invite('00000000-0000-0000-0000-000000000086', :'libcode', 'Lou');
select pg_temp.expect('a late joiner gets the coins but no alerts for old drops', not exists (select 1 from notifications n join teams t on t.id = n.team_id
  where t.user_id = '00000000-0000-0000-0000-000000000086' and n.kind = 'pool_drop'));
-- closing soon: a question closing in two hours that Fern hasn't called, once
update pool_markets set closes_at = now() + interval '2 hours' where league_id = :lib and title like 'How many couples get engaged%';
select _pool_nudge_closing(:lib) as nudged \gset
select pg_temp.expect('the reminder goes to those who haven''t called it', :nudged >= 1
  and exists (select 1 from notifications where team_id = :fern and kind = 'pool_closing' and body like '⏰ Closes in 2h: How many couples get engaged%'));
select pg_temp.expect('and only once', _pool_nudge_closing(:lib) = 0);
select pg_temp.expect('the hourly job runs it', (run_league_jobs('pool-drops')->>:'lib') is not null);
select set_config('request.jwt.claim.sub', '', false);
select 'pool alerts', true;

-- ───────────── the Love Is Blind test's scoreboard (migration 155) ─────────────
reset role;
insert into ops.platform_admins (user_id) select user_id from teams where id = 1 on conflict do nothing;
select pg_temp.as_team(1);
set role authenticated;
select platform_pool_test() as pt \gset
reset role;
select set_config('t.pt', :'pt', false);
select pg_temp.expect('the scoreboard counts the pools and their players', (current_setting('t.pt')::jsonb->>'pools_live')::int >= 1
  and (current_setting('t.pt')::jsonb->>'players')::int >= 2
  and jsonb_array_length(current_setting('t.pt')::jsonb->'weeks') = 4
  and exists (select 1 from jsonb_array_elements(current_setting('t.pt')::jsonb->'pools') x where (x->>'league_id')::int = :lib and (x->>'calls')::int >= 1));
select pg_temp.expect('a pool with three players or more is running', (current_setting('t.pt')::jsonb->>'running')::int
  = (select count(*) from (select t.league_id from teams t join leagues l on l.id = t.league_id where l.kind = 'predict' and l.status = 'active'
     and t.role = 'gm' and t.user_id is not null group by t.league_id having count(*) >= 3) x));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the platform sees it', 'select platform_pool_test()', 'Only the platform');
reset role;
-- what pool players ask for (migration 161): a pool's idea tells its chat where to vote, and the platform reads every
-- pool's ideas in one list; nobody else can
select set_config('app.league_id', :'lib', false);
insert into feature_ideas (team_id, title, body) values (:fern, 'A question for every couple', 'One tap for the whole cast');
select pg_temp.expect('a pool''s idea points its chat to More, Ideas', exists (select 1 from messages where league_id = :lib
  and body like '💡 % suggested an idea: “A question for every couple”. Vote on it under More → Ideas.'));
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the platform reads every pool''s ideas', exists (select 1 from jsonb_array_elements(platform_ideas()) x
  where x->>'title' = 'A question for every couple' and x->>'pool' is not null and (x->>'votes')::int = 0));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the platform reads them', 'select platform_ideas()', 'Only the platform');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'pool test scoreboard', true;

-- ───────────── start a pool with no account yet (migration 153) ─────────────
-- the join function makes the account, then opens the pool through _pool_start_new as the service role
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000091', 'newhost91@example.com'), ('00000000-0000-0000-0000-000000000092', 'newhost92@example.com'),
  ('00000000-0000-0000-0000-000000000093', 'newhost93@example.com'), ('00000000-0000-0000-0000-000000000094', 'newhost94@example.com') on conflict do nothing;
set role service_role;
select _pool_start_new('00000000-0000-0000-0000-000000000091', 'Pod Watchers', '#fb7185', 'love-is-blind-s11', 'Maya', 'iphash-aaaa-1') ->> 'id' as nw \gset
reset role;
select pg_temp.expect('a brand-new account hosts its new pool, under the name it gave', (select t.is_commish and t.gm_name = 'Maya' and t.user_id = '00000000-0000-0000-0000-000000000091'
  from teams t where t.league_id = :nw));
select pg_temp.expect('it is a member, with the pack loaded and 1,000 coins', exists (select 1 from league_members where user_id = '00000000-0000-0000-0000-000000000091' and league_id = :nw)
  and (select count(*) from pool_markets where league_id = :nw) = 8 and (select sum(amount) from coin_ledger c join teams t on t.id = c.team_id where t.league_id = :nw) = 1000);
select pg_temp.expect('and the pool opens for it', (select active_league_id from accounts where user_id = '00000000-0000-0000-0000-000000000091') = :nw);
set role service_role;
select pg_temp.raises('an account already in a pool uses My pools instead', $$select _pool_start_new('00000000-0000-0000-0000-000000000091', 'Second Pool', null, null, 'Maya', 'iphash-aaaa-1')$$, 'already in a pool');
select _pool_start_new('00000000-0000-0000-0000-000000000092', 'Rose Ceremony', null, null, 'Ana', 'iphash-aaaa-1');
select _pool_start_new('00000000-0000-0000-0000-000000000093', 'Altar Watch', null, null, 'Bea', 'iphash-aaaa-1');
select pg_temp.raises('three new pools a day from one address', $$select _pool_start_new('00000000-0000-0000-0000-000000000094', 'Fourth Pool', null, null, 'Cy', 'iphash-aaaa-1')$$, 'three new pools');
select pg_temp.expect('another address still can', (_pool_start_new('00000000-0000-0000-0000-000000000094', 'Fourth Pool', null, null, 'Cy', 'iphash-bbbb-2') ->> 'id') is not null);
select pg_temp.raises('no address, no pool', $$select _pool_start_new('00000000-0000-0000-0000-000000000094', 'Fifth Pool', null, null, 'Cy', '')$$, 'Couldn');
reset role;
-- nobody signed in reaches either door directly
set role anon;
select pg_temp.raises('the public can''t call it', $$select _pool_start_new('00000000-0000-0000-0000-000000000094', 'X Pool', null, null, 'Cy', 'iphash-cccc-3')$$, 'permission denied');
reset role;
set role authenticated;
select pg_temp.raises('nor can a signed-in GM', $$select _pool_open('00000000-0000-0000-0000-000000000094', 'X Pool', null, null)$$, 'permission denied');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'start a pool, no account', true;

-- ───────────── soccer packs (migration 156) ─────────────
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000095', 'gaffer95@example.com') on conflict do nothing;
set role service_role;
select _pool_start_new('00000000-0000-0000-0000-000000000095', 'Sunday League', null, 'premier-league-2026-27', 'Sam', 'iphash-dddd-4') ->> 'id' as epl \gset
reset role;
select pg_temp.expect('a Premier League pool opens with its questions and its monthly drops', (select count(*) from pool_markets where league_id = :epl and status = 'open') = 9
  and (select count(*) from pool_drops where league_id = :epl) = 7 and (select brand->>'trophy' from leagues where id = :epl) = 'The Title');
select pg_temp.expect('a champion question carries the contenders and the field', (select jsonb_array_length(outcomes) = 8 and outcomes->7->>'label' = 'Anyone else'
  from pool_markets where league_id = :epl and title = 'Who wins the Premier League?'));
set role anon;
select pg_temp.expect('the start page lists every pack with its icon', (select count(*) from pool_pack_list() where icon is not null) = (select count(*) from pool_pack_list())
  and exists (select 1 from pool_pack_list() where slug = 'mls-cup-2026' and questions = 5));
-- the calendar (migration 159): a pack with nothing left to call drops off; one half done lists what is still open, and
-- a pool started from it gets only those
reset role;
insert into pool_packs (slug, name, brand, markets, drops) values
  ('test-done', 'Done and dusted', '{"icon": "🗓️"}', jsonb_build_array(jsonb_build_object('title', 'Over already?', 'outcomes', jsonb_build_array('Yes', 'No'), 'closes_at', now() - interval '1 day')), '[]'),
  ('test-half', 'Half time', '{"icon": "⏱️"}', jsonb_build_array(
     jsonb_build_object('title', 'The first half?', 'outcomes', jsonb_build_array('Yes', 'No'), 'closes_at', now() - interval '1 hour'),
     jsonb_build_object('title', 'The second half?', 'outcomes', jsonb_build_array('Yes', 'No'), 'closes_at', now() + interval '2 days')), '[]');
set role anon;
select pg_temp.expect('a finished pack is off the list; a half-done one lists what is open, soonest first',
  not exists (select 1 from pool_pack_list() where slug = 'test-done')
  and (select questions = 1 and next_close > now() from pool_pack_list() where slug = 'test-half')
  and (select slug from pool_pack_list() limit 1) = 'test-half'
  and exists (select 1 from pool_pack_list() where slug = 'world-series-2026' and icon = '⚾')
  and exists (select 1 from pool_pack_list() where slug = 'nhl-2026-27' and questions = 9));
reset role;
select pg_temp.expect('a pool takes only the questions still open', _pool_load_pack(:epl, 'test-half', null) = 1
  and not exists (select 1 from pool_markets where league_id = :epl and title = 'The first half?'));
delete from pool_markets where league_id = :epl and pack = 'test-half';
delete from pool_packs where slug in ('test-done', 'test-half');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'soccer packs', true;

-- ───────────── last one standing (migration 157) ─────────────
-- Pod Squad runs a survivor on two MLS matchweeks: Fern, Hana and Lou are in; Lou never picks
reset role;
select set_config('request.jwt.claim.sub', '', false);
select soccer_ingest('mls', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', '501', 'name', 'Austin FC', 'short', 'ATX'), jsonb_build_object('ext_id', '502', 'name', 'Boston FC', 'short', 'BOS'),
    jsonb_build_object('ext_id', '503', 'name', 'Calgary FC', 'short', 'CAL'), jsonb_build_object('ext_id', '504', 'name', 'Denver FC', 'short', 'DEN')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', '7001', 'gameweek', 30, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', '501', 'away', '502'),
    jsonb_build_object('ext_id', '7002', 'gameweek', 30, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', '503', 'away', '504'),
    jsonb_build_object('ext_id', '7003', 'gameweek', 31, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', '501', 'away', '503'),
    jsonb_build_object('ext_id', '7004', 'gameweek', 31, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', '502', 'away', '504'))));
select id as atx from clubs where ext_id = '501' \gset
select id as bos from clubs where ext_id = '502' \gset
select id as cal from clubs where ext_id = '503' \gset
select id as den from clubs where ext_id = '504' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the host starts one', $$select survivor_start('mls')$$, 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select survivor_start('mls') as sv \gset
select pg_temp.expect('it starts from the next matchweek', (select start_gw from pool_survivors where id = :sv) = 30);
select pg_temp.raises('one at a time', $$select survivor_start('mls')$$, 'already has a survivor');
select survivor_pick(:sv, :cal);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select survivor_pick(:sv, :bos);
select survivor_pick(:sv, :atx);
reset role;
select pg_temp.expect('a pick can change until kick-off, one a matchweek', (select count(*) from pool_survivor_picks where survivor_id = :sv and team_id = :fern) = 1
  and (select club_id from pool_survivor_picks where survivor_id = :sv and team_id = :fern) = :atx);
set role authenticated;
select pg_temp.expect('the board shows her own pick before kick-off, not Hana''s', (select jsonb_array_length(p->'picks') from jsonb_array_elements(survivor_board(:sv)->'players') p where (p->>'team_id')::int = :fern) = 1
  and (select jsonb_array_length(p->'picks') from jsonb_array_elements(survivor_board(:sv)->'players') p where (p->>'team_id')::int <> :fern and (p->'picks') <> '[]'::jsonb) is null);
reset role;
-- matchweek 30: Austin win, Calgary v Denver is postponed; Lou made no pick
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7001', 'gameweek', 30, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', '501', 'away', '502', 'home_score', 2, 'away_score', 0, 'home_ft', 2, 'away_ft', 0),
  jsonb_build_object('ext_id', '7002', 'gameweek', 30, 'kickoff', now() + interval '1 day', 'status', 'PST', 'home', '503', 'away', '504'))));
select pg_temp.expect('a win is through, a postponed match is void', (select result from pool_survivor_picks where survivor_id = :sv and team_id = :fern) = 'through'
  and (select result from pool_survivor_picks p join teams t on t.id = p.team_id where p.survivor_id = :sv and t.is_commish) = 'void');
select pg_temp.expect('no pick is out', exists (select 1 from pool_survivor_picks p join teams t on t.id = p.team_id where p.survivor_id = :sv and t.gm_name = 'Lou' and p.result = 'missed')
  and exists (select 1 from notifications n join teams t on t.id = n.team_id where t.gm_name = 'Lou' and n.kind = 'survivor' and n.body like '💥 Out: no pick%'));
select pg_temp.expect('two still in, so it goes on', (select status from pool_survivors where id = :sv) = 'open'
  and (select count(*) from jsonb_array_elements(survivor_board(:sv)->'players') p where (p->>'alive')::boolean) = 2);
-- matchweek 31: Fern can't use Austin again; Hana can use Calgary again (its match was called off), then switches to Denver
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a club once a season', format('select survivor_pick(%s, %s)', :sv, :atx), 'used that club');
select survivor_pick(:sv, :cal);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a club that doesn''t play this week', format('select survivor_pick(%s, %s)', :sv, (select id from clubs where ext_id = '42')), 'doesn''t play');
select survivor_pick(:sv, :cal);
select survivor_pick(:sv, :den);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.raises('someone out can''t pick', format('select survivor_pick(%s, %s)', :sv, :bos), 'out of this one');
reset role;
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7003', 'gameweek', 31, 'kickoff', now() + interval '8 days', 'status', 'FT', 'home', '501', 'away', '503', 'home_score', 0, 'away_score', 1, 'home_ft', 0, 'away_ft', 1),
  jsonb_build_object('ext_id', '7004', 'gameweek', 31, 'kickoff', now() + interval '8 days', 'status', 'FT', 'home', '502', 'away', '504', 'home_score', 2, 'away_score', 2, 'home_ft', 2, 'away_ft', 2))));
select pg_temp.expect('a draw is out', (select result from pool_survivor_picks p join teams t on t.id = p.team_id where p.survivor_id = :sv and t.is_commish and p.gameweek = 31) = 'out'
  and exists (select 1 from notifications n join teams t on t.id = n.team_id where t.is_commish and t.league_id = :lib and n.kind = 'survivor' and n.body like '💥 Out: Denver FC didn''t beat Boston FC (2-2).'));
select pg_temp.expect('the last one standing wins it, and the chat hears', (select status = 'done' and winners = array[:fern] from pool_survivors where id = :sv)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Last one standing: Fern.'));
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'last one standing', true;

-- ───────────── call the score (migration 158) ─────────────
-- Pod Squad calls the scores of two more MLS matchweeks (40, the last 41): Fern and Hana call, Lou forgets
reset role;
select set_config('request.jwt.claim.sub', '', false);
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7101', 'gameweek', 40, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', '501', 'away', '502'),
  jsonb_build_object('ext_id', '7102', 'gameweek', 40, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', '503', 'away', '504'),
  jsonb_build_object('ext_id', '7103', 'gameweek', 41, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', '504', 'away', '501'),
  jsonb_build_object('ext_id', '7104', 'gameweek', 41, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', '502', 'away', '503'))));
select id as fa from fixtures where ext_id = '7101' \gset
select id as fb from fixtures where ext_id = '7102' \gset
select id as fc from fixtures where ext_id = '7103' \gset
select id as fd from fixtures where ext_id = '7104' \gset
select id as hana from teams where league_id = :lib and is_commish \gset
select id as lou from teams where league_id = :lib and gm_name = 'Lou' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the host starts it', $$select predictor_start('mls')$$, 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select predictor_start('mls') as pr \gset
select pg_temp.expect('it starts from the next matchweek', (select start_gw from pool_predictors where id = :pr) = 40);
select pg_temp.raises('one at a time', $$select predictor_start('mls')$$, 'already has a score predictor');
select pg_temp.expect('Hana calls both', predictor_save(:pr, 40, jsonb_build_array(jsonb_build_object('fixture', :fa, 'home', 1, 'away', 1),
  jsonb_build_object('fixture', :fb, 'home', 1, 'away', 0)), :fb) = 2);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a score is 0 to 20', format('select predictor_save(%s, 40, %L)', :pr, jsonb_build_array(jsonb_build_object('fixture', :fa, 'home', 21, 'away', 0))), 'from 0 to 20');
select pg_temp.raises('a banker needs a call', format('select predictor_save(%s, 40, %L, %s)', :pr, '[]', :fa), 'score first');
select predictor_save(:pr, 40, jsonb_build_array(jsonb_build_object('fixture', :fa, 'home', 3, 'away', 0), jsonb_build_object('fixture', :fb, 'home', 0, 'away', 0)), :fb);
select predictor_save(:pr, 40, jsonb_build_array(jsonb_build_object('fixture', :fa, 'home', 2, 'away', 1)), :fa);
reset role;
select pg_temp.expect('a call and the banker can change until kick-off', (select home = 2 and away = 1 and banker from pool_predictor_picks where predictor_id = :pr and team_id = :fern and fixture_id = :fa)
  and (select count(*) from pool_predictor_picks where predictor_id = :pr and team_id = :fern and banker) = 1);
set role authenticated;
select pg_temp.expect('before kick-off she sees her own calls, nobody else''s', (select (f->'mine'->>'home')::int = 2 and f->'calls' = 'null'::jsonb
  from jsonb_array_elements(predictor_board(:pr)->'fixtures') f where (f->>'id')::bigint = :fa));
select pg_temp.raises('the table itself is not readable', 'select count(*) from pool_predictor_picks', 'permission denied');
reset role;
-- three hours out, the one who hasn't called hears about it, once
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7101', 'gameweek', 40, 'kickoff', now() + interval '3 hours', 'status', 'NS', 'home', '501', 'away', '502'),
  jsonb_build_object('ext_id', '7102', 'gameweek', 40, 'kickoff', now() + interval '3 hours', 'status', 'NS', 'home', '503', 'away', '504'))));
select _soccer_nudge(:lib) as nudged \gset
select pg_temp.expect('the reminder goes to the one with matches to call', :nudged = 1
  and exists (select 1 from notifications where team_id = :lou and kind = 'predictor' and body = '⏰ Matchweek 40 kicks off in 3h. Call the score: 2 matches to call.'));
select pg_temp.expect('and only once', _soccer_nudge(:lib) = 0);
-- full time: 2-1 (Fern spot on with her banker, 6) and 2-0 (Hana's banker has the result, 2)
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7101', 'gameweek', 40, 'kickoff', now() - interval '2 hours', 'status', 'FT', 'home', '501', 'away', '502', 'home_score', 2, 'away_score', 1, 'home_ft', 2, 'away_ft', 1))));
select pg_temp.expect('the exact score with a banker is 6, and she hears it', (select points from pool_predictor_picks where predictor_id = :pr and team_id = :fern and fixture_id = :fa) = 6
  and (select points from pool_predictor_picks where predictor_id = :pr and team_id = :hana and fixture_id = :fa) = 0
  and exists (select 1 from notifications where team_id = :fern and kind = 'predictor' and body = '🎯 Spot on: Austin FC 2-1 Boston FC. +6 with your banker'));
select pg_temp.expect('the week isn''t announced while a match is left', not exists (select 1 from messages where league_id = :lib and body like '🎯 Matchweek 40%'));
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7102', 'gameweek', 40, 'kickoff', now() - interval '2 hours', 'status', 'FT', 'home', '503', 'away', '504', 'home_score', 3, 'away_score', 0, 'home_ft', 2, 'away_ft', 0))));
select pg_temp.expect('the result counts from ninety minutes; a banker doubles the result', (select points from pool_predictor_picks where predictor_id = :pr and team_id = :hana and fixture_id = :fb) = 2
  and (select points from pool_predictor_picks where predictor_id = :pr and team_id = :fern and fixture_id = :fb) = 0);
select pg_temp.expect('the week is done: the chat hears who won it, and so does she', exists (select 1 from messages where league_id = :lib
    and body = '🎯 Matchweek 40 is done. Top of the week: Fern with 6 points. Leading the table: Fern on 6.')
  and exists (select 1 from notifications where team_id = :fern and body = '🏅 You won matchweek 40 with 6 points.'));
-- a corrected score re-scores the calls, without a second announcement
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7101', 'gameweek', 40, 'kickoff', now() - interval '2 hours', 'status', 'FT', 'home', '501', 'away', '502', 'home_score', 1, 'away_score', 1, 'home_ft', 1, 'away_ft', 1))));
select pg_temp.expect('a correction re-scores', (select points from pool_predictor_picks where predictor_id = :pr and team_id = :hana and fixture_id = :fa) = 3
  and (select points from pool_predictor_picks where predictor_id = :pr and team_id = :fern and fixture_id = :fa) = 0
  and (select count(*) from messages where league_id = :lib and body like '🎯 Matchweek 40%') = 1);
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7101', 'gameweek', 40, 'kickoff', now() - interval '2 hours', 'status', 'FT', 'home', '501', 'away', '502', 'home_score', 2, 'away_score', 1, 'home_ft', 2, 'away_ft', 1))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.expect('after kick-off everyone''s calls show, and the table ranks them', (select jsonb_array_length(f->'calls') = 2
    from jsonb_array_elements(predictor_board(:pr, 40)->'fixtures') f where (f->>'id')::bigint = :fa)
  and (predictor_board(:pr, 40)->'table'->0->>'team_id')::int = :fern and (predictor_board(:pr, 40)->'table'->0->>'points')::int = 6
  and (predictor_board(:pr, 40)->'table'->0->>'exact')::int = 1 and (predictor_board(:pr)->>'gameweek')::int = 41);
reset role;
-- the last matchweek: one match kicks off early (too late to call), the other is called off
update fixtures set kickoff = now() - interval '1 minute' where id = :fc;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('a match that has kicked off keeps the call it had', predictor_save(:pr, 41, jsonb_build_array(jsonb_build_object('fixture', :fc, 'home', 1, 'away', 1),
  jsonb_build_object('fixture', :fd, 'home', 1, 'away', 2))) = 1);
reset role;
select soccer_ingest('mls', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', '7104', 'gameweek', 41, 'kickoff', now() + interval '8 days', 'status', 'PST', 'home', '502', 'away', '503'),
  jsonb_build_object('ext_id', '7103', 'gameweek', 41, 'kickoff', now() - interval '1 minute', 'status', 'FT', 'home', '504', 'away', '501', 'home_score', 0, 'away_score', 0, 'home_ft', 0, 'away_ft', 0))));
select pg_temp.expect('a called-off match is void', (select void and points = 0 from pool_predictor_picks where predictor_id = :pr and team_id = :fern and fixture_id = :fd));
select pg_temp.expect('the season''s last matchweek ends it, and the chat hears who won', (select status = 'done' and winners = array[:fern] from pool_predictors where id = :pr)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Call the score is done: Fern, 6 points over the season.'));
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'call the score', true;

-- ───────────── the injury report's timeline (migration 152) ─────────────
-- the hourly sync writes the expected return, what it is and the list; a GM reads them through the league's players,
-- and the status change still lands in the player's history
select id as inj_p from players order by id limit 1 \gset
update players set injury_status = 'Injured Reserve', injury_note = 'Placed on long-term IR.', injury_return = today_et() + 20,
  injury_part = 'Knee, left', injury_list = 'IR-LT', injury_detail = 'Expected to miss about three weeks.' where id = :inj_p;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('a GM sees when he is expected back', (select injury_return = today_et() + 20 and injury_part = 'Knee, left' and injury_list = 'IR-LT'
  and injury_detail like 'Expected%' from league_players where id = :inj_p));
select pg_temp.expect('and the listing is in his history', exists (select 1 from player_events where player_id = :inj_p and kind = 'injury' and body like 'Listed Injured Reserve%'));
reset role;
update players set injury_status = null, injury_note = null, injury_return = null, injury_part = null, injury_list = null, injury_detail = null where id = :inj_p;
select set_config('request.jwt.claim.sub', '', false);
select 'injury timeline', true;

-- ───────────── pool games: pick the series, rank the teams (migration 165) ─────────────
-- Pod Squad runs a baseball postseason: the division series are under way, the championship series and the final next.
-- Hana hosts; Fern and Hana pick; Lou forgets.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select sport_ingest('mlb-post-2026', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', '901', 'name', 'Albany Aces', 'short', 'ALB'), jsonb_build_object('ext_id', '902', 'name', 'Bristol Bats', 'short', 'BRI'),
    jsonb_build_object('ext_id', '903', 'name', 'Camden Crows', 'short', 'CAM'), jsonb_build_object('ext_id', '904', 'name', 'Dover Dogs', 'short', 'DOV'),
    jsonb_build_object('ext_id', '906', 'name', 'Fresno Foxes', 'short', 'FRE')),
  'series', jsonb_build_array(
    jsonb_build_object('ext_id', 'T_D1', 'round', 2, 'label', 'AL Division Series', 'short', 'ALDS', 'best_of', 5, 'high', '901', 'low', '902', 'starts_at', now() - interval '1 day'),
    jsonb_build_object('ext_id', 'T_D2', 'round', 2, 'label', 'AL Division Series', 'short', 'ALDS', 'best_of', 5, 'high', '903', 'low', '904', 'starts_at', now() - interval '1 day'),
    jsonb_build_object('ext_id', 'T_L1', 'round', 3, 'label', 'AL Championship Series', 'short', 'ALCS', 'best_of', 7, 'starts_at', now() + interval '2 days', 'tbd', true),
    jsonb_build_object('ext_id', 'T_W1', 'round', 4, 'label', 'World Series', 'short', 'WS', 'best_of', 7, 'starts_at', now() + interval '10 days', 'tbd', true)),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'g101', 'series', 'T_D1', 'game_no', 1, 'kickoff', now() - interval '1 day', 'state', 'final', 'home', '901', 'away', '902', 'home_score', 3, 'away_score', 1,
      'periods', jsonb_build_array(jsonb_build_object('n', 1, 'home', 2, 'away', 0), jsonb_build_object('n', 2, 'home', 1, 'away', 1))),
    jsonb_build_object('ext_id', 'g201', 'series', 'T_D2', 'game_no', 1, 'kickoff', now() - interval '1 day', 'state', 'final', 'home', '903', 'away', '904', 'home_score', 0, 'away_score', 2))));
select id as alb from clubs where sport = 'mlb' and ext_id = '901' \gset
select id as bri from clubs where sport = 'mlb' and ext_id = '902' \gset
select id as dov from clubs where sport = 'mlb' and ext_id = '904' \gset
select id as fre from clubs where sport = 'mlb' and ext_id = '906' \gset
select id as alcs from series where ext_id = 'T_L1' \gset
select id as ws from series where ext_id = 'T_W1' \gset
select pg_temp.expect('a series takes its wins and state from its games, and a game keeps its line score',
  (select high_wins = 1 and low_wins = 0 and state = 'live' from series where ext_id = 'T_D1')
  and (select count(*) from fixture_periods p join fixtures f on f.id = p.fixture_id where f.ext_id = 'g101') = 2);
select pg_temp.expect('the start page offers the event from its next round', (select (e->>'open_round')::int = 3 and e->>'pack' = 'world-series-2026'
  from jsonb_array_elements(pool_events()) e where e->>'competition' = 'mlb-post-2026'));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the host starts a game', $$select pool_game_start('series', 'mlb-post-2026')$$, 'Commissioner only');
select pg_temp.raises('or adds games to a new pool', format('select pool_start_games(%s, %L)', :lib, '[{"kind":"series","competition":"mlb-post-2026"}]'), 'Only the pool''s host');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a round already started can''t be the start', $$select pool_game_start('series', 'mlb-post-2026', '{"from_round":2}')$$, 'already started');
select pool_game_start('series', 'mlb-post-2026', '{"preset":"classic"}') as sg \gset
select pool_game_start('rank', 'mlb-post-2026') as rg \gset
select pg_temp.expect('it starts from the next round, on the preset''s points', (select (rules->>'from_round')::int = 3 and rules->'points'->>'3' = '4' and rules->'length'->>'3' = '2'
  from pool_games where id = :sg) and exists (select 1 from messages where league_id = :lib and body = '⚔️ Pick the series is on, from the Championship Series: call each series and how many games it goes. Each pick locks at its Game 1''s first pitch.'));
select pg_temp.raises('one of each kind', $$select pool_game_start('series', 'mlb-post-2026')$$, 'already runs that game');
select pg_temp.raises('a series whose clubs aren''t set waits', format('select pool_game_pick(%s, %L, %L)', :sg, 's:' || :alcs, jsonb_build_object('winner', :alb, 'games', 5)), 'isn''t set yet');
select pool_game_pick(:rg, 'rank', jsonb_build_object('order', jsonb_build_array(:dov, :alb)));
select pool_game_pick(:sg, 'tiebreak', '{"runs":7}');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:rg, 'rank', jsonb_build_object('order', jsonb_build_array(:alb, :dov, :bri)));
select pool_game_pick(:sg, 'tiebreak', '{"runs":9}');
reset role;
-- the division series end: Albany and Dover meet in the championship series, three hours from now
select sport_ingest('mlb-post-2026', jsonb_build_object(
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'T_L1', 'round', 3, 'label', 'AL Championship Series', 'short', 'ALCS', 'best_of', 7, 'high', '901', 'low', '904', 'starts_at', now() + interval '3 hours')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'g102', 'series', 'T_D1', 'game_no', 2, 'kickoff', now() - interval '20 hours', 'state', 'final', 'home', '901', 'away', '902', 'home_score', 5, 'away_score', 1),
    jsonb_build_object('ext_id', 'g103', 'series', 'T_D1', 'game_no', 3, 'kickoff', now() - interval '19 hours', 'state', 'final', 'home', '902', 'away', '901', 'home_score', 0, 'away_score', 2),
    jsonb_build_object('ext_id', 'g202', 'series', 'T_D2', 'game_no', 2, 'kickoff', now() - interval '20 hours', 'state', 'final', 'home', '903', 'away', '904', 'home_score', 1, 'away_score', 4),
    jsonb_build_object('ext_id', 'g203', 'series', 'T_D2', 'game_no', 3, 'kickoff', now() - interval '19 hours', 'state', 'final', 'home', '904', 'away', '903', 'home_score', 2, 'away_score', 3),
    jsonb_build_object('ext_id', 'g204', 'series', 'T_D2', 'game_no', 4, 'kickoff', now() - interval '18 hours', 'state', 'final', 'home', '904', 'away', '903', 'home_score', 6, 'away_score', 2),
    jsonb_build_object('ext_id', 'l1', 'series', 'T_L1', 'game_no', 1, 'kickoff', now() + interval '3 hours', 'state', 'scheduled', 'home', '901', 'away', '904'))));
select pg_temp.expect('a series is won at three of five', (select state = 'final' and winner = :alb and high_wins = 3 from series where ext_id = 'T_D1')
  and (select state = 'final' and winner = :dov and low_wins = 3 and high_wins = 1 from series where ext_id = 'T_D2'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a best-of-7 goes 4 to 7', format('select pool_game_pick(%s, %L, %L)', :sg, 's:' || :alcs, jsonb_build_object('winner', :alb, 'games', 3)), 'goes 4 to 7');
select pg_temp.raises('one of the two clubs', format('select pool_game_pick(%s, %L, %L)', :sg, 's:' || :alcs, jsonb_build_object('winner', :bri, 'games', 5)), 'one of the two');
select pool_game_pick(:sg, 's:' || :alcs, jsonb_build_object('winner', :alb, 'games', 6));
select pool_game_pick(:sg, 's:' || :alcs, jsonb_build_object('winner', :alb, 'games', 5));
select pg_temp.expect('before the first pitch she sees her own pick, nobody''s calls', (select (s->'mine'->>'games')::int = 5 and s->'calls' = 'null'::jsonb and (s->>'picked')::int = 1
  from jsonb_array_elements(pool_game_board(:sg)->'series') s where (s->>'id')::bigint = :alcs));
select pg_temp.raises('the picks themselves are not readable', 'select count(*) from pool_picks', 'permission denied');
select pg_temp.expect('the menu knows nothing is left to pick', (select (x->>'to_pick')::int = 0 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :sg));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_pick(:sg, 's:' || :alcs, jsonb_build_object('winner', :dov, 'games', 7));
reset role;
select _pool_game_nudge(:lib) as gnudged \gset
select pg_temp.expect('three hours out, the one who hasn''t picked hears it, for the series and the ranking', :gnudged = 2
  and exists (select 1 from notifications where team_id = :lou and kind = 'pool_game' and body = '⏰ The ALCS starts in 3h. Pick the winner and how many games.')
  and exists (select 1 from notifications where team_id = :lou and kind = 'pool_game' and body = '⏰ Rank the teams locks in 3h. Put the clubs in order.'));
select pg_temp.expect('and only once', _pool_game_nudge(:lib) = 0);
-- first pitch: everything on the series locks, and the calls show
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'l1', 'series', 'T_L1', 'game_no', 1, 'kickoff', now() - interval '1 hour', 'state', 'live', 'home', '901', 'away', '904', 'home_score', 1, 'away_score', 0))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a pick locks at the first pitch', format('select pool_game_pick(%s, %L, %L)', :sg, 's:' || :alcs, jsonb_build_object('winner', :dov, 'games', 4)), 'picks are locked');
select pg_temp.raises('so does the ranking', format('select pool_game_pick(%s, %L, %L)', :rg, 'rank', jsonb_build_object('order', jsonb_build_array(:dov, :alb))), 'locked');
select pg_temp.expect('once it starts everyone''s calls show', (select jsonb_array_length(s->'calls') = 2 and (s->>'locked')::boolean
  from jsonb_array_elements(pool_game_board(:sg)->'series') s where (s->>'id')::bigint = :alcs));
select pg_temp.expect('and everyone''s ranking', jsonb_array_length(pool_game_board(:rg)->'rank'->'orders') = 2);
reset role;
-- Albany take it in five
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'l1', 'series', 'T_L1', 'game_no', 1, 'kickoff', now() - interval '1 hour', 'state', 'final', 'home', '901', 'away', '904', 'home_score', 3, 'away_score', 0),
  jsonb_build_object('ext_id', 'l2', 'series', 'T_L1', 'game_no', 2, 'kickoff', now() - interval '50 minutes', 'state', 'final', 'home', '901', 'away', '904', 'home_score', 2, 'away_score', 1),
  jsonb_build_object('ext_id', 'l3', 'series', 'T_L1', 'game_no', 3, 'kickoff', now() - interval '40 minutes', 'state', 'final', 'home', '904', 'away', '901', 'home_score', 5, 'away_score', 1),
  jsonb_build_object('ext_id', 'l4', 'series', 'T_L1', 'game_no', 4, 'kickoff', now() - interval '30 minutes', 'state', 'final', 'home', '904', 'away', '901', 'home_score', 0, 'away_score', 4))));
select pg_temp.expect('three games in, nothing is settled', (select points from _pool_game_table(:sg) where team_id = :fern) = 0
  and (select possible from _pool_game_table(:sg) where team_id = :fern) = 6 + 11);
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'l5', 'series', 'T_L1', 'game_no', 5, 'kickoff', now() - interval '20 minutes', 'state', 'final', 'home', '904', 'away', '901', 'home_score', 2, 'away_score', 6))));
select pg_temp.expect('the winner and the length: 4 + 2, and she hears it', (select points from _pool_game_table(:sg) where team_id = :fern) = 6
  and (select points from _pool_game_table(:sg) where team_id = :hana) = 0
  and exists (select 1 from notifications where team_id = :fern and kind = 'pool_game' and body = '✅ You called it: Albany Aces in 5, length and all. +6'));
select pg_temp.expect('the chat hears who called it', exists (select 1 from messages where league_id = :lib and body = '🏁 Albany Aces win the ALCS in 5. 1 of 2 called it, 1 with the length.'));
select pg_temp.expect('the ranking pays each win its rank: 4 wins at 2 and 1 at 1 for Fern, the other way round for Hana',
  (select points from _pool_game_table(:rg) where team_id = :fern) = 9 and (select points from _pool_game_table(:rg) where team_id = :hana) = 6);
select pg_temp.expect('Lou, who picked nothing, can still get the final', (select points = 0 and possible = 11 from _pool_game_table(:sg) where team_id = :lou));
-- the final: Albany against Fresno; Hana has Fresno in 4, Fern Albany in 6
select sport_ingest('mlb-post-2026', jsonb_build_object(
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'T_W1', 'round', 4, 'label', 'World Series', 'short', 'WS', 'best_of', 7, 'high', '901', 'low', '906', 'starts_at', now() + interval '1 day'))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_pick(:sg, 's:' || :ws, jsonb_build_object('winner', :fre, 'games', 4));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:sg, 's:' || :ws, jsonb_build_object('winner', :alb, 'games', 6));
reset role;
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'w1', 'series', 'T_W1', 'game_no', 1, 'kickoff', now() - interval '4 hours', 'state', 'final', 'home', '901', 'away', '906', 'home_score', 1, 'away_score', 2),
  jsonb_build_object('ext_id', 'w2', 'series', 'T_W1', 'game_no', 2, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', '901', 'away', '906', 'home_score', 0, 'away_score', 3),
  jsonb_build_object('ext_id', 'w3', 'series', 'T_W1', 'game_no', 3, 'kickoff', now() - interval '2 hours', 'state', 'final', 'home', '906', 'away', '901', 'home_score', 4, 'away_score', 2),
  jsonb_build_object('ext_id', 'w4', 'series', 'T_W1', 'game_no', 4, 'kickoff', now() - interval '1 hour', 'state', 'final', 'home', '906', 'away', '901', 'home_score', 5, 'away_score', 2))));
select pg_temp.expect('a sweep in the final: 8 + 3 for Hana, and the tiebreaker is the last game''s runs', (select points = 11 and tiebreak = 0 from _pool_game_table(:sg) where team_id = :hana)
  and (select points = 6 and tiebreak = 2 from _pool_game_table(:sg) where team_id = :fern));
select pg_temp.expect('the last round ends both games and names their winners', (select status = 'done' and winners = array[:hana] from pool_games where id = :sg)
  and (select status = 'done' and winners = array[:fern] from pool_games where id = :rg)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Pick the series is done: Hana, with 11 points.')
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Rank the teams is done: Fern, with 9 points.'));
-- another league sees none of it
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t read the board', format('select pool_game_board(%s)', :sg));
select pg_temp.expect('nor list the games', pool_games_list() = '[]'::jsonb);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'pool games', true;

-- ───────────── squares (migration 167) ─────────────
-- Pod Squad puts a 5 by 5 grid on a best-of-3 (fresh digits each game, 10 coins a square, 20 each at most) and a
-- 10 by 10 grid on a one-game playoff that only Lou plays.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select sport_ingest('mlb-post-2026', jsonb_build_object('series', jsonb_build_array(
  jsonb_build_object('ext_id', 'T_X1', 'round', 4, 'label', 'Exhibition Series', 'short', 'EX', 'best_of', 3, 'high', '903', 'low', '904', 'starts_at', now() + interval '1 day'),
  jsonb_build_object('ext_id', 'T_X2', 'round', 4, 'label', 'One-Game Playoff', 'short', 'OGP', 'best_of', 1, 'high', '901', 'low', '906', 'starts_at', now() + interval '2 days'))));
select id as x1 from series where ext_id = 'T_X1' \gset
select id as x2 from series where ext_id = 'T_X2' \gset
insert into coin_ledger (team_id, amount, reason) values (:hana, 1000, 'squares test'), (:fern, 1000, 'squares test'), (:lou, 1000, 'squares test');
select _coins_free(:fern) as fern0 \gset
select _coins_free(:hana) as hana0 \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a grid is 10 or 5 squares a side', format('select pool_game_start(%L, %L, %L)', 'squares', 'mlb-post-2026', jsonb_build_object('series', :x1, 'size', 7)), 'A grid is');
select pg_temp.raises('with more than one series left in the last round, the host picks one', $$select pool_game_start('squares', 'mlb-post-2026')$$, 'Pick the series');
select pool_game_start('squares', 'mlb-post-2026', jsonb_build_object('series', :x1, 'size', 5, 'cost', 10, 'cap', 20, 'digits', 'each')) as qg \gset
select pool_game_start('squares', 'mlb-post-2026', jsonb_build_object('series', :x2, 'cost', 10)) as qg2 \gset
select pg_temp.expect('the grid takes its series'' name and the chat hears the price', (select title = 'Exhibition Series squares' and rules->>'pays' = 'innings' from pool_games where id = :qg)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 Exhibition Series squares are open: 10 coins a square, 25 squares with two digits a side.%'));
select pg_temp.raises('one grid on a series', format('select pool_game_start(%L, %L, %L)', 'squares', 'mlb-post-2026', jsonb_build_object('series', :x1)), 'already runs');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('Fern claims two squares for 20 coins', (pool_squares_claim(:qg, array['sq:0:0', 'sq:0:1'])->>'coins')::int = 20);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a square has one owner', format('select pool_squares_claim(%s, array[%L])', :qg, 'sq:0:0'), 'already');
select pg_temp.raises('and is on the grid', format('select pool_squares_claim(%s, array[%L])', :qg, 'sq:5:0'), 'No such square');
select pg_temp.expect('Hana lets the grid pick ten', jsonb_array_length(pool_squares_claim(:qg, null, 10)->'claimed') = 10);
select pg_temp.raises('up to the cap', format('select pool_squares_claim(%s, null, 11)', :qg), 'Up to 20 squares each');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('a square goes back for its coins before the draw', pool_squares_release(:qg, array['sq:0:1']) = 1);
select pg_temp.expect('the grid shows every claim and the pot, and no digits yet', (select (b->>'claimed')::int = 11 and (b->>'pot')::int = 110 and b->'draw' = 'null'::jsonb and b->>'pay_when' = 'innings'
  and not (b->>'locked')::boolean and jsonb_array_length(b->'claims') = 11 from (select pool_game_board(:qg)->'squares' b) z));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.expect('Lou has a grid waiting on him', (select (x->>'to_pick')::int = 1 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :qg));
select pg_temp.expect('Lou takes the one square on the other grid', (pool_squares_claim(:qg2, array['sq:5:5'])->>'coins')::int = 10);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('the last fourteen squares fill the grid', (pool_squares_claim(:qg, null, 14)->>'full')::boolean);
select pg_temp.raises('then the grid is closed', format('select pool_squares_claim(%s, null, 1)', :qg), 'digits are drawn');
select pg_temp.raises('and nothing goes back', format('select pool_squares_release(%s, array[%L])', :qg, 'sq:0:0'), 'digits are drawn');
reset role;
select pg_temp.expect('a full grid draws its digits at once: a set per game, each 0 to 9 once, and anyone can check them from the seed',
  (select draw->>'why' = 'full' and (draw->>'pot')::int = 250 and jsonb_array_length(draw->'sets') = 3
     and (select array_agg(v::int order by v::int) from jsonb_array_elements_text(draw->'sets'->0->'top') v) = array[0,1,2,3,4,5,6,7,8,9]
     and draw->'sets'->1->'side' = to_jsonb(_squares_digits(draw->>'seed', 2, 'side'))
   from pool_games where id = :qg)
  and exists (select 1 from messages where league_id = :lib and body like '🎲 The digits are drawn for Exhibition Series squares, the grid is full: 25 squares, a pot of 250 coins.%'));
select pg_temp.expect('the coins went in', _coins_free(:fern) = :fern0 - 150 and _coins_free(:hana) = :hana0 - 100);
-- Game 1: tied 2-2 after three, the top of the 4th under way
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'x1g1', 'series', 'T_X1', 'game_no', 1, 'kickoff', now() - interval '1 hour', 'state', 'live', 'home', '903', 'away', '904', 'home_score', 2, 'away_score', 2,
    'periods', jsonb_build_array(jsonb_build_object('n', 1, 'home', 1, 'away', 0), jsonb_build_object('n', 2, 'home', 0, 'away', 2), jsonb_build_object('n', 3, 'home', 1, 'away', 0),
      jsonb_build_object('n', 4, 'home', null, 'away', 0))))));
select pg_temp.expect('after the 3rd: 2-2 names a square and it takes 25% of the game''s third of the pot',
  (select count(*) = 1 and min(coins) = 20 and min(point) = 3 and min(top_runs) = 2 and min(side_runs) = 2 and bool_and(paid_cell = cell and team_id is not null)
   from pool_square_pays where game_id = :qg)
  and (select sum(amount) from coin_ledger where reason = 'Squares: Exhibition Series squares · Game 1, after the 3rd') = 20
  and exists (select 1 from messages where league_id = :lib and body like '🔲 Game 1, after the 3rd: CAM 2, DOV 2.%takes 20 coins.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('while it''s on, the board shows the square leading', (select g->'now'->>'cell' is not null and g->'now'->>'to' = g->'now'->>'cell'
  from jsonb_array_elements(pool_game_board(:qg)->'squares'->'games') g where (g->>'game_no')::int = 1));
reset role;
-- Camden win Game 1 5-3 and Game 2 4-1: the series ends in two, and the last final takes what the third game would have paid
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'x1g1', 'series', 'T_X1', 'game_no', 1, 'kickoff', now() - interval '1 hour', 'state', 'final', 'home', '903', 'away', '904', 'home_score', 5, 'away_score', 3,
    'periods', (select jsonb_agg(jsonb_build_object('n', i, 'home', (array[1,0,1,0,2,0,1,0,null])[i], 'away', (array[0,2,0,0,0,1,0,0,0])[i])) from generate_series(1, 9) i)))));
select pg_temp.expect('Game 1 pays its 6th and its final', (select count(*) = 3 and sum(coins) = 81 from pool_square_pays where game_id = :qg)
  and (select top_runs = 4 and side_runs = 3 from pool_square_pays where game_id = :qg and point = 6)
  and (select top_runs = 5 and side_runs = 3 and coins = 41 from pool_square_pays where game_id = :qg and point = 0));
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'x1g2', 'series', 'T_X1', 'game_no', 2, 'kickoff', now() - interval '10 minutes', 'state', 'final', 'home', '904', 'away', '903', 'home_score', 1, 'away_score', 4,
    'periods', (select jsonb_agg(jsonb_build_object('n', i, 'away', (array[0,0,2,0,0,1,1,0,0])[i], 'home', (array[0,1,0,0,0,0,0,0,0])[i])) from generate_series(1, 9) i)))));
select pg_temp.expect('the series is over in two: the whole pot is paid and the grid is done',
  (select sum(coins) = 250 and count(*) = 6 from pool_square_pays where game_id = :qg)
  and (select coins = 250 - 81 - 40 from pool_square_pays p join fixtures f on f.id = p.fixture_id where p.game_id = :qg and f.game_no = 2 and p.point = 0)
  and (select top_runs = 2 and side_runs = 1 from pool_square_pays p join fixtures f on f.id = p.fixture_id where p.game_id = :qg and f.game_no = 2 and p.point = 3)
  and (select status = 'done' and cardinality(winners) >= 1 from pool_games where id = :qg)
  and exists (select 1 from messages where league_id = :lib and body like '🏆 Exhibition Series squares are done:%'));
select pg_temp.expect('every coin in came back out, and the table counts them', (select sum(amount) from coin_ledger where reason like 'Squares%Exhibition Series squares%') = 0
  and (select sum(points) from _pool_game_table(:qg)) = 250);
-- the one-game playoff: the first pitch draws Lou's grid; whatever squares the score names, his is the only claimed one
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'x2g1', 'series', 'T_X2', 'game_no', 1, 'kickoff', now() - interval '1 minute', 'state', 'live', 'home', '901', 'away', '906', 'home_score', 0, 'away_score', 0))));
select pg_temp.expect('the first pitch draws a grid that isn''t full', (select draw->>'why' = 'first pitch' and (draw->>'pot')::int = 10 and jsonb_array_length(draw->'sets') = 1 from pool_games where id = :qg2));
select sport_ingest('mlb-post-2026', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'x2g1', 'series', 'T_X2', 'game_no', 1, 'kickoff', now() - interval '1 minute', 'state', 'final', 'home', '901', 'away', '906', 'home_score', 7, 'away_score', 3,
    'periods', (select jsonb_agg(jsonb_build_object('n', i, 'home', (array[3,0,0,1,0,2,0,1,null])[i], 'away', (array[0,1,0,0,2,0,0,0,0])[i])) from generate_series(1, 9) i)))));
select pg_temp.expect('an empty square passes its coins along to the next claimed one: Lou takes 2, 2 and the last 6',
  (select array_agg(coins order by case when point = 0 then 99 else point end) = array[2, 2, 6] and bool_and(team_id = :lou and paid_cell = 'sq:5:5')
   from pool_square_pays where game_id = :qg2)
  and (select status = 'done' and winners = array[:lou] from pool_games where id = :qg2));
-- another league can't touch it
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t claim a square', format('select pool_squares_claim(%s, array[%L])', :qg2, 'sq:0:0'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'squares', true;

-- ───────────── the pool scoreboard (migration 169) ─────────────
-- Pod Squad now runs the questions, two sports games, two grids, last one standing and call the score: one table
-- reads them all.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_scoreboard() as sb \gset
select pg_temp.expect('every game the pool runs is on the scoreboard, each with every member',
  (select count(*) from jsonb_array_elements(:'sb'::jsonb->'games')) = 7
  and (select bool_and(jsonb_array_length(g->'rows') = (select count(*) from teams where league_id = :lib and role = 'gm')) from jsonb_array_elements(:'sb'::jsonb->'games') g)
  and (select array_agg(g->>'key' order by g->>'key') from jsonb_array_elements(:'sb'::jsonb->'games') g)
      = (select array_agg(k order by k) from unnest(array['questions', 'game:' || :sg, 'game:' || :rg, 'game:' || :qg, 'game:' || :qg2, 'survivor:' || :sv, 'predictor:' || :pr]) k));
select pg_temp.expect('the main game comes first and is marked', (select g->>'key' = :'sb'::jsonb->>'crown' and (g->>'crown')::boolean from jsonb_array_elements(:'sb'::jsonb->'games') with ordinality x(g, i) where i = 1));
select pg_temp.expect('a sports game ranks by its own table: Hana''s 11 tops Fern''s 6, and Fern sees her place',
  (select (r->>'rank')::int = 1 and (r->>'score')::int = 11 from jsonb_array_elements(:'sb'::jsonb->'games') g, jsonb_array_elements(g->'rows') r where g->>'key' = 'game:' || :sg and (r->>'team_id')::int = :hana)
  and (select (g->'mine'->>'rank')::int = 2 and (g->'mine'->>'behind')::int = 5 from jsonb_array_elements(:'sb'::jsonb->'games') g where g->>'key' = 'game:' || :sg));
select pg_temp.expect('last one standing ranks its winner first, then whoever lasted longest', (select (r->>'team_id')::int = :fern and (r->>'alive')::boolean and r->>'line' = 'Won it'
  from jsonb_array_elements(:'sb'::jsonb->'games') g, jsonb_array_elements(g->'rows') r where g->>'key' = 'survivor:' || :sv and (r->>'rank')::int = 1)
  and (select (r->>'rank')::int = 2 and r->>'line' = 'Out in matchweek 31' from jsonb_array_elements(:'sb'::jsonb->'games') g, jsonb_array_elements(g->'rows') r where g->>'key' = 'survivor:' || :sv and (r->>'team_id')::int = :hana));
select pg_temp.expect('a grid has no "still possible"', (select bool_and(r->'possible' = 'null'::jsonb) from jsonb_array_elements(:'sb'::jsonb->'games') g, jsonb_array_elements(g->'rows') r where g->>'key' = 'game:' || :qg));
select pg_temp.raises('only the host names the main game', format('select pool_set_crown(%L)', 'game:' || :rg), 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('and only one the pool runs', $$select pool_set_crown('game:999999')$$, 'doesn''t run that game');
select pg_temp.expect('the host names it', pool_set_crown('game:' || :rg) = 'game:' || :rg);
select pg_temp.expect('and it leads the scoreboard', pool_scoreboard()->'games'->0->>'key' = 'game:' || :rg);
select pg_temp.expect('and can hand it back to the default', pool_set_crown(null) is not null);
select pg_temp.expect('which clears the choice', (select crown from league_rules where league_id = :lib) is null);
reset role;
-- the hourly look: the first records where everyone stands and tells nobody. The pool job above has already looked
-- (sections 145 and 154), and the squares' coins have moved everyone's net worth since by a random draw, so start this
-- pool's standings afresh to make this the first look
delete from pool_standing where league_id = :lib;
select _pool_mark() as mark1 \gset
select pg_temp.expect('the first look records every member in every game and alerts nobody', :mark1 = 0
  and (select count(*) from pool_standing where league_id = :lib) = 7 * (select count(*) from teams where league_id = :lib and role = 'gm'));
-- pretend the series game is still on, with Fern fifth and Hana second at the last look
update pool_games set status = 'open' where id = :sg;
update pool_standing set rank = 5, day_rank = 5 where league_id = :lib and game = 'game:' || :sg and team_id = :fern;
update pool_standing set rank = 2, day_rank = 2 where league_id = :lib and game = 'game:' || :sg and team_id = :hana;
select _pool_mark() as mark2 \gset
select pg_temp.expect('climbing three places, or into first, is news', :mark2 = 2
  and exists (select 1 from notifications where team_id = :fern and kind = 'pool_rank' and body = '📈 Up 3 places to 2nd in Pick the series.' and link = '/picks?g=' || :sg)
  and exists (select 1 from notifications where team_id = :hana and kind = 'pool_rank' and body = '👑 You''re top of Pick the series.'));
update pool_standing set rank = 5 where league_id = :lib and game = 'game:' || :sg and team_id = :fern;
select pg_temp.expect('once a game a day', _pool_mark() = 0);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('the arrows count from where the day began: Fern is up 3', (select (g->'mine'->>'move')::int = 3 from jsonb_array_elements(pool_scoreboard()->'games') g where g->>'key' = 'game:' || :sg));
reset role;
-- a new day starts the arrows again from the last look
update pool_standing set day = day - 1 where league_id = :lib and game = 'game:' || :sg and team_id = :fern;
select _pool_mark();
select pg_temp.expect('a new day: yesterday''s last place is today''s start', (select day_rank = 2 and rank = 2 and day = today_et() from pool_standing where league_id = :lib and game = 'game:' || :sg and team_id = :fern));
update pool_games set status = 'done' where id = :sg;
-- another league sees none of it, and a fantasy league has no standings to keep
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('another league''s scoreboard has none of Pod Squad''s games', not exists (select 1 from jsonb_array_elements(pool_scoreboard()->'games') g where g->>'key' like 'game:%' or g->>'key' like 'survivor:%'));
select pg_temp.raises('nor reads the standings', 'select count(*) from pool_standing', 'permission denied');
reset role;
select set_config('app.league_id', '1', false);
select pg_temp.expect('a fantasy league keeps no standings', _pool_mark() = 0);
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'pool scoreboard', true;

-- ───────────── weekly pick'em (migration 170) ─────────────
-- Pod Squad runs a Confidence pick'em on the Test Cup's matchweeks 5 and 6 (matchweek 4 is played): Fern, Hana and Lou
-- pick; a sport with no draws refuses one.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-test', 'soccer', 'Test Cup', 'TC', '2026', 'api-football', 'pk', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-test', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'pk1', 'name', 'Pine FC', 'short', 'PIN'), jsonb_build_object('ext_id', 'pk2', 'name', 'Quay FC', 'short', 'QUA'),
    jsonb_build_object('ext_id', 'pk3', 'name', 'Rook FC', 'short', 'ROO'), jsonb_build_object('ext_id', 'pk4', 'name', 'Sand FC', 'short', 'SAN')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'pk-40', 'gameweek', 4, 'kickoff', now() - interval '3 days', 'status', 'FT', 'home', 'pk1', 'away', 'pk4', 'home_score', 1, 'away_score', 0, 'home_ft', 1, 'away_ft', 0),
    jsonb_build_object('ext_id', 'pk-51', 'gameweek', 5, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'pk1', 'away', 'pk2'),
    jsonb_build_object('ext_id', 'pk-52', 'gameweek', 5, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'pk3', 'away', 'pk4'),
    jsonb_build_object('ext_id', 'pk-61', 'gameweek', 6, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'pk1', 'away', 'pk3'),
    jsonb_build_object('ext_id', 'pk-62', 'gameweek', 6, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'pk2', 'away', 'pk4'))));
select id as m51 from fixtures where ext_id = 'pk-51' \gset
select id as m52 from fixtures where ext_id = 'pk-52' \gset
select id as m61 from fixtures where ext_id = 'pk-61' \gset
select id as m62 from fixtures where ext_id = 'pk-62' \gset
select pg_temp.expect('the start page offers pick''em and last one standing on a competition with rounds, from its next one; the old list is unchanged',
  (select e->'kinds' = '["pickem", "survivor", "streak"]'::jsonb and (e->>'open_round')::int = 5 and e->>'open_label' = 'Matchweek 5' and e->>'stage' = 'Matchweek 5 next'
   from jsonb_array_elements(pool_event_list()) e where e->>'competition' = 'pk-test')
  and not exists (select 1 from jsonb_array_elements(pool_events()) e where e->>'competition' = 'pk-test'));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a round already played can''t be the start', $$select pool_game_start('pickem', 'pk-test', '{"from_round":4}')$$, 'That round is over');
select pg_temp.raises('Classic or Confidence', $$select pool_game_start('pickem', 'pk-test', '{"preset":"spread"}')$$, 'Classic or Confidence');
select pool_game_start('pickem', 'pk-test', '{"preset":"confidence"}') as pk \gset
select pg_temp.expect('it runs from the next round to the last, with draws, named for its competition',
  (select title = 'Test Cup pick''em' and rules->>'preset' = 'confidence' and (rules->>'from_round')::int = 5 and (rules->>'to_round')::int = 6
     and (rules->>'draws')::boolean from pool_games where id = :pk)
  and exists (select 1 from messages where league_id = :lib and body like '✅ Test Cup pick''em is on from Matchweek 5: pick the winner of every match, or a draw. Each pick locks at its kick-off.%'));
select pg_temp.raises('one pick''em on a competition', $$select pool_game_start('pickem', 'pk-test')$$, 'already runs that game');
select pool_pickem_save(:pk, 5, jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'H', 'conf', 1), jsonb_build_object('fixture', :m52, 'pick', 'A', 'conf', 2)));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('each confidence number once a round', format('select pool_pickem_save(%s, 5, %L)', :pk,
  jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'H', 'conf', 2), jsonb_build_object('fixture', :m52, 'pick', 'D', 'conf', 2))), 'once a round');
select pg_temp.raises('from 1 to the round''s matches', format('select pool_pickem_save(%s, 5, %L)', :pk, jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'H', 'conf', 3))), 'from 1 to 2');
select pg_temp.raises('a match in the round', format('select pool_pickem_save(%s, 5, %L)', :pk, jsonb_build_array(jsonb_build_object('fixture', :m61, 'pick', 'H', 'conf', 1))), 'isn''t in this round');
select pg_temp.expect('Fern picks the round', pool_pickem_save(:pk, 5, jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'H', 'conf', 2), jsonb_build_object('fixture', :m52, 'pick', 'D', 'conf', 1))) = 2);
select pg_temp.expect('before kick-off she sees her own picks and nobody''s calls',
  (select (f->'mine'->>'pick') = 'H' and (f->'mine'->>'conf')::int = 2 and f->'split' = 'null'::jsonb and f->'calls' = 'null'::jsonb and (f->>'picked')::int = 2
   from jsonb_array_elements(pool_game_board(:pk)->'pickem'->'fixtures') f where (f->>'id')::bigint = :m51)
  and (pool_game_board(:pk)->'pickem'->>'round')::int = 5 and (pool_game_board(:pk)->'pickem'->>'word') = 'Matchweek');
select pg_temp.raises('the picks themselves are not readable', 'select count(*) from pool_picks', 'permission denied');
select pg_temp.expect('nothing left to pick this round', (select (x->>'to_pick')::int = 0 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :pk));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.expect('Lou has two to pick', (select (x->>'to_pick')::int = 2 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :pk));
select pool_pickem_save(:pk, 5, jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'A', 'conf', 2), jsonb_build_object('fixture', :m52, 'pick', 'H', 'conf', 1)));
reset role;
select pg_temp.expect('before a ball is kicked, Fern can reach 2 + 1 this round and 2 + 1 the next', (select points = 0 and possible = 6 and picked = 2 from _pool_game_table(:pk) where team_id = :fern));
-- matchweek 5: Pine beat Quay 2-0, Rook and Sand draw 1-1
select soccer_ingest('pk-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'pk-51', 'gameweek', 5, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'pk1', 'away', 'pk2', 'home_score', 2, 'away_score', 0, 'home_ft', 2, 'away_ft', 0),
  jsonb_build_object('ext_id', 'pk-52', 'gameweek', 5, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'pk3', 'away', 'pk4', 'home_score', 1, 'away_score', 1, 'home_ft', 1, 'away_ft', 1))));
select pg_temp.expect('a right pick earns its confidence: Fern 2 + 1, Hana 1, Lou none',
  (select points = 3 and right_calls = 2 from _pool_game_table(:pk) where team_id = :fern)
  and (select points = 1 and right_calls = 1 from _pool_game_table(:pk) where team_id = :hana)
  and (select points = 0 from _pool_game_table(:pk) where team_id = :lou));
select pg_temp.expect('the round''s end is news: the chat hears the best of the week, and each picker their own round',
  exists (select 1 from messages where league_id = :lib and body = '✅ Matchweek 5 is done in Test Cup pick''em. Top of the matchweek: Fern with 3 points. Leading: Fern on 3.')
  and exists (select 1 from notifications where team_id = :fern and kind = 'pool_game' and body = '🏅 You won Matchweek 5 in Test Cup pick''em: 2 of 2 right, 3 points.')
  and exists (select 1 from notifications where team_id = :lou and kind = 'pool_game' and body = '✅ Matchweek 5 in Test Cup pick''em: 0 of 2 right, 0 points.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('a played match locks, and shows the pool''s split', pool_pickem_save(:pk, 5, jsonb_build_array(jsonb_build_object('fixture', :m51, 'pick', 'A', 'conf', 2))) = 0
  and (select f->'mine'->>'pick' = 'H' and f->'split' = '{"A": 1, "D": 0, "H": 2}'::jsonb and jsonb_array_length(f->'calls') = 3 and f->>'result' = 'H'
       from jsonb_array_elements(pool_pickem_board(:pk, 5)->'fixtures') f where (f->>'id')::bigint = :m51));
select pool_pickem_save(:pk, 6, jsonb_build_array(jsonb_build_object('fixture', :m61, 'pick', 'H', 'conf', 2), jsonb_build_object('fixture', :m62, 'pick', 'A', 'conf', 1)));
reset role;
-- matchweek 6: Pine v Rook is postponed, Sand win at Quay
select soccer_ingest('pk-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'pk-61', 'gameweek', 6, 'kickoff', now() + interval '8 days', 'status', 'PST', 'home', 'pk1', 'away', 'pk3'),
  jsonb_build_object('ext_id', 'pk-62', 'gameweek', 6, 'kickoff', now() + interval '8 days', 'status', 'FT', 'home', 'pk2', 'away', 'pk4', 'home_score', 0, 'away_score', 1, 'home_ft', 0, 'away_ft', 1))));
select pg_temp.expect('a postponed match counts for nobody, and the last round ends the game with its winner',
  (select points = 4 and possible = 4 from _pool_game_table(:pk) where team_id = :fern)
  and (select status = 'done' and winners = array[:fern] from pool_games where id = :pk)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Test Cup pick''em is done: Fern, with 4 points.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('the scoreboard reads it like any other game', (select (r->>'rank')::int = 1 and r->>'line' = '3 right from 4 picked'
  from jsonb_array_elements(pool_scoreboard()->'games') g, jsonb_array_elements(g->'rows') r where g->>'key' = 'game:' || :pk and (r->>'team_id')::int = :fern));
select pg_temp.raises('and nothing more is picked once it is done', format('select pool_pickem_save(%s, 6, %L)', :pk, '[]'), 'That one is over');
reset role;
-- a sport with no draws: a no-draw competition refuses one
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-nodraw', 'mlb', 'Test Bowl', 'TB', '2026', 'mlb-statsapi', 'pkn', '2026', true) on conflict (id) do nothing;
insert into fixtures (sport, competition, provider, ext_id, season, gameweek, kickoff, date, home_club, away_club, state)
values ('mlb', 'pk-nodraw', 'mlb-statsapi', 'pkn-1', '2026', 1, now() + interval '2 days', (now() + interval '2 days')::date, :alb, :bri, 'scheduled');
select id as nd1 from fixtures where ext_id = 'pkn-1' \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-nodraw') as pk2 \gset
select pg_temp.expect('a sport with no draws says so, and Classic needs no numbers', (select not (rules->>'draws')::boolean and rules->>'preset' = 'classic' from pool_games where id = :pk2)
  and exists (select 1 from messages where league_id = :lib and body = '✅ Test Bowl pick''em is on from Round 1: pick the winner of every match. Each pick locks at its first pitch.'));
select pg_temp.raises('no draw to pick', format('select pool_pickem_save(%s, 1, %L)', :pk2, jsonb_build_array(jsonb_build_object('fixture', :nd1, 'pick', 'D'))), 'no draws');
select pg_temp.expect('a pick and taking it back', pool_pickem_save(:pk2, 1, jsonb_build_array(jsonb_build_object('fixture', :nd1, 'pick', 'H'))) = 1
  and pool_pickem_save(:pk2, 1, jsonb_build_array(jsonb_build_object('fixture', :nd1, 'pick', null))) = 0);
reset role;
select pg_temp.expect('which leaves nothing picked', (select picked = 0 from _pool_game_table(:pk2) where team_id = :hana));
-- another league sees none of it
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t read the round', format('select pool_pickem_board(%s, 5)', :pk));
select pg_temp.raises('nor pick in it', format('select pool_pickem_save(%s, 1, %L)', :pk2, '[]'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'pick''em', true;

-- ───────────── the NFL on ESPN (migration 171) ─────────────
-- the sport and its season are in, with no draws and its rounds called Weeks; a pick'em on it reads the same way
select pg_temp.expect('the NFL has its row and its season on ESPN', (select not (config->>'draws')::boolean and config->'words'->>'round' = 'Week'
     and _sport_state('nfl', 'FT') = 'final' and _sport_state('nfl', 'NS') = 'scheduled' and _sport_state('nfl', 'PST') = 'postponed' from sports where id = 'nfl')
  and (select provider = 'espn' and ext_id = 'football/nfl' and active from competitions where id = 'nfl')
  and _round_word('nfl') = 'Week');
select 'nfl', true;

-- ───────────── the host's desk (migration 172) ─────────────
-- Hana runs a pick'em on the Desk Cup: she changes its rules before the first lock, enters Lou's picks when he asks,
-- and settles a match the feed left hanging.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-desk', 'soccer', 'Desk Cup', 'DC', '2026', 'api-football', 'pkd', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-desk', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'dk-11', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'pk1', 'away', 'pk2', 'home_club', jsonb_build_object('ext_id', 'pk1'), 'away_club', jsonb_build_object('ext_id', 'pk2')),
  jsonb_build_object('ext_id', 'dk-12', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'pk3', 'away', 'pk4', 'home_club', jsonb_build_object('ext_id', 'pk3'), 'away_club', jsonb_build_object('ext_id', 'pk4')),
  jsonb_build_object('ext_id', 'dk-21', 'gameweek', 2, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'pk1', 'away', 'pk3', 'home_club', jsonb_build_object('ext_id', 'pk1'), 'away_club', jsonb_build_object('ext_id', 'pk3')))));
select id as d11 from fixtures where ext_id = 'dk-11' \gset
select id as d12 from fixtures where ext_id = 'dk-12' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-desk') as dk \gset
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the host changes the rules', format('select pool_game_set_rules(%s, %L)', :dk, '{"preset":"confidence"}'), 'Commissioner only');
select pg_temp.raises('or picks for someone', format('select pool_host_pick(%s, %s, %L)', :dk, :lou, '{}'), 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('before anyone picks, the host switches the scoring and shortens it to one round',
  pool_game_set_rules(:dk, '{"preset":"confidence"}')->>'preset' = 'confidence'
  and (pool_game_set_rules(:dk, '{"to_round":1}')->>'to_round')::int = 1);
select pg_temp.expect('where it starts stays put', (select (rules->>'from_round')::int = 1 and rules->>'preset' = 'confidence' from pool_games where id = :dk)
  and exists (select 1 from messages where league_id = :lib and body = '📝 The host changed the rules of Desk Cup pick''em before the first lock.'));
select pg_temp.expect('the host enters Lou''s round when he asks', (pool_host_pick(:dk, :lou, jsonb_build_object('round', 1, 'picks',
  jsonb_build_array(jsonb_build_object('fixture', :d11, 'pick', 'H', 'conf', 2), jsonb_build_object('fixture', :d12, 'pick', 'A', 'conf', 1)))))::int = 2);
select pg_temp.raises('only for a player in the pool', format('select pool_host_pick(%s, 2, %L)', :dk, jsonb_build_object('round', 1, 'picks', '[]'::jsonb)), 'player in this pool');
select pg_temp.raises('once picks are in, the scoring stays', format('select pool_game_set_rules(%s, %L)', :dk, '{"preset":"classic"}'), 'Picks are in');
reset role;
select pg_temp.expect('Lou hears it, and the log keeps it', exists (select 1 from notifications where team_id = :lou and body = '📝 The host entered a pick for you in Desk Cup pick''em.')
  and exists (select 1 from commish_log where league_id = :lib and action = 'pool_host_pick')
  and exists (select 1 from commish_log where league_id = :lib and action = 'pool_game_set_rules'));
-- the first match kicks off, and the feed stalls at half-time
select soccer_ingest('pk-desk', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'dk-11', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'HT', 'home', 'pk1', 'away', 'pk2', 'home_score', 2, 'away_score', 0))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('after the first lock the rules are frozen', format('select pool_game_set_rules(%s, %L)', :dk, '{"to_round":2}'), 'froze at the first lock');
select pg_temp.raises('a match is settled by hand only once it has kicked off', format('select pool_result_set(%s, %s, %L, %L)', :dk, :d12, 'A', 'early'), 'hasn''t kicked off');
select pg_temp.raises('and with the reason', format('select pool_result_set(%s, %s, %L, %L)', :dk, :d11, 'H', ''), 'Say why');
select pg_temp.expect('the host settles the stalled match for this pool', pool_result_set(:dk, :d11, 'h', 'The feed stuck at half-time; Pine won 2-0') = 'H');
select pg_temp.expect('the board shows the result and why', (select f->>'result' = 'H' and f->'host'->>'reason' = 'The feed stuck at half-time; Pine won 2-0' and (f->>'locked')::boolean
  from jsonb_array_elements(pool_pickem_board(:dk, 1)->'fixtures') f where (f->>'id')::bigint = :d11));
reset role;
select pg_temp.expect('the shared match stays as the feed has it', (select state = 'live' from fixtures where id = :d11)
  and (select points = 2 from _pool_game_table(:dk) where team_id = :lou));
-- the other match ends on the feed: the round, and the game, are over
select soccer_ingest('pk-desk', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'dk-12', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'pk3', 'away', 'pk4', 'home_score', 0, 'away_score', 1, 'home_ft', 0, 'away_ft', 1))));
select pg_temp.expect('the round counts the host''s result with the feed''s: Lou 2 + 1, and wins it', (select points = 3 from _pool_game_table(:dk) where team_id = :lou)
  and (select status = 'done' and winners = array[:lou] from pool_games where id = :dk)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Desk Cup pick''em is done: Lou, with 3 points.'));
-- another league can't touch it
select set_config('app.league_id', '', false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('another league''s host can''t settle a match here', format('select pool_result_set(%s, %s, %L, %L)', :dk, :d11, 'A', 'nope'));
select pg_temp.expect('nor read this pool''s results', (select count(*) from pool_result_overrides where fixture_id = :d11) = 0);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'host desk', true;

-- ───────────── last one standing on the NFL (migration 173) ─────────────
-- Hana starts one on two NFL weeks from the engine's door and picks Lou's team when he asks; a tie puts Lou out; Fern
-- and Hana are both still in when the last week is done, so they share it.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'nf1', 'name', 'Kansas City', 'short', 'KC'), jsonb_build_object('ext_id', 'nf2', 'name', 'Buffalo', 'short', 'BUF'),
    jsonb_build_object('ext_id', 'nf3', 'name', 'Detroit', 'short', 'DET'), jsonb_build_object('ext_id', 'nf4', 'name', 'Philadelphia', 'short', 'PHI')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'nfl-71', 'gameweek', 7, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'),
    jsonb_build_object('ext_id', 'nfl-72', 'gameweek', 7, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'nf3', 'away', 'nf4'),
    jsonb_build_object('ext_id', 'nfl-81', 'gameweek', 8, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'nf1', 'away', 'nf4'),
    jsonb_build_object('ext_id', 'nfl-82', 'gameweek', 8, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'nf2', 'away', 'nf3'),
    jsonb_build_object('ext_id', 'nfl-91', 'gameweek', 9, 'kickoff', now() + interval '15 days', 'status', 'NS', 'home', 'nf1', 'away', 'nf3'))));
select id as kc from clubs where ext_id = 'nf1' \gset
select id as buf from clubs where ext_id = 'nf2' \gset
select id as det from clubs where ext_id = 'nf3' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers last one standing on the NFL, in weeks and teams', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'nfl' and e->'kinds' ? 'survivor' and e->'kinds' ? 'pickem' and e->>'word' = 'Week' and e->>'club_word' = 'team' and (e->>'open_round')::int = 7));
select pg_temp.raises('a round with nothing left to kick off can''t start it', $$select pool_game_start('survivor', 'mls', '{"from_round": 31}')$$, 'under way');
select pool_game_start('survivor', 'nfl', '{"to_round": 8}') as nsv \gset
select pg_temp.expect('it runs weeks 7 to 8, and the chat hears it in the sport''s words', (select start_gw = 7 and end_gw = 8 from pool_survivors where id = :nsv)
  and exists (select 1 from messages where league_id = :lib and body = '🛡️ Last one standing starts in week 7 of the NFL: pick one team to win each week, never the same team twice. A loss or a tie and you''re out. It runs to week 8; whoever is still in then shares it.'));
select pg_temp.expect('the board speaks the sport', (select b->>'word' = 'Week' and b->>'club_word' = 'team' and b->>'match_word' = 'game' and (b->>'draws')::boolean = false
  and (b->>'end_gw')::int = 8 and (b->>'gameweek')::int = 7 and jsonb_array_length(b->'fixtures') = 2 from survivor_board(:nsv) b));
select survivor_pick(:nsv, :buf);
select pg_temp.expect('the host picks Lou''s team when he asks', survivor_host_pick(:nsv, :lou, :det) = 7);
select pg_temp.raises('only for a player in the pool', format('select survivor_host_pick(%s, 2, %s)', :nsv, :det));
reset role;
select pg_temp.expect('and he hears it', exists (select 1 from notifications where team_id = :lou and kind = 'survivor' and body = '📝 The host picked Detroit for you in week 7 of Last one standing.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('a member can''t pick for someone else', format('select survivor_host_pick(%s, %s, %s)', :nsv, :lou, :kc), 'Commissioner only');
select survivor_pick(:nsv, :det);
reset role;
-- week 7: Buffalo and Detroit win; anyone else in the pool made no pick and is out
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-71', 'gameweek', 7, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'nf1', 'away', 'nf2', 'home_score', 20, 'away_score', 27, 'home_ft', 20, 'away_ft', 27),
  jsonb_build_object('ext_id', 'nfl-72', 'gameweek', 7, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'nf3', 'away', 'nf4', 'home_score', 31, 'away_score', 17, 'home_ft', 31, 'away_ft', 17))));
select pg_temp.expect('three through, so it goes on; a missed week reads in weeks', (select status = 'open' from pool_survivors where id = :nsv)
  and (select count(*) from pool_survivor_picks where survivor_id = :nsv and result = 'through') = 3
  and (not exists (select 1 from pool_survivor_picks where survivor_id = :nsv and result = 'missed')
       or exists (select 1 from notifications where kind = 'survivor' and body = '💥 Out: no pick in week 7.')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a team once', format('select survivor_pick(%s, %s)', :nsv, :buf), 'used that team already');
select survivor_pick(:nsv, :kc);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select survivor_pick(:nsv, :kc);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select survivor_pick(:nsv, :buf);
reset role;
-- week 8, the last: Kansas City win, Buffalo and Detroit tie
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-81', 'gameweek', 8, 'kickoff', now() + interval '8 days', 'status', 'FT', 'home', 'nf1', 'away', 'nf4', 'home_score', 30, 'away_score', 10, 'home_ft', 30, 'away_ft', 10),
  jsonb_build_object('ext_id', 'nfl-82', 'gameweek', 8, 'kickoff', now() + interval '8 days', 'status', 'FT', 'home', 'nf2', 'away', 'nf3', 'home_score', 20, 'away_score', 20, 'home_ft', 20, 'away_ft', 20))));
select pg_temp.expect('a tie is out', (select result from pool_survivor_picks where survivor_id = :nsv and team_id = :lou and gameweek = 8) = 'out'
  and exists (select 1 from notifications where team_id = :lou and kind = 'survivor' and body = '💥 Out: Buffalo didn''t beat Detroit (20-20).'));
select pg_temp.expect('the last week done, the two still in share it', (select status = 'done' and winners @> array[:fern, :hana] and cardinality(winners) = 2 from pool_survivors where id = :nsv)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 Last one standing: Fern and Hana. Still in after week 8, they share it.'));
select pg_temp.expect('the pool''s table reads it in weeks', (select line = 'Out in week 8' from _pool_rows() where game = 'survivor:' || :nsv and team_id = :lou)
  and (select bool_and(alive) from _pool_rows() where game = 'survivor:' || :nsv and team_id in (:fern, :hana)));
-- another league can't touch it
select set_config('app.league_id', '', false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('another league''s host can''t pick in it', format('select survivor_host_pick(%s, %s, %s)', :nsv, :lou, :kc));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'survivor on rounds', true;

-- ───────────── the crowd in the prediction log (migration 174) ─────────────
-- Pod Squad picks a round of the Crowd Cup: all three back Ashford, two of three back Chelmsford away, and the third
-- match splits three ways (no favourite, left out). Chelmsford's match goes live and the host settles it by hand; the
-- feed finishes the rest.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-crowd', 'soccer', 'Crowd Cup', 'CC', '2026', 'api-football', 'pkc', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-crowd', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'cc1', 'name', 'Ashford', 'short', 'ASH'), jsonb_build_object('ext_id', 'cc2', 'name', 'Bexley', 'short', 'BEX'),
    jsonb_build_object('ext_id', 'cc3', 'name', 'Croydon', 'short', 'CRO'), jsonb_build_object('ext_id', 'cc4', 'name', 'Chelmsford', 'short', 'CHE'),
    jsonb_build_object('ext_id', 'cc5', 'name', 'Epsom', 'short', 'EPS'), jsonb_build_object('ext_id', 'cc6', 'name', 'Fulham Vale', 'short', 'FUL')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'cr-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'cc1', 'away', 'cc2'),
    jsonb_build_object('ext_id', 'cr-2', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'cc3', 'away', 'cc4'),
    jsonb_build_object('ext_id', 'cr-3', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'cc5', 'away', 'cc6'))));
select id as cr1 from fixtures where ext_id = 'cr-1' \gset
select id as cr2 from fixtures where ext_id = 'cr-2' \gset
select id as cr3 from fixtures where ext_id = 'cr-3' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-crowd') as crg \gset
select pool_pickem_save(:crg, 1, jsonb_build_array(jsonb_build_object('fixture', :cr1, 'pick', 'H'), jsonb_build_object('fixture', :cr2, 'pick', 'H'), jsonb_build_object('fixture', :cr3, 'pick', 'H')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_pickem_save(:crg, 1, jsonb_build_array(jsonb_build_object('fixture', :cr1, 'pick', 'H'), jsonb_build_object('fixture', :cr2, 'pick', 'A'), jsonb_build_object('fixture', :cr3, 'pick', 'D')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pool_pickem_save(:crg, 1, jsonb_build_array(jsonb_build_object('fixture', :cr1, 'pick', 'H'), jsonb_build_object('fixture', :cr2, 'pick', 'A'), jsonb_build_object('fixture', :cr3, 'pick', 'A')));
reset role;
select pg_temp.expect('nothing is written before kick-off', not exists (select 1 from predictions where kind = 'pool_split' and (subject->>'game')::bigint = :crg));
select soccer_ingest('pk-crowd', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'cr-2', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', '1H', 'home', 'cc3', 'away', 'cc4'))));
select pg_temp.expect('at kick-off the pool''s split is a forecast: Chelmsford away, two in three',
  (select predicted = 0.667 and basis = 'soccer' and status = 'open' and league_id = :lib and detail->>'fav' = 'A' and (detail->>'picks')::int = 3
   from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr2)));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_result_set(:crg, :cr2, 'A', 'The feed froze at half-time');
reset role;
select pg_temp.expect('the host''s result scores it: the favourite was right', (select status = 'scored' and outcome = 1 and error = 0.333
  from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr2)));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_result_set(:crg, :cr2, null, null);
reset role;
select pg_temp.expect('handed back to the feed, it waits again', (select status = 'open' and outcome is null
  from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr2)));
select soccer_ingest('pk-crowd', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'cr-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'cc1', 'away', 'cc2', 'home_score', 2, 'away_score', 0, 'home_ft', 2, 'away_ft', 0),
  jsonb_build_object('ext_id', 'cr-2', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'cc3', 'away', 'cc4', 'home_score', 1, 'away_score', 1, 'home_ft', 1, 'away_ft', 1),
  jsonb_build_object('ext_id', 'cr-3', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'cc5', 'away', 'cc6', 'home_score', 0, 'away_score', 3, 'home_ft', 0, 'away_ft', 3))));
select pg_temp.expect('the feed scores the rest: a unanimous favourite right, a draw beats an away favourite, a three-way split left out',
  (select status = 'scored' and predicted = 1 and outcome = 1 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr1))
  and (select status = 'scored' and outcome = 0 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr2))
  and not exists (select 1 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :crg, 'fixture', :cr3)));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('a member reads how good the pool''s consensus is, by sport and split',
  (select sum(n) = (select count(*) from predictions where kind = 'pool_split' and status = 'scored') and bool_and(sport = 'soccer') from crowd_calibration())
  and (select n = 1 and said = 1 and right_share = 1 from crowd_calibration() where bucket = 0.9));
reset role;
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('another league reads none of it', not exists (select 1 from crowd_calibration())
  and not exists (select 1 from predictions where kind = 'pool_split'));
reset role;
select count(*) as crowd_n from predictions where kind = 'pool_split' and status = 'scored' \gset
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('a platform admin reads every pool''s crowd', (select sum(n) from crowd_calibration()) = :crowd_n and :crowd_n >= 2);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'crowd', true;

-- ───────────── chances to win (migration 175) ─────────────
-- A one-round pick'em on the Odds Cup: Hana and Fern pick both matches, Lou picks neither; the first match goes Hana's
-- and Fern's way, so Lou can only guess his way to a share of it.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-odds', 'soccer', 'Odds Cup', 'OC', '2026', 'api-football', 'pko', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-odds', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'oc1', 'name', 'Oxford', 'short', 'OXF'), jsonb_build_object('ext_id', 'oc2', 'name', 'Reading', 'short', 'REA'),
    jsonb_build_object('ext_id', 'oc3', 'name', 'Swindon', 'short', 'SWI'), jsonb_build_object('ext_id', 'oc4', 'name', 'Slough', 'short', 'SLO')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'od-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'oc1', 'away', 'oc2'),
    jsonb_build_object('ext_id', 'od-2', 'gameweek', 1, 'kickoff', now() + interval '2 days', 'status', 'NS', 'home', 'oc3', 'away', 'oc4'))));
select id as od1 from fixtures where ext_id = 'od-1' \gset
select id as od2 from fixtures where ext_id = 'od-2' \gset
select count(*) as members from teams where league_id = :lib and role = 'gm' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-odds') as og \gset
select pool_pickem_save(:og, 1, jsonb_build_array(jsonb_build_object('fixture', :od1, 'pick', 'H'), jsonb_build_object('fixture', :od2, 'pick', 'H')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_pickem_save(:og, 1, jsonb_build_array(jsonb_build_object('fixture', :od1, 'pick', 'H'), jsonb_build_object('fixture', :od2, 'pick', 'A')));
select pool_game_chances(:og) as ch0 \gset
select pg_temp.expect('before a ball is kicked every member has a chance, and they add up to one',
  jsonb_array_length(:'ch0'::jsonb) = :members
  and abs((select sum((e->>'chance')::numeric) from jsonb_array_elements(:'ch0'::jsonb) e) - 1) < 0.01
  and (select bool_and((e->>'chance')::numeric > 0) from jsonb_array_elements(:'ch0'::jsonb) e where (e->>'team_id')::int in (:hana, :fern, :lou)));
reset role;
select pg_temp.expect('the first look logs each member''s chance, once a day', (select count(*) from predictions where kind = 'pool_win' and (subject->>'game')::bigint = :og and status = 'open') = :members);
select soccer_ingest('pk-odds', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'od-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'FT', 'home', 'oc1', 'away', 'oc2', 'home_score', 1, 'away_score', 0, 'home_ft', 1, 'away_ft', 0))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_chances(:og) as ch1 \gset
select pg_temp.expect('a point up with one to play, Hana and Fern are far likelier than Lou, who can only guess his way to a share',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'ch1'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric + 0.2 from jsonb_array_elements(:'ch1'::jsonb) e where (e->>'team_id')::int = :lou)
  and (select (e->>'chance')::numeric from jsonb_array_elements(:'ch1'::jsonb) e where (e->>'team_id')::int = :fern)
    > (select (e->>'chance')::numeric + 0.2 from jsonb_array_elements(:'ch1'::jsonb) e where (e->>'team_id')::int = :lou));
reset role;
select pg_temp.expect('still one forecast a day each', (select count(*) from predictions where kind = 'pool_win' and (subject->>'game')::bigint = :og) = :members);
select soccer_ingest('pk-odds', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'od-2', 'gameweek', 1, 'kickoff', now() + interval '2 days', 'status', 'FT', 'home', 'oc3', 'away', 'oc4', 'home_score', 0, 'away_score', 2, 'home_ft', 0, 'away_ft', 2))));
select pg_temp.expect('Fern wins it, and the chances are scored: hers a hit, the rest misses', (select status = 'done' and winners = array[:fern] from pool_games where id = :og)
  and (select outcome = 1 and status = 'scored' from predictions where kind = 'pool_win' and (subject->>'game')::bigint = :og and (subject->>'team_id')::int = :fern)
  and (select bool_and(outcome = 0) from predictions where kind = 'pool_win' and (subject->>'game')::bigint = :og and (subject->>'team_id')::int <> :fern));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.expect('over, the chances are its winners', (select (e->>'chance')::numeric = 1 and (e->>'team_id')::int = :fern from jsonb_array_elements(pool_game_chances(:og)) e));
reset role;
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t read them', format('select pool_game_chances(%s)', :og));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'chances', true;

-- ───────────── chances to win in Pick the series (migration 176) ─────────────
-- An LCS then a World Series: Hana takes the higher seed in 4, Fern the lower seed in 7, Lou never picks. Up 3-0, the
-- higher seed makes Hana the favourite.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('ws-odds', 'mlb', 'Odds Series', 'OS', '2026', 'mlb', 'ws-odds', '2026', true) on conflict (id) do nothing;
select sport_ingest('ws-odds', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', '951', 'name', 'Erie Eagles', 'short', 'ERI'), jsonb_build_object('ext_id', '952', 'name', 'Flint Flyers', 'short', 'FLI')),
  'series', jsonb_build_array(
    jsonb_build_object('ext_id', 'O_L1', 'round', 1, 'label', 'Championship Series', 'short', 'CS', 'best_of', 7, 'high', '951', 'low', '952', 'starts_at', now() + interval '2 days'),
    jsonb_build_object('ext_id', 'O_W1', 'round', 2, 'label', 'World Series', 'short', 'WS', 'best_of', 7, 'starts_at', now() + interval '10 days', 'tbd', true))));
select id as eri from clubs where sport = 'mlb' and ext_id = '951' \gset
select id as fli from clubs where sport = 'mlb' and ext_id = '952' \gset
select id as ocs from series where ext_id = 'O_L1' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('series', 'ws-odds', '{"preset":"classic"}') as osg \gset
select pool_game_pick(:osg, 's:' || :ocs, jsonb_build_object('winner', :eri, 'games', 4));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:osg, 's:' || :ocs, jsonb_build_object('winner', :fli, 'games', 7));
select pool_game_chances(:osg) as sc0 \gset
select pg_temp.expect('before the first pitch every member has a chance, adding up to one',
  jsonb_array_length(:'sc0'::jsonb) = :members
  and abs((select sum((e->>'chance')::numeric) from jsonb_array_elements(:'sc0'::jsonb) e) - 1) < 0.01
  and (select bool_and((e->>'chance')::numeric > 0) from jsonb_array_elements(:'sc0'::jsonb) e where (e->>'team_id')::int in (:hana, :fern, :lou)));
reset role;
select pg_temp.expect('the series chances are logged as a forecast of their own kind', (select count(*) from predictions where kind = 'pool_win' and basis = 'series' and (subject->>'game')::bigint = :osg) = :members);
select sport_ingest('ws-odds', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'o1', 'series', 'O_L1', 'game_no', 1, 'kickoff', now() - interval '3 days', 'state', 'final', 'home', '951', 'away', '952', 'home_score', 5, 'away_score', 1),
  jsonb_build_object('ext_id', 'o2', 'series', 'O_L1', 'game_no', 2, 'kickoff', now() - interval '2 days', 'state', 'final', 'home', '951', 'away', '952', 'home_score', 4, 'away_score', 2),
  jsonb_build_object('ext_id', 'o3', 'series', 'O_L1', 'game_no', 3, 'kickoff', now() - interval '1 day', 'state', 'final', 'home', '952', 'away', '951', 'home_score', 0, 'away_score', 3))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pool_game_chances(:osg) as sc1 \gset
select pg_temp.expect('up 3-0, the higher seed makes Hana the clear favourite over Fern, who needs four straight from the lower seed',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'sc1'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric + 0.2 from jsonb_array_elements(:'sc1'::jsonb) e where (e->>'team_id')::int = :fern));
reset role;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'series chances', true;

-- ───────────── results by hand for every game (migration 177) ─────────────
-- Pod Squad runs last one standing and Call the score on the Hand Cup. The feed freezes: the host settles Ashby v
-- Barnet 2-1 by hand and voids Cobham v Dorking; then hands Ashby v Barnet back, and the feed has Barnet winning 1-0.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('hb-cup', 'soccer', 'Hand Cup', 'HC', '2026', 'api-football', 'hbc', '2026', true) on conflict (id) do nothing;
select soccer_ingest('hb-cup', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'hb1', 'name', 'Ashby', 'short', 'ASB'), jsonb_build_object('ext_id', 'hb2', 'name', 'Barnet Vale', 'short', 'BAR'),
    jsonb_build_object('ext_id', 'hb3', 'name', 'Cobham', 'short', 'COB'), jsonb_build_object('ext_id', 'hb4', 'name', 'Dorking', 'short', 'DOR')),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'hb-11', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'hb1', 'away', 'hb2'),
    jsonb_build_object('ext_id', 'hb-12', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'hb3', 'away', 'hb4'),
    jsonb_build_object('ext_id', 'hb-21', 'gameweek', 2, 'kickoff', now() + interval '8 days', 'status', 'NS', 'home', 'hb1', 'away', 'hb3'))));
select id as hb11 from fixtures where ext_id = 'hb-11' \gset
select id as hb12 from fixtures where ext_id = 'hb-12' \gset
select id as hb21 from fixtures where ext_id = 'hb-21' \gset
select id as asb from clubs where ext_id = 'hb1' \gset
select id as bar from clubs where ext_id = 'hb2' \gset
select id as cob from clubs where ext_id = 'hb3' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select survivor_start('hb-cup') as hsv \gset
select predictor_start('hb-cup') as hpr \gset
select survivor_pick(:hsv, :bar);
select predictor_save(:hpr, 1, jsonb_build_array(jsonb_build_object('fixture', :hb11, 'home', 0, 'away', 1)));
select pg_temp.raises('a match not yet kicked off can''t be settled', format('select pool_fixture_result_set(%s, %L, null, null, %L)', :hb11, 'H', 'early'), 'hasn''t kicked off');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select survivor_pick(:hsv, :asb);
select predictor_save(:hpr, 1, jsonb_build_array(jsonb_build_object('fixture', :hb11, 'home', 2, 'away', 1)));
select pg_temp.raises('only the host settles', format('select pool_fixture_result_set(%s, %L, null, null, %L)', :hb11, 'H', 'mine'), 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select survivor_pick(:hsv, :cob);
reset role;
-- both kick off, and the feed freezes
select soccer_ingest('hb-cup', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'hb-11', 'gameweek', 1, 'kickoff', now() - interval '1 hour', 'status', '1H', 'home', 'hb1', 'away', 'hb2', 'home_score', 0, 'away_score', 0),
  jsonb_build_object('ext_id', 'hb-12', 'gameweek', 1, 'kickoff', now() - interval '1 hour', 'status', '1H', 'home', 'hb3', 'away', 'hb4', 'home_score', 0, 'away_score', 0))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a score has both sides', format('select pool_fixture_result_set(%s, null, 2, null, %L)', :hb11, 'The feed froze'), 'both sides');
select pg_temp.raises('a match the pool''s games aren''t on', format('select pool_fixture_result_set(%s, %L, null, null, %L)', :od1, 'H', 'The feed froze'), 'isn''t in one of');
select pg_temp.expect('the host settles Ashby v Barnet 2-1', pool_fixture_result_set(:hb11, null, 2, 1, 'The feed froze at half-time') = 'H');
reset role;
select pg_temp.expect('last one standing settles from it: Fern through on Ashby, Hana out on Barnet',
  (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :fern) = 'through'
  and (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :hana) = 'out'
  and exists (select 1 from notifications where team_id = :fern and kind = 'survivor' and body = '🛡️ Through: Ashby beat Barnet Vale 2-1.'));
select pg_temp.expect('and Call the score: Fern spot on, Hana nothing', (select points from pool_predictor_picks where predictor_id = :hpr and team_id = :fern) = 3
  and (select points from pool_predictor_picks where predictor_id = :hpr and team_id = :hana) = 0
  and exists (select 1 from messages where league_id = :lib and body = '📝 The host settled Ashby 2-1 Barnet Vale: Ashby win. The feed froze at half-time'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_fixture_result_set(:hb12, 'void', null, null, 'Abandoned for floodlight failure');
reset role;
select pg_temp.expect('a void lets Lou through and closes the round by hand: the next one is in play',
  (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :lou) = 'void'
  and _survivor_week(:hsv) = 2 and (select status from pool_survivors where id = :hsv) = 'open');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('handed back, Ashby v Barnet waits for the feed again', pool_fixture_result_set(:hb11, null, null, null, null) is null);
reset role;
select pg_temp.expect('its picks are open again', (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :fern) is null
  and (select points from pool_predictor_picks where predictor_id = :hpr and team_id = :fern) is null);
select soccer_ingest('hb-cup', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'hb-11', 'gameweek', 1, 'kickoff', now() - interval '1 hour', 'status', 'FT', 'home', 'hb1', 'away', 'hb2', 'home_score', 0, 'away_score', 1, 'home_ft', 0, 'away_ft', 1))));
select pg_temp.expect('the feed settles it now: Barnet won, so Hana is through and Fern out; Hana''s call was spot on',
  (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :hana) = 'through'
  and (select result from pool_survivor_picks where survivor_id = :hsv and team_id = :fern) = 'out'
  and (select points from pool_predictor_picks where predictor_id = :hpr and team_id = :hana) = 3
  and (select points from pool_predictor_picks where predictor_id = :hpr and team_id = :fern) = 0);
select pg_temp.expect('the void stays the host''s, whatever the feed does', (select outcome from pool_result_overrides where league_id = :lib and fixture_id = :hb12) = 'void');
select set_config('app.league_id', '', false);
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('another pool''s host can''t settle it', format('select pool_fixture_result_set(%s, %L, null, null, %L)', :hb11, 'H', 'nope'), 'isn''t in one of');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'results by hand', true;

-- ───────────── the market beside the crowd (migration 178) ─────────────
-- The Market Cup's one match comes with the market's view; it moves before kick-off, then freezes. All three pick the
-- home side, which the market gave 61%.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-mkt', 'soccer', 'Market Cup', 'MC', '2026', 'espn', 'mkt', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-mkt', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'mk1', 'name', 'Mansfield', 'short', 'MAN'), jsonb_build_object('ext_id', 'mk2', 'name', 'Newport', 'short', 'NEW')),
  'fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'mk-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'mk1', 'away', 'mk2',
    'odds', jsonb_build_object('home', 0.55, 'away', 0.2, 'draw', 0.25, 'line', -0.5, 'total', 2.5)))));
select id as mk1 from fixtures where ext_id = 'mk-1' \gset
select soccer_ingest('pk-mkt', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'mk-1', 'gameweek', 1, 'kickoff', now() + interval '1 day',
  'status', 'NS', 'home', 'mk1', 'away', 'mk2', 'odds', jsonb_build_object('home', 0.61, 'away', 0.17, 'draw', 0.22, 'line', -1, 'total', 2.5)))));
select pg_temp.expect('the market''s view rides with the match, and moves before kick-off', (select (detail->'odds'->>'home')::numeric = 0.61 and (detail->'odds'->>'line')::numeric = -1 from fixtures where id = :mk1));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-mkt') as mkg \gset
select pool_pickem_save(:mkg, 1, jsonb_build_array(jsonb_build_object('fixture', :mk1, 'pick', 'H')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_pickem_save(:mkg, 1, jsonb_build_array(jsonb_build_object('fixture', :mk1, 'pick', 'H')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pool_pickem_save(:mkg, 1, jsonb_build_array(jsonb_build_object('fixture', :mk1, 'pick', 'H')));
reset role;
select soccer_ingest('pk-mkt', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'mk-1', 'gameweek', 1, 'kickoff', now() - interval '10 minutes',
  'status', '1H', 'home', 'mk1', 'away', 'mk2', 'home_score', 0, 'away_score', 0, 'odds', jsonb_build_object('home', 0.3, 'away', 0.4, 'draw', 0.3)))));
select soccer_ingest('pk-mkt', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'mk-1', 'gameweek', 1, 'kickoff', now() - interval '10 minutes',
  'status', '2H', 'home', 'mk1', 'away', 'mk2', 'home_score', 0, 'away_score', 1, 'odds', jsonb_build_object('home', 0.1, 'away', 0.7, 'draw', 0.2)))));
select pg_temp.expect('under way, the closing line stays', (select (detail->'odds'->>'home')::numeric = 0.61 from fixtures where id = :mk1));
select pg_temp.expect('the crowd''s forecast carries the market''s chance for its favourite', (select predicted = 1 and (detail->>'market')::numeric = 0.61
  from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :mkg, 'fixture', :mk1)));
select soccer_ingest('pk-mkt', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'mk-1', 'gameweek', 1, 'kickoff', now() - interval '10 minutes',
  'status', 'FT', 'home', 'mk1', 'away', 'mk2', 'home_score', 0, 'away_score', 1, 'home_ft', 0, 'away_ft', 1))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('the calibration reads the market beside the crowd', (select market = 0.61 and priced = 1 and right_share = 0 from crowd_calibration() where bucket = 0.9 and sport = 'soccer' and n = 1)
  or (select priced >= 1 from crowd_calibration() where bucket = 0.9 and sport = 'soccer'));
reset role;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'market', true;

-- ───────────── reminders in the sport's words, and a last call (migration 179) ─────────────
-- An NFL survivor: Thursday's game has kicked off, Sunday's is five hours out; Lou hasn't picked.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-101', 'gameweek', 10, 'kickoff', now() - interval '2 days', 'status', 'FT', 'home', 'nf1', 'away', 'nf2', 'home_score', 20, 'away_score', 17, 'home_ft', 20, 'away_ft', 17),
  jsonb_build_object('ext_id', 'nfl-102', 'gameweek', 10, 'kickoff', now() + interval '5 hours', 'status', 'NS', 'home', 'nf3', 'away', 'nf4'))));
select set_config('app.league_id', :'lib', false);
insert into pool_games (league_id, kind, competition, title, rules, created_by) values (:lib, 'survivor', 'nfl', 'Last one standing', '{"start_gw": 10, "end_gw": 10}', :hana) returning id as lsv \gset
select _soccer_nudge(:lib) as ln \gset
select pg_temp.expect('a round under way still gets a last call before its final kick-off, in the sport''s words',
  exists (select 1 from notifications where team_id = :lou and kind = 'survivor' and body = '⏰ Last call for week 10: its last game kicks off in 5h. Pick your team or you''re out.'));
select pg_temp.expect('and only once', _soccer_nudge(:lib) = 0);
update pool_games set status = 'done' where id = :lsv;
-- pick'em on the same week: its Thursday game is played, Sunday's still to pick
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'nfl') as nflpk \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select _pool_game_nudge(:lib) as pn \gset
select pg_temp.expect('pick''em gets a second reminder before the rest of a round under way, in the sport''s words',
  exists (select 1 from notifications where team_id = :lou and kind = 'pool_game' and body = '⏰ The rest of week 10 kicks off in 5h. You have one game still to pick in NFL pick''em.'));
select pg_temp.expect('and only once', _pool_game_nudge(:lib) = 0);
update pool_games set status = 'done' where id = :nflpk;
select set_config('app.league_id', '', false);
select 'last call', true;

-- ───────────── chance to win from the market (migration 181) ─────────────
-- One match, Hana on the home side, Fern on the away side: the pool alone can't split them, the market can.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('pk-mko', 'soccer', 'Line Cup', 'LC', '2026', 'espn', 'mko', '2026', true) on conflict (id) do nothing;
select soccer_ingest('pk-mko', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'lc1', 'name', 'Leyton', 'short', 'LEY'), jsonb_build_object('ext_id', 'lc2', 'name', 'Morecambe', 'short', 'MOR')),
  'fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'lc-1', 'gameweek', 1, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'lc1', 'away', 'lc2',
    'odds', jsonb_build_object('home', 0.9, 'away', 0.04, 'draw', 0.06)))));
select id as lc1 from fixtures where ext_id = 'lc-1' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('pickem', 'pk-mko') as lcg \gset
select pool_pickem_save(:lcg, 1, jsonb_build_array(jsonb_build_object('fixture', :lc1, 'pick', 'H')));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_pickem_save(:lcg, 1, jsonb_build_array(jsonb_build_object('fixture', :lc1, 'pick', 'A')));
select pool_game_chances(:lcg) as lch \gset
select pg_temp.expect('the market''s 90% makes the home pick the clear favourite',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'lch'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric + 0.3 from jsonb_array_elements(:'lch'::jsonb) e where (e->>'team_id')::int = :fern));
reset role;
update pool_games set status = 'done' where id = :lcg;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'chances from the market', true;

-- ───────────── chance to win in Rank the teams (migration 182) ─────────────
-- Two championship series, then a World Series of their winners. Hana ranks Ogden first, Fern ranks Reno first; once
-- the order locks, Ogden goes 3-0 up and Hana is the favourite.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('rk-odds', 'mlb', 'Rank Series', 'RS', '2026', 'mlb', 'rk-odds', '2026', true) on conflict (id) do nothing;
select sport_ingest('rk-odds', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', '961', 'name', 'Ogden Owls', 'short', 'OGD'), jsonb_build_object('ext_id', '962', 'name', 'Provo Pines', 'short', 'PRO'),
    jsonb_build_object('ext_id', '963', 'name', 'Quincy Quails', 'short', 'QUI'), jsonb_build_object('ext_id', '964', 'name', 'Reno Rams', 'short', 'REN')),
  'series', jsonb_build_array(
    jsonb_build_object('ext_id', 'K_L1', 'round', 1, 'label', 'AL Championship Series', 'short', 'ALCS', 'best_of', 7, 'high', '961', 'low', '962', 'starts_at', now() + interval '1 day'),
    jsonb_build_object('ext_id', 'K_L2', 'round', 1, 'label', 'NL Championship Series', 'short', 'NLCS', 'best_of', 7, 'high', '963', 'low', '964', 'starts_at', now() + interval '1 day'),
    jsonb_build_object('ext_id', 'K_W1', 'round', 2, 'label', 'World Series', 'short', 'WS', 'best_of', 7, 'starts_at', now() + interval '10 days', 'tbd', true))));
select id as ogd from clubs where sport = 'mlb' and ext_id = '961' \gset
select id as pro from clubs where sport = 'mlb' and ext_id = '962' \gset
select id as qui from clubs where sport = 'mlb' and ext_id = '963' \gset
select id as ren from clubs where sport = 'mlb' and ext_id = '964' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('rank', 'rk-odds') as rkg \gset
select pool_game_pick(:rkg, 'rank', jsonb_build_object('order', jsonb_build_array(:ogd, :pro, :qui, :ren)));
select pg_temp.expect('before the lock there are no chances: the order can still change', pool_game_chances(:rkg) = '[]'::jsonb);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:rkg, 'rank', jsonb_build_object('order', jsonb_build_array(:ren, :qui, :pro, :ogd)));
reset role;
select set_config('request.jwt.claim.sub', '', false);
update series set starts_at = now() - interval '1 hour' where competition = 'rk-odds' and round = 1;
select sport_ingest('rk-odds', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'k1', 'series', 'K_L1', 'game_no', 1, 'kickoff', now() - interval '50 minutes', 'state', 'final', 'home', '961', 'away', '962', 'home_score', 4, 'away_score', 1),
  jsonb_build_object('ext_id', 'k2', 'series', 'K_L1', 'game_no', 2, 'kickoff', now() - interval '40 minutes', 'state', 'final', 'home', '961', 'away', '962', 'home_score', 3, 'away_score', 2),
  jsonb_build_object('ext_id', 'k3', 'series', 'K_L1', 'game_no', 3, 'kickoff', now() - interval '30 minutes', 'state', 'final', 'home', '962', 'away', '961', 'home_score', 0, 'away_score', 5))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pool_game_chances(:rkg) as rkc \gset
select pg_temp.expect('locked and Ogden 3-0 up, Hana is the favourite; the chances add up to one',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'rkc'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric + 0.2 from jsonb_array_elements(:'rkc'::jsonb) e where (e->>'team_id')::int = :fern)
  and abs((select sum((e->>'chance')::numeric) from jsonb_array_elements(:'rkc'::jsonb) e) - 1) < 0.01);
reset role;
select pg_temp.expect('logged as a forecast of its own kind', exists (select 1 from predictions where kind = 'pool_win' and basis = 'rank' and (subject->>'game')::bigint = :rkg));
update pool_games set status = 'done' where id = :rkg;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'rank chances', true;

-- ───────────── every chance against what happened (migration 183) ─────────────
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.expect('the pool''s chances read in tenths, its own only', (select sum(n) from chance_calibration where kind = 'pool_win')
  = (select count(*) from predictions where kind = 'pool_win' and status = 'scored')
  and exists (select 1 from chance_calibration where kind = 'pool_split'));
reset role;
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.expect('another league sees none of them', not exists (select 1 from chance_calibration where kind in ('pool_win', 'pool_split')));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'chance calibration', true;

-- ───────────── the bracket (migration 185) ─────────────
-- Eight clubs, four series, then two, then the final. Hana takes Akron all the way, Fern takes Gary; Lou never fills
-- one in. After the first round, Hana has three right and can still reach eleven.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('br-cup', 'mlb', 'Bracket Cup', 'BC', '2026', 'mlb', 'br-cup', '2026', true) on conflict (id) do nothing;
select sport_ingest('br-cup', jsonb_build_object(
  'clubs', (select jsonb_agg(jsonb_build_object('ext_id', 'b' || i, 'name', n, 'short', upper(left(n, 3)))) from unnest(array['Akron', 'Boise', 'Canton', 'Dayton', 'Erie', 'Fargo', 'Gary', 'Helena']) with ordinality u(n, i)),
  'series', jsonb_build_array(
    jsonb_build_object('ext_id', 'B11', 'round', 1, 'label', 'Quarterfinal', 'short', 'QF1', 'best_of', 7, 'high', 'b1', 'low', 'b2', 'starts_at', now() + interval '1 day', 'sort', 1),
    jsonb_build_object('ext_id', 'B12', 'round', 1, 'label', 'Quarterfinal', 'short', 'QF2', 'best_of', 7, 'high', 'b3', 'low', 'b4', 'starts_at', now() + interval '1 day', 'sort', 2),
    jsonb_build_object('ext_id', 'B13', 'round', 1, 'label', 'Quarterfinal', 'short', 'QF3', 'best_of', 7, 'high', 'b5', 'low', 'b6', 'starts_at', now() + interval '1 day', 'sort', 3),
    jsonb_build_object('ext_id', 'B14', 'round', 1, 'label', 'Quarterfinal', 'short', 'QF4', 'best_of', 7, 'high', 'b7', 'low', 'b8', 'starts_at', now() + interval '1 day', 'sort', 4),
    jsonb_build_object('ext_id', 'B21', 'round', 2, 'label', 'Semifinal', 'short', 'SF1', 'best_of', 7, 'starts_at', now() + interval '9 days', 'tbd', true, 'sort', 1),
    jsonb_build_object('ext_id', 'B22', 'round', 2, 'label', 'Semifinal', 'short', 'SF2', 'best_of', 7, 'starts_at', now() + interval '9 days', 'tbd', true, 'sort', 2),
    jsonb_build_object('ext_id', 'B31', 'round', 3, 'label', 'Final', 'short', 'F', 'best_of', 7, 'starts_at', now() + interval '18 days', 'tbd', true, 'sort', 1))));
select id as ak from clubs where sport = 'mlb' and ext_id = 'b1' \gset
select id as bo from clubs where sport = 'mlb' and ext_id = 'b2' \gset
select id as ca from clubs where sport = 'mlb' and ext_id = 'b3' \gset
select id as da from clubs where sport = 'mlb' and ext_id = 'b4' \gset
select id as er from clubs where sport = 'mlb' and ext_id = 'b5' \gset
select id as fa from clubs where sport = 'mlb' and ext_id = 'b6' \gset
select id as ga from clubs where sport = 'mlb' and ext_id = 'b7' \gset
select id as q1 from series where ext_id = 'B11' \gset
select id as q2 from series where ext_id = 'B12' \gset
select id as q3 from series where ext_id = 'B13' \gset
select id as q4 from series where ext_id = 'B14' \gset
select id as s1 from series where ext_id = 'B21' \gset
select id as s2 from series where ext_id = 'B22' \gset
select id as f1 from series where ext_id = 'B31' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers a bracket where the rounds make one', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'br-cup' and e->'kinds' ? 'bracket'));
-- with a point for calling the games too (migration 228)
select pool_game_start('bracket', 'br-cup', '{"games_bonus": 1}') as bg \gset
select pg_temp.expect('it is on, doubling by round', (select title = 'The bracket' and rules->'points' = '{"1": 1, "2": 2, "3": 4}'::jsonb from pool_games where id = :bg)
  and exists (select 1 from messages where league_id = :lib and body like '🏆 The bracket is open, from the Quarterfinal%'));
select pg_temp.raises('every series needs a winner', format('select pool_game_pick(%s, %L, %L)', :bg, 'bracket',
  jsonb_build_object('winners', jsonb_build_object(:q1, :ak))), 'every series');
select pg_temp.raises('a winner goes on only from below', format('select pool_game_pick(%s, %L, %L)', :bg, 'bracket',
  jsonb_build_object('winners', jsonb_build_object(:q1, :ak, :q2, :ca, :q3, :er, :q4, :ga, :s1, :er, :s2, :er, :f1, :er))), 'only from a series before it');
select pg_temp.raises('a best-of-7 goes 4 to 7', format('select pool_game_pick(%s, %L, %L)', :bg, 'bracket',
  jsonb_build_object('winners', jsonb_build_object(:q1, :ak, :q2, :ca, :q3, :er, :q4, :ga, :s1, :ak, :s2, :er, :f1, :ak), 'lengths', jsonb_build_object(:q1, 3))), '4 to 7 games');
-- Akron in five and Erie in seven
select pool_game_pick(:bg, 'bracket', jsonb_build_object('winners', jsonb_build_object(:q1, :ak, :q2, :ca, :q3, :er, :q4, :ga, :s1, :ak, :s2, :er, :f1, :ak),
  'lengths', jsonb_build_object(:q1, 5, :q3, 7)));
select pool_game_pick(:bg, 'tiebreak', '{"runs": 8}');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:bg, 'bracket', jsonb_build_object('winners', jsonb_build_object(:q1, :bo, :q2, :ca, :q3, :fa, :q4, :ga, :s1, :ca, :s2, :ga, :f1, :ga)));
select pg_temp.expect('the board shows the tree and her own bracket, nobody''s champion before the lock',
  (select jsonb_array_length(b->'bracket'->'series') = 7 and (b->'bracket'->'mine'->>(:f1)::text)::bigint = :ga and b->'bracket'->'champions' = 'null'::jsonb
   from (select pool_game_board(:bg) b) x));
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the first round starts (the lock) and finishes: Akron, Dayton, Erie and Gary go through
update series set starts_at = now() - interval '1 day' where competition = 'br-cup' and round = 1;
update series set state = 'final', high_wins = case when ext_id in ('B11', 'B13', 'B14') then 4 else 2 end,
  low_wins = case when ext_id = 'B12' then 4 else 1 end,
  winner = case ext_id when 'B11' then :ak when 'B12' then :da when 'B13' then :er else :ga end
where competition = 'br-cup' and round = 1;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('locked at the first game', format('select pool_game_pick(%s, %L, %L)', :bg, 'bracket',
  jsonb_build_object('winners', jsonb_build_object(:q1, :ak, :q2, :ca, :q3, :er, :q4, :ga, :s1, :ak, :s2, :er, :f1, :ak))), 'locked');
reset role;
select pg_temp.expect('three right and Akron in five, twelve still possible for Hana; one and seven for Fern; nothing for Lou, who never filled one in',
  (select points = 4 and possible = 12 and right_calls = 3 and exact = 1 and picked = 1 from _pool_game_table(:bg) where team_id = :hana)
  and (select points = 1 and possible = 7 from _pool_game_table(:bg) where team_id = :fern)
  and (select points = 0 and possible = 0 and picked = 0 from _pool_game_table(:bg) where team_id = :lou));
select pg_temp.expect('the pool''s table reads it', (select line = '3 right' and score = 4 from _pool_rows() where game = 'game:' || :bg and team_id = :hana)
  and (select line = 'No bracket yet' from _pool_rows() where game = 'game:' || :bg and team_id = :lou));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000086', false);
set role authenticated;
select pg_temp.expect('once locked, everyone''s champion shows', (select jsonb_array_length(pool_game_board(:bg)->'bracket'->'champions') = 2));
reset role;
-- a second chance (migration 211): with the first bracket locked, the host opens another from the semifinals
update series s set high_club = x.h, low_club = x.l
from (select t.next_id, min(c.winner) h, max(c.winner) l from _bracket_tree('br-cup', 1) t join series c on c.id = t.series_id where t.round = 1 group by t.next_id) x
where s.id = x.next_id and s.high_club is null;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the game list says the first one is locked, from round 1', (select (x->>'locked')::boolean and (x->>'from_round')::int = 1
  from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :bg));
select pool_game_start('bracket', 'br-cup') as bg2 \gset
select pg_temp.raises('one second chance from a round', $$select pool_game_start('bracket', 'br-cup')$$, 'already runs that game');
reset role;
select pg_temp.expect('a second-chance bracket from the next round, and the chat hears', (select title = 'Second-chance bracket' and (rules->>'from_round')::int = 2 from pool_games where id = :bg2)
  and exists (select 1 from messages where league_id = :lib and body like '🏆 The second-chance bracket is open, from the %: a fresh bracket for everyone, busted or not.%'));
-- the games called on a series still going (migration 228): Akron in six stays possible while Dayton has two wins, not three
update pool_picks set pick = jsonb_set(pick, '{lengths}', pick->'lengths' || jsonb_build_object(:s1::text, 6)) where game_id = :bg and team_id = :hana and thing = 'bracket';
update series set state = 'live', high_wins = case when high_club = :ak then 1 else 2 end, low_wins = case when high_club = :ak then 2 else 1 end where id = :s1;
select possible as p_two from _bracket_table(:bg) where team_id = :hana \gset
update series set high_wins = case when high_club = :ak then 1 else 3 end, low_wins = case when high_club = :ak then 3 else 1 end where id = :s1;
select pg_temp.expect('Akron in six goes once Dayton has three', (select possible from _bracket_table(:bg) where team_id = :hana) = :p_two - 1);
update series set state = 'scheduled', high_wins = 0, low_wins = 0 where id = :s1;
update pool_games set status = 'done' where id = :bg2;
update pool_games set status = 'done' where id = :bg;
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t read it', format('select pool_game_board(%s)', :bg));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'bracket', true;

-- ───────────── chance to win in the bracket (migration 186) ─────────────
-- The Bracket Cup again (migration 185's section): after the first round Hana has three right and Akron, Erie and her
-- champion still alive; Fern has one and Gary.
select set_config('app.league_id', :'lib', false);
update pool_games set status = 'open' where id = :bg;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_chances(:bg) as bch \gset
select pg_temp.expect('Hana is the favourite, Lou has none, and the chances add up to one',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'bch'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric from jsonb_array_elements(:'bch'::jsonb) e where (e->>'team_id')::int = :fern)
  and (select (e->>'chance')::numeric = 0 from jsonb_array_elements(:'bch'::jsonb) e where (e->>'team_id')::int = :lou)
  and abs((select sum((e->>'chance')::numeric) from jsonb_array_elements(:'bch'::jsonb) e) - 1) < 0.01);
reset role;
update pool_games set status = 'done' where id = :bg;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'bracket chances', true;

-- ───────────── the NFL's playoffs as series, and a bracket on them (migration 187) ─────────────
-- Last season's playoffs as soccer-sync files them (the Wild Card round played, the Divisional round next, the later
-- rounds' slots not yet drawn): the bracket can start from the Divisional round, the AFC's games feeding the AFC final.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('nfl-po-test', 'nfl', 'NFL Playoffs (test)', 'NFL', '2025', 'espn', 'football/nfl', '2025', true, 'series') on conflict (id) do nothing;
select sport_ingest('nfl-po-test', '{"clubs":[{"ext_id":"30","name":"Jacksonville Jaguars","short":"JAX","logo":null},{"ext_id":"2","name":"Buffalo Bills","short":"BUF","logo":null},{"ext_id":"17","name":"New England Patriots","short":"NE","logo":null},{"ext_id":"24","name":"Los Angeles Chargers","short":"LAC","logo":null},{"ext_id":"23","name":"Pittsburgh Steelers","short":"PIT","logo":null},{"ext_id":"34","name":"Houston Texans","short":"HOU","logo":null},{"ext_id":"29","name":"Carolina Panthers","short":"CAR","logo":null},{"ext_id":"14","name":"Los Angeles Rams","short":"LAR","logo":null},{"ext_id":"3","name":"Chicago Bears","short":"CHI","logo":null},{"ext_id":"9","name":"Green Bay Packers","short":"GB","logo":null},{"ext_id":"21","name":"Philadelphia Eagles","short":"PHI","logo":null},{"ext_id":"25","name":"San Francisco 49ers","short":"SF","logo":null},{"ext_id":"7","name":"Denver Broncos","short":"DEN","logo":null},{"ext_id":"26","name":"Seattle Seahawks","short":"SEA","logo":null}],"series":[{"ext_id":"P401772977","round":1,"label":"AFC Wild Card","short":"AFC WC","best_of":1,"high":"30","low":"2","starts_at":"2026-01-11T18:00:00.000Z","tbd":false,"sort":1},{"ext_id":"P401772978","round":1,"label":"AFC Wild Card","short":"AFC WC","best_of":1,"high":"17","low":"24","starts_at":"2026-01-12T01:15:00.000Z","tbd":false,"sort":2},{"ext_id":"P401772976","round":1,"label":"AFC Wild Card","short":"AFC WC","best_of":1,"high":"23","low":"34","starts_at":"2026-01-13T01:15:00.000Z","tbd":false,"sort":3},{"ext_id":"P401772979","round":1,"label":"NFC Wild Card","short":"NFC WC","best_of":1,"high":"29","low":"14","starts_at":"2026-01-10T21:30:00.000Z","tbd":false,"sort":4},{"ext_id":"P401772981","round":1,"label":"NFC Wild Card","short":"NFC WC","best_of":1,"high":"3","low":"9","starts_at":"2026-01-11T01:00:00.000Z","tbd":false,"sort":5},{"ext_id":"P401772980","round":1,"label":"NFC Wild Card","short":"NFC WC","best_of":1,"high":"21","low":"25","starts_at":"2026-01-11T21:30:00.000Z","tbd":false,"sort":6},{"ext_id":"P401772982","round":2,"label":"AFC Divisional","short":"AFC DIV","best_of":1,"high":"7","low":"2","starts_at":"2099-01-17T21:30:00Z","tbd":false,"sort":1},{"ext_id":"P401772983","round":2,"label":"AFC Divisional","short":"AFC DIV","best_of":1,"high":"17","low":"34","starts_at":"2099-01-17T21:30:00Z","tbd":false,"sort":2},{"ext_id":"P401772984","round":2,"label":"NFC Divisional","short":"NFC DIV","best_of":1,"high":"26","low":"25","starts_at":"2099-01-17T21:30:00Z","tbd":false,"sort":3},{"ext_id":"P401772985","round":2,"label":"NFC Divisional","short":"NFC DIV","best_of":1,"high":"3","low":"14","starts_at":"2099-01-17T21:30:00Z","tbd":false,"sort":4},{"ext_id":"PAFC","round":3,"label":"AFC Championship","short":"AFC CC","best_of":1,"tbd":true,"sort":1},{"ext_id":"PNFC","round":3,"label":"NFC Championship","short":"NFC CC","best_of":1,"tbd":true,"sort":2},{"ext_id":"PSB","round":4,"label":"Super Bowl","short":"SB","best_of":1,"tbd":true,"sort":1}],"fixtures":[{"ext_id":"P401772977","series":"P401772977","game_no":1,"kickoff":"2026-01-11T18:00:00.000Z","state":"final","status":"FT","home":"30","away":"2","home_score":24,"away_score":27,"venue":"EverBank Stadium, Jacksonville"},{"ext_id":"P401772978","series":"P401772978","game_no":1,"kickoff":"2026-01-12T01:15:00.000Z","state":"final","status":"FT","home":"17","away":"24","home_score":16,"away_score":3,"venue":"Gillette Stadium, Foxborough"},{"ext_id":"P401772976","series":"P401772976","game_no":1,"kickoff":"2026-01-13T01:15:00.000Z","state":"final","status":"FT","home":"23","away":"34","home_score":6,"away_score":30,"venue":"Acrisure Stadium, Pittsburgh"},{"ext_id":"P401772979","series":"P401772979","game_no":1,"kickoff":"2026-01-10T21:30:00.000Z","state":"final","status":"FT","home":"29","away":"14","home_score":31,"away_score":34,"venue":"Bank of America Stadium, Charlotte"},{"ext_id":"P401772981","series":"P401772981","game_no":1,"kickoff":"2026-01-11T01:00:00.000Z","state":"final","status":"FT","home":"3","away":"9","home_score":31,"away_score":27,"venue":"Soldier Field, Chicago"},{"ext_id":"P401772980","series":"P401772980","game_no":1,"kickoff":"2026-01-11T21:30:00.000Z","state":"final","status":"FT","home":"21","away":"25","home_score":19,"away_score":23,"venue":"Lincoln Financial Field, Philadelphia"},{"ext_id":"P401772982","series":"P401772982","game_no":1,"kickoff":"2099-01-17T21:30:00Z","state":"scheduled","status":"NS","home":"7","away":"2","home_score":null,"away_score":null,"venue":"Empower Field at Mile High, Denver"},{"ext_id":"P401772983","series":"P401772983","game_no":1,"kickoff":"2099-01-17T21:30:00Z","state":"scheduled","status":"NS","home":"17","away":"34","home_score":null,"away_score":null,"venue":"Gillette Stadium, Foxborough"},{"ext_id":"P401772984","series":"P401772984","game_no":1,"kickoff":"2099-01-17T21:30:00Z","state":"scheduled","status":"NS","home":"26","away":"25","home_score":null,"away_score":null,"venue":"Lumen Field, Seattle"},{"ext_id":"P401772985","series":"P401772985","game_no":1,"kickoff":"2099-01-17T21:30:00Z","state":"scheduled","status":"NS","home":"3","away":"14","home_score":null,"away_score":null,"venue":"Soldier Field, Chicago"}]}'::jsonb);
select pg_temp.expect('the playoffs offer a bracket from the Divisional round, beside the series kinds', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'nfl-po-test' and (e->>'open_round')::int = 2 and e->'kinds' ? 'bracket' and e->'kinds' ? 'series'));
select pg_temp.expect('the AFC''s Divisional games feed the AFC final, the conference finals the Super Bowl',
  (select bool_and(t.next_id = (select id from series where ext_id = 'PAFC')) from _bracket_tree('nfl-po-test', 2) t join series s on s.id = t.series_id where s.short = 'AFC DIV')
  and (select bool_and(t.next_id = (select id from series where ext_id = 'PNFC')) from _bracket_tree('nfl-po-test', 2) t join series s on s.id = t.series_id where s.short = 'NFC DIV')
  and (select bool_and(t.next_id = (select id from series where ext_id = 'PSB')) from _bracket_tree('nfl-po-test', 2) t join series s on s.id = t.series_id where s.round = 3));
select pg_temp.expect('the Wild Card round can''t start one: the NFL reseeds after it', not _bracket_ok('nfl-po-test', 1));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('bracket', 'nfl-po-test') as nbg \gset
select pg_temp.expect('a bracket on the playoffs, doubling from the Divisional round', (select rules->'points' = '{"2": 1, "3": 2, "4": 4}'::jsonb from pool_games where id = :nbg));
-- in football's words (migration 190): the Super Bowl's total points break a tie, up to 150
select pg_temp.expect('the board speaks football', (select b->'words' = '{"start": "kickoff", "score": "points", "cap": 150}'::jsonb from (select pool_game_board(:nbg) b) x));
select pool_game_pick(:nbg, 'tiebreak', '{"runs": 98}');
select pg_temp.raises('a tiebreaker past a football score', format('select pool_game_pick(%s, %L, %L)', :nbg, 'tiebreak', '{"runs": 151}'), 'Total points: a number from 0 to 150');
reset role;
update pool_games set status = 'done' where id = :nbg;
update competitions set active = false where id = 'nfl-po-test';
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'nfl playoffs', true;

-- ───────────── the box pool (migration 188) ─────────────
-- Two clubs that meet twice in a week forty days out (regular-season ids: a game's type is read from its id),
-- fifteen forwards, five defence and five goalies between them.
-- Quick is five boxes of five, the best forwards in box 1. Hana takes the first in every box, Fern the second, and the
-- host enters Lou's team for him. The first night: Hana's top forward scores twice and sets one up, Fern's goalie wins.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into players (id, name, pos, elig, last_fp, proj, status, nhl_team, proj_stats)
select 990000 + i, 'Box ' || case when i <= 15 then 'Forward ' when i <= 20 then 'Defence ' else 'Goalie ' end || i,
  case when i <= 15 then 'C' when i <= 20 then 'D' else 'G' end, array[case when i <= 15 then 'C' when i <= 20 then 'D' else 'G' end], 0, 0, 'active',
  case when i % 2 = 0 then 'BXA' else 'BXB' end,
  case when i <= 20 then jsonb_build_object('gp', 82, 'g', 60 - i * 2, 'a', 60 - i * 2) else jsonb_build_object('gp', 60, 'w', 60 - i, 'sho', 3) end
from generate_series(1, 25) i on conflict (id) do nothing;
insert into games (id, date, start_utc, home, away, state) values
  (2099029101, today_et() + 40, (today_et() + 40)::timestamp + interval '23 hours', 'BXA', 'BXB', 'FUT'),
  (2099029102, today_et() + 42, (today_et() + 42)::timestamp + interval '23 hours', 'BXB', 'BXA', 'FUT') on conflict do nothing;
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers a box pool on the NHL season', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'nhl-2026' and e->'kinds' = '["players"]'::jsonb));
select pool_game_start('players', 'nhl-2026', jsonb_build_object('preset', 'quick', 'length', 'week', 'from', today_et() + 40)) as bxg \gset
select pg_temp.expect('it is on: five boxes of five, the best forwards first, the goalies last',
  (select title = 'The box pool' and jsonb_array_length(rules->'boxes') = 5 and rules->'boxes'->0->>'label' = 'Forwards 1'
     and rules->'boxes'->0->'players' = '[990001, 990002, 990003, 990004, 990005]'::jsonb and rules->'boxes'->4->>'label' = 'Goalies'
     -- a week, cut at the season's last night (here the second game)
     and rules->>'to' = (today_et() + 42)::text from pool_games where id = :bxg)
  and exists (select 1 from messages where league_id = :lib and body like '🏒 The box pool is open: take one player from each of 5 boxes%'));
select pg_temp.raises('one from every box', format('select pool_game_pick(%s, %L, %L)', :bxg, 'box', '{"players": [990001]}'), 'every box');
select pg_temp.raises('only from its own box', format('select pool_game_pick(%s, %L, %L)', :bxg, 'box', '{"players": [990006, 990001, 990011, 990016, 990021]}'), 'isn''t in Forwards 1');
select pool_game_pick(:bxg, 'box', '{"players": [990001, 990006, 990011, 990016, 990021]}');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:bxg, 'box', '{"players": [990002, 990007, 990012, 990017, 990022]}');
select pg_temp.expect('the board shows the boxes and her own team, nobody else''s before the lock',
  (select jsonb_array_length(b->'players'->'boxes') = 5 and b->'players'->'mine' = '[990002, 990007, 990012, 990017, 990022]'::jsonb
     and b->'players'->'teams' = 'null'::jsonb and (b->'players'->'boxes'->0->'players'->0->>'games')::int = 2 from (select pool_game_board(:bxg) b) x));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('the boxes stay once teams are in', format('select pool_game_set_rules(%s, %L)', :bxg, '{"scoring": {"g": 2}}'), 'the boxes stay');
-- a change that doesn't name the window keeps it (migration 196): the same rules again pass, the window untouched
select pool_game_set_rules(:bxg, '{"preset": "quick"}');
reset role;
select pg_temp.expect('the window is as it was', (select rules->>'length' = 'week' and rules->>'to' = (today_et() + 42)::text from pool_games where id = :bxg));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_host_pick(:bxg, :lou, '{"thing": "box", "pick": {"players": [990003, 990008, 990013, 990018, 990023]}}');
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- two hours to the first puck drop: nobody who has a team in hears the reminder (migration 195)
update games set start_utc = now() + interval '2 hours' where id = 2099029101;
select _pool_game_nudge(:lib);
select pg_temp.expect('no reminder for a member whose team is in', not exists (select 1 from notifications where team_id in (:hana, :fern, :lou) and body like '⏰ The box pool locks%'));
-- the first night starts and is played
update games set start_utc = now() - interval '3 hours', state = 'OFF' where id = 2099029101;
insert into player_games (game_id, player_id, date, stats) values
  (2099029101, 990001, today_et() + 40, '{"g": 2, "a": 1}'), (2099029101, 990002, today_et() + 40, '{"g": 0, "a": 1}'),
  (2099029101, 990022, today_et() + 40, '{"w": 1, "sho": 0, "sv": 30}'), (2099029101, 990021, today_et() + 40, '{"w": 0, "l": 1}');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('locked at the first puck drop', format('select pool_game_pick(%s, %L, %L)', :bxg, 'box', '{"players": [990002, 990006, 990011, 990016, 990021]}'), 'locked');
select pg_temp.expect('once locked, everyone''s team shows, and who took whom', (select jsonb_array_length(b->'players'->'teams') = 3
  and (b->'players'->'boxes'->0->'players'->0->>'taken')::int = 1 and (b->'players'->'boxes'->0->'players'->0->>'pts')::int = 3
  from (select pool_game_board(:bxg) b) x));
-- what's still to come (migration 193): the best forward has one game left, about 1.4 points a game
select pg_temp.expect('the board says what each player should still add', (select (b->'players'->'boxes'->0->'players'->0->>'to_come')::numeric = 1.4
  from (select pool_game_board(:bxg) b) x));
-- and his next game (migration 199): the second night, at home to the other club
select pg_temp.expect('the board says who he plays next', (select b->'players'->'boxes'->0->'players'->0->'next'->>'opp' = 'BXA'
    and b->'players'->'boxes'->0->'players'->0->'next'->>'state' = 'FUT'
  from (select pool_game_board(:bxg) b) x));
reset role;
select pg_temp.expect('Hana 3 with two goals and an assist, Fern 3 from an assist and a win, Lou nothing yet',
  (select points = 3 and right_calls = 2 and exact = 1 and picked = 1 from _pool_game_table(:bxg) where team_id = :hana)
  and (select points = 3 from _pool_game_table(:bxg) where team_id = :fern)
  and (select points = 0 and picked = 1 from _pool_game_table(:bxg) where team_id = :lou));
select pg_temp.expect('the pool''s table reads it', (select line = '2 goals, 1 assist' from _pool_rows() where game = 'game:' || :bxg and team_id = :hana));
-- goal alerts (migration 192): Hana hears her forward's two goals, Fern her goalie's win, Lou nothing
select pg_temp.expect('Hana hears the goals, Fern the win, Lou nothing',
  exists (select 1 from notifications where team_id = :hana and body = '🚨 Box Forward 1 scores 2 for you in the box pool: +2')
  and exists (select 1 from notifications where team_id = :fern and body = '🥅 Box Goalie 22 gets the win for you in the box pool: +2')
  and not exists (select 1 from notifications where team_id = :lou and kind = 'pool_game' and body like '🚨%'));
update player_games set stats = '{"g": 2, "a": 2}' where game_id = 2099029101 and player_id = 990001;
select pg_temp.expect('an assist added is no goal', (select count(*) from notifications where team_id = :hana and body like '🚨 Box Forward 1%') = 1);
update player_games set stats = '{"g": 2, "a": 1}' where game_id = 2099029101 and player_id = 990001;
-- the chance to win (migration 189): one night left, Hana three up with the better players
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_chances(:bxg) as bxch \gset
reset role;
select pg_temp.expect('Hana is the favourite over Lou, and the chances add up to one',
  (select (e->>'chance')::numeric from jsonb_array_elements(:'bxch'::jsonb) e where (e->>'team_id')::int = :hana)
    > (select (e->>'chance')::numeric from jsonb_array_elements(:'bxch'::jsonb) e where (e->>'team_id')::int = :lou)
  and abs((select sum((e->>'chance')::numeric) from jsonb_array_elements(:'bxch'::jsonb) e) - 1) < 0.01);
-- the prediction log (migration 197): a forecast for each team once it locks, once
select _players_log(:lib) as bxl \gset
select pg_temp.expect('each team''s expected points go in the log, once', :bxl = 3 and _players_log(:lib) = 0);
select pg_temp.expect('with a forecast above nothing', (select predicted > 0 from predictions where kind = 'box_points' and (subject->>'game')::bigint = :bxg and (subject->>'team_id')::int = :hana));
select pg_temp.expect('not done while nights are left', _players_settle(:lib) = 0);
-- the week is over: the nights move into the past and the second is played
update games set date = date - 50, start_utc = start_utc - interval '50 days', state = 'OFF' where id in (2099029101, 2099029102);
update player_games set date = date - 50 where game_id = 2099029101;
insert into player_games (game_id, player_id, date, stats) values (2099029102, 990001, today_et() - 8, '{"g": 1, "a": 0}');
update pool_games set rules = rules || jsonb_build_object('from', today_et() - 10, 'to', today_et() - 4) where id = :bxg;
-- the morning line (migration 194): the second night was Hana's alone, once
select pg_temp.expect('the pool hears who had the night and who leads', _players_recap(:lib, today_et() - 8) = 1);
select pg_temp.expect('in so many words, once', exists (select 1 from messages where league_id = :lib
    and body = '🏒 Last night in the box pool: Hana had the night, +1 (Box Forward 1: 1 G). Hana leads with 4.')
  and _players_recap(:lib, today_et() - 8) = 0);
select _players_settle(:lib) as bxn \gset
select pg_temp.expect('the morning after, Hana wins it', :bxn = 1
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :bxg)
  and exists (select 1 from messages where league_id = :lib and body = '🏆 The box pool is done: Hana, with 4 points.'));
select pg_temp.expect('the host hears it, with the next one to deal (migration 198)', exists (select 1 from notifications where team_id = :hana and link = '/host'
  and body = '🏒 The box pool is done. Deal the next one from the Host page: fresh boxes, and everyone starts level.'));
select pg_temp.expect('and each forecast is scored on the points made', (select status = 'scored' and outcome = 4 and error = 4 - predicted
  from predictions where kind = 'box_points' and (subject->>'game')::bigint = :bxg and (subject->>'team_id')::int = :hana));
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('another league can''t read it', format('select pool_game_board(%s)', :bxg));
reset role;
delete from player_games where game_id in (2099029101, 2099029102);
delete from games where id in (2099029101, 2099029102);
update players set status = 'unrostered' where id between 990001 and 990025;
select set_config('request.jwt.claim.sub', '', false);
select 'box pool', true;

-- ───────────── the box pool on the playoffs (migration 202) ─────────────
-- A first round of one series forty days out: BXA, expected to play six games, against BXB, expected to play five.
-- The boxes are dealt on those games, so BXA's second forward leads the first box. It locks at the first puck drop,
-- BXB's players are shaded once BXB is out, and it's done with the final (here the one series).
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
update players set status = 'active' where id between 990001 and 990025;
insert into nhl_teams (abbrev, name, exp_po_games) values ('BXA', 'Box A', 6), ('BXB', 'Box B', 5)
  on conflict (abbrev) do update set exp_po_games = excluded.exp_po_games;
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('nhl-po-box', 'nhl', 'Stanley Cup Playoffs (box test)', 'NHL', '2027', 'nhl-api', 'nhl', '20262027', true, 'series') on conflict (id) do nothing;
select sport_ingest('nhl-po-box', jsonb_build_object(
  'clubs', '[{"ext_id": "901", "name": "Box A", "short": "BXA"}, {"ext_id": "902", "name": "Box B", "short": "BXB"}]'::jsonb,
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'box:A', 'round', 1, 'label', '1st Round', 'short', 'R1', 'best_of', 7,
    'high', '901', 'low', '902', 'starts_at', (today_et() + 40)::timestamp + interval '23 hours', 'tbd', false, 'sort', 1)),
  'fixtures', '[]'::jsonb));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers a box pool on the playoffs before the first round', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'nhl-po-box' and e->'kinds' ? 'players'));
select pool_game_start('players', 'nhl-po-box', '{"preset": "quick"}') as bxp \gset
reset role;
select pg_temp.expect('it is on, from the first puck drop to the Cup, on each club''s expected games',
  (select rules->>'length' = 'playoffs' and (rules->>'playoffs')::boolean and rules->>'from' = (today_et() + 40)::text
     and jsonb_array_length(rules->'boxes') = 5
     -- forwards 1 to 15 score less down the list; BXA (the even ones) plays a game more
     and rules->'boxes'->0->'players' = '[990002, 990004, 990001, 990006, 990003]'::jsonb from pool_games where id = :bxp)
  and exists (select 1 from messages where league_id = :lib and body like '🏒 The playoff box pool is open: take one player from each of 5 boxes%all the way to the Cup%'));
select jsonb_build_object('players', jsonb_agg(b->'players'->0 order by o)) p1, jsonb_build_object('players', jsonb_agg(b->'players'->1 order by o)) p2
from pool_games, jsonb_array_elements(rules->'boxes') with ordinality x(b, o) where id = :bxp \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_pick(:bxp, 'box', :'p1');
select pg_temp.expect('before the puck drops: the playoffs, both clubs in, each player''s club expected to play its games',
  (select (b->'players'->>'playoffs')::boolean and (b->'players'->>'clubs_left')::int = 2 and not (b->'players'->>'locked')::boolean
     and (b->'players'->'boxes'->0->'players'->0->>'games')::int = 6 and (b->'players'->'boxes'->0->'players'->2->>'games')::int = 5
     and not (b->'players'->'boxes'->0->'players'->2->>'out')::boolean
   from (select pool_game_board(:bxp) b) x));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:bxp, 'box', :'p2');
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- Game 1 is played (a playoff game: type 3), and the standings task brings BXA's games to come down to five
insert into games (id, date, start_utc, home, away, state) values
  (2099030101, today_et() + 40, now() - interval '3 hours', 'BXA', 'BXB', 'OFF') on conflict do nothing;
insert into player_games (game_id, player_id, date, stats) values
  (2099030101, 990002, today_et() + 40, '{"g": 1, "a": 1}'), (2099030101, 990004, today_et() + 40, '{"g": 0, "a": 1}');
update nhl_teams set exp_po_games = 5 where abbrev = 'BXA';
update nhl_teams set exp_po_games = 4 where abbrev = 'BXB';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('locked at the first puck drop', format('select pool_game_pick(%s, %L, %L)', :bxp, 'box', :'p2'), 'locked');
select pg_temp.expect('a playoff game counts: Hana 2, Fern 1, and five games to come for BXA',
  (select (b->'players'->'boxes'->0->'players'->0->>'pts')::int = 2 and (b->'players'->'boxes'->0->'players'->0->>'left')::int = 5
     and (b->'players'->'boxes'->0->'players'->0->>'games')::int = 6
   from (select pool_game_board(:bxp) b) x));
reset role;
select pg_temp.expect('on the table too', (select points = 2 from _pool_game_table(:bxp) where team_id = :hana)
  and (select points = 1 from _pool_game_table(:bxp) where team_id = :fern));
select pg_temp.expect('the chances count each club''s games to come, and add up to one',
  (select abs(sum(chance) - 1) < 0.01 and max(chance) filter (where team_id = :hana) > max(chance) filter (where team_id = :fern)
   from _players_chances(:bxp)));
select _players_log(:lib) as bxpl \gset
select pg_temp.expect('each team''s forecast counts the games played and expected', :bxpl = 2
  and (select predicted > 0 from predictions where kind = 'box_points' and (subject->>'game')::bigint = :bxp and (subject->>'team_id')::int = :hana));
select pg_temp.expect('not done while the playoffs run', _players_settle(:lib) = 0);
-- BXA sweeps: BXB is out
update series set state = 'final', high_wins = 4, winner = high_club, updated_at = now() where competition = 'nhl-po-box';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('a club that loses is out: its players shaded, with nothing to come',
  (select (b->'players'->>'clubs_left')::int = 1 and (b->'players'->'boxes'->0->'players'->2->>'out')::boolean
     and (b->'players'->'boxes'->0->'players'->2->>'left')::int = 0 and (b->'players'->'boxes'->0->'players'->2->>'to_come')::numeric = 0
     and not (b->'players'->'boxes'->0->'players'->0->>'out')::boolean
   from (select pool_game_board(:bxp) b) x));
reset role;
select _players_settle(:lib) as bxpn \gset
select pg_temp.expect('the final is over: done, Hana wins it', :bxpn = 1
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :bxp));
delete from player_games where game_id = 2099030101;
delete from games where id = 2099030101;
update players set status = 'unrostered' where id between 990001 and 990025;
select set_config('request.jwt.claim.sub', '', false);
select 'box pool playoffs', true;

-- ───────────── the pool's split on a series (migration 205) ─────────────
-- A best-of-7 a day out: Hana and Fern take the high seed, Lou the low. At the first pitch the pool's split goes in the
-- log (two in three for the high seed); the low seed wins it, so the favourite was wrong.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('split-test', 'mlb', 'Split test', 'ST', '2026', 'mlb', 'st', '2026', true, 'series') on conflict (id) do nothing;
select sport_ingest('split-test', jsonb_build_object(
  'clubs', '[{"ext_id": "s91", "name": "Split High", "short": "SPH"}, {"ext_id": "s92", "name": "Split Low", "short": "SPL"}]'::jsonb,
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'split:1', 'round', 1, 'label', 'Split Series', 'short', 'SS', 'best_of', 7,
    'high', 's91', 'low', 's92', 'starts_at', now() + interval '1 day', 'tbd', false, 'sort', 1)),
  'fixtures', '[]'::jsonb));
select id as sps from series where ext_id = 'split:1' \gset
select high_club as sph, low_club as spl from series where id = :sps \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('series', 'split-test', '{"preset": "classic"}') as spg \gset
select pool_game_pick(:spg, 's:' || :sps, jsonb_build_object('winner', :sph, 'games', 5));
select pool_host_pick(:spg, :lou, jsonb_build_object('thing', 's:' || :sps, 'pick', jsonb_build_object('winner', :spl, 'games', 7)));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:spg, 's:' || :sps, jsonb_build_object('winner', :sph, 'games', 6));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('nothing is written before the first pitch', not exists (select 1 from predictions where kind = 'pool_split' and (subject->>'game')::bigint = :spg));
update series set state = 'live', starts_at = now() - interval '1 hour' where id = :sps;
select pg_temp.expect('at the first pitch the split is in the log: the high seed, two in three',
  (select predicted = 0.667 and status = 'open' and basis = 'mlb' and (detail->>'fav')::bigint = :sph and (detail->>'picks')::int = 3
   from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :spg, 'series', :sps)));
update series set state = 'final', winner = low_club, low_wins = 4, high_wins = 2 where id = :sps;
select pg_temp.expect('the low seed wins it: the favourite was wrong',
  (select status = 'scored' and outcome = 0 and error = -0.667 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :spg, 'series', :sps)));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the pool reads it back with its matches', exists (select 1 from crowd_calibration() where sport = 'mlb' and bucket = 0.6));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select 'series split', true;

-- ───────────── a postseason game by hand (migration 206) ─────────────
-- A best-of-3 whose feed stalls: a platform admin enters Game 1 (with its innings) and Game 2, the series is won, and
-- the feed's late, wrong Game 2 is ignored until the game is handed back.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('fix-test', 'mlb', 'Fix test', 'FX', '2026', 'mlb', 'fx', '2026', true, 'series') on conflict (id) do nothing;
select sport_ingest('fix-test', jsonb_build_object(
  'clubs', '[{"ext_id": "x91", "name": "Fix High", "short": "FXH"}, {"ext_id": "x92", "name": "Fix Low", "short": "FXL"}]'::jsonb,
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'fix:1', 'round', 1, 'label', 'Fix Series', 'short', 'FS', 'best_of', 3,
    'high', 'x91', 'low', 'x92', 'starts_at', now() - interval '1 day', 'tbd', false, 'sort', 1)),
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'fx1', 'series', 'fix:1', 'game_no', 1, 'kickoff', now() - interval '1 day', 'state', 'live', 'home', 'x91', 'away', 'x92', 'home_score', 1, 'away_score', 0),
    jsonb_build_object('ext_id', 'fx2', 'series', 'fix:1', 'game_no', 2, 'kickoff', now() - interval '3 hours', 'state', 'scheduled', 'home', 'x92', 'away', 'x91'))));
select id as fx1 from fixtures where provider = 'mlb' and ext_id = 'fx1' \gset
select id as fx2 from fixtures where provider = 'mlb' and ext_id = 'fx2' \gset
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('only a platform admin fixes a game', format('select platform_game_fix(%s, 3, 1, %L, null, %L)', :fx1, 'final', 'feed stalled'), 'Platform admins only');
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.raises('a reason goes on the record', format('select platform_game_fix(%s, 3, 1)', :fx1), 'Say why');
select pg_temp.raises('a playoff game has a winner', format('select platform_game_fix(%s, 2, 2, %L, null, %L)', :fx1, 'final', 'feed stalled'), 'has a winner');
select platform_game_fix(:fx1, 3, 1, 'final', '[{"n": 1, "home": 1, "away": 0}, {"n": 2, "home": 2, "away": 1}]', 'feed stalled after the 7th');
select platform_game_fix(:fx2, 2, 5, 'final', null, 'feed stalled');
reset role;
select pg_temp.expect('the series follows: two wins for the high seed, final, and the games are marked',
  (select state = 'final' and high_wins = 2 and low_wins = 0 and winner = high_club from series where provider = 'mlb' and ext_id = 'fix:1')
  and (select detail->'by_hand'->>'reason' = 'feed stalled after the 7th' from fixtures where id = :fx1)
  and (select count(*) = 2 from fixture_periods where fixture_id = :fx1));
-- the feed comes back with a wrong Game 2: it is left alone
select sport_ingest('fix-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'fx2', 'series', 'fix:1', 'game_no', 2, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', 'x92', 'away', 'x91', 'home_score', 9, 'away_score', 0))));
select pg_temp.expect('the feed leaves a game set by hand alone', (select home_score = 2 and away_score = 5 from fixtures where id = :fx2)
  and (select winner = high_club from series where provider = 'mlb' and ext_id = 'fix:1'));
select pg_temp.as_team(1);
set role authenticated;
select platform_game_fix(:fx2, null, null, null);
reset role;
select sport_ingest('fix-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'fx2', 'series', 'fix:1', 'game_no', 2, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', 'x92', 'away', 'x91', 'home_score', 9, 'away_score', 0))));
select pg_temp.expect('handed back, the feed writes it again and the series follows',
  (select home_score = 9 and not (detail ? 'by_hand') from fixtures where id = :fx2)
  and (select state = 'live' and high_wins = 1 and low_wins = 1 and winner is null from series where provider = 'mlb' and ext_id = 'fix:1'));
update competitions set active = false where id = 'fix-test';
select set_config('request.jwt.claim.sub', '', false);
select 'game by hand', true;

-- ───────────── the prop sheet (migration 208) ─────────────
-- Game 1 of a best-of-7 tomorrow. Hana and Lou (the host enters his) get seven of eight; Fern five. The home side wins 5-2,
-- led 1-0 after the 1st and 3-2 after five, nine innings, nobody shut out. Lou's total is spot on, so he takes it.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('props-test', 'mlb', 'Props test', 'PT', '2026', 'mlb', 'pt', '2026', true, 'series') on conflict (id) do nothing;
select sport_ingest('props-test', jsonb_build_object(
  'clubs', '[{"ext_id": "p91", "name": "Props Home", "short": "PH"}, {"ext_id": "p92", "name": "Props Away", "short": "PA"}]'::jsonb,
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'props:1', 'round', 1, 'label', 'Props Series', 'short', 'PS', 'best_of', 7,
    'high', 'p91', 'low', 'p92', 'starts_at', now() + interval '1 day', 'tbd', false, 'sort', 1)),
  'fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'pg1', 'series', 'props:1', 'game_no', 1, 'kickoff', now() + interval '1 day',
    'state', 'scheduled', 'home', 'p91', 'away', 'p92'))));
select id as pfx from fixtures where provider = 'mlb' and ext_id = 'pg1' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers a sheet on the game', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'props-test' and e->'kinds' ? 'props' and (e->'sheets'->0->>'id')::bigint = :pfx and e->'sheets'->0->>'away' = 'PA'));
select pool_game_start('props', 'props-test', jsonb_build_object('fixture', :pfx)) as prg \gset
select pg_temp.raises('one sheet a game', format('select pool_game_start(%L, %L, %L)', 'props', 'props-test', jsonb_build_object('fixture', :pfx)), 'already runs that game');
reset role;
select pg_temp.expect('eight calls in baseball''s words, the total at the usual 8.5, and the chat hears',
  (select title = 'Props · PS Game 1: PA at PH' and jsonb_array_length(rules->'questions') = 8
     and rules->'questions'->1->>'q' = 'Total runs: over or under 8.5?' and rules->'questions'->5->>'q' = 'A run in the 1st inning?'
   from pool_games where id = :prg)
  and exists (select 1 from messages where league_id = :lib and body = '📋 The prop sheet is open on PS Game 1: PA at PH: 8 calls on the game, a point each, and the total breaks a tie. It locks at the first pitch.'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('every call', format('select pool_game_pick(%s, %L, %L)', :prg, 'props', '{"answers": {"winner": "H"}, "total": 8}'), 'Make every call');
select pg_temp.raises('an answer on the sheet', format('select pool_game_pick(%s, %L, %L)', :prg, 'props',
  '{"answers": {"winner": "X", "total": "U", "margin": "2", "first": "H", "half": "H", "early": "Y", "extra": "N", "shutout": "Y"}, "total": 8}'), 'isn''t one of the answers');
select pool_game_pick(:prg, 'props', '{"answers": {"winner": "H", "total": "U", "margin": "2", "first": "H", "half": "H", "early": "Y", "extra": "N", "shutout": "Y"}, "total": 8}');
select pool_host_pick(:prg, :lou, '{"thing": "props", "pick": {"answers": {"winner": "H", "total": "U", "margin": "2", "first": "H", "half": "H", "early": "Y", "extra": "N", "shutout": "Y"}, "total": 7}}');
select pg_temp.expect('before the start nobody sees the split', (select b->'props'->'split' = 'null'::jsonb and (b->'props'->>'picked')::int = 2
  and b->'props'->'mine'->'answers'->>'margin' = '2' from (select pool_game_board(:prg) b) x));
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pool_game_pick(:prg, 'props', '{"answers": {"winner": "A", "total": "U", "margin": "1", "first": "H", "half": "A", "early": "Y", "extra": "N", "shutout": "N"}, "total": 9}');
select pg_temp.expect('the menu knows her sheet is in', (select (x->>'to_pick')::int = 0 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :prg));
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the first pitch: locked
select sport_ingest('props-test', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'pg1', 'series', 'props:1', 'game_no', 1,
  'kickoff', now() - interval '2 hours', 'state', 'live', 'home', 'p91', 'away', 'p92', 'home_score', 1, 'away_score', 0))));
select pg_temp.expect('at the first pitch each call''s split goes in the log (migration 210)', (select count(*) = 8 from predictions where kind = 'pool_split' and (subject->>'game')::bigint = :prg)
  and (select predicted = 0.667 and detail->>'fav' = 'H' and basis = 'mlb' from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :prg, 'call', 'winner')));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('the sheet locks at the first pitch', format('select pool_game_pick(%s, %L, %L)', :prg, 'props',
  '{"answers": {"winner": "H", "total": "U", "margin": "2", "first": "H", "half": "H", "early": "Y", "extra": "N", "shutout": "N"}, "total": 7}'), 'locked');
reset role;
select pg_temp.expect('once locked, a member with no sheet has nothing still possible (migration 213)', not exists (select 1 from _pool_game_table(:prg) where picked = 0 and possible > 0));
set role authenticated;
select pg_temp.expect('once it starts, the split and every sheet show', (select (b->'props'->'split'->'winner'->>'H')::int = 2 and jsonb_array_length(b->'props'->'sheets') = 3
  from (select pool_game_board(:prg) b) x));
select pg_temp.expect('once locked, each sheet has its chance to win (migration 218): Hana and Lou''s twin sheets alike, all of it shared out',
  (select abs(sum((e->>'chance')::numeric) - 1) < 0.01 and count(*) filter (where (e->>'chance')::numeric > 0) = 3
     and min((e->>'chance')::numeric) filter (where (e->>'team_id')::int in (:hana, :lou)) = max((e->>'chance')::numeric) filter (where (e->>'team_id')::int in (:hana, :lou))
   from jsonb_array_elements(pool_game_chances(:prg)) e));
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the home side wins 5-2 in nine
select sport_ingest('props-test', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'pg1', 'series', 'props:1', 'game_no', 1,
  'kickoff', now() - interval '2 hours', 'state', 'final', 'home', 'p91', 'away', 'p92', 'home_score', 5, 'away_score', 2,
  'periods', '[{"n": 1, "home": 1, "away": 0}, {"n": 2, "home": 0, "away": 0}, {"n": 3, "home": 0, "away": 1}, {"n": 4, "home": 2, "away": 0},
    {"n": 5, "home": 0, "away": 1}, {"n": 6, "home": 1, "away": 0}, {"n": 7, "home": 0, "away": 0}, {"n": 8, "home": 1, "away": 0}, {"n": 9, "home": null, "away": 0}]'::jsonb))));
select pg_temp.expect('done: Hana and Lou seven, Fern five, and Lou''s total takes it',
  (select status = 'done' and winners = array[:lou] from pool_games where id = :prg)
  and (select points = 7 and tiebreak = 1 from _pool_game_table(:prg) where team_id = :hana)
  and (select points = 5 from _pool_game_table(:prg) where team_id = :fern)
  and (select points = 7 and tiebreak = 0 from _pool_game_table(:prg) where team_id = :lou));
select pg_temp.expect('each call''s split is scored on its answer', (select status = 'scored' and outcome = 1 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :prg, 'call', 'winner'))
  and (select status = 'scored' and outcome = 0 from predictions where kind = 'pool_split' and subject = jsonb_build_object('game', :prg, 'call', 'shutout')));
select pg_temp.expect('the chat hears, and each sheet hears how it did', exists (select 1 from messages where league_id = :lib
    and body = '📋 The prop sheet on PA at PH is done: Lou, with 7 of 8 right.')
  and exists (select 1 from notifications where team_id = :lou and body = '📋 PA at PH: you called 7 of 8. You won the sheet.')
  and exists (select 1 from notifications where team_id = :fern and body = '📋 PA at PH: you called 5 of 8.'));
select set_config('app.league_id', :'lib', false);
select pg_temp.expect('and the scoreboard reads it', exists (select 1 from _pool_rows() r where r.game = 'game:' || :prg and r.kind = 'props' and r.team_id = :lou and r.line = '7 right'));
select set_config('app.league_id', '', false);
-- a Game 5 the series never needs (migration 209): a sheet on it ends with no winner, and it isn't offered once the series is over
select sport_ingest('props-test', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'pg5', 'series', 'props:1', 'game_no', 5,
  'kickoff', now() + interval '3 days', 'state', 'scheduled', 'home', 'p91', 'away', 'p92'))));
select id as pfx5 from fixtures where provider = 'mlb' and ext_id = 'pg5' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
-- calls a host hands in are ignored: the sheet is always the server's (migration 214)
select pool_game_start('props', 'props-test', jsonb_build_object('fixture', :pfx5, 'questions', '[{"q": "x"}]'::jsonb)) as prg5 \gset
select pg_temp.raises('a sheet has no rules to change', format('select pool_game_set_rules(%s, %L)', :prg5, '{"questions": []}'), 'no rules to change');
select pg_temp.expect('the sheet is the server''s eight calls', (select jsonb_array_length(rules->'questions') = 8 and rules->'questions'->0->>'key' = 'winner' from pool_games where id = :prg5));
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the series is over in four
update series set state = 'final', winner = high_club, high_wins = 4 where provider = 'mlb' and ext_id = 'props:1';
select _props_tick('props-test');
select pg_temp.expect('a game the series didn''t need: done, no winner, and the chat hears',
  (select status = 'done' and winners = '{}' from pool_games where id = :prg5)
  and exists (select 1 from messages where league_id = :lib and body = '📋 The series ended before PA at PH, so its prop sheet counts for nobody.')
  and jsonb_array_length(_props_games('props-test')) = 0);
update competitions set active = false where id = 'props-test';
select set_config('request.jwt.claim.sub', '', false);
select 'prop sheet', true;

-- ───────────── the Eliminator (migration 212) ─────────────
-- A four-team tournament of single games. Round 1: Hana takes Ash, Fern takes Dale, Lou takes Cove; Ash and Dale win, so
-- Lou is out. The final is Ash against Dale: each has used one of them, so Hana must take Dale and Fern Ash. Ash wins it.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
update pool_games set status = 'done' where kind = 'survivor' and league_id = :lib and status = 'open';
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('elim-test', 'ncaab', 'Elim Test', 'ET', '2027', 'espn', 'basketball/elim', '2027', true, 'series') on conflict (id) do nothing;
select sport_ingest('elim-test', jsonb_build_object(
  'clubs', '[{"ext_id": "e1", "name": "Ash", "short": "ASH"}, {"ext_id": "e2", "name": "Birch", "short": "BIR"}, {"ext_id": "e3", "name": "Cove", "short": "COV"}, {"ext_id": "e4", "name": "Dale", "short": "DAL"}]'::jsonb,
  'series', '[{"ext_id": "elim:1", "round": 1, "label": "Semifinal", "best_of": 1, "high": "e1", "low": "e2", "sort": 1},
              {"ext_id": "elim:2", "round": 1, "label": "Semifinal", "best_of": 1, "high": "e3", "low": "e4", "sort": 2},
              {"ext_id": "elim:3", "round": 2, "label": "Final", "best_of": 1, "sort": 3}]'::jsonb,
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'eg1', 'series', 'elim:1', 'game_no', 1, 'kickoff', now() + interval '1 day', 'state', 'scheduled', 'home', 'e1', 'away', 'e2'),
    jsonb_build_object('ext_id', 'eg2', 'series', 'elim:2', 'game_no', 1, 'kickoff', now() + interval '1 day', 'state', 'scheduled', 'home', 'e3', 'away', 'e4'))));
select (select id from clubs where provider = 'espn' and sport = 'ncaab' and ext_id = 'e1') as eash, (select id from clubs where provider = 'espn' and sport = 'ncaab' and ext_id = 'e3') as ecove,
  (select id from clubs where provider = 'espn' and sport = 'ncaab' and ext_id = 'e4') as edale \gset
select pg_temp.expect('a single game carries its round', (select gameweek = 1 from fixtures where provider = 'espn' and ext_id = 'eg1'));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers the Eliminator on the tournament', exists (select 1 from jsonb_array_elements(pool_event_list()) e
  where e->>'competition' = 'elim-test' and e->'kinds' ? 'survivor'));
select pool_game_start('survivor', 'elim-test') as esv \gset
select survivor_pick(:esv, :eash);
reset role;
select pg_temp.expect('it runs from round 1 to the final', (select start_gw = 1 and end_gw = 2 from pool_survivors where id = :esv));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select survivor_pick(:esv, :edale);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select survivor_host_pick(:esv, :lou, :ecove);
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- round 1: Ash and Dale win; the final's matchup is set and its game comes in, carrying round 2
select sport_ingest('elim-test', jsonb_build_object(
  'series', '[{"ext_id": "elim:3", "round": 2, "label": "Final", "best_of": 1, "high": "e1", "low": "e4", "sort": 3}]'::jsonb,
  'fixtures', jsonb_build_array(
    jsonb_build_object('ext_id', 'eg1', 'series', 'elim:1', 'game_no', 1, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', 'e1', 'away', 'e2', 'home_score', 70, 'away_score', 61),
    jsonb_build_object('ext_id', 'eg2', 'series', 'elim:2', 'game_no', 1, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', 'e3', 'away', 'e4', 'home_score', 58, 'away_score', 66),
    jsonb_build_object('ext_id', 'eg3', 'series', 'elim:3', 'game_no', 1, 'kickoff', now() + interval '2 days', 'state', 'scheduled', 'home', 'e1', 'away', 'e4'))));
select pg_temp.expect('Lou is out, the other two through, and it goes on to the final',
  (select status = 'open' from pool_games where id = :esv) and not _survivor_alive(:esv, :lou) and _survivor_alive(:esv, :hana) and _survivor_alive(:esv, :fern)
  and _survivor_week(:esv) = 2);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a team once', format('select survivor_pick(%s, %s)', :esv, :eash), 'used that team already');
select survivor_pick(:esv, :edale);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select survivor_pick(:esv, :eash);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select sport_ingest('elim-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'eg3', 'series', 'elim:3', 'game_no', 1, 'kickoff', now() - interval '2 hours', 'state', 'final', 'home', 'e1', 'away', 'e4', 'home_score', 75, 'away_score', 72))));
select pg_temp.expect('Ash takes the final: Fern is the last one standing',
  (select status = 'done' and winners = array[:fern] from pool_games where id = :esv));
update competitions set active = false where id = 'elim-test';
select set_config('request.jwt.claim.sub', '', false);
select 'eliminator', true;

-- ───────────── a prop sheet on an NFL week (migration 216) ─────────────
-- Week 11, tomorrow: Hana fills a sheet. The home side wins 24-20, 7-3 after the 1st, 17-10 at the half, 10 points in the
-- 1st quarter, no overtime, nobody held to 10: everything she called but the last.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-211', 'gameweek', 11, 'kickoff', now() + interval '1 day', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'))));
select id as wkf from fixtures where provider = 'espn' and ext_id = 'nfl-211' \gset
select pg_temp.expect('an NFL week''s game takes a sheet', exists (select 1 from jsonb_array_elements(_props_games('nfl')) g where (g->>'id')::bigint = :wkf and g->>'label' = 'Week 11'));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('props', 'nfl', jsonb_build_object('fixture', :wkf)) as wkp \gset
select pool_game_pick(:wkp, 'props', '{"answers": {"winner": "H", "total": "U", "margin": "1", "first": "H", "half": "H", "early": "O", "extra": "N", "held": "Y"}, "total": 45}');
reset role;
select pg_temp.expect('in football''s words, from the week', (select title like 'Props · Week 11: %' and rules->'questions'->5->>'q' = '1st-quarter points: over or under 9.5?' from pool_games where id = :wkp));
select set_config('request.jwt.claim.sub', '', false);
-- under way (migration 218): the 1st quarter is over at 7-3, so the leader after it and its ten points are in; who wins,
-- the total and a side held to 10 wait. Two right so far, the other six still possible, and the only sheet in can't lose.
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-211', 'gameweek', 11, 'kickoff', now() - interval '40 minutes', 'status', 'LIVE', 'home', 'nf1', 'away', 'nf2',
    'home_score', 7, 'away_score', 3, 'periods', '[{"n": 1, "home": 7, "away": 3}, {"n": 2, "home": 0, "away": 0}]'::jsonb))));
select pg_temp.expect('a sheet scores as the game goes',
  (select points = 2 and possible = 8 from _props_table(:wkp) where team_id = :hana)
  and (select a->>'first' = 'H' and a->>'early' = 'O' and a->'winner' = 'null'::jsonb and a->'held' = 'null'::jsonb from (select _props_answers(:wkp) a) x)
  and (select status = 'open' from pool_games where id = :wkp));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the board shows the calls decided, and the one sheet in is sure to win',
  (select b->'answers'->>'first' = 'H' from (select pool_game_board(:wkp)->'props' b) x)
  and (select (e->>'chance')::numeric = 1 from jsonb_array_elements(pool_game_chances(:wkp)) e where (e->>'team_id')::int = :hana));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-211', 'gameweek', 11, 'kickoff', now() - interval '4 hours', 'status', 'FT', 'home', 'nf1', 'away', 'nf2',
    'home_score', 24, 'away_score', 20, 'home_ft', 24, 'away_ft', 20,
    'periods', '[{"n": 1, "home": 7, "away": 3}, {"n": 2, "home": 10, "away": 7}, {"n": 3, "home": 0, "away": 7}, {"n": 4, "home": 7, "away": 3}]'::jsonb))));
select pg_temp.expect('the quarters are in, and the sheet settles itself: seven of eight',
  (select count(*) = 4 from fixture_periods where fixture_id = :wkf)
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :wkp)
  and (select points = 7 and tiebreak = 1 from _pool_game_table(:wkp) where team_id = :hana));
select set_config('request.jwt.claim.sub', '', false);
select 'nfl week sheet', true;

-- ───────────── squares on an NFL week's game (migration 217) ─────────────
-- Monday night of Week 12: Hana opens a 5 by 5 grid on the one game, takes three squares and the rest stay empty.
-- Kickoff draws the digits, each quarter pays to the square named or the next claimed one along, and a level final is
-- still the last: the grid is done, the whole pot to Hana.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-212', 'gameweek', 12, 'kickoff', now() + interval '2 days', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'))));
select id as wsf from fixtures where provider = 'espn' and ext_id = 'nfl-212' \gset
select pg_temp.expect('a week''s games are offered for a grid, apart from the series grids',
  exists (select 1 from jsonb_array_elements(pool_event_list()) e, jsonb_array_elements(e->'game_grids') g
          where e->>'competition' = 'nfl' and (g->>'id')::bigint = :wsf and e->'grids' = '[]'::jsonb));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('squares', 'nfl', jsonb_build_object('fixture', :wsf, 'size', 5, 'cost', 10)) as wsq \gset
select pg_temp.raises('one grid on a game', format('select pool_game_start(%L, %L, %L)', 'squares', 'nfl', jsonb_build_object('fixture', :wsf)), 'already runs');
select pg_temp.raises('a game already played takes no grid', format('select pool_game_start(%L, %L, %L)', 'squares', 'nfl', jsonb_build_object('fixture', :wkf)), 'has started');
select pool_squares_claim(:wsq, array['sq:0:0', 'sq:2:3', 'sq:4:4']);
select pg_temp.expect('the board reads the week''s game as a series of one',
  (select b->'series'->>'label' = 'Week 12' and (b->'series'->>'fixture')::bigint = :wsf and (b->'series'->>'best_of')::int = 1
     and b->'top'->>'short' = 'KC' and b->'side'->>'short' = 'BUF' and (b->>'claimed')::int = 3 and (b->>'pot')::int = 30
     and b->'words'->>'start' = 'kickoff' and jsonb_array_length(b->'games') = 1 and (b->'games'->0->>'game_no')::int = 1
     from (select pool_game_board(:wsq)->'squares' b) x)
  and (select (x->>'to_pick')::int = 0 from jsonb_array_elements(pool_games_list()) x where (x->>'id')::bigint = :wsq));
reset role;
select pg_temp.expect('in football''s words, from the week', (select title = 'Week 12: BUF at KC squares' and rules->>'pays' = 'quarters'
    and rules ? 'fixture' and not rules ? 'series' from pool_games where id = :wsq)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 Week 12: BUF at KC squares are open: 10 coins a square, 25 squares%at kickoff, and the pot pays after the 1st quarter%'));
select set_config('request.jwt.claim.sub', '', false);
-- kickoff, a 7-3 first quarter with the second under way
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-212', 'gameweek', 12, 'kickoff', now() - interval '20 minutes', 'status', 'LIVE', 'home', 'nf1', 'away', 'nf2',
    'home_score', 7, 'away_score', 3, 'periods', '[{"n": 1, "home": 7, "away": 3}, {"n": 2, "home": 0, "away": 0}]'::jsonb))));
select pg_temp.expect('kickoff draws the grid, and the 1st quarter pays a fifth of the pot',
  (select draw->>'why' = 'kickoff' and (draw->>'pot')::int = 30 and (draw->>'top')::bigint = (select home_club from fixtures where id = :wsf) from pool_games where id = :wsq)
  and (select count(*) = 1 and min(coins) = 6 and min(point) = 1 and min(game_no) = 1 and bool_and(team_id = :hana) from pool_square_pays where game_id = :wsq)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 After the 1st quarter: KC 7, BUF 3. Hana%square takes 6 coins.'));
-- a level final, 20-20, after 10-10 at the half and 17-10 after three
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-212', 'gameweek', 12, 'kickoff', now() - interval '4 hours', 'status', 'FT', 'home', 'nf1', 'away', 'nf2',
    'home_score', 20, 'away_score', 20, 'home_ft', 20, 'away_ft', 20,
    'periods', '[{"n": 1, "home": 7, "away": 3}, {"n": 2, "home": 3, "away": 7}, {"n": 3, "home": 7, "away": 0}, {"n": 4, "home": 3, "away": 10}]'::jsonb))));
select pg_temp.expect('the half, the 3rd and a level final pay, the whole pot to Hana, and the grid is done',
  (select array_agg(top_runs || '-' || side_runs order by case when point = 0 then 99 else point end) = array['7-3', '10-10', '17-10', '20-20']
     and sum(coins) = 30 from pool_square_pays where game_id = :wsq)
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :wsq));
select set_config('app.league_id', '', false);
-- (migration 219) a grid on a game called off hands its coins back; one on a game that lands final with no score by
-- quarter pays the final alone, the whole pot, and never the 0-0 square for the quarters it didn't see
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-213', 'gameweek', 13, 'kickoff', now() + interval '3 days', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'),
  jsonb_build_object('ext_id', 'nfl-214', 'gameweek', 14, 'kickoff', now() + interval '10 days', 'status', 'NS', 'home', 'nf2', 'away', 'nf1', 'round', 'Week 14'))));
select id as wcf from fixtures where provider = 'espn' and ext_id = 'nfl-213' \gset
select id as wnf from fixtures where provider = 'espn' and ext_id = 'nfl-214' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('squares', 'nfl', jsonb_build_object('fixture', :wcf, 'size', 5, 'cost', 10)) as wcq \gset
select pool_game_start('squares', 'nfl', jsonb_build_object('fixture', :wnf, 'size', 5, 'cost', 10)) as wnq \gset
select pool_squares_claim(:wcq, array['sq:1:1', 'sq:3:3']);
select pool_squares_claim(:wnq, array['sq:0:0', 'sq:1:2']);
reset role;
select set_config('request.jwt.claim.sub', '', false);
select coalesce(sum(amount), 0) as before_cx from coin_ledger where team_id = :hana \gset
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-213', 'gameweek', 13, 'kickoff', now() - interval '1 hour', 'status', 'CANC', 'home', 'nf1', 'away', 'nf2'),
  jsonb_build_object('ext_id', 'nfl-214', 'gameweek', 14, 'kickoff', now() - interval '4 hours', 'status', 'FT', 'home', 'nf2', 'away', 'nf1', 'round', 'Week 14',
    'home_score', 13, 'away_score', 10, 'home_ft', 13, 'away_ft', 10))));
select pg_temp.expect('a game called off: the grid is done and Hana has her 20 coins back',
  (select status = 'done' and winners = '{}' and draw is null from pool_games where id = :wcq)
  and (select sum(amount) from coin_ledger where team_id = :hana) - :before_cx = 20 + 20
  and exists (select 1 from coin_ledger where team_id = :hana and amount = 20 and reason like 'Squares back: Week 13: BUF at KC squares · called off'));
select pg_temp.expect('a final with no quarters pays the final alone, the whole pot, and the week reads as the feed names it',
  (select count(*) = 1 and min(point) = 0 and sum(coins) = 20 from pool_square_pays where game_id = :wnq)
  and (select status = 'done' and title = 'Week 14: KC at BUF squares' from pool_games where id = :wnq));
select set_config('app.league_id', '', false);
select 'nfl week squares', true;

-- ───────────── prop sheets on every game, automatically (migration 223) ─────────────
-- Hana turns them on for the NFL: a sheet opens at once on each game within a day and a half that has none (tonight's
-- Week 15 game), not on the one three days off; the hourly job opens nothing twice; a member can't turn it on; off is off.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-215', 'gameweek', 15, 'kickoff', now() + interval '20 hours', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'),
  jsonb_build_object('ext_id', 'nfl-216', 'gameweek', 15, 'kickoff', now() + interval '3 days', 'status', 'NS', 'home', 'nf2', 'away', 'nf1'))));
select id as af1 from fixtures where provider = 'espn' and ext_id = 'nfl-215' \gset
select id as af2 from fixtures where provider = 'espn' and ext_id = 'nfl-216' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000082', false);
set role authenticated;
select pg_temp.raises('only the host turns it on', format('select pool_auto_sheets_set(%L, true)', 'nfl'), 'Commissioner only');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_auto_sheets_set('nfl', true) as opened \gset
reset role;
select pg_temp.expect('on: tonight''s game has its sheet, the one three days off waits',
  :opened >= 1
  and exists (select 1 from pool_games where league_id = :lib and kind = 'props' and (rules->>'fixture')::bigint = :af1 and status = 'open')
  and not exists (select 1 from pool_games where league_id = :lib and kind = 'props' and (rules->>'fixture')::bigint = :af2)
  and exists (select 1 from pool_auto_sheets where league_id = :lib and competition = 'nfl'));
select count(*) as sheets_now from pool_games where league_id = :lib and kind = 'props' \gset
select pg_temp.expect('the hourly job opens nothing twice', _props_auto(:lib) = 0
  and (select count(*) from pool_games where league_id = :lib and kind = 'props') = :sheets_now);
set role authenticated;
select pool_auto_sheets_set('nfl', false);
reset role;
select pg_temp.expect('off is off', not exists (select 1 from pool_auto_sheets where league_id = :lib));
-- from the start page (migration 227): a new pool's first sheet can turn on a sheet for every game too
select set_config('request.jwt.claim.sub', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'nfl-217', 'gameweek', 15, 'kickoff', now() + interval '2 days', 'status', 'NS', 'home', 'nf2', 'away', 'nf1'))));
select id as af3 from fixtures where provider = 'espn' and ext_id = 'nfl-217' \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_start_games(:lib, jsonb_build_array(jsonb_build_object('kind', 'props', 'competition', 'nfl', 'rules', jsonb_build_object('fixture', :af3, 'auto', true))));
reset role;
select pg_temp.expect('the chosen game has its sheet and every game will', exists (select 1 from pool_games where league_id = :lib and kind = 'props'
    and (rules->>'fixture')::bigint = :af3 and not rules ? 'auto')
  and exists (select 1 from pool_auto_sheets where league_id = :lib and competition = 'nfl'));
set role authenticated;
select pool_auto_sheets_set('nfl', false);
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
select pg_temp.expect('every NFL sheet added up on the scoreboard (migration 226): Hana''s seven, and the Week 11 sheet she won',
  exists (select 1 from _pool_rows() r where r.game = 'props:nfl' and r.kind = 'props_all' and r.team_id = :hana and r.score >= 7
          and r.tiebreak = -1 and r.line like '%right on 1 sheet, 1 won' and r.title = 'Every prop sheet · ' || (select name from competitions where id = 'nfl')));
-- a second sheet in (tonight's game): two sheets on the row, its eight calls still possible on top
select (select possible from _pool_rows() r where r.game = 'props:nfl' and r.team_id = :hana) as allposs \gset
set role authenticated;
select pool_game_pick((select id from pool_games where league_id = :lib and kind = 'props' and (rules->>'fixture')::bigint = :af1),
  'props', '{"answers": {"winner": "H", "total": "O", "margin": "8", "first": "H", "half": "H", "early": "O", "extra": "N", "held": "N"}, "total": 50}');
reset role;
select pg_temp.expect('two sheets added up', exists (select 1 from _pool_rows() r where r.game = 'props:nfl' and r.team_id = :hana
  and r.line like '%right on 2 sheets, 1 won' and r.score >= 7 and r.possible = :allposs));
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'automatic sheets', true;

-- ───────────── the pools in play, for the platform (migration 224) ─────────────
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a host is not a platform admin', 'select platform_pool_games()', 'Platform admins only');
reset role;
select pg_temp.as_team(1);
set role authenticated;
select pg_temp.expect('the platform sees each pool''s games, who has picked and its automatic events',
  exists (select 1 from jsonb_array_elements(platform_pool_games()) l where (l->>'league_id')::int = :lib
          and jsonb_array_length(l->'games') > 5 and exists (select 1 from jsonb_array_elements(l->'games') g where (g->>'pickers')::int >= 1)));
reset role;
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'platform pool games', true;

-- ───────────── a nudge for the host (migration 230) ─────────────
-- A pool that follows an event through its pack, with no game on it, hears once a round when the next round is near.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format, pack)
values ('nudge-test', 'mlb', 'Nudge test', 'NT', '2026', 'mlb', 'nt', '2026', true, 'series', 'love-is-blind-s11') on conflict (id) do nothing;
select sport_ingest('nudge-test', jsonb_build_object('series', jsonb_build_array(jsonb_build_object('ext_id', 'nudge:1', 'round', 2, 'label', 'NL Championship Series',
  'short', 'NLCS', 'best_of', 7, 'high', 'p91', 'low', 'p92', 'starts_at', now() + interval '30 hours', 'tbd', false, 'sort', 1))));
select set_config('app.league_id', :'lib', false);
select _pool_host_nudge(:lib) as nudge1 \gset
select pg_temp.expect('the host hears the round is near, once', :nudge1 = 1 and _pool_host_nudge(:lib) = 0
  and exists (select 1 from notifications where team_id = :hana and body like '🎯 The Championship Series starts %. Add a game on it for the pool%' and link = '/host'));
update competitions set active = false, pack = null where id = 'nudge-test';
select set_config('app.league_id', '', false);
select 'host nudge', true;

-- ───────────── the daily streak (migration 231) ─────────────
-- Four NFL days ahead, one game each and a second on the fourth. Hana starts the streak and picks the home side on days
-- one, two and four, the visitors on day three. Home sides win all four: two right, a miss, one right; her best run is 2
-- and she is on 1.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select soccer_ingest('nfl', jsonb_build_object('fixtures', (select jsonb_agg(jsonb_build_object('ext_id', 'nfl-30' || d, 'gameweek', 14,
  'kickoff', ((current_date + d)::timestamp + time '13:00') at time zone 'America/New_York',
  'status', 'NS', 'home', 'nf1', 'away', 'nf2')) from generate_series(1, 4) d)));
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'nfl-305', 'gameweek', 14,
  'kickoff', ((current_date + 4)::timestamp + time '13:05') at time zone 'America/New_York', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'))));
select (select id from fixtures where ext_id = 'nfl-301') st1, (select id from fixtures where ext_id = 'nfl-302') st2,
  (select id from fixtures where ext_id = 'nfl-303') st3, (select id from fixtures where ext_id = 'nfl-304') st4,
  (select id from fixtures where ext_id = 'nfl-305') st5 \gset
select set_config('app.league_id', :'lib', false);
select pg_temp.expect('the NFL offers the streak', exists (select 1 from jsonb_array_elements(pool_event_list()) e where e->>'competition' = 'nfl' and e->'kinds' ? 'streak'));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('streak', 'nfl') as stg \gset
select pg_temp.raises('one streak an event', 'select pool_game_start(''streak'', ''nfl'')', 'This pool already runs that game');
select pool_game_pick(:stg, 'streak', jsonb_build_object('fixture', :st1, 'pick', 'H'));
select pool_game_pick(:stg, 'streak', jsonb_build_object('fixture', :st2, 'pick', 'H'));
select pool_game_pick(:stg, 'streak', jsonb_build_object('fixture', :st3, 'pick', 'A'));
select pool_game_pick(:stg, 'streak', jsonb_build_object('fixture', :st5, 'pick', 'A'));
select pool_game_pick(:stg, 'streak', jsonb_build_object('fixture', :st4, 'pick', 'H'));
select pg_temp.raises('no draws in football', format('select pool_game_pick(%s, ''streak'', ''{"fixture": %s, "pick": "D"}'')', :stg, :st1), 'Pick one of the two sides');
-- the host can enter a member's pick (migration 232); here Hana's own, through the same door
select pool_host_pick(:stg, :hana, jsonb_build_object('thing', 'streak', 'pick', jsonb_build_object('fixture', :st1, 'pick', 'H')));
select pg_temp.expect('the board has the next three days with games, the first day''s pick in',
  (select jsonb_array_length(b->'days') = 3 from (select pool_game_board(:stg)->'streak' b) x)
  and (select (d->'mine'->>'fixture')::bigint = :st1 and x->'locked' = 'false' and x->'calls' = 'null'::jsonb and x->>'label' = 'Week 14'
       from jsonb_array_elements(pool_game_board(:stg)->'streak'->'days') d cross join jsonb_array_elements(d->'games') x
       where (d->>'day')::date = current_date + 1 and (x->>'id')::bigint = :st1)
  -- and the list counts the next day with games as one to pick until it is picked
  and (select (g->>'to_pick')::int = case when exists (select 1 from jsonb_array_elements(pool_game_board(:stg)->'streak'->'days') d
                                                       where d->'mine' = 'null'::jsonb and (d->>'day')::date = (select min((f.kickoff at time zone 'America/New_York')::date) from fixtures f
                                                         where f.competition = 'nfl' and f.state = 'scheduled' and f.kickoff > now() and f.home_club is not null))
                                          then 1 else 0 end
       from jsonb_array_elements(pool_games_list()) g where (g->>'id')::bigint = :stg));
reset role;
select pg_temp.expect('one pick a day: the fourth day''s moved from the late game to the early one',
  (select count(*) = 4 from pool_picks where game_id = :stg)
  and (select (pick->>'fixture')::bigint = :st4 from pool_picks where game_id = :stg and thing = 'd:' || (current_date + 4)));
select set_config('request.jwt.claim.sub', '', false);
-- the fourth day's early game starts: the day's pick stays, even for the late game still to come
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'nfl-304', 'gameweek', 14,
  'kickoff', ((current_date + 4)::timestamp + time '13:00') at time zone 'America/New_York', 'status', 'LIVE', 'home', 'nf1', 'away', 'nf2', 'home_score', 0, 'away_score', 0))));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('a day''s pick stays once its game starts', format('select pool_game_pick(%s, ''streak'', ''{"fixture": %s, "pick": "H"}'')', :stg, :st5), 'Your pick for that day has started');
reset role;
select set_config('request.jwt.claim.sub', '', false);
-- the four games end, home sides all: right, right, wrong, right
select soccer_ingest('nfl', jsonb_build_object('fixtures', (select jsonb_agg(jsonb_build_object('ext_id', 'nfl-30' || d, 'gameweek', 14,
  'kickoff', now() - make_interval(days => 5 - d), 'status', 'FT', 'home', 'nf1', 'away', 'nf2', 'home_score', 24, 'away_score', 17, 'home_ft', 24, 'away_ft', 17))
  from generate_series(1, 4) d)));
select pg_temp.expect('best run 2, on 1 now, three right from four',
  (select points = 2 and exact = 1 and right_calls = 3 and picked = 4 and tiebreak = -1 from _pool_game_table(:stg) where team_id = :hana)
  and (select line = 'Best run 2, 1 now' and score = 2 and possible is null from _pool_rows() where game = 'game:' || :stg and team_id = :hana));
-- a day's first game under six hours away and no pick for it: a reminder, once
select soccer_ingest('nfl', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'nfl-306', 'gameweek', 14,
  'kickoff', now() + interval '2 hours', 'status', 'NS', 'home', 'nf1', 'away', 'nf2'))));
select _pool_game_nudge(:lib) as stn \gset
select pg_temp.expect('a reminder before the day''s first game, once',
  (select count(*) = 1 from notifications where team_id = :hana and body like '🔥 The day''s first game starts in%')
  and _pool_game_nudge(:lib) = 0);
update fixtures set state = 'cancelled' where ext_id in ('nfl-305', 'nfl-306');
-- the streak ends with its event (migration 233): a one-game event, Hana's pick right, the pool job crowns her
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active)
values ('st-end', 'mlb', 'Streak test', 'ST', '2026', 'mlb-statsapi', 'ste', '2026', true) on conflict (id) do nothing;
insert into fixtures (sport, competition, provider, ext_id, season, gameweek, kickoff, date, home_club, away_club, state)
select 'mlb', 'st-end', 'mlb-statsapi', 'ste-1', '2026', 1, now() + interval '2 days', (now() + interval '2 days')::date, home_club, away_club, 'scheduled'
from fixtures where id = :st1;
select id as se1 from fixtures where ext_id = 'ste-1' \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('streak', 'st-end') as seg \gset
select pool_game_pick(:seg, 'streak', jsonb_build_object('fixture', :se1, 'pick', 'A'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('a streak stays open while its event has a game to come', _streak_close(:lib) = 0);
update fixtures set state = 'final', kickoff = now() - interval '3 hours', home_score = 2, away_score = 5 where id = :se1;
select _streak_close(:lib) as sc1 \gset
select _streak_close(:lib) as sc2 \gset
select pg_temp.expect('and ends with it: Hana''s run of 1 wins, and the pool hears, once',
  :sc1 = 1 and :sc2 = 0
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :seg)
  and exists (select 1 from messages where league_id = :lib and body like '🔥 The daily streak is over: % won it with a run of 1.'));
update competitions set active = false where id = 'st-end';
select set_config('app.league_id', '', false);
select 'daily streak', true;

-- ───────────── the Stanley Cup playoffs as series (migration 191) ─────────────
-- The 2026 playoffs as mlb-sync files them from the NHL's bracket (logos, venues and details left out): every series'
-- result as the NHL had it, and a bracket from the first round, the letters' order making the tree.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('nhl-po-test', 'nhl', 'Stanley Cup Playoffs (test)', 'NHL', '2026', 'nhl-api', 'nhl', '20252026', true, 'series') on conflict (id) do nothing;
select sport_ingest('nhl-po-test', '{"clubs":[{"ext_id":"7","name":"Buffalo Sabres","short":"BUF","color":null,"logo":null},{"ext_id":"6","name":"Boston Bruins","short":"BOS","color":null,"logo":null},{"ext_id":"14","name":"Tampa Bay Lightning","short":"TBL","color":null,"logo":null},{"ext_id":"8","name":"Montr\u00e9al Canadiens","short":"MTL","color":null,"logo":null},{"ext_id":"12","name":"Carolina Hurricanes","short":"CAR","color":null,"logo":null},{"ext_id":"9","name":"Ottawa Senators","short":"OTT","color":null,"logo":null},{"ext_id":"5","name":"Pittsburgh Penguins","short":"PIT","color":null,"logo":null},{"ext_id":"4","name":"Philadelphia Flyers","short":"PHI","color":null,"logo":null},{"ext_id":"21","name":"Colorado Avalanche","short":"COL","color":null,"logo":null},{"ext_id":"26","name":"Los Angeles Kings","short":"LAK","color":null,"logo":null},{"ext_id":"25","name":"Dallas Stars","short":"DAL","color":null,"logo":null},{"ext_id":"30","name":"Minnesota Wild","short":"MIN","color":null,"logo":null},{"ext_id":"54","name":"Vegas Golden Knights","short":"VGK","color":null,"logo":null},{"ext_id":"68","name":"Utah Mammoth","short":"UTA","color":null,"logo":null},{"ext_id":"22","name":"Edmonton Oilers","short":"EDM","color":null,"logo":null},{"ext_id":"24","name":"Anaheim Ducks","short":"ANA","color":null,"logo":null}],"series":[{"ext_id":"20252026:A","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"7","low":"6","starts_at":"2026-04-19T23:30:00Z","tbd":false,"sort":1},{"ext_id":"20252026:B","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"14","low":"8","starts_at":"2026-04-19T21:45:00Z","tbd":false,"sort":2},{"ext_id":"20252026:C","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"12","low":"9","starts_at":"2026-04-18T19:00:00Z","tbd":false,"sort":3},{"ext_id":"20252026:D","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"5","low":"4","starts_at":"2026-04-19T00:00:00Z","tbd":false,"sort":4},{"ext_id":"20252026:E","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"21","low":"26","starts_at":"2026-04-19T19:00:00Z","tbd":false,"sort":5},{"ext_id":"20252026:F","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"25","low":"30","starts_at":"2026-04-18T21:30:00Z","tbd":false,"sort":6},{"ext_id":"20252026:G","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"54","low":"68","starts_at":"2026-04-20T02:00:00Z","tbd":false,"sort":7},{"ext_id":"20252026:H","round":1,"label":"1st Round","short":"R1","best_of":7,"high":"22","low":"24","starts_at":"2026-04-21T02:00:00Z","tbd":false,"sort":8},{"ext_id":"20252026:I","round":2,"label":"2nd Round","short":"R2","best_of":7,"high":"7","low":"8","starts_at":"2026-05-06T23:00:00Z","tbd":false,"sort":9},{"ext_id":"20252026:J","round":2,"label":"2nd Round","short":"R2","best_of":7,"high":"12","low":"4","starts_at":"2026-05-03T00:00:00Z","tbd":false,"sort":10},{"ext_id":"20252026:K","round":2,"label":"2nd Round","short":"R2","best_of":7,"high":"21","low":"30","starts_at":"2026-05-04T01:00:00Z","tbd":false,"sort":11},{"ext_id":"20252026:L","round":2,"label":"2nd Round","short":"R2","best_of":7,"high":"54","low":"24","starts_at":"2026-05-05T01:30:00Z","tbd":false,"sort":12},{"ext_id":"20252026:M","round":3,"label":"Eastern Conference Finals","short":"ECF","best_of":7,"high":"12","low":"8","starts_at":"2026-05-22T00:00:00Z","tbd":false,"sort":13},{"ext_id":"20252026:N","round":3,"label":"Western Conference Finals","short":"WCF","best_of":7,"high":"21","low":"54","starts_at":"2026-05-21T00:00:00Z","tbd":false,"sort":14},{"ext_id":"20252026:O","round":4,"label":"Stanley Cup Final","short":"SCF","best_of":7,"high":"12","low":"54","starts_at":"2026-06-03T00:00:00Z","tbd":false,"sort":15}],"fixtures":[{"ext_id":"2025030111","series":"20252026:A","game_no":1,"kickoff":"2026-04-19T23:30:00Z","state":"final","home":"7","away":"6","home_score":4,"away_score":3},{"ext_id":"2025030112","series":"20252026:A","game_no":2,"kickoff":"2026-04-21T23:30:00Z","state":"final","home":"7","away":"6","home_score":2,"away_score":4},{"ext_id":"2025030113","series":"20252026:A","game_no":3,"kickoff":"2026-04-23T23:00:00Z","state":"final","home":"6","away":"7","home_score":1,"away_score":3},{"ext_id":"2025030114","series":"20252026:A","game_no":4,"kickoff":"2026-04-26T18:00:00Z","state":"final","home":"6","away":"7","home_score":1,"away_score":6},{"ext_id":"2025030115","series":"20252026:A","game_no":5,"kickoff":"2026-04-28T23:30:00Z","state":"final","home":"7","away":"6","home_score":1,"away_score":2},{"ext_id":"2025030116","series":"20252026:A","game_no":6,"kickoff":"2026-05-01T23:30:00Z","state":"final","home":"6","away":"7","home_score":1,"away_score":4},{"ext_id":"2025030121","series":"20252026:B","game_no":1,"kickoff":"2026-04-19T21:45:00Z","state":"final","home":"14","away":"8","home_score":3,"away_score":4},{"ext_id":"2025030122","series":"20252026:B","game_no":2,"kickoff":"2026-04-21T23:00:00Z","state":"final","home":"14","away":"8","home_score":3,"away_score":2},{"ext_id":"2025030123","series":"20252026:B","game_no":3,"kickoff":"2026-04-24T23:00:00Z","state":"final","home":"8","away":"14","home_score":3,"away_score":2},{"ext_id":"2025030124","series":"20252026:B","game_no":4,"kickoff":"2026-04-26T23:00:00Z","state":"final","home":"8","away":"14","home_score":2,"away_score":3},{"ext_id":"2025030125","series":"20252026:B","game_no":5,"kickoff":"2026-04-29T23:00:00Z","state":"final","home":"14","away":"8","home_score":2,"away_score":3},{"ext_id":"2025030126","series":"20252026:B","game_no":6,"kickoff":"2026-05-01T23:00:00Z","state":"final","home":"8","away":"14","home_score":0,"away_score":1},{"ext_id":"2025030127","series":"20252026:B","game_no":7,"kickoff":"2026-05-03T22:00:00Z","state":"final","home":"14","away":"8","home_score":1,"away_score":2},{"ext_id":"2025030131","series":"20252026:C","game_no":1,"kickoff":"2026-04-18T19:00:00Z","state":"final","home":"12","away":"9","home_score":2,"away_score":0},{"ext_id":"2025030132","series":"20252026:C","game_no":2,"kickoff":"2026-04-20T23:30:00Z","state":"final","home":"12","away":"9","home_score":3,"away_score":2},{"ext_id":"2025030133","series":"20252026:C","game_no":3,"kickoff":"2026-04-23T23:30:00Z","state":"final","home":"9","away":"12","home_score":1,"away_score":2},{"ext_id":"2025030134","series":"20252026:C","game_no":4,"kickoff":"2026-04-25T19:00:00Z","state":"final","home":"9","away":"12","home_score":2,"away_score":4},{"ext_id":"2025030141","series":"20252026:D","game_no":1,"kickoff":"2026-04-19T00:00:00Z","state":"final","home":"5","away":"4","home_score":2,"away_score":3},{"ext_id":"2025030142","series":"20252026:D","game_no":2,"kickoff":"2026-04-20T23:00:00Z","state":"final","home":"5","away":"4","home_score":0,"away_score":3},{"ext_id":"2025030143","series":"20252026:D","game_no":3,"kickoff":"2026-04-22T23:00:00Z","state":"final","home":"4","away":"5","home_score":5,"away_score":2},{"ext_id":"2025030144","series":"20252026:D","game_no":4,"kickoff":"2026-04-26T00:00:00Z","state":"final","home":"4","away":"5","home_score":2,"away_score":4},{"ext_id":"2025030145","series":"20252026:D","game_no":5,"kickoff":"2026-04-27T23:00:00Z","state":"final","home":"5","away":"4","home_score":3,"away_score":2},{"ext_id":"2025030146","series":"20252026:D","game_no":6,"kickoff":"2026-04-29T23:30:00Z","state":"final","home":"4","away":"5","home_score":1,"away_score":0},{"ext_id":"2025030151","series":"20252026:E","game_no":1,"kickoff":"2026-04-19T19:00:00Z","state":"final","home":"21","away":"26","home_score":2,"away_score":1},{"ext_id":"2025030152","series":"20252026:E","game_no":2,"kickoff":"2026-04-22T02:00:00Z","state":"final","home":"21","away":"26","home_score":2,"away_score":1},{"ext_id":"2025030153","series":"20252026:E","game_no":3,"kickoff":"2026-04-24T02:00:00Z","state":"final","home":"26","away":"21","home_score":2,"away_score":4},{"ext_id":"2025030154","series":"20252026:E","game_no":4,"kickoff":"2026-04-26T20:30:00Z","state":"final","home":"26","away":"21","home_score":1,"away_score":5},{"ext_id":"2025030161","series":"20252026:F","game_no":1,"kickoff":"2026-04-18T21:30:00Z","state":"final","home":"25","away":"30","home_score":1,"away_score":6},{"ext_id":"2025030162","series":"20252026:F","game_no":2,"kickoff":"2026-04-21T01:30:00Z","state":"final","home":"25","away":"30","home_score":4,"away_score":2},{"ext_id":"2025030163","series":"20252026:F","game_no":3,"kickoff":"2026-04-23T01:30:00Z","state":"final","home":"30","away":"25","home_score":3,"away_score":4},{"ext_id":"2025030164","series":"20252026:F","game_no":4,"kickoff":"2026-04-25T21:30:00Z","state":"final","home":"30","away":"25","home_score":3,"away_score":2},{"ext_id":"2025030165","series":"20252026:F","game_no":5,"kickoff":"2026-04-29T00:00:00Z","state":"final","home":"25","away":"30","home_score":2,"away_score":4},{"ext_id":"2025030166","series":"20252026:F","game_no":6,"kickoff":"2026-04-30T23:30:00Z","state":"final","home":"30","away":"25","home_score":5,"away_score":2},{"ext_id":"2025030171","series":"20252026:G","game_no":1,"kickoff":"2026-04-20T02:00:00Z","state":"final","home":"54","away":"68","home_score":4,"away_score":2},{"ext_id":"2025030172","series":"20252026:G","game_no":2,"kickoff":"2026-04-22T01:30:00Z","state":"final","home":"54","away":"68","home_score":2,"away_score":3},{"ext_id":"2025030173","series":"20252026:G","game_no":3,"kickoff":"2026-04-25T01:30:00Z","state":"final","home":"68","away":"54","home_score":4,"away_score":2},{"ext_id":"2025030174","series":"20252026:G","game_no":4,"kickoff":"2026-04-28T01:30:00Z","state":"final","home":"68","away":"54","home_score":4,"away_score":5},{"ext_id":"2025030175","series":"20252026:G","game_no":5,"kickoff":"2026-04-30T02:00:00Z","state":"final","home":"54","away":"68","home_score":5,"away_score":4},{"ext_id":"2025030176","series":"20252026:G","game_no":6,"kickoff":"2026-05-02T02:00:00Z","state":"final","home":"68","away":"54","home_score":1,"away_score":5},{"ext_id":"2025030181","series":"20252026:H","game_no":1,"kickoff":"2026-04-21T02:00:00Z","state":"final","home":"22","away":"24","home_score":4,"away_score":3},{"ext_id":"2025030182","series":"20252026:H","game_no":2,"kickoff":"2026-04-23T02:00:00Z","state":"final","home":"22","away":"24","home_score":4,"away_score":6},{"ext_id":"2025030183","series":"20252026:H","game_no":3,"kickoff":"2026-04-25T02:00:00Z","state":"final","home":"24","away":"22","home_score":7,"away_score":4},{"ext_id":"2025030184","series":"20252026:H","game_no":4,"kickoff":"2026-04-27T01:30:00Z","state":"final","home":"24","away":"22","home_score":4,"away_score":3},{"ext_id":"2025030185","series":"20252026:H","game_no":5,"kickoff":"2026-04-29T02:00:00Z","state":"final","home":"22","away":"24","home_score":4,"away_score":1},{"ext_id":"2025030186","series":"20252026:H","game_no":6,"kickoff":"2026-05-01T02:00:00Z","state":"final","home":"24","away":"22","home_score":5,"away_score":2},{"ext_id":"2025030211","series":"20252026:I","game_no":1,"kickoff":"2026-05-06T23:00:00Z","state":"final","home":"7","away":"8","home_score":4,"away_score":2},{"ext_id":"2025030212","series":"20252026:I","game_no":2,"kickoff":"2026-05-08T23:00:00Z","state":"final","home":"7","away":"8","home_score":1,"away_score":5},{"ext_id":"2025030213","series":"20252026:I","game_no":3,"kickoff":"2026-05-10T23:00:00Z","state":"final","home":"8","away":"7","home_score":6,"away_score":2},{"ext_id":"2025030214","series":"20252026:I","game_no":4,"kickoff":"2026-05-12T23:00:00Z","state":"final","home":"8","away":"7","home_score":2,"away_score":3},{"ext_id":"2025030215","series":"20252026:I","game_no":5,"kickoff":"2026-05-14T23:00:00Z","state":"final","home":"7","away":"8","home_score":3,"away_score":6},{"ext_id":"2025030216","series":"20252026:I","game_no":6,"kickoff":"2026-05-17T00:00:00Z","state":"final","home":"8","away":"7","home_score":3,"away_score":8},{"ext_id":"2025030217","series":"20252026:I","game_no":7,"kickoff":"2026-05-18T23:30:00Z","state":"final","home":"7","away":"8","home_score":2,"away_score":3},{"ext_id":"2025030221","series":"20252026:J","game_no":1,"kickoff":"2026-05-03T00:00:00Z","state":"final","home":"12","away":"4","home_score":3,"away_score":0},{"ext_id":"2025030222","series":"20252026:J","game_no":2,"kickoff":"2026-05-04T23:00:00Z","state":"final","home":"12","away":"4","home_score":3,"away_score":2},{"ext_id":"2025030223","series":"20252026:J","game_no":3,"kickoff":"2026-05-08T00:00:00Z","state":"final","home":"4","away":"12","home_score":1,"away_score":4},{"ext_id":"2025030224","series":"20252026:J","game_no":4,"kickoff":"2026-05-09T22:00:00Z","state":"final","home":"4","away":"12","home_score":2,"away_score":3},{"ext_id":"2025030231","series":"20252026:K","game_no":1,"kickoff":"2026-05-04T01:00:00Z","state":"final","home":"21","away":"30","home_score":9,"away_score":6},{"ext_id":"2025030232","series":"20252026:K","game_no":2,"kickoff":"2026-05-06T00:00:00Z","state":"final","home":"21","away":"30","home_score":5,"away_score":2},{"ext_id":"2025030233","series":"20252026:K","game_no":3,"kickoff":"2026-05-10T01:00:00Z","state":"final","home":"30","away":"21","home_score":5,"away_score":1},{"ext_id":"2025030234","series":"20252026:K","game_no":4,"kickoff":"2026-05-12T00:00:00Z","state":"final","home":"30","away":"21","home_score":2,"away_score":5},{"ext_id":"2025030235","series":"20252026:K","game_no":5,"kickoff":"2026-05-14T00:00:00Z","state":"final","home":"21","away":"30","home_score":4,"away_score":3},{"ext_id":"2025030241","series":"20252026:L","game_no":1,"kickoff":"2026-05-05T01:30:00Z","state":"final","home":"54","away":"24","home_score":3,"away_score":1},{"ext_id":"2025030242","series":"20252026:L","game_no":2,"kickoff":"2026-05-07T01:30:00Z","state":"final","home":"54","away":"24","home_score":1,"away_score":3},{"ext_id":"2025030243","series":"20252026:L","game_no":3,"kickoff":"2026-05-09T01:30:00Z","state":"final","home":"24","away":"54","home_score":2,"away_score":6},{"ext_id":"2025030244","series":"20252026:L","game_no":4,"kickoff":"2026-05-11T01:30:00Z","state":"final","home":"24","away":"54","home_score":4,"away_score":3},{"ext_id":"2025030245","series":"20252026:L","game_no":5,"kickoff":"2026-05-13T01:30:00Z","state":"final","home":"54","away":"24","home_score":3,"away_score":2},{"ext_id":"2025030246","series":"20252026:L","game_no":6,"kickoff":"2026-05-15T01:30:00Z","state":"final","home":"24","away":"54","home_score":1,"away_score":5},{"ext_id":"2025030311","series":"20252026:M","game_no":1,"kickoff":"2026-05-22T00:00:00Z","state":"final","home":"12","away":"8","home_score":2,"away_score":6},{"ext_id":"2025030312","series":"20252026:M","game_no":2,"kickoff":"2026-05-23T23:00:00Z","state":"final","home":"12","away":"8","home_score":3,"away_score":2},{"ext_id":"2025030313","series":"20252026:M","game_no":3,"kickoff":"2026-05-26T00:00:00Z","state":"final","home":"8","away":"12","home_score":2,"away_score":3},{"ext_id":"2025030314","series":"20252026:M","game_no":4,"kickoff":"2026-05-28T00:00:00Z","state":"final","home":"8","away":"12","home_score":0,"away_score":4},{"ext_id":"2025030315","series":"20252026:M","game_no":5,"kickoff":"2026-05-30T00:00:00Z","state":"final","home":"12","away":"8","home_score":6,"away_score":1},{"ext_id":"2025030321","series":"20252026:N","game_no":1,"kickoff":"2026-05-21T00:00:00Z","state":"final","home":"21","away":"54","home_score":2,"away_score":4},{"ext_id":"2025030322","series":"20252026:N","game_no":2,"kickoff":"2026-05-23T00:00:00Z","state":"final","home":"21","away":"54","home_score":1,"away_score":3},{"ext_id":"2025030323","series":"20252026:N","game_no":3,"kickoff":"2026-05-25T00:00:00Z","state":"final","home":"54","away":"21","home_score":5,"away_score":3},{"ext_id":"2025030324","series":"20252026:N","game_no":4,"kickoff":"2026-05-27T01:00:00Z","state":"final","home":"54","away":"21","home_score":2,"away_score":1},{"ext_id":"2025030411","series":"20252026:O","game_no":1,"kickoff":"2026-06-03T00:00:00Z","state":"final","home":"12","away":"54","home_score":4,"away_score":5},{"ext_id":"2025030412","series":"20252026:O","game_no":2,"kickoff":"2026-06-05T00:00:00Z","state":"final","home":"12","away":"54","home_score":4,"away_score":3},{"ext_id":"2025030413","series":"20252026:O","game_no":3,"kickoff":"2026-06-07T00:00:00Z","state":"final","home":"54","away":"12","home_score":5,"away_score":4},{"ext_id":"2025030414","series":"20252026:O","game_no":4,"kickoff":"2026-06-10T00:00:00Z","state":"final","home":"54","away":"12","home_score":3,"away_score":5},{"ext_id":"2025030415","series":"20252026:O","game_no":5,"kickoff":"2026-06-12T00:00:00Z","state":"final","home":"12","away":"54","home_score":4,"away_score":2},{"ext_id":"2025030416","series":"20252026:O","game_no":6,"kickoff":"2026-06-15T00:00:00Z","state":"final","home":"54","away":"12","home_score":0,"away_score":3}]}'::jsonb);
select pg_temp.expect('every series ends as the NHL had it: Carolina over Vegas in six for the Cup',
  (select count(*) = 15 and count(*) filter (where state = 'final') = 15 from series where competition = 'nhl-po-test')
  and (select c.short = 'CAR' and s.high_wins + s.low_wins = 6 from series s join clubs c on c.id = s.winner where s.competition = 'nhl-po-test' and s.round = 4)
  and (select c.short = 'MTL' from series s join clubs c on c.id = s.winner where s.ext_id = '20252026:B'));
select pg_temp.expect('a bracket from the first round, A and B feeding I, M and N the final',
  _bracket_ok('nhl-po-test', 1)
  and (select n.ext_id = '20252026:I' from _bracket_tree('nhl-po-test', 1) t join series x on x.id = t.series_id join series n on n.id = t.next_id where x.ext_id = '20252026:B')
  and (select n.ext_id = '20252026:O' from _bracket_tree('nhl-po-test', 1) t join series x on x.id = t.series_id join series n on n.id = t.next_id where x.ext_id = '20252026:N'));
update competitions set active = false where id = 'nhl-po-test';
select 'nhl playoffs', true;

-- ───────────── squares by the quarter (migration 200) ─────────────
-- A Super Bowl grid: Hana takes three squares, the rest stay empty. Kickoff draws the digits; it pays after the 1st
-- quarter, at the half, after the 3rd and on the final, 20/20/20/40, each to the square named or the next claimed one
-- along its row, so all of it comes to Hana. The chat hears it in football's words, with no "Game 1".
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format)
values ('nfl-sq-test', 'nfl', 'NFL Playoffs (squares test)', 'NFL', '2026', 'espn', 'football/nfl', '2026', true, 'series') on conflict (id) do nothing;
select sport_ingest('nfl-sq-test', jsonb_build_object(
  'clubs', jsonb_build_array(jsonb_build_object('ext_id', 'sqk', 'name', 'Kansas City Chiefs', 'short', 'KC'), jsonb_build_object('ext_id', 'sqp', 'name', 'Philadelphia Eagles', 'short', 'PHI')),
  'series', jsonb_build_array(jsonb_build_object('ext_id', 'SQSB', 'round', 1, 'label', 'Super Bowl', 'short', 'SB', 'best_of', 1, 'high', 'sqk', 'low', 'sqp',
    'starts_at', now() + interval '2 days', 'sort', 1))));
select id as sbs from series where ext_id = 'SQSB' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.raises('football doesn''t pay by the inning', format('select pool_game_start(%L, %L, %L)', 'squares', 'nfl-sq-test', jsonb_build_object('series', :sbs, 'pays', 'innings')), 'every quarter');
select pool_game_start('squares', 'nfl-sq-test', jsonb_build_object('series', :sbs, 'size', 5, 'cost', 10)) as fsq \gset
select pg_temp.expect('a football grid pays by the quarter, and says so', (select rules->>'pays' = 'quarters' and rules->'points' = '[1, 2, 3, 0]'::jsonb
    and rules->'weights' = '[20, 20, 20, 40]'::jsonb from pool_games where id = :fsq)
  and exists (select 1 from messages where league_id = :lib and body = '🔲 Super Bowl squares are open: 10 coins a square, 25 squares with two digits a side. The digits are drawn when the grid fills or at kickoff, and the pot pays after the 1st quarter, at the half, after the 3rd quarter and on the final.'));
select pool_squares_claim(:fsq, array['sq:0:0', 'sq:2:3', 'sq:4:4']);
select pg_temp.expect('the board speaks football', (select b->'words' = '{"start": "kickoff", "score": "points", "period": "quarter"}'::jsonb from (select pool_game_board(:fsq)->'squares' b) x));
reset role;
-- kickoff, then a 7-3 first quarter with the second under way
select sport_ingest('nfl-sq-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'SQSB', 'series', 'SQSB', 'game_no', 1, 'kickoff', now() - interval '20 minutes', 'state', 'live', 'home', 'sqk', 'away', 'sqp', 'home_score', 7, 'away_score', 3,
    'periods', jsonb_build_array(jsonb_build_object('n', 1, 'home', 7, 'away', 3), jsonb_build_object('n', 2, 'home', 0, 'away', 0))))));
select pg_temp.expect('kickoff draws the grid, and the 1st quarter pays a fifth of the pot',
  (select draw->>'why' = 'kickoff' and (draw->>'pot')::int = 30 from pool_games where id = :fsq)
  and (select count(*) = 1 and min(coins) = 6 and min(point) = 1 and bool_and(team_id = :hana) from pool_square_pays where game_id = :fsq)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 After the 1st quarter: KC 7, PHI 3. Hana%square takes 6 coins.')
  and (select sum(amount) from coin_ledger where reason = 'Squares: Super Bowl squares · after the 1st quarter') = 6);
-- the final, after 17-10 at the half and 24-17 after three
select sport_ingest('nfl-sq-test', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'SQSB', 'series', 'SQSB', 'game_no', 1, 'kickoff', now() - interval '4 hours', 'state', 'final', 'home', 'sqk', 'away', 'sqp', 'home_score', 31, 'away_score', 24,
    'periods', jsonb_build_array(jsonb_build_object('n', 1, 'home', 7, 'away', 3), jsonb_build_object('n', 2, 'home', 10, 'away', 7),
      jsonb_build_object('n', 3, 'home', 7, 'away', 7), jsonb_build_object('n', 4, 'home', 7, 'away', 7))))));
select pg_temp.expect('the half, the 3rd and the final pay, the whole pot to Hana, and the grid is done',
  (select array_agg(top_runs || '-' || side_runs order by case when point = 0 then 99 else point end) = array['7-3', '17-10', '24-17', '31-24']
     and sum(coins) = 30 from pool_square_pays where game_id = :fsq)
  and (select status = 'done' and winners = array[:hana] from pool_games where id = :fsq)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 At the half: KC 17, PHI 10.%'));
update competitions set active = false where id = 'nfl-sq-test';
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'football squares', true;

-- ───────────── March Madness (migration 201) ─────────────
-- The 2026 tournament as soccer-sync files it from ESPN (logos and venues left out): 63 single-game series in bracket
-- order, the regions paired as the Final Four paired them. Every result is ESPN's; Michigan win it. Then the same draw
-- still to come, where a bracket opens on the first round and its tiebreaker runs to basketball scores.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
insert into competitions (id, sport, name, short, season, provider, ext_id, ext_season, active, format) values
  ('mm-test', 'ncaab', 'March Madness (test)', 'NCAA', '2026', 'espn', 'basketball/mens-college-basketball', '2026', true, 'series'),
  ('mm-next', 'ncaab', 'March Madness (next)', 'NCAA', '2099', 'espn', 'basketball/mens-college-basketball', '2099', true, 'series') on conflict (id) do nothing;
select sport_ingest('mm-test', '{"clubs":[{"ext_id":"194","name":"Ohio State Buckeyes","short":"OSU","logo":null},{"ext_id":"2628","name":"TCU Horned Frogs","short":"TCU","logo":null},{"ext_id":"158","name":"Nebraska Cornhuskers","short":"NEB","logo":null},{"ext_id":"2653","name":"Troy Trojans","short":"TROY","logo":null},{"ext_id":"97","name":"Louisville Cardinals","short":"LOU","logo":null},{"ext_id":"58","name":"South Florida Bulls","short":"USF","logo":null},{"ext_id":"275","name":"Wisconsin Badgers","short":"WIS","logo":null},{"ext_id":"2272","name":"High Point Panthers","short":"HPU","logo":null},{"ext_id":"150","name":"Duke Blue Devils","short":"DUKE","logo":null},{"ext_id":"2561","name":"Siena Saints","short":"SIE","logo":null},{"ext_id":"238","name":"Vanderbilt Commodores","short":"VAN","logo":null},{"ext_id":"2377","name":"McNeese Cowboys","short":"MCN","logo":null},{"ext_id":"8","name":"Arkansas Razorbacks","short":"ARK","logo":null},{"ext_id":"62","name":"Hawai''i Rainbow Warriors","short":"HAW","logo":null},{"ext_id":"127","name":"Michigan State Spartans","short":"MSU","logo":null},{"ext_id":"2449","name":"North Dakota State Bison","short":"NDSU","logo":null},{"ext_id":"153","name":"North Carolina Tar Heels","short":"UNC","logo":null},{"ext_id":"2670","name":"VCU Rams","short":"VCU","logo":null},{"ext_id":"130","name":"Michigan Wolverines","short":"MICH","logo":null},{"ext_id":"47","name":"Howard Bison","short":"HOW","logo":null},{"ext_id":"252","name":"BYU Cougars","short":"BYU","logo":null},{"ext_id":"251","name":"Texas Longhorns","short":"TEX","logo":null},{"ext_id":"2608","name":"Saint Mary''s Gaels","short":"SMC","logo":null},{"ext_id":"245","name":"Texas A&M Aggies","short":"TA&M","logo":null},{"ext_id":"356","name":"Illinois Fighting Illini","short":"ILL","logo":null},{"ext_id":"219","name":"Pennsylvania Quakers","short":"PENN","logo":null},{"ext_id":"61","name":"Georgia Bulldogs","short":"UGA","logo":null},{"ext_id":"139","name":"Saint Louis Billikens","short":"SLU","logo":null},{"ext_id":"248","name":"Houston Cougars","short":"HOU","logo":null},{"ext_id":"70","name":"Idaho Vandals","short":"IDHO","logo":null},{"ext_id":"2250","name":"Gonzaga Bulldogs","short":"GONZ","logo":null},{"ext_id":"338","name":"Kennesaw State Owls","short":"KENN","logo":null},{"ext_id":"96","name":"Kentucky Wildcats","short":"UK","logo":null},{"ext_id":"2541","name":"Santa Clara Broncos","short":"SCU","logo":null},{"ext_id":"2641","name":"Texas Tech Red Raiders","short":"TTU","logo":null},{"ext_id":"2006","name":"Akron Zips","short":"AKR","logo":null},{"ext_id":"12","name":"Arizona Wildcats","short":"ARIZ","logo":null},{"ext_id":"112358","name":"Long Island University Sharks","short":"LIU","logo":null},{"ext_id":"258","name":"Virginia Cavaliers","short":"UVA","logo":null},{"ext_id":"2750","name":"Wright State Raiders","short":"WRST","logo":null},{"ext_id":"66","name":"Iowa State Cyclones","short":"ISU","logo":null},{"ext_id":"2634","name":"Tennessee State Tigers","short":"TNST","logo":null},{"ext_id":"333","name":"Alabama Crimson Tide","short":"ALA","logo":null},{"ext_id":"2275","name":"Hofstra Pride","short":"HOF","logo":null},{"ext_id":"222","name":"Villanova Wildcats","short":"VILL","logo":null},{"ext_id":"328","name":"Utah State Aggies","short":"USU","logo":null},{"ext_id":"2633","name":"Tennessee Volunteers","short":"TENN","logo":null},{"ext_id":"193","name":"Miami (OH) RedHawks","short":"M-OH","logo":null},{"ext_id":"228","name":"Clemson Tigers","short":"CLEM","logo":null},{"ext_id":"2294","name":"Iowa Hawkeyes","short":"IOWA","logo":null},{"ext_id":"2599","name":"St. John''s Red Storm","short":"SJU","logo":null},{"ext_id":"2460","name":"Northern Iowa Panthers","short":"UNI","logo":null},{"ext_id":"26","name":"UCLA Bruins","short":"UCLA","logo":null},{"ext_id":"2116","name":"UCF Knights","short":"UCF","logo":null},{"ext_id":"2509","name":"Purdue Boilermakers","short":"PUR","logo":null},{"ext_id":"2511","name":"Queens University Royals","short":"QUC","logo":null},{"ext_id":"57","name":"Florida Gators","short":"FLA","logo":null},{"ext_id":"2504","name":"Prairie View A&M Panthers","short":"PV","logo":null},{"ext_id":"2305","name":"Kansas Jayhawks","short":"KU","logo":null},{"ext_id":"2856","name":"California Baptist Lancers","short":"CBU","logo":null},{"ext_id":"2390","name":"Miami Hurricanes","short":"MIA","logo":null},{"ext_id":"142","name":"Missouri Tigers","short":"MIZ","logo":null},{"ext_id":"41","name":"UConn Huskies","short":"CONN","logo":null},{"ext_id":"231","name":"Furman Paladins","short":"FUR","logo":null}],"series":[{"ext_id":"2026:R1:East:0","round":1,"label":"First Round","short":"East 1v16","best_of":1,"high":"150","low":"2561","starts_at":"2026-03-19T19:00:00.000Z","tbd":false,"sort":1},{"ext_id":"2026:R1:East:1","round":1,"label":"First Round","short":"East 8v9","best_of":1,"high":"194","low":"2628","starts_at":"2026-03-19T16:15:00.000Z","tbd":false,"sort":2},{"ext_id":"2026:R1:East:2","round":1,"label":"First Round","short":"East 5v12","best_of":1,"high":"2599","low":"2460","starts_at":"2026-03-20T23:25:00.000Z","tbd":false,"sort":3},{"ext_id":"2026:R1:East:3","round":1,"label":"First Round","short":"East 4v13","best_of":1,"high":"2305","low":"2856","starts_at":"2026-03-21T02:07:00.000Z","tbd":false,"sort":4},{"ext_id":"2026:R1:East:4","round":1,"label":"First Round","short":"East 6v11","best_of":1,"high":"97","low":"58","starts_at":"2026-03-19T17:30:00.000Z","tbd":false,"sort":5},{"ext_id":"2026:R1:East:5","round":1,"label":"First Round","short":"East 3v14","best_of":1,"high":"127","low":"2449","starts_at":"2026-03-19T20:27:00.000Z","tbd":false,"sort":6},{"ext_id":"2026:R1:East:6","round":1,"label":"First Round","short":"East 7v10","best_of":1,"high":"26","low":"2116","starts_at":"2026-03-20T23:31:00.000Z","tbd":false,"sort":7},{"ext_id":"2026:R1:East:7","round":1,"label":"First Round","short":"East 2v15","best_of":1,"high":"41","low":"231","starts_at":"2026-03-21T02:31:00.000Z","tbd":false,"sort":8},{"ext_id":"2026:R1:South:0","round":1,"label":"First Round","short":"South 1v16","best_of":1,"high":"57","low":"2504","starts_at":"2026-03-21T01:25:00.000Z","tbd":false,"sort":9},{"ext_id":"2026:R1:South:1","round":1,"label":"First Round","short":"South 8v9","best_of":1,"high":"228","low":"2294","starts_at":"2026-03-20T22:50:00.000Z","tbd":false,"sort":10},{"ext_id":"2026:R1:South:2","round":1,"label":"First Round","short":"South 5v12","best_of":1,"high":"238","low":"2377","starts_at":"2026-03-19T19:15:00.000Z","tbd":false,"sort":11},{"ext_id":"2026:R1:South:3","round":1,"label":"First Round","short":"South 4v13","best_of":1,"high":"158","low":"2653","starts_at":"2026-03-19T16:40:00.000Z","tbd":false,"sort":12},{"ext_id":"2026:R1:South:4","round":1,"label":"First Round","short":"South 6v11","best_of":1,"high":"153","low":"2670","starts_at":"2026-03-19T22:50:00.000Z","tbd":false,"sort":13},{"ext_id":"2026:R1:South:5","round":1,"label":"First Round","short":"South 3v14","best_of":1,"high":"356","low":"219","starts_at":"2026-03-20T01:55:00.000Z","tbd":false,"sort":14},{"ext_id":"2026:R1:South:6","round":1,"label":"First Round","short":"South 7v10","best_of":1,"high":"2608","low":"245","starts_at":"2026-03-19T23:35:00.000Z","tbd":false,"sort":15},{"ext_id":"2026:R1:South:7","round":1,"label":"First Round","short":"South 2v15","best_of":1,"high":"248","low":"70","starts_at":"2026-03-20T02:15:00.000Z","tbd":false,"sort":16},{"ext_id":"2026:R1:West:0","round":1,"label":"First Round","short":"West 1v16","best_of":1,"high":"12","low":"112358","starts_at":"2026-03-20T17:35:00.000Z","tbd":false,"sort":17},{"ext_id":"2026:R1:West:1","round":1,"label":"First Round","short":"West 8v9","best_of":1,"high":"222","low":"328","starts_at":"2026-03-20T20:10:00.000Z","tbd":false,"sort":18},{"ext_id":"2026:R1:West:2","round":1,"label":"First Round","short":"West 5v12","best_of":1,"high":"275","low":"2272","starts_at":"2026-03-19T17:50:00.000Z","tbd":false,"sort":19},{"ext_id":"2026:R1:West:3","round":1,"label":"First Round","short":"West 4v13","best_of":1,"high":"8","low":"62","starts_at":"2026-03-19T20:27:00.000Z","tbd":false,"sort":20},{"ext_id":"2026:R1:West:4","round":1,"label":"First Round","short":"West 6v11","best_of":1,"high":"252","low":"251","starts_at":"2026-03-19T23:35:00.000Z","tbd":false,"sort":21},{"ext_id":"2026:R1:West:5","round":1,"label":"First Round","short":"West 3v14","best_of":1,"high":"2250","low":"338","starts_at":"2026-03-20T02:24:00.000Z","tbd":false,"sort":22},{"ext_id":"2026:R1:West:6","round":1,"label":"First Round","short":"West 7v10","best_of":1,"high":"2390","low":"142","starts_at":"2026-03-21T02:07:00.000Z","tbd":false,"sort":23},{"ext_id":"2026:R1:West:7","round":1,"label":"First Round","short":"West 2v15","best_of":1,"high":"2509","low":"2511","starts_at":"2026-03-20T23:35:00.000Z","tbd":false,"sort":24},{"ext_id":"2026:R1:Midwest:0","round":1,"label":"First Round","short":"Midwest 1v16","best_of":1,"high":"130","low":"47","starts_at":"2026-03-19T23:30:00.000Z","tbd":false,"sort":25},{"ext_id":"2026:R1:Midwest:1","round":1,"label":"First Round","short":"Midwest 8v9","best_of":1,"high":"61","low":"139","starts_at":"2026-03-20T02:10:00.000Z","tbd":false,"sort":26},{"ext_id":"2026:R1:Midwest:2","round":1,"label":"First Round","short":"Midwest 5v12","best_of":1,"high":"2641","low":"2006","starts_at":"2026-03-20T16:40:00.000Z","tbd":false,"sort":27},{"ext_id":"2026:R1:Midwest:3","round":1,"label":"First Round","short":"Midwest 4v13","best_of":1,"high":"333","low":"2275","starts_at":"2026-03-20T19:15:00.000Z","tbd":false,"sort":28},{"ext_id":"2026:R1:Midwest:4","round":1,"label":"First Round","short":"Midwest 6v11","best_of":1,"high":"2633","low":"193","starts_at":"2026-03-20T20:25:00.000Z","tbd":false,"sort":29},{"ext_id":"2026:R1:Midwest:5","round":1,"label":"First Round","short":"Midwest 3v14","best_of":1,"high":"258","low":"2750","starts_at":"2026-03-20T17:50:00.000Z","tbd":false,"sort":30},{"ext_id":"2026:R1:Midwest:6","round":1,"label":"First Round","short":"Midwest 7v10","best_of":1,"high":"96","low":"2541","starts_at":"2026-03-20T16:15:00.000Z","tbd":false,"sort":31},{"ext_id":"2026:R1:Midwest:7","round":1,"label":"First Round","short":"Midwest 2v15","best_of":1,"high":"66","low":"2634","starts_at":"2026-03-20T19:07:00.000Z","tbd":false,"sort":32},{"ext_id":"2026:R2:East:0","round":2,"label":"Second Round","short":"East","best_of":1,"high":"150","low":"2628","starts_at":"2026-03-21T21:25:00.000Z","tbd":false,"sort":1},{"ext_id":"2026:R2:East:1","round":2,"label":"Second Round","short":"East","best_of":1,"high":"2305","low":"2599","starts_at":"2026-03-22T21:15:00.000Z","tbd":false,"sort":2},{"ext_id":"2026:R2:East:2","round":2,"label":"Second Round","short":"East","best_of":1,"high":"127","low":"97","starts_at":"2026-03-21T18:45:00.000Z","tbd":false,"sort":3},{"ext_id":"2026:R2:East:3","round":2,"label":"Second Round","short":"East","best_of":1,"high":"41","low":"26","starts_at":"2026-03-23T01:10:00.000Z","tbd":false,"sort":4},{"ext_id":"2026:R2:South:0","round":2,"label":"Second Round","short":"South","best_of":1,"high":"57","low":"2294","starts_at":"2026-03-22T23:10:00.000Z","tbd":false,"sort":5},{"ext_id":"2026:R2:South:1","round":2,"label":"Second Round","short":"South","best_of":1,"high":"158","low":"238","starts_at":"2026-03-22T01:02:00.000Z","tbd":false,"sort":6},{"ext_id":"2026:R2:South:2","round":2,"label":"Second Round","short":"South","best_of":1,"high":"356","low":"2670","starts_at":"2026-03-22T00:15:00.000Z","tbd":false,"sort":7},{"ext_id":"2026:R2:South:3","round":2,"label":"Second Round","short":"South","best_of":1,"high":"248","low":"245","starts_at":"2026-03-21T22:10:00.000Z","tbd":false,"sort":8},{"ext_id":"2026:R2:West:0","round":2,"label":"Second Round","short":"West","best_of":1,"high":"12","low":"328","starts_at":"2026-03-23T00:11:00.000Z","tbd":false,"sort":9},{"ext_id":"2026:R2:West:1","round":2,"label":"Second Round","short":"West","best_of":1,"high":"8","low":"2272","starts_at":"2026-03-22T01:45:00.000Z","tbd":false,"sort":10},{"ext_id":"2026:R2:West:2","round":2,"label":"Second Round","short":"West","best_of":1,"high":"2250","low":"251","starts_at":"2026-03-21T23:10:00.000Z","tbd":false,"sort":11},{"ext_id":"2026:R2:West:3","round":2,"label":"Second Round","short":"West","best_of":1,"high":"2509","low":"2390","starts_at":"2026-03-22T16:10:00.000Z","tbd":false,"sort":12},{"ext_id":"2026:R2:Midwest:0","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":"130","low":"139","starts_at":"2026-03-21T16:10:00.000Z","tbd":false,"sort":13},{"ext_id":"2026:R2:Midwest:1","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":"333","low":"2641","starts_at":"2026-03-23T02:08:00.000Z","tbd":false,"sort":14},{"ext_id":"2026:R2:Midwest:2","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":"258","low":"2633","starts_at":"2026-03-22T22:10:00.000Z","tbd":false,"sort":15},{"ext_id":"2026:R2:Midwest:3","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":"66","low":"96","starts_at":"2026-03-22T18:45:00.000Z","tbd":false,"sort":16},{"ext_id":"2026:R3:East:0","round":3,"label":"Sweet 16","short":"East","best_of":1,"high":"150","low":"2599","starts_at":"2026-03-27T23:10:00.000Z","tbd":false,"sort":1},{"ext_id":"2026:R3:East:1","round":3,"label":"Sweet 16","short":"East","best_of":1,"high":"41","low":"127","starts_at":"2026-03-28T01:55:00.000Z","tbd":false,"sort":2},{"ext_id":"2026:R3:South:0","round":3,"label":"Sweet 16","short":"South","best_of":1,"high":"158","low":"2294","starts_at":"2026-03-26T23:30:00.000Z","tbd":false,"sort":3},{"ext_id":"2026:R3:South:1","round":3,"label":"Sweet 16","short":"South","best_of":1,"high":"248","low":"356","starts_at":"2026-03-27T02:05:00.000Z","tbd":false,"sort":4},{"ext_id":"2026:R3:West:0","round":3,"label":"Sweet 16","short":"West","best_of":1,"high":"12","low":"8","starts_at":"2026-03-27T02:06:00.000Z","tbd":false,"sort":5},{"ext_id":"2026:R3:West:1","round":3,"label":"Sweet 16","short":"West","best_of":1,"high":"2509","low":"251","starts_at":"2026-03-26T23:10:00.000Z","tbd":false,"sort":6},{"ext_id":"2026:R3:Midwest:0","round":3,"label":"Sweet 16","short":"Midwest","best_of":1,"high":"130","low":"333","starts_at":"2026-03-27T23:35:00.000Z","tbd":false,"sort":7},{"ext_id":"2026:R3:Midwest:1","round":3,"label":"Sweet 16","short":"Midwest","best_of":1,"high":"66","low":"2633","starts_at":"2026-03-28T02:35:00.000Z","tbd":false,"sort":8},{"ext_id":"2026:R4:East:0","round":4,"label":"Elite Eight","short":"East","best_of":1,"high":"150","low":"41","starts_at":"2026-03-29T21:05:00.000Z","tbd":false,"sort":1},{"ext_id":"2026:R4:South:0","round":4,"label":"Elite Eight","short":"South","best_of":1,"high":"356","low":"2294","starts_at":"2026-03-28T22:09:00.000Z","tbd":false,"sort":2},{"ext_id":"2026:R4:West:0","round":4,"label":"Elite Eight","short":"West","best_of":1,"high":"12","low":"2509","starts_at":"2026-03-29T00:59:00.000Z","tbd":false,"sort":3},{"ext_id":"2026:R4:Midwest:0","round":4,"label":"Elite Eight","short":"Midwest","best_of":1,"high":"130","low":"2633","starts_at":"2026-03-29T18:15:00.000Z","tbd":false,"sort":4},{"ext_id":"2026:R5:N:0","round":5,"label":"Final Four","short":"Final Four","best_of":1,"high":"41","low":"356","starts_at":"2026-04-04T22:09:00.000Z","tbd":false,"sort":1},{"ext_id":"2026:R5:N:1","round":5,"label":"Final Four","short":"Final Four","best_of":1,"high":"12","low":"130","starts_at":"2026-04-05T01:19:00.000Z","tbd":false,"sort":2},{"ext_id":"2026:R6:N:0","round":6,"label":"National Championship","short":"Final","best_of":1,"high":"41","low":"130","starts_at":"2026-04-07T00:50:00.000Z","tbd":false,"sort":1}],"fixtures":[{"ext_id":"M401856479","series":"2026:R1:East:1","game_no":1,"kickoff":"2026-03-19T16:15:00.000Z","state":"final","status":"FT","home":"194","away":"2628","home_score":64,"away_score":66},{"ext_id":"M401856489","series":"2026:R1:South:3","game_no":1,"kickoff":"2026-03-19T16:40:00.000Z","state":"final","status":"FT","home":"158","away":"2653","home_score":76,"away_score":47},{"ext_id":"M401856482","series":"2026:R1:East:4","game_no":1,"kickoff":"2026-03-19T17:30:00.000Z","state":"final","status":"FT","home":"97","away":"58","home_score":83,"away_score":79},{"ext_id":"M401856480","series":"2026:R1:West:2","game_no":1,"kickoff":"2026-03-19T17:50:00.000Z","state":"final","status":"FT","home":"275","away":"2272","home_score":82,"away_score":83},{"ext_id":"M401856478","series":"2026:R1:East:0","game_no":1,"kickoff":"2026-03-19T19:00:00.000Z","state":"final","status":"FT","home":"150","away":"2561","home_score":71,"away_score":65},{"ext_id":"M401856488","series":"2026:R1:South:2","game_no":1,"kickoff":"2026-03-19T19:15:00.000Z","state":"final","status":"FT","home":"238","away":"2377","home_score":78,"away_score":68},{"ext_id":"M401856481","series":"2026:R1:West:3","game_no":1,"kickoff":"2026-03-19T20:27:00.000Z","state":"final","status":"FT","home":"8","away":"62","home_score":97,"away_score":78},{"ext_id":"M401856483","series":"2026:R1:East:5","game_no":1,"kickoff":"2026-03-19T20:27:00.000Z","state":"final","status":"FT","home":"127","away":"2449","home_score":92,"away_score":67},{"ext_id":"M401856490","series":"2026:R1:South:4","game_no":1,"kickoff":"2026-03-19T22:50:00.000Z","state":"final","status":"FT","home":"153","away":"2670","home_score":78,"away_score":82},{"ext_id":"M401856486","series":"2026:R1:Midwest:0","game_no":1,"kickoff":"2026-03-19T23:30:00.000Z","state":"final","status":"FT","home":"130","away":"47","home_score":101,"away_score":80},{"ext_id":"M401856484","series":"2026:R1:West:4","game_no":1,"kickoff":"2026-03-19T23:35:00.000Z","state":"final","status":"FT","home":"252","away":"251","home_score":71,"away_score":79},{"ext_id":"M401856492","series":"2026:R1:South:6","game_no":1,"kickoff":"2026-03-19T23:35:00.000Z","state":"final","status":"FT","home":"2608","away":"245","home_score":50,"away_score":63},{"ext_id":"M401856491","series":"2026:R1:South:5","game_no":1,"kickoff":"2026-03-20T01:55:00.000Z","state":"final","status":"FT","home":"356","away":"219","home_score":105,"away_score":70},{"ext_id":"M401856487","series":"2026:R1:Midwest:1","game_no":1,"kickoff":"2026-03-20T02:10:00.000Z","state":"final","status":"FT","home":"61","away":"139","home_score":77,"away_score":102},{"ext_id":"M401856493","series":"2026:R1:South:7","game_no":1,"kickoff":"2026-03-20T02:15:00.000Z","state":"final","status":"FT","home":"248","away":"70","home_score":78,"away_score":47},{"ext_id":"M401856485","series":"2026:R1:West:5","game_no":1,"kickoff":"2026-03-20T02:24:00.000Z","state":"final","status":"FT","home":"2250","away":"338","home_score":73,"away_score":64},{"ext_id":"M401856525","series":"2026:R1:Midwest:6","game_no":1,"kickoff":"2026-03-20T16:15:00.000Z","state":"final","status":"FT","home":"96","away":"2541","home_score":89,"away_score":84},{"ext_id":"M401856520","series":"2026:R1:Midwest:2","game_no":1,"kickoff":"2026-03-20T16:40:00.000Z","state":"final","status":"FT","home":"2641","away":"2006","home_score":91,"away_score":71},{"ext_id":"M401856529","series":"2026:R1:West:0","game_no":1,"kickoff":"2026-03-20T17:35:00.000Z","state":"final","status":"FT","home":"12","away":"112358","home_score":92,"away_score":58},{"ext_id":"M401856526","series":"2026:R1:Midwest:5","game_no":1,"kickoff":"2026-03-20T17:50:00.000Z","state":"final","status":"FT","home":"258","away":"2750","home_score":82,"away_score":73},{"ext_id":"M401856524","series":"2026:R1:Midwest:7","game_no":1,"kickoff":"2026-03-20T19:07:00.000Z","state":"final","status":"FT","home":"66","away":"2634","home_score":108,"away_score":74},{"ext_id":"M401856521","series":"2026:R1:Midwest:3","game_no":1,"kickoff":"2026-03-20T19:15:00.000Z","state":"final","status":"FT","home":"333","away":"2275","home_score":90,"away_score":70},{"ext_id":"M401856528","series":"2026:R1:West:1","game_no":1,"kickoff":"2026-03-20T20:10:00.000Z","state":"final","status":"FT","home":"222","away":"328","home_score":76,"away_score":86},{"ext_id":"M401856527","series":"2026:R1:Midwest:4","game_no":1,"kickoff":"2026-03-20T20:25:00.000Z","state":"final","status":"FT","home":"2633","away":"193","home_score":78,"away_score":56},{"ext_id":"M401856522","series":"2026:R1:South:1","game_no":1,"kickoff":"2026-03-20T22:50:00.000Z","state":"final","status":"FT","home":"228","away":"2294","home_score":61,"away_score":67},{"ext_id":"M401856494","series":"2026:R1:East:2","game_no":1,"kickoff":"2026-03-20T23:25:00.000Z","state":"final","status":"FT","home":"2599","away":"2460","home_score":79,"away_score":53},{"ext_id":"M401856496","series":"2026:R1:East:6","game_no":1,"kickoff":"2026-03-20T23:31:00.000Z","state":"final","status":"FT","home":"26","away":"2116","home_score":75,"away_score":71},{"ext_id":"M401856519","series":"2026:R1:West:7","game_no":1,"kickoff":"2026-03-20T23:35:00.000Z","state":"final","status":"FT","home":"2509","away":"2511","home_score":104,"away_score":71},{"ext_id":"M401856523","series":"2026:R1:South:0","game_no":1,"kickoff":"2026-03-21T01:25:00.000Z","state":"final","status":"FT","home":"57","away":"2504","home_score":114,"away_score":55},{"ext_id":"M401856495","series":"2026:R1:East:3","game_no":1,"kickoff":"2026-03-21T02:07:00.000Z","state":"final","status":"FT","home":"2305","away":"2856","home_score":68,"away_score":60},{"ext_id":"M401856518","series":"2026:R1:West:6","game_no":1,"kickoff":"2026-03-21T02:07:00.000Z","state":"final","status":"FT","home":"2390","away":"142","home_score":80,"away_score":66},{"ext_id":"M401856497","series":"2026:R1:East:7","game_no":1,"kickoff":"2026-03-21T02:31:00.000Z","state":"final","status":"FT","home":"41","away":"231","home_score":82,"away_score":71},{"ext_id":"M401856532","series":"2026:R2:Midwest:0","game_no":1,"kickoff":"2026-03-21T16:10:00.000Z","state":"final","status":"FT","home":"130","away":"139","home_score":95,"away_score":72},{"ext_id":"M401856531","series":"2026:R2:East:2","game_no":1,"kickoff":"2026-03-21T18:45:00.000Z","state":"final","status":"FT","home":"127","away":"97","home_score":77,"away_score":69},{"ext_id":"M401856530","series":"2026:R2:East:0","game_no":1,"kickoff":"2026-03-21T21:25:00.000Z","state":"final","status":"FT","home":"150","away":"2628","home_score":81,"away_score":58},{"ext_id":"M401856535","series":"2026:R2:South:3","game_no":1,"kickoff":"2026-03-21T22:10:00.000Z","state":"final","status":"FT","home":"248","away":"245","home_score":88,"away_score":57},{"ext_id":"M401856537","series":"2026:R2:West:2","game_no":1,"kickoff":"2026-03-21T23:10:00.000Z","state":"final","status":"FT","home":"2250","away":"251","home_score":68,"away_score":74},{"ext_id":"M401856533","series":"2026:R2:South:2","game_no":1,"kickoff":"2026-03-22T00:15:00.000Z","state":"final","status":"FT","home":"356","away":"2670","home_score":76,"away_score":55},{"ext_id":"M401856534","series":"2026:R2:South:1","game_no":1,"kickoff":"2026-03-22T01:02:00.000Z","state":"final","status":"FT","home":"158","away":"238","home_score":74,"away_score":72},{"ext_id":"M401856536","series":"2026:R2:West:1","game_no":1,"kickoff":"2026-03-22T01:45:00.000Z","state":"final","status":"FT","home":"8","away":"2272","home_score":94,"away_score":88},{"ext_id":"M401856564","series":"2026:R2:West:3","game_no":1,"kickoff":"2026-03-22T16:10:00.000Z","state":"final","status":"FT","home":"2509","away":"2390","home_score":79,"away_score":69},{"ext_id":"M401856561","series":"2026:R2:Midwest:3","game_no":1,"kickoff":"2026-03-22T18:45:00.000Z","state":"final","status":"FT","home":"66","away":"96","home_score":82,"away_score":63},{"ext_id":"M401856558","series":"2026:R2:East:1","game_no":1,"kickoff":"2026-03-22T21:15:00.000Z","state":"final","status":"FT","home":"2305","away":"2599","home_score":65,"away_score":67},{"ext_id":"M401856562","series":"2026:R2:Midwest:2","game_no":1,"kickoff":"2026-03-22T22:10:00.000Z","state":"final","status":"FT","home":"258","away":"2633","home_score":72,"away_score":79},{"ext_id":"M401856563","series":"2026:R2:South:0","game_no":1,"kickoff":"2026-03-22T23:10:00.000Z","state":"final","status":"FT","home":"57","away":"2294","home_score":72,"away_score":73},{"ext_id":"M401856565","series":"2026:R2:West:0","game_no":1,"kickoff":"2026-03-23T00:11:00.000Z","state":"final","status":"FT","home":"12","away":"328","home_score":78,"away_score":66},{"ext_id":"M401856559","series":"2026:R2:East:3","game_no":1,"kickoff":"2026-03-23T01:10:00.000Z","state":"final","status":"FT","home":"41","away":"26","home_score":73,"away_score":57},{"ext_id":"M401856560","series":"2026:R2:Midwest:1","game_no":1,"kickoff":"2026-03-23T02:08:00.000Z","state":"final","status":"FT","home":"333","away":"2641","home_score":90,"away_score":65},{"ext_id":"M401856568","series":"2026:R3:West:1","game_no":1,"kickoff":"2026-03-26T23:10:00.000Z","state":"final","status":"FT","home":"2509","away":"251","home_score":79,"away_score":77},{"ext_id":"M401856567","series":"2026:R3:South:0","game_no":1,"kickoff":"2026-03-26T23:30:00.000Z","state":"final","status":"FT","home":"158","away":"2294","home_score":71,"away_score":77},{"ext_id":"M401856566","series":"2026:R3:South:1","game_no":1,"kickoff":"2026-03-27T02:05:00.000Z","state":"final","status":"FT","home":"248","away":"356","home_score":55,"away_score":65},{"ext_id":"M401856569","series":"2026:R3:West:0","game_no":1,"kickoff":"2026-03-27T02:06:00.000Z","state":"final","status":"FT","home":"12","away":"8","home_score":109,"away_score":88},{"ext_id":"M401856570","series":"2026:R3:East:0","game_no":1,"kickoff":"2026-03-27T23:10:00.000Z","state":"final","status":"FT","home":"150","away":"2599","home_score":80,"away_score":75},{"ext_id":"M401856572","series":"2026:R3:Midwest:0","game_no":1,"kickoff":"2026-03-27T23:35:00.000Z","state":"final","status":"FT","home":"130","away":"333","home_score":90,"away_score":77},{"ext_id":"M401856571","series":"2026:R3:East:1","game_no":1,"kickoff":"2026-03-28T01:55:00.000Z","state":"final","status":"FT","home":"41","away":"127","home_score":67,"away_score":63},{"ext_id":"M401856573","series":"2026:R3:Midwest:1","game_no":1,"kickoff":"2026-03-28T02:35:00.000Z","state":"final","status":"FT","home":"66","away":"2633","home_score":62,"away_score":76},{"ext_id":"M401856574","series":"2026:R4:South:0","game_no":1,"kickoff":"2026-03-28T22:09:00.000Z","state":"final","status":"FT","home":"356","away":"2294","home_score":71,"away_score":59},{"ext_id":"M401856575","series":"2026:R4:West:0","game_no":1,"kickoff":"2026-03-29T00:59:00.000Z","state":"final","status":"FT","home":"12","away":"2509","home_score":79,"away_score":64},{"ext_id":"M401856576","series":"2026:R4:Midwest:0","game_no":1,"kickoff":"2026-03-29T18:15:00.000Z","state":"final","status":"FT","home":"130","away":"2633","home_score":95,"away_score":62},{"ext_id":"M401856577","series":"2026:R4:East:0","game_no":1,"kickoff":"2026-03-29T21:05:00.000Z","state":"final","status":"FT","home":"150","away":"41","home_score":72,"away_score":73},{"ext_id":"M401856598","series":"2026:R5:N:0","game_no":1,"kickoff":"2026-04-04T22:09:00.000Z","state":"final","status":"FT","home":"41","away":"356","home_score":71,"away_score":62},{"ext_id":"M401856599","series":"2026:R5:N:1","game_no":1,"kickoff":"2026-04-05T01:19:00.000Z","state":"final","status":"FT","home":"12","away":"130","home_score":73,"away_score":91},{"ext_id":"M401856600","series":"2026:R6:N:0","game_no":1,"kickoff":"2026-04-07T00:50:00.000Z","state":"final","status":"FT","home":"130","away":"41","home_score":69,"away_score":63}]}'::jsonb);
select pg_temp.expect('63 games as ESPN had them, Michigan champions, and a bracket from the first round',
  (select count(*) = 63 and count(*) filter (where state = 'final') = 63 from series where competition = 'mm-test')
  and (select c.short = 'MICH' from series s join clubs c on c.id = s.winner where s.competition = 'mm-test' and s.round = 6)
  and _bracket_ok('mm-test', 1)
  and (select bool_and(n.round = 5) from _bracket_tree('mm-test', 1) t join series x on x.id = t.series_id join series n on n.id = t.next_id where x.round = 4)
  and (select n.short = 'East' from _bracket_tree('mm-test', 1) t join series x on x.id = t.series_id join series n on n.id = t.next_id where x.short = 'East 5v12'));
select sport_ingest('mm-next', '{"series":[{"ext_id":"F2026:R1:East:0","round":1,"label":"First Round","short":"East 1v16","best_of":1,"high":"150","low":"2561","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":1},{"ext_id":"F2026:R1:East:1","round":1,"label":"First Round","short":"East 8v9","best_of":1,"high":"194","low":"2628","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":2},{"ext_id":"F2026:R1:East:2","round":1,"label":"First Round","short":"East 5v12","best_of":1,"high":"2599","low":"2460","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":3},{"ext_id":"F2026:R1:East:3","round":1,"label":"First Round","short":"East 4v13","best_of":1,"high":"2305","low":"2856","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":4},{"ext_id":"F2026:R1:East:4","round":1,"label":"First Round","short":"East 6v11","best_of":1,"high":"97","low":"58","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":5},{"ext_id":"F2026:R1:East:5","round":1,"label":"First Round","short":"East 3v14","best_of":1,"high":"127","low":"2449","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":6},{"ext_id":"F2026:R1:East:6","round":1,"label":"First Round","short":"East 7v10","best_of":1,"high":"26","low":"2116","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":7},{"ext_id":"F2026:R1:East:7","round":1,"label":"First Round","short":"East 2v15","best_of":1,"high":"41","low":"231","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":8},{"ext_id":"F2026:R1:South:0","round":1,"label":"First Round","short":"South 1v16","best_of":1,"high":"57","low":"2504","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":9},{"ext_id":"F2026:R1:South:1","round":1,"label":"First Round","short":"South 8v9","best_of":1,"high":"228","low":"2294","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":10},{"ext_id":"F2026:R1:South:2","round":1,"label":"First Round","short":"South 5v12","best_of":1,"high":"238","low":"2377","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":11},{"ext_id":"F2026:R1:South:3","round":1,"label":"First Round","short":"South 4v13","best_of":1,"high":"158","low":"2653","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":12},{"ext_id":"F2026:R1:South:4","round":1,"label":"First Round","short":"South 6v11","best_of":1,"high":"153","low":"2670","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":13},{"ext_id":"F2026:R1:South:5","round":1,"label":"First Round","short":"South 3v14","best_of":1,"high":"356","low":"219","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":14},{"ext_id":"F2026:R1:South:6","round":1,"label":"First Round","short":"South 7v10","best_of":1,"high":"2608","low":"245","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":15},{"ext_id":"F2026:R1:South:7","round":1,"label":"First Round","short":"South 2v15","best_of":1,"high":"248","low":"70","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":16},{"ext_id":"F2026:R1:West:0","round":1,"label":"First Round","short":"West 1v16","best_of":1,"high":"12","low":"112358","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":17},{"ext_id":"F2026:R1:West:1","round":1,"label":"First Round","short":"West 8v9","best_of":1,"high":"222","low":"328","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":18},{"ext_id":"F2026:R1:West:2","round":1,"label":"First Round","short":"West 5v12","best_of":1,"high":"275","low":"2272","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":19},{"ext_id":"F2026:R1:West:3","round":1,"label":"First Round","short":"West 4v13","best_of":1,"high":"8","low":"62","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":20},{"ext_id":"F2026:R1:West:4","round":1,"label":"First Round","short":"West 6v11","best_of":1,"high":"252","low":"251","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":21},{"ext_id":"F2026:R1:West:5","round":1,"label":"First Round","short":"West 3v14","best_of":1,"high":"2250","low":"338","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":22},{"ext_id":"F2026:R1:West:6","round":1,"label":"First Round","short":"West 7v10","best_of":1,"high":"2390","low":"142","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":23},{"ext_id":"F2026:R1:West:7","round":1,"label":"First Round","short":"West 2v15","best_of":1,"high":"2509","low":"2511","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":24},{"ext_id":"F2026:R1:Midwest:0","round":1,"label":"First Round","short":"Midwest 1v16","best_of":1,"high":"130","low":"47","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":25},{"ext_id":"F2026:R1:Midwest:1","round":1,"label":"First Round","short":"Midwest 8v9","best_of":1,"high":"61","low":"139","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":26},{"ext_id":"F2026:R1:Midwest:2","round":1,"label":"First Round","short":"Midwest 5v12","best_of":1,"high":"2641","low":"2006","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":27},{"ext_id":"F2026:R1:Midwest:3","round":1,"label":"First Round","short":"Midwest 4v13","best_of":1,"high":"333","low":"2275","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":28},{"ext_id":"F2026:R1:Midwest:4","round":1,"label":"First Round","short":"Midwest 6v11","best_of":1,"high":"2633","low":"193","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":29},{"ext_id":"F2026:R1:Midwest:5","round":1,"label":"First Round","short":"Midwest 3v14","best_of":1,"high":"258","low":"2750","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":30},{"ext_id":"F2026:R1:Midwest:6","round":1,"label":"First Round","short":"Midwest 7v10","best_of":1,"high":"96","low":"2541","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":31},{"ext_id":"F2026:R1:Midwest:7","round":1,"label":"First Round","short":"Midwest 2v15","best_of":1,"high":"66","low":"2634","starts_at":"2099-03-19T16:00:00Z","tbd":false,"sort":32},{"ext_id":"F2026:R2:East:0","round":2,"label":"Second Round","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":1},{"ext_id":"F2026:R2:East:1","round":2,"label":"Second Round","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":2},{"ext_id":"F2026:R2:East:2","round":2,"label":"Second Round","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":3},{"ext_id":"F2026:R2:East:3","round":2,"label":"Second Round","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":4},{"ext_id":"F2026:R2:South:0","round":2,"label":"Second Round","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":5},{"ext_id":"F2026:R2:South:1","round":2,"label":"Second Round","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":6},{"ext_id":"F2026:R2:South:2","round":2,"label":"Second Round","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":7},{"ext_id":"F2026:R2:South:3","round":2,"label":"Second Round","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":8},{"ext_id":"F2026:R2:West:0","round":2,"label":"Second Round","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":9},{"ext_id":"F2026:R2:West:1","round":2,"label":"Second Round","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":10},{"ext_id":"F2026:R2:West:2","round":2,"label":"Second Round","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":11},{"ext_id":"F2026:R2:West:3","round":2,"label":"Second Round","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":12},{"ext_id":"F2026:R2:Midwest:0","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":13},{"ext_id":"F2026:R2:Midwest:1","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":14},{"ext_id":"F2026:R2:Midwest:2","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":15},{"ext_id":"F2026:R2:Midwest:3","round":2,"label":"Second Round","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":16},{"ext_id":"F2026:R3:East:0","round":3,"label":"Sweet 16","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":1},{"ext_id":"F2026:R3:East:1","round":3,"label":"Sweet 16","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":2},{"ext_id":"F2026:R3:South:0","round":3,"label":"Sweet 16","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":3},{"ext_id":"F2026:R3:South:1","round":3,"label":"Sweet 16","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":4},{"ext_id":"F2026:R3:West:0","round":3,"label":"Sweet 16","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":5},{"ext_id":"F2026:R3:West:1","round":3,"label":"Sweet 16","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":6},{"ext_id":"F2026:R3:Midwest:0","round":3,"label":"Sweet 16","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":7},{"ext_id":"F2026:R3:Midwest:1","round":3,"label":"Sweet 16","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":8},{"ext_id":"F2026:R4:East:0","round":4,"label":"Elite Eight","short":"East","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":1},{"ext_id":"F2026:R4:South:0","round":4,"label":"Elite Eight","short":"South","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":2},{"ext_id":"F2026:R4:West:0","round":4,"label":"Elite Eight","short":"West","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":3},{"ext_id":"F2026:R4:Midwest:0","round":4,"label":"Elite Eight","short":"Midwest","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":4},{"ext_id":"F2026:R5:N:0","round":5,"label":"Final Four","short":"Final Four","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":1},{"ext_id":"F2026:R5:N:1","round":5,"label":"Final Four","short":"Final Four","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":2},{"ext_id":"F2026:R6:N:0","round":6,"label":"National Championship","short":"Final","best_of":1,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":1}]}'::jsonb);
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the start page offers a bracket on it', exists (select 1 from jsonb_array_elements(pool_event_list()) e where e->>'competition' = 'mm-next' and e->'kinds' ? 'bracket'));
select pool_game_start('bracket', 'mm-next') as mmb \gset
select pg_temp.expect('six rounds, doubling to 32 for the champion, the tiebreaker in basketball points',
  (select rules->'points' = '{"1": 1, "2": 2, "3": 4, "4": 8, "5": 16, "6": 32}'::jsonb from pool_games where id = :mmb)
  and (select b->'words' = '{"start": "tip-off", "score": "points", "cap": 300}'::jsonb from (select pool_game_board(:mmb) b) x));
select pool_game_pick(:mmb, 'tiebreak', '{"runs": 141}');
select pg_temp.raises('a tiebreaker past a basketball score', format('select pool_game_pick(%s, %L, %L)', :mmb, 'tiebreak', '{"runs": 301}'), 'Total points: a number from 0 to 300');
reset role;
update pool_games set status = 'done' where id = :mmb;
-- the Final Four's pairing goes on by a platform admin only
select set_config('app.league_id', '', false);
select pg_temp.as_team(2);
set role authenticated;
select pg_temp.raises('only a platform admin sets the regions', $$select platform_set_regions('mm-next', array['East', 'South', 'West', 'Midwest'])$$, 'Platform admins only');
reset role;
update competitions set active = false where id in ('mm-test', 'mm-next');
select set_config('request.jwt.claim.sub', '', false);
select 'march madness', true;

-- ───────────── the NBA playoffs (migration 220) ─────────────
-- The field drawn (the 2026 first round as ESPN had it, through nbaPlayoffPayload): fifteen best-of-7 series in bracket
-- order, the first round's clubs set, the rest to be decided; a month before the first tip-off the event offers Pick the
-- series, Rank the teams and a bracket from the first round, in basketball's words, the tiebreaker to 300 points.
reset role;
select set_config('request.jwt.claim.sub', '', false);
select set_config('app.league_id', '', false);
select pg_temp.expect('the NBA has its sport row and its 2027 postseason', exists (select 1 from sports where id = 'nba' and config->'words'->>'start' = 'tip-off')
  and exists (select 1 from competitions where id = 'nba-post-2027' and format = 'series' and ext_id = 'basketball/nba'));
select sport_ingest('nba-post-2027', '{"clubs":[{"ext_id":"5","name":"Cleveland Cavaliers","short":"CLE"},{"ext_id":"28","name":"Toronto Raptors","short":"TOR"},{"ext_id":"7","name":"Denver Nuggets","short":"DEN"},{"ext_id":"16","name":"Minnesota Timberwolves","short":"MIN"},{"ext_id":"18","name":"New York Knicks","short":"NY"},{"ext_id":"1","name":"Atlanta Hawks","short":"ATL"},{"ext_id":"13","name":"Los Angeles Lakers","short":"LAL"},{"ext_id":"10","name":"Houston Rockets","short":"HOU"},{"ext_id":"2","name":"Boston Celtics","short":"BOS"},{"ext_id":"20","name":"Philadelphia 76ers","short":"PHI"},{"ext_id":"25","name":"Oklahoma City Thunder","short":"OKC"},{"ext_id":"21","name":"Phoenix Suns","short":"PHX"},{"ext_id":"8","name":"Detroit Pistons","short":"DET"},{"ext_id":"19","name":"Orlando Magic","short":"ORL"},{"ext_id":"24","name":"San Antonio Spurs","short":"SA"},{"ext_id":"22","name":"Portland Trail Blazers","short":"POR"}],"series":[{"ext_id":"nba:2027:R1:E:0","round":1,"label":"East 1st Round","short":"E R1","best_of":7,"high":"8","low":"19","starts_at":null,"tbd":false,"sort":1},{"ext_id":"nba:2027:R1:E:1","round":1,"label":"East 1st Round","short":"E R1","best_of":7,"high":"5","low":"28","starts_at":null,"tbd":false,"sort":2},{"ext_id":"nba:2027:R1:E:2","round":1,"label":"East 1st Round","short":"E R1","best_of":7,"high":"18","low":"1","starts_at":null,"tbd":false,"sort":3},{"ext_id":"nba:2027:R1:E:3","round":1,"label":"East 1st Round","short":"E R1","best_of":7,"high":"2","low":"20","starts_at":null,"tbd":false,"sort":4},{"ext_id":"nba:2027:R1:W:0","round":1,"label":"West 1st Round","short":"W R1","best_of":7,"high":"25","low":"21","starts_at":null,"tbd":false,"sort":5},{"ext_id":"nba:2027:R1:W:1","round":1,"label":"West 1st Round","short":"W R1","best_of":7,"high":"13","low":"10","starts_at":null,"tbd":false,"sort":6},{"ext_id":"nba:2027:R1:W:2","round":1,"label":"West 1st Round","short":"W R1","best_of":7,"high":"7","low":"16","starts_at":null,"tbd":false,"sort":7},{"ext_id":"nba:2027:R1:W:3","round":1,"label":"West 1st Round","short":"W R1","best_of":7,"high":"24","low":"22","starts_at":null,"tbd":false,"sort":8},{"ext_id":"nba:2027:R2:E:0","round":2,"label":"East Semifinals","short":"E Semis","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":9},{"ext_id":"nba:2027:R2:E:1","round":2,"label":"East Semifinals","short":"E Semis","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":10},{"ext_id":"nba:2027:R2:W:0","round":2,"label":"West Semifinals","short":"W Semis","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":11},{"ext_id":"nba:2027:R2:W:1","round":2,"label":"West Semifinals","short":"W Semis","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":12},{"ext_id":"nba:2027:R3:E:0","round":3,"label":"East Finals","short":"ECF","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":13},{"ext_id":"nba:2027:R3:W:0","round":3,"label":"West Finals","short":"WCF","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":14},{"ext_id":"nba:2027:R4:F:0","round":4,"label":"NBA Finals","short":"Finals","best_of":7,"high":null,"low":null,"starts_at":null,"tbd":true,"sort":15}],"fixtures":[]}'::jsonb);
update series set starts_at = now() + interval '30 days' + sort * interval '1 hour' where competition = 'nba-post-2027' and round = 1;
select pg_temp.expect('fifteen series in bracket order, the first round set',
  (select count(*) = 15 and count(*) filter (where round = 1 and high_club is not null and low_club is not null) = 8 and bool_and(best_of = 7)
   from series where competition = 'nba-post-2027')
  and (select string_agg(h.short || '-' || l.short, ' ' order by s.sort) = 'DET-ORL CLE-TOR NY-ATL BOS-PHI OKC-PHX LAL-HOU DEN-MIN SA-POR'
       from series s join clubs h on h.id = s.high_club join clubs l on l.id = s.low_club where s.competition = 'nba-post-2027' and s.round = 1));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pg_temp.expect('the event offers the series, the ranking and a bracket from the first round',
  exists (select 1 from jsonb_array_elements(pool_event_list()) e where e->>'competition' = 'nba-post-2027'
          and e->'kinds' ?& array['series', 'rank', 'bracket'] and (e->>'open_round')::int = 1));
select pool_game_start('bracket', 'nba-post-2027', '{}'::jsonb) as nbab \gset
-- a grid on a first-round series pays by the quarter, every game (migration 221)
select pool_game_start('squares', 'nba-post-2027', jsonb_build_object('series', (select id from series where competition = 'nba-post-2027' and sort = 1))) as nbasq \gset
reset role;
select pg_temp.expect('a bracket on it, its tiebreaker the Finals'' points up to 300', (select kind = 'bracket' and (rules->>'from_round')::int = 1 from pool_games where id = :nbab)
  and _score_cap('nba-post-2027') = 300);
select pg_temp.expect('NBA squares pay by the quarter, every game', (select rules->>'pays' = 'quarters' and rules->'points' = '[1, 2, 3, 0]'::jsonb from pool_games where id = :nbasq)
  and exists (select 1 from messages where league_id = :lib and body like '🔲 East 1st Round squares are open:%after the 1st quarter, at the half, after the 3rd quarter and on the final of every game.'));
-- a prop sheet on Game 1 in basketball's words, settled from the score and the quarters (migration 222)
select sport_ingest('nba-post-2027', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'Bt1', 'series', 'nba:2027:R1:E:0',
  'game_no', 1, 'kickoff', now() + interval '2 days', 'state', 'scheduled', 'home', '8', 'away', '19'))));
select id as nbaf from fixtures where provider = 'espn' and ext_id = 'Bt1' \gset
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_game_start('props', 'nba-post-2027', jsonb_build_object('fixture', :nbaf)) as nbap \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect('an NBA sheet asks in basketball''s words', (select rules->'questions'->1->>'q' = 'Total points: over or under 220.5?'
    and rules->'questions'->2->'options'->2->>'label' = '11 or more' and rules->'questions'->3->>'q' = 'Who leads after the 1st quarter?'
    and rules->'questions'->5->>'q' = '1st-quarter points: over or under 54.5?' and rules->'questions'->7->>'q' = 'A side held under 100 points?'
  from pool_games where id = :nbap));
select sport_ingest('nba-post-2027', jsonb_build_object('fixtures', jsonb_build_array(jsonb_build_object('ext_id', 'Bt1', 'series', 'nba:2027:R1:E:0',
  'game_no', 1, 'kickoff', now() - interval '3 hours', 'state', 'final', 'home', '8', 'away', '19', 'home_score', 104, 'away_score', 99,
  'periods', '[{"n": 1, "home": 30, "away": 25}, {"n": 2, "home": 20, "away": 28}, {"n": 3, "home": 27, "away": 24}, {"n": 4, "home": 27, "away": 22}]'::jsonb))));
select pg_temp.expect('and settles: Detroit by 5, under the total, 55 in the 1st, Orlando held to 99',
  (select a = '{"winner": "H", "total": "U", "margin": "1", "first": "H", "half": "A", "early": "O", "extra": "N", "held": "Y"}'::jsonb from (select _props_answers(:nbap) a) x));
-- automatic sheets open on a series' next game only (migration 225): Game 2 tonight, not Game 3 the night after
select sport_ingest('nba-post-2027', jsonb_build_object('fixtures', jsonb_build_array(
  jsonb_build_object('ext_id', 'Bt2', 'series', 'nba:2027:R1:E:0', 'game_no', 2, 'kickoff', now() + interval '10 hours', 'state', 'scheduled', 'home', '8', 'away', '19'),
  jsonb_build_object('ext_id', 'Bt3', 'series', 'nba:2027:R1:E:0', 'game_no', 3, 'kickoff', now() + interval '30 hours', 'state', 'scheduled', 'home', '19', 'away', '8'))));
select set_config('app.league_id', :'lib', false);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000081', false);
set role authenticated;
select pool_auto_sheets_set('nba-post-2027', true);
reset role;
select pg_temp.expect('a sheet on Game 2, none yet on Game 3', exists (select 1 from pool_games g join fixtures f on f.id = (g.rules->>'fixture')::bigint
    where g.league_id = :lib and g.kind = 'props' and f.ext_id = 'Bt2')
  and not exists (select 1 from pool_games g join fixtures f on f.id = (g.rules->>'fixture')::bigint where g.league_id = :lib and g.kind = 'props' and f.ext_id = 'Bt3'));
select pg_temp.raises('one open sheet a game, whatever the path', format('insert into pool_games (league_id, kind, competition, title, rules) select g.league_id, g.kind, g.competition, g.title, g.rules from pool_games g join fixtures f on f.id = (g.rules->>''fixture'')::bigint where g.league_id = %s and g.kind = ''props'' and f.ext_id = ''Bt2''', :lib), 'pool_games_one_open_sheet');
update competitions set active = false where id = 'nba-post-2027';
select set_config('app.league_id', '', false);
select set_config('request.jwt.claim.sub', '', false);
select 'nba playoffs', true;
