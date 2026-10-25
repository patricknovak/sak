// The fans' board and knowledge base (migration 337, 25 October 2026): ideas, questions, insights and fixes, voted up
// or down, and the facts fans add about the club and the league. Anyone reads; a post, a vote or a report needs a fan's
// account (useVoice().ask opens the sign-in). A platform admin marks a fact checked or a fix made, with a note, and takes
// down what breaks the rules; three reports take a post down on their own.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Flag, Link2, Plus, Share2, ShieldCheck, Trash2 } from 'lucide-react';
import {
  KINDS, dirName, fanBoard, fanModerate, fanPost, fanRemove, fanReport, fanVote, shareLink, topicsFor, zoneLink,
  type FanKind, type FanPost, type Sort,
} from '../../lib/fanVoice';
import { supabase } from '../../lib/supabase';
import { useNow } from '../../lib/store';
import { ago } from '../../lib/format';
import { Sheet, Spinner, useToast } from '../ui';
import { Chips } from './kit';
import { useVoice } from './FanVoice';

const KIND = Object.fromEntries(KINDS.map((k) => [k.key, k])) as Record<FanKind, (typeof KINDS)[number]>;
// where a fan stands to watch, in each sport's words
const GROUND: Record<string, string> = { hockey: 'at the rink', football: 'at the stadium', basketball: 'at the arena', soccer: 'at the ground' };
const DONE: Record<FanKind, string> = { idea: 'Noted', ask: 'Answered', insight: 'Checked', fact: 'Checked', fix: 'Fixed' };
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function PostCard({ p, onChange, onGone, lit }: { p: FanPost; onChange: (p: FanPost) => void; onGone: (id: number) => void; lit?: boolean }) {
  const v = useVoice()!;
  const toast = useToast();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const body = useRef<HTMLParagraphElement>(null);
  const score = p.ups - p.downs;
  // "Read it all" only when the four lines cut it short
  useLayoutEffect(() => { const el = body.current; if (el && !open) setLong(el.scrollHeight > el.clientHeight + 2); }, [p.body, open]);

  const vote = async (val: 1 | -1) => {
    if (!v.signedIn) { v.ask('Sign in to vote. Just a name will do.'); return; }
    if (p.own) { toast('That one is yours: the other fans vote on it', 'info'); return; }
    const next = (p.mine === val ? 0 : val) as -1 | 0 | 1;
    const before = p;
    onChange({ ...p, mine: next || null, ups: p.ups + (next === 1 ? 1 : 0) - (p.mine === 1 ? 1 : 0), downs: p.downs + (next === -1 ? 1 : 0) - (p.mine === -1 ? 1 : 0) });
    try { const r = await fanVote(p.id, next); onChange({ ...p, ups: r.ups, downs: r.downs, mine: r.mine }); } catch (e) { toast((e as Error).message, 'err'); onChange(before); }
  };
  const report = async () => {
    if (!v.signedIn) { v.ask('Sign in to report a post.'); return; }
    if (!window.confirm('Report this post? Three reports take it down, and the fan zones’ editors read every one.')) return;
    try {
      const r = await fanReport(p.id);
      if (r === 'removed' || r === 'gone') { onGone(p.id); toast('Taken down. Thanks for keeping the board clean'); } else toast('Reported. Thanks for keeping the board clean');
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const remove = async () => {
    if (!window.confirm(p.own ? 'Take your post down?' : 'Take this post down for breaking the rules?')) return;
    try { await fanRemove(p.id); onGone(p.id); toast('Taken down'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const check = async () => {
    const reopen = p.status === 'checked';
    const note = reopen ? null : window.prompt(`A note for the fans (optional): how it was ${DONE[p.kind].toLowerCase()}`, '') ?? undefined;
    if (note === undefined) return;
    try { await fanModerate(p.id, reopen ? 'open' : 'checked', note); onChange({ ...p, status: reopen ? 'open' : 'checked', note: reopen ? null : note || null }); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const share = async () => {
    const r = await shareLink(zoneLink(v.league, p.club, undefined, p.id), p.title, `${KIND[p.kind].emoji} From the ${p.club === v.board ? v.dir.name : dirName(v.dir, p.club)} fan board: ${p.title}`);
    if (r === 'copied') toast('Link copied');
  };

  return (
    <article id={`post-${p.id}`} className={`card flex gap-2.5 p-3 ${lit ? 'ring-2' : ''}`} style={lit ? { boxShadow: '0 0 0 2px rgb(var(--club-rgb))' } : undefined}>
      <div className="flex w-9 shrink-0 flex-col items-center pt-0.5">
        <button type="button" aria-label="Vote up" aria-pressed={p.mine === 1} onClick={() => vote(1)}
          className={`grid h-8 w-8 place-items-center rounded-full transition ${p.mine === 1 ? '' : 'text-slate-400 hover:bg-white/[.06] hover:text-white'}`}
          style={p.mine === 1 ? { background: 'rgb(var(--club-rgb))', color: 'var(--club-ink)' } : undefined}><ChevronUp className="h-5 w-5" /></button>
        <span className={`num py-0.5 text-sm font-extrabold ${score > 0 ? 'text-white' : score < 0 ? 'text-red-300' : 'text-mute'}`} aria-label={`${p.ups} up, ${p.downs} down`}>{score}</span>
        <button type="button" aria-label="Vote down" aria-pressed={p.mine === -1} onClick={() => vote(-1)}
          className={`grid h-8 w-8 place-items-center rounded-full transition ${p.mine === -1 ? 'bg-red-500/80 text-white' : 'text-slate-400 hover:bg-white/[.06] hover:text-white'}`}><ChevronDown className="h-5 w-5" /></button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="chip">{KIND[p.kind]?.emoji} {KIND[p.kind]?.one}</span>
          <span className="chip">{topicsFor(v.sport).find((t) => t[0] === p.topic)?.[1] ?? p.topic}</span>
          {p.status === 'checked' && <span className="chip border-emerald-400/30 bg-emerald-500/10 text-emerald-200"><ShieldCheck className="h-3 w-3" />{DONE[p.kind]}</span>}
        </div>
        <h3 className="mt-1.5 text-[15px] font-bold leading-snug text-white [overflow-wrap:anywhere]">{p.title}</h3>
        {p.body && <p ref={body} className={`mt-1 whitespace-pre-line text-[13.5px] leading-snug text-slate-300 [overflow-wrap:anywhere] ${open ? '' : 'line-clamp-4'}`}>{p.body}</p>}
        {(long || open) && <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 text-xs font-semibold text-sky-300">{open ? 'Less' : 'Read it all'}</button>}
        {p.source && <a href={p.source} target="_blank" rel="noopener noreferrer nofollow ugc" className="mt-1.5 inline-flex max-w-full items-center gap-1 text-xs text-sky-300"><Link2 className="h-3 w-3 shrink-0" /><span className="truncate">{host(p.source)}</span></a>}
        {p.note && <p className="mt-1.5 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-xs leading-snug text-emerald-100 ring-1 ring-emerald-400/20"><b>From the editors:</b> {p.note}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
          <span><b className="text-slate-300">{p.author}</b> · {ago(p.at, now)}</span>
          <button type="button" onClick={share} className="inline-flex items-center gap-1 hover:text-white"><Share2 className="h-3 w-3" />Share</button>
          {p.own ? <button type="button" onClick={remove} className="inline-flex items-center gap-1 hover:text-white"><Trash2 className="h-3 w-3" />Take down</button>
            : <button type="button" onClick={report} className="inline-flex items-center gap-1 hover:text-white"><Flag className="h-3 w-3" />Report</button>}
          {v.me?.admin && (
            <>
              <button type="button" onClick={check} className="font-semibold text-emerald-300">{p.status === 'checked' ? 'Reopen' : `Mark ${DONE[p.kind].toLowerCase()}`}</button>
              {!p.own && <button type="button" onClick={remove} className="font-semibold text-red-300">Remove</button>}
              {p.reports ? <span className="font-semibold text-red-300">{p.reports} report{p.reports === 1 ? '' : 's'}</span> : null}
            </>
          )}
        </div>
      </div>
    </article>
  );
}

// a list of posts from the board, read again when the club, the kind, the sort or a new post changes it
function usePosts(club: string, kind: FanKind | null, sort: Sort, size: number, tick: number, league: string) {
  const [posts, setPosts] = useState<FanPost[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setPosts(null); setFailed(false);
    fanBoard(club, kind, sort, size + 1, 0, league).then((r) => { if (!live) return; setMore(r.length > size); setPosts(r.slice(0, size)); }, () => { if (live) { setPosts([]); setFailed(true); } });
    return () => { live = false; };
  }, [club, kind, sort, size, tick, league]);
  const loadMore = useCallback(async () => {
    const have = posts?.length ?? 0;
    const r = await fanBoard(club, kind, sort, size + 1, have, league);
    setMore(r.length > size);
    setPosts((p) => [...(p ?? []), ...r.slice(0, size).filter((x) => !(p ?? []).some((y) => y.id === x.id))]);
  }, [club, kind, sort, size, posts, league]);
  const change = useCallback((x: FanPost) => setPosts((p) => p?.map((y) => (y.id === x.id ? x : y)) ?? p), []);
  const gone = useCallback((id: number) => setPosts((p) => p?.filter((y) => y.id !== id) ?? p), []);
  return { posts, more, failed, loadMore, change, gone };
}

const BOARD_KINDS = [['idea', 'Ideas'], ['ask', 'Questions'], ['insight', 'Insights'], ['fix', 'Fixes'], ['all', 'Everything']] as const;
const SORTS = [['hot', 'Rising'], ['top', 'Top'], ['new', 'New']] as const;

export function FanBoard({ post }: { post?: number | null }) {
  const v = useVoice()!;
  const [kind, setKind] = useState<(typeof BOARD_KINDS)[number][0]>('idea');
  const [sort, setSort] = useState<Sort>('hot');
  const [tick, setTick] = useState(0);
  const [compose, setCompose] = useState<FanKind | null>(null);
  const { posts, more, failed, loadMore, change, gone } = usePosts(v.club, kind === 'all' ? null : kind, sort, 12, tick, v.league);
  const [shared, setShared] = useState<FanPost | null>(null);
  // a shared link (?post=12) opens on its post, wherever it sits on the board
  useEffect(() => {
    if (!post) { setShared(null); return; }
    supabase.from('fan_posts').select('*').eq('id', post).maybeSingle().then(({ data }) => {
      if (!data) return;
      setShared({ ...(data as FanPost & { created_at: string }), at: (data as { created_at: string }).created_at });
      setTimeout(() => document.getElementById(`post-${post}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
    });
  }, [post]);
  const add = (k: FanKind) => (v.signedIn ? setCompose(k) : v.ask('Sign in to post. Just a name will do.'));
  const here = kind === 'all' ? 'idea' : kind;
  const empty = { idea: 'No ideas yet. What would you do?', ask: 'No questions yet. What would you ask the GM or the coach?', insight: 'No insights yet. What do you see that the numbers miss?', fix: 'Nothing to fix so far. Spot something wrong in the analysis? Say so here.', all: 'Nothing on the board yet. Start it.' }[kind];
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><Chips label="The board" items={BOARD_KINDS} value={kind} onChange={setKind} /></div>
      </div>
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label="Order" className="flex gap-1 rounded-full bg-white/[.04] p-0.5 ring-1 ring-white/10">
          {SORTS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={sort === k} onClick={() => setSort(k)} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${sort === k ? 'bg-white/[.12] text-white' : 'text-mute hover:text-slate-200'}`}>{l}</button>)}
        </div>
        <button type="button" onClick={() => add(here)} className="btn-club btn-sm ml-auto shrink-0 px-3!"><Plus className="h-3.5 w-3.5" />{KIND[here].one}</button>
      </div>
      {shared && !posts?.some((x) => x.id === shared.id) && <PostCard p={shared} lit onChange={setShared} onGone={() => setShared(null)} />}
      {posts == null ? <div className="flex justify-center py-6"><Spinner /></div>
        : posts.length === 0 ? (
          <button type="button" onClick={() => add(here)} className="card block w-full p-5 text-center hover:bg-white/[.03]">
            <div className="text-3xl">{kind === 'all' ? '📣' : KIND[kind].emoji}</div>
            <p className="mt-1 text-sm text-slate-300">{failed ? 'The board didn’t load. Pull to refresh in a minute.' : empty}</p>
            {!failed && <span className="btn-club btn-sm mt-3 inline-flex px-3!"><Plus className="h-3.5 w-3.5" />Add {KIND[here].one.toLowerCase()}</span>}
          </button>
        ) : posts.map((p) => <PostCard key={p.id} p={p} lit={p.id === post} onChange={change} onGone={gone} />)}
      {more && <button type="button" onClick={() => void loadMore()} className="btn-ghost w-full">Show more</button>}
      <FanCompose open={compose != null} kind={compose ?? 'idea'} onClose={() => setCompose(null)} onPosted={(k) => { setCompose(null); setKind(k === 'fact' ? kind : (k as typeof kind)); setSort('new'); setTick((n) => n + 1); }} />
    </div>
  );
}

const PROMPT: Record<FanKind, string> = {
  idea: 'What would you do, and why? The numbers or the games that back it up help it rise.',
  ask: 'Any background that makes the question sharper.',
  insight: 'What you see, and the games or numbers that show it.',
  fact: 'The fact in full, and why it matters to the club.',
  fix: 'What the analysis or the data says, and what is right.',
};

export function FanCompose({ open, kind, onClose, onPosted }: { open: boolean; kind: FanKind; onClose: () => void; onPosted: (k: FanKind) => void }) {
  const v = useVoice()!;
  const toast = useToast();
  const [k, setK] = useState<FanKind>(kind);
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setK(kind); setTopic(''); setTitle(''); setBody(''); setSource(''); } }, [open, kind]);
  const ok = title.trim().length >= 3 && topic && (!source.trim() || /^https?:\/\/\S+$/i.test(source.trim()));
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try { await fanPost({ club: v.club, kind: k, topic, title: title.trim(), body: body.trim(), source: source.trim() || null, league: v.league }); toast('Posted'); v.refreshMe(); v.reloadPulse(); onPosted(k); }
    catch (x) { toast((x as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={v.club === v.board ? 'Add to the league board' : `Add to the ${dirName(v.dir, v.club)} board`}>
      <form onSubmit={send} className="space-y-3">
        <div>
          <span className="label">What is it?</span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {KINDS.map((x) => (
              <button key={x.key} type="button" aria-pressed={k === x.key} onClick={() => setK(x.key)}
                className={`rounded-full px-2.5 py-1 text-[13px] font-semibold ${k === x.key ? '' : 'border border-white/10 bg-white/[.04] text-slate-200'}`}
                style={k === x.key ? { background: 'rgb(var(--club-rgb))', color: 'var(--club-ink)' } : undefined}>{x.emoji} {x.one}</button>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-mute">{KIND[k].hint}.</p>
        </div>
        <label className="block">
          <span className="label">Topic</span>
          <select className="input mt-1" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="" disabled>Pick a topic</option>
            {topicsFor(v.sport).map(([t, l]) => <option key={t} value={t}>{l}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between"><span className="label">In a line</span><span className="num text-[11px] text-mute">{title.length}/140</span></span>
          <input className="input mt-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder={k === 'ask' ? 'Your question' : k === 'fact' ? 'The fact' : k === 'fix' ? 'What needs fixing' : 'Your idea in one line'} />
        </label>
        <label className="block">
          <span className="flex items-baseline justify-between"><span className="label">More (optional)</span><span className="num text-[11px] text-mute">{body.length}/2000</span></span>
          <textarea className="input mt-1 min-h-28" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder={PROMPT[k]} />
        </label>
        <label className="block">
          <span className="label">{k === 'fact' || k === 'fix' ? 'Source (helps it get checked)' : 'A link that backs it up (optional)'}</span>
          <input className="input mt-1" type="url" inputMode="url" value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://" />
        </label>
        <p className="text-[11px] leading-snug text-mute">Be specific and fair: no personal attacks, nothing you wouldn&apos;t say {GROUND[v.sport] ?? 'at the game'}. It shows as {v.me?.name ?? 'your first name and initial'}; three reports take a post down.</p>
        <button className="btn-club w-full py-2.5" disabled={busy || !ok}>{busy ? <Spinner /> : 'Post it'}</button>
      </form>
    </Sheet>
  );
}

// the knowledge base: the facts fans add about the club, the best first, and the league's own beside them
export function FanKnowledge() {
  const v = useVoice()!;
  const [tick, setTick] = useState(0);
  const [compose, setCompose] = useState(false);
  const club = usePosts(v.club, 'fact', 'top', 8, tick, v.league);
  const nhl = usePosts(v.board, 'fact', 'top', 4, v.club === v.board ? -1 : tick, v.league);
  const add = () => (v.signedIn ? setCompose(true) : v.ask('Sign in to add a fact. Just a name will do.'));
  return (
    <div className="space-y-2.5">
      {club.posts == null ? <div className="flex justify-center py-6"><Spinner /></div>
        : club.posts.length === 0 ? (
          <button type="button" onClick={add} className="card block w-full p-5 text-center hover:bg-white/[.03]">
            <div className="text-3xl">📚</div>
            <p className="mt-1 text-sm text-slate-300">{v.club === v.board ? 'The league’s knowledge base is empty so far.' : `Nothing in the ${dirName(v.dir, v.club)} knowledge base yet.`} Add a record, a story or a piece of trivia, with a source if you have one.</p>
          </button>
        ) : club.posts.map((p) => <PostCard key={p.id} p={p} onChange={club.change} onGone={club.gone} />)}
      {club.more && <button type="button" onClick={() => void club.loadMore()} className="btn-ghost w-full">More facts</button>}
      <button type="button" onClick={add} className="btn-club w-full py-2.5"><Plus className="h-4 w-4" />Add a fact</button>
      {v.club !== v.board && (nhl.posts?.length ?? 0) > 0 && (
        <div className="space-y-2 pt-2">
          <div className="label px-1">From around the league</div>
          {nhl.posts!.map((p) => <PostCard key={p.id} p={p} onChange={nhl.change} onGone={nhl.gone} />)}
        </div>
      )}
      <FanCompose open={compose} kind="fact" onClose={() => setCompose(false)} onPosted={() => { setCompose(false); setTick((n) => n + 1); }} />
    </div>
  );
}
