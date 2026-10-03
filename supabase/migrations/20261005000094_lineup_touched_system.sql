-- A lineup change made by the system (lineup plans applied at puck drop, the auto-pilot, the shadow league) failed
-- when nobody was signed in: _lineup_touched asked _team(), which raises "Sign in as a GM first", so nhl-sync's score
-- sync failed whenever plans were due and no GM had touched the site yet (18 failed runs after midnight ET on
-- 2 October). The trigger only marks a GM's own hand-made change; it now asks my_team(), which is empty for the
-- system, so system changes pass through unmarked.
create or replace function public._lineup_touched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.slot is distinct from old.slot and my_team() = new.team_id then
    update teams set lineup_touched = today_et() where id = new.team_id and lineup_touched is distinct from today_et();
  end if;
  return new;
end $$;
