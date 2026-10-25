// A share button and the pool's look for a share card (src/lib/shareCard.ts): the card is drawn on the phone and shown
// in the share sheet (src/components/ShareSheet.tsx) with every way to send it. Used by the questions, the Table, the
// prop sheet and every pool kind's "share my picks".
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useBrand } from '../lib/brand';
import { useLeague } from '../lib/store';
import type { CardBrand } from '../lib/shareCard';
import type { ShareJob } from '../lib/share';
import { ShareSheet } from './ShareSheet';
import { useToast } from './ui';

// the pool's look for a share card
export function useCardBrand(): CardBrand {
  const brand = useBrand();
  const { league } = useLeague();
  return { wordmark: brand.wordmark, color: brand.colors?.gold ?? '#f7c548', coin: brand.coin, pool: league?.name ?? brand.short };
}

// a share button: draws the card on the phone (`make` gives the job: the picture, the words, the link), then the sheet
export function ShareButton({ label, make, className = 'btn-ghost', heading }: { label: string; make: () => Promise<ShareJob | null | undefined | void> | ShareJob | null; className?: string; heading?: string }) {
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<ShareJob | null>(null);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    try {
      const j = await make();
      if (j) setJob(j);
    } catch (e) { if ((e as Error)?.name !== 'AbortError') toast('Couldn’t draw the picture on this phone. Try a screenshot instead.', 'err'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className={`${className} inline-flex items-center justify-center gap-2`} disabled={busy} onClick={() => void go()}>
        <Share2 className="h-4 w-4" /> {busy ? 'Drawing it…' : label}
      </button>
      <ShareSheet open={!!job} onClose={() => setJob(null)} job={job} heading={heading ?? label} />
    </>
  );
}
