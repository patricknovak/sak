import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from './ui';

// The code step of a door that makes an account (9 November 2026, docs/LAUNCH-READINESS-2026-10-28.md item 4): the
// join function answered {verify: true}, so Auth has emailed a 6-digit code to the address typed. Typing it here signs
// the phone in as that address (verifyOtp), and whoever opened this step then calls the door again, signed in, to open
// the pool, the league or the seat. Drawn like the sign-in page's reset code, inside the door's own card.
export function EmailCode({ email, onDone, onBack, busy, noun }: { email: string; onDone: () => Promise<void>; onBack: () => void; busy: boolean; noun: string }) {
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const digits = code.replace(/\D/g, '').slice(0, 6);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (digits.length !== 6 || working || busy) return;
    setWorking(true); setErr(''); setNote('');
    const { error } = await supabase.auth.verifyOtp({ email, token: digits, type: 'email' });
    if (error) {
      setWorking(false);
      setErr(/expired|invalid|not found/i.test(error.message) ? 'That code didn’t work. Check it, or ask for a new one.' : error.message);
      return;
    }
    try { await onDone(); } finally { setWorking(false); }
  };

  // another code to the same address, through Auth's own mail and its own limits
  const resend = async () => {
    setErr(''); setNote('');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) setErr(/rate|seconds|too many/i.test(error.message) ? 'Too many codes asked for. Wait a few minutes and try again.' : error.message);
    else setNote('A new code is on its way.');
  };

  return (
    <form onSubmit={confirm} className="relative">
      <div className="label text-white/80">Check your email</div>
      <p className="mt-1 text-sm leading-snug text-white/75">We sent a 6-digit code to <b className="text-white">{email}</b>. Type it here and your {noun} opens.</p>
      <input className="input mt-3 w-full text-center font-display text-2xl tracking-[.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6}
        value={digits} onChange={(e) => setCode(e.target.value)} placeholder="000000" aria-label="The 6-digit code" autoFocus />
      <button type="submit" className="btn-gold mt-3 w-full py-3 text-base" disabled={digits.length !== 6 || working || busy}>{working || busy ? <Spinner /> : 'Confirm and open'}</button>
      <div className="mt-3 flex items-center justify-between text-xs text-white/60">
        <button type="button" className="underline" onClick={resend} disabled={working || busy}>Send a new code</button>
        <button type="button" className="underline" onClick={onBack} disabled={working || busy}>Use another email</button>
      </div>
      {note && <p className="mt-2 text-xs text-emerald-300">{note}</p>}
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      <p className="mt-3 text-[11px] leading-snug text-white/45">Nothing in your inbox? Check junk. The code is good for an hour.</p>
    </form>
  );
}
