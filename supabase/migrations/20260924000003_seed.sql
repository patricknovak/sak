-- SaK League: 2026/27 league settings and the eight franchises
insert into public.league (id, season, phase, keepers, top_scorer_rule, keeper_deadline, draft_at, pick_seconds,
  draft_rounds, snake, season_start, season_end, trade_deadline, max_acquisitions, extra_acq_fee, entry_fee, sak_fee)
values (1, '2026-27', 'keepers', 6, true,
  '2026-09-27 16:00:00+00',   -- Sun Sep 27, 12:00 pm ET
  '2026-09-28 01:00:00+00',   -- Sun Sep 27, 9:00 pm ET
  90, 18, true, '2026-09-29', '2027-04-10',
  '2027-03-04 04:59:00+00',   -- Wed Mar 3, 11:59 pm ET
  10, 30, 200, 25)
on conflict (id) do nothing;

update public.league set info = '{
  "fund": {"asOf": "2025-11-27", "holding": "36 TSLA shares (held in trust by the commissioner)", "valueCad": 17233.34,
           "perMember": 2154.17, "note": "Market value less $1,000 cost contributed by Patrick. Shared equally by active GMs."},
  "prizes2526": {"pool": 1400, "first": 840, "second": 420, "third": 140, "sakShare": 200},
  "peterOwed": {"season": "2025-26", "team": "Eagle Palace", "amount": 270.70}
}' where id = 1;

insert into public.draft_state (id, season) values (1, '2026-27') on conflict (id) do nothing;

insert into public.teams (id, name, abbrev, gm_name, login_email, color, emoji, is_commish, joined_season, motto) values
  (1, 'The Hip Czechs',     'HIP', 'Patrick',    'hipczechs@sakleague.app',   '#c8102e', '🇨🇿', true,  '2013-14', 'Commish. Founder. Still chasing the Johnson.'),
  (2, '#What No Way',       'WNW', 'Terry',      'whatnoway@sakleague.app',   '#7c3aed', '😱', false, '2015-16', 'Back-to-back champs 22/23 & 23/24.'),
  (3, 'Jays',               'JAY', 'Jason',      'jays@sakleague.app',        '#1d4ed8', '🐦', false, '2013-14', 'All-time points leader. 4x champ.'),
  (4, 'Ravens',             'RAV', 'Craig',      'ravens@sakleague.app',      '#111827', '🐦‍⬛', false, '2013-14', 'Nevermore.'),
  (5, 'Eagle Palace',       'EGL', 'Trystan',    'eaglepalace@sakleague.app', '#0f766e', '🦅', false, '2025-26', 'Holder of the Peter. Nowhere to go but up.'),
  (6, 'Connor McPanos',     'PAN', 'Panagiotis', 'mcpanos@sakleague.app',     '#ea580c', '🧔', false, '2013-14', '2024/25 champion.'),
  (7, 'Hughes Your Daddy',  'HYD', 'Todd',       'hughes@sakleague.app',      '#0891b2', '👨‍👦', false, '2013-14', 'THE NUGE lives on.'),
  (8, 'Hatrick Swayze',     'HAT', 'Darin',      'hatrick@sakleague.app',     '#db2777', '🕺', false, '2025-26', 'Rookie GM. Reigning champ. Nobody puts Swayze in the corner.')
on conflict (id) do nothing;

-- proposals carried over from the spreadsheet's "Proposals For Future Seasons"
insert into public.proposals (title, body, sponsor_team, cosponsor_team, status) values
  ('Taxi Squad', 'Take two roster spots and make them a Taxi Squad for development players. Set before game 1; a taxi player can only be activated by trading him, and the squad is only replenished at the next draft.', 1, 6, 'tabled'),
  ('Trade response deadline', 'Set a max number of days (around 10) to accept or reject a trade offer, to spark moves that wouldn''t happen without the pressure.', 7, null, 'tabled'),
  ('Smaller rosters', 'Change total roster positions from 24 (+IR) to 20.', 7, null, 'tabled'),
  ('Unlimited pickups', 'Change free pickups from the current limit to unlimited.', 7, null, 'tabled');
