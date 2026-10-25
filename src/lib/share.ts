// Sharing, one way for the whole product (25 October 2026, Patrick: "share in the most epic and amazing fashions the
// content and information they love"): a share is a job (a title, a line of text, a link and, where there is one, a
// picture), and the ShareSheet (src/components/ShareSheet.tsx) offers every way to send it: the phone's own sheet with
// the picture in it, the picture saved, the link copied, X, Threads, Facebook, Reddit, WhatsApp, Telegram, Messages,
// email, and a QR code to show a friend across the table. Links go through the app's Worker, so each unfurls with its own
// picture (worker/fans.ts, worker/preview.ts).
import qrcode from 'qrcode-generator';

export interface ShareJob { title: string; text: string; url?: string; blob?: Blob | null; file?: string }

export const onPhone = () => typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const nav = () => navigator as Navigator & { canShare?: (d: ShareData) => boolean };
export const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
export const canShareFile = (file: File) => { try { return !!nav().canShare?.({ files: [file] }); } catch { return false; } };
export const fileOf = (job: ShareJob) => (job.blob ? new File([job.blob], job.file ?? 'super-pools.png', { type: job.blob.type || 'image/png' }) : null);

// the phone's own sheet: the picture where the phone takes one, else the words and the link
export async function shareNative(job: ShareJob): Promise<'shared' | 'cancelled' | 'unsupported'> {
  if (!canShare()) return 'unsupported';
  const file = fileOf(job);
  const data: ShareData = file && canShareFile(file)
    ? { files: [file], text: job.url ? `${job.text} ${job.url}` : job.text }
    : { title: job.title, text: job.text, ...(job.url ? { url: job.url } : {}) };
  try { await navigator.share(data); return 'shared'; } catch (e) { return (e as Error)?.name === 'AbortError' ? 'cancelled' : 'unsupported'; }
}

export async function copyText(s: string) {
  try { await navigator.clipboard.writeText(s); return true; } catch { return false; }
}

// the picture saved to the phone (where it can't be shared as a file, or on purpose)
export function savePicture(blob: Blob, name = 'super-pools.png') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// the usual places, each with its own colour
export interface Target { key: string; name: string; href: string; color: string; ink?: string }
const enc = encodeURIComponent;
export function targets(url: string, title: string, text: string): Target[] {
  const both = `${text} ${url}`;
  return [
    { key: 'x', name: 'X', href: `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, color: '#000000' },
    { key: 'threads', name: 'Threads', href: `https://www.threads.net/intent/post?text=${enc(both)}`, color: '#101010' },
    { key: 'whatsapp', name: 'WhatsApp', href: `https://wa.me/?text=${enc(both)}`, color: '#25d366' },
    { key: 'telegram', name: 'Telegram', href: `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`, color: '#229ed9' },
    { key: 'messages', name: 'Messages', href: `sms:?&body=${enc(both)}`, color: '#34c759' },
    { key: 'facebook', name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}`, color: '#1877f2' },
    { key: 'reddit', name: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`, color: '#ff4500' },
    { key: 'bluesky', name: 'Bluesky', href: `https://bsky.app/intent/compose?text=${enc(both)}`, color: '#0085ff' },
    { key: 'email', name: 'Email', href: `mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`, color: '#334155' },
  ];
}

// a QR code for the link, as an SVG (the phone's camera reads it from another phone's screen)
export function qrSvg(text: string, dark = '#0b1222', light = '#ffffff') {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
export const qrDataUrl = (text: string) => `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg(text))}`;

// the words for a chance in a share line
export const pctWord = (p: number) => (p >= 0.995 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);
