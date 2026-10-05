-- Every member shares the pool (docs/POOLS.md section 6: the gate is thirty players): the pool's open link, the one the
-- host already passes around the group chat, is handed to any member who asks, so friends of friends can join without
-- waiting on the host. The newest open link still good is returned; with none, a fresh one is made (30 days, 50 uses),
-- so the host's taps and the members' all share one link instead of minting a new one each time. Prediction pools only;
-- a spectator can't.
create or replace function public.pool_share_link() returns text
language plpgsql security definer set search_path = public as $$
declare me int := _team(); lid int := current_league_id(); code text;
begin
  if me is null or (select role from teams where id = me) <> 'gm' then raise exception 'Only members share the pool'; end if;
  if (select kind from leagues where id = lid) <> 'predict' then raise exception 'Open links are for prediction pools'; end if;
  select i.code into code from league_invites i
  where i.league_id = lid and i.team_id is null and i.role = 'gm' and not i.revoked
    and i.expires_at > now() + interval '1 day' and i.uses < i.max_uses
  order by i.expires_at desc limit 1;
  if code is null then
    code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
    insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
    values (code, lid, null, 'gm', auth.uid(), now() + interval '30 days', 50);
  end if;
  return code;
end $$;
revoke execute on function public.pool_share_link() from public, anon;
grant execute on function public.pool_share_link() to authenticated;
