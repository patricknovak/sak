-- Pin search_path on three immutable helpers the advisors still flag (16 October 2026).
-- Bodies unchanged; only `set search_path = public` so a caller cannot inject a schema.
-- NOT applied to production by this PR: Patrick applies with scripts/db.sh migrate after review.

create or replace function public._ats_side(p_home int, p_away int, p_line numeric) returns text
language sql immutable set search_path = public as $$
  select case when p_home is null or p_away is null then null
              when p_home + coalesce(p_line, 0) > p_away then 'H' when p_home + coalesce(p_line, 0) < p_away then 'A' else 'P' end
$$;
revoke execute on function public._ats_side(int, int, numeric) from public, anon, authenticated;

create or replace function public._pick_res(p_rules jsonb, p_pick jsonb, p_res text, p_by_host boolean, p_home int, p_away int) returns text
language sql immutable set search_path = public as $$
  select case when coalesce(p_rules->>'ats', 'false') <> 'true' or p_res is null then p_res
              when p_home is null or p_away is null then 'P'
              else _ats_side(p_home, p_away, (p_pick->>'line')::numeric) end
$$;
revoke execute on function public._pick_res(jsonb, jsonb, text, boolean, int, int) from public, anon, authenticated;

create or replace function public._mc_test_email(p_email text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_email, '') ilike '%patricknovak%'
      or coalesce(p_email, '') ilike '%planetterrian%'
      or coalesce(p_email, '') ilike '%+test%'
      or coalesce(p_email, '') ilike '%test@%'
      or coalesce(p_email, '') ilike '%example.com%'
      or coalesce(p_email, '') ilike '%qa@%'
      or coalesce(p_email, '') ilike '%@superpoolsai.com%'
      or coalesce(p_email, '') ilike '%@superpools.com%'
$$;
revoke execute on function public._mc_test_email(text) from public, anon, authenticated;
