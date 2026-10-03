// Writes SaK's history (src/data/history.ts) as SQL for the league memory tables, so the database holds exactly
// what the site shows today. Run: node --experimental-strip-types scripts/gen-history-sql.mjs > /tmp/history-sak.sql (then paste it into a migration)
import { SEASONS, FRANCHISE_OF, ALL_TIME_2425, TROPHIES, TIMELINE, RULES } from '../src/data/history.ts';

const q = (v) => (v === undefined || v === null ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`;
const out = [];
out.push('-- SaK (league 1) history, generated from src/data/history.ts by scripts/gen-history-sql.mjs. Safe to run twice.');
out.push('insert into public.league_seasons (league_id, season, note, penalty, sort) values');
out.push(SEASONS.map((s, i) => `  (1, ${q(s.season)}, ${q(s.note)}, ${q(s.peterPenalty)}, ${SEASONS.length - i})`).join(',\n') + '\non conflict (league_id, season) do nothing;');
const rows = [];
for (const s of SEASONS) s.rows.forEach((r, i) => rows.push(`  (1, ${q(s.season)}, ${i + 1}, ${q(r.team)}, ${q(r.gm)}, ${q(FRANCHISE_OF[r.gm])}, ${q(r.points)}, ${q(r.prize)}, ${q(!!r.peter)}, ${q(r.note)})`));
out.push('insert into public.season_results (league_id, season, place, team_name, gm_name, team_id, points, prize, last_place, note) values');
out.push(rows.join(',\n') + '\non conflict (league_id, season, place) do nothing;');
out.push('insert into public.league_all_time_base (league_id, franchise, team_id, points, through_season) values');
out.push(ALL_TIME_2425.map((r) => `  (1, ${q(r.franchise)}, ${r.teamId || 'null'}, ${q(r.points)}, '2024-25')`).join(',\n') + '\non conflict (league_id, franchise) do nothing;');
out.push('insert into public.league_trophies (league_id, name, since, emoji, description, sort) values');
out.push(TROPHIES.map((t, i) => `  (1, ${q(t.name)}, ${q(t.since)}, ${q(t.emoji)}, ${q(t.desc)}, ${i + 1})`).join(',\n') + '\non conflict (league_id, name) do nothing;');
out.push('insert into public.league_timeline (league_id, when_label, what, sort) values');
out.push(TIMELINE.map((t, i) => `  (1, ${q(t.when)}, ${q(t.what)}, ${i + 1})`).join(',\n') + '\non conflict (league_id, sort) do nothing;');
out.push('insert into public.league_rule_text (league_id, title, items, sort) values');
out.push(RULES.map((r, i) => `  (1, ${q(r.title)}, ${arr(r.items)}, ${i + 1})`).join(',\n') + '\non conflict (league_id, title) do nothing;');
console.log(out.join('\n'));
