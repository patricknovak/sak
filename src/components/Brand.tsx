// The league wordmark: the first word in championship gold, the second in tracked silver caps ("SAK" +
// "SUPERLEAGUE" for SaK; whatever the league's brand row says on Super Pools). One component so the
// sidebar, phone header, login screen and TV board all match.
import { useBrand } from '../lib/brand';

// `mark` draws someone else's wordmark (a preview, another league's card) instead of the league on screen
export function Wordmark({ size = 'md', tagline, className = '', mark }: { size?: 'sm' | 'md' | 'lg' | 'xl'; tagline?: string; className?: string; mark?: { a: string; b: string } }) {
  const s = { sm: 'text-xl', md: 'text-2xl', lg: 'text-3xl sm:text-4xl', xl: 'text-6xl' }[size];
  const sub = { sm: 'text-[9px] tracking-[.18em]', md: 'text-[10px] tracking-[.3em]', lg: 'text-sm tracking-[.34em]', xl: 'text-lg tracking-[.38em]' }[size];
  const own = useBrand().wordmark;
  const wordmark = mark ?? own;
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className={`h-display ${s} leading-none`}><span className="text-gold-shine italic">{wordmark.a}</span><span className="text-shine ml-1.5 font-black not-italic">{wordmark.b}</span></span>
      {tagline && <span className={`mt-1 font-bold uppercase text-mute ${sub}`}>{tagline}</span>}
    </span>
  );
}

// stacked version for tight spots (the phone header): SAK on top, SUPERLEAGUE small underneath
export function WordmarkStack({ className = '' }: { className?: string }) {
  const { wordmark } = useBrand();
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className="h-display text-gold-shine text-[22px] italic leading-none">{wordmark.a}</span>
      <span className="text-shine -mt-0.5 text-[8px] font-black uppercase tracking-[.3em]">{wordmark.b}</span>
    </span>
  );
}
