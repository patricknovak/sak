-- Coming off IR at any time (Patrick, 16 October 2026): a GM moves a player from IR to the bench or a lineup spot
-- whenever the roster has room for him, including after his game has started, so a game-time decision can wait for
-- the warm-up. Only the move off IR is freed: the lineup that counts for a game is still the one at puck drop
-- (take_snapshots runs first and keeps him on IR for tonight's game), and nobody goes onto IR, or is swapped out of a
-- lineup, once his game has started. A swap with someone coming off IR follows the same rule from either end.
-- Otherwise the move is as it was (the guillotine's _not_cut, migration 278, kept). Safe to run twice.

create or replace function public.move_player(p_player integer, p_slot text, p_swap integer default null::integer)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  me int := _team();
  r rosters; s rosters; p players; q players;
  s_new text;
begin perform _not_cut();
  perform take_snapshots();
  select * into r from rosters where player_id = p_player and team_id = me for update;
  if not found then raise exception 'That player is not on your roster'; end if;
  select * into p from players where id = p_player;
  -- a player coming off IR can move any time; every other move waits for no game to have started
  if not (r.slot = 'IR' and p_slot <> 'IR') and player_locked(p_player) then raise exception '% is locked: his game has started', p.name; end if;
  if not slot_ok(p.elig, p.pos, p_slot) then raise exception '% can''t play %', p.name, p_slot; end if;
  if p_slot = 'IR' and r.slot <> 'IR' and not _ir_ok(p.injury_status) then
    if p.injury_status is null then
      raise exception '% isn''t on the injury report: IR is for injured players only', p.name;
    end if;
    raise exception '% is listed %: suspended players can''t go on IR', p.name, p.injury_status;
  end if;

  if p_swap is not null then
    select * into s from rosters where player_id = p_swap and team_id = me for update;
    if not found or s.slot <> p_slot then raise exception 'Swap target is not in that slot'; end if;
    select * into q from players where id = p_swap;
    -- the one he swaps with is held to the same rule: free when coming off IR, otherwise not once his game has started
    if not (s.slot = 'IR' and r.slot <> 'IR') and player_locked(p_swap) then raise exception '% is locked: his game has started', q.name; end if;
    s_new := case when slot_ok(q.elig, q.pos, r.slot) and not (r.slot = 'IR' and not _ir_ok(q.injury_status)) then r.slot else 'BN' end;
    if s_new = 'BN' and r.slot <> 'BN' and (select count(*) from rosters where team_id = me and slot = 'BN') >= _cap('BN') then
      raise exception 'Bench is full';
    end if;
    update rosters set slot = s_new where player_id = p_swap and team_id = me;
    update rosters set slot = p_slot where player_id = p_player and team_id = me;
  else
    if r.slot = p_slot then return; end if;
    if r.slot = 'IR' and _active_count(me) >= _roster_max() then
      raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.', p.name, _roster_max();
    end if;
    if (select count(*) from rosters where team_id = me and slot = p_slot) >= _cap(p_slot) then
      raise exception '% is full: pick someone to swap with', p_slot;
    end if;
    update rosters set slot = p_slot where player_id = p_player and team_id = me;
  end if;
  if _active_count(me) > _roster_max() then
    raise exception 'No roster spot to bring % off IR: % active players is the max. Drop or trade someone first.',
      case when r.slot = 'IR' then p.name else q.name end, _roster_max();
  end if;
  -- anyone now on IR drops out of saved future lineups
  delete from lineup_plans lp using rosters x
    where x.team_id = me and x.slot = 'IR' and lp.team_id = me and lp.player_id = x.player_id and lp.date > today_et();
end $function$;
