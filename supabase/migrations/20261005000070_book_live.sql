-- Garry's Book, in play: odds that move while a market is open, without storing a single tick.
--   * A market's stored options are its opening odds. Its live odds are a function of state the site already
--     keeps: the games row (score, period, clock) for tonight's markets, the standings and box scores for the
--     long ones. _live_options(m) computes them on read; book_live() hands the board's live prices to the site in
--     one call; place_market_bet() stamps the live price on the ticket. Nothing is written per tick, no job runs.
--   * In play: tonight's markets (moneyline, total, overtime, player props) stay open after puck drop while the
--     game is live. The house keeps 10% in play (5% before the game). Guards, because the score feed polls every
--     minute or so and a GM watching TV sees a goal first: no bets when the feed is stale (the game row older
--     than two minutes), none in the last two minutes of regulation, none in overtime or a shootout.
--   * The long markets re-price on read: futures from the standings, requested races from the box scores so far
--     plus what's left, season-long club races and lines from the standings model. A ticket keeps the odds it was
--     placed at, as before, so the price moving changes nothing already bought.
-- The model is the one the site already shows as "% to hit": a Poisson grid on the goals left, each side's rate
-- set by the pre-game moneyline; a normal approximation for a player's points.
set client_min_messages = warning;

alter table public.market_bets add column if not exists placed_live boolean not null default false;

-- regulation minutes left in a game; 0 in overtime, a shootout, or once it's final
create or replace function public._minutes_left(g games) returns numeric
language sql immutable as $$
  select case
    when g.state in ('OFF', 'FINAL') then 0
    when upper(coalesce(g.period, '')) like '%OT%' or upper(coalesce(g.period, '')) like '%SO%' then 0
    when g.state not in ('LIVE', 'CRIT') then 60
    else greatest(0, (3 - coalesce(nullif(regexp_replace(coalesce(g.period, '1'), '\D', '', 'g'), ''), '1')::int) * 20
      + case when g.clock ~ '^\d+:\d+$' then split_part(g.clock, ':', 1)::numeric + split_part(g.clock, ':', 2)::numeric / 60 when g.clock = 'INT' then 0 else 20 end) end
$$;

create or replace function public._poisson(lambda numeric, k int) returns numeric
language sql immutable as $$ select exp(-lambda) * power(lambda, k) / (select exp(sum(ln(i))) from generate_series(1, greatest(k, 1)) i) * case when k = 0 then 1 else 1 end $$;

-- in-play odds: a 10% house edge, between 1.05 and 15
create or replace function public._odds_live(p numeric) returns numeric
language sql immutable as $$ select least(15, greatest(1.05, round(0.90 / greatest(0.06, least(0.97, p)), 2))) $$;

-- why an in-play bet can't be taken right now, or null when it can
create or replace function public._inplay_block(m markets, g games) returns text
language sql stable as $$
  select case
    when m.kind not in ('winner', 'total', 'ot', 'prop') then 'That market is closed'
    when g.id is null then 'That market is closed'
    when g.state in ('OFF', 'FINAL') then 'That game is over'
    when g.state not in ('LIVE', 'CRIT') then 'That market is closed'
    when g.updated_at < now() - interval '2 minutes' then 'The score feed is behind; try again in a minute'
    when upper(coalesce(g.period, '')) like '%OT%' or upper(coalesce(g.period, '')) like '%SO%' then 'No bets in overtime'
    when _minutes_left(g) < 2 then 'No bets in the last two minutes'
    else null end
$$;


-- a player's total of one stat inside a window so far (fantasy points, or a box-score stat)
create or replace function public._race_sofar(p_player int, p_stat text, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case p_stat when 'fpts' then pg.fpts when 'pts' then (pg.stats->>'g')::numeric + (pg.stats->>'a')::numeric else (pg.stats->>p_stat)::numeric end), 0)
  from player_games pg where pg.player_id = p_player and pg.date between p_from and p_to
$$;
-- a club's standings points inside a window so far, from the finished games on the schedule
create or replace function public._club_points_in(p_abbrev text, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when (g.home = p_abbrev and g.home_score > g.away_score) or (g.away = p_abbrev and g.away_score > g.home_score) then 2 when g.period in ('OT', 'SO') then 1 else 0 end), 0)
  from games g where p_abbrev in (g.home, g.away) and g.date between p_from and p_to and g.game_type = 2 and g.state in ('OFF', 'FINAL') and g.home_score is not null
$$;

-- Build the market a request describes without opening it: title, options with odds, when tickets stop and how it
-- settles. Raises a plain-English reason when the request can't be priced. p: {template, ...}
-- (Re-created from migration 68: a window that has already started counts what's in the book so far, so the
-- opening price and the live price agree.)
--   game:        {game_id, bet: winner|total|ot}
--   player_race: {players: [id, ...], stat, from, to}
--   player_line: {player_id, stat, from, to, line?}
--   club_race:   {what: points|division|conference|president|cup|playoffs, clubs: [abbrev, ...], from?, to?}
--   club_line:   {club, line?}
create or replace function public.preview_market(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  tpl text := p->>'template'; stat text := coalesce(p->>'stat', 'fpts'); what text := p->>'what';
  d_from date; d_to date; g games; r numeric; ph numeric; line numeric; mean numeric; sd numeric; sigma numeric;
  ids int[]; clubs text[]; grp text[]; names text; n int; mkind text := 'race'; title text; subject jsonb; options jsonb; closes timestamptz; note text; m_date date;
  first timestamptz; nt record; tot numeric; sumw numeric; wfield numeric; k text; lbl text; rows jsonb; season_end date := _nhl_season_end();
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
  if d_from < today_et() then d_from := today_et(); end if;
  if d_from > season_end then raise exception 'The regular season is over by then'; end if;
  if d_to > season_end then d_to := season_end; end if;
  if d_to < d_from then raise exception 'The window ends before it starts'; end if;
  m_date := d_from;

  if tpl in ('player_race', 'player_line') then
    if tpl = 'player_line' then ids := array[nullif(p->>'player_id', '')::int]; else select array_agg(distinct v::int) into ids from jsonb_array_elements_text(coalesce(p->'players', '[]'::jsonb)) v; end if;
    if ids is null or array_length(ids, 1) < (case when tpl = 'player_line' then 1 else 2 end) then raise exception 'Pick % players', case when tpl = 'player_line' then 'a player' else 'two to six' end; end if;
    if array_length(ids, 1) > 6 then raise exception 'Six players at most'; end if;
    if (select count(*) from players where id = any(ids)) < array_length(ids, 1) then raise exception 'Unknown player'; end if;
    if (select count(distinct pos = 'G') from players where id = any(ids)) > 1 then raise exception 'Skaters race skaters and goalies race goalies'; end if;
    if (select bool_or(pos = 'G') from players where id = any(ids)) and stat not in ('fpts', 'w', 'sv', 'sho') then raise exception 'Goalies race on fantasy points, wins, saves or shutouts'; end if;
    if (select bool_or(pos <> 'G') from players where id = any(ids)) and stat in ('w', 'sv', 'sho') then raise exception 'That''s a goalie stat'; end if;
    select array_agg(distinct nhl_team) into clubs from players where id = any(ids) and nhl_team is not null;
    first := case when clubs is null then null else _first_start(clubs, d_from, d_to) end;
    if first is null then raise exception 'No games left in that window'; end if;
    -- tickets stop at the first game of the race, but a race starting tonight still takes tickets for 48 hours
    closes := greatest(first, now() + interval '48 hours');
    closes := least(closes, (d_to + 1)::timestamp at time zone 'America/Toronto');
    -- each player's expected total: his rate × his club's games left
    select jsonb_agg(jsonb_build_object('id', pl.id, 'short', coalesce(pl.last_name, pl.name), 'gl', _club_games_left(pl.nhl_team, d_from, d_to),
      'left', round(_player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2),
      'mean', round(_race_sofar(pl.id, stat, d_from, d_to) + _player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2))) into rows from players pl where pl.id = any(ids);
    if exists (select 1 from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric) where gl = 0) then
      raise exception '% has no games left in that window', (select short from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric) where gl = 0 limit 1);
    end if;
    select avg(r."left"), max(r.mean) into mean, tot from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric);
    sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));   -- the spread is on what's still to play
    if tpl = 'player_race' then
      -- a softmax over expected totals, spread by how much the stat swings over the window
      select sum(exp((r.mean - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric);
      select jsonb_agg(jsonb_build_object('key', 'p' || r.id, 'label', r.short, 'odds', _odds_long(round(exp((r.mean - tot) / sd) / sumw, 4))) order by r.mean desc, r.id),
             string_agg(r.short, ' vs ' order by r.mean desc, r.id),
             string_agg(format('%s %s', r.short, round(r.mean, 1)), ', ' order by r.mean desc, r.id),
             jsonb_object_agg(r.id, round(r.mean, 1))
        into options, names, lbl, subject from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric);
      title := format('%s: most %s %s', names, _stat_label(stat), _window_label(d_from, d_to));
      subject := jsonb_build_object('template', tpl, 'players', to_jsonb(ids), 'stat', stat, 'from', d_from, 'to', d_to, 'settle', 'auto', 'means', subject);
      note := format('Expected: %s. Counted from the box scores %s; a tie refunds everyone. The price moves with the box scores; a ticket keeps the price it was bought at.', lbl, _window_label(d_from, d_to));
    else
      select r.mean, r.short, r.gl into mean, names, n from jsonb_to_recordset(rows) as r(id int, short text, gl int, "left" numeric, mean numeric);
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
    if clubs is null or array_length(clubs, 1) < (case when what = 'playoffs' then 1 else 2 end) then raise exception 'Pick % clubs', case when what = 'playoffs' then 'a club' else 'two to eight' end; end if;
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
        title := format('%s: first in the %s', array_to_string(clubs, ' vs '), (select case division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else division || ' Division' end from nhl_teams where abbrev = clubs[1]));
      elsif what = 'conference' then
        if (select count(distinct conf) from nhl_teams where abbrev = any(clubs)) > 1 then raise exception 'A conference race needs clubs from one conference'; end if;
        select array_agg(abbrev) into grp from nhl_teams where conf = (select conf from nhl_teams where abbrev = clubs[1]);
        title := format('%s: first in the %s', array_to_string(clubs, ' vs '), (select case conf when 'E' then 'East' when 'W' then 'West' else conf end from nhl_teams where abbrev = clubs[1]));
      else
        select array_agg(abbrev) into grp from nhl_teams;
        title := format('%s: %s', array_to_string(clubs, ' vs '), case when what = 'cup' then 'the Stanley Cup' else 'the Presidents'' Trophy' end);
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
      return jsonb_build_object('kind', mkind, 'title', title, 'date', m_date, 'subject', subject, 'options', options, 'closes_at', closes, 'note', note);
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

-- a market's odds right now: the stored (opening) odds unless the market is in play or long-dated
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

create or replace function public._live_option_odds(m markets, p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select (o->>'odds')::numeric from jsonb_array_elements(_live_options(m)) o where o->>'key' = p_key
$$;

-- the live board in one call: every open market's odds right now (the site refreshes this as scores change)
create or replace function public.book_live() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(m.id, _live_options(m)), '{}'::jsonb) from markets m where m.status = 'open' and m.league_id = current_league_id()
$$;
revoke execute on function public.book_live() from public, anon;
grant execute on function public.book_live() to authenticated;

-- a ticket at the price the Book shows right now; tonight's markets stay open in play, with the guards above
create or replace function public.place_market_bet(p_market bigint, p_pick text, p_coins int) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); m markets; g games; o numeric; staked int; lbl text; live boolean := false; why text;
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  select * into m from markets where id = p_market for update;
  if m.status <> 'open' then raise exception 'That market is closed'; end if;
  if m.closes_at <= now() then
    if m.game_id is null then raise exception 'That market is closed'; end if;
    select * into g from games where id = m.game_id;
    why := _inplay_block(m, g);
    if why is not null then raise exception '%', why; end if;
    live := true;
  end if;
  o := _live_option_odds(m, p_pick);
  if o is null then raise exception 'Pick one of the options'; end if;
  if p_coins < 5 or p_coins > 500 then raise exception 'Bet between 5 and 500 coins'; end if;
  select coalesce(sum(coins), 0) into staked from market_bets where market_id = p_market and team_id = me;
  if staked + p_coins > 500 then raise exception 'Max 500 coins per market (you have % on it)', staked; end if;
  if p_coins > _coins_available(me) then raise exception 'You only have % St. Patrick coins available', _coins_available(me); end if;
  select o2->>'label' into lbl from jsonb_array_elements(m.options) o2 where o2->>'key' = p_pick;
  insert into market_bets (market_id, team_id, pick, coins, odds, placed_live) values (p_market, me, p_pick, p_coins, o, live)
    on conflict (market_id, team_id, pick) do update set odds = round((market_bets.coins * market_bets.odds + excluded.coins * excluded.odds) / (market_bets.coins + excluded.coins), 2),
      coins = market_bets.coins + excluded.coins, placed_live = market_bets.placed_live or excluded.placed_live;
  insert into coin_ledger (team_id, amount, reason) values (me, -p_coins, format('Book: %s · %s @ %s%s', m.title, lbl, o, case when live then ' (in play)' else '' end));
end $$;
