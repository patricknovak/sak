// Sharing a fan zone (25 October 2026, Patrick: "make it so that it is easy to share with others"; later that day:
// "share in the most epic and amazing fashions"): a link alone goes straight to the phone's own sheet; a share with
// pictures to choose from (the club's verdict, its outlook, its history, the fan's own calls, the pulse) opens the
// share sheet with each one drawn on the phone (src/lib/fanCards.ts) and every way to send it. The links go through the
// app's Worker (worker/fans.ts), so a pasted link shows the page's own picture.
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { onPhone, shareNative, type ShareJob } from '../../lib/share';
import { ShareSheet, type ShareOption } from '../ShareSheet';
import { useToast } from '../ui';

export function ShareButton({ url, title, text, label = 'Share', className = 'btn-ghost btn-sm', options, heading, children }: {
  url: string; title: string; text: string; label?: string; className?: string; options?: ShareOption[]; heading?: string; children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const job: ShareJob = { url, title, text };
  const go = async () => {
    // a plain link on a phone: its own sheet, at once
    if (!options && onPhone()) {
      const r = await shareNative(job);
      if (r === 'shared' || r === 'cancelled') return;
      try { await navigator.clipboard.writeText(url); toast('Link copied'); return; } catch { /* the sheet below has the link */ }
    }
    setOpen(true);
  };
  return (
    <>
      <button type="button" onClick={() => void go()} className={className}><Share2 className="h-3.5 w-3.5" />{children ?? label}</button>
      <ShareSheet open={open} onClose={() => setOpen(false)} job={job} options={options} heading={heading ?? (options ? `Share ${title}` : 'Share')} />
    </>
  );
}

// a small share for a section head: the link to that page, its own words
export function ShareIcon({ url, title, text }: { url: string; title: string; text: string }) {
  return <ShareButton url={url} title={title} text={text} className="btn-ghost btn-sm shrink-0 px-2!" label=""><span className="sr-only">Share {title}</span></ShareButton>;
}
