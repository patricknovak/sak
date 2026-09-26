// The SAK Superleague wordmark: "SAK" in championship gold, "SUPERLEAGUE" in tracked silver caps.
// One component so the sidebar, phone header, login screen and TV board all match.
export function Wordmark({ size = 'md', tagline, className = '' }: { size?: 'sm' | 'md' | 'lg' | 'xl'; tagline?: string; className?: string }) {
  const s = { sm: 'text-xl', md: 'text-2xl', lg: 'text-4xl', xl: 'text-6xl' }[size];
  const sub = { sm: 'text-[9px] tracking-[.18em]', md: 'text-[10px] tracking-[.3em]', lg: 'text-sm tracking-[.34em]', xl: 'text-lg tracking-[.38em]' }[size];
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className={`h-display ${s} leading-none`}><span className="text-gold-shine italic">SAK</span><span className="text-shine ml-1.5 font-black not-italic">SUPERLEAGUE</span></span>
      {tagline && <span className={`mt-1 font-bold uppercase text-mute ${sub}`}>{tagline}</span>}
    </span>
  );
}

// stacked version for tight spots (the phone header): SAK on top, SUPERLEAGUE small underneath
export function WordmarkStack({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex flex-col leading-none ${className}`}>
      <span className="h-display text-gold-shine text-[22px] italic leading-none">SAK</span>
      <span className="text-shine -mt-0.5 text-[8px] font-black uppercase tracking-[.3em]">Superleague</span>
    </span>
  );
}
