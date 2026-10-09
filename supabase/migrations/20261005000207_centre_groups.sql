-- Standings by division and conference in the centres (docs/DEVELOPMENT.md §6 item 2, "standings by division"): a
-- competition's groups go on the competition (`competitions.detail.groups`, each a name, its parent and its clubs by
-- short name; `group_word` and `parent_word` name them), so NFL centre shows the eight divisions and the two
-- conferences, and Match centre shows MLS's two conferences, beside the league table. The groups are data, not code: a
-- new competition gets its own the same way, and a realignment is an update here.

update public.competitions set detail = coalesce(detail, '{}') || jsonb_build_object(
  'group_word', 'Division', 'parent_word', 'Conference',
  'groups', '[
    {"name": "AFC East", "parent": "AFC", "clubs": ["BUF", "MIA", "NE", "NYJ"]},
    {"name": "AFC North", "parent": "AFC", "clubs": ["BAL", "CIN", "CLE", "PIT"]},
    {"name": "AFC South", "parent": "AFC", "clubs": ["HOU", "IND", "JAX", "TEN"]},
    {"name": "AFC West", "parent": "AFC", "clubs": ["DEN", "KC", "LAC", "LV"]},
    {"name": "NFC East", "parent": "NFC", "clubs": ["DAL", "NYG", "PHI", "WSH"]},
    {"name": "NFC North", "parent": "NFC", "clubs": ["CHI", "DET", "GB", "MIN"]},
    {"name": "NFC South", "parent": "NFC", "clubs": ["ATL", "CAR", "NO", "TB"]},
    {"name": "NFC West", "parent": "NFC", "clubs": ["ARI", "LAR", "SEA", "SF"]}]'::jsonb)
where id = 'nfl';

update public.competitions set detail = coalesce(detail, '{}') || jsonb_build_object(
  'group_word', 'Conference',
  'groups', '[
    {"name": "Eastern Conference", "clubs": ["ATL", "CHI", "CIN", "CLB", "CLT", "DC", "MIA", "MTL", "NE", "NSH", "NYC", "ORL", "PHI", "RBNY", "TOR"]},
    {"name": "Western Conference", "clubs": ["ATX", "COL", "DAL", "HOU", "LA", "LAFC", "MIN", "POR", "RSL", "SD", "SEA", "SJ", "SKC", "STL", "VAN"]}]'::jsonb)
where id = 'mls';
