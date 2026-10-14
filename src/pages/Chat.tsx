import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useBrand } from '../lib/brand';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { ChatPanel } from '../components/ChatPanel';
import { GmPicker } from '../components/GmPicker';
import { CHAT_KINDS, chatKinds, type ChatKind, type ChatWhat } from '../lib/chatFilter';
import type { Message } from '../lib/types';

// The league chat is one feed (14 October 2026, Patrick): the old channel bar (All, Trash Talk, Draft, Ask the voice,
// a DM per GM) became a filter over every message, by GM and by kind (talk, transactions, bets, the voice, the draft,
// private lines, league news). A link to an old channel (a mention's bell, `?c=`) opens the filter that shows it.
export default function Chat() {
  const brand = useBrand();
  const { me, teams, spectators } = useLeague();
  const [params, setParams] = useSearchParams();
  const people = [...teams, ...spectators];

  // the old channel links become the filter that shows them
  useEffect(() => {
    const c = params.get('c');
    if (!c) return;
    const next = new URLSearchParams();
    if (c.startsWith('garry:')) next.set('f', 'garry');
    else if (c === 'draft') next.set('f', 'draft');
    else if (c.startsWith('dm:')) { const other = c.slice(3).split('-').map(Number).find((id) => id !== me?.id); next.set('f', 'private'); if (other) next.set('gm', String(other)); }
    setParams(next, { replace: true });
  }, [params.get('c'), me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const what = (CHAT_KINDS.some((k) => k.k === params.get('f')) ? params.get('f') : 'all') as ChatWhat;
  const gmId = Number(params.get('gm')) || null;
  const gm = people.find((t) => t.id === gmId) ?? null;
  const set = (f: ChatWhat, g: number | null) => {
    const next = new URLSearchParams();
    if (f !== 'all') next.set('f', f);
    if (g) next.set('gm', String(g));
    setParams(next, { replace: true });
  };

  // which kinds the league has said anything in lately, so a pool's chat doesn't offer transactions or a draft
  const [present, setPresent] = useState<Set<ChatKind> | null>(null);
  useEffect(() => {
    supabase.from('messages').select('channel,kind,body,meta,team_id,id').not('channel', 'like', 'game:%').order('id', { ascending: false }).limit(400)
      .then(({ data }) => { const s = new Set<ChatKind>(); for (const m of (data ?? []) as Message[]) chatKinds(m).forEach((k) => s.add(k)); setPresent(s); });
  }, []);
  const kinds = CHAT_KINDS.filter((k) => k.k === 'all' || k.k === what || k.k === 'garry' || k.k === 'talk' || !present || present.has(k.k));

  const filter = useMemo(() => ({ what, gm: gm?.id ?? null }), [what, gm?.id]);
  // the chosen kind stays in view when the chips run off the screen (a link straight to transactions, say)
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chips.current, el = row?.querySelector<HTMLElement>('[data-on="1"]');
    if (row && el) row.scrollTo({ left: Math.max(0, el.offsetLeft - row.offsetLeft - 8), behavior: 'smooth' });
  }, [what, kinds.length]);

  return (
    <div className="-mx-3 -my-3 flex h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)-var(--banner,0px))] flex-col sm:-mx-5 lg:m-0 lg:h-[calc(100dvh-3rem-var(--banner,0px))]">
      <div className="relative shrink-0 border-b border-white/[.07] lg:card lg:mb-3 lg:border-b-0">
        <div className="flex items-center gap-1.5 px-2 py-2">
          {/* who: everyone, or one GM (their posts, their DMs with you, and every league line that names them) */}
          <GmPicker value={gm?.id ?? null} onChange={(id) => set(what, id)} />
          <span className="h-5 w-px shrink-0 bg-white/10" />
          {/* what: one kind of message */}
          <div ref={chips} className="scroll-x flex min-w-0 flex-1 gap-1.5">
            {kinds.map((k) => (
              <button key={k.k} data-on={what === k.k ? '1' : undefined} onClick={() => set(k.k, gm?.id ?? null)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${what === k.k ? 'bg-white text-ice shadow-[0_6px_18px_-8px_rgba(255,255,255,.6)]' : 'border border-white/[.07] bg-white/[.05] text-slate-300'}`}>
                <span>{k.k === 'garry' ? brand.bot.emoji : k.icon}</span>{k.label.replace('{bot}', brand.bot.name)}
              </button>
            ))}
          </div>
        </div>
        {(gm || what !== 'all') && (
          <div className="flex items-center gap-2 px-3 pb-2 text-xs text-mute">
            <span className="min-w-0 flex-1 truncate">
              Showing {what === 'all' ? 'everything' : kinds.find((k) => k.k === what)?.label.replace('{bot}', brand.bot.name).toLowerCase()}
              {gm ? ` ${what === 'private' ? 'with' : 'from or about'} ${gm.id === me?.id ? 'you' : gm.gm_name}` : ''}
            </span>
            <button onClick={() => set('all', null)} className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 font-semibold text-slate-300 hover:bg-white/[.06]"><X className="h-3 w-3" />Clear</button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:card lg:overflow-hidden">
        <ChatPanel channel="feed" filter={filter} className="flex-1" />
      </div>
    </div>
  );
}
