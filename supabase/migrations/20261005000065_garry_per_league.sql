-- Garry per league, shaped by the commissioner.
-- * garry_state holds one row per league (the id = 1 pin goes); every league gets its row, new leagues at creation.
-- * The commissioner's briefing: what the voice should know about the league (its history, trophies, who's who,
--   running jokes, what to leave alone). It goes into every prompt, the memory pass and the weekly voice rewrite.
-- * garry_remember: the commissioner (or a GM, about their own team) hands the voice a fact to keep.
-- * SaK's briefing starts with the lore the edge function used to hard-code.
-- Memory (garry_memory) already carries league_id; the edge function now scopes every read and write to one league.
set client_min_messages = warning;

do $$ begin
  alter table public.garry_state drop constraint if exists garry_state_id_check;
end $$;
create sequence if not exists public.garry_state_id_seq owned by public.garry_state.id;
select setval('public.garry_state_id_seq', greatest((select max(id) from public.garry_state), 1));
alter table public.garry_state alter column id set default nextval('public.garry_state_id_seq');
create unique index if not exists garry_state_league_idx on public.garry_state (league_id);
alter table public.garry_state add column if not exists briefing text;
alter table public.garry_state add column if not exists briefing_updated_at timestamptz;
do $$ begin
  alter table public.garry_state add constraint garry_state_briefing_len check (briefing is null or length(briefing) <= 4000);
exception when duplicate_object then null; end $$;
insert into public.garry_state (league_id)
  select l.id from public.leagues l where not exists (select 1 from public.garry_state s where s.league_id = l.id);

-- a new league gets its voice's row with the rest of its furniture
create or replace function public.create_league(p_slug text, p_name text, p_short text, p_brand jsonb default '{}'::jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare nid int;
begin
  perform _commish();
  insert into leagues (slug, name, short_name, brand, status) values (p_slug, p_name, p_short, coalesce(p_brand, '{}'::jsonb), 'setup') returning id into nid;
  insert into league_rules (id, league_id, name, short_name, season, phase, keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq)
  select nid, nid, p_name, p_short, season, 'keepers', keepers, top_scorer_rule, pick_seconds, draft_rounds, snake, roster, scoring, trade_review_hours, max_acquisitions, prize_split, playoff_share, cup_share, playoff_bonus_acq
  from league_rules where league_id = 1;
  insert into garry_state (league_id) values (nid) on conflict (league_id) do nothing;
  return nid;
end $$;

-- the commissioner writes (or clears) the briefing for their league
create or replace function public.garry_brief(p_text text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _commish();
  insert into garry_state (league_id, briefing, briefing_updated_at)
  values (current_league_id(), nullif(btrim(coalesce(p_text, '')), ''), now())
  on conflict (league_id) do update set briefing = excluded.briefing, briefing_updated_at = now();
end $$;
revoke execute on function public.garry_brief(text) from public, anon;
grant execute on function public.garry_brief(text) to authenticated;

-- hand the voice something to remember: the commissioner about anyone or the league, a GM about their own team.
-- Hand-fed memories weigh more than the ones pulled from chat, so they surface first and survive the trim.
create or replace function public.garry_remember(p_text text, p_team int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not is_commish() and (p_team is null or p_team is distinct from _team()) then raise exception 'You can only tell him about your own team'; end if;
  if p_team is not null and not exists (select 1 from teams where id = p_team and league_id = current_league_id()) then raise exception 'No such team in this league'; end if;
  insert into garry_memory (kind, team_id, content, weight, league_id)
  values ('fact', p_team, left(btrim(p_text), 300), 3, current_league_id()) returning id into nid;
  return nid;
end $$;
revoke execute on function public.garry_remember(text, int) from public, anon;
grant execute on function public.garry_remember(text, int) to authenticated;

-- SaK's briefing: the lore the function carried in code until now
update public.garry_state set briefing = $brief$The league: She's A Keeper, the SAK Superleague, est. 2013. Eight longtime friends in an NHL keeper league: six keepers each, and the top-scorer rule sends every team's top scorer back into the pool. They play for real money (the SaK Fund) and for St. Patrick coins, the side-bet currency; everyone started with 1,000.
Trophies: the regular-season winner takes The Johnson, the full-year winner (regular season plus playoffs) takes The SAK Cup, and the last-place finisher holds The Peter and pays the Peter Punishment into the SaK Fund.
Last season (2025-26): Darin (Hatrick Swayze) won it all as a rookie GM; Craig (Ravens) 2nd, six points short; Panagiotis (Connor McPanos) 3rd; Todd (Hughes Your Daddy) 4th; Patrick (The Hip Czechs, the commissioner and founder) 5th; Jason (Jays) 6th; Terry (#What No Way) 7th; Trystan (Eagle Palace) last, holding The Peter.
History: Jason is the all-time points leader and a four-time champ; Terry went back to back in 2022-23 and 2023-24; Panagiotis won 2024-25; Darin won 2025-26.
Top scorers sent back into the pool for the 2026-27 draft: Connor McDavid, Nathan MacKinnon, Nikita Kucherov, Macklin Celebrini, Martin Necas, Evan Bouchard, Cale Makar, Tage Thompson.$brief$,
  briefing_updated_at = now()
where league_id = 1 and briefing is null;
