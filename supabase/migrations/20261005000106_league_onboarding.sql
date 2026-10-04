-- Onboarding, part 1 (docs/SUPERPOOLS.md section 7, step 5; docs/EXPANSION.md section 8): the platform opens a league
-- and invites its commissioner, a checklist says when the league is ready, the platform switches it live, and the
-- commissioner gives it its own name and look.
--
-- * platform_leagues(): every league at a glance for the platform (seats filled, the commissioner, its status).
-- * league_readiness(league): the new-league checklist as data: each line with whether it holds and whether it must
--   before the league goes live. The platform and that league's commissioner can read it.
-- * platform_set_league_status(league, status): 'active' only when every required line holds (that is what puts the
--   league on the nightly jobs: run_league_jobs runs active leagues), 'archived' to stand one down. SaK is never moved.
-- * commish_set_brand(name, short, brand): the commissioner's league identity: its name and short name, and the brand
--   keys the site reads (wordmark, tagline, prizes, the coin, the league's voice, the colour). Only known keys are kept,
--   each trimmed; anything else already in the brand (the shadow flag, for one) stays as it was.

set client_min_messages = warning;

create or replace function public.platform_leagues()
returns table (league_id int, slug text, name text, short_name text, status text, created_at timestamptz, seats int, filled int,
               spectators int, commish_team int, commish_name text, commish_seated boolean, brand jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  return query
    select l.id, l.slug, l.name, l.short_name, l.status, l.created_at,
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm'),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'gm' and t.user_id is not null),
      (select count(*)::int from teams t where t.league_id = l.id and t.role = 'spectator'),
      c.id, c.gm_name, c.user_id is not null, l.brand
    from leagues l
    left join lateral (select t.id, t.gm_name, t.user_id from teams t where t.league_id = l.id and t.is_commish order by t.id limit 1) c on true
    order by l.id;
end $$;
revoke execute on function public.platform_leagues() from public, anon;
grant execute on function public.platform_leagues() to authenticated;

-- the checklist: [{key, label, ok, required, detail}], in the order a league is set up
create or replace function public.league_readiness(p_league int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l leagues; r league_rules; c teams; seats int; open int; uncoined int;
begin
  if not (is_platform_admin() or (p_league = current_league_id() and is_commish())) then
    raise exception 'Only the platform or this league''s commissioner can see that';
  end if;
  select * into l from leagues where id = p_league;
  if l.id is null then raise exception 'No such league'; end if;
  select * into r from league_rules where league_id = p_league;
  select * into c from teams where league_id = p_league and is_commish order by id limit 1;
  select count(*), count(*) filter (where user_id is null) into seats, open from teams where league_id = p_league and role = 'gm';
  select count(*) into uncoined from teams t where t.league_id = p_league and t.role = 'gm'
    and not exists (select 1 from coin_ledger x where x.team_id = t.id);
  return jsonb_build_array(
    jsonb_build_object('key', 'name', 'label', 'Name and short name', 'required', true,
      'ok', coalesce(btrim(l.name), '') <> '' and coalesce(btrim(l.short_name), '') <> '', 'detail', concat_ws(' · ', l.name, l.short_name)),
    jsonb_build_object('key', 'rules', 'label', 'Rules, roster and scoring', 'required', true,
      'ok', r.id is not null and r.season is not null and r.roster is not null and r.profile_id is not null,
      'detail', case when r.id is null then 'No rules yet' else concat('Season ', r.season, ', phase ', r.phase) end),
    jsonb_build_object('key', 'commish', 'label', 'Commissioner signed in', 'required', true,
      'ok', c.user_id is not null, 'detail', case when c.id is null then 'No commissioner seat' when c.user_id is null then 'Send the commissioner''s invite' else c.gm_name end),
    jsonb_build_object('key', 'draft', 'label', 'Draft set up', 'required', true,
      'ok', exists (select 1 from draft_state where league_id = p_league),
      'detail', coalesce((select status from draft_state where league_id = p_league), 'No draft yet')),
    jsonb_build_object('key', 'coins', 'label', 'Opening coins for every GM', 'required', true,
      'ok', uncoined = 0, 'detail', case when uncoined = 0 then 'Every team has its coins' else uncoined || ' without' end),
    jsonb_build_object('key', 'seats', 'label', 'Every seat has a GM', 'required', false,
      'ok', seats > 0 and open = 0, 'detail', (seats - open) || ' of ' || seats || ' seats taken'),
    jsonb_build_object('key', 'voice', 'label', 'The league''s voice has a briefing', 'required', false,
      'ok', exists (select 1 from garry_state where league_id = p_league and coalesce(btrim(briefing), '') <> ''),
      'detail', 'The commissioner writes it on the Commish page'));
end $$;
revoke execute on function public.league_readiness(int) from public, anon;
grant execute on function public.league_readiness(int) to authenticated;

create or replace function public.platform_set_league_status(p_league int, p_status text) returns text
language plpgsql security definer set search_path = public as $$
declare missing text;
begin
  if not is_platform_admin() then raise exception 'Only the platform can do that'; end if;
  if p_status not in ('setup', 'active', 'archived') then raise exception 'A league is in setup, active or archived'; end if;
  if p_league = 1 then raise exception 'The SaK Superleague stays as it is'; end if;
  if not exists (select 1 from leagues where id = p_league) then raise exception 'No such league'; end if;
  if p_status = 'active' then
    select string_agg(x->>'label', ', ') into missing
    from jsonb_array_elements(league_readiness(p_league)) x
    where (x->>'required')::boolean and not (x->>'ok')::boolean;
    if missing is not null then raise exception 'Not ready to go live: %', missing; end if;
  end if;
  update leagues set status = p_status, updated_at = now() where id = p_league;
  return p_status;
end $$;
revoke execute on function public.platform_set_league_status(int, text) from public, anon;
grant execute on function public.platform_set_league_status(int, text) to authenticated;

create or replace function public.commish_set_brand(p_name text, p_short text, p_brand jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); b jsonb; k text; v text; sub text; f text; nm text := btrim(coalesce(p_name, '')); sh text := btrim(coalesce(p_short, ''));
begin
  perform _commish();
  if length(nm) < 2 or length(nm) > 60 then raise exception 'The league''s name takes 2 to 60 characters'; end if;
  if length(sh) < 1 or length(sh) > 12 then raise exception 'The short name takes 1 to 12 characters'; end if;
  select coalesce(brand, '{}'::jsonb) into b from leagues where id = lid;
  p_brand := coalesce(p_brand, '{}'::jsonb);
  -- plain words: an empty one goes back to the default, except the tagline, where empty means none
  foreach k in array array['tagline', 'trophy', 'regular', 'playoff', 'booby', 'fund', 'bank'] loop
    if p_brand ? k then
      v := left(btrim(coalesce(p_brand->>k, '')), 40);
      b := case when v = '' and k <> 'tagline' then b - k else jsonb_set(b, array[k], to_jsonb(v)) end;
    end if;
  end loop;
  -- the pairs: the wordmark's two words, the voice's and the coin's name and emoji
  foreach sub in array array['wordmark', 'bot', 'coin'] loop
    if jsonb_typeof(p_brand->sub) = 'object' then
      foreach f in array case sub when 'wordmark' then array['a', 'b'] else array['name', 'emoji'] end loop
        if p_brand->sub ? f then
          v := left(btrim(coalesce(p_brand->sub->>f, '')), case when f = 'emoji' then 8 when sub = 'wordmark' then 16 else 30 end);
          b := jsonb_set(b, array[sub], coalesce(b->sub, '{}'::jsonb));
          b := case when v = '' then jsonb_set(b, array[sub], (b->sub) - f) else jsonb_set(b, array[sub, f], to_jsonb(v)) end;
        end if;
      end loop;
    end if;
  end loop;
  if p_brand->'colors' ? 'gold' then
    v := btrim(coalesce(p_brand->'colors'->>'gold', ''));
    if v !~ '^#[0-9a-fA-F]{6}$' then raise exception 'The colour is a hex code like #f7c548'; end if;
    b := jsonb_set(jsonb_set(b, '{colors}', coalesce(b->'colors', '{}'::jsonb)), '{colors,gold}', to_jsonb(lower(v)));
  end if;
  update leagues set name = nm, short_name = sh, brand = b, updated_at = now() where id = lid;
  update league_rules set name = nm, short_name = sh, updated_at = now() where league_id = lid;
  return b;
end $$;
revoke execute on function public.commish_set_brand(text, text, jsonb) from public, anon;
grant execute on function public.commish_set_brand(text, text, jsonb) to authenticated;
