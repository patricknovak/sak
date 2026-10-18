-- A pack's question as it stands today (18 October 2026). The World Series pack was written before the division series:
-- "Who wins the World Series?" offers eight clubs and "Do the Dodgers win a third straight World Series?" waits on the
-- Dodgers, so a pool started on it this week (the World Series is the week's event) would trade clubs already knocked
-- out and a question already decided. A pack question that names its series in `feed` (migration 272) now loads with
-- only the clubs still alive in its competition, and a question about one club loads only while that club is. Pools
-- that already have the question keep it as it is: a market can't lose an outcome someone may hold. Safe to run twice.

-- the clubs a competition has knocked out: every club that lost a decided series in it
create or replace function public._feed_out(p_comp text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct lower(c.name)), '{}')
  from series s join clubs c on c.id in (s.high_club, s.low_club)
  where s.competition = p_comp and s.winner is not null and c.id <> s.winner
$$;
revoke execute on function public._feed_out(text) from public, anon, authenticated;

-- the question to load, or null when there is nothing left to call
create or replace function public._pack_market_now(x jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := x->'feed'; gone text[]; keep jsonb;
begin
  if f is null or f->>'kind' not in ('winner', 'winner_is') or f->>'competition' is null then return x; end if;
  gone := _feed_out(f->>'competition');
  if cardinality(gone) = 0 then return x; end if;
  if f->>'kind' = 'winner_is' then
    return case when lower(f->>'club') = any (gone) then null else x end;
  end if;
  select jsonb_agg(o order by i) into keep
  from jsonb_array_elements(x->'outcomes') with ordinality t(o, i)
  where not lower(coalesce(o->>'label', o #>> '{}')) = any (gone);
  if keep is null or jsonb_array_length(keep) < 2 then return null; end if;
  return jsonb_set(x, '{outcomes}', keep);
end $$;
revoke execute on function public._pack_market_now(jsonb) from public, anon, authenticated;

create or replace function public._pool_load_pack(p_league int, p_slug text, p_by int) returns int
language plpgsql security definer set search_path = public as $$
declare pk pool_packs; x jsonb; n int := 0;
begin
  select * into pk from pool_packs where slug = p_slug;
  if pk.slug is null then raise exception 'No such pack'; end if;
  for x in select * from jsonb_array_elements(pk.markets) loop
    if (x->>'closes_at')::timestamptz <= now() + interval '10 minutes' then continue; end if;
    if not exists (select 1 from pool_markets where league_id = p_league and pack = p_slug and title = x->>'title') then
      -- only what can still happen: knocked-out clubs off the list, a question about one of them left out (migration 316)
      x := _pack_market_now(x);
      if x is null then continue; end if;
      perform _pool_insert_market(p_league, x, p_by, p_slug);
      n := n + 1;
    end if;
  end loop;
  -- a pack's drop is one the pool has by its note: a drop whose date or amount the pack corrected moves with it while
  -- nobody has been paid it (migration 263; matching on the date too paid a moved drop twice), a paid one stays as paid
  for x in select * from jsonb_array_elements(pk.drops) loop
    if not exists (select 1 from pool_drops where league_id = p_league and note = x->>'note') then
      insert into pool_drops (league_id, at, amount, note) values (p_league, (x->>'at')::timestamptz, (x->>'amount')::int, x->>'note');
    else
      update pool_drops d set at = (x->>'at')::timestamptz, amount = (x->>'amount')::int
      where d.league_id = p_league and d.note = x->>'note'
        and (d.at <> (x->>'at')::timestamptz or d.amount <> (x->>'amount')::int)
        and not exists (select 1 from coin_ledger where reason like '%[drop ' || d.id || ']');
    end if;
  end loop;
  return n;
end $$;

-- the start page's count is the questions a pool started now would get
create or replace function public.pool_pack_list() returns table (slug text, name text, questions int, color text, icon text, blurb text,
  next_close timestamptz, last_close timestamptz)
language sql stable security definer set search_path = public as $$
  select p.slug, p.name, o.n, p.brand #>> '{colors,gold}', p.brand ->> 'icon', p.brand ->> 'blurb', o.nxt, o.lst
  from pool_packs p
  cross join lateral (select count(*)::int n, min((m->>'closes_at')::timestamptz) nxt, max((m->>'closes_at')::timestamptz) lst
                      from jsonb_array_elements(p.markets) m
                      where (m->>'closes_at')::timestamptz > now() + interval '10 minutes' and _pack_market_now(m) is not null) o
  where o.n > 0
  order by o.nxt, p.name
$$;
grant execute on function public.pool_pack_list() to anon, authenticated;
