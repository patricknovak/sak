// A fantasy league of your own, from the start page (#/new, migration 242: fantasy_start). Every choice that shapes the
// league is made up front, in plain words: how many teams, season total or head-to-head (and its playoffs), points or
// categories, keepers and the draft. The rest (the roster, the points per stat, the NHL calendar) starts from the SaK
// Superleague's and is changed on the Commish page. The league opens in setup with its starter in the commissioner's
// seat and lands on the Commish page, where the invites and the checklist are. A stranger from the landing's door
// starts it with an email and a password in the same form (the join function's fantasy body, migration 347); an email
// that already has an account signs in right here and the league starts on it.
import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { rpc, setRemember, supabase } from '../lib/supabase';
import { openPool } from '../lib/host';
import { signOut } from '../lib/guest';
import { attributionFields, trackPoolCreated, trackSignUp } from '../lib/analytics';
import { CATEGORIES, STANDARD_CATEGORIES } from '../lib/categories';
import { Spinner } from './ui';
import { humanField } from '../lib/turnstile';

const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

function Field({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="[counter-increment:step]">
      <div className="mb-2 flex items-center gap-2"><span className="num grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs font-black text-white before:content-[counter(step)]" /><span className="label text-white/80">{title}</span></div>
      {children}
      {note && <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{note}</p>}
    </div>
  );
}
function Seg<T extends string | number>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="grid gap-1.5 rounded-2xl bg-black/25 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(([k, l]) => <button key={String(k)} type="button" onClick={() => set(k)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${value === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
    </div>
  );
}

export function FantasyStart({ color, setColor, swatches, member, signedIn }: { color: string; setColor: (c: string) => void; swatches: string[]; member: boolean; signedIn: boolean }) {
  const [name, setName] = useState('');
  const [teams, setTeams] = useState(8);
  const [format, setFormat] = useState<'season' | 'h2h'>('season');
  const [scoring, setScoring] = useState<'points' | 'cats'>('points');
  const [cats, setCats] = useState<string[]>(STANDARD_CATEGORIES);
  const [playoffs, setPlayoffs] = useState(4);
  const [keepers, setKeepers] = useState(0);
  const [snake, setSnake] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // the stranger's own details, under the league's: who they are and how they'll sign in
  const [host, setHost] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [haveAccount, setHaveAccount] = useState(false);
  const [notYet, setNotYet] = useState(false);
  // signed in here with an account that already exists: the league starts on it the moment its seat loads
  const pending = useRef(false);
  const po = format === 'h2h' ? Math.min(playoffs, teams) : 0;
  const okCats = scoring === 'points' || (cats.length >= 3 && cats.length <= 12);
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const stranger = !member && !signedIn;
  const ready = name.trim().length >= 3 && okCats && (member || (stranger && host.trim().length >= 2 && okEmail && pw.length >= (haveAccount ? 1 : 6)));
  const params = () => ({ p_name: name.trim(), p_color: color, p_seats: teams, p_format: format, p_categories: scoring === 'cats' ? cats : null, p_keepers: keepers, p_playoffs: po, p_snake: snake });
  const startAsMember = async () => {
    const r = await rpc<{ id: number; slug: string }>('fantasy_start', params());
    await trackPoolCreated({ id: r.id, kind: 'fantasy', sport: 'nhl' });
    await openPool({ league_id: r.id, slug: r.slug }, '/commish');
  };
  useEffect(() => {
    if (!pending.current || !member) return;
    pending.current = false;
    startAsMember().catch((x) => { setErr((x as Error).message); setBusy(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);
  const start = async () => {
    setBusy(true); setErr(''); setNotYet(false);
    try {
      if (member) { await startAsMember(); return; }
      const login = email.trim().toLowerCase();
      if (haveAccount) {
        setRemember(true);
        const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
        if (se) { setBusy(false); setErr(se.message === 'Invalid login credentials' ? 'That email and password don’t match.' : se.message); return; }
        try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
        pending.current = true;
        return;
      }
      const { data, error } = await supabase.functions.invoke('join', { body: { fantasy: { name: name.trim(), color, seats: teams, format, categories: scoring === 'cats' ? cats : null, keepers, playoffs: po, snake },
        email: login, password: pw, name: host.trim(), ...attributionFields(), ...(await humanField()) } });
      if (error) {
        const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
        if (body?.signIn) { setHaveAccount(true); setPw(''); setErr('That email already has an account. Type its password and the league starts on it.'); setBusy(false); return; }
        if (body?.notYet) setNotYet(true);
        setErr(body?.error ?? 'Couldn’t start the league right now. Try again in a minute.');
        setBusy(false);
        return;
      }
      setRemember(true);
      const opened = (data as { league?: { id: number; slug: string } })?.league;
      await trackPoolCreated({ id: opened?.id, kind: 'fantasy', sport: 'nhl' });
      const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
      if (se) { setBusy(false); setErr(`Your league is open, but signing in failed: ${se.message}. Sign in from the main page.`); return; }
      try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
      await trackSignUp('email', login);
      if (opened) await openPool({ league_id: opened.id, slug: opened.slug }, '/commish');
      else { window.location.hash = '#/'; window.location.reload(); }
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };
  const toggleCat = (k: string) => setCats((cs) => (cs.includes(k) ? cs.filter((x) => x !== k) : [...cs, k]));
  const summary = [`${teams} teams`, format === 'h2h' ? `head-to-head${po ? `, ${po}-team playoffs` : ', no playoffs'}` : 'season total',
    scoring === 'points' ? 'fantasy points' : `${cats.length} categories`, keepers ? `${keepers} keeper${keepers === 1 ? '' : 's'} a team` : 'no keepers', snake ? 'snake draft' : 'same order every round'];

  // signed in, but in no pool: this account can't host (the rule in fantasy_start); a new account can, with nothing lost
  if (signedIn && !member) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4 text-sm text-white/80">
        <div className="font-semibold text-white">This account isn’t in a pool yet</div>
        <p className="mt-1 text-white/70">A league is started from an account that plays on Super Pools. Start it with a new account instead, or tell us about your league, with the rosters and keepers you have now, and we open it with you.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-gold px-4 py-2 text-sm" onClick={() => void signOut()}>Sign out and start with a new account</button><a href="#/start" className="btn-ghost px-4 py-2 text-sm">Ask us to set it up</a></div>
      </div>
    );
  }
  return (
    <>
      <Field title="How many teams?" note="Seat 1 is yours as commissioner; the rest wait for the GMs you invite from the Commish page. Four to twenty.">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-black/25 p-1 pl-3">
          <span className="text-sm text-white/70">Including yours</span>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold text-white disabled:opacity-30" disabled={teams <= 4} onClick={() => setTeams(teams - 1)} aria-label="One team fewer">−</button>
            <span className="num w-8 text-center font-display text-2xl font-extrabold text-white">{teams}</span>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-lg font-bold text-white disabled:opacity-30" disabled={teams >= 20} onClick={() => setTeams(teams + 1)} aria-label="One team more">+</button>
          </div>
        </div>
      </Field>
      <Field title="How it’s won" note={format === 'season' ? 'Every team plays the whole season against everyone: the best total at the end wins.' : 'Each week you play one other team; the best record makes the playoffs, and the bracket decides the champion.'}>
        <Seg value={format} set={setFormat} options={[['season', '📈 Season total'], ['h2h', '⚔️ Head-to-head']]} />
        {format === 'h2h' && <div className="mt-1.5"><Seg value={playoffs} set={setPlayoffs} options={[[0, 'No playoffs'], [4, '4 teams'], [6, '6 teams'], [8, '8 teams']]} /></div>}
      </Field>
      <Field title="How it scores" note={scoring === 'points' ? 'Every stat a player starts for you is worth points: goals, assists, shots, hits, a goalie’s wins and saves. The values start from our standard scoring; change any of them on the Commish page.'
        : `${format === 'h2h' ? 'Each week, win more categories than your opponent to win the week.' : 'Rotisserie: teams are ranked in each category on the season; first earns as many points as there are teams.'} Pick 3 to 12.`}>
        <Seg value={scoring} set={setScoring} options={[['points', '🏒 Fantasy points'], ['cats', format === 'h2h' ? '📊 Categories' : '📊 Rotisserie']]} />
        {scoring === 'cats' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const on = cats.includes(c.key);
              return <button key={c.key} type="button" onClick={() => toggleCat(c.key)} title={c.label}
                className={`rounded-full px-2.5 py-1 text-xs font-bold ring-1 transition ${on ? 'text-[#0b1220]' : 'bg-white/[.04] text-white/70 ring-white/15'}`}
                style={on ? { background: color, borderColor: color, ['--tw-ring-color' as string]: color } : undefined}>{c.short}</button>;
            })}
          </div>
        )}
        {!okCats && <p className="mt-1.5 text-xs text-amber-200">Pick 3 to 12 categories.</p>}
      </Field>
      <Field title="Keepers and the draft" note={keepers ? `Each team keeps ${keepers} player${keepers === 1 ? '' : 's'} from one season to the next; the draft fills the rest.` : 'A fresh draft every season: nobody is kept.'}>
        <Seg value={keepers} set={setKeepers} options={[[0, 'None'], [1, '1'], [3, '3'], [5, '5'], [8, '8']]} />
        <div className="mt-1.5"><Seg value={snake ? 'snake' : 'straight'} set={(v) => setSnake(v === 'snake')} options={[['snake', '🐍 Snake draft'], ['straight', 'Same order each round']]} /></div>
      </Field>
      <Field title="Name it">
        <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="The Beer League" />
        <div className="mt-3 flex flex-wrap gap-2.5">
          {swatches.map((s) => (
            <button key={s} type="button" aria-label={`Colour ${s}`} onClick={() => setColor(s)} className="grid h-10 w-10 place-items-center rounded-full ring-2 transition"
              style={{ background: s, boxShadow: color === s ? `0 0 18px ${s}` : undefined, ['--tw-ring-color' as string]: color === s ? '#fff' : 'transparent' }}>
              {color === s && <Check size={18} className="text-[#0b1220]" strokeWidth={3} />}
            </button>
          ))}
        </div>
      </Field>
      <div className="rounded-2xl p-3 text-sm" style={{ background: `rgb(${rgb(color)} / .1)`, boxShadow: `inset 0 0 0 1px rgb(${rgb(color)} / .35)` }}>
        <div className="text-[10px] font-black uppercase tracking-[.16em]" style={{ color }}>Your league</div>
        <div className="mt-1 font-semibold text-white">{name.trim() || 'Your league'}: {summary.join(' · ')}</div>
        <div className="mt-1 text-xs text-white/60">NHL players, a standard roster (2C, 2LW, 2RW, 4D, 2G, a bench and IR) and the NHL calendar. It opens in setup: invite your GMs, set draft night, and take it live from the Commish page when the checklist is ticked.</div>
      </div>
      {stranger && (
        <div className="space-y-3 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between gap-3">
            <div className="label text-white/80">{haveAccount ? 'Sign in to run it' : 'You, the commissioner'}</div>
            <button type="button" className="text-xs font-semibold text-white/60 underline" onClick={() => { setHaveAccount(!haveAccount); setErr(''); }}>{haveAccount ? 'New here? Make an account' : 'Already have an account?'}</button>
          </div>
          {!haveAccount && <input className="input w-full" value={host} onChange={(e) => setHost(e.target.value)} maxLength={40} autoComplete="name" placeholder="Your name" aria-label="Your name" />}
          <input className="input w-full" type="email" inputMode="email" autoComplete={haveAccount ? 'username' : 'email'} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" />
          <div className="relative">
            <input className="input w-full pr-16" type={showPw ? 'text' : 'password'} autoComplete={haveAccount ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={haveAccount ? 'Your password' : 'A password, 6+ characters'} aria-label="Password" />
            <button type="button" className="absolute inset-y-0 right-3 text-xs font-semibold text-white/70" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide the password' : 'Show the password'}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
          {haveAccount
            ? <p className="text-[11px] leading-snug text-white/50">The league goes on your account beside the others, on My pools.</p>
            : <p className="text-[11px] leading-snug text-white/50">Starting a league means you agree to the <a href="#/terms" className="underline">Terms of use</a>. <a href="#/privacy" className="underline">What we keep, held in the United States</a>.</p>}
        </div>
      )}
      <button type="button" className="btn-gold w-full py-3 text-base" disabled={busy || !ready} onClick={start}>{busy ? <Spinner /> : haveAccount && !member ? '🏒 Sign in and start' : '🏒 Start my league'}</button>
      {notYet && <a href="#/start" className="btn-ghost w-full py-2.5 text-sm">Ask us to set it up</a>}
      {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">{err}</div>}
    </>
  );
}
