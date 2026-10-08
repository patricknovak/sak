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
import { type Pack, packName, packPlaceholder, packWhen } from '../lib/packs';
import { KINDS, PICKEM_PRESETS, PRESETS, SQUARES_DEFAULT, gridFor, gridLabel, presetExample, type GameKind, type PickemPreset, type PoolEvent, type SeriesPreset, type SquaresRules } from '../lib/poolGames';
import { SquaresKnobs, lockText } from './Picks';

// "Start a pool" (#/new), open to anyone, in steps (docs/POOL-TYPES.md §4): what are you following (a sports event open
// now, a show's question pack, or anything else), what kind of pool (for a sport: pick the series, rank the teams, the
// questions; the first one picked is the pool's main game), how it scores (a preset in plain words with a worked
// example), then its name, colour and the host's account. It lands on the Host page with the invite link ready to send. Someone new goes through the `join` function (it makes the account
// and the pool together, migration 153, with limits per address and per day); someone signed in who is already in a
// pool starts it with pool_start, as on My pools. A link can choose the pack (#/new?pack=love-is-blind-s11), which the
// landing page uses. Drawn in the pool's own colour as it is chosen.

const SWATCHES = ['#fb7185', '#38bdf8', '#f7c548', '#34d399', '#c4b5fd', '#f97316'];
const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

const STEPS = [
  ['🔗', 'Send one link', 'Friends tap it in the group chat, pick a name and they’re in. No app to download.'],
  ['🎯', 'Pick it, rank it, call it', 'Series picks, rankings, or questions priced like a market in coins. Every result lands on its own.'],
  ['👑', 'Wear the crown', 'The table runs all season. Never money, just bragging rights.'],
] as const;
const SPORT_EMOJI: Record<string, string> = { mlb: '⚾', nhl: '🏒', soccer: '⚽', nfl: '🏈', nba: '🏀' };
type Following = { type: 'event'; comp: string } | { type: 'pack'; slug: string } | { type: 'blank' } | null;

// a numbered step's heading
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2"><span className="num grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs font-black text-white">{n}</span><span className="label text-white/80">{title}</span></div>
      {children}
    </div>
  );
}

export default function NewPool() {
  const { session, me } = useLeague();
  const [params] = useSearchParams();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [pack, setPack] = useState<string | null>(params.get('pack'));
  const [events, setEvents] = useState<PoolEvent[] | null>(null);
  const [following, setFollowing] = useState<Following>(null);
  const [kinds, setKinds] = useState<(GameKind | 'questions')[]>(['series', 'questions']);
  const [preset, setPreset] = useState<SeriesPreset>('classic');
  const [pkPreset, setPkPreset] = useState<PickemPreset>('classic');
  const [grid, setGrid] = useState<Omit<SquaresRules, 'series'>>(SQUARES_DEFAULT);
  const [gridOn, setGridOn] = useState<number | null>(null);
  const [color, setColor] = useState<string>(SWATCHES[0]);
  const [pool, setPool] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signIn, setSignIn] = useState(false);

  useEffect(() => {
    rpc<PoolEvent[]>('pool_event_list').then((e) => {
      setEvents(e ?? []);
      // a link that names an event's pack opens on the event
      const ev = (e ?? []).find((x) => x.pack && x.pack === params.get('pack'));
      if (ev) { setFollowing({ type: 'event', comp: ev.competition }); setKinds([ev.kinds[0], ...(ev.pack ? ['questions' as const] : [])]); }
      else if (params.get('pack')) setFollowing({ type: 'pack', slug: params.get('pack')! });
    }, () => setEvents([]));
    rpc<Pack[]>('pool_pack_list').then((d) => {
      setPacks(d ?? []);
      // a pack chosen by the link brings its colour
      const chosen = (d ?? []).find((p) => p.slug === params.get('pack'));
      if (chosen?.color && /^#[0-9a-f]{6}$/i.test(chosen.color)) setColor(chosen.color.toLowerCase());
      else if (params.get('pack') && !chosen) setPack(null);
    }, () => setPacks([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = useMemo(() => packs?.find((p) => p.slug === pack) ?? null, [packs, pack]);
  const event = following?.type === 'event' ? events?.find((e) => e.competition === following.comp) ?? null : null;
  // packs that ride with a sports event are offered inside it, as its questions
  const eventPacks = new Set((events ?? []).map((e) => e.pack).filter(Boolean));
  const loosePacks = (packs ?? []).filter((p) => !eventPacks.has(p.slug));
  const eventPack = event?.pack ? packs?.find((p) => p.slug === event.pack) ?? null : null;
  const games = event ? kinds.filter((k): k is GameKind => k !== 'questions') : [];
  const toggle = (k: GameKind | 'questions') => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const choose = (f: Following) => {
    setFollowing(f);
    // an event starts with its first kind ticked, and its questions when it has them
    const ev = f?.type === 'event' ? events?.find((e) => e.competition === f.comp) : null;
    if (ev) setKinds([ev.kinds[0], ...(ev.pack ? ['questions' as const] : [])]);
    const slug = f?.type === 'pack' ? f.slug : f?.type === 'event' ? events?.find((e) => e.competition === f.comp)?.pack ?? null : null;
    setPack(f?.type === 'pack' ? f.slug : null);
    const c = packs?.find((x) => x.slug === slug)?.color;
    if (c && /^#[0-9a-f]{6}$/i.test(c)) setColor(c.toLowerCase());
  };
  // the pack the pool opens with: the one chosen, or the event's own when its questions are ticked
  const openPack = event ? (kinds.includes('questions') ? event.pack : null) : following?.type === 'pack' ? following.slug : null;
  // squares go on the series chosen, by default the event's last one still to come
  const gridSeries = event ? (event.grids ?? []).find((g) => g.id === gridOn) ?? gridFor(event) : null;
  const offered: GameKind[] = event ? [...event.kinds.filter((k) => k in KINDS), ...(gridSeries ? ['squares' as const] : [])] : [];
  const gamesPayload = games.filter((k) => k !== 'squares' || gridSeries).map((k) => ({ kind: k, competition: event!.competition,
    rules: k === 'series' ? { preset } : k === 'pickem' ? { preset: pkPreset } : k === 'squares' ? { ...grid, series: gridSeries!.id } : {} }));
  const startGames = async (id: number) => { if (gamesPayload.length) await rpc('pool_start_games', { p_league: id, p_games: gamesPayload }); };
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const member = !!session && !!me;
  const ready = !!following && (!event || kinds.length > 0) && pool.trim().length >= 3 && (member || (name.trim().length >= 2 && okEmail && pw.length >= 6));

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(''); setSignIn(false);
    try {
      if (member) {
        const r = await rpc<{ id: number; slug: string }>('pool_start', { p_name: pool.trim(), p_color: color, p_pack: openPack });
        await startGames(r.id);
        await openPool({ league_id: r.id, slug: r.slug }, '/host');
        return;
      }
      const login = email.trim().toLowerCase();
      const { data, error } = await supabase.functions.invoke('join', { body: { pool: { name: pool.trim(), color, pack: openPack }, email: login, password: pw, name: name.trim() } });
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
      if (opened) {
        await startGames(opened.id).catch((x) => setErr(`Your pool is open, but its games didn’t start: ${(x as Error).message}. Add them from the Host page.`));
        await openPool({ league_id: opened.id, slug: opened.slug }, '/host');
      }
      else { window.location.hash = '#/'; window.location.reload(); }
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <div className="pt-safe min-h-dvh px-4 py-10" style={themed(color)}>
      <div className="mx-auto w-full max-w-md pt-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={56} /></div>
          <h1 className="h-display text-shine text-4xl leading-none">Start a pool</h1>
          <p className="mt-2 text-sm text-slate-300">Pick'em, series picks, rankings and questions for anything your group follows. Free, and never money.</p>
        </div>

        <form onSubmit={start} className="card-hero p-5">
          <div className="relative space-y-6">
            <Step n={1} title="What are you following?">
              <div className="grid gap-2">
                {(events ?? []).map((e) => {
                  const on = following?.type === 'event' && following.comp === e.competition;
                  return (
                    <button key={e.competition} type="button" onClick={() => choose({ type: 'event', comp: e.competition })}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `rgb(${rgb(color)} / .18)` }}>{SPORT_EMOJI[e.sport] ?? '🏆'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-balance font-semibold text-white">{e.name}<span className="rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-red-200 ring-1 ring-red-400/30">Live now</span></span>
                        <span className="block text-xs text-white/60">{e.stage ?? 'Under way'} · picks from {e.word ? e.open_label : `the ${e.open_label}`}, {lockText(e.next_lock)}</span>
                      </span>
                      {on && <Check size={18} className="shrink-0 text-emerald-300" />}
                    </button>
                  );
                })}
                {[...loosePacks.map((p) => { const w = packWhen(p); return { f: { type: 'pack', slug: p.slug } as Following, key: p.slug, name: packName(p.name), icon: p.icon, sub: `${p.questions} questions · ${w.text}`, soon: w.soon }; }),
                  { f: { type: 'blank' } as Following, key: 'blank', name: 'Something else', icon: null, sub: 'Ask your own questions from the Host page', soon: false }].map((o) => {
                  const on = following?.type === o.f?.type && (o.f?.type !== 'pack' || (following?.type === 'pack' && following.slug === o.key));
                  return (
                    <button key={o.key} type="button" onClick={() => choose(o.f)}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `rgb(${rgb(color)} / .18)`, color }}>{o.icon ? <span className="text-lg leading-none">{o.icon}</span> : o.key !== 'blank' ? <Sparkles size={18} /> : <Plus size={18} />}</span>
                      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-balance font-semibold text-white">{o.name}{o.soon && <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-amber-200 ring-1 ring-amber-400/30">Closing soon</span>}</span><span className="block text-xs text-white/60">{o.sub}</span></span>
                      {on && <Check size={18} className="shrink-0 text-emerald-300" />}
                    </button>
                  );
                })}
                {(!packs || !events) && <div className="flex justify-center py-2"><Spinner /></div>}
              </div>
            </Step>

            {event && (
              <Step n={2} title="What kind of pool?">
                <div className="grid gap-2">
                  {[...offered.map((k) => ({ key: k as GameKind | 'questions', ...KINDS[k], sub: `${KINDS[k].line} ${KINDS[k].time}.` })),
                    ...(eventPack ? [{ key: 'questions' as const, title: 'The questions', badge: 'In coins', emoji: '🔮', sub: `${eventPack.questions} questions on the ${event.final_label.replace(/^(AL|NL) /, '')} and the pennants, priced like a market: buy what you believe, sell if you change your mind.`, time: '', line: '' }] : [])].map((k) => {
                    const on = kinds.includes(k.key);
                    const main = on && kinds.filter((x) => (offered as string[]).includes(x) || x === 'questions')[0] === k.key;
                    return (
                      <button key={k.key} type="button" onClick={() => toggle(k.key)}
                        className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `rgb(${rgb(color)} / .18)` }}>{k.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-white">{k.title}
                            <span className="rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ring-1" style={{ color, background: `rgb(${rgb(color)} / .12)`, borderColor: color }}>{k.badge}</span>
                            {main && <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white/80">Main game</span>}</span>
                          <span className="mt-0.5 block text-xs leading-snug text-white/60">{k.sub}</span>
                        </span>
                        <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ${on ? 'bg-emerald-400 text-[#0b1220] ring-emerald-300' : 'ring-white/25'}`}>{on && <Check size={16} strokeWidth={3} />}</span>
                      </button>
                    );
                  })}
                </div>
                {!kinds.length && <p className="mt-2 text-xs text-amber-200">Pick at least one.</p>}
                {kinds.includes('players') && (
                  <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">
                    The box pool runs four weeks from {event.open_label}: ten boxes of the league’s best, six players each, and everyone takes one from every box. A goal or an assist is a point, a goalie’s win two and a shutout one more. The host can make it a week, the rest of the season or five boxes before the first puck drop.
                  </p>
                )}
                {kinds.includes('survivor') && (
                  <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">
                    Last one standing runs from {event.open_label} to {event.final_label}: one {event.club_word ?? 'club'} to win each {(event.word ?? 'round').toLowerCase()}, never the same one twice. {event.sport === 'soccer' ? 'A draw or a loss' : 'A loss'} and you’re out; whoever is still in at the end shares it.
                  </p>
                )}
              </Step>
            )}

            {event && kinds.includes('series') && (
              <Step n={3} title="How it scores">
                <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-black/25 p-1">
                  {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${preset === p.key ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{p.label}</button>)}
                </div>
                <p className="mt-2 text-sm leading-snug text-white/80">{PRESETS.find((p) => p.key === preset)!.line}</p>
                <p className="mt-1.5 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{presetExample(preset, event.final_label, event.final_round)} The total runs in the last game breaks a tie.</p>
                {kinds.includes('rank') && <p className="mt-2 text-xs leading-snug text-white/60">Rank the teams: your top club in the {event.open_label} earns the most for every game it wins, your last club the least.</p>}
              </Step>
            )}

            {event && kinds.includes('pickem') && (
              <Step n={3} title="How it scores">
                <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
                  {PICKEM_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPkPreset(p.key)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${pkPreset === p.key ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{p.label}</button>)}
                </div>
                <p className="mt-2 text-sm leading-snug text-white/80">{PICKEM_PRESETS.find((p) => p.key === pkPreset)!.line}</p>
                <p className="mt-1.5 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{PICKEM_PRESETS.find((p) => p.key === pkPreset)!.example} From {event.open_label} to {event.final_label}; each pick locks at its own kick-off.</p>
              </Step>
            )}

            {event && gridSeries && kinds.includes('squares') && (
              <Step n={kinds.includes('series') ? 4 : 3} title="The grid">
                <SquaresKnobs dark grids={event.grids ?? []} on={gridSeries.id} setOn={setGridOn} grid={grid} setGrid={setGrid} />
                <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{gridLabel(gridSeries)}. Members claim squares with their coins until the grid fills or Game 1 starts; then the digits are drawn from a seed anyone can check.</p>
              </Step>
            )}

            {following && (
            <Step n={event ? 3 + Number(kinds.includes('series') || kinds.includes('pickem')) + Number(kinds.includes('squares') && !!gridSeries) : 2} title="Name it">
            <div className="space-y-4">
            <label className="block"><span className="sr-only">Name your pool</span>
              <input className="input w-full" value={pool} onChange={(e) => setPool(e.target.value)} maxLength={40} placeholder={packPlaceholder(event ? event.pack : chosen?.slug)} /></label>
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
            </div>
            </Step>
            )}

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
