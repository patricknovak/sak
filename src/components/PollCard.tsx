// A poll in the chat stream: tap an option to vote (or change your vote), live tallies, the starter or the
// commissioner can close it. Also the little form that starts one.
import { useEffect, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { supabase } from '../lib/supabase';
import { useToast } from './ui';
import { BarChart3 } from 'lucide-react';

interface Poll { id: number; channel: string; team_id: number; question: string; options: string[]; closes_at: string | null; closed: boolean; created_at: string }
interface Vote { poll_id: number; team_id: number; choice: number }

export function PollCard({ id }: { id: number }) {
  const { me, team, can } = useLeague();
  const now = useNow(15_000);
  const toast = useToast();
  const [poll, setPoll] = useState<Poll | null>(null);
  const [votes, setVotes] = useState<Vote[]>([]);
  const load = async () => {
    const [{ data: p }, { data: v }] = await Promise.all([
      supabase.from('polls').select('*').eq('id', id).single(),
      supabase.from('poll_votes').select('poll_id,team_id,choice').eq('poll_id', id),
    ]);
    if (p) setPoll(p as Poll);
    setVotes((v ?? []) as Vote[]);
  };
  const open = !!poll && !poll.closed && (!poll.closes_at || new Date(poll.closes_at).getTime() > now);
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // realtime isn't guaranteed for these tables, so an open poll refreshes itself
  useEffect(() => {
    if (!open) return;
    const i = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15_000);
    return () => window.clearInterval(i);
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!poll) return null;
  const mine = votes.find((v) => v.team_id === me?.id)?.choice;
  const total = votes.length;
  const vote = async (choice: number) => {
    if (!me || !open || !can('chat')) return;
    setVotes((v) => [...v.filter((x) => x.team_id !== me.id), { poll_id: id, team_id: me.id, choice }]);
    const { error } = await supabase.from('poll_votes').upsert({ poll_id: id, team_id: me.id, choice });
    if (error) { toast(error.message, 'err'); load(); }
  };
  const close = async () => {
    if (!confirm('Close this poll?')) return;
    const { error } = await supabase.from('polls').update({ closed: true }).eq('id', id);
    if (error) toast(error.message, 'err'); else load();
  };
  const canClose = open && (poll.team_id === me?.id || me?.is_commish);
  return (
    <div className="mx-auto my-1 w-full max-w-md rounded-2xl border border-sky-400/25 bg-gradient-to-br from-sky-500/15 to-sky-900/20 p-3 text-left shadow-[0_8px_24px_-14px_rgba(76,195,255,.8)]">
      <div className="mb-2 flex items-start gap-2">
        <BarChart3 size={16} className="mt-0.5 shrink-0 text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold leading-snug">{poll.question}</div>
          <div className="text-[11px] text-mute">{team(poll.team_id)?.gm_name}’s poll · {total} vote{total === 1 ? '' : 's'}{!open ? ' · closed' : poll.closes_at ? ` · closes ${new Date(poll.closes_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}</div>
        </div>
        {canClose && <button className="text-[11px] text-mute hover:text-white" onClick={close}>Close</button>}
      </div>
      <div className="space-y-1">
        {poll.options.map((o, i) => {
          const n = votes.filter((v) => v.choice === i).length;
          const pct = total ? Math.round((100 * n) / total) : 0;
          const who = votes.filter((v) => v.choice === i).map((v) => team(v.team_id)?.gm_name).filter(Boolean);
          return (
            <button key={i} disabled={!open || !can('chat')} onClick={() => vote(i)} title={who.join(', ')}
              className={`relative w-full overflow-hidden rounded-xl border px-3 py-1.5 text-left text-sm transition disabled:cursor-default ${mine === i ? 'border-sky-300/60' : 'border-white/10'} ${open ? 'hover:border-sky-300/40' : ''}`}>
              <span className="absolute inset-y-0 left-0 bg-sky-400/25 transition-all" style={{ width: `${pct}%` }} />
              <span className="relative flex items-center gap-2"><span className="flex-1">{mine === i ? '✓ ' : ''}{o}</span><span className="num text-xs text-slate-300">{n} · {pct}%</span></span>
              {who.length > 0 && <span className="relative block truncate text-[10px] text-mute">{who.join(', ')}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PollComposer({ channel, onDone }: { channel: string; onDone: () => void }) {
  const { me } = useLeague();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [hours, setHours] = useState(0);
  const [busy, setBusy] = useState(false);
  const clean = opts.map((o) => o.trim()).filter(Boolean);
  const ok = q.trim().length >= 3 && clean.length >= 2;
  const start = async () => {
    if (!ok || !me) return;
    setBusy(true);
    const { error } = await supabase.from('polls').insert({ channel, team_id: me.id, question: q.trim(), options: clean, closes_at: hours ? new Date(Date.now() + hours * 3600_000).toISOString() : null });
    setBusy(false);
    if (error) { toast(error.message, 'err'); return; }
    onDone();
  };
  return (
    <div className="mb-1 space-y-1.5 rounded-xl border border-sky-400/25 bg-sky-500/10 p-2">
      <div className="flex items-center justify-between text-xs font-semibold text-sky-200"><span>📊 New poll</span><button className="text-mute" onClick={onDone}>✕</button></div>
      <input className="input py-1.5 text-sm" placeholder="The question" value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} autoFocus />
      {opts.map((o, i) => (
        <input key={i} className="input py-1.5 text-sm" placeholder={`Option ${i + 1}`} value={o} maxLength={60} onChange={(e) => setOpts(opts.map((x, j) => (j === i ? e.target.value : x)))} />
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        {opts.length < 6 && <button className="chip" onClick={() => setOpts([...opts, ''])}>+ option</button>}
        <select className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={0}>Open until closed</option><option value={1}>Closes in 1 hour</option><option value={24}>Closes in 24 hours</option><option value={72}>Closes in 3 days</option>
        </select>
        <button className="btn-blue btn-sm ml-auto" disabled={!ok || busy} onClick={start}>Start poll</button>
      </div>
    </div>
  );
}
