-- Goal alerts in the box pool (docs/POOL-TYPES.md §2.7, "goal alerts"): when a player on a member's box pool team
-- scores, or a goalie on it gets the win, the member hears it while the game is on. nhl-sync writes `player_games`
-- every few minutes through a game; the trigger compares the new line with the old, so each goal is told once, and
-- only for teams locked into an open box pool whose nights include the game. It never stands in the way of the scores:
-- anything that goes wrong here is a warning, and the write goes on.

create or replace function public._box_goal_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g int := coalesce((new.stats->>'g')::int, 0); w int := coalesce((new.stats->>'w')::int, 0);
  og int := 0; ow int := 0; pg pool_games; pk record; pname text; gained int; pts int;
begin
  if tg_op = 'UPDATE' then og := coalesce((old.stats->>'g')::int, 0); ow := coalesce((old.stats->>'w')::int, 0); end if;
  if g <= og and w <= ow then return new; end if;
  if not exists (select 1 from pool_games where kind = 'players' and status = 'open') then return new; end if;
  begin
    select name into pname from players where id = new.player_id;
    gained := greatest(g - og, 0);
    for pg in select * from pool_games where kind = 'players' and status = 'open'
               and new.date between (rules->>'from')::date and (rules->>'to')::date
               and coalesce(_players_lock(id) <= now(), false) loop
      pts := gained * coalesce((pg.rules->'scoring'->>'g')::int, 1) + case when w > ow then coalesce((pg.rules->'scoring'->>'w')::int, 2) else 0 end;
      if pts <= 0 then continue; end if;
      for pk in select team_id from pool_picks where game_id = pg.id and thing = 'box' and pick->'players' @> to_jsonb(new.player_id) loop
        perform _pool_alert(pk.team_id, 'pool_game', case when gained > 0
            then format('🚨 %s scores%s for you in %s: +%s', pname, case when gained > 1 then format(' %s', gained) else '' end, lower(pg.title), pts)
            else format('🥅 %s gets the win for you in %s: +%s', pname, lower(pg.title), pts) end,
          '/picks?g=' || pg.id);
      end loop;
    end loop;
  exception when others then
    raise warning 'box goal alert for player % in game %: %', new.player_id, new.game_id, sqlerrm;
  end;
  return new;
end $$;
revoke execute on function public._box_goal_alert() from public, anon, authenticated;

drop trigger if exists player_games_box_goal on public.player_games;
create trigger player_games_box_goal after insert or update of stats on public.player_games
  for each row execute function public._box_goal_alert();
