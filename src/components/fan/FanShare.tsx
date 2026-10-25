// Sharing a fan zone (25 October 2026, Patrick: "make it so that it is easy to share with others"): the phone's own share
// sheet where there is one, else a sheet of the usual places (X, Reddit, Facebook, WhatsApp, email) and a copied link.
// The links go through the app's Worker (worker/fans.ts), so a pasted link shows the club's own picture.
import { useState } from 'react';
import { Check, Copy, Mail, Share2 } from 'lucide-react';
import { shareLink } from '../../lib/fanVoice';
import { Sheet, useToast } from '../ui';

const enc = encodeURIComponent;

export function ShareButton({ url, title, text, label = 'Share', className = 'btn-ghost btn-sm' }: { url: string; title: string; text: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const go = async () => {
    // a phone's own sheet first; a desktop gets ours
    if (typeof navigator.share === 'function' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      const r = await shareLink(url, title, text);
      if (r !== 'none') { if (r === 'copied') toast('Link copied'); return; }
    }
    setOpen(true);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { toast('Couldn’t copy: hold the link to copy it', 'err'); }
  };
  const places: [string, string, string][] = [
    ['X', `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`, '#000000'],
    ['Reddit', `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`, '#ff4500'],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`, '#1877f2'],
    ['WhatsApp', `https://wa.me/?text=${enc(`${text} ${url}`)}`, '#25d366'],
  ];
  return (
    <>
      <button type="button" onClick={() => void go()} className={className}><Share2 className="h-3.5 w-3.5" />{label}</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Share">
        <div className="space-y-3">
          <p className="text-sm text-slate-300">{text}</p>
          <div className="flex items-center gap-2 rounded-xl bg-black/30 p-1.5 pl-3 ring-1 ring-white/10">
            <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">{url}</span>
            <button type="button" onClick={() => void copy()} className="btn-club btn-sm shrink-0 px-3!">{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? 'Copied' : 'Copy'}</button>
          </div>
          <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-5">
            {places.map(([name, href, bg]) => (
              <a key={name} href={href} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-sm font-bold text-white ring-1 ring-white/10 hover:brightness-110" style={{ background: bg }}>{name}</a>
            ))}
            <a href={`mailto:?subject=${enc(title)}&body=${enc(`${text}\n\n${url}`)}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-white/[.08] px-2 py-2.5 text-sm font-bold text-white ring-1 ring-white/10 hover:bg-white/[.12]"><Mail className="h-4 w-4" />Email</a>
          </div>
        </div>
      </Sheet>
    </>
  );
}
