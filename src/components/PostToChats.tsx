// Post the pool in another chat you're in (migration 311, pool_announce): one button per league or pool, each posting
// a card the others there join with one tap. Host and admins only (migration 327); the Invite card hides this for
// everyone else. The first measured week said the league's own GMs are the people most likely to play.
import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { useAction } from './ui';
import { track } from '../lib/analytics';

type Other = { league_id: number; name: string; kind: 'fantasy' | 'predict'; here: boolean };

export function PostToChats() {
  const [others, setOthers] = useState<Other[]>([]);
  const [done, setDone] = useState<Set<number>>(new Set());
  const { busy, run } = useAction();
  useEffect(() => { rpc<Other[]>('my_pools').then((d) => setOthers((d ?? []).filter((p) => !p.here)), () => setOthers([])); }, []);
  if (!others.length) return null;
  // a fantasy league first: that's where the crowd that talks every day is
  const list = [...others].sort((a, b) => Number(a.kind === 'predict') - Number(b.kind === 'predict')).slice(0, 4);
  const post = (o: Other) => run(async () => {
    await rpc('pool_announce', { p_to: o.league_id });
    setDone((s) => new Set(s).add(o.league_id));
    track('invite_share', { via: 'league_chat' });
  }, `Posted in ${o.name}'s chat`);
  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200"><Megaphone className="h-3.5 w-3.5 text-gold" /> Post it where your crew already talks</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {list.map((o) => (
          <button key={o.league_id} type="button" disabled={busy || done.has(o.league_id)} onClick={() => post(o)}
            className={`max-w-full rounded-full px-3 py-1.5 text-left text-xs font-semibold transition ${done.has(o.league_id) ? 'bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30' : 'bg-white/[.07] text-white ring-1 ring-white/15 hover:bg-white/[.12]'}`}>
            {done.has(o.league_id) ? '✓ Posted in ' : 'Post in '}<span className="break-words">{o.name}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-mute">A card with the pool and a Join button, from you, in that chat. Once a day per chat.</p>
    </div>
  );
}
