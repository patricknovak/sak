// Commissioner: who the 𝕏 Insiders feed follows, and which topics it should favour.
import { useState } from 'react';
import { Plus, RotateCcw, X as XIcon } from 'lucide-react';
import { useLeague } from '../lib/store';
import { rpc } from '../lib/supabase';
import { useAction } from './ui';
import { X_DEFAULT_ACCOUNTS, X_MAX_ACCOUNTS, X_SUGGESTED, xConfigOf, type XAccount } from '../lib/xfeed';

export function XFeedSettings() {
  const { league, refresh } = useLeague();
  const { busy, run } = useAction();
  const saved = xConfigOf(league?.info);
  const [accounts, setAccounts] = useState<XAccount[]>(saved.accounts);
  const [topics, setTopics] = useState<string[]>(saved.topics);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const has = (h: string) => accounts.some((a) => a.handle.toLowerCase() === h.toLowerCase());
  const add = (a: XAccount) => { if (!has(a.handle) && accounts.length < X_MAX_ACCOUNTS) setAccounts([...accounts, a]); };
  const addTyped = () => {
    const h = handle.replace(/^@/, '').trim();
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) return;
    add({ handle: h, name: name.trim() || h }); setHandle(''); setName('');
  };
  const addTopic = () => { const t = topic.trim(); if (t && !topics.some((x) => x.toLowerCase() === t.toLowerCase()) && topics.length < 12) setTopics([...topics, t]); setTopic(''); };
  const dirty = JSON.stringify({ accounts, topics }) !== JSON.stringify(saved);
  const save = () => run(async () => {
    await rpc('commish_update_league', { p: { info: { ...(league?.info ?? {}), x_feed: { accounts, topics } } } });
    await refresh(['league']);
  }, 'Insiders feed updated. The next refresh follows the new list.');
  return (
    <div className="card space-y-3 p-3 text-sm">
      <p className="text-xs text-mute">The NHL centre’s 𝕏 Insiders tab pulls the latest posts from these accounts (through Grok’s X search). Up to {X_MAX_ACCOUNTS} accounts; the first ten are searched first. Topics tell the search what to favour, like a team, a player or “waivers”.</p>
      <div>
        <div className="label mb-1.5">Following ({accounts.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {accounts.map((a) => <span key={a.handle} className="chip gap-1.5 py-1 text-xs"><span className="font-semibold text-slate-100">{a.name}</span><span className="text-mute">@{a.handle}</span><button className="rounded-full p-0.5 text-mute hover:text-red-300" aria-label={`Remove ${a.handle}`} onClick={() => setAccounts(accounts.filter((x) => x.handle !== a.handle))}><XIcon size={12} /></button></span>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input className="input w-40 flex-1" placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTyped()} />
          <input className="input w-40 flex-1" placeholder="Display name (optional)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTyped()} />
          <button className="btn-ghost" onClick={addTyped} disabled={!handle.trim() || accounts.length >= X_MAX_ACCOUNTS}><Plus size={14} /> Add</button>
        </div>
        {X_SUGGESTED.some((s) => !has(s.handle)) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-mute">Suggested:</span>
            {X_SUGGESTED.filter((s) => !has(s.handle)).map((s) => <button key={s.handle} className="chip hover:bg-white/[.1]" onClick={() => add(s)}>+ {s.name}</button>)}
          </div>
        )}
      </div>
      <div>
        <div className="label mb-1.5">Topics to favour ({topics.length})</div>
        <div className="flex flex-wrap gap-1.5">
          {topics.length === 0 && <span className="text-xs text-mute">None yet: the feed is everything NHL from the accounts above.</span>}
          {topics.map((t) => <span key={t} className="chip gap-1.5 py-1 text-xs">{t}<button className="rounded-full p-0.5 text-mute hover:text-red-300" aria-label={`Remove ${t}`} onClick={() => setTopics(topics.filter((x) => x !== t))}><XIcon size={12} /></button></span>)}
        </div>
        <div className="mt-2 flex gap-2">
          <input className="input flex-1" placeholder="e.g. Maple Leafs, McDavid, waivers, goalie injuries" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTopic()} />
          <button className="btn-ghost" onClick={addTopic} disabled={!topic.trim() || topics.length >= 12}><Plus size={14} /> Add</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || !dirty || accounts.length === 0} onClick={save}>Save feed</button>
        <button className="btn-ghost" disabled={busy} onClick={() => { setAccounts(X_DEFAULT_ACCOUNTS); setTopics([]); }}><RotateCcw size={14} /> Reset to defaults</button>
        {dirty && <span className="self-center text-xs text-amber-200">Unsaved changes</span>}
      </div>
    </div>
  );
}
