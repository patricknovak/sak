// What tonight really looks like for every team in a league, worked out the way the site's Best lineup and the
// auto-pilot work it out (the shared optimizer, _shared/lineup.ts): who can play, which swaps a GM could make that
// gain points, and what can't be fixed. Garry's lineup advice comes from here and nowhere else, so he never tells a GM
// to bench a player nobody can replace, or to sit a day-to-day player who's playing, or to start someone who can't
// fill the slot (a defenceman for a centre). Pure reads; nothing here changes a lineup.
import { optimize, weekEndOf, worth, gameToday, isOut, slotOk, STARTING, type Basis, type LPlayer, type LSeason, type LRow, type LContext } from '../_shared/lineup.ts';
import { STATUS_LABEL, type GameStatus } from '../_shared/gameday.ts';

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export interface Swap { start: string; start_pos: string; start_game: string; sit: string | null; sit_why: string | null; gain: number; shuffle?: string[] }
export interface TeamNight {
  team_id: number;
  slots: number;            // starting slots
  can_fill: number;         // starting slots the roster can fill with someone who plays tonight (best lineup)
  set_now: number;          // starters in the current lineup who play tonight
  value_now: number;        // expected points of the current lineup tonight
  value_best: number;       // expected points of the best lineup tonight
  swaps: Swap[];            // the moves that make up the difference, each worth doing
  gain: number;             // what those swaps add tonight, in expected points
  idle_no_fix: string[];    // starters who won't play tonight and nobody on the bench can replace (not advice: a fact)
  autopilot: boolean;       // the auto-pilot will set this lineup before the games (on, and not hand-set today)
  moves: { name: string; from: string; to: string }[];   // every slot change in the best lineup
}
export interface Night { date: string; games: number; teams: Map<number, TeamNight>; matchups: string[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

// why a starter is worth less than his replacement tonight, in plain words
function whyNot(p: LPlayer, ctx: LContext): string {
  if (!gameToday(p.nhl_team, ctx)) return 'no game tonight';
  if (p.gs === 'scratched') return 'scratched';
  if (p.gs === 'backup') return 'backup goalie tonight';
  if (p.gs === 'out' || isOut(p.injury_status)) return `out (${p.injury_status ?? 'injured'})`;
  if (p.injury_status) return `${p.injury_status}, may not play`;
  return 'projects lower tonight';
}
function gameWords(p: LPlayer, ctx: LContext): string {
  const g = gameToday(p.nhl_team, ctx);
  if (!g) return 'no game';
  const opp = g.home === p.nhl_team ? `vs ${g.away}` : `at ${g.home}`;
  return p.gs && p.gs !== 'gtd' ? `${opp}, ${STATUS_LABEL[p.gs as GameStatus].toLowerCase()}` : opp;
}

// ldb: the service key working for this league (x-league), which sees past row-level security, so the league's own
// tables are filtered by its id here
export async function night(ldb: Db, lid: number, today: string, opts: { minGain?: number } = {}): Promise<Night> {
  const minGain = opts.minGain ?? 0.5;
  const [{ data: league }, { data: teams }] = await Promise.all([
    ldb.from('league').select('roster').single(),
    ldb.from('teams').select('id,auto_mode,auto_basis,lineup_touched').eq('league_id', lid).eq('role', 'gm'),
  ]);
  const caps = (league?.roster ?? {}) as Record<string, number>;
  const tlist = (teams ?? []) as { id: number; auto_mode: string | null; auto_basis: Basis | null; lineup_touched: string | null }[];
  const weekEnd = weekEndOf(today);
  const [{ data: rows }, { data: games }] = await Promise.all([
    ldb.from('rosters').select('team_id,player_id,slot,pin').in('team_id', tlist.map((t) => t.id)),
    ldb.from('games').select('home,away,date,start_utc,state').gte('date', today).lte('date', weekEnd),
  ]);
  const roster = (rows ?? []) as (LRow & { team_id: number })[];
  const ids = [...new Set(roster.map((r) => r.player_id))];
  const players = new Map<number, LPlayer & { name: string }>(), season = new Map<number, LSeason>();
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const [{ data: ps }, { data: ss }] = await Promise.all([
      ldb.from('league_players').select('id,name,pos,elig,proj,proj_gp,nhl_team,injury_status').in('id', chunk),
      ldb.from('player_season').select('player_id,gp,fpts,gp14,fpts14').in('player_id', chunk),
    ]);
    for (const p of ps ?? []) players.set(p.id, { ...p, elig: p.elig ?? [], proj: Number(p.proj ?? 0), proj_gp: p.proj_gp == null ? null : Number(p.proj_gp) });
    for (const x of ss ?? []) season.set(x.player_id, { gp: Number(x.gp), fpts: Number(x.fpts), gp14: Number(x.gp14 ?? 0), fpts14: x.fpts14 == null ? null : Number(x.fpts14) });
  }
  // every goalie, so a hurt starter's starts go to his healthy partner (as the auto-pilot does)
  const { data: gs } = await ldb.from('league_players').select('id,name,pos,elig,proj,proj_gp,nhl_team,injury_status').eq('pos', 'G');
  for (const g of gs ?? []) if (!players.has(g.id)) players.set(g.id, { ...g, elig: g.elig ?? [], proj: Number(g.proj ?? 0), proj_gp: g.proj_gp == null ? null : Number(g.proj_gp) });
  const { data: status } = await ldb.from('player_status').select('player_id,status').eq('date', today);
  for (const s of status ?? []) { const p = players.get(s.player_id); if (p) p.gs = s.status as GameStatus; }

  const gl = (games ?? []) as LContext['games'];
  const ctx: LContext = { today, weekEnd, now: Date.now(), games: gl, season, caps };
  const tonight = gl.filter((g) => g.date === today && g.state !== 'PPD' && g.state !== 'CNCL');
  const out = new Map<number, TeamNight>();
  const nm = (id: number) => players.get(id)?.name ?? 'someone';
  for (const t of tlist) {
    const mine = roster.filter((r) => r.team_id === t.id);
    if (!mine.length) continue;
    const basis: Basis = t.auto_basis ?? 'ros';
    const plan = optimize(mine, players, 'day', basis, ctx);
    const w = (id: number) => worth(players.get(id)!, 'day', basis, ctx);
    const slotNow = new Map(mine.map((r) => [r.player_id, r.slot]));
    const starting = (s: string | undefined) => !!s && STARTING.includes(s);
    // the ins and outs of the best lineup, each player coming in paired with one he can take the place of directly (a
    // defenceman never "for" a centre), the biggest gain first; whoever's left was made room for by moving starters
    // around (the shuffle names those moves). A swap stays only if it's worth it: a starter who can't play tonight
    // (no game, out, a backup goalie, scratched) from half a point, a guess between two players who both play from a
    // full point, since one night's projection is only a guess.
    const ins = plan.moves.filter((m) => !starting(m.from) && starting(m.to)).map((m) => m.player_id).sort((a, b) => w(b) - w(a));
    const outs = plan.moves.filter((m) => starting(m.from) && !starting(m.to)).map((m) => ({ id: m.player_id, slot: m.from }));
    const shuffles = plan.moves.filter((m) => starting(m.from) && starting(m.to)).map((m) => `${nm(m.player_id)} ${m.from} to ${m.to}`);
    const used = new Set<number>(), pairs: { i: number; o: number | null; chain: boolean }[] = [];
    for (const i of ins) {
      const o = outs.filter((x) => !used.has(x.id) && slotOk(players.get(i)!, x.slot)).sort((a, b) => w(a.id) - w(b.id))[0];
      if (o) { used.add(o.id); pairs.push({ i, o: o.id, chain: false }); }
    }
    const left = outs.filter((x) => !used.has(x.id)).sort((a, b) => w(a.id) - w(b.id));
    for (const i of ins.filter((i) => !pairs.some((p) => p.i === i))) { const o = left.shift(); pairs.push({ i, o: o?.id ?? null, chain: true }); }
    const hard = (o: number | null) => o == null || w(o) === 0 || players.get(o)!.gs === 'backup';
    const swaps: Swap[] = pairs.map(({ i, o, chain }) => {
      const p = players.get(i)!;
      return { start: nm(i), start_pos: p.pos, start_game: gameWords(p, ctx), sit: o != null ? nm(o) : null,
        sit_why: o != null ? whyNot(players.get(o)!, ctx) : 'fills an empty slot', gain: r2(w(i) - (o != null ? w(o) : 0)),
        ...(chain && shuffles.length ? { shuffle: shuffles } : {}), hard: hard(o) };
    }).filter((x) => x.gain >= (x.hard ? minGain : 1)).sort((a, b) => b.gain - a.gain).map(({ hard: _h, ...x }) => x);
    const plays = (id: number) => w(id) > 0;
    const bestStarters = [...plan.slots].filter(([, s]) => starting(s)).map(([id]) => id);
    const nowStarters = mine.filter((r) => starting(r.slot)).map((r) => r.player_id);
    out.set(t.id, {
      team_id: t.id,
      slots: STARTING.reduce((n, s) => n + (caps[s] ?? 0), 0),
      can_fill: bestStarters.filter(plays).length,
      set_now: nowStarters.filter(plays).length,
      value_now: r2(plan.before), value_best: r2(plan.value), swaps, gain: r2(swaps.reduce((t, x) => t + x.gain, 0)),
      idle_no_fix: bestStarters.filter((id) => !plays(id) && starting(slotNow.get(id))).map((id) => `${nm(id)} (${whyNot(players.get(id)!, ctx)})`),
      autopilot: !!t.auto_mode && t.auto_mode !== 'off' && t.lineup_touched !== today,
      moves: plan.moves.map((m) => ({ name: nm(m.player_id), from: m.from, to: m.to })),
    });
  }
  return { date: today, games: tonight.length, teams: out, matchups: tonight.map((g) => `${g.away} at ${g.home}`) };
}
