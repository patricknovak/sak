import { useEffect, useState } from 'react';
import { Check, Mail } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { Sheet, Spinner, useAction } from './ui';

// Invite people to this pool by name (migration 163): the people you already play with in your other pools and leagues,
// and anyone by email. Each one with an account finds the invitation on My pools, with an alert in each of their
// pools; an address with no account hears nothing, so the open link is still the way to reach them.
interface Candidate { account: string; name: string | null; pools: string; invited: boolean }

export function InvitePeople({ open, onClose, pool }: { open: boolean; onClose: () => void; pool: string }) {
  const { busy, run } = useAction();
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSent(false); setPicked(new Set()); setEmails('');
    rpc<Candidate[]>('pool_invite_candidates').then((d) => setPeople(d ?? []), () => setPeople([]));
  }, [open]);
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const toggle = (a: string) => setPicked((s) => { const n = new Set(s); if (n.has(a)) n.delete(a); else n.add(a); return n; });
  const send = () => run(async () => {
    await rpc('pool_invite_people', { p_accounts: [...picked], p_emails: list });
    setSent(true);
  });
  return (
    <Sheet open={open} onClose={onClose} title={`Invite people to ${pool}`}>
      {sent ? (
        <div className="space-y-3 py-4 text-center">
          <div className="text-4xl">✉️</div>
          <div className="font-display text-xl font-extrabold text-white">Invitations sent</div>
          <p className="text-sm text-slate-300">Anyone who already plays on Super Pools finds it on My pools, with an alert in their other pools. Someone new won&apos;t get an email from us, so send them the link too.</p>
          <button type="button" className="btn-gold w-full py-3" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="label">People you play with</span>
            {people === null ? <div className="flex justify-center py-4"><Spinner /></div>
              : !people.length ? <p className="mt-1 text-sm text-mute">Nobody from your other pools yet. Invite by email below, or share the link.</p>
              : (
                <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {people.map((p) => {
                    const on = picked.has(p.account);
                    return (
                      <button key={p.account} type="button" disabled={p.invited} onClick={() => toggle(p.account)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition disabled:opacity-60 ${on ? 'border-gold/60 bg-gold/15' : 'border-white/10 bg-white/[.03] enabled:hover:bg-white/[.06]'}`}>
                        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ring-1 ${on ? 'bg-gold text-[#0b1220] ring-gold' : 'ring-white/25'}`}>{on && <Check className="h-4 w-4" strokeWidth={3} />}</span>
                        <span className="min-w-0 flex-1"><span className="block break-words font-semibold text-white">{p.name ?? 'Someone'}</span><span className="block text-[11px] text-mute">{p.pools}</span></span>
                        {p.invited && <span className="chip shrink-0 text-[10px]">Invited</span>}
                      </button>
                    );
                  })}
                </div>
              )}
          </div>
          <label className="block"><span className="label">Or their email addresses</span>
            <textarea className="input mt-1 w-full" rows={2} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="friend@example.com, another@example.com" /></label>
          <button type="button" className="btn-gold inline-flex w-full items-center justify-center gap-2 py-3" disabled={busy || (picked.size === 0 && list.length === 0)} onClick={send}>
            <Mail className="h-4 w-4" /> {busy ? 'Sending…' : `Invite ${picked.size + list.length || ''}`.trim()}
          </button>
          <p className="text-xs text-mute">They join from My pools in one tap. An invitation lasts 14 days.</p>
        </div>
      )}
    </Sheet>
  );
}
