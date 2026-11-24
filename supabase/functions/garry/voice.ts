// Two habits that made Garry tiresome and wrong (19 November 2026), kept apart from index.ts so they can be tested.

const words = (s: string, skip: Set<string> = new Set()) => (s.toLowerCase().replace(/[’']s\b/g, '').match(/[\p{L}']{4,}/gu) ?? []).filter((w) => !COMMON.has(w) && !skip.has(w));
const COMMON = new Set(['that', 'this', 'with', 'what', 'when', 'have', 'from', 'they', 'them', 'your', 'just', 'like', 'will', 'more', 'than', 'then', 'some', 'only', 'over', 'into', 'been', 'were', 'says', 'said', 'keeps', 'calls', 'always', 'about', 'after', 'again', 'their', 'there', 'these', 'those', 'still', 'night', 'tonight', 'points', 'point', 'league',
  'every', 'where', 'which', 'while', 'would', 'could', 'should', 'being', 'never', 'always', 'first', 'second', 'third', 'fourth', 'fifth',
  'sixth', 'seventh', 'eighth', 'place', 'behind', 'ahead', 'season', 'games', 'standings', 'team', 'teams', 'running', 'best', 'worst',
  'goal', 'goals', 'goalie', 'goalies', 'bench', 'benched', 'benches', 'lead', 'leads', 'trade', 'trades', 'coins', 'game', 'player', 'players',
  'start', 'starts', 'started', 'starter', 'starters', 'last', 'week', 'year', 'back', 'gets', 'make', 'made', 'even', 'good']);

// The same running gag in post after post: Terry's "daddy" and "dust", Jason's Oilers cup run, the coins, in four wraps out
// of six. A memory whose words mostly turned up in his last few posts has been used lately; it rests until they scroll
// out. `memories` are the recall lines ("[Terry] (running gag) ..."), `recent` his own latest posts.
// `names` (the GMs' first names) say nothing about which bit it is, so they don't count.
export function rested(memories: string[], recent: string[], names: string[] = []): string[] {
  const skip = new Set(names.map((n) => n.toLowerCase()));
  const seen = new Set(recent.flatMap((r) => words(r, skip)));
  return memories.filter((m) => {
    const w = [...new Set(words(m.replace(/^\[[^\]]*\]\s*(\(running gag\)\s*)?/, ''), skip))];
    if (w.length < 2) return true;
    const used = w.filter((x) => seen.has(x)).length;
    return !(used >= 3 || (used >= 2 && used / w.length >= 0.3));
  });
}

const flat = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim();

// Words in quotation marks are someone's words, so they must be in what he was given, said by the GM the sentence puts
// them on. The 18 November trade take quoted Terry from a chat line Terry wrote in October about something else, and
// told it as his reaction to the trade. `sources` are lines of what he was given (chat lines "Terry: ...", memories
// "[Terry] ...", the facts); `people` the GMs' first names.
export function quoteCheck(sources: string[], people: string[]) {
  const lines = sources.map((s) => ({ raw: s.toLowerCase(), flat: flat(s) }));
  return (body: string): string | null => {
    for (const sentence of body.split(/(?<=[.!?]["”]?)\s+|\n+/)) {
      for (const m of sentence.matchAll(/["“]([^"”]{12,})["”]/g)) {
        const q = flat(m[1]);
        if (q.split(' ').length < 3) continue;
        const from = lines.filter((l) => l.flat.includes(q));
        if (!from.length) return `it quotes "${m[1]}", and nobody said that`;
        const who = people.filter((p) => new RegExp(`(^|[^\\p{L}])${p}(?![\\p{L}])`, 'iu').test(sentence.replace(m[0], '')));
        if (who.length && !from.some((l) => who.some((p) => l.raw.includes(p.toLowerCase())))) return `it puts "${m[1]}" on ${who.join(' or ')}, who didn't say it`;
      }
    }
    return null;
  };
}

// A GM's swearing stays the GM's: memories that carry it (Terry's "assholes", Todd's "stub their dicks") are left out of
// what he's given, so a post never says it back to the whole league (the persona keeps him PG-13).
export const CRUDE = /\b(fuck(s|ed|er|ers|ing|in)?|motherfuck\w*|shit(s|ty|ter|head)?|bullshit|assholes?|bitch(es|y)?|puss(y|ies)|dicks?|dickhead|cunts?|cocks?|bastards?|sluts?|whores?|retard(ed|s)?)\b/i;
