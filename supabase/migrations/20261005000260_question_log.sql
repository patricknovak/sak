-- The pool's questions join the prediction log (the product learns, docs/DEVELOPMENT.md §4): when a question settles,
-- the answer the pool had priced highest at the close, its chance and whether it came in are written and scored at
-- once ('pool_question', the way the pick'em's split is 'pool_split'), so the Calibration page can say how well a
-- group of friends reads a show or a series. _pool_settle is as migration 257 left it but for that.
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
  -- the pool's own forecast goes on the prediction log (migration 260, the product learns): the answer the pool had
  -- priced highest when the question closed, its chance, and whether it came in; scored here and now, since the
  -- settle is the result. A question nobody called has no forecast to score.
  if exists (select 1 from pool_positions where market_id = p_market and shares > 0.0001) then
    insert into predictions (league_id, kind, subject, predicted, basis, made_at, resolves_on, outcome, error, status, scored_at, detail)
    select m.league_id, 'pool_question', jsonb_build_object('market', p_market), round(pr.p, 3), 'pool prices', m.closes_at, now()::date,
      (pr.k = p_winner)::int, (pr.k = p_winner)::int - round(pr.p, 3), 'scored', now(),
      jsonb_build_object('fav', pr.k, 'winner', p_winner, 'prices', pool_prices(m.q, m.b), 'title', m.title, 'pack', m.pack,
        'callers', (select count(distinct team_id) from pool_positions where market_id = p_market and (shares > 0.0001 or cost > 0)))
    from (select key as k, value::numeric as p from jsonb_each_text(pool_prices(m.q, m.b)) order by value::numeric desc, key limit 1) pr
    on conflict (league_id, kind, subject) do nothing;
  end if;
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
