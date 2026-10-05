-- Every GM can see every team's daily lineups, the days ahead as well as the days played: a team's planned lineups
-- (lineup_plans) were readable only by that team and the commissioner, and now by anyone in the league, the same as
-- rosters and the lineups each night locked in (lineup_snapshots). Seeing is all it opens: a plan is still written
-- only through set_lineup_plans and clear_lineup_plans, which act on the caller's own team, and authenticated has no
-- insert, update or delete on the table.
drop policy if exists read_own on public.lineup_plans;
drop policy if exists read_league on public.lineup_plans;
create policy read_league on public.lineup_plans for select to authenticated
  using (league_id = (select public.current_league_id()));
