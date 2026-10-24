-- A league's own club for its fan zone (24 October 2026, Patrick: a super fan page of the Edmonton Oilers on SaK).
-- league_rules.info.fan_club names the NHL club the More menu's fan zone opens on (#/fans); any club can be picked from
-- the page itself. SaK's is Edmonton. Safe to run twice: a club already set is left alone.
update public.league_rules set info = coalesce(info, '{}'::jsonb) || jsonb_build_object('fan_club', 'EDM')
  where league_id = 1 and not (coalesce(info, '{}'::jsonb) ? 'fan_club');
