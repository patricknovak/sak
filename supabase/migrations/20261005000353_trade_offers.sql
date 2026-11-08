-- Trade offers in the chat too (8 November 2026, Patrick: "Please make it such that trade offers are also on chat and
-- have the ability to comment on."). Migration 351 put agreed and finished trades in the chat as cards to talk about;
-- now every offer (and every counter-offer) posts a line the moment it's made, carrying its trade, so the site draws
-- the same card on it, with the offer's state as it stands (on the table, declined, withdrawn, countered, agreed).
-- Offers were already readable by every member of the league (trades' read_all policy), so nothing new is shown.
--
-- The line is written when the offer's transaction commits (a deferred constraint trigger on trades): propose_trade
-- and propose_multi_trade add the trade's items after the trade row, and the line names what's in the deal.
-- Safe to run twice.

create or replace function public._trade_offer_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare tr trades; parts int[]; summary text;
begin
  select * into tr from trades where id = new.id;
  if not found or tr.status <> 'proposed' then return null; end if;
  if exists (select 1 from messages where league_id = tr.league_id and kind = 'system' and channel = 'general' and (meta->>'trade')::bigint = tr.id) then return null; end if;
  if tr.parties is null then
    summary := format('%s offer %s to %s for %s', _tname(tr.from_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = tr.id and from_team = tr.from_team and not release), 'nothing'),
      _tname(tr.to_team),
      coalesce((select string_agg(_item_label(i), ', ') from trade_items i where trade_id = tr.id and from_team = tr.to_team and not release), 'nothing'));
  else
    parts := tr.parties;
    summary := format('%s put a %s-team deal to %s', _tname(tr.from_team), cardinality(parts),
      (select string_agg(_tname(x), ', ') from unnest(parts) x where x <> tr.from_team));
  end if;
  insert into messages (channel, kind, body, meta, league_id)
    values ('general', 'system', case when tr.counter_of is null then '📨 Trade offer: ' else '📨 Counter-offer: ' end || summary,
      jsonb_build_object('trade', tr.id, 'offer', true), tr.league_id);
  return null;
-- a line that can't be written never costs the GM their offer
exception when others then
  raise warning 'trade offer line for trade %: %', new.id, sqlerrm;
  return null;
end $$;
revoke execute on function public._trade_offer_line() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trades_offer_line' and tgrelid = 'public.trades'::regclass) then
    create constraint trigger trades_offer_line after insert on public.trades
      deferrable initially deferred for each row execute function public._trade_offer_line();
  end if;
end $$;
