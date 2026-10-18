-- A pack question the feed has already decided doesn't load (18 October 2026, review of migration 316): a question about
-- one club loaded once that club had won its series, and any question whose series was decided loaded too, only its
-- closing time keeping it out. Whatever `_feed_answer` (migration 272) can already answer is left out of a new pool and
-- out of the start page's count. Safe to run twice.

create or replace function public._pack_market_now(x jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := x->'feed'; gone text[]; keep jsonb;
begin
  if f is null or f->>'competition' is null then return x; end if;
  -- decided already: nothing left to call
  if _feed_answer(f) is not null then return null; end if;
  if f->>'kind' not in ('winner', 'winner_is') then return x; end if;
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
