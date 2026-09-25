// Garry: the SaK League's resident chirper.
//   ?task=daily  (late morning ET) yesterday's recap + standings + daily coin bonus; keeper/draft hype off-season
//   ?task=nudge  (late afternoon ET) calls out GMs with sloppy lineups before puck drop
//   ?task=reply  (when a GM says "Garry" in chat, or anything in their Ask Garry channel) answers with real info
//   ?task=draft  (when the last pick lands) grades every team's draft
//   ?task=weekly (Monday morning) team of the week (+coins), bust of the week, player of the week, power rankings
// Writes with Grok (xAI) when the XAI_API_KEY secret is set; otherwise uses built-in templates.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { etDate } from '../_shared/nhl.ts';
import { gradeTeams, type GP } from '../_shared/grades.ts';
import { answer } from './answer.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const apiKey = Deno.env.get('XAI_API_KEY');
const GROK_MODEL = Deno.env.get('GROK_MODEL') || 'grok-4';   // any xAI chat model id
const GROK_URL = 'https://api.x.ai/v1/chat/completions';

const DAILY_BONUS = 25;
const WEEKLY_BONUS = 50;
const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const f1 = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

type Team = { id: number; name: string; gm_name: string; auto_lineup: boolean; keepers_submitted: boolean };

const PERSONA = `You are Garry, the resident chirper of the She's A Keeper (SaK) fantasy hockey keeper league, a group of
eight longtime friends (est. 2013) who play for real money, the SaK Fund, and St. Patrick coins (the league's side-bet
currency, everyone started with 1,000). You live in the league chat.

Voice: a loud, lovable Canadian beer-league dressing-room guy. Quick, punchy, specific, funny. Roast everyone equally,
leader and Peter-holder alike (The Peter is the last-place trophy; the champion wins The Johnson). Keep it PG-13: no
slurs, nothing about anyone's family, looks, jobs or real-life problems; the chirps are about hockey decisions only.
Use the facts given; never invent stats, scores or players. Tag GMs as @Name (first names given). Use at most 3 emoji.

Always end with one nudge that gets people participating: set lineups, make a trade offer, post a side bet with
St. Patrick coins, or trash talk someone specific. Plain text only, no markdown headers.`;

async function write(task: string, facts: unknown, fallback: string, maxWords = 180): Promise<string> {
  if (!apiKey) return fallback;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 45_000);
    const res = await fetch(GROK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: ctl.signal,
      body: JSON.stringify({
        model: GROK_MODEL,
        temperature: 0.9,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: PERSONA },
          { role: 'user', content: `${task}\nKeep it under ${maxWords} words.\n\nFacts (JSON):\n${JSON.stringify(facts)}` },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) { console.error('grok', res.status, (await res.text()).slice(0, 300)); return fallback; }
    const j = await res.json();
    const text = String(j?.choices?.[0]?.message?.content ?? '').trim();
    return text || fallback;
  } catch (e) {
    console.error('grok', e);
    return fallback;
  }
}

async function post(body: string, meta: Record<string, unknown>) {
  const { error } = await db.from('messages').insert({ channel: 'general', kind: 'bot', body: body.slice(0, 2000), meta: { bot: 'garry', ...meta } });
  if (error) throw error;
}

async function alreadyPosted(type: string, date: string) {
  const { data } = await db.from('messages').select('id').eq('kind', 'bot').contains('meta', { type, date }).limit(1);
  return (data ?? []).length > 0;
}

async function base() {
  const [{ data: league }, { data: teams }, { data: standings }] = await Promise.all([
    db.from('league').select('*').single(),
    db.from('teams').select('id,name,gm_name,auto_lineup,keepers_submitted').eq('role', 'gm').order('id'),
    db.from('standings').select('*'),
  ]);
  const byId = new Map((teams as Team[]).map((t) => [t.id, t]));
  return { league, teams: teams as Team[], byId, standings: (standings ?? []) as any[] };
}

// ─────────────── daily ───────────────
async function daily() {
  const { league, teams, byId, standings: regStandings } = await base();
  let standings = regStandings;
  const today = etDate(new Date());
  const yesterday = etDate(new Date(Date.now() - 86400000));

  if (league.phase === 'keepers' || league.phase === 'predraft') {
    if (await alreadyPosted('hype', today)) return { skipped: 'already posted' };
    const slackers = teams.filter((t) => !t.keepers_submitted).map((t) => t.gm_name);
    const draftIn = league.draft_at ? Math.max(0, Math.round((new Date(league.draft_at).getTime() - Date.now()) / 3600000)) : null;
    const facts = {
      phase: league.phase, keeper_deadline: league.keeper_deadline, draft_at: league.draft_at, hours_to_draft: draftIn,
      gms_without_keepers: league.phase === 'keepers' ? slackers : [],
      defending_champ: 'Hatrick Swayze (Darin), a rookie GM who won it all last year',
      peter_holder: 'Eagle Palace (Trystan), last place last season',
      top_scorers_back_in_pool: ['Connor McDavid', 'Nathan MacKinnon', 'Nikita Kucherov', 'Macklin Celebrini', 'Martin Necas', 'Evan Bouchard', 'Cale Makar', 'Tage Thompson'],
    };
    const fallback = league.phase === 'keepers'
      ? `☘️ Garry here. ${draftIn != null ? `${draftIn} hours to draft night.` : ''} ${slackers.length ? `Still waiting on keepers from ${slackers.map((n) => '@' + n).join(', ')}. The deadline won't extend itself, boys.` : 'Every GM has locked in keepers. Look at you, all responsible.'} McDavid, MacKinnon and Kucherov are all back in the pool thanks to the top-scorer rule. Somebody's about to look like a genius and somebody's about to take a goalie first overall. Build your queue, and put some St. Patrick coins where your mouth is: who goes #1?`
      : `☘️ Garry here. Keepers are locked. ${draftIn != null ? `${draftIn} hours until the draft.` : ''} Star your targets so autodraft doesn't pick you a backup goalie in round 2. Side bet idea: over/under 3 goalies taken in round 1. Loser buys the first round.`;
    const body = await write('Write the morning pre-draft hype post for the league chat.', facts, fallback, 150);
    await post(body, { type: 'hype', date: today });
    return { posted: 'hype' };
  }
  if (league.phase !== 'season') return { skipped: league.phase };
  if (await alreadyPosted('recap', yesterday)) return { skipped: 'already posted' };

  // regular season first; once the NHL playoffs start, yesterday's points live in the playoff table
  let { data: daily } = await db.from('team_daily').select('*').eq('date', yesterday);
  let playoffs = false;
  if (!daily?.length) {
    const { data: po } = await db.from('playoff_daily').select('*').eq('date', yesterday);
    if (po?.length) { daily = po; playoffs = true; }
  }
  if (!daily || daily.length === 0) return { skipped: 'no games yesterday' };
  if (playoffs) {
    const { data: ps } = await db.from('playoff_standings').select('*');
    standings = (ps ?? []) as any[];
  }
  const { data: snaps } = await db.from('lineup_snapshots').select('team_id,player_id,slot').eq('date', yesterday);
  const ids = [...new Set((snaps ?? []).map((s) => s.player_id))];
  const [{ data: pgs }, { data: players }] = await Promise.all([
    db.from('player_games').select('player_id,fpts,stats').eq('date', yesterday).in('player_id', ids),
    db.from('players').select('id,name,nhl_team').in('id', ids),
  ]);
  const pname = new Map((players ?? []).map((p) => [p.id, p.name]));
  const pg = new Map((pgs ?? []).map((p) => [p.player_id, p]));
  const lines = (snaps ?? []).filter((s) => pg.has(s.player_id)).map((s) => ({
    gm: byId.get(s.team_id)?.gm_name, team: byId.get(s.team_id)?.name, player: pname.get(s.player_id),
    slot: s.slot, fpts: Number(pg.get(s.player_id)!.fpts), stats: pg.get(s.player_id)!.stats,
  }));
  const active = lines.filter((l) => !['BN', 'IR'].includes(l.slot)).sort((a, b) => b.fpts - a.fpts);
  const benchRegret = lines.filter((l) => l.slot === 'BN' && l.fpts >= 4).sort((a, b) => b.fpts - a.fpts).slice(0, 3);
  const dayTable = [...daily].sort((a, b) => b.points - a.points).map((d) => ({ gm: byId.get(d.team_id)?.gm_name, team: byId.get(d.team_id)?.name, points: Number(d.points) }));
  const season = [...standings].sort((a, b) => a.rank - b.rank).map((s) => ({ rank: s.rank, gm: byId.get(s.team_id)?.gm_name, team: byId.get(s.team_id)?.name, points: Number(s.points) }));
  const winner = [...daily].sort((a, b) => b.points - a.points)[0];

  // daily bonus: top team of the day gets St. Patrick coins
  await db.from('coin_ledger').insert({ team_id: winner.team_id, amount: DAILY_BONUS, reason: `Garry's Dangler of the Day (${yesterday})` });

  const { data: chat } = await db.from('messages').select('team_id').eq('kind', 'user').gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  const talkers = new Set((chat ?? []).map((m) => m.team_id));
  const lurkers = teams.filter((t) => !talkers.has(t.id)).map((t) => t.gm_name);

  const facts = {
    date: yesterday, day_scores: dayTable, season_standings: season,
    top_performers: active.slice(0, 3), worst_starters: active.slice(-2).reverse(), left_on_bench: benchRegret,
    daily_bonus: { gm: byId.get(winner.team_id)?.gm_name, coins: DAILY_BONUS },
    stage: playoffs ? `SaK playoffs (NHL playoff games only; separate table and ${league.playoff_share ?? 40}% of the prize pool)` : 'regular season',
    peter_watch: playoffs ? null : season.at(-1), quiet_in_chat_this_week: lurkers,
  };
  const top = active[0];
  const fallback = [
    `🎙️ Garry's ${playoffs ? 'playoff ' : ''}morning skate, ${yesterday}.`,
    `Yesterday: ${dayTable.map((d) => `${d.gm} ${f1(d.points)}`).join(' · ')}.`,
    `${dayTable[0].gm} takes the day ${pick(['and the bragging rights', 'like it was a beer-league final', 'with zero humility'])} and pockets ${DAILY_BONUS} ☘️ coins.`,
    top ? `Star of the night: ${top.player} with ${f1(top.fpts)} for @${top.gm}.` : '',
    benchRegret[0] ? `Meanwhile @${benchRegret[0].gm} left ${benchRegret[0].player} (${f1(benchRegret[0].fpts)} pts) on the bench. Set your lineup, buddy.` : '',
    playoffs ? `Playoff table: ${season.slice(0, 3).map((x) => `${x.rank}. @${x.gm} ${f1(x.points)}`).join(', ')}.` : `Peter watch: @${season.at(-1)?.gm} sitting in the basement at ${f1(season.at(-1)?.points ?? 0)}.`,
    lurkers.length ? `Haven't heard a peep this week from ${lurkers.map((n) => '@' + n).join(', ')}. Say something.` : '',
    pick(['Who wants to put 100 ☘️ on tonight?', 'Trade offers are free. Your dignity isn\'t.', 'Set your lineups before puck drop.']),
  ].filter(Boolean).join(' ');
  const body = await write(`Write this morning's recap of yesterday's SaK ${playoffs ? 'playoff ' : ''}results for the league chat.`, facts, fallback, 220);
  await post(body, { type: 'recap', date: yesterday });
  return { posted: 'recap', bonus: facts.daily_bonus };
}

// ─────────────── nudge ───────────────
async function nudge() {
  const { league, teams, byId } = await base();
  const today = etDate(new Date());
  if (await alreadyPosted('nudge', today)) return { skipped: 'already posted' };

  if (league.phase === 'keepers') {
    const hrs = league.keeper_deadline ? (new Date(league.keeper_deadline).getTime() - Date.now()) / 3600000 : 99;
    const slackers = teams.filter((t) => !t.keepers_submitted);
    if (hrs > 30 || hrs < 0 || slackers.length === 0) return { skipped: 'nothing to nudge' };
    const fb = `⏰ Keeper deadline in ${Math.round(hrs)} hours. ${slackers.map((t) => '@' + t.gm_name).join(', ')}: More → Keepers, pick six, hit save. Miss it and the site picks for you. I'll be judging.`;
    await post(await write('Remind the listed GMs to submit keepers before the deadline.', { hours_left: Math.round(hrs), gms: slackers.map((t) => t.gm_name) }, fb, 70), { type: 'nudge', date: today });
    return { posted: 'keeper nudge' };
  }
  if (league.phase !== 'season') return { skipped: league.phase };

  const { data: games } = await db.from('games').select('home,away,start_utc').eq('date', today);
  if (!games?.length) return { skipped: 'no games today' };
  const playing = new Set(games.flatMap((g) => [g.home, g.away]));
  const { data: rosters } = await db.from('rosters').select('team_id,player_id,slot');
  const { data: players } = await db.from('players').select('id,name,nhl_team,injury_status').in('id', (rosters ?? []).map((r) => r.player_id));
  const pl = new Map((players ?? []).map((p) => [p.id, p]));
  const cap = league.roster as Record<string, number>;
  const issues: { gm: string; problems: string[] }[] = [];
  for (const t of teams) {
    const mine = (rosters ?? []).filter((r) => r.team_id === t.id);
    const problems: string[] = [];
    const starters = mine.filter((r) => !['BN', 'IR'].includes(r.slot));
    const idle = starters.filter((r) => !playing.has(pl.get(r.player_id)?.nhl_team ?? ''));
    const benchPlaying = mine.filter((r) => r.slot === 'BN' && playing.has(pl.get(r.player_id)?.nhl_team ?? ''));
    const hurt = starters.filter((r) => pl.get(r.player_id)?.injury_status);
    const empty = Object.entries(cap).filter(([s]) => !['BN', 'IR'].includes(s)).reduce((n, [s, c]) => n + Math.max(0, c - mine.filter((r) => r.slot === s).length), 0);
    if (empty) problems.push(`${empty} empty starting slot${empty > 1 ? 's' : ''}`);
    if (idle.length && benchPlaying.length) problems.push(`${idle.length} starter${idle.length > 1 ? 's' : ''} with no game while ${benchPlaying.map((r) => pl.get(r.player_id)?.name).slice(0, 2).join(' and ')} sit${benchPlaying.length > 1 ? '' : 's'} on the bench`);
    if (hurt.length) problems.push(`starting injured ${hurt.map((r) => `${pl.get(r.player_id)?.name} (${pl.get(r.player_id)?.injury_status})`).join(', ')}`);
    if (problems.length) issues.push({ gm: t.gm_name, problems });
  }
  if (!issues.length) return { skipped: 'all lineups clean' };
  const fb = `🚨 Lineup check before puck drop: ${issues.map((i) => `@${i.gm}: ${i.problems.join('; ')}`).join(' · ')}. Tap Lineup, or flip on auto-set in your profile and let the robot do your job.`;
  await post(await write('Call out these lineup problems before tonight\'s games, then tell them to fix it.', { games_today: games.length, issues }, fb, 120), { type: 'nudge', date: today });
  return { posted: 'lineup nudge', teams: issues.length };
}

// ─────────────── reply ───────────────
// answers anyone who says "Garry" in a public channel, and everything in their private garry:<team> channel
async function reply(messageId: number) {
  const { data: m } = await db.from('messages').select('*').eq('id', messageId).single();
  if (!m || m.kind !== 'user') return { skipped: 'not a user message' };
  const ans = await answer(db, m.body, m.team_id);
  const body = await write(
    'A GM just asked you something in the league chat. Answer them directly. Keep every fact, number and every "👉 #/..." link from draft_answer (the links become buttons), be sassy but genuinely useful, 1-4 sentences.',
    { question: m.body, draft_answer: ans.text, topic: ans.topic, ...ans.facts }, ans.text, 110);
  const { error } = await db.from('messages').insert({ channel: m.channel, kind: 'bot', body, reply_to: m.id, meta: { bot: 'garry', type: 'reply', topic: ans.topic } });
  if (error) throw error;
  return { replied: true, topic: ans.topic };
}


// ─────────────── draft recap ───────────────
async function draftRecap() {
  const { teams, byId } = await base();
  const { data: ds } = await db.from('draft_state').select('season,status').single();
  if (ds?.status !== 'done') return { skipped: 'draft not finished' };
  if (await alreadyPosted('draft', ds.season)) return { skipped: 'already posted' };
  const [{ data: picks }, { data: kept }] = await Promise.all([
    db.from('draft_picks').select('overall,round,team_id,player_id,auto').eq('season', ds.season).not('player_id', 'is', null).order('overall'),
    db.from('rosters').select('team_id,player_id').eq('acquired', 'keeper'),
  ]);
  const ids = [...new Set([...(picks ?? []).map((p) => p.player_id), ...(kept ?? []).map((k) => k.player_id)])];
  const pl = new Map<number, GP & { name: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from('players').select('id,name,pos,elig,proj').in('id', ids.slice(i, i + 300));
    for (const p of data ?? []) pl.set(p.id, { ...p, proj: Number(p.proj) });
  }
  // everyone not kept, ranked by projection, is where a player "should" have gone
  const keptIds = new Set((kept ?? []).map((k) => k.player_id));
  const { data: poolRows } = await db.from('players').select('id').order('proj', { ascending: false }).limit(400);
  const poolRank = new Map((poolRows ?? []).filter((r) => !keptIds.has(r.id)).map((r, i) => [r.id, i + 1]));
  const byTeam = new Map<number, (GP & { name: string })[]>(teams.map((t) => [t.id, []]));
  for (const k of kept ?? []) { const p = pl.get(k.player_id); if (p) byTeam.get(k.team_id)?.push(p); }
  for (const k of picks ?? []) { const p = pl.get(k.player_id); if (p) byTeam.get(k.team_id)?.push(p); }
  const grades = [...gradeTeams(byTeam).values()].sort((a, b) => a.rank - b.rank);
  const vals = (picks ?? []).map((k) => ({ gm: byId.get(k.team_id)?.gm_name, player: pl.get(k.player_id)?.name, overall: k.overall, auto: k.auto, value: k.overall - (poolRank.get(k.player_id) ?? k.overall) }));
  const steal = [...vals].sort((a, b) => b.value - a.value)[0];
  const reach = [...vals].filter((v) => v.overall <= 48).sort((a, b) => a.value - b.value)[0];
  const autos = teams.map((t) => ({ gm: t.gm_name, n: (picks ?? []).filter((k) => k.team_id === t.id && k.auto).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const facts = {
    season: ds.season,
    grades: grades.map((g) => ({ gm: byId.get(g.team)?.gm_name, team: byId.get(g.team)?.name, grade: g.grade, rank: g.rank, projected_starter_points: Math.round(g.starterPts) })),
    first_overall: vals[0], steal_of_the_draft: steal, biggest_reach: reach, most_autopicks: autos[0] ?? null,
  };
  const top = grades[0], low = grades[grades.length - 1];
  const g = (t: number) => byId.get(t)!;
  const fallback = [
    `🏁 Draft's done and Garry's got the red pen out. Report cards:`,
    ...grades.map((x) => `${x.grade.padEnd(2)} @${g(x.team).gm_name} (${g(x.team).name})`),
    steal ? `🥷 Steal of the draft: ${steal.player} at #${steal.overall} to @${steal.gm}.` : '',
    reach ? `🚨 Reach of the night: ${reach.player} at #${reach.overall}, @${reach.gm}. Bold.` : '',
    autos[0] ? `🤖 @${autos[0].gm} let the robot make ${autos[0].n} pick${autos[0].n > 1 ? 's' : ''}. Hope it was a good date.` : '',
    `@${g(top.team).gm_name} is the paper champ. @${g(low.team).gm_name}, the season is long, bud. Set those lineups, and someone put coins on it.`,
  ].filter(Boolean).join('\n');
  const body = await write('Write the post-draft report card for the league chat: give every GM their letter grade (use the grades given, in rank order, one short line each), crown the steal of the draft, roast the biggest reach, and hype the season opener.', facts, fallback, 260);
  await post(body, { type: 'draft', date: ds.season });
  return { posted: true, grades: facts.grades.length };
}

// ─────────────── weekly awards + power rankings ───────────────
// Monday-to-Sunday week that ended yesterday; power rank = 60% last-14-day pace, 40% season standing
async function weekly() {
  const { league, teams, byId, standings } = await base();
  if (league.phase !== 'season') return { skipped: league.phase };
  const end = etDate(new Date(Date.now() - 86400000));
  const start = etDate(new Date(Date.now() - 7 * 86400000));
  const start14 = etDate(new Date(Date.now() - 14 * 86400000));
  if (await alreadyPosted('weekly', end)) return { skipped: 'already posted' };
  const { data: daily } = await db.from('team_daily').select('team_id,date,points').gte('date', start14).lte('date', end);
  const week = (daily ?? []).filter((d) => d.date >= start);
  if (week.length === 0) return { skipped: 'no games last week' };
  const sum = (rows: { team_id: number; points: number }[]) => {
    const m = new Map<number, number>(teams.map((t) => [t.id, 0]));
    for (const r of rows) m.set(r.team_id, (m.get(r.team_id) ?? 0) + Number(r.points));
    return m;
  };
  const wk = sum(week), two = sum(daily ?? []);
  const table = teams.map((t) => ({ team_id: t.id, gm: t.gm_name, team: t.name, points: Math.round((wk.get(t.id) ?? 0) * 10) / 10 })).sort((a, b) => b.points - a.points);
  const best = table[0], worst = table[table.length - 1];

  // player of the week: most points while starting for someone
  const { data: snaps } = await db.from('lineup_snapshots').select('team_id,player_id,game_id,slot').gte('date', start).lte('date', end).not('slot', 'in', '("BN","IR")');
  const ids = [...new Set((snaps ?? []).map((s) => s.player_id))];
  const byPlayer = new Map<number, { pts: number; team: number }>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: pgs } = await db.from('player_games').select('player_id,game_id,fpts').gte('date', start).lte('date', end).in('player_id', ids.slice(i, i + 300));
    for (const g of pgs ?? []) {
      const s = (snaps ?? []).find((x) => x.player_id === g.player_id && x.game_id === g.game_id);
      if (!s) continue;
      const cur = byPlayer.get(g.player_id) ?? { pts: 0, team: s.team_id };
      byPlayer.set(g.player_id, { pts: cur.pts + Number(g.fpts), team: s.team_id });
    }
  }
  const topId = [...byPlayer.entries()].sort((a, b) => b[1].pts - a[1].pts)[0];
  let star: { player: string; gm: string | undefined; points: number } | null = null;
  if (topId) {
    const { data: p } = await db.from('players').select('name').eq('id', topId[0]).single();
    star = { player: p?.name ?? '?', gm: byId.get(topId[1].team)?.gm_name, points: Math.round(topId[1].pts * 10) / 10 };
  }

  // power rankings, with movement since last Monday's column
  const n = teams.length;
  const seasonRank = new Map(standings.map((s) => [s.team_id, Number(s.rank)]));
  const paceRank = new Map([...two.entries()].sort((a, b) => b[1] - a[1]).map(([id], i) => [id, i + 1]));
  const score = (id: number) => 0.6 * (paceRank.get(id) ?? n) + 0.4 * (seasonRank.get(id) ?? n);
  const { data: prevMsg } = await db.from('messages').select('meta').eq('kind', 'bot').contains('meta', { type: 'weekly' }).order('id', { ascending: false }).limit(1);
  const prev = new Map<number, number>(((prevMsg?.[0]?.meta as { rankings?: { team_id: number; rank: number }[] })?.rankings ?? []).map((r) => [r.team_id, r.rank]));
  const rankings = teams.map((t) => ({ team_id: t.id, s: score(t.id) })).sort((a, b) => a.s - b.s)
    .map((r, i) => ({ team_id: r.team_id, rank: i + 1, prev: prev.get(r.team_id) ?? null, gm: byId.get(r.team_id)?.gm_name, team: byId.get(r.team_id)?.name,
      last14: Math.round((two.get(r.team_id) ?? 0) * 10) / 10, season_rank: seasonRank.get(r.team_id) ?? null }));
  const arrow = (r: { rank: number; prev: number | null }) => r.prev == null ? 'new' : r.prev > r.rank ? `▲${r.prev - r.rank}` : r.prev < r.rank ? `▼${r.rank - r.prev}` : '–';

  await db.from('coin_ledger').insert({ team_id: best.team_id, amount: WEEKLY_BONUS, reason: `Garry's Team of the Week (${start} to ${end})` });
  await db.from('notifications').insert({ team_id: best.team_id, kind: 'weekly', body: `🏆 Team of the Week! ${f1(best.points)} points and ${WEEKLY_BONUS} ☘️ coins from Garry`, link: '/chat' });

  const facts = { week: { start, end }, week_table: table, team_of_the_week: { ...best, coins: WEEKLY_BONUS }, bust_of_the_week: worst, player_of_the_week: star,
    power_rankings: rankings.map((r) => ({ rank: r.rank, gm: r.gm, team: r.team, move: arrow(r), last_14_days: r.last14, season_rank: r.season_rank })) };
  const fallback = [
    `📰 Garry's Monday column, week of ${start}.`,
    `🏆 Team of the Week: @${best.gm} (${best.team}) with ${f1(best.points)}. That's ${WEEKLY_BONUS} ☘️ coins, don't spend them all on one bet.`,
    `🪣 Bust of the Week: @${worst.gm} with ${f1(worst.points)}. ${pick(['Was the lineup even set?', 'The bench outscored the starters, probably.', 'Tough week. Tougher chat.'])}`,
    star ? `⭐ Player of the Week: ${star.player} (${f1(star.points)}) for @${star.gm}.` : '',
    `Power rankings: ${rankings.map((r) => `${r.rank}. ${r.gm} (${arrow(r)})`).join(' · ')}.`,
    pick(['Trade deadline energy, please. Somebody make an offer.', 'Put some coins on next week\'s Team of the Week.', 'Set your lineups. Garry is watching.']),
  ].filter(Boolean).join('\n');
  const body = await write('Write your Monday column for the league chat: Team of the Week (and their coin bonus), Bust of the Week, Player of the Week, then the power rankings as a numbered list with the movement arrows given. One dry line per team.', facts, fallback, 260);
  await post(body, { type: 'weekly', date: end, rankings: rankings.map((r) => ({ team_id: r.team_id, rank: r.rank, prev: r.prev })), team_of_week: best.team_id });
  return { posted: 'weekly', team_of_week: best.gm, star };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const task = url.searchParams.get('task') ?? 'daily';
  try {
    let result: unknown;
    if (task === 'reply') {
      const { message_id } = await req.json();
      result = await reply(Number(message_id));
    } else if (task === 'nudge') result = await nudge();
    else if (task === 'draft') result = await draftRecap();
    else if (task === 'weekly') result = await weekly();
    else result = await daily();
    return Response.json({ task, ok: true, llm: apiKey ? GROK_MODEL : false, result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
