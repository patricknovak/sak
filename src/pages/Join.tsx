import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { rpc, setRemember, supabase } from '../lib/supabase';
import { useLeague } from '../lib/store';
import { Spinner } from '../components/ui';
import { LeagueCrest } from '../components/Brand';
import { themed } from '../components/LeagueIdentity';

// The page an invite link opens (#/join/<code>), signed in or not. It shows what the invite is for, then:
// someone new makes their account right here (the `join` edge function makes it and seats them in one go);
// someone with an account signs in, or is already signed in, and takes the seat with accept_invite.
// Either way they land in the league they just joined.
interface Preview { ok: boolean; reason?: string | null; league_id?: number; league?: string; short?: string; brand?: { colors?: { gold?: string } } | null; role?: 'gm' | 'spectator'; team?: string | null; expires_at?: string }

const WHY: Record<string, string> = {
  unknown: 'That invite link isn’t right. Ask the commissioner for a new one.',
  revoked: 'That invite was cancelled. Ask the commissioner for a new one.',
  expired: 'That invite has expired. Ask the commissioner for a new one.',
  used: 'That invite has already been used. Ask the commissioner for a new one.',
  taken: 'Someone has already taken that seat.',
};

// into the league just joined: its pages load fresh for it
const goHome = () => { window.location.hash = '#/'; window.location.reload(); };

export default function Join({ code }: { code: string }) {
  const { session, me } = useLeague();
  const [pv, setPv] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'new' | 'have'>('new');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { rpc<Preview>('invite_preview', { p_code: code }).then(setPv, () => setPv({ ok: false, reason: 'unknown' })); }, [code]);

  const accept = async () => {
    try { await rpc('accept_invite', { p_code: code }); goHome(); }
    catch (e) { setBusy(false); setErr((e as Error).message); }
  };

  // someone new: make the account and take the seat, then sign in
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) { setErr('The two passwords don’t match.'); return; }
    setBusy(true); setErr('');
    const login = email.trim().toLowerCase();
    const { error } = await supabase.functions.invoke('join', { body: { code, email: login, password: pw, name: name.trim() } });
    if (error) {
      const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
      setBusy(false);
      setErr(body?.error ?? 'Couldn’t join right now. Try again in a minute.');
      if (body?.signIn) setMode('have');
      return;
    }
    setRemember(true);
    const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
    if (se) { setBusy(false); setErr(`You're in, but signing in failed: ${se.message}. Sign in from the main page.`); return; }
    try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
    goHome();
  };

  // someone with an account: sign in, then take the seat
  const signInAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setRemember(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: pw });
    if (error) { setBusy(false); setErr(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message); return; }
    await accept();
  };

  // the invite wears the inviting league's colour and crest (SaK keeps its own badge)
  const sak = !pv?.ok || pv.league_id === 1 || (pv.league_id == null && pv.short === 'SaK');
  const gold = !sak && /^#[0-9a-f]{6}$/i.test(pv?.brand?.colors?.gold ?? '') ? pv!.brand!.colors!.gold! : null;
  const what = pv?.role === 'spectator' ? 'a spectator place' : pv?.team ? `the ${pv.team} seat` : 'a seat';
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  return (
    <div className="pt-safe flex min-h-dvh flex-col items-center justify-center px-4 py-10" style={gold ? themed(gold) : undefined}>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          {sak ? <img src="./icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" /> : <span className="mb-3 inline-block"><LeagueCrest short={pv?.short ?? '…'} size={64} /></span>}
          <div className="label text-mute">You&apos;re invited to</div>
          <h1 className="h-display text-shine mt-1 text-3xl leading-tight">{pv?.league ?? '…'}</h1>
          {pv?.ok && <p className="mt-2 text-sm text-slate-300">Taking {what}{pv.role === 'gm' ? ' as its GM' : ''}.</p>}
        </div>

        {!pv ? <div className="flex justify-center py-8"><Spinner /></div>
          : !pv.ok ? <div className="card p-5 text-center text-sm text-slate-200">{WHY[pv.reason ?? 'unknown'] ?? WHY.unknown}</div>
          : session ? (
            <div className="card-hero p-5">
              <p className="relative text-sm text-white/80">You&apos;re signed in{me ? ` as ${me.gm_name}` : ''}. Joining adds this league to your account; you can switch between leagues on your Profile.</p>
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy} onClick={() => { setBusy(true); setErr(''); accept(); }}>
                {busy ? <Spinner /> : `🏒 Join ${pv.short ?? pv.league}`}
              </button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => supabase.auth.signOut()}>Not you? Sign out</button>
            </div>
          ) : mode === 'new' ? (
            <form onSubmit={join} className="card-hero p-5">
              <label className="label relative text-white/70" htmlFor="jname">Your name</label>
              <input id="jname" className="input relative mt-1" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="What the league calls you" />
              <label className="label relative mt-3 block text-white/70" htmlFor="jemail">Email</label>
              <input id="jemail" className="input relative mt-1" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label className="label relative mt-3 block text-white/70" htmlFor="jpw">Password</label>
              <input id="jpw" className="input relative mt-1" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="6+ characters" />
              <input className="input relative mt-2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="Same again" />
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || name.trim().length < 2 || !okEmail || pw.length < 6 || !pw2}>{busy ? <Spinner /> : '🏒 Join the league'}</button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => { setMode('have'); setErr(''); }}>Already have an account? Sign in to join</button>
            </form>
          ) : (
            <form onSubmit={signInAndAccept} className="card-hero p-5">
              <label className="label relative text-white/70" htmlFor="jemail2">Email</label>
              <input id="jemail2" className="input relative mt-1" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label className="label relative mt-3 block text-white/70" htmlFor="jpw2">Password</label>
              <input id="jpw2" className="input relative mt-1" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || !okEmail || !pw}>{busy ? <Spinner /> : '🏒 Sign in and join'}</button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => { setMode('new'); setErr(''); }}>New here? Make an account</button>
            </form>
          )}
        {err && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
      </div>
    </div>
  );
}
