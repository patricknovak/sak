// The night's wrap, worked out before a word is written (19 November 2026).
//
// Patrick's word after a week of wraps: "very incoherent and inaccurate". The model was handed the whole night as one
// JSON blob (every team, every gap, every starter, the news) and asked to find the story; it found several at once and
// glued them together: "Todd's 5-point night trimmed Jason's gap by 3.3" (the 3.3 was Todd's gap to Patrick), "Trystan's
// 0.8 widened his cushion on Darin by 4.7" (it shrank by 0.2), "couldn't close the four-point gap to Craig" (39 back),
// "Trystan's McDavid add closed the basement gap to 1.9" (1.7, and nobody added McDavid), and on 17 November it skipped
// Darin's 31.7, the best night in the league. So the stories are now chosen and told here, each one a plain sentence
// with its own numbers and the GMs and players it is about, ranked by how much they matter. The model only voices them,
// and `beatsCheck` holds the post to them: every number is one a story gives, a number sits only beside the GMs whose
// story it is, a gap that grew is never "trimmed" (or the other way round), and no player is named who isn't in a story.

export type NightRow = { gm: string; now: number; points: number; tonight: number };
export type Starter = { gm: string; player: string; fpts: number; line: string };
export type BenchMiss = { gm?: string; player?: string; fpts: number; over?: string; over_fpts: number; cost: number };
export type NewsItem = { headline: string; players: { player: string; on_team_of: string; last_night: string; status_now: string }[] };
export type Beat = { kind: string; weight: number; text: string; gms: string[]; players: string[]; nums: string[]; dir?: 'closed' | 'grew' };

const r1 = (x: number) => Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 10) / 10;
const n1 = (x: number) => String(r1(x));
const ORD = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
// a number as the check reads it: digits only, no trailing ".0"
const norm = (s: string) => s.replace(/,/g, '').replace(/\.0+$/, '').replace(/^(-?)0+(\d)/, '$1$2');
const numsOf = (text: string) => [...text.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)].map((m) => norm(m[0].replace(/^-/, '')));

function beat(kind: string, weight: number, text: string, gms: string[], players: string[] = [], dir?: 'closed' | 'grew'): Beat {
  return { kind, weight: Math.round(weight * 10) / 10, text, gms: [...new Set(gms)], players: [...new Set(players)], nums: [...new Set(numsOf(text))], ...(dir ? { dir } : {}) };
}

export function buildBeats(input: {
  rows: NightRow[]; starters: Starter[]; bench: BenchMiss[]; week: { gm: string; points: number }[]; news: NewsItem[];
  next?: { label: string; games: number; short: { gm: string; can: number; of: number }[] } | null; bonus?: { gm: string; coins: number } | null;
  pointsTable: boolean;
}): Beat[] {
  const out: Beat[] = [];
  const rows = [...input.rows].sort((a, b) => a.now - b.now);
  const before = [...rows].sort((a, b) => (b.points - b.tonight) - (a.points - a.tonight));
  const was = new Map(before.map((r, i) => [r.gm, i + 1]));
  const byNow = new Map(rows.map((r) => [r.now, r]));
  const last = rows.length;
  const tops = (gm: string, k = 2) => input.starters.filter((s) => s.gm === gm && s.fpts > 0).sort((a, b) => b.fpts - a.fpts).slice(0, k);
  const said = (s: Starter) => `${s.player} ${n1(s.fpts)}${s.line && s.line !== 'no points' ? ` (${s.line})` : ''}`;

  // the night's best and worst scores
  const night = [...rows].sort((a, b) => b.tonight - a.tonight);
  const hi = night[0], lo = night.at(-1);
  if (hi) {
    const t = tops(hi.gm);
    out.push(beat('best_night', 6 + Math.max(0, hi.tonight - (night[1]?.tonight ?? 0)) / 3,
      `${hi.gm} had the best night in the league, ${n1(hi.tonight)} points${night[1] ? ` (next best: ${night[1].gm} ${n1(night[1].tonight)})` : ''}${t.length ? `, led by ${list(t.map(said))}` : ''}${input.bonus?.gm === hi.gm ? `; that's the Dangler of the Day, ${input.bonus.coins} coins` : ''}`,
      [hi.gm, ...(night[1] ? [night[1].gm] : [])], t.map((s) => s.player)));
  }
  if (lo && lo !== hi && night.length > 2) {
    out.push(beat('worst_night', 2.5 + (lo.now === 1 ? 1.5 : 0) + (lo.tonight <= 1 ? 1 : 0),
      `${lo.gm} had the quietest night: ${n1(lo.tonight)} points, the fewest in the league`, [lo.gm]));
  }

  // the best single player on anyone's ice, when it isn't already the best night's own story
  const star = [...input.starters].sort((a, b) => b.fpts - a.fpts)[0];
  if (star && !(hi && tops(hi.gm).some((s) => s.player === star.player))) {
    out.push(beat('star', 3 + star.fpts / 4, `${star.player} was the best starter in the league: ${n1(star.fpts)} points (${star.line}) for ${star.gm}`, [star.gm], [star.player]));
  }
  // a starter who cost his GM points
  const dud = [...input.starters].sort((a, b) => a.fpts - b.fpts)[0];
  if (dud && dud.fpts < 0) {
    out.push(beat('dud', 1.5 + Math.abs(dud.fpts), `${dud.player} went negative for ${dud.gm}: ${n1(dud.fpts)} points (${dud.line})`, [dud.gm], [dud.player]));
  }

  if (input.pointsTable) {
    // every pass, with where they were and where they are now
    for (const r of rows) {
      const w = was.get(r.gm) ?? r.now;
      if (w <= r.now) continue;
      const passed = rows.filter((o) => (was.get(o.gm) ?? o.now) < w && o.now > r.now).map((o) => o.gm);
      const ahead = byNow.get(r.now - 1), behind = byNow.get(r.now + 1);
      out.push(beat('climb', 7 + (w - r.now - 1),
        `${r.gm} passed ${list(passed)} and moved from ${ORD(w)} to ${ORD(r.now)}${r.now === 1 ? ', into first place' : ''}` +
          (behind && passed.includes(behind.gm) ? `; ${behind.gm} is now ${n1(r.points - behind.points)} behind` : '') +
          (ahead ? `; ${r.gm} is ${n1(ahead.points - r.points)} behind ${ahead.gm} (${ORD(ahead.now)})` : ''),
        [r.gm, ...passed, ...(ahead ? [ahead.gm] : [])]));
    }
    // each gap that moved, between a team and the one just ahead of it, told the way it went
    for (const r of rows) {
      const ahead = byNow.get(r.now - 1);
      if (!ahead) continue;
      const gb = r1((ahead.points - ahead.tonight) - (r.points - r.tonight)), ga = r1(ahead.points - r.points);
      // they passed each other, or this team climbed tonight: the climb tells it, with the gap it's left with
      if (gb < 0 || (was.get(r.gm) ?? r.now) > r.now) continue;
      const d = r1(gb - ga), close = ga <= 3 ? 3 : ga <= 8 ? 1.5 : 0, edge = ahead.now === 1 ? 1.5 : r.now === last ? 1 : 0;
      const top = ahead.now === 1, basement = r.now === last;
      const told = d > 0
        ? (top ? `${r.gm} (${ORD(r.now)}) cut ${ahead.gm}'s lead at the top` : `${r.gm} (${ORD(r.now)}${basement ? ', last' : ''}) closed the gap to ${ahead.gm} (${ORD(ahead.now)})`)
        : (top ? `${ahead.gm}'s lead at the top over ${r.gm} (${ORD(r.now)})` : `${ahead.gm}'s (${ORD(ahead.now)}) gap over ${r.gm} (${ORD(r.now)}${basement ? ', last' : ''})`);
      if (Math.abs(d) >= 0.5) {
        out.push(beat('gap', 2 + Math.abs(d) / 3 + close + edge,
          d > 0 ? `${told} from ${n1(gb)} to ${n1(ga)}, by ${n1(d)}` : `${told} grew from ${n1(gb)} to ${n1(ga)}, by ${n1(-d)}`,
          [r.gm, ahead.gm], [], d > 0 ? 'closed' : 'grew'));
      } else if (ga <= 3) {
        out.push(beat('gap', 2 + close, `${r.gm} is still only ${n1(ga)} behind ${ahead.gm} (${ORD(ahead.now)})`, [r.gm, ahead.gm]));
      }
    }
    if (!rows.some((r) => (was.get(r.gm) ?? r.now) !== r.now)) out.push(beat('no_moves', 0.5, 'Nobody changed places in the table', []));
  }

  // points left on a bench, where the bench player could have taken that starter's slot
  for (const b of input.bench.slice(0, 2)) {
    if (!b.gm || !b.player || !b.over) continue;
    out.push(beat('bench', 3 + b.cost / 2, `${b.gm} left ${b.player} on the bench for ${n1(b.fpts)} points while ${b.over} scored ${n1(b.over_fpts)} in a slot he could have filled: ${n1(b.cost)} points lost`, [b.gm], [b.player, b.over]));
  }
  // the week's form, when it's lopsided
  const wk = [...input.week].sort((a, b) => b.points - a.points);
  if (wk.length > 2 && wk[0].points - wk[1].points >= 8) out.push(beat('week', 2.5, `${wk[0].gm} has the most points over the last 7 days, ${n1(wk[0].points)}, ${n1(wk[0].points - wk[1].points)} more than anyone else`, [wk[0].gm]));
  if (wk.length > 2 && wk.at(-2)!.points - wk.at(-1)!.points >= 8) out.push(beat('week', 2, `${wk.at(-1)!.gm} has the fewest points over the last 7 days, ${n1(wk.at(-1)!.points)}`, [wk.at(-1)!.gm]));

  // the NHL's news about the league's own players, each as it stands
  for (const a of input.news.slice(0, 3)) {
    const ps = a.players.slice(0, 2);
    if (!ps.length) continue;
    out.push(beat('news', 2.5 + (ps.some((p) => p.status_now !== 'healthy') ? 1 : 0),
      `NHL news: "${a.headline}". ${ps.map((p) => `${p.player} is on ${p.on_team_of}'s team; last night: ${p.last_night}; status now: ${p.status_now}`).join('. ')}`,
      ps.map((p) => p.on_team_of), ps.map((p) => p.player)));
  }
  // the next slate, only when a team can't fill its lineup and the rest can
  const nx = input.next;
  if (nx && nx.games > 4 && nx.short.length && nx.short.length <= 3) {
    out.push(beat('next', 1.5 + nx.short.length * 0.3, `${nx.label}: ${nx.games} NHL games, and ${list(nx.short.map((s) => `${s.gm} can only dress ${s.can} of ${s.of} starters`))}`, nx.short.map((s) => s.gm)));
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// the night's date, which the post may give ("Monday the 17th")
export function dateBeat(day: string): Beat {
  const [y, m, d] = day.split('-').map(Number);
  return { kind: 'date', weight: 0, text: day, gms: [], players: [], nums: [String(y), String(m), String(d)] };
}

// every team's night and season total, one line each: the post may give any GM's own score or total beside their name
export function scoreBeats(rows: NightRow[]): Beat[] {
  return rows.map((r) => beat('score', 0, `${r.gm}: ${n1(r.tonight)} tonight, ${n1(r.points)} for the season, ${ORD(r.now)}`, [r.gm]));
}

// the stories the wrap tells: the best night always, then the heaviest, at most `k`
export function pickBeats(all: Beat[], k = 6): Beat[] {
  const best = all.find((b) => b.kind === 'best_night');
  const rest = all.filter((b) => b !== best && b.kind !== 'no_moves');
  return [...(best ? [best] : []), ...rest].slice(0, k).sort((a, b) => b.weight - a.weight);
}

const WORDS: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12', first: '1', second: '2', third: '3', fourth: '4', fifth: '5', sixth: '6', seventh: '7', eighth: '8', ninth: '9', tenth: '10' };
const wordsToDigits = (s: string) => s.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi, (w) => WORDS[w.toLowerCase()]);
// small counts read as words ("one night", "two goals") and 0 are never a story's number
const FREE = new Set(['0', '1', '2']);
const CLOSE = /\b(clos(e|ed|es|ing)|cut|cuts|trim(med|s)?|shr[ai]nk|shrunk|narrow(ed|s)?|chipp?(ed)?|sliced?|shav(ed|es?)|ate into|reel(ed)? in)\b/i;
const GREW = /\b(gr[eo]w(n|s)?|widen(ed|s)?|stretch(ed|es)?|extend(ed|s)?|pull(ed)? away|built|padd?(ed)?|grows)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// the post held to its stories. `people` names each GM and their team; `roster` is every player on a league roster
export function beatsCheck(beats: Beat[], people: { gm: string; team: string }[], roster: string[]) {
  const allowed = new Set(beats.flatMap((b) => b.nums));
  const rounded = new Set([...allowed].map((n) => String(Math.round(Number(n)))));
  const named = new Set(beats.flatMap((b) => b.players).flatMap((p) => [p, p.split(/\s+/).slice(1).join(' ')]).map((s) => s.toLowerCase()).filter(Boolean));
  const gmRe = people.map((p) => ({ gm: p.gm, re: new RegExp(`(^|[^\\p{L}])(${esc(p.gm.split(/\s+/)[0])}|${esc(p.team)})(?![\\p{L}])`, 'iu') }));
  // a roster player is named by his full name or his last name, capitalised as a name is
  const players = roster.map((full) => {
    const lastName = full.split(/\s+/).slice(1).join(' ');
    return { full, re: new RegExp(`(^|[^\\p{L}])(${esc(full)}|${esc(lastName)})(?![\\p{L}])`, 'u') };
  }).filter((p) => p.full.includes(' '));
  return (body: string): string | null => {
    const text = wordsToDigits(body.replace(/@/g, ''));
    for (const n of numsOf(text)) {
      if (FREE.has(n) || allowed.has(n) || (!n.includes('.') && rounded.has(n))) continue;
      return `it says ${n}, which none of the stories has`;
    }
    // each clause on its own: "Jason cut Terry's lead to 47.6, while Todd posted 20.7" is two stories in one sentence
    for (const clause of text.split(/(?<=[.!?])\s+|\n+|[;:,–]\s*|\s+(?=(?:while|whereas|meanwhile|but|as)\b)/i)) {
      const nums = numsOf(clause).filter((n) => !FREE.has(n));
      const gms = gmRe.filter((g) => g.re.test(clause)).map((g) => g.gm);
      for (const n of nums) {
        const homes = beats.filter((b) => b.nums.includes(n) || (!n.includes('.') && b.nums.some((x) => String(Math.round(Number(x))) === n)));
        if (!homes.length || !gms.length) continue;
        // a gap or a pass is between the GMs it names, and nobody else in the clause (the 16 November wrap: "Todd's
        // 5-point night trimmed Jason's gap by 3.3", the 3.3 was Todd's gap to Patrick); any other number belongs to
        // at least one GM the clause names
        const fits = homes.some((b) => !b.gms.length || (b.kind === 'gap' || b.kind === 'climb' ? gms.every((g) => b.gms.includes(g)) : gms.some((g) => b.gms.includes(g))));
        if (!fits) return `it puts ${n} beside ${gms.join(' and ')}, but ${n} is from ${[...new Set(homes.flatMap((b) => b.gms))].join(' and ')}'s story`;
        // a gap told the wrong way: grew called closed, or closed called grew
        const dirs = new Set(homes.map((b) => b.dir).filter(Boolean));
        if (dirs.size === 1) {
          const dir = [...dirs][0];
          if (dir === 'grew' && CLOSE.test(clause) && !GREW.test(clause)) return `it says a gap closed with ${n}, and that gap grew`;
          if (dir === 'closed' && GREW.test(clause) && !CLOSE.test(clause)) return `it says a gap grew with ${n}, and that gap closed`;
        }
      }
    }
    for (const p of players) {
      const m = body.match(p.re);
      if (m && !named.has(m[2].toLowerCase())) return `it names ${p.full}, who isn't in any of tonight's stories`;
    }
    return null;
  };
}

// the wrap without the model: the stories as they are
export function plainWrap(head: string, beats: Beat[]) {
  const best = beats.filter((b) => b.kind === 'best_night');
  return [head, ...[...best, ...beats.filter((b) => b.kind !== 'best_night')].slice(0, 4).map((b) => `${b.text}.`)].join(' ');
}
