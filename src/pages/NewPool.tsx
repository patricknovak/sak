import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, Check, ChevronRight, Lock, Plus, Sparkles } from 'lucide-react';
import { rpc, setRemember, supabase } from '../lib/supabase';
import { markShareAfterCreate, openPool } from '../lib/host';
import { isGuestEmail, signOut } from '../lib/guest';
import { useLeague } from '../lib/store';
import { Spinner, Toggle } from '../components/ui';
import { themed } from '../components/LeagueIdentity';
import { ProductMark } from '../components/Brand';
import { type Pack, packName, packPlaceholder, packWhen } from '../lib/packs';
import { KIND_ORDER, KIND_WHEN, KINDS, ATS_LINE, MISSED_LINE, PICKEM_PRESETS, PRESETS, SQUARES_DEFAULT, atsFits, eventGrids, finalSoon, gridFor, gridLabel, gridRules, presetExample, sheetLabel, type GameKind, type PickemPreset, type PoolEvent, type SeriesPreset, type SquaresRules } from '../lib/poolGames';
import { SERIES_SPORTS, SheetPicker, SquaresKnobs, lockText } from './Picks';
import { attributionFields, noteCtaArrival, trackPoolCreated, trackSignUp } from '../lib/analytics';
import { FantasyStart } from '../components/FantasyStart';
import { PRODUCT } from '../lib/brand';
import { humanField } from '../lib/turnstile';

// "Start a pool" (#/new), open to anyone, in steps (docs/POOL-TYPES.md §4). First what you're starting: a sports pool,
// a questions pool or a fantasy league (migration 242: a league of your own, its choices made up front). Then, for a
// sport, what are you following (a sports event open now) and what kind of pool, every kind listed with the ones not
// open on that event greyed and why; for questions, a show's pack or your own. For a sport: what kind of pool (for a sport: pick the series, rank the teams, the
// questions; the first one picked is the pool's main game), how it scores (a preset in plain words with a worked
// example), then its name, colour and the host's account. It lands on the pool home and opens the share sheet once
// (InviteCard, with ?src=share on the invite). Someone new goes through the `join` function (it makes the account
// and the pool together, migration 153, with limits per address and per day); someone signed in who is already in a
// pool starts it with pool_start, as on My pools. A link can choose the pack (#/new?pack=love-is-blind-s11) or the event
// (#/new?comp=nfl), which the landing page uses. Drawn in the pool's own colour as it is chosen.
// One step is open at a time: an answered step folds to a line saying what was chosen, with Change to reopen it, so a
// phone sees the question in front of it rather than four screens of cards. A link that already answers a step lands
// past it (?comp folds the type and the event; ?comp with ?kind folds the kinds too). The start button rides in a bar
// at the foot of the screen and says what's still missing until the pool can start.

const SWATCHES = ['#fb7185', '#38bdf8', '#f7c548', '#34d399', '#c4b5fd', '#f97316'];
const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

const STEPS = [
  ['🔗', 'Send one link', 'Friends tap it in the group chat, pick a name and they’re in. No app to download.'],
  ['🎯', 'Pick it, rank it, call it', 'Series picks, rankings, or questions priced like a market in Supercoins. Every result lands on its own.'],
  ['👑', 'Wear the crown', 'The table runs all season. Never money, just bragging rights.'],
] as const;
// a questions pool's host isn't here for the sports: the same three cards in the pool's own words
const QUESTION_STEPS = [
  ['🔗', 'Send one link', 'Friends tap it in the group chat, pick a name and they’re in. No app to download.'],
  ['✍️', 'Ask anything', 'A yes or no, a who, a how many: you write it, the pool prices it, friends call it before it closes.'],
  ['👑', 'Wear the crown', 'The table runs as long as you like. Never money, just bragging rights.'],
] as const;
const SPORT_EMOJI: Record<string, string> = { mlb: '⚾', nhl: '🏒', soccer: '⚽', nfl: '🏈', nba: '🏀', ncaab: '🏀' };
type Following = { type: 'event'; comp: string } | { type: 'pack'; slug: string } | { type: 'blank' } | null;
type Mode = 'sports' | 'questions' | 'fantasy';
const SPORT_NAME: Record<string, string> = { mlb: 'Baseball', nhl: 'Hockey', soccer: 'Soccer', nfl: 'Football', nba: 'Basketball', ncaab: 'College basketball' };
const MODES: { key: Mode; emoji: string; title: string; line: string }[] = [
  { key: 'sports', emoji: '🏆', title: 'A sports pool', line: 'Pick’em, brackets, series picks, last one standing, Call the score, squares, prop sheets, the hockey box pool: on a league that’s on now.' },
  { key: 'questions', emoji: '🔮', title: 'A questions pool', line: 'Questions priced like a market in Supercoins: a TV show, an awards night, the office bake-off. Start from a pack or ask your own.' },
  { key: 'fantasy', emoji: '🏒', title: 'A fantasy league', line: 'Draft a team of NHL players and play the season: points or categories, season total or head-to-head, keepers or not.' },
];
const isMode = (t: string | null): t is Mode => t === 'sports' || t === 'questions' || t === 'fantasy';
type StepKey = 'type' | 'follow' | 'kinds' | 'details';

// a step's heading, numbered in order by the form's counter, so a step that isn't shown takes no number; an answered
// step folds to one line (its title over what was chosen) and the whole line reopens it
function Step({ id, title, summary, onChange, children }: { id: StepKey; title: string; summary?: React.ReactNode; onChange?: () => void; children?: React.ReactNode }) {
  if (onChange) {
    return (
      <div id={`step-${id}`} className="scroll-mt-4 [counter-increment:step]">
        {/* named for what it does, so a reader (and a test) never takes it for the choice itself */}
        <button type="button" onClick={onChange} aria-label={`Change ${({ type: 'what you’re starting', follow: 'what it follows', kinds: 'its games', details: 'the name' } as Record<StepKey, string>)[id]}`}
          className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5 text-left transition hover:bg-white/[.06]">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400 text-[#0b1220]"><Check size={14} strokeWidth={3} /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[.14em] text-white/50">{title}</span>
            <span className="block text-sm font-semibold leading-snug text-white">{summary}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/85 ring-1 ring-white/15">Change</span>
        </button>
      </div>
    );
  }
  return (
    <div id={`step-${id}`} className="scroll-mt-4 [counter-increment:step]">
      <div className="mb-2 flex items-center gap-2"><span className="num grid h-6 w-6 place-items-center rounded-full bg-white/10 text-xs font-black text-white before:content-[counter(step)]" /><span className="label text-white/80">{title}</span></div>
      {children}
    </div>
  );
}

// a setting inside the kinds step (how it scores, its size, the grid, the game): a plain heading, not a numbered step
function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[.14em] text-white/60">{title}</div>
      {children}
    </div>
  );
}

// Link fields that choose the template (not src / UTM). Same key → keep typed name/email; new key → re-derive.
function newPoolLinkKey(p: URLSearchParams) {
  return [p.get('type') ?? '', p.get('pack') ?? '', p.get('comp') ?? '', p.get('kind') ?? '', p.get('ats') === '1' ? '1' : ''].join('|');
}

export default function NewPool() {
  const { session, me } = useLeague();
  const [params] = useSearchParams();
  const linkKey = newPoolLinkKey(params);
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [pack, setPack] = useState<string | null>(params.get('pack'));
  const [events, setEvents] = useState<PoolEvent[] | null>(null);
  const [following, setFollowing] = useState<Following>(null);
  const [kinds, setKinds] = useState<(GameKind | 'questions')[]>(['series', 'questions']);
  const [preset, setPreset] = useState<SeriesPreset>('classic');
  const [pkPreset, setPkPreset] = useState<PickemPreset>('classic');
  // against the spread on from the link too (#/new?comp=nfl&ats=1, the football landing page's)
  const [ats, setAts] = useState(params.get('ats') === '1');
  const [missFav, setMissFav] = useState(false);
  // a season-long pick'em can drop each player's worst weeks (migration 294)
  const [dropN, setDropN] = useState(0);
  // last one standing's lives (migration 288): out on the first loss, or the second or third
  const [lives, setLives] = useState(1);
  // the box pool's size and window (migration 188)
  const [box, setBox] = useState<{ preset: 'classic' | 'quick'; length: 'week' | 'month' | 'season' }>({ preset: 'classic', length: 'month' });
  const [grid, setGrid] = useState<Omit<SquaresRules, 'series'>>(SQUARES_DEFAULT);
  const [gridOn, setGridOn] = useState<number | null>(null);
  const [sheetOn, setSheetOn] = useState<number | null>(null);
  // and a sheet on every game after it, by itself (migration 227): on by default for a postseason, off for a week of
  // the NFL's regular season (sixteen sheets a week is a lot to ask)
  const [everySheetSet, setEverySheet] = useState<boolean | null>(null);
  const [color, setColor] = useState<string>(SWATCHES[0]);
  const [pool, setPool] = useState('');
  const [poolTouched, setPoolTouched] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signIn, setSignIn] = useState(false);
  // "already have an account": sign in right here and start the pool as that account, with the steps kept
  const [haveAccount, setHaveAccount] = useState(false);
  const [afterSignIn, setAfterSignIn] = useState(false);
  const [showPw, setShowPw] = useState(false);
  // an event tapped before both lists have answered must not be un-picked by the link effect's first run
  const touched = useRef(false);
  const typed = params.get('type');
  const [mode, setMode] = useState<Mode | null>(isMode(typed) ? typed : null);
  // the step asked for; an earlier step still unanswered opens in its place (below). ?type= lands on what comes next.
  const [open, setOpen] = useState<StepKey>(isMode(typed) ? (typed === 'fantasy' ? 'details' : 'follow') : 'type');
  // only a tap moves the screen to the step it opens; a link landing mid-way stays at the top
  const tapped = useRef(false);
  const appliedLink = useRef<string | null>(null);
  const go = (s: StepKey) => { tapped.current = true; setOpen(s); };

  useEffect(() => { document.title = PRODUCT.name; }, []);
  // Landing CTA → app: measure arrival once per session per src (consent + host gate in noteCtaArrival).
  const srcParam = params.get('src');
  useEffect(() => { if (srcParam) noteCtaArrival(srcParam); }, [srcParam]);
  // Lists load once; the link effect below re-applies whenever the hash query's template changes
  // (same /new route stays mounted, so a second #/new?... must not keep the first template).
  // a list that failed to load says so and offers another go, rather than reading as "nothing is on"
  const [listsFailed, setListsFailed] = useState(false);
  const [listsTry, setListsTry] = useState(0);
  useEffect(() => {
    setListsFailed(false);
    rpc<PoolEvent[]>('pool_event_list').then((e) => setEvents(e ?? []), () => { setEvents([]); setListsFailed(true); });
    rpc<Pack[]>('pool_pack_list').then((d) => setPacks(d ?? []), () => { setPacks([]); setListsFailed(true); });
  }, [listsTry]);
  const retryLists = () => { setEvents(null); setPacks(null); appliedLink.current = null; setListsTry((n) => n + 1); };
  useEffect(() => {
    if (events === null || packs === null) return;
    const same = appliedLink.current === linkKey;
    if (same) return;
    const switched = appliedLink.current !== null;
    appliedLink.current = linkKey;

    const packQ = params.get('pack');
    const compQ = params.get('comp');
    const kindQ = params.get('kind');
    const typeQ = params.get('type');
    const atsOn = params.get('ats') === '1';

    // New template: refresh default pool name and fold state; keep typed host name/email/password.
    if (switched) {
      setPoolTouched(false);
      setPreset('classic');
      setPkPreset('classic');
      setMissFav(false);
      setDropN(0);
      setLives(1);
      setBox({ preset: 'classic', length: 'month' });
      setGrid(SQUARES_DEFAULT);
      setGridOn(null);
      setSheetOn(null);
      setEverySheet(null);
      setErr('');
      setSignIn(false);
    }

    setAts(atsOn);
    // a link that names an event's pack opens on the event
    // (or names the event itself, #/new?comp=nfl, as the landing page's open-right-now board does)
    const ev = events.find((x) => (x.pack && x.pack === packQ) || x.competition === compQ);
    // and a kind it offers, #/new?comp=nba-2026-27&kind=wins, is ticked in place of its first (squares too, on an
    // event with a grid to draw, #/new?comp=mlb-post-2026&kind=squares from the World Series page)
    const want = ev?.kinds.find((k) => k === kindQ)
      ?? (ev && kindQ === 'squares' && eventGrids(ev).length ? 'squares' as const : undefined);
    // a link that names the kind has answered the kinds step too, so it lands on the name; one that names only the
    // event lands on the kinds, the first one ticked
    if (ev) {
      setMode('sports');
      setFollowing({ type: 'event', comp: ev.competition });
      setKinds([want ?? ev.kinds[0], ...(ev.pack ? ['questions' as const] : [])]);
      setOpen(want ? 'details' : 'kinds');
      setPack(null);
      const evPack = ev.pack ? packs.find((p) => p.slug === ev.pack) : null;
      if (evPack?.color && /^#[0-9a-f]{6}$/i.test(evPack.color)) setColor(evPack.color.toLowerCase());
      else if (switched) setColor(SWATCHES[0]);
    } else if (packQ) {
      setMode('questions');
      setFollowing({ type: 'pack', slug: packQ });
      setKinds(['series', 'questions']);
      setOpen('details');
      const chosenPack = packs.find((p) => p.slug === packQ);
      if (chosenPack) {
        setPack(packQ);
        if (chosenPack.color && /^#[0-9a-f]{6}$/i.test(chosenPack.color)) setColor(chosenPack.color.toLowerCase());
        else if (switched) setColor(SWATCHES[0]);
      } else {
        setPack(null);
        if (switched) setColor(SWATCHES[0]);
      }
    } else if (isMode(typeQ)) {
      setMode(typeQ);
      if (switched || !touched.current) {
        setFollowing(null);
        setKinds(['series', 'questions']);
        setPack(null);
        setOpen(typeQ === 'fantasy' ? 'details' : 'follow');
      }
      if (switched) setColor(SWATCHES[0]);
    } else if (switched) {
      // Left a templated link for bare #/new — clear the previous template.
      setMode(null);
      setFollowing(null);
      setKinds(['series', 'questions']);
      setPack(null);
      setOpen('type');
      setColor(SWATCHES[0]);
    }
    // Bare #/new on first resolve: leave mode alone so a tap before the lists load is not wiped.
  }, [linkKey, events, packs, params]);
  const chosen = useMemo(() => packs?.find((p) => p.slug === pack) ?? null, [packs, pack]);
  const event = following?.type === 'event' ? events?.find((e) => e.competition === following.comp) ?? null : null;
  // Real editable default once the link's pack or event resolves (placeholder alone left the button dead).
  useEffect(() => {
    if (poolTouched) return;
    if (event) {
      setPool(event.pack ? packPlaceholder(event.pack) : `${event.name} pool`);
      return;
    }
    if (following?.type === 'pack') {
      setPool(packPlaceholder(following.slug));
      return;
    }
    if (following?.type === 'blank') setPool(packPlaceholder(null));
  }, [event, following, poolTouched]);
  // the events in the list's order, except that an event reaching its final within two weeks (the World Series in its
  // week, a Super Bowl, a Cup final) goes first: it's the pool that can't wait. Ranked event by event (4 November 2026):
  // one MLS Cup used to lift every soccer league above the NFL.
  const byGroup = useMemo(() => (events ?? []).map((e, i) => ({ e, i, soon: finalSoon(e) }))
    .sort((a, b) => Number(b.soon) - Number(a.soon) || a.i - b.i).map((x) => x.e), [events]);
  // packs that ride with a sports event are offered inside it, as its questions
  const eventPacks = new Set((events ?? []).map((e) => e.pack).filter(Boolean));
  const loosePacks = (packs ?? []).filter((p) => !eventPacks.has(p.slug));
  const eventPack = event?.pack ? packs?.find((p) => p.slug === event.pack) ?? null : null;
  const games = event ? kinds.filter((k): k is GameKind => k !== 'questions') : [];
  const toggle = (k: GameKind | 'questions') => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]));
  const choose = (f: Following) => {
    touched.current = true;
    // the same event picked again (after Change) keeps what was ticked for it
    if (f?.type === 'event' && following?.type === 'event' && following.comp === f.comp) return;
    setFollowing(f);
    // an event starts with its first kind ticked (the one most pools on it play), and its questions when it has them
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
  const gridSeries = event ? eventGrids(event).find((g) => g.id === gridOn) ?? gridFor(event) : null;
  // a prop sheet goes on the game chosen, by default the soonest still to start
  const everySheet = everySheetSet ?? !event?.word;
  const sheetGame = event ? (event.sheets ?? []).find((g) => g.id === sheetOn) ?? event.sheets?.[0] ?? null : null;
  const offered: GameKind[] = event ? [...event.kinds.filter((k) => k in KINDS), ...(gridSeries ? ['squares' as const] : [])] : [];
  const gamesPayload = games.filter((k) => (k !== 'squares' || gridSeries) && (k !== 'props' || sheetGame)).map((k) => ({ kind: k, competition: event!.competition,
    rules: k === 'series' ? { preset } : k === 'pickem' ? { preset: pkPreset, ...(ats && atsFits(event?.sport) ? { ats: true } : {}), ...(missFav ? { missed: 'favourite' } : {}), ...(dropN ? { drop: dropN } : {}) } : k === 'players' ? box : k === 'squares' ? { ...grid, ...gridRules(gridSeries!) }
      : k === 'survivor' ? (lives > 1 ? { lives } : {})
      : k === 'props' ? { fixture: sheetGame!.id, ...(everySheet ? { auto: true } : {}) }
      // a bracket on best-of-7s takes a point for calling the games too (migration 228)
      : k === 'bracket' && SERIES_SPORTS.includes(event!.sport) ? { games_bonus: 1 } : {} }));
  const startGames = async (id: number) => { if (gamesPayload.length) await rpc('pool_start_games', { p_league: id, p_games: gamesPayload }); };
  const okEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const member = !!session && !!me;
  // any signed-in account hosts a sports or questions pool, seat or not (migration 349: a fan from the fan zones, a host
  // whose pools went); a fantasy league still starts from an account that plays (fantasy_start)
  const canHost = member || (!!session && mode !== 'fantasy');
  const ready = !!following && (!event || kinds.length > 0) && pool.trim().length >= 3 && (canHost || (haveAccount ? okEmail && pw.length > 0 : name.trim().length >= 2 && okEmail && pw.length >= 6));

  // the steps this kind of start has, the one open (the one asked for, unless an earlier one is still unanswered: an
  // event's kinds can't be skipped with nothing ticked), and what each folded step says was chosen
  const order: StepKey[] = mode === 'sports' ? ['type', 'follow', 'kinds', 'details'] : mode === 'questions' ? ['type', 'follow', 'details'] : mode === 'fantasy' ? ['type', 'details'] : ['type'];
  const answered: Record<StepKey, boolean> = { type: !!mode, follow: !!following, kinds: !!event && kinds.length > 0, details: false };
  const want = order.includes(open) ? open : order[order.length - 1];
  const cur = order.find((s) => !answered[s] && order.indexOf(s) < order.indexOf(want)) ?? want;
  const curAt = order.indexOf(cur);
  const shown = (s: StepKey) => order.includes(s) && order.indexOf(s) <= curAt;
  const folded = (s: StepKey) => order.indexOf(s) < curAt;
  const kindTitle = (k: GameKind | 'questions') => (k === 'questions' ? 'The questions' : KINDS[k].title);
  const summaryPreset = (() => {
    if (kinds.includes('series')) return PRESETS.find((p) => p.key === preset)?.label ?? null;
    if (kinds.includes('pickem')) return `${PICKEM_PRESETS.find((p) => p.key === pkPreset)?.label ?? ''}${ats && atsFits(event?.sport) ? ', against the spread' : ''}`;
    if (kinds.includes('players')) return box.preset === 'classic' ? 'Ten boxes' : 'Five boxes';
    return null;
  })();
  const kindsLine = [kinds.filter((k) => (k === 'questions' ? !!event?.pack : offered.includes(k))).map(kindTitle).join(' + '), summaryPreset].filter(Boolean).join(' · ');
  const followLine = event ? event.name
    : following?.type === 'pack' ? packName(chosen?.name ?? following.slug) : following?.type === 'blank' ? 'Your own questions' : '';
  // what still stands between the host and the start button, first thing first, and where to go to fix it
  const missing: { text: string; step: StepKey; focus?: string } | null = !mode ? { text: 'Pick what you’re starting', step: 'type' }
    : !following ? { text: mode === 'questions' ? 'Pick your questions' : 'Pick an event', step: 'follow' }
    : event && !kinds.length ? { text: 'Pick at least one game', step: 'kinds' }
    : pool.trim().length < 3 ? { text: 'Name your pool', step: 'details', focus: 'np-pool' }
    : busy || afterSignIn ? { text: 'Opening your pool', step: 'details' }
    : session && !canHost ? { text: 'This account isn’t in a pool yet', step: 'details' }
    : canHost ? null
    : haveAccount ? (!okEmail ? { text: email.trim() ? 'Check your email' : 'Add your email', step: 'details', focus: 'np-email' } : !pw ? { text: 'Add your password', step: 'details', focus: 'np-pw' } : null)
    : name.trim().length < 2 ? { text: 'Add your name', step: 'details', focus: 'np-name' }
    : !okEmail ? { text: email.trim() ? 'Check your email' : 'Add your email', step: 'details', focus: 'np-email' }
    : pw.length < 6 ? { text: pw ? 'Password: 6+ characters' : 'Add a password', step: 'details', focus: 'np-pw' }
    : null;
  // still on an earlier step, the next thing is the step after it, not a field further down
  const need = missing && cur !== 'details' && missing.step === 'details' ? { text: 'Next: name your pool', step: 'details' as StepKey, focus: 'np-pool' } : missing;
  const fix = () => {
    if (!need) return;
    go(need.step);
    if (need.focus) setTimeout(() => document.getElementById(need.focus!)?.focus(), 60);
  };
  // a link with ?comp or ?pack waits for the events before drawing the steps, so it doesn't flash step 1 first
  const resolving = !!(params.get('comp') || params.get('pack')) && events === null;
  const bar = mode !== 'fantasy';
  // before the kind of start is picked, count the sports pool's four steps
  const stepCount = mode ? order.length : 4;
  const progress = (order.filter((s) => answered[s]).length + (ready ? 1 : 0)) / stepCount;

  // a tap that opens a step brings it into view when the fold left it off screen
  useEffect(() => {
    if (!tapped.current) return;
    tapped.current = false;
    requestAnimationFrame(() => {
      const el = document.getElementById(`step-${cur}`);
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [open, following, mode, cur]);
  useEffect(() => { if (err) document.getElementById('np-err')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [err]);

  // the start as a signed-in member: the pool goes on the account beside the others
  const startAsMember = async () => {
    const r = await rpc<{ id: number; slug: string }>('pool_start', { p_name: pool.trim(), p_color: color, p_pack: openPack });
    // Queue only; openPool reloads and initAnalytics sends pool_created on the stable page.
    // Question pools omit sport (DB default nhl must not mislabel analytics).
    await trackPoolCreated({ id: r.id, pack: openPack, sport: mode === 'questions' ? null : event?.sport ?? null, kind: mode });
    await startGames(r.id);
    markShareAfterCreate();
    await openPool({ league_id: r.id, slug: r.slug }, '/');
  };
  // signed in from this page with the pool still in hand: start it the moment the account's seat is known
  useEffect(() => {
    if (!afterSignIn || !canHost) return;
    setAfterSignIn(false);
    startAsMember().catch((x) => { setErr((x as Error).message); setBusy(false); });
  }, [afterSignIn, canHost]); // eslint-disable-line react-hooks/exhaustive-deps
  // signed in, but the account has no seat anywhere: pool_start would refuse it, so say so instead of waiting
  useEffect(() => {
    if (!afterSignIn || !session || me || mode !== 'fantasy') return;
    const t = setTimeout(() => { setAfterSignIn(false); setBusy(false); setErr('That account isn’t in a pool yet, so it can’t start one. Start with a new account below.'); }, 6000);
    return () => clearTimeout(t);
  }, [afterSignIn, session, me, mode]);
  const startFresh = async () => {
    // keep the pool typed so far; only the account goes
    setErr(''); setSignIn(false); setHaveAccount(false);
    await signOut();
  };

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy || afterSignIn || (!!session && !canHost)) return;
    setBusy(true); setErr(''); setSignIn(false);
    try {
      if (canHost) { await startAsMember(); return; }
      const login = email.trim().toLowerCase();
      if (haveAccount) {
        // sign in here and start it as that account once its seat loads (the effect above), nothing retyped
        setRemember(true);
        const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
        if (se) { setBusy(false); setErr(se.message === 'Invalid login credentials' ? 'That email and password don’t match.' : se.message); return; }
        try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
        setAfterSignIn(true);
        return;
      }
      // attribution rides along; the join function drops it when the columns are not live yet
      const { data, error } = await supabase.functions.invoke('join', { body: { pool: { name: pool.trim(), color, pack: openPack }, email: login, password: pw, name: name.trim(), ...attributionFields(), ...(await humanField()) } });
      if (error) {
        const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
        // an email that already has an account: the password field stays, the sign-in happens right here
        if (body?.signIn) { setHaveAccount(true); setPw(''); setErr('That email already has an account. Type its password and the pool starts on it.'); setSignIn(false); setBusy(false); return; }
        setErr(body?.error ?? 'Couldn’t start the pool right now. Try again in a minute.');
        setBusy(false);
        return;
      }
      setRemember(true);
      const opened = (data as { pool?: { id: number; slug: string } })?.pool;
      // Queue before sign-in so a failed login cannot skip the north-star hit; send after reload.
      await trackPoolCreated({ id: opened?.id, pack: openPack, sport: mode === 'questions' ? null : event?.sport ?? null, kind: mode });
      const { error: se } = await supabase.auth.signInWithPassword({ email: login, password: pw });
      if (se) { setBusy(false); setErr(`Your pool is open, but signing in failed: ${se.message}. Sign in from the main page.`); return; }
      try { localStorage.setItem('sak-last-email', login); } catch { /* nothing to remember with */ }
      await trackSignUp('email', login);
      if (opened) {
        await startGames(opened.id).catch((x) => setErr(`Your pool is open, but its games didn’t start: ${(x as Error).message}. Add them from the Host page.`));
        markShareAfterCreate();
        await openPool({ league_id: opened.id, slug: opened.slug }, '/');
      }
      else { window.location.hash = '#/'; window.location.reload(); }
    } catch (x) { setErr((x as Error).message); setBusy(false); }
  };

  return (
    <div className={`pt-safe min-h-dvh px-4 pt-10 ${bar ? 'pb-[calc(7.5rem+env(safe-area-inset-bottom))]' : 'pb-10'}`} style={themed(color)}>
      {/* room for the consent sheet while it's up (ConsentBanner sets how far down it reaches), so the title shows */}
      <div aria-hidden style={{ height: 'max(0px, calc(var(--consent-space, 0px) - 2.25rem))' }} />
      <div className="mx-auto w-full max-w-md pt-6">
        {member && <a href="#/pools" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-white/70 hover:text-white"><ArrowLeft size={16} /> My pools</a>}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={mode ? 44 : 56} /></div>
          <h1 className="h-display text-shine text-4xl leading-none">{mode === 'fantasy' ? 'Start a league' : 'Start a pool'}</h1>
          {!mode && <p className="mt-2 text-sm text-slate-300">Sports pools, question pools and fantasy leagues for anything your group follows. Free, and never money.</p>}
        </div>

        <form id="np-form" onSubmit={start} className="card-hero p-5">
          <div className="relative space-y-4 [counter-reset:step]">
            {resolving ? <div className="flex justify-center py-6"><Spinner /></div> : (<>

            {folded('type') ? (
              <Step id="type" title="Starting" onChange={() => go('type')}
                summary={<>{MODES.find((m) => m.key === mode)!.emoji} {MODES.find((m) => m.key === mode)!.title}</>} />
            ) : (
            <Step id="type" title="What are you starting?">
              <div className="grid gap-2">
                {MODES.map((m) => {
                  const on = mode === m.key;
                  return (
                    <button key={m.key} type="button" onClick={() => {
                      setMode(m.key);
                      if (mode !== m.key) choose(null);
                      // the same kind again picks up where it was; a new one starts at what it follows
                      go(m.key === 'fantasy' ? 'details' : mode === m.key && following ? (event && !kinds.length ? 'kinds' : 'details') : 'follow');
                    }}
                      className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-2xl" style={{ background: `rgb(${rgb(color)} / .18)` }}>{m.emoji}</span>
                      <span className="min-w-0 flex-1"><span className="block font-semibold text-white">{m.title}</span><span className="mt-0.5 block text-xs leading-snug text-white/60">{m.line}</span></span>
                      {on && <Check size={18} className="mt-1 shrink-0 text-emerald-300" />}
                    </button>
                  );
                })}
              </div>
            </Step>
            )}

            {mode === 'fantasy' && shown('details') && <FantasyStart color={color} setColor={setColor} swatches={SWATCHES} member={member} signedIn={!!session} />}

            {mode === 'sports' && shown('follow') && (folded('follow') ? (
              <Step id="follow" title="Following" onChange={() => go('follow')}
                summary={<>{SPORT_EMOJI[event?.sport ?? ''] ?? '🏆'} {followLine}</>} />
            ) : (
            <Step id="follow" title="What are you following?">
              <div className="grid gap-2">
                {byGroup.map((e, i, all) => {
                  const on = following?.type === 'event' && following.comp === e.competition;
                  // the events under their sport's name, a run whose final is close marked as such
                  const soon = finalSoon(e);
                  const head = i === 0 || all[i - 1].sport !== e.sport || finalSoon(all[i - 1]) !== soon;
                  // "Live now" only where a round is being played (a week under way, a series on), so it says something;
                  // an event whose next round hasn't started reads "next" in its stage
                  const live = /under way/i.test(e.stage ?? '') || (!!e.open_round && !/\bnext\b/i.test(e.stage ?? ''));
                  // what it plays, so two events on one league read apart (the NHL's weeks and its box pool)
                  const plays = [...e.kinds.filter((k) => k in KINDS), ...(!e.kinds.includes('squares') && eventGrids(e).length ? ['squares' as const] : [])]
                    .map((k) => KINDS[k].title.replace(/^The (.)/, (_, c: string) => c.toUpperCase())).concat(e.pack ? ['Questions'] : []);
                  return (
                    <div key={e.competition} className="contents">
                    {head && <div className="mt-1 px-1 text-[10px] font-black uppercase tracking-[.18em] text-white/50">{SPORT_EMOJI[e.sport] ?? '🏆'} {SPORT_NAME[e.sport] ?? e.sport}{soon && <span className="text-gold"> · Final soon</span>}</div>}
                    <button type="button" onClick={() => { choose({ type: 'event', comp: e.competition }); go('kinds'); }}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `rgb(${rgb(color)} / .18)` }}>{SPORT_EMOJI[e.sport] ?? '🏆'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-balance font-semibold text-white">{e.name}{live && <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-red-200 ring-1 ring-red-400/30">Live now</span>}</span>
                        {plays.length > 0 && <span className="mt-0.5 block text-[12px] font-semibold leading-snug text-white/85">{plays.join(' · ')}</span>}
                        <span className="mt-0.5 block text-xs text-white/60">{e.stage ?? 'Under way'} · {e.kinds.includes('players') && !e.open_round ? `from the next puck drop, ${lockText(e.next_lock)}` : `picks from ${e.word ? e.open_label : `the ${e.open_label}`}, ${lockText(e.next_lock)}`}</span>
                      </span>
                      {on && <Check size={18} className="shrink-0 text-emerald-300" />}
                    </button>
                    </div>
                  );
                })}
                {events && !events.length && (listsFailed
                  ? <div className="flex items-center gap-3 rounded-xl bg-white/[.05] px-3 py-2 text-xs text-white/70"><span className="min-w-0 flex-1">Couldn&apos;t load what&apos;s on right now.</span><button type="button" className="btn-ghost shrink-0 px-3 py-1.5 text-xs" onClick={retryLists}>Try again</button></div>
                  : <p className="rounded-xl bg-white/[.05] px-3 py-2 text-xs text-white/70">No league is open for a new pool right now. A questions pool works for anything.</p>)}
                {!events && <div className="flex justify-center py-2"><Spinner /></div>}
              </div>
            </Step>
            ))}

            {mode === 'questions' && shown('follow') && (folded('follow') ? (
              <Step id="follow" title="Questions" onChange={() => go('follow')}
                summary={<>{(following?.type === 'pack' && chosen?.icon) || (following?.type === 'blank' ? '✍️' : '🔮')} {followLine}</>} />
            ) : (
            <Step id="follow" title="Which questions?">
              <div className="grid gap-2">
                {[{ f: { type: 'blank' } as Following, key: 'blank', name: 'Your own questions', icon: '✍️', sub: 'An awards night, the office, the family, anything: you write the questions, friends call them', soon: false },
                  ...loosePacks.map((p) => { const w = packWhen(p); return { f: { type: 'pack', slug: p.slug } as Following, key: p.slug, name: packName(p.name), icon: p.icon, sub: `${p.questions} questions · ${w.text}`, soon: w.soon }; })].map((o) => {
                  const on = following?.type === o.f?.type && (o.f?.type !== 'pack' || (following?.type === 'pack' && following.slug === o.key));
                  return (
                    <button key={o.key} type="button" onClick={() => { choose(o.f); go('details'); }}
                      className={`flex items-center gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `rgb(${rgb(color)} / .18)`, color }}>{o.icon ? <span className="text-lg leading-none">{o.icon}</span> : o.key !== 'blank' ? <Sparkles size={18} /> : <Plus size={18} />}</span>
                      <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-balance font-semibold text-white">{o.name}{o.soon && <span className="rounded-full bg-amber-400/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-amber-200 ring-1 ring-amber-400/30">Closing soon</span>}</span><span className="block text-xs text-white/60">{o.sub}</span></span>
                      {on && <Check size={18} className="shrink-0 text-emerald-300" />}
                    </button>
                  );
                })}
                {!packs && <div className="flex justify-center py-2"><Spinner /></div>}
              </div>
            </Step>
            ))}

            {mode === 'sports' && event && shown('kinds') && (folded('kinds') ? (
              <Step id="kinds" title="Your games" onChange={() => go('kinds')} summary={kindsLine} />
            ) : (
              <Step id="kinds" title="What kind of pool?">
                <div className="grid gap-2">
                  {[...offered.map((k) => ({ key: k as GameKind | 'questions', ...KINDS[k], sub: `${KINDS[k].line} ${KINDS[k].time}.` })),
                    ...(eventPack ? [{ key: 'questions' as const, title: 'The questions', badge: 'In Supercoins', emoji: '🔮', sub: `${eventPack.questions} questions on ${event.word ? 'the season: the title, the races and the awards' : `the ${event.final_label.replace(/^(AL|NL) /, '')} and the pennants`}, priced like a market: buy what you believe, sell if you change your mind.`, time: '', line: '' }] : [])].map((k) => {
                    const on = kinds.includes(k.key);
                    const main = on && kinds.filter((x) => (offered as string[]).includes(x) || x === 'questions')[0] === k.key;
                    return (
                      <button key={k.key} type="button" aria-pressed={on} onClick={() => toggle(k.key)}
                        className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${on ? 'border-white/40 bg-white/[.08]' : 'border-white/10 bg-white/[.03] hover:bg-white/[.06]'}`}>
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `rgb(${rgb(color)} / .18)` }}>{k.emoji}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-white">{k.title}
                            <span className="rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-wider ring-1" style={{ color, background: `rgb(${rgb(color)} / .12)`, borderColor: color }}>{k.badge}</span>
                            {main && <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-white/80">Main game</span>}</span>
                          <span className={`mt-0.5 text-xs leading-snug text-white/60 ${on ? 'block' : 'line-clamp-2'}`}>{k.sub}</span>
                        </span>
                        <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1 ${on ? 'bg-emerald-400 text-[#0b1220] ring-emerald-300' : 'ring-white/25'}`}>{on && <Check size={16} strokeWidth={3} />}</span>
                      </button>
                    );
                  })}
                </div>
                {!kinds.length && <p className="mt-2 text-xs text-amber-200">Pick at least one.</p>}
                {/* the rest of the menu, greyed: what each is for, so nothing looks missing */}
                {KIND_ORDER.some((k) => !offered.includes(k)) && (
                  <details className="group mt-3 rounded-2xl border border-white/[.06] bg-black/15">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-semibold text-white/70">
                      <span>More kinds of pool, on other events</span><span className="transition group-open:rotate-90">›</span>
                    </summary>
                    <div className="grid gap-1.5 px-2 pb-2">
                      {KIND_ORDER.filter((k) => !offered.includes(k)).map((k) => (
                        <div key={k} className="flex items-start gap-3 rounded-xl bg-white/[.03] p-2.5 opacity-70">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.06] text-base">{KINDS[k].emoji}</span>
                          <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 text-sm font-semibold text-white">{KINDS[k].title}<Lock size={11} className="text-white/50" /></span>
                            <span className="block text-[11px] leading-snug text-white/60">{KINDS[k].line}</span>
                            <span className="mt-0.5 block text-[11px] font-semibold leading-snug" style={{ color }}>{KIND_WHEN[k]}</span></span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {kinds.includes('players') && (
                  <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">
                    {event.open_round ? 'The box pool runs all through the playoffs: everyone takes one player from every box of the best in the first round, dealt on how far their clubs are expected to go.' : `The box pool starts ${event.open_label}: everyone takes one player from every box of the league’s best.`} A goal or an assist is a point, a goalie’s win two and a shutout one more. The host can change the size{event.open_round ? '' : ' and the nights'} until the first puck drop.
                  </p>
                )}
                {kinds.includes('survivor') && (
                  <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">
                    Last one standing runs from {event.open_label} to {event.final_label}: one {event.club_word ?? 'club'} to win each {(event.word ?? 'round').toLowerCase()}, never the same one twice. {lives > 1 ? `${event.sport === 'soccer' ? 'A draw or a loss' : 'A loss'}, or no pick, costs one of your ${lives} lives; lose them all and you’re out` : `${event.sport === 'soccer' ? 'A draw or a loss' : 'A loss'} and you’re out`}; whoever is still in at the end shares it.
                  </p>
                )}
                {kinds.includes('survivor') && (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white/[.05] px-3 py-2">
                    <span className="text-[13px] font-semibold text-white">Lives<span className="block text-[11px] font-normal text-white/60">Out on the first loss, or a second chance</span></span>
                    <div className="flex shrink-0 gap-1 rounded-xl bg-black/25 p-1">
                      {[1, 2, 3].map((n) => <button key={n} type="button" aria-label={`${n} ${n === 1 ? 'life' : 'lives'}`} onClick={() => setLives(n)} className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${lives === n ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{'♥'.repeat(n)}</button>)}
                    </div>
                  </div>
                )}

                {kinds.includes('series') && (
                  <Part title="How it scores">
                    <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-black/25 p-1">
                      {PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPreset(p.key)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${preset === p.key ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{p.label}</button>)}
                    </div>
                    <p className="mt-2 text-sm leading-snug text-white/80">{event.sport === 'nfl' ? 'Every game is a single game, so a right winner takes the round’s points: the later the round, the more it’s worth.' : PRESETS.find((p) => p.key === preset)!.line}</p>
                    <p className="mt-1.5 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{presetExample(preset, event.final_label, event.final_round, event.sport === 'nfl')} The total {event.sport === 'mlb' ? 'runs' : event.sport === 'nhl' ? 'goals' : 'points'} in the last game breaks a tie.</p>
                    {kinds.includes('rank') && <p className="mt-2 text-xs leading-snug text-white/60">Rank the teams: your top club in the {event.open_label} earns the most for every game it wins, your last club the least.</p>}
                  </Part>
                )}

                {kinds.includes('players') && (
                  <Part title={event.open_round ? 'Its size' : 'Its size and nights'}>
                    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
                      {([['classic', 'Ten boxes of six'], ['quick', 'Five boxes of five']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setBox({ ...box, preset: k })} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${box.preset === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
                    </div>
                    {!event.open_round && <div className="mt-1.5 grid grid-cols-3 gap-1.5 rounded-2xl bg-black/25 p-1">
                      {([['week', 'A week'], ['month', 'Four weeks'], ['season', 'The season']] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setBox({ ...box, length: k })} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${box.length === k ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{l}</button>)}
                    </div>}
                    <p className="mt-2 text-sm leading-snug text-white/80">{box.preset === 'classic' ? 'Seven boxes of forwards, two of defence and one of goalies: sixty of the league’s best to choose from.' : 'Three boxes of forwards, one of defence and one of goalies: quick to fill in.'} {event.open_round ? 'Every playoff game from the first puck drop to the Cup; a player whose club is knocked out has nothing more to add.' : box.length === 'week' ? 'Seven nights from the first puck drop.' : box.length === 'month' ? 'Four weeks from the first puck drop.' : 'Every night to the end of the regular season.'}</p>
                  </Part>
                )}

                {kinds.includes('pickem') && (
                  <Part title={kinds.includes('series') ? 'How pick’em scores' : 'How it scores'}>
                    <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-black/25 p-1">
                      {PICKEM_PRESETS.map((p) => <button key={p.key} type="button" onClick={() => setPkPreset(p.key)} className={`rounded-xl px-2 py-2 text-xs font-bold transition ${pkPreset === p.key ? 'bg-white text-[#0b1220]' : 'text-white/70 hover:text-white'}`}>{p.label}</button>)}
                    </div>
                    <p className="mt-2 text-sm leading-snug text-white/80">{PICKEM_PRESETS.find((p) => p.key === pkPreset)!.line}</p>
                    <p className="mt-1.5 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{PICKEM_PRESETS.find((p) => p.key === pkPreset)!.example} From {event.open_label} to {event.final_label}; each pick locks at its own kick-off.</p>
                    <div className="mt-2 rounded-xl bg-white/[.05] px-3 py-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-semibold text-white">Forgot a pick? The favourite<span className="block text-[11px] font-normal text-white/60">Instead of nothing, when the game starts</span></span>
                        <Toggle on={missFav} onChange={setMissFav} />
                      </div>
                      {missFav && <p className="pb-2 text-[11px] leading-snug text-white/70">{MISSED_LINE}</p>}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white/[.05] px-3 py-2">
                      <span className="text-[13px] font-semibold text-white">Drop the worst {(event.word ?? 'round').toLowerCase()}s<span className="block text-[11px] font-normal text-white/60">A bad week or a late start, forgiven</span></span>
                      <div className="flex shrink-0 gap-1 rounded-xl bg-black/25 p-1">
                        {[0, 1, 2].map((n) => <button key={n} type="button" onClick={() => setDropN(n)} className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${dropN === n ? 'bg-white text-[#0b1220]' : 'text-white/70'}`}>{n === 0 ? 'None' : n}</button>)}
                      </div>
                    </div>
                    {atsFits(event.sport) && (
                      <div className="mt-2 rounded-xl bg-white/[.05] px-3 py-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-semibold text-white">Against the spread<span className="block text-[11px] font-normal text-white/60">Pick who covers the line, not just who wins</span></span>
                          <Toggle on={ats} onChange={setAts} />
                        </div>
                        {ats && <p className="pb-2 text-[11px] leading-snug text-white/70">{ATS_LINE}</p>}
                      </div>
                    )}
                  </Part>
                )}

                {gridSeries && kinds.includes('squares') && (
                  <Part title="The grid">
                    <SquaresKnobs dark grids={eventGrids(event)} on={gridSeries.id} setOn={setGridOn} grid={grid} setGrid={setGrid} sport={event.sport} />
                    <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{gridLabel(gridSeries)}. Members claim squares with their Supercoins until the grid fills or {gridSeries.best_of > 1 ? 'Game 1 starts' : 'the game starts'}; then the digits are drawn from a seed anyone can check.</p>
                  </Part>
                )}

                {sheetGame && kinds.includes('props') && (
                  <Part title="The prop sheet’s game">
                    <SheetPicker dark games={event.sheets ?? []} on={sheetGame.id} setOn={setSheetOn} />
                    <p className="mt-2 rounded-xl bg-white/[.05] px-3 py-2 text-xs leading-snug text-white/70">{sheetLabel(sheetGame)}: eight calls on the game, a point each, settled from the score. Everyone's sheet locks at the start.</p>
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-white/[.05] px-3 py-1">
                      <span className="text-[13px] font-semibold text-white">A sheet on every game after it<span className="block text-[11px] font-normal text-white/60">Each opens by itself a day and a half before the game</span></span>
                      <Toggle on={everySheet} onChange={setEverySheet} />
                    </div>
                  </Part>
                )}

                <button type="button" disabled={!kinds.length} onClick={() => go('details')}
                  className="btn mt-5 w-full bg-white py-3 text-base font-bold text-[#0b1220] hover:bg-white/90">Next: name your pool <ArrowRight size={18} /></button>
              </Step>
            ))}

            {mode !== 'fantasy' && following && shown('details') && (
            <Step id="details" title={member ? 'Name it' : 'Name it, and who’s hosting'}>
            <div className="space-y-4">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-white/70">Name your pool</span>
              <input id="np-pool" className="input w-full" value={pool} onChange={(e) => { setPoolTouched(true); setPool(e.target.value); }} maxLength={40} placeholder={packPlaceholder(event ? event.pack : chosen?.slug)} /></label>
            <div>
              <span className="text-xs font-semibold text-white/70">Its colour</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {SWATCHES.map((s) => (
                  <button key={s} type="button" aria-label={`Colour ${s}`} onClick={() => setColor(s)} className="grid h-9 w-9 place-items-center rounded-full ring-2 transition"
                    style={{ background: s, boxShadow: color === s ? `0 0 18px ${s}` : undefined, ['--tw-ring-color' as string]: color === s ? '#fff' : 'transparent' }}>
                    {color === s && <Check size={18} className="text-[#0b1220]" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            {member && isGuestEmail(session?.user?.email) ? (
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[.06] p-3 text-sm text-white/80">
                <p>You&apos;re in as {me!.gm_name} on this phone only. The pool starts on this account; add an email on its home right after (Keep your place), so the host&apos;s seat, the invite link and the settling survive a new phone.</p>
              </div>
            ) : member ? (
              <p className="text-sm text-white/70">You’re signed in as {me!.gm_name}. The pool goes on your account beside the others, on My pools.</p>
            ) : session && !afterSignIn ? (
              isGuestEmail(session.user?.email) ? (
                <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[.06] p-3 text-sm text-white/80">
                  <p>You&apos;re in with your fan zone name, on this phone only. The pool starts on this account; add an email on its home right after (Keep your place), so the host&apos;s seat and the invite link survive a new phone.</p>
                </div>
              ) : (
                <p className="text-sm text-white/70">You&apos;re signed in. The pool starts on this account and shows on My pools.</p>
              )
            ) : session ? (
              <p className="text-sm text-white/70">Signed in. Opening your pool…</p>
            ) : (
              <div className="space-y-3 border-t border-white/10 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="label text-white/70">{haveAccount ? 'Sign in to host it' : 'You, the host'}</div>
                  <button type="button" className="text-xs text-white/60 underline" onClick={() => { setHaveAccount((v) => !v); setErr(''); setSignIn(false); }}>{haveAccount ? 'New here? Make an account' : 'Already have an account?'}</button>
                </div>
                {!haveAccount && <input id="np-name" className="input w-full" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name, as friends know you" maxLength={40} />}
                <input id="np-email" className="input w-full" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
                <div className="relative">
                  <input id="np-pw" className="input w-full pr-16" type={showPw ? 'text' : 'password'} autoComplete={haveAccount ? 'current-password' : 'new-password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder={haveAccount ? 'Your password' : 'A password, 6+ characters'} />
                  <button type="button" className="absolute inset-y-0 right-3 text-xs font-semibold text-white/70" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? 'Hide the password' : 'Show the password'}>{showPw ? 'Hide' : 'Show'}</button>
                </div>
                {haveAccount
                  ? <p className="text-[11px] leading-snug text-white/50">The pool goes on your account beside the others, on My pools.</p>
                  : <p className="text-[11px] leading-snug text-white/50">Starting a pool means you agree to the <a href="#/terms" className="underline">Terms of use</a>. <a href="#/privacy" className="underline">What we keep, held in the United States</a>.</p>}
              </div>
            )}
            </div>
            </Step>
            )}
            </>)}

            {!session && !haveAccount && !shown('details') && <button type="button" onClick={() => { setHaveAccount(true); go('details'); }} className="block w-full pt-1 text-center text-sm text-white/60 underline">Already have an account? Sign in and start it</button>}
          </div>
        </form>
        {err && (
          <div id="np-err" className="mt-4 scroll-mb-32 rounded-xl border border-red-400/30 bg-red-900/50 px-4 py-3 text-center text-sm text-red-200">
            {err}{signIn && <> <a href="#/" className="font-semibold underline">Sign in</a></>}
            {session && !canHost && !afterSignIn && !busy && <> <button type="button" className="font-semibold underline" onClick={startFresh}>Start with a new account</button></>}
          </div>
        )}

        {mode !== 'fantasy' && <div className="mt-6 grid gap-2">
          {(mode === 'questions' ? QUESTION_STEPS : STEPS).map(([icon, t, d]) => (
            <div key={t} className="flex items-start gap-3 rounded-2xl border border-white/[.06] bg-white/[.03] p-3">
              <span className="text-xl leading-none">{icon}</span>
              <span className="min-w-0"><span className="block text-sm font-semibold text-white">{t}</span><span className="block text-xs text-mute">{d}</span></span>
            </div>
          ))}
        </div>}
        <p className="mt-4 text-center text-[11px] text-mute">Super Pools is free and runs on Supercoins with no cash value. Nothing to buy, nothing to cash out.</p>
      </div>

      {/* the start button, always in reach: what's still missing (a tap goes there) until the pool can start. #/new is
          drawn outside the app's layout, so there's no dock under it; it sits above the phone's home bar. */}
      {bar && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0b1220]/90 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-white/[.06]"><div className="h-full bg-gold transition-[width] duration-300" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-[.16em] text-white/50">{ready ? 'All set' : resolving ? 'One moment' : `Step ${curAt + 1} of ${stepCount}`}</div>
              {need && !resolving ? (
                <button type="button" onClick={fix} className="text-left text-sm font-semibold leading-snug text-white"><span className="line-clamp-1">{need.text}<ChevronRight size={15} className="-mt-0.5 ml-0.5 inline text-white/60" /></span></button>
              ) : ready ? (
                <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-white">{pool.trim()}</p>
              ) : null}
            </div>
            <button type="submit" form="np-form" className="btn-gold shrink-0 px-3.5 py-3 text-[15px]" disabled={busy || afterSignIn || !ready || (!!session && !canHost)}>{busy || afterSignIn ? <Spinner /> : haveAccount && !member ? 'Sign in and start' : 'Start my pool'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
