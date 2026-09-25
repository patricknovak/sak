-- Player stats by timeframe (this season, last 7 / 14 / 30 days) with every counting stat summed, for the
-- sort-by-any-stat tools on the Players page, the draft room and the mock draft. One row per player per
-- window; players with no games in a window have no row.
create or replace view public.player_windows as
  with w(win, days) as (values ('season', 100000), ('30', 30), ('14', 14), ('7', 7))
  select pg.player_id, w.win, count(*)::int as gp, round(sum(pg.fpts), 2) as fpts,
    jsonb_strip_nulls(jsonb_build_object(
      'g', sum((stats->>'g')::numeric), 'a', sum((stats->>'a')::numeric), 'pts', sum((stats->>'pts')::numeric),
      'pm', sum((stats->>'pm')::numeric), 'pim', sum((stats->>'pim')::numeric),
      'ppg', sum((stats->>'ppg')::numeric), 'ppa', sum((stats->>'ppa')::numeric), 'ppp', sum((stats->>'ppp')::numeric),
      'shg', sum((stats->>'shg')::numeric), 'sha', sum((stats->>'sha')::numeric), 'shp', sum((stats->>'shp')::numeric),
      'gwg', sum((stats->>'gwg')::numeric), 'sog', sum((stats->>'sog')::numeric),
      'fow', sum((stats->>'fow')::numeric), 'fol', sum((stats->>'fol')::numeric),
      'hit', sum((stats->>'hit')::numeric), 'blk', sum((stats->>'blk')::numeric),
      'gs', sum((stats->>'gs')::numeric), 'w', sum((stats->>'w')::numeric), 'l', sum((stats->>'l')::numeric),
      'otl', sum((stats->>'otl')::numeric), 'ga', sum((stats->>'ga')::numeric), 'sa', sum((stats->>'sa')::numeric),
      'sv', sum((stats->>'sv')::numeric), 'sho', sum((stats->>'sho')::numeric))) as totals
  from player_games pg cross join w
  where pg.date > today_et() - w.days
  group by pg.player_id, w.win;
revoke all on public.player_windows from anon, authenticated;
grant select on public.player_windows to authenticated;

-- housekeeping from the security advisor: signed-in-only functions were still executable by anon
revoke execute on function public.set_lineup(jsonb), public.set_lineup_prefs(text, text), public.set_pin(int, text),
  public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_device_count()
  from public, anon;
revoke execute on function public._push_on_notify() from public, anon, authenticated;
alter function public.slot_ok(text[], text, text) set search_path = public;
alter function public.today_et() set search_path = public;
alter function public._next_season(text) set search_path = public;
alter function public._player_games_fpts() set search_path = public;
