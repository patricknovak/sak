-- The watch list hears injury news too (migration 140 brought the list). When a player's injury status changes, the
-- team that has him hears it as before, and now so does every team watching him (in any league, never twice: a team
-- that has him and watches him hears it once, as his owner). Same wording, marked as from the watch list.

set client_min_messages = warning;

create or replace function public._injury_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare o int; msg text;
begin
  if new.injury_status is not distinct from old.injury_status then return new; end if;
  msg := case when new.injury_status is null then format('✅ %s is off the injury report', new.name)
              else format('🚑 %s: %s%s', new.name, new.injury_status, coalesce(' · ' || left(new.injury_note, 90), '')) end;
  -- the team that has him, in every league that does
  for o in select team_id from rosters where player_id = new.id loop
    perform _notify(o, 'injury', msg, '/player/' || new.id);
  end loop;
  -- the teams watching him that don't have him
  for o in select w.team_id from watchlist w
           where w.player_id = new.id and not exists (select 1 from rosters r where r.player_id = new.id and r.team_id = w.team_id) loop
    perform _notify(o, 'injury', msg || ' (on your watch list)', '/player/' || new.id);
  end loop;
  return new;
end $$;
