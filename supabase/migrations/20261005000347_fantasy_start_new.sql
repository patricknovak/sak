-- A fantasy league from the landing's door, with no account yet (3 November 2026, docs/DEVELOPMENT.md §9.25).
-- fantasy_start (migration 242) needs a member: someone already in a pool starts a league of their own. The landing's
-- "Run a fantasy league" door sent a stranger to that form, which could only tell them to sign in first. Now the join
-- function makes the account and opens the league in one go, the way it opens a pool (migration 153): the door's own
-- limits (_pool_signup_check: three a day per address, sixty a day in all), then _fantasy_start_new as the service
-- role. The league itself is opened by _fantasy_open, which fantasy_start now calls too, so both doors open the same
-- league: SaK's rules, roster, scoring and calendar, the choices made at the start, seat 1 the starter's as
-- commissioner, the rest waiting for invites.

-- the league, opened for a given account under a given name (the starter's, or the first seat's)
create or replace function public._fantasy_open(p_user uuid, p_host text, p_name text, p_color text default null, p_seats int default 8,
  p_format text default 'season', p_categories text[] default null, p_keepers int default 0, p_playoffs int default 0, p_snake boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := p_user; nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  col text := lower(coalesce(nullif(btrim(p_color), ''), '#f7c548')); ws text; short text; words text[]; br jsonb;
  nid int; tid int; who text; em text; season text; coin text; k int; cats text[];
begin
  if me is null then raise exception 'Sign in first'; end if;
  if length(nm) < 3 then raise exception 'Give the league a name (3 to 40 characters)'; end if;
  if col !~ '^#[0-9a-f]{6}$' then raise exception 'Pick one of the colours'; end if;
  if coalesce(p_seats, 0) not between 4 and 20 then raise exception 'A league takes 4 to 20 teams'; end if;
  if p_format not in ('season', 'h2h') then raise exception 'A league plays the season total or head-to-head'; end if;
  if coalesce(p_keepers, 0) not between 0 and 15 then raise exception 'Keep 0 to 15 players a team'; end if;
  if p_format = 'h2h' and coalesce(p_playoffs, 0) <> 0 and (p_playoffs not between 2 and 16 or p_playoffs > p_seats) then
    raise exception 'The playoffs take 2 to 16 teams (no more than the league has), or none';
  end if;
  if p_categories is not null and cardinality(p_categories) > 0 then
    cats := (select array_agg(c->>'key' order by o) from jsonb_array_elements(_category_catalogue()) with ordinality x(c, o) where c->>'key' = any (p_categories));
    if coalesce(cardinality(cats), 0) <> (select count(distinct k2) from unnest(p_categories) k2) then raise exception 'Pick categories from the list'; end if;
    if cardinality(cats) not between 3 and 12 then raise exception 'A category league plays 3 to 12 categories'; end if;
  end if;
  if (select count(*) from leagues where owner_user = me and kind is distinct from 'predict' and created_at > now() - interval '1 day') >= 2 and not is_platform_admin() then
    raise exception 'That''s two leagues today. Try again tomorrow';
  end if;
  if (select count(*) from leagues where owner_user = me and kind is distinct from 'predict' and status = 'setup') >= 5 and not is_platform_admin() then
    raise exception 'You have five leagues being set up: take one live or remove one first';
  end if;

  ws := _pool_slug(nm);
  words := regexp_split_to_array(upper(nm), '\s+');
  short := left(coalesce(nullif(regexp_replace(array_to_string(array(select left(w, 1) from unnest(words) w), ''), '[^A-Z0-9]', '', 'g'), ''), 'FL'), 4);
  if length(short) < 2 then short := left(regexp_replace(upper(nm), '[^A-Z0-9]', '', 'g'), 3); end if;
  br := jsonb_build_object(
    'wordmark', jsonb_build_object('a', left(words[1], 14), 'b', coalesce(nullif(left(array_to_string(words[2:], ' '), 18), ''), 'LEAGUE')),
    'colors', jsonb_build_object('gold', col), 'coin', jsonb_build_object('name', 'Coins', 'emoji', '🪙'),
    'tagline', 'A Super Pools league', 'trophy', 'The Cup', 'booby', 'The Wooden Spoon');
  insert into leagues (slug, name, short_name, brand, status, sport, owner_user)
  values (ws, nm, short, br, 'setup', 'nhl', me) returning id into nid;
  -- SaK's rules, roster, scoring and calendar, then the choices made at the start
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster,
    scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq,
    season_start, season_end, trade_deadline, playoffs_end)
  select nid, nid, nm, short, r.season, 'predraft', coalesce(p_keepers, 0), coalesce(p_keepers, 0) > 0 and r.top_scorer_rule, r.pick_seconds, r.draft_rounds,
    coalesce(p_snake, true), r.roster, r.scoring, r.trade_review_hours, r.max_acquisitions, r.prize_split, r.playoff_share, r.cup_share, r.playoff_bonus_acq,
    r.season_start, r.season_end, r.trade_deadline, r.playoffs_end
  from league_rules r where r.league_id = 1;
  update league_rules set format = p_format, categories = cats, h2h_playoffs = case when p_format = 'h2h' then coalesce(p_playoffs, 0) else 0 end,
    features = coalesce(features, '{}'::jsonb) - 'money' - 'fund', updated_at = now()
  where league_id = nid;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);

  -- seat 1 is the starter's, as commissioner, under the name they gave (or the one their first seat carries); the rest
  -- wait for invites
  select coalesce(nullif(t.gm_name, 'Open seat'), split_part(u.email, '@', 1)), u.email into who, em
  from auth.users u left join league_members m on m.user_id = u.id left join teams t on t.id = m.team_id
  where u.id = me order by m.joined_at nulls last limit 1;
  who := coalesce(nullif(left(btrim(p_host), 40), ''), who);
  season := (select r.season from league_rules r where r.league_id = nid);
  coin := _brand_word('{coin,name}', 'coins', nid);
  for k in 1..p_seats loop
    if k = 1 then
      insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, is_commish, joined_season, auto_lineup, perms)
      values (left(coalesce(who, 'Team 1'), 40), coalesce(nullif(upper(left(regexp_replace(coalesce(who, ''), '[^A-Za-z]', '', 'g'), 3)), ''), 'T01'),
              left(coalesce(who, 'Commissioner'), 40), em, me, nid, col, '👑', 'gm', true, season, false, '{}')
      returning id into tid;
    else
      insert into teams (name, abbrev, gm_name, league_id, role, is_commish, joined_season, auto_lineup, perms)
      values ('Team ' || k, 'T' || lpad(k::text, 2, '0'), 'Open seat', nid, 'gm', false, season, false, '{}')
      returning id into tid;
    end if;
    insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || coin);
  end loop;
  -- head-to-head: the weeks' matchups from the start (the commissioner can make them again on the Commish page)
  if p_format = 'h2h' then
    perform set_config('app.league_id', nid::text, true);
    begin perform commish_make_schedule(coalesce(p_playoffs, 0)); exception when others then null; end;
  end if;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('👑 %s started %s. Invite the GMs from the Commish page, set the draft, and take it live once the checklist is ticked.', coalesce(who, 'The commissioner'), nm),
    jsonb_build_object('fantasy_start', nid), nid);
  insert into accounts (user_id, active_league_id) values (me, nid)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return jsonb_build_object('id', nid, 'slug', ws);
end $$;
revoke execute on function public._fantasy_open(uuid, text, text, text, int, text, text[], int, int, boolean) from public, anon, authenticated;

-- a member starts a league of their own (migration 242), through the same door
create or replace function public.fantasy_start(p_name text, p_color text default null, p_seats int default 8, p_format text default 'season',
  p_categories text[] default null, p_keepers int default 0, p_playoffs int default 0, p_snake boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not (is_platform_admin() or exists (select 1 from league_members where user_id = me)) then raise exception 'Join a pool first; then you can start your own'; end if;
  return _fantasy_open(me, null, p_name, p_color, p_seats, p_format, p_categories, p_keepers, p_playoffs, p_snake);
end $$;
revoke execute on function public.fantasy_start(text, text, int, text, text[], int, int, boolean) from public, anon;
grant execute on function public.fantasy_start(text, text, int, text, text[], int, int, boolean) to authenticated;

-- a brand-new account opens its league: only for an account in no league yet, and only past the door's limits (the
-- same limits as a new pool's, counted together: a pool or a league is one start)
create or replace function public._fantasy_start_new(p_user uuid, p_host text, p_ip text, p_name text, p_color text default null, p_seats int default 8,
  p_format text default 'season', p_categories text[] default null, p_keepers int default 0, p_playoffs int default 0, p_snake boolean default true) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare why text := _pool_signup_check(p_ip); r jsonb;
begin
  if why is not null then raise exception '%', why; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such account'; end if;
  if exists (select 1 from league_members where user_id = p_user) or exists (select 1 from leagues where owner_user = p_user) then
    raise exception 'That account is already in a pool. Sign in and start the league from My pools.';
  end if;
  if length(btrim(coalesce(p_host, ''))) < 2 then raise exception 'Tell us your name'; end if;
  r := _fantasy_open(p_user, p_host, p_name, p_color, p_seats, p_format, p_categories, p_keepers, p_playoffs, p_snake);
  insert into private.pool_signups (ip_hash, user_id, league_id) values (p_ip, p_user, (r->>'id')::int);
  return r;
end $$;
revoke execute on function public._fantasy_start_new(uuid, text, text, text, text, int, text, text[], int, int, boolean) from public, anon, authenticated;
grant execute on function public._fantasy_start_new(uuid, text, text, text, text, int, text, text[], int, int, boolean) to service_role;
