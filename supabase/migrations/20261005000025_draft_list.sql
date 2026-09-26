-- The draft list: every pick's owner with a note on how it changed hands, and a commissioner tool to
-- reassign a pick (a Yahoo-era trade that was missed, a correction a GM points out).
alter table public.draft_picks add column if not exists note text;

create or replace function public.commish_set_pick_owner(p_pick int, p_team int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d draft_picks; st draft_state;
begin
  perform _commish();
  select * into st from draft_state;
  if st.status in ('live', 'paused') then raise exception 'Draft is in progress'; end if;
  select * into d from draft_picks where id = p_pick;
  if d.id is null then raise exception 'No such pick'; end if;
  if d.player_id is not null then raise exception 'That pick has already been used'; end if;
  if not exists (select 1 from teams where id = p_team and role = 'gm') then raise exception 'Not a GM team'; end if;
  update draft_picks set team_id = p_team, note = nullif(left(coalesce(p_note, ''), 120), '') where id = p_pick;
  perform _sys('draft', format('✏️ The commish moved the %s round %s pick (originally %s) to %s%s.', d.season, d.round, _tname(d.original_team), _tname(p_team),
    case when p_team = d.original_team then ' (back to its original owner)' else '' end));
end $$;
revoke execute on function public.commish_set_pick_owner(int, int, text) from public, anon;
grant execute on function public.commish_set_pick_owner(int, int, text) to authenticated;
