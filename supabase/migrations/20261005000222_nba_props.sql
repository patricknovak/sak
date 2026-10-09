-- The prop sheet on the NBA playoffs (migration 220 brought the feed): eight calls in basketball's words. Who wins; the
-- total over or under the market's line (made a half) or 220.5; the margin, 1 to 5, 6 to 10 or 11 or more; who leads
-- after the 1st quarter and at the half; 1st-quarter points over or under 54.5; overtime; a side held under 100. Settled
-- from the score and ESPN's quarters as the game goes, like every sheet (migration 218). Safe to run twice.

create or replace function public._props_sheet(p_fixture bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f fixtures; sp text; h text; a text; line numeric; pw text; teams jsonb; lead jsonb; yn jsonb;
begin
  select * into f from fixtures where id = p_fixture;
  sp := (select sport from competitions where id = f.competition);
  h := (select coalesce(short, name) from clubs where id = f.home_club);
  a := (select coalesce(short, name) from clubs where id = f.away_club);
  -- the market's total when the feed carried one, made a half so it can't push; else the sport's usual
  line := coalesce(floor((f.detail->'odds'->>'total')::numeric) + 0.5, case sp when 'mlb' then 8.5 when 'nfl' then 44.5 when 'nba' then 220.5 when 'nhl' then 5.5 else 2.5 end);
  pw := case sp when 'mlb' then 'inning' when 'nfl' then 'quarter' when 'nba' then 'quarter' else 'period' end;
  teams := jsonb_build_array(jsonb_build_object('v', 'A', 'label', a), jsonb_build_object('v', 'H', 'label', h));
  lead := jsonb_build_array(jsonb_build_object('v', 'A', 'label', a), jsonb_build_object('v', 'T', 'label', 'Tied'), jsonb_build_object('v', 'H', 'label', h));
  yn := '[{"v": "Y", "label": "Yes"}, {"v": "N", "label": "No"}]';
  return jsonb_build_array(
    jsonb_build_object('key', 'winner', 'q', 'Who wins?', 'options', teams),
    jsonb_build_object('key', 'total', 'q', format('Total %s: over or under %s?', _sport_word(f.competition, 'score', 'runs'), line), 'line', line,
      'options', jsonb_build_array(jsonb_build_object('v', 'O', 'label', 'Over ' || line), jsonb_build_object('v', 'U', 'label', 'Under ' || line))),
    jsonb_build_object('key', 'margin', 'q', 'The winning margin', 'options', case sp
      when 'mlb' then '[{"v": "1", "label": "1 run"}, {"v": "2", "label": "2 or 3"}, {"v": "4", "label": "4 or more"}]'::jsonb
      when 'nfl' then '[{"v": "1", "label": "1 to 7"}, {"v": "8", "label": "8 to 14"}, {"v": "15", "label": "15 or more"}]'::jsonb
      when 'nba' then '[{"v": "1", "label": "1 to 5"}, {"v": "6", "label": "6 to 10"}, {"v": "11", "label": "11 or more"}]'::jsonb
      else '[{"v": "1", "label": "1 goal"}, {"v": "2", "label": "2 goals"}, {"v": "3", "label": "3 or more"}]'::jsonb end),
    jsonb_build_object('key', 'first', 'q', format('Who leads after the 1st %s?', pw), 'options', lead),
    jsonb_build_object('key', 'half', 'q', case sp when 'mlb' then 'Who leads after 5 innings?' when 'nfl' then 'Who leads at the half?' when 'nba' then 'Who leads at the half?' else 'Who leads after the 2nd period?' end, 'options', lead),
    case sp when 'nfl' then jsonb_build_object('key', 'early', 'q', '1st-quarter points: over or under 9.5?',
           'options', '[{"v": "O", "label": "Over 9.5"}, {"v": "U", "label": "Under 9.5"}]'::jsonb)
         when 'nba' then jsonb_build_object('key', 'early', 'q', '1st-quarter points: over or under 54.5?',
           'options', '[{"v": "O", "label": "Over 54.5"}, {"v": "U", "label": "Under 54.5"}]'::jsonb)
         else jsonb_build_object('key', 'early', 'q', format('A %s in the 1st %s?', case sp when 'mlb' then 'run' else 'goal' end, pw), 'options', yn) end,
    jsonb_build_object('key', 'extra', 'q', case sp when 'mlb' then 'Extra innings?' else 'Overtime?' end, 'options', yn),
    case sp when 'nfl' then jsonb_build_object('key', 'held', 'q', 'A side held to 10 points or fewer?', 'options', yn)
         when 'nba' then jsonb_build_object('key', 'held', 'q', 'A side held under 100 points?', 'options', yn)
         else jsonb_build_object('key', 'shutout', 'q', 'A shutout?', 'options', yn) end);
end $$;
revoke execute on function public._props_sheet(bigint) from public, anon, authenticated;

create or replace function public._props_answers(p_game bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g pool_games; f fixtures; sp text; reg int; half int; np int; h int; a int; m int; fh int; fa int; hh int; ha int; out jsonb := '{}';
  q jsonb; fin boolean; done1 boolean; doneh boolean; extra boolean;
begin
  select * into g from pool_games where id = p_game and kind = 'props';
  select * into f from fixtures where id = (g.rules->>'fixture')::bigint;
  if f.id is null or f.state not in ('final', 'live') or f.home_score is null or f.away_score is null then return out; end if;
  fin := f.state = 'final';
  sp := (select sport from competitions where id = f.competition);
  reg := case sp when 'mlb' then 9 when 'nfl' then 4 when 'nba' then 4 else 3 end;
  half := case sp when 'mlb' then 5 else 2 end;
  h := f.home_score; a := f.away_score; m := abs(h - a);
  select count(*), sum(home) filter (where n = 1), sum(away) filter (where n = 1), sum(home) filter (where n <= half), sum(away) filter (where n <= half)
    into np, fh, fa, hh, ha from fixture_periods where fixture_id = f.id;
  -- while the game is on, a period is over once the next has begun (as the squares read it, migration 167)
  done1 := exists (select 1 from fixture_periods where fixture_id = f.id and n > 1 and away is not null);
  doneh := exists (select 1 from fixture_periods where fixture_id = f.id and n > half and away is not null);
  extra := exists (select 1 from fixture_periods where fixture_id = f.id and n > reg and away is not null);
  for q in select * from jsonb_array_elements(g.rules->'questions') loop
    out := out || jsonb_build_object(q->>'key', case when fin then case q->>'key'
      when 'winner' then case when h > a then 'H' when a > h then 'A' end
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' when h + a < (q->>'line')::numeric then 'U' end
      when 'margin' then case when m = 0 then null
        when sp = 'mlb' then case when m = 1 then '1' when m <= 3 then '2' else '4' end
        when sp = 'nfl' then case when m <= 7 then '1' when m <= 14 then '8' else '15' end
        when sp = 'nba' then case when m <= 5 then '1' when m <= 10 then '6' else '11' end
        else case when m = 1 then '1' when m = 2 then '2' else '3' end end
      when 'first' then case when np < 1 or fh is null and fa is null then null
        when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end
      when 'half' then case when np < half then null
        when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end
      when 'early' then case when np < 1 then null
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' else 'U' end
        when sp = 'nba' then case when coalesce(fh, 0) + coalesce(fa, 0) > 54.5 then 'O' else 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' else 'N' end
      when 'extra' then case when np < reg then null when np > reg then 'Y' else 'N' end
      when 'shutout' then case when h = 0 or a = 0 then 'Y' else 'N' end
      when 'held' then case when least(h, a) <= case when sp = 'nba' then 99 else 10 end then 'Y' else 'N' end end
    -- under way: only what can no longer change
    else case q->>'key'
      when 'total' then case when h + a > (q->>'line')::numeric then 'O' end
      when 'first' then case when done1 then case when coalesce(fh, 0) > coalesce(fa, 0) then 'H' when coalesce(fa, 0) > coalesce(fh, 0) then 'A' else 'T' end end
      when 'half' then case when doneh then case when coalesce(hh, 0) > coalesce(ha, 0) then 'H' when coalesce(ha, 0) > coalesce(hh, 0) then 'A' else 'T' end end
      when 'early' then case
        when sp = 'nfl' then case when coalesce(fh, 0) + coalesce(fa, 0) > 9.5 then 'O' when done1 then 'U' end
        when sp = 'nba' then case when coalesce(fh, 0) + coalesce(fa, 0) > 54.5 then 'O' when done1 then 'U' end
        when coalesce(fh, 0) + coalesce(fa, 0) > 0 then 'Y' when done1 then 'N' end
      when 'extra' then case when extra then 'Y' end
      when 'shutout' then case when h > 0 and a > 0 then 'N' end
      when 'held' then case when least(h, a) > case when sp = 'nba' then 99 else 10 end then 'N' end end end);
  end loop;
  -- a call with no answer yet is a null, as before (at the final, a null is a void call)
  return out;
end $$;
revoke execute on function public._props_answers(bigint) from public, anon, authenticated;

create or replace function public._props_rules(p_competition text, p_rules jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f fixtures; r jsonb := coalesce(p_rules, '{}');
begin
  select * into f from fixtures where id = (r->>'fixture')::bigint and competition = p_competition;
  -- a postseason's game, or a game of an NFL week (its feed keeps the quarters too, migration 216)
  if f.id is null or (f.series_id is null and (select sport from competitions where id = p_competition) <> 'nfl') then raise exception 'Pick a game of this event'; end if;
  -- the feeds keep the score by period for baseball, football and hockey (the Stanley Cup's since migration 215)
  if (select sport from competitions where id = p_competition) not in ('mlb', 'nfl', 'nba', 'nhl') then raise exception 'Prop sheets run on baseball, football, basketball and hockey'; end if;
  if f.state <> 'scheduled' or f.kickoff <= now() then raise exception 'That game has started; pick one still to come'; end if;
  if (select state from series where id = f.series_id) = 'final' then raise exception 'That series is over, so the game won''t be played'; end if;
  -- the sheet stays as it was made while the game is the same (a rules change before the lock keeps its lines)
  -- the sheet is always made here, never taken from the caller (the settlement reads its keys, lines and options)
  return jsonb_build_object('fixture', f.id, 'questions', _props_sheet(f.id));
end $$;
revoke execute on function public._props_rules(text, jsonb) from public, anon, authenticated;

create or replace function public._props_games(p_competition text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'kickoff', f.kickoff, 'game_no', case when s.best_of > 1 then f.game_no end,
      'label', coalesce(s.short, s.label, nullif(f.round, ''), 'Week ' || f.gameweek),
      'home', coalesce(ch.short, ch.name), 'away', coalesce(ca.short, ca.name)) order by f.kickoff, f.id), '[]')
  from fixtures f left join series s on s.id = f.series_id join competitions c on c.id = f.competition
  join clubs ch on ch.id = f.home_club join clubs ca on ca.id = f.away_club
  where f.competition = p_competition and c.sport in ('mlb', 'nfl', 'nba', 'nhl') and f.state = 'scheduled'
    -- a postseason's games while their series is still going, or an NFL week's
    and (coalesce(s.state, '') <> 'final' and (f.series_id is not null or c.sport = 'nfl'))
    and f.kickoff > now() and f.kickoff <= now() + interval '7 days'
$$;
revoke execute on function public._props_games(text) from public, anon, authenticated;
