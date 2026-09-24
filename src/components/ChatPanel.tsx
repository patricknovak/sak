import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import type { Message, Reaction } from '../lib/types';
import { ago, readable } from '../lib/format';
import { TeamBadge, useToast } from './ui';
import { SendHorizontal } from 'lucide-react';

const REACTIONS = ['🔥', '😂', '🤡', '👏', '💀', '🍺', '🚨', '🪣'];
const CHIRPS = ['🚨 REACH!', 'Steal of the draft 🥷', 'Enjoy the Peter 🪣', 'Sell me that guy 💰', 'Who? 🤔', 'Lock it in 🔒', 'GG 🍺', 'Scoreboard. 📈'];

export function ChatPanel({ channel, compact, className = '' }: { channel: string; compact?: boolean; className?: string }) {
  const { me, team, teams } = useLeague();
  const now = useNow(30_000);
  const toast = useToast();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<number | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [showChirps, setShowChirps] = useState(false);
  const [older, setOlder] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async (before?: number) => {
    let q = supabase.from('messages').select('*').eq('channel', channel).order('id', { ascending: false }).limit(80);
    if (before) q = q.lt('id', before);
    const { data } = await q;
    const rows = ((data ?? []) as Message[]).reverse();
    if (rows.length < 80) setOlder(false);
    setMsgs((m) => (before ? [...rows, ...m] : rows));
    if (rows.length) {
      const { data: rx } = await supabase.from('reactions').select('message_id,team_id,emoji').in('message_id', rows.map((r) => r.id));
      setReactions((r) => [...(before ? r : []), ...((rx ?? []) as Reaction[])]);
    }
  }, [channel]);

  useEffect(() => {
    setMsgs([]); setReactions([]); setOlder(true); stick.current = true;
    load();
    const ch = realtimeChannel(`chat-${channel}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel=eq.${channel}` }, (p) => {
        setMsgs((m) => (m.some((x) => x.id === (p.new as Message).id) ? m : [...m, p.new as Message]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel=eq.${channel}` }, (p) => {
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
    supabase.from('chat_reads').upsert({ team_id: me.id, channel, last_read_id: lastId }).then(() => {});
  }, [lastId, me?.id, channel]);

  const send = async (body: string) => {
    body = body.trim();
    if (!body || !me) return;
    setText(''); setReplyTo(null); setShowChirps(false); stick.current = true;
    const { data, error } = await supabase.from('messages').insert({ channel, team_id: me.id, body, reply_to: replyTo?.id ?? null }).select().single();
    if (error) { toast(error.message, 'err'); setText(body); return; }
    setMsgs((m) => (m.some((x) => x.id === data.id) ? m : [...m, data as Message]));
  };

  const react = async (m: Message, emoji: string) => {
    setPicker(null);
    if (!me) return;
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
    body.split(/(@\w+)/g).map((part, i) => part.startsWith('@')
      ? <span key={i} className={`font-semibold ${me && part.slice(1).toLowerCase() === me.gm_name.toLowerCase() ? 'rounded bg-amber-400/30 px-0.5 text-amber-200' : 'text-sky-300'}`}>{part}</span>
      : <Fragment key={i}>{part}</Fragment>);

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div ref={scroller} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {older && msgs.length >= 80 && (
          <button className="btn-ghost btn-sm mx-auto mb-2 flex" onClick={() => { stick.current = false; load(msgs[0]?.id); }}>Load older</button>
        )}
        {msgs.length === 0 && <div className="py-10 text-center text-sm text-mute">No messages yet. Fire the first shot. 🏒</div>}
        {msgs.map((m, i) => {
          if (m.kind === 'system') {
            return (
              <div key={m.id} className="flex justify-center py-1">
                <div className={`max-w-[92%] whitespace-pre-line rounded-full border border-white/10 bg-white/[.05] px-3.5 py-1.5 text-center text-xs font-medium text-slate-300 ${compact ? '' : 'sm:text-sm'}`}>{m.body}</div>
              </div>
            );
          }
          if (m.kind === 'bot') {
            const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
            return (
              <div key={m.id} className="flex gap-2 pt-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-300 to-emerald-800 text-sm shadow-[0_4px_14px_-4px_rgba(52,211,153,.9)] ring-1 ring-emerald-300/40">🎙️</div>
                <div className="max-w-[85%]">
                  <div className="mb-0.5 px-1 text-[11px]"><span className="font-semibold text-emerald-300">Garry</span> <span className="text-mute">· league bot · {ago(m.created_at, now)}</span></div>
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
          const grouped = prev && prev.kind === 'user' && prev.team_id === m.team_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
          const rx = reactions.filter((r) => r.message_id === m.id);
          const counts = REACTIONS.map((e) => ({ e, n: rx.filter((r) => r.emoji === e).length, me: rx.some((r) => r.emoji === e && r.team_id === me?.id) })).filter((x) => x.n);
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
          return (
            <div key={m.id} className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''} ${grouped ? '' : 'pt-2'}`}>
              <div className="w-7 shrink-0">{!grouped && !mine && <TeamBadge team={t} size={28} />}</div>
              <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
                {!grouped && !mine && (
                  <div className="mb-0.5 px-1 text-[11px]"><span className="font-semibold" style={{ color: readable(t?.color ?? '#888') }}>{t?.gm_name}</span> <span className="text-mute">· {ago(m.created_at, now)}</span></div>
                )}
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

      <div className="border-t border-white/[.07] bg-[#0b1222]/70 p-2 backdrop-blur-xl">
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
        {showChirps && (
          <div className="scroll-x mb-1 flex gap-1">
            {CHIRPS.map((c) => <button key={c} className="chip shrink-0 py-1 text-xs" onClick={() => send(c)}>{c}</button>)}
          </div>
        )}
        <form className="flex items-end gap-1.5" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <button type="button" className="btn-ghost h-10 w-10 shrink-0 p-0 text-lg" onClick={() => setShowChirps(!showChirps)} title="Quick chirps">🗯️</button>
          <textarea
            className="input max-h-32 min-h-10 flex-1 resize-none py-2" rows={1} value={text} maxLength={2000}
            placeholder={channel === 'draft' ? 'Chirp the picks…' : 'Talk trash…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
          />
          <button className="btn-primary h-10 w-10 shrink-0 p-0" disabled={!text.trim()} aria-label="Send"><SendHorizontal size={18} /></button>
        </form>
      </div>
    </div>
  );
}
