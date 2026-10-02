-- Voting on and co-sponsoring a rule proposal check that the proposal is in the caller's league (the tenancy
-- guardrail test in supabase/tests/tenancy.sql found both taking any proposal id). Same insertion as migration 76.
do $$
declare
  r record; f oid; def text; tail text; i int; k int;
begin
  for r in select * from (values
    ('vote_proposal',      'perform public._in_league(''proposals'', p_id);'),
    ('cosponsor_proposal', 'perform public._in_league(''proposals'', p_id);')
  ) v(fn, guard) loop
    for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = r.fn loop
      def := pg_get_functiondef(f);
      continue when position('_in_league(' in def) > 0;
      if pg_get_function_identity_arguments(f) !~ '\mp_id\M' then raise exception '% has no p_id', r.fn; end if;
      i := strpos(def, '$function$');
      tail := substr(def, i);
      k := regexp_instr(tail, '\mbegin\M', 1, 1, 1, 'i');
      if i = 0 or k = 0 then raise exception 'no body to guard in %', r.fn; end if;
      execute left(def, i - 1) || left(tail, k - 1) || E'\n  ' || r.guard || substr(tail, k);
    end loop;
  end loop;
end $$;
