import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useBrand } from '../lib/brand';
import { useLeague } from '../lib/store';
import { supabase } from '../lib/supabase';
import { ChatPanel } from '../components/ChatPanel';
import { GmPicker } from '../components/GmPicker';
import { CHAT_KINDS, chatKinds, type ChatKind, type ChatWhat } from '../lib/chatFilter';
import type { Message } from '../lib/types';
import { TeamBadge } from '../components/ui';
import { ago } from '../lib/format';
import { IMAGE_BODY } from '../lib/chatMedia';
import { useLounges } from '../lib/lounge';
import { LoungePanel } from '../components/LoungePanel';

// The league chat is one feed (14 October 2026, Patrick): the old channel bar (All, Trash Talk, Draft, Ask the voice,
// a DM per GM) became a filter over every message, by GM and by kind (talk, transactions, bets, the voice, the draft,
// private lines, league news). A link to an old channel (a mention's bell, `?c=`) opens the filter that shows it.
// Above it, the lounges (migration 333): the chats every pool following the same league or show shares, `?lounge=<key>`.
export default function Chat() {
  const brand = useBrand();
  const { me, teams, spectators, league } = useLeague();
  const [params, setParams] = useSearchParams();
  const { lounges } = useLounges();
  const room = lounges?.find((l) => l.key === params.get('lounge')) ?? null;
  const goRoom = (key: string | null) => setParams(key ? new URLSearchParams({ lounge: key }) : new URLSearchParams(), { replace: true });
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
  // a GM's own side by default; "and mentions" adds the league's lines and the voice's posts that name them
  const mentions = params.get('about') === '1';
  // ?m=<id> opens the chat at that message (a search result, a link shared out of the league)
  const jump = Number(params.get('m')) || null;
  const set = (f: ChatWhat, g: number | null, about = false) => {
    const next = new URLSearchParams();
    if (f !== 'all') next.set('f', f);
    if (g) next.set('gm', String(g));
    if (g && about) next.set('about', '1');
    setParams(next, { replace: true });
  };

  // which kinds the league has said anything in lately, so a pool's chat doesn't offer transactions or a draft
  const [present, setPresent] = useState<Set<ChatKind> | null>(null);
  useEffect(() => {
    supabase.from('messages').select('channel,kind,body,meta,team_id,id').not('channel', 'like', 'game:%').order('id', { ascending: false }).limit(400)
      .then(({ data }) => { const s = new Set<ChatKind>(); for (const m of (data ?? []) as Message[]) chatKinds(m).forEach((k) => s.add(k)); setPresent(s); });
  }, []);
  const kinds = CHAT_KINDS.filter((k) => k.k === 'all' || k.k === what || k.k === 'garry' || k.k === 'talk' || !present || present.has(k.k));

  const filter = useMemo(() => ({ what, gm: gm?.id ?? null, mentions }), [what, gm?.id, mentions]);

  // search: every message you can see, newest first (a GM picked and no mentions: only theirs)
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Message[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (!searching || term.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      let r = supabase.from('messages').select('*').not('channel', 'like', 'game:%').eq('deleted', false)
        .ilike('body', `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`).order('id', { ascending: false }).limit(50);
      if (gm && !mentions) r = r.eq('team_id', gm.id);
      r.then(({ data }) => { if (live) setHits((data ?? []) as Message[]); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, searching, gm?.id, mentions]); // eslint-disable-line react-hooks/exhaustive-deps
  // a result opens with the filters cleared, so the message is in view whatever it is
  const open = (id: number) => { setParams(new URLSearchParams({ m: String(id) }), { replace: true }); setSearching(false); };
  const mark = (body: string) => {
    const term = q.trim();
    const i = body.toLowerCase().indexOf(term.toLowerCase());
    if (i < 0 || !term) return body.slice(0, 140);
    const from = Math.max(0, i - 40);
    return <>{from > 0 ? '…' : ''}{body.slice(from, i)}<mark className="rounded bg-gold/30 px-0.5 text-white">{body.slice(i, i + term.length)}</mark>{body.slice(i + term.length, i + term.length + 90)}</>;
  };
  // the chosen kind stays in view when the chips run off the screen (a link straight to transactions, say)
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chips.current, el = row?.querySelector<HTMLElement>('[data-on="1"]');
    if (row && el) row.scrollTo({ left: Math.max(0, el.offsetLeft - row.offsetLeft - 8), behavior: 'smooth' });
  }, [what, kinds.length]);

  return (
    <div className="-mx-3 -my-3 flex h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom)-env(safe-area-inset-top)-var(--banner,0px))] flex-col sm:-mx-5 lg:m-0 lg:h-[calc(100dvh-3rem-var(--banner,0px))]">
      {/* which room: this pool's own chat, or a lounge it shares with every pool following the same league or show */}
      {!!lounges?.length && (
        <div className="scroll-x flex shrink-0 gap-1.5 border-b border-white/[.07] px-2 py-2 lg:mb-2 lg:border-b-0 lg:px-0">
          <button type="button" onClick={() => goRoom(null)} aria-pressed={!room}
            className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm font-bold transition ${!room ? 'bg-gold text-[#0b1220] shadow-[0_8px_20px_-10px_rgb(var(--gold-rgb)/.9)]' : 'border border-white/[.08] bg-white/[.05] text-slate-200'}`}>
            💬 <span className="max-w-[11rem] truncate">{league?.name ?? 'Our chat'}</span>
          </button>
          {lounges.map((l) => (
            <button key={l.key} type="button" onClick={() => goRoom(l.key)} aria-pressed={room?.key === l.key}
              className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm font-bold transition ${room?.key === l.key ? 'bg-white text-ice' : 'border border-white/[.08] bg-white/[.05] text-slate-200'} ${l.here ? '' : 'opacity-70'}`}>
              <span>{l.emoji}</span>{l.name}<span className={`text-[11px] font-semibold ${room?.key === l.key ? 'text-ice/60' : 'text-mute'}`}>lounge</span>
              {l.today > 0 && room?.key !== l.key && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-label="New posts today" />}
            </button>
          ))}
        </div>
      )}
      {room ? (
        <div className="relative flex min-h-0 flex-1 flex-col lg:card lg:overflow-hidden"><LoungePanel key={room.key} lounge={room} /></div>
      ) : (<>
      {/* above the chat below it: the card's blur makes a layer of its own, which hid the GM list on a wide screen */}
      <div className="relative z-20 shrink-0 border-b border-white/[.07] lg:card lg:mb-3 lg:border-b-0">
        <div className="flex items-center gap-1.5 px-2 py-2">
          {/* who: everyone, or one GM (their posts, their DMs with you, and every league line that names them) */}
          <GmPicker value={gm?.id ?? null} onChange={(id) => set(what, id, mentions)} />
          <span className="h-5 w-px shrink-0 bg-white/10" />
          {/* what: one kind of message */}
          <div ref={chips} className={`scroll-x min-w-0 flex-1 gap-1.5 ${searching ? 'hidden' : 'flex'}`}>
            {kinds.map((k) => (
              <button key={k.k} data-on={what === k.k ? '1' : undefined} onClick={() => set(k.k, gm?.id ?? null, mentions)}
                className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${what === k.k ? 'bg-white text-ice shadow-[0_6px_18px_-8px_rgba(255,255,255,.6)]' : 'border border-white/[.07] bg-white/[.05] text-slate-300'}`}>
                <span>{k.k === 'garry' ? brand.bot.emoji : k.icon}</span>{k.label.replace('{bot}', brand.bot.name)}
              </button>
            ))}
          </div>
          {searching && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={gm && !mentions ? `Search ${gm.gm_name}’s messages…` : 'Search the chat…'}
              onKeyDown={(e) => { if (e.key === 'Escape') { setSearching(false); setQ(''); } }}
              className="input h-9 min-w-0 flex-1 py-1 text-sm" />
          )}
          <button type="button" onClick={() => { setSearching(!searching); if (searching) setQ(''); }} aria-label={searching ? 'Close search' : 'Search the chat'}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full transition ${searching ? 'bg-white text-ice' : 'border border-white/[.08] bg-white/[.05] text-slate-200'}`}>
            {searching ? <X size={16} /> : <Search size={16} />}
          </button>
        </div>
        {(gm || what !== 'all') && !searching && (
          <div className="flex items-center gap-2 px-3 pb-2 text-xs text-mute">
            <span className="min-w-0 flex-1 truncate">
              {gm ? `${what === 'all' ? 'All' : kinds.find((k) => k.k === what)?.label.replace('{bot}', brand.bot.name)} ${what === 'private' ? 'with' : mentions ? 'from or about' : 'from'} ${gm.id === me?.id ? 'you' : gm.gm_name}`
                : `Showing ${kinds.find((k) => k.k === what)?.label.replace('{bot}', brand.bot.name).toLowerCase()}`}
            </span>
            {gm && what !== 'private' && (
              <button onClick={() => set(what, gm.id, !mentions)} aria-pressed={mentions}
                className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-semibold transition ${mentions ? 'bg-sky-400/20 text-sky-100 ring-1 ring-sky-400/40' : 'border border-white/10 text-slate-300 hover:bg-white/[.06]'}`}>
                {mentions ? '✓ ' : '+ '}and mentions
              </button>
            )}
            <button onClick={() => set('all', null)} className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 font-semibold text-slate-300 hover:bg-white/[.06]"><X className="h-3 w-3" />Clear</button>
          </div>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col lg:card lg:overflow-hidden">
        <ChatPanel channel="feed" filter={filter} className="flex-1" jump={jump} onJumped={() => { const next = new URLSearchParams(params); next.delete('m'); setParams(next, { replace: true }); }} />
        {searching && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-[#070b16]/[.97] backdrop-blur">
            {q.trim().length < 2 ? (
              <div className="px-6 py-12 text-center text-sm text-mute"><div className="mb-2 text-3xl">🔎</div>Search every message you can see: a player, a trade, a chirp, a word.{gm && !mentions ? ` Only ${gm.gm_name}’s for now.` : ''}</div>
            ) : hits === null ? <div className="py-10 text-center text-sm text-mute">Searching…</div>
              : hits.length === 0 ? <div className="py-10 text-center text-sm text-mute">Nothing says “{q.trim()}”.</div> : (
              <div className="divide-y divide-white/[.06]">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-mute">{hits.length === 50 ? 'The latest 50' : hits.length} {hits.length === 1 ? 'message' : 'messages'}</div>
                {hits.map((h) => {
                  const t = people.find((x) => x.id === h.team_id);
                  return (
                    <button key={h.id} type="button" onClick={() => open(h.id)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[.04]">
                      {t ? <TeamBadge team={t} size={30} /> : <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-emerald-500/20 text-sm">{h.kind === 'bot' ? brand.bot.emoji : '📣'}</span>}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5 text-xs"><b className="truncate">{t?.gm_name ?? (h.kind === 'bot' ? brand.bot.name : 'League')}</b><span className="shrink-0 text-mute">{ago(h.created_at, Date.now())}</span></span>
                        <span className="mt-0.5 block break-words text-sm text-slate-200">{h.body === IMAGE_BODY ? '📷 Photo' : mark(h.body)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </>)}
    </div>
  );
}
