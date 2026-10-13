-- A pack's new questions reach every pool already on it, and Love Is Blind gets a question set per drop (the 13 October
-- 2026 review, docs/DEVELOPMENT.md §9). Until now a pack's questions arrived with the pool and never again:
-- _pool_load_pack adds only what a pool doesn't have, but nothing called it after the start. The hourly pool job
-- (run_pool_drops) now reloads each open pool's packs; what arrives is said once in the pool's chat and once in each
-- member's bell (the pack loader itself stays quiet, as it was for a pool's first questions).
create or replace function public._pool_pack_refresh(p_league int) returns int
language plpgsql security definer set search_path = public as $$
declare pslug text; n int; total int := 0; names text; t record; pname text;
begin
  for pslug in select distinct m.pack from pool_markets m where m.league_id = p_league and m.pack is not null
               and exists (select 1 from pool_packs p where p.slug = m.pack) loop
    n := _pool_load_pack(p_league, pslug, null);
    if n = 0 then continue; end if;
    total := total + n;
    select name into pname from pool_packs where slug = pslug;
    select string_agg(format('"%s"', title), ' · ' order by sort, id) into names
      from (select title, sort, id from pool_markets where league_id = p_league and pack = pslug order by id desc limit n) q;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('🔮 %s new question%s from %s: %s', n, case when n = 1 then '' else 's' end, pname, names),
      jsonb_build_object('pool_pack', pslug, 'added', n), p_league);
    for t in select id from teams where league_id = p_league and role = 'gm' and user_id is not null loop
      perform _pool_alert(t.id, 'pool_new', format('🔮 %s new question%s to call from %s', n, case when n = 1 then '' else 's' end, pname), '/questions');
    end loop;
  end loop;
  return total;
end $$;
revoke execute on function public._pool_pack_refresh(int) from public, anon, authenticated;

create or replace function public.run_pool_drops() returns int
language sql security definer set search_path = public as $$
  select _pool_pack_refresh(current_league_id()) + _pool_pay_drops(current_league_id()) + _pool_nudge_closing(current_league_id()) + _soccer_nudge(current_league_id())
    + _pool_game_nudge(current_league_id()) + _squares_tick(null, current_league_id()) + _players_log(current_league_id()) + _players_recap(current_league_id()) + _players_settle(current_league_id()) + _props_auto(current_league_id()) + _pool_host_nudge(current_league_id()) + _streak_close(current_league_id()) + _sweep_tick(current_league_id()) + _pool_mark()
$$;
revoke execute on function public.run_pool_drops() from public, anon, authenticated;

-- Love Is Blind, season 11: the premiere's and the season's questions as before, plus a set for each of the two drops in
-- between (21 and 28 October), so a member has something to call every Wednesday. Each is about what the show airs, with
-- no cast named, so the pack holds before anyone knows the couples; the host settles each from the episodes. Netflix
-- drops at 3 am Eastern (07:00 UTC).
insert into public.pool_packs (slug, name, brand, markets, drops) values ('love-is-blind-s11', 'Love Is Blind · Season 11',
  '{"wordmark": {"a": "POD", "b": "SQUAD"}, "tagline": "A Love Is Blind pool", "trophy": "The Golden Goblet", "booby": "The Pod Wall",
    "icon": "💍", "blurb": "Every engagement, every getaway and every altar called with your friends, with coins on every drop",
    "coin": {"name": "Goblets", "emoji": "🥂"}, "bot": {"name": "Vee", "emoji": "💌"}, "colors": {"gold": "#fb7185"}}'::jsonb,
  '[
    {"title": "How many couples get engaged in the pods?", "category": "Before the premiere", "sort": 1,
     "rule": "Every engagement the show airs from the pods, counted when the couples leave them. A proposal accepted later, outside the pods, does not count.",
     "outcomes": ["4 or fewer", "5", "6", "7", "8 or more"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will a woman propose in the pods?", "category": "Before the premiere", "sort": 2,
     "rule": "Yes if the show airs a woman asking a man to marry her while they are in the pods, whatever his answer.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will an engagement end before the getaway?", "category": "Before the premiere", "sort": 3,
     "rule": "Yes if any engaged couple splits on screen between the reveal and the start of the getaway trip.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "Will the getaway be somewhere other than Mexico for any couple?", "category": "Before the premiere", "sort": 4,
     "rule": "Yes if at least one couple''s post-pods getaway, as aired, is outside Mexico.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-14T07:00:00Z"},
    {"title": "How many couples are still engaged when episode 8 ends?", "category": "Drop 2 (episodes 6-8)", "sort": 5,
     "rule": "Couples still engaged as the last scene of episode 8 ends. A split the show airs by then counts as over, whatever happens later.",
     "outcomes": ["3 or fewer", "4", "5", "6 or more"], "closes_at": "2026-10-21T07:00:00Z"},
    {"title": "Does a family member say on camera they are against the marriage?", "category": "Drop 2 (episodes 6-8)", "sort": 6,
     "rule": "Yes if, in episodes 6 to 8, a parent, sibling or other family member of either partner says on camera that they do not support the engagement or the wedding.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-21T07:00:00Z"},
    {"title": "Does anyone go back to a person they did not pick in the pods?", "category": "Drop 2 (episodes 6-8)", "sort": 7,
     "rule": "Yes if, in episodes 6 to 8, the show airs an engaged person meeting, calling or messaging someone they dated in the pods but did not choose.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-21T07:00:00Z"},
    {"title": "Does a couple sleep apart on the getaway?", "category": "Drop 2 (episodes 6-8)", "sort": 8,
     "rule": "Yes if, in episodes 6 to 8, the show airs or a couple says that they slept in separate rooms or beds on the getaway.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-21T07:00:00Z"},
    {"title": "How many couples are still engaged when episode 11 ends?", "category": "Drop 3 (episodes 9-11)", "sort": 9,
     "rule": "Couples still engaged as the last scene of episode 11 ends, going into the weddings.",
     "outcomes": ["2 or fewer", "3", "4", "5 or more"], "closes_at": "2026-10-28T07:00:00Z"},
    {"title": "Does a couple call it off before the altar in this drop?", "category": "Drop 3 (episodes 9-11)", "sort": 10,
     "rule": "Yes if, in episodes 9 to 11, an engaged couple ends the engagement on screen.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-28T07:00:00Z"},
    {"title": "Does someone cry at a dress or suit fitting?", "category": "Drop 3 (episodes 9-11)", "sort": 11,
     "rule": "Yes if the show airs tears at a wedding-outfit fitting in episodes 9 to 11, from the person being fitted or anyone with them.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-28T07:00:00Z"},
    {"title": "Does a bachelor or bachelorette party end in an argument?", "category": "Drop 3 (episodes 9-11)", "sort": 12,
     "rule": "Yes if, at a bachelor or bachelorette party the show airs in episodes 9 to 11, two or more people argue on camera.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-10-28T07:00:00Z"},
    {"title": "How many couples make it to the altar?", "category": "The whole season", "sort": 20,
     "rule": "Couples who stand at the altar at a wedding the show airs, whatever they say there. Trading stays open until the finale drops.",
     "outcomes": ["2 or fewer", "3", "4", "5 or more"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "How many couples say \"I do\"?", "category": "The whole season", "sort": 21,
     "rule": "Couples where both say \"I do\" at the altar, as aired in the finale. Trading stays open until the finale drops.",
     "outcomes": ["None", "1", "2", "3 or more"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "Will someone say \"I do\" while their partner says \"I don''t\"?", "category": "The whole season", "sort": 22,
     "rule": "Yes if, at any wedding the show airs, one says \"I do\" and the other does not.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-04T08:00:00Z"},
    {"title": "Will any couple still be together at the reunion?", "category": "The whole season", "sort": 23,
     "rule": "Yes if at least one couple from this season says at the reunion that they are together (married or not). Closes when the reunion drops; the host moves the date once Netflix announces it.",
     "outcomes": ["Yes", "No"], "closes_at": "2026-11-11T08:00:00Z"}
  ]'::jsonb,
  '[
    {"at": "2026-10-14T07:00:00Z", "amount": 250, "note": "Premiere night (episodes 1-5)"},
    {"at": "2026-10-21T07:00:00Z", "amount": 250, "note": "Drop 2 (episodes 6-8)"},
    {"at": "2026-10-28T07:00:00Z", "amount": 250, "note": "Drop 3 (episodes 9-11)"},
    {"at": "2026-11-04T08:00:00Z", "amount": 250, "note": "The weddings (episode 12)"}
  ]'::jsonb)
on conflict (slug) do update set name = excluded.name, brand = excluded.brand, markets = excluded.markets, drops = excluded.drops, updated_at = now();
