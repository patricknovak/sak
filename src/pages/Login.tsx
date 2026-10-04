import { useState } from 'react';
import { remembered, setRemember, supabase } from '../lib/supabase';
import { Spinner } from '../components/ui';
import { Wordmark } from '../components/Brand';

// Sign in with your email and password (Patrick's call, October 2026; every SaK account has its own email since step 2).
// Forgot your password: the league emails you a code, you type it with a new password, and you're in. The code works
// on any device (no link to open on the right phone).
export default function Login() {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('sak-last-email') ?? ''; } catch { return ''; } });
  const [remember, setRem] = useState(remembered);
  const [mode, setMode] = useState<'in' | 'forgot' | 'code'>('in');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const login = email.trim().toLowerCase();
  const go = (m: typeof mode) => { setMode(m); setErr(''); setNote(''); setPw(''); setPw2(''); setCode(''); };

  const keepEmail = () => { try { if (remember) localStorage.setItem('sak-last-email', login); else localStorage.removeItem('sak-last-email'); } catch { /* nothing to remember with */ } };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setRemember(remember);
    const { error } = await supabase.auth.signInWithPassword({ email: login, password: pw });
    setBusy(false);
    if (error) setErr(error.message === 'Invalid login credentials' ? 'That email and password don’t match. Forgot it? Reset it below.' : error.message);
    else keepEmail();
  };

  // the league emails a one-time code; nothing says whether the address has an account
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const { error } = await supabase.auth.resetPasswordForEmail(login);
    setBusy(false);
    if (error) { setErr(/rate limit/i.test(error.message) ? 'Too many codes asked for. Wait a few minutes and try again.' : error.message); return; }
    go('code');
    setNote(`If ${login} has an account, a code is on its way. Check your inbox (and junk).`);
  };

  // the code signs you in for the reset; the new password goes on straight after
  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return; }
    setBusy(true); setErr('');
    setRemember(remember);
    const { error } = await supabase.auth.verifyOtp({ email: login, token: code.trim(), type: 'recovery' });
    if (error) { setBusy(false); setErr(/expired|invalid/i.test(error.message) ? 'That code didn’t work. Check it, or ask for a new one.' : error.message); return; }
    const up = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (up.error) setErr(`You're signed in, but the new password didn't save: ${up.error.message}. Set it on your Profile page.`);
    else keepEmail();
  };

  const rememberBox = (
    <label className="relative mt-3 flex cursor-pointer items-center gap-2 text-sm text-white/80">
      <input type="checkbox" className="h-4 w-4 accent-gold" checked={remember} onChange={(e) => setRem(e.target.checked)} />
      Remember me on this device
    </label>
  );
  const emailField = (
    <>
      <label className="label relative text-white/70" htmlFor="email">Email</label>
      <input id="email" className="input relative mt-1" type="email" inputMode="email" autoComplete="username" autoFocus={!email}
        value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
    </>
  );
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(login);

  return (
    <div className="pt-safe relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-10">
      {/* arena lights */}
      <div className="pointer-events-none absolute inset-0">
        <div className="animate-glow absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(var(--gold-rgb)/.22), transparent)' }} />
        <div className="absolute -left-32 top-10 h-[640px] w-40 rotate-[24deg] bg-gradient-to-b from-white/[.10] to-transparent blur-2xl" />
        <div className="absolute -right-32 top-10 h-[640px] w-40 -rotate-[24deg] bg-gradient-to-b from-white/[.10] to-transparent blur-2xl" />
        <div className="absolute bottom-0 left-1/2 h-64 w-[900px] -translate-x-1/2 rounded-[100%] border-t-[6px] border-goal/20" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-4 h-24 w-24">
            <div className="absolute inset-0 animate-glow rounded-[28px] bg-gold/40 blur-2xl" />
            <img src="./icon.svg" alt="" className="relative h-24 w-24 drop-shadow-2xl" />
          </div>
          <h1><Wordmark size="lg" /></h1>
          <p className="mt-2 text-xs font-bold uppercase tracking-[.3em] text-mute">She’s A Keeper · est. 2013 · 2026-27</p>
        </div>

        {mode === 'in' ? (
          <form onSubmit={signIn} className="card-hero animate-pop p-5">
            {emailField}
            <label className="label relative mt-3 block text-white/70" htmlFor="pw">Password</label>
            <input id="pw" className="input relative mt-1" type="password" autoComplete="current-password" autoFocus={!!email} value={pw}
              onChange={(e) => setPw(e.target.value)} placeholder="Your Superleague password" />
            {rememberBox}
            <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || !pw || !okEmail}>{busy ? <Spinner /> : '🏒 Drop the puck'}</button>
            <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => go('forgot')}>Forgot your password?</button>
          </form>
        ) : mode === 'forgot' ? (
          <form onSubmit={sendCode} className="card-hero animate-pop p-5">
            <div className="relative mb-3 text-sm text-white/80">Type your email and we&apos;ll send you a code to set a new password.</div>
            {emailField}
            <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || !okEmail}>{busy ? <Spinner /> : '✉️ Email me a code'}</button>
            <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => go('in')}>Back to sign in</button>
          </form>
        ) : (
          <form onSubmit={reset} className="card-hero animate-pop p-5">
            {note && <div className="relative mb-3 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">{note}</div>}
            <label className="label relative text-white/70" htmlFor="code">Code from the email</label>
            <input id="code" className="input relative mt-1 tracking-[.3em]" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="123456" />
            <label className="label relative mt-3 block text-white/70" htmlFor="npw">New password</label>
            <input id="npw" className="input relative mt-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="6+ characters" />
            <input className="input relative mt-2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Same again" />
            {rememberBox}
            <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || code.length < 6 || pw.length < 6 || !pw2}>{busy ? <Spinner /> : '🔑 Set password and sign in'}</button>
            <div className="relative mt-3 flex justify-between text-sm text-white/60">
              <button type="button" className="underline" onClick={() => go('forgot')}>Send a new code</button>
              <button type="button" className="underline" onClick={() => go('in')}>Back to sign in</button>
            </div>
          </form>
        )}
        {err && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
        <p className="mt-8 text-center text-xs italic text-mute">Play fair, play hard and play to win.</p>
      </div>
    </div>
  );
}
