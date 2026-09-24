-- when the last pick lands, Garry posts a graded draft recap (garry?task=draft)
create or replace function public._advance() returns void
language plpgsql security definer set search_path = public as $$
declare
  st draft_state; nxt draft_picks; l league; t int;
begin
  select * into st from draft_state for update;
  select * into l from league;
  select * into nxt from draft_picks where season = st.season and player_id is null and overall is not null
    order by overall limit 1;
  if not found then
    update draft_state set status = 'done', current_overall = null, deadline = null, updated_at = now()
  where id = 1;
    update league set phase = 'season', updated_at = now()
  where id = 1;
    for t in select id from teams loop perform _auto_lineup(t); end loop;
    perform _sys('draft', '🏁 The draft is complete! Lineups have been auto-set; tweak yours on My Team. Let the chirping begin.');
    perform _sys('general', '🏁 The draft is complete! Rosters are live.');
    -- Garry grades everyone's draft
    perform net.http_post(
      url := 'https://quakdkzdafzlhgjvmypg.supabase.co/functions/v1/garry?task=draft',
      body := '{}'::jsonb,
      headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1YWtka3pkYWZ6bGhnanZteXBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjEzOTQsImV4cCI6MjEwNTc5NzM5NH0.aAkN2kU_Sg4i1PGXpinOEKaNK2BNbcbLx1c4rc4ZroA"}'::jsonb,
      timeout_milliseconds := 5000);
    return;
  end if;
  update draft_state set current_overall = nxt.overall,
    deadline = now() + make_interval(secs => case when (select autodraft from teams where id = nxt.team_id) then 4 else l.pick_seconds end),
    updated_at = now()
  where id = 1;
  perform _notify(nxt.team_id, 'draft', format('You''re on the clock! Pick #%s', nxt.overall), '/draft');
end $$;
