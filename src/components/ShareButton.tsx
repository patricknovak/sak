// A share button and the pool's look for a share card (src/lib/shareCard.ts): the card is drawn on the phone, then the
// share sheet opens (or the picture is saved where the phone can't share one). Used by the questions, the Table and the
// prop sheet.
import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { useBrand } from '../lib/brand';
import { useLeague } from '../lib/store';
import type { CardBrand } from '../lib/shareCard';
import { useToast } from './ui';

// the pool's look for a share card
export function useCardBrand(): CardBrand {
  const brand = useBrand();
  const { league } = useLeague();
  return { wordmark: brand.wordmark, color: brand.colors?.gold ?? '#f7c548', coin: brand.coin, pool: league?.name ?? brand.short };
}

// a share button: draws the card on the phone, then the share sheet (or a saved picture where the phone can't share one)
export function ShareButton({ label, make, className = 'btn-ghost' }: { label: string; make: () => Promise<unknown>; className?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button type="button" className={`${className} inline-flex items-center justify-center gap-2`} disabled={busy}
      onClick={() => { setBusy(true); make().catch((e: Error) => { if (e?.name !== 'AbortError') toast('Couldn’t draw the picture on this phone. Try a screenshot instead.', 'err'); }).finally(() => setBusy(false)); }}>
      <Share2 className="h-4 w-4" /> {busy ? 'Drawing it…' : label}
    </button>
  );
}

