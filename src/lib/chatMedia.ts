// Photos and sharing in the chat (16 October 2026). A photo is shrunk on the phone before it goes up (a 12-megapixel
// shot becomes a few hundred KB), stored in the league's own folder of the private 'chat' bucket (migration 310), and
// shown through short-lived signed links asked for in batches. A message carries it as meta.image = {path, w, h}.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export const IMAGE_BODY = '📷 Photo';
export type ChatImage = { path: string; w: number; h: number };

// only a photo in this league's folder is drawn, whatever a message's meta says
export function imageOf(meta: Record<string, unknown> | null | undefined, league: number | null): ChatImage | null {
  const i = meta?.image as Partial<ChatImage> | undefined;
  if (!i || typeof i.path !== 'string' || league == null) return null;
  if (!new RegExp(`^${league}/\\d+/[\\w-]+\\.(webp|jpg|jpeg|png|gif)$`).test(i.path)) return null;
  return { path: i.path, w: Number(i.w) || 4, h: Number(i.h) || 3 };
}

// longest side 1600 px, WebP where the browser makes it (JPEG otherwise); a GIF goes up as it is so it still moves
async function shrink(file: File): Promise<{ blob: Blob; w: number; h: number; ext: string }> {
  const bmp = await createImageBitmap(file).catch(() => null);
  // a picture this browser can't draw (an iPhone's HEIC, mostly) goes up only if every phone can show it
  const raw: Record<string, string> = { 'image/gif': 'gif', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (file.type === 'image/gif' || !bmp) {
    if (!raw[file.type]) throw new Error('That photo’s format won’t show on every phone. Send a screenshot of it instead.');
    if (file.size > 8 * 1024 * 1024) throw new Error('That picture is too big (8 MB at most)');
    return { blob: file, w: bmp?.width ?? 4, h: bmp?.height ?? 3, ext: raw[file.type] };
  }
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  const out = (type: string) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, 0.82));
  const webp = await out('image/webp');
  if (webp && webp.type === 'image/webp') return { blob: webp, w, h, ext: 'webp' };
  const jpg = await out('image/jpeg');
  if (!jpg) throw new Error('Couldn’t read that picture');
  return { blob: jpg, w, h, ext: 'jpg' };
}

export async function uploadChatImage(league: number, team: number, file: File): Promise<ChatImage> {
  if (!file.type.startsWith('image/')) throw new Error('Only pictures can go in the chat');
  const { blob, w, h, ext } = await shrink(file);
  const path = `${league}/${team}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('chat').upload(path, blob, { contentType: blob.type || `image/${ext}`, cacheControl: '31536000' });
  if (error) throw new Error(error.message);
  return { path, w, h };
}

// signed links, asked for together: every photo on screen in one call, each good for six hours and kept for five
const cache = new Map<string, { url: string; until: number }>();
const waiting = new Map<string, ((u: string | null) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
function flush() {
  timer = null;
  const paths = [...waiting.keys()];
  const cbs = new Map(waiting);
  waiting.clear();
  supabase.storage.from('chat').createSignedUrls(paths, 6 * 3600).then(({ data }) => {
    const got = new Map((data ?? []).map((d) => [d.path ?? '', d.signedUrl ?? null]));
    for (const p of paths) {
      const u = got.get(p) ?? null;
      if (u) cache.set(p, { url: u, until: Date.now() + 5 * 3600_000 });
      cbs.get(p)?.forEach((cb) => cb(u));
    }
  }, () => paths.forEach((p) => cbs.get(p)?.forEach((cb) => cb(null))));
}
export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((ok) => {
    waiting.set(path, [...(waiting.get(path) ?? []), ok]);
    if (!timer) timer = setTimeout(flush, 30);
  });
}
export function useSignedUrl(path: string | null): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(() => (path ? cache.get(path)?.url : null));
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let live = true;
    signedUrl(path).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path]);
  return url;
}

// send something out to the phone's share sheet (Messages, WhatsApp, Signal...), the picture itself where the phone
// takes files; without a share sheet (a desktop browser) the words and the link go to the clipboard
export async function shareOut(o: { title?: string; text: string; url?: string; image?: string | null }): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (navigator.share) {
    try {
      if (o.image) {
        const blob = await fetch(o.image).then((r) => r.blob());
        const file = new File([blob], `photo.${(blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`, { type: blob.type || 'image/jpeg' });
        if (nav.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: o.title, text: o.text }); return 'shared'; }
      }
      await navigator.share({ title: o.title, text: o.text, url: o.url });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  try { await navigator.clipboard.writeText([o.text, o.url].filter(Boolean).join('\n')); return 'copied'; } catch { return 'cancelled'; }
}
