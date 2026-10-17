// A pool posted in a league's chat (migration 311, pool_announce): the pool's name in its colour, what it plays, how many
// are in, and one tap to join it (the join page, with the pool's preview and its first call) or, for someone already in
// it, to open it. Only pool_announce can write the card (a guard on messages drops a hand-made one).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { openPool } from '../lib/host';

export type PoolCardMeta = { league_id: number; code: string; name: string; what: string | null; members: number; color: string | null; slug: string };

// the pools this account is in, shared by every card in the chat and asked again after a minute (a join, another
// sign-in); a failed ask isn't kept
let mine: { at: number; p: Promise<Set<number>> } | null = null;
const myPools = () => {
  if (!mine || Date.now() - mine.at > 60_000) {
    const p = rpc<{ league_id: number }[]>('my_pools').then((d) => new Set((d ?? []).map((x) => x.league_id)), () => { mine = null; return new Set<number>(); });
    mine = { at: Date.now(), p };
  }
  return mine.p;
};
export const poolCardOf = (meta: Record<string, unknown> | null | undefined): PoolCardMeta | null => {
  const c = meta?.pool_card as Partial<PoolCardMeta> | undefined;
  return c && typeof c.code === 'string' && typeof c.name === 'string' && typeof c.league_id === 'number' ? (c as PoolCardMeta) : null;
};

export function PoolInviteCard({ card, mine: posted }: { card: PoolCardMeta; mine: boolean }) {
  const nav = useNavigate();
  const [inIt, setInIt] = useState<boolean | null>(posted ? true : null);
  useEffect(() => { if (!posted) myPools().then((s) => setInIt(s.has(card.league_id))); }, [posted, card.league_id]);
  const c = card.color && /^#[0-9a-f]{6}$/i.test(card.color) ? card.color : '#f7c548';
  const crest = card.name.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || '🏆';
  return (
    <div className="w-[17rem] max-w-full overflow-hidden rounded-2xl border text-left"
      style={{ borderColor: `${c}55`, background: `linear-gradient(150deg, ${c}2e, rgba(13,21,40,.92) 60%)` }}>
      <div className="flex items-center gap-3 p-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-black" style={{ background: `${c}26`, color: c, boxShadow: `inset 0 0 0 2px ${c}` }}>{crest}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-[.16em]" style={{ color: c }}>A pool to join</div>
          <div className="break-words font-display text-[17px] font-extrabold leading-tight text-white">{card.name}</div>
          {card.what && <div className="mt-0.5 break-words text-xs leading-snug text-slate-300">{card.what}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
        <span className="min-w-0 flex-1 text-xs text-mute">{card.members} {card.members === 1 ? 'player' : 'playing'} · free, no money</span>
        {inIt ? (
          <button type="button" onClick={(e) => { e.stopPropagation(); openPool({ league_id: card.league_id, slug: card.slug }); }} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">Open <ArrowRight size={13} /></button>
        ) : (
          <button type="button" disabled={inIt === null} onClick={(e) => { e.stopPropagation(); nav(`/join/${card.code}`); }} className="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-ice disabled:opacity-60" style={{ background: c }}>Join <ArrowRight size={13} /></button>
        )}
      </div>
    </div>
  );
}
