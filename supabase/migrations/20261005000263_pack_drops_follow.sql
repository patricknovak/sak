-- A pack's corrected drop reaches every pool once, not twice: _pool_load_pack matched a drop by its note and its date,
-- so a drop whose date the pack corrected came in again beside the old one and paid twice. Now a pool has a pack's
-- drop by its note; a corrected date or amount moves the pool's copy while nobody has been paid it, and a paid one
-- stays as paid. The rest is as migration 159 left it.
create or replace function public._pool_load_pack(p_league int, p_slug text, p_by int) returns int
language plpgsql security definer set search_path = public as $$
declare pk pool_packs; x jsonb; n int := 0;
begin
  select * into pk from pool_packs where slug = p_slug;
  if pk.slug is null then raise exception 'No such pack'; end if;
  for x in select * from jsonb_array_elements(pk.markets) loop
    if (x->>'closes_at')::timestamptz <= now() + interval '10 minutes' then continue; end if;
    if not exists (select 1 from pool_markets where league_id = p_league and pack = p_slug and title = x->>'title') then
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
