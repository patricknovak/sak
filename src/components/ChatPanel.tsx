import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import type { Message, Reaction } from '../lib/types';
import { ago, readable } from '../lib/format';
import { TeamBadge, useToast } from './ui';
import { BarChart3, SendHorizontal } from 'lucide-react';
import { PollCard, PollComposer } from './PollCard';
import { Link } from 'react-router-dom';

const REACTIONS = ['🔥', '😂', '🤡', '👏', '💀', '🍺', '🚨', '🪣'];
const ASK_GARRY = ['Roast me', 'Trash talk the leader', 'Tell me a joke', 'Who’s winning?', 'How’s my lineup?', 'Who should I pick up?', 'How do trades work?', 'What’s the prize money?', 'When’s the draft?', 'How do keepers work?', 'What’s the scoring?'];
// Garry points at pages with "👉 #/path"; those become buttons
const LINK_LABEL: [string, string][] = [['/player/', 'Player page'], ['/team', 'My lineup'], ['/standings', 'Standings'], ['/trades', 'Trades'], ['/players', 'Players'],
  ['/keepers', 'Keepers'], ['/draft', 'Draft room'], ['/bets', 'Side bets'], ['/profile', 'Profile'], ['/nhl?t=injuries', 'Injuries'], ['/nhl', 'NHL centre'], ['/features', 'Features'], ['/league?t=money', 'Prize money'], ['/league', 'Rulebook']];
const linkLabel = (path: string) => LINK_LABEL.find(([p]) => path.startsWith(p))?.[1] ?? 'Open';

const CHIRPS = ['🚨 REACH!', 'Steal of the draft 🥷', 'Enjoy the Peter 🪣', 'Sell me that guy 💰', 'Who? 🤔', 'Lock it in 🔒', 'GG 🍺', 'Scoreboard. 📈'];

// channel 'all' is the merged feed: every channel this GM can see except the draft room, newest last; posting from it goes to Trash Talk
export function ChatPanel({ channel, compact, className = '' }: { channel: string; compact?: boolean; className?: string }) {
  const { me, team, teams, can } = useLeague();
  const all = channel === 'all';
  const postTo = all ? 'general' : channel;
  const muted = !can('chat') || (channel.startsWith('dm:') && !can('dm'));
  const now = useNow(30_000);
  const toast = useToast();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showChirps, setShowChirps] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [older, setOlder] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async (before?: number) => {
    let q = supabase.from('messages').select('*').order('id', { ascending: false }).limit(80);
    q = all ? q.neq('channel', 'draft') : q.eq('channel', channel);
    if (before) q = q.lt('id', before);
    const { data } = await q;
    const rows = ((data ?? []) as Message[]).reverse();
    if (rows.length < 80) setOlder(false);
    setMsgs((m) => (before ? [...rows, ...m] : rows));
    if (rows.length) {
      const { data: rx } = await supabase.from('reactions').select('message_id,team_id,emoji').in('message_id', rows.map((r) => r.id));
      setReactions((r) => [...(before ? r : []), ...((rx ?? []) as Reaction[])]);
    }
  }, [channel, all]);

  useEffect(() => {
    setMsgs([]); setReactions([]); setOlder(true); stick.current = true;
    load();
    const ch = realtimeChannel(`chat-${channel}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', ...(all ? {} : { filter: `channel=eq.${channel}` }) }, (p) => {
        const n = p.new as Message;
        if (all && n.channel === 'draft') return;
        setMsgs((m) => (m.some((x) => x.id === n.id) ? m : [...m, n]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', ...(all ? {} : { filter: `channel=eq.${channel}` }) }, (p) => {
        setMsgs((m) => m.map((x) => (x.id === (p.new as Message).id ? (p.new as Message) : x)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reactions' }, (p) => {
        if (p.eventType === 'INSERT') setReactions((r) => [...r, p.new as Reaction]);
        if (p.eventType === 'DELETE') {
          const o = p.old as Reaction;
          setReactions((r) => r.filter((x) => !(x.message_id === o.message_id && x.team_id === o.team_id && x.emoji === o.emoji)));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channel, load]);

  // keep pinned to the bottom unless the user scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // mark read
  const lastId = msgs[msgs.length - 1]?.id;
  useEffect(() => {
    if (!me || !lastId) return;
    // tell the app shell straight away (the badge), then the server
    const rows = new Map<string, number>();
    if (!all) rows.set(channel, lastId);
    else for (const m of msgs) rows.set(m.channel, Math.max(rows.get(m.channel) ?? 0, m.id));   // the merged feed reads every channel it showed
    for (const [c, id] of rows) window.dispatchEvent(new CustomEvent('sak:read', { detail: { channel: c, id } }));
    supabase.from('chat_reads').upsert([...rows].map(([c, id]) => ({ team_id: me.id, channel: c, last_read_id: id }))).then(() => {});
  }, [lastId, me?.id, channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (body: string) => {
    body = body.trim();
    if (!body || !me) return;
    setText(''); setReplyTo(null); setShowChirps(false); stick.current = true;
    const dest = all && replyTo ? replyTo.channel : postTo;   // replying from the merged feed answers in the message's own channel
    const { data, error } = await supabase.from('messages').insert({ channel: dest, team_id: me.id, body, reply_to: replyTo?.id ?? null }).select().single();
    if (error) { toast(error.message, 'err'); setText(body); return; }
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

  const byId = useMemo(() => new Map(msgs.map((m) => [m.id, m])), [msgs]);
  const mention = /@(\w*)$/.exec(text)?.[1];
  const suggestions = mention !== undefined ? [...teams.map((t) => t.gm_name), 'Garry', 'everyone'].filter((n) => n.toLowerCase().startsWith(mention.toLowerCase())) : [];

  const highlight = (body: string) =>
    body.split(/(👉\s*#\/\S+|@\w+)/gu).map((part, i) => part.startsWith('👉')
      ? <Link key={i} to={part.replace(/^👉\s*#/u, '').replace(/[.,!?)]+$/, '')} className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs font-bold text-emerald-200 ring-1 ring-inset ring-emerald-400/40 hover:bg-emerald-400/30">👉 {linkLabel(part.replace(/^👉\s*#/u, ''))}</Link>
      : part.startsWith('@')
      ? <span key={i} className={`font-semibold ${me && part.slice(1).toLowerCase() === me.gm_name.toLowerCase() ? 'rounded bg-amber-400/30 px-0.5 text-amber-200' : 'text-sky-300'}`}>{part}</span>
      : <Fragment key={i}>{part}</Fragment>);

  // where a message came from, shown on the merged feed
  const tagOf = (c: string) => {
    if (c === 'general') return { label: 'Trash Talk', cls: 'bg-goal/20 text-rose-200' };
    if (c.startsWith('garry:')) return { label: 'Ask Garry', cls: 'bg-emerald-500/20 text-emerald-200' };
    if (c.startsWith('dm:')) { const other = c.slice(3).split('-').map(Number).find((id) => id !== me?.id); return { label: `DM · ${team(other)?.gm_name ?? '?'}`, cls: 'bg-sky-500/20 text-sky-200' }; }
    return { label: c, cls: 'bg-white/10 text-slate-300' };
  };
  const Tag = ({ c }: { c: string }) => { if (!all) return null; const t = tagOf(c); return <span className={`rounded px-1 py-px text-[10px] font-semibold ${t.cls}`}>{t.label}</span>; };
  // Garry is "typing" for a bit after someone asks him something
  const isGarry = channel.startsWith('garry:');
  const roastTarget = useMemo(() => { const others = teams.filter((t) => t.id !== me?.id && t.role !== 'spectator'); return others.length ? others[Math.floor(Math.random() * others.length)].gm_name : null; }, [teams, me?.id]);
  const last = msgs[msgs.length - 1];
  const asked = !!last && last.kind === 'user' && last.team_id === me?.id && (isGarry || /\bgarry\b/i.test(last.body));
  const [, tick] = useState(0);
  useEffect(() => { if (!asked) return; const t = setTimeout(() => tick((n) => n + 1), 25_000); return () => clearTimeout(t); }, [asked, last?.id]);
  const garryTyping = asked && Date.now() - new Date(last!.created_at).getTime() < 25_000;
  // don't rely on realtime alone for his answer: poll briefly while he's "typing"
  useEffect(() => {
    if (!garryTyping || !last) return;
    const i = setInterval(async () => {
      const { data } = await supabase.from('messages').select('*').eq('channel', channel).gt('id', last.id).order('id');
      if (data?.length) setMsgs((m) => [...m, ...(data as Message[]).filter((x) => !m.some((y) => y.id === x.id))]);
    }, 3000);
    return () => clearInterval(i);
  }, [garryTyping, last?.id, channel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div ref={scroller} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {older && msgs.length >= 80 && (
          <button className="btn-ghost btn-sm mx-auto mb-2 flex" onClick={() => { stick.current = false; load(msgs[0]?.id); }}>Load older</button>
        )}
        {msgs.length === 0 && !isGarry && <div className="py-10 text-center text-sm text-mute">No messages yet. Fire the first shot. 🏒</div>}
        {isGarry && msgs.length === 0 && (
          <div className="px-3 py-8 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-4xl ring-1 ring-emerald-400/30">🎙️</div>
            <div className="mt-2 font-semibold">Your private line to Garry</div>
            <div className="mx-auto mt-1 max-w-sm text-sm text-mute">Ask about standings, your lineup, any player, tonight’s games, trades, pickups, the draft, bets, rules or the prize money. Only you can see this. He’s cheeky, but he knows his stuff.</div>
          </div>
        )}
        {msgs.map((m, i) => {
          if (m.kind === 'system') {
            const pollId = typeof m.meta?.poll === 'number' ? m.meta.poll : null;
            return (
              <div key={m.id} className="flex flex-col items-center py-1">
                <div className={`max-w-[92%] whitespace-pre-line rounded-full border border-white/10 bg-white/[.05] px-3.5 py-1.5 text-center text-xs font-medium text-slate-300 ${compact ? '' : 'sm:text-sm'}`}><Tag c={m.channel} /> {m.body}</div>
                {pollId != null && <PollCard id={pollId} />}
              </div>
            );
          }
          if (m.kind === 'bot') {
            const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
            return (
              <div key={m.id} className="flex gap-2 pt-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-800 text-sm shadow-[0_4px_14px_-4px_rgba(52,211,153,.9)] ring-1 ring-emerald-300/40">🎙️</div>
                <div className="max-w-[85%]">
                  <div className="mb-0.5 px-1 text-[11px]"><span className="font-semibold text-emerald-300">Garry</span> <span className="text-mute">· league bot · {ago(m.created_at, now)}</span> <Tag c={m.channel} /></div>
                  <div className="rounded-2xl rounded-bl-md border border-emerald-400/25 bg-gradient-to-br from-emerald-500/20 to-emerald-900/30 px-3 py-2 text-[15px] leading-snug shadow-[0_8px_24px_-14px_rgba(52,211,153,.8)]">
                    {parent && <div className="mb-1 border-l-2 border-emerald-500/50 pl-2 text-xs opacity-75">{team(parent.team_id)?.gm_name}: {parent.body.slice(0, 80)}</div>}
                    <span className="whitespace-pre-wrap break-words">{highlight(m.body)}</span>
                  </div>
                </div>
              </div>
            );
          }
          const t = team(m.team_id);
          const mine = m.team_id === me?.id;
          const prev = msgs[i - 1];
          const grouped = prev && prev.kind === 'user' && prev.team_id === m.team_id && prev.channel === m.channel && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const rx = reactions.filter((r) => r.message_id === m.id);
          const counts = REACTIONS.map((e) => ({ e, n: rx.filter((r) => r.emoji === e).length, me: rx.some((r) => r.emoji === e && r.team_id === me?.id) })).filter((x) => x.n);
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped ? '' : 'pt-2'}`}>
              <div className="w-7 shrink-0">{!grouped && !mine && t && <Link to={`/team/${t.id}`} aria-label={t.name}><TeamBadge team={t} size={28} /></Link>}</div>
              <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!grouped && !mine && (
                  <div className="mb-0.5 px-1 text-[11px]"><Link to={`/team/${t?.id}`} className="font-semibold hover:underline" style={{ color: readable(t?.color ?? '#888') }}>{t?.gm_name}</Link> <span className="text-mute">· {ago(m.created_at, now)}</span> <Tag c={m.channel} /></div>
                )}
                {!grouped && mine && all && <div className="mb-0.5 px-1 text-[11px]"><Tag c={m.channel} /> <span className="text-mute">{ago(m.created_at, now)}</span></div>}
                <button onClick={() => setPicker(picker === m.id ? null : m.id)}
                  className={`rounded-2xl px-3 py-1.5 text-left text-[15px] leading-snug transition active:scale-[.98] ${m.deleted ? 'italic text-mute' : ''} ${mine ? 'rounded-br-md text-white shadow-[inset_0_1px_0_rgba(255,255,255,.2)]' : 'rounded-bl-md border border-white/[.07] bg-white/[.06]'}`}
                  style={mine ? { background: `linear-gradient(160deg, color-mix(in oklab, ${me?.color} 85%, white 15%), color-mix(in oklab, ${me?.color} 80%, black))`, boxShadow: `0 8px 20px -12px ${me?.color}` } : undefined}>
                  {parent && <div className="mb-1 border-l-2 border-white/40 pl-2 text-xs opacity-75">{team(parent.team_id)?.gm_name}: {parent.body.slice(0, 80)}</div>}
                  <span className="whitespace-pre-wrap break-words">{highlight(m.body)}</span>
                </button>
                {counts.length > 0 && (
                  <div className="-mt-1 flex flex-wrap gap-1 px-1">
                    {counts.map((c) => (
                      <button key={c.e} onClick={() => react(m, c.e)} className={`rounded-full border px-1.5 text-xs ${c.me ? 'border-sky-400 bg-sky-500/20' : 'border-line bg-rink'}`}>{c.e} {c.n}</button>
                    ))}
                  </div>
                )}
                {picker === m.id && (
                  <div className="animate-pop mt-1 flex items-center gap-1 rounded-full border border-white/10 bg-[#16213b]/95 px-2 py-1 shadow-2xl backdrop-blur">
                    {REACTIONS.map((e) => <button key={e} className="text-lg transition hover:scale-125" onClick={() => react(m, e)}>{e}</button>)}
                    <button className="ml-1 text-xs text-mute" onClick={() => { setReplyTo(m); setPicker(null); }}>↩︎</button>
                    {mine && !m.deleted && <button className="ml-1 text-xs text-red-300" onClick={() => remove(m)}>🗑</button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {garryTyping && (
        <div className="flex items-center gap-2 px-4 pb-1 text-xs text-emerald-300"><span className="animate-pulse">🎙️</span> Garry is typing…</div>
      )}
      <div className="border-t border-white/[.07] bg-[#0b1222]/70 p-2 backdrop-blur-xl">
        {isGarry && !text && (
          <div className="scroll-x mb-1 flex gap-1">
            {[...ASK_GARRY.slice(0, 1), ...(roastTarget ? [`Roast ${roastTarget}`] : []), ...ASK_GARRY.slice(1)].map((q) => <button key={q} className="chip shrink-0 py-1 text-xs" onClick={() => send(q)}>{q}</button>)}
          </div>
        )}
        {replyTo && (
          <div className="mb-1 flex items-center gap-2 rounded-lg bg-boards px-2 py-1 text-xs">
            <span className="flex-1 truncate">↩︎ {team(replyTo.team_id)?.gm_name}: {replyTo.body}</span>
            <button onClick={() => setReplyTo(null)}>✕</button>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="scroll-x mb-1 flex gap-1">
            {suggestions.map((s) => <button key={s} className="chip" onClick={() => setText(text.replace(/@\w*$/, '@' + s + ' '))}>@{s}</button>)}
          </div>
        )}
        {showPoll && !muted && <PollComposer channel={postTo} onDone={() => setShowPoll(false)} />}
        {showChirps && (
          <div className="scroll-x mb-1 flex gap-1">
            {CHIRPS.map((c) => <button key={c} className="chip shrink-0 py-1 text-xs" onClick={() => send(c)}>{c}</button>)}
          </div>
        )}
        {muted ? <div className="rounded-xl border border-white/10 bg-white/[.04] px-3 py-2.5 text-center text-sm text-mute">🔇 The commissioner has switched off {channel.startsWith('dm:') ? 'DMs' : 'chat'} for your spectator pass.</div> : (
        <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0 text-lg" onClick={() => setShowChirps(!showChirps)} title="Quick chirps">🗯️</button>
          {!isGarry && !channel.startsWith('dm:') && <button type="button" className={`btn-ghost h-10 w-10 shrink-0 p-0 ${showPoll ? 'text-sky-300' : ''}`} onClick={() => setShowPoll(!showPoll)} title="Start a poll"><BarChart3 size={18} /></button>}
          <textarea
            className="input max-h-32 min-h-10 flex-1 resize-none py-2" rows={1} value={text} maxLength={2000}
            placeholder={isGarry ? 'Ask Garry anything…' : channel === 'draft' ? 'Chirp the picks…' : all ? (replyTo ? `Reply in ${tagOf(replyTo.channel).label}…` : 'Post to Trash Talk… (say “Garry” to ask him something)') : 'Talk trash… (say “Garry” to ask him something)'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
          />
          <button className="btn-primary h-10 w-10 shrink-0 p-0" disabled={!text.trim()} aria-label="Send"><SendHorizontal size={18} /></button>
        </form>)}
      </div>
    </div>
  );
}
