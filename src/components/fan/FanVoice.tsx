// The fans' voice on a fan zone page (migration 337, 25 October 2026): who the fan is, the sign-in sheet (just a name,
// or an email), the calls (who starts in goal, the MVP, the one to move, the need, the window, the spring, grades for
// the GM and the coach; for the league the Cup and the awards) with every fan's split, and a verdict of the fan's own on
// each of the analysis's bigger questions. src/lib/fanVoice.ts reads and writes it; the board and the knowledge base
// are in FanBoard.tsx. Every league's zones use the same pieces (migration 338): the provider carries the league, its
// sport (which decides the calls) and its clubs.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { Check, LogIn, Megaphone, PencilLine, ShieldCheck, Users } from 'lucide-react';
import { setRemember, supabase } from '../../lib/supabase';
import {
  NHL_DIR, VERDICTS, callsFor, dirName, fanCall, fanJoin, fanPulse, fanSetMe, gradeAvg, shares, shownName, useFanMe,
  type CallDef, type CallSplit, type FanDir, type FanLeague, type FanMe, type FanPulse, type FanSport,
} from '../../lib/fanVoice';
import { isGuestEmail } from '../../lib/guest';
import { useLeague } from '../../lib/store';
import type { FanData } from '../../lib/fanZone';
import type { SportClub, SportLeague } from '../../lib/fanSport';
import { Sheet, Spinner, useToast } from '../ui';
import { ClubMark } from './kit';

interface Voice {
  league: string; sport: FanSport; board: string; dir: FanDir;
  club: string; me: FanMe | null; signedIn: boolean; refreshMe: () => void;
  pulse: FanPulse | null; reloadPulse: () => void;
  call: (topic: string, choice: string | null) => void;
  ask: (why?: string) => void;
}
const Ctx = createContext<Voice | null>(null);
export const useVoice = () => useContext(Ctx);

export function FanVoiceProvider({ club, league = 'nhl', dir, children }: { club: string; league?: string; dir?: FanDir | null; children: ReactNode }) {
  const d = dir ?? NHL_DIR;
  const { me, signedIn, refresh } = useFanMe();
  const toast = useToast();
  const [pulse, setPulse] = useState<FanPulse | null>(null);
  const [tick, setTick] = useState(0);
  const [why, setWhy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fanPulse(club, undefined, league).then((p) => { if (live) setPulse(p); }, () => { if (live) setPulse(null); });
    return () => { live = false; };
  }, [club, league, tick, signedIn]);
  const call = useCallback((topic: string, choice: string | null) => {
    if (!signedIn) { setWhy('Sign in to make your call. Just a name will do.'); return; }
    // the fan's own pick shows at once; every fan's split follows from the database
    setPulse((p) => p && { ...p, mine: { ...(p.mine ?? {}), [topic]: choice ?? '' } });
    fanCall(club, topic, choice, league).then((r) => setPulse((p) => p && {
      ...p, calls: { ...p.calls, [topic]: { total: r.total, choices: r.choices } },
      mine: Object.fromEntries(Object.entries({ ...(p.mine ?? {}), [topic]: r.mine ?? '' }).filter(([, x]) => x)),
    }), (e) => { toast((e as Error).message, 'err'); setTick((n) => n + 1); });
  }, [club, league, signedIn, toast]);
  const value = useMemo<Voice>(() => ({
    league, sport: d.sport, board: d.board, dir: d,
    club, me, signedIn, refreshMe: refresh, pulse, reloadPulse: () => setTick((n) => n + 1), call,
    ask: (w) => setWhy(w ?? 'Sign in to add your voice. Just a name will do.'),
  }), [league, d, club, me, signedIn, refresh, pulse, call]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <FanSignIn open={why != null} why={why ?? ''} club={club} dir={d} onClose={() => setWhy(null)} onDone={() => { setWhy(null); refresh(); }} />
    </Ctx.Provider>
  );
}

// ───────────── signing in: a name is enough ─────────────
function FanSignIn({ open, why, club, dir, onClose, onDone }: { open: boolean; why: string; club: string; dir: FanDir; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'name' | 'email'>('name');
  const [name, setName] = useState('');
  const [fav, setFav] = useState('');
  const [email, setEmail] = useState(() => { try { return localStorage.getItem('sak-last-email') ?? ''; } catch { return ''; } });
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setErr(''); setFav(club === dir.board ? '' : club); } }, [open, club, dir.board]);
  const shown = shownName(name);

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await fanJoin(name.trim(), fav || null, dir.league); onDone(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    setRemember(true);
    const login = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: login, password: pw });
    setBusy(false);
    if (error) { setErr(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : error.message); return; }
    try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
    onDone();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add your voice">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/95 shadow"><ClubMark league={dir.league} code={club} logo={dir.byCode[club]?.logo} size={34} light /></span>
          <div className="min-w-0">
            <div className="font-display text-lg font-extrabold leading-tight text-white">{club === dir.board ? 'Join the fans' : `Join the ${dirName(dir, club)} fans`}</div>
            <p className="mt-0.5 text-sm leading-snug text-slate-300">{why}</p>
          </div>
        </div>
        {mode === 'name' ? (
          <form onSubmit={join} className="space-y-3">
            <label className="block">
              <span className="label">Your name</span>
              <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" placeholder="First and last name" />
              <span className="mt-1 block text-[11px] text-mute">{shown ? <>Others see <b className="text-slate-200">{shown}</b>, never more.</> : 'Others see only your first name and initial.'}</span>
            </label>
            <label className="block">
              <span className="label">Your club</span>
              <select className="input mt-1" value={fav} onChange={(e) => setFav(e.target.value)}>
                <option value="">No club, just the league</option>
                {dir.clubs.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <button className="btn-club w-full py-2.5" disabled={busy || name.trim().length < 2}>{busy ? <Spinner /> : 'Join as a fan'}</button>
          </form>
        ) : (
          <form onSubmit={signIn} className="space-y-2">
            <input aria-label="Email" className="input" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <input aria-label="Password" className="input" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" />
            <button className="btn-club w-full py-2.5" disabled={busy || !email.trim() || !pw}>{busy ? <Spinner /> : <><LogIn className="h-4 w-4" />Sign in</>}</button>
            <a href="#/" className="block text-center text-xs text-mute underline">Forgot it? Reset it on the sign-in page</a>
          </form>
        )}
        {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-3 py-2 text-sm text-red-200">{err}</div>}
        <button type="button" onClick={() => { setMode(mode === 'name' ? 'email' : 'name'); setErr(''); }} className="w-full text-center text-sm font-semibold text-sky-300">
          {mode === 'name' ? 'Have a Super Pools account? Sign in with your email' : 'No account? Just use a name'}
        </button>
        <p className="text-[11px] leading-snug text-mute">No email needed: you stay signed in on this phone, and you can add an email any time to keep your name everywhere. Posts are public under your first name and initial; votes and calls only ever count in the totals. <a href="#/privacy" className="underline">Privacy</a></p>
      </div>
    </Sheet>
  );
}

// ───────────── the fan, as the fan zones know them ─────────────
export function FanMeBar() {
  const v = useVoice();
  const { session } = useLeague();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [keep, setKeep] = useState(false);
  if (!v) return null;
  if (!v.signedIn) {
    return (
      <button type="button" onClick={() => v.ask()} className="card flex w-full items-center gap-3 p-3 text-left hover:bg-white/[.03]">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl" style={{ background: 'rgb(var(--club-rgb) / .2)', boxShadow: 'inset 0 0 0 1px rgb(var(--club-rgb) / .45)' }}><Megaphone className="h-5 w-5" style={{ color: 'var(--club)' }} /></span>
        <span className="min-w-0 flex-1"><b className="block text-white">Add your voice</b><span className="block text-[12px] leading-snug text-mute">Make your calls, post ideas and vote. Just a name, no email.</span></span>
        <span className="btn-club btn-sm shrink-0">Join</span>
      </button>
    );
  }
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // the club the fan already follows stays theirs, whatever league this page is in
    const own = v.me?.club ? { club: v.me.club, league: v.me.league ?? 'nhl' } : { club: v.club === v.board ? null : v.club, league: v.league };
    try { await fanSetMe(name, own.club, own.league); v.refreshMe(); setEdit(false); toast('Saved'); } catch (x) { toast((x as Error).message, 'err'); }
  };
  const guest = isGuestEmail(session?.user?.email);
  return (
    <div className="card p-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-base font-extrabold" style={{ background: 'rgb(var(--club-rgb))', color: 'var(--club-ink)' }}>{(v.me?.name ?? '?').slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-mute">You&apos;re in as</div>
          <div className="flex flex-wrap items-baseline gap-x-2"><b className="text-white">{v.me?.name ?? '…'}</b><span className="text-[11px] text-mute">{v.me ? `${v.me.posts} post${v.me.posts === 1 ? '' : 's'} · ${v.me.calls} call${v.me.calls === 1 ? '' : 's'} · ${v.me.score >= 0 ? '+' : ''}${v.me.score} from votes` : ''}</span></div>
        </div>
        <button type="button" onClick={() => { setName(v.me?.given ?? ''); setEdit(!edit); }} className="btn-ghost btn-sm" aria-label="Change the name others see"><PencilLine className="h-3.5 w-3.5" /></button>
      </div>
      {edit && (
        <form onSubmit={save} className="mt-2 flex gap-2">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="First and last name" aria-label="Your name" />
          <button className="btn-club shrink-0" disabled={name.trim().length < 2}>Save</button>
        </form>
      )}
      {guest && !keep && <button type="button" onClick={() => setKeep(true)} className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-sky-300"><ShieldCheck className="h-3.5 w-3.5" />Add an email to keep your name on any phone</button>}
      {guest && keep && <KeepFan onDone={() => setKeep(false)} />}
    </div>
  );
}

// a fan who joined with just a name adds an email and a password to the same account (the join function's claim)
function KeepFan({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toast = useToast();
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
    await supabase.auth.signInWithPassword({ email: login, password: pw });
    try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
    setBusy(false); toast('Your name is yours on any phone now'); onDone();
  };
  return (
    <form onSubmit={save} className="mt-2 space-y-2">
      <input aria-label="Email" className="input" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      <input aria-label="Password" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Pick a password, 6+ characters" />
      <button className="btn-club w-full py-2" disabled={busy || !ok}>{busy ? <Spinner /> : 'Keep my name'}</button>
      {err && <div className="rounded-xl border border-red-400/30 bg-red-900/50 px-3 py-2 text-sm text-red-200">{err}</div>}
    </form>
  );
}

// ───────────── the calls ─────────────
type Option = [value: string, label: string, sub?: string];
// a player's leading number in each sport, in order of what says the most
const LEAD_WORDS: [string, string][] = [['passingYards', 'pass yds'], ['rushingYards', 'rush yds'], ['receivingYards', 'rec yds'], ['sacks', 'sacks'],
  ['totalTackles', 'tackles'], ['interceptions', 'INT'], ['pointsPerGame', 'ppg'], ['reboundsPerGame', 'rpg'], ['assistsPerGame', 'apg'],
  ['blocksPerGame', 'bpg'], ['goals', 'goals'], ['assists', 'assists'], ['saves', 'saves']];

function SplitBars({ split, mine, label, rows = 3 }: { split: CallSplit | undefined; mine?: string; label: (choice: string) => string; rows?: number }) {
  const list = shares(split);
  if (!list.length) return <p className="mt-2 text-[12px] text-mute">No calls yet. Be the first.</p>;
  return (
    <div className="mt-2.5 space-y-1.5">
      {list.slice(0, rows).map((c) => (
        <div key={c.choice}>
          <div className="flex items-baseline gap-2 text-[12px]">
            <span className={`min-w-0 flex-1 truncate ${c.choice === mine ? 'font-bold text-white' : 'text-slate-300'}`}>{c.choice === mine && <Check className="mr-1 inline h-3 w-3" style={{ color: 'var(--club)' }} />}{label(c.choice)}</span>
            <span className="num font-bold text-white">{Math.round(c.pct * 100)}%</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-white/[.06]">
            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, c.pct * 100)}%`, background: c.choice === mine ? 'rgb(var(--club-rgb))' : 'rgb(148 163 184 / .55)' }} />
          </div>
        </div>
      ))}
      {list.length > rows && <p className="text-[11px] text-mute">and {list.length - rows} more</p>}
    </div>
  );
}

function CallCard({ def, options }: { def: CallDef; options: Option[] }) {
  const v = useVoice()!;
  const split = v.pulse?.calls[def.key];
  const mine = v.pulse?.mine?.[def.key] || undefined;
  const label = (c: string) => options.find((o) => o[0] === c)?.[1] ?? split?.choices.find((x) => x.choice === c)?.name ?? dirName(v.dir, c);
  const chips = options.length <= 8;
  const avg = def.key === 'gm' || def.key === 'coach' ? gradeAvg(split) : null;
  return (
    <div className="card flex w-full flex-col p-3.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--club)' }}>{def.short}</span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-mute"><Users className="h-3 w-3" />{split?.total ?? 0}</span>
      </div>
      <b className="mt-0.5 block leading-snug text-white">{def.title}</b>
      {chips ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {options.map(([k, l, sub]) => (
            <button key={k} type="button" aria-pressed={mine === k} onClick={() => v.call(def.key, mine === k ? null : k)}
              className={`rounded-full px-2.5 py-1 text-[12px] font-semibold transition ${mine === k ? '' : 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.08]'}`}
              style={mine === k ? { background: 'rgb(var(--club-rgb))', color: 'var(--club-ink)' } : undefined}>
              {l}{sub ? <span className="ml-1 font-normal opacity-70">{sub}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <select aria-label={def.title} className="input mt-2 py-1.5 text-[14px]" value={mine ?? ''} onChange={(e) => v.call(def.key, e.target.value || null)}>
          <option value="">{mine ? 'Take my call back' : 'Make your call'}</option>
          {options.map(([k, l, sub]) => <option key={k} value={k}>{l}{sub ? ` · ${sub}` : ''}</option>)}
        </select>
      )}
      {avg && <p className="mt-2 text-[12px] text-slate-300">The fans&apos; grade: <b className="font-display text-base text-white">{avg}</b></p>}
      <SplitBars split={split} mine={mine} label={label} />
    </div>
  );
}

// the club's calls (or the league's), with the names each question offers: the club's roster for its own (the
// database takes only a player on the club), the season's leaders for the league's awards; in the other leagues the
// club's players from ESPN's roster (by position for the quarterback and the keeper) and the league's leaders
export function FanCalls({ d, league, sport }: { d?: FanData | null; league?: FanLeague | null; sport?: { club?: SportClub | null; league?: SportLeague | null } }) {
  const v = useVoice();
  const options = useMemo(() => {
    const out: Record<string, Option[]> = {};
    out.club = (v?.dir.clubs ?? []).map((c) => [c.code, c.name]);
    if (d) {
      const pts = new Map(d.skaters.map((s) => [s.id, s.pts]));
      const gs = new Map(d.goalies.map((g) => [g.id, g]));
      const roster = [...d.roster].sort((a, b) => (pts.get(b.id) ?? -1) - (pts.get(a.id) ?? -1));
      const goalies = roster.filter((p) => p.pos === 'G').sort((a, b) => (gs.get(b.id)?.gs ?? 0) - (gs.get(a.id)?.gs ?? 0));
      out.goalie = goalies.map((p) => { const g = gs.get(p.id); return [String(p.id), p.name, g ? `${g.gs} GS` : undefined]; });
      out.player = roster.map((p) => { const g = gs.get(p.id); return [String(p.id), p.name, p.pos === 'G' ? (g ? `G · ${g.w} W` : 'G') : `${p.pos} · ${pts.get(p.id) ?? 0} pts`]; });
    }
    if (league) {
      out.hart = league.skaters.map((s) => [String(s.id), s.name, `${s.team} · ${s.pts} pts`]);
      out.norris = league.defence.map((s) => [String(s.id), s.name, `${s.team} · ${s.pts} pts`]);
      out.vezina = league.goalies.map((g) => [String(g.id), g.name, `${g.team} · ${g.w} W${g.svp != null ? ` · ${g.svp.toFixed(3).replace(/^0/, '')}` : ''}`]);
    }
    const sc = sport?.club;
    if (sc) {
      // the players doing the most first: on the leader boards (the NBA's minutes), in the most matches (soccer)
      const weight = new Map<string, number>();
      for (const c of sc.leaders) c.rows.forEach((r, i) => weight.set(r.id, (weight.get(r.id) ?? 0) + (c.cat === 'minutesPerGame' ? r.value * 3 : Math.max(0, 12 - i))));
      for (const p of sc.players) if (p.season) weight.set(p.id, (weight.get(p.id) ?? 0) + p.season.apps * 4 + p.season.g * 3 + p.season.a * 2);
      // the player's number that says the most, in a few words (the feed's leader lines run long)
      const lead = (id: string) => {
        for (const [cat, word] of LEAD_WORDS) {
          const r = sc.leaders.find((c) => c.cat === cat)?.rows.find((x) => x.id === id);
          if (r && r.value > 0) return `${r.display} ${word}`;
        }
        return undefined;
      };
      const ranked = [...sc.players].sort((a, b) => (weight.get(b.id) ?? 0) - (weight.get(a.id) ?? 0) || a.name.localeCompare(b.name));
      const sub = (p: SportClub['players'][number]) => [p.pos, p.season ? `${p.season.apps} apps${p.season.g ? `, ${p.season.g} g` : ''}` : lead(p.id)].filter(Boolean).join(' · ') || undefined;
      out.player = ranked.map((p) => [p.id, p.name, sub(p)]);
      out.qb = ranked.filter((p) => p.pos === 'QB').map((p) => [p.id, p.name, lead(p.id) ?? 'QB']);
      out.keeper = ranked.filter((p) => p.pos === 'G' || p.pos === 'GK').map((p) => [p.id, p.name, p.season ? `${p.season.apps} apps` : 'G']);
    }
    const sl = sport?.league;
    if (sl) {
      // the league's leaders, each once, in the order the leader boards rank them
      const seen = new Map<string, Option>();
      const most = Math.max(0, ...sl.leaders.map((c) => c.rows.length));
      for (let i = 0; i < most; i++) for (const c of sl.leaders) {
        const r = c.rows[i];
        if (r?.id && !seen.has(r.id)) seen.set(r.id, [r.id, r.name, [r.team, `${c.name.replace(/ Leaders?$/, '')} ${r.display}`].filter(Boolean).join(' · ')]);
      }
      out.athlete = [...seen.values()];
    }
    return out;
  }, [d, league, sport?.club, sport?.league, v?.dir]);
  if (!v) return null;
  const defs = callsFor(v.sport, v.club === v.board);
  const optionsFor = (def: CallDef): Option[] => (def.kind === 'choice' ? def.choices ?? [] : options[def.kind] ?? []);
  const shown = defs.filter((def) => optionsFor(def).length);
  const made = shown.filter((def) => v.pulse?.mine?.[def.key]).length;
  // a row to swipe on a phone (the page is long already), a grid on a wider screen
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1 text-[12px]">
        <span className="font-semibold text-slate-300">{v.signedIn ? `Your calls: ${made} of ${shown.length}` : `${shown.length} calls for the season`}</span>
        <span className="text-mute sm:hidden">Swipe for them all</span>
      </div>
      <div className="scroll-x flex snap-x snap-mandatory items-start gap-2 pb-1 sm:grid sm:grid-cols-2 sm:items-stretch sm:overflow-visible">
        {shown.map((def) => <div key={def.key} className="flex w-[86%] max-w-[340px] shrink-0 snap-center sm:w-auto sm:max-w-none"><CallCard def={def} options={optionsFor(def)} /></div>)}
      </div>
    </div>
  );
}

// the fan's own verdict on one of the analysis's bigger questions, beside every fan's split
const VERDICT_TONE: Record<string, string> = { keep: 'rgb(52 211 153)', adjust: 'rgb(251 191 36)', rethink: 'rgb(248 113 113)' };
export function VerdictCall({ topic, verdict }: { topic: string | undefined; verdict: string }) {
  const v = useVoice();
  if (!v || !topic) return null;
  const split = v.pulse?.calls[topic];
  const mine = v.pulse?.mine?.[topic] || undefined;
  const list = shares(split);
  const pct = (k: string) => list.find((c) => c.choice === k)?.pct ?? 0;
  return (
    <div className="mt-2 rounded-xl bg-black/20 p-2.5 ring-1 ring-white/[.06]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-mute">Your call</span>
        {VERDICTS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={mine === k} onClick={() => v.call(topic, mine === k ? null : k)}
            className={`rounded-full px-2.5 py-1 text-[12px] font-bold transition ${mine === k ? 'text-[#0b1222]' : 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.08]'}`}
            style={mine === k ? { background: VERDICT_TONE[k] } : undefined}>{l}</button>
        ))}
      </div>
      {split?.total ? (
        <>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/[.06]" role="img" aria-label={VERDICTS.map(([k, l]) => `${l} ${Math.round(pct(k) * 100)}%`).join(', ')}>
            {VERDICTS.map(([k]) => (pct(k) ? <div key={k} style={{ width: `${pct(k) * 100}%`, background: VERDICT_TONE[k] }} className="h-2 border-r-2 border-[#0e1527] last:border-r-0" /> : null))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-mute">
            {VERDICTS.map(([k, l]) => <span key={k}><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: VERDICT_TONE[k] }} />{l} {Math.round(pct(k) * 100)}%</span>)}
            <span className="ml-auto">{split.total} fan{split.total === 1 ? '' : 's'} · the numbers say {verdict}</span>
          </div>
        </>
      ) : <p className="mt-1.5 text-[11px] text-mute">No fan has made this call yet. The numbers say {verdict}.</p>}
    </div>
  );
}
