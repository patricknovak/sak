-- A settle names who called it (the 13 October 2026 review: a drop night's settle is the pool's moment). The chat line
-- a settle leaves gains the callers, biggest call first, against how many called anything on the question; the rest of
-- _pool_settle is as migration 148 left it.
create or replace function public._pool_settle(p_market bigint, p_winner text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m pool_markets; r record; lbl text;
begin
  select * into m from pool_markets where id = p_market for update;
  if m.id is null then raise exception 'No such question'; end if;
  if m.status = 'void' then raise exception 'That question was voided'; end if;
  if m.status = 'resolved' and p_winner is not null then raise exception 'It is settled; void it to start over'; end if;
  if p_winner is not null and not (m.q ? p_winner) then raise exception 'Pick one of the answers, or void it'; end if;
  if p_winner is null then
    -- take back what a resolution paid, then refund what each member still had in
    for r in select team_id, sum(paid) paid, sum(cost) cost from pool_positions where market_id = p_market group by team_id loop
      if r.paid > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, -r.paid, format('Taken back (voided): %s', m.title)); end if;
      if r.cost > 0 then insert into coin_ledger (team_id, amount, reason) values (r.team_id, ceil(r.cost)::int, format('Refund (voided): %s', m.title)); end if;
    end loop;
    update pool_positions set paid = 0 where market_id = p_market;
    update pool_markets set status = 'void', winner_key = null, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
    insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
      format('🔮 Voided: "%s"; every stake refunded%s', m.title, coalesce(' · ' || nullif(btrim(p_note), ''), '')), jsonb_build_object('pool_market', p_market), m.league_id);
    return;
  end if;
  lbl := _pool_label(m, p_winner);
  for r in select team_id, shares from pool_positions where market_id = p_market and outcome = p_winner and floor(shares) > 0 loop
    insert into coin_ledger (team_id, amount, reason) values (r.team_id, floor(r.shares)::int, format('Paid: %s · %s', m.title, lbl));
    update pool_positions set paid = floor(r.shares)::int where market_id = p_market and team_id = r.team_id and outcome = p_winner;
  end loop;
  update pool_markets set status = 'resolved', winner_key = p_winner, note = nullif(left(btrim(coalesce(p_note, '')), 400), ''), resolved_at = now() where id = p_market;
  -- the chat line names who called it (biggest call first) against how many called anything, so a drop night's settle
  -- is a moment in the chat, not only a bell
  insert into messages (channel, kind, body, meta, league_id) values ('general', 'system',
    format('✅ Settled: "%s" → %s%s%s', m.title, lbl, coalesce(' · ' || nullif(btrim(p_note), ''), ''),
      (select case when count(*) = 0 then ' · Nobody called it'
              else format(' · Called it: %s (%s of %s)', string_agg(t.gm_name, ', ' order by p.shares desc), count(*),
                (select count(distinct team_id) from pool_positions where market_id = p_market and (shares > 0.0001 or cost > 0))) end
       from pool_positions p join teams t on t.id = p.team_id where p.market_id = p_market and p.outcome = p_winner and floor(p.shares) > 0)),
    jsonb_build_object('pool_market', p_market), m.league_id);
end $$;
