-- Start a pool with no account yet (docs/POOLS.md section 6: the Love Is Blind test needs friend groups to open their own
-- pools, not wait for an invite). The `join` edge function makes the account and calls _pool_start_new; someone
-- already in a pool still uses pool_start (migration 151). Both open the pool the same way, through _pool_open.
--
-- Open sign-up stays off everywhere else. A new account made here has exactly one pool and is its host, and the door
-- has limits: three new pools a day from one address and sixty a day across the platform; past them the page says to
-- try again tomorrow or write in.

-- where new pools came from, for the limits (an address is kept only as a hash)
create table if not exists private.pool_signups (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  user_id uuid,
  league_id int,
  at timestamptz not null default now()
);
create index if not exists pool_signups_at on private.pool_signups (at);
create index if not exists pool_signups_ip on private.pool_signups (ip_hash, at);
revoke all on private.pool_signups from public, anon, authenticated;

create or replace function public._pool_open(p_user uuid, p_name text, p_color text, p_pack text, p_host text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := p_user; nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  col text := lower(coalesce(nullif(btrim(p_color), ''), '#38bdf8')); ws text; short text; words text[]; br jsonb; pk jsonb;
  nid int; tid int; who text; em text; season text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if length(nm) < 3 then raise exception 'Give the pool a name (3 to 40 characters)'; end if;
  if col !~ '^#[0-9a-f]{6}$' then raise exception 'Pick one of the colours'; end if;
  if (select count(*) from leagues where owner_user = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'That''s five pools today. Try again tomorrow';
  end if;
  if (select count(*) from leagues where owner_user = me) >= 25 then raise exception 'That''s 25 pools; write to hello@superpoolsai.com for more'; end if;
  if p_pack is not null and not exists (select 1 from pool_packs where slug = p_pack) then raise exception 'No such pack'; end if;

  ws := _pool_slug(nm);
  words := regexp_split_to_array(upper(nm), '\s+');
  short := left(coalesce(nullif(regexp_replace(array_to_string(array(select left(w, 1) from unnest(words) w), ''), '[^A-Z0-9]', '', 'g'), ''), 'SP'), 4);
  if length(short) < 2 then short := left(regexp_replace(upper(nm), '[^A-Z0-9]', '', 'g'), 3); end if;
  -- the pool's look: its own name and colour, a pack's coins and words if one was chosen
  pk := coalesce((select brand from pool_packs where slug = p_pack), '{}'::jsonb) - 'wordmark' - 'colors';
  br := jsonb_build_object(
          'wordmark', jsonb_build_object('a', left(words[1], 14), 'b', coalesce(nullif(left(array_to_string(words[2:], ' '), 18), ''), 'POOL')),
          'colors', jsonb_build_object('gold', col),
          'coin', jsonb_build_object('name', 'Coins', 'emoji', '🪙'),
          'tagline', 'A Super Pools pool', 'trophy', 'The Crown', 'booby', 'The Wooden Spoon',
          'bot', jsonb_build_object('name', 'Super Pools', 'emoji', '✨')) || pk;

  insert into leagues (slug, name, short_name, brand, status, sport, owner_user, kind)
  values (ws, nm, short, br, 'active', 'nhl', me, 'predict') returning id into nid;
  -- the model league's rules (nothing a pool reads but the season), no money and no fund
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster,
    scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq,
    season_start, season_end, trade_deadline, playoffs_end)
  select nid, nid, nm, short, r.season, 'season', r.keepers, r.top_scorer_rule, r.pick_seconds, r.draft_rounds, r.snake, r.roster,
    r.scoring, r.trade_review_hours, r.max_acquisitions, r.prize_split, r.playoff_share, r.cup_share, r.playoff_bonus_acq,
    r.season_start, r.season_end, r.trade_deadline, r.playoffs_end
  from league_rules r where r.league_id = 1;
  update league_rules set features = coalesce(features, '{}'::jsonb) - 'money' - 'fund' where league_id = nid;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  perform _draft_row(nid);

  -- the starter hosts it, under the name they go by elsewhere
  select coalesce(nullif(t.gm_name, 'Open seat'), split_part(u.email, '@', 1)), u.email into who, em
  from auth.users u left join league_members m on m.user_id = u.id left join teams t on t.id = m.team_id
  where u.id = me order by m.joined_at nulls last limit 1;
  who := coalesce(nullif(left(btrim(p_host), 40), ''), who);
  season := (select r.season from league_rules r where r.league_id = nid);
  insert into teams (name, abbrev, gm_name, login_email, user_id, league_id, color, emoji, role, is_commish, joined_season, auto_lineup, perms)
  values (left(coalesce(who, 'Host'), 40), coalesce(nullif(upper(left(regexp_replace(coalesce(who, ''), '[^A-Za-z]', '', 'g'), 3)), ''), 'HST'),
          left(coalesce(who, 'Host'), 40), em, me, nid, col, '👑', 'gm', true, season, false, '{}')
  returning id into tid;
  insert into coin_ledger (team_id, amount, reason) values (tid, 1000, 'Opening balance: 1,000 ' || _brand_word('{coin,name}', 'coins', nid));
  if p_pack is not null then perform _pool_load_pack(nid, p_pack, tid); end if;
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('👑 %s opened %s. Ask the questions on the Host page and send the invite link to bring friends in.', coalesce(who, 'The host'), nm),
    jsonb_build_object('pool_start', nid), nid);
  insert into accounts (user_id, active_league_id) values (me, nid)
  on conflict (user_id) do update set active_league_id = excluded.active_league_id, updated_at = now();
  return jsonb_build_object('id', nid, 'slug', ws);
end $$;
revoke execute on function public._pool_open(uuid, text, text, text, text) from public, anon, authenticated;

-- someone already in a pool opens another (unchanged for the caller)
create or replace function public.pool_start(p_name text, p_color text default null, p_pack text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from league_members where user_id = auth.uid()) then raise exception 'Join a pool first; then you can start your own'; end if;
  return _pool_open(auth.uid(), p_name, p_color, p_pack);
end $$;
revoke execute on function public.pool_start(text, text, text) from public, anon;
grant execute on function public.pool_start(text, text, text) to authenticated;

-- the door's limits, checked before an account is made: null means go ahead, else the reason to show
create or replace function public._pool_signup_check(p_ip text) returns text
language sql stable security definer set search_path = public, private as $$
  select case
    when coalesce(length(p_ip), 0) < 8 then 'Couldn''t start a pool from here. Try again in a minute.'
    when (select count(*) from private.pool_signups where ip_hash = p_ip and at > now() - interval '1 day') >= 3
      then 'That''s three new pools from here today. Try again tomorrow, or sign in and start one from My pools.'
    when (select count(*) from private.pool_signups where at > now() - interval '1 day') >= 60
      then 'Lots of pools started today. Try again tomorrow, or write to hello@superpoolsai.com and we''ll open yours.'
  end
$$;
revoke execute on function public._pool_signup_check(text) from public, anon, authenticated;
grant execute on function public._pool_signup_check(text) to service_role;

-- a brand-new account opens its pool: only for an account in no pool yet, and only past the door's limits
create or replace function public._pool_start_new(p_user uuid, p_name text, p_color text, p_pack text, p_host text, p_ip text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare why text := _pool_signup_check(p_ip); r jsonb;
begin
  if why is not null then raise exception '%', why; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'No such account'; end if;
  if exists (select 1 from league_members where user_id = p_user) or exists (select 1 from leagues where owner_user = p_user) then
    raise exception 'That account is already in a pool. Sign in and start one from My pools.';
  end if;
  r := _pool_open(p_user, p_name, p_color, p_pack, p_host);
  insert into private.pool_signups (ip_hash, user_id, league_id) values (p_ip, p_user, (r->>'id')::int);
  return r;
end $$;
revoke execute on function public._pool_start_new(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public._pool_start_new(uuid, text, text, text, text, text) to service_role;

-- the question packs, for the public start page (their names, size and colour; the questions stay for members)
create or replace function public.pool_pack_list() returns table (slug text, name text, questions int, color text)
language sql stable security definer set search_path = public as $$
  select p.slug, p.name, coalesce(jsonb_array_length(p.markets), 0), p.brand #>> '{colors,gold}' from pool_packs p order by p.name
$$;
grant execute on function public.pool_pack_list() to anon, authenticated;
