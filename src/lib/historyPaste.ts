// A past season's final table, pasted from wherever the league played it (Yahoo, ESPN, Fantrax, CBS, a spreadsheet,
// an old email). Each line is a team, top to bottom. The parser keeps what a final table needs: the team's name, its
// GM when the line has one, and its points. It drops the rest: the place number in front, W-L-T records, money columns
// it can't tell from points, and header lines.
export interface PastedRow { team_name: string; gm_name: string; points: string }

// a number as tables print it: 1,234.5 or 1 234,5 or 98.0
const NUM = /^[-+]?\d{1,3}(?:[ ,]\d{3})*(?:[.,]\d+)?$|^[-+]?\d+(?:[.,]\d+)?$/;
const RECORD = /^\d+-\d+(?:-\d+)?$/;              // 10-3-1, a W-L-T record
const PLACE = /^(?:#?\d{1,2}(?:st|nd|rd|th)?\.?|T-?\d{1,2}\.?)$/i;   // 1, 1., #1, 1st, T-3
const HEADER = /^(rank|place|pos|team|teams|manager|managers|gm|owner|points|pts|fpts|w-l-t|record|total|#)$/i;

const toNumber = (s: string) => {
  let t = s.replace(/\s/g, '');
  // 1,234.5 -> 1234.5; 1.234,5 -> 1234.5; 98,5 -> 98.5
  if (/,\d{3}(?:\.|$)/.test(t)) t = t.replace(/,/g, '');
  else if (/\.\d{3},/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '';
};

// a comma-separated line, quotes respected ("Smith, Jones & Co" stays one cell), and a number its commas split back
// together: "1", "234.5" after a split on "1,234.5" is one number again
const splitCsv = (line: string) => {
  const cells: string[] = [];
  let cur = '', quoted = false, wasQuoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; wasQuoted = true; continue; }
    if (ch === ',' && !quoted) { cells.push(wasQuoted ? cur : cur.trim()); cur = ''; wasQuoted = false; continue; }
    cur += ch;
  }
  cells.push(wasQuoted ? cur : cur.trim());
  const out: string[] = [];
  for (const c of cells) {
    const prev = out[out.length - 1];
    if (prev != null && /^[-+]?\d{1,3}(?:,\d{3})*$/.test(prev) && /^\d{3}(?:\.\d+)?$/.test(c)) out[out.length - 1] = `${prev},${c}`;
    else out.push(c);
  }
  return out;
};

// cells: tabs (copied from a web table or a sheet), else commas between fields (a comma next to a letter or a quote,
// never only the one inside a number like 1,234), else runs of two or more spaces
const splitCells = (line: string) =>
  line.includes('\t') ? line.split('\t') : /"|,\s*[^\d\s]|[^\d\s],/.test(line) ? splitCsv(line) : line.split(/\s{2,}/);

export function parsePastedTable(text: string): PastedRow[] {
  const out: PastedRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cells = splitCells(line).map((c) => c.trim()).filter(Boolean);
    if (cells.length === 1) {
      // one cell: "1. Team Name 1234.5" style, split off a leading place and a trailing number
      const m = cells[0].match(/^(?:#?\d{1,2}(?:st|nd|rd|th)?[.)]?\s+)?(.*?)(?:\s+(\d+-\d+(?:-\d+)?))?(?:\s+([-+]?[\d,. ]*\d))?$/i);
      cells = m ? [m[1], m[2], m[3]].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim()) : cells;
    }
    if (cells.every((c) => HEADER.test(c))) continue;   // a header line
    if (cells.length && PLACE.test(cells[0]) && cells.length > 1) cells = cells.slice(1);
    const words: string[] = [];
    let points = '';
    for (const c of cells) {
      if (RECORD.test(c)) continue;
      if (NUM.test(c.replace(/^\$/, ''))) { if (!c.startsWith('$') && !points) points = toNumber(c); continue; }
      if (HEADER.test(c)) continue;
      words.push(c);
    }
    if (!words.length) continue;
    let team = words[0], gm = words[1] ?? '';
    // "Team Name (GM)" or "Team Name - GM"
    const paren = team.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (paren && !gm) { team = paren[1]; gm = paren[2]; }
    out.push({ team_name: team.slice(0, 60), gm_name: gm.slice(0, 40), points });
  }
  return out;
}
