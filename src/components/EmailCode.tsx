import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from './ui';

// The code step of a door that makes an account (9 November 2026, docs/LAUNCH-READINESS-2026-10-28.md item 4): the
// join function answered {verify: true}, so Auth has emailed a 6-digit code to the address typed. Typing it here signs
// the phone in as that address (verifyOtp), and whoever opened this step then calls the door again, signed in, to open
// the pool, the league or the seat. Drawn like the sign-in page's reset code, inside the door's own card.
// Not a form of its own: the start page draws it inside its own form, and a form inside a form sent the phone back to
// an empty start page when the code was confirmed (24 November 2026). Enter in the box and the button both confirm.
export function EmailCode({ email, onDone, onBack, busy, noun }: { email: string; onDone: () => Promise<void>; onBack: () => void; busy: boolean; noun: string }) {
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const digits = code.replace(/\D/g, '').slice(0, 6);
  // the step opens mid-page, on the start page under a bar fixed to the foot of the screen: bring the box to the middle
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, []);

  const confirm = async (typed = digits) => {
    if (typed.length !== 6 || working || busy) return;
    setWorking(true); setErr(''); setNote('');
    const { error } = await supabase.auth.verifyOtp({ email, token: typed, type: 'email' });
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
    <div className="relative">
      <div className="label text-white/80">Check your email</div>
      <p className="mt-1 text-sm leading-snug text-white/75">We sent a 6-digit code to <b className="text-white">{email}</b>. Type it here and your {noun} opens.</p>
      {/* no maxLength: a code pasted as "123 456" keeps all six digits. The sixth digit confirms by itself (a typed
          code, a paste, or the phone's own fill from the message), so there's no second tap */}
      <input ref={box} id="email-code" className="input mt-3 w-full text-center font-display text-2xl tracking-[.4em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*"
        value={digits} placeholder="000000" aria-label="The 6-digit code" autoFocus
        onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(d); if (d.length === 6 && d !== digits) void confirm(d); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void confirm(); } }} />
      <button type="button" className="btn-gold mt-3 w-full py-3 text-base" disabled={digits.length !== 6 || working || busy} onClick={() => void confirm()}>{working || busy ? <Spinner /> : 'Confirm and open'}</button>
      <div className="mt-3 flex items-center justify-between text-xs text-white/60">
        <button type="button" className="underline" onClick={resend} disabled={working || busy}>Send a new code</button>
        <button type="button" className="underline" onClick={onBack} disabled={working || busy}>Use another email</button>
      </div>
      {note && <p className="mt-2 text-xs text-emerald-300">{note}</p>}
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      <p className="mt-3 text-[11px] leading-snug text-white/45">Nothing in your inbox? Check junk. The code is good for an hour.</p>
    </div>
  );
}
