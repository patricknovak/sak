// The draft analysis: every pick against where it was taken, every roster (keepers + picks) played out over the
// real schedule, finish odds, position and category ranks, and what each GM should do next. Pure; the page and
// the offline report both call analyzeDraft().
import { finishOdds, forecastTeam, rankIn, type FGame, type FPlayer, type Odds, type TeamForecast } from './forecast';

export interface APick { overall: number; round: number; team: number; player: number }
export interface ATeam { id: number; name: string; gm: string }
export interface PickEval { overall: number; round: number; team: number; player: number; proj: number; slotValue: number; over: number; boardRank: number; stash: boolean }
export interface TeamAnalysis {
  team: number;
  draftGrade: string; draftScore: number;   // value added over slot, all picks
  rosterGrade: string;                      // the full roster's forecast against the league
  fc: TeamForecast; odds: Odds;
  picks: PickEval[]; best: PickEval | null; worst: PickEval | null; stashes: PickEval[];
  keeperPts: number; draftPts: number;      // expected starter points from keepers vs this draft's picks
  posRank: Record<string, number>;          // 1 = best in the league
  catRank: Record<string, number>;
  counts: Record<string, number>;           // players by position
  goalieStarts: number;
  avgAge: number | null;
  risks: string[]; strengths: string[]; weaknesses: string[]; moves: string[];
  surplus: string[]; needs: string[];
}
export interface DraftAnalysis { teams: TeamAnalysis[]; steals: PickEval[]; reaches: PickEval[]; stashes: PickEval[]; runs: { pos: string; from: number; to: number; n: number }[]; asOf: string; avgWaste: number; avgEmpty: number }

const DEPTH: Record<string, number> = { C: 4, LW: 4, RW: 4, D: 6, G: 3 };
const POS = ['C', 'LW', 'RW', 'D', 'G'];
const CATS_SK = ['g', 'a', 'ppp', 'sog', 'hit', 'blk', 'pm'];
const CATS_G = ['w', 'sv', 'sho'];
const letter = (z: number) => (z >= 1.4 ? 'A+' : z >= 0.9 ? 'A' : z >= 0.5 ? 'A-' : z >= 0.2 ? 'B+' : z >= -0.1 ? 'B' : z >= -0.4 ? 'B-' : z >= -0.7 ? 'C+' : z >= -1 ? 'C' : z >= -1.4 ? 'C-' : 'D');
const zOf = (vals: number[], v: number) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
  return (v - m) / sd;
};
const NAMES: Record<string, string> = { C: 'centres', LW: 'left wings', RW: 'right wings', D: 'defence', G: 'goaltending', g: 'goals', a: 'assists', ppp: 'power-play points', sog: 'shots', hit: 'hits', blk: 'blocks', pm: 'plus/minus', w: 'goalie wins', sv: 'saves', sho: 'shutouts' };

export function analyzeDraft(opts: {
  teams: ATeam[]; players: Map<number, FPlayer & { name: string; age?: number | null }>;
  rosters: { team_id: number; player_id: number; acquired: string }[]; picks: APick[];
  games: FGame[]; caps: Record<string, number>; from: string; current?: Map<number, number>;
}): DraftAnalysis {
  const { teams, players, rosters, picks, games, caps, from } = opts;
  const P = (id: number) => players.get(id);
  // the board as it stood when the draft opened: everyone except the keepers, best projection first
  const kept = new Set(rosters.filter((r) => r.acquired === 'keeper').map((r) => r.player_id));
  const board = [...players.values()].filter((p) => !kept.has(p.id)).sort((a, b) => b.proj - a.proj);
  const boardRank = new Map(board.map((p, i) => [p.id, i + 1]));
  const evals: PickEval[] = picks.filter((k) => P(k.player)).map((k) => {
    const proj = P(k.player)!.proj;
    const slotValue = board[k.overall - 1]?.proj ?? 0;
    // a prospect with no NHL track record is a keeper stash for later years, not a pick for this season
    const stash = proj < 15 && (boardRank.get(k.player) ?? 999) > 300;
    return { ...k, proj, slotValue, over: proj - slotValue, boardRank: boardRank.get(k.player) ?? 999, stash };
  });

  // play out every roster
  const rosterOf = (t: number) => rosters.filter((r) => r.team_id === t).map((r) => P(r.player_id)).filter((p): p is NonNullable<typeof p> => !!p);
  const fcs = teams.map((t) => forecastTeam(t.id, rosterOf(t.id), games, caps, from, opts.current?.get(t.id) ?? 0));
  const odds = finishOdds(fcs, players as Map<number, FPlayer>);
  const totals = fcs.map((f) => f.total);
  // value over slot for this season (stashed prospects are judged later, not here)
  const draftScores = teams.map((t) => evals.filter((e) => e.team === t.id && !e.stash).reduce((s, e) => s + e.over, 0));
  const avgWaste = fcs.reduce((s, f) => s + f.benchWaste, 0) / fcs.length;
  const avgEmpty = fcs.reduce((s, f) => s + f.emptySlots, 0) / fcs.length;

  const out: TeamAnalysis[] = teams.map((t, i) => {
    const fc = fcs[i], od = odds[i];
    const mine = evals.filter((e) => e.team === t.id).sort((a, b) => a.overall - b.overall);
    const best = [...mine].filter((e) => !e.stash).sort((a, b) => b.over - a.over)[0] ?? null;
    const worst = [...mine].filter((e) => e.round <= 8 && !e.stash).sort((a, b) => a.over - b.over)[0] ?? null;
    const draftedIds = new Set(mine.map((e) => e.player));
    let keeperPts = 0, draftPts = 0;
    for (const c of fc.players.values()) (draftedIds.has(c.id) ? (draftPts += c.pts) : (keeperPts += c.pts));
    const posRank: Record<string, number> = {};
    for (const p of POS) posRank[p] = rankIn(fcs.map((f) => f.byPos[p] ?? 0), fc.byPos[p] ?? 0);
    const catRank: Record<string, number> = {};
    for (const c of [...CATS_SK, ...CATS_G]) catRank[c] = rankIn(fcs.map((f) => f.cats[c] ?? 0), fc.cats[c] ?? 0);
    const roster = rosterOf(t.id);
    const counts: Record<string, number> = {};
    for (const p of POS) counts[p] = roster.filter((x) => x.pos === p).length;
    const goalies = roster.filter((p) => p.pos === 'G').sort((a, b) => (b.proj_gp ?? 0) - (a.proj_gp ?? 0));
    const goalieStarts = goalies.slice(0, 3).reduce((s, g) => s + (g.proj_gp ?? 0), 0);
    const ages = roster.map((p) => p.age).filter((a): a is number => a != null);
    const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;

    const n = teams.length;
    const strengths: string[] = [], weaknesses: string[] = [], risks: string[] = [], moves: string[] = [];
    for (const p of POS) {
      if (posRank[p] <= 2) strengths.push(`${posRank[p] === 1 ? 'Best' : '2nd-best'} ${NAMES[p]} in the league`);
      if (posRank[p] >= n - 1) weaknesses.push(`${posRank[p] === n ? 'Weakest' : '2nd-weakest'} ${NAMES[p]} in the league`);
    }
    const catTop = [...CATS_SK, ...CATS_G].filter((c) => catRank[c] === 1).map((c) => NAMES[c]);
    if (catTop.length) strengths.push(`Leads the league in ${catTop.join(', ')}`);
    const catBottom = [...CATS_SK, ...CATS_G].filter((c) => catRank[c] === n).map((c) => NAMES[c]);
    if (catBottom.length) weaknesses.push(`Last in ${catBottom.join(', ')}`);
    for (const p of roster) {
      if (p.injury_status && /^(out|ir|injured|long|suspen)/i.test(p.injury_status) && p.proj >= 90) risks.push(`${p.name} starts the year ${p.injury_status}`);
      if ((p.age ?? 0) >= 34 && p.proj >= 120) risks.push(`${p.name} is ${p.age}: the decline can come fast`);
    }
    // surplus: the position whose players lose the most starts to teammates
    const benchByPos: Record<string, number> = {};
    for (const c of fc.players.values()) { const pos = P(c.id)!.pos; benchByPos[pos] = (benchByPos[pos] ?? 0) + c.benchPts; }
    const surplus = POS.filter((p) => (benchByPos[p] ?? 0) >= 90 && counts[p] > DEPTH[p] - 1).sort((a, b) => benchByPos[b] - benchByPos[a]).slice(0, 2);
    const needs = POS.filter((p) => counts[p] < DEPTH[p] - (p === 'D' ? 1 : 0) || posRank[p] >= n - 1);
    if (surplus.length && fc.benchWaste > avgWaste * 1.03) {
      moves.push(`About ${Math.round(fc.benchWaste)} projected points sit on the bench (league average ${Math.round(avgWaste)}), mostly ${surplus.map((p) => NAMES[p]).join(' and ')} with nowhere to play. Package that surplus for a starter where you're thin.`);
    }
    if (fc.emptySlots > avgEmpty * 1.04) moves.push(`${Math.round(fc.emptySlots)} starting spots project to go empty on nights your players are off (league average ${Math.round(avgEmpty)}). Spread your games out: add free agents who play on light nights.`);
    if (goalieStarts < 95) moves.push(`Your goalies project for only ${Math.round(goalieStarts)} starts between them. A goalie who plays a lot is worth more than one who stops a lot: go get a workhorse.`);
    for (const p of needs) if (!surplus.includes(p)) {
      const partners = teams.filter((o, j) => o.id !== t.id && (fcs[j].byPos[p] ?? 0) > (fc.byPos[p] ?? 0) * 1.15 && surplus.some((s) => posRank[s] < rankIn(fcs.map((f) => f.byPos[s] ?? 0), fcs[j].byPos[s] ?? 0))).map((o) => o.gm);
      moves.push(`Upgrade your ${NAMES[p]} (#${posRank[p]} of ${n}).${surplus.length && partners.length ? ` ${partners.slice(0, 2).join(' and ')} ${partners.length > 1 ? 'have' : 'has'} the depth there and could use your ${surplus.map((s) => NAMES[s]).join('/')}.` : ''}`);
    }
    const hurt = roster.filter((p) => p.injury_status && /^(out|ir|injured|long)/i.test(p.injury_status));
    if (hurt.length) moves.push(`Put ${hurt.slice(0, 2).map((p) => p.name).join(' and ')} on IR while ${hurt.length > 1 ? 'they are' : 'he is'} out: it frees a bench spot for someone who plays.`);
    if (od.top3 < 0.2 && avgAge != null && avgAge < 27.5) moves.push('Young roster and long odds this year: take upside swings and future picks in trades.');
    if (od.top3 >= 0.6) moves.push('A real contender: trade depth and future picks for starters before the deadline.');

    return {
      team: t.id, draftScore: draftScores[i], draftGrade: letter(zOf(draftScores, draftScores[i])), rosterGrade: letter(zOf(totals, fc.total)),
      fc, odds: od, picks: mine, best, worst, keeperPts, draftPts, posRank, catRank, counts, goalieStarts, avgAge,
      risks: risks.slice(0, 3), strengths, weaknesses, moves: moves.slice(0, 5), surplus, needs, stashes: mine.filter((e) => e.stash),
    };
  });

  // position runs: 4+ of one position inside 8 picks
  const ordered = evals.slice().sort((a, b) => a.overall - b.overall);
  const runs: DraftAnalysis['runs'] = [];
  for (const pos of POS) {
    for (let i = 0; i < ordered.length; i++) {
      const win = ordered.slice(i, i + 8).filter((e) => P(e.player)?.pos === pos);
      if (win.length >= 4 && !runs.some((r) => r.pos === pos && r.to >= ordered[i].overall)) runs.push({ pos, from: win[0].overall, to: win[win.length - 1].overall, n: win.length });
    }
  }
  return {
    teams: out.sort((a, b) => b.fc.total - a.fc.total),
    steals: [...evals].sort((a, b) => b.over - a.over).slice(0, 5),
    reaches: [...evals].filter((e) => e.round <= 8 && !e.stash).sort((a, b) => a.over - b.over).slice(0, 5),
    stashes: evals.filter((e) => e.stash),
    runs: runs.slice(0, 5), asOf: from, avgWaste, avgEmpty,
  };
}
