// A lounge (migration 333): the chat everyone in Super Pools shares for one sports league or show, narrowed in a tap to
// the posts from the caller's own pool. Names show as a first name and an initial; a post from one of the caller's own
// pools says which. A member reports a post (three reports take it down) or takes down their own.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Flag, MoreHorizontal, Send, Trash2, Users } from 'lucide-react';
import { useLeague, useNow } from '../lib/store';
import { rpc } from '../lib/supabase';
import { ago } from '../lib/format';
import { myPosts, useLoungeFeed, type Lounge } from '../lib/lounge';
import { LoadError, Spinner, useToast } from './ui';

// a steady colour per name, so a regular is recognisable at a glance
const HUES = [200, 160, 280, 330, 30, 260, 100, 15];
const hueOf = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];
// "following the NHL", "following Love Is Blind"
const following = (name: string) => (/^(NHL|NFL|NBA|MLB|NWSL|WSL|MLS)$/.test(name) || /League$/.test(name) ? `the ${name}` : name);

export function LoungePanel({ lounge }: { lounge: Lounge }) {
  const { league } = useLeague();
  const toast = useToast();
  const now = useNow(30_000);
  const here = league?.league_id ?? null;
  const { msgs, more, failed, reload, earlier, post, remove, report } = useLoungeFeed(lounge.key);
  const [onlyMine, setOnlyMine] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [admin, setAdmin] = useState(false);
  const [mine, setMine] = useState<Set<number>>(() => myPosts());
  useEffect(() => { rpc<boolean>('is_platform_admin').then((a) => setAdmin(!!a), () => {}); }, []);
  // the caller's pools in this room, by id: a post from one of them says which
  const myPools = useMemo(() => new Map((lounge.pools ?? []).map((p) => [p.id, p.name])), [lounge.pools]);
  const shown = useMemo(() => (msgs ?? []).filter((m) => !onlyMine || m.from_league === here), [msgs, onlyMine, here]);
  const canPost = lounge.here;

  // the newest post stays in view as posts arrive, unless the reader has scrolled up to read
  const box = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => { const el = box.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; }, [shown.length]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try { const id = await post(body); setMine((s) => new Set(s).add(id)); setText(''); pinned.current = true; }
    catch (err) { toast((err as Error).message.replace(/^.*?ERROR:\s*/, ''), 'err'); }
    setSending(false);
  };
  const doReport = async (id: number) => {
    setMenu(null);
    try { const r = await report(id); toast(r === 'removed' ? 'Thanks. That post is down.' : 'Thanks. We’ll take a look.'); }
    catch (err) { toast((err as Error).message, 'err'); }
  };
  const doRemove = async (id: number) => {
    setMenu(null);
    try { await remove(id); toast('Taken down'); } catch (err) { toast((err as Error).message, 'err'); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* the room: whose it is and the filter to your own pool */}
      <div className="shrink-0 border-b border-white/[.07] px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 text-xl ring-1 ring-gold/30">{lounge.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-extrabold leading-tight text-white">The {lounge.name} lounge</div>
            <div className="text-xs leading-snug text-mute">Everyone on Super Pools following {following(lounge.name)}{lounge.today ? ` · ${lounge.today} post${lounge.today === 1 ? '' : 's'} today` : ''}</div>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          {([[false, 'Everyone'], [true, league?.name ? `Just ${league.name}` : 'Just my pool']] as const).map(([v, label]) => (
            <button key={String(v)} type="button" onClick={() => setOnlyMine(v)} aria-pressed={onlyMine === v}
              className={`flex min-w-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold transition ${onlyMine === v ? 'bg-white text-ice' : 'border border-white/[.07] bg-white/[.05] text-slate-300'}`}>
              {v && <Users className="h-3.5 w-3.5 shrink-0" />}<span className="truncate">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div ref={box} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {msgs === null ? <div className="flex justify-center py-10"><Spinner /></div>
          : failed ? <LoadError what="the lounge" onRetry={reload} />
          : shown.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-4xl">{lounge.emoji}</div>
              <div className="mt-2 font-semibold text-white">{onlyMine ? 'Nobody from your pool has posted here yet' : 'Nobody has said a word yet'}</div>
              <div className="mt-1 text-sm text-mute">{canPost ? 'Start it off: a take, a question, a bold call.' : 'It opens to your posts from a pool that follows it.'}</div>
            </div>
          ) : (
            <div className="space-y-3">
              {more && !onlyMine && <button type="button" onClick={earlier} className="mx-auto block rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-white/[.06]">Earlier posts</button>}
              {shown.map((m) => {
                const own = mine.has(m.id);
                const pool = m.from_league === here ? 'Your pool' : myPools.get(m.from_league) ?? null;
                const h = hueOf(m.author);
                return (
                  <div key={m.id} className="group flex items-start gap-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-extrabold text-white"
                      style={{ background: `hsl(${h} 55% 32%)`, boxShadow: `inset 0 0 0 1px hsl(${h} 60% 55% / .45)` }}>{m.author.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                        <b className="text-[13px] text-white">{own ? 'You' : m.author}</b>
                        {pool && <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${m.from_league === here ? 'bg-gold/20 text-gold ring-1 ring-gold/40' : 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30'}`}>{pool}</span>}
                        <span className="text-mute">{ago(m.created_at, now)}</span>
                        <button type="button" onClick={() => setMenu(menu === m.id ? null : m.id)} aria-label="Post options" className="relative ml-auto grid h-7 w-7 place-items-center rounded-full text-mute hover:bg-white/[.06] hover:text-white after:absolute after:-inset-1">
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </div>
                      <div className={`mt-0.5 whitespace-pre-wrap break-words rounded-2xl rounded-tl-md px-3 py-2 text-[15px] leading-snug ${own ? 'bg-gold/[.12] text-white ring-1 ring-gold/25' : 'bg-white/[.05] text-slate-100 ring-1 ring-white/[.06]'}`}>{m.body}</div>
                      {menu === m.id && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {!own && <button type="button" onClick={() => doReport(m.id)} className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/[.06]"><Flag className="h-3.5 w-3.5" />Report</button>}
                          {(own || admin) && <button type="button" onClick={() => doRemove(m.id)} className="flex items-center gap-1 rounded-full border border-red-400/30 px-2.5 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />{own ? 'Delete' : 'Take down'}</button>}
                          <button type="button" onClick={() => setMenu(null)} className="rounded-full px-2.5 py-1 text-xs text-mute">Cancel</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {canPost ? (
        <form onSubmit={send} className="shrink-0 border-t border-white/[.07] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:pb-2">
          <div className="flex items-end gap-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={800} rows={1} placeholder={`Say something to the ${lounge.name} lounge…`}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              className="input max-h-32 min-h-[42px] flex-1 resize-none py-2.5 text-[15px]" />
            <button type="submit" disabled={!text.trim() || sending} aria-label="Post" className="btn-gold grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full p-0">
              {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <div className="mt-1 px-1 text-[11px] text-mute">Seen by everyone following {following(lounge.name)} on Super Pools, as your first name and initial. Keep it friendly.</div>
        </form>
      ) : (
        <div className="shrink-0 border-t border-white/[.07] px-3 py-3 text-center text-xs text-mute">
          You&apos;re here through {(lounge.pools ?? []).map((p) => p.name).join(', ') || 'another pool'}. Switch to it to post.
        </div>
      )}
    </div>
  );
}
