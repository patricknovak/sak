import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { rpc, supabase } from '../lib/supabase';
import { ago } from '../lib/format';
import { ALL_FEATURES, FEATURE_GROUPS, type Feature } from '../data/features';
import { PageHeader, TeamBadge, useAction } from '../components/ui';

interface Comment { id: number; feature_key: string; team_id: number; body: string; created_at: string }
interface Idea { id: number; team_id: number; title: string; body: string | null; status: Status; commish_note: string | null; created_at: string }
interface Vote { idea_id: number; team_id: number }
type Status = 'new' | 'planned' | 'building' | 'done' | 'declined';

const STATUS: Record<Status, { label: string; cls: string }> = {
  new: { label: '🆕 New', cls: 'bg-white/[.06] text-slate-300' },
  planned: { label: '🗓️ Planned', cls: 'bg-sky-500/15 text-sky-200 ring-1 ring-inset ring-sky-400/30' },
  building: { label: '🛠️ Building', cls: 'bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-400/30' },
  done: { label: '✅ Shipped', cls: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-inset ring-emerald-400/30' },
  declined: { label: '🙅 Not now', cls: 'bg-red-500/10 text-red-200/80' },
};

export default function Features() {
  const { me, team } = useLeague();
  const now = useNow(60_000);
  const { busy, run } = useAction();
  const [params, setParams] = useSearchParams();
  const tab = params.get('t') === 'ideas' || params.get('idea') ? 'ideas' : 'built';
  const [comments, setComments] = useState<Comment[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [open, setOpen] = useState<string | null>(params.get('idea') ? `idea:${params.get('idea')}` : null);
  const [draft, setDraft] = useState('');
  const [idea, setIdea] = useState({ title: '', body: '' });

  const load = useCallback(async () => {
    const [c, i, v] = await Promise.all([
      supabase.from('feature_comments').select('*').order('id'),
      supabase.from('feature_ideas').select('*').order('id', { ascending: false }),
      supabase.from('feature_votes').select('*'),
    ]);
    setComments((c.data ?? []) as Comment[]);
    setIdeas((i.data ?? []) as Idea[]);
    setVotes((v.data ?? []) as Vote[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const byKey = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) m.set(c.feature_key, [...(m.get(c.feature_key) ?? []), c]);
    return m;
  }, [comments]);
  const voteCount = (id: number) => votes.filter((v) => v.idea_id === id).length;
  const iVoted = (id: number) => votes.some((v) => v.idea_id === id && v.team_id === me?.id);
  const ranked = [...ideas].sort((a, b) =>
    Number(a.status === 'done' || a.status === 'declined') - Number(b.status === 'done' || b.status === 'declined')
    || voteCount(b.id) - voteCount(a.id) || b.id - a.id);

  const post = (key: string) => run(async () => {
    const body = draft.trim();
    if (!body || !me) return;
    const { error } = await supabase.from('feature_comments').insert({ feature_key: key, team_id: me.id, body });
    if (error) throw error;
    setDraft(''); await load();
  });
  const removeComment = (c: Comment) => run(async () => {
    if (!confirm('Delete this comment?')) return;
    const { error } = await supabase.from('feature_comments').delete().eq('id', c.id);
    if (error) throw error;
    await load();
  });
  const suggest = () => run(async () => {
    if (!me || idea.title.trim().length < 3) throw new Error('Give it a title (3+ characters)');
    const { data, error } = await supabase.from('feature_ideas').insert({ team_id: me.id, title: idea.title.trim(), body: idea.body.trim() || null }).select().single();
    if (error) throw error;
    await supabase.from('feature_votes').insert({ idea_id: data.id, team_id: me.id });
    setIdea({ title: '', body: '' }); await load();
  }, 'Idea posted. The league’s been told to vote 🗳️');
  const toggleVote = (id: number) => run(async () => {
    if (!me) return;
    const { error } = iVoted(id)
      ? await supabase.from('feature_votes').delete().match({ idea_id: id, team_id: me.id })
      : await supabase.from('feature_votes').insert({ idea_id: id, team_id: me.id });
    if (error) throw error;
    await load();
  });
  const setStatus = (i: Idea, status: Status) => run(async () => {
    const note = status === i.status ? i.commish_note : prompt('Note for the league (optional)', i.commish_note ?? '') ?? i.commish_note;
    await rpc('set_idea_status', { p_id: i.id, p_status: status, p_note: note });
    await load();
  }, 'Status updated');
  const removeIdea = (i: Idea) => run(async () => {
    if (!confirm(`Delete “${i.title}”?`)) return;
    const { error } = await supabase.from('feature_ideas').delete().eq('id', i.id);
    if (error) throw error;
    await load();
  });

  // called as plain functions (not <Thread />) so the comment box keeps focus while typing
  const Thread = ({ k }: { k: string }) => {
    const list = byKey.get(k) ?? [];
    return (
      <div className="mt-3 space-y-2 border-t border-white/[.07] pt-3">
        {list.length === 0 && <div className="text-xs text-mute">No comments yet. Be the first.</div>}
        {list.map((c) => {
          const t = team(c.team_id);
          return (
            <div key={c.id} className="flex gap-2 text-sm">
              {t && <TeamBadge team={t} size={22} />}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-mute"><span className="font-semibold text-slate-200">{t?.gm_name}</span> · {ago(c.created_at, now)}
                  {(c.team_id === me?.id || me?.is_commish) && <button className="ml-2 text-red-300/70 hover:text-red-300" onClick={() => removeComment(c)}>delete</button>}</div>
                <div className="whitespace-pre-wrap break-words">{c.body}</div>
              </div>
            </div>
          );
        })}
        <form className="flex gap-1.5 pt-1" onSubmit={(e) => { e.preventDefault(); post(k); }}>
          <input className="input py-1.5 text-sm" placeholder="Add a comment…" maxLength={1000} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn-primary btn-sm shrink-0" disabled={busy || !draft.trim()}>Post</button>
        </form>
      </div>
    );
  };

  const toggle = (k: string) => { setDraft(''); setOpen(open === k ? null : k); };

  const FeatureCard = ({ f }: { f: Feature }) => {
    const n = byKey.get(f.key)?.length ?? 0;
    return (
      <div className="card p-3.5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[.05] text-2xl ring-1 ring-white/10">{f.icon}</div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-bold">{f.title}</h3>
              {f.isNew && <span className="rounded-full bg-goal/90 px-1.5 py-px text-[10px] font-extrabold uppercase tracking-wide text-white">New</span>}
            </div>
            <p className="text-sm text-slate-300">{f.blurb}</p>
          </div>
        </div>
        <ul className="mt-2 space-y-0.5 pl-14 text-[13px] text-mute">
          {f.points.map((p) => <li key={p} className="relative before:absolute before:-left-3 before:top-2 before:h-1 before:w-1 before:rounded-full before:bg-sky-400/70">{p}</li>)}
        </ul>
        <div className="mt-2.5 flex items-center gap-2 pl-14">
          <button className="btn-ghost btn-sm" onClick={() => toggle(f.key)}>💬 {n ? `${n} comment${n > 1 ? 's' : ''}` : 'Comment'}</button>
          {f.to && <Link to={f.to} className="btn-ghost btn-sm">Open →</Link>}
        </div>
        {open === f.key && Thread({ k: f.key })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader icon="💡" title="League features" sub={`${ALL_FEATURES.length} features built so far. Tell us what you think and what to build next.`} />

      <div className="flex gap-1">
        <button className={`tab ${tab === 'built' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setParams({})}>🧰 What’s built</button>
        <button className={`tab ${tab === 'ideas' ? 'tab-on' : 'bg-white/[.05]'}`} onClick={() => setParams({ t: 'ideas' })}>🗳️ Ideas{ideas.length ? ` (${ideas.length})` : ''}</button>
      </div>

      {tab === 'built' && (
        <>
          <div className="card overflow-hidden sm:flex">
            <video className="aspect-[9/16] w-full bg-black sm:w-60" controls playsInline preload="none" poster="promo-poster.jpg" src="promo.mp4" />
            <div className="p-4 sm:self-center">
              <div className="h-display text-xl">🎬 The 2026-27 promo</div>
              <p className="mt-1 text-sm text-mute">Everything the league can do, in 76 seconds. Sound on. Share it with anyone who still thinks we run this on a spreadsheet.</p>
              <a className="btn-ghost btn-sm mt-3" href="promo.mp4" download="SaK-2026-27-promo.mp4">⬇️ Download</a>
            </div>
          </div>
          <div className="card-hero flex flex-wrap items-center gap-3 p-4" style={{ '--tc': '#ef2a4f' } as React.CSSProperties}>
            <div className="relative flex-1 text-sm">
              <div className="h-display text-xl">Got an idea?</div>
              <div className="text-white/70">Suggest a feature and the league votes on it. The most-wanted ideas get built first.</div>
            </div>
            <button className="btn-primary relative" onClick={() => setParams({ t: 'ideas' })}>💡 Suggest a feature</button>
          </div>
          {FEATURE_GROUPS.map((g) => (
            <section key={g.key}>
              <div className="mb-2.5 px-1">
                <h2 className="h-display flex items-center gap-2 text-lg"><span>{g.icon}</span>{g.title}</h2>
                <div className="text-xs text-mute">{g.tagline}</div>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">{g.features.map((f) => <Fragment key={f.key}>{FeatureCard({ f })}</Fragment>)}</div>
            </section>
          ))}
        </>
      )}

      {tab === 'ideas' && (
        <>
          <form className="card space-y-2 p-3.5" onSubmit={(e) => { e.preventDefault(); suggest(); }}>
            <div className="font-bold">💡 Suggest a feature</div>
            <input className="input" placeholder="What should we build? (e.g. Weekly head-to-head side pot)" maxLength={120} value={idea.title} onChange={(e) => setIdea({ ...idea, title: e.target.value })} />
            <textarea className="input min-h-20" placeholder="Details (optional): how would it work, why would it be fun?" maxLength={2000} value={idea.body} onChange={(e) => setIdea({ ...idea, body: e.target.value })} />
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-mute">Posting it tells the league chat so people can vote.</span>
              <button className="btn-primary shrink-0 whitespace-nowrap" disabled={busy || idea.title.trim().length < 3}>Post idea</button>
            </div>
          </form>

          {ranked.length === 0 && <div className="card p-6 text-center text-sm text-mute">No ideas yet. Yours could be the first one we build.</div>}
          <div className="space-y-3">
            {ranked.map((i) => {
              const t = team(i.team_id);
              const k = `idea:${i.id}`;
              const n = byKey.get(k)?.length ?? 0;
              const voted = iVoted(i.id);
              return (
                <div key={i.id} className="card flex gap-3 p-3.5">
                  <button onClick={() => toggleVote(i.id)} disabled={busy} aria-label={voted ? 'Remove vote' : 'Vote'}
                    className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-sm font-extrabold transition ${voted ? 'bg-gradient-to-b from-sky-400 to-sky-600 text-ice shadow-[0_6px_18px_-8px_rgba(56,189,248,.8)]' : 'bg-white/[.05] text-slate-300 ring-1 ring-white/10 hover:bg-white/[.1]'}`}>
                    <span className="text-xs">▲</span>{voteCount(i.id)}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-bold">{i.title}</h3>
                      <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                    </div>
                    <div className="text-[11px] text-mute">{t && <>{t.emoji} {t.gm_name} · </>}{ago(i.created_at, now)}</div>
                    {i.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{i.body}</p>}
                    {i.commish_note && <div className="mt-2 rounded-lg border-l-2 border-amber-400/60 bg-amber-400/[.06] px-2 py-1 text-xs text-amber-100">🛠️ Commish: {i.commish_note}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button className="btn-ghost btn-sm" onClick={() => toggle(k)}>💬 {n ? `${n} comment${n > 1 ? 's' : ''}` : 'Comment'}</button>
                      {me?.is_commish && (
                        <select aria-label="Set status" className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs" value={i.status} onChange={(e) => setStatus(i, e.target.value as Status)}>
                          {(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                        </select>
                      )}
                      {(i.team_id === me?.id || me?.is_commish) && <button className="text-xs text-red-300/70 hover:text-red-300" onClick={() => removeIdea(i)}>delete</button>}
                    </div>
                    {open === k && Thread({ k })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
