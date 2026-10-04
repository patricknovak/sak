-- A new league from start to its first scored night with nobody touching SQL (docs/EXPANSION.md, Phase 2's gate).
-- Walking a new league through it found three things:
--
-- * "Randomize the draft order" put every league's teams in the hat (it runs with the owner's rights, so row-level
--   security never narrowed it), and refused the order. SaK's would have failed the same way since the shadow league
--   opened. It draws from the caller's league now.
-- * An open seat (no GM yet) waited out the whole pick clock before its pick was made for it: 90 seconds a pick, every
--   round. It now goes in 4 seconds, like a GM on autodraft. Whoever takes the seat later gets the team as drafted.
-- * A new league opened in the keepers phase, with no rosters and nobody to keep. It opens ready to draft (predraft).
--   The keeper rule itself stays in its rules for the seasons after.
--
-- _advance and create_league are their live text with only those lines changed.

set client_min_messages = warning;

create or replace function public.draft_randomize_order() returns int[]
language plpgsql security definer set search_path = public as $$
declare o int[];
begin
  perform _commish();
  select array_agg(id order by random()) into o from teams where role = 'gm' and league_id = current_league_id();
  perform draft_set_order(o);
  return o;
end $$;

create or replace function public._advance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  st draft_state; nxt draft_picks; l league; t int; lid int := current_league_id();
begin
  select * into st from draft_state where league_id = lid for update;
  select * into l from league;
  select * into nxt from draft_picks where league_id = lid and season = st.season and player_id is null and overall is not null
    order by overall limit 1;
  if not found then
    update draft_state set status = 'done', current_overall = null, deadline = null, updated_at = now()
  where league_id = lid;
    update league set phase = 'season', updated_at = now();
    for t in select id from teams where league_id = lid and role = 'gm' loop perform _auto_lineup(t); end loop;
    perform _sys('draft', '🏁 The draft is complete! Lineups have been auto-set; tweak yours on My Team. Let the chirping begin.');
    perform _sys('general', '🏁 The draft is complete! Rosters are live.');
    -- Garry grades everyone's draft
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=draft&league=' || lid,
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 5000);
    return;
  end if;
  update draft_state set current_overall = nxt.overall,
    deadline = now() + make_interval(secs => case when (select autodraft or user_id is null from teams where id = nxt.team_id) then 4 else l.pick_seconds end),
    updated_at = now()
  where league_id = lid;
  perform _notify(nxt.team_id, 'draft', format('You''re on the clock! Pick #%s', nxt.overall), '/draft');
end $function$;

create or replace function public.create_league(p_slug text, p_name text, p_short text, p_brand jsonb DEFAULT '{}'::jsonb, p_seats integer DEFAULT 0, p_template integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare nid int; k int; tid int; season text; coin text;
begin
  if not is_platform_admin() then raise exception 'Only the platform can open a league'; end if;
  if p_slug !~ '^[a-z0-9][a-z0-9-]{1,30}$' then raise exception 'The short web name takes lowercase letters, numbers and dashes'; end if;
  if exists (select 1 from leagues where slug = p_slug) then raise exception 'That web name is taken'; end if;
  if coalesce(p_seats, 0) not between 0 and 20 then raise exception 'Between 0 and 20 seats'; end if;
  if not exists (select 1 from league_rules where league_id = p_template) then raise exception 'No such template league'; end if;
  insert into leagues (slug, name, short_name, brand, status, sport, owner_user)
  values (p_slug, p_name, p_short, coalesce(p_brand, '{}'::jsonb), 'setup', (select sport from leagues where id = p_template), auth.uid())
  returning id into nid;
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster,
    scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq)
  select nid, nid, p_name, p_short, r.season, 'predraft', r.keepers, r.top_scorer_rule, r.pick_seconds, r.draft_rounds, r.snake, r.roster,
    r.scoring, r.trade_review_hours, r.max_acquisitions, r.prize_split, r.playoff_share, r.cup_share, r.playoff_bonus_acq
  from league_rules r where r.league_id = p_template;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);
  -- the seats: open GM teams waiting for an invite; seat 1 runs the league
  season := (select r.season from league_rules r where r.league_id = nid);
  coin := _brand_word('{coin,name}', 'coins', nid);
  for k in 1..coalesce(p_seats, 0) loop
    insert into teams (name, abbrev, gm_name, league_id, role, is_commish, joined_season, auto_lineup, perms)
    values ('Team ' || k, 'T' || lpad(k::text, 2, '0'), 'Open seat', nid, 'gm', k = 1, season, false, '{}')
    returning id into tid;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || coin);
  end loop;
  return nid;
end $function$;
