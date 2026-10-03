-- A new league built in one call, by the platform (docs/EXPANSION.md, section 5).
--
-- create_league could be called by any league's commissioner, set no owner or sport, and left the league with no
-- seats, so nobody could be invited (only a league's commissioner can mint invites, and a new league has none).
-- Now:
--   * only a platform admin (ops.platform_admins) can create a league;
--   * the league records its owner and sport, and gets its rules from a template league (SaK's by default), its
--     draft row and its Garry row, as before;
--   * p_seats open GM seats are made with it (seat 1 is the commissioner's), each with its opening coins;
--   * platform_invite(league, seat) mints an invite for any seat of any league, so the first commissioner can be
--     invited into a league that has no commissioner yet. From then on the commissioner invites everyone else.
-- The old four-argument create_league is renamed out of the way (create_league_before_platform) and revoked.

set client_min_messages = warning;

do $$ begin
  if exists (select 1 from pg_proc where proname = 'create_league' and pronamespace = 'public'::regnamespace
             and pg_get_function_identity_arguments(oid) = 'p_slug text, p_name text, p_short text, p_brand jsonb') then
    if exists (select 1 from pg_proc where proname = 'create_league_before_platform' and pronamespace = 'public'::regnamespace) then
      -- run again after an earlier migration re-made the old one: the renamed copy is already kept
      drop function public.create_league(text, text, text, jsonb);
    else
      alter function public.create_league(text, text, text, jsonb) rename to create_league_before_platform;
      revoke execute on function public.create_league_before_platform(text, text, text, jsonb) from public, anon, authenticated;
    end if;
  end if;
end $$;

create or replace function public.create_league(p_slug text, p_name text, p_short text, p_brand jsonb default '{}',
  p_seats int default 0, p_template int default 1)
returns integer
language plpgsql security definer set search_path = public as $$
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
  select nid, nid, p_name, p_short, r.season, 'keepers', r.keepers, r.top_scorer_rule, r.pick_seconds, r.draft_rounds, r.snake, r.roster,
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
end $$;
revoke execute on function public.create_league(text, text, text, jsonb, int, int) from public, anon;
grant execute on function public.create_league(text, text, text, jsonb, int, int) to authenticated;

-- an invite to any seat of any league, for the platform: how the first commissioner gets in
create or replace function public.platform_invite(p_league int, p_team int, p_days int default 14) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare code text;
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  if not exists (select 1 from teams where id = p_team and league_id = p_league and role = 'gm' and user_id is null) then
    raise exception 'That seat isn''t open in that league';
  end if;
  code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values (code, p_league, p_team, 'gm', auth.uid(), now() + make_interval(days => greatest(p_days, 1)), 1);
  return code;
end $$;
revoke execute on function public.platform_invite(int, int, int) from public, anon;
grant execute on function public.platform_invite(int, int, int) to authenticated;
