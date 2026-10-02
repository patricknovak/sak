-- Garry's Book, the NHL board: the common futures every book carries, open all season on the house, and the
-- chat bet builder that turns "Oilers to win the Cup" into a priced market.
--   * open_nhl_markets() opens, once a season, the Stanley Cup, the Presidents' Trophy, the four division winners,
--     the Art Ross (most points), the Rocket Richard (most goals), the most wins among goalies and the top-scoring
--     defenceman. Each is a race market like the requested ones: priced on read from the standings model and the
--     box scores (migration 70), a ticket keeps its price, no job re-prices anything. The player awards run the
--     league's top eight against "the field" (everyone else), so the board stays short.
--   * Requests loosen up: one club against the field in a season-long race ("Oilers: the Stanley Cup"), up to
--     eight players in a race, and a player race against the field. That is what Garry's chat builds from.
--   * Settlement: the division winners and the club lines as before (the 82 played); the player awards from the
--     box scores over the whole regular season, league-wide, so a winner outside the eight pays "the field"; a
--     tie at the top waits for the commish (the NHL tiebreakers). The Cup stays the commish's call.
set client_min_messages = warning;

create or replace function public.preview_market(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tpl text := p->>'template'; stat text := coalesce(p->>'stat', 'fpts'); what text := p->>'what';
  d_from date; d_to date; g games; r numeric; ph numeric; line numeric; mean numeric; sd numeric; sigma numeric;
  ids int[]; clubs text[]; grp text[]; names text; n int; mkind text := 'race'; title text; subject jsonb; options jsonb; closes timestamptz; note text; m_date date;
  first timestamptz; nt record; tot numeric; sumw numeric; wfield numeric; k text; lbl text; rows jsonb; grp_ids int[]; season_end date := _nhl_season_end();
begin
  if stat not in ('fpts', 'g', 'a', 'pts', 'sog', 'hit', 'blk', 'ppp', 'w', 'sv', 'sho') then raise exception 'Pick a stat the Book keeps'; end if;

  if tpl = 'game' then
    if coalesce(p->>'bet', 'winner') not in ('winner', 'total', 'ot') then raise exception 'Moneyline, total or overtime'; end if;
    mkind := coalesce(p->>'bet', 'winner');
    select * into g from games where id = nullif(p->>'game_id', '')::bigint;
    if g.id is null then raise exception 'Pick a game from the schedule'; end if;
    if g.start_utc <= now() or g.state not in ('FUT', 'PRE') then raise exception 'That game has started'; end if;
    if g.date <= today_et() then raise exception 'Tonight''s games get their markets from the Book at 9:35 ET; ask for one later in the week'; end if;
    if exists (select 1 from markets where game_id = g.id and markets.kind = mkind and status = 'open' and league_id = current_league_id()) then raise exception 'That market is already on the board'; end if;
    ph := least(0.75, greatest(0.25, 0.54 + (_club_rating(g.home) - _club_rating(g.away)) * 0.6));
    m_date := g.date; closes := g.start_utc;
    subject := jsonb_build_object('home', g.home, 'away', g.away, 'template', 'game');
    if mkind = 'winner' then
      title := format('%s @ %s: who wins? (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      options := jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph)));
      note := format('%s is %s%% to win on form and home ice. Settled from the final score.', g.home, round(ph * 100));
    elsif mkind = 'total' then
      title := format('%s @ %s: total goals (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      subject := subject || jsonb_build_object('line', 6.5);
      options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9));
      note := 'Both clubs'' goals, overtime and the shootout goal included. Settled from the final score.';
    else
      title := format('%s @ %s: goes to overtime? (%s)', g.away, g.home, to_char(g.date, 'FMDy Mon FMDD'));
      options := jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28));
      note := 'Settled from the final score.';
    end if;
    return jsonb_build_object('kind', mkind, 'title', title, 'game_id', g.id, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  -- windows: from today (or later) to a day the season still covers
  d_from := coalesce(nullif(p->>'from', '')::date, today_et()); d_to := coalesce(nullif(p->>'to', '')::date, season_end);
  if d_from < today_et() and not coalesce((p->>'whole_season')::boolean, false) then d_from := today_et(); end if;
  if d_from > season_end then raise exception 'The regular season is over by then'; end if;
  if d_to > season_end then d_to := season_end; end if;
  if d_to < d_from then raise exception 'The window ends before it starts'; end if;
  m_date := d_from;

  if tpl in ('player_race', 'player_line') then
    if tpl = 'player_line' then ids := array[nullif(p->>'player_id', '')::int]; else select array_agg(distinct v::int) into ids from jsonb_array_elements_text(coalesce(p->'players', '[]'::jsonb)) v; end if;
    if ids is null or array_length(ids, 1) < (case when tpl = 'player_line' then 1 when coalesce((p->>'field')::boolean, false) then 1 else 2 end) then raise exception 'Pick % players', case when tpl = 'player_line' then 'a player' when coalesce((p->>'field')::boolean, false) then 'a player, or up to eight' else 'two to eight' end; end if;
    if array_length(ids, 1) > 8 then raise exception 'Eight players at most'; end if;
    if (select count(*) from players where id = any(ids)) < array_length(ids, 1) then raise exception 'Unknown player'; end if;
    if (select count(distinct pos = 'G') from players where id = any(ids)) > 1 then raise exception 'Skaters race skaters and goalies race goalies'; end if;
    if (select bool_or(pos = 'G') from players where id = any(ids)) and stat not in ('fpts', 'w', 'sv', 'sho') then raise exception 'Goalies race on fantasy points, wins, saves or shutouts'; end if;
    if (select bool_or(pos <> 'G') from players where id = any(ids)) and stat in ('w', 'sv', 'sho') then raise exception 'That''s a goalie stat'; end if;
    -- the field: the rest of the top 30 at that stat (skaters, goalies, or one position), by projection
    if tpl = 'player_race' and coalesce((p->>'field')::boolean, false) then
      select array_agg(id) into grp_ids from (
        select pl.id from players pl
        where pl.status = 'active' and pl.proj_stats is not null
          and case coalesce(p->>'pos', '') when 'G' then pl.pos = 'G' when 'D' then pl.pos = 'D' when 'F' then pl.pos in ('C', 'LW', 'RW') else pl.pos <> 'G' end
        order by case stat when 'fpts' then pl.proj else (pl.proj_stats->>stat)::numeric end desc nulls last limit 30) t;
      grp_ids := (select array_agg(distinct x) from unnest(grp_ids || ids) x);
    end if;
    select array_agg(distinct nhl_team) into clubs from players where id = any(coalesce(grp_ids, ids)) and nhl_team is not null;
    first := case when clubs is null then null else _first_start(clubs, d_from, d_to) end;
    if first is null then raise exception 'No games left in that window'; end if;
    -- tickets stop at the first game of the race, but a race starting tonight still takes tickets for 48 hours
    closes := greatest(first, now() + interval '48 hours');
    closes := least(closes, (d_to + 1)::timestamp at time zone 'America/Toronto');
    -- each player's expected total: his rate × his club's games left
    select jsonb_agg(jsonb_build_object('id', pl.id, 'short', coalesce(pl.last_name, pl.name), 'gl', _club_games_left(pl.nhl_team, d_from, d_to),
      'left', round(_player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2),
      'mean', round(_race_sofar(pl.id, stat, d_from, d_to) + _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2), 'picked', pl.id = any(ids))) into rows from players pl where pl.id = any(coalesce(grp_ids, ids));
    if grp_ids is null and exists (select 1 from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean) where gl = 0 and picked) then
      raise exception '% has no games left in that window', (select short from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric) where gl = 0 limit 1);
    end if;
    select avg(r."left"), max(r.mean) into mean, tot from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
    sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));   -- the spread is on what's still to play
    if tpl = 'player_race' then
      -- a softmax over expected totals, spread by how much the stat swings over the window
      select sum(exp((r.mean - tot) / sd)), coalesce(sum(exp((r.mean - tot) / sd)) filter (where not r.picked), 0) into sumw, wfield from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
      select jsonb_agg(jsonb_build_object('key', 'p' || r.id, 'label', r.short, 'odds', _odds_long(round(exp((r.mean - tot) / sd) / sumw, 4))) order by r.mean desc, r.id),
             string_agg(r.short, ' vs ' order by r.mean desc, r.id),
             string_agg(format('%s %s', r.short, round(r.mean, 1)), ', ' order by r.mean desc, r.id),
             jsonb_object_agg(r.id, round(r.mean, 1))
        into options, names, lbl, subject from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean) where r.picked;
      if grp_ids is not null then options := options || jsonb_build_array(jsonb_build_object('key', 'field', 'label', 'The field', 'odds', _odds_long(round(wfield / sumw, 4)))); end if;
      title := coalesce(nullif(p->>'title', ''), format('%s: most %s %s%s', names, _stat_label(stat), _window_label(d_from, d_to), case when grp_ids is not null then ' (or the field)' else '' end));
      subject := jsonb_build_object('template', tpl, 'players', to_jsonb(ids), 'stat', stat, 'from', d_from, 'to', d_to, 'settle', 'auto', 'means', subject)
        || case when grp_ids is not null then jsonb_build_object('group', to_jsonb(grp_ids), 'pos', coalesce(p->>'pos', 'S')) else '{}'::jsonb end;
      note := format('Expected: %s. Counted from the box scores %s; %s. The price moves with the box scores; a ticket keeps the price it was bought at.', lbl, _window_label(d_from, d_to),
        case when grp_ids is not null then 'the field is everyone else in the league; a tie at the top goes to the NHL tiebreaker, settled by the commish' else 'a tie refunds everyone' end);
    else
      select r.mean, r.short, r.gl into mean, names, n from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric, picked boolean);
      line := coalesce(nullif(p->>'line', '')::numeric, floor(mean) + 0.5);
      if line <> floor(line) + 0.5 then line := floor(line) + 0.5; end if;      -- always a half, so there's no push
      if line < 0.5 then line := 0.5; end if;
      ph := least(0.95, greatest(0.05, 1 - _phi((line - mean) / sd)));
      title := format('%s: %s %s', names, _stat_label(stat), _window_label(d_from, d_to));
      options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(ph)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - ph)));
      subject := jsonb_build_object('template', tpl, 'player_id', ids[1], 'stat', stat, 'line', line, 'from', d_from, 'to', d_to, 'settle', 'auto', 'mean', round(mean, 1));
      note := format('The Book expects %s over %s games. Counted from the box scores; refunded if he never dresses in the window. The price moves with the box scores; a ticket keeps the price it was bought at.', round(mean, 1), n);
    end if;
    return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  if tpl = 'club_race' then
    if what not in ('points', 'division', 'conference', 'president', 'cup', 'playoffs') then raise exception 'Pick a race'; end if;
    select array_agg(distinct upper(v)) into clubs from jsonb_array_elements_text(coalesce(p->'clubs', '[]'::jsonb)) v;
    if clubs is null or array_length(clubs, 1) < (case when what = 'points' then 2 else 1 end) then raise exception 'Pick % clubs', case when what = 'points' then 'two to eight' else 'a club, or up to eight' end; end if;
    if array_length(clubs, 1) > 8 then raise exception 'Eight clubs at most'; end if;
    if not exists (select 1 from nhl_teams) and what <> 'points' then raise exception 'The standings aren''t in yet; ask for a points race over a window instead'; end if;
    if exists (select 1 from nhl_teams) and (select count(*) from nhl_teams where abbrev = any(clubs)) < array_length(clubs, 1) then raise exception 'Unknown club'; end if;
    if what = 'points' then
      -- most standings points over the window, from the schedule: 2 × points % × games left
      first := _first_start(clubs, d_from, d_to);
      if first is null then raise exception 'No games left in that window'; end if;
      closes := least(greatest(first, now() + interval '48 hours'), (d_to + 1)::timestamp at time zone 'America/Toronto');
      select jsonb_agg(jsonb_build_object('abbrev', c, 'gl', _club_games_left(c, d_from, d_to), 'x', round(_club_points_in(c, d_from, d_to) + 2 * _club_rating(c) * _club_games_left(c, d_from, d_to), 2))) into rows from unnest(clubs) c;
      if exists (select 1 from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric) where gl = 0) then
        raise exception '% has no games left in that window', (select abbrev from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric) where gl = 0 limit 1);
      end if;
      select avg(gl), max(x) into mean, tot from jsonb_to_recordset(rows) as r(abbrev text, gl int, x numeric);
      sd := greatest(0.75, 0.95 * sqrt(greatest(1, mean)));   -- the spread is on the games still to play
      select sum(exp((x - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(abbrev text, x numeric);
      select jsonb_agg(jsonb_build_object('key', 'c' || abbrev, 'label', abbrev, 'odds', _odds_long(round(exp((x - tot) / sd) / sumw, 4))) order by x desc, abbrev),
             string_agg(format('%s %s', abbrev, round(x, 1)), ', ' order by x desc)
        into options, lbl from jsonb_to_recordset(rows) as r(abbrev text, x numeric);
      title := format('%s: most points %s', array_to_string(clubs, ' vs '), _window_label(d_from, d_to));
      note := format('Expected: %s. Standings points (2 a win, 1 an overtime or shootout loss) over the window, from the schedule; a tie refunds everyone.', lbl);
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'from', d_from, 'to', d_to, 'settle', 'auto');
      return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    elsif what = 'playoffs' then
      closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
      select least(0.97, greatest(0.03, coalesce(playoff_odds, 0.5))) into ph from nhl_teams where abbrev = clubs[1];
      title := format('%s: make the playoffs?', _club_label(clubs[1]));
      options := jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'In', 'odds', _odds(ph)), jsonb_build_object('key', 'no', 'label', 'Out', 'odds', _odds(1 - ph)));
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'settle', 'auto');
      note := format('The standings model has them %s%% to get in. Settled when the bracket is set.', round(ph * 100));
      return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    else
      -- a season-long race: everyone in the group runs, the clubs not picked are "the field"
      closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
      if what = 'division' then
        if (select count(distinct division) from nhl_teams where abbrev = any(clubs)) > 1 then raise exception 'A division race needs clubs from one division'; end if;
        select array_agg(abbrev) into grp from nhl_teams where division = (select division from nhl_teams where abbrev = clubs[1]);
        title := format('%s: first in the %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, (select case division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else division || ' Division' end from nhl_teams where abbrev = clubs[1]));
      elsif what = 'conference' then
        if (select count(distinct conf) from nhl_teams where abbrev = any(clubs)) > 1 then raise exception 'A conference race needs clubs from one conference'; end if;
        select array_agg(abbrev) into grp from nhl_teams where conf = (select conf from nhl_teams where abbrev = clubs[1]);
        title := format('%s: first in the %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, (select case conf when 'E' then 'East' when 'W' then 'West' else conf end from nhl_teams where abbrev = clubs[1]));
      else
        select array_agg(abbrev) into grp from nhl_teams;
        title := format('%s: %s', case when array_length(clubs, 1) = 1 then _club_label(clubs[1]) else array_to_string(clubs, ' vs ') end, case when what = 'cup' then 'the Stanley Cup' else 'the Presidents'' Trophy' end);
      end if;
      if what = 'cup' then
        -- in the playoffs and strong once there
        select jsonb_agg(jsonb_build_object('abbrev', abbrev, 'picked', abbrev = any(clubs), 'x', greatest(0.01, coalesce(playoff_odds, 0.5)) * exp(12 * (coalesce(strength, 0.5) - 0.5)))) into rows from nhl_teams where abbrev = any(grp);
        note := 'Priced from each club''s playoff odds and strength. Settled by the commish when the Cup is handed over.';
      else
        -- final points: banked plus 2 × strength × games left, a softmax that tightens as the games run out
        select avg(_club_games_left(abbrev, today_et(), season_end)) into mean from nhl_teams where abbrev = any(grp);
        sigma := greatest(1, 0.95 * sqrt(greatest(1, mean)));
        select max(pts + 2 * coalesce(strength, 0.5) * _club_games_left(abbrev, today_et(), season_end)) into tot from nhl_teams where abbrev = any(grp);
        select jsonb_agg(jsonb_build_object('abbrev', abbrev, 'picked', abbrev = any(clubs), 'x', exp((pts + 2 * coalesce(strength, 0.5) * _club_games_left(abbrev, today_et(), season_end) - tot) / sigma))) into rows from nhl_teams where abbrev = any(grp);
        note := 'Final regular-season points, from the standings when the 82 are played. A tie at the top goes to the NHL tiebreakers, settled by the commish.';
      end if;
      select sum(x), coalesce(sum(x) filter (where not picked), 0) into sumw, wfield from jsonb_to_recordset(rows) as r(abbrev text, picked boolean, x numeric);
      select jsonb_agg(jsonb_build_object('key', 'c' || abbrev, 'label', abbrev, 'odds', _odds_long(round(x / sumw, 4))) order by x desc, abbrev) into options from jsonb_to_recordset(rows) as r(abbrev text, picked boolean, x numeric) where picked;
      if wfield > 0 then options := options || jsonb_build_array(jsonb_build_object('key', 'field', 'label', 'The field', 'odds', _odds_long(round(wfield / sumw, 4)))); end if;
      subject := jsonb_build_object('template', tpl, 'what', what, 'clubs', to_jsonb(clubs), 'group', to_jsonb(grp), 'settle', case when what = 'cup' then 'commish' else 'auto' end);
      return jsonb_build_object('kind', mkind, 'title', coalesce(nullif(p->>'title', ''), title), 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
    end if;
  end if;

  if tpl = 'club_line' then
    k := upper(coalesce(p->>'club', ''));
    select * into nt from nhl_teams where abbrev = k;
    if nt.abbrev is null then raise exception 'Pick a club'; end if;
    n := _club_games_left(k, today_et(), season_end);
    if n = 0 then raise exception 'They have played their 82'; end if;
    mean := nt.pts + 2 * coalesce(nt.strength, 0.5) * n;
    sd := greatest(1, 0.95 * sqrt(n));
    line := coalesce(nullif(p->>'line', '')::numeric, floor(mean) + 0.5);
    if line <> floor(line) + 0.5 then line := floor(line) + 0.5; end if;
    ph := 1 - _phi((line - mean) / sd);
    closes := least(now() + interval '48 hours', (season_end + 1)::timestamp at time zone 'America/Toronto');
    title := format('%s: season points', nt.name);
    options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(ph)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - ph)));
    subject := jsonb_build_object('template', tpl, 'club', k, 'line', line, 'settle', 'auto', 'mean', round(mean, 1));
    note := format('%s banked, %s games left, the Book projects %s. Settled from the standings when the 82 are played.', nt.pts, n, round(mean, 1));
    return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
  end if;

  raise exception 'Pick a template';
end $$;
revoke execute on function public.preview_market(jsonb) from public, anon;
grant execute on function public.preview_market(jsonb) to authenticated;

-- the live price of a player race against the field: everyone in the pool, so far plus what's left
create or replace function public._race_field_options(m markets) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb := m.subject; stat text := m.subject->>'stat'; d_from date := (m.subject->>'from')::date; d_to date := (m.subject->>'to')::date;
  ids int[]; grp int[]; rows jsonb; mean numeric; sd numeric; tot numeric; sumw numeric; wfield numeric; probs jsonb;
begin
  select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e;
  select array_agg(e::int) into grp from jsonb_array_elements_text(s->'group') e;
  grp := (select array_agg(distinct x) from unnest(grp || ids) x);
  select jsonb_agg(jsonb_build_object('id', pl.id, 'picked', pl.id = any(ids), 'sofar', _race_sofar(pl.id, stat, d_from, d_to),
    'left', _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to))) into rows from players pl where pl.id = any(grp);
  select avg(r."left"), max(r.sofar + r."left") into mean, tot from jsonb_to_recordset(rows) as r(id int, picked boolean, sofar numeric, "left" numeric);
  sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));
  select sum(exp((r.sofar + r."left" - tot) / sd)), coalesce(sum(exp((r.sofar + r."left" - tot) / sd)) filter (where not r.picked), 0) into sumw, wfield from jsonb_to_recordset(rows) as r(id int, picked boolean, sofar numeric, "left" numeric);
  select jsonb_object_agg('p' || r.id, exp((r.sofar + r."left" - tot) / sd) / sumw) into probs from jsonb_to_recordset(rows) as r(id int, picked boolean, sofar numeric, "left" numeric) where r.picked;
  probs := probs || jsonb_build_object('field', wfield / sumw);
  return (select jsonb_agg(o || jsonb_build_object('odds', _odds_long(round((probs->>(o->>'key'))::numeric, 4))) order by ord) from jsonb_array_elements(m.options) with ordinality as t(o, ord));
end $$;

-- a market's odds right now (re-created from migration 70: a player race against the field prices over its pool)
create or replace function public._live_options(m markets) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  g games; s jsonb := m.subject; opts jsonb := m.options; f numeric; oh numeric; oa numeric; ph numeric; lh numeric; la numeric; share numeric;
  hs int; aw int; i int; j int; w numeric; p_home numeric := 0; p_away numeric := 0; p_ot numeric := 0; p_over numeric := 0; line numeric;
  sofar numeric; mean numeric; sd numeric; per_game numeric; probs jsonb; d_from date; d_to date; stat text; ids int[]; rows jsonb; tot numeric; sumw numeric;
  pts jsonb; clubs text[]; keyp text;
begin
  if m.status <> 'open' then return opts; end if;

  -- tonight's markets: only while the game is on
  if m.kind in ('winner', 'total', 'ot', 'prop') then
    if m.game_id is null then return opts; end if;
    select * into g from games where id = m.game_id;
    if g.id is null or g.state not in ('LIVE', 'CRIT') then return opts; end if;
    f := _minutes_left(g) / 60;
    hs := coalesce(g.home_score, 0); aw := coalesce(g.away_score, 0);
    if m.kind = 'prop' then
      line := coalesce((s->>'line')::numeric, 0);
      select coalesce(sum(pg.fpts), 0) into sofar from player_games pg where pg.game_id = g.id and pg.player_id = (s->>'player_id')::int;
      per_game := greatest(0.5, _player_rate((s->>'player_id')::int, 'fpts'));
      mean := sofar + f * per_game; sd := sqrt(greatest(0.0001, f * greatest(0.6, per_game * 1.4)));
      p_over := case when f <= 0.001 then (case when sofar > line then 1 else 0 end) else 1 - _phi((line - mean) / sd) end;
      probs := jsonb_build_object('over', p_over, 'under', 1 - p_over);
    else
      -- the pre-game moneyline sets each side's scoring rate (the total and overtime markets borrow the moneyline on the same game)
      select (o->>'odds')::numeric into oh from markets mm, jsonb_array_elements(mm.options) o where mm.game_id = m.game_id and mm.kind = 'winner' and o->>'key' = 'home' order by mm.id limit 1;
      select (o->>'odds')::numeric into oa from markets mm, jsonb_array_elements(mm.options) o where mm.game_id = m.game_id and mm.kind = 'winner' and o->>'key' = 'away' order by mm.id limit 1;
      oh := coalesce(oh, 1.9); oa := coalesce(oa, 1.9);
      ph := (1 / oh) / (1 / oh + 1 / oa);
      lh := 3.05 * (1 + (ph - 0.5) * 0.9); la := 3.05 * (1 - (ph - 0.5) * 0.9);
      share := lh / (lh + la);
      line := coalesce((s->>'line')::numeric, 6.5);
      if upper(coalesce(g.period, '')) like '%OT%' or upper(coalesce(g.period, '')) like '%SO%' then
        p_ot := 1; p_home := share; p_away := 1 - share; p_over := case when hs + aw + 1 > line then 1 else 0 end;
      else
        for i in 0..12 loop
          for j in 0..12 loop
            w := _poisson(lh * f, i) * _poisson(la * f, j);
            if hs + i > aw + j then p_home := p_home + w;
            elsif aw + j > hs + i then p_away := p_away + w;
            else p_ot := p_ot + w; p_home := p_home + w * share; p_away := p_away + w * (1 - share); end if;
            if hs + i + aw + j + (case when hs + i = aw + j then 1 else 0 end) > line then p_over := p_over + w; end if;
          end loop;
        end loop;
      end if;
      probs := jsonb_build_object('home', p_home, 'away', p_away, 'yes', p_ot, 'no', 1 - p_ot, 'over', p_over, 'under', 1 - p_over);
    end if;
    return (select jsonb_agg(o || jsonb_build_object('odds', _odds_live((probs->>(o->>'key'))::numeric)) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
  end if;

  -- the season futures: re-priced from the standings on read
  if m.kind = 'future' then return coalesce(_future_options(s->>'what'), opts); end if;

  -- requested races: what's in the book so far plus what's left
  if m.kind = 'race' then
    stat := s->>'stat';
    if s->>'template' = 'player_race' and s ? 'group' then return _race_field_options(m); end if;
    if s->>'template' in ('player_race', 'player_line') then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      if s->>'template' = 'player_line' then ids := array[(s->>'player_id')::int]; else select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e; end if;
      select jsonb_agg(jsonb_build_object('id', pl.id, 'sofar', _race_sofar(pl.id, stat, d_from, d_to),
        'left', _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to))) into rows from players pl where pl.id = any(ids);
      select avg(r."left") into mean from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
      sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));
      if s->>'template' = 'player_race' then
        select max(r.sofar + r."left") into tot from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        select sum(exp((r.sofar + r."left" - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        select jsonb_object_agg('p' || r.id, exp((r.sofar + r."left" - tot) / sd) / sumw) into probs from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        return (select jsonb_agg(o || jsonb_build_object('odds', _odds_long(round((probs->>(o->>'key'))::numeric, 4))) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
      else
        select r.sofar + r."left" into mean from jsonb_to_recordset(rows) as r(id int, sofar numeric, "left" numeric);
        line := (s->>'line')::numeric;
        p_over := least(0.97, greatest(0.03, 1 - _phi((line - mean) / sd)));
        return jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(p_over)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - p_over)));
      end if;
    elsif s->>'template' = 'club_race' and s->>'what' = 'points' then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      select array_agg(e) into clubs from jsonb_array_elements_text(s->'clubs') e;
      select jsonb_agg(jsonb_build_object('abbrev', c, 'x', _club_points_in(c, d_from, d_to) + 2 * _club_rating(c) * _club_games_left(c, d_from, d_to), 'left', _club_games_left(c, d_from, d_to))) into rows from unnest(clubs) c;
      select avg(r."left"), max(r.x) into mean, tot from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      sd := greatest(0.75, 0.95 * sqrt(greatest(1, mean)));
      select sum(exp((r.x - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      select jsonb_object_agg('c' || r.abbrev, exp((r.x - tot) / sd) / sumw) into probs from jsonb_to_recordset(rows) as r(abbrev text, x numeric, "left" int);
      return (select jsonb_agg(o || jsonb_build_object('odds', _odds_long(round((probs->>(o->>'key'))::numeric, 4))) order by ord) from jsonb_array_elements(opts) with ordinality as t(o, ord));
    else
      -- season-long club races, the playoff yes/no and a club's season points: the same pricing as a fresh request
      begin
        pts := preview_market(jsonb_build_object('template', s->>'template', 'what', s->>'what', 'clubs', s->'clubs', 'club', s->>'club', 'line', s->>'line'));
        return coalesce(pts->'options', opts);
      exception when others then return opts; end;
    end if;
  end if;

  return opts;
end $$;


-- ───────────────────────────── settling the races (re-created from migration 68) ─────────────────────────────
-- Windows settle the morning after they close, from the box scores and the schedule; season-long club races
-- when the clubs have played their 82; the playoff yes/no when the bracket is set. The Cup, and any tie the
-- data can't break, is left for the commish (the market shows his settle buttons).
create or replace function public.settle_race_markets() returns int
language plpgsql security definer set search_path = public as $$
declare m markets; s jsonb; d_from date; d_to date; w text; val numeric; n int := 0; ids int[]; clubs text[]; grp text[]; top record; second record; stat text; alive int;
begin
  for m in select * from markets where status = 'open' and kind = 'race' and closes_at < now() and league_id = current_league_id() order by id loop
    s := m.subject; w := null; val := null;
    if s->>'template' in ('player_race', 'player_line', 'club_race') and s ? 'to' then
      d_from := (s->>'from')::date; d_to := (s->>'to')::date;
      if d_to >= today_et() then continue; end if;                                             -- the window is still running
      -- every game in the window final and, for players, in the box scores
      if exists (select 1 from games where date between d_from and d_to and game_type = 2 and (state not in ('OFF', 'FINAL', 'PPD', 'CNCL') or (state in ('OFF', 'FINAL') and not final_synced))) then continue; end if;
    end if;
    stat := s->>'stat';
    if s->>'template' = 'player_race' and s ? 'group' then
      -- against the field: the league-wide leader at the stat over the window (one position, goalies, or every skater)
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into top from player_games pg join players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last limit 1;
      select pg.player_id, sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) as v
        into second from player_games pg join players p on p.id = pg.player_id
        where pg.date between d_from and d_to and case s->>'pos' when 'G' then p.pos = 'G' when 'D' then p.pos = 'D' when 'F' then p.pos in ('C', 'LW', 'RW') else p.pos <> 'G' end
        group by pg.player_id order by v desc nulls last offset 1 limit 1;
      if top.player_id is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- no box scores at all: refund
      if second.v is not null and second.v = top.v then continue; end if;                                -- the NHL tiebreakers: the commish settles
      update markets set result = jsonb_build_object('winner', top.player_id, 'value', top.v) where id = m.id;
      w := case when _market_option_odds(m, 'p' || top.player_id) is not null then 'p' || top.player_id else 'field' end;
    elsif s->>'template' = 'player_race' then
      select array_agg(e::int) into ids from jsonb_array_elements_text(s->'players') e;
      with tot as (
        select i as player_id, coalesce((select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end)
                                        from player_games pg where pg.player_id = i and pg.date between d_from and d_to), 0) as v
        from unnest(ids) i)
      select jsonb_object_agg(player_id, v) into s from tot;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;   -- a tie refunds everyone
      w := 'p' || top.key;
    elsif s->>'template' = 'player_line' then
      select sum(case stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>stat)::numeric end) into val
      from player_games pg where pg.player_id = (s->>'player_id')::int and pg.date between d_from and d_to;
      if val is null then perform _payout_market(m.id, null); n := n + 1; continue; end if;    -- never dressed: refund
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    elsif s->>'template' = 'club_race' and s->>'what' = 'points' then
      select array_agg(e) into clubs from jsonb_array_elements_text(s->'clubs') e;
      with pts as (
        select c, coalesce((select sum(case when (g.home = c and g.home_score > g.away_score) or (g.away = c and g.away_score > g.home_score) then 2 when g.period in ('OT', 'SO') then 1 else 0 end)
                            from games g where c in (g.home, g.away) and g.date between d_from and d_to and g.game_type = 2 and g.state in ('OFF', 'FINAL') and g.home_score is not null), 0) as v
        from unnest(clubs) c)
      select jsonb_object_agg(c, v) into s from pts;
      update markets set result = jsonb_build_object('values', s) where id = m.id;
      select key, value::numeric as v into top from jsonb_each_text(s) order by value::numeric desc limit 1;
      select key, value::numeric as v into second from jsonb_each_text(s) order by value::numeric desc offset 1 limit 1;
      if second.v is not null and second.v = top.v then perform _payout_market(m.id, null); n := n + 1; continue; end if;
      w := 'c' || top.key;
    elsif s->>'template' = 'club_race' and s->>'what' in ('division', 'conference', 'president') then
      select array_agg(e) into grp from jsonb_array_elements_text(s->'group') e;
      if (select bool_and(gp >= 82) from nhl_teams where abbrev = any(grp)) is not true then continue; end if;
      select abbrev, pts into top from nhl_teams where abbrev = any(grp) order by pts desc limit 1;
      select abbrev, pts into second from nhl_teams where abbrev = any(grp) order by pts desc offset 1 limit 1;
      if second.pts = top.pts then continue; end if;                                          -- the NHL tiebreakers: the commish settles
      w := case when _market_option_odds(m, 'c' || top.abbrev) is not null then 'c' || top.abbrev else 'field' end;
      update markets set result = jsonb_build_object('winner', top.abbrev, 'value', top.pts) where id = m.id;
    elsif s->>'template' = 'club_race' and s->>'what' = 'playoffs' then
      select count(*) into alive from nhl_teams where po_status = 'alive';
      if alive <> 16 then continue; end if;                                                   -- the bracket isn't set
      w := case when exists (select 1 from nhl_teams where abbrev = s->'clubs'->>0 and po_status = 'alive') then 'yes' else 'no' end;
    elsif s->>'template' = 'club_line' then
      select pts into val from nhl_teams where abbrev = s->>'club' and gp >= 82;
      if val is null then continue; end if;
      update markets set result = jsonb_build_object('value', val) where id = m.id;
      w := case when val > (s->>'line')::numeric then 'over' else 'under' end;
    else
      continue;                                                                               -- the Cup: the commish
    end if;
    if w is not null then perform _payout_market(m.id, w); n := n + 1; end if;
  end loop;
  if n > 0 then perform _sys('general', format('🏁 The Book settled %s requested market%s. 👉 #/bets?t=book', n, case when n = 1 then '' else 's' end), jsonb_build_object('book', 'race-settle')); end if;
  return n;
end $$;


-- the house's NHL board, once a season (idempotent); runs with the season Book every morning
create or replace function public.open_nhl_markets() returns int
language plpgsql security definer set search_path = public as $$
declare l league; n int := 0; closes timestamptz; spec jsonb; req jsonb; d record; ids int[]; season_from date; season_to date := _nhl_season_end(); clubs text[];
begin
  select * into l from league;
  if l.id is null or l.phase <> 'season' then return 0; end if;
  if not exists (select 1 from nhl_teams where proj_pts is not null) then return 0; end if;
  if exists (select 1 from markets where kind = 'race' and subject->>'house' = 'nhl' and subject->>'season' = l.season and league_id = current_league_id()) then return 0; end if;
  closes := coalesce(l.trade_deadline, (season_to - 30)::timestamptz);
  if closes <= now() then return 0; end if;
  season_from := coalesce((select min(date) from games where game_type = 2), today_et());
  -- the clubs: the Cup (the eight strongest against the field), the Presidents' Trophy (the eight best projections), the divisions
  select array_agg(abbrev) into clubs from (select abbrev from nhl_teams order by strength desc nulls last, abbrev limit 8) t;
  req := jsonb_build_object('template', 'club_race', 'what', 'cup', 'clubs', to_jsonb(clubs), 'title', 'Stanley Cup winner');
  spec := preview_market(req);
  insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('race', spec->>'title', today_et(), (spec->'subject') || jsonb_build_object('house', 'nhl', 'season', l.season, 'terms', spec->>'note'), spec->'options', closes, current_league_id());
  n := n + 1;
  select array_agg(abbrev) into clubs from (select abbrev from nhl_teams order by proj_pts desc nulls last, abbrev limit 8) t;
  req := jsonb_build_object('template', 'club_race', 'what', 'president', 'clubs', to_jsonb(clubs), 'title', 'Presidents'' Trophy: best regular-season record');
  spec := preview_market(req);
  insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('race', spec->>'title', today_et(), (spec->'subject') || jsonb_build_object('house', 'nhl', 'season', l.season, 'terms', spec->>'note'), spec->'options', closes, current_league_id());
  n := n + 1;
  for d in select division, array_agg(abbrev order by proj_pts desc nulls last) as cl from nhl_teams group by division order by division loop
    req := jsonb_build_object('template', 'club_race', 'what', 'division', 'clubs', to_jsonb(d.cl[1:8]),
      'title', format('%s Division winner', case d.division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else d.division end));
    begin
      spec := preview_market(req);
      insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('race', spec->>'title', today_et(), (spec->'subject') || jsonb_build_object('house', 'nhl', 'season', l.season, 'terms', spec->>'note'), spec->'options', closes, current_league_id());
      n := n + 1;
    exception when others then null; end;
  end loop;
  -- the player awards: the league's top eight at the stat against the field, over the whole regular season
  for d in select * from (values
      ('pts', 'S', 'Art Ross: most points this season'), ('g', 'S', 'Rocket Richard: most goals this season'),
      ('w', 'G', 'Most wins by a goalie this season'), ('pts', 'D', 'Top-scoring defenceman this season')) as v(stat, pos, title) loop
    select array_agg(id) into ids from (
      select pl.id from players pl where pl.status = 'active' and pl.proj_stats is not null
        and case d.pos when 'G' then pl.pos = 'G' when 'D' then pl.pos = 'D' else pl.pos <> 'G' end
      order by (pl.proj_stats->>d.stat)::numeric desc nulls last limit 8) t;
    if coalesce(array_length(ids, 1), 0) < 2 then continue; end if;
    req := jsonb_build_object('template', 'player_race', 'stat', d.stat, 'players', to_jsonb(ids), 'field', true, 'pos', d.pos, 'from', season_from, 'to', season_to, 'whole_season', true, 'title', d.title);
    begin
      spec := preview_market(req);
      insert into markets (kind, title, date, subject, options, closes_at, league_id) values ('race', spec->>'title', today_et(), (spec->'subject') || jsonb_build_object('house', 'nhl', 'season', l.season, 'terms', spec->>'note'), spec->'options', closes, current_league_id());
      n := n + 1;
    exception when others then null; end;
  end loop;
  if n > 0 then
    perform _sys('general', format('🏒 The Book''s NHL board is open: the Stanley Cup, the Presidents'' Trophy, the division winners, the Art Ross, the Rocket Richard, most wins and the top defenceman. Prices move with the season; your ticket keeps its price. Open until %s. 👉 #/bets?t=book',
      to_char(closes at time zone 'America/Toronto', 'FMMonth FMDD')), jsonb_build_object('book', 'nhl'));
  end if;
  return n;
end $$;
