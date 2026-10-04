-- One account, every pool (Patrick, 4 October 2026): a person sees all their pools in one place, starts a new one from
-- their own account, and carries the one sign-in into every pool.
--
-- * my_pools(): every league the caller belongs to, with where they stand and what needs them, worked out on read:
--   a fantasy league's rank, points and tonight's points (by its format), a trade offer waiting, the draft clock on
--   them; a prediction pool's rank by net worth, coins to spend, questions closing soon they haven't called, the next
--   coin drop; in both, unread chat and alerts. Each league is read as itself (app.league_id, the way the scheduler
--   reads them), and a league that fails to read shows without its summary instead of breaking the list.
-- * pool_start(name, colour, pack): a member opens a prediction pool of their own in one step. The pool gets a web name
--   from its name, a brand from its name and colour (a pack's coins and words if one is chosen), the rules of the model
--   league with no money in them, and the starter as its host with the opening coins. A few a day, a couple of dozen in
--   all, so a runaway script can't fill the platform. Fantasy leagues still open through a request (#/start): they need
--   a draft, seats and a season.

set client_min_messages = warning;

create or replace function public.my_pools() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); prev text := current_setting('app.league_id', true); here int := current_league_id();
  r record; out jsonb := '[]'; item jsonb; s jsonb; fmt text; cats boolean; n int; tid int; ds draft_state;
begin
  if me is null then return '[]'; end if;
  for r in
    select l.id, l.slug, l.name, l.short_name, l.kind, l.status, l.sport, l.brand, m.role, m.team_id, m.joined_at,
           t.name team_name, t.color team_color, t.emoji team_emoji
    from league_members m join leagues l on l.id = m.league_id left join teams t on t.id = m.team_id
    where m.user_id = me and l.status <> 'archived'
    order by m.joined_at, l.id
  loop
    item := jsonb_build_object('league_id', r.id, 'slug', r.slug, 'name', r.name, 'short', r.short_name, 'kind', r.kind,
      'status', r.status, 'sport', r.sport, 'role', r.role, 'team_id', r.team_id, 'team', r.team_name, 'team_color', r.team_color,
      'team_emoji', r.team_emoji, 'here', r.id = here,
      'brand', jsonb_build_object('colors', r.brand->'colors', 'wordmark', r.brand->'wordmark', 'coin', r.brand->'coin', 'tagline', r.brand->'tagline'));
    tid := r.team_id;
    begin
      perform set_config('app.league_id', r.id::text, true);
      s := '{}';
      if r.kind = 'predict' then
        with lb as (select team_id, coins, worth, row_number() over (order by worth desc, team_id) rk, count(*) over () total from pool_leaders())
        select jsonb_build_object('rank', rk, 'of', total, 'worth', worth, 'coins', coins) into s from lb where team_id = tid;
        s := coalesce(s, '{}') || jsonb_build_object(
          -- open questions closing within two days that this member hasn't called yet
          'closing', (select count(*) from pool_markets pm where pm.league_id = r.id and pm.status = 'open'
                       and pm.closes_at > now() and pm.closes_at < now() + interval '48 hours'
                       and not exists (select 1 from pool_positions pp where pp.market_id = pm.id and pp.team_id = tid and pp.shares > 0)),
          'open', (select count(*) from pool_markets pm where pm.league_id = r.id and pm.status = 'open' and pm.closes_at > now()),
          'next_drop', (select min(at) from pool_drops d where d.league_id = r.id and d.at > now()));
      elsif r.role <> 'spectator' and tid is not null then
        select format, categories is not null into fmt, cats from league_rules where league_id = r.id;
        select count(*) into n from teams where league_id = r.id and role <> 'spectator';
        if fmt = 'h2h' then
          select jsonb_build_object('rank', h.rank, 'of', n, 'record', h.w || '-' || h.l || case when h.t > 0 then '-' || h.t else '' end)
            into s from h2h_standings() h where h.team_id = tid;
        elsif cats then
          select jsonb_build_object('rank', c.rank, 'of', n, 'points', c.total) into s from category_standings() c where c.team_id = tid;
        else
          select jsonb_build_object('rank', st.rank, 'of', n, 'points', st.points, 'today', st.today,
                   'back', (select max(points) from standings) - st.points)
            into s from standings st where st.team_id = tid;
        end if;
        select * into ds from draft_state where league_id = r.id;
        s := coalesce(s, '{}') || jsonb_build_object(
          'trade_offers', (select count(*) from trades tr where tr.league_id = r.id and tr.status = 'proposed' and tr.to_team = tid),
          'draft', case when ds.status in ('live', 'paused') then ds.status end,
          'on_clock', ds.status = 'live' and exists (select 1 from draft_picks p where p.league_id = r.id and p.season = ds.season
                        and p.overall = ds.current_overall and p.team_id = tid),
          'deadline', case when ds.status = 'live' then ds.deadline end);
      end if;
      if tid is not null then
        s := s || jsonb_build_object(
          'unread_chat', (select least(count(*), 99) from messages msg where msg.league_id = r.id and msg.channel = 'general'
                           and msg.team_id is distinct from tid
                           and msg.id > coalesce((select last_read_id from chat_reads cr where cr.team_id = tid and cr.channel = 'general'), 0)),
          'alerts', (select count(*) from notifications nt where nt.team_id = tid and not nt.read));
      end if;
      item := item || jsonb_build_object('summary', s);
    exception when others then
      raise warning 'my_pools league %: %', r.id, sqlerrm;
    end;
    out := out || jsonb_build_array(item);
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return out;
end $$;
revoke execute on function public.my_pools() from public, anon;
grant execute on function public.my_pools() to authenticated;

-- a web name from a pool's name: lowercase words joined by dashes, never one of the app's own names, unique
create or replace function public._pool_slug(p_name text) returns text
language plpgsql stable set search_path = public as $$
declare base text; s text; k int := 1;
begin
  base := left(trim(both '-' from regexp_replace(lower(_plain_letters(p_name)), '[^a-z0-9]+', '-', 'g')), 26);
  if length(base) < 3 or base in ('www', 'app', 'api', 'admin', 'mail', 'send', 'rsend', 'superpools', 'superpool', 'platform', 'start',
                                  'join', 'help', 'support', 'status', 'docs', 'blog', 'pools', 'pool', 'sak') then
    base := trim(both '-' from left(coalesce(nullif(base, ''), 'my'), 21)) || '-pool';
  end if;
  s := base;
  while exists (select 1 from leagues where slug = s) loop
    k := k + 1; s := base || '-' || k;
  end loop;
  return s;
end $$;

-- accents off the letters where the extension isn't installed: the slug keeps what it can and drops the rest
create or replace function public._plain_letters(p text) returns text
language sql immutable set search_path = public as $$
  select translate(coalesce(p, ''), 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ',
                                    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')
$$;

create or replace function public.pool_start(p_name text, p_color text default null, p_pack text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  col text := lower(coalesce(nullif(btrim(p_color), ''), '#38bdf8')); ws text; short text; words text[]; br jsonb; pk jsonb;
  nid int; tid int; who text; em text; season text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from league_members where user_id = me) then raise exception 'Join a pool first; then you can start your own'; end if;
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
revoke execute on function public.pool_start(text, text, text) from public, anon;
grant execute on function public.pool_start(text, text, text) to authenticated;
revoke execute on function public._pool_slug(text) from public, anon, authenticated;
revoke execute on function public._plain_letters(text) from public, anon, authenticated;
