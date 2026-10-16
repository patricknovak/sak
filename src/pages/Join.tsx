import { useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { rpc, setLeagueHeader, setRemember, supabase } from '../lib/supabase';
import { useLeague } from '../lib/store';
import { Spinner } from '../components/ui';
import { LeagueCrest } from '../components/Brand';
import { themed } from '../components/LeagueIdentity';
import { attributionFields, trackFirstCall, trackJoinGroup, trackSignUp } from '../lib/analytics';
import { PRODUCT } from '../lib/brand';
import { setTabLeague } from '../lib/host';

// The page an invite link opens (#/join/<code>), signed in or not. It shows what the invite is for, then:
// someone new makes their account right here (the `join` edge function makes it and seats them in one go);
// someone with an account signs in, or is already signed in, and takes the seat with accept_invite.
// Either way they land in the league they just joined.
interface Preview { ok: boolean; reason?: string | null; league_id?: number; league?: string; short?: string; brand?: { colors?: { gold?: string }; tagline?: string; coin?: { name?: string; emoji?: string } } | null; role?: 'gm' | 'spectator'; team?: string | null; expires_at?: string; kind?: 'fantasy' | 'predict'; host?: string | null; members?: number; open_questions?: number; next_market?: number | null; next_question?: string | null; next_closes?: string | null; next_outcomes?: { key: string; label: string; pct: number }[] | null;
  // a sports pool's next game (migration 293)
  next_game?: string | null; next_game_line?: string | null; next_game_at?: string | null }

const WHY: Record<string, string> = {
  unknown: 'That invite link isn’t right. Ask the commissioner for a new one.',
  revoked: 'That invite was cancelled. Ask the commissioner for a new one.',
  expired: 'That invite has expired. Ask the commissioner for a new one.',
  used: 'That invite has already been used. Ask the commissioner for a new one.',
  taken: 'Someone has already taken that seat.',
};

// when a question closes, in the reader's own clock: "tomorrow at 3:00 a.m.", "Wednesday at 8:00 p.m.", "in 40 minutes"
function closesWords(iso: string) {
  const d = new Date(iso), ms = d.getTime() - Date.now();
  if (ms < 3600000) return `in ${Math.max(1, Math.round(ms / 60000))} minutes`;
  const day = new Date(), tomorrow = new Date(Date.now() + 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const when = same(d, day) ? 'today' : same(d, tomorrow) ? 'tomorrow' : ms < 6 * 86400000 ? d.toLocaleDateString(undefined, { weekday: 'long' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${when} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// into the league just joined: pin this tab to it so the reload reads its coins and table, not a stale one
const goHome = (leagueId?: number | null) => {
  if (leagueId) { setTabLeague(leagueId); setLeagueHeader(leagueId); }
  window.location.hash = '#/';
  window.location.reload();
};

export default function Join({ code }: { code: string }) {
  const { session, me } = useLeague();
  const [pv, setPv] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'new' | 'have'>('new');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // the first call, picked before the account exists and placed the moment they're in (migration 255)
  const [call, setCall] = useState<string | null>(null);
  const FIRST_STAKE = 100;
  const placeFirstCall = async (leagueId?: number | null) => {
    if (!call || !pv?.next_market) return;
    // the call goes to the pool just joined, not to whichever pool this tab was in before
    if (leagueId) setLeagueHeader(leagueId);
    try { await rpc('pool_buy', { p_market: pv.next_market, p_outcome: call, p_coins: FIRST_STAKE }); trackFirstCall('join'); }
    catch { /* the question closed or the pool changed while they typed: they're in, and the board is a tap away */ }
  };

  useEffect(() => { rpc<Preview>('invite_preview', { p_code: code }).then(setPv, () => setPv({ ok: false, reason: 'unknown' })); }, [code]);

  const accept = async () => {
    try {
      const leagueId = await rpc<number>('accept_invite', { p_code: code });
      trackJoinGroup({ id: leagueId ?? pv?.league_id });
      await placeFirstCall(leagueId ?? pv?.league_id);
      goHome(leagueId ?? pv?.league_id);
    } catch (e) { setBusy(false); setErr((e as Error).message); }
  };

  // someone new: make the account and take the seat, then sign in
  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    const login = email.trim().toLowerCase();
    // attribution is first-touch UTM/referrer; the join function ignores unknown fields if the SQL is not live yet
    const { data, error } = await supabase.functions.invoke('join', { body: { code, email: login, password: pw, name: name.trim(), ...attributionFields() } });
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
    trackSignUp('email');
    const leagueId = typeof (data as { league?: number } | null)?.league === 'number' ? (data as { league: number }).league : pv?.league_id;
    trackJoinGroup({ id: leagueId });
    await placeFirstCall(leagueId);
    goHome(leagueId);
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
  // an open link into a prediction pool (migration 145) has no seat named: the newcomer gets one of their own
  const what = pv?.role === 'spectator' ? 'a spectator place' : pv?.team ? `the ${pv.team} seat` : 'a place of your own';
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  // a prediction pool's invite speaks the pool's words (docs/BRAND.md: no sports words in a pool that is not about sport)
  const pool = pv?.kind === 'predict', mark = pool ? '✨' : '🏒', noun = pool ? 'pool' : 'league';

  return (
    <div className="pt-safe flex min-h-dvh flex-col items-center justify-center px-4 py-10" style={gold ? themed(gold) : undefined}>
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          {sak ? <img src="./icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" /> : <span className="mb-3 inline-block"><LeagueCrest short={pv?.short ?? '…'} size={64} /></span>}
          <div className="label text-mute">You&apos;re invited to</div>
          <h1 className="h-display text-shine mt-1 text-3xl leading-tight">{pv?.league ?? '…'}</h1>
          {pv?.ok && (pool
            ? <>
                <p className="mt-2 text-sm text-slate-300">{pv.brand?.tagline ? `${pv.brand.tagline}. ` : ''}Your place is ready.</p>
                {pv.host && <p className="mt-1 text-sm font-semibold text-white">{pv.host} invited you{pv.members && pv.members > 1 ? ` · ${pv.members} are in` : ''}</p>}
              </>
            : <p className="mt-2 text-sm text-slate-300">Taking {what}{pv.role === 'gm' && pv.team ? ' as its GM' : ''}.</p>)}
        </div>

        {/* what a pool is, for someone who tapped a link in the group chat */}
        {pv?.ok && pool && (
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            {/* a sports pool with no questions is about the games: picks, not coins (migration 293) */}
            {(pv.next_game && !pv.next_question
              ? [['🏆', 'A table and a crown'], ['🎯', 'Make your calls'], ['🆓', 'Free, never money']]
              : [[pv.brand?.coin?.emoji || PRODUCT.coin.emoji, `1,000 ${(pv.brand?.coin?.name || PRODUCT.coin.name).toLowerCase()} to start`], ['🔮', 'Call what happens next'], ['🆓', 'Free, never money']]).map(([e, t]) => (
              <div key={t} className="rounded-2xl border border-white/10 bg-white/[.04] px-2 py-3">
                <div className="text-xl leading-none">{e}</div>
                <div className="mt-1.5 text-balance text-[12px] font-semibold leading-tight text-slate-200">{t}</div>
              </div>
            ))}
          </div>
        )}

        {/* the first call, before the form: what the pool is asking right now and when it closes (migration 252) */}
        {pv?.ok && pool && pv.next_question && (
          <div className="card-hero mb-4 p-4">
            <div className="label relative text-white/70">First up{pv.open_questions && pv.open_questions > 1 ? ` · ${pv.open_questions} open to call` : ''}</div>
            <div className="relative mt-1 text-balance text-lg font-bold leading-snug text-white">{pv.next_question}</div>
            {pv.next_closes && <div className="relative mt-1.5 text-xs text-white/70">Closes {closesWords(pv.next_closes)}</div>}
            {pv.next_outcomes && pv.next_outcomes.length > 0 && (
              <div className="relative mt-3">
                <div className="flex flex-wrap gap-2">
                  {pv.next_outcomes.map((o) => (
                    <button key={o.key} type="button" onClick={() => setCall(call === o.key ? null : o.key)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${call === o.key ? 'border-white bg-white text-[#1a0a10]' : 'border-white/25 bg-white/[.08] text-white hover:bg-white/[.14]'}`}>
                      {o.label} <span className={`num ${call === o.key ? 'text-[#1a0a10]/70' : 'text-white/60'}`}>{o.pct}%</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-xs text-white/70">
                  {call ? <>Your first call: <b className="text-white">{pv.next_outcomes.find((o) => o.key === call)?.label}</b> for {FIRST_STAKE} {(pv.brand?.coin?.name || PRODUCT.coin.name).toLowerCase()}, placed the moment you&apos;re in.</>
                    : 'Tap an answer to make it your first call. The numbers are the pool’s chances.'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* a sports pool asks no question: its next game is the pitch instead (migration 293) */}
        {pv?.ok && pool && !pv.next_question && pv.next_game && (
          <div className="card-hero mb-4 p-4">
            <div className="label relative text-white/70">First up</div>
            <div className="relative mt-1 text-balance text-lg font-bold leading-snug text-white">{pv.next_game}</div>
            <div className="relative mt-1 text-sm text-white/80">{pv.next_game_line}</div>
            {pv.next_game_at && <div className="relative mt-1.5 text-xs text-white/70">The first pick locks {closesWords(pv.next_game_at)}</div>}
          </div>
        )}

        {!pv ? <div className="flex justify-center py-8"><Spinner /></div>
          : !pv.ok ? <div className="card p-5 text-center text-sm text-slate-200">{WHY[pv.reason ?? 'unknown'] ?? WHY.unknown}</div>
          : session ? (
            <div className="card-hero p-5">
              <p className="relative text-sm text-white/80">You&apos;re signed in{me ? ` as ${me.gm_name}` : ''}. Joining adds this {noun} to your account; you can switch between them on your Profile.</p>
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy} onClick={() => { setBusy(true); setErr(''); accept(); }}>
                {busy ? <Spinner /> : `${mark} Join ${pv.short ?? pv.league}`}
              </button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => supabase.auth.signOut()}>Not you? Sign out</button>
            </div>
          ) : mode === 'new' ? (
            <form onSubmit={join} className="card-hero p-5">
              <label className="label relative text-white/70" htmlFor="jname">Your name</label>
              <input id="jname" className="input relative mt-1" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`What the ${noun} calls you`} />
              <label className="label relative mt-3 block text-white/70" htmlFor="jemail">Email</label>
              <input id="jemail" className="input relative mt-1" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label className="label relative mt-3 block text-white/70" htmlFor="jpw">Password</label>
              <div className="relative mt-1">
                <input id="jpw" className="input w-full pr-16" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="6+ characters" />
                <button type="button" className="absolute inset-y-0 right-3 text-xs font-semibold text-white/70" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide the password' : 'Show the password'}>{show ? 'Hide' : 'Show'}</button>
              </div>
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || name.trim().length < 2 || !okEmail || pw.length < 6}>{busy ? <Spinner /> : `${mark} Join the ${noun}`}</button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => { setMode('have'); setErr(''); }}>Already have an account? Sign in to join</button>
            </form>
          ) : (
            <form onSubmit={signInAndAccept} className="card-hero p-5">
              <label className="label relative text-white/70" htmlFor="jemail2">Email</label>
              <input id="jemail2" className="input relative mt-1" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <label className="label relative mt-3 block text-white/70" htmlFor="jpw2">Password</label>
              <input id="jpw2" className="input relative mt-1" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="btn-primary relative mt-4 w-full py-3 text-base" disabled={busy || !okEmail || !pw}>{busy ? <Spinner /> : `${mark} Sign in and join`}</button>
              <button type="button" className="relative mt-3 w-full text-center text-sm text-white/60 underline" onClick={() => { setMode('new'); setErr(''); }}>New here? Make an account</button>
            </form>
          )}
        {err && <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
      </div>
    </div>
  );
}
