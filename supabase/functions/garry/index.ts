// Garry: the SaK League's resident chirper.
//   ?task=daily  (late morning ET) yesterday's recap + standings + daily coin bonus; keeper/draft hype off-season
//   ?task=nudge  (late afternoon ET) calls out GMs with sloppy lineups before puck drop
//   ?task=reply  (on "@Garry" in chat, via a database trigger) answers back
// Writes with Claude when the ANTHROPIC_API_KEY secret is set; otherwise uses built-in templates.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk';
import { etDate } from '../_shared/nhl.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
const claude = apiKey ? new Anthropic({ apiKey }) : null;

const DAILY_BONUS = 25;
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
  if (!claude) return fallback;
  try {
    const params = {
      model: 'claude-opus-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: PERSONA,
      messages: [{
        role: 'user',
        content: `${task}\nKeep it under ${maxWords} words.\n\nFacts (JSON):\n${JSON.stringify(facts)}`,
      }],
    };
    // deno-lint-ignore no-explicit-any
    const res: any = await claude.beta.messages.create(params as any);
    if (res.stop_reason === 'refusal') return fallback;
    const text = (res.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim();
    return text || fallback;
  } catch (e) {
    console.error('claude', e);
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
    db.from('teams').select('id,name,gm_name,auto_lineup,keepers_submitted').order('id'),
    db.from('standings').select('*'),
  ]);
  const byId = new Map((teams as Team[]).map((t) => [t.id, t]));
  return { league, teams: teams as Team[], byId, standings: (standings ?? []) as any[] };
}

// ─────────────── daily ───────────────
async function daily() {
  const { league, teams, byId, standings } = await base();
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

  const { data: daily } = await db.from('team_daily').select('*').eq('date', yesterday);
  if (!daily || daily.length === 0) return { skipped: 'no games yesterday' };
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
    peter_watch: season.at(-1), quiet_in_chat_this_week: lurkers,
  };
  const top = active[0];
  const fallback = [
    `🎙️ Garry's morning skate, ${yesterday}.`,
    `Yesterday: ${dayTable.map((d) => `${d.gm} ${f1(d.points)}`).join(' · ')}.`,
    `${dayTable[0].gm} takes the day ${pick(['and the bragging rights', 'like it was a beer-league final', 'with zero humility'])} and pockets ${DAILY_BONUS} ☘️ coins.`,
    top ? `Star of the night: ${top.player} with ${f1(top.fpts)} for @${top.gm}.` : '',
    benchRegret[0] ? `Meanwhile @${benchRegret[0].gm} left ${benchRegret[0].player} (${f1(benchRegret[0].fpts)} pts) on the bench. Set your lineup, buddy.` : '',
    `Peter watch: @${season.at(-1)?.gm} sitting in the basement at ${f1(season.at(-1)?.points ?? 0)}.`,
    lurkers.length ? `Haven't heard a peep this week from ${lurkers.map((n) => '@' + n).join(', ')}. Say something.` : '',
    pick(['Who wants to put 100 ☘️ on tonight?', 'Trade offers are free. Your dignity isn\'t.', 'Set your lineups before puck drop.']),
  ].filter(Boolean).join(' ');
  const body = await write("Write this morning's recap of yesterday's SaK results for the league chat.", facts, fallback, 220);
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
async function reply(messageId: number) {
  const { data: m } = await db.from('messages').select('*').eq('id', messageId).single();
  if (!m || m.kind !== 'user') return { skipped: 'not a user message' };
  const { league, byId, standings } = await base();
  const { data: recent } = await db.from('messages').select('team_id,kind,body').eq('channel', m.channel).lt('id', messageId).order('id', { ascending: false }).limit(12);
  const asker = byId.get(m.team_id);
  const facts = {
    asked_by: asker?.gm_name, asker_team: asker?.name, question: m.body, league_phase: league.phase,
    standings: [...standings].sort((a, b) => a.rank - b.rank).map((s) => ({ rank: s.rank, gm: byId.get(s.team_id)?.gm_name, points: Number(s.points) })),
    recent_chat: (recent ?? []).reverse().map((r) => `${r.kind === 'user' ? byId.get(r.team_id)?.gm_name : 'league'}: ${r.body.slice(0, 200)}`),
  };
  const fb = pick([
    `@${asker?.gm_name} I'd answer that but I'm busy watching your goalie let in another one.`,
    `@${asker?.gm_name} bold words from a guy whose bench outscored his starters last week.`,
    `@${asker?.gm_name} put some ☘️ coins on it and we'll talk.`,
    `@${asker?.gm_name} I've seen better takes at a Zamboni driver convention.`,
  ]);
  const body = await write('A GM just tagged you in the chat. Reply to them directly in 1-3 sentences.', facts, fb, 70);
  const { error } = await db.from('messages').insert({ channel: m.channel, kind: 'bot', body, reply_to: m.id, meta: { bot: 'garry', type: 'reply' } });
  if (error) throw error;
  return { replied: true };
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
    else result = await daily();
    return Response.json({ task, ok: true, llm: !!claude, result });
  } catch (e) {
    console.error(task, e);
    return Response.json({ task, ok: false, error: String((e as Error)?.message ?? e) }, { status: 500 });
  }
});
