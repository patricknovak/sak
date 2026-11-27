// One byte range out of a Range header (RFC 9110 §14): "bytes=0-1", "bytes=500-", "bytes=-500". The film on the
// marketing site is served through this (worker/landing.ts): Safari on a phone asks for bytes 0-1 before it will play
// anything, and wants a 206 back.
//   null             no usable range (another unit, several ranges, not a number): answer with the whole file
//   'unsatisfiable'  a range that starts past the end, or a suffix of nothing: 416
//   { start, end }   the bytes to send, both inclusive, clamped to the file
export type ByteRange = { start: number; end: number };

export function rangeOf(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header || !Number.isFinite(size) || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    // the last n bytes
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (end < start) return null;
  return { start, end };
}
