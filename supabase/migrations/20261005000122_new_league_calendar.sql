-- A new league's calendar, and the schedule on the checklist.
--
-- * create_league copied the template's rules but not its calendar: the season's first and last days, the trade
--   deadline and the end of the playoffs are the NHL's, the same for every league playing that season, and a new
--   league was left with none (no trade deadline, and a head-to-head schedule that can't be made). It copies them now,
--   and a league already opened without them takes them from SaK's when it plays the same season. The draft and keeper
--   dates stay each league's own.
-- * league_readiness: the rules line wants the season's dates too, and a head-to-head league can't go live without its
--   schedule.

set client_min_messages = warning;

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
  -- the rules from the template, and the season's calendar with them (the NHL's, the same for every league)
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster,
    scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq,
    season_start, season_end, trade_deadline, playoffs_end)
  select nid, nid, p_name, p_short, r.season, 'predraft', r.keepers, r.top_scorer_rule, r.pick_seconds, r.draft_rounds, r.snake, r.roster,
    r.scoring, r.trade_review_hours, r.max_acquisitions, r.prize_split, r.playoff_share, r.cup_share, r.playoff_bonus_acq,
    r.season_start, r.season_end, r.trade_deadline, r.playoffs_end
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

-- leagues opened before this: SaK's calendar when they play the same season (only the dates still empty are filled)
update league_rules r set
  season_start = coalesce(r.season_start, s.season_start), season_end = coalesce(r.season_end, s.season_end),
  trade_deadline = coalesce(r.trade_deadline, s.trade_deadline), playoffs_end = coalesce(r.playoffs_end, s.playoffs_end),
  updated_at = now()
from league_rules s
where s.league_id = 1 and r.league_id <> 1 and r.season = s.season
  and (r.season_start is null or r.season_end is null or r.trade_deadline is null or r.playoffs_end is null);

-- the checklist: [{key, label, ok, required, detail}], in the order a league is set up
create or replace function public.league_readiness(p_league int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l leagues; r league_rules; c teams; seats int; open int; uncoined int; out jsonb;
begin
  if not (is_platform_admin() or (p_league = current_league_id() and is_commish())) then
    raise exception 'Only the platform or this league''s commissioner can see that';
  end if;
  select * into l from leagues where id = p_league;
  if l.id is null then raise exception 'No such league'; end if;
  select * into r from league_rules where league_id = p_league;
  select * into c from teams where league_id = p_league and is_commish order by id limit 1;
  select count(*), count(*) filter (where user_id is null) into seats, open from teams where league_id = p_league and role = 'gm';
  select count(*) into uncoined from teams t where t.league_id = p_league and t.role = 'gm'
    and not exists (select 1 from coin_ledger x where x.team_id = t.id);
  out := jsonb_build_array(
    jsonb_build_object('key', 'name', 'label', 'Name and short name', 'required', true,
      'ok', coalesce(btrim(l.name), '') <> '' and coalesce(btrim(l.short_name), '') <> '', 'detail', concat_ws(' · ', l.name, l.short_name)),
    jsonb_build_object('key', 'rules', 'label', 'Rules, roster and scoring', 'required', true,
      'ok', r.id is not null and r.season is not null and r.roster is not null and r.profile_id is not null
        and r.season_start is not null and r.season_end is not null,
      'detail', case when r.id is null then 'No rules yet'
                     when r.season_start is null or r.season_end is null then concat('Season ', r.season, ': no first and last days yet')
                     else concat('Season ', r.season, ', phase ', r.phase) end),
    jsonb_build_object('key', 'commish', 'label', 'Commissioner signed in', 'required', true,
      'ok', c.user_id is not null, 'detail', case when c.id is null then 'No commissioner seat' when c.user_id is null then 'Send the commissioner''s invite' else c.gm_name end),
    jsonb_build_object('key', 'draft', 'label', 'Draft set up', 'required', true,
      'ok', exists (select 1 from draft_state where league_id = p_league),
      'detail', coalesce((select status from draft_state where league_id = p_league), 'No draft yet')),
    jsonb_build_object('key', 'coins', 'label', 'Opening coins for every GM', 'required', true,
      'ok', uncoined = 0, 'detail', case when uncoined = 0 then 'Every team has its coins' else uncoined || ' without' end));
  -- a head-to-head league plays a schedule; it is made on the Commish page
  if r.format = 'h2h' then
    out := out || jsonb_build_array(jsonb_build_object('key', 'schedule', 'label', 'Head-to-head schedule made', 'required', true,
      'ok', exists (select 1 from matchups m where m.league_id = p_league),
      'detail', coalesce((select max(m.week) || ' weeks' || case when r.h2h_playoffs >= 2 then ', then playoffs for the top ' || r.h2h_playoffs else '' end
                          from matchups m where m.league_id = p_league having count(*) > 0), 'The commissioner makes it on the Commish page')));
  end if;
  return out || jsonb_build_array(
    jsonb_build_object('key', 'seats', 'label', 'Every seat has a GM', 'required', false,
      'ok', seats > 0 and open = 0, 'detail', (seats - open) || ' of ' || seats || ' seats taken'),
    jsonb_build_object('key', 'voice', 'label', 'The league''s voice has a briefing', 'required', false,
      'ok', exists (select 1 from garry_state where league_id = p_league and coalesce(btrim(briefing), '') <> ''),
      'detail', 'The commissioner writes it on the Commish page'));
end $$;
revoke execute on function public.league_readiness(int) from public, anon;
grant execute on function public.league_readiness(int) to authenticated;
