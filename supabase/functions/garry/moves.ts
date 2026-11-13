// A climb the table didn't see (18 October 2026): a dry run of the morning column had "Terry ... jumped Jason and
// Patrick in one night to take the top spot", a day after it happened, with the facts' rank_changes naming only Patrick
// and Craig going up. A GM (or their team) named as the one who climbed, passed or took first, with the verb within ten
// words and no other GM between, must be one the facts move up; otherwise the sentence says so.
const UP = /^(jump(ed|s)?|leapfrog(ged|s)?|vault(ed|s)?|climb(ed|s)?|pass(ed|es)?|overt(ook|akes?)|rose|rises?|surg(ed|es?)|snuck|sneaks?|took|takes?|moved?|moves|slipped|slips?|launch(ed|es)?|rocket(ed|s)?|shot|shoots?|hopp(ed)|hops?|bump(ed|s)?|nudg(ed|es?)|edg(ed|es?)|lea(pt|ped|ps?)|soar(ed|s)?|catapult(ed|s)?|muscl(ed|es?)|stole|steals?|grabb(ed)|grabs?)$/;
// these are a climb only with where they went: "took the top spot", "moved up", "slipped into 4th"
const NEEDS_WHERE = /^(took|takes?|moved?|moves|slipped|slips?|shot|shoots?|edg(ed|es?)|nudg(ed|es?)|bump(ed|s)?|stole|steals?|grabb(ed)|grabs?)$/;
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

// The night's table, held against the words (13 November 2026). The wrap of 12 November had three things wrong that the
// climb check above let through: "Patrick's 33.1-point night launched him from fourth to third" (third all night;
// "launched" wasn't a climb word), "the 5.5-point gap to Jason held tight" (it went from 22.5 to 5.5) and "Darin slipped
// past Trystan into seventh by the same margin" (5.0, not 5.5). Each row is a GM's line from table_after_the_night.
export type TableRow = { gm: string; was: string; now: string; gap_to_the_team_ahead?: string };
const ORDS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, top: 1, last: 0 };
const ordOf = (w: string, n: number) => { const m = /^(\d+)(st|nd|rd|th)$/.exec(w); return m ? Number(m[1]) : w === 'last' ? n : ORDS[w] ?? null; };
const HOLD = /\b(held|holds|holding|frozen|froze|unchanged|steady|didn t budge|did not budge|exactly where|same as yesterday|stayed put|stood still|barely moved)\b/;

export function tableCheck(rows: TableRow[], people: { gm: string; team: string }[]) {
  const n = rows.length;
  const rank = (o: string) => Number(/\d+/.exec(o)?.[0] ?? 0);
  const at = new Map(rows.map((r) => [r.gm.split(/\s+/)[0].toLowerCase(), { was: rank(r.was), now: rank(r.now) }]));
  // each pair's gap, before and after: "Jason: 22.5 before, 5.5 now"
  const pairs = rows.flatMap((r) => {
    const m = /^(.+?): (-?[\d.]+) before, (-?[\d.]+) now/.exec(r.gap_to_the_team_ahead ?? '');
    return m ? [{ a: m[1].split(/\s+/)[0].toLowerCase(), b: r.gm.split(/\s+/)[0].toLowerCase(), was: Number(m[2]), now: Number(m[3]) }] : [];
  });
  const gapsNow = pairs.map((p) => p.now.toFixed(1));
  const names: [string, string][] = people.flatMap((p) => {
    const first = p.gm.split(/\s+/)[0];
    return [[plain(first), first.toLowerCase()], ...(plain(p.team) ? [[plain(p.team), first.toLowerCase()] as [string, string]] : [])];
  });
  return (body: string): string | null => {
    for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
      const low = ` ${plain(sentence)} `;
      const who = [...new Set(names.flatMap(([nm, gm]) => [...low.matchAll(new RegExp(`(?<= )${escape(nm)}(?= )`, 'g'))].map((m) => ({ at: m.index!, gm })))
        .sort((a, b) => a.at - b.at).map((h) => h.gm))];
      // "from fourth to third": the GM named first in the sentence, before and after
      const ft = /\bfrom (\w+) to (\w+)\b/.exec(low);
      if (ft && who.length) {
        const a = ordOf(ft[1], n), b = ordOf(ft[2], n), r = at.get(who[0]);
        if (a != null && b != null && r && (a !== r.was || b !== r.now))
          return `it has ${who[0]} going from ${ft[1]} to ${ft[2]}, and they went from ${ORD(r.was)} to ${ORD(r.now)}`;
      }
      // a gap that "held" between two GMs whose gap moved a point or more
      if (HOLD.test(low)) {
        for (const p of pairs) {
          const named = who.includes(p.a) && who.includes(p.b);
          const one = (who.includes(p.a) || who.includes(p.b)) && new RegExp(`(^|[^\\d.])${p.now.toFixed(1).replace('.', '\\.')}`).test(sentence.replace(/(\d+\.\d)0\b/g, '$1'));
          if ((named || one) && Math.abs(p.was - p.now) >= 1)
            return `it says the gap between ${p.a} and ${p.b} held, and it went from ${p.was} to ${p.now}`;
        }
      }
      // "by the same margin" when no two gaps in the table are the same
      if (/\bsame (margin|gap|distance|cushion)\b/.test(low) && new Set(gapsNow).size === gapsNow.length)
        return 'it says two gaps are the same margin, and no two gaps in the table are equal';
    }
    return null;
  };
}
const ORD = (k: number) => `${k}${['st', 'nd', 'rd'][((k + 90) % 100 - 10) % 10 - 1] ?? 'th'}`;
