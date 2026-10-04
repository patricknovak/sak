-- League by host knows the league's kind: a prediction pool's address shows a sign-in page in its own words, with no
-- hockey in it (docs/BRAND.md: no sports words in a pool that is not about sport). Same lookup, one more key.

create or replace function public.league_by_host(p_host text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', l.id, 'slug', l.slug, 'name', l.name, 'short_name', l.short_name, 'brand', l.brand, 'status', l.status,
                            'kind', l.kind)
  from leagues l
  where l.status <> 'archived'
    and (l.domain = lower(split_part(btrim(coalesce(p_host, '')), ':', 1)) or l.slug = _host_slug(p_host))
  order by (l.domain is not null and l.domain = lower(split_part(btrim(coalesce(p_host, '')), ':', 1))) desc
  limit 1
$$;
revoke execute on function public.league_by_host(text) from public;
grant execute on function public.league_by_host(text) to anon, authenticated;

-- the invite's preview says the kind too, so the join page speaks a pool's words to a pool's newcomer
create or replace function public.invite_preview(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'ok', not i.revoked and i.expires_at >= now() and i.uses < i.max_uses
            and (i.team_id is null or not exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null)),
      'reason', case when i.revoked then 'revoked' when i.expires_at < now() then 'expired' when i.uses >= i.max_uses then 'used'
                     when i.team_id is not null and exists (select 1 from teams t where t.id = i.team_id and t.user_id is not null) then 'taken'
                     else null end,
      'league', l.name, 'short', l.short_name, 'brand', l.brand, 'role', i.role,
      'team', (select t.name from teams t where t.id = i.team_id),
      'expires_at', i.expires_at, 'kind', l.kind)
    from league_invites i join leagues l on l.id = i.league_id
    where i.code = lower(trim(p_code))), jsonb_build_object('ok', false, 'reason', 'unknown'))
$$;
revoke execute on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
