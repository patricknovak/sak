import { useState } from 'react';

// a club's crest, or its short name in a disc while the feed has no logo for it (or the logo won't load)
export interface ClubLike { name: string | null; short?: string | null; logo: string | null }

export function Crest({ c, size = 28 }: { c: ClubLike; size?: number }) {
  const [failed, setFailed] = useState(false);
  const label = c.short || (c.name ?? '?').slice(0, 3).toUpperCase();
  return c.logo && !failed ? <img src={c.logo} alt="" width={size} height={size} onError={() => setFailed(true)} className="shrink-0 object-contain" style={{ width: size, height: size }} />
    : <span className="grid shrink-0 place-items-center rounded-full bg-white/10 text-[10px] font-black text-white" style={{ width: size, height: size }}>{label}</span>;
}
