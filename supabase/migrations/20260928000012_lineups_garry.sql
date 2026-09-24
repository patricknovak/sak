-- Lineup auto-pilot (day / week / season modes, ranking basis, pins) and Garry answering questions.

-- ───────────── lineup preferences ─────────────
alter table public.teams add column if not exists auto_mode text not null default 'off'
  check (auto_mode in ('off', 'day', 'week', 'season'));
alter table public.teams add column if not exists auto_basis text not null default 'proj'
  check (auto_basis in ('proj', 'form', 'season'));
-- the last day a GM moved players by hand: the pre-game re-check leaves that team alone
alter table public.teams add column if not exists lineup_touched date;
update public.teams set auto_mode = 'day' where auto_lineup and auto_mode = 'off';

-- pin a player: always start him when he can play, or never start him
alter table public.rosters add column if not exists pin text check (pin in ('start', 'bench'));

-- recent form needs games played in the last 14 days too
create or replace view public.player_season as
  select pg.player_id, count(*) as gp, round(sum(pg.fpts), 2) as fpts,
    round(sum(pg.fpts) filter (where pg.date > today_et() - 14), 2) as fpts14,
    jsonb_build_object(
      'g', sum((stats->>'g')::numeric), 'a', sum((stats->>'a')::numeric), 'pm', sum((stats->>'pm')::numeric),
      'sog', sum((stats->>'sog')::numeric), 'hit', sum((stats->>'hit')::numeric), 'blk', sum((stats->>'blk')::numeric),
      'ppp', sum((stats->>'ppp')::numeric), 'w', sum((stats->>'w')::numeric), 'sv', sum((stats->>'sv')::numeric),
      'ga', sum((stats->>'ga')::numeric), 'sho', sum((stats->>'sho')::numeric)) as totals,
    count(*) filter (where pg.date > today_et() - 14) as gp14
  from player_games pg, league l
  group by pg.player_id;
revoke all on public.player_season from anon, authenticated;
grant select on public.player_season to authenticated;

-- apply a whole lineup at once: {"<player_id>": "<slot>", ...}. Checks ownership, locks, positions and
-- slot counts; either every move lands or none do.
create or replace function public._apply_lineup(p_team int, p_slots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  k text; v text; r rosters; p players; n int := 0; s text;
begin
  perform take_snapshots();
  for k, v in select * from jsonb_each_text(p_slots) loop
    select * into r from rosters where player_id = k::int and team_id = p_team for update;
    if not found then raise exception 'Player % is not on this roster', k; end if;
    if r.slot = v then continue; end if;
    select * into p from players where id = r.player_id;
    if player_locked(r.player_id) then raise exception '% is locked: his game has started', p.name; end if;
    if not slot_ok(p.elig, p.pos, v) then raise exception '% can''t play %', p.name, v; end if;
    update rosters set slot = v where player_id = r.player_id and team_id = p_team;
    n := n + 1;
  end loop;
  for s in select unnest(array['C','LW','RW','D','Util','G','BN','IR']) loop
    if (select count(*) from rosters where team_id = p_team and slot = s) > _cap(s) then
      raise exception 'Too many players at %', s;
    end if;
  end loop;
  return n;
end $$;

-- a GM setting their own lineup (from "Optimize" previews or the lineup editor)
create or replace function public.set_lineup(p_slots jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare me int := _team(); n int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  n := _apply_lineup(me, p_slots);
  if n > 0 then update teams set lineup_touched = today_et() where id = me; end if;
  return n;
end $$;

-- the auto-pilot (edge function, service role) applies a plan without counting as a manual change
create or replace function public.apply_auto_lineup(p_team int, p_slots jsonb) returns int
language sql security definer set search_path = public as $$ select _apply_lineup(p_team, p_slots) $$;

create or replace function public.set_lineup_prefs(p_mode text, p_basis text) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team();
begin
  update teams set auto_mode = coalesce(p_mode, auto_mode), auto_basis = coalesce(p_basis, auto_basis),
    auto_lineup = coalesce(p_mode, auto_mode) <> 'off'
  where id = me;
end $$;

create or replace function public.set_pin(p_player int, p_pin text) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team();
begin
  if p_pin is not null and p_pin not in ('start', 'bench') then raise exception 'Pin must be start or bench'; end if;
  update rosters set pin = p_pin where player_id = p_player and team_id = me;
  if not found then raise exception 'That player is not on your roster'; end if;
end $$;

-- moving a single player by hand also counts as a manual change for the day
create or replace function public._lineup_touched() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.slot is distinct from old.slot and _team() = new.team_id then
    update teams set lineup_touched = today_et() where id = new.team_id and lineup_touched is distinct from today_et();
  end if;
  return new;
end $$;
drop trigger if exists rosters_touched on public.rosters;
create trigger rosters_touched after update of slot on public.rosters
  for each row execute function public._lineup_touched();

-- the old profile toggle still works: on means "day" mode
create or replace function public.update_my_team(p_name text, p_motto text, p_color text, p_emoji text,
  p_fav_nhl text, p_auto_lineup boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me int := _team(); old text;
begin
  select name into old from teams where id = me;
  update teams set name = coalesce(nullif(trim(p_name), ''), name), motto = p_motto,
    color = coalesce(p_color, color), emoji = coalesce(nullif(p_emoji, ''), emoji),
    fav_nhl = p_fav_nhl, auto_lineup = coalesce(p_auto_lineup, auto_lineup),
    auto_mode = case when p_auto_lineup is null then auto_mode
                     when p_auto_lineup and auto_mode = 'off' then 'day'
                     when not p_auto_lineup then 'off' else auto_mode end
  where id = me;
  if old <> coalesce(nullif(trim(p_name), ''), old) then
    perform _sys('general', format('🪪 %s are now known as %s', old, trim(p_name)));
  end if;
end $$;

revoke all on function public._apply_lineup(int, jsonb), public.apply_auto_lineup(int, jsonb), public._lineup_touched()
  from public, anon, authenticated;
grant execute on function public.set_lineup(jsonb), public.set_lineup_prefs(text, text), public.set_pin(int, text)
  to authenticated;
grant execute on function public.apply_auto_lineup(int, jsonb) to service_role;

-- ───────────── Garry ─────────────
-- each GM gets a private "Ask Garry" channel, garry:<team id>, visible only to that team
drop policy if exists read_all on public.messages;
create policy read_all on public.messages for select to authenticated
  using ((channel not like 'dm:%' and channel not like 'garry:%')
    or (channel like 'dm:%' and public.my_team()::text = any (string_to_array(substr(channel, 4), '-')))
    or (channel like 'garry:%' and public.my_team()::text = substr(channel, 7)));
drop policy if exists post_own on public.messages;
create policy post_own on public.messages for insert to authenticated
  with check (team_id = public.my_team() and kind = 'user'
    and ((channel not like 'dm:%' and channel not like 'garry:%')
      or (channel like 'dm:%' and public.my_team()::text = any (string_to_array(substr(channel, 4), '-')))
      or (channel like 'garry:%' and public.my_team()::text = substr(channel, 7))));

-- Garry answers when he's addressed by name (not just @Garry), and every message in his own channel
create or replace function public._mention_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.kind <> 'user' then return new; end if;
  for t in select id, gm_name from teams where id is distinct from new.team_id
    and (new.body ~* ('@' || gm_name || '\M') or new.body ~* '@(all|everyone)\M') loop
    perform _notify(t.id, 'mention', format('%s: %s', _tname(new.team_id), left(new.body, 120)), '/chat?c=' || new.channel);
  end loop;
  if new.channel like 'garry:%' or (new.channel not like 'dm:%' and new.body ~* '\mgarry\M') then
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=reply',
      body := jsonb_build_object('message_id', new.id),
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 30000);
  end if;
  return new;
end $$;
revoke execute on function public._mention_notify() from public, anon, authenticated;
