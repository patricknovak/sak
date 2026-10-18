// A post whose rewrite still fails its check keeps every sentence that passes, as long as most of it survives: one stray
// number shouldn't cost the league its morning column (18 October 2026: two of the week's eight columns fell back to
// the bare scores line over a single number the facts didn't hold). Each line is cut into sentences and each sentence
// held to the same check on its own; what's left must pass whole and keep at least `keep` of the original's length,
// or there is nothing to salvage (null).
export function salvage(text: string, check: (body: string) => string | null, keep = 0.6): string | null {
  const whole = text.trim();
  if (!whole) return null;
  const lines = whole.split('\n').map((line) => {
    if (!line.trim()) return '';
    const kept = line.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !check(s));
    return kept.length ? kept.join(' ') : null;
  }).filter((line): line is string => line !== null);
  const out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!out || out.length < whole.length * keep || check(out)) return null;
  return out;
}
