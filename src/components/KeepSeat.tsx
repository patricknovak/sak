// Keep your seat: a guest (joined with just a name, migration 332) adds an email and a password to the same account, so
// every pick and coin stays and they can sign in on any phone. Shown only to a guest; gone once the email is saved.
import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useLeague } from '../lib/store';
import { isGuestEmail } from '../lib/guest';
import { Spinner } from './ui';

export function KeepSeat() {
  const { session } = useLeague();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!isGuestEmail(session?.user?.email)) return null;
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && pw.length >= 6;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const login = email.trim().toLowerCase();
    const { error } = await supabase.functions.invoke('join', { body: { claim: { email: login, password: pw } } });
    if (error) {
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setBusy(false); setErr(body?.error ?? 'Couldn’t save your email. Try again in a minute.');
      return;
    }
    // the same account under its new address: sign in again so this phone's session carries it
    await supabase.auth.signInWithPassword({ email: login, password: pw });
    try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
    setBusy(false);
  };

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gold/15 ring-1 ring-gold/40"><ShieldCheck className="h-5 w-5 text-gold" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-extrabold leading-tight text-white">Keep your place</div>
          <p className="mt-0.5 text-sm leading-snug text-slate-300">You&apos;re in on this phone only. Add an email to sign in anywhere, and your calls and coins come with you.</p>
        </div>
      </div>
      {!open ? (
        <button type="button" className="btn-gold mt-3 w-full py-2.5" onClick={() => setOpen(true)}>Add my email</button>
      ) : (
        <form onSubmit={save} className="mt-3 space-y-2">
          <input aria-label="Email" className="input w-full" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <input aria-label="Password" className="input w-full" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Pick a password, 6+ characters" />
          <button className="btn-gold w-full py-2.5" disabled={busy || !ok}>{busy ? <Spinner /> : 'Keep my place'}</button>
          {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-3 py-2 text-sm text-red-200">{err}</div>}
        </form>
      )}
    </div>
  );
}
