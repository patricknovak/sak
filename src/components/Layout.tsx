import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import { ago, countdown } from '../lib/format';
import { currentSubscription } from '../lib/push';
import { Sheet, TeamBadge } from './ui';
import {
  Bell, ClipboardList, FlaskConical, Dices, Home, Landmark, Lightbulb, Lock, LogOut, Menu, MessageCircle, Newspaper, Repeat2, Search, Shield,
  Trophy, UserRound, Wrench, type LucideIcon,
} from 'lucide-react';

type Item = { to: string; label: string; icon: LucideIcon; commish?: boolean };

export function useUnread() {
  const { me } = useLeague();
  const [latest, setLatest] = useState<Record<string, number>>({});
  const [reads, setReads] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!me) return;
    const load = async () => {
      const [{ data: r }, { data: m }] = await Promise.all([
        supabase.from('chat_reads').select('channel,last_read_id'),
        supabase.from('messages').select('id,channel').order('id', { ascending: false }).limit(200),
      ]);
      setReads(Object.fromEntries((r ?? []).map((x) => [x.channel, x.last_read_id])));
      const l: Record<string, number> = {};
      for (const x of m ?? []) l[x.channel] = Math.max(l[x.channel] ?? 0, x.id);
      setLatest(l);
    };
    load();
    const ch = realtimeChannel('unread')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
        const m = p.new as { id: number; channel: string };
        setLatest((l) => ({ ...l, [m.channel]: Math.max(l[m.channel] ?? 0, m.id) }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, (p) => {
        const r = p.new as { channel: string; last_read_id: number };
        if (r?.channel) setReads((x) => ({ ...x, [r.channel]: r.last_read_id }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me?.id]);
  const unread = (c: string) => (latest[c] ?? 0) > (reads[c] ?? 0);
  const any = Object.keys(latest).some((c) => c !== 'draft' && unread(c));
  return { unread, any, markRead: (c: string, id: number) => setReads((r) => ({ ...r, [c]: Math.max(r[c] ?? 0, id) })) };
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
  const { me, league, draft, picks, notifications, refresh } = useLeague();
  const now = useNow(1000);
  const loc = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(false);
  const [bell, setBell] = useState(false);
  const { any: chatUnread } = useUnread();
  const unreadN = notifications.filter((n) => !n.read).length;

  // if this device already has alerts on, make sure the server knows it belongs to this team
  useEffect(() => {
    if (!me || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    currentSubscription().then((sub) => {
      const j = sub?.toJSON();
      if (j?.endpoint) supabase.rpc('push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: navigator.userAgent }).then(() => {}, () => {});
    }).catch(() => {});
  }, [me?.id]);

  const phase = league?.phase;
  const draftish = phase === 'keepers' || phase === 'predraft' || phase === 'draft';
  const spectator = me?.role === 'spectator';
  const items: Item[] = [
    { to: '/', label: 'Home', icon: Home },
    draftish ? { to: '/draft', label: 'Draft', icon: ClipboardList } : spectator ? { to: '/standings', label: 'Standings', icon: Trophy } : { to: '/team', label: 'Lineup', icon: Shield },
    { to: '/chat', label: 'Chat', icon: MessageCircle },
    { to: '/players', label: 'Players', icon: Search },
  ];
  const moreItems: Item[] = [
    { to: '/standings', label: 'Standings', icon: Trophy },
    draftish ? { to: '/team', label: 'My Team', icon: Shield } : { to: '/draft', label: 'Draft Board', icon: ClipboardList },
    { to: '/keepers', label: 'Keepers', icon: Lock },
    ...(draftish ? [{ to: '/mock', label: 'Mock Draft', icon: FlaskConical }] : []),
    { to: '/trades', label: 'Trades', icon: Repeat2 },
    { to: '/bets', label: 'Side Bets', icon: Dices },
    { to: '/news', label: 'News & Injuries', icon: Newspaper },
    { to: '/league', label: 'League & History', icon: Landmark },
    { to: '/features', label: 'League Features', icon: Lightbulb },
    { to: '/profile', label: 'My Profile', icon: UserRound },
    { to: '/commish', label: 'Commissioner', icon: Wrench, commish: true },
  ].filter((i) => (!i.commish || me?.is_commish) && !(spectator && i.to === '/team'));

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
    document.title = myTurn ? `⏰ YOUR PICK · ${countdown(remaining)}` : 'SaK League';
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

  const banner = draft?.status === 'live' && !!current && !loc.pathname.startsWith('/draft');
  const nKind: Record<string, string> = { trade: '🔄', bet: '🎲', mention: '💬', draft: '📋' };
  return (
    <div className="lg:flex" style={{ '--banner': banner ? '2.25rem' : '0px' } as React.CSSProperties}>
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-white/[.06] bg-[#0a1122]/70 p-4 backdrop-blur-xl lg:flex">
        <button onClick={() => nav('/')} className="mb-7 flex items-center gap-3 px-1">
          <img src="./icon.svg" className="h-10 w-10 drop-shadow-[0_6px_16px_rgba(239,42,79,.45)]" alt="" />
          <div className="text-left"><div className="h-display text-shine text-2xl leading-none">SaK League</div><div className="mt-0.5 text-[11px] font-medium text-mute">She’s A Keeper · {league?.season}</div></div>
        </button>
        <nav className="flex flex-col gap-0.5">
          {[...items, ...moreItems].filter((i, n, a) => a.findIndex((x) => x.to === i.to) === n).map((i) => {
            const a = isActive(i.to);
            return (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={`relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${a ? 'bg-gradient-to-r from-white/[.14] to-white/[.03] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]' : 'text-slate-400 hover:bg-white/[.05] hover:text-slate-100'}`}>
                {a && <span className="absolute bottom-2 left-0 top-2 w-1 rounded-r-full bg-gradient-to-b from-goal to-blue" />}
                <i.icon size={18} strokeWidth={a ? 2.4 : 2} className={a ? 'text-blue' : ''} />{i.label}
                {i.to === '/chat' && chatUnread && <span className="ml-auto h-2 w-2 rounded-full bg-goal shadow-[0_0_8px_rgba(239,42,79,.9)]" />}
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
        <header className="pt-safe sticky top-0 z-30 border-b border-white/[.06] bg-[#070c18]/75 backdrop-blur-xl lg:hidden">
          <div className="flex h-12 items-center gap-2 px-3">
            <button onClick={() => nav('/')} className="flex items-center gap-2">
              <img src="./icon.svg" className="h-7 w-7 drop-shadow-[0_4px_10px_rgba(239,42,79,.5)]" alt="" />
              <span className="h-display text-shine text-xl">SaK</span>
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

        <main key={loc.pathname} className="page-in mb-nav mx-auto w-full max-w-5xl px-3 py-3 sm:px-5 lg:mb-0 lg:py-6">{children}</main>
      </div>

      {/* mobile dock */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 px-3 lg:hidden">
        <div className="mb-2 grid h-16 grid-cols-5 rounded-[22px] border border-white/10 bg-[#0d1528]/80 shadow-[0_18px_40px_-12px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,255,255,.07)] backdrop-blur-2xl">
          {items.map((i) => {
            const a = isActive(i.to);
            return (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className="relative flex flex-col items-center justify-center gap-1">
                <span className={`grid h-8 w-12 place-items-center rounded-full transition-all duration-200 ${a ? 'bg-gradient-to-b from-white/20 to-white/[.06] text-white shadow-[0_0_18px_-4px_rgba(76,195,255,.7)]' : 'text-slate-400'}`}>
                  <i.icon size={20} strokeWidth={a ? 2.4 : 2} />
                </span>
                <span className={`text-[10px] font-bold tracking-wide ${a ? 'text-white' : 'text-mute'}`}>{i.label}</span>
                {i.to === '/chat' && chatUnread && <span className="absolute right-[24%] top-2 h-2.5 w-2.5 rounded-full border-2 border-[#0d1528] bg-goal" />}
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
