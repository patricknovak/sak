-- Pack path: pool_start → _pool_open never called pool_start_games, so leagues.sport stayed
-- the hardcoded 'nhl'. Stamp it from the pack's competition (competitions.pack) when opening.

create or replace function public._pool_open(p_user uuid, p_name text, p_color text, p_pack text, p_host text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := p_user; nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  col text := lower(coalesce(nullif(btrim(p_color), ''), '#38bdf8')); ws text; short text; words text[]; br jsonb; pk jsonb;
  nid int; tid int; who text; em text; season text; sport_id text;
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

  -- pack → competition → sport; show packs with no competition keep the default
  sport_id := coalesce(
    (select c.sport from competitions c where p_pack is not null and c.pack = p_pack order by c.id limit 1),
    'nhl');

  insert into leagues (slug, name, short_name, brand, status, sport, owner_user, kind)
  values (ws, nm, short, br, 'active', sport_id, me, 'predict') returning id into nid;
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
