-- Trades in the chat, for the trash talk (7 November 2026, Patrick: "show all trades made in the chat by notification
-- and make it such that you can comment on trades and the trade and comments show up in the chat, basically to
-- increase the trash talk").
--
-- The league's lines already announce a trade: "🤝 ... agreed to a trade. Pending commissioner review." when the other
-- side accepts (respond_trade) and "🔄 TRADE! ..." when it goes through (_execute_trade, carrying meta.trade). The site
-- now draws both as a card to comment on (a comment is a chat reply to the line, so it lands in the feed with the trade
-- quoted above it). What this adds, without touching the trade functions themselves:
--   * the "agreed" line carries its trade too (meta.trade), so the card can show the deal while the commish looks;
--   * a trade that goes through rings every other team in the league (the teams in the deal already hear), opening the
--     chat at the trade;
--   * and it comes with a league poll, "Who won the trade?": each team in the deal, or too close to call, open a week.
-- A poll the league starts has no team behind it, so polls.team_id may be empty; only the commissioner closes one early,
-- and no "started a poll" line is posted for it (the trade's line is where it shows).
-- Safe to run twice.

alter table public.polls alter column team_id drop not null;

create or replace function public._poll_posted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- a league poll (a trade's "Who won?") rides on the line that started it
  if new.team_id is null then return new; end if;
  perform _sys(new.channel, format('📊 %s started a poll: %s', _tname(new.team_id), new.question), jsonb_build_object('poll', new.id));
  return new;
end $$;
revoke execute on function public._poll_posted() from public, anon, authenticated;

create or replace function public._trade_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare tr trades; parts int[]; pid bigint; opts jsonb;
begin
  if new.kind <> 'system' or new.channel <> 'general' or new.body is null then return new; end if;
  -- the other side accepted: respond_trade set the trade to accepted in this same transaction, so its time is now()
  if new.body like '🤝 % agreed to a %trade. Pending commissioner review.' and not coalesce(new.meta ? 'trade', false) then
    select * into tr from trades where league_id = new.league_id and status = 'accepted' and responded_at = now()
      order by id desc limit 1;
    if found then new.meta := coalesce(new.meta, '{}'::jsonb) || jsonb_build_object('trade', tr.id); end if;
    return new;
  end if;
  if new.body not like '🔄 TRADE! %' or not coalesce(new.meta ? 'trade', false) or new.meta ? 'poll' then return new; end if;
  select * into tr from trades where id = (new.meta->>'trade')::bigint and status = 'approved';
  if not found then return new; end if;
  parts := coalesce(tr.parties, array[tr.from_team, tr.to_team]);
  -- who won it: every team in the deal, then a way out (a poll takes at most six answers)
  if cardinality(parts) <= 5 then
    select jsonb_agg(_tname(x) order by o) || '["Too close to call"]'::jsonb into opts from unnest(parts) with ordinality u(x, o);
    insert into polls (channel, team_id, question, options, closes_at, league_id)
      values ('general', null, 'Who won the trade?', opts, now() + interval '7 days', tr.league_id)
      returning id into pid;
    new.meta := new.meta || jsonb_build_object('poll', pid);
  end if;
  -- everyone else in the league hears about it, and the bell opens the chat at the trade
  insert into notifications (team_id, kind, body, link, league_id)
    select t.id, 'trade', left('🔄 Trade! ' || substr(new.body, length('🔄 TRADE! ') + 1), 180), '/chat?m=' || new.id, tr.league_id
    from teams t where t.league_id = tr.league_id and not (t.id = any (parts));
  return new;
end $$;
revoke execute on function public._trade_line() from public, anon, authenticated;

drop trigger if exists messages_trade_line on public.messages;
create trigger messages_trade_line before insert on public.messages for each row execute function public._trade_line();
