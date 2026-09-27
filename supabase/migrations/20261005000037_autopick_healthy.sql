-- Autopick: the queue is honoured as-is (the GM chose), but the fallback to best available now skips
-- anyone listed out / injured reserve / suspended, so a GM who steps away doesn't end up with a
-- player who won't dress for months.
create or replace function public._autopick_player(p_team int) returns int
language sql stable security definer set search_path = public as $$
  with have as (select p.pos, count(*) n from rosters r join players p on p.id = r.player_id where r.team_id = p_team group by p.pos),
  lim(pos, mx) as (values ('C', 7), ('LW', 7), ('RW', 7), ('D', 9), ('G', 4))
  select coalesce(
    (select q.player_id from draft_queue q where q.team_id = p_team
       and not exists (select 1 from rosters r where r.player_id = q.player_id) order by q.pos, q.player_id limit 1),
    (select p.id from players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id)
         and coalesce(have.n, 0) < lim.mx
         and coalesce(p.injury_status, '') !~* '^(out|ir\b|injured|suspen|long)'
       order by p.proj desc, p.last_fp desc limit 1),
    (select p.id from players p join lim on lim.pos = p.pos left join have on have.pos = p.pos
       where not exists (select 1 from rosters r where r.player_id = p.id) and coalesce(have.n, 0) < lim.mx
       order by p.proj desc, p.last_fp desc limit 1))
$$;
