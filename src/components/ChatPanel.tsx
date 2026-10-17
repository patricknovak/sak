import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import type { Message, Reaction } from '../lib/types';
import { ago, readable } from '../lib/format';
import { TeamBadge, useToast } from './ui';
import { ArrowDown, BarChart3, Copy, Download, ImagePlus, Plus, Reply, SendHorizontal, Share2, Trash2, X } from 'lucide-react';
import { PollCard, PollComposer } from './PollCard';
import { Link } from 'react-router-dom';
import { useBrand } from '../lib/brand';
import { chatMatch, type ChatWhat } from '../lib/chatFilter';
import { IMAGE_BODY, imageOf, shareOut, signedUrl, uploadChatImage, useSignedUrl, type ChatImage } from '../lib/chatMedia';
import { pingTyping, useTyping } from '../lib/typing';
import { PoolInviteCard, poolCardOf } from './PoolInviteCard';

const REACTIONS = ['🔥', '😂', '🤡', '👏', '💀', '🍺', '🚨', '🪣'];
const ASK_GARRY = ['Roast me', 'Trash talk the leader', 'Tell me a joke', 'Who’s winning?', 'How’s my lineup?', 'Who should I pick up?', 'How do trades work?', 'What’s the prize money?', 'When’s the draft?', 'How do keepers work?', 'What’s the scoring?'];
// a prediction pool has no lineups, draft or keepers to ask about
const ASK_POOL = ['Roast me', 'Trash talk the leader', 'Tell me a joke', 'Who’s winning?', 'How does the pool score?'];
// Garry points at pages with "👉 #/path"; those become buttons
const LINK_LABEL: [string, string][] = [['/player/', 'Player page'], ['/team', 'My lineup'], ['/standings', 'Standings'], ['/trades', 'Trades'], ['/players', 'Players'],
  ['/draft?t=keepers', 'Keepers'], ['/draft', 'Draft room'], ['/bets', 'Side bets'], ['/performance', 'Performance'], ['/profile', 'Profile'], ['/nhl?t=injuries', 'Injuries'], ['/nhl', 'NHL centre'], ['/features', 'Features'], ['/money', 'Money'], ['/league', 'Rulebook']];
const linkLabel = (path: string) => LINK_LABEL.find(([p]) => path.startsWith(p))?.[1] ?? 'Open';

const CHIRPS = ['🚨 REACH!', 'Steal of the draft 🥷', 'Enjoy {booby} 🪣', 'Sell me that guy 💰', 'Who? 🤔', 'Lock it in 🔒', 'GG 🍺', 'Scoreboard. 📈', 'Ice cold 🧊', 'Put him on IR, he’s embarrassing you 🚑', 'Cup or bust 🏆', 'Fleeced 🐑'];

// a message's day on the league's clock, for the separators between days
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const dayWords = (key: string, now: number) => {
  const today = dayKey(new Date(now).toISOString());
  const y = dayKey(new Date(now - 86_400_000).toISOString());
  if (key === today) return 'Today';
  if (key === y) return 'Yesterday';
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
};
const URL_RE = /^https?:\/\//;

// a photo in a message: the right shape before it loads, a tap opens it full size
function Photo({ img, onOpen }: { img: ChatImage; onOpen: (url: string) => void }) {
  const url = useSignedUrl(img.path);
  const w = Math.min(260, img.w), ratio = img.w / Math.max(1, img.h);
  return (
    <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); if (url) onOpen(url); }} onKeyDown={(e) => { if (e.key === 'Enter' && url) onOpen(url); }}
      className="relative mb-1 block overflow-hidden rounded-xl bg-white/[.06] ring-1 ring-white/10" style={{ width: w, maxWidth: '100%', aspectRatio: String(Math.max(0.5, Math.min(2.2, ratio))) }}>
      {url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
        : <span className={`absolute inset-0 grid place-items-center text-xs text-mute ${url === undefined ? 'animate-pulse' : ''}`}>{url === null ? 'Photo unavailable' : '📷'}</span>}
    </span>
  );
}

// channel 'all' is the merged feed: every channel this GM can see except the draft room and the game threads, newest
// last; posting from it goes to Trash Talk. A game's thread is channel 'game:<game id>' (GameThread, in the box score).
// Channel 'feed' is the league chat as one feed (14 October 2026): the draft room and private lines too, shown through a
// filter (a kind, a GM, or both, src/lib/chatFilter.ts), and the composer says where a message goes.
// jump: a message to open the chat at (a search result, a shared link), with the ones around it.
export function ChatPanel({ channel, compact, className = '', filter, jump, onJumped }: {
  channel: string; compact?: boolean; className?: string; filter?: { what: ChatWhat; gm: number | null; mentions?: boolean }; jump?: number | null; onJumped?: () => void;
}) {
  const { me, team, teams, can, league, kind } = useLeague();
  const brand = useBrand();
  const bot = brand.bot.name;
  // realtime checks a row's league without this tab's league (the x-league header rides on REST only), so with two
  // pools open another pool's messages would arrive here: a row from another league is dropped on sight
  const lid = league?.league_id ?? null;
  const theirs = (row: { league_id?: number | null } | null | undefined) => lid != null && row?.league_id != null && row.league_id !== lid;
  const chirps = CHIRPS.map((c) => c.replace('{booby}', brand.booby.replace(/^The /, 'the ')));
  const feed = channel === 'feed';
  const all = channel === 'all' || feed;
  const what = feed ? filter?.what ?? 'all' : 'all';
  const gm = feed && filter?.gm != null ? team(filter.gm) ?? null : null;
  const mentions = !!filter?.mentions;
  const dmWith = (id: number) => `dm:${Math.min(id, me?.id ?? 0)}-${Math.max(id, me?.id ?? 0)}`;
  // where a new message goes from the one feed: the filter suggests it (the voice's private line, the draft room, a
  // GM's DM), the composer's "To" changes it; everything else is the league's main room
  const suggested = !feed ? null : what === 'garry' && me ? `garry:${me.id}` : what === 'draft' ? 'draft'
    : what === 'private' && gm && me && gm.id !== me.id && can('dm') ? dmWith(gm.id) : 'general';
  const [to, setTo] = useState<string | null>(suggested);
  useEffect(() => { setTo(suggested); }, [suggested]);
  const postTo = feed ? to ?? 'general' : all ? 'general' : channel;
  const muted = !can('chat') || (postTo.startsWith('dm:') && !can('dm'));
  const now = useNow(30_000);
  const toast = useToast();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [tray, setTray] = useState<'chirps' | 'poll' | null>(null);
  const [older, setOlder] = useState(true);
  // jumped back in time: newer messages exist that aren't loaded (realtime waits until you come back to the latest)
  const [gap, setGap] = useState(false);
  const [lit, setLit] = useState<number | null>(null);
  const [below, setBelow] = useState(0);   // new messages that arrived while you were scrolled up
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; m: Message } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const page = feed ? 150 : 80;
  const loading = useRef(false);
  // which messages this chat reads: the one feed leaves out the game threads (each game's chat lives beside its score),
  // the merged feed the draft room too, a channel only itself
  const base = useCallback(() => {
    const q = supabase.from('messages').select('*');
    return feed ? q.not('channel', 'like', 'game:%') : all ? q.neq('channel', 'draft').not('channel', 'like', 'game:%') : q.eq('channel', channel);
  }, [channel, all, feed]);
  const loadReactions = async (rows: Message[], add: boolean) => {
    if (!rows.length) { if (!add) setReactions([]); return; }
    const { data: rx } = await supabase.from('reactions').select('message_id,team_id,emoji').in('message_id', rows.map((r) => r.id));
    setReactions((r) => [...(add ? r : []), ...((rx ?? []) as Reaction[])]);
  };
  const load = useCallback(async (before?: number) => {
    loading.current = true;
    let q = base().order('id', { ascending: false }).limit(page);
    if (before) q = q.lt('id', before);
    const { data } = await q;
    const rows = ((data ?? []) as Message[]).reverse();
    loading.current = false;
    if (rows.length < page) setOlder(false);
    if (!before) { setGap(false); setBelow(0); }
    setMsgs((m) => (before ? [...rows, ...m] : rows));
    await loadReactions(rows, !!before);
  }, [base, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // open the chat at one message: the 60 before it and what came after (up to 200; more than that leaves a gap)
  const loadAround = useCallback(async (id: number) => {
    loading.current = true;
    const [{ data: b }, { data: a }] = await Promise.all([
      base().lte('id', id).order('id', { ascending: false }).limit(60),
      base().gt('id', id).order('id', { ascending: true }).limit(200),
    ]);
    const rows = [...((b ?? []) as Message[]).reverse(), ...((a ?? []) as Message[])];
    loading.current = false;
    stick.current = false;
    setOlder((b ?? []).length >= 60);
    setGap((a ?? []).length >= 200);
    setMsgs(rows);
    setLit(id);
    await loadReactions(rows, false);
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  const gapRef = useRef(false);
  gapRef.current = gap;
  // the message a jump opened at, kept until the GM heads back to the latest, so a reload (the league arriving late)
  // opens at it again rather than at the newest
  const target = useRef<number | null>(null);
  // whether a new message would show under the filter, for the "new" count (kept current below)
  const showRef = useRef<(m: Message) => boolean>(() => true);
  useEffect(() => {
    setMsgs([]); setReactions([]); setOlder(true); stick.current = true;
    if (target.current) loadAround(target.current);
    else if (!jump) load();
    const ch = realtimeChannel(`chat-${channel}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...(all ? {} : { filter: `channel=eq.${channel}` }) }, (p) => {
        const n = p.new as Message;
        if (theirs(n) || (all && ((!feed && n.channel === 'draft') || n.channel.startsWith('game:')))) return;
        const seen = showRef.current(n);
        if (gapRef.current) { if (seen) setBelow((x) => x + 1); return; }
        if (!stick.current && seen) setBelow((x) => x + 1);
        setMsgs((m) => (m.some((x) => x.id === n.id) ? m : [...m, n]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', ...(all ? {} : { filter: `channel=eq.${channel}` }) }, (p) => {
        if (theirs(p.new as Message)) return;
        setMsgs((m) => m.map((x) => (x.id === (p.new as Message).id ? (p.new as Message) : x)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, (p) => {
        if (p.eventType === 'INSERT' && !theirs(p.new as Reaction)) setReactions((r) => [...r, p.new as Reaction]);
        if (p.eventType === 'DELETE') {
          const o = p.old as Reaction;
          setReactions((r) => r.filter((x) => !(x.message_id === o.message_id && x.team_id === o.team_id && x.emoji === o.emoji)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channel, load, lid]); // eslint-disable-line react-hooks/exhaustive-deps

  // a jump asked for (a search result, a shared link): load around it, then let the caller clear it
  useEffect(() => {
    if (!jump) return;
    target.current = jump;
    const el = document.getElementById(`msg-${jump}`);
    if (el && msgs.some((m) => m.id === jump)) { stick.current = false; setLit(jump); }
    else loadAround(jump);
    onJumped?.();
  }, [jump]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (lit == null) return;
    document.getElementById(`msg-${lit}`)?.scrollIntoView({ block: 'center' });
    const t = setTimeout(() => setLit(null), 2600);
    return () => clearTimeout(t);
  }, [lit, msgs.length]);

  // keep pinned to the bottom unless the user scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current && lit == null) el.scrollTop = el.scrollHeight;
  }, [msgs]); // eslint-disable-line react-hooks/exhaustive-deps
  const toBottom = () => {
    setBelow(0);
    target.current = null;
    if (gap) { stick.current = true; load(); return; }
    stick.current = true;
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  // mark read
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    if (!me || !lastId || gap) return;
    // tell the app shell straight away (the badge), then the server
    const rows = new Map<string, number>();
    if (!all) rows.set(channel, lastId);
    else for (const m of msgs) rows.set(m.channel, Math.max(rows.get(m.channel) ?? 0, m.id));   // the merged feed reads every channel it showed
    for (const [c, id] of rows) window.dispatchEvent(new CustomEvent('sak:read', { detail: { channel: c, id } }));
    supabase.from('chat_reads').upsert([...rows].map(([c, id]) => ({ team_id: me.id, channel: c, last_read_id: id }))).then(() => {});
  }, [lastId, me?.id, channel]); // eslint-disable-line react-hooks/exhaustive-deps

  // a photo picked, taken or pasted: shown above the composer until it goes with the message (or is taken off)
  const pickPhoto = (f: File | null | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Only pictures can go in the chat', 'err'); return; }
    setPhoto((p) => { if (p) URL.revokeObjectURL(p.preview); return { file: f, preview: URL.createObjectURL(f) }; });
  };
  const dropPhoto = () => setPhoto((p) => { if (p) URL.revokeObjectURL(p.preview); return null; });

  const send = async (raw: string) => {
    let body = raw.trim();
    if ((!body && !photo) || !me || sending) return;
    const dest = all && replyTo ? replyTo.channel : postTo;   // replying from the merged feed answers in the message's own channel
    let meta: Record<string, unknown> | null = null;
    if (photo) {
      if (lid == null) return;
      setSending(true);
      try { meta = { image: await uploadChatImage(lid, me.id, photo.file) }; }
      catch (e) { toast((e as Error).message || 'The photo didn’t go up', 'err'); setSending(false); return; }
      if (!body) body = IMAGE_BODY;
    }
    setText(''); setReplyTo(null); setTray(null); stick.current = true;
    const { data, error } = await supabase.from('messages').insert({ channel: dest, team_id: me.id, body, reply_to: replyTo?.id ?? null, ...(meta ? { meta } : {}) }).select().single();
    setSending(false);
    if (error) { toast(error.message, 'err'); setText(raw); return; }
    dropPhoto();
    if (gap) { load(); return; }
    setMsgs((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Message]));
  };

  const react = async (m: Message, emoji: string) => {
    setPicker(null);
    if (!me || muted) return;
    const mine = reactions.some((r) => r.message_id === m.id && r.team_id === me.id && r.emoji === emoji);
    if (mine) {
      setReactions((r) => r.filter((x) => !(x.message_id === m.id && x.team_id === me.id && x.emoji === emoji)));
      await supabase.from('reactions').delete().match({ message_id: m.id, team_id: me.id, emoji });
    } else {
      setReactions((r) => [...r, { message_id: m.id, team_id: me.id, emoji }]);
      await supabase.from('reactions').insert({ message_id: m.id, team_id: me.id, emoji });
    }
  };

  const remove = async (m: Message) => {
    setPicker(null);
    if (confirm('Delete this message?')) await supabase.from('messages').update({ deleted: true, body: '(deleted)' }).eq('id', m.id);
  };

  // a message out of the league, to a group chat or a friend: who said it, what, and a link back to it here
  const linkTo = (m: Message) => `${location.origin}${location.pathname}#/chat?m=${m.id}`;
  const share = async (m: Message, image?: string | null) => {
    setPicker(null);
    const who = m.kind === 'bot' ? bot : m.kind === 'system' ? (league?.name ?? 'The league') : team(m.team_id)?.gm_name ?? 'Someone';
    const body = m.body === IMAGE_BODY ? '' : m.body;
    const how = await shareOut({ title: `${who} in ${league?.name ?? 'the chat'}`, text: body ? `${who}: “${body}”` : `${who} posted a photo`, url: linkTo(m), image });
    if (how === 'copied') toast('Copied: paste it anywhere');
  };
  const copy = async (m: Message) => {
    setPicker(null);
    try { await navigator.clipboard.writeText(m.body); toast('Copied'); } catch { toast('Couldn’t copy', 'err'); }
  };

  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  // a new filter starts at the newest of what it shows
  useEffect(() => {
    if (!feed) return;
    stick.current = true;
    requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; });
  }, [feed, what, gm?.id, mentions]);
  // Escape closes a photo
  useEffect(() => {
    if (!viewer) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewer(null); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [viewer]);
  // what the filter lets through; a sparse filter reaches back on its own until it has a screenful or the start
  const shown = useMemo(() => (feed && (what !== 'all' || gm) ? msgs.filter((m) => chatMatch(m, what, gm, mentions, (id) => byId.get(id))) : msgs), [msgs, feed, what, gm, mentions, byId]);
  showRef.current = (m) => !(feed && (what !== 'all' || gm)) || chatMatch(m, what, gm, mentions, (id) => byId.get(id));
  useEffect(() => {
    if (!feed || shown.length >= 30 || !older || !msgs.length || loading.current) return;
    stick.current = shown.length === 0;
    load(msgs[0].id);
  }, [feed, shown.length, older, msgs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const mention = /@(\w*)$/.exec(text)?.[1];
  const suggestions = mention !== undefined ? [...teams.map((t) => t.gm_name), bot, 'everyone'].filter((n) => n.toLowerCase().startsWith(mention.toLowerCase())) : [];

  // the week's chirp: the post with the most reactions in the last seven days, two at least, pinned over the feed
  const chirp = useMemo(() => {
    if (!feed || what !== 'all' || gm) return null;
    const since = now - 7 * 86_400_000;
    const n = new Map<number, number>();
    for (const r of reactions) n.set(r.message_id, (n.get(r.message_id) ?? 0) + 1);
    let best: { m: Message; n: number } | null = null;
    for (const m of msgs) {
      if (m.kind !== 'user' || m.deleted || Date.parse(m.created_at) < since) continue;
      const k = n.get(m.id) ?? 0;
      if (k >= 2 && (!best || k > best.n)) best = { m, n: k };
    }
    return best;
  }, [feed, what, gm, msgs, reactions, now]);

  // who's typing where this chat shows: the feed shows the main room and the draft room, a channel itself
  const typing = useTyping(lid, (c) => (feed || all ? c === 'general' || (feed && c === 'draft') : c === channel)).filter((id) => id !== me?.id);

  const highlight = (body: string) =>
    body.split(/(👉\s*#\/\S+|@\w+|https?:\/\/[^\s<>"]+)/gu).map((part, i) => part.startsWith('👉')
      ? <Link key={i} to={part.replace(/^👉\s*#/u, '').replace(/[.,!?)]+$/, '')} onClick={(e) => e.stopPropagation()} className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/40 hover:bg-emerald-400/30">👉 {linkLabel(part.replace(/^👉\s*#/u, ''))}</Link>
      : URL_RE.test(part)
      ? <a key={i} href={part.replace(/[.,!?)]+$/, '')} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="break-all font-semibold text-sky-300 underline decoration-sky-300/40 underline-offset-2">{part.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{part.replace(/^https?:\/\/(www\.)?/, '').length > 48 ? '…' : ''}</a>
      : part.startsWith('@')
      ? <span key={i} className={`font-semibold ${me && part.slice(1).toLowerCase() === me.gm_name.toLowerCase() ? 'rounded bg-amber-400/30 px-0.5 text-amber-200' : 'text-sky-300'}`}>{part}</span>
      : <Fragment key={i}>{part}</Fragment>);

  // where a message came from, shown on the merged feed
  const tagOf = (c: string) => {
    if (c === 'general') return { label: 'Trash Talk', cls: 'bg-goal/20 text-rose-200' };
    if (c === 'draft') return { label: 'Draft room', cls: 'bg-amber-400/20 text-amber-200' };
    if (c.startsWith('garry:')) return { label: `Ask ${bot}`, cls: 'bg-emerald-500/20 text-emerald-200' };
    if (c.startsWith('dm:')) { const other = c.slice(3).split('-').map(Number).find((id) => id !== me?.id); return { label: `DM · ${team(other)?.gm_name ?? '?'}`, cls: 'bg-sky-500/20 text-sky-200' }; }
    return { label: c, cls: 'bg-white/10 text-slate-300' };
  };
  // in the one feed the main room needs no label: only the draft room and the private lines say where they are
  const Tag = ({ c }: { c: string }) => { if (!all || (feed && c === 'general')) return null; const t = tagOf(c); return <span className={`rounded px-1 py-px text-[10px] font-semibold ${t.cls}`}>{t.label}</span>; };
  // Garry is "typing" for a bit after someone asks him something
  const isGarry = postTo.startsWith('garry:');
  const roastTarget = useMemo(() => { const others = teams.filter((t) => t.id !== me?.id && t.role !== 'spectator'); return others.length ? others[Math.floor(Math.random() * others.length)].gm_name : null; }, [teams, me?.id]);
  const last = msgs[msgs.length - 1];
  const asked = !!last && last.kind === 'user' && last.team_id === me?.id && (isGarry || new RegExp(`\\b${bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(last.body));
  const [, tick] = useState(0);
  useEffect(() => { if (!asked) return; const t = setTimeout(() => tick((n) => n + 1), 25_000); return () => clearTimeout(t); }, [asked, last?.id]);
  const garryTyping = asked && Date.now() - new Date(last!.created_at).getTime() < 25_000;
  // don't rely on realtime alone for his answer: poll briefly while he's "typing"
  useEffect(() => {
    if (!garryTyping || !last) return;
    const i = setInterval(async () => {
      const { data } = await supabase.from('messages').select('*').eq('channel', postTo).gt('id', last.id).order('id');
      if (data?.length) setMsgs((m) => [...m, ...(data as Message[]).filter((x) => !m.some((y) => y.id === x.id))]);
    }, 3000);
    return () => clearInterval(i);
  }, [garryTyping, last?.id, postTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // the actions under a message once it's tapped: reactions, then reply, copy, share and (your own) delete
  const actions = (m: Message, mine: boolean, image?: ChatImage | null) => picker === m.id && (
    <div className="animate-pop mt-1 flex w-max max-w-[calc(100vw-3.5rem)] flex-wrap items-center gap-1 rounded-2xl border border-white/10 bg-[#16213b]/95 px-2 py-1 shadow-2xl backdrop-blur">
      {m.kind === 'user' && REACTIONS.map((e) => <button key={e} className="text-lg transition hover:scale-125" onClick={() => react(m, e)}>{e}</button>)}
      <span className="mx-0.5 h-5 w-px bg-white/10" />
      {m.kind === 'user' && !muted && <button className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" title="Reply" aria-label="Reply" onClick={() => { setReplyTo(m); setPicker(null); }}><Reply size={15} /></button>}
      {!image && <button className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" title="Copy" aria-label="Copy" onClick={() => copy(m)}><Copy size={14} /></button>}
      <button className="grid h-7 w-7 place-items-center rounded-full text-slate-300 hover:bg-white/10" title="Share to another app" aria-label="Share" onClick={async () => share(m, image ? await signedUrl(image.path) : null)}><Share2 size={14} /></button>
      {mine && !m.deleted && <button className="grid h-7 w-7 place-items-center rounded-full text-red-300 hover:bg-white/10" title="Delete" aria-label="Delete" onClick={() => remove(m)}><Trash2 size={14} /></button>}
    </div>
  );

  let prevDay = '';
  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (stick.current && !gap) setBelow(0); }}>
        {older && msgs.length > 0 && (
          <button className="btn-ghost btn-sm mx-auto mb-2 flex" onClick={() => { stick.current = false; load(msgs[0]?.id); }}>Load older</button>
        )}
        {chirp && (
          <button type="button" onClick={() => { stick.current = false; setLit(chirp.m.id); }}
            className="mx-auto mb-2 flex w-full max-w-md items-center gap-2.5 rounded-2xl border border-gold/30 bg-gradient-to-r from-gold/[.14] via-gold/[.06] to-transparent px-3 py-2 text-left">
            <span className="text-xl">🏆</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-black uppercase tracking-[.16em] text-gold">Chirp of the week</span>
              <span className="block truncate text-sm"><b>{team(chirp.m.team_id)?.gm_name}</b>: {chirp.m.body === IMAGE_BODY ? '📷 a photo' : chirp.m.body}</span>
            </span>
            <span className="num shrink-0 rounded-full bg-white/[.08] px-2 py-0.5 text-xs font-bold">{chirp.n} reactions</span>
          </button>
        )}
        {shown.length === 0 && !isGarry && (!feed || (what === 'all' && !gm)) && <div className="py-10 text-center text-sm text-mute">No messages yet. Fire the first shot. 🏒</div>}
        {feed && shown.length === 0 && !isGarry && (what !== 'all' || gm) && (
          <div className="py-10 text-center text-sm text-mute">{older ? 'Looking further back…' : `Nothing here yet${gm ? ` from ${gm.gm_name}` : ''}.${gm && !mentions ? ' Turn on “and mentions” to see the league’s lines about them.' : ' Try another filter.'}`}</div>
        )}
        {isGarry && shown.length === 0 && (
          <div className="px-3 py-8 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-4xl ring-1 ring-emerald-400/30">🎙️</div>
            <div className="mt-2 font-semibold">Your private line to {bot}</div>
            <div className="mx-auto mt-1 max-w-sm text-sm text-mute">Ask about standings, your lineup, any player, tonight’s games, trades, pickups, the draft, bets, rules or the prize money. Only you can see this. He’s cheeky, but he knows his stuff.</div>
          </div>
        )}
        {shown.map((m, i) => {
          const day = dayKey(m.created_at);
          const sep = day !== prevDay ? (
            <div key={`d-${day}`} className="flex justify-center py-1.5">
              <span className="rounded-full border border-white/10 bg-[#0d1528]/90 px-3 py-0.5 text-[11px] font-bold text-slate-300 shadow backdrop-blur">{dayWords(day, now)}</span>
            </div>
          ) : null;
          const newDay = day !== prevDay;
          prevDay = day;
          const glow = lit === m.id ? 'rounded-2xl ring-2 ring-gold/70 bg-gold/[.08] transition' : '';
          if (m.kind === 'system') {
            const pollId = typeof m.meta?.poll === 'number' ? m.meta.poll : null;
            return (
              <Fragment key={m.id}>{sep}
                <div id={`msg-${m.id}`} className={`flex flex-col items-center py-1 ${glow}`}>
                  <div role="button" tabIndex={0} onClick={() => setPicker(picker === m.id ? null : m.id)} className={`max-w-[92%] cursor-pointer whitespace-pre-line rounded-full border border-white/10 bg-white/[.05] px-3.5 py-1.5 text-center text-xs font-medium text-slate-300 ${compact ? '' : 'sm:text-sm'}`}><Tag c={m.channel} /> {m.body}</div>
                  {pollId != null && <PollCard id={pollId} />}
                  {actions(m, false)}
                </div>
              </Fragment>
            );
          }
          if (m.kind === 'bot') {
            const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
            return (
              <Fragment key={m.id}>{sep}
                <div id={`msg-${m.id}`} className={`flex gap-2 pt-2 ${glow}`}>
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-800 text-sm shadow-[0_4px_14px_-4px_rgba(52,211,153,.9)] ring-1 ring-emerald-300/40">🎙️</div>
                  <div className="max-w-[85%]">
                    <div className="mb-0.5 px-1 text-[11px]"><span className="font-semibold text-emerald-300">{bot}</span> <span className="text-mute">· league bot · {ago(m.created_at, now)}</span> <Tag c={m.channel} /></div>
                    <div role="button" tabIndex={0} onClick={() => setPicker(picker === m.id ? null : m.id)} className="cursor-pointer rounded-2xl rounded-bl-md border border-emerald-400/25 bg-gradient-to-br from-emerald-500/20 to-emerald-900/30 px-3 py-2 text-[15px] leading-snug shadow-[0_8px_24px_-14px_rgba(52,211,153,.8)]">
                      {parent && <div className="mb-1 border-l-2 border-emerald-500/50 pl-2 text-xs opacity-75">{team(parent.team_id)?.gm_name}: {parent.body.slice(0, 80)}</div>}
                      <span className="whitespace-pre-wrap break-words">{highlight(m.body)}</span>
                    </div>
                    {actions(m, false)}
                  </div>
                </div>
              </Fragment>
            );
          }
          const t = team(m.team_id);
          const mine = m.team_id === me?.id;
          const prev = shown[i - 1];
          const grouped = !newDay && prev && prev.kind === 'user' && prev.team_id === m.team_id && prev.channel === m.channel && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const rx = reactions.filter((r) => r.message_id === m.id);
          const counts = REACTIONS.map((e) => ({ e, n: rx.filter((r) => r.emoji === e).length, me: rx.some((r) => r.emoji === e && r.team_id === me?.id), who: rx.filter((r) => r.emoji === e).map((r) => team(r.team_id)?.gm_name).filter(Boolean).join(', ') })).filter((x) => x.n);
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
          const img = m.deleted ? null : imageOf(m.meta, lid);
          const words = img && m.body === IMAGE_BODY ? '' : m.body;
          // a pool posted from its own page (migration 311) shows as a card to join, in place of the bubble
          const pc = m.deleted ? null : poolCardOf(m.meta);
          return (
            <Fragment key={m.id}>{sep}
              <div id={`msg-${m.id}`} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped ? '' : 'pt-2'} ${glow}`}>
                <div className="w-7 shrink-0">{!grouped && !mine && t && <Link to={`/team/${t.id}`} aria-label={t.name}><TeamBadge team={t} size={28} /></Link>}</div>
                <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  {!grouped && !mine && (
                    <div className="mb-0.5 px-1 text-[11px]"><Link to={`/team/${t?.id}`} className="font-semibold hover:underline" style={{ color: readable(t?.color ?? '#888') }}>{t?.gm_name}</Link> <span className="text-mute">· {ago(m.created_at, now)}</span> <Tag c={m.channel} /></div>
                  )}
                  {!grouped && mine && all && <div className="mb-0.5 px-1 text-[11px]"><Tag c={m.channel} /> <span className="text-mute">{ago(m.created_at, now)}</span></div>}
                  {pc ? <div role="button" tabIndex={0} onClick={() => setPicker(picker === m.id ? null : m.id)} onKeyDown={(e) => { if (e.key === 'Enter') setPicker(picker === m.id ? null : m.id); }}><PoolInviteCard card={pc} mine={mine} /></div> : <div role="button" tabIndex={0} onClick={() => setPicker(picker === m.id ? null : m.id)} onKeyDown={(e) => { if (e.key === 'Enter') setPicker(picker === m.id ? null : m.id); }}
                    className={`cursor-pointer rounded-2xl text-left text-[15px] leading-snug transition active:scale-[.98] ${img && !words ? 'p-1' : 'px-3 py-1.5'} ${m.deleted ? 'italic text-mute' : ''} ${mine ? 'rounded-br-md text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]' : 'rounded-bl-md border border-white/[.07] bg-white/[.06]'}`}
                    style={mine ? { background: `linear-gradient(160deg, color-mix(in oklab, ${me?.color} 85%, white 15%), color-mix(in oklab, ${me?.color} 80%, black))`, boxShadow: `0 8px 20px -12px ${me?.color}` } : undefined}>
                    {parent && <div className="mb-1 border-l-2 border-white/40 pl-2 text-xs opacity-75">{team(parent.team_id)?.gm_name}: {parent.body === IMAGE_BODY ? '📷 Photo' : parent.body.slice(0, 80)}</div>}
                    {img && <Photo img={img} onOpen={(url) => setViewer({ url, m })} />}
                    {words && <span className={`whitespace-pre-wrap break-words ${img ? 'block px-2 pb-1' : ''}`}>{highlight(words)}</span>}
                  </div>}
                  {counts.length > 0 && (
                    <div className="-mt-1 flex flex-wrap gap-1 px-1">
                      {counts.map((c) => (
                        <button key={c.e} title={c.who} onClick={() => react(m, c.e)} className={`rounded-full border px-1.5 text-xs ${c.me ? 'border-sky-400 bg-sky-500/20' : 'border-line bg-rink'}`}>{c.e} {c.n}</button>
                      ))}
                    </div>
                  )}
                  {actions(m, mine, img)}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* back to the latest: new messages below while you read back, or a jump that left a gap */}
      {(below > 0 || gap) && (
        <button type="button" onClick={toBottom} className="animate-pop absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full bg-sky-500 px-3 py-1.5 text-xs font-bold text-white shadow-[0_8px_24px_-6px_rgba(14,165,233,.8)]">
          <ArrowDown size={14} />{below > 0 ? `${below} new` : 'Latest'}
        </button>
      )}
      </div>

      {(garryTyping || typing.length > 0) && (
        <div className="flex items-center gap-2 px-4 pb-1 text-xs">
          {garryTyping && <span className="flex items-center gap-1 text-emerald-300"><span className="animate-pulse">🎙️</span> {bot} is typing…</span>}
          {typing.length > 0 && (
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="flex -space-x-1.5">{typing.slice(0, 3).map((id) => { const t = team(id); return t ? <TeamBadge key={id} team={t} size={16} /> : null; })}</span>
              {typing.map((id) => team(id)?.gm_name).filter(Boolean).slice(0, 2).join(' and ')}{typing.length > 2 ? ` and ${typing.length - 2} more` : ''} {typing.length > 1 ? 'are' : 'is'} typing
              <span className="inline-flex gap-0.5"><span className="h-1 w-1 animate-bounce rounded-full bg-slate-300" /><span className="h-1 w-1 animate-bounce rounded-full bg-slate-300 [animation-delay:.15s]" /><span className="h-1 w-1 animate-bounce rounded-full bg-slate-300 [animation-delay:.3s]" /></span>
            </span>
          )}
        </div>
      )}
      <div className="border-t border-white/[.07] bg-[#0b1222]/70 p-2 backdrop-blur-xl">
        {isGarry && !text && (
          <div className="scroll-x mb-1 flex gap-1">
            {[...ASK_GARRY.slice(0, 1), ...(roastTarget ? [`Roast ${roastTarget}`] : []), ...(kind === 'predict' ? ASK_POOL : ASK_GARRY).slice(1)].map((q) => <button key={q} className="chip shrink-0 py-1 text-xs" onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {replyTo && (
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-boards px-2 py-1 text-xs">
            <span className="flex-1 truncate">↩︎ {team(replyTo.team_id)?.gm_name}: {replyTo.body === IMAGE_BODY ? '📷 Photo' : replyTo.body}</span>
            <button onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="scroll-x mb-1 flex gap-1">
            {suggestions.map((s) => <button key={s} className="chip" onClick={() => setText(text.replace(/@\w*$/, '@' + s + ' '))}>@{s}</button>)}
          </div>
        )}
        {feed && me && !replyTo && (
          <div className="scroll-x mb-1.5 flex items-center gap-1.5 text-xs">
            <span className="shrink-0 font-semibold text-mute">To</span>
            {[{ c: 'general', label: '🔥 Everyone', tip: 'The whole league' }, { c: `garry:${me.id}`, label: `🔒 ${bot}`, tip: `Your private line to ${bot}` },
              ...(what === 'draft' || postTo === 'draft' ? [{ c: 'draft', label: '📋 Draft room', tip: 'The draft room' }] : []),
              ...(gm && gm.id !== me.id && can('dm') ? [{ c: dmWith(gm.id), label: `🔒 ${gm.gm_name}`, tip: `Just you and ${gm.gm_name}` }] : [])].map((d) => (
              <button key={d.c} type="button" title={d.tip} onClick={() => setTo(d.c)}
                className={`shrink-0 rounded-full px-2.5 py-1 font-semibold transition ${postTo === d.c ? 'bg-white text-ice' : 'border border-white/[.08] bg-white/[.05] text-slate-300'}`}>{d.label}</button>
            ))}
          </div>
        )}
        {tray === 'poll' && !muted && <PollComposer channel={postTo} onDone={() => setTray(null)} />}
        {tray === 'chirps' && (
          <div className="scroll-x mb-1 flex gap-1">
            {chirps.map((c) => <button key={c} className="chip shrink-0 py-1 text-xs" onClick={() => send(c)}>{c}</button>)}
          </div>
        )}
        {photo && (
          <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.04] p-1.5">
            <img src={photo.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <span className="min-w-0 flex-1 text-xs text-slate-300">{sending ? 'Sending the photo…' : 'Add a caption, or send it as it is'}</span>
            {!sending && <button type="button" onClick={dropPhoto} aria-label="Remove the photo" className="grid h-8 w-8 place-items-center rounded-full text-mute hover:bg-white/10"><X size={16} /></button>}
          </div>
        )}
        {muted ? <div className="rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-center text-sm text-mute">🔇 The commissioner has switched off {postTo.startsWith('dm:') ? 'DMs' : 'chat'} for your spectator pass.</div> : (
        <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          {/* the extras: quick chirps and a poll */}
          <button type="button" className={`btn-ghost h-10 w-10 shrink-0 p-0 transition ${tray ? 'rotate-45 text-sky-300' : ''}`} onClick={() => setTray(tray ? null : 'chirps')} title="Chirps and polls" aria-label="Chirps and polls"><Plus size={20} /></button>
          {tray && !isGarry && !postTo.startsWith('dm:') && <button type="button" className={`btn-ghost h-10 w-10 shrink-0 p-0 ${tray === 'poll' ? 'text-sky-300' : ''}`} onClick={() => setTray(tray === 'poll' ? 'chirps' : 'poll')} title="Start a poll" aria-label="Start a poll"><BarChart3 size={18} /></button>}
          {!isGarry && <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0" onClick={() => fileRef.current?.click()} title="Send a photo" aria-label="Send a photo"><ImagePlus size={19} /></button>}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          <textarea
            className="input max-h-32 min-h-10 min-w-0 flex-1 resize-none py-2 placeholder:truncate" rows={1} value={text} maxLength={2000}
            placeholder={photo ? 'Add a caption…' : replyTo && all ? `Reply in ${tagOf(replyTo.channel).label}…` : isGarry ? `Ask ${bot} anything…` : postTo === 'draft' ? 'Chirp the picks…' : postTo.startsWith('dm:') ? `Message ${gm?.gm_name ?? 'them'} privately…` : all ? `Post, or ask ${bot}…` : channel.startsWith('game:') ? 'Talk about the game…' : `Talk trash, or ask ${bot}…`}
            onChange={(e) => { setText(e.target.value); if (me && e.target.value) pingTyping(me.id, postTo); }}
            onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f && !isGarry) { e.preventDefault(); pickPhoto(f); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
          />
          <button className="btn-primary h-10 w-10 shrink-0 p-0" disabled={(!text.trim() && !photo) || sending} aria-label="Send"><SendHorizontal size={18} /></button>
        </form>)}
      </div>

      {/* a photo full size, with share and save */}
      {viewer && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95 backdrop-blur" onClick={() => setViewer(null)}>
          <div className="pt-safe flex items-center gap-2 px-3 py-2" onClick={(e) => e.stopPropagation()}>
            {team(viewer.m.team_id) && <TeamBadge team={team(viewer.m.team_id)} size={28} />}
            <div className="min-w-0 flex-1 text-sm"><div className="truncate font-semibold">{team(viewer.m.team_id)?.gm_name}</div><div className="text-xs text-mute">{ago(viewer.m.created_at, now)}</div></div>
            <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Share" onClick={() => share(viewer.m, viewer.url)}><Share2 size={18} /></button>
            <a className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Save" href={viewer.url} target="_blank" rel="noopener noreferrer" download><Download size={18} /></a>
            <button type="button" className="grid h-10 w-10 place-items-center rounded-full bg-white/10" aria-label="Close" onClick={() => setViewer(null)}><X size={18} /></button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2"><img src={viewer.url} alt="" className="max-h-full max-w-full rounded-lg object-contain" /></div>
          {viewer.m.body !== IMAGE_BODY && <div className="pb-safe px-4 py-3 text-center text-sm text-slate-200" onClick={(e) => e.stopPropagation()}>{viewer.m.body}</div>}
        </div>
      )}
    </div>
  );
}
