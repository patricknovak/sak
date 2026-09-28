-- No paid extra pickups any more: pickups are tradable, so a GM who has used them all trades for more.
-- (p_accept_fee is kept so older clients don't break; it's ignored.)
create or replace function public.add_player(p_add integer, p_drop integer default null, p_accept_fee boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare
  me int := _team(); l league; used int; cnt int; stuck text; allowed int;
begin perform _gm_only();
  select * into l from league;
  if l.phase <> 'season' then raise exception 'Free agency opens after the draft'; end if;
  perform take_snapshots();
  if exists (select 1 from rosters where player_id = p_add) then raise exception 'That player is already on a roster'; end if;
  if not exists (select 1 from players where id = p_add) then raise exception 'Unknown player'; end if;
  select string_agg(pl.name, ', ') into stuck from rosters r join players pl on pl.id = r.player_id
    where r.team_id = me and r.slot = 'IR' and not _ir_ok(pl.injury_status) and r.player_id is distinct from p_drop;
  if stuck is not null then
    raise exception '% % no longer injured but still on IR. Activate or drop before adding: IR only frees a spot for injured players.',
      stuck, case when position(',' in stuck) > 0 then 'are' else 'is' end;
  end if;
  used := _acq_used(me);
  allowed := _acq_allowed(me);
  if used >= allowed then
    raise exception 'You''ve used all % of your free-agent pickups. Trade with another GM for more.', allowed;
  end if;
  if p_drop is not null then
    if not exists (select 1 from rosters where player_id = p_drop and team_id = me) then raise exception 'You can only drop your own players'; end if;
    delete from rosters where player_id = p_drop;
    insert into transactions (season, type, team_id, player_id) values (l.season, 'drop', me, p_drop);
  end if;
  select count(*) into cnt from rosters where team_id = me and slot <> 'IR';
  if cnt >= _roster_max() then raise exception 'Roster is full (% players). Choose someone to drop.', _roster_max(); end if;
  insert into rosters (player_id, team_id, slot, acquired) values (p_add, me, 'BN', 'fa');
  insert into transactions (season, type, team_id, player_id) values (l.season, 'add', me, p_add);
  perform _sys('general', format('➕ %s add %s%s', _tname(me), _pname(p_add),
    case when p_drop is not null then ', drop ' || _pname(p_drop) else '' end));
end $$;
update public.league set extra_acq_fee = 0;
