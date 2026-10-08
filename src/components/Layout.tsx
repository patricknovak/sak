import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LeagueMark, Wordmark, WordmarkStack } from './Brand';
import { useLeague, useNow } from '../lib/store';
import { hasFeature } from '../lib/features';
import { realtimeChannel, supabase } from '../lib/supabase';
import { ago, countdown } from '../lib/format';
import { currentSubscription } from '../lib/push';
import { Sheet, TeamBadge } from './ui';
import { centreName } from '../lib/poolGames';
import {
  Bell, ClipboardList, Dices, Home, Landmark, Lightbulb, LogOut, Menu, MessageCircle, Radio, Repeat2, Search, Shield, Target,
  Trophy, Tv, UserRound, Wrench, Wallet, type LucideIcon, BarChart3, Sparkles, Crown, Wand2, Layers, ChevronDown, Swords, MonitorPlay } from 'lucide-react';

type Item = { to: string; label: string; icon: LucideIcon; commish?: boolean; short?: string };   // short: the phone dock's label, one line

export function useUnread() {
  const { me } = useLeague();
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [reads, setReads] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<{ id: number; channel: string; team_id: number | null }[]>([]);   // the last 200 messages, for the count
  useEffect(() => {
    if (!me) return;
    const load = async () => {
      const [{ data: r }, { data: m }] = await Promise.all([
        supabase.from('chat_reads').select('channel,last_read_id'),
        supabase.from('messages').select('id,channel,team_id').order('id', { ascending: false }).limit(200),
      ]);
      setReads(Object.fromEntries((r ?? []).map((x) => [x.channel, x.last_read_id])));
      setRecent((m ?? []) as { id: number; channel: string; team_id: number | null }[]);
      const l: Record<string, number> = {};
      for (const x of m ?? []) l[x.channel] = Math.max(l[x.channel] ?? 0, x.id);
      setLatest(l);
    };
    load();
    const ch = realtimeChannel('unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        const m = p.new as { id: number; channel: string; team_id: number | null };
        setLatest((l) => ({ ...l, [m.channel]: Math.max(l[m.channel] ?? 0, m.id) }));
        setRecent((r) => (r.some((x) => x.id === m.id) ? r : [m, ...r].slice(0, 300)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, (p) => {
        const r = p.new as { channel: string; last_read_id: number };
        if (r?.channel) setReads((x) => ({ ...x, [r.channel]: r.last_read_id }));
      })
      .subscribe();
    // the chat panel announces what it just marked read, so the badge clears without waiting on the server
    const onRead = (e: Event) => { const { channel, id } = (e as CustomEvent<{ channel: string; id: number }>).detail; setReads((r) => ({ ...r, [channel]: Math.max(r[channel] ?? 0, id) })); };
    window.addEventListener('sak:read', onRead);
    // and when the app comes back to the front, re-check (reads made on another device, missed events)
    const onWake = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onWake);
    return () => { supabase.removeChannel(ch); window.removeEventListener('sak:read', onRead); document.removeEventListener('visibilitychange', onWake); };
  }, [me?.id]);
  const unread = (c: string) => (latest[c] ?? 0) > (reads[c] ?? 0);
  const any = Object.keys(latest).some((c) => c !== 'draft' && unread(c));
  // how many messages you haven't seen (everything but the draft room and your own posts; 200+ shows as 99+)
  const count = recent.filter((m) => m.channel !== 'draft' && m.team_id !== me?.id && m.id > (reads[m.channel] ?? 0)).length;
  return { unread, any, count, markRead: (c: string, id: number) => setReads((r) => ({ ...r, [c]: Math.max(r[c] ?? 0, id) })) };
}

// short beep + buzz when it's your turn
function alertMe() {
  try {
    navigator.vibrate?.([200, 100, 200]);
    const ctx = new AudioContext();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.2, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.15);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
    });
  } catch { /* no audio */ }
}

export function Layout({ children }: { children: ReactNode }) {
  const { me, league, brand, draft, picks, notifications, refresh, sport, kind } = useLeague();
  const now = useNow(1000);
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false);
  const { any: chatUnread, count: chatCount } = useUnread();
  const unreadN = notifications.filter((n) => !n.read).length;

  // if this device already has alerts on, make sure the server knows it belongs to this team
  useEffect(() => {
    if (!me || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    currentSubscription().then((sub) => {
      const j = sub?.toJSON();
      if (j?.endpoint) supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent }).then(() => {}, () => {});
    }).catch(() => {});
  }, [me?.id]);

  // what this league or pool actually runs, so nothing shows that belongs to another: questions (a fantasy league has
  // the board only once it asks one), and the soccer games (only in a pool that has started one). Row-level security
  // keeps each count to this league.
  const [runs, setRuns] = useState({ questions: false, predictor: false, survivor: false, games: false, mlb: false });
  // the competition played in rounds the pool's games are on (a pick'em, last one standing, Call the score), for its centre
  const [rounds, setRounds] = useState<{ id: string; sport: string } | null>(null);
  const [nflPost, setNflPost] = useState(false);
  const onHost = loc.pathname === '/host';
  useEffect(() => {
    if (!me) return;
    let live = true;
    const has = (t: string) => supabase.from(t).select('id', { count: 'exact', head: true }).then(({ count }) => (count ?? 0) > 0, () => false);
    // the baseball centre only for a pool with a game on the MLB postseason (a soccer pick'em has no use for it)
    const mlb = supabase.from('pool_games').select('id', { count: 'exact', head: true }).like('competition', 'mlb%').then(({ count }) => (count ?? 0) > 0, () => false);
    // the NFL's playoffs played as series (a bracket, migration 187) have the series centre too
    supabase.from('pool_games').select('id', { count: 'exact', head: true }).like('competition', 'nfl-post%')
      .then(({ count }) => { if (live) setNflPost((count ?? 0) > 0); }, () => {});
    Promise.all([has('pool_markets'), has('predictors'), has('survivors'), has('pool_games'), mlb]).then(([questions, predictor, survivor, games, mlbOn]) => { if (live) setRuns({ questions, predictor, survivor, games, mlb: mlbOn }); });
    const first = (t: string, kind?: string) => {
      let q = supabase.from(t).select('competition').order('id', { ascending: false }).limit(1);
      if (kind) q = q.eq('kind', kind);
      return q.then(({ data }) => (data?.[0] as { competition: string } | undefined)?.competition ?? null, () => null);
    };
    Promise.all([first('pool_games', 'pickem'), first('survivors'), first('predictors')]).then(async (cs) => {
      const id = cs.find(Boolean) ?? null;
      const sp = id ? (await supabase.from('competitions').select('sport').eq('id', id).maybeSingle()).data?.sport as string | undefined : undefined;
      if (live) setRounds(id && sp ? { id, sport: sp } : null);
    });
    return () => { live = false; };
  }, [me?.id, league?.league_id, onHost]);

  const phase = league?.phase;
  const draftish = phase === 'keepers' || phase === 'predraft' || phase === 'draft';
  const spectator = me?.role === 'spectator';
  // a prediction pool (migration 145) is questions, the table, chat: none of the sport's pages
  const pool = kind === 'predict';
  // a sports pool's games (migration 165) take the second place; its questions show once it has any
  const poolQuestions = runs.questions || !runs.games;
  const items: Item[] = pool ? [
    { to: '/', label: 'Home', icon: Home },
    ...(runs.games ? [{ to: '/picks', label: 'Picks', icon: Swords }] : []),
    // the questions keep their place unless the pool also runs sports games: then the Table (every game) takes it
    ...(poolQuestions && !runs.games ? [{ to: '/questions', label: 'Questions', icon: Sparkles }] : []),
    { to: '/chat', label: 'Chat', icon: MessageCircle },
    { to: '/leaders', label: 'Table', icon: Crown },
  ] : [
    { to: '/', label: 'Home', icon: Home },
    draftish ? { to: '/draft', label: 'Draft Centre', short: 'Draft', icon: ClipboardList } : spectator ? { to: '/standings', label: 'Standings', icon: Trophy } : { to: '/team', label: 'Lineup', icon: Shield },
    { to: '/chat', label: 'Chat', icon: MessageCircle },
    // the sport's own centre ("NHL centre" for hockey), from the sports row
    { to: '/nhl', label: sport.words.centre ?? 'NHL centre', icon: Tv },
  ];
  const moreItems: Item[] = (pool ? [
    ...(runs.games && poolQuestions ? [{ to: '/questions', label: 'Questions', icon: Sparkles }] : []),
    // the sport centre for the pool's games (baseball's postseason first)
    ...(runs.mlb ? [{ to: '/sport/mlb', label: 'MLB centre', icon: Tv }] : []),
    ...(nflPost ? [{ to: '/sport/nfl', label: 'NFL playoffs', icon: Tv }] : []),
    ...(rounds ? [{ to: `/centre/${rounds.id}`, label: centreName(rounds.sport), icon: Tv }] : []),
    ...(runs.predictor ? [{ to: '/predictor', label: 'Call the score', icon: Target }] : []),
    ...(runs.survivor ? [{ to: '/survivor', label: 'Last one standing', icon: Shield }] : []),
    { to: '/pools', label: 'My pools', icon: Layers },
    { to: '/features', label: 'Ideas', icon: Lightbulb },
    { to: '/profile', label: 'My Profile', icon: UserRound },
    { to: '/host', label: 'Host', icon: Wand2, commish: true },
  ] as Item[] : [
    ...(draftish ? [] : [{ to: '/lineup-new', label: 'Lineup New', icon: Sparkles }]),
    // where to watch tonight's games (hockey leagues: the NHL's broadcasts)
    ...(sport.words.centre === 'NHL centre' ? [{ to: '/watch', label: 'Watch live', icon: MonitorPlay }] : []),
    { to: '/standings', label: 'Standings', icon: Trophy },
    ...(runs.questions ? [{ to: '/questions', label: 'Questions', icon: Sparkles }] : []),
    { to: '/players', label: 'Players', icon: Search },
    { to: '/pools', label: 'My pools', icon: Layers },
    ...(draftish ? [] : [{ to: '/scoreboard', label: 'Live scoreboard', icon: Radio }, { to: '/performance', label: 'Performance', icon: BarChart3 }]),
    draftish ? { to: '/team', label: 'My Team', icon: Shield } : { to: '/draft', label: 'Draft Centre', icon: ClipboardList },
    { to: '/trades', label: 'Trades', icon: Repeat2 },
    { to: '/bets', label: 'Side Bets', icon: Dices },
    ...(hasFeature(league, 'money') || hasFeature(league, 'fund') ? [{ to: '/money', label: 'Money', icon: Wallet }] : []),
    { to: '/league', label: 'League & History', icon: Landmark },
    { to: '/features', label: 'League Features', icon: Lightbulb },
    { to: '/profile', label: 'My Profile', icon: UserRound },
    { to: '/commish', label: 'Commissioner', icon: Wrench, commish: true },
  ]).filter((i) => (!i.commish || me?.is_commish) && !(spectator && i.to === '/team'));

  // who's on the clock?
  const current = useMemo(() => picks.find((p) => p.overall === draft?.current_overall && draft?.season === p.season), [picks, draft]);
  const myTurn = draft?.status === 'live' && current && me && current.team_id === me.id;
  const remaining = draft?.deadline ? new Date(draft.deadline).getTime() - now : 0;

  // alert once per pick
  const alerted = useRef<number | null>(null);
  useEffect(() => {
    if (myTurn && current && alerted.current !== current.overall) {
      alerted.current = current.overall;
      alertMe();
    }
  }, [myTurn, current]);
  useEffect(() => {
    document.title = myTurn ? `⏰ YOUR PICK · ${countdown(remaining)}` : league?.league_id === 1 || !league ? 'SAK Superleague' : league.name;
  }, [myTurn, Math.floor(remaining / 1000)]);

  // any open client keeps the draft clock honest (the server double-checks the deadline)
  const ticking = useRef(false);
  useEffect(() => {
    if (draft?.status !== 'live' || !draft.deadline || remaining > -500 || ticking.current) return;
    ticking.current = true;
    supabase.rpc('draft_tick').then(() => { ticking.current = false; refresh(['draft', 'picks', 'rosters']); });
  }, [draft?.status, draft?.deadline, remaining < -500]);

  const openNotif = async () => {
    setBell(true);
    const ids = notifications.filter((n) => !n.read).map((n) => n.id);
    if (ids.length) {
      await supabase.from('notifications').update({ read: true }).in('id', ids);
      refresh(['notifications']);
    }
  };

  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  if (loc.pathname === '/draft/tv') return <>{children}</>;

  const banner = draft?.status === 'live' && !!current && !loc.pathname.startsWith('/draft');
  const nKind: Record<string, string> = { trade: '🔄', bet: '🎲', mention: '💬', draft: '📋', injury: '🚑', big_night: '🔥', weekly: '🏆', health: '🩺', idea: '💡', matchup: '⚔️', watch: '⭐' };
  return (
    <div className="lg:flex" style={{ '--banner': banner ? '2.25rem' : '0px' } as React.CSSProperties}>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/[.06] bg-[#091020]/70 p-4 backdrop-blur-xl lg:flex">
        <button onClick={() => nav('/')} className="mb-7 flex items-center gap-3 px-1">
          <LeagueMark size={44} className="drop-shadow-[0_6px_16px_rgb(var(--gold-rgb)/.45)]" />
          <Wordmark size="sm" tagline={[brand.tagline, league?.season].filter(Boolean).join(" · ")} className="text-left" />
        </button>
        <nav className="flex flex-col gap-0.5">
          {[...items, ...moreItems].filter((i, n, a) => a.findIndex((x) => x.to === i.to) === n).map((i) => {
            const a = isActive(i.to);
            return (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${a ? 'bg-gradient-to-r from-white/[.14] to-white/[.03] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]' : 'text-slate-400 hover:bg-white/[.05] hover:text-slate-100'}`}>
                {a && <span className="accent-bar absolute bottom-2 left-0 top-2 w-1 rounded-r-full" />}
                <i.icon size={18} strokeWidth={a ? 2.4 : 2} className={a ? 'text-gold' : ''} />{i.label}
                {i.to === '/chat' && chatUnread && <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-goal px-1.5 text-[11px] font-bold text-white shadow-[0_0_8px_rgba(239,42,79,.9)]">{chatCount > 99 ? '99+' : chatCount || ''}</span>}
                {i.to === '/draft' && draft?.status === 'live' && <span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 rounded-2xl border border-white/[.07] bg-white/[.03] p-2.5">
          <TeamBadge team={me ?? undefined} size={36} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{me?.name}</div><div className="text-xs text-mute">GM {me?.gm_name}</div></div>
          <button className="btn-ghost btn-sm relative" onClick={openNotif} aria-label="Notifications"><Bell size={16} />{unreadN > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-goal px-1 text-[10px] font-bold">{unreadN}</span>}</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* mobile top bar */}
        <header className="pt-safe sticky top-0 z-30 border-b border-white/[.06] bg-[#05080f]/75 backdrop-blur-xl lg:hidden">
          <div className="flex h-12 items-center gap-2 px-3">
            <button onClick={() => nav('/')} className="flex items-center gap-2">
              <LeagueMark size={32} className="drop-shadow-[0_4px_10px_rgb(var(--gold-rgb)/.5)]" />
              <WordmarkStack />
            </button>
            {/* every pool on this account, one tap away */}
            <button onClick={() => nav('/pools')} aria-label="My pools" className="grid h-7 w-7 place-items-center rounded-full bg-white/[.06] text-white/70 ring-1 ring-white/10 hover:text-white">
              <ChevronDown size={15} />
            </button>
            <div className="flex-1" />
            <button className="relative grid h-9 w-9 place-items-center rounded-full bg-white/[.05] ring-1 ring-white/10" onClick={openNotif} aria-label="Notifications">
              <Bell size={18} />
              {unreadN > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-goal px-1 text-[10px] font-bold shadow-[0_0_10px_rgba(239,42,79,.8)]">{unreadN}</span>}
            </button>
            <button onClick={() => nav('/profile')} aria-label="My profile"><TeamBadge team={me ?? undefined} size={32} /></button>
          </div>
        </header>

        {/* you're on the clock */}
        {banner && current && (
          <button onClick={() => nav('/draft')} className={`sticky top-12 z-20 flex h-9 w-full items-center justify-center gap-2 truncate px-3 text-sm font-bold shadow-lg lg:top-0 ${myTurn ? 'bg-gradient-to-r from-rose-600 via-goal to-rose-600 text-white' : 'bg-gradient-to-r from-sky-500 to-cyan-400 text-ice'}`}>
            {myTurn ? '⏰ You’re on the clock!' : '🟢 Draft is live'} · Pick #{current.overall} · <span className="num">{countdown(remaining)}</span> → Draft room
          </button>
        )}

        <main key={loc.pathname} className="page-in mb-nav mx-auto w-full max-w-5xl px-3 py-3 sm:px-5 lg:mb-0 lg:px-8 lg:py-6 xl:max-w-[92rem] 2xl:max-w-[110rem] 2xl:px-10"><HostNotice />{children}</main>
      </div>

      {/* mobile dock */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 px-3 lg:hidden">
        <div className="mb-2 grid h-16 grid-cols-5 rounded-[22px] border border-white/10 bg-[#0d1528]/80 shadow-[0_18px_40px_-12px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-2xl">
          {items.map((i) => {
            const a = isActive(i.to);
            return (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className="relative flex flex-col items-center justify-center gap-1">
                <span className={`grid h-8 w-12 place-items-center rounded-full transition-all duration-200 ${a ? 'bg-gradient-to-b from-gold/30 to-white/[.06] text-gold shadow-[0_0_18px_-4px_rgb(var(--gold-rgb)/.7)]' : 'text-slate-400'}`}>
                  <i.icon size={20} strokeWidth={a ? 2.4 : 2} />
                </span>
                <span className={`whitespace-nowrap text-[10px] font-bold tracking-wide ${a ? 'text-white' : 'text-mute'}`}>{i.short ?? i.label}</span>
                {i.to === '/chat' && chatUnread && (chatCount > 0
                  ? <span className="absolute right-[18%] top-1 grid h-4 min-w-4 place-items-center rounded-full border-2 border-[#0d1528] bg-goal px-1 text-[9px] font-bold leading-none text-white">{chatCount > 99 ? '99+' : chatCount}</span>
                  : <span className="absolute right-[24%] top-2 h-2.5 w-2.5 rounded-full border-2 border-[#0d1528] bg-goal" />)}
                {i.to === '/draft' && draft?.status === 'live' && <span className="absolute right-[24%] top-2 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-[#0d1528] bg-emerald-400" />}
              </NavLink>
            );
          })}
          <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-1">
            <span className="grid h-8 w-12 place-items-center rounded-full text-slate-400"><Menu size={20} /></span>
            <span className="text-[10px] font-bold tracking-wide text-mute">More</span>
          </button>
        </div>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="stagger grid grid-cols-2 gap-2">
          {moreItems.map((i) => (
            <button key={i.to} onClick={() => { setMore(false); nav(i.to); }} className="card flex items-center gap-2.5 px-3 py-3 text-left text-sm font-semibold transition active:scale-[.97]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-white/15 to-white/[.03] ring-1 ring-white/10"><i.icon size={18} /></span>{i.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost mt-4 w-full" onClick={() => { setMore(false); supabase.auth.signOut(); }}><LogOut size={16} /> Sign out</button>
      </Sheet>

      <Sheet open={bell} onClose={() => setBell(false)} title="Notifications">
        {notifications.length === 0 ? <div className="py-8 text-center text-sm text-mute">Nothing yet. Go start something in the chat.</div> : (
          <div className="divide-y divide-white/[.06]">
            {notifications.map((n) => (
              <button key={n.id} className="flex w-full items-start gap-3 py-2.5 text-left" onClick={() => { setBell(false); if (n.link) nav(n.link); }}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[.06] text-base">{nKind[n.kind] ?? '🔔'}</span>
                <span className="flex-1 text-sm">{n.body}</span>
                <span className="text-xs text-mute">{ago(n.created_at, now)}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}

// signed in on another league's address: say so, and that the page is the GM's own league
function HostNotice() {
  const { host, hostElsewhere, league } = useLeague();
  if (!hostElsewhere || !host) return null;
  return (
    <div className="mb-3 flex items-start gap-2.5 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-3 py-2.5 text-sm text-sky-100">
      <span className="text-lg leading-none">🧭</span>
      <span className="min-w-0 flex-1">This is <b>{host.name}</b>’s address, and you’re not in that league, so you’re seeing your own{league?.name ? <>: <b>{league.name}</b></> : ''}.</span>
    </div>
  );
}
