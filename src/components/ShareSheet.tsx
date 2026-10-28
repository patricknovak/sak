// The share sheet (25 October 2026): one sheet for a fan zone, a pool, a call or a table. It shows what is being shared
// (the picture, big, where there is one; the line of text; the link), then every way to send it: the phone's own sheet
// first (the picture goes with it where the phone takes files), the picture saved, the link copied, the usual places and
// a QR code. A share with several pictures to choose from (a club's verdict, its outlook, its history, my calls) shows
// them as a strip; the chosen one is drawn when it is picked and kept.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, QrCode, Share2 } from 'lucide-react';
import { canShare, copyText, fileOf, canShareFile, onPhone, qrDataUrl, savePicture, shareNative, targets, type ShareJob } from '../lib/share';
import { Sheet, Spinner, useToast } from './ui';

export interface ShareOption { key: string; label: string; hint?: string; make: () => Promise<ShareJob> | ShareJob }

export function ShareSheet({ open, onClose, job, options, heading = 'Share', onShared }: { open: boolean; onClose: () => void; job?: ShareJob | null; options?: ShareOption[]; heading?: ReactNode; onShared?: () => void }) {
  const toast = useToast();
  const [picked, setPicked] = useState(0);
  const [made, setMade] = useState<Record<string, ShareJob>>({});
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const drawing = useRef<string | null>(null);
  const opt = options?.[picked] ?? null;
  const cur: ShareJob | null = opt ? made[opt.key] ?? null : job ?? null;
  // draw the picked option once, the first time it is picked
  useEffect(() => {
    if (!open || !opt || made[opt.key] || drawing.current === opt.key) return;
    drawing.current = opt.key;
    setBusy(true);
    Promise.resolve().then(() => opt.make()).then((j) => setMade((m) => ({ ...m, [opt.key]: j })), (e: Error) => { if (e?.name !== 'AbortError') toast('Couldn’t draw the picture on this phone. Try a screenshot instead.', 'err'); })
      .finally(() => { drawing.current = null; setBusy(false); });
  }, [open, opt, made, toast]);
  useEffect(() => { if (!open) { setPicked(0); setQr(false); setCopied(false); } }, [open]);
  // the picture, as something an <img> can show
  const src = useMemo(() => (cur?.blob ? URL.createObjectURL(cur.blob) : null), [cur?.blob]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const native = canShare();
  const file = cur ? fileOf(cur) : null;
  const withPicture = !!file && canShareFile(file);
  const send = async () => {
    if (!cur) return;
    const r = await shareNative(cur);
    if (r === 'shared') { onShared?.(); onClose(); }
    else if (r === 'unsupported') { if (cur.url && (await copyText(cur.url))) { onShared?.(); toast('Link copied'); } }
  };
  const copy = async () => {
    if (!cur?.url) return;
    if (await copyText(cur.url)) { onShared?.(); setCopied(true); setTimeout(() => setCopied(false), 2000); } else toast('Couldn’t copy: hold the link to copy it', 'err');
  };
  const save = () => { if (cur?.blob) { savePicture(cur.blob, cur.file ?? 'super-pools.png'); toast('Saved to your pictures'); } };
  const places = cur?.url ? targets(cur.url, cur.title, cur.text) : [];

  return (
    <Sheet open={open} onClose={onClose} title={heading}>
      <div className="space-y-3">
        {options && options.length > 1 && (
          <div role="tablist" aria-label="What to share" className="scroll-x -mx-1 flex gap-1.5 px-1">
            {options.map((o, i) => (
              <button key={o.key} type="button" role="tab" aria-selected={i === picked} onClick={() => setPicked(i)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition ${i === picked ? 'bg-white text-[#0b1222]' : 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.08]'}`}>{o.label}</button>
            ))}
          </div>
        )}
        {opt?.hint && <p className="text-[12px] text-mute">{opt.hint}</p>}
        {/* the picture, or the words */}
        {(cur?.blob || busy) && (
          <div className="relative mx-auto w-full max-w-[300px] overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10" style={{ aspectRatio: '4 / 5' }}>
            {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Spinner /></div>}
          </div>
        )}
        {cur && !cur.blob && !busy && <p className="rounded-2xl bg-black/25 px-3 py-2.5 text-sm leading-snug text-slate-200 ring-1 ring-white/10">{cur.text}</p>}
        {cur?.url && (
          <div className="flex items-center gap-2 rounded-xl bg-black/30 p-1.5 pl-3 ring-1 ring-white/10">
            <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">{cur.url.replace(/^https?:\/\//, '')}</span>
            <button type="button" onClick={() => void copy()} className="btn-ghost btn-sm shrink-0 px-3!">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" onClick={() => setQr(!qr)} aria-pressed={qr} className="btn-ghost btn-sm shrink-0 px-2.5!" aria-label="QR code"><QrCode className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {qr && cur?.url && (
          <div className="flex items-center gap-3 rounded-2xl bg-white p-3">
            <img src={qrDataUrl(cur.url)} alt={`QR code for ${cur.url}`} className="h-28 w-28 shrink-0" />
            <p className="text-[13px] leading-snug text-slate-700">Point a phone&apos;s camera at it and the page opens. Good for the person across the table.</p>
          </div>
        )}
        {/* the ways to send it */}
        <div className="grid grid-cols-2 gap-2">
          {native && <button type="button" onClick={() => void send()} disabled={!cur || busy} className="btn-gold col-span-2 py-2.5 disabled:opacity-50"><Share2 className="h-4 w-4" />{withPicture ? 'Share the picture…' : onPhone() ? 'Share…' : 'Share with another app…'}</button>}
          {cur?.blob && <button type="button" onClick={save} disabled={busy} className="btn-ghost py-2.5"><Download className="h-4 w-4" />Save the picture</button>}
          {cur?.url && <button type="button" onClick={() => void copy()} className={`btn-ghost py-2.5 ${cur.blob ? '' : 'col-span-2'}`}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Link copied' : 'Copy the link'}</button>}
        </div>
        {places.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {places.map((p) => (
              <a key={p.key} href={p.href} target={p.key === 'messages' || p.key === 'email' ? undefined : '_blank'} rel="noopener noreferrer"
                className="flex items-center justify-center rounded-xl px-2 py-2.5 text-[13px] font-bold text-white ring-1 ring-white/10 hover:brightness-110" style={{ background: p.color }}>{p.name}</a>
            ))}
          </div>
        )}
        {cur?.blob && <p className="text-[11px] leading-snug text-mute">The picture is drawn on your phone and goes only where you send it. Posting it to a story or a group chat with the link under it gets people straight to the page.</p>}
      </div>
    </Sheet>
  );
}
