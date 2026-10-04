-- Commissioner tools (docs/SUPERPOOLS.md section 7, item 12): sharing the job, and handing over a team whose GM has
-- gone.
--
-- * commish_set_cocommish(team, on): a commissioner makes another seated GM in the league a co-commissioner (the same
--   powers: every commish_ function checks _commish(), which any team with is_commish passes), or takes it back. A
--   league always keeps at least one; a commissioner can step down only when another is in place. The league is told.
-- * commish_vacate_seat(team): a GM who has left the league gives up their seat: the account comes off the team (it
--   keeps its other leagues), the phones it registered for that team stop getting its alerts, any open invite for the
--   seat is cancelled, and a fresh 14-day invite for the seat comes back to hand to the new GM. The team, its roster,
--   picks, coins and history stay with the seat. A commissioner can't vacate their own seat, or another commissioner's.

set client_min_messages = warning;

create or replace function public.commish_set_cocommish(p_team int, p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare me int := _commish(); t teams;
begin
  perform _in_league('teams', p_team);
  select * into t from teams where id = p_team;
  if t.role <> 'gm' then raise exception 'Only a GM''s team can run the league'; end if;
  if p_on then
    if t.user_id is null then raise exception 'That seat has no GM yet'; end if;
    if t.is_commish then return true; end if;
    update teams set is_commish = true where id = p_team;
    perform _sys('general', format('🛡️ %s is now a co-commissioner.', coalesce(t.gm_name, t.name)));
  else
    if not t.is_commish then return false; end if;
    if (select count(*) from teams where league_id = t.league_id and is_commish and role = 'gm') <= 1 then
      raise exception 'The league needs a commissioner: make someone else one first';
    end if;
    update teams set is_commish = false where id = p_team;
    perform _sys('general', case when p_team = me then format('🛡️ %s stepped down as commissioner.', coalesce(t.gm_name, t.name))
                                 else format('🛡️ %s is no longer a commissioner.', coalesce(t.gm_name, t.name)) end);
  end if;
  return p_on;
end $$;
revoke execute on function public.commish_set_cocommish(int, boolean) from public, anon;
grant execute on function public.commish_set_cocommish(int, boolean) to authenticated;

create or replace function public.commish_vacate_seat(p_team int) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare me int := _commish(); t teams; code text;
begin
  perform _in_league('teams', p_team);
  select * into t from teams where id = p_team;
  if t.role <> 'gm' then raise exception 'That isn''t a GM''s seat'; end if;
  if p_team = me then raise exception 'You can''t give up your own seat here'; end if;
  if t.is_commish then raise exception 'Take away their commissioner role first'; end if;
  if t.user_id is null then raise exception 'That seat is already open'; end if;
  -- the account leaves this team (the membership goes with it, through teams_sync_member); the seat waits for its next GM
  update teams set user_id = null, login_email = null, gm_name = 'Open seat' where id = p_team;
  -- the old GM's phones stop getting this team's alerts
  delete from push_subscriptions where team_id = p_team;
  update league_invites set revoked = true where team_id = p_team and not revoked;
  code := lower(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 12));
  insert into league_invites (code, league_id, team_id, role, created_by, expires_at, max_uses)
  values (code, t.league_id, p_team, 'gm', auth.uid(), now() + interval '14 days', 1);
  perform _sys('general', format('🪑 %s is looking for a new GM. %s has moved on.', t.name, coalesce(t.gm_name, 'Its GM')));
  return code;
end $$;
revoke execute on function public.commish_vacate_seat(int) from public, anon;
grant execute on function public.commish_vacate_seat(int) to authenticated;
