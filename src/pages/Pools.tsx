// My pools (Patrick, 4 October 2026): every pool this account is in, on one page, with where they stand and what needs
// them (my_pools(), migration 151), and the way into a new one: a sports pool, a questions pool or a fantasy league,
// all from the start page (#/new, every kind of pool and the league's choices, migration 242), or a league brought over
// from Yahoo. A pool its host started can be deleted from its card (pool_delete), for testing and for good. One account, one sign-in, every
// pool a tap away; a tap opens it on the one app with the pool in the link (openPool).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Layers, Plus, Sparkles, Trash2, Trophy, Upload } from 'lucide-react';
import { rpc } from '../lib/supabase';
import { openPool } from '../lib/host';
import { useNow } from '../lib/store';
import { countdown, fmtPts, ordinal } from '../lib/format';
import { Empty, PageHeader, Section, Skeleton, useAction } from '../components/ui';
import { DeletePool } from '../components/DeletePool';
import { track } from '../lib/analytics';

interface PoolSummary {
  rank?: number; of?: number; points?: number; today?: number; back?: number; record?: string;
  worth?: number; coins?: number; closing?: number; open?: number; next_drop?: string | null;
  trade_offers?: number; draft?: 'live' | 'paused' | null; on_clock?: boolean; deadline?: string | null;
  unread_chat?: number; alerts?: number;
}
interface MyPool {
  league_id: number; slug: string; name: string; short: string | null; kind: 'fantasy' | 'predict'; status: string; sport: string;
  role: 'commish' | 'gm' | 'spectator'; team_id: number | null; team: string | null; here: boolean;
  brand: { colors?: { gold?: string }; wordmark?: { a: string; b: string }; coin?: { name: string; emoji: string }; tagline?: string };
  summary?: PoolSummary;
}

const hex = (c?: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '#f7c548');
const rgb = (c: string) => `${parseInt(c.slice(1, 3), 16)} ${parseInt(c.slice(3, 5), 16)} ${parseInt(c.slice(5, 7), 16)}`;

// how many things want this member's attention, so the pools that need them sort first
const needs = (s?: PoolSummary) => (s?.on_clock ? 10 : 0) + (s?.trade_offers ?? 0) * 3 + (s?.closing ?? 0) * 2 + (s?.alerts ?? 0) + Math.min(s?.unread_chat ?? 0, 5) / 5;

// a pool's crest in its own colour (SaK keeps its drawn badge)
function PoolCrest({ p, size = 52 }: { p: MyPool; size?: number }) {
  const c = hex(p.brand.colors?.gold);
  if (p.league_id === 1) return <img src="./icon.svg" alt="" style={{ width: size, height: size }} className="shrink-0 drop-shadow-[0_8px_18px_rgba(247,197,72,.35)]" />;
  const s = (p.short ?? p.name).slice(0, 4).toUpperCase();
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-[28%] border border-white/10"
      style={{ width: size, height: size, background: 'radial-gradient(circle at 50% 30%, #1a2747, #070b16 75%)', boxShadow: `0 10px 24px -12px rgb(${rgb(c)} / .7)` }}>
      <span className="absolute inset-[9%] rounded-full" style={{ boxShadow: `inset 0 0 0 2.5px ${c}, inset 0 0 14px rgb(${rgb(c)} / .35)` }} />
      <span className="h-display relative italic leading-none" style={{ color: c, fontSize: size * (s.length > 3 ? 0.2 : s.length > 2 ? 0.26 : 0.32), paddingRight: size * 0.03 }}>{s}</span>
    </span>
  );
}

function Chip({ tone, children, pulse, onClick }: { tone: 'red' | 'gold' | 'ice' | 'mint' | 'mute' | 'rose'; children: ReactNode; pulse?: boolean; onClick?: () => void }) {
  const cls = {
    red: 'bg-rose-500/15 text-rose-200 ring-rose-400/30', gold: 'bg-amber-300/15 text-amber-100 ring-amber-300/30', ice: 'bg-sky-400/15 text-sky-100 ring-sky-300/30',
    mint: 'bg-emerald-400/15 text-emerald-100 ring-emerald-300/30', rose: 'bg-pink-400/15 text-pink-100 ring-pink-300/30', mute: 'bg-white/[.06] text-slate-300 ring-white/10',
  }[tone];
  const body = <>{pulse && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}{children}</>;
  const k = `inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${cls}`;
  return onClick ? <button type="button" className={`${k} hover:brightness-125`} onClick={(e) => { e.stopPropagation(); onClick(); }}>{body}</button> : <span className={k}>{body}</span>;
}

const roleLabel = (p: MyPool) => p.role === 'commish' ? (p.kind === 'predict' ? 'Host' : 'Commissioner') : p.role === 'spectator' ? 'Spectator' : p.kind === 'predict' ? 'Player' : 'GM';

// a pool its host may delete: a prediction pool they host, or a league they started still being set up (never SaK)
const deletable = (p: MyPool) => p.league_id !== 1 && p.role === 'commish' && (p.kind === 'predict' || p.status === 'setup');

function PoolCard({ p, now, onDelete }: { p: MyPool; now: number; onDelete: () => void }) {
  const c = hex(p.brand.colors?.gold), s = p.summary ?? {};
  const go = (path = '') => (p.here && !path ? (location.hash = '#/') : openPool(p, path));
  const coin = p.brand.coin?.emoji ?? '🪙';
  const pool = p.kind === 'predict';
  const drop = s.next_drop ? new Date(s.next_drop).getTime() - now : null;
  const chips: ReactNode[] = [];
  if (s.on_clock) chips.push(<Chip key="clock" tone="red" pulse onClick={() => go('/draft')}>On the clock{s.deadline ? ` · ${countdown(new Date(s.deadline).getTime() - now)}` : ''}</Chip>);
  else if (s.draft === 'live') chips.push(<Chip key="draft" tone="mint" pulse onClick={() => go('/draft')}>Draft is live</Chip>);
  if (s.trade_offers) chips.push(<Chip key="tr" tone="gold" onClick={() => go('/trades')}>{s.trade_offers} trade {s.trade_offers === 1 ? 'offer' : 'offers'}</Chip>);
  if (s.closing) chips.push(<Chip key="cl" tone="rose" onClick={() => go('/questions')}>{s.closing} closing soon</Chip>);
  if (s.unread_chat) chips.push(<Chip key="ch" tone="ice" onClick={() => go('/chat')}>{s.unread_chat > 98 ? '99+' : s.unread_chat} new in chat</Chip>);
  if (s.alerts) chips.push(<Chip key="al" tone="mute">{s.alerts} {s.alerts === 1 ? 'alert' : 'alerts'}</Chip>);
  if (pool && drop != null && drop > 0) chips.push(<Chip key="dr" tone="mute">{coin} Coin drop in {countdown(drop)}</Chip>);
  return (
    <div role="button" tabIndex={0} onClick={() => go()} onKeyDown={(e) => { if (e.key === 'Enter') go(); }} className="group relative w-full cursor-pointer overflow-hidden rounded-3xl border border-white/[.08] p-4 text-left transition hover:border-white/20 active:scale-[.99]"
      style={{ background: `radial-gradient(420px 180px at 0% 0%, rgb(${rgb(c)} / .16), transparent 70%), linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.015))` }}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: `linear-gradient(180deg, ${c}, transparent)` }} />
      <div className="flex items-center gap-3">
        <PoolCrest p={p} />
        <div className="min-w-0 flex-1">
          <div className="break-words text-[17px] font-bold leading-tight">{p.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
            <span style={{ color: c }}>{pool ? 'Prediction pool' : p.sport === 'nhl' ? 'Fantasy hockey' : 'Fantasy'}</span>
            <span className="text-white/25">·</span><span className="text-mute">{roleLabel(p)}</span>
            {p.status === 'setup' && <><span className="text-white/25">·</span><span className="text-amber-200">Setting up</span></>}
          </div>
        </div>
        {p.here ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-bold text-emerald-200 ring-1 ring-emerald-300/30"><Check size={12} />Here now</span>
          : <ArrowRight size={18} className="shrink-0 text-white/40 transition group-hover:translate-x-0.5 group-hover:text-white" />}
        {deletable(p) && (
          <button type="button" aria-label={`Delete ${p.name}`} title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 transition hover:bg-red-500/15 hover:text-red-300"><Trash2 size={15} /></button>
        )}
      </div>
      {s.rank != null && (
        <div className="mt-3.5 flex items-end gap-4">
          <div className="leading-none">
            <span className="h-display text-[34px] leading-none" style={{ color: c }}>{ordinal(s.rank)}</span>
            <span className="ml-1.5 text-sm text-mute">of {s.of}</span>
          </div>
          <div className="min-w-0 flex-1 pb-0.5 text-sm text-slate-300">
            {pool ? <><b className="num text-white">{Math.round(s.worth ?? 0).toLocaleString()}</b> worth <span className="text-mute">· {coin} {(s.coins ?? 0).toLocaleString()} to spend</span></>
              : s.record ? <><b className="num text-white">{s.record}</b> <span className="text-mute">record</span></>
              : <><b className="num text-white">{fmtPts(s.points)}</b> pts{s.today ? <span className="text-emerald-300"> · +{fmtPts(s.today)} today</span> : null}{s.back ? <span className="text-mute"> · {fmtPts(s.back)} back</span> : s.rank === 1 ? <span className="text-amber-200"> · in front</span> : null}</>}
          </div>
        </div>
      )}
      {chips.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{chips}</div>}
    </div>
  );
}


// invitations addressed to this account (migration 163): the pool, who asked, how many are in; join or not now
interface Invite { code: string; league_id: number; name: string; short: string; slug: string; color: string | null; tagline: string | null; host: string | null; members: number; expires_at: string }

function Invitations({ list, reload }: { list: Invite[]; reload: () => void }) {
  const { busy, run } = useAction();
  if (!list.length) return null;
  return (
    <Section title={`Invitations (${list.length})`}>
      <div className="grid gap-3 lg:grid-cols-2">
        {list.map((i) => {
          const c = hex(i.color ?? undefined);
          return (
            <div key={i.code} className="relative overflow-hidden rounded-3xl border p-4" style={{ borderColor: `${c}55`, background: `radial-gradient(120% 120% at 0% 0%, ${c}33, transparent 60%), linear-gradient(160deg,#151a2e,#0b1222 75%)` }}>
              <div className="flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl" style={{ background: `${c}26` }}>✉️</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[.18em]" style={{ color: c }}>{i.host ? `${i.host} invited you` : 'You’re invited'}</div>
                  <div className="break-words font-display text-xl font-extrabold leading-tight text-white">{i.name}</div>
                  <div className="text-xs text-mute">{[i.tagline, `${i.members} in`].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                <button type="button" className="btn-gold py-2.5" disabled={busy}
                  onClick={() => run(async () => { await rpc('accept_invite', { p_code: i.code }); track('join'); await openPool({ league_id: i.league_id, slug: i.slug }); })}>Join {i.short || 'the pool'}</button>
                <button type="button" className="btn-ghost px-4" disabled={busy} onClick={() => run(async () => { await rpc('decline_invite', { p_code: i.code }); reload(); }, 'Invitation turned down')}>Not now</button>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export default function Pools() {
  const now = useNow(30000);
  const [rows, setRows] = useState<MyPool[] | null>(null);
  const [deleting, setDeleting] = useState<MyPool | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const loadInvites = () => rpc<Invite[]>('my_invites').then((d) => setInvites(d ?? []), () => setInvites([]));
  const load = () => { rpc<MyPool[]>('my_pools').then((d) => setRows(d ?? []), () => setRows([])); loadInvites(); };
  useEffect(() => {
    load();
    // back on the page after a while in another app: fresh numbers
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => (rows ?? []).slice().sort((a, b) => Number(b.here) - Number(a.here) || needs(b.summary) - needs(a.summary) || a.name.localeCompare(b.name)), [rows]);
  const waiting = (rows ?? []).filter((p) => needs(p.summary) >= 1).length;
  return (
    <div className="space-y-5">
      <PageHeader icon={<Layers className="h-6 w-6 text-gold" />} title="My pools"
        sub={rows ? `${rows.length} ${rows.length === 1 ? 'pool' : 'pools'} on one account${waiting ? ` · ${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : ''}` : 'Every pool you’re in, on one account'}
        right={<a href="#/new" className="btn-gold inline-flex items-center gap-1.5"><Plus className="h-4 w-4" /> Start a pool</a>} />
      <Invitations list={invites} reload={loadInvites} />
      {!rows ? <div className="grid gap-3 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-36 rounded-3xl" />)}</div>
        : !rows.length ? <Empty icon="🏆" title="No pools yet">Start one below, or open an invite link a friend sent you.</Empty>
        : <div className="grid gap-3 lg:grid-cols-2">{sorted.map((p) => <PoolCard key={p.league_id} p={p} now={now} onDelete={() => setDeleting(p)} />)}</div>}

      <Section title="Start something new">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <a href="#/new?type=sports" className="card group flex flex-col items-start gap-2 p-4 transition hover:border-white/20">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-400/15 text-xl ring-1 ring-emerald-300/25">🏆</span>
            <b className="text-[15px]">A sports pool</b>
            <span className="text-sm text-mute">Pick’em, brackets, series picks, last one standing, Call the score, squares, prop sheets or the hockey box pool, on a league that’s on now.</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-emerald-300">Start one <ArrowRight size={14} /></span>
          </a>
          <a href="#/new?type=questions" className="card group flex flex-col items-start gap-2 p-4 transition hover:border-white/20">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-400/15 text-sky-300 ring-1 ring-sky-300/25"><Sparkles size={20} /></span>
            <b className="text-[15px]">A questions pool</b>
            <span className="text-sm text-mute">Questions with odds that move as friends call them: a show, an awards night, anything. Ready in a minute, hosted by you.</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-sky-300">Start one <ArrowRight size={14} /></span>
          </a>
          <a href="#/new?type=fantasy" className="card group flex flex-col items-start gap-2 p-4 transition hover:border-white/20">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-300/15 text-amber-200 ring-1 ring-amber-300/25"><Trophy size={20} /></span>
            <b className="text-[15px]">A fantasy league</b>
            <span className="text-sm text-mute">A draft, rosters and a season of NHL players: points or categories, season total or head-to-head, keepers or not.</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-amber-200">Set one up <ArrowRight size={14} /></span>
          </a>
          <Link to="/yahoo" className="card group flex flex-col items-start gap-2 p-4 transition hover:border-white/20">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-400/15 text-violet-200 ring-1 ring-violet-300/25"><Upload size={20} /></span>
            <b className="text-[15px]">Your Yahoo leagues</b>
            <span className="text-sm text-mute">See your leagues on Yahoo and bring one over with every past season.</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold text-violet-200">Open <ArrowRight size={14} /></span>
          </Link>
        </div>
      </Section>
      <p className="px-1 text-center text-xs text-mute">One account and one sign-in for every pool. Tap a pool to open it; your account remembers where you were.</p>
      {deleting && <DeletePool pool={deleting} open onClose={() => setDeleting(null)}
        onDone={() => { const here = deleting.here; setDeleting(null); if (here) { location.hash = '#/pools'; location.reload(); } else load(); }} />}
    </div>
  );
}
