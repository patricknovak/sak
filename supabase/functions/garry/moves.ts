// A climb the table didn't see (18 October 2026): a dry run of the morning column had "Terry ... jumped Jason and
// Patrick in one night to take the top spot", a day after it happened, with the facts' rank_changes naming only Patrick
// and Craig going up. A GM (or their team) named as the one who climbed, passed or took first, with the verb within ten
// words and no other GM between, must be one the facts move up; otherwise the sentence says so.
const UP = /^(jump(ed|s)?|leapfrog(ged|s)?|vault(ed|s)?|climb(ed|s)?|pass(ed|es)?|overt(ook|akes?)|rose|rises?|surg(ed|es?)|snuck|sneaks?|took|takes?|moved?|moves|slipped|slips?)$/;
// these are a climb only with where they went: "took the top spot", "moved up", "slipped into 4th"
const NEEDS_WHERE = /^(took|takes?|moved?|moves|slipped|slips?)$/;
const WHERE = /^(up|past|into|the|top|first|1st|over|ahead)$/;

const plain = (s: string) => s.toLowerCase().replace(/[’']s\b/g, '').replace(/[^\p{L}\p{N}#\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function movesCheck(changes: string[], people: { gm: string; team: string }[]) {
  const up = new Set(changes.filter((c) => /\bup\b/i.test(c)).map((c) => c.split(/\s+/)[0].toLowerCase()));
  const names: [string, string][] = people.flatMap((p) => {
    const first = p.gm.split(/\s+/)[0];
    return [[plain(first), first], ...(plain(p.team) ? [[plain(p.team), first] as [string, string]] : [])];
  });
  return (body: string): string | null => {
    for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
      const low = ` ${plain(sentence)} `;
      // where each GM (or their team) is named in the sentence, in order
      const hits = names.flatMap(([n, gm]) => [...low.matchAll(new RegExp(`(?<= )${escape(n)}(?= )`, 'g'))]
        .map((m) => ({ at: m.index!, end: m.index! + n.length, gm }))).sort((a, b) => a.at - b.at);
      for (const h of hits) {
        const next = hits.find((o) => o.at > h.end && o.gm !== h.gm)?.at ?? low.length;
        const words = low.slice(h.end, next).trim().split(' ').slice(0, 10);
        const k = words.findIndex((w) => UP.test(w));
        if (k < 0) continue;
        if (NEEDS_WHERE.test(words[k]) && !WHERE.test(words[k + 1] ?? '')) continue;
        if (!up.has(h.gm.toLowerCase())) return `it says ${h.gm} moved up, and the table didn't move them`;
      }
    }
    return null;
  };
}
