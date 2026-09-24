import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLeague, useNow } from '../lib/store';
import { realtimeChannel, supabase } from '../lib/supabase';
import { ago, countdown } from '../lib/format';
import { Sheet, TeamBadge } from './ui';

type Item = { to: string; label: string; icon: string; commish?: boolean };

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

  const phase = league?.phase;
  const draftish = phase === 'keepers' || phase === 'predraft' || phase === 'draft';
  const items: Item[] = [
    { to: '/', label: 'Home', icon: '🏠' },
    draftish ? { to: '/draft', label: 'Draft', icon: '📋' } : { to: '/team', label: 'Lineup', icon: '🏒' },
    { to: '/chat', label: 'Chat', icon: '💬' },
    { to: '/players', label: 'Players', icon: '🔎' },
  ];
  const moreItems: Item[] = [
    { to: '/standings', label: 'Standings', icon: '🏆' },
    draftish ? { to: '/team', label: 'My Team', icon: '🏒' } : { to: '/draft', label: 'Draft Board', icon: '📋' },
    { to: '/keepers', label: 'Keepers', icon: '🔒' },
    { to: '/trades', label: 'Trades', icon: '🔄' },
    { to: '/bets', label: 'Side Bets', icon: '🎲' },
    { to: '/news', label: 'News & Injuries', icon: '🩹' },
    { to: '/league', label: 'League & History', icon: '📜' },
    { to: '/profile', label: 'My Profile', icon: '🪪' },
    { to: '/commish', label: 'Commissioner', icon: '🛠️', commish: true },
  ].filter((i) => !i.commish || me?.is_commish);

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

  return (
    <div className="lg:flex">
      {/* desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-rink/60 p-4 lg:flex">
        <button onClick={() => nav('/')} className="mb-6 flex items-center gap-2">
          <img src="./icon.svg" className="h-9 w-9" alt="" />
          <div className="text-left"><div className="h-display text-xl leading-none">SaK League</div><div className="text-[11px] text-mute">She’s A Keeper · {league?.season}</div></div>
        </button>
        <nav className="flex flex-col gap-1">
          {[...items, ...moreItems].filter((i, n, a) => a.findIndex((x) => x.to === i.to) === n).map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive: a }) => `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${a ? 'bg-white text-ice' : 'text-slate-300 hover:bg-boards'}`}>
              <span>{i.icon}</span>{i.label}
              {i.to === '/chat' && chatUnread && <span className="ml-auto h-2 w-2 rounded-full bg-goal" />}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2">
          <TeamBadge team={me ?? undefined} size={34} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{me?.name}</div><div className="text-xs text-mute">{me?.gm_name}</div></div>
          <button className="btn-ghost btn-sm relative" onClick={openNotif}>🔔{unreadN > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-goal px-1 text-[10px]">{unreadN}</span>}</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* mobile top bar */}
        <header className="pt-safe sticky top-0 z-30 border-b border-line bg-ice/90 backdrop-blur lg:hidden">
          <div className="flex h-12 items-center gap-2 px-3">
            <button onClick={() => nav('/')} className="flex items-center gap-2">
              <img src="./icon.svg" className="h-7 w-7" alt="" />
              <span className="h-display text-lg">SaK</span>
            </button>
            <div className="flex-1" />
            <button className="relative rounded-full p-2" onClick={openNotif} aria-label="Notifications">
              <span className="text-lg">🔔</span>
              {unreadN > 0 && <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-goal px-1 text-[10px] font-bold">{unreadN}</span>}
            </button>
            <button onClick={() => nav('/profile')}><TeamBadge team={me ?? undefined} size={30} /></button>
          </div>
        </header>

        {/* you're on the clock */}
        {draft?.status === 'live' && current && !loc.pathname.startsWith('/draft') && (
          <button onClick={() => nav('/draft')} className={`sticky top-12 z-20 flex w-full items-center justify-center gap-2 px-3 py-2 text-sm font-semibold lg:top-0 ${myTurn ? 'bg-goal text-white' : 'bg-sky-500 text-ice'}`}>
            {myTurn ? '⏰ You’re on the clock!' : '🟢 Draft is live'} · Pick #{current.overall} · {countdown(remaining)} → Draft room
          </button>
        )}

        <main className="mb-nav mx-auto w-full max-w-5xl px-3 py-3 sm:px-5 lg:mb-0 lg:py-6">{children}</main>
      </div>

      {/* mobile bottom nav */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-rink/95 backdrop-blur lg:hidden">
        <div className="grid h-16 grid-cols-5">
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.to === '/'} className="relative flex flex-col items-center justify-center gap-0.5">
              <span className={`text-xl transition ${isActive(i.to) ? 'scale-110' : 'opacity-60 grayscale'}`}>{i.icon}</span>
              <span className={`text-[10px] font-semibold ${isActive(i.to) ? 'text-white' : 'text-mute'}`}>{i.label}</span>
              {i.to === '/chat' && chatUnread && <span className="absolute right-[30%] top-2 h-2 w-2 rounded-full bg-goal" />}
              {i.to === '/draft' && draft?.status === 'live' && <span className="absolute right-[30%] top-2 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />}
            </NavLink>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-0.5">
            <span className="text-xl opacity-60 grayscale">☰</span>
            <span className="text-[10px] font-semibold text-mute">More</span>
          </button>
        </div>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-2 gap-2">
          {moreItems.map((i) => (
            <button key={i.to} onClick={() => { setMore(false); nav(i.to); }} className="card flex items-center gap-2 px-3 py-3 text-left text-sm font-semibold">
              <span className="text-xl">{i.icon}</span>{i.label}
            </button>
          ))}
        </div>
        <button className="btn-ghost mt-4 w-full" onClick={() => { setMore(false); supabase.auth.signOut(); }}>Sign out</button>
      </Sheet>

      <Sheet open={bell} onClose={() => setBell(false)} title="Notifications">
        {notifications.length === 0 ? <div className="py-8 text-center text-sm text-mute">Nothing yet. Go start something in the chat.</div> : (
          <div className="divide-y divide-line">
            {notifications.map((n) => (
              <button key={n.id} className="flex w-full items-start gap-3 py-2.5 text-left" onClick={() => { setBell(false); if (n.link) nav(n.link); }}>
                <span className="text-lg">{{ trade: '🔄', bet: '🎲', mention: '💬', draft: '📋' }[n.kind] ?? '🔔'}</span>
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
