-- The prediction log (docs/DEVELOPMENT.md, section 4): what the product expects, written down before the games and
-- scored after them, so its projections can be measured and tuned instead of trusted.
--
-- * predictions: one row per thing predicted, per league (each league scores with its own weights). First kind:
--   'player_night', every rostered player whose club plays tonight, with the points the engine expects from him
--   (his per-game rate this season once he has five games, his projection before that: _player_rate).
-- * predict_tonight() writes tonight's rows for the running league; score_predictions() fills in what happened once
--   the night is over (his points from the box score; a player who didn't dress is marked, not scored as zero).
--   Both run once per league through run_league_jobs ('predict', 'score-predictions'); the cron is in the _cron file.
-- * prediction_accuracy: per kind and week, how many, the average miss (bias) and the average size of the miss.
-- * book_calibration: the Book's odds against what happened, from the markets themselves (nothing new to log): every
--   settled market's options with their no-vig chance, bucketed by that chance, with how often the bucket hit.

set client_min_messages = warning;

create table if not exists public.predictions (
  id bigserial primary key,
  league_id int not null default public.current_league_id() references public.leagues (id),
  kind text not null,
  subject jsonb not null,                 -- player_night: {"player_id": .., "date": ..}
  predicted numeric not null,
  basis text,                             -- what the number came from ('season rate', 'projection')
  made_at timestamptz not null default now(),
  resolves_on date not null,              -- the day after which it can be scored
  outcome numeric,
  error numeric,                          -- outcome - predicted
  status text not null default 'open' check (status in ('open', 'scored', 'void')),
  scored_at timestamptz
);
create unique index if not exists predictions_one_per_subject on public.predictions (league_id, kind, subject);
create index if not exists predictions_open_idx on public.predictions (resolves_on) where status = 'open';
alter table public.predictions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.predictions'::regclass and polname = 'read_league') then
    create policy read_league on public.predictions for select to authenticated using (league_id = (select current_league_id()));
  end if;
end $$;
revoke all on public.predictions from anon;
grant select on public.predictions to authenticated;

-- tonight's expectation for every player the running league has on a roster and whose club plays tonight
create or replace function public.predict_tonight() returns integer
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); d date := today_et(); n int;
begin
  insert into predictions (league_id, kind, subject, predicted, basis, resolves_on)
  select lid, 'player_night', jsonb_build_object('player_id', p.id, 'date', d), _player_rate(p.id, 'fpts'),
    case when coalesce(ps.gp, 0) >= 5 then 'season rate' else 'projection' end, d
  from rosters r
  join league_players p on p.id = r.player_id
  left join player_season ps on ps.player_id = p.id
  where r.league_id = lid and r.slot <> 'IR'
    and exists (select 1 from games g where g.date = d and p.nhl_team in (g.home, g.away) and g.state not in ('PPD', 'CNCL'))
  on conflict (league_id, kind, subject) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- what happened, once the night is over and the box scores are final
create or replace function public.score_predictions(p_through date default null) returns integer
language plpgsql security definer set search_path = public as $$
declare lid int := current_league_id(); through date := coalesce(p_through, today_et() - 1); n int := 0; k int;
begin
  -- a player who dressed: his points that night in this league's scoring
  with done as (
    select pr.id, sum(lg.fpts) as pts
    from predictions pr
    join league_games lg on lg.player_id = (pr.subject->>'player_id')::int and lg.date = (pr.subject->>'date')::date
    join games g on g.id = lg.game_id and g.final_synced
    where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    group by pr.id)
  update predictions pr set outcome = done.pts, error = done.pts - pr.predicted, status = 'scored', scored_at = now()
  from done where pr.id = done.id;
  get diagnostics k = row_count; n := n + k;
  -- a player who never dressed once his club's games that night are final: void, not a zero
  update predictions pr set status = 'void', scored_at = now()
  where pr.league_id = lid and pr.kind = 'player_night' and pr.status = 'open' and pr.resolves_on <= through
    and not exists (select 1 from games g join players p on p.id = (pr.subject->>'player_id')::int
                    where g.date = (pr.subject->>'date')::date and p.nhl_team in (g.home, g.away) and not g.final_synced
                      and g.state not in ('PPD', 'CNCL'));
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

revoke execute on function public.predict_tonight(), public.score_predictions(date) from public, anon, authenticated;

-- how good the guesses are, per kind and week
create or replace view public.prediction_accuracy with (security_invoker = true) as
  select kind, date_trunc('week', resolves_on)::date as week, basis,
    count(*) as n, round(avg(predicted), 2) as avg_predicted, round(avg(outcome), 2) as avg_outcome,
    round(avg(error), 2) as bias, round(avg(abs(error)), 2) as avg_miss
  from predictions where status = 'scored'
  group by kind, date_trunc('week', resolves_on), basis;
revoke all on public.prediction_accuracy from anon;
grant select on public.prediction_accuracy to authenticated;

-- the Book against what happened: each settled option's no-vig chance, bucketed, and how often the bucket hit
create or replace view public.book_calibration with (security_invoker = true) as
  with opts as (
    select m.id, m.kind, o->>'key' as key, (o->>'odds')::numeric as odds, m.winner_key
    from markets m cross join jsonb_array_elements(m.options) o
    where m.status = 'settled' and m.winner_key is not null and (o->>'odds')::numeric > 1),
  fair as (
    select o.*, (1 / o.odds) / sum(1 / o.odds) over (partition by o.id) as chance from opts o)
  select kind, least(9, floor(chance * 10))::int as bucket, count(*) as n,
    round(avg(chance), 3) as expected, round(avg(case when key = winner_key then 1 else 0 end), 3) as happened,
    round(avg(power(chance - case when key = winner_key then 1 else 0 end, 2)), 4) as brier
  from fair group by kind, least(9, floor(chance * 10));
revoke all on public.book_calibration from anon;
grant select on public.book_calibration to authenticated;

-- the league pass runs the new jobs too
create or replace function public.run_league_jobs(p_job text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lid int; prev text := current_setting('app.league_id', true); out jsonb := '{}'; r jsonb;
begin
  if p_job not in ('open-book', 'open-book-season', 'settle-book', 'settle-book-season', 'settle-bets', 'predict', 'score-predictions') then
    raise exception 'Unknown league job %', p_job;
  end if;
  for lid in select id from leagues where status = 'active' order by id loop
    begin
      perform set_config('app.league_id', lid::text, true);
      r := case p_job
        when 'open-book' then to_jsonb(open_markets())
        when 'open-book-season' then jsonb_build_array(open_season_markets(), open_nhl_markets(), reprice_season_markets())
        when 'settle-book' then settle_markets()
        when 'settle-book-season' then jsonb_build_array(settle_season_markets(), settle_race_markets())
        when 'settle-bets' then settle_due_bets()
        when 'predict' then to_jsonb(predict_tonight())
        when 'score-predictions' then to_jsonb(score_predictions())
      end;
      out := out || jsonb_build_object(lid::text, r);
    exception when others then
      raise warning 'run_league_jobs % league %: %', p_job, lid, sqlerrm;
      out := out || jsonb_build_object(lid::text, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  perform set_config('app.league_id', coalesce(prev, ''), true);
  return out;
end $$;
