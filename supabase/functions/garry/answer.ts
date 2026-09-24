// Garry's question answering. Works out what a GM is asking, pulls the real numbers, and answers with
// a bit of sass plus a pointer to where in the site to go ("👉 #/team"). The chat turns those into links.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { etDate } from '../_shared/nhl.ts';

type Db = SupabaseClient;
export interface Answer { text: string; topic: string; facts: Record<string, unknown> }

const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const f1 = (n: number) => (Math.round(Number(n) * 10) / 10).toFixed(1);
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-CA', { maximumFractionDigits: 2 });
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const OUT = /^(out|ir|injured reserve|injured|suspension|suspended|long[- ]term)/i;
// surnames that are also everyday words: only count them with the first name
const COMMON = new Set(['power', 'point', 'king', 'price', 'hart', 'stone', 'young', 'white', 'brown', 'green', 'black', 'knight', 'love',
  'lake', 'hill', 'wood', 'rice', 'hope', 'best', 'next', 'free', 'fast', 'mark', 'goal', 'trade', 'deal', 'ward', 'bear', 'marsh', 'bunting',
  'little', 'strong', 'miller', 'foote', 'rielly', 'pick', 'more', 'hunt', 'blue', 'long', 'short', 'glass', 'snow', 'frost', 'day', 'star']);

const OPEN = [
  'Oh, you want Garry’s help now?', 'Great question. Shocking, coming from you.', 'Pull up a stool, bud.',
  'Garry’s got you. This once.', 'Took you long enough to ask.', 'Easy one. Pay attention.', 'Buckle up, rookie.',
  'I charge 5 coins for this, but fine.', 'Ask and ye shall be chirped.',
];
const CLOSE = [
  'Now go do something about it.', 'You’re welcome, by the way.', 'Garry out. 🎤', 'Don’t make me repeat myself.',
  'That’s free advice, which is exactly what your last trade offer was worth.', 'Now stop bugging me and set your lineup.',
];

const HELP: Record<string, string> = {
  lineup: 'Lineup tab (bottom menu): tap a player, then tap the slot he should go to. Players lock when their game starts. Or open ⚙️ Lineup tools: “Optimize today” sets the best lineup in one tap, and Auto-pilot (Day / Week / Season) does it for you every morning. Pin anyone you always want in (📌) or never want in (🚫). 👉 #/team',
  trade: 'Tap any team name to open their page, switch to “Scout & trade”, tick the players or picks you want, then Build trade and add what you’re sending. Picks for this draft and next year’s are tradable. The commish approves accepted deals. 👉 #/trades',
  pickup: 'Players tab → “Available”, tap a player → ➕ Add (you’ll pick who to drop if you’re full). You get 10 free pickups a season, then it costs $30 a pop. 👉 #/players',
  keeper: 'More → Keepers: tick up to 6 from your 2025-26 roster and hit Save before the deadline. Your 2025-26 top scorer can’t be kept. Miss the deadline and the site keeps your top 6 by points for you. 👉 #/keepers',
  draft: 'The Draft tab is the draft room: star players to build your queue, flip on Autodraft if you’ll be away, and practise first in the mock draft. Turn on phone alerts so you get buzzed when you’re on the clock. 👉 #/draft',
  bet: 'Side Bets (More menu) → New bet: pick an opponent (or leave it open), terms, and St. Patrick coins and/or real money. Head-to-head bets track your fantasy points automatically. 👉 #/bets',
  alerts: 'My Profile → Alerts → Turn on alerts. On iPhone add SaK to your Home Screen first (Share → Add to Home Screen), open it from there, then turn alerts on. 👉 #/profile',
  player: 'Tap any player anywhere for his full page: stats, where his points come from, game log, career, news and upcoming games. 👉 #/players',
  features: 'More → League Features lists everything the site does. Comment on any of it, suggest new features, and upvote the ideas you want most; the commish marks them planned, building or shipped. 👉 #/features?t=ideas',
  chat: 'Trash Talk is the main room, each GM has a DM, and “Ask Garry” is your private line to me. Say my name anywhere and I’ll show up.',
};

async function base(db: Db) {
  const [{ data: league }, { data: teams }, { data: standings }, { data: playoffs }] = await Promise.all([
    db.from('league').select('*').single(),
    db.from('teams').select('id,name,gm_name,abbrev,auto_mode,keepers_submitted').order('id'),
    db.from('standings').select('*'),
    db.from('playoff_standings').select('*'),
  ]);
  return { league: league as any, teams: (teams ?? []) as any[], standings: (standings ?? []) as any[], playoffs: (playoffs ?? []) as any[] };
}

async function findPlayers(db: Db, q: string) {
  const all: { id: number; name: string; last_name: string | null; proj: number }[] = [];
  // page by id until empty: the API may cap each page below what we ask for
  for (let from = 0; from < 20000;) {
    const { data } = await db.from('players').select('id,name,last_name,proj').order('id').range(from, from + 999);
    if (!data?.length) break;
    all.push(...((data ?? []) as any[]));
    from += data.length;
  }
  const text = ' ' + norm(q).replace(/[^a-z' ]/g, ' ') + ' ';
  const full = all.filter((p) => p.name.length > 5 && text.includes(' ' + norm(p.name) + ' '));
  if (full.length) return full.slice(0, 2).map((p) => p.id);
  // by last name alone: when two players share it (Cale and Taylor Makar), the better one is who they mean
  const best = new Map<string, (typeof all)[number]>();
  for (const p of all) {
    if (!p.last_name || p.last_name.length < 4 || COMMON.has(norm(p.last_name)) || !text.includes(' ' + norm(p.last_name) + ' ')) continue;
    const k = norm(p.last_name);
    if (!best.has(k) || Number(p.proj) > Number(best.get(k)!.proj)) best.set(k, p);
  }
  return [...best.values()].slice(0, 2).map((p) => p.id);
}

export async function answer(db: Db, question: string, askerTeam: number): Promise<Answer> {
  const q = norm(question.replace(/@?garry[,:!]?/ig, ' ')).trim();
  const { league, teams, standings, playoffs } = await base(db);
  const byId = new Map(teams.map((t) => [t.id, t]));
  const me = byId.get(askerTeam);
  const gm = me ? '@' + me.gm_name : 'bud';
  const today = etDate(new Date());
  const has = (re: RegExp) => re.test(q);
  // "how do I…" wants instructions; "how's my lineup" / "how is Makar" wants the facts
  const howTo = has(/\b(how (do|can|does|to|should|would)|where|help|can i|what do i|explain|show me)\b/);
  const reply = (topic: string, body: string, facts: Record<string, unknown> = {}) =>
    ({ topic, facts, text: `${gm} ${topic === 'hello' ? '' : pick(OPEN)} ${body} ${topic === 'hello' ? '' : pick(CLOSE)}`.replace(/\s+/g, ' ').trim() });
  const inPlayoffs = playoffs.some((t) => Number(t.points) !== 0);
  const table = [...(inPlayoffs ? playoffs : standings)].sort((a, b) => a.rank - b.rank);
  const scored = table.some((t) => Number(t.points) !== 0);

  // ── greetings and thanks
  if (!q || /^(hi|hey|yo|sup|hello|thanks|thank you|ty|cheers)\b[\s!.?]*$/.test(q)) {
    return reply('hello', (/thank|ty|cheers/.test(q) ? 'Anytime. Garry’s always here, unlike your goalie. ' : 'You rang? ') + 'Ask me anything: standings, your lineup, a player, tonight’s games, trades, pickups, the draft, bets, rules or the prize money.');
  }

  // ── a specific player
  const pids = has(/\b(my team|my lineup|my roster|standings|trade|draft|rules)\b/) ? [] : await findPlayers(db, question);
  if (pids.length) {
    const [{ data: ps }, { data: own }, { data: season }, { data: games }] = await Promise.all([
      db.from('players').select('id,name,pos,nhl_team,proj,last_fp,rank,injury_status,injury_note').in('id', pids),
      db.from('rosters').select('player_id,team_id,slot').in('player_id', pids),
      db.from('player_season').select('player_id,gp,fpts,fpts14,gp14').in('player_id', pids),
      db.from('games').select('date,home,away,start_utc').gte('date', today).order('start_utc').limit(200),
    ]);
    const lines = (ps ?? []).map((p: any) => {
      const o = (own ?? []).find((r: any) => r.player_id === p.id);
      const s = (season ?? []).find((r: any) => r.player_id === p.id);
      const next = (games ?? []).find((g: any) => g.home === p.nhl_team || g.away === p.nhl_team);
      const owner = o ? (o.team_id === askerTeam ? `yours (${o.slot})` : `owned by ${byId.get(o.team_id)?.name} (${byId.get(o.team_id)?.gm_name})`) : 'a free agent, so go grab him';
      const form = s && s.gp ? ` ${f1(s.fpts)} SaK pts in ${s.gp} games this season${s.gp14 ? `, ${f1(s.fpts14)} over his last ${s.gp14}` : ''}.` : ` ${f1(p.last_fp)} SaK pts last season, projected ${Math.round(p.proj)} (#${p.rank ?? '–'} overall).`;
      const note = p.injury_note ? (p.injury_note.length > 110 ? p.injury_note.slice(0, 110).replace(/\s+\S*$/, '') + '…' : p.injury_note) : '';
      const inj = p.injury_status ? ` Heads up: listed ${p.injury_status}${note ? ` (${note})` : ''}.` : '';
      const nxt = next ? ` Next up: ${next.home === p.nhl_team ? 'vs ' + next.away : '@ ' + next.home} on ${next.date}.` : '';
      return `${p.name} (${p.pos}, ${p.nhl_team ?? 'no NHL team'}) is ${owner}.${form}${inj}${nxt} 👉 #/player/${p.id}`;
    });
    return reply('player', lines.join(' '), { players: lines });
  }

  // ── how-to help
  const topics: [RegExp, string][] = [
    [/\b(lineups?|line ups?|start(ing|ers?)?|sit|bench(ed)?|slots?|auto.?set|auto.?pilot|optimi[sz]e|pins?)\b/, 'lineup'],
    [/\b(trades?|trading|deals?|offers?|swaps?)\b/, 'trade'],
    [/\b(pick ?ups?|add|adds|drop|drops|waivers?|free agents?|fa)\b/, 'pickup'],
    [/\b(keepers?|keep|keeping)\b/, 'keeper'],
    [/\b(drafts?|mock|queue|autodraft|on the clock)\b/, 'draft'],
    [/\b(bets?|betting|wagers?|coins?|st\.? patrick)\b/, 'bet'],
    [/\b(alerts?|notifications?|notify|push|buzz)\b/, 'alerts'],
    [/\b(features?|suggest\w*|ideas?|wish ?list|request)\b/, 'features'],
  ];
  const topic = topics.find(([re]) => re.test(q))?.[1];

  // ── standings
  if (has(/\b(standing|standings|leader|leading|winning|first place|last place|in first|in last|peter|rank|table|who.?s up|points race|where am i)\b/)) {
    if (!scored) {
      const last = [...table].pop();
      return reply('standings', `Nobody’s scored yet: the season starts ${league.season_start ?? 'soon'}. Everyone’s tied at zero, which is the best some of you will ever look. Last year Hatrick Swayze (Darin) won it and Eagle Palace (Trystan) took the Peter. 👉 #/standings`, { last });
    }
    const mine = table.find((t) => t.team_id === askerTeam);
    const lead = table[0], last = table[table.length - 1];
    const top3 = table.slice(0, 3).map((t) => `${t.rank}. ${byId.get(t.team_id)?.gm_name} ${f1(t.points)}`).join(', ');
    const you = mine ? ` You’re ${mine.rank}${['st', 'nd', 'rd'][mine.rank - 1] ?? 'th'} with ${f1(mine.points)}${mine.team_id !== lead.team_id ? `, ${f1(lead.points - mine.points)} back of ${byId.get(lead.team_id)?.gm_name}` : ', leading the pack'}.` : '';
    return reply('standings', `${inPlayoffs ? 'Playoff race' : 'Standings'}: ${top3}.${you}${!inPlayoffs ? ` Peter watch: ${byId.get(last.team_id)?.gm_name} at ${f1(last.points)}.` : ''} 👉 #/standings`, { top3, mine });
  }

  // ── coins
  if (topic === 'bet' && !howTo || has(/\b(balance|how many coins|my coins)\b/)) {
    const { data: bal } = await db.from('coin_balances').select('*').eq('team_id', askerTeam).maybeSingle();
    return reply('bet', `You’ve got ${bal ? Number(bal.balance) - Number(bal.escrow) : 0} St. Patrick coins free to bet${bal?.escrow ? ` (${bal.escrow} tied up in live bets)` : ''}. ${HELP.bet}`);
  }

  // ── how-to questions get instructions
  if (howTo && topic) return reply(topic, HELP[topic]);

  // ── injuries on the asker's roster
  if (has(/\b(injur\w*|hurt|suspend\w*)\b/)) {
    const { data: rows } = await db.from('rosters').select('player_id,slot').eq('team_id', askerTeam);
    const { data: ps } = await db.from('players').select('id,name,injury_status').in('id', (rows ?? []).map((r: any) => r.player_id)).not('injury_status', 'is', null);
    if (!ps?.length) return reply('injuries', 'Your whole roster is healthy. Enjoy it, it never lasts. 👉 #/news');
    return reply('injuries', `On your roster: ${ps.map((p: any) => `${p.name} (${p.injury_status})`).join(', ')}. Stash the long-term guys on IR and pick up a body. 👉 #/news`);
  }

  // ── scoring
  if (has(/\b(scoring|counts?|points (for|per)|worth|power ?play|shots?|hits?|blocks?|plus.?minus|pim|faceoffs?|shutouts?|saves?)\b/) && !has(/\bmy\b/)) {
    const sk = league.scoring?.skater ?? {}, go = league.scoring?.goalie ?? {};
    const fmt = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k.toUpperCase()} ${v > 0 ? '+' : ''}${v}`).join(', ');
    return reply('scoring', `Skaters: ${fmt(sk)}. Goalies: ${fmt(go)}. Anything not listed is worth zero. Tap any player to see exactly where his points come from. 👉 #/league?t=rules`);
  }

  // ── the asker's own lineup
  if (has(/\b(my (team|lineup|line up|roster|guys|players)|who should i (start|sit|play)|am i set|set my|tonight for me|my starters)\b/) || (topic === 'lineup' && !howTo)) {
    const [{ data: rows }, { data: games }] = await Promise.all([
      db.from('rosters').select('player_id,slot,pin').eq('team_id', askerTeam),
      db.from('games').select('home,away,start_utc,state').eq('date', today),
    ]);
    const ids = (rows ?? []).map((r: any) => r.player_id);
    const { data: ps } = await db.from('players').select('id,name,nhl_team,injury_status,proj').in('id', ids);
    const pl = new Map((ps ?? []).map((p: any) => [p.id, p]));
    const playing = new Set((games ?? []).filter((g: any) => !['PPD', 'CNCL'].includes(g.state)).flatMap((g: any) => [g.home, g.away]));
    const starters = (rows ?? []).filter((r: any) => !['BN', 'IR'].includes(r.slot));
    const idle = starters.filter((r: any) => !playing.has(pl.get(r.player_id)?.nhl_team));
    const benchPlaying = (rows ?? []).filter((r: any) => r.slot === 'BN' && playing.has(pl.get(r.player_id)?.nhl_team)).sort((a: any, b: any) => pl.get(b.player_id).proj - pl.get(a.player_id).proj);
    const hurt = starters.filter((r: any) => OUT.test(pl.get(r.player_id)?.injury_status ?? ''));
    const cap = league.roster as Record<string, number>;
    const empty = ['C', 'LW', 'RW', 'D', 'Util', 'G'].reduce((n, s) => n + Math.max(0, (cap[s] ?? 0) - starters.filter((r: any) => r.slot === s).length), 0);
    const issues: string[] = [];
    if (empty) issues.push(`${empty} empty starting slot${empty > 1 ? 's' : ''}`);
    if (hurt.length) issues.push(`you’re starting injured ${hurt.map((r: any) => pl.get(r.player_id).name).join(', ')}`);
    if (idle.length && benchPlaying.length) issues.push(`${idle.length} starter${idle.length > 1 ? 's have' : ' has'} no game today while ${benchPlaying.slice(0, 3).map((r: any) => pl.get(r.player_id).name).join(', ')} sit${benchPlaying.length > 1 ? '' : 's'} on your bench`);
    const pilot = me?.auto_mode && me.auto_mode !== 'off' ? ` Auto-pilot is on (${me.auto_mode} mode), so I set it every morning, but I won’t touch it after you move someone yourself.` : ' Pro tip: turn on Auto-pilot in ⚙️ Lineup tools and let the robot do your job.';
    const body = league.phase !== 'season'
      ? `No lineups to set until the season starts. For now, worry about your keepers and your draft queue.`
      : issues.length
        ? `Your lineup’s a mess: ${issues.join('; ')}. Hit ⚙️ Lineup tools → “Optimize today” and I’ll sort it in one tap.${pilot}`
        : `Your lineup looks clean: ${starters.length - idle.length} starters play today and nobody useful is rotting on the bench.${pilot}`;
    return reply('my-lineup', body + ' 👉 #/team', { issues });
  }

  // ── tonight's games
  if (has(/\b(tonight|today|games|schedule|who plays|playing)\b/)) {
    const { data: games } = await db.from('games').select('home,away,start_utc,state').eq('date', today).order('start_utc');
    const { data: rows } = await db.from('rosters').select('player_id,slot').eq('team_id', askerTeam);
    const { data: ps } = await db.from('players').select('id,name,nhl_team').in('id', (rows ?? []).map((r: any) => r.player_id));
    const playing = new Set((games ?? []).flatMap((g: any) => [g.home, g.away]));
    const mine = (ps ?? []).filter((p: any) => playing.has(p.nhl_team)).map((p: any) => p.name);
    if (!games?.length) return reply('tonight', 'No NHL games today. Go outside, touch some grass, maybe propose a trade.');
    return reply('tonight', `${games.length} game${games.length > 1 ? 's' : ''} today: ${games.slice(0, 6).map((g: any) => `${g.away} @ ${g.home}`).join(', ')}${games.length > 6 ? '…' : ''}. ${mine.length ? `You’ve got ${mine.length} guys playing: ${mine.slice(0, 6).join(', ')}.` : 'None of your guys play. Brutal.'} 👉 #/team`, { games: games.length, mine });
  }

  // ── free agents
  if (topic === 'pickup' && !howTo || has(/\b(best (available|free agents?)|who should i (add|pick up|grab))\b/)) {
    const { data: owned } = await db.from('rosters').select('player_id');
    const taken = new Set((owned ?? []).map((r: any) => r.player_id));
    const { data: ps } = await db.from('players').select('id,name,pos,nhl_team,proj,injury_status').order('proj', { ascending: false }).limit(150);
    const fa = (ps ?? []).filter((p: any) => !taken.has(p.id) && !OUT.test(p.injury_status ?? '')).slice(0, 4);
    return reply('pickup', `Best healthy free agents by projection: ${fa.map((p: any) => `${p.name} (${p.pos}, ${Math.round(p.proj)})`).join(', ')}. ${HELP.pickup}`, { fa });
  }

  // ── the draft
  if (topic === 'draft' && !howTo || has(/\b(when is the draft|draft (time|order|night)|my (next )?pick)\b/)) {
    const { data: ds } = await db.from('draft_state').select('*').single();
    const { data: next } = await db.from('draft_picks').select('overall,round').eq('season', ds?.season).eq('team_id', askerTeam).is('player_id', null).not('overall', 'is', null).order('overall').limit(1);
    const when = league.draft_at ? new Date(league.draft_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'TBD';
    const status = ds?.status === 'live' ? `It’s live right now, pick #${ds.current_overall} is on the clock${next?.[0] ? `, and you’re up at #${next[0].overall}` : ''}.`
      : ds?.status === 'done' ? 'It’s done. Go look at your report card and weep.'
      : `Draft night is ${when}: ${league.draft_rounds} rounds, ${league.pick_seconds}s a pick, snake order.${ds?.order_set && next?.[0] ? ` Your first pick is #${next[0].overall}.` : ' The order isn’t set yet.'}`;
    return reply('draft', `${status} ${HELP.draft}`, { status });
  }

  // ── keepers
  if (topic === 'keeper' && !howTo) {
    const when = league.keeper_deadline ? new Date(league.keeper_deadline).toLocaleString('en-CA', { timeZone: 'America/Toronto', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : 'TBD';
    const waiting = teams.filter((t) => !t.keepers_submitted).map((t) => t.gm_name);
    return reply('keeper', `Keeper deadline: ${when}. ${me?.keepers_submitted ? 'You’re locked in.' : 'You haven’t saved yours yet. Tick tock.'} Still waiting on: ${waiting.join(', ') || 'nobody, miraculously'}. ${HELP.keeper}`);
  }


  // ── money
  if (has(/\b(money|prize|pot|payout|paid|pay|fund|entry|fee|how much)\b/)) {
    const n = teams.length, entry = Number(league.entry_fee), fund = Number(league.sak_fee), share = Number(league.playoff_share ?? 40) / 100;
    const pool = (entry - fund) * n, split = (league.prize_split ?? [60, 30, 10]).map(Number);
    const pots = (amt: number) => split.map((p: number, i: number) => `${['1st', '2nd', '3rd'][i]} ${money(amt * p / 100)}`).join(', ');
    return reply('money', `${n} GMs × ${money(entry)}, with ${money(fund)} each to the SaK Fund, makes a ${money(pool)} pool. Regular season (${Math.round((1 - share) * 100)}%, ${money(pool * (1 - share))}): ${pots(pool * (1 - share))}. Playoffs (${Math.round(share * 100)}%, ${money(pool * share)}): ${pots(pool * share)}. Last place pays the Peter. 👉 #/league?t=money`);
  }

  // ── rules and deadlines
  if (has(/\b(rule|rules|deadline|limit|how many (pickups|keepers)|allowed)\b/)) {
    const td = league.trade_deadline ? new Date(league.trade_deadline).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'long', day: 'numeric' }) : 'TBD';
    return reply('rules', `Keep ${league.keepers} (not your top scorer), ${league.max_acquisitions} free pickups then $${league.extra_acq_fee} each, trade deadline ${td}, lineups lock at each player’s puck drop, and the regular-season and playoff pots are separate races. Full rulebook: 👉 #/league?t=rules`);
  }

  if (topic) return reply(topic, HELP[topic]);
  if (has(/\b(chat|dm|message|ask garry)\b/)) return reply('chat', HELP.chat);

  return reply('unknown', `No idea what you’re on about, but here’s what I know: standings, your lineup, any player by name, tonight’s games, injuries, free agents, trades, keepers, the draft, bets and coins, scoring, rules and prize money. Try “Garry, who should I pick up?” or “Garry, how’s Makar doing?”`);
}
