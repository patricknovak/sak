-- Which pages a pool's members open (docs/SUPERPOOLS.md item 14, the per-pool usage tables): the Monday read says how
-- many called and talked; this says what they came for. Pseudonymous and per day: a count of opens per page, and how
-- many members opened it, counted by a hash of the member and the day (never kept with a name, a team or an account,
-- and a new hash every day, so no one's path through the site can be followed). A commissioner switches it off for
-- the league (features.usage false, beside the live room); nothing is counted then. Platform admins read every
-- league's last week through platform_usage(); a league's own members read its rows. Safe to run twice.

create table if not exists public.usage_daily (
  league_id int not null default public.current_league_id() references public.leagues (id),
  day date not null,
  page text not null,
  opens int not null default 0,
  members int not null default 0,
  primary key (league_id, day, page)
);
alter table public.usage_daily enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.usage_daily'::regclass and polname = 'league_reads') then
    create policy league_reads on public.usage_daily for select to authenticated using (league_id = (select current_league_id()));
  end if;
end $$;
revoke all on public.usage_daily from anon;
revoke insert, update, delete on public.usage_daily from authenticated;
grant select on public.usage_daily to authenticated;

create table if not exists private.usage_seen (
  league_id int not null, day date not null, page text not null, who text not null,
  primary key (league_id, day, page, who)
);
revoke all on private.usage_seen from public, anon, authenticated;

-- a member opened a page: one open, and one member the first time today's hash is seen on it
create or replace function public.usage_hit(p_page text) returns void
language plpgsql security definer set search_path = public, private as $$
declare lid int := current_league_id(); d date := today_et(); who text; fresh int := 0;
begin
  if lid is null or auth.uid() is null or my_team() is null then return; end if;
  if (select features->>'usage' from league_rules where league_id = lid) = 'false' then return; end if;
  if p_page is null or p_page !~ '^[a-z0-9][a-z0-9_-]{0,31}$' then return; end if;
  who := md5(auth.uid()::text || ':' || d::text || ':' || lid::text);
  insert into private.usage_seen (league_id, day, page, who) values (lid, d, p_page, who) on conflict do nothing;
  get diagnostics fresh = row_count;
  insert into usage_daily (league_id, day, page, opens, members) values (lid, d, p_page, 1, fresh)
  on conflict (league_id, day, page) do update set opens = usage_daily.opens + 1, members = usage_daily.members + excluded.members;
end $$;
revoke execute on function public.usage_hit(text) from public, anon;
grant execute on function public.usage_hit(text) to authenticated;

-- the platform's read: each league's pages over the last seven days, most opened first
create or replace function public.platform_usage(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Platform admins only'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('league_id', l.id, 'name', l.name, 'kind', l.kind, 'pages', x.pages) order by x.total desc)
    from leagues l
    join lateral (
      select sum(opens) total, jsonb_agg(jsonb_build_object('page', page, 'opens', opens, 'member_days', member_days) order by opens desc) pages
      from (select page, sum(opens)::int opens, sum(members)::int member_days from usage_daily
            where league_id = l.id and day > today_et() - greatest(1, least(coalesce(p_days, 7), 90)) group by page) p
    ) x on x.total is not null), '[]'::jsonb);
end $$;
revoke execute on function public.platform_usage(int) from public, anon;
grant execute on function public.platform_usage(int) to authenticated;

-- the commissioner's switch: usage joins money, the fund and the live room
create or replace function public.commish_update_league(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f jsonb;
begin
  perform _commish();
  if p ? 'prize_split' and (jsonb_typeof(p->'prize_split') <> 'array'
      or (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(p->'prize_split') x) <> 100) then
    raise exception 'Payout percentages must add up to 100';
  end if;
  if coalesce((p->>'playoff_share')::numeric, (select playoff_share from league)) + coalesce((p->>'cup_share')::numeric, (select cup_share from league)) > 100 then
    raise exception 'The playoff and % shares can''t add up to more than 100%%', regexp_replace(_brand_word('{trophy}', 'full-year'), '^The ', '');
  end if;
  if p ? 'features' then
    f := p->'features';
    if jsonb_typeof(f) <> 'object' or exists (select 1 from jsonb_each(f) e where e.key not in ('money', 'fund', 'live_room', 'usage') or jsonb_typeof(e.value) <> 'boolean') then
      raise exception 'Features are money, fund, live_room and usage, each on or off';
    end if;
  end if;
  update league set
    keepers = coalesce((p->>'keepers')::int, keepers),
    top_scorer_rule = coalesce((p->>'top_scorer_rule')::boolean, top_scorer_rule),
    keeper_deadline = case when p ? 'keeper_deadline' then (p->>'keeper_deadline')::timestamptz else keeper_deadline end,
    draft_at = case when p ? 'draft_at' then (p->>'draft_at')::timestamptz else draft_at end,
    pick_seconds = coalesce((p->>'pick_seconds')::int, pick_seconds),
    draft_rounds = coalesce((p->>'draft_rounds')::int, draft_rounds),
    snake = coalesce((p->>'snake')::boolean, snake),
    trade_deadline = case when p ? 'trade_deadline' then (p->>'trade_deadline')::timestamptz else trade_deadline end,
    max_acquisitions = coalesce((p->>'max_acquisitions')::int, max_acquisitions),
    playoff_bonus_acq = coalesce((p->>'playoff_bonus_acq')::int, playoff_bonus_acq),
    extra_acq_fee = coalesce((p->>'extra_acq_fee')::numeric, extra_acq_fee),
    entry_fee = coalesce((p->>'entry_fee')::numeric, entry_fee),
    sak_fee = coalesce((p->>'sak_fee')::numeric, sak_fee),
    prize_split = coalesce(p->'prize_split', prize_split),
    playoff_share = coalesce((p->>'playoff_share')::numeric, playoff_share),
    cup_share = coalesce((p->>'cup_share')::numeric, cup_share),
    phase = coalesce(p->>'phase', phase),
    commish_note = case when p ? 'commish_note' then p->>'commish_note' else commish_note end,
    scoring = coalesce(p->'scoring', scoring),
    info = coalesce(p->'info', info),
    features = features || coalesce(f, '{}'),
    updated_at = now();
  -- a league that turns its fund on gets its fund row (kept, with its history, if it is turned off again)
  if league_has('fund') then
    insert into fund (league_id) values (current_league_id()) on conflict (league_id) do nothing;
  end if;
  if p ? 'commish_note' and coalesce(p->>'commish_note', '') <> '' then
    perform _sys('general', '📣 Commissioner: ' || (p->>'commish_note'));
  end if;
end $$;
