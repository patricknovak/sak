-- Payouts follow the league's format. commish_post_payouts ranked every pot off the points tables, which is SaK's
-- game; a head-to-head or rotisserie league with money on would have paid its points leaders, not its winners.
--
-- * The regular-season pot: a head-to-head league pays its table (wins, losses and ties), a rotisserie league its
--   category table, a points league its points table as before.
-- * The playoff pot: a head-to-head league with a bracket pays the champion, the runner-up, then the better-seeded of
--   the semifinal losers, once the final is played. Otherwise the NHL playoff points table as before.
-- * The full-year pot stays on the points table (it is the season's points plus the playoffs' by definition).
-- * The last-place punishment ($1 a point behind second-last) is a points-league rule: only a points league posts it.
-- SaK posts exactly as before.

set client_min_messages = warning;

create or replace function public.commish_post_payouts(p_pot text) returns integer
language plpgsql security definer set search_path = public as $$
declare lg league; lid int := current_league_id(); pool numeric; share numeric; label text; n int := 0;
  last_t int; second_pts numeric; last_pts numeric; mine int[]; ranked int[]; t int; fin record; third int;
  h2h boolean; roto boolean;
begin
  perform _commish();
  select * into lg from league;
  if p_pot not in ('regular', 'playoffs', 'cup') then raise exception 'Pot is regular, playoffs or cup'; end if;
  h2h := lg.format = 'h2h';
  roto := not h2h and lg.categories is not null;
  label := case p_pot
    when 'regular' then _brand_word('{regular}', 'Regular season champion') || ' (regular season)'
    when 'playoffs' then regexp_replace(_brand_word('{playoff}', 'Playoff champion'), '^The ', '')
    else regexp_replace(_brand_word('{trophy}', 'The Cup'), '^The ', '') || ' (full year)' end;
  if exists (select 1 from ledger where league_id = lid and season = lg.season and kind = 'payout' and description like '%' || label || '%') then
    raise exception 'Those payouts are already posted';
  end if;
  -- this league's GMs only: the standings views run with the owner's rights here and would rank every league's teams
  select array_agg(id) into mine from teams where role = 'gm' and league_id = lid;
  pool := (lg.entry_fee - lg.sak_fee) * coalesce(array_length(mine, 1), 0);
  share := case p_pot when 'playoffs' then lg.playoff_share when 'cup' then lg.cup_share else 100 - lg.playoff_share - lg.cup_share end / 100;
  -- the top three, by the table this league plays for
  if p_pot = 'regular' and h2h then
    ranked := array(select x.team_id from h2h_standings() x where x.team_id = any (mine) order by x.rank, x.pf desc, x.team_id limit 3);
  elsif p_pot = 'regular' and roto then
    ranked := array(select x.team_id from category_standings() x where x.team_id = any (mine) order by x.rank, x.team_id limit 3);
  elsif p_pot = 'playoffs' and h2h and coalesce(lg.h2h_playoffs, 0) >= 2 then
    select * into fin from h2h_bracket() b order by b.round desc, b.slot limit 1;
    if not found or fin.status <> 'final' then raise exception 'The playoff final isn''t played yet'; end if;
    -- third: the semifinal loser with the better seed (a two-team bracket has no third)
    select case when b.winner = b.high_team then b.low_team else b.high_team end into third
    from h2h_bracket() b where b.round = fin.round - 1 and b.status = 'final'
    order by case when b.winner = b.high_team then b.low_seed else b.high_seed end limit 1;
    ranked := array_remove(array[fin.winner, case when fin.winner = fin.high_team then fin.low_team else fin.high_team end, third], null);
  else
    execute format('select array(select team_id from %I where team_id = any($1) order by rank, team_id limit 3)',
      case p_pot when 'regular' then 'standings' when 'playoffs' then 'playoff_standings' else 'sak_cup_standings' end) into ranked using mine;
  end if;
  foreach t in array coalesce(ranked, '{}') loop
    n := n + 1;
    insert into ledger (season, team_id, kind, amount, description)
      values (lg.season, t, 'payout', -round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2),
              format('%s %s: %s place', lg.season, label, case n when 1 then '1st' when 2 then '2nd' else '3rd' end));
    perform _notify(t, 'money', format('🏆 %s: $%s coming your way.', label, round(pool * share * (lg.prize_split->>(n - 1))::numeric / 100, 2)), '/money');
  end loop;
  -- the last-place punishment counts points behind second-last: a points league's rule
  if p_pot = 'regular' and not h2h and not roto then
    select team_id, points into last_t, last_pts from standings where team_id = any(mine) order by points asc, team_id limit 1;
    select points into second_pts from standings where team_id = any(mine) order by points asc, team_id offset 1 limit 1;
    if last_t is not null and second_pts > last_pts then
      insert into ledger (season, team_id, kind, amount, description)
        values (lg.season, last_t, 'peter', round(second_pts - last_pts, 2),
                format('%s %s Punishment: $1 a point behind second-last, to the %s', lg.season,
                       regexp_replace(_brand_word('{booby}', 'Last place'), '^The ', ''), _fund_name(lid)));
    end if;
  end if;
  perform _sys('general', format('💰 %s payouts posted. See the Money page.', label));
  return n;
end $$;
