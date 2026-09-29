import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ago } from '../lib/format';
import type { NewsItem, PlayerEvent } from '../lib/types';

// one timeline per player: ESPN headlines that mention him, plus his NHL team moves (trades, call-ups, waivers)
// and injury-report changes as the site picks them up
export type NewsEntry =
  | { kind: 'headline'; at: string; item: NewsItem }
  | { kind: 'team' | 'injury' | 'lineup'; at: string; item: PlayerEvent };

export function usePlayerNews(id: number | null | undefined, limit = 15) {
  const [items, setItems] = useState<NewsEntry[] | null>(null);
  useEffect(() => {
    setItems(null);
    if (!id) return;
    let live = true;
    Promise.all([
      supabase.from('news').select('*').contains('player_ids', [id]).order('published', { ascending: false }).limit(limit),
      supabase.from('player_events').select('*').eq('player_id', id).order('at', { ascending: false }).limit(limit),
    ]).then(([n, e]) => {
      if (!live) return;
      const out: NewsEntry[] = [
        ...((n.data ?? []) as NewsItem[]).map((item) => ({ kind: 'headline' as const, at: item.published ?? '', item })),
        ...((e.data ?? []) as PlayerEvent[]).map((item) => ({ kind: item.kind, at: item.at, item })),
      ];
      setItems(out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit * 2));
    });
    return () => { live = false; };
  }, [id, limit]);
  return items;
}

const ICON = { team: '🔁', injury: '🩹', lineup: '📋' } as const;

export function NewsLine({ e, images = false }: { e: NewsEntry; images?: boolean }) {
  if (e.kind === 'headline') {
    const n = e.item;
    return (
      <a href={n.url ?? '#'} target="_blank" rel="noreferrer" className="card flex gap-3 p-3">
        {images && n.image && <img src={n.image} alt="" loading="lazy" className="h-16 w-24 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0"><div className="text-sm font-semibold leading-snug">{n.headline}</div>
          {n.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-400">{n.description}</div>}
          <div className="mt-1 text-[11px] text-mute">{n.published ? ago(n.published) : ''} · ESPN</div></div>
      </a>
    );
  }
  return (
    <div className="card flex items-start gap-3 p-3">
      <span className="text-lg leading-none">{ICON[e.kind]}</span>
      <div className="min-w-0"><div className="text-sm font-semibold leading-snug">{e.item.body}</div>
        <div className="mt-1 text-[11px] text-mute">{ago(e.item.at)} · {e.kind === 'team' ? 'NHL roster' : e.kind === 'lineup' ? 'Game day' : 'Injury report'}</div></div>
    </div>
  );
}

export function PlayerNewsList({ items, name, images }: { items: NewsEntry[] | null; name: string; images?: boolean }) {
  if (items === null) return <div className="py-6 text-center text-sm text-mute">Loading news…</div>;
  if (!items.length) return <div className="card p-4 text-sm text-mute">No recent news, trades or injury updates for {name}.</div>;
  return <div className="space-y-2">{items.map((e) => <NewsLine key={`${e.kind}-${e.kind === 'headline' ? e.item.id : e.item.id}`} e={e} images={images} />)}</div>;
}

// the most recent item from the last two weeks, for the top of a player's overview
export function LatestNews({ items, onMore }: { items: NewsEntry[] | null; onMore: () => void }) {
  const e = items?.[0];
  if (!e || Date.now() - new Date(e.at).getTime() > 14 * 86400000) return null;
  const text = e.kind === 'headline' ? e.item.headline : e.item.body;
  return (
    <button onClick={onMore} className="mt-3 flex w-full items-start gap-2 rounded-xl border border-sky-900/60 bg-sky-950/30 p-2.5 text-left text-sm">
      <span>{e.kind === 'headline' ? '📰' : ICON[e.kind]}</span>
      <span className="min-w-0 flex-1"><span className="font-semibold">{text}</span> <span className="text-[11px] text-mute">· {ago(e.at)}</span></span>
      {items!.length > 1 && <span className="shrink-0 text-xs text-sky-300">+{items!.length - 1} more</span>}
    </button>
  );
}
