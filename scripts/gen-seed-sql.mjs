#!/usr/bin/env node
// Turns data/players.json + data/rosters-2025-26.json into SQL upserts.
//   node scripts/gen-seed-sql.mjs [--rosters] [--chunk 250]   -> supabase/seed/players-NN.sql
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const chunk = Number(args[args.indexOf('--chunk') + 1]) || 250;
const { players } = JSON.parse(readFileSync(join(root, 'data/players.json'), 'utf8'));

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(q).join(',')}]::text[]`;
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'null' : String(v));

const out = join(root, 'supabase/seed');
mkdirSync(out, { recursive: true });
const files = [];
for (let i = 0; i < players.length; i += chunk) {
  const rows = players.slice(i, i + chunk).map((p) =>
    `(${p.id},${q(p.name)},${q(p.first)},${q(p.lastName)},${q(p.pos)},${arr(p.elig)},${q(p.team)},${num(p.num)},${q(p.birth)},${q(p.shoots)},${q(p.headshot)},${num(p.last?.fp ?? 0)},${p.last ? q(JSON.stringify(p.last)) + '::jsonb' : 'null'},${num(p.proj)},${p.rank},${q(p.unrostered ? 'unrostered' : 'active')})`);
  const sql = `insert into public.players (id,name,first,last_name,pos,elig,nhl_team,num,birth,shoots,headshot,last_fp,last_stats,proj,rank,status) values
${rows.join(',\n')}
on conflict (id) do update set name=excluded.name, first=excluded.first, last_name=excluded.last_name, pos=excluded.pos,
  elig=case when array_length(players.elig,1) > 1 then players.elig else excluded.elig end,
  nhl_team=excluded.nhl_team, num=excluded.num, birth=excluded.birth, shoots=excluded.shoots, headshot=excluded.headshot,
  last_fp=excluded.last_fp, last_stats=excluded.last_stats, proj=excluded.proj, rank=excluded.rank, status=excluded.status, updated_at=now();
`;
  const f = join(out, `players-${String(files.length + 1).padStart(2, '0')}.sql`);
  writeFileSync(f, sql);
  files.push(f);
}

if (args.includes('--rosters')) {
  const rosters = JSON.parse(readFileSync(join(root, 'data/rosters-2025-26.json'), 'utf8'));
  const rows = Object.entries(rosters).flatMap(([team, list]) =>
    list.map((r) => `(${r.id},${team},'BN','carryover',${r.yahooFp})`));
  writeFileSync(join(out, 'rosters-2025-26.sql'),
`-- End-of-2025/26 rosters from Yahoo: the pool each GM chooses keepers from
insert into public.rosters (player_id, team_id, slot, acquired, prev_fp) values
${rows.join(',\n')}
on conflict (player_id) do nothing;
`);
  files.push('rosters-2025-26.sql');
}
console.log(files.map((f) => f.replace(root + '/', '')).join('\n'));
