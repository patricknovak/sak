import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Check, Plus, Sparkles } from 'lucide-react';
import { rpc, setRemember, supabase } from '../lib/supabase';
import { openPool } from '../lib/host';
import { useLeague } from '../lib/store';
import { Spinner } from '../components/ui';
import { themed } from '../components/LeagueIdentity';
import { ProductMark } from './Start';

// "Start a pool" (#/new), open to anyone: name a pool, pick its colour and its questions, make an account, and land on
// its Host page with the invite link ready to send. Someone new goes through the `join` function (it makes the account
// and the pool together, migration 153, with limits per address and per day); someone signed in who is already in a
// pool starts it with pool_start, as on My pools. A link can choose the pack (#/new?pack=love-is-blind-s11), which the
// landing page uses. Drawn in the pool's own colour as it is chosen.

const SWATCHES = ['#fb7185', '#38bdf8', '#f7c548', '#34d399', '#c4b5fd', '#f97316'];
interface Pack { slug: string; name: string; questions: number; color: string | null; icon: string | null; blurb: string | null }
const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

const STEPS = [
  ['🔗', 'Send one link', 'Friends tap it in the group chat, pick a name and they’re in. No app to download.'],
  ['🪙', 'Call it in coins', 'Everyone starts with 1,000. Prices move as people buy, so a long shot pays big.'],
  ['👑', 'Wear the crown', 'The leaderboard runs all season. Never money, just bragging rights.'],
] as const;

export default function NewPool() {
  const { session, me } = useLeague();
  const [params] = useSearchParams();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [pack, setPack] = useState<string | null>(params.get('pack'));
  const [color, setColor] = useState<string>(SWATCHES[0]);
  const [pool, setPool] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    rpc<Pack[]>('pool_pack_list').then((d) => {
      setPacks(d ?? []);
      // a pack chosen by the link brings its colour
      const chosen = (d ?? []).find((p) => p.slug === params.get('pack'));
      if (chosen?.color && /^#[0-9a-f]{6}$/i.test(chosen.color)) setColor(chosen.color.toLowerCase());
      else if (params.get('pack') && !chosen) setPack(null);
    }, () => setPacks([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => packs?.find((p) => p.slug === pack) ?? null, [packs, pack]);
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const member = !!session && !!me;
  const ready = pool.trim().length >= 3 && (member || (name.trim().length >= 2 && okEmail && pw.length >= 6));

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setSignIn(false);
    try {
      if (member) {
        const r = await rpc<{ id: number; slug: string }>('pool_start', { p_name: pool.trim(), p_color: color, p_pack: pack });
        await openPool({ league_id: r.id, slug: r.slug }, '/host');
        return;
      }
      const login = email.trim().toLowerCase();
      const { data, error } = await supabase.functions.invoke('join', { body: { pool: { name: pool.trim(), color, pack }, email: login, password: pw, name: name.trim() } });
      if (error) {
        const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
        setErr(body?.error ?? 'Couldn’t start the pool right now. Try again in a minute.');
        setSignIn(!!body?.signIn);
        setBusy(false);
        return;
      }
      setRemember(true);
      const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
      if (se) { setBusy(false); setErr(`Your pool is open, but signing in failed: ${se.message}. Sign in from the main page.`); return; }
      try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
      const opened = (data as { pool?: { id: number; slug: string } })?.pool;
      if (opened) await openPool({ league_id: opened.id, slug: opened.slug }, '/host');
      else { window.location.hash = '#/'; window.location.reload(); }
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <div className="pt-safe min-h-dvh px-4 py-10" style={themed(color)}>
      <div className="mx-auto w-full max-w-md pt-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={56} /></div>
          <h1 className="h-display text-shine text-4xl leading-none">Start a pool</h1>
          <p className="mt-2 text-sm text-slate-300">Questions about anything your group watches, priced like a market, played in coins. Free, and never money.</p>
        </div>

        {chosen && (
          <div className="card-hero mb-4 p-4" style={{ borderColor: `rgb(${rgb(color)} / .45)` }}>
            <div className="relative flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `rgb(${rgb(color)} / .2)` }}>{chosen.icon ?? '✨'}</span>
              <div className="min-w-0">
                <div className="font-semibold text-white">{chosen.name}</div>
                <div className="text-xs text-white/70">{chosen.questions} questions ready to go{chosen.blurb ? `. ${chosen.blurb}` : ', and the coin drops'}</div>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={start} className="card-hero p-5">
          <div className="relative space-y-4">
            <label className="block"><span className="label text-white/70">Name your pool</span>
              <input className="input mt-1 w-full" value={pool} onChange={(e) => setPool(e.target.value)} maxLength={40} placeholder={chosen?.slug.startsWith('love-is-blind') ? 'The Pod Squad' : chosen?.slug.startsWith('premier') ? 'The Sunday League' : chosen?.slug.startsWith('mls') ? 'The Cup Crew' : 'The Group Chat Pool'} /></label>
            <div>
              <span className="label text-white/70">Its colour</span>
              <div className="mt-2 flex flex-wrap gap-2.5">
                {SWATCHES.map((s) => (
                  <button key={s} type="button" aria-label={`Colour ${s}`} onClick={() => setColor(s)} className="grid h-10 w-10 place-items-center rounded-full ring-2 transition"
                    style={{ background: s, boxShadow: color === s ? `0 0 18px ${s}` : undefined, ['--tw-ring-color' as string]: color === s ? '#fff' : 'transparent' }}>
                    {color === s && <Check size={18} className="text-[#0b1220]" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="label text-white/70">Start with</span>
              <div className="mt-2 grid gap-2">
                {[...(packs ?? []).map((p) => ({ slug: p.slug as string | null, name: p.name, icon: p.icon, sub: `${p.questions} questions ready, and the coin drops` })),
                  { slug: null as string | null, name: 'A blank pool', icon: null, sub: 'Ask your own questions from the Host page' }].map((o) => (
                  <button key={o.slug ?? 'blank'} type="button" onClick={() => { setPack(o.slug); const c = packs?.find((x) => x.slug === o.slug)?.color; if (c && /^#[0-9a-f]{6}$/i.test(c)) setColor(c.toLowerCase()); }}
                    className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${pack === o.slug ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: `rgb(${rgb(color)} / .18)`, color }}>{o.icon ? <span className="text-lg leading-none">{o.icon}</span> : o.slug ? <Sparkles size={18} /> : <Plus size={18} />}</span>
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-white">{o.name}</span><span className="block text-xs text-white/60">{o.sub}</span></span>
                    {pack === o.slug && <Check size={18} className="shrink-0 text-emerald-300" />}
                  </button>
                ))}
                {!packs && <div className="flex justify-center py-2"><Spinner /></div>}
              </div>
            </div>

            {member ? (
              <p className="text-sm text-white/70">You’re signed in as {me!.gm_name}. The pool goes on your account beside the others, on My pools.</p>
            ) : session ? (
              <p className="text-sm text-white/70">This account isn’t in a pool yet. Sign out to start one with a new account, or write to hello@superpoolsai.com.</p>
            ) : (
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div className="label text-white/70">And you, the host</div>
                <input className="input w-full" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name, as friends know you" maxLength={40} />
                <input className="input w-full" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <input className="input w-full" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="A password, 6+ characters" />
              </div>
            )}

            <button className="btn-gold w-full py-3 text-base" disabled={busy || !ready || (!!session && !member)}>{busy ? <Spinner /> : '✨ Start my pool'}</button>
            {!session && <a href="#/" className="block text-center text-sm text-white/60 underline">Already have an account? Sign in, then start it from My pools</a>}
          </div>
        </form>
        {err && (
          <div className="mt-4 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">
            {err}{signIn && <> <a href="#/" className="font-semibold underline">Sign in</a></>}
          </div>
        )}

        <div className="mt-6 grid gap-2">
          {STEPS.map(([icon, t, d]) => (
            <div key={t} className="flex items-start gap-3 rounded-2xl border border-white/[.06] bg-white/[.03] p-3">
              <span className="text-xl leading-none">{icon}</span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-white">{t}</span><span className="block text-xs text-mute">{d}</span></span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-center text-[11px] text-mute">Super Pools is free and runs on coins with no cash value. Nothing to buy, nothing to cash out.</p>
      </div>
    </div>
  );
}
