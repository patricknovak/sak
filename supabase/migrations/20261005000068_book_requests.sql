-- Garry's Book, by request: the long bets on the NHL itself, opened only when a GM asks for one.
--   * The Book prices nothing it isn't asked for. A GM builds a market from a template, sees the odds, and opens
--     it by taking the first ticket; from then on it's on the board for everyone, marked "asked by". Nothing is
--     hosted for a bet nobody wants: no standing data, no nightly re-pricing, just the schedule, box scores and
--     standings the site already keeps.
--   * Templates: a game later in the week (moneyline, total, overtime: settled like tonight's), a race between
--     players on one stat over a window (most goals in October), a player's over/under on a stat over a window,
--     a race between NHL clubs (most points over a window, the division, the conference, the Presidents' Trophy,
--     the Stanley Cup) and a club's season points over/under, plus yes/no on a club making the playoffs.
--   * Odds come from what the site knows: a club's strength from the standings model (or its points percentage),
--     a player's rate this season (or his projection), the games left in the window. Odds freeze when the
--     market opens; tickets are taken until the race starts (or 48 hours, whichever is later) and never after.
--   * Settlement: windows from the box scores and the schedule the morning after they close; division,
--     conference, Presidents' and season-points markets when the clubs have played their 82; the playoff
--     yes/no when the bracket is set. The Cup, and any tie the data can't break, waits for the commish.
--   * Guidance: book_suggestions() offers a handful of markets worth asking for right now (marquee games
--     this week, races between the league's rostered stars, the tightest NHL race), computed on the fly.
--   * Limits so the board doesn't explode: 3 open requested markets per GM, 15 per league, no duplicates.
-- Everything reads the caller's league; the kinds and subjects stay sport-agnostic (stat keys and lines).
set client_min_messages = warning;

do $$ begin
  alter table public.markets drop constraint if exists markets_kind_check;
  alter table public.markets add constraint markets_kind_check check (kind in ('winner', 'total', 'ot', 'prop', 'custom', 'future', 'season_prop', 'race'));
end $$;

-- ───────────────────────────── the numbers the odds come from ─────────────────────────────
-- standard normal CDF (Abramowitz-Stegun), for over/unders at a line the GM chose
create or replace function public._phi(z numeric) returns numeric
language sql immutable as $$
  with t as (select 1 / (1 + 0.2316419 * abs(z)) as t, 0.3989423 * exp(-(z * z) / 2) as d)
  select round(case when z > 0 then 1 - p else p end, 4)
  from (select d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))) as p from t) x
$$;

-- how strong a club is, 0..1: the standings model's blend when it has one, else this season's points
-- percentage from the schedule, else even
create or replace function public._club_rating(p_abbrev text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(strength, point_pct, prior_pct) from nhl_teams where abbrev = p_abbrev), _club_form(p_abbrev), 0.5)
$$;

-- the last day of the NHL regular season on the schedule
create or replace function public._nhl_season_end() returns date
language sql stable security definer set search_path = public as $$
  select coalesce((select max(date) from games where game_type = 2), today_et() + 180)
$$;

-- regular-season games a club still has to play in a window (not counting one already under way)
create or replace function public._club_games_left(p_abbrev text, p_from date, p_to date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from games
  where p_abbrev in (home, away) and date between greatest(p_from, today_et()) and p_to and game_type = 2
    and state not in ('OFF', 'FINAL', 'PPD', 'CNCL') and start_utc > now()
$$;

-- the first puck drop still to come in a window for a set of clubs (when tickets stop)
create or replace function public._first_start(p_clubs text[], p_from date, p_to date) returns timestamptz
language sql stable security definer set search_path = public as $$
  select min(start_utc) from games
  where (home = any(p_clubs) or away = any(p_clubs)) and date between greatest(p_from, today_et()) and p_to and game_type = 2
    and state not in ('OFF', 'FINAL', 'PPD', 'CNCL') and start_utc > now()
$$;

-- a player's per-game rate of one stat: this season once he has five games, else his projection, else last season
create or replace function public._player_rate(p_player int, p_stat text) returns numeric
language sql stable security definer set search_path = public as $$
  with p as (select * from players where id = p_player), s as (select * from player_season where player_id = p_player),
  ls as (select case p_stat when 'fpts' then 'fp' else p_stat end as k)
  select round(coalesce(
    case when (select gp from s) >= 5 then
      case p_stat when 'fpts' then (select fpts / gp from s)
                  when 'pts' then (select ((totals->>'g')::numeric + (totals->>'a')::numeric) / gp from s)
                  else (select (totals->>p_stat)::numeric / gp from s) end end,
    case p_stat when 'fpts' then (select nullif(proj, 0) / coalesce(nullif(proj_gp, 0), 82) from p)
                else (select (proj_stats->>p_stat)::numeric / coalesce(nullif(proj_gp, 0), 82) from p) end,
    (select (last_stats->>(select k from ls))::numeric / nullif((last_stats->>'gp')::numeric, 0) from p),
    0), 3)
$$;

-- how spread out a stat is game to game, relative to a Poisson count (fantasy points and saves swing more)
create or replace function public._stat_spread(p_stat text) returns numeric
language sql immutable as $$ select case p_stat when 'fpts' then 1.7 when 'sv' then 1.5 else 0.9 end $$;

create or replace function public._stat_label(p_stat text) returns text
language sql immutable as $$
  select case p_stat when 'fpts' then 'fantasy points' when 'g' then 'goals' when 'a' then 'assists' when 'pts' then 'points' when 'sog' then 'shots'
    when 'hit' then 'hits' when 'blk' then 'blocked shots' when 'ppp' then 'power-play points' when 'w' then 'wins' when 'sv' then 'saves' when 'sho' then 'shutouts' else p_stat end
$$;

-- "in October", "from Oct 12 to Nov 3", "the rest of the season"
create or replace function public._window_label(p_from date, p_to date) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_to >= _nhl_season_end() and p_from <= today_et() then 'the rest of the season'
    when p_from = date_trunc('month', p_from)::date and p_to = (date_trunc('month', p_from) + interval '1 month - 1 day')::date then 'in ' || to_char(p_from, 'FMMonth')
    else format('from %s to %s', to_char(p_from, 'Mon FMDD'), to_char(p_to, 'Mon FMDD')) end
$$;

create or replace function public._club_label(p_abbrev text) returns text
language sql stable security definer set search_path = public as $$ select coalesce((select name from nhl_teams where abbrev = p_abbrev), p_abbrev) $$;

-- ───────────────────────────── pricing a request ─────────────────────────────
-- Build the market a request describes without opening it: title, options with odds, when tickets stop and how it
-- settles. Raises a plain-English reason when the request can't be priced. p: {template, ...}
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
      'mean', round(_player_rate(pl.id, stat) * _club_games_left(pl.nhl_team, d_from, d_to), 2))) into rows from players pl where pl.id = any(ids);
    if exists (select 1 from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric) where gl = 0) then
      raise exception '% has no games left in that window', (select short from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric) where gl = 0 limit 1);
    end if;
    select avg(r.mean), max(r.mean) into mean, tot from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric);
    sd := greatest(0.5, _stat_spread(stat) * sqrt(greatest(0.25, mean)));
    if tpl = 'player_race' then
      -- a softmax over expected totals, spread by how much the stat swings over the window
      select sum(exp((r.mean - tot) / sd)) into sumw from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric);
      select jsonb_agg(jsonb_build_object('key', 'p' || r.id, 'label', r.short, 'odds', _odds_long(round(exp((r.mean - tot) / sd) / sumw, 4))) order by r.mean desc, r.id),
             string_agg(r.short, ' vs ' order by r.mean desc, r.id),
             string_agg(format('%s %s', r.short, round(r.mean, 1)), ', ' order by r.mean desc, r.id),
             jsonb_object_agg(r.id, round(r.mean, 1))
        into options, names, lbl, subject from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric);
      title := format('%s: most %s %s', names, _stat_label(stat), _window_label(d_from, d_to));
      subject := jsonb_build_object('template', tpl, 'players', to_jsonb(ids), 'stat', stat, 'from', d_from, 'to', d_to, 'settle', 'auto', 'means', subject);
      note := format('Expected: %s. Counted from the box scores %s; a tie refunds everyone. Odds frozen when the market opened.', lbl, _window_label(d_from, d_to));
    else
      select r.mean, r.short, r.gl into mean, names, n from jsonb_to_recordset(rows) as r(id int, short text, gl int, mean numeric);
      line := coalesce(nullif(p->>'line', '')::numeric, floor(mean) + 0.5);
      if line <> floor(line) + 0.5 then line := floor(line) + 0.5; end if;      -- always a half, so there's no push
      if line < 0.5 then line := 0.5; end if;
      ph := least(0.95, greatest(0.05, 1 - _phi((line - mean) / sd)));
      title := format('%s: %s %s', names, _stat_label(stat), _window_label(d_from, d_to));
      options := jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', _odds(ph)), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', _odds(1 - ph)));
      subject := jsonb_build_object('template', tpl, 'player_id', ids[1], 'stat', stat, 'line', line, 'from', d_from, 'to', d_to, 'settle', 'auto', 'mean', round(mean, 1));
      note := format('The Book expects %s over %s games. Counted from the box scores; refunded if he never dresses in the window. Odds frozen when the market opened.', round(mean, 1), n);
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
      select jsonb_agg(jsonb_build_object('abbrev', c, 'x', round(2 * _club_rating(c) * _club_games_left(c, d_from, d_to), 2))) into rows from unnest(clubs) c;
      if exists (select 1 from jsonb_to_recordset(rows) as r(abbrev text, x numeric) where x = 0) then
        raise exception '% has no games left in that window', (select abbrev from jsonb_to_recordset(rows) as r(abbrev text, x numeric) where x = 0 limit 1);
      end if;
      select avg(x), max(x) into mean, tot from jsonb_to_recordset(rows) as r(abbrev text, x numeric);
      sd := greatest(0.75, 0.95 * sqrt(greatest(1, mean)));
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

-- ───────────────────────────── opening a requested market ─────────────────────────────
-- A GM opens the market they previewed by taking the first ticket. The Book keeps three open requests per GM
-- and fifteen per league, and won't open the same market twice.
create or replace function public.request_market(p jsonb, p_pick text, p_coins int) returns bigint
language plpgsql security definer set search_path = public as $$
declare me int := _team(); spec jsonb; id bigint; sig text; lbl text; o numeric; opts text;
begin
  perform _gm_only();
  if not can_do('bets') then raise exception 'Betting is switched off for your pass'; end if;
  if p_coins < 5 or p_coins > 500 then raise exception 'Bet between 5 and 500 coins'; end if;
  spec := preview_market(p);
  if (select count(*) from markets where created_by = me and status = 'open' and kind <> 'custom' and league_id = current_league_id()) >= 3 then
    raise exception 'You have three markets open already; wait for one to settle';
  end if;
  if (select count(*) from markets where created_by is not null and status = 'open' and kind <> 'custom' and league_id = current_league_id()) >= 15 then
    raise exception 'The board is full (15 requested markets); wait for one to settle';
  end if;
  sig := md5((((spec->'subject') - 'means' - 'mean' - 'group') || jsonb_build_object('kind', spec->>'kind', 'game_id', spec->>'game_id'))::text);
  if exists (select 1 from markets where status = 'open' and subject->>'sig' = sig and league_id = current_league_id()) then raise exception 'That market is already open: back it there'; end if;
  insert into markets (kind, title, game_id, date, subject, options, closes_at, created_by, league_id)
    values (spec->>'kind', left(spec->>'title', 140), nullif(spec->>'game_id', '')::bigint, (spec->>'date')::date,
      (spec->'subject') || jsonb_build_object('sig', sig, 'terms', spec->>'note', 'requested_by', me), spec->'options', (spec->>'closes_at')::timestamptz, me, current_league_id())
    returning markets.id into id;
  perform place_market_bet(id, p_pick, p_coins);
  select x->>'label', (x->>'odds')::numeric into lbl, o from jsonb_array_elements(spec->'options') x where x->>'key' = p_pick;
  select string_agg(format('%s @ %s', x->>'label', x->>'odds'), ' · ') into opts from jsonb_array_elements(spec->'options') x;
  perform _sys('general', format('🎟️ %s asked the Book for a market: "%s" · %s · and took %s ☘️ on %s. It''s open to everyone until %s. 👉 #/bets?t=book',
    _tname(me), spec->>'title', opts, p_coins, lbl, to_char((spec->>'closes_at')::timestamptz at time zone 'America/Toronto', 'FMDy Mon FMDD, FMHH:MI am')), jsonb_build_object('market', id, 'book', 'request'));
  return id;
end $$;
revoke execute on function public.request_market(jsonb, text, int) from public, anon;
grant execute on function public.request_market(jsonb, text, int) to authenticated;

-- the morning Book skips a game only when the house already has markets on it; a requested moneyline on a game
-- later in the week doesn't stop the total, the overtime and the props opening on the day, and no kind doubles up
create or replace function public.open_markets(p_date date default today_et()) returns int
language plpgsql security definer set search_path = public as $$
declare g record; n int := 0; fh numeric; fa numeric; ph numeric; pr record; line numeric; first_start timestamptz; ngames int := 0;
begin
  for g in select * from games where date = p_date and start_utc > now() and state not in ('PPD', 'CNCL')
             and not exists (select 1 from markets m where m.game_id = games.id and m.created_by is null) order by start_utc loop
    ngames := ngames + 1;
    first_start := coalesce(first_start, g.start_utc);
    fh := _club_form(g.home); fa := _club_form(g.away);
    ph := least(0.75, greatest(0.25, 0.54 + coalesce(fh - fa, 0) * 0.6));
    if not exists (select 1 from markets where game_id = g.id and kind = 'winner' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('winner', format('%s @ %s: who wins?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'home', 'label', g.home, 'odds', _odds(ph)), jsonb_build_object('key', 'away', 'label', g.away, 'odds', _odds(1 - ph))), g.start_utc);
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'total' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('total', format('%s @ %s: total goals', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away, 'line', 6.5),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over 6.5', 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under 6.5', 'odds', 1.9)), g.start_utc);
      n := n + 1;
    end if;
    if not exists (select 1 from markets where game_id = g.id and kind = 'ot' and status = 'open') then
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('ot', format('%s @ %s: goes to overtime?', g.away, g.home), g.id, p_date, jsonb_build_object('home', g.home, 'away', g.away),
          jsonb_build_array(jsonb_build_object('key', 'yes', 'label', 'OT or shootout', 'odds', 3.4), jsonb_build_object('key', 'no', 'label', 'Ends in regulation', 'odds', 1.28)), g.start_utc);
      n := n + 1;
    end if;
    -- SaK-points over/under on the two best SaK-rostered skaters in the game
    for pr in
      select p.id, p.name, r.team_id, coalesce(case when ps.gp >= 5 then ps.fpts / ps.gp end, p.proj / 82.0, 0) as avg
      from players p join rosters r on r.player_id = p.id left join player_season ps on ps.player_id = p.id
      where p.nhl_team in (g.home, g.away) and p.pos <> 'G' and p.injury_status is null
      order by avg desc limit 2
    loop
      line := floor(pr.avg * 2) / 2;                       -- to the half point, always ending in .5 so there's no push
      if line = floor(line) then line := line + 0.5; end if;
      line := round(greatest(0.5, line), 1);
      insert into markets (kind, title, game_id, date, subject, options, closes_at) values
        ('prop', format('%s: SaK points tonight', pr.name), g.id, p_date, jsonb_build_object('player_id', pr.id, 'stat', 'fpts', 'line', line, 'owner', pr.team_id),
          jsonb_build_array(jsonb_build_object('key', 'over', 'label', 'Over ' || line, 'odds', 1.9), jsonb_build_object('key', 'under', 'label', 'Under ' || line, 'odds', 1.9)), g.start_utc);
      n := n + 1;
    end loop;
  end loop;
  if n > 0 then
    perform _sys('general', format('📖 Garry''s Book is open: %s game%s %s, %s markets. Moneylines, totals, overtime and player props, St. Patrick coins only. First puck drop %s ET. 👉 #/bets?t=book',
      ngames, case when ngames = 1 then '' else 's' end, case when p_date = today_et() then 'tonight' else 'on ' || to_char(p_date, 'FMDay FMMonth FMDD') end, n, to_char(first_start at time zone 'America/Toronto', 'FMHH:MI am')), jsonb_build_object('book', p_date));
  end if;
  return n;
end $$;

-- ───────────────────────────── settling the races ─────────────────────────────
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
    if s->>'template' = 'player_race' then
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

-- ───────────────────────────── what's worth asking for ─────────────────────────────
-- A handful of markets the Book would price right now, computed on the fly (nothing is opened): the marquee games
-- in the week ahead, races between the league's rostered stars this month, the tightest NHL races. Each entry is
-- a request ready for preview_market(), with a line on why.
create or replace function public.book_suggestions() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb := '[]'::jsonb; x record; lid int := current_league_id(); d_to date; today date := today_et(); ids int[]; out_clubs text[]; nm text; season_end date := _nhl_season_end();
begin
  -- the rest of this month, or next month once there's under ten days left in this one
  d_to := (date_trunc('month', today) + interval '1 month - 1 day')::date;
  if d_to - today < 10 then d_to := (date_trunc('month', today) + interval '2 month - 1 day')::date; end if;
  d_to := least(d_to, season_end);

  -- marquee games in the next week: the two strongest clubs, with the league's own players in them
  for x in
    select * from (
      select g.id, g.away, g.home, g.date, g.start_utc, _club_rating(g.home) + _club_rating(g.away) as strength,
        (select count(*) from rosters r join players p on p.id = r.player_id where r.league_id = lid and r.slot not in ('IR') and p.nhl_team in (g.home, g.away)) as ours
      from games g
      where g.date > today and g.date <= today + 7 and g.game_type = 2 and g.state in ('FUT', 'PRE') and g.start_utc > now()
        and not exists (select 1 from markets m where m.game_id = g.id and m.status = 'open' and m.league_id = lid)) q
    order by q.strength + 0.02 * q.ours desc, q.start_utc limit 3
  loop
    out := out || jsonb_build_array(jsonb_build_object('template', 'game', 'bet', 'winner', 'game_id', x.id, 'label', format('%s @ %s · %s', x.away, x.home, to_char(x.date, 'FMDy Mon FMDD')),
      'why', format('Two of the strongest clubs%s', case when x.ours > 0 then format(', with %s of the league''s players on the ice', x.ours) else '' end), 'group', 'games'));
  end loop;

  -- the league's best skaters, one per GM team, racing on goals this month; and the best goalies on wins
  with best as (
    select distinct on (r.team_id) p.id, p.proj, coalesce(p.last_name, p.name) as short from rosters r join players p on p.id = r.player_id
    where r.league_id = lid and r.slot not in ('IR', 'BN') and p.pos <> 'G' and p.injury_status is null and p.proj > 0 order by r.team_id, p.proj desc),
  top4 as (select * from best order by proj desc limit 4)
  select array_agg(id), string_agg(short, ' vs ' order by proj desc) into ids, nm from top4;
  if array_length(ids, 1) >= 2 then
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'g', 'players', to_jsonb(ids), 'from', today, 'to', d_to, 'label', format('%s: most goals %s', nm, _window_label(today, d_to)),
      'why', 'The league''s biggest guns, each on a different GM''s roster', 'group', 'players'));
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'fpts', 'players', to_jsonb(ids), 'from', today, 'to', season_end, 'label', format('%s: most fantasy points the rest of the way', nm),
      'why', 'The long race between the league''s best', 'group', 'players'));
  end if;
  with best as (
    select distinct on (r.team_id) p.id, p.proj, coalesce(p.last_name, p.name) as short from rosters r join players p on p.id = r.player_id
    where r.league_id = lid and r.slot not in ('IR', 'BN') and p.pos = 'G' and p.injury_status is null and p.proj > 0 order by r.team_id, p.proj desc),
  top3 as (select * from best order by proj desc limit 3)
  select array_agg(id), string_agg(short, ' vs ' order by proj desc) into ids, nm from top3;
  if array_length(ids, 1) >= 2 then
    out := out || jsonb_build_array(jsonb_build_object('template', 'player_race', 'stat', 'w', 'players', to_jsonb(ids), 'from', today, 'to', d_to, 'label', format('%s: most wins %s', nm, _window_label(today, d_to)),
      'why', 'The league''s starting goalies', 'group', 'players'));
  end if;

  -- the NHL: the tightest division at the top, the club on the playoff bubble, the Presidents' Trophy and the Cup
  if exists (select 1 from nhl_teams where proj_pts is not null) then
    for x in
      select division, array_agg(abbrev order by proj_pts desc) as clubs, max(proj_pts) - (array_agg(proj_pts order by proj_pts desc))[2] as gap
      from nhl_teams where proj_pts is not null group by division order by gap, division limit 1
    loop
      out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'division', 'clubs', to_jsonb(x.clubs[1:4]),
        'label', format('The %s: %s', case x.division when 'A' then 'Atlantic' when 'M' then 'Metropolitan' when 'C' then 'Central' when 'P' then 'Pacific' else x.division end, array_to_string(x.clubs[1:4], ' vs ')),
        'why', format('The tightest division: %s points between first and second in the projections', round(x.gap)), 'group', 'nhl'));
    end loop;
    for x in select abbrev, name, playoff_odds from nhl_teams where playoff_odds is not null order by abs(playoff_odds - 0.5), abbrev limit 1 loop
      out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'playoffs', 'clubs', jsonb_build_array(x.abbrev), 'label', format('%s: make the playoffs?', x.name),
        'why', format('The bubble: %s%% to get in', round(x.playoff_odds * 100)), 'group', 'nhl'));
    end loop;
    select array_agg(abbrev order by proj_pts desc) into out_clubs from (select abbrev, proj_pts from nhl_teams order by proj_pts desc nulls last limit 4) t;
    out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'president', 'clubs', to_jsonb(out_clubs), 'label', format('Presidents'' Trophy: %s', array_to_string(out_clubs, ' vs ')), 'why', 'The four best clubs in the projections, or the field', 'group', 'nhl'));
    select array_agg(abbrev order by strength desc) into out_clubs from (select abbrev, strength from nhl_teams order by strength desc nulls last limit 4) t;
    out := out || jsonb_build_array(jsonb_build_object('template', 'club_race', 'what', 'cup', 'clubs', to_jsonb(out_clubs), 'label', format('Stanley Cup: %s', array_to_string(out_clubs, ' vs ')), 'why', 'The four strongest clubs, or the field', 'group', 'nhl'));
  end if;
  return out;
end $$;
revoke execute on function public.book_suggestions() from public, anon;
grant execute on function public.book_suggestions() to authenticated;
